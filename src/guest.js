/** @file Формирует один ответ Guest Mode с учётом лимитов Telegram. */

import { TELEGRAM_MESSAGE_TEXT_LIMIT, wrapJsonAsPre } from './update-json.js';

/** Лимит суммарного текста Rich Message в символах Unicode по Bot API. */
const RICH_MESSAGE_TEXT_LIMIT = 32_768;

/**
 * Возвращает полный JSON одним сообщением: HTML для небольших обновлений,
 * rich-блок кода для больших. Если не помещается даже JSON без отступов,
 * объясняет ограничение, не выдавая обрезанный текст за полный Update.
 *
 * @param {object} update Входящее обновление Telegram.
 * @param {string} json Читаемое JSON-представление обновления.
 * @returns {import('grammy/types').InputMessageContent} Содержимое ответа Guest Mode.
 */
export function createGuestContent(update, json) {
  if (json.length <= TELEGRAM_MESSAGE_TEXT_LIMIT) {
    return {
      message_text: wrapJsonAsPre(json),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    };
  }

  let text = json;
  if (Array.from(text).length > RICH_MESSAGE_TEXT_LIMIT) {
    text = JSON.stringify(update);
  }

  if (Array.from(text).length <= RICH_MESSAGE_TEXT_LIMIT) {
    return {
      rich_message: {
        blocks: [{ type: 'pre', text, language: 'json' }],
        skip_entity_detection: true,
      },
    };
  }

  return {
    message_text: 'Это обновление слишком большое для одного ответа в гостевом режиме. '
      + 'Отправь сообщение в личный чат со мной, чтобы получить JSON нового обновления целиком.',
  };
}
