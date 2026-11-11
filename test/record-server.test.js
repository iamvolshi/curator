// The record sidecar: one POST per ARCHE call, one fact per POST.
//
// What matters here is the contract the Rust entity depends on: a
// valid fact is stored and answered with its `seq`; a malformed
// entry is refused, never stored; concurrent POSTs get distinct,
// strictly increasing, gapless `seq`s; and nothing but POST
// /v1/record is served. All of it is checkable against a real HTTP
// server on loopback, with no browser involved.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startRecordServer, checkFactEntry, HOST, RECORD_PATH } from '../cli/record-server.js';
import { createStore } from '../record/store.js';

const when = '2026-11-11T16:52:00.000Z';

function factEntry(overrides = {}) {
  return {
    when,
    label: 'fact',
    what: {
      kind: 'arche-turn',
      worker: 'arche',
      endpoint: '/turn',
      request: { channel_id: 123456789, author_name: 'Darren', trigger: 'message' },
      model: 'stub',
      prompt: 'I like strong coffee',
      ok: true,
      response: 'strong coffee, noted.',
      finishReason: 'complete',
      usage: null,
      durationMs: 3,
      error: null,
      warnings: [],
      noCallMade: false,
      subjects: ['coffee'],
      kid: 'test-kid-4-EventIngestion',
      ...overrides,
    },
  };
}

async function withServer(fn, { recordsName = 'k-record.jsonl' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'curator-record-server-'));
  let server;
  try {
    const store = createStore(join(dir, recordsName));
    server = await startRecordServer({ store, port: 0 });
    return await fn({ store, server, dir });
  } finally {
    if (server) await server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

async function post(url, body, raw = false) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? body : JSON.stringify(body),
  });
}

test('the sidecar serves on loopback, and only on loopback', async () => {
  await withServer(async ({ server }) => {
    assert.equal(server.host, '127.0.0.1');
    assert.equal(server.host, HOST);
    assert.ok(server.port > 0, 'a real port was assigned');
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/v1\/record$/);
  });
});

test('a valid fact is stored and answered with its seq, entry unchanged', async () => {
  await withServer(async ({ store, server }) => {
    const entry = factEntry();
    const res = await post(server.url, entry);
    assert.equal(res.status, 200);
    const stored = await res.json();
    assert.equal(stored.seq, 1);
    assert.equal(stored.when, entry.when);
    assert.equal(stored.label, 'fact');
    assert.deepEqual(stored.what, entry.what);
    // What is on disk is what was answered: explicit nulls kept,
    // subjects kept, nothing filled in.
    const onDisk = await store.readAll();
    assert.equal(onDisk.length, 1);
    assert.deepEqual(onDisk[0], stored);
  });
});

test('seq increases by one per append, in append order', async () => {
  await withServer(async ({ server }) => {
    for (const n of [1, 2, 3]) {
      const res = await post(server.url, factEntry({ prompt: `turn ${n}` }));
      assert.equal(res.status, 200);
      assert.equal((await res.json()).seq, n);
    }
  });
});

test('concurrent POSTs get distinct, strictly increasing, gapless seqs', async () => {
  await withServer(async ({ server }) => {
    const count = 20;
    const results = await Promise.all(
      Array.from({ length: count }, (_, i) => post(server.url, factEntry({ prompt: `turn ${i}` }))),
    );
    assert.ok(results.every((res) => res.status === 200), 'every concurrent POST is accepted');
    const seqs = (await Promise.all(results.map((res) => res.json()))).map((stored) => stored.seq);
    assert.deepEqual([...seqs].sort((a, b) => a - b), Array.from({ length: count }, (_, i) => i + 1));
  });
});

test('a non-fact label is refused and nothing is stored', async () => {
  await withServer(async ({ store, server }) => {
    const res = await post(server.url, factEntry());
    assert.equal(res.status, 200);
    const judged = { ...factEntry(), label: 'judgment' };
    const bad = await post(server.url, judged);
    assert.equal(bad.status, 400);
    const body = await bad.json();
    assert.equal(body.error, 'bad_entry');
    assert.match(body.message, /fact/);
    assert.equal((await store.readAll()).length, 1);
  });
});

test('a fact without a KID is refused, empty or absent', async () => {
  await withServer(async ({ store, server }) => {
    const { kid, ...withoutKid } = factEntry().what;
    const missing = await post(server.url, { when, label: 'fact', what: withoutKid });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error, 'bad_entry');
    const empty = await post(server.url, factEntry({ kid: '' }));
    assert.equal(empty.status, 400);
    assert.equal((await store.readAll()).length, 0);
  });
});

test('each broken what field is refused with bad_entry', async () => {
  await withServer(async ({ store, server }) => {
    const cases = [
      ['kind missing', factEntry({ kind: undefined })],
      ['kind empty', factEntry({ kind: '' })],
      ['prompt missing', factEntry({ prompt: undefined })],
      ['ok not a boolean', factEntry({ ok: 'yes' })],
      ['durationMs not a number', factEntry({ durationMs: '3' })],
      ['noCallMade missing', factEntry({ noCallMade: undefined })],
      ['subjects not strings', factEntry({ subjects: ['coffee', 7] })],
    ];
    for (const [name, entry] of cases) {
      // A key set to undefined drops out of JSON, which is the
      // missing-field case; the rest travel as wrong types.
      const res = await post(server.url, entry);
      assert.equal(res.status, 400, name);
      assert.equal((await res.json()).error, 'bad_entry', name);
    }
    assert.equal((await store.readAll()).length, 0);
  });
});

test('a body that is not JSON, or not an object, is refused', async () => {
  await withServer(async ({ store, server }) => {
    const notJson = await post(server.url, '{not json', true);
    assert.equal(notJson.status, 400);
    assert.equal((await notJson.json()).error, 'bad_entry');
    const array = await post(server.url, [factEntry()], true);
    assert.equal(array.status, 400);
    assert.equal((await array.json()).error, 'bad_entry');
    const text = await post(server.url, '"just a string"', true);
    assert.equal(text.status, 400);
    assert.equal((await text.json()).error, 'bad_entry');
    assert.equal((await store.readAll()).length, 0);
  });
});

test('any other method or path is a 404', async () => {
  await withServer(async ({ server }) => {
    const base = server.url.replace(RECORD_PATH, '');
    const get = await fetch(server.url);
    assert.equal(get.status, 404);
    const wrongPath = await post(`${base}/other`, factEntry());
    assert.equal(wrongPath.status, 404);
    const root = await post(`${base}/`, factEntry());
    assert.equal(root.status, 404);
    const wrongMethod = await fetch(server.url, { method: 'PUT', body: '{}' });
    assert.equal(wrongMethod.status, 404);
  });
});

test('subjects absent stays absent on read; subjects present are carried', async () => {
  await withServer(async ({ store, server }) => {
    const { subjects, ...noSubjects } = factEntry().what;
    const res = await post(server.url, { when, label: 'fact', what: noSubjects });
    assert.equal(res.status, 200);
    const stored = await res.json();
    assert.equal('subjects' in stored.what, false);
    const [onDisk] = await store.readAll();
    assert.equal('subjects' in onDisk.what, false);
  });
});

test('a store failure is a 503 store_unavailable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'curator-record-server-'));
  let server;
  try {
    // The record path is a directory, so no line can ever be appended.
    const store = createStore(dir);
    server = await startRecordServer({ store, port: 0 });
    const res = await post(server.url, factEntry());
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'store_unavailable');
  } finally {
    if (server) await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('checkFactEntry accepts a good fact and names each refusal', () => {
  assert.equal(checkFactEntry(factEntry()), null);
  assert.match(checkFactEntry({ ...factEntry(), label: 'question' }), /fact/);
  assert.match(checkFactEntry(factEntry({ kid: '' })), /kid/);
  assert.match(checkFactEntry(factEntry({ durationMs: '3' })), /durationMs/);
});
