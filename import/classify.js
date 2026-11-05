// Deterministic classification of an imported message.
//
// No model, no judge: a keyword list and a date rule, both written down here
// so any result can be checked by reading the message. Judges doctrine says
// deterministic work is done deterministically, and sorting a message into
// "appointment / invitation / contact-request / commitment / other" is
// deterministic work.
//
// Two outputs per message:
//   type   — appointment | invitation | contact-request | commitment | other
//   status — done | scheduled | pending
//
// The status rule, exactly:
//   - a message that says the thing already happened (did it, sent it, done,
//     finished, met) is done;
//   - a message with a date in the future is scheduled;
//   - a message with a date in the past and no done-marker is done (the date
//     passed; the meeting happened or it didn't, and the record says only
//     that the date is behind us — see the note on `date` below);
//   - everything else, and anything whose date cannot be read, is pending.
//     Uncertain is pending, never guessed: a wrong "scheduled" is a missed
//     meeting, a wrong "pending" is just a message to look at.
//
// Dates are read from the message text against a reference day (`now`, which
// the caller passes so tests can fix it): "tomorrow", "today", weekday names
// (the next one, so "Friday" on a Wednesday means this Friday, on a Saturday
// means next Friday), and explicit dates (12 Nov, Nov 12, 12/11/2026,
// 2026-11-12). A bare time ("at 3") is not a date: without a day it stays
// pending. Month/day numbers are read day-first (12/11 = 12 November), the
// same convention as the WhatsApp parser's default.

export const TYPES = ['appointment', 'invitation', 'contact-request', 'commitment', 'other'];
export const STATUSES = ['done', 'scheduled', 'pending'];

const APPOINTMENT_WORDS = [
  'meet',
  'meeting',
  'coffee',
  'lunch',
  'dinner',
  'breakfast',
  'call',
  'zoom',
  'video call',
  'catch up',
  'catch-up',
  'see you',
  'appointment',
  'booked',
  'book a',
  'let’s meet',
  "let's meet",
  'come over',
  'come round',
  'drop by',
  'swing by',
];
const INVITATION_WORDS = [
  'invit',
  'join us',
  'join me',
  'come to',
  'you’re invited',
  "you're invited",
  'party',
  'event',
  'webinar',
  'launch',
  'celebration',
  'rsvp',
];
const CONTACT_WORDS = [
  'connect',
  'connection request',
  'add me',
  'follow up',
  'follow-up',
  'introduc',
  'intro ',
  'nice to meet you',
  'great to connect',
  'let’s connect',
  "let's connect",
  'request to connect',
];
const COMMITMENT_WORDS = [
  'i will',
  'i’ll',
  "i'll",
  'i promise',
  'i can do',
  'i’ll send',
  "i'll send",
  'i’ll do',
  "i'll do",
  'i’ll get',
  "i'll get",
  'by friday',
  'by monday',
  'by tomorrow',
  'agreed',
  'confirming',
  'i confirm',
  'count me in',
  'deal',
];
const DONE_WORDS = [
  'done',
  'finished',
  'completed',
  'did it',
  'sent it',
  'already sent',
  'it’s done',
  "it's done",
  'all done',
  'great meeting',
  'thanks for meeting',
  'had a great',
  'went well',
];

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

function hasAny(text, words) {
  return words.some((word) => text.includes(word));
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * The first date the text names, as an ISO date (YYYY-MM-DD), or null.
 * Also returns whether the reading is certain: a weekday name is certain
 * enough to schedule on (it names a day), a bare "next week" is not a date
 * and returns null. Nothing here guesses a year for a dateless month/day:
 * it takes the next occurrence from the reference day.
 */
export function extractDate(text, now = new Date()) {
  const lower = String(text ?? '').toLowerCase();
  const ref = startOfDay(now);

  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(ref);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (/\btoday\b/.test(lower)) return ref.toISOString().slice(0, 10);

  const weekday = WEEKDAYS.findIndex((day) => new RegExp(`\\b${day}\\b`).test(lower));
  if (weekday !== -1) {
    const d = new Date(ref);
    // The next one, not today: "Friday" said on a Friday means next Friday.
    // "Next Friday" means the one after that — the Friday of next week.
    let delta = (weekday - d.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    if (new RegExp(`\\bnext\\s+${WEEKDAYS[weekday]}\\b`).test(lower)) delta += 7;
    d.setDate(d.getDate() + delta);
    return d.toISOString().slice(0, 10);
  }

  // 12 November / November 12 / 12 Nov 2026 / Nov 12, 2026
  const named = new RegExp(
    `\\b(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join('|')})|(${MONTHS.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?)(?:,?\\s+(\\d{4}))?\\b`,
  ).exec(lower);
  if (named) {
    const day = Number(named[1] ?? named[4]);
    const month = MONTHS.indexOf(named[2] ?? named[3]);
    let year = Number(named[5] ?? ref.getFullYear());
    const d = new Date(year, month, day);
    // No year given: this year. A message saying "we met on 12 October" in
    // November means last month, not next year — and a scheduling message
    // names a date near the message, so this year is the honest reading.
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  // ISO: 2026-11-12
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(lower);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // Numeric: 12/11/2026 or 12/11, day first.
  const numeric = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(lower);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    let year = numeric[3] ? Number(numeric[3]) : ref.getFullYear();
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(year, month - 1, day);
      return d.toISOString().slice(0, 10);
    }
  }

  return null;
}

/**
 * Classify one imported message.
 *
 * @param {{ text: string, when?: string }} message
 * @param {{ now?: Date|string }} options `now` is the reference day for
 *   "tomorrow" and weekday names; pass a fixed date in tests.
 * @returns {{ type, status, date: string|null, reason: string }}
 *   `date` is the ISO date the text names, or null. `reason` names the rule
 *   that fired, so a classification can be argued with.
 */
export function classifyMessage(message, { now = new Date() } = {}) {
  const text = String(message?.text ?? message?.content ?? '');
  const lower = text.toLowerCase();
  const ref = startOfDay(now);
  const date = extractDate(text, ref);

  let type = 'other';
  let reason = 'no appointment, invitation, contact-request or commitment wording found';
  if (hasAny(lower, APPOINTMENT_WORDS)) {
    type = 'appointment';
    reason = 'appointment wording (meet / call / coffee / see you …)';
  } else if (hasAny(lower, INVITATION_WORDS)) {
    type = 'invitation';
    reason = 'invitation wording (invite / join us / party / event …)';
  } else if (hasAny(lower, CONTACT_WORDS)) {
    type = 'contact-request';
    reason = 'contact-request wording (connect / introduce / follow up …)';
  } else if (hasAny(lower, COMMITMENT_WORDS)) {
    type = 'commitment';
    reason = 'commitment wording (I will / I’ll send / agreed …)';
  }

  // LinkedIn connection-request and invitation messages often carry their
  // meaning in the envelope, not the text: a caller that knows the row came
  // from Invitations.csv says so with `context`.
  if (message?.context === 'invitation' && type === 'other') {
    type = 'contact-request';
    reason = 'row came from Invitations.csv';
  }

  // A connection already made is done, not pending: the row itself is the
  // proof it happened, and waiting on it would be a false open loop.
  if (message?.context === 'connection') {
    return { type: 'contact-request', status: 'done', date, reason: 'row came from Connections.csv: the connection already exists' };
  }

  let status = 'pending';
  if (hasAny(lower, DONE_WORDS)) {
    status = 'done';
    reason += '; done wording present';
  } else if (date) {
    // A named date in the past is done: the day is behind us. A named date
    // in the future is scheduled. No date at all stays pending.
    status = date < ref.toISOString().slice(0, 10) ? 'done' : 'scheduled';
    reason += `; named date ${date} is ${status === 'done' ? 'past' : 'ahead'}`;
  } else {
    reason += '; no date named, so pending rather than guessed';
  }

  return { type, status, date, reason };
}
