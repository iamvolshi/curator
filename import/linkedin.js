// LinkedIn data-export parser.
//
// A LinkedIn "Download your data" archive is a ZIP of CSVs. This file reads
// the ZIP (stored or deflated entries, no dependency) or an already-extracted
// folder, and parses the three files Curator cares about:
//
//   messages.csv    one row per message
//   Invitations.csv one row per sent/received invitation
//   Connections.csv one row per connection
//
// The header is NOT an official spec. LinkedIn publishes no schema for these
// files; the column names below come from community parsers of real exports
// and are validated, not assumed: a file whose header does not match fails
// cleanly with a named error instead of silently misreading a column.
//
//   messages.csv header:
//     CONVERSATION ID, CONVERSATION TITLE, FROM, TO, DATE, SUBJECT, CONTENT, FOLDER
//   Invitations.csv header (observed):
//     FROM, TO, SENT AT, MESSAGE
//   Connections.csv header (observed):
//     First Name, Last Name, URL, Email Address, Company, Position, Connected On
//
// A file that is absent is not an error — an export may simply not contain
// it — but a file that is present with the wrong header is: misreading a
// column would file someone else's words under the wrong name.

import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MESSAGES_HEADERS = [
  'CONVERSATION ID',
  'CONVERSATION TITLE',
  'FROM',
  'TO',
  'DATE',
  'SUBJECT',
  'CONTENT',
  'FOLDER',
];
export const INVITATIONS_HEADERS = ['FROM', 'TO', 'SENT AT', 'MESSAGE'];
export const CONNECTIONS_HEADERS = [
  'First Name',
  'Last Name',
  'URL',
  'Email Address',
  'Company',
  'Position',
  'Connected On',
];

/** A header that does not match what this parser knows how to read. */
export class LinkedInHeaderError extends Error {
  constructor(file, expected, found) {
    super(
      `${file} has a header this parser does not recognise (LinkedIn publishes no ` +
        `schema for its exports, so the header is validated, not assumed). ` +
        `Expected: ${expected.join(' | ')}. Found: ${found.join(' | ') || '(empty)'}. ` +
        `If LinkedIn changed the export, the header list in import/linkedin.js needs updating first.`,
    );
    this.name = 'LinkedInHeaderError';
    this.code = 'LINKEDIN_HEADER_MISMATCH';
    this.file = file;
  }
}

/** A ZIP this reader cannot open: not a ZIP, or a flavour it does not support. */
export class LinkedInZipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LinkedInZipError';
    this.code = 'LINKEDIN_ZIP_UNREADABLE';
  }
}

// --- Minimal ZIP reader: central directory + stored/deflated entries. --------

function findEndOfCentralDirectory(buffer) {
  // The EOCD record is 22 bytes and sits at the end, with an optional comment.
  const min = Math.max(0, buffer.length - 22 - 65535);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

/** Read every file out of a ZIP buffer. Returns Map<name, Buffer>. */
export function readZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    throw new LinkedInZipError('not a ZIP file: too short to hold a central directory');
  }
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd === -1) throw new LinkedInZipError('not a ZIP file: no end-of-central-directory record found');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  const entries = new Map();
  for (let n = 0; n < count; n += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new LinkedInZipError(`ZIP central directory is damaged at entry ${n + 1}`);
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new LinkedInZipError(`ZIP local header for ${name} is damaged`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = inflateRawSync(compressed);
    else throw new LinkedInZipError(`ZIP entry ${name} uses compression method ${method}, which this reader does not support`);

    entries.set(name, data);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

// --- CSV: quoted fields, embedded commas and newlines, doubled quotes. --------

/** Parse CSV text into rows of strings. The first row is the header. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const src = String(text ?? '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

function checkHeader(file, rows, expected) {
  const found = (rows[0] ?? []).map((h) => h.trim());
  const missing = expected.filter((h) => !found.includes(h));
  if (missing.length > 0) throw new LinkedInHeaderError(file, expected, found);
  return found;
}

function rowsToObjects(rows, file, expected) {
  const header = checkHeader(file, rows, expected);
  return rows.slice(1).map((row) => {
    const obj = {};
    header.forEach((name, i) => {
      obj[name] = row[i] ?? '';
    });
    return obj;
  });
}

// --- Dates: LinkedIn writes e.g. "2024-05-01 12:34:56 UTC". ------------------

/** A LinkedIn DATE / SENT AT / Connected On value, as ISO, or null if unreadable. */
export function parseLinkedInDate(value) {
  const raw = String(value ?? '').trim();
  if (raw === '') return null;
  // "2024-05-01 12:34:56 UTC" -> ISO; Date.parse reads the space form too,
  // but the explicit rewrite keeps the result independent of the host.
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*(UTC|Z)?$/i.exec(raw);
  if (match) {
    const [, y, mo, d, h, mi, s] = match;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0))).toISOString();
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

// --- The three files. ---------------------------------------------------------

function parseMessagesCsv(text) {
  const rows = parseCsv(text);
  return rowsToObjects(rows, 'messages.csv', MESSAGES_HEADERS).map((r) => ({
    conversationId: r['CONVERSATION ID'],
    conversationTitle: r['CONVERSATION TITLE'],
    from: r.FROM,
    to: r.TO,
    when: parseLinkedInDate(r.DATE),
    dateRaw: r.DATE,
    subject: r.SUBJECT,
    content: r.CONTENT,
    folder: r.FOLDER,
  }));
}

function parseInvitationsCsv(text) {
  const rows = parseCsv(text);
  return rowsToObjects(rows, 'Invitations.csv', INVITATIONS_HEADERS).map((r) => ({
    from: r.FROM,
    to: r.TO,
    when: parseLinkedInDate(r['SENT AT']),
    dateRaw: r['SENT AT'],
    message: r.MESSAGE,
  }));
}

function parseConnectionsCsv(text) {
  const rows = parseCsv(text);
  return rowsToObjects(rows, 'Connections.csv', CONNECTIONS_HEADERS).map((r) => ({
    firstName: r['First Name'],
    lastName: r['Last Name'],
    url: r.URL,
    email: r['Email Address'],
    company: r.Company,
    position: r.Position,
    when: parseLinkedInDate(r['Connected On']),
    dateRaw: r['Connected On'],
  }));
}

/** Find a file in a ZIP map or a folder listing, case-insensitively. */
function findFile(names, wanted) {
  const lower = wanted.toLowerCase();
  return names.find((n) => n.split('/').pop().toLowerCase() === lower) ?? null;
}

/**
 * Parse a LinkedIn data export: a ZIP path/buffer, or an extracted folder path.
 *
 * @param {string|Buffer} input path to the .zip, path to an extracted folder, or ZIP bytes
 * @returns {Promise<{ messages, invitations, connections, files: string[],
 *   missing: string[] }>}
 *   `files` names what was found; `missing` names what was looked for and
 *   absent (an absent file is not an error, a wrong header is).
 */
export async function parseLinkedInExport(input) {
  let files = new Map();

  if (Buffer.isBuffer(input)) {
    files = readZipEntries(input);
  } else if (typeof input === 'string' && input.toLowerCase().endsWith('.zip')) {
    const bytes = await readFile(input);
    files = readZipEntries(bytes);
  } else if (typeof input === 'string') {
    const names = await readdir(input, { recursive: true });
    for (const name of names) {
      if (typeof name !== 'string') continue;
      files.set(name, await readFile(join(input, name)));
    }
  } else {
    throw new LinkedInZipError('parseLinkedInExport needs a .zip path, an extracted folder path, or ZIP bytes');
  }

  const names = [...files.keys()];
  const pick = (wanted) => {
    const found = findFile(names, wanted);
    return found ? files.get(found).toString('utf8') : null;
  };

  const messagesText = pick('messages.csv');
  const invitationsText = pick('Invitations.csv');
  const connectionsText = pick('Connections.csv');
  const missing = [];
  if (!messagesText) missing.push('messages.csv');
  if (!invitationsText) missing.push('Invitations.csv');
  if (!connectionsText) missing.push('Connections.csv');

  return {
    messages: messagesText ? parseMessagesCsv(messagesText) : [],
    invitations: invitationsText ? parseInvitationsCsv(invitationsText) : [],
    connections: connectionsText ? parseConnectionsCsv(connectionsText) : [],
    files: names,
    missing,
  };
}

/** SHA-256 of a string, hex. The content hash an import dedupes on. */
export function hashText(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}
