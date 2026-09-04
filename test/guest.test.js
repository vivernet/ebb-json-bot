/** @file Проверяет граничные размеры единственного ответа Guest Mode. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createGuestContent } from '../src/guest.js';

test('учитывает границу rich-текста в символах Unicode, сохраняя emoji', () => {
  const update = { text: '😀'.repeat(32752) };
  const json = JSON.stringify(update, null, 2);
  assert.equal(Array.from(json).length, 32768);
  assert.equal(createGuestContent(update, json).rich_message.blocks[0].text, json);
});

test('убирает отступы, если это позволяет отправить весь Update', () => {
  const update = { values: Array.from({ length: 5000 }, () => 0) };
  const json = JSON.stringify(update, null, 2);
  assert.ok(json.length > 32768);
  const content = createGuestContent(update, json);
  assert.equal(content.rich_message.blocks[0].text, JSON.stringify(update));
});

test('сообщает о превышении лимита вместо молчания или обрезанного JSON', () => {
  const update = { text: 'x'.repeat(32768) };
  const content = createGuestContent(update, JSON.stringify(update, null, 2));
  assert.match(content.message_text, /слишком большое/u);
  assert.equal('rich_message' in content, false);
});
