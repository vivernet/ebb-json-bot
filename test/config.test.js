/** @file Проверяет настройки на изолированных данных без чтения пользовательского .env. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { readConfig } from '../src/config.js';

/** Проверяет минимальные настройки без зависимости от длины или формата токена. */
test('принимает непустой токен и возвращает неизменяемую конфигурацию', () => {
  const config = readConfig({ TELEGRAM_BOT_TOKEN: 'test' });

  assert.deepEqual(config, { token: 'test', apiRoot: undefined });
  assert.equal(Object.isFrozen(config), true);
  assert.equal(readConfig({ TELEGRAM_BOT_TOKEN: '1:x' }).token, '1:x');
  assert.equal(readConfig({ TELEGRAM_BOT_TOKEN: ' \t1:x\r\n' }).token, '1:x');
});

/** Проверяет отсутствие токена и пробелы внутри него, в том числе случайные переносы строк. */
test('отклоняет пустой токен и внутренние пробельные символы', () => {
  for (const token of [undefined, '', ' ', 'one two', 'one\ntwo', 'one\ttwo']) {
    assert.throws(() => readConfig({ TELEGRAM_BOT_TOKEN: token }), /TELEGRAM_BOT_TOKEN/u);
  }
});

/** Сохраняет допустимый префикс обратного прокси и нормализует завершающие слеши. */
test('принимает HTTP и HTTPS с необязательным префиксом пути', () => {
  const cases = [
    [undefined, undefined],
    ['', undefined],
    ['   ', undefined],
    ['http://127.0.0.1:8081/', 'http://127.0.0.1:8081'],
    [' https://example.com/telegram/api/// ', 'https://example.com/telegram/api'],
    ['https://example.com/bot-api', 'https://example.com/bot-api'],
  ];

  for (const [apiRoot, expected] of cases) {
    const config = readConfig({ TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_BOT_API_URL: apiRoot });
    assert.equal(config.apiRoot, expected);
  }
});

/** Не допускает пути методов Telegram, учётные данные и параметры в адресе API. */
test('отклоняет некорректные и опасные адреса API без утечки их значений', () => {
  const secret = 'sensitive-test-value';
  const invalidUrls = [
    `not-a-url-${secret}`,
    `ftp://example.com/${secret}`,
    `https://${secret}@example.com`,
    `https://user:${secret}@example.com`,
    `https://example.com?key=${secret}`,
    `https://example.com#${secret}`,
    'https://example.com?',
    'https://example.com#',
    `https://example.com/bot123:${secret}`,
    `https://example.com/prefix/bot123%3A${secret}/sendMessage`,
    'https://example.com/bot<token>',
    'https://example.com/bot{token}',
    'https://example.com/bot',
    `https://example.com/%ZZ${secret}`,
  ];

  for (const apiRoot of invalidUrls) {
    assert.throws(() => readConfig({ TELEGRAM_BOT_TOKEN: 'test', TELEGRAM_BOT_API_URL: apiRoot }), (error) => {
      assert.match(error.message, /TELEGRAM_BOT_API_URL/u);
      assert.doesNotMatch(error.stack, new RegExp(secret, 'u'));
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});
