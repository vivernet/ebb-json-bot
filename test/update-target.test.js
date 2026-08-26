/** @file Проверяет поиск чата, Guest Mode и защиту от самоповторения. */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getGuestQueryId,
  getUpdateTarget,
  getUpdateType,
  isOwnMessageUpdate,
} from '../src/update-target.js';

/** Проверяет маршрутизацию личных, групповых, канальных и служебных событий. */
test('находит исходный чат в поддерживаемых типах Update', () => {
  const cases = [
    [{ message: { chat: { id: 1 }, message_thread_id: 10 } }, { chatId: 1, messageThreadId: 10 }],
    [{ message: { chat: { id: -11 }, direct_messages_topic: { topic_id: 12 } } }, {
      chatId: -11,
      messageThreadId: undefined,
      directMessagesTopicId: 12,
    }],
    [{ edited_message: { chat: { id: -2 } } }, { chatId: -2, messageThreadId: undefined }],
    [{ channel_post: { chat: { id: -1003 } } }, { chatId: -1003, messageThreadId: undefined }],
    [{ guest_message: { chat: { id: -30 } } }, { chatId: -30, messageThreadId: undefined }],
    [{ message_reaction: { chat: { id: -4 } } }, { chatId: -4, messageThreadId: undefined }],
    [{ callback_query: { message: { chat: { id: -5 } } } }, { chatId: -5, messageThreadId: undefined }],
    [{ deleted_business_messages: { chat: { id: 6 } } }, { chatId: 6, messageThreadId: undefined }],
    [{ stopped_message_generation: { chat: { id: 7 }, message_thread_id: 8 } }, { chatId: 7, messageThreadId: 8 }],
    [{ business_connection: { user_chat_id: 9_007_199_254_740_000 } }, { chatId: 9_007_199_254_740_000, messageThreadId: undefined }],
    [{ poll_answer: { voter_chat: { id: -10 } } }, { chatId: -10, messageThreadId: undefined }],
  ];

  for (const [update, expected] of cases) {
    assert.deepEqual(getUpdateTarget(update), expected);
  }
});

/** Проверяет особый ответ Guest Mode и тип события. */
test('извлекает guest_query_id и тип Update', () => {
  const update = { update_id: 10, guest_message: { guest_query_id: 'guest-query' } };

  assert.equal(getGuestQueryId(update), 'guest-query');
  assert.equal(getUpdateType(update), 'guest_message');
  assert.deepEqual(
    getUpdateTarget({ inline_query: { id: 'query', from: { id: 11 } } }),
    { chatId: 11, messageThreadId: undefined },
  );
  assert.equal(getUpdateTarget({ poll: { id: 'poll' } }), undefined);
});

/** Проверяет fallback в личный чат инициатора, если Update не содержит исходный чат. */
test('находит личный чат инициатора для событий без чата', () => {
  const cases = [
    [{ chosen_inline_result: { from: { id: 12 } } }, 12],
    [{ callback_query: { from: { id: 13 } } }, 13],
    [{ shipping_query: { from: { id: 14 } } }, 14],
    [{ pre_checkout_query: { from: { id: 15 } } }, 15],
    [{ purchased_paid_media: { from: { id: 16 } } }, 16],
    [{ poll_answer: { user: { id: 17 } } }, 17],
    [{ managed_bot: { user: { id: 18 } } }, 18],
    [{ subscription: { user: { id: 19 } } }, 19],
  ];

  for (const [update, chatId] of cases) {
    assert.deepEqual(getUpdateTarget(update), { chatId, messageThreadId: undefined });
  }
});

/** Проверяет, что собственное сообщение бота не будет обработано повторно. */
test('игнорирует сообщения, отправленные текущим ботом', () => {
  assert.equal(
    isOwnMessageUpdate({ message: { from: { id: 123 } } }, 123),
    true,
  );
  assert.equal(
    isOwnMessageUpdate({ message: { from: { id: 456 } } }, 123),
    false,
  );
});
