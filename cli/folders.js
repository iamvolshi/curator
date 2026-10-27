// Reading folders back.
//
// A folder is not created by this command: it holds the entries the record
// already has, and it is rebuilt from the record each time. So `folders` can
// show a subject that was named a minute ago and cannot show one nobody named.
//
// Reading a folder back prints its entries in record order, each with its label
// visible, because a fact, a judgment and a question must never read alike.

import { folderNamed, foldersFrom, unfiledQuestions } from '../record/folders.js';
import { renderEntry } from '../record/render.js';
import { MAX_SHADE, describeShade, shadeFor } from '../record/shades.js';
import { createStore } from '../record/store.js';
import { readOption } from './args.js';
import { heading, line, note } from './output.js';

/** Wide enough for a subject, narrow enough to keep the counts in one column. */
const NAME_WIDTH = 28;

function clip(value, max = NAME_WIDTH) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;
}

/**
 * The questions that belong to no folder, printed under their own heading.
 * They are shown rather than filed: a question about a move that names no
 * subject has no thread to sit in, and inventing a subject to hold it would be
 * a folder nobody observed. Leaving it out made it reachable only by reading the
 * raw record, which is close to not recording it.
 */
function printUnfiled(unfiled) {
  heading('Unfiled \u2014 questions with no subject to sit in');
  for (const entry of unfiled) {
    const what = entry.what ?? {};
    const about = Number.isInteger(what.move) ? ` \u2014 about the move at seq ${what.move}` : '';
    note(`seq ${entry.seq}${about}`);
    note(`  ${what.question ?? '(no question text recorded)'}`);
  }
  note('');
  note(`Unfiled questions: ${unfiled.length}. They belong to no folder by design: nothing was invented to hold them.`);
}

export async function foldersCommand({ args = [], store = createStore() } = {}) {
  const entries = await store.readAll();
  const wanted = readOption(args, '--subject');

  if (wanted !== undefined) {
    const folder = folderNamed(entries, wanted);

    heading(`Folder \u2014 ${folder.name}`);
    if (folder.entries.length === 0) {
      // Not an error: a subject nobody observed has no folder, and inventing one
      // would be priming, which this phase does not do.
      note('No entry names this subject, so there is no folder. Nothing was created to hold it.');
      return 0;
    }

    line('entries:', String(folder.entries.length));
    line('first seen:', `seq ${folder.firstSeq}`);
    // Counted from the whole record, so a folder view cannot overstate a shade by
    // holding only part of the subject's facts.
    line('shade:', describeShade(shadeFor(entries, folder.name)));
    note('');
    note(folder.entries.map(renderEntry).join('\n\n'));
    return 0;
  }

  const folders = foldersFrom(entries);
  const unfiled = unfiledQuestions(entries);

  heading('Folders \u2014 one per subject the record names');
  if (folders.length === 0) {
    note('No folder exists yet: no entry has declared a subject.');
    note('A folder appears when a call says what it is about, not before.');
  } else {
    for (const folder of folders) {
      const labels = folder.entries.reduce((counts, entry) => {
        counts[entry.label] = (counts[entry.label] ?? 0) + 1;
        return counts;
      }, {});
      const said = Object.entries(labels)
        .map(([label, n]) => `${n} ${label}${n === 1 ? '' : 's'}`)
        .join(' \u00b7 ');
      const shade = shadeFor(entries, folder.name);
      const band = shade.band === 'black' ? ', black band' : '';
      line(clip(folder.name), `${said || 'empty'} \u00b7 shade ${shade.shade}/${MAX_SHADE}${band}`);
    }

    note('');
    note(`Subjects: ${folders.length}. Read one back with --subject "..."`);
  }

  // Printed whether or not any folder exists: the record can hold unfiled
  // questions while declaring no subjects at all, and that is not a reason to
  // stop before showing them.
  if (unfiled.length > 0) {
    printUnfiled(unfiled);
  }
  return 0;
}
