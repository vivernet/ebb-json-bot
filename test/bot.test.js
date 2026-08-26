/** @file Проверяет отправку JSON ботом во все чаты с доступным идентификатором. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { GrammyError } from 'grammy';

import { createBot, isExpectedDeliveryError } from '../src/bot.js';

/**
 * Устанавливает фиктивные сведения о боте, чтобы тест не вызывал getMe.
 *
 * @param {import('grammy').Bot} bot Экземпляр тестируемого бота.
 * @returns {void}
 */
function setTestBotInfo(bot) {
  bot.botInfo = {
    id: 999,
    is_bot: true,
    first_name: 'JSON Bot',
    username: 'json_test_bot',
    can_join_groups: true,
    can_read_all_group_messages: true,
    supports_inline_queries: true,
  };
}

/**
 * Подменяет транспорт grammY и сохраняет параметры вызовов Bot API.
 *
 * @param {import('grammy').Bot} bot Экземпляр тестируемого бота.
 * @returns {Array<{method: string, payload: object}>} Изменяемый список вызовов.
 */
function captureApiCalls(bot) {
  const calls = [];

  /**
   * Возвращает успешный фиктивный ответ на вызов Bot API.
   *
   * @param {Function} previous Предыдущая функция транспортной цепочки.
   * @param {string} method Имя метода Bot API.
   * @param {object} payload Параметры метода.
   * @returns {Promise<object>} Успешный ответ Bot API.
   */
  async function transformer(previous, method, payload) {
    calls.push({ method, payload });

    if (method === 'deleteMessage') {
      return { ok: true, result: true };
    }

    return {
      ok: true,
      result: method === 'answerGuestQuery'
        ? { inline_message_id: 'guest-message' }
        : {
          message_id: calls.length,
          date: 1_700_000_001,
          chat: { id: payload.chat_id, type: 'private' },
          text: payload.text,
        },
    };
  }

  bot.api.config.use(transformer);
  return calls;
}

/**
 * Создаёт ошибку Telegram Bot API с заданным методом и описанием.
 *
 * @param {number} errorCode Код ошибки Telegram.
 * @param {string} description Описание ошибки Telegram.
 * @param {string} [method] Метод Bot API.
 * @returns {GrammyError} Ошибка grammY для теста.
 */
function createGrammyError(errorCode, description, method = 'sendMessage') {
  return new GrammyError(
    `Call to '${method}' failed!`,
    { ok: false, error_code: errorCode, description },
    method,
    {},
  );
}

/** Создаёт минимальное входящее обновление Telegram с сообщением. */
function createMessageUpdate(chatType, chatId, messageOverrides = {}) {
  return {
    update_id: 1,
    message: {
      message_id: 42,
      date: 1_700_000_000,
      chat: { id: chatId, type: chatType },
      from: { id: 100, is_bot: false, first_name: 'Тест' },
      text: 'Привет',
      ...messageOverrides,
    },
  };
}

/** Проверяет отправку полного JSON в личный чат. */
test('отправляет сырое сообщение в личный чат', async () => {
  const bot = createBot({ token: '123456:test' });
  const calls = captureApiCalls(bot);
  setTestBotInfo(bot);
  const update = createMessageUpdate('private', 100);

  await bot.handleUpdate(update);

  assert.deepEqual(calls.map(({ method }) => method), ['sendMessage']);
  assert.equal(calls[0].payload.chat_id, 100);
  assert.equal(
    calls[0].payload.text,
    `<pre><code class="language-json">${JSON.stringify(update, null, 2)}</code></pre>`,
  );
  assert.equal(calls[0].payload.parse_mode, 'HTML');
});

/** Проверяет групповой чат, канал и сохранение темы форума. */
test('отправляет JSON в группы, каналы и тему форума', async () => {
  const bot = createBot({ token: '123456:test' });
  const calls = captureApiCalls(bot);
  setTestBotInfo(bot);

  await bot.handleUpdate(createMessageUpdate('supergroup', -100_123, { message_thread_id: 77 }));
  await bot.handleUpdate({
    update_id: 2,
    channel_post: {
      message_id: 8,
      date: 1_700_000_000,
      chat: { id: -100_456, type: 'channel' },
      text: 'Пост',
    },
  });

  assert.deepEqual(calls.map(({ payload }) => payload.chat_id), [-100_123, -100_456]);
  assert.equal(calls[0].payload.message_thread_id, 77);
  assert.equal(calls[1].payload.message_thread_id, undefined);
});

/** Проверяет сохранение темы в direct messages канале. */
test('отправляет JSON в исходную тему direct messages', async () => {
  const bot = createBot({ token: '123456:test' });
  const calls = captureApiCalls(bot);
  setTestBotInfo(bot);

  await bot.handleUpdate(createMessageUpdate('channel', -100_999, {
    direct_messages_topic: { topic_id: 77 },
  }));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.chat_id, -100_999);
  assert.equal(calls[0].payload.direct_messages_topic_id, 77);
  assert.equal(calls[0].payload.message_thread_id, undefined);
});

/** Проверяет обработку не-сообщения с идентификатором чата. */
test('отправляет JSON события реакции в его чат', async () => {
  const bot = createBot({ token: '123456:test' });
  const calls = captureApiCalls(bot);
  setTestBotInfo(bot);
  const update = {
    update_id: 3,
    message_reaction: { chat: { id: -100_789, type: 'supergroup' }, message_id: 9 },
  };

  await bot.handleUpdate(update);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.chat_id, -100_789);
  assert.equal(
    calls[0].payload.text,
    `<pre><code class="language-json">${JSON.stringify(update, null, 2)}</code></pre>`,
  );
});

/** Проверяет fallback в личный чат инициатора для события без исходного чата. */
test('отправляет inline_query в личный чат его отправителя', async () => {
  const bot = createBot({ token: '123456:test' });
  const calls = captureApiCalls(bot);
  setTestBotInfo(bot);
  const update = {
    update_id: 31,
    inline_query: {
      id: 'inline-query',
      from: { id: 123, is_bot: false, first_name: 'Тест' },
      query: 'json',
      offset: '',
    },
  };

  await bot.handleUpdate(update);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.chat_id, 123);
  assert.equal(
    calls[0].payload.text,
    `<pre><code class="language-json">${JSON.stringify(update, null, 2)}</code></pre>`,
  );
});

/** Проверяет специальный ответ Guest Mode. */
test('отвечает на guest_message через answerGuestQuery', async () => {
  const bot = createBot({ token: '123456:test' });
  const calls = captureApiCalls(bot);
  setTestBotInfo(bot);
  const update = {
    update_id: 4,
    guest_message: { guest_query_id: 'guest-query', chat: { id: -100_789, type: 'supergroup' } },
  };

  await bot.handleUpdate(update);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'answerGuestQuery');
  assert.equal(calls[0].payload.guest_query_id, 'guest-query');
  assert.equal(
    calls[0].payload.result.input_message_content.message_text,
    `<pre><code class="language-json">${JSON.stringify(update, null, 2)}</code></pre>`,
  );
  assert.equal(calls[0].payload.result.input_message_content.parse_mode, 'HTML');
});

/** Проверяет разбиение большого JSON и защиту от повторной отправки. */
test('делит большой JSON и игнорирует собственные сообщения', async () => {
  const bot = createBot({ token: '123456:test' });
  const calls = captureApiCalls(bot);
  setTestBotInfo(bot);
  const update = createMessageUpdate('private', 100, { text: 'x'.repeat(5_000) });

  await bot.handleUpdate(update);

  assert.equal(calls.length, 2);
  const jsonParts = calls.map(({ payload }) => payload.text
    .replace('<pre><code class="language-json">', '')
    .replace('</code></pre>', ''));
  assert.equal(jsonParts.join(''), JSON.stringify(update, null, 2));

  await bot.handleUpdate(createMessageUpdate('private', 100, {
    from: { id: 999, is_bot: true, first_name: 'JSON Bot' },
  }));
  assert.equal(calls.length, 2);
});

/** Проверяет приветствие и удаление команды /start только в личном чате. */
test('приветствует в личном чате и удаляет команду /start', async () => {
  const bot = createBot({ token: '123456:test' });
  const calls = captureApiCalls(bot);
  setTestBotInfo(bot);

  await bot.handleUpdate(createMessageUpdate('private', 100, {
    text: '/start',
    entities: [{ type: 'bot_command', offset: 0, length: 6 }],
  }));

  assert.deepEqual(calls.map(({ method }) => method), ['sendMessage', 'deleteMessage']);
  assert.match(calls[0].payload.text, /^🤖 <b>Ebb JSON Bot<\/b>/u);
  assert.match(calls[0].payload.text, /обновление, связанное с этим сообщением/u);
  assert.match(
    calls[0].payload.text,
    /Добавь меня в <a href="https:\/\/t\.me\/json_test_bot\?startgroup&amp;admin=change_info\+delete_messages\+restrict_members\+invite_users\+pin_messages\+manage_topics\+promote_members\+manage_video_chats\+anonymous\+manage_chat\+post_stories\+edit_stories\+delete_stories\+manage_tags\+send_welcome_messages">группу<\/a>/u,
  );
  assert.match(
    calls[0].payload.text,
    /<a href="https:\/\/t\.me\/json_test_bot\?startchannel&amp;admin=change_info\+post_messages\+edit_messages\+delete_messages\+restrict_members\+invite_users\+promote_members\+manage_video_chats\+anonymous\+manage_chat\+post_stories\+edit_stories\+delete_stories\+manage_direct_messages\+send_welcome_messages">канал<\/a>/u,
  );
  assert.match(
    calls[0].payload.text,
    /<blockquote>Для получения некоторых типов обновлений требуются соответствующие права администратора\.<\/blockquote>/u,
  );
  assert.equal(calls[0].payload.parse_mode, 'HTML');
  assert.deepEqual(calls[1].payload, { chat_id: 100, message_id: 42 });
});

/** Проверяет, что /start в группе остаётся обычным сырым обновлением. */
test('не показывает приветствие для /start в группе', async () => {
  const bot = createBot({ token: '123456:test' });
  const calls = captureApiCalls(bot);
  setTestBotInfo(bot);

  await bot.handleUpdate(createMessageUpdate('group', -100, {
    text: '/start',
    entities: [{ type: 'bot_command', offset: 0, length: 6 }],
  }));

  assert.deepEqual(calls.map(({ method }) => method), ['sendMessage']);
  assert.match(calls[0].payload.text, /^<pre><code class="language-json">/u);
});

/** Проверяет классификацию ожидаемых и неожиданных ошибок доставки. */
test('распознаёт ожидаемые отказы доставки Telegram', () => {
  assert.equal(isExpectedDeliveryError(createGrammyError(
    403,
    'Forbidden: bot was blocked by the user',
  )), true);
  assert.equal(isExpectedDeliveryError(createGrammyError(
    403,
    'Forbidden: bot was kicked from the supergroup chat',
  )), true);
  assert.equal(isExpectedDeliveryError(createGrammyError(
    400,
    'Bad Request: chat not found',
  )), true);
  assert.equal(isExpectedDeliveryError(createGrammyError(
    400,
    'Bad Request: query is too old and response timeout expired',
    'answerGuestQuery',
  )), true);
  assert.equal(isExpectedDeliveryError(createGrammyError(
    400,
    'Bad Request: message is too long',
  )), false);
  assert.equal(isExpectedDeliveryError(createGrammyError(
    429,
    'Too Many Requests: retry after 1',
  )), false);
  assert.equal(isExpectedDeliveryError(new Error('Ошибка приложения')), false);
});

/** Проверяет, что блокировка пользователя не создаёт запись со stack trace. */
test('молча обрабатывает блокировку бота пользователем', async () => {
  const bot = createBot({ token: '123456:test' });
  setTestBotInfo(bot);
  const consoleErrors = [];
  const originalConsoleError = console.error;

  bot.api.config.use(async () => ({
    ok: false,
    error_code: 403,
    description: 'Forbidden: bot was blocked by the user',
  }));
  console.error = (...args) => consoleErrors.push(args);

  try {
    await bot.handleUpdates([createMessageUpdate('private', 100)]);
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(consoleErrors, []);
});
