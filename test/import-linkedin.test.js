import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseCsv,
  parseLinkedInExport,
  readZipEntries,
  LinkedInHeaderError,
  LinkedInZipError,
} from '../import/linkedin.js';

const FIXTURES = new URL('./fixtures/linkedin/', import.meta.url).pathname;

test('LinkedIn: CSV parser handles quoted commas, quotes and newlines', () => {
  const rows = parseCsv('A,B,C\n"one, two","say ""hi""","line1\nline2"\nplain,plain2,plain3');
  assert.deepEqual(rows[0], ['A', 'B', 'C']);
  assert.deepEqual(rows[1], ['one, two', 'say "hi"', 'line1\nline2']);
  assert.deepEqual(rows[2], ['plain', 'plain2', 'plain3']);
});

test('LinkedIn: ZIP export parses messages, invitations and connections', async () => {
  const result = await parseLinkedInExport(join(FIXTURES, '..', 'linkedin-sample-export.zip'));
  assert.equal(result.messages.length, 4);
  assert.equal(result.invitations.length, 2);
  assert.equal(result.connections.length, 2);
  assert.deepEqual(result.missing, []);

  const first = result.messages[0];
  assert.equal(first.from, 'Priya Nair');
  assert.equal(first.conversationTitle, 'Priya Nair');
  assert.equal(first.when, '2026-10-20T14:30:00.000Z');
  assert.match(first.content, /call on Thursday/);

  assert.equal(result.invitations[0].from, 'Darren Hall');
  assert.equal(result.invitations[0].to, 'Ana Sousa');
  assert.equal(result.connections[0].firstName, 'Priya');
  assert.equal(result.connections[0].company, 'Greenfield Collective');
});

test('LinkedIn: extracted folder parses the same as the ZIP', async () => {
  const fromZip = await parseLinkedInExport(join(FIXTURES, '..', 'linkedin-sample-export.zip'));
  const fromFolder = await parseLinkedInExport(FIXTURES);
  assert.equal(fromFolder.messages.length, fromZip.messages.length);
  assert.equal(fromFolder.invitations.length, fromZip.invitations.length);
  assert.equal(fromFolder.connections.length, fromZip.connections.length);
  assert.deepEqual(fromFolder.messages[0], fromZip.messages[0]);
});

test('LinkedIn: a messages.csv with the wrong header fails cleanly with a named error', async () => {
  const bad = 'ID,TITLE,FROM\n1,Chat,Alice';
  const buffer = await makeZip({ 'messages.csv': bad });
  await assert.rejects(
    () => parseLinkedInExport(buffer),
    (err) => {
      assert.ok(err instanceof LinkedInHeaderError);
      assert.equal(err.code, 'LINKEDIN_HEADER_MISMATCH');
      assert.match(err.message, /messages\.csv/);
      assert.match(err.message, /CONVERSATION ID/);
      return true;
    },
  );
});

test('LinkedIn: a missing file is reported, not an error', async () => {
  const buffer = await makeZip({
    'messages.csv': await readFile(join(FIXTURES, 'messages.csv'), 'utf8'),
  });
  const result = await parseLinkedInExport(buffer);
  assert.equal(result.messages.length, 4);
  assert.deepEqual(result.invitations, []);
  assert.deepEqual(result.connections, []);
  assert.deepEqual(result.missing, ['Invitations.csv', 'Connections.csv']);
});

test('LinkedIn: bytes that are not a ZIP fail cleanly', async () => {
  await assert.rejects(
    () => parseLinkedInExport(Buffer.from('this is not a zip')),
    (err) => err instanceof LinkedInZipError && err.code === 'LINKEDIN_ZIP_UNREADABLE',
  );
});

test('LinkedIn: a date that cannot be read becomes null, not a crash', async () => {
  const csv =
    'CONVERSATION ID,CONVERSATION TITLE,FROM,TO,DATE,SUBJECT,CONTENT,FOLDER\n' +
    'c1,Chat,Alice,Bob,not-a-date,,hello,INBOX\n';
  const buffer = await makeZip({ 'messages.csv': csv });
  const result = await parseLinkedInExport(buffer);
  assert.equal(result.messages[0].when, null);
  assert.equal(result.messages[0].dateRaw, 'not-a-date');
});

/** Build a tiny stored (uncompressed) ZIP in memory, for tests. */
async function makeZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8); // method 0: stored
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  const zip = Buffer.concat([...chunks, ...central, eocd]);
  // Sanity: our own reader must open what the test just built.
  assert.equal(readZipEntries(zip).size, Object.keys(files).length);
  return zip;
}
