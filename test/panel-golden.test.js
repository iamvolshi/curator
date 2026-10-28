// The panel's run, pinned: a fixed record and fixed replies print the same words.
//
// panel.test.js and panel-seats.test.js check properties — that a seat's judgment
// carries the ID the response named, that a failed seat is filled from the bank,
// that the readout declares a probable and keeps the dissent. This checks the whole
// terminal output of a run, and the exit code it ends on, because every property can
// still hold while the report quietly changes shape, and how a run reports itself is
// how a reader knows what it did.
//
// The readout is the case that needs this most: it is the product's whole output,
// and it is built from the record after the run. A fixture here pins what the three
// seats added up to — unanimous, 2-1, 1-1-1, a fill from the bank, an ID missing —
// as printed, not as summarised by the run that produced it.
//
// A deliberate change to the report means re-blessing the fixtures:
//
//     node test/panel-golden.test.js --write
//     OVERSEER_WRITE_PANEL_GOLDENS=1 npm test    (the same thing)
//
// Read the diff before committing it: that diff is the change to what a run says it
// did. The inputs are fixed — explicit entries, explicit replies, an explicit
// environment — so two runs can differ only because the report changed, never
// because of the clock, a key on this machine, or what happens to be in this
// checkout's record file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertInventory, firstDifference, goldenText, writeRequested } from '../checks/golden.js';
import { panelCommand } from '../cli/panel.js';
import { SEAT_WORDS } from '../cli/panel-report.js';
import { SEAT_STATES } from '../judge/panel.js';
import { DIRECTING, NOT_SHOWN, OTHER, SAME, THIRD, fact } from '../checks/panel-fixtures.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDENS = join(HERE, 'fixtures', 'panel');
const SCRIPT = 'node test/panel-golden.test.js --write';

/** Writing is asked for outright, never inferred. */
const WRITE = writeRequested('OVERSEER_WRITE_PANEL_GOLDENS');

const WHEN = '2026-10-27T09:00:00.000Z';

/** What the run prints is the file it read: pinned, so it cannot be this machine's path. */
const FILE_NAME = 'records/k-record.jsonl';

/**
 * A seated panel: Muse in the main seat, two free models beside it, and one plug in
 * the bank. The bank's model is deliberately not either seat's.
 */
const SEATED = {
  MODEL_API_KEY: 'LLM_test_key',
  NVIDIA_API_KEY: 'nvapi-test-key',
  NVIDIA_MODEL: 'free-fill',
  PANEL_SEAT2_MODEL: 'free-a',
  PANEL_SEAT3_MODEL: 'free-b',
  PANEL_BANK: 'nvidia',
};

/** One judgment already in the record: the move it names is answered. */
function judgment(seq, move, seat = 1) {
  return {
    seq,
    when: WHEN,
    label: 'judgment',
    what: {
      kind: 'judgment',
      move,
      subjects: ['Ada Okafor'],
      seat,
      model: `a-model-${seat}`,
      observation: 'the reply supports the claim about Ada',
    },
  };
}

/** A store over the fixed entries; `written` is what the run appended. */
function storeOver(entries) {
  const all = [...entries];
  const written = [];
  return {
    path: FILE_NAME,
    readAll: async () => [...all],
    append: async (entry) => {
      const stored = { seq: all.length + 1, ...entry };
      all.push(stored);
      written.push(stored);
      return stored;
    },
    written,
  };
}

/**
 * The provider, as a queue of replies, in the order the seats ask.
 *
 * A fixture gives exactly the replies its run should consume; asking for one more is
 * a fixture that is out of answers, and the failure it raises says so rather than
 * reading like a network fault. A response names the model it answered as unless the
 * item says to leave the field out, which is the only way to produce an ID-missing
 * judgment.
 */
function replies(...items) {
  const queue = [...items];
  return async (url, options) => {
    const body = JSON.parse(options.body);

    // The MMRC consolidation call is not a seat. It is answered the way the real
    // consolidator is asked to answer: the grouping it was given, handed back unchanged
    // as JSON, and it does not take a reply from the queue.
    if (body.messages?.[0]?.content?.startsWith('You are the MMRC consolidator')) {
      const form = JSON.parse(body.messages[1].content);
      const handed = { opinions: form.opinions, highest_probable: form.highest_probable, questions: form.questions };
      const served = { model: body.model, choices: [{ message: { content: JSON.stringify(handed) } }] };
      return { ok: true, status: 200, text: async () => JSON.stringify(served) };
    }

    if (queue.length === 0) throw new Error('the fixture gave no reply for this call');
    const item = queue.shift();
    if (item.throws) throw new Error(item.throws);

    const text = typeof item === 'string' ? item : item.text;
    const served = { choices: [{ message: { content: text } }] };
    if (item.omitModel !== true) served.model = item.answeredAs ?? JSON.parse(options.body).model;
    return { ok: true, status: 200, text: async () => JSON.stringify(served) };
  };
}

/** A store that refuses to be read or written: for the runs that must not touch it. */
const UNTOUCHED = {
  path: FILE_NAME,
  readAll: async () => {
    throw new Error('the record must not be read');
  },
  append: async () => {
    throw new Error('nothing may be written');
  },
};

/** One run, as a terminal saw it: every line, then a newline. */
async function printed(fixture) {
  const store = fixture.untouched ? UNTOUCHED : storeOver(fixture.entries ?? []);
  const lines = [];
  const original = console.log;
  console.log = (...values) => lines.push(values.map(String).join(' '));
  let code;
  try {
    code = await panelCommand({
      args: fixture.args ?? [],
      env: fixture.env ?? SEATED,
      store,
      now: () => new Date(WHEN),
      fetchImpl: replies(...(fixture.replies ?? [])),
    });
  } finally {
    console.log = original;
  }
  return { text: `${lines.join('\n')}\n`, code, written: store.written ?? [] };
}

/**
 * The runs that are pinned: the four shapes a panel can come to, the two ways a
 * reading can be unusable, a fill from the bank, the ways the bank cannot fill, and
 * the ways a run stops before it seats anything. `env` overrides the seated panel;
 * `untouched` marks a run that must not read or write the record at all.
 */
const FIXTURES = [
  { name: 'unanimous', entries: [fact(1)], replies: [SAME, SAME, SAME], code: 0 },
  { name: 'two-one', entries: [fact(1)], replies: [SAME, SAME, OTHER], code: 0 },
  { name: 'one-one-one', entries: [fact(1)], replies: [SAME, OTHER, THIRD], code: 0 },
  { name: 'one-seat-asks-for-a-basis', entries: [fact(1)], replies: [SAME, SAME, NOT_SHOWN], code: 0 },
  {
    name: 'two-seats-name-no-model',
    entries: [fact(1)],
    replies: [SAME, { text: OTHER, omitModel: true }, { text: OTHER, omitModel: true }],
    code: 0,
  },
  {
    name: 'the-id-from-the-response',
    entries: [fact(1)],
    replies: [{ text: SAME, answeredAs: 'muse-spark-1.3-preview' }, SAME, OTHER],
    code: 0,
  },
  {
    name: 'replaced-from-the-bank',
    entries: [fact(1)],
    replies: [SAME, SAME, { throws: 'the connection was refused' }, OTHER],
    code: 0,
  },
  {
    name: 'a-reading-that-directs',
    entries: [fact(1)],
    replies: [SAME, SAME, DIRECTING, OTHER],
    code: 0,
  },
  {
    name: 'a-reply-that-cannot-be-read',
    entries: [fact(1)],
    replies: [SAME, SAME, 'the move looks fine to me, eight out of ten', THIRD],
    code: 0,
  },
  {
    name: 'bank-cannot-fill-a-failed-seat',
    entries: [fact(1)],
    env: { ...SEATED, NVIDIA_MODEL: 'free-b' },
    replies: [SAME, SAME, { throws: 'the connection was refused' }],
    code: 4,
  },
  {
    name: 'bank-cannot-fill-a-directed-seat',
    entries: [fact(1)],
    env: { ...SEATED, NVIDIA_MODEL: 'free-b' },
    replies: [SAME, SAME, DIRECTING],
    code: 5,
  },
  {
    name: 'moves-judged-before-a-stop-stay',
    entries: [fact(1), fact(2, 'name three colours')],
    // The bank's plug is asked too, and it fails as well: that attempt is a call the
    // report counts, so the fixture has to have an answer for it.
    replies: [SAME, SAME, OTHER, SAME, SAME, { throws: 'the connection was refused' }, { throws: 'the connection was refused' }],
    code: 4,
  },
  {
    // A move the panel has already read: three seats, one entry each, as a panel run
    // writes them. The readout counts against THESE seats, so the fixture has to hold
    // the record a panel would actually have left behind.
    name: 'nothing-left-to-seat',
    entries: [fact(1), judgment(2, 1, 1), judgment(3, 1, 2), judgment(4, 1, 3)],
    replies: [],
    code: 0,
  },
  { name: 'capped', entries: [fact(1), fact(2, 'name three colours')], args: ['--limit', '1'], replies: [SAME, SAME, SAME], code: 0 },
  { name: 'one-named-move', entries: [fact(1), fact(2, 'name three colours')], args: ['--move', '2'], replies: [SAME, SAME, SAME], code: 0 },
  { name: 'no-such-move', entries: [fact(1)], args: ['--move', '9'], replies: [], code: 2 },
  { name: 'not-a-limit', entries: [fact(1)], args: ['--limit', 'zero'], replies: [], code: 2 },
  { name: 'not-a-panel-option', args: ['--retry-parked'], untouched: true, replies: [], code: 2 },
  {
    // Seat 3 has no model of its own, and the plug that serves it has none either:
    // a seat whose plug could seat it is seated, so both have to be empty.
    name: 'an-unseated-panel',
    env: { ...SEATED, NVIDIA_MODEL: '', PANEL_SEAT3_MODEL: '' },
    untouched: true,
    replies: [],
    code: 3,
  },
  {
    name: 'a-bank-that-is-not-a-plug',
    env: { ...SEATED, PANEL_BANK: 'nvidia,florida' },
    untouched: true,
    replies: [],
    code: 3,
  },
];

test('every fixed run prints exactly the report that was blessed, and exits the same way', async () => {
  await mkdir(GOLDENS, { recursive: true });
  const seen = [];

  for (const fixture of FIXTURES) {
    const { text, code } = await printed(fixture);
    const blessed = await goldenText({ dir: GOLDENS, extension: 'txt', name: fixture.name, text, write: WRITE, script: SCRIPT });

    if (blessed !== null) {
      assert.equal(text, blessed, firstDifference({ name: fixture.name, blessed, printed: text, noun: 'run', script: SCRIPT, dir: GOLDENS, extension: 'txt' }));
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

test('what a run says it wrote is what it wrote', async () => {
  for (const fixture of FIXTURES) {
    const { text, written } = await printed(fixture);

    // A usage or seating refusal returns before the summary; nothing followed, and
    // saying nothing about what was written is the whole report for those.
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
    assert.equal(
      counted('calls'),
      fixture.untouched ? 0 : (fixture.replies ?? []).length,
      `"${fixture.name}" says how many calls it made; that is the replies it was given and no more`,
    );

    // Every seat the run reported is in the record, and no seat it did not report is.
    const reported = [...text.matchAll(/^seat (\d+)\s+(judgment|question|nothing) written/gm)].map((found) => Number(found[1]));
    assert.deepEqual(
      reported.sort(),
      written.filter((entry) => entry.label === 'judgment' || entry.label === 'question').map((entry) => entry.what.seat).sort(),
      `"${fixture.name}" reports exactly the seats it wrote, and writes exactly the seats it reports`,
    );
  }
});

test('every state a seat can come to has words in the report', () => {
  // The report's table is keyed by the panel's own states, so a state added to one
  // side without the other would print as a bare identifier instead of a sentence.
  for (const state of Object.values(SEAT_STATES)) {
    assert.equal(typeof SEAT_WORDS[state], 'string', `the report has no words for the state "${state}"`);
    assert.notEqual(SEAT_WORDS[state].trim(), '', `the words for "${state}" are empty`);
  }

  assert.deepEqual(
    Object.keys(SEAT_WORDS).sort(),
    Object.values(SEAT_STATES).sort(),
    'the report speaks for exactly the states a seat can come to',
  );
});

test('a directive the record refused is never written to the record', async () => {
  // A seat whose reading directs the agent produced nothing writable, so the words
  // do not go in the record — that is what makes the refusal a refusal. The report
  // does quote the phrase that made it direct, in the run's own words ("the wording
  // directed: …"), exactly as the judge's report does: the reason a reading was
  // refused belongs in the report of the run, not in the record it was kept out of.
  for (const fixture of FIXTURES) {
    const { written } = await printed(fixture);
    assert.equal(JSON.stringify(written).includes('you should'), false, `"${fixture.name}" writes no directive`);
  }
});

test('nothing but the report decides these runs', async () => {
  // Running the same fixture twice has to give the same words, or a blessed run
  // would fail for a reason that has nothing to do with what it reports.
  for (const fixture of FIXTURES) {
    const { text, code } = await printed(fixture);
    const again = await printed(fixture);
    assert.equal(again.text, text, `${fixture.name} prints the same twice`);
    assert.equal(again.code, code, `${fixture.name} exits the same twice`);
  }

  // The key values are in the fixtures' environment on purpose: they must never
  // reach the report, and a pinned file is where a leak would become permanent.
  for (const fixture of FIXTURES) {
    const { text } = await printed(fixture);
    assert.equal(text.includes('LLM_test_key'), false, `the main seat's key stays out of "${fixture.name}"`);
    assert.equal(text.includes('nvapi-test-key'), false, `the free seat's key stays out of "${fixture.name}"`);
  }
});

// Last, because it is the check on the whole set: a blessing writes files as it
// goes, and asking the set what it should contain before the last writer has run
// would report a fixture as missing in the very run that is about to create it.
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
