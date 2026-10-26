// A K-record entry answers three questions about one moment:
//
//   what happened   -> `what`
//   when it happened -> `when`
//   what kind of statement it is -> `label`
//
// The two labels:
//   fact     — something observed. A call went out and this is what came back.
//   judgment — an assessment someone made about an observation.
//
// This outcome builds and uses the `fact` path only. `judgment` is declared
// here so the shape is fixed from the start, but nothing in this scaffold
// writes one yet — that belongs to a later outcome.

export const LABELS = ['fact', 'judgment'];

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
