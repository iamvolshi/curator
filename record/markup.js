// The small pieces every part of the page shares, in one copy.
//
// Escaping is the piece that matters most: a reply is text, not markup, and every
// part of the page that shows recorded words has to pass through the same function
// or one section becomes the way in. Counting and clipping are here for the same
// reason — two sections disagreeing is a real way for a page to misreport one
// record, so "1 call" and "1 calls" must not be able to come from two files.

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape text for HTML. Model output is not trusted to be markup. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

/** "3 calls · 3 facts · 0 judgments", with the plural handled once. */
export function count(n, singular, plural = `${singular}s`) {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * How an entry's call reads, in a word — or null when the entry records no call.
 *
 * Three outcomes, not two: one that was sent and worked, one that was sent and did
 * not work, and one where nothing was sent at all. Folding the third into "did not
 * work" said a call had gone out and failed when the record shows none did, and the
 * foot of the page counts "never sent" apart for exactly that reason — so every part
 * of the page has to agree with it. A judgment or a question records no call either,
 * so it gets no word here rather than borrowing one it did not earn.
 */
export function callOutcome(what) {
  if (typeof what?.ok !== 'boolean') return null;
  if (what.ok) return 'worked';
  return what.noCallMade === true ? 'never sent' : 'did not work';
}

/** Shorten text for a tooltip, where a long value would be unusable. */
export function clip(value, max = 90) {
  const flat = String(value ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}\u2026` : flat;
}
