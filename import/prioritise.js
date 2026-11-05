// The prioritisation view: what is due, what is done, what is still open.
//
// There is no day→week→month→quarter summary pipeline in this codebase —
// the concept is in the notes, the code is not — so this view is built on
// what exists: folders (chapters, one per declared subject), shades (how
// much of a subject the record supports), and the classification every
// imported entry carries in `what.classification`.
//
// Three buckets, from imported entries only (a model-call entry carries no
// classification and is not a commitment anyone made):
//   scheduled — a dated appointment or invitation whose date is today or
//               ahead, earliest first
//   done      — classified done, most recent first
//   pending   — everything else: undated, uncertain, or awaiting a reply
// Within each bucket entries group by source (WhatsApp / LinkedIn) and then
// by subject (chapter), so a reader sees "WhatsApp → Mara's birthday plan"
// rather than one flat list.

import { foldersFrom } from '../record/folders.js';
import { shadeFor } from '../record/shades.js';

const IMPORT_KINDS = new Set(['whatsapp-import', 'linkedin-import']);

/** Only imported entries: the view is about what people said to you. */
export function importedEntries(entries) {
  return (entries ?? []).filter((entry) => IMPORT_KINDS.has(entry?.what?.kind));
}

function bucketOf(entry) {
  const classification = entry?.what?.classification ?? {};
  if (classification.status === 'done') return 'done';
  if (classification.status === 'scheduled') return 'scheduled';
  if (classification.status === 'pending') return 'pending';
  // An imported entry with no classification (older imports, hand-written
  // rows) is pending: the view never guesses a status it was not given.
  return 'pending';
}

function compareDates(a, b) {
  const da = a?.what?.classification?.date ?? '';
  const db = b?.what?.classification?.date ?? '';
  return da < db ? -1 : da > db ? 1 : 0;
}

/**
 * Sort the view: scheduled earliest-first, done and pending most recent
 * first (a done thing matters by how fresh it is; a pending thing by how
 * long it has waited).
 */
export function prioritise(entries, { now = new Date() } = {}) {
  const imported = importedEntries(entries);
  const view = { scheduled: [], done: [], pending: [] };

  for (const entry of imported) view[bucketOf(entry)].push(entry);

  view.scheduled.sort(compareDates);
  const byWhenDesc = (a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0);
  view.done.sort(byWhenDesc);
  view.pending.sort(byWhenDesc);

  return view;
}

/** Group a bucket's entries by source, then by first declared subject. */
export function groupBySourceAndSubject(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const source = entry?.what?.source ?? 'unknown';
    const subjects = entry?.what?.subjects;
    const subject = Array.isArray(subjects) && subjects[0] ? subjects[0] : '(no chapter)';
    const key = `${source} :: ${subject}`;
    if (!groups.has(key)) groups.set(key, { source, subject, entries: [] });
    groups.get(key).entries.push(entry);
  }
  return [...groups.values()];
}

/**
 * One line per entry, readable in a terminal: date (when the message names
 * one), who said it, and the first line of what they said.
 */
export function renderEntryLine(entry) {
  const what = entry?.what ?? {};
  const classification = what.classification ?? {};
  const date = classification.date ? `${classification.date} ` : '';
  const sender = what.sender ?? what.from ?? 'unknown';
  const firstLine = String(what.text ?? '').split('\n')[0];
  const clipped = firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
  return `${date}${sender}: ${clipped}`;
}

/** The whole view as text: three buckets, grouped, with chapter shades. */
export function renderPrioritisation(entries, { now = new Date() } = {}) {
  const view = prioritise(entries, { now });
  const folders = foldersFrom(entries);
  const shadeBySubject = new Map(folders.map((f) => [f.name, shadeFor(entries, f.name).shade]));
  const lines = [];

  const sections = [
    ['Scheduled — dated, today or ahead', view.scheduled],
    ['Done', view.done],
    ['Pending — no date, or awaiting a reply', view.pending],
  ];

  for (const [title, bucket] of sections) {
    lines.push(`\n${title} (${bucket.length})`);
    lines.push('-'.repeat(title.length + 4));
    if (bucket.length === 0) {
      lines.push('  nothing here.');
      continue;
    }
    for (const group of groupBySourceAndSubject(bucket)) {
      const shade = shadeBySubject.get(group.subject);
      const shadeNote = shade === undefined ? '' : ` — shade ${shade}/9`;
      lines.push(`  ${group.source} · ${group.subject}${shadeNote} (${group.entries.length})`);
      for (const entry of group.entries) lines.push(`    ${renderEntryLine(entry)}`);
    }
  }

  const total = view.scheduled.length + view.done.length + view.pending.length;
  lines.push(`\nImported entries: ${total} (${view.scheduled.length} scheduled · ${view.done.length} done · ${view.pending.length} pending).`);
  return lines.join('\n');
}
