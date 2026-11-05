// Import command: an export file in, K-record fact entries out.
//
//   node bin/overseer.js import --whatsapp chat.txt [--record PATH] [--chat NAME] [--date-order dmy|mdy] [--subject NAME]
//   node bin/overseer.js import --linkedin export.zip [--record PATH]
//   node bin/overseer.js import --linkedin ./export-folder [--record PATH]
//
// With no --record the default record is used (records/k-record.jsonl); a
// demo or a test passes its own scratch path so the real record is never
// touched by an import that was only tried out. Re-importing the same file
// appends nothing: entries are deduped by content hash, and the report says
// how many were skipped as duplicates.

import { importLinkedIn, importWhatsApp } from '../import/import.js';
import { readAll, readOption } from './args.js';
import { heading, line, note } from './output.js';

function reportCounts(result, label) {
  line(`${label} parsed:`, String(result.parsed));
  line(`${label} appended:`, String(result.appended));
  line(`${label} skipped (duplicate):`, String(result.skipped));
  line(`${label} pending:`, String(result.pending));
}

export async function importCommand({ args = [] } = {}) {
  const whatsappFile = readOption(args, '--whatsapp');
  const linkedInFile = readOption(args, '--linkedin');
  const recordPath = readOption(args, '--record');
  const chatName = readOption(args, '--chat');
  const dateOrder = readOption(args, '--date-order') ?? 'dmy';
  const subjects = readAll(args, '--subject');

  if (!whatsappFile && !linkedInFile) {
    note('import: give a file: --whatsapp <chat.txt> or --linkedin <export.zip|folder>.');
    note('Run "node bin/overseer.js help" for the full usage.');
    return 2;
  }
  if (whatsappFile && linkedInFile) {
    note('import: one file at a time — pass --whatsapp or --linkedin, not both.');
    return 2;
  }
  if (dateOrder !== 'dmy' && dateOrder !== 'mdy') {
    note('import: --date-order is "dmy" (Android, day first) or "mdy" (iOS, month first).');
    return 2;
  }

  try {
    if (whatsappFile) {
      const result = await importWhatsApp({
        file: whatsappFile,
        recordPath,
        chatName,
        dateOrder,
        subjects: subjects.length > 0 ? subjects : undefined,
      });
      heading(`Imported WhatsApp chat — ${result.chatName ?? result.file}`);
      line('file:', result.file);
      line('record:', result.recordPath);
      line('system lines:', String(result.systemLines));
      line('skipped lines:', String(result.skippedLines));
      if (result.capped) {
        note('Warning: the export holds 40,000 messages — WhatsApp caps exports there, so the chat may continue past this file.');
      }
      reportCounts(result, 'messages');
      return 0;
    }

    const result = await importLinkedIn({ file: linkedInFile, recordPath });
    heading('Imported LinkedIn data archive');
    line('file:', String(result.file));
    line('record:', result.recordPath);
    if (result.missingFiles.length > 0) {
      note(`Files not in the archive (not an error — an export may not contain them): ${result.missingFiles.join(', ')}.`);
    }
    reportCounts(result.messages, 'messages');
    reportCounts(result.invitations, 'invitations');
    reportCounts(result.connections, 'connections');
    line('total parsed:', String(result.parsed));
    line('total appended:', String(result.appended));
    line('total skipped (duplicate):', String(result.skipped));
    line('total pending:', String(result.pending));
    return 0;
  } catch (err) {
    if (err?.code === 'LINKEDIN_HEADER_MISMATCH') {
      console.error(`import: ${err.message}`);
      return 2;
    }
    if (err?.code === 'ENOENT') {
      console.error(`import: no such file: ${err.path ?? ''}`);
      return 2;
    }
    throw err;
  }
}
