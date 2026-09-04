/** @file Определяет, в какой чат Telegram можно вернуть JSON обновления. */

/** Пути к объектам, которые содержат исходный чат обновления. */
const CHAT_CONTAINERS = Object.freeze([
  ['message'],
  ['edited_message'],
  ['channel_post'],
  ['edited_channel_post'],
  ['business_message'],
  ['edited_business_message'],
  ['deleted_business_messages'],
  ['guest_message'],
  ['message_reaction'],
  ['message_reaction_count'],
  ['callback_query', 'message'],
  ['my_chat_member'],
  ['chat_member'],
  ['chat_join_request'],
  ['chat_boost'],
  ['removed_chat_boost'],
  ['stopped_message_generation'],
]);

/** Пути к пользователям, которым можно написать в личный чат при отсутствии чата события. */
const ACTOR_CONTAINERS = Object.freeze([
  ['inline_query', 'from'],
  ['chosen_inline_result', 'from'],
  ['callback_query', 'from'],
  ['shipping_query', 'from'],
  ['pre_checkout_query', 'from'],
  ['purchased_paid_media', 'from'],
  ['poll_answer', 'user'],
  ['managed_bot', 'user'],
  ['subscription', 'user'],
]);

/** Пути к сообщениям, отправленным самим ботом и не требующим эхо. */
const MESSAGE_CONTAINERS = Object.freeze([
  ['message'],
  ['edited_message'],
  ['channel_post'],
  ['edited_channel_post'],
  ['business_message'],
  ['edited_business_message'],
  ['guest_message'],
]);

/**
 * Возвращает вложенное значение без выбрасывания ошибки для неполного Update.
 *
 * @param {object} value Исходный объект.
 * @param {readonly string[]} path Путь к полю объекта.
 * @returns {unknown} Найденное значение либо `undefined`.
 */
function getAtPath(value, path) {
  return path.reduce(
    (current, key) => (current && typeof current === 'object' ? current[key] : undefined),
    value,
  );
}

/**
 * Проверяет, годится ли значение в качестве идентификатора чата Telegram.
 *
 * @param {unknown} value Значение для проверки.
 * @returns {value is number | string} Признак идентификатора чата.
 */
function isChatId(value) {
  return (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.length > 0);
}

/**
 * @typedef {object} ChatTarget
 * @property {number | string} chatId Идентификатор чата для `sendMessage`.
 * @property {number | undefined} messageThreadId Тема форума, если она известна.
 * @property {number | undefined} [directMessagesTopicId] Тема direct messages канала.
 * @property {string} [businessConnectionId] Подключение бизнес-аккаунта, от имени которого отправляется ответ.
 * @property {{receiver_user_id: number, callback_query_id?: string}} [ephemeralMessageParameters] Параметры ответа, видимого только инициатору приватного события.
 * @property {{ephemeral_message_id: number}} [replyParameters] Привязка ответа к входящей приватной команде.
 */

/**
 * Формирует адресат из объекта с полем `chat`.
 *
 * @param {unknown} container Объект Telegram, содержащий чат.
 * @returns {ChatTarget | undefined} Адресат либо `undefined`.
 */
function getChatTarget(container) {
  if (!container || typeof container !== 'object') {
    return undefined;
  }

  const chatId = container.chat?.id;

  if (!isChatId(chatId)) {
    return undefined;
  }

  const directMessagesTopicId = container.direct_messages_topic?.topic_id;
  const businessConnectionId = container.business_connection_id;

  return {
    chatId,
    messageThreadId: Number.isSafeInteger(container.message_thread_id)
      ? container.message_thread_id
      : undefined,
    ...(Number.isSafeInteger(directMessagesTopicId)
      ? { directMessagesTopicId }
      : {}),
    ...(typeof businessConnectionId === 'string' && businessConnectionId.length > 0
      ? { businessConnectionId }
      : {}),
  };
}

/**
 * Проверяет признаки приватного сообщения внутри группового чата.
 * Одного `message_id: 0` недостаточно: такой идентификатор бывает и у отложенной отправки.
 *
 * @param {unknown} container Возможный объект Message.
 * @returns {boolean} `true`, если событие нельзя публиковать для всего чата.
 */
function isEphemeralMessage(container) {
  return Boolean(container && typeof container === 'object'
    && ('ephemeral_message_id' in container || 'receiver_user' in container));
}

/**
 * Сохраняет приватность команды или нажатия кнопки ephemeral-сообщения.
 * Получателем ответа становится инициатор события, а не получатель исходного сообщения.
 * При неполных данных запрещает отправку, чтобы JSON не появился в общем чате.
 *
 * @param {object} message Исходное приватное сообщение.
 * @param {ChatTarget | undefined} target Основной адресат сообщения.
 * @param {object | undefined} callbackQuery Запрос нажатия кнопки, если он есть.
 * @returns {ChatTarget | undefined} Приватный адресат либо `undefined`.
 */
function getEphemeralTarget(message, target, callbackQuery) {
  const actor = callbackQuery ? callbackQuery.from : message.from;

  if (!target || !Number.isSafeInteger(actor?.id) || actor.id <= 0 || actor.is_bot === true) {
    return undefined;
  }

  if (callbackQuery) {
    if (typeof callbackQuery.id !== 'string' || callbackQuery.id.length === 0) {
      return undefined;
    }

    return {
      ...target,
      ephemeralMessageParameters: {
        receiver_user_id: actor.id,
        callback_query_id: callbackQuery.id,
      },
    };
  }

  if (!Number.isSafeInteger(message.ephemeral_message_id)) {
    return undefined;
  }

  return {
    ...target,
    ephemeralMessageParameters: { receiver_user_id: actor.id },
    replyParameters: { ephemeral_message_id: message.ephemeral_message_id },
  };
}

/**
 * Формирует адресат из объекта Chat без привязки к контейнеру Update.
 *
 * @param {unknown} chat Объект чата Telegram.
 * @returns {ChatTarget | undefined} Адресат либо `undefined`.
 */
function getDirectChatTarget(chat) {
  if (!chat || typeof chat !== 'object' || !isChatId(chat.id)) {
    return undefined;
  }

  return { chatId: chat.id, messageThreadId: undefined };
}

/**
 * Формирует адресат личного чата пользователя из объекта User.
 *
 * @param {unknown} user Объект пользователя Telegram.
 * @returns {ChatTarget | undefined} Адресат либо `undefined`.
 */
function getUserTarget(user) {
  if (!user || typeof user !== 'object' || !isChatId(user.id)) {
    return undefined;
  }

  return { chatId: user.id, messageThreadId: undefined };
}

/**
 * Находит чат, из которого пришло обновление. Если Telegram не передаёт
 * чат, но передаёт инициатора события, возвращает личный чат этого пользователя.
 * Для business_connection используется документированный `user_chat_id`.
 * У бизнес-сообщений сохраняет подключение: чат бизнес-аккаунта отличается
 * от обычного чата бота с тем же идентификатором.
 * Приватные команды и кнопки ephemeral-сообщений остаются видимыми только
 * инициатору; неполные приватные события не допускают публичного или личного fallback.
 *
 * @param {object} update Сырое входящее обновление Telegram.
 * @returns {ChatTarget | undefined} Адресат либо `undefined`, если Bot API не передаёт чат.
 */
export function getUpdateTarget(update) {
  for (const path of CHAT_CONTAINERS) {
    const container = getAtPath(update, path);
    const target = getChatTarget(container);

    if (isEphemeralMessage(container)) {
      return getEphemeralTarget(
        container,
        target,
        path[0] === 'callback_query' ? update.callback_query : undefined,
      );
    }

    if (target) {
      return target;
    }
  }

  const businessConnection = update.business_connection;

  if (businessConnection && typeof businessConnection === 'object'
    && isChatId(businessConnection.user_chat_id)) {
    return { chatId: businessConnection.user_chat_id, messageThreadId: undefined };
  }

  const voterChatTarget = getDirectChatTarget(update.poll_answer?.voter_chat);

  if (voterChatTarget) {
    return voterChatTarget;
  }

  for (const path of ACTOR_CONTAINERS) {
    const target = getUserTarget(getAtPath(update, path));

    if (target) {
      return target;
    }
  }

  return undefined;
}

/**
 * Возвращает идентификатор Guest Mode-запроса, требующего answerGuestQuery.
 *
 * @param {object} update Сырое входящее обновление Telegram.
 * @returns {string | undefined} Идентификатор запроса либо `undefined`.
 */
export function getGuestQueryId(update) {
  const guestQueryId = update.guest_message?.guest_query_id;
  return typeof guestQueryId === 'string' && guestQueryId.length > 0
    ? guestQueryId
    : undefined;
}

/**
 * Извлекает тип единственного поля Update, не считая update_id.
 *
 * @param {object} update Сырое входящее обновление Telegram.
 * @returns {string} Тип обновления или `unknown`.
 */
export function getUpdateType(update) {
  return Object.keys(update).find((key) => key !== 'update_id') ?? 'unknown';
}

/**
 * Проверяет, не является ли обновление сообщением, которое бот создал сам.
 * Это исключает самоповторение JSON, если Telegram доставляет исходящие
 * сообщения бота обратно как Update.
 * У бизнес-сообщений фактический бот-отправитель указан в `sender_business_bot`.
 * Сообщение внутри `callback_query` не проверяется: событие создаёт пользователь,
 * нажавший кнопку, даже если сама кнопка находится в сообщении текущего бота.
 *
 * @param {object} update Сырое входящее обновление Telegram.
 * @param {number} botId Идентификатор текущего бота.
 * @returns {boolean} `true`, если обновление отправлено ботом.
 */
export function isOwnMessageUpdate(update, botId) {
  return MESSAGE_CONTAINERS.some((path) => {
    const message = getAtPath(update, path);
    return Boolean(message && typeof message === 'object'
      && (message.from?.id === botId || message.sender_business_bot?.id === botId));
  });
}
