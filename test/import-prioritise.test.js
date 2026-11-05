import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importLinkedIn, importWhatsApp } from '../import/import.js';
import { createStore } from '../record/store.js';
import { groupBySourceAndSubject, prioritise, renderPrioritisation } from '../import/prioritise.js';

const NOW = new Date('2026-11-04T12:00:00Z');
const WA = new URL('./fixtures/sample-whatsapp-chat.txt', import.meta.url).pathname;
const LI = new URL('./fixtures/linkedin-sample-export.zip', import.meta.url).pathname;

async function importedRecord() {
  const dir = await mkdtemp(join(tmpdir(), 'curator-import-due-'));
  const recordPath = join(dir, 'k-record.jsonl');
  await importWhatsApp({ file: WA, recordPath, chatName: 'Weekend plans', now: NOW });
  await importLinkedIn({ file: LI, recordPath, now: NOW });
  const entries = await createStore(recordPath).readAll();
  return { dir, entries };
}

test('due: scheduled, done and pending split on the classification', async () => {
  const { dir, entries } = await importedRecord();
  try {
    assert.equal(entries.length, 16);
    const view = prioritise(entries, { now: NOW });
    // Scheduled: WA coffee Saturday, WA meet Saturday, WA slides by Friday,
    // WA gallery next Friday, LI call Thursday, LI meet Thursday.
    assert.equal(view.scheduled.length, 6);
    // Done: WA "had a great time", LI two connections.
    assert.equal(view.done.length, 3);
    // Pending: the rest.
    assert.equal(view.pending.length, 7);
    // Scheduled earliest first.
    const dates = view.scheduled.map((e) => e.what.classification.date);
    assert.deepEqual(dates, [...dates].sort());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('due: entries group by source, then by chapter', async () => {
  const { dir, entries } = await importedRecord();
  try {
    const view = prioritise(entries, { now: NOW });
    const groups = groupBySourceAndSubject(view.scheduled);
    const keys = groups.map((g) => `${g.source} :: ${g.subject}`);
    assert.ok(keys.includes('whatsapp :: Weekend plans'));
    assert.ok(keys.includes('linkedin :: Priya Nair'));
    const wa = groups.find((g) => g.source === 'whatsapp');
    assert.equal(wa.entries.length, 4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('due: non-imported entries never appear in the view', async () => {
  const { dir, entries } = await importedRecord();
  try {
    const { makeEntry } = await import('../record/entry.js');
    const mixed = [
      ...entries,
      { seq: 99, ...makeEntry({ when: '2026-11-04T00:00:00.000Z', label: 'fact', what: { kind: 'worker-call', prompt: 'hello', subjects: ['Weekend plans'] } }) },
    ];
    const view = prioritise(mixed, { now: NOW });
    assert.equal(view.scheduled.length + view.done.length + view.pending.length, 16);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('due: the render names the buckets and the chapters', async () => {
  const { dir, entries } = await importedRecord();
  try {
    const text = renderPrioritisation(entries, { now: NOW });
    assert.match(text, /Scheduled — dated, today or ahead \(6\)/);
    assert.match(text, /Done \(3\)/);
    assert.match(text, /Pending — no date, or awaiting a reply \(7\)/);
    assert.match(text, /whatsapp · Weekend plans/);
    assert.match(text, /linkedin · Priya Nair/);
    assert.match(text, /Imported entries: 16 \(6 scheduled · 3 done · 7 pending\)/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
