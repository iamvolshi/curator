// The provider seam: one way out, three plugs wired, one slot waiting.
//
// Two kinds of check here. The static ones read the source and fail if a second
// call path appears — that is a property of the code, so it has to be checked
// against the code. The rest are ordinary behavioural checks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLUG_NAMES, checkPlugShape, call, health, preflight, resolvePlug } from '../provider/index.js';
import { ROUTES, plugForSlot } from '../provider/routing.js';
import { runWorkerCall } from '../worker/client.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APP_DIRS = ['provider', 'worker', 'cli', 'bin', 'wrapper', 'record'];

async function jsFilesIn(dir) {
  const entries = await readdir(join(ROOT, dir), { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await jsFilesIn(path)));
    else if (entry.name.endsWith('.js')) files.push(path.replace(/\\/g, '/'));
  }

  return files;
}

async function appFiles() {
  const files = [];
  for (const dir of APP_DIRS) files.push(...(await jsFilesIn(dir)));
  return files;
}

// Matches an actual invocation of a fetch function: fetch(...) or fetchImpl(...).
// A bare `fetch` passed along as a value does not match, which is what lets every
// layer carry a testable fetch without being a call path.
const FETCH_CALL = /(?:\bfetch|\bfetchImpl)\s*\(/;

test('the transport is the only place that can reach the network', async () => {
  const offenders = [];

  for (const file of await appFiles()) {
    const source = await readFile(join(ROOT, file), 'utf8');
    if (FETCH_CALL.test(source)) offenders.push(file);
  }

  assert.deepEqual(offenders, ['provider/transport.js']);
});

test('no file outside provider/ reaches into a plug directly', async () => {
  const offenders = [];

  for (const file of await appFiles()) {
    if (file.startsWith('provider/')) continue;
    const source = await readFile(join(ROOT, file), 'utf8');
    if (/plugs\//.test(source)) offenders.push(file);
  }

  assert.deepEqual(offenders, []);
});

test('a worker call takes exactly one hop, through the plug the routing table names', async () => {
  const env = { MODEL_API_KEY: 'LLM_test_key' };
  const expected = resolvePlug(plugForSlot('worker'), env).chatUrl;
  const seen = [];

  const outcome = await runWorkerCall({
    prompt: 'say ready',
    env,
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
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
  });

  assert.equal(seen.length, 1, 'one call in, one request out');
  assert.equal(seen[0].url, expected);
  assert.equal(seen[0].url, 'https://api.meta.ai/v1/chat/completions');
  assert.equal(seen[0].options.headers.Authorization, 'Bearer LLM_test_key');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.text, 'ready');
});

test('every plug carries the same config shape, empty slots included', () => {
  assert.deepEqual(PLUG_NAMES, ['meta', 'openrouter', 'baseten', 'picture']);

  for (const name of PLUG_NAMES) {
    const plug = resolvePlug(name, {});
    assert.deepEqual(checkPlugShape(plug), [], name);

    // Where each value came from has to be sayable for every plug.
    for (const field of ['baseUrl', 'key', 'model']) {
      assert.equal(typeof plug.sources[field], 'string', `${name}.sources.${field}`);
    }
  }
});

test('the meta plug keeps the documented Meta facts', () => {
  const plug = resolvePlug('meta', {});

  assert.equal(plug.baseUrl, 'https://api.meta.ai/v1');
  assert.equal(plug.chatUrl, 'https://api.meta.ai/v1/chat/completions');
  assert.equal(plug.keyEnvVar, 'MODEL_API_KEY');
  assert.equal(plug.defaultModel, 'muse-spark-1.3');
  assert.equal(plug.model, 'muse-spark-1.3');
  assert.equal(plug.status, 'ready');
  assert.equal(resolvePlug('meta', { MODEL_ID: 'muse-spark-2' }).model, 'muse-spark-2');
});

test('the baseten plug uses the given address and key, and no invented model', () => {
  const bare = resolvePlug('baseten', {});

  assert.equal(bare.baseUrl, 'https://inference.baseten.co/v1');
  assert.equal(bare.chatUrl, 'https://inference.baseten.co/v1/chat/completions');
  assert.equal(bare.keyEnvVar, 'BASETEN_API_KEY');
  assert.equal(bare.defaultModel, null, 'no model is assumed for the Overseer');
  assert.equal(bare.model, null);
  assert.equal(bare.status, 'needs-config');

  const chosen = resolvePlug('baseten', { BASETEN_MODEL: 'a-model-darren-picks' });
  assert.equal(chosen.model, 'a-model-darren-picks');
  assert.equal(chosen.status, 'ready');
});

test('the openrouter plug takes its address and model from the environment', () => {
  const bare = resolvePlug('openrouter', {});

  assert.equal(bare.baseUrl, null, 'no address is baked in');
  assert.equal(bare.defaultModel, null, 'no model is baked in');
  assert.equal(bare.status, 'needs-config');

  const configured = resolvePlug('openrouter', {
    OPENROUTER_BASE_URL: 'https://example.test/v1/',
    OPENROUTER_MODEL: 'a-model',
  });

  assert.equal(configured.baseUrl, 'https://example.test/v1/');
  assert.equal(configured.chatUrl, 'https://example.test/v1/chat/completions');
  assert.equal(configured.keyEnvVar, 'OPENROUTER_API_KEY');
  assert.equal(configured.model, 'a-model');
  assert.equal(configured.status, 'ready');
});

test('the routing table is the fixed one', () => {
  assert.deepEqual(ROUTES, { worker: 'meta', overseer: 'baseten', picture: 'picture' });
  assert.equal(plugForSlot('worker'), 'meta');
  assert.equal(plugForSlot('overseer'), 'baseten');
  assert.equal(plugForSlot('picture'), 'picture');
  assert.throws(() => plugForSlot('something-else'), /no route/);
});

test('the picture slot is configured but empty, waiting on the provider pick', async () => {
  const plug = resolvePlug('picture', {});

  assert.equal(plug.kind, 'image');
  assert.equal(plug.status, 'awaiting-pick');
  assert.equal(plug.baseUrl, null);
  assert.equal(plug.model, null);
  assert.equal(plug.chatUrl, null);
  assert.equal(plug.replyShape, null, 'how to read an image reply is not decided');
  assert.match(plug.blockedReason, /Darren/);

  let called = false;
  const result = await call('picture', {
    messages: [{ role: 'user', content: 'a picture' }],
    env: {},
    fetchImpl: async () => {
      called = true;
      return { ok: true, status: 200, text: async () => '{}' };
    },
  });

  assert.equal(called, false, 'an empty slot sends nothing');
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'missing-config');
  assert.equal(result.noCallMade, true);
});

test('a plug with no model chosen refuses rather than guessing', async () => {
  let called = false;
  const result = await call('baseten', {
    messages: [{ role: 'user', content: 'judge this' }],
    env: { BASETEN_API_KEY: 'a-key' },
    fetchImpl: async () => {
      called = true;
      return { ok: true, status: 200, text: async () => '{}' };
    },
  });

  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'missing-config');
  assert.match(result.error.message, /BASETEN_MODEL/);
});

test('a baseten call goes to Baseten, with the configured model and its own key', async () => {
  const env = { BASETEN_API_KEY: 'baseten-secret', BASETEN_MODEL: 'darrens-pick' };
  const seen = [];

  const result = await call(plugForSlot('overseer'), {
    messages: [{ role: 'user', content: 'judge this' }],
    env,
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ model: 'darrens-pick', choices: [{ message: { content: 'fine' } }] }),
      };
    },
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://inference.baseten.co/v1/chat/completions');
  assert.equal(seen[0].options.headers.Authorization, 'Bearer baseten-secret');
  assert.equal(JSON.parse(seen[0].options.body).model, 'darrens-pick');
  assert.equal(result.ok, true);
  assert.equal(result.text, 'fine');
});

test('an openrouter call uses the address from the environment', async () => {
  const env = {
    OPENROUTER_BASE_URL: 'https://example.test/v1',
    OPENROUTER_API_KEY: 'router-secret',
    OPENROUTER_MODEL: 'a-model',
  };
  const seen = [];

  await call('openrouter', {
    messages: [{ role: 'user', content: 'hello' }],
    env,
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'hi' } }] }) };
    },
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://example.test/v1/chat/completions');
  assert.equal(seen[0].options.headers.Authorization, 'Bearer router-secret');
});

test('with no key the seam sends nothing and says which variable is missing', async () => {
  let called = false;
  const result = await call('meta', {
    messages: [{ role: 'user', content: 'hello' }],
    env: {},
    fetchImpl: async () => {
      called = true;
      return { ok: true, status: 200, text: async () => '{}' };
    },
  });

  assert.equal(called, false);
  assert.equal(result.error.kind, 'missing-key');
  assert.equal(result.noCallMade, true);
  assert.match(result.error.message, /MODEL_API_KEY/);
});

test('the failure taxonomy is the same one the Meta path already had', async () => {
  const result = await call('meta', {
    messages: [{ role: 'user', content: 'hello' }],
    env: { MODEL_API_KEY: 'LLM_test_key' },
    fetchImpl: async () => ({
      ok: false,
      status: 402,
      text: async () =>
        JSON.stringify({ error: { message: 'no credit', type: 'billing_error', code: 'billing_not_configured' } }),
    }),
  });

  assert.equal(result.error.kind, 'billing');
  assert.equal(result.error.httpStatus, 402);
  assert.equal(result.noCallMade, undefined, 'a call was tried');
});

test('an unknown plug is a programming error, not a silent fallback', () => {
  assert.throws(() => resolvePlug('nope', {}), /unknown plug/);
  assert.throws(() => preflight('nope', {}), /unknown plug/);
});

test('health reads the plug it is asked about, and says when there is no such address', async () => {
  const seen = [];
  const meta = await health('meta', {
    env: {},
    fetchImpl: async (url) => {
      seen.push(url);
      return { ok: true, status: 200, text: async () => '{"is_alive":true}' };
    },
  });

  assert.deepEqual(seen, ['https://api.meta.ai/v1/status']);
  assert.equal(meta.ok, true);
  assert.equal(meta.status, 200);

  const baseten = await health('baseten', { env: {} });
  assert.equal(baseten.ok, false);
  assert.match(baseten.error, /no key-free health address/);
});
