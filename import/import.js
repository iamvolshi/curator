// The import path: export file in, K-record fact entries out.
//
// One imported message becomes one fact entry, written through the store —
// never by hand-editing the file — so the record's append-only rule and its
// `seq` counting hold for imports exactly as they hold for model calls.
// Imported content never goes through wrapper/wrap.js: that wrapper records
// model calls, and an import is not a model call.
//
// Provenance lives inside `what`, because the entry format has no
// provenance fields of its own:
//   kind         'whatsapp-import' | 'linkedin-import'
//   source       'whatsapp' | 'linkedin'
//   sender / from, text (the original, unedited), hash (SHA-256 of the text)
//   endpoint     the chat / conversation the message came from — together
//                with `prompt` (the original text) this is the move key, so
//                each imported message darkens its subject's shade once
//   prompt       the original text (the shade rule dedupes by move key, and
//                two different messages must never collapse into one move)
//   subjects     DECLARED by the importer: the chat / conversation title, so
//                the message lands in that chapter. Nothing is guessed from
//                the prose.
//   classification { type, status, date, reason } — see import/classify.js
//   snapshotDate the date the export was imported (the export itself carries
//                no reliable export date; the honest stamp is "imported on")
//
// Idempotence: re-importing the same file appends nothing. The content hash
// of every message already in the record is collected first, and a message
// whose hash is already there — or appears twice in one file — is skipped
// and counted, not written again. The record never rewrites history, so
// "import again" means "skip what is already there", not "delete and redo".

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { makeEntry } from '../record/entry.js';
import { createStore } from '../record/store.js';
import { classifyMessage } from './classify.js';
import { parseLinkedInExport } from './linkedin.js';
import { parseWhatsAppExport } from './whatsapp.js';

export function hashText(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

/** Today's date, YYYY-MM-DD, in local time: the snapshot stamp. */
export function todayDate(now = new Date()) {
  return new Date(now).toISOString().slice(0, 10);
}

/** Every content hash the record already holds, from imported entries. */
export function existingHashes(entries) {
  const seen = new Set();
  for (const entry of entries ?? []) {
    const hash = entry?.what?.hash;
    if (typeof hash === 'string' && hash !== '') seen.add(hash);
  }
  return seen;
}

function buildEntry({ when, kind, source, endpoint, sender, text, subjects, classification, snapshotDate }) {
  return makeEntry({
    when,
    label: 'fact',
    what: {
      kind,
      source,
      endpoint,
      sender,
      text,
      prompt: text,
      hash: hashText(text),
      subjects,
      classification,
      snapshotDate,
    },
  });
}

/**
 * Append parsed messages to the store, skipping duplicates by content hash.
 * Shared by both importers so the dedupe rule has exactly one home.
 */
export async function appendMessages(store, messages, { kind, source, endpointFor, subjectsFor, now = new Date() }) {
  const already = existingHashes(await store.readAll());
  const snapshotDate = todayDate(now);
  let appended = 0;
  let skipped = 0;
  let pending = 0;

  for (const message of messages) {
    const text = message.text ?? message.content ?? '';
    const hash = hashText(text);
    if (already.has(hash)) {
      skipped += 1;
      continue;
    }
    already.add(hash);
    const classification = classifyMessage(message, { now });
    if (classification.status === 'pending') pending += 1;
    const when = message.when ?? new Date(now).toISOString();
    await store.append(
      buildEntry({
        when,
        kind,
        source,
        endpoint: endpointFor(message),
        sender: message.sender ?? message.from ?? 'unknown',
        text,
        subjects: subjectsFor(message),
        classification,
        snapshotDate,
      }),
    );
    appended += 1;
  }

  return { parsed: messages.length, appended, skipped, pending };
}

// --- WhatsApp ----------------------------------------------------------------

/**
 * Import one WhatsApp chat export (.txt) into the record.
 *
 * @param {{ file: string, recordPath?: string, chatName?: string,
 *   dateOrder?: 'dmy'|'mdy', subjects?: string[], now?: Date }} options
 *   `subjects`, when given, replaces the chat-name chapter; otherwise the
 *   chat name (or the file's chat, or 'WhatsApp chat') is the chapter.
 */
export async function importWhatsApp({ file, recordPath, chatName, dateOrder = 'dmy', subjects, now = new Date() }) {
  const text = await readFile(file, 'utf8');
  const parsed = parseWhatsAppExport(text, { chatName, dateOrder });
  const store = createStore(recordPath);
  const chapter = subjects ?? [parsed.chatName ?? 'WhatsApp chat'];

  const counts = await appendMessages(store, parsed.messages, {
    kind: 'whatsapp-import',
    source: 'whatsapp',
    endpointFor: () => `whatsapp:${chapter[0]}`,
    subjectsFor: () => chapter,
    now,
  });

  return {
    source: 'whatsapp',
    file,
    chatName: parsed.chatName,
    systemLines: parsed.systemLines.length,
    skippedLines: parsed.skippedLines,
    capped: parsed.capped,
    recordPath: store.path,
    ...counts,
  };
}

// --- LinkedIn ----------------------------------------------------------------

/**
 * Import a LinkedIn data export (ZIP path/buffer, or extracted folder) into
 * the record. Messages become entries; invitations become entries too
 * (type contact-request); connections become entries of their own kind, so
 * the record holds who the person is connected to, not just what they said.
 */
export async function importLinkedIn({ file, recordPath, now = new Date() }) {
  const parsed = await parseLinkedInExport(file);
  const store = createStore(recordPath);

  const messageCounts = await appendMessages(store, parsed.messages, {
    kind: 'linkedin-import',
    source: 'linkedin',
    endpointFor: (m) => `linkedin:${m.conversationId || m.conversationTitle || 'conversation'}`,
    subjectsFor: (m) => [m.conversationTitle || 'LinkedIn conversation'],
    now,
  });

  // Invitations carry no free text of their own beyond the note; the note is
  // the text, and the envelope says what kind of row it is.
  const invitationCounts = await appendMessages(
    store,
    parsed.invitations.map((inv) => ({
      when: inv.when,
      from: inv.from,
      text: inv.message || `(connection invitation from ${inv.from} to ${inv.to})`,
      context: 'invitation',
    })),
    {
      kind: 'linkedin-import',
      source: 'linkedin',
      endpointFor: (m) => `linkedin:invitation:${m.from}`,
      subjectsFor: () => ['LinkedIn invitations'],
      now,
    },
  );

  // Connections are facts about the network, not messages: one entry each,
  // text is a plain sentence, classification is 'other' / 'done' by rule.
  const connectionCounts = await appendMessages(
    store,
    parsed.connections.map((c) => ({
      when: c.when ?? new Date(now).toISOString(),
      from: `${c.firstName} ${c.lastName}`.trim(),
      text: `Connected on LinkedIn with ${c.firstName} ${c.lastName}`.trim() +
        (c.company ? ` (${c.position ? `${c.position}, ` : ''}${c.company})` : '') +
        (c.url ? ` ${c.url}` : ''),
      context: 'connection',
    })),
    {
      kind: 'linkedin-import',
      source: 'linkedin',
      endpointFor: (m) => `linkedin:connection:${m.from}`,
      subjectsFor: () => ['LinkedIn connections'],
      now,
    },
  );

  return {
    source: 'linkedin',
    file: typeof file === 'string' ? file : '(zip bytes)',
    filesFound: parsed.files,
    missingFiles: parsed.missing,
    recordPath: store.path,
    messages: messageCounts,
    invitations: invitationCounts,
    connections: connectionCounts,
    parsed: messageCounts.parsed + invitationCounts.parsed + connectionCounts.parsed,
    appended: messageCounts.appended + invitationCounts.appended + connectionCounts.appended,
    skipped: messageCounts.skipped + invitationCounts.skipped + connectionCounts.skipped,
    pending: messageCounts.pending + invitationCounts.pending + connectionCounts.pending,
  };
}
