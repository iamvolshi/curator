import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWhatsAppExport, WHATSAPP_EXPORT_CAP } from '../import/whatsapp.js';

const ANDROID = `[12/3/26, 14:05] Mara: Are you still up for coffee on Saturday?
[12/3/26, 14:06] Jonas: Absolutely, see you at 10
And I'll bring the sketches
[12/3/26, 14:07] Jonas: <Media omitted>
[12/3/26, 14:08] Messages and calls are end-to-end encrypted.
[12/3/26, 14:09] Jonas: Had a great time today`;

test('WhatsApp: Android format parses, day first', () => {
  const { messages, systemLines } = parseWhatsAppExport(ANDROID);
  assert.equal(messages.length, 4);
  assert.equal(messages[0].sender, 'Mara');
  assert.equal(messages[0].text, 'Are you still up for coffee on Saturday?');
  assert.equal(messages[0].when.slice(0, 10), '2026-03-12');
  assert.equal(systemLines.length, 1);
});

test('WhatsApp: multi-line messages keep their line breaks', () => {
  const { messages } = parseWhatsAppExport(ANDROID);
  assert.equal(messages[1].text, "Absolutely, see you at 10\nAnd I'll bring the sketches");
});

test('WhatsApp: media-omitted placeholders are marked, not dropped', () => {
  const { messages } = parseWhatsAppExport(ANDROID);
  assert.equal(messages[2].text, '<Media omitted>');
  assert.equal(messages[2].mediaOmitted, true);
  assert.equal(messages[0].mediaOmitted, false);
});

test('WhatsApp: iOS format parses, month first, 12-hour clock with seconds', () => {
  const ios = '[3/12/2026, 2:05:33 PM] Mara: hi there\n[3/12/2026, 11:05:02 AM] Jonas: morning';
  const { messages } = parseWhatsAppExport(ios, { dateOrder: 'mdy' });
  assert.equal(messages.length, 2);
  // Checked in local time: the export carries no timezone, so the time is
  // read as local and stored as ISO — the wall-clock reading is the stable one.
  const first = new Date(messages[0].when);
  assert.equal(first.getMonth(), 2);
  assert.equal(first.getDate(), 12);
  assert.equal(first.getHours(), 14);
  assert.equal(first.getMinutes(), 5);
  assert.equal(first.getSeconds(), 33);
  const second = new Date(messages[1].when);
  assert.equal(second.getHours(), 11);
  assert.equal(second.getSeconds(), 2);
});

test('WhatsApp: a date with one half over 12 answers its own order', () => {
  // 25 can only be a day, so 25/3 is day-first whatever the option says.
  const { messages } = parseWhatsAppExport('[25/3/26, 09:00] Mara: hi', { dateOrder: 'mdy' });
  assert.equal(messages[0].when.slice(0, 10), '2026-03-25');
  // 3/25 can only be month-first.
  const { messages: m2 } = parseWhatsAppExport('[3/25/26, 09:00] Mara: hi', { dateOrder: 'dmy' });
  assert.equal(m2[0].when.slice(0, 10), '2026-03-25');
});

test('WhatsApp: an ambiguous date follows the dateOrder option', () => {
  const line = '[3/12/26, 09:00] Mara: hi';
  assert.equal(parseWhatsAppExport(line, { dateOrder: 'dmy' }).messages[0].when.slice(0, 10), '2026-12-03');
  assert.equal(parseWhatsAppExport(line, { dateOrder: 'mdy' }).messages[0].when.slice(0, 10), '2026-03-12');
});

test('WhatsApp: system lines with a sender prefix are still system lines', () => {
  const { messages, systemLines } = parseWhatsAppExport(
    '[12/3/26, 09:00] Mara: Jonas created this group\n[12/3/26, 09:01] Mara: hello',
  );
  assert.equal(messages.length, 1);
  assert.equal(systemLines.length, 1);
});

test('WhatsApp: text before the first header is counted, not silently dropped', () => {
  const { messages, skippedLines } = parseWhatsAppExport('stray line\n[12/3/26, 09:00] Mara: hi');
  assert.equal(messages.length, 1);
  assert.equal(skippedLines, 1);
});

test('WhatsApp: the 40k cap is flagged, never silently truncated', () => {
  assert.equal(WHATSAPP_EXPORT_CAP, 40000);
  const lines = Array.from({ length: 40000 }, (_, i) => `[12/3/26, 09:00] Mara: message ${i}`);
  const result = parseWhatsAppExport(lines.join('\n'));
  assert.equal(result.messages.length, 40000);
  assert.equal(result.capped, true);
  const small = parseWhatsAppExport('[12/3/26, 09:00] Mara: hi');
  assert.equal(small.capped, false);
});
