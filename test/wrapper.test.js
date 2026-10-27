// The wrapper: one call in, exactly one fact entry out — success or failure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStore } from '../record/store.js';
import { wrapCall } from '../wrapper/wrap.js';
import { runWorkerCall } from '../worker/client.js';

async function withStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'overseer-wrapper-'));
  try {
    return await fn(createStore(join(dir, 'records.jsonl')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const goodCall = async () => ({
  ok: true,
  worker: 'meta-model-api',
  endpoint: 'POST https://api.meta.ai/v1/chat/completions',
  model: 'muse-spark-1.3',
  text: 'ready',
  finishReason: 'stop',
  usage: { total_tokens: 15 },
  durationMs: 40,
  error: null,
  warnings: [],
});

test('a working call is recorded as one fact entry', async () => {
  await withStore(async (store) => {
    const result = await wrapCall({ call: goodCall, prompt: 'say ready', store });

    assert.equal(result.ok, true);
    assert.equal(result.entry.label, 'fact');
    assert.equal(result.entry.what.ok, true);
    assert.equal(result.entry.what.response, 'ready');
    assert.equal(result.entry.what.model, 'muse-spark-1.3');
    assert.equal(result.entry.what.prompt, 'say ready');
    assert.equal((await store.readAll()).length, 1);
  });
});

test('a failed call is recorded too, because it also happened', async () => {
  await withStore(async (store) => {
    const failing = async () => ({
      ok: false,
      worker: 'meta-model-api',
      model: 'muse-spark-1.3',
      text: null,
      error: { kind: 'auth', retryable: false, fix: 'fix the key', message: 'Unauthorized' },
    });

    const result = await wrapCall({ call: failing, prompt: 'say ready', store });

    assert.equal(result.ok, false);
    assert.equal(result.entry.label, 'fact');
    assert.equal(result.entry.what.ok, false);
    assert.equal(result.entry.what.error.kind, 'auth');
    assert.equal((await store.readAll()).length, 1);
  });
});

test('a worker that throws is recorded, and does not take the caller down', async () => {
  await withStore(async (store) => {
    const exploding = async () => {
      throw new Error('the worker itself broke');
    };

    const result = await wrapCall({ call: exploding, prompt: 'say ready', store });
    const [stored] = await store.readAll();

    // The throw was caught and handed back, not propagated at the caller.
    assert.ok(result.threw instanceof Error);
    assert.match(result.threw.message, /worker itself broke/);
    assert.equal(result.ok, false);
    assert.equal(stored.label, 'fact');
    assert.match(stored.what.error.message, /worker itself broke/);
    assert.equal((await store.readAll()).length, 1);
  });
});

test('two calls write two entries, in order', async () => {
  await withStore(async (store) => {
    await wrapCall({ call: goodCall, prompt: 'first', store });
    await wrapCall({ call: goodCall, prompt: 'second', store });

    const entries = await store.readAll();
    assert.equal(entries.length, 2);
    assert.deepEqual(
      entries.map((e) => e.seq),
      [1, 2],
    );
    assert.equal(entries[1].what.prompt, 'second');
  });
});

test('the wrapper refuses to run without a call or a store', async () => {
  await withStore(async (store) => {
    await assert.rejects(() => wrapCall({ prompt: 'x', store }), /needs a call function/);
    await assert.rejects(() => wrapCall({ call: goodCall, prompt: 'x' }), /needs a record store/);
  });
});

/** A worker call wired to a fake fetch that hands back whatever it was sent. */
async function recordOneWorkerCall(store, { env, onSend }) {
  return wrapCall({
    call: (request) =>
      runWorkerCall({
        ...request,
        env,
        fetchImpl: async (url, options) => {
          onSend?.(url, options);
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                model: 'muse-spark-1.3',
                choices: [{ message: { content: 'ready' }, finish_reason: 'stop' }],
              }),
          };
        },
      }),
    prompt: 'say ready',
    store,
  });
}

test('the entry keeps the exact body that went out, byte for byte', async () => {
  await withStore(async (store) => {
    let sentBody = null;

    await recordOneWorkerCall(store, {
      env: { MODEL_API_KEY: 'LLM_test_key' },
      onSend: (_url, options) => {
        sentBody = options.body;
      },
    });

    const [entry] = await store.readAll();

    assert.equal(typeof sentBody, 'string', 'the transport really did serialize something');
    assert.equal(
      JSON.stringify(entry.what.request.body),
      sentBody,
      'the stored body re-serializes to exactly what went over the wire',
    );
    assert.equal(entry.what.request.method, 'POST');
    assert.equal(entry.what.request.url, 'https://api.meta.ai/v1/chat/completions');
    assert.deepEqual(entry.what.request.body.messages, [{ role: 'user', content: 'say ready' }]);
  });
});

test('the key never reaches the record, even though the request does', async () => {
  await withStore(async (store) => {
    const secret = 'LLM_555000111222333_the-key-itself';

    await recordOneWorkerCall(store, { env: { MODEL_API_KEY: secret } });

    const [entry] = await store.readAll();
    const asText = JSON.stringify(entry);

    assert.equal(asText.includes(secret), false, 'no part of the key is in the entry');
    assert.equal(asText.includes('Authorization'), false, 'headers are not recorded at all');
    assert.equal(Object.hasOwn(entry.what.request, 'headers'), false);
  });
});

test('a call that was never sent records no request at all', async () => {
  await withStore(async (store) => {
    const { entry } = await recordOneWorkerCall(store, { env: {} });

    assert.equal(entry.what.noCallMade, true, 'nothing was sent');
    assert.equal(entry.what.request, null, 'so there is no request to show');
  });
});
