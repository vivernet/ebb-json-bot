/** @file Проверяет настройки подключения Telegram-бота без побочных эффектов при импорте. */

/**
 * Проверяет корень Bot API и удаляет завершающие косые черты.
 * Диагностика не содержит исходный адрес, поскольку в нём могут оказаться секреты.
 *
 * @param {string | undefined} value Значение переменной окружения.
 * @returns {string | undefined} Нормализованный адрес или `undefined`.
 */
function normalizeApiRoot(value) {
  const apiRoot = value?.trim();

  if (!apiRoot) {
    return undefined;
  }

  let url;
  let pathSegments;

  try {
    url = new URL(apiRoot);
    pathSegments = decodeURIComponent(url.pathname).split('/');
  } catch {
    throw new Error('TELEGRAM_BOT_API_URL должен содержать корректный адрес HTTP или HTTPS.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('TELEGRAM_BOT_API_URL должен использовать протокол HTTP или HTTPS.');
  }

  if (url.username || url.password || apiRoot.includes('?') || apiRoot.includes('#')) {
    throw new Error('TELEGRAM_BOT_API_URL не должен содержать логин, пароль, параметры запроса или фрагмент.');
  }

  if (pathSegments.some((segment) => /^bot(?:$|[^/]*:|<|\{)/iu.test(segment))) {
    throw new Error('TELEGRAM_BOT_API_URL должен указывать на корень API без пути /bot<token>.');
  }

  return url.toString().replace(/\/+$/, '');
}

/**
 * Читает и проверяет настройки при запуске, не обращаясь к окружению при импорте.
 * Не ограничивает длину токена: его подлинность проверяет Telegram Bot API.
 *
 * @param {Record<string, string | undefined>} [env=process.env] Переменные окружения.
 * @returns {Readonly<{token: string, apiRoot: string | undefined}>} Неизменяемые настройки бота.
 */
export function readConfig(env = process.env) {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();

  if (!token) {
    throw new Error('Укажите TELEGRAM_BOT_TOKEN в файле .env или переменных окружения.');
  }

  if (/\s/u.test(token)) {
    throw new Error('TELEGRAM_BOT_TOKEN не должен содержать пробельные символы.');
  }

  return Object.freeze({
    token,
    apiRoot: normalizeApiRoot(env.TELEGRAM_BOT_API_URL),
  });
}
