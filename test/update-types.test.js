/** @file Проверяет полноту явного списка разрешённых Telegram Update. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ALL_UPDATE_TYPES } from '../src/update-types.js';

/**
 * Проверяет полный список полей Update в актуальном Telegram Bot API.
 * Отдельно покрыты три типа, которые Telegram не включает в пустой список.
 */
test('задаёт каждый актуальный тип обновления без дублей', () => {
  assert.deepEqual(ALL_UPDATE_TYPES, [
    'message',
    'edited_message',
    'channel_post',
    'edited_channel_post',
    'business_connection',
    'business_message',
    'edited_business_message',
    'deleted_business_messages',
    'guest_message',
    'message_reaction',
    'message_reaction_count',
    'inline_query',
    'chosen_inline_result',
    'callback_query',
    'shipping_query',
    'pre_checkout_query',
    'purchased_paid_media',
    'poll',
    'poll_answer',
    'my_chat_member',
    'chat_member',
    'chat_join_request',
    'chat_boost',
    'removed_chat_boost',
    'managed_bot',
    'subscription',
    'stopped_message_generation',
  ]);
  assert.equal(new Set(ALL_UPDATE_TYPES).size, ALL_UPDATE_TYPES.length);
  assert.ok(ALL_UPDATE_TYPES.includes('chat_member'));
  assert.ok(ALL_UPDATE_TYPES.includes('message_reaction'));
  assert.ok(ALL_UPDATE_TYPES.includes('message_reaction_count'));
});
