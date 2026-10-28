// Writing the record out as one page a person can read.
//
// The page is built from whatever is in the file at the moment this runs, so it
// cannot describe a record that does not exist. Nothing here knows what an entry
// says: it reads, hands the entries to the renderer, and writes the result.

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describeGroupingProblem, storedGroupingProblems } from '../judge/consolidate.js';
import { storedSchemaProblems } from '../judge/delivery.js';
import { storedLinkProblems } from '../judge/readout.js';
import { createStore } from '../record/store.js';
import { readOption } from './args.js';
import { heading, line, note } from './output.js';
import { buildPage, parkedFor } from './view.js';

/** Where the page goes unless `--out` says otherwise. */
export const DEFAULT_PAGE_PATH = 'record.html';

export async function pageCommand({
  args = [],
  store = createStore(),
  now = () => new Date(),
  env = process.env,
} = {}) {
  const outPath = resolve(readOption(args, '--out') ?? DEFAULT_PAGE_PATH);
  const entries = await store.readAll();
  const generatedAt = now().toISOString();
  const parked = await parkedFor(entries, env);
  // Checked before the page is opened, let alone shared: a stored opinion that no
  // longer links is a fact about the record, and the person building the page should
  // hear it from this output rather than notice a marked row later.
  const linkProblems = storedLinkProblems(entries);
  // A stored report can find every seat and still group them differently from what
  // the code would produce today. That is the other half of the same guarantee, so it
  // is checked and reported beside the link, before the page is shared.
  const groupingProblems = storedGroupingProblems(entries);
  // A stored report can also carry a field the form has no place for. The
  // grouping check cannot see it — it compares what an opinion says, not what
  // else it holds — so it is named here rather than left for a reader to notice.
  const schemaProblems = storedSchemaProblems(entries);

  const html = buildPage(entries, { source: store.path, generatedAt, env, parked, groupingProblems });
  await writeFile(outPath, html, 'utf8');

  heading('The record, as one page');
  line('read from:', store.path);
  line('entries:', String(entries.length));
  line(
    'links:',
    linkProblems.length === 0
      ? 'every stored delivery still finds the seats it cites'
      : `${linkProblems.length} stored opinion${linkProblems.length === 1 ? '' : 's'} no longer link${linkProblems.length === 1 ? 's' : ''} to a seat`,
  );
  for (const problem of linkProblems) {
    note(`  seq ${problem.seq}, move ${problem.move}: ${describeLinkProblem(problem)}`);
  }
  line(
    'grouping:',
    groupingProblems.length === 0
      ? 'every stored delivery still groups the way its seat reports do'
      : groupingProblems.length === 1
        ? '1 stored delivery no longer matches its seat reports'
        : `${groupingProblems.length} stored deliveries no longer match their seat reports`,
  );
  for (const problem of groupingProblems) {
    note(`  seq ${problem.seq}, move ${problem.move}: ${describeGroupingProblem(problem)}`);
  }
  line(
    'schema:',
    schemaProblems.length === 0
      ? 'every stored opinion and question carries only fields the schema defines'
      : `${schemaProblems.length} stored ${schemaProblems.length === 1 ? 'opinion or question carries a field' : 'opinions or questions carry fields'} the schema does not define`,
  );
  for (const problem of schemaProblems) {
    note(`  seq ${problem.seq}, move ${problem.move}: ${problem.where} carries ${problem.fields.join(', ')}, which the schema does not define`);
  }
  line('written to:', outPath);

  if (entries.length === 0) {
    note('The record is empty, so the page says so instead of inventing anything.');
  }
  // Said here as well as on the page: a park is a fact about the queue, and a
  // reader of this output should not have to open the file to learn one exists.
  if (parked.length > 0) {
    line('parked:', `${parked.length} move${parked.length === 1 ? '' : 's'} the judge is skipping, shown on the page and still unjudged`);
  }
  note('Open it in a browser, or print it to PDF. Regenerate it after every call.');

  // The page is still written, with the row marked: the record is not hidden from a
  // reader because a link broke. The non-zero code is the alarm, so a script or a
  // person building the page sees it before the page is shown to anyone.
  return linkProblems.length === 0 && groupingProblems.length === 0 && schemaProblems.length === 0 ? 0 : 1;
}

/** One line a reader can act on: what the basis no longer places, and why. */
function describeLinkProblem(problem) {
  const basis = problem.basis.length > 0 ? `entries ${problem.basis.join(', ')}` : 'an empty basis';
  const unplaced = problem.reparse ?? [];
  if (unplaced.length > 0) {
    return `${unplaced.join(', ')} ${unplaced.length === 1 ? 'is' : 'are'} not placed by ${basis}`;
  }
  if (problem.missing?.length > 0) {
    return `no seat in this record holds ${problem.missing.join(', ')} for ${basis}`;
  }
  if (problem.reason === 'ambiguous') {
    return `${problem.models.join(', ')} sits on more than one seat with different opinions, so ${basis} cannot choose between them`;
  }
  return `no seat in this record holds an opinion on ${basis}`;
}
