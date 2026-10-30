// The picture kid: one image call, and one saved picture.
//
// The live call is not made here — there is no key in this process, and a
// test must not spend a real image call. Every live-shaped check below runs
// against a fake fetch that returns the shape Muse Image returns, so the
// reader and the saver are checked, not the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { callImage, readImageReply, resolvePlug } from '../provider/index.js';
import { pictureCommand } from '../cli/picture.js';

const ENV = { MODEL_API_KEY: 'LLM_test_key' };

function reply(body, status = 200) {
  return async () => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
}

// The bytes of a minimal PNG header, base64 — enough for the saver to read
// the format from the bytes themselves rather than from a filename.
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).toString('base64');

test('the picture plug defaults to Muse Image on the Meta Model API', () => {
  const plug = resolvePlug('picture', {});
  assert.equal(plug.model, 'muse-image-1.0');
  assert.equal(plug.baseUrl, 'https://api.meta.ai/v1');
  assert.equal(plug.imageUrl, 'https://api.meta.ai/v1/images/generations');
  assert.equal(plug.keyEnvVar, 'MODEL_API_KEY');
});

test('readImageReply takes base64 bytes, then a URL, and refuses neither', () => {
  assert.deepEqual(readImageReply({ data: [{ b64_json: 'abc', revised_prompt: '  ' }] }), {
    image: { source: 'base64', data: 'abc', revisedPrompt: null },
  });
  assert.deepEqual(readImageReply({ data: [{ url: 'https://example.com/p.png' }] }), {
    image: { source: 'url', data: 'https://example.com/p.png', revisedPrompt: null },
  });
  assert.equal(readImageReply({ data: [] }).problem, 'the image reply had no data entry');
  assert.equal(readImageReply({ data: [{}] }).problem, 'the image reply had no image bytes and no image URL');
  assert.equal(readImageReply({}).problem, 'the image reply had no data entry');
});

test('callImage sends only model + prompt, and returns the image', async () => {
  let seen;
  const result = await callImage('picture', {
    prompt: 'a red circle',
    env: ENV,
    fetchImpl: async (url, options) => {
      seen = { url, body: JSON.parse(options.body), auth: options.headers.Authorization };
      return reply({ data: [{ b64_json: PNG_B64 }] })();
    },
  });

  assert.equal(result.ok, true);
  assert.equal(seen.url, 'https://api.meta.ai/v1/images/generations');
  assert.deepEqual(seen.body, { model: 'muse-image-1.0', prompt: 'a red circle' });
  assert.equal(seen.auth, 'Bearer LLM_test_key');
  assert.equal(result.image.source, 'base64');
  assert.equal(result.image.data, PNG_B64);
});

test('callImage sends nothing without a prompt, and nothing without a key', async () => {
  let called = false;
  const noPrompt = await callImage('picture', {
    prompt: '   ',
    env: ENV,
    fetchImpl: async () => {
      called = true;
      return reply({})() ;
    },
  });
  assert.equal(called, false);
  assert.equal(noPrompt.ok, false);
  assert.equal(noPrompt.noCallMade, true);

  const noKey = await callImage('picture', {
    prompt: 'a red circle',
    env: {},
    fetchImpl: async () => {
      called = true;
      return reply({})() ;
    },
  });
  assert.equal(called, false);
  assert.equal(noKey.ok, false);
  assert.equal(noKey.error.kind, 'missing-key');
  assert.equal(noKey.noCallMade, true);
});

test('callImage fails honestly when the reply has no image', async () => {
  const result = await callImage('picture', {
    prompt: 'a red circle',
    env: ENV,
    fetchImpl: reply({ data: [{}] }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'bad-response');
  assert.match(result.error.message, /no image/);
});

test('the picture command saves base64 bytes with the format from the bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'overseer-picture-'));
  const out = join(dir, 'folder-pic');
  try {
    const code = await pictureCommand({
      args: ['--prompt', 'a red circle', '--out', out],
      env: ENV,
      fetchImpl: reply({ data: [{ b64_json: PNG_B64 }] }),
    });
    assert.equal(code, 0);
    // The saver does not trust the caller's filename: the PNG header wins.
    const saved = await readFile(`${out}.png`);
    assert.equal(saved[0], 0x89);
    assert.equal(saved[1], 0x50);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the picture command refuses a missing prompt and a missing key, sending nothing', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return reply({})() ;
  };
  assert.equal(await pictureCommand({ args: [], env: ENV, fetchImpl }), 2);
  assert.equal(await pictureCommand({ args: ['--prompt', 'a red circle'], env: {}, fetchImpl }), 3);
  assert.equal(called, false);
});

test('the picture command dry run sends nothing', async () => {
  let called = false;
  const code = await pictureCommand({
    args: ['--prompt', 'a red circle', '--dry-run'],
    env: ENV,
    fetchImpl: async () => {
      called = true;
      return reply({})() ;
    },
  });
  assert.equal(code, 0);
  assert.equal(called, false);
});
