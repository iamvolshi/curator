// The record as one page.
//
// Two properties matter and both are checkable without a browser. Everything on
// the page has to come from the entries handed in — the counts counted, not
// typed. And model output is text, not markup, so it has to be escaped: a reply
// that contains a tag must not become a tag on a page shown to someone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pageCommand } from '../cli/page.js';
import { renderPage } from '../record/html.js';
import { createStore } from '../record/store.js';

const when = '2026-10-26T23:12:32.281Z';
const URL = 'https://api.meta.ai/v1/chat/completions';

function call(seq, overrides = {}) {
  return {
    seq,
    when,
    label: 'fact',
    what: {
      kind: 'worker-call',
      worker: 'meta-model-api',
      endpoint: `POST ${URL}`,
      request: { method: 'POST', url: URL, body: { model: 'muse-spark-1.3', messages: [] } },
      model: 'muse-spark-1.3',
      prompt: 'say ready',
      ok: true,
      response: 'ready',
      usage: { total_tokens: 186 },
      durationMs: 1443,
      ...overrides,
    },
  };
}

test('the page shows every entry with its number and its label', () => {
  const html = renderPage([
    call(1),
    call(2, { prompt: 'a second question', response: 'a second answer', usage: { total_tokens: 647 } }),
    { seq: 3, when, label: 'judgment', what: { kind: 'judgment', about: 1, note: 'on task' } },
  ]);

  assert.match(html, /say ready/);
  assert.match(html, /a second question/);
  assert.match(html, /a second answer/);
  assert.match(html, /chip--fact/);
  assert.match(html, /chip--judgment/);
  assert.match(html, /on task/, 'an entry shape the renderer does not know still shows what it holds');
  assert.match(html, /3 calls/);
  assert.match(html, /2 facts/);
  assert.match(html, /1 judgment/);
});

test('model output is escaped, never trusted as markup', () => {
  const html = renderPage([
    call(1, {
      prompt: '<script>alert(1)</script>',
      response: '<img src=x onerror="alert(2)">',
    }),
  ]);

  assert.equal(html.includes('<script>alert(1)'), false, 'a reply must not become script');
  assert.equal(html.includes('<img src=x'), false, 'a reply must not become an image tag');
  assert.match(html, /&lt;script&gt;/, 'it is shown, but as text');
});

test('the numbers on the page are counted from the entries', () => {
  const html = renderPage([
    call(1),
    call(2, { usage: { total_tokens: 647 } }),
    call(3, {
      ok: false,
      response: null,
      usage: null,
      noCallMade: true,
      request: null,
      error: { kind: 'missing-key', message: 'no key', fix: 'put the key somewhere' },
    }),
  ]);

  assert.match(html, /3 calls/);
  assert.match(html, /2 calls worked/);
  assert.match(html, /1 call never sent/);
  assert.match(html, /833 tokens in total/, '186 + 647, counted, not guessed');
  assert.match(html, /2 entries kept the request body/);
  assert.match(html, /No judgments yet/, 'the page must not imply a judge exists');
});

test('an empty record produces a page that says so', () => {
  const html = renderPage([], { source: 'records/k-record.jsonl', generatedAt: when });

  assert.match(html, /Nothing has been recorded yet/);
  assert.match(html, /0 calls/);
  assert.equal(html.includes('class="entry'), false, 'no entry markup is invented');
  assert.match(html, /records\/k-record\.jsonl/);
});

test('the command writes the page from the file, and the page names the file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'overseer-page-'));
  try {
    const store = createStore(join(dir, 'records.jsonl'));
    const out = join(dir, 'page.html');

    await store.append(call(1));
    const code = await pageCommand({ store, args: ['--out', out], now: () => new Date(when) });

    assert.equal(code, 0);

    const html = await readFile(out, 'utf8');
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /say ready/, 'the entry written to the store is on the page');
    assert.match(html, /1 call\b/);
    assert.equal(html.includes('k-record.jsonl'), false, 'it names the file it actually read');

    const written = await store.readAll();
    assert.equal(written.length, 1, 'reading the record did not add to it');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
