// Running real work through a plug.
//
// A task is not a prove, so these check the difference as carefully as the
// similarity: the same entry shape and the same call path, but its own kind, no
// proof ceremony in the output, and no invented prompt when none was given.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { renderEntry } from '../record/render.js';
import { createStore } from '../record/store.js';
import { taskCommand } from '../cli/task.js';

async function withStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'overseer-task-'));
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

async function runTask(options) {
  const out = capture();
  let code;
  try {
    code = await taskCommand(options);
  } finally {
    out.restore();
  }
  return { code, text: out.text() };
}

const BASETEN_ENV = { BASETEN_API_KEY: 'baseten-secret', BASETEN_MODEL: 'darrens-pick' };

test('a task calls the named plug and records one fact entry, not a proof', async () => {
  await withStore(async (store) => {
    const seen = [];

    const { code, text } = await runTask({
      args: ['--plug', 'baseten', '--prompt', 'Name the three colours of a traffic light.'],
      env: BASETEN_ENV,
      store,
      fetchImpl: async (url, options) => {
        seen.push({ url, auth: options.headers.Authorization, raw: options.body, body: JSON.parse(options.body) });
        return reply({ model: 'darrens-pick', choices: [{ message: { content: 'red, amber, green' } }] });
      },
    });

    assert.equal(code, 0, 'a task that worked exits 0');
    assert.equal(seen.length, 1, 'one call in, one request out');
    assert.equal(seen[0].auth, 'Bearer baseten-secret', 'it carries the plug\u2019s own key');
    assert.equal(seen[0].body.messages[0].content, 'Name the three colours of a traffic light.');

    const [entry] = await store.readAll();
    assert.equal(entry.label, 'fact', 'a task is an observation like any other call');
    assert.equal(entry.what.kind, 'plug-task', 'work is not recorded as a prove');
    assert.equal(entry.what.plug, 'baseten');
    assert.equal(entry.what.role, 'overseer');
    assert.equal(entry.what.ok, true);
    assert.equal(entry.what.response, 'red, amber, green');
    assert.equal(
      JSON.stringify(entry.what.request.body),
      seen[0].raw,
      'a task keeps the body exactly as it was sent',
    );

    // The output has to read as work, not as a check that something works.
    assert.match(text, /one task through the wrapper \(baseten\)/);
    assert.match(text, /red, amber, green/);
    assert.doesNotMatch(text, /\bPASS\b|\bFAILED\b/, 'a task is not a pass/fail check');
    assert.doesNotMatch(text, /Checks against what is stored/);
  });
});

test('a task entry reads as a task, and is not mistaken for a prove', async () => {
  await withStore(async (store) => {
    await runTask({
      args: ['--plug', 'baseten', '--prompt', 'say ready'],
      env: BASETEN_ENV,
      store,
      fetchImpl: async () => reply({ model: 'darrens-pick', choices: [{ message: { content: 'ready' } }] }),
    });

    const [entry] = await store.readAll();
    const shown = renderEntry(entry);

    assert.match(shown, /a task run on the baseten plug \(overseer\) using darrens-pick/);
    assert.match(shown, /result: the call worked/);
    assert.doesNotMatch(shown, /prove/, 'a task must not claim to be a proof');
  });
});

test('a task with no prompt is refused, and nothing is sent or recorded', async () => {
  await withStore(async (store) => {
    let called = false;
    const { code, text } = await runTask({
      args: ['--plug', 'baseten'],
      env: BASETEN_ENV,
      store,
      fetchImpl: async () => {
        called = true;
        return reply({});
      },
    });

    assert.equal(code, 2, 'nothing to do is a usage mistake, not a call that failed');
    assert.equal(called, false);
    assert.deepEqual(await store.readAll(), [], 'no invented prompt, and no entry');
    assert.match(text, /Nothing to do/);
    assert.match(text, /--prompt/);
  });
});

test('a task on a plug that is not ready sends nothing and records nothing', async () => {
  await withStore(async (store) => {
    let called = false;
    const { code, text } = await runTask({
      args: ['--plug', 'openrouter', '--prompt', 'say ready'],
      env: {},
      store,
      fetchImpl: async () => {
        called = true;
        return reply({});
      },
    });

    assert.equal(code, 3, 'not ready is "nothing attempted", not "the call failed"');
    assert.equal(called, false);
    assert.deepEqual(await store.readAll(), []);
    assert.match(text, /Stopped before the call/);
    assert.match(text, /OPENROUTER_BASE_URL/);
  });
});

test('a task on the Worker\u2019s plug keeps the worker path and the worker entry shape', async () => {
  await withStore(async (store) => {
    const seen = [];
    const { code } = await runTask({
      args: ['--prompt', 'say ready'],
      env: { MODEL_API_KEY: 'LLM_test_key' },
      store,
      fetchImpl: async (url, options) => {
        seen.push({ url, auth: options.headers.Authorization });
        return reply({ model: 'muse-spark-1.3', choices: [{ message: { content: 'ready' } }] });
      },
    });

    assert.equal(code, 0);
    assert.deepEqual(seen, [{ url: 'https://api.meta.ai/v1/chat/completions', auth: 'Bearer LLM_test_key' }]);

    const [entry] = await store.readAll();
    assert.equal(entry.what.kind, 'worker-call', 'real work on the worker plug is still a worker call');
    assert.equal(entry.what.worker, 'meta-model-api');
    assert.equal(Object.hasOwn(entry.what, 'plug'), false, 'the worker entry shape is unchanged');
  });
});

test('a task that fails is still recorded', async () => {
  await withStore(async (store) => {
    const { code } = await runTask({
      args: ['--plug', 'baseten', '--prompt', 'say ready'],
      env: BASETEN_ENV,
      store,
      fetchImpl: async () => reply({ error: { message: 'model not found', type: 'invalid_request_error' } }, { status: 404 }),
    });

    assert.equal(code, 4, 'the call did not work');
    const [entry] = await store.readAll();
    assert.equal(entry.what.ok, false);
    assert.equal(entry.what.kind, 'plug-task');
    assert.equal(entry.what.noCallMade, false, 'the request really was sent');
  });
});

test('an unknown plug name is refused and the built-in names are listed', async () => {
  await withStore(async (store) => {
    const { code, text } = await runTask({
      args: ['--plug', 'not-a-plug', '--prompt', 'say ready'],
      env: {},
      store,
    });

    assert.equal(code, 2);
    assert.match(text, /unknown plug/);
    assert.match(text, /meta, openrouter, baseten, picture/);
    assert.deepEqual(await store.readAll(), []);
  });
});
