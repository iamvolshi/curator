// The judge's run, pinned: a fixed record and fixed replies print the same words.
//
// judge.test.js and judge-options.test.js check properties — that a judgment names
// its move, that a cap is announced, that a refusal exits 5. This checks the whole
// terminal output of a run, because every property can still hold while the report
// quietly changes shape, and how a run reports itself is how a reader knows what it
// did: which move was judged, which was refused, which was parked, and whether a
// cap or a pick left work behind. A park in particular writes nothing to the
// record by design, so this output is the only place it is visible at all.
//
// A deliberate change to the report means re-blessing the fixtures:
//
//     node test/judge-golden.test.js --write
//     OVERSEER_WRITE_JUDGE_GOLDENS=1 npm test     (the same thing)
//
// Read the diff before committing it: that diff is the change to what a run says
// it did. The inputs are fixed — explicit entries, explicit replies, an explicit
// environment, an in-memory ledger — so two runs can differ only because the
// report changed, never because of the clock, a key on this machine, or what
// happens to be in this checkout's record file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { judgeCommand } from '../cli/judge.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDENS = join(HERE, 'fixtures', 'judge');

/** Writing is asked for outright, never inferred. */
const WRITE = process.argv.includes('--write') || Boolean(process.env.OVERSEER_WRITE_JUDGE_GOLDENS);

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

/** The ledger, in memory: counts a fixture can set, and nothing on disk. */
function ledgerOver(counts = {}) {
  const state = JSON.parse(JSON.stringify(counts));
  return {
    path: 'records/judge-attempts.json',
    readAll: async () => state,
    noteFailure: async (seq) => {
      const key = String(seq);
      state[key] = { fails: (state[key]?.fails ?? 0) + 1 };
      return state[key].fails;
    },
    clear: async (seq) => {
      delete state[String(seq)];
    },
    reset: async () => {
      for (const key of Object.keys(state)) delete state[key];
    },
  };
}

/**
 * The provider, as a queue of replies. A fixture gives exactly the replies its
 * run should consume; asking for one more throws, so a run that quietly makes an
 * extra call fails instead of being blessed with an empty answer.
 */
function replies(...items) {
  const queue = [...items];
  return async () => {
    if (queue.length === 0) throw new Error('the run asked for a reply the fixture did not give it');
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
  const store = storeOver(fixture.entries);
  const lines = [];
  const original = console.log;
  console.log = (...values) => lines.push(values.map(String).join(' '));
  let code;
  try {
    code = await judgeCommand({
      args: fixture.args ?? [],
      env: fixture.env ?? READY,
      store,
      ledger: ledgerOver(fixture.counts),
      fetchImpl: replies(...(fixture.replies ?? [])),
    });
  } finally {
    console.log = original;
  }
  return { text: `${lines.join('\n')}\n`, code, written: store.written };
}

/**
 * The runs that are pinned: one per branch of the report — a judgment, a question
 * with and without a subject, a refused wording with and without one, an unreadable
 * reply, a call that never arrived, an empty queue, a park on its own and beside
 * work, a cap, a pick, and the five ways a run stops before it judges anything.
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
  { name: 'every-move-parked', entries: [fact(1, 'say ready', ['Ada Okafor']), fact(2, 'name three colours')], counts: { 1: { fails: 3 }, 2: { fails: 3 } }, replies: [], code: 0 },
  { name: 'parked-beside-work', entries: THREE, counts: { 3: { fails: 4 } }, replies: [SHOWN, SHOWN], code: 0 },
  { name: 'capped', entries: THREE, args: ['--limit', '1'], replies: [SHOWN], code: 0 },
  { name: 'one-named-move', entries: THREE, args: ['--move', '2'], replies: [SHOWN], code: 0 },
  { name: 'no-such-move', entries: [fact(1, 'say ready', ['Ada Okafor'])], args: ['--move', '9'], replies: [], code: 2 },
  { name: 'move-already-answered', entries: [fact(1, 'say ready', ['Ada Okafor']), judgment(2, 1)], args: ['--move', '1'], replies: [], code: 2 },
  { name: 'plug-not-ready', entries: [fact(1, 'say ready', ['Ada Okafor'])], env: {}, replies: [], code: 3 },
  { name: 'not-a-limit', entries: [fact(1, 'say ready', ['Ada Okafor'])], args: ['--limit', 'zero'], replies: [], code: 2 },
  { name: 'two-ways-to-choose', entries: [fact(1, 'say ready', ['Ada Okafor'])], args: ['--move', '1', '--limit', '1'], replies: [], code: 2 },
];

/** A line as a failure can show it, so a long detail does not bury the point. */
function show(line) {
  if (line === undefined) return '(the output ends here)';
  const text = String(line);
  return text.length > 120 ? `${text.slice(0, 119)}\u2026` : text;
}

/**
 * Where two outputs part company, as a sentence.
 * Comparing whole runs says only that something moved; the line turns that into a
 * reason a reader can act on.
 */
function firstDifference(name, blessed, printed_) {
  // A checkout that rewrote the fixture's line endings is not a change to the
  // report, and reporting it as one would send the reader to the wrong file.
  if (blessed.includes('\r\n') && !printed_.includes('\r\n')) {
    return [
      `the blessed run for "${name}" was checked out with Windows line endings, so nothing can match it:`,
      '  these files are compared byte for byte, so git has to check them out as stored.',
      '  .gitattributes keeps that true; get the file again with:',
      '    rm test/fixtures/judge/*.txt && git checkout -- test/fixtures/judge',
    ].join('\n');
  }

  const before = blessed.split('\n');
  const after = printed_.split('\n');
  const at = before.findIndex((line, i) => line !== after[i]);
  const where =
    at === -1
      ? `the lines agree up to line ${Math.min(before.length, after.length)}, where one run ends and the other does not (blessed ${before.length} lines, printed ${after.length})`
      : `first difference at line ${at + 1}\n    blessed: ${show(before[at])}\n    printed: ${show(after[at])}`;

  return [
    `the run for "${name}" is no longer what was blessed:`,
    `  ${where}`,
    'If the report changed on purpose, re-bless it and read the diff:',
    '    node test/judge-golden.test.js --write',
  ].join('\n');
}

test('every fixed run prints exactly the report that was blessed, and exits the same way', async () => {
  const seen = [];

  for (const fixture of FIXTURES) {
    const { text, code } = await printed(fixture);
    const path = join(GOLDENS, `${fixture.name}.txt`);

    if (WRITE) {
      await mkdir(GOLDENS, { recursive: true });
      await writeFile(path, text, 'utf8');
      seen.push(`${fixture.name} (blessed)`);
      continue;
    }

    let blessed;
    try {
      blessed = await readFile(path, 'utf8');
    } catch {
      assert.fail(`no blessed run for "${fixture.name}" at test/fixtures/judge/${fixture.name}.txt; create it with: node test/judge-golden.test.js --write`);
    }

    assert.equal(text, blessed, firstDifference(fixture.name, blessed, text));
    assert.equal(
      code,
      fixture.code,
      `"${fixture.name}" exited ${code}; the pinned run exits ${fixture.code} — an exit code is part of what a run reports`,
    );
    seen.push(fixture.name);
  }

  assert.equal(seen.length, FIXTURES.length, 'every fixture was run');
  if (WRITE) console.log(`blessed ${seen.length} runs: ${seen.join(', ')}`);
});

test('the blessed runs are exactly the fixtures, with none left behind', async () => {
  const files = (await readdir(GOLDENS)).filter((file) => file.endsWith('.txt')).sort();

  assert.deepEqual(
    files,
    FIXTURES.map((fixture) => `${fixture.name}.txt`).sort(),
    'a run with no fixture, or a fixture with no run, means the set and the files have drifted apart',
  );
  assert.equal(new Set(FIXTURES.map((fixture) => fixture.name)).size, FIXTURES.length, 'one run per name');

  for (const fixture of FIXTURES) {
    const text = await readFile(join(GOLDENS, `${fixture.name}.txt`), 'utf8');
    assert.equal(text.endsWith('\n'), true, `${fixture.name}.txt ends with a newline, as the terminal saw it`);
    assert.match(text, /^\n[^\n]+\n-+\n/, `${fixture.name}.txt is a whole run, from a heading`);
    // A run that got as far as the record says whose judge it is. One refused for
    // how it was asked names that instead, and must not pretend to be a run.
    if ([0, 4, 5].includes(fixture.code)) {
      assert.match(text, /^\nOverseer \u2014 the judge \(baseten\)\n-+\n/, `${fixture.name}.txt reports from the judge itself`);
    }
  }
});

test('what a run says it wrote is what it wrote, and a run that stops early writes nothing', async () => {
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
  }
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
