/** @file Создаёт grammY-бота, который возвращает сырые Telegram Update как JSON. */

import { Bot, GrammyError } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';

import { serializeUpdate, splitText, wrapJsonAsPre } from './update-json.js';
import { createGuestContent } from './guest.js';
import { formatError } from './errors.js';
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

/** Ожидаемые ошибки просроченного Guest Mode или callback-запроса. */
const EXPECTED_QUERY_ERRORS = Object.freeze([
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
 * @param {import('./update-target.js').ChatTarget} target Адресат обновления.
 * @returns {object} Параметры `sendMessage`.
 */
function createMessageOptions(target) {
  const htmlOptions = createHtmlMessageOptions();

  if (target.businessConnectionId !== undefined) {
    htmlOptions.business_connection_id = target.businessConnectionId;
  }

  if (target.ephemeralMessageParameters) {
    htmlOptions.ephemeral_message_parameters = target.ephemeralMessageParameters;
  }
  if (target.replyParameters) {
    htmlOptions.reply_parameters = target.replyParameters;
  }

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
  await context.reply(createStartMessageHtml(context.me.username), createMessageOptions(
    getUpdateTarget(context.update),
  ));
  try {
    await context.deleteMessage();
  } catch (error) {
    if (!isExpectedDeliveryError(error)) {
      throw error;
    }
  }
}

/**
 * Отвечает на обновление Guest Mode через специальный метод Bot API.
 * Guest-бот не обязан быть участником исходного чата, поэтому `sendMessage`
 * для него использовать нельзя.
 *
 * @param {import('grammy').Context} context Контекст входящего обновления.
 * @param {string} guestQueryId Идентификатор Guest Mode-запроса.
 * @param {string} json Сырое JSON-представление обновления.
 * @returns {Promise<void>} Завершение отправки ответа.
 */
async function replyToGuestQuery(context, guestQueryId, json) {
  await context.api.answerGuestQuery(guestQueryId, {
    type: 'article',
    id: `raw-update-${context.update.update_id}`,
    title: 'Raw Telegram Update JSON',
    input_message_content: createGuestContent(context.update, json),
  });
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

  // Подтверждение убирает индикатор на кнопке. Истёкший запрос не мешает показать JSON.
  if (update.callback_query) {
    try {
      await context.answerCallbackQuery();
    } catch (error) {
      if (!isExpectedDeliveryError(error)) {
        console.error(`Ошибка подтверждения кнопки: ${formatError(error, context.api.token)}`);
      }
    }
  }

  const guestQueryId = getGuestQueryId(update);

  if (guestQueryId) {
    await replyToGuestQuery(context, guestQueryId, serializeUpdate(update));
    return;
  }

  const target = getUpdateTarget(update);

  if (!target) {
    console.warn(
      `Update ${update.update_id} типа ${getUpdateType(update)} не содержит достаточных данных для безопасной отправки JSON.`,
    );
    return;
  }

  const messageOptions = createMessageOptions(target);

  for (const jsonPart of splitText(serializeUpdate(update))) {
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

  if (error.method === 'deleteMessage') {
    return error.error_code === 400
      && /message to delete not found|message can't be deleted/iu.test(error.description);
  }

  return ['answerGuestQuery', 'answerCallbackQuery'].includes(error.method)
    && error.error_code === 400
    && EXPECTED_QUERY_ERRORS.some((pattern) => pattern.test(error.description));
}

/**
 * Подавляет ожидаемые отказы доставки и выводит остальные ошибки без
 * завершения polling. Ошибки Telegram API выводятся кратко, без stack trace.
 *
 * @param {import('grammy').BotError<import('grammy').Context>} error Ошибка обработчика.
 * @param {string} token Токен, исключаемый из диагностики.
 * @returns {void}
 */
function handleBotError(error, token) {
  if (isExpectedDeliveryError(error.error)) {
    return;
  }

  console.error(`Ошибка при обработке Update ${error.ctx.update.update_id}: ${formatError(error.error, token)}`);
}

/**
 * Создаёт и настраивает экземпляр grammY-бота.
 *
 * @param {BotSettings} settings Настройки подключения к Telegram.
 * @returns {Bot} Настроенный экземпляр бота.
 */
export function createBot(settings) {
  const botOptions = {
    // Long polling ждёт 30 секунд; ещё 30 оставляем на соединение и ответ сервера.
    client: { timeoutSeconds: 60, ...(settings.apiRoot ? { apiRoot: settings.apiRoot } : {}) },
  };
  const bot = new Bot(settings.token, botOptions);
  // Повторяем явный отказ с retry_after, сохраняя порядок частей JSON.
  // Сетевые ошибки имеют неопределённый результат; повтор мог бы создать дубликат.
  bot.api.config.use(autoRetry({
    maxRetryAttempts: 3,
    maxDelaySeconds: 60,
    rethrowInternalServerErrors: true,
    rethrowHttpErrors: true,
  }));
  const privateMessages = bot.chatType('private');

  // Командой запуска является только новое обычное сообщение пользователя.
  privateMessages.on('message')
    .filter((context) => !isOwnMessageUpdate(context.update, context.me.id))
    .command('start', handleStart);
  bot.use(handleRawUpdate);
  bot.catch((error) => handleBotError(error, settings.token));

  return bot;
}
