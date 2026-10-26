// The status command: the whole socket, and nothing invented.
//
// Two things matter here and both are checkable without a network. It has to name
// every plug — that is the point of it. And it has to probe only the addresses the
// plugs themselves declare, because a health URL made up here would be a claim
// about someone else's service rather than a fact from the config.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { statusCommand } from '../cli/status.js';
import { PLUG_NAMES, resolvePlug } from '../provider/index.js';

/** Collect what the command prints, so its text can be checked as text. */
function capture() {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.map(String).join(' '));
  return {
    lines,
    text: () => lines.join('\n'),
    restore: () => {
      console.log = original;
    },
  };
}

async function runStatus({ env = {}, fetchImpl } = {}) {
  const out = capture();
  let code;
  try {
    code = await statusCommand({ env, fetchImpl });
  } finally {
    out.restore();
  }
  return { code, text: out.text() };
}

const ANSWERING = async () => ({ ok: true, status: 200, text: async () => '{"is_alive":true}' });

test('status names every plug, not just meta', async () => {
  const seen = [];
  const { code, text } = await runStatus({
    env: { MODEL_API_KEY: 'LLM_test_key' },
    fetchImpl: async (url) => {
      seen.push(url);
      return ANSWERING();
    },
  });

  for (const name of PLUG_NAMES) {
    assert.match(text, new RegExp(`\\b${name}\\b`), `status should report the ${name} plug`);
  }

  // The routing table is part of the socket, so it is on the same page.
  assert.match(text, /worker -> meta/);
  assert.match(text, /overseer -> baseten/);
  assert.match(text, /picture -> picture/);

  assert.equal(code, 0);
});

test('status probes only the plugs that declare a key-free health address', async () => {
  const seen = [];
  await runStatus({
    env: { MODEL_API_KEY: 'LLM_test_key' },
    fetchImpl: async (url) => {
      seen.push(url);
      return ANSWERING();
    },
  });

  const declared = PLUG_NAMES.filter((name) => resolvePlug(name, {}).statusUrl).map(
    (name) => resolvePlug(name, {}).statusUrl,
  );

  assert.deepEqual(seen, declared);
  assert.deepEqual(seen, ['https://api.meta.ai/v1/status'], 'meta is the only one with a health address');
});

test('status says a plug with no health address was not checked, rather than inventing one', async () => {
  const { text } = await runStatus({
    env: { MODEL_API_KEY: 'LLM_test_key' },
    fetchImpl: ANSWERING,
  });

  const unprobeable = PLUG_NAMES.filter((name) => !resolvePlug(name, {}).statusUrl);
  assert.deepEqual(unprobeable, ['openrouter', 'baseten', 'picture']);
  assert.match(text, /no key-free health address/);
});

test('status reports every plug wired or not, and which can be called now', async () => {
  const { text } = await runStatus({
    env: { MODEL_API_KEY: 'LLM_test_key' },
    fetchImpl: ANSWERING,
  });

  // The values come from the plug configs, so a slot waiting on a decision reads
  // as waiting on a decision, not as an error.
  assert.match(text, /awaiting-pick/);
  assert.match(text, /needs-config/);
  assert.match(text, /muse-spark-1\.3/);
  assert.match(text, /1 can be called now \(meta\)/);
});

test('status fails, and says where to look, when the host does not answer', async () => {
  const { code, text } = await runStatus({
    env: { MODEL_API_KEY: 'LLM_test_key' },
    fetchImpl: async () => {
      throw new Error('getaddrinfo ENOTFOUND api.meta.ai');
    },
  });

  assert.equal(code, 1, 'an address that does not answer is a failure, not a success');
  assert.match(text, /did not answer/);
  assert.match(text, /getaddrinfo ENOTFOUND/);
  assert.match(text, /not at the key/);
});

test('status never prints the key', async () => {
  const secret = 'LLM_999999999999999_neverPrintThis';
  const { text } = await runStatus({
    env: { MODEL_API_KEY: secret },
    fetchImpl: ANSWERING,
  });

  assert.ok(!text.includes(secret), 'the key value must not appear in the output');
  assert.ok(!text.includes('neverPrintThis'), 'not even part of it');
  assert.match(text, /key:\s+set/);
});
