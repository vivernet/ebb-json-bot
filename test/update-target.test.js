/** @file Проверяет поиск чата, Guest Mode и защиту от самоповторения. */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getGuestQueryId,
  getUpdateTarget,
  getUpdateType,
  isOwnMessageUpdate,
} from '../src/update-target.js';

/** Проверяет маршрутизацию личных, групповых, канальных и служебных событий. */
test('находит исходный чат в поддерживаемых типах Update', () => {
  const cases = [
    [{ message: { chat: { id: 1 }, message_thread_id: 10 } }, { chatId: 1, messageThreadId: 10 }],
    [{ message: { chat: { id: -11 }, direct_messages_topic: { topic_id: 12 } } }, {
      chatId: -11,
      messageThreadId: undefined,
      directMessagesTopicId: 12,
    }],
    [{ edited_message: { chat: { id: -2 } } }, { chatId: -2, messageThreadId: undefined }],
    [{ channel_post: { chat: { id: -1003 } } }, { chatId: -1003, messageThreadId: undefined }],
    [{ guest_message: { chat: { id: -30 } } }, { chatId: -30, messageThreadId: undefined }],
    [{ message_reaction: { chat: { id: -4 } } }, { chatId: -4, messageThreadId: undefined }],
    [{ callback_query: { message: { chat: { id: -5 } } } }, { chatId: -5, messageThreadId: undefined }],
    [{ deleted_business_messages: { chat: { id: 6 } } }, { chatId: 6, messageThreadId: undefined }],
    [{ stopped_message_generation: { chat: { id: 7 }, message_thread_id: 8 } }, { chatId: 7, messageThreadId: 8 }],
    [{ business_connection: { user_chat_id: 9_007_199_254_740_000 } }, { chatId: 9_007_199_254_740_000, messageThreadId: undefined }],
    [{ poll_answer: { voter_chat: { id: -10 } } }, { chatId: -10, messageThreadId: undefined }],
  ];

  for (const [update, expected] of cases) {
    assert.deepEqual(getUpdateTarget(update), expected);
  }
});

/** Проверяет особый ответ Guest Mode и тип события. */
test('извлекает guest_query_id и тип Update', () => {
  const update = { update_id: 10, guest_message: { guest_query_id: 'guest-query' } };

  assert.equal(getGuestQueryId(update), 'guest-query');
  assert.equal(getUpdateType(update), 'guest_message');
  assert.deepEqual(
    getUpdateTarget({ inline_query: { id: 'query', from: { id: 11 } } }),
    { chatId: 11, messageThreadId: undefined },
  );
  assert.equal(getUpdateTarget({ poll: { id: 'poll' } }), undefined);
});

/** Проверяет fallback в личный чат инициатора, если Update не содержит исходный чат. */
test('находит личный чат инициатора для событий без чата', () => {
  const cases = [
    [{ chosen_inline_result: { from: { id: 12 } } }, 12],
    [{ callback_query: { from: { id: 13 } } }, 13],
    [{ shipping_query: { from: { id: 14 } } }, 14],
    [{ pre_checkout_query: { from: { id: 15 } } }, 15],
    [{ purchased_paid_media: { from: { id: 16 } } }, 16],
    [{ poll_answer: { user: { id: 17 } } }, 17],
    [{ managed_bot: { user: { id: 18 } } }, 18],
    [{ subscription: { user: { id: 19 } } }, 19],
  ];

  for (const [update, chatId] of cases) {
    assert.deepEqual(getUpdateTarget(update), { chatId, messageThreadId: undefined });
  }
});

/** Проверяет, что собственное сообщение бота не будет обработано повторно. */
test('игнорирует сообщения, отправленные текущим ботом', () => {
  assert.equal(
    isOwnMessageUpdate({ message: { from: { id: 123 } } }, 123),
    true,
  );
  assert.equal(
    isOwnMessageUpdate({ message: { from: { id: 456 } } }, 123),
    false,
  );
});

/** Проверяет, что бизнес-события адресуются через исходное подключение. */
test('сохраняет business_connection_id сообщений и удалений', () => {
  for (const updateType of ['business_message', 'edited_business_message', 'deleted_business_messages']) {
    assert.deepEqual(getUpdateTarget({
      [updateType]: { chat: { id: 456 }, business_connection_id: 'business-connection' },
    }), {
      chatId: 456,
      messageThreadId: undefined,
      businessConnectionId: 'business-connection',
    });
  }

  assert.deepEqual(getUpdateTarget({
    business_connection: { id: 'business-connection', user_chat_id: 123 },
  }), { chatId: 123, messageThreadId: undefined });
});

/** Проверяет фактического отправителя ответа от имени бизнес-аккаунта. */
test('распознаёт собственные бизнес-сообщения по sender_business_bot', () => {
  for (const updateType of ['business_message', 'edited_business_message']) {
    const message = {
      from: { id: 456 },
      sender_business_bot: { id: 123 },
    };

    assert.equal(isOwnMessageUpdate({ [updateType]: message }, 123), true);
    assert.equal(isOwnMessageUpdate({ [updateType]: message }, 789), false);
  }
});

/** Нажатие кнопки пользователем не является повтором собственного сообщения бота. */
test('не игнорирует callback_query на собственном сообщении бота', () => {
  const update = {
    callback_query: {
      from: { id: 456 },
      message: { from: { id: 123 }, chat: { id: -100 }, message_thread_id: 77 },
    },
  };

  assert.equal(isOwnMessageUpdate(update, 123), false);
  assert.deepEqual(getUpdateTarget(update), { chatId: -100, messageThreadId: 77 });
});

/** Ответ на приватную команду виден её отправителю, а не всему групповому чату. */
test('сохраняет приватность новых и отредактированных ephemeral-команд', () => {
  for (const updateType of ['message', 'edited_message']) {
    const update = {
      [updateType]: {
        message_id: 0,
        ephemeral_message_id: 321,
        chat: { id: -100, type: 'supergroup' },
        message_thread_id: 77,
        from: { id: 456, is_bot: false },
        receiver_user: { id: 123, is_bot: true },
      },
    };

    assert.deepEqual(getUpdateTarget(update), {
      chatId: -100,
      messageThreadId: 77,
      ephemeralMessageParameters: { receiver_user_id: 456 },
      replyParameters: { ephemeral_message_id: 321 },
    });
  }
});

/** У приватной кнопки получателем ответа становится пользователь, который её нажал. */
test('сохраняет приватность callback_query на ephemeral-сообщении', () => {
  const update = {
    callback_query: {
      id: 'private-callback',
      from: { id: 456, is_bot: false },
      message: {
        message_id: 0,
        ephemeral_message_id: 321,
        chat: { id: -100, type: 'supergroup' },
        from: { id: 123, is_bot: true },
        receiver_user: { id: 456, is_bot: false },
      },
    },
  };

  assert.deepEqual(getUpdateTarget(update), {
    chatId: -100,
    messageThreadId: undefined,
    ephemeralMessageParameters: { receiver_user_id: 456, callback_query_id: 'private-callback' },
  });
  assert.equal(isOwnMessageUpdate(update, 123), false);
});

/** Неполные приватные события не допускают публичного ответа или fallback в личный чат. */
test('не раскрывает ephemeral-событие при недостаточных данных для ответа', () => {
  const message = {
    chat: { id: -100, type: 'supergroup' },
    ephemeral_message_id: 321,
    from: { id: 456, is_bot: false },
  };
  const invalidMessages = [
    { ...message, from: undefined },
    { ...message, from: { id: '456' } },
    { ...message, from: { id: 0 } },
    { ...message, from: { id: 123, is_bot: true } },
    { ...message, ephemeral_message_id: undefined },
    { ...message, ephemeral_message_id: '321' },
    { ...message, chat: undefined },
    { chat: message.chat, from: message.from, receiver_user: { id: 123 } },
  ];

  for (const invalidMessage of invalidMessages) {
    assert.equal(getUpdateTarget({ message: invalidMessage }), undefined);
  }

  for (const callback of [
    { id: 'query', from: message.from, message: { ...message, chat: undefined } },
    { id: 'query', message },
    { from: message.from, message },
    { id: '', from: message.from, message },
    { id: 'query', from: { id: 0 }, message },
  ]) {
    assert.equal(getUpdateTarget({ callback_query: callback }), undefined);
  }
});

/** Нулевой message_id бывает у отложенной отправки и сам по себе не означает приватность. */
test('не считает message_id 0 самостоятельным ephemeral-признаком', () => {
  assert.deepEqual(getUpdateTarget({ message: { message_id: 0, chat: { id: -100 } } }), {
    chatId: -100,
    messageThreadId: undefined,
  });
});
