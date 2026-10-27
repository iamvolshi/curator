// Writing the record out as one page a person can read.
//
// The page is built from whatever is in the file at the moment this runs, so it
// cannot describe a record that does not exist. Nothing here knows what an entry
// says: it reads, hands the entries to the renderer, and writes the result.

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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

  const html = buildPage(entries, { source: store.path, generatedAt, env, parked });
  await writeFile(outPath, html, 'utf8');

  heading('The record, as one page');
  line('read from:', store.path);
  line('entries:', String(entries.length));
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

  return 0;
}
