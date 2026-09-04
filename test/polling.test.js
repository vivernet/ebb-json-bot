/** @file Проверяет сохранение и последовательную обработку очереди Telegram. */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';

import { Bot, HttpError } from 'grammy';

import { POLLING_OPTIONS, runPolling } from '../src/polling.js';
import { ALL_UPDATE_TYPES } from '../src/update-types.js';

/** Проверяет, что запуск не очищает накопленные обновления и не пропускает их. */
test('сохраняет очередь обновлений при запуске long polling', () => {
  assert.equal(POLLING_OPTIONS.drop_pending_updates, false);
  assert.equal('offset' in POLLING_OPTIONS, false);
  assert.strictEqual(POLLING_OPTIONS.allowed_updates, ALL_UPDATE_TYPES);
});

/**
 * Создаёт обещание, которым тест управляет без таймеров и реальной сети.
 *
 * @returns {{promise: Promise<void>, resolve: Function, reject: Function}} Управление ожиданием.
 */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('передаёт параметры polling и уведомление о запуске, затем удаляет свои слушатели', async () => {
  const signals = new EventEmitter();
  const externalListener = () => {};
  signals.on('SIGINT', externalListener);
  const botInfo = { username: 'test_bot' };
  let notified;
  await runPolling({
    async init() {},
    async start(options) {
      assert.strictEqual(options.allowed_updates, ALL_UPDATE_TYPES);
      assert.equal(options.drop_pending_updates, false);
      await options.onStart(botInfo);
    },
    stop() { assert.fail('Самопроизвольная остановка не требуется'); },
  }, {
    signals,
    onStart: (info) => { notified = info; },
  });
  assert.strictEqual(notified, botInfo);
  assert.deepEqual(signals.listeners('SIGINT'), [externalListener]);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('повторные сигналы вызывают одну остановку и ожидают middleware и подтверждение offset', async () => {
  const signals = new EventEmitter();
  const middleware = deferred();
  const confirmation = deferred();
  let stopCalls = 0;
  let completed = false;
  const running = runPolling({
    async init() {},
    start: () => middleware.promise,
    stop() { stopCalls += 1; return confirmation.promise; },
  }, { signals }).then(() => { completed = true; });
  await setImmediate();
  signals.emit('SIGINT');
  signals.emit('SIGTERM');
  signals.emit('SIGINT');
  await setImmediate();
  assert.equal(stopCalls, 1);
  assert.equal(completed, false);
  middleware.resolve();
  await setImmediate();
  assert.equal(completed, false);
  signals.emit('SIGTERM');
  assert.equal(signals.listenerCount('SIGINT'), 1);
  confirmation.resolve();
  await running;
  assert.equal(stopCalls, 1);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('ожидает middleware, даже когда подтверждение остановки уже завершилось', async () => {
  const signals = new EventEmitter();
  const middleware = deferred();
  let completed = false;
  const running = runPolling({
    async init() {},
    start: () => middleware.promise,
    async stop() {},
  }, { signals }).then(() => { completed = true; });
  await setImmediate();
  signals.emit('SIGTERM');
  await setImmediate();
  assert.equal(completed, false);
  middleware.resolve();
  await running;
});

test('останавливает бота при сигнале во время старта polling и пропускает уведомление о запуске', async () => {
  const signals = new EventEmitter();
  const startup = deferred();
  let stopCalls = 0;
  const running = runPolling({
    async init() {},
    async start(options) {
      signals.emit('SIGTERM');
      await startup.promise;
      await options.onStart({ username: 'test_bot' });
    },
    async stop() { stopCalls += 1; startup.resolve(); },
  }, {
    signals,
    onStart() { assert.fail('После сигнала завершения запуск не объявляется'); },
  });
  await running;
  assert.equal(stopCalls, 1);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('возвращает ошибку запуска и удаляет обработчики сигналов', async () => {
  const signals = new EventEmitter();
  const error = new Error('Ошибка инициализации');
  await assert.rejects(runPolling({
    async init() {},
    async start() { throw error; },
    async stop() {},
  }, { signals }), (actual) => actual === error);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

for (const synchronous of [false, true]) {
  test(`возвращает ${synchronous ? 'синхронную' : 'асинхронную'} ошибку stop после завершения middleware`, async () => {
    const signals = new EventEmitter();
    const middleware = deferred();
    const error = new Error('Ошибка подтверждения offset');
    const checked = assert.rejects(runPolling({
      async init() {},
      start: () => middleware.promise,
      stop() {
        if (synchronous) throw error;
        return Promise.reject(error);
      },
    }, { signals }), (actual) => actual === error);
    await setImmediate();
    signals.emit('SIGINT');
    // Даём stop отклониться до завершения start: необработанного rejection быть не должно.
    await setImmediate();
    middleware.resolve();
    await checked;
    assert.equal(signals.listenerCount('SIGINT'), 0);
    assert.equal(signals.listenerCount('SIGTERM'), 0);
  });
}

test('сохраняет обе ошибки, если после сигнала завершаются сбоем запуск и остановка', async () => {
  const signals = new EventEmitter();
  const startup = deferred();
  const startupError = new Error('Ошибка запуска после сигнала');
  const stopError = new Error('Ошибка остановки');
  const checked = assert.rejects(runPolling({
    async init() {},
    start: () => startup.promise,
    async stop() { startup.reject(startupError); throw stopError; },
  }, { signals }), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [startupError, stopError]);
    return true;
  });
  await setImmediate();
  signals.emit('SIGTERM');
  await checked;
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('реальный grammY получает сигнал отмены getMe и завершается до старта polling', async () => {
  const signals = new EventEmitter();
  const bot = new Bot('test');
  const calls = [];
  let requestSignal;
  bot.api.config.use(async (_previous, method, _payload, signal) => {
    calls.push(method);
    assert.equal(method, 'getMe');
    requestSignal = signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  const running = runPolling(bot, { signals });
  await setImmediate();
  assert.ok(requestSignal instanceof AbortSignal);
  signals.emit('SIGTERM');
  await running;
  assert.equal(requestSignal.aborted, true);
  assert.equal(bot.isRunning(), false);
  assert.deepEqual(calls, ['getMe']);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('не запускает polling, если init успел выполниться одновременно с сигналом остановки', async () => {
  const signals = new EventEmitter();
  await runPolling({
    async init() { signals.emit('SIGINT'); },
    start() { assert.fail('После остановки polling не запускается'); },
    stop() { assert.fail('Остановка polling до его запуска не нужна'); },
  }, { signals });
});

test('отмена останавливает внутренние повторы getMe при сетевом AbortError', async () => {
  const signals = new EventEmitter();
  const bot = new Bot('test');
  const requestStarted = deferred();
  const networkError = new HttpError('Сетевой запрос отменён', new DOMException('Отмена', 'AbortError'));
  let calls = 0;
  bot.api.config.use(async (_previous, method, _payload, signal) => {
    assert.equal(method, 'getMe');
    calls += 1;
    if (signal.aborted) throw networkError;
    requestStarted.resolve();
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(networkError), { once: true });
    });
  });
  // grammY оборачивает повтор сетевого abort в обычный Error: сохраняем диагностику.
  const checked = assert.rejects(runPolling(bot, { signals }), /Aborted delay/u);
  await requestStarted.promise;
  signals.emit('SIGTERM');
  await checked;
  assert.equal(calls, 2);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('не скрывает произвольную ошибку init после получения сигнала', async () => {
  const signals = new EventEmitter();
  const error = new Error('Ошибка конфигурации во время инициализации');
  await assert.rejects(runPolling({
    async init() { signals.emit('SIGTERM'); throw error; },
    start() { assert.fail('После ошибки polling не запускается'); },
    stop() { assert.fail('Остановка polling до его запуска не нужна'); },
  }, { signals }), (actual) => actual === error);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

for (const wrapped of [false, true]) {
  test(`считает ${wrapped ? 'обёрнутый HttpError' : 'обычный'} AbortError штатной отменой init`, async () => {
    const signals = new EventEmitter();
    await runPolling({
      async init() {
        signals.emit('SIGINT');
        const error = new DOMException('Запрос отменён', 'AbortError');
        throw wrapped ? new HttpError('Ошибка запроса getMe', error) : error;
      },
      start() { assert.fail('Отменённый запуск не продолжается'); },
      stop() { assert.fail('Остановка polling до его запуска не нужна'); },
    }, { signals });
    assert.equal(signals.listenerCount('SIGINT'), 0);
  });
}
