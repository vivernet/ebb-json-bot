/** @file Форматирует ошибки без токена бота и содержимого Telegram-запросов. */

import { GrammyError, HttpError } from 'grammy';

/** Замена секретного токена в диагностических сообщениях. */
const HIDDEN_TOKEN = '[ТОКЕН СКРЫТ]';

/** Ограничивает обход некорректно сформированной цепочки причин. */
const MAX_ERROR_DEPTH = 20;

/**
 * Скрывает известный токен и токены в стандартных URL Telegram Bot API.
 * Обрабатывает URL скачивания файлов, собственный API-сервер и `%3A` вместо `:`.
 *
 * @param {string} value Подготовленная диагностическая строка.
 * @param {string} token Токен из настроек, если их удалось загрузить.
 * @returns {string} Диагностика без открытого токена.
 */
function hideTokens(value, token) {
  let result = value;

  if (token) {
    const encodedToken = encodeURIComponent(token);
    const variants = new Set([
      token,
      encodedToken,
      encodedToken.replace(/%[0-9A-F]{2}/gu, (part) => part.toLowerCase()),
    ]);

    for (const variant of variants) {
      result = result.replaceAll(variant, HIDDEN_TOKEN);
    }
  }

  return result.replace(
    /(https?:\/\/[^\s"'<>]*?\/(?:file\/)?bot)\d+(?::|%3a)[a-z0-9_-]+/giu,
    `$1${HIDDEN_TOKEN}`,
  );
}

/**
 * Читает только диагностические поля ошибки, не сериализуя произвольные объекты.
 * Сетевые причины grammY и элементы AggregateError обходятся отдельно.
 *
 * @param {unknown} error Исходная ошибка или её причина.
 * @param {Set<Error>} seen Уже обработанные ошибки для защиты от циклов.
 * @param {number} depth Глубина вложенности причин.
 * @returns {string} Диагностика до маскировки токенов.
 */
function describeError(error, seen, depth) {
  if (!(error instanceof Error)) {
    return typeof error === 'string'
      ? error
      : 'Ошибка без диагностического сообщения.';
  }

  if (seen.has(error)) {
    return '[Повторная ссылка на ошибку]';
  }

  if (depth >= MAX_ERROR_DEPTH) {
    return '[Достигнут предел вложенности причин ошибки]';
  }

  seen.add(error);

  if (error instanceof GrammyError) {
    return `GrammyError: ${error.method} — ${error.error_code}: ${error.description}`;
  }

  const parts = [typeof error.stack === 'string' ? error.stack : `${error.name}: ${error.message}`];
  const code = /** @type {Error & {code?: unknown}} */ (error).code;

  if (typeof code === 'string' || typeof code === 'number') {
    parts.push(`Код: ${code}`);
  }

  if (error.cause !== undefined) {
    parts.push(`Причина: ${describeError(error.cause, seen, depth + 1)}`);
  }

  if (error instanceof HttpError) {
    parts.push(`Ошибка HTTP: ${describeError(error.error, seen, depth + 1)}`);
  }

  if (error instanceof AggregateError) {
    for (const [index, nestedError] of error.errors.entries()) {
      parts.push(`Ошибка ${index + 1}: ${describeError(nestedError, seen, depth + 1)}`);
    }
  }

  return parts.join('\n');
}

/**
 * Сохраняет стек, код и причины ошибки, скрывая токен бота.
 * Ошибки Bot API выводятся кратко: метод, код и описание, без payload.
 * Произвольные поля объектов и контекст Telegram Update в лог не попадают.
 *
 * @param {unknown} error Ошибка обработчика, запуска или остановки бота.
 * @param {string} [token=''] Известный токен для маскировки вне URL Bot API.
 * @returns {string} Безопасная строка для записи в журнал.
 */
export function formatError(error, token = '') {
  return hideTokens(describeError(error, new Set(), 0), token);
}
