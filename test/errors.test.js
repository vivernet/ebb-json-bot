/** @file Проверяет сохранение диагностики ошибок без раскрытия токена и payload. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { GrammyError, HttpError } from 'grammy';

import { formatError } from '../src/errors.js';

/** Искусственный токен используется только для проверки маскировки. */
const TEST_TOKEN = '123456789:Test_token-only-for-unit-tests';

/** Проверяет краткий вывод ошибки API без тела запроса и полного стека. */
test('форматирует GrammyError без payload и маскирует токен в описании', () => {
  const error = new GrammyError(
    'Ошибка вызова',
    { ok: false, error_code: 400, description: `Bad Request: ${TEST_TOKEN}` },
    'sendMessage',
    { text: 'PRIVATE_UPDATE_BODY', chat_id: 123 },
  );
  error.stack = 'PRIVATE_STACK';

  assert.equal(formatError(error, TEST_TOKEN), 'GrammyError: sendMessage — 400: Bad Request: [ТОКЕН СКРЫТ]');
});

/** Проверяет стек и сетевой код исходной ошибки, вложенной в HttpError. */
test('сохраняет диагностику HttpError и скрывает токен в URL', () => {
  const networkError = new Error(`request to https://api.telegram.org/bot${TEST_TOKEN}/getUpdates failed`);
  networkError.stack = `${networkError.message}\n    at fetch (network.js:10:2)`;
  networkError.code = 'ECONNRESET';
  networkError.request = { body: 'PRIVATE_REQUEST_BODY' };
  const error = new HttpError("Network request for 'getUpdates' failed!", networkError);
  const formatted = formatError(error, TEST_TOKEN);

  assert.match(formatted, /HttpError: Network request for 'getUpdates' failed!/u);
  assert.match(formatted, /bot\[ТОКЕН СКРЫТ\]\/getUpdates/u);
  assert.match(formatted, /at fetch \(network\.js:10:2\)/u);
  assert.match(formatted, /Код: ECONNRESET/u);
  assert.ok(!formatted.includes(TEST_TOKEN));
  assert.ok(!formatted.includes('PRIVATE_REQUEST_BODY'));
});

/** Проверяет маскировку известного токена вне URL и с URL-кодированием. */
test('скрывает обычный и URL-кодированный токен во всей цепочке причин', () => {
  const encoded = encodeURIComponent(TEST_TOKEN);
  const cause = new Error(`${encoded}; ${encoded.replace('%3A', '%3a')}`);
  const error = new Error(`Токен ${TEST_TOKEN}`, { cause });
  const formatted = formatError(error, TEST_TOKEN);

  assert.match(formatted, /Причина: Error:/u);
  assert.ok(!formatted.includes(TEST_TOKEN));
  assert.ok(!formatted.includes(encoded));
  assert.ok(!formatted.includes(encoded.replace('%3A', '%3a')));
});

/** Проверяет маскировку URL при ошибке до загрузки конфигурации бота. */
test('скрывает токен в URL методов и файлов без загруженной конфигурации', () => {
  for (const url of [
    `https://api.telegram.org/bot${TEST_TOKEN}/getMe`,
    `https://api.telegram.org/file/bot${TEST_TOKEN}/documents/file.json`,
    `http://localhost:8081/proxy/bot${encodeURIComponent(TEST_TOKEN)}/getUpdates`,
  ]) {
    const formatted = formatError(new Error(`Запрос ${url} завершился ошибкой`));

    assert.ok(!formatted.includes(TEST_TOKEN));
    assert.ok(!formatted.includes(encodeURIComponent(TEST_TOKEN)));
    assert.match(formatted, /bot\[ТОКЕН СКРЫТ\]\//u);
  }
});

/** Проверяет вывод нескольких ошибок остановки вместе с общей причиной. */
test('раскрывает причины AggregateError, защищаясь от циклических ссылок', () => {
  const first = new Error('Ошибка polling');
  const second = new Error('Ошибка остановки');
  const error = new AggregateError([first, second], 'Не удалось завершить работу', { cause: first });
  second.cause = error;
  const formatted = formatError(error);

  assert.match(formatted, /AggregateError: Не удалось завершить работу/u);
  assert.match(formatted, /Причина: Error: Ошибка polling/u);
  assert.match(formatted, /Ошибка 2: Error: Ошибка остановки/u);
  assert.match(formatted, /Повторная ссылка на ошибку/u);
});

/** Проверяет резервное описание Error без стека и отказ от сериализации объектов. */
test('не сериализует произвольный объект ошибки или её причины', () => {
  const payload = {
    secret: 'PRIVATE_UPDATE_BODY',
    toString() {
      throw new Error('Объект нельзя преобразовывать в строку');
    },
  };
  const error = new Error('Нет стека', { cause: payload });
  error.stack = undefined;

  assert.equal(formatError(payload), 'Ошибка без диагностического сообщения.');
  assert.equal(formatError(error), 'Error: Нет стека\nПричина: Ошибка без диагностического сообщения.');
  assert.equal(formatError(new HttpError('Ошибка сети', payload)).includes('PRIVATE_UPDATE_BODY'), false);
});
