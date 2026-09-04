/** @file Проверяет ошибки точки входа без загрузки .env и обращения к Telegram. */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const entrypoint = fileURLToPath(new URL('../src/index.js', import.meta.url));

/**
 * Запускает точку входа с фиктивным окружением, гарантированно не проходящим валидацию.
 *
 * @param {Record<string, string>} settings Ошибочные настройки тестового запуска.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} Результат процесса.
 */
function runWithInvalidSettings(settings) {
  return spawnSync(process.execPath, [entrypoint], {
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, TELEGRAM_BOT_TOKEN: '', TELEGRAM_BOT_API_URL: '', ...settings },
  });
}

test('без токена завершается с кодом 1 и понятным сообщением', () => {
  const result = runWithInvalidSettings({});
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Укажите TELEGRAM_BOT_TOKEN/u);
  assert.equal(result.stdout, '');
});

test('не раскрывает секреты из неправильного адреса при запуске', () => {
  const result = runWithInvalidSettings({
    TELEGRAM_BOT_TOKEN: '123456:test-secret-token',
    TELEGRAM_BOT_API_URL: 'https://username:private-password@example.com',
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /TELEGRAM_BOT_API_URL/u);
  assert.doesNotMatch(result.stderr, /test-secret-token|private-password/u);
});
