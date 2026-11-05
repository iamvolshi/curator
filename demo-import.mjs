// Demo: import the fictional samples into a scratch record and show the
// prioritisation view. Nothing here touches the real record, the Ada demo,
// or the live site: the record lives in the OS temp dir and is deleted at
// the end of the run. Run it with: npm run demo:import
//
// It imports twice on purpose: the second run must append nothing, proving
// the hash dedupe works.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importLinkedIn, importWhatsApp } from './import/import.js';
import { createStore } from './record/store.js';
import { renderPrioritisation } from './import/prioritise.js';

const scratch = await mkdtemp(join(tmpdir(), 'curator-import-demo-'));
const recordPath = join(scratch, 'k-record.jsonl');

console.log('Scratch record:', recordPath);
console.log('All people and messages below are fictional sample data.\n');

const wa = await importWhatsApp({
  file: 'test/fixtures/sample-whatsapp-chat.txt',
  recordPath,
  chatName: 'Weekend plans',
});
console.log(`WhatsApp: parsed ${wa.parsed}, appended ${wa.appended}, skipped ${wa.skipped}, pending ${wa.pending}`);

const li = await importLinkedIn({ file: 'test/fixtures/linkedin-sample-export.zip', recordPath });
console.log(`LinkedIn: parsed ${li.parsed}, appended ${li.appended}, skipped ${li.skipped}, pending ${li.pending}`);

const wa2 = await importWhatsApp({
  file: 'test/fixtures/sample-whatsapp-chat.txt',
  recordPath,
  chatName: 'Weekend plans',
});
console.log(`WhatsApp again: parsed ${wa2.parsed}, appended ${wa2.appended}, skipped ${wa2.skipped} (dedupe holds)`);

const entries = await createStore(recordPath).readAll();
console.log(renderPrioritisation(entries));

await rm(scratch, { recursive: true, force: true });
console.log('\nScratch record deleted. The real record was never touched.');
