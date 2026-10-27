// The read-back, pinned: a fixed record has to print the same words every time.
//
// The record exists to be read, so how an entry is printed is part of what the
// record is. A property check can hold — the label is shown, the error is shown —
// while the shape of the page nobody asked to change quietly moves, and that is
// the edit easiest to miss. So the whole output of `records` over a fixed record
// is compared, line for line, against a blessed copy in test/fixtures/records.
//
// A deliberate change to the read-back means re-blessing them:
//
//     node test/records-golden.test.js --write
//     OVERSEER_WRITE_RECORD_GOLDENS=1 npm test     (the same thing)
//
// Read the diff before committing it: that diff is the change to what a reader
// sees. The fixtures are fixed inputs — explicit entries, a fixed file name — so
// two runs can differ only because the printing changed, never because of the
// machine, the clock, or what happens to be in this checkout's record file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { recordsCommand } from '../cli/records.js';
import { assertInventory, firstDifference, goldenText, writeRequested } from '../checks/golden.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDENS = join(HERE, 'fixtures', 'records');
const SCRIPT = 'node test/records-golden.test.js --write';

/** Writing is asked for outright, never inferred. */
const WRITE = writeRequested('OVERSEER_WRITE_RECORD_GOLDENS');

const WHEN = '2026-10-26T23:12:32.281Z';
const WORKER_URL = 'https://api.meta.ai/v1/chat/completions';
const BASETEN_URL = 'https://inference.baseten.co/v1/chat/completions';

/** What the command prints is the file it read: pinned, so it cannot be this machine's path. */
const FILE_NAME = 'records/k-record.jsonl';

/**
 * One entry of each shape the read-back knows how to print, in record order.
 * The point of the set is breadth, not a story: every branch of the printer
 * appears at least once, including a call with no token count and an entry shape
 * this renderer was never taught.
 */
const ENTRIES = [
  {
    seq: 1,
    when: WHEN,
    label: 'fact',
    what: {
      kind: 'worker-call',
      worker: 'meta-model-api',
      endpoint: `POST ${WORKER_URL}`,
      request: { method: 'POST', url: WORKER_URL, body: { model: 'muse-spark-1.3', messages: [] } },
      model: 'muse-spark-1.3',
      prompt: 'say ready',
      ok: true,
      response: 'ready',
      usage: { total_tokens: 186 },
      durationMs: 1443,
    },
  },
  {
    seq: 2,
    when: WHEN,
    label: 'fact',
    what: {
      kind: 'plug-prove',
      plug: 'baseten',
      role: 'overseer',
      endpoint: `POST ${BASETEN_URL}`,
      model: 'darrens-pick',
      prompt: 'say ready',
      ok: true,
      response: 'ready',
    },
  },
  {
    seq: 3,
    when: WHEN,
    label: 'fact',
    what: {
      kind: 'plug-task',
      plug: 'baseten',
      role: 'overseer',
      model: 'darrens-pick',
      prompt: 'name three colours',
      ok: true,
      response: 'red, green, blue',
    },
  },
  {
    seq: 4,
    when: WHEN,
    label: 'fact',
    what: {
      kind: 'worker-call',
      worker: 'meta-model-api',
      endpoint: `POST ${WORKER_URL}`,
      model: 'muse-spark-1.3',
      prompt: 'say ready',
      ok: false,
      response: null,
      error: { kind: 'auth', message: 'the key was rejected', fix: 'check the key' },
    },
  },
  {
    seq: 5,
    when: WHEN,
    label: 'fact',
    what: {
      kind: 'worker-call',
      worker: 'meta-model-api',
      model: 'muse-spark-1.3',
      prompt: 'say ready',
      ok: false,
      response: null,
      noCallMade: true,
      error: { kind: 'missing-key', message: 'the key is not there', fix: 'put it in .env' },
    },
  },
  {
    seq: 6,
    when: WHEN,
    label: 'judgment',
    what: { kind: 'judgment', move: 1, subjects: ['Ada Okafor'], observation: 'the reply supports the claim about Ada' },
  },
  {
    seq: 7,
    when: WHEN,
    label: 'question',
    what: { kind: 'question', move: 3, subjects: [], question: 'what in the record shows the basis for this?' },
  },
  // A shape from a later outcome, or one this renderer was never taught: it has to
  // print what it holds rather than nothing.
  { seq: 8, when: WHEN, label: 'judgment', what: { kind: 'something-later', note: 'a shape the printer does not know' } },
];

/** A store over the fixed entries: the command's two seams, and nothing else. */
function storeOver(entries) {
  return { path: FILE_NAME, readAll: async () => entries };
}

/** The command's output, as it reaches a terminal: every line, then a newline. */
async function printed(args, entries) {
  const lines = [];
  const original = console.log;
  console.log = (...values) => lines.push(values.map(String).join(' '));
  try {
    const code = await recordsCommand({ args, store: storeOver(entries) });
    assert.equal(code, 0, `records ${args.join(' ')} finished cleanly`);
  } finally {
    console.log = original;
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The four outputs that are pinned: the whole record read back, the last entry
 * on its own, the raw JSON view, and the empty record — one per branch of the
 * command rather than one per idea.
 */
const FIXTURES = [
  { name: 'entries-of-every-kind', args: [], entries: ENTRIES },
  { name: 'only-the-last-entry', args: ['--last'], entries: ENTRIES },
  { name: 'two-entries-as-json', args: ['--json'], entries: ENTRIES.slice(0, 2) },
  { name: 'nothing-recorded', args: [], entries: [] },
];

test('every fixed record reads back as exactly the output that was blessed', async () => {
  const seen = [];

  for (const fixture of FIXTURES) {
    const text = await printed(fixture.args, fixture.entries);
    const blessed = await goldenText({ dir: GOLDENS, extension: 'txt', name: fixture.name, text, write: WRITE, script: SCRIPT });

    if (blessed !== null) {
      assert.equal(text, blessed, firstDifference({ name: fixture.name, blessed, printed: text, noun: 'read-back', script: SCRIPT, glob: 'test/fixtures/records/*.txt' }));
    }
    seen.push(fixture.name);
  }

  assert.equal(seen.length, FIXTURES.length, 'every fixture was read back');
  if (WRITE) console.log(`blessed ${seen.length} read-backs: ${seen.join(', ')}`);
});

test('the blessed outputs are exactly the fixtures, with none left behind', async () => {
  await assertInventory({
    dir: GOLDENS,
    extension: 'txt',
    names: FIXTURES.map((fixture) => fixture.name),
    validate: (file, text) => assert.equal(text.endsWith('\n'), true, `${file} ends with a newline, as the terminal saw it`),
  });
});

test('nothing but the printing decides these outputs', async () => {
  // Reading the same record twice has to give the same words, or a blessed output
  // would fail for a reason that has nothing to do with what a reader sees.
  for (const fixture of FIXTURES) {
    assert.equal(
      await printed(fixture.args, fixture.entries),
      await printed(fixture.args, fixture.entries),
      `${fixture.name} prints the same twice`,
    );
  }

  // The record this checkout happens to hold must not be able to reach a pinned
  // output. So a marker entry is put where the default store would look, and the
  // read-back is asked for a fixed record: whatever comes back must not be it.
  const dir = await mkdtemp(join(tmpdir(), 'overseer-records-golden-'));
  const marker = 'A MARKER THAT MUST NOT BE PRINTED';
  try {
    await writeFile(
      join(dir, 'records.jsonl'),
      `${JSON.stringify({ seq: 1, when: WHEN, label: 'fact', what: { kind: 'worker-call', prompt: marker } })}\n`,
      'utf8',
    );
    process.env.OVERSEER_RECORDS = join(dir, 'records.jsonl');
    try {
      const text = await printed([], ENTRIES);
      assert.equal(text.includes(marker), false, 'the read-back printed the record it was given, not the one this machine holds');
    } finally {
      delete process.env.OVERSEER_RECORDS;
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
