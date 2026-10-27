// The judge's run, pinned: a fixed record and fixed replies print the same words.
//
// judge.test.js and judge-options.test.js check properties — that a judgment names
// its move, that a cap is announced, that a refusal exits 5. This checks the whole
// terminal output of a run, and the exit code it ends on, because every property
// can still hold while the report quietly changes shape, and how a run reports
// itself is how a reader knows what it did. A park is the clearest case: it writes
// nothing to the record by design, so this output is the only place it is visible.
//
// A deliberate change to the report means re-blessing the fixtures:
//
//     node test/judge-golden.test.js --write
//     OVERSEER_WRITE_JUDGE_GOLDENS=1 npm test     (the same thing)
//
// Read the diff before committing it: that diff is the change to what a run says
// it did. The inputs are fixed — explicit entries, explicit replies, an explicit
// environment, a real ledger in a temporary directory — so two runs can differ only
// because the report changed, never because of the clock, a key on this machine, or
// what happens to be in this checkout's record file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertInventory, firstDifference, goldenText, writeRequested } from '../checks/golden.js';
import { judgeCommand } from '../cli/judge.js';
import { createLedger } from '../judge/attempts.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const GOLDENS = join(HERE, 'fixtures', 'judge');
const SCRIPT = 'node test/judge-golden.test.js --write';

const WRITE = writeRequested('OVERSEER_WRITE_JUDGE_GOLDENS');

const WHEN = '2026-10-26T23:12:32.281Z';

/** What the run prints is the file it read: pinned, so it cannot be this machine's path. */
const FILE_NAME = 'records/k-record.jsonl';

/** A plug that can be called: the model is chosen, and a key is present. */
const READY = { BASETEN_API_KEY: 'baseten-secret', BASETEN_MODEL: 'darrens-pick' };

/** Replies, in the shapes the judge must tell apart. */
const SHOWN = JSON.stringify({ basis: 'shown', observation: 'the reply supports its claim', question: '' });
const NOT_SHOWN = JSON.stringify({ basis: 'not-shown', observation: '', question: 'what in the record supports this claim?' });
const DIRECTING = JSON.stringify({
  basis: 'shown',
  observation: 'the reply supports its claim, but you should add a timing figure next',
  question: '',
});

/** One observed move, as the wrapper records it. */
function fact(seq, prompt, subjects = []) {
  return {
    seq,
    when: WHEN,
    label: 'fact',
    what: { kind: 'worker-call', worker: 'meta-model-api', model: 'muse-spark-1.3', prompt, ok: true, response: 'ready', subjects },
  };
}

/** One judgment, already in the record: the move it names is answered. */
function judgment(seq, move) {
  return {
    seq,
    when: WHEN,
    label: 'judgment',
    what: { kind: 'judgment', move, subjects: ['Ada Okafor'], observation: 'the reply supports its claim' },
  };
}

/** Three moves in record order: enough for a cap, a pick, and a park to differ. */
const THREE = [fact(1, 'say ready', ['Ada Okafor']), fact(2, 'name three colours', ['Ada Okafor']), fact(3, 'third move')];

/** A store over the fixed entries; `written` is what the run appended. */
function storeOver(entries) {
  const written = [];
  return {
    path: FILE_NAME,
    readAll: async () => entries,
    append: async (entry) => {
      written.push(entry);
      return { seq: entries.length + written.length, ...entry };
    },
    written,
  };
}

/**
 * The provider, as a queue of replies. A fixture gives exactly the replies its run
 * should consume; asking for one more is a fixture that is out of answers, and the
 * failure says so rather than reading like a network fault.
 */
function replies(...items) {
  const queue = [...items];
  return async () => {
    if (queue.length === 0) throw new Error('the fixture gave no reply for this call');
    const item = queue.shift();
    if (item.throws) throw new Error(item.throws);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ model: 'darrens-pick', choices: [{ message: { content: item } }] }),
    };
  };
}

/** One run, as a terminal saw it: every line, then a newline. */
async function printed(fixture) {
  const dir = await mkdtemp(join(tmpdir(), 'overseer-judge-golden-'));
  try {
    const store = storeOver(fixture.entries);
    // The real ledger, seeded by counting failures, so the parked path is the one
    // the command will actually take rather than a stand-in for it.
    const ledger = createLedger(join(dir, 'attempts.json'));
    for (const [seq, fails] of Object.entries(fixture.parked ?? {})) {
      for (let i = 0; i < fails; i += 1) await ledger.noteFailure(Number(seq), 'unreadable', WHEN);
    }

    const lines = [];
    const original = console.log;
    console.log = (...values) => lines.push(values.map(String).join(' '));
    let code;
    try {
      code = await judgeCommand({
        args: fixture.args ?? [],
        env: fixture.env ?? READY,
        store,
        ledger,
        fetchImpl: replies(...(fixture.replies ?? [])),
      });
    } finally {
      console.log = original;
    }
    return { text: `${lines.join('\n')}\n`, code, written: store.written };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The runs that are pinned: one per branch of the report — a judgment, a question
 * with and without a subject, a refused wording with and without one, an unreadable
 * reply, a call that never arrived, an empty queue, a park on its own and beside
 * work, a retry of parked moves, a cap, a pick, and the ways a run stops before it
 * judges anything. `parked` is how many failed attempts each seq has had.
 */
const FIXTURES = [
  { name: 'judgment-written', entries: [fact(1, 'say ready', ['Ada Okafor']), fact(2, 'name three colours', ['Ada Okafor'])], replies: [SHOWN, SHOWN], code: 0 },
  { name: 'question-for-a-missing-basis', entries: [fact(1, 'say ready', ['Ada Okafor'])], replies: [NOT_SHOWN], code: 0 },
  { name: 'question-that-names-no-subject', entries: [fact(1, 'say ready')], replies: [NOT_SHOWN], code: 0 },
  { name: 'wording-refused', entries: [fact(1, 'say ready', ['Ada Okafor'])], replies: [DIRECTING], code: 5 },
  { name: 'wording-refused-with-no-subject', entries: [fact(1, 'say ready')], replies: [DIRECTING], code: 5 },
  { name: 'reply-unreadable', entries: [fact(1, 'say ready', ['Ada Okafor'])], replies: ['the move looks fine to me, eight out of ten'], code: 5 },
  { name: 'call-failed', entries: [fact(1, 'say ready', ['Ada Okafor'])], replies: [{ throws: 'the network was down' }], code: 4 },
  { name: 'nothing-to-judge', entries: [fact(1, 'say ready', ['Ada Okafor']), judgment(2, 1)], replies: [], code: 0 },
  { name: 'every-move-parked', entries: [fact(1, 'say ready', ['Ada Okafor']), fact(2, 'name three colours')], parked: { 1: 3, 2: 3 }, replies: [], code: 0 },
  { name: 'parked-beside-work', entries: THREE, parked: { 3: 4 }, replies: [SHOWN, SHOWN], code: 0 },
  { name: 'retrying-parked-moves', entries: THREE, parked: { 1: 3, 2: 3 }, args: ['--retry-parked'], replies: [SHOWN, NOT_SHOWN, SHOWN], code: 0 },
  { name: 'capped', entries: THREE, args: ['--limit', '1'], replies: [SHOWN], code: 0 },
  { name: 'one-named-move', entries: THREE, args: ['--move', '2'], replies: [SHOWN], code: 0 },
  { name: 'no-such-move', entries: [fact(1, 'say ready', ['Ada Okafor'])], args: ['--move', '9'], replies: [], code: 2 },
  { name: 'move-already-answered', entries: [fact(1, 'say ready', ['Ada Okafor']), judgment(2, 1)], args: ['--move', '1'], replies: [], code: 2 },
  { name: 'plug-not-ready', entries: [fact(1, 'say ready', ['Ada Okafor'])], env: {}, replies: [], code: 3 },
  { name: 'not-a-limit', entries: [fact(1, 'say ready', ['Ada Okafor'])], args: ['--limit', 'zero'], replies: [], code: 2 },
  { name: 'limit-given-nothing', entries: [fact(1, 'say ready', ['Ada Okafor'])], args: ['--limit'], replies: [], code: 2 },
  { name: 'move-given-nothing', entries: [fact(1, 'say ready', ['Ada Okafor'])], args: ['--move'], replies: [], code: 2 },
  { name: 'two-ways-to-choose', entries: [fact(1, 'say ready', ['Ada Okafor'])], args: ['--move', '1', '--limit', '1'], replies: [], code: 2 },
];

test('every fixed run prints exactly the report that was blessed, and exits the same way', async () => {
  const seen = [];

  for (const fixture of FIXTURES) {
    const { text, code } = await printed(fixture);
    const blessed = await goldenText({ dir: GOLDENS, extension: 'txt', name: fixture.name, text, write: WRITE, script: SCRIPT });

    if (blessed !== null) {
      assert.equal(text, blessed, firstDifference({ name: fixture.name, blessed, printed: text, noun: 'run', script: SCRIPT, glob: 'test/fixtures/judge/*.txt' }));
      assert.equal(
        code,
        fixture.code,
        `"${fixture.name}" exited ${code}; the pinned run exits ${fixture.code} — an exit code is part of what a run reports`,
      );
    }
    seen.push(fixture.name);
  }

  assert.equal(seen.length, FIXTURES.length, 'every fixture was run');
  if (WRITE) console.log(`blessed ${seen.length} runs: ${seen.join(', ')}`);
});

test('the blessed runs are exactly the fixtures, with none left behind', async () => {
  await assertInventory({
    dir: GOLDENS,
    extension: 'txt',
    names: FIXTURES.map((fixture) => fixture.name),
    validate: (file, text) => {
      assert.equal(text.endsWith('\n'), true, `${file} ends with a newline, as the terminal saw it`);
      assert.match(text, /^\n[^\n]+\n-+\n/, `${file} is a whole run, from a heading`);
    },
  });
});

test('what a run says it wrote is what it wrote, filing included', async () => {
  for (const fixture of FIXTURES) {
    const { text, written } = await printed(fixture);

    // A usage or readiness refusal returns before the summary; nothing followed.
    if (!text.includes('What the record gained')) {
      assert.equal(written.length, 0, `"${fixture.name}" reported no summary, so it must have written nothing`);
      continue;
    }

    const counted = (label) => {
      const found = text.match(new RegExp(`\\n${label}:\\s+(\\d+)`));
      return found ? Number(found[1]) : NaN;
    };

    assert.equal(
      counted('judgments'),
      written.filter((entry) => entry.label === 'judgment').length,
      `"${fixture.name}" says how many judgments it wrote; the number and the appends have to agree`,
    );
    assert.equal(
      counted('questions'),
      written.filter((entry) => entry.label === 'question').length,
      `"${fixture.name}" says how many questions it wrote; the number and the appends have to agree`,
    );

    // A count is not the whole claim. "question written" also says whether the move
    // had a subject to file it under, and that is a fact about the entry, not the
    // sentence — so each question the run printed is held to the entry it wrote.
    // A judgment's line makes no claim about filing: its subjects are the move's.
    for (const line of text.split('\n')) {
      const found = line.match(/^seq (\d+)\s+(question written.*)$/);
      if (!found) continue;
      const seq = Number(found[1]);
      const said = found[2];
      const entry = written.find((candidate) => candidate.what?.move === seq);
      assert.ok(entry, `"${fixture.name}" reported seq ${seq} written, and wrote no entry naming it`);

      const unfiled = (entry.what.subjects ?? []).length === 0;
      assert.equal(
        said.includes('no subject'),
        unfiled,
        `"${fixture.name}" reports seq ${seq} as ${unfiled ? 'filed' : 'unfiled'}, but the entry it wrote says otherwise`,
      );
    }
  }
});

test('a run only claims the options it was given', async () => {
  for (const fixture of FIXTURES) {
    const { text } = await printed(fixture);
    const asked = (flag) => (fixture.args ?? []).includes(flag);

    // A parked move also makes a run shorter than its queue, and reporting that as
    // a cap would be a claim about how the run was asked for — a false one, with no
    // number in it. So the cap line belongs to a run that was given a cap.
    if (!asked('--limit')) {
      assert.equal(text.includes('capped:'), false, `"${fixture.name}" was given no cap, so it cannot report one`);
    }
    if (!asked('--move')) {
      assert.equal(text.includes('chosen:'), false, `"${fixture.name}" named no move, so it cannot report picking one`);
    }
  }
});

test('the command line prints the same report as the command, and passes its exit code through', async () => {
  // One byte-level check of the entry point, using the report the command already
  // pins: a dispatch that swallowed an argument or an exit code would print
  // something else here. The empty environment keeps it away from any key on this
  // machine, and this branch reads no record, so nothing is touched either way.
  const run = spawnSync(process.execPath, [join(ROOT, 'bin', 'overseer.js'), 'judge', '--limit'], {
    cwd: ROOT,
    env: {},
    encoding: 'utf8',
  });

  const blessed = await readFile(join(GOLDENS, 'limit-given-nothing.txt'), 'utf8');
  assert.equal(run.status, 2, 'the entry point passes the command\u2019s exit code through');
  assert.equal(run.stdout, blessed, 'the entry point prints the report the command prints');
});

test('nothing but the report decides these runs', async () => {
  // Running the same fixture twice has to give the same words, or a blessed run
  // would fail for a reason that has nothing to do with what it reports.
  for (const fixture of FIXTURES) {
    assert.equal((await printed(fixture)).text, (await printed(fixture)).text, `${fixture.name} prints the same twice`);
  }

  // The key value is in the fixture's environment on purpose: it must never reach
  // the report, and a pinned file is where a leak would become permanent.
  for (const fixture of FIXTURES) {
    assert.equal((await printed(fixture)).text.includes('baseten-secret'), false, `the key value stays out of "${fixture.name}"`);
  }
});
