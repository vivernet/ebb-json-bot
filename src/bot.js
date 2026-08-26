/** @file Создаёт grammY-бота, который возвращает сырые Telegram Update как JSON. */

import { Bot, GrammyError } from 'grammy';

import { serializeUpdate, splitText, wrapJsonAsPre } from './update-json.js';
import {
  getGuestQueryId,
  getUpdateTarget,
  getUpdateType,
  isOwnMessageUpdate,
} from './update-target.js';

/** Максимальный набор прав администратора, применимых к группам и супергруппам. */
const GROUP_ADMIN_RIGHTS = Object.freeze([
  'change_info',
  'delete_messages',
  'restrict_members',
  'invite_users',
  'pin_messages',
  'manage_topics',
  'promote_members',
  'manage_video_chats',
  'anonymous',
  'manage_chat',
  'post_stories',
  'edit_stories',
  'delete_stories',
  'manage_tags',
  'send_welcome_messages',
]);

/** Максимальный набор прав администратора, применимых к каналам. */
const CHANNEL_ADMIN_RIGHTS = Object.freeze([
  'change_info',
  'post_messages',
  'edit_messages',
  'delete_messages',
  'restrict_members',
  'invite_users',
  'promote_members',
  'manage_video_chats',
  'anonymous',
  'manage_chat',
  'post_stories',
  'edit_stories',
  'delete_stories',
  'manage_direct_messages',
  'send_welcome_messages',
]);

/** Ожидаемые ошибки Telegram для уже недоступного чата или сообщения. */
const EXPECTED_SEND_MESSAGE_ERRORS = Object.freeze([
  /chat not found/iu,
  /message thread not found/iu,
  /topic[_ ]closed/iu,
  /not enough rights to send text messages/iu,
]);

/** Ожидаемые ошибки ответа на Guest Mode-запрос с истёкшим сроком действия. */
const EXPECTED_GUEST_QUERY_ERRORS = Object.freeze([
  /query is too old/iu,
  /query[_ ]id[_ ]invalid/iu,
]);

/**
 * @typedef {object} BotSettings
 * @property {string} token Токен Telegram-бота.
 * @property {string} [apiRoot] Корневой адрес собственного Bot API.
 */

/**
 * Создаёт приветствие со ссылками для добавления текущего бота.
 *
 * @param {string} username Username запущенного Telegram-бота без `@`.
 * @returns {string} Приветствие и краткая инструкция в Telegram HTML.
 */
function createStartMessageHtml(username) {
  const encodedUsername = encodeURIComponent(username);
  const groupLink = `https://t.me/${encodedUsername}?startgroup&amp;admin=${GROUP_ADMIN_RIGHTS.join('+')}`;
  const channelLink = `https://t.me/${encodedUsername}?startchannel&amp;admin=${CHANNEL_ADMIN_RIGHTS.join('+')}`;

  return [
    '🤖 <b>Ebb JSON Bot</b>',
    '',
    'Отправь мне любое сообщение — в ответ я пришлю полученное от Telegram обновление, связанное с этим сообщением, в формате JSON.',
    '',
    `Добавь меня в <a href="${groupLink}">группу</a> или <a href="${channelLink}">канал</a> — я буду отправлять туда все обновления Telegram, связанные с этим чатом, в рамках предоставленных мне прав.`,
    '<blockquote>Для получения некоторых типов обновлений требуются соответствующие права администратора.</blockquote>',
  ].join('\n');
}

/**
 * Создаёт общие параметры Telegram HTML-сообщения.
 *
 * @returns {object} Параметры безопасного HTML-сообщения.
 */
function createHtmlMessageOptions() {
  return {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  };
}

/**
 * Создаёт параметры отправки JSON в исходную тему форума.
 *
 * @param {{messageThreadId: number | undefined, directMessagesTopicId?: number}} target Адресат обновления.
 * @returns {object} Параметры `sendMessage`.
 */
function createMessageOptions(target) {
  const htmlOptions = createHtmlMessageOptions();

  if (target.directMessagesTopicId !== undefined) {
    return {
      ...htmlOptions,
      direct_messages_topic_id: target.directMessagesTopicId,
    };
  }

  return target.messageThreadId === undefined
    ? htmlOptions
    : { ...htmlOptions, message_thread_id: target.messageThreadId };
}

/**
 * Приветствует пользователя и после ответа удаляет команду `/start`.
 * Обработчик зарегистрирован только в личных чатах.
 *
 * @param {import('grammy').Context} context Контекст команды `/start`.
 * @returns {Promise<void>} Обещание завершения отправки и удаления команды.
 */
async function handleStart(context) {
  await context.reply(createStartMessageHtml(context.me.username), createHtmlMessageOptions());
  await context.deleteMessage();
}

/**
 * Отвечает на обновление Guest Mode через специальный метод Bot API.
 * Guest-бот не обязан быть участником исходного чата, поэтому `sendMessage`
 * для него использовать нельзя.
 *
 * @param {import('grammy').Context} context Контекст входящего обновления.
 * @param {string} guestQueryId Идентификатор Guest Mode-запроса.
 * @param {string} json Сырое JSON-представление обновления.
 * @returns {Promise<boolean>} `true`, если JSON был полностью отправлен.
 */
async function replyToGuestQuery(context, guestQueryId, json) {
  const [jsonPart, ...remainingParts] = splitText(json);

  if (remainingParts.length > 0) {
    console.warn(
      `Guest Mode update ${context.update.update_id} длиннее лимита Telegram и не может быть отправлен целиком.`,
    );
    return false;
  }

  await context.api.answerGuestQuery(guestQueryId, {
    type: 'article',
    id: `raw-update-${context.update.update_id}`,
    title: 'Raw Telegram Update JSON',
    input_message_content: {
      message_text: wrapJsonAsPre(jsonPart),
      ...createHtmlMessageOptions(),
    },
  });

  return true;
}

/**
 * Получает любое обновление и отправляет его JSON в связанный с ним чат.
 *
 * @param {import('grammy').Context} context Контекст входящего обновления.
 * @returns {Promise<void>} Обещание завершения обработки обновления.
 */
async function handleRawUpdate(context) {
  const update = context.update;

  if (isOwnMessageUpdate(update, context.me.id)) {
    return;
  }

  const json = serializeUpdate(update);
  const guestQueryId = getGuestQueryId(update);

  if (guestQueryId) {
    await replyToGuestQuery(context, guestQueryId, json);
    return;
  }

  const target = getUpdateTarget(update);

  if (!target) {
    console.warn(
      `Update ${update.update_id} типа ${getUpdateType(update)} не содержит чата для отправки JSON.`,
    );
    return;
  }

  const messageOptions = createMessageOptions(target);

  for (const jsonPart of splitText(json)) {
    await context.api.sendMessage(target.chatId, wrapJsonAsPre(jsonPart), messageOptions);
  }
}

/**
 * Определяет штатный отказ доставки, который не требует stack trace.
 * Такое происходит, например, сразу после блокировки бота пользователем
 * или удаления бота из группы/канала.
 *
 * @param {unknown} error Исходная ошибка middleware grammY.
 * @returns {boolean} `true`, если ошибку можно безопасно подавить.
 */
export function isExpectedDeliveryError(error) {
  if (!(error instanceof GrammyError)) {
    return false;
  }

  if (error.method === 'sendMessage') {
    if (error.error_code === 403) {
      return true;
    }

    return error.error_code === 400
      && EXPECTED_SEND_MESSAGE_ERRORS.some((pattern) => pattern.test(error.description));
  }

  return error.method === 'answerGuestQuery'
    && error.error_code === 400
    && EXPECTED_GUEST_QUERY_ERRORS.some((pattern) => pattern.test(error.description));
}

/**
 * Подавляет ожидаемые отказы доставки и выводит остальные ошибки без
 * завершения polling. Ошибки Telegram API выводятся кратко, без stack trace.
 *
 * @param {import('grammy').BotError<import('grammy').Context>} error Ошибка обработчика.
 * @returns {void}
 */
function handleBotError(error) {
  if (isExpectedDeliveryError(error.error)) {
    return;
  }

  if (error.error instanceof GrammyError) {
    console.error(
      `Ошибка Telegram Bot API при обработке Update ${error.ctx.update.update_id}: ${error.error.method} — ${error.error.error_code}: ${error.error.description}`,
    );
    return;
  }

  console.error('Ошибка при обработке обновления Telegram:', error.error);
}

/**
 * Создаёт и настраивает экземпляр grammY-бота.
 *
 * @param {BotSettings} settings Настройки подключения к Telegram.
 * @returns {Bot} Настроенный экземпляр бота.
 */
export function createBot(settings) {
  const botOptions = settings.apiRoot
    ? { client: { apiRoot: settings.apiRoot } }
    : undefined;
  const bot = new Bot(settings.token, botOptions);
  const privateMessages = bot.chatType('private');

  privateMessages.command('start', handleStart);
  bot.use(handleRawUpdate);
  bot.catch(handleBotError);

  return bot;
}
