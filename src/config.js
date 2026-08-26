/** @file Загружает и проверяет настройки подключения Telegram-бота. */

/**
 * Удаляет завершающие косые черты из корневого адреса Bot API.
 *
 * @param {string | undefined} value Значение переменной окружения.
 * @returns {string | undefined} Нормализованный адрес или `undefined`.
 */
function normalizeApiRoot(value) {
  const apiRoot = value?.trim();

  if (!apiRoot) {
    return undefined;
  }

  const url = new URL(apiRoot);

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('TELEGRAM_BOT_API_URL должен использовать протокол HTTP или HTTPS.');
  }

  return url.toString().replace(/\/+$/, '');
}

/**
 * Читает и проверяет токен Telegram-бота.
 *
 * @returns {string} Непустой токен из окружения.
 */
function readBotToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();

  if (!token) {
    throw new Error('Укажите TELEGRAM_BOT_TOKEN в файле .env.');
  }

  return token;
}

/**
 * Неизменяемая конфигурация Telegram-бота.
 *
 * @type {{token: string, apiRoot: string | undefined}}
 */
export const config = Object.freeze({
  token: readBotToken(),
  apiRoot: normalizeApiRoot(process.env.TELEGRAM_BOT_API_URL),
});
