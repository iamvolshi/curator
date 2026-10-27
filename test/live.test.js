// The viewer that rebuilds the page while calls are made.
//
// What matters here is that the page is never a snapshot: every request renders
// from the record as it is at that moment, and the page is told a signature it
// can compare against /state to decide whether to reload. Both are checkable
// against a real HTTP server on loopback, with no browser involved.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startLiveServer } from '../cli/live.js';
import { renderPage } from '../record/html.js';
import { createStore } from '../record/store.js';

const when = '2026-10-26T23:12:32.281Z';
const URL_CHAT = 'https://api.meta.ai/v1/chat/completions';

function call(seq, prompt = 'say ready', overrides = {}) {
  return {
    seq,
    when,
    label: 'fact',
    what: {
      kind: 'worker-call',
      worker: 'meta-model-api',
      endpoint: `POST ${URL_CHAT}`,
      model: 'muse-spark-1.3',
      prompt,
      ok: true,
      response: 'ready',
      usage: { total_tokens: 10 },
      ...overrides,
    },
  };
}

async function withViewer(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'overseer-live-'));
  let viewer;
  try {
    const store = createStore(join(dir, 'records.jsonl'));
    viewer = await startLiveServer({ store, env: {}, port: 0, now: () => new Date(when) });
    return await fn({ store, viewer });
  } finally {
    if (viewer) await viewer.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('the viewer serves the page on loopback, and only on loopback', async () => {
  await withViewer(async ({ viewer }) => {
    assert.equal(viewer.host, '127.0.0.1');
    assert.ok(viewer.port > 0, 'a real port was assigned');
    assert.match(viewer.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  });
});

test('the page is rebuilt from the record on every request', async () => {
  await withViewer(async ({ store, viewer }) => {
    await store.append(call(1, 'say ready'));

    const first = await (await fetch(viewer.url)).text();
    assert.match(first, /say ready/);
    assert.equal(first.includes('a later question'), false);

    await store.append(call(2, 'a later question'));

    const second = await (await fetch(viewer.url)).text();
    assert.match(second, /a later question/, 'a new entry appears without rebuilding a file by hand');
    assert.match(second, /2 calls/, 'and the counts move with it');
  });
});

test('the page is told a signature, and /state reports a new one when the record grows', async () => {
  await withViewer(async ({ store, viewer }) => {
    const state = new URL('state', viewer.url);
    const before = await (await fetch(state)).json();
    assert.ok(before.sig, '/state reports a signature');

    const html = await (await fetch(viewer.url)).text();
    assert.ok(html.includes(JSON.stringify(before.sig)), 'the page carries the signature it was built from');

    await store.append(call(1));

    const after = await (await fetch(state)).json();
    assert.notEqual(after.sig, before.sig, 'the signature changes when the record grows');
  });
});

test('the served page watches itself, and refreshes only when the signature changes', async () => {
  await withViewer(async ({ viewer }) => {
    const html = await (await fetch(viewer.url)).text();

    assert.match(html, /data-live/, 'the live badge is on the page');
    assert.match(html, /fetch\('\/state'/, 'it asks /state for the current signature');
    assert.match(html, /location\.reload\(\)/, 'and reloads itself when it differs');
    assert.match(html, /live__text/, 'so a reader can see it is watching');
  });
});

test('the saved page is not live and carries no script at all', () => {
  const html = renderPage([call(1)]);

  assert.equal(html.includes('<script'), false, 'a page saved to disk claims nothing and runs nothing');
  assert.equal(html.includes('data-live'), false);
});

test('the viewer serves the page and its state, and nothing else', async () => {
  await withViewer(async ({ viewer }) => {
    const missing = await fetch(new URL('records', viewer.url));
    assert.equal(missing.status, 404);

    const traversal = await fetch(new URL('%2e%2e%2fpackage.json', viewer.url));
    assert.equal(traversal.status, 404, 'no path is a file path');

    const page = await fetch(viewer.url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  });
});
