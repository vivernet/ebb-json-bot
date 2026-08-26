/** @file Проверяет сохранение и последовательную обработку очереди Telegram. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { POLLING_OPTIONS } from '../src/polling.js';
import { ALL_UPDATE_TYPES } from '../src/update-types.js';

/** Проверяет, что запуск не очищает накопленные обновления и не пропускает их. */
test('сохраняет очередь обновлений при запуске long polling', () => {
  assert.equal(POLLING_OPTIONS.drop_pending_updates, false);
  assert.equal('offset' in POLLING_OPTIONS, false);
  assert.strictEqual(POLLING_OPTIONS.allowed_updates, ALL_UPDATE_TYPES);
});
