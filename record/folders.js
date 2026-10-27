// Folders: a view of the record, one per subject.
//
// A folder is not a store. It holds the entries that name its subject, read out
// of the record in the order they were written, and it is rebuilt from the
// record on every read. So a folder cannot lose an entry, and a folder cannot
// disagree with the record — there is no second copy to disagree with.
//
// A subject is DECLARED, never guessed. A call says what it is about, the
// wrapper records that, and the folder appears the first time such an entry
// lands. Guessing from the prose was available and it was wrong: this record's
// own text would have produced a folder called "Company Logs Every AI Agent Call
// Permanently", because a Title Case headline looks exactly like a proper noun.
// A rule that cannot tell a name from a headline is not an observation, it is a
// guess with a confidence problem.
//
// Nothing seeds a subject. A folder exists because an entry named it, which is
// why there is no priming here: with no entries there are no folders at all.

/**
 * A list of subject names, trimmed and de-duplicated.
 * One copy, used both when an entry is written and when it is read back, so a
 * subject cannot look like two subjects because of spacing.
 */
export function normalizeSubjectList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const value of list) {
    if (typeof value !== 'string') continue;
    const name = value.trim();
    if (name === '' || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * The subjects an entry says it is about.
 * An entry about nothing returns an empty list — an entry that belongs to no
 * folder is a normal entry, not a broken one.
 */
export function subjectsOf(entry) {
  return normalizeSubjectList(entry?.what?.subjects);
}

/**
 * Every folder the record warrants, in the order each subject was first observed.
 *
 * @param {Array} entries the record, oldest first
 * @returns {Array<{name: string, entries: Array, firstSeq: number|null}>}
 */
export function foldersFrom(entries) {
  const order = [];
  const byName = new Map();

  for (const entry of entries) {
    for (const name of subjectsOf(entry)) {
      if (!byName.has(name)) {
        byName.set(name, []);
        order.push(name);
      }
      byName.get(name).push(entry);
    }
  }

  return order.map((name) => {
    // Entries arrive oldest first, so the folder is already in record order.
    const held = byName.get(name);
    return { name, entries: held, firstSeq: held[0]?.seq ?? null };
  });
}

/**
 * One folder, or an empty folder for a subject no entry has named.
 * The empty case is returned rather than null so a reader sees "nothing here"
 * instead of a crash, and it is never written down as if it existed.
 */
export function folderNamed(entries, name) {
  const wanted = String(name ?? '').trim();
  const held = entries.filter((entry) => subjectsOf(entry).includes(wanted));
  return { name: wanted, entries: held, firstSeq: held[0]?.seq ?? null };
}
