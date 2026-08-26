/** @file Проверяет сериализацию и разбиение сырого Telegram Update. */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  serializeUpdate,
  splitText,
  TELEGRAM_MESSAGE_TEXT_LIMIT,
  wrapJsonAsPre,
} from '../src/update-json.js';

/** Проверяет читаемый JSON без изменения полей обновления. */
test('сериализует Update в читаемый JSON', () => {
  const update = {
    update_id: 42,
    message: { chat: { id: 100, type: 'private' }, text: 'Привет' },
  };

  assert.equal(
    serializeUpdate(update),
    '{\n  "update_id": 42,\n  "message": {\n    "chat": {\n      "id": 100,\n      "type": "private"\n    },\n    "text": "Привет"\n  }\n}',
  );
});

/** Проверяет HTML-экранирование JSON и указание языка блока кода. */
test('оборачивает JSON в Telegram pre-блок с языком json', () => {
  assert.equal(
    wrapJsonAsPre('{\n  "text": "<tag>&"\n}'),
    '<pre><code class="language-json">{\n  "text": "&lt;tag&gt;&amp;"\n}</code></pre>',
  );
});

/** Проверяет сохранение JSON и целостности emoji при делении сообщений. */
test('делит большой JSON без разрыва суррогатных пар', () => {
  const value = `${'a'.repeat(TELEGRAM_MESSAGE_TEXT_LIMIT - 1)}😀${'b'.repeat(10)}`;
  const parts = splitText(value);

  assert.equal(parts.join(''), value);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].length, TELEGRAM_MESSAGE_TEXT_LIMIT - 1);
  assert.ok(parts.every((part) => part.length <= TELEGRAM_MESSAGE_TEXT_LIMIT));
});

/** Проверяет пустую строку и недопустимый лимит. */
test('не создаёт пустых частей и проверяет лимит', () => {
  assert.deepEqual(splitText(''), []);
  assert.throws(() => splitText('text', 1), /не меньше 2/u);
});
