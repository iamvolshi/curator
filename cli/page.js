// Writing the record out as one page a person can read.
//
// The page is built from whatever is in the file at the moment this runs, so it
// cannot describe a record that does not exist. Nothing here knows what an entry
// says: it reads, hands the entries to the renderer, and writes the result.

import { writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { renderPage } from '../record/html.js';
import { createStore } from '../record/store.js';
import { readOption } from './args.js';
import { heading, line, note } from './output.js';

/** Where the page goes unless `--out` says otherwise. */
export const DEFAULT_PAGE_PATH = 'record.html';

export async function pageCommand({
  args = [],
  store = createStore(),
  now = () => new Date(),
} = {}) {
  const outPath = resolve(readOption(args, '--out') ?? DEFAULT_PAGE_PATH);
  const entries = await store.readAll();
  const generatedAt = now().toISOString();

  // Shown as it appears in the project rather than as a machine's absolute path:
  // the page may end up in front of someone who does not have this checkout.
  const html = renderPage(entries, { source: showablePath(store.path), generatedAt });
  await writeFile(outPath, html, 'utf8');

  heading('The record, as one page');
  line('read from:', store.path);
  line('entries:', String(entries.length));
  line('written to:', outPath);

  if (entries.length === 0) {
    note('The record is empty, so the page says so instead of inventing anything.');
  }
  note('Open it in a browser, or print it to PDF. Regenerate it after every call.');

  return 0;
}

/** The path as a reader of the page should see it: relative when it is inside the project. */
function showablePath(path) {
  const shown = relative(process.cwd(), path);
  if (shown === '' || shown.startsWith('..') || isAbsolute(shown)) return path;
  // Forward slashes: the page may be read on a different kind of machine.
  return shown.replaceAll('\\', '/');
}
