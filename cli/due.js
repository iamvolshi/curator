// The due command: what is scheduled, what is done, what is still pending.
//
//   node bin/overseer.js due [--record PATH]
//
// A view, not a store: it reads the record as it is now and groups the
// imported entries — scheduled (dated, today or ahead), done, pending — by
// source and by chapter. Nothing here writes, judges, or reschedules: the
// record is the record, and this is just the reading of it a person checks
// in the morning.

import { createStore } from '../record/store.js';
import { renderPrioritisation } from '../import/prioritise.js';
import { readOption } from './args.js';
import { heading, line, note } from './output.js';

export async function dueCommand({ args = [], store = createStore() } = {}) {
  const recordPath = readOption(args, '--record');
  const resolved = recordPath ? createStore(recordPath) : store;
  const entries = await resolved.readAll();

  heading('What is due — from the imported record');
  line('file:', resolved.path);
  if (entries.length === 0) {
    note('Nothing has been recorded yet. Import a chat export first: node bin/overseer.js import --whatsapp <chat.txt>');
    return 0;
  }
  note(renderPrioritisation(entries));
  return 0;
}
