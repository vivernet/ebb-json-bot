/** @file Запускает Telegram-бота в режиме long polling. */

import { createBot } from './bot.js';
import { readConfig } from './config.js';
import { formatError } from './errors.js';
import { runPolling } from './polling.js';

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
  let token = '';
  try {
    const config = readConfig();
    token = config.token;
    const bot = createBot(config);
    await runPolling(bot, { onStart: logBotStart });
  } catch (error) {
    console.error(`Не удалось запустить или корректно остановить бота: ${formatError(error, token)}`);
    process.exitCode = 1;
  }
}

await main();
