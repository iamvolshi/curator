// Proving one plug on its own.
//
// A plug is only proven by a real call on that plug, so these checks exercise the
// whole path with a fake fetch: the request that goes out, the key it carries, the
// entry that gets written, and what is refused before anything is sent. The one
// thing they cannot check is that a provider answers — only a live call can show
// that, and none of these make one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runPlugCall } from '../cli/plug-call.js';
import { proveCommand } from '../cli/prove.js';
import { renderEntry } from '../record/render.js';
import { createStore } from '../record/store.js';
import { wrapCall } from '../wrapper/wrap.js';

async function withStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'overseer-plug-prove-'));
  try {
    return await fn(createStore(join(dir, 'records.jsonl')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function reply(body, { status = 200 } = {}) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

function capture() {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.map(String).join(' '));
  return {
    text: () => lines.join('\n'),
    restore: () => {
      console.log = original;
    },
  };
}

async function runProve(options) {
  const out = capture();
  let code;
  try {
    code = await proveCommand(options);
  } finally {
    out.restore();
  }
  return { code, text: out.text() };
}

const BASETEN_ENV = { BASETEN_API_KEY: 'baseten-secret', BASETEN_MODEL: 'darrens-pick' };

test('a plug prove calls that plug, carries its key, and records one fact entry', async () => {
  await withStore(async (store) => {
    const seen = [];

    const { ok, entry } = await wrapCall({
      call: (request) =>
        runPlugCall('baseten', {
          ...request,
          env: BASETEN_ENV,
          fetchImpl: async (url, options) => {
            seen.push({ url, auth: options.headers.Authorization, body: JSON.parse(options.body) });
            return reply({ model: 'darrens-pick', choices: [{ message: { content: 'ready' } }] });
          },
        }),
      prompt: 'say ready',
      store,
      kind: 'plug-prove',
    });

    assert.equal(seen.length, 1, 'one call in, one request out');
    assert.equal(seen[0].url, 'https://inference.baseten.co/v1/chat/completions');
    assert.equal(seen[0].auth, 'Bearer baseten-secret', 'it carries the plug\u2019s own key');
    assert.equal(seen[0].body.model, 'darrens-pick');

    assert.equal(ok, true);
    assert.equal(entry.label, 'fact');
    assert.equal(entry.what.kind, 'plug-prove', 'a prove is not recorded as a worker call');
    assert.equal(entry.what.plug, 'baseten');
    assert.equal(entry.what.role, 'overseer');
    assert.equal((await store.readAll()).length, 1);

    // An entry nobody can read is not a record, so the plug prove has to read.
    const shown = renderEntry(entry);
    assert.match(shown, /prove call to the baseten plug/);
    assert.match(shown, /darrens-pick/);
  });
});

test('a plug that is not configured sends nothing, and the record says nothing was sent', async () => {
  await withStore(async (store) => {
    let called = false;

    const { ok, entry } = await wrapCall({
      call: (request) =>
        runPlugCall('openrouter', {
          ...request,
          env: {},
          fetchImpl: async () => {
            called = true;
            return reply({});
          },
        }),
      prompt: 'say ready',
      store,
      kind: 'plug-prove',
    });

    assert.equal(called, false, 'an unconfigured plug must not reach the network');
    assert.equal(ok, false);
    assert.equal(entry.what.noCallMade, true);
    assert.equal(entry.what.error.kind, 'missing-config');
    assert.equal(entry.what.plug, 'openrouter');
  });
});

test('the Worker\u2019s own plug still records itself as a worker call, with no plug field', async () => {
  await withStore(async (store) => {
    const { entry } = await wrapCall({
      call: async () => ({ ok: true, worker: 'meta-model-api', model: 'muse-spark-1.3', text: 'ready' }),
      prompt: 'say ready',
      store,
    });

    assert.equal(entry.what.kind, 'worker-call', 'a caller that states no kind keeps the old one');
    assert.equal(entry.what.worker, 'meta-model-api');
    assert.equal(Object.hasOwn(entry.what, 'plug'), false, 'the worker entry shape is unchanged');
  });
});

test('proving the Worker\u2019s plug still goes through the worker path, end to end', async () => {
  await withStore(async (store) => {
    const seen = [];
    const { code } = await runProve({
      args: ['--plug', 'meta'],
      env: { MODEL_API_KEY: 'LLM_test_key' },
      store,
      fetchImpl: async (url, options) => {
        seen.push({ url, auth: options.headers.Authorization });
        return reply({
          model: 'muse-spark-1.3',
          choices: [{ message: { content: 'ready' }, finish_reason: 'stop' }],
          usage: { total_tokens: 18 },
        });
      },
    });

    assert.equal(code, 0, 'the proof held');
    assert.deepEqual(seen, [
      { url: 'https://api.meta.ai/v1/chat/completions', auth: 'Bearer LLM_test_key' },
    ]);

    const [entry] = await store.readAll();
    assert.equal(entry.what.kind, 'worker-call');
    assert.equal(entry.what.worker, 'meta-model-api');
  });
});

test('proving another plug is reported and recorded separately, end to end', async () => {
  await withStore(async (store) => {
    const seen = [];
    const { code, text } = await runProve({
      args: ['--plug', 'baseten'],
      env: BASETEN_ENV,
      store,
      fetchImpl: async (url) => {
        seen.push(url);
        return reply({ model: 'darrens-pick', choices: [{ message: { content: 'ready' }, finish_reason: 'stop' }] });
      },
    });

    assert.equal(code, 0);
    assert.deepEqual(seen, ['https://inference.baseten.co/v1/chat/completions']);
    assert.match(text, /one call through the wrapper \(baseten\)/);
    assert.match(text, /the entry names the plug that was called/);

    const [entry] = await store.readAll();
    assert.equal(entry.what.plug, 'baseten');
    assert.equal(entry.what.kind, 'plug-prove');
  });
});

test('proving a plug that is not ready stops at exit 3 and writes no entry', async () => {
  await withStore(async (store) => {
    let called = false;
    const { code, text } = await runProve({
      args: ['--plug', 'openrouter'],
      env: {},
      store,
      fetchImpl: async () => {
        called = true;
        return reply({});
      },
    });

    assert.equal(code, 3, 'not ready is "nothing was attempted", not "the call failed"');
    assert.equal(called, false);
    assert.deepEqual(await store.readAll(), [], 'nothing was recorded because nothing happened');
    assert.match(text, /Stopped before the call/);
    assert.match(text, /OPENROUTER_BASE_URL/);
  });
});

test('an unknown plug name is refused, and the built-in names are listed', async () => {
  await withStore(async (store) => {
    const { code, text } = await runProve({ args: ['--plug', 'not-a-plug'], env: {}, store });

    assert.equal(code, 2);
    assert.match(text, /unknown plug/);
    assert.match(text, /meta, openrouter, baseten, picture/);
    assert.deepEqual(await store.readAll(), []);
  });
});

test('a dry run of a plug prove shows the request and sends nothing', async () => {
  await withStore(async (store) => {
    let called = false;
    const { code, text } = await runProve({
      args: ['--plug', 'baseten', '--dry-run'],
      env: { BASETEN_MODEL: 'darrens-pick' },
      store,
      fetchImpl: async () => {
        called = true;
        return reply({});
      },
    });

    assert.equal(code, 0);
    assert.equal(called, false);
    assert.deepEqual(await store.readAll(), []);
    assert.match(text, /https:\/\/inference\.baseten\.co\/v1\/chat\/completions/);
    assert.match(text, /Bearer <BASETEN_API_KEY>/, 'the key is a placeholder, not a key');
    assert.match(text, /darrens-pick/);
  });
});
