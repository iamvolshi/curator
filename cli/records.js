// Reading records back. This is the other half of the point: an entry you
// cannot read is not a record.

import { createStore } from '../record/store.js';
import { renderEntry } from '../record/render.js';
import { heading, line, note } from './output.js';

export async function recordsCommand({ args = [] } = {}) {
  const store = createStore();
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
