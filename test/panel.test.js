// The judge panel: three seats, the ID that judged, the readout, and the bank.
//
// What these can check without a key and without a network: that every seat's
// reading is written as its own entry carrying the model ID the RESPONSE named,
// that an opinion with no ID counts as no independent support, that a panel whose
// seat fails is filled from the bank with the substitution labelled in the entry,
// that a panel that cannot be completed writes nothing for that move, and that the
// readout is a view of the record — probable and edge greys, nothing merged.
//
// What they cannot check: that any of these models judge well. That is a live
// question, and three calls to three real endpoints is the only thing that answers
// it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { panelCommand } from '../cli/panel.js';
import { reportPanelRun } from '../cli/panel-report.js';
import { buildPage } from '../cli/view.js';
import { judgePanel } from '../judge/panel.js';
import { majorityFor, readPanel } from '../judge/readout.js';
import { panelConfig } from '../judge/seats.js';
import { createStore } from '../record/store.js';
import { DIRECTING, NOT_SHOWN, OTHER, SAME, THIRD, fact, numbered } from '../checks/panel-fixtures.js';

const WHEN = '2026-10-27T09:00:00.000Z';

/** A panel someone has seated: Muse, and two free seats with their own models. */
const PANEL = {
  MODEL_API_KEY: 'LLM_test_key',
  NVIDIA_API_KEY: 'nvapi-test',
  PANEL_SEAT2_MODEL: 'free-a',
  PANEL_SEAT3_MODEL: 'free-b',
  PANEL_BANK: '',
};

/**
 * Seats answer by the model they were asked for.
 *
 * A model the fixture does not know throws "the fixture gave no reply", so a run
 * that calls more than the fixture provided says so rather than looking like a
 * network fault. A model that is meant to fail has to say so itself.
 */
function seatReplies(byModel) {
  const asked = [];
  const consolidated = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    const model = body.model;

    // The MMRC consolidation call is not a seat. It is answered the way the real
    // consolidator is asked to answer: the grouping it was given, handed back
    // unchanged as JSON. Kept apart from `asked` so the seat assertions stay about seats.
    if (body.messages?.[0]?.content?.startsWith('You are the MMRC consolidator')) {
      consolidated.push(model);
      const form = JSON.parse(body.messages[1].content);
      const handed = { opinions: form.opinions, highest_probable: form.highest_probable, questions: form.questions };
      const served = { model, choices: [{ message: { content: JSON.stringify(handed) } }] };
      return { ok: true, status: 200, text: async () => JSON.stringify(served) };
    }

    asked.push(model);
    const reply = byModel[model];
    if (reply === undefined) throw new Error(`the fixture gave no reply for ${model}`);
    if (reply.fail) throw new Error(reply.fail);

    const served = { choices: [{ message: { content: reply.text ?? reply } }] };
    // A response that names a model names it here; one that names none leaves the
    // field out entirely, which is what the ID-missing path is about.
    if (reply.omitModel !== true) served.model = reply.answeredAs ?? model;
    return { ok: true, status: 200, text: async () => JSON.stringify(served) };
  };
  fetchImpl.asked = asked;
  fetchImpl.consolidated = consolidated;
  return fetchImpl;
}

async function withStore(fn, entries = []) {
  const dir = await mkdtemp(join(tmpdir(), 'overseer-panel-'));
  const path = join(dir, 'records.jsonl');
  if (entries.length) await writeFile(path, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
  try {
    return await fn(createStore(path), path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A command run, with its report captured instead of printed. */
async function run(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...values) => lines.push(values.map(String).join(' '));
  try {
    const code = await fn();
    return { text: `${lines.join('\n')}\n`, code };
  } finally {
    console.log = original;
  }
}

test('every seat writes its own judgment, carrying the ID the response named', async () => {
  await withStore(async (store) => {
    await store.append(fact(1));
    const fetchImpl = seatReplies({ 'muse-spark-1.3': SAME, 'free-a': SAME, 'free-b': OTHER });

    const result = await judgePanel({
      entries: await store.readAll(),
      env: PANEL,
      store,
      fetchImpl,
      now: () => new Date(WHEN),
    });

    assert.deepEqual(fetchImpl.asked, ['muse-spark-1.3', 'free-a', 'free-b'], 'one call per seat, in seat order');
    assert.equal(result.written.judgments, 3, 'three seats, three entries — never one merged opinion');

    const judgments = (await store.readAll()).filter((entry) => entry.label === 'judgment');
    assert.deepEqual(judgments.map((entry) => entry.what.seat), [1, 2, 3]);
    assert.deepEqual(judgments.map((entry) => entry.what.model), ['muse-spark-1.3', 'free-a', 'free-b']);
    assert.deepEqual(
      judgments.map((entry) => entry.what.observation),
      ['the reply supports the claim about Ada', 'the reply supports the claim about Ada', 'the reply restates the prompt without evidence'],
      'each seat\u2019s reading is what that seat said',
    );
  });
});

test('the ID recorded is the one the response named, so a substitution is caught and not hidden', async () => {
  await withStore(async (store) => {
    await store.append(fact(1));

    const result = await judgePanel({
      entries: await store.readAll(),
      env: PANEL,
      store,
      now: () => new Date(WHEN),
      fetchImpl: seatReplies({
        'muse-spark-1.3': { text: SAME, answeredAs: 'muse-spark-1.3-preview' },
        'free-a': SAME,
        'free-b': OTHER,
      }),
    });

    const first = (await store.readAll()).filter((entry) => entry.label === 'judgment')[0];
    assert.equal(first.what.model, 'muse-spark-1.3-preview', 'the ID from the response, not the one asked for');
    assert.equal(first.what.modelIdMissing, undefined);
    assert.equal(result.outcomes[0].seats[0].model, 'muse-spark-1.3-preview');
  });
});

test('a response that names no model writes the judgment flagged, and counts as no independent judge', async () => {
  await withStore(async (store) => {
    await store.append(fact(1));

    await judgePanel({
      entries: await store.readAll(),
      env: PANEL,
      store,
      now: () => new Date(WHEN),
      fetchImpl: seatReplies({
        'muse-spark-1.3': SAME,
        // The two free seats agree with each other but neither names a model, so
        // two seats holding one opinion is still zero independent agreement.
        'free-a': { text: OTHER, omitModel: true },
        'free-b': { text: OTHER, omitModel: true },
      }),
    });

    const entries = await store.readAll();
    const missing = entries.filter((entry) => entry.what.modelIdMissing === true);
    assert.equal(missing.length, 2, 'both unnamed judges are written, with the ID marked missing');
    assert.deepEqual(missing.map((entry) => entry.what.model), [null, null]);

    const readout = readPanel(entries);
    const move = readout.moves[0];
    assert.equal(move.probable, null, 'no opinion reached a majority of independent judges');
    assert.deepEqual(
      move.edgeGreys.map((opinion) => [opinion.judges, opinion.support]),
      [
        [1, 1],
        [2, 0],
      ],
      'the two agreeing seats are surfaced, and their support is counted as nothing',
    );
  });
});

test('the readout declares the probable opinion and keeps the dissent as an edge grey', async () => {
  await withStore(async (store) => {
    await store.append(fact(1));

    await judgePanel({
      entries: await store.readAll(),
      env: PANEL,
      store,
      now: () => new Date(WHEN),
      fetchImpl: seatReplies({ 'muse-spark-1.3': SAME, 'free-a': SAME, 'free-b': OTHER }),
    });

    const readout = readPanel(await store.readAll());
    const [move] = readout.moves;

    assert.equal(majorityFor(3), 2, 'a majority of three seats is two');
    assert.equal(move.probable.text, 'the reply supports the claim about Ada');
    assert.equal(move.probable.support, 2, 'two independent judges, by ID');
    assert.deepEqual(move.probable.ids, ['muse-spark-1.3', 'free-a']);
    assert.deepEqual(move.probable.seats, [1, 2]);
    assert.equal(move.edgeGreys.length, 1, 'the minority is surfaced, never averaged away');
    assert.equal(move.edgeGreys[0].text, 'the reply restates the prompt without evidence');
    assert.deepEqual(move.edgeGreys[0].ids, ['free-b']);
  });
});

test('a unanimous panel has a probable and no edge grey, and a split panel declares nothing', async () => {
  await withStore(async (store) => {
    await store.append(fact(1));

    await judgePanel({
      entries: await store.readAll(),
      env: PANEL,
      store,
      now: () => new Date(WHEN),
      fetchImpl: seatReplies({ 'muse-spark-1.3': SAME, 'free-a': SAME, 'free-b': SAME }),
    });

    const unanimous = readPanel(await store.readAll()).moves[0];
    assert.equal(unanimous.probable.support, 3);
    assert.deepEqual(unanimous.edgeGreys, [], 'nobody dissented, so there is no grey to surface');
  });

  await withStore(async (store) => {
    await store.append(fact(1));

    await judgePanel({
      entries: await store.readAll(),
      env: PANEL,
      store,
      now: () => new Date(WHEN),
      fetchImpl: seatReplies({ 'muse-spark-1.3': SAME, 'free-a': OTHER, 'free-b': THIRD }),
    });

    const split = readPanel(await store.readAll()).moves[0];
    assert.equal(split.probable, null, 'no majority: nothing is declared probable');
    assert.equal(split.edgeGreys.length, 3, 'all three readings are surfaced');
    assert.deepEqual(split.edgeGreys.map((opinion) => opinion.support), [1, 1, 1]);
  });
});

test('a seat that saw no basis asks a question, and the readout says it took no position', async () => {
  await withStore(async (store) => {
    await store.append(fact(1));

    await judgePanel({
      entries: await store.readAll(),
      env: PANEL,
      store,
      now: () => new Date(WHEN),
      fetchImpl: seatReplies({ 'muse-spark-1.3': SAME, 'free-a': SAME, 'free-b': NOT_SHOWN }),
    });

    const entries = await store.readAll();
    const asked = entries.filter((entry) => entry.label === 'question');
    assert.equal(asked.length, 1);
    assert.equal(asked[0].what.seat, 3, 'the question says which seat asked');
    assert.equal(asked[0].what.model, 'free-b');
    assert.equal(asked[0].what.question, 'what in the record supports this claim?');

    const [move] = readPanel(entries).moves;
    assert.deepEqual(move.noPosition, [3], 'a seat that asked took no position, and is reported as such');
    assert.equal(move.probable.support, 2, 'the two opinions still work out their own readout');
  });
});

test('a reading that directs is never written, and the seat is filled instead', async () => {
  await withStore(async (store) => {
    await store.append(fact(1));
    const env = { ...PANEL, NVIDIA_MODEL: 'free-c', PANEL_BANK: 'nvidia' };

    const fetchImpl = seatReplies({ 'muse-spark-1.3': SAME, 'free-a': SAME, 'free-b': DIRECTING, 'free-c': SAME });
    const result = await judgePanel({ entries: await store.readAll(), env, store, fetchImpl, now: () => new Date(WHEN) });

    const record = await store.readAll();
    const text = JSON.stringify(record);
    assert.doesNotMatch(text, /you should/i, 'the model\u2019s directive is not in the record');
    assert.equal(record.filter((entry) => entry.label === 'judgment').length, 3, 'the seat was filled, so the panel is whole');

    const filled = record.filter((entry) => entry.what.substitution)[0];
    assert.equal(filled.what.seat, 3);
    assert.equal(filled.what.model, 'free-c', 'the filling judge\u2019s own ID');
    assert.deepEqual(filled.what.substitution, {
      seat: 3,
      departed: 'free-b',
      departedReason: 'the reading directed the agent, so it was refused',
      plug: 'nvidia',
      filledBy: 'free-c',
    });
    assert.equal(result.written.judgments, 3);
  });
});

test('a directed question is refused too, not only a directed observation', async () => {
  await withStore(async (store) => {
    await store.append(fact(1));
    const env = { ...PANEL, NVIDIA_MODEL: 'free-c', PANEL_BANK: 'nvidia' };

    // Basis not shown, so the seat asks; the question itself tells the agent what to do.
    const directedQuestion = numbered('the reply makes no claim', 'not shown', 'none', 'you should add a timing log next?');
    const fetchImpl = seatReplies({ 'muse-spark-1.3': SAME, 'free-a': SAME, 'free-b': directedQuestion, 'free-c': SAME });
    await judgePanel({ entries: await store.readAll(), env, store, fetchImpl, now: () => new Date(WHEN) });

    const record = await store.readAll();
    assert.doesNotMatch(JSON.stringify(record), /you should/i, 'the directed question is not in the record');
    const filled = record.filter((entry) => entry.what.substitution);
    assert.equal(filled.length, 1);
    assert.equal(filled[0].what.substitution.plug, 'nvidia');
    assert.match(filled[0].what.substitution.departedReason, /directed/);
  });
});

test('a seat whose call fails is filled from the bank, and the entry says who left and who filled it', async () => {
  await withStore(async (store) => {
    await store.append(fact(1));
    const env = { ...PANEL, NVIDIA_MODEL: 'free-c', PANEL_BANK: 'nvidia' };

    const fetchImpl = seatReplies({
      'muse-spark-1.3': SAME,
      'free-a': SAME,
      'free-b': { fail: 'the connection was refused' },
      'free-c': OTHER,
    });

    const result = await judgePanel({ entries: await store.readAll(), env, store, fetchImpl, now: () => new Date(WHEN) });

    const filled = (await store.readAll()).filter((entry) => entry.what.substitution);
    assert.equal(filled.length, 1);
    assert.equal(filled[0].what.seat, 3);
    assert.equal(filled[0].what.substitution.departed, 'free-b');
    assert.equal(filled[0].what.substitution.plug, 'nvidia');
    assert.equal(filled[0].what.substitution.filledBy, 'free-c', 'the ID the filling response named');
    assert.match(filled[0].what.substitution.departedReason, /the call did not work/);
    assert.equal(result.written.judgments, 3, 'the panel never silently drops to two');

    // The filler's opinion counts as independent support: it is a different judge.
    const [move] = readPanel(await store.readAll()).moves;
    assert.deepEqual(move.probable.ids, ['muse-spark-1.3', 'free-a']);
    assert.deepEqual(move.edgeGreys[0].ids, ['free-c']);
  });
});

test('a bank plug offering the same model as the seat cannot fill it', async () => {
  await withStore(async (store) => {
    await store.append(fact(1));
    // The bank's nvidia offers free-b: the model the seat already is. Filling with it
    // would record one judge twice and read as agreement.
    const env = { ...PANEL, NVIDIA_MODEL: 'free-b', PANEL_BANK: 'nvidia' };

    const { code, text } = await run(() =>
      panelCommand({
        args: [],
        env,
        store,
        now: () => new Date(WHEN),
        fetchImpl: seatReplies({ 'muse-spark-1.3': SAME, 'free-a': SAME, 'free-b': { fail: 'the connection was refused' } }),
      }),
    );

    assert.equal(code, 4, 'a seat that failed and could not be filled is a call that did not work');
    assert.match(text, /could not fill the seat/, 'the report says the bank could not fill it');
    assert.match(text, /the same model as the seat/, 'and why this plug could not');
    assert.deepEqual(await store.readAll(), (await store.readAll()).filter((entry) => entry.label === 'fact'), 'nothing was written for the move');
  });
});

test('a panel that cannot be completed writes nothing for that move, and stops there', async () => {
  await withStore(async (store) => {
    await store.append(fact(1));
    await store.append(fact(2, 'name three colours'));
    const env = { ...PANEL, NVIDIA_MODEL: 'free-c', PANEL_BANK: 'nvidia' };

    // The fixture answers the first move fully, then fails seat 3 and the plug the
    // bank would fill it with on the second.
    let calls = 0;
    const fetchImpl = async (url, options) => {
      calls += 1;
      const model = JSON.parse(options.body).model;
      if (calls > 4 && (model === 'free-b' || model === 'free-c')) throw new Error('the connection was refused');
      const content = model === 'free-b' ? OTHER : SAME;
      return { ok: true, status: 200, text: async () => JSON.stringify({ model, choices: [{ message: { content } }] }) };
    };

    const result = await judgePanel({ entries: await store.readAll(), env, store, fetchImpl, now: () => new Date(WHEN) });

    assert.equal(result.stopped.seq, 2, 'the run stopped at the move it could not seat');
    assert.equal(result.stopped.seat, 3);
    assert.match(result.stopped.skips[0].why, /the call did not work/, 'and says why the bank could not fill it');

    const record = await store.readAll();
    assert.equal(record.filter((entry) => entry.what?.move === 2).length, 0, 'nothing was written for the unseated move');
    assert.equal(record.filter((entry) => entry.label === 'judgment').length, 3, 'the move judged before it stays written');
  });
});

test('an unseated panel refuses before the record is read and before anything is sent', async () => {
  const never = {
    path: 'never-read.jsonl',
    append: async () => {
      throw new Error('nothing may be written');
    },
    readAll: async () => {
      throw new Error('the record must not be read for an unseated panel');
    },
  };

  const { code, text } = await run(() =>
    panelCommand({
      args: [],
      env: { ...PANEL, PANEL_SEAT3_MODEL: '' },
      store: never,
      fetchImpl: async () => {
        throw new Error('nothing may be sent');
      },
    }),
  );

  assert.equal(code, 3, 'a seat that is not seated is configuration, not a failed call');
  assert.match(text, /The panel is not seated/);
  assert.match(text, /seat 3/);
  assert.match(text, /PANEL_SEAT3_MODEL/);
});

test('--retry-parked is refused as a judge option, not quietly ignored', async () => {
  const { code, text } = await run(() => panelCommand({ args: ['--retry-parked'], env: PANEL }));

  assert.equal(code, 2);
  assert.match(text, /Not a panel option/);
  assert.match(text, /--retry-parked belongs to judge/);
});

test('the panel reads the contest prompt, and the single judge reads its own', async () => {
  const { JUDGE_SYSTEM, PANEL_SYSTEM, panelMessages } = await import('../judge/prompt.js');

  assert.match(PANEL_SYSTEM, /opinion contest/);
  assert.match(PANEL_SYSTEM, /cannot see the others/, 'a seat is told it is one of three, reading alone');

  // One output contract per seat: the numbered one. The judge's JSON shape never reaches a seat.
  assert.match(PANEL_SYSTEM, /Answer by number, in order/);
  assert.doesNotMatch(PANEL_SYSTEM, /Answer with JSON only/);
  assert.doesNotMatch(PANEL_SYSTEM, /in exactly this shape/);

  // The manner rule is the judge's own, and each of its two lines is sent to a seat once.
  const [system] = panelMessages({ what: {} });
  const manner = JUDGE_SYSTEM.split('\n').slice(-2);
  assert.equal(manner.length, 2);
  for (const line of manner) {
    assert.equal(system.content.split(line).length - 1, 1, `once, not twice: ${line.slice(0, 40)}\u2026`);
  }
  assert.equal(JUDGE_SYSTEM.includes('opinion contest'), false, 'the single judge is not told it is in a contest');
});

test('the panel seats what the record says is unjudged, and nothing else', async () => {
  await withStore(async (store) => {
    await store.append(fact(1));
    await store.append(fact(2, 'name three colours'));

    await judgePanel({
      entries: await store.readAll(),
      env: PANEL,
      store,
      now: () => new Date(WHEN),
      fetchImpl: seatReplies({ 'muse-spark-1.3': SAME, 'free-a': SAME, 'free-b': SAME }),
    });
    assert.equal((await store.readAll()).length, 10, 'two facts, three opinions each, and one delivery per move');

    // The second run has nothing left: both moves are named by three judgments.
    const fetchImpl = seatReplies({});
    const result = await judgePanel({ entries: await store.readAll(), env: PANEL, store, fetchImpl, now: () => new Date(WHEN) });
    assert.equal(result.candidates, 0);
    assert.deepEqual(fetchImpl.asked, [], 'no second panel for a move the record already answered');
  });
});

test('the seats are the configured ones, and the readout counts against the seats the record shows', () => {
  const config = panelConfig(PANEL);
  assert.equal(config.seats.length, 3);
  assert.deepEqual(config.bank, [], 'an empty bank is what this panel was configured with');
  assert.equal(majorityFor(3), 2);
  assert.equal(majorityFor(4), 3, 'more than half of four seats is three');
  assert.equal(majorityFor(1), 1);
});

/** One seat's reading, as the panel records it: the seat number is what makes it a seat's. */
function read(seq, move, seat, model, observation) {
  return {
    seq,
    when: WHEN,
    label: 'judgment',
    what: { kind: 'judgment', move, subjects: [], seat, model, observation },
  };
}

/** A seat's judgment carrying the numbered basis a stored delivery is matched by. */
function seated(seq, seat, model, pool, observation) {
  return {
    seq,
    when: WHEN,
    label: 'judgment',
    what: {
      kind: 'seat-judgment',
      move: 1,
      subjects: [],
      seat,
      model,
      observation,
      numbered: { deed: 'the move', pool, basis: 'shown', topics: [], sitting: 'none' },
    },
  };
}

/** One stored delivery for move 1: two opinions, neither reaching a majority. */
function delivery(seq) {
  return {
    seq,
    when: WHEN,
    label: 'delivery',
    what: {
      kind: 'delivery',
      move: 1,
      mmrc_model_id: 'model-m',
      seats: ['model-a', 'model-b'],
      opinions: [
        { position: 'justified', basis: [1], support_count: 1, supporting_models: ['model-a'], status: 'gray_box' },
        { position: 'justified', basis: [2], support_count: 1, supporting_models: ['model-b'], status: 'gray_box' },
      ],
      highest_probable: null,
      questions: [],
      derived: true,
    },
  };
}

test('a consolidated move reads out its delivery, and its gray box is labelled as one', () => {
  const entries = [
    fact(1),
    seated(2, 1, 'model-a', 'entry 1', 'the reply supports the claim'),
    seated(3, 2, 'model-b', 'entry 2', 'the reply restates the prompt'),
    delivery(4),
  ];
  const readout = readPanel(entries);

  assert.equal(readout.moves[0].probable, null, 'no opinion reached a majority');
  assert.deepEqual(readout.moves[0].edgeGreys.map((opinion) => opinion.text), [
    'the reply supports the claim',
    'the reply restates the prompt',
  ]);
  assert.deepEqual(readout.moves[0].edgeGreys.map((opinion) => opinion.status), ['gray_box', 'gray_box']);

  const printed = [];
  const original = console.log;
  console.log = (...args) => printed.push(args.join(' '));
  try {
    reportPanelRun(
      { refused: null, problem: null, waiting: 0, candidates: 0, outcomes: [], attempts: [], written: { judgments: 0, questions: 0 }, stopped: null, seats: [1, 2, 3] },
      { readout },
    );
  } finally {
    console.log = original;
  }

  assert.match(printed.join('\n'), /gray box:\s+"the reply supports the claim"/, 'non-convergence is the gray box, not a dissent');
  assert.doesNotMatch(printed.join('\n'), /edge grey:\s+"the reply supports the claim"/);
});

test('a stored opinion still finds its seats after a cited basis is read differently', () => {
  // The report recorded "entries 7\u20139" as the two numbers an older read made of it.
  // The span now reads as the three entries inside it, so matching on the basis alone
  // would find no seat, and the page would print an opinion with no text and nobody
  // behind it. The report cites its sources by model ID, which no parse can change.
  const entries = [
    fact(1),
    seated(2, 1, 'model-a', 'entries 7\u20139', 'the approval entry covers the deed'),
    seated(3, 2, 'model-b', 'entry 12', 'a dissent from another basis'),
    {
      seq: 4,
      when: WHEN,
      label: 'delivery',
      what: {
        kind: 'delivery',
        move: 1,
        mmrc_model_id: 'model-m',
        seats: ['model-a', 'model-b'],
        opinions: [
          { position: 'justified', basis: [7, 9], support_count: 1, supporting_models: ['model-a'], status: 'gray_box' },
          { position: 'justified', basis: [12], support_count: 1, supporting_models: ['model-b'], status: 'gray_box' },
        ],
        highest_probable: null,
        questions: [],
        derived: true,
      },
    },
  ];
  const readout = readPanel(entries);

  assert.deepEqual(
    readout.moves[0].edgeGreys.map((opinion) => opinion.text),
    ['the approval entry covers the deed', 'a dissent from another basis'],
    'each stored opinion is read with the seat that wrote it',
  );
  assert.deepEqual(
    readout.moves[0].edgeGreys.map((opinion) => opinion.seats),
    [[1], [2]],
    'the seats are the ones the report cites, not an empty row',
  );
  assert.deepEqual(readout.moves[0].edgeGreys.map((opinion) => opinion.support), [1, 1], 'the counts still come from the report');
});

test('a stored opinion the record cannot back is marked unbacked, not shown blank', () => {
  // The report cites a model and a basis this record does not hold, so nothing here
  // can say what that seat wrote. The opinion is still shown — a stored derivation is
  // never dropped — but it is marked, so a blank line cannot read as an opinion
  // nobody wrote. The words are not invented and the report's count is not changed.
  const entries = [
    fact(1),
    seated(2, 1, 'model-a', 'entry 1', 'the reply supports the claim'),
    {
      seq: 3,
      when: WHEN,
      label: 'delivery',
      what: {
        kind: 'delivery',
        move: 1,
        mmrc_model_id: 'model-m',
        seats: ['model-a', 'model-z'],
        opinions: [
          { position: 'justified', basis: [1], support_count: 1, supporting_models: ['model-a'], status: 'gray_box' },
          { position: 'justified', basis: [99], support_count: 1, supporting_models: ['model-z'], status: 'gray_box' },
        ],
        highest_probable: null,
        questions: [],
        derived: true,
      },
    },
  ];
  const readout = readPanel(entries);
  const [held, unbacked] = readout.moves[0].edgeGreys;

  assert.equal(held.unbacked, false, 'an opinion the record backs is not marked');
  assert.equal(unbacked.unbacked, true, 'and one it cannot back is');
  assert.equal(unbacked.text, '', 'the record holds no words for it, so none are invented');
  assert.equal(unbacked.support, 1, 'the report count is carried unchanged');
});

test('a model the record seats twice with two readings is ambiguous, and no seat is attached', () => {
  // The bank filled a failed seat with the model already seated, so one ID sits on two
  // seats that say different things. The report's basis was read under rules that no
  // longer apply, so the basis cannot place them, and the cited ID alone cannot say
  // which seat the report meant. Attaching both would hand one opinion a seat that
  // holds another; attaching one would be a guess.
  const entries = [
    fact(1),
    seated(2, 1, 'model-a', 'entries 7\u20139', 'the approval entry covers the deed'),
    seated(3, 2, 'model-a', 'entry 12', 'the approval entry names another basis'),
    {
      seq: 4,
      when: WHEN,
      label: 'delivery',
      what: {
        kind: 'delivery',
        move: 1,
        mmrc_model_id: 'model-m',
        seats: ['model-a'],
        opinions: [
          { position: 'justified', basis: [7, 9], support_count: 1, supporting_models: ['model-a'], status: 'gray_box' },
          { position: 'justified', basis: [12], support_count: 1, supporting_models: ['model-a'], status: 'gray_box' },
        ],
        highest_probable: null,
        questions: [],
        derived: true,
      },
    },
  ];
  const [contested, placed] = readPanel(entries).moves[0].edgeGreys;

  assert.equal(contested.unbacked, true, 'the row is marked rather than shown as held by nobody');
  assert.equal(contested.unbackedReason, 'ambiguous', 'the seats exist; the link is what is refused');
  assert.deepEqual(contested.ambiguousModels, ['model-a'], 'and the disputed model is named');
  assert.deepEqual(contested.seats, [], 'neither seat is attached');
  assert.equal(contested.text, '', 'no words are invented for the opinion');

  assert.equal(placed.unbacked, false, 'the opinion the basis still places is linked as before');
  assert.equal(placed.text, 'the approval entry names another basis');
  assert.deepEqual(placed.seats, [2]);
});

test('an opinion the basis only partly places says so, instead of a seat count below the report\u2019s', () => {
  // The report grouped two models under one basis, and this record's reading of that
  // basis now places one of them. The row still shows the seat it can name, but it
  // has to say the second is not placed: otherwise it reads "1 seat" beside the
  // report's own count of 2, with nothing saying why the panel appears to have
  // shrunk. The report is not corrected and no words are borrowed from the seat it
  // could not place.
  const entries = [
    fact(1),
    seated(2, 1, 'model-a', 'entry 1', 'the reply supports the claim'),
    seated(3, 2, 'model-b', 'entry 2', 'the reply restates the prompt'),
    {
      seq: 4,
      when: WHEN,
      label: 'delivery',
      what: {
        kind: 'delivery',
        move: 1,
        mmrc_model_id: 'model-m',
        seats: ['model-a', 'model-b'],
        opinions: [
          { position: 'justified', basis: [1], support_count: 2, supporting_models: ['model-a', 'model-b'], status: 'gray_box' },
        ],
        highest_probable: null,
        questions: [],
        derived: true,
      },
    },
  ];
  const [opinion] = readPanel(entries).moves[0].edgeGreys;

  assert.equal(opinion.unbacked, false, 'the basis places one seat, so the opinion has words');
  assert.equal(opinion.text, 'the reply supports the claim', 'the words come from the seat it did place');
  assert.deepEqual(opinion.seats, [1], 'and only that seat is attached');
  assert.equal(opinion.support, 2, 'the report count is carried unchanged');
  assert.deepEqual(
    opinion.partial,
    { reparse: ['model-b'], missing: [] },
    'the model the basis no longer places is named, so the short seat count is explained',
  );
});

test('an opinion citing a model the record does not seat at all says that, not just a short count', () => {
  // The other way a cited source goes unplaced: the basis finds a seat, and the
  // report also names a model this record has no seat on. That is a gap, not a
  // disagreement about a basis, and the row says which it is.
  const entries = [
    fact(1),
    seated(2, 1, 'model-a', 'entry 1', 'the reply supports the claim'),
    {
      seq: 3,
      when: WHEN,
      label: 'delivery',
      what: {
        kind: 'delivery',
        move: 1,
        mmrc_model_id: 'model-m',
        seats: ['model-a', 'model-z'],
        opinions: [
          { position: 'justified', basis: [1], support_count: 2, supporting_models: ['model-a', 'model-z'], status: 'gray_box' },
        ],
        highest_probable: null,
        questions: [],
        derived: true,
      },
    },
  ];
  const [opinion] = readPanel(entries).moves[0].edgeGreys;

  assert.deepEqual(opinion.seats, [1]);
  assert.deepEqual(opinion.partial, { reparse: [], missing: ['model-z'] }, 'the absent model is named as absent');
});

test('one model on two seats citing one basis is one opinion, however the words differ', () => {
  // The guard must not over-refuse: an opinion is position + basis, and the spec says
  // wording is not the grouping rule. Two seats on one model that cite the same
  // entries hold the same opinion even when they phrased it differently, so the link
  // is made, not refused.
  const entries = [
    fact(1),
    seated(2, 1, 'model-a', 'entries 4\u20136', 'the approval entry covers the deed'),
    seated(3, 2, 'model-a', 'entries 4, 5 and 6', 'the deed follows from those entries'),
    {
      seq: 4,
      when: WHEN,
      label: 'delivery',
      what: {
        kind: 'delivery',
        move: 1,
        mmrc_model_id: 'model-m',
        seats: ['model-a'],
        opinions: [
          { position: 'justified', basis: [4, 6], support_count: 1, supporting_models: ['model-a'], status: 'gray_box' },
        ],
        highest_probable: null,
        questions: [],
        derived: true,
      },
    },
  ];
  const [opinion] = readPanel(entries).moves[0].edgeGreys;

  assert.equal(opinion.unbacked, false, 'the seats hold one opinion, so it is not ambiguous');
  assert.deepEqual(opinion.seats, [1, 2], 'both seats are behind it');
  assert.equal(opinion.support, 1, 'and the report still counts one model');
});

test('the panel report says about a marked opinion what the page says', () => {
  // Three stored opinions the record cannot fully place: no seat at all, a model the
  // record seats twice with different readings, and a cited source the basis leaves
  // out. The terminal and the page print the same sentences, composed once — a
  // terminal counting seats the page says are not attached would be a second
  // readout of the same record, and the reader would have no way to tell which one
  // the file backs.
  const entries = [
    fact(1),
    seated(2, 1, 'model-a', 'entries 7\u20139', 'the approval entry covers the deed'),
    seated(3, 2, 'model-a', 'entry 12', 'the approval entry names another basis'),
    seated(4, 3, 'model-b', 'entry 2', 'the reply restates the prompt'),
    {
      seq: 5,
      when: WHEN,
      label: 'delivery',
      what: {
        kind: 'delivery',
        move: 1,
        mmrc_model_id: 'model-m',
        seats: ['model-a', 'model-a', 'model-b'],
        opinions: [
          { position: 'justified', basis: [99], support_count: 1, supporting_models: ['model-z'], status: 'gray_box' },
          { position: 'justified', basis: [98], support_count: 1, supporting_models: ['model-a'], status: 'gray_box' },
          { position: 'justified', basis: [2], support_count: 2, supporting_models: ['model-a', 'model-b'], status: 'gray_box' },
        ],
        highest_probable: null,
        questions: [],
        derived: true,
      },
    },
  ];
  const { moves } = readPanel(entries);
  const html = buildPage(entries, { source: 'records/k-record.jsonl', generatedAt: WHEN, env: {} });

  const printed = [];
  const original = console.log;
  console.log = (...args) => printed.push(args.map(String).join(' '));
  try {
    reportPanelRun(
      { refused: null, problem: null, waiting: 0, candidates: 0, outcomes: [], attempts: [], written: { judgments: 0, questions: 0 }, stopped: null, seats: [1, 2, 3] },
      { readout: { moves } },
    );
  } finally {
    console.log = original;
  }
  const text = printed.join('\n');

  // Scoped to the readout: the seat-graph section reuses the row classes, and an
  // edge's text is not an opinion.
  const section = html.split('<section class="readout">')[1].split('</section>')[0];
  const pageTexts = [...section.matchAll(/readout__text">([^<]*)</g)].map((found) => found[1]);
  const pageCounts = [...section.matchAll(/readout__count">([^<]*)</g)].map((found) => found[1]);
  assert.equal(pageTexts.length, 3, 'the page shows all three opinions');
  for (const words of pageTexts) assert.ok(text.includes(words), `the report says what the page says: ${words}`);
  for (const held of pageCounts) assert.ok(text.includes(held), `the report counts what the page counts: ${held}`);

  assert.match(text, /unbacked: the report cites model-z/, 'and does not print an opinion it has no words for');
  assert.doesNotMatch(text, /0 seat\(s\) held it/, 'no opinion is printed as held by nobody');
  assert.doesNotMatch(text, /1 seat\(s\) held it, 2 independent/, 'and no short count is printed without the report\u2019s own');
});

test('the readout is counted against the seats the record shows, never a panel it never held', () => {
  const entries = [
    fact(1),
    read(2, 1, 1, 'a-model', 'the reply supports the claim about Ada'),
    read(3, 1, 2, 'b-model', 'the reply restates the prompt'),
  ];

  const [move] = readPanel(entries).moves;
  assert.equal(move.seats, 2, 'the seats are the ones this move shows');
  assert.equal(move.majority, 2, 'a majority of the seats this move shows');
  assert.equal(move.probable, null, 'one of two seats is not a majority of the two it shows');
  assert.deepEqual(move.edgeGreys.map((opinion) => opinion.ids), [['a-model'], ['b-model']]);

  // The single judge's own judgment on the same move is not a seat. It is not a
  // judge of this panel, and counting it would make one seat look like two.
  const judgedToo = [
    ...entries,
    {
      seq: 4,
      when: WHEN,
      label: 'judgment',
      what: { kind: 'judgment', move: 1, subjects: [], observation: 'the reply supports the claim about Ada' },
    },
  ];

  const [mixed] = readPanel(judgedToo).moves;
  assert.equal(mixed.seats, 2, 'an entry carrying no seat is not a seat of the panel');
  assert.equal(mixed.edgeGreys[0].judges, 1, 'and it is not counted as one of the judges holding that opinion');
});

test('a record the single judge wrote is not read out as a panel that agreed on nothing', () => {
  // A judgment with no seat is one judge's reading of a move it was asked to judge.
  // Reading it out against seats it never held would put "no opinion reached 2
  // independent judges" on a page for a panel that never sat.
  const judgeWrote = [
    fact(1),
    {
      seq: 2,
      when: WHEN,
      label: 'judgment',
      what: { kind: 'judgment', move: 1, subjects: ['Ada Okafor'], observation: 'the reply supports the claim about Ada' },
    },
    {
      seq: 3,
      when: WHEN,
      label: 'question',
      what: { kind: 'question', move: 2, subjects: [], question: 'what in the record shows the basis for this?' },
    },
  ];

  assert.deepEqual(readPanel(judgeWrote), { moves: [] }, 'no seat in the record, so there is no panel to read out');
});

test('a move every seat asked about is read out, with no opinions and every seat named', async () => {
  await withStore(async (store) => {
    await store.append(fact(1));

    await judgePanel({
      entries: await store.readAll(),
      env: PANEL,
      store,
      now: () => new Date(WHEN),
      fetchImpl: seatReplies({ 'muse-spark-1.3': NOT_SHOWN, 'free-a': NOT_SHOWN, 'free-b': NOT_SHOWN }),
    });

    const [move] = readPanel(await store.readAll()).moves;
    assert.equal(move.seq, 1, 'the move is read out even when no seat took a side on it');
    assert.equal(move.seats, 3);
    assert.equal(move.probable, null, 'no seat offered a reading, so none is probable');
    assert.deepEqual(move.edgeGreys, [], 'there is no minority reading to surface either');
    assert.deepEqual(move.noPosition, [1, 2, 3], 'every seat that asked is named');
  });
});

test('a named move is seated on its own, and one that cannot be judged is refused', async () => {
  await withStore(async (store) => {
    await store.append(fact(1));
    await store.append(fact(2, 'name three colours'));
    const fetchImpl = seatReplies({ 'muse-spark-1.3': SAME, 'free-a': SAME, 'free-b': SAME });

    const result = await judgePanel({
      entries: await store.readAll(),
      env: PANEL,
      store,
      fetchImpl,
      move: 2,
      now: () => new Date(WHEN),
    });

    assert.equal(result.candidates, 1);
    assert.deepEqual(fetchImpl.asked, ['muse-spark-1.3', 'free-a', 'free-b'], 'three calls, for the one named move');
    assert.deepEqual(result.outcomes.map((outcome) => outcome.seq), [2]);
  });

  await withStore(async (store) => {
    await store.append(fact(1));
    const result = await judgePanel({
      entries: await store.readAll(),
      env: PANEL,
      store,
      fetchImpl: seatReplies({}),
      move: 9,
      now: () => new Date(WHEN),
    });

    assert.match(result.problem, /no entry with seq 9/);
    assert.equal(result.candidates, 0);
  });
});

test('the panel leaves every fact byte-identical, and shades unmoved', async () => {
  await withStore(async (store, path) => {
    await store.append(fact(1));
    const before = (await readFile(path, 'utf8')).trim().split('\n');

    await judgePanel({
      entries: await store.readAll(),
      env: PANEL,
      store,
      now: () => new Date(WHEN),
      fetchImpl: seatReplies({ 'muse-spark-1.3': SAME, 'free-a': SAME, 'free-b': OTHER }),
    });

    const after = (await readFile(path, 'utf8')).trim().split('\n');
    assert.deepEqual(after.slice(0, before.length), before, 'every fact line is exactly as it was');

    const { shadeFor } = await import('../record/shades.js');
    const entries = await store.readAll();
    assert.equal(shadeFor(entries, 'Ada Okafor').shade, 1, 'three opinions darken nothing: shade counts facts');
  });
});
