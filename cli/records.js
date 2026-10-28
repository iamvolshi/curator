// Reading records back. This is the other half of the point: an entry you
// cannot read is not a record.

import { createStore } from '../record/store.js';
import { renderEntry } from '../record/render.js';
import { heading, line, note } from './output.js';

// The store is taken as an argument like every other command's, so a check can
// read a fixed record back without a file on disk and without this printing
// whatever the machine happens to hold. The default is the real one.
export async function recordsCommand({ args = [], store = createStore() } = {}) {
  // Only these flags exist. Anything else is refused, not silently dropped: a
  // typo like "--last 2" would otherwise read as a plain "--last".
  const unknown = args.filter((arg) => arg !== '--last' && arg !== '--json');
  if (unknown.length > 0) {
    note(`records: unknown option ${unknown.map((arg) => JSON.stringify(arg)).join(', ')}. Use --last and/or --json.`);
    return 2;
  }

  const entries = await store.readAll();
  const wanted = args.includes('--last') ? entries.slice(-1) : entries;

  if (wanted.length === 0) {
    heading('Records');
    line('file:', store.path);
    note(entries.length === 0 ? 'Nothing has been recorded yet.' : 'No entries to show.');
    return 0;
  }

  heading(`Records (${wanted.length} of ${entries.length})`);
  line('file:', store.path);

  for (const entry of wanted) {
    note('');
    note(args.includes('--json') ? JSON.stringify(entry, null, 2) : renderEntry(entry));
  }

  return 0;
}
