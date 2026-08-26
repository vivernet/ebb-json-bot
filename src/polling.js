/** @file Определяет настройки long polling с сохранением очереди Telegram. */

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
