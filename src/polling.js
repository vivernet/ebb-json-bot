/** @file Управляет long polling с сохранением очереди и корректной остановкой. */

import { HttpError } from 'grammy';

import { ALL_UPDATE_TYPES } from './update-types.js';

/**
 * Настройки long polling без начального offset и без очистки очереди.
 * Telegram возвращает самое раннее неподтверждённое обновление, а grammY
 * последовательно обрабатывает всю накопленную очередь.
 */
export const POLLING_OPTIONS = Object.freeze({
  allowed_updates: ALL_UPDATE_TYPES,
  drop_pending_updates: false,
});

/**
 * Распознаёт только явную отмену запроса, сохраняя остальные ошибки запуска.
 *
 * @param {unknown} error Ошибка инициализации grammY.
 * @param {Error} reason Причина отмены, созданная текущим запуском.
 * @returns {boolean} Признак ожидаемой отмены.
 */
function isStartupAbort(error, reason) {
  const cause = error instanceof HttpError ? error.error : error;
  return cause === reason || (cause instanceof Error && cause.name === 'AbortError');
}

/**
 * Запускает polling и дожидается обработки обновлений и подтверждения остановки.
 * Отдельная инициализация позволяет отменить первый getMe до начала polling.
 * Повторные сигналы используют одну остановку. Ошибки запуска и остановки
 * возвращаются вызывающему коду, а обработчики сигналов всегда удаляются.
 *
 * @param {Pick<import('grammy').Bot, 'init' | 'start' | 'stop'>} bot Запускаемый бот.
 * @param {object} [options] Настройки жизненного цикла.
 * @param {import('node:events').EventEmitter} [options.signals=process] Источник сигналов.
 * @param {import('grammy').PollingOptions['onStart']} [options.onStart] Уведомление о запуске.
 * @returns {Promise<void>} Завершение polling и всех действий остановки.
 */
export async function runPolling(bot, { signals = process, onStart } = {}) {
  const errors = [];
  const startupAbort = new AbortController();
  const abortReason = new Error('Инициализация бота отменена сигналом завершения.');
  let pollingStarted = false;
  let stopping;

  /**
   * Запрашивает остановку один раз и сразу перехватывает её возможный сбой.
   * Микрозадача позволяет завершить синхронную часть bot.start перед bot.stop.
   *
   * @returns {void}
   */
  function stop() {
    startupAbort.abort(abortReason);
    if (pollingStarted) {
      stopping ??= Promise.resolve()
        .then(() => bot.stop())
        .catch((error) => { errors.push(error); });
    }
  }

  signals.on('SIGINT', stop);
  signals.on('SIGTERM', stop);

  try {
    // Встроенный start не передаёт AbortSignal первому getMe: инициализируем явно.
    await bot.init(startupAbort.signal);
    if (!startupAbort.signal.aborted) {
      pollingStarted = true;
      await bot.start({
        ...POLLING_OPTIONS,
        onStart: (botInfo) => stopping ? undefined : onStart?.(botInfo),
      });
    }
  } catch (error) {
    if (pollingStarted || !startupAbort.signal.aborted || !isStartupAbort(error, abortReason)) {
      errors.unshift(error);
    }
  } finally {
    // bot.stop подтверждает offset, а bot.start отдельно ждёт завершения middleware.
    if (stopping) await stopping;
    signals.off('SIGINT', stop);
    signals.off('SIGTERM', stop);
  }

  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Ошибки при работе и остановке long polling.');
  }
}
