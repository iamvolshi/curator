// A K-record entry answers three questions about one moment:
//
//   what happened   -> `what`
//   when it happened -> `when`
//   what kind of statement it is -> `label`
//
// The three labels, and the difference is the label:
//   fact     — something observed. A call went out and this is what came back.
//   judgment — the Overseer's assessment of an observed move. Labelled, in the
//              entry itself, so no reader can mistake it for a fact.
//   question — an open follow-up question on a subject. It sits in the subject's
//              thread. It is not a fact and not a judgment, and it darkens
//              nothing.
//
// Only facts are observations. A judgment never changes a fact, and a question
// never darkens a shade — the labels are what keep those three apart.

export const LABELS = ['fact', 'judgment', 'question'];

/**
 * Build an entry, refusing to hand back one that is malformed.
 * Throws rather than returning a partial record: a record store that quietly
 * accepts a broken entry is worse than no record store.
 */
export function makeEntry({ when, label, what }) {
  const entry = { when, label, what };
  const problem = checkEntry(entry);
  if (problem) throw new Error(`refusing to record a malformed entry: ${problem}`);
  return entry;
}

/** Returns a plain description of what is wrong with an entry, or null if it is fine. */
export function checkEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return 'an entry must be an object';
  }
  if (typeof entry.when !== 'string' || Number.isNaN(Date.parse(entry.when))) {
    return 'when must be a date written as an ISO string, e.g. 2026-10-26T16:00:00.000Z';
  }
  if (!LABELS.includes(entry.label)) {
    return `label must be one of: ${LABELS.join(', ')}`;
  }
  if (!entry.what || typeof entry.what !== 'object' || Array.isArray(entry.what)) {
    return 'what must be an object describing what happened';
  }
  if (Object.keys(entry.what).length === 0) {
    return 'what cannot be empty';
  }
  return null;
}
