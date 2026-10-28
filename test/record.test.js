// The record layer: an entry must carry what happened, when, and a label —
// and once written it must still say the same thing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LABELS, checkEntry, makeEntry } from '../record/entry.js';
import { createStore } from '../record/store.js';

const when = '2026-10-26T16:00:00.000Z';

function entry(overrides = {}) {
  return makeEntry({
    when,
    label: 'fact',
    what: { kind: 'worker-call', ok: true, prompt: 'hello', ...overrides.what },
    ...overrides,
  });
}

test('an entry needs what happened, when, and a valid label', () => {
  assert.equal(checkEntry(entry()), null);

  assert.match(checkEntry({ label: 'fact', what: { a: 1 } }), /when/);
  assert.match(checkEntry({ when, what: { a: 1 } }), /label/);
  assert.match(checkEntry({ when, label: 'guess', what: { a: 1 } }), /label/);
  assert.match(checkEntry({ when, label: 'fact' }), /what/);
  assert.match(checkEntry({ when, label: 'fact', what: {} }), /empty/);
});

test('makeEntry refuses a malformed entry instead of storing half of it', () => {
  assert.throws(() => makeEntry({ when, label: 'hunch', what: { a: 1 } }), /refusing to record/);
});

test('all four labels are declared, and each one can be written', async () => {
  // Four: a question is a third kind of statement, and a delivery is the MMRC
  // consolidation of one move. The set is still asserted exactly — a fifth label
  // added silently would fail here.
  assert.deepEqual(LABELS, ['fact', 'judgment', 'question', 'delivery']);

  for (const label of LABELS) {
    const written = makeEntry({ when, label, what: { kind: 'x' } });
    assert.equal(written.label, label, `a ${label} entry can be written`);
  }
});

test('an entry survives being written and read back with its label intact', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'overseer-record-'));
  try {
    const store = createStore(join(dir, 'records.jsonl'));

    const written = await store.append(entry());
    assert.equal(written.seq, 1);
    assert.equal(written.label, 'fact');

    const readBack = await store.readAll();
    assert.equal(readBack.length, 1);
    assert.equal(readBack[0].label, 'fact');
    assert.equal(readBack[0].when, when);
    assert.equal(readBack[0].what.prompt, 'hello');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the store only ever adds: what was written is still there, byte for byte', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'overseer-record-'));
  const file = join(dir, 'records.jsonl');
  try {
    const store = createStore(file);

    await store.append(entry());
    const afterFirst = await readFile(file, 'utf8');

    await store.append(entry({ what: { prompt: 'second' } }));
    const afterSecond = await readFile(file, 'utf8');

    assert.equal(afterSecond.startsWith(afterFirst), true, 'the first entry was left untouched');
    assert.equal((await store.readAll()).length, 2);
    assert.equal((await store.readAll())[1].seq, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a record file that does not exist yet reads as nothing recorded', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'overseer-record-'));
  try {
    const store = createStore(join(dir, 'nothing-here.jsonl'));
    assert.deepEqual(await store.readAll(), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a damaged record file is reported, not silently skipped', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'overseer-record-'));
  const file = join(dir, 'records.jsonl');
  try {
    await writeFile(file, `${JSON.stringify(entry())}\nnot json at all\n`, 'utf8');
    await assert.rejects(() => createStore(file).readAll(), /damaged on line 2/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
