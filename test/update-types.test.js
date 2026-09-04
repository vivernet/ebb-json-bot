/** @file Проверяет полноту явного списка разрешённых Telegram Update. */

import assert from 'node:assert/strict';
import test from 'node:test';
import { API_CONSTANTS } from 'grammy';

import { ALL_UPDATE_TYPES } from '../src/update-types.js';

/**
 * Проверяет полный список полей Update в актуальном Telegram Bot API.
 * Отдельно покрыты три типа, которые Telegram не включает в пустой список.
 */
test('задаёт каждый актуальный тип обновления без дублей', () => {
  // Независимый эталон из SDK выявляет новые типы после обновления grammY.
  assert.deepEqual(new Set(ALL_UPDATE_TYPES), new Set(API_CONSTANTS.ALL_UPDATE_TYPES));
  assert.equal(new Set(ALL_UPDATE_TYPES).size, ALL_UPDATE_TYPES.length);
  assert.ok(ALL_UPDATE_TYPES.includes('chat_member'));
  assert.ok(ALL_UPDATE_TYPES.includes('message_reaction'));
  assert.ok(ALL_UPDATE_TYPES.includes('message_reaction_count'));
});
