// WhatsApp chat export parser.
//
// A WhatsApp chat export is a plain .txt file: one line starts a message,
// the lines after it that start no new message belong to it. That is the
// whole format, and this file parses exactly that — no model, no guessing.
//
// Two shapes exist, and they disagree about the date:
//   Android: [12/3/26, 14:05] Mara: text          day first, 24-hour clock
//   iOS:     [3/12/2026, 2:05:33 PM] Mara: text   month first, 12-hour clock
// A date like 3/12/26 is ambiguous on its own — 3 December or 12 March — so
// the caller says which order the export uses (`dateOrder: 'dmy' | 'mdy'`,
// default 'dmy', the Android shape). When one half of the date is over 12 the
// order answers itself and the option is ignored for that line.
//
// The 40,000-message cap: WhatsApp itself caps an export at about 40,000
// messages (fewer with media attached). A file that stops at the cap looks
// exactly like a chat that ended there, so this parser never truncates and
// never pretends to know: it parses every line it is given, counts what it
// found, and flags `capped: true` when the count reaches the cap, so the
// caller can say "this may be cut off" instead of silently losing the rest.

export const WHATSAPP_EXPORT_CAP = 40000;

/** Lines WhatsApp writes that are not anyone speaking. */
const SYSTEM_PATTERNS = [
  /messages (and calls )?are end-to-end encrypted/i,
  /created this group/i,
  /changed (the )?subject/i,
  /added you$/i,
  /you were added/i,
  /left$/i,
  /removed/i,
  /changed this group's icon/i,
  /changed their phone number/i,
  /your security code with .* changed/i,
  /messages you send to this chat/i,
  /disappearing messages (were|are|have been)/i,
  /missed (voice|video) call/i,
];

const MEDIA_OMITTED = /^(<[^>]*\b(media|image|video|audio|document|sticker|gif)\b[^>]*>|image omitted|video omitted|audio omitted|document omitted|sticker omitted)$/i;

/**
 * A line that starts a message: [date, time] Sender: text
 * The sender part is everything up to the first ": ". A line with no ": "
 * after the bracket is a system line, not a message.
 */
const HEADER =
  /^\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}), (\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?\]\s+(.*)$/;

function parseHeader(line, dateOrder) {
  const match = HEADER.exec(line);
  if (!match) return null;

  const [, first, second, yearRaw, hourRaw, minuteRaw, secondRaw, ampm, rest] = match;
  const a = Number(first);
  const b = Number(second);
  // Whichever half is over 12 cannot be a month: the order answers itself.
  const order = a > 12 ? 'dmy' : b > 12 ? 'mdy' : dateOrder;
  const day = order === 'dmy' ? a : b;
  const month = order === 'dmy' ? b : a;
  let year = Number(yearRaw);
  if (year < 100) year += 2000;

  let hour = Number(hourRaw);
  if (ampm) {
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
  }
  const minute = Number(minuteRaw);
  const sec = Number(secondRaw ?? 0);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || sec > 59) {
    return null;
  }

  // The export carries no timezone, so the time is read as local time and
  // stored as ISO: the record wants one clock, and UTC is the one it has.
  const when = new Date(year, month - 1, day, hour, minute, sec).toISOString();
  return { when, rest };
}

function isSystemLine(rest) {
  if (!rest.includes(': ')) return true;
  return SYSTEM_PATTERNS.some((pattern) => pattern.test(rest));
}

/**
 * Parse a WhatsApp chat export.
 *
 * @param {string} text the whole .txt export
 * @param {{ chatName?: string, dateOrder?: 'dmy'|'mdy' }} options
 * @returns {{ chatName: string|null, messages: Array<{when,sender,text,mediaOmitted}>,
 *   systemLines: string[], skippedLines: number, capped: boolean }}
 *   messages are in export order (oldest first); a message's text keeps its
 *   line breaks; `mediaOmitted` marks a placeholder where media was not
 *   exported, so a reader never mistakes an empty message for a silent one.
 */
export function parseWhatsAppExport(text, { chatName = null, dateOrder = 'dmy' } = {}) {
  const messages = [];
  const systemLines = [];
  let skippedLines = 0;
  let current = null;

  const flush = () => {
    if (current) messages.push(current);
    current = null;
  };

  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine;
    if (line.trim() === '') continue;
    const header = parseHeader(line, dateOrder);

    if (header) {
      flush();
      const { rest } = header;
      if (isSystemLine(rest)) {
        systemLines.push(rest);
        continue;
      }
      const colon = rest.indexOf(': ');
      const sender = rest.slice(0, colon).trim();
      const body = rest.slice(colon + 2);
      current = { when: header.when, sender, text: body, mediaOmitted: MEDIA_OMITTED.test(body.trim()) };
      continue;
    }

    if (current) {
      // A continuation line: part of the message above it, line break kept.
      current.text += `\n${line}`;
      if (MEDIA_OMITTED.test(line.trim())) current.mediaOmitted = true;
    } else {
      // Text before any message header: not a message, counted not dropped.
      skippedLines += 1;
    }
  }
  flush();

  return {
    chatName,
    messages,
    systemLines,
    skippedLines,
    // The cap is WhatsApp's, not this parser's: reaching it means the export
    // itself may have stopped early, and the count is the honest report.
    capped: messages.length >= WHATSAPP_EXPORT_CAP,
  };
}
