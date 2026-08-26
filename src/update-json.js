/** @file Сериализует Telegram Update и делит большой JSON на безопасные части. */

/** Максимальная длина поля `text` в методе Telegram Bot API `sendMessage`. */
export const TELEGRAM_MESSAGE_TEXT_LIMIT = 4096;

/**
 * Преобразует полученный от Telegram объект Update в читаемый JSON.
 *
 * @param {object} update Сырое входящее обновление Telegram.
 * @returns {string} JSON с отступом в два пробела.
 */
export function serializeUpdate(update) {
  return JSON.stringify(update, null, 2);
}

/**
 * Экранирует текст для Telegram HTML parse mode.
 *
 * @param {string} value Исходный текст.
 * @returns {string} Безопасный HTML-текст.
 */
function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * Показывает JSON как исходный код с подсветкой синтаксиса Telegram.
 *
 * @param {string} json Сырое JSON-представление обновления или его часть.
 * @returns {string} Безопасное HTML-сообщение в блоке `pre`.
 */
export function wrapJsonAsPre(json) {
  return `<pre><code class="language-json">${escapeHtml(json)}</code></pre>`;
}

/**
 * Делит строку без разрыва суррогатных пар. Объединение частей всегда даёт
 * исходную строку, поэтому JSON остаётся сырым, даже если его пришлось
 * отправить несколькими сообщениями.
 *
 * @param {string} value Исходный текст.
 * @param {number} [limit] Максимальная длина одной части в UTF-16-кодовых единицах.
 * @returns {string[]} Непустые части исходного текста.
 */
export function splitText(value, limit = TELEGRAM_MESSAGE_TEXT_LIMIT) {
  if (!Number.isInteger(limit) || limit < 2) {
    throw new RangeError('Лимит длины сообщения должен быть целым числом не меньше 2.');
  }

  if (!value) {
    return [];
  }

  /** @type {string[]} */
  const parts = [];
  let part = '';

  for (const codePoint of value) {
    if (part.length > 0 && part.length + codePoint.length > limit) {
      parts.push(part);
      part = '';
    }

    part += codePoint;
  }

  if (part) {
    parts.push(part);
  }

  return parts;
}
