import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importLinkedIn, importWhatsApp, hashText } from '../import/import.js';
import { createStore } from '../record/store.js';
import { liveImportRoutes } from '../import/live-stubs.js';

const NOW = new Date('2026-11-04T12:00:00Z');
const WA = new URL('./fixtures/sample-whatsapp-chat.txt', import.meta.url).pathname;
const LI = new URL('./fixtures/linkedin-sample-export.zip', import.meta.url).pathname;

async function scratchRecord() {
  const dir = await mkdtemp(join(tmpdir(), 'curator-import-test-'));
  return { dir, recordPath: join(dir, 'k-record.jsonl') };
}

test('import: WhatsApp sample imports one entry per message, with provenance', async () => {
  const { dir, recordPath } = await scratchRecord();
  try {
    const result = await importWhatsApp({ file: WA, recordPath, chatName: 'Weekend plans', now: NOW });
    assert.equal(result.parsed, 8);
    assert.equal(result.appended, 8);
    assert.equal(result.skipped, 0);
    assert.equal(result.systemLines, 1);

    const entries = await createStore(recordPath).readAll();
    assert.equal(entries.length, 8);
    assert.deepEqual(entries.map((e) => e.seq), [1, 2, 3, 4, 5, 6, 7, 8]);

    const first = entries[0];
    assert.equal(first.label, 'fact');
    assert.equal(first.what.kind, 'whatsapp-import');
    assert.equal(first.what.source, 'whatsapp');
    assert.equal(first.what.sender, 'Mara Ellison');
    assert.equal(first.what.text, 'Morning! Are you still up for coffee on Saturday?');
    assert.equal(first.what.hash, hashText(first.what.text));
    assert.deepEqual(first.what.subjects, ['Weekend plans']);
    assert.equal(first.what.classification.type, 'appointment');
    assert.equal(first.what.classification.status, 'scheduled');
    assert.equal(first.what.snapshotDate, '2026-11-04');
    // The prompt carries the original text, so shades count each message once.
    assert.equal(first.what.prompt, first.what.text);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('import: re-importing the same file appends nothing (hash dedupe)', async () => {
  const { dir, recordPath } = await scratchRecord();
  try {
    const first = await importWhatsApp({ file: WA, recordPath, chatName: 'Weekend plans', now: NOW });
    assert.equal(first.appended, 8);
    const second = await importWhatsApp({ file: WA, recordPath, chatName: 'Weekend plans', now: NOW });
    assert.equal(second.parsed, 8);
    assert.equal(second.appended, 0);
    assert.equal(second.skipped, 8);
    const entries = await createStore(recordPath).readAll();
    assert.equal(entries.length, 8);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('import: LinkedIn ZIP imports messages, invitations and connections', async () => {
  const { dir, recordPath } = await scratchRecord();
  try {
    const result = await importLinkedIn({ file: LI, recordPath, now: NOW });
    assert.equal(result.messages.parsed, 4);
    assert.equal(result.invitations.parsed, 2);
    assert.equal(result.connections.parsed, 2);
    assert.equal(result.appended, 8);
    assert.deepEqual(result.missingFiles, []);

    const entries = await createStore(recordPath).readAll();
    const kinds = entries.map((e) => e.what.kind);
    assert.ok(kinds.every((k) => k === 'linkedin-import'));
    const invitation = entries.find((e) => e.what.subjects[0] === 'LinkedIn invitations');
    assert.equal(invitation.what.classification.type, 'contact-request');
    const connection = entries.find((e) => e.what.subjects[0] === 'LinkedIn connections');
    assert.equal(connection.what.classification.status, 'done');

    // And again: nothing new.
    const again = await importLinkedIn({ file: LI, recordPath, now: NOW });
    assert.equal(again.appended, 0);
    assert.equal(again.skipped, 8);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('import: the record file stays append-only JSONL the store can read back', async () => {
  const { dir, recordPath } = await scratchRecord();
  try {
    await importWhatsApp({ file: WA, recordPath, chatName: 'Weekend plans', now: NOW });
    const raw = await readFile(recordPath, 'utf8');
    const lines = raw.trim().split('\n');
    assert.equal(lines.length, 8);
    for (const line of lines) assert.doesNotThrow(() => JSON.parse(line));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('import: live-route stubs are not live and make no network call', () => {
  for (const route of liveImportRoutes()) {
    assert.equal(route.live, false);
    assert.match(route.reason, /No live route/);
  }
});
