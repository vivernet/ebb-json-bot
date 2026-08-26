/** @file Запускает Telegram-бота в режиме long polling. */

import { createBot } from './bot.js';
import { config } from './config.js';
import { POLLING_OPTIONS } from './polling.js';

/**
 * Сообщает в консоли об успешном запуске бота.
 *
 * @param {{username: string}} botInfo Краткие сведения о запущенном боте.
 * @returns {void}
 */
function logBotStart({ username }) {
  console.log(`Бот @${username} запущен и ожидает все типы обновлений.`);
}

/**
 * Запускает long polling и регистрирует корректное завершение процесса.
 *
 * @returns {Promise<void>} Обещание, которое выполняется после остановки бота.
 */
async function main() {
  const bot = createBot(config);

  /**
   * Останавливает long polling при завершении процесса.
   *
   * @returns {void}
   */
  function stopBot() {
    bot.stop();
  }

  process.once('SIGINT', stopBot);
  process.once('SIGTERM', stopBot);

  await bot.start({ ...POLLING_OPTIONS, onStart: logBotStart });
}

await main();
