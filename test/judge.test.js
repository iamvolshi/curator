// The judge.
//
// What these can check without a Baseten key: that a judgment names the move it
// judges and carries the judgment label, that directing wording stops an entry
// instead of writing it, that a question lands in its subject's thread and asks
// for nothing else, that the facts it reads are left byte-identical, and that
// without credentials the whole path refuses before it touches the network.
//
// What they cannot check: that Baseten answers or that its judgements are good.
// Both are live questions and Baseten has no credentials here, so this phase
// makes no live call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { judgeCommand } from '../cli/judge.js';
import { judgeMoves, movesToJudge } from '../judge/judge.js';
import { readJudgeReply, judgeMessages } from '../judge/prompt.js';
import { DIRECTIVE_PATTERNS, directs } from '../judge/wording.js';
import { createStore } from '../record/store.js';
import { shadeFor } from '../record/shades.js';
import { wrapCall } from '../wrapper/wrap.js';

const BASETEN_ENV = { BASETEN_API_KEY: 'baseten-secret', BASETEN_MODEL: 'darrens-pick' };

async function withStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'overseer-judge-'));
  try {
    return await fn(createStore(join(dir, 'records.jsonl')), join(dir, 'records.jsonl'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function capture() {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.map(String).join(' '));
  return {
    text: () => lines.join('\n'),
    restore: () => {
      console.log = original;
    },
  };
}

/** One observed move, recorded by the wrapper as always. */
function observed(store, prompt, subjects = [], response = 'an answer') {
  return wrapCall({
    call: async () => ({ ok: true, kind: 'worker-call', worker: 'meta-model-api', model: 'muse-spark-1.3', text: response }),
    prompt,
    store,
    subjects,
  });
}

/** A provider that answers the judge with a fixed reply, and records every URL. */
function provider(content, seen = []) {
  return async (url, options) => {
    seen.push({ url, auth: options?.headers?.Authorization });
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ model: 'darrens-pick', choices: [{ message: { content } }] }),
    };
  };
}

const SHOWN = JSON.stringify({ basis: 'shown', observation: 'the reply supports the claim about Ada', question: '' });
const NOT_SHOWN = JSON.stringify({ basis: 'not-shown', observation: '', question: 'what in the record supports this claim?' });

test('a judgment names its move, carries its label, and says nothing else', async () => {
  await withStore(async (store) => {
    const { entry: fact } = await observed(store, 'a move about Ada', ['Ada Okafor']);
    const seen = [];

    const result = await judgeMoves({
      entries: await store.readAll(),
      env: BASETEN_ENV,
      store,
      fetchImpl: provider(SHOWN, seen),
    });

    assert.equal(seen.length, 1, 'one move, one call');
    assert.equal(seen[0].url, 'https://inference.baseten.co/v1/chat/completions', 'the judge runs on the Overseer plug');
    assert.equal(seen[0].auth, 'Bearer baseten-secret');
    assert.equal(result.written.judgments, 1);

    const stored = (await store.readAll()).at(-1);
    assert.equal(stored.label, 'judgment', 'labelled as a judgment, not a fact');
    assert.equal(stored.what.kind, 'judgment');
    assert.equal(stored.what.move, fact.seq, 'it names the move it judges, by sequence');
    assert.deepEqual(stored.what.subjects, ['Ada Okafor'], 'so it lands in that subject folder');
    assert.deepEqual(
      Object.keys(stored.what).sort(),
      ['kind', 'move', 'observation', 'subjects'],
      'one move, one observation, and nothing else — no score, no verdict, no advice',
    );
  });
});

test('wording that directs stops the entry being written, and names the phrase', async () => {
  await withStore(async (store) => {
    await observed(store, 'a move about Ada', ['Ada Okafor']);

    const directing = JSON.stringify({
      basis: 'shown',
      observation: 'the reply supports the claim, but you should add a timing figure next',
      question: '',
    });

    const result = await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: provider(directing) });

    assert.equal(result.written.judgments, 0, 'nothing is written from a directive');
    assert.equal(result.outcomes[0].state, 'directed');
    assert.match(result.outcomes[0].detail, /you should/i, 'the report names the phrase that stopped it');
    assert.equal((await store.readAll()).length, 1, 'only the fact is in the record');
  });
});

test('every directive phrase is caught, and ordinary observation is not', () => {
  const directing = [
    'you should record the model next',
    'You must add a key first',
    'you need to retry this',
    'do that next',
    'next, run the prove',
    'try again',
    'I recommend a smaller model',
    'make sure you check the reply',
    'consider adding a subject',
    "why don't you ask again",
    "you'd better rerun it",
  ];

  for (const text of directing) {
    assert.ok(directs(text), `caught: ${text}`);
  }
  // No dead patterns: every pattern in the list catches at least one of these
  // phrases, so a rule that stopped working would show up here.
  for (const pattern of DIRECTIVE_PATTERNS) {
    assert.ok(directing.some((text) => pattern.test(text)), `pattern ${pattern} still catches something`);
  }

  const observing = [
    'the result supports the claim about Ada',
    'the reply contradicts the earlier figure',
    'the move bears on the subject Ada, and the record shows one support',
  ];
  for (const text of observing) {
    assert.equal(directs(text), null, `left alone: ${text}`);
  }
});

test('a question lands in its subject thread and asks for nothing else', async () => {
  await withStore(async (store) => {
    await observed(store, 'a move about Ada with no basis shown', ['Ada Okafor']);
    const seen = [];

    const result = await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: provider(NOT_SHOWN, seen) });

    assert.equal(seen.length, 1, 'asking a question does not send anything after it');
    assert.equal(result.written.questions, 1);
    assert.equal(result.written.judgments, 0, 'no judgment is written where the basis is not shown');

    const stored = (await store.readAll()).at(-1);
    assert.equal(stored.label, 'question');
    assert.deepEqual(stored.what.subjects, ['Ada Okafor']);
    assert.equal(typeof stored.what.move, 'number');
  });
});

test('the facts the judge reads are byte-identical afterwards', async () => {
  await withStore(async (store, path) => {
    await observed(store, 'first move about Ada', ['Ada Okafor']);
    await observed(store, 'second move about Ada', ['Ada Okafor']);

    const before = (await readFile(path, 'utf8')).trim().split('\n');

    await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: provider(SHOWN) });

    const after = (await readFile(path, 'utf8')).trim().split('\n');
    assert.deepEqual(after.slice(0, before.length), before, 'every fact line is exactly as it was');

    // And the extra lines are judgments, appended rather than mixed in.
    assert.equal(after.length, before.length + 2);
  });
});

test('a judgment darkens no shade, and the shade of a judged subject is still the fact count', async () => {
  await withStore(async (store) => {
    await observed(store, 'first move about Ada', ['Ada Okafor']);
    await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: provider(SHOWN) });

    const entries = await store.readAll();
    assert.equal(entries.filter((e) => e.label === 'judgment').length, 1);
    assert.equal(shadeFor(entries, 'Ada Okafor').shade, 1, 'one fact, one shade — the judgment adds nothing');
  });
});

test('without Baseten credentials the judge sends nothing and writes nothing', async () => {
  await withStore(async (store) => {
    await observed(store, 'a move about Ada', ['Ada Okafor']);
    const before = (await store.readAll()).length;
    let called = false;

    const result = await judgeMoves({
      entries: await store.readAll(),
      env: {},
      store,
      fetchImpl: async () => {
        called = true;
        throw new Error('the judge must not reach the network without a key');
      },
    });

    assert.equal(called, false, 'no call is made without a key');
    assert.equal(result.refused.status, 'needs-config');
    assert.match(result.refused.missing, /BASETEN_MODEL/, 'the plug is blocked by the model decision first');
    assert.match(result.refused.keyProblem, /BASETEN_API_KEY/, 'and the missing key is named separately');
    assert.equal((await store.readAll()).length, before, 'nothing was written');
  });
});

test('the judge command exits 3 without credentials, having recorded nothing', async () => {
  await withStore(async (store) => {
    await observed(store, 'a move about Ada', ['Ada Okafor']);

    const out = capture();
    let code;
    try {
      code = await judgeCommand({ env: {}, store, fetchImpl: async () => assert.fail('no call expected') });
    } finally {
      out.restore();
    }

    assert.equal(code, 3);
    assert.match(out.text(), /Stopped before the call/);
    assert.match(out.text(), /BASETEN_MODEL/);
    assert.equal((await store.readAll()).length, 1);
  });
});

test('a move already named by a judgment is not judged twice', async () => {
  await withStore(async (store) => {
    const { entry: fact } = await observed(store, 'a move about Ada', ['Ada Okafor']);
    await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: provider(SHOWN) });

    const entries = await store.readAll();
    assert.deepEqual(movesToJudge(entries).map((e) => e.seq), [], 'the judged move is not offered again');

    const seen = [];
    await judgeMoves({ entries, env: BASETEN_ENV, store, fetchImpl: provider(SHOWN, seen) });
    assert.equal(seen.length, 0, 'no second call for a move the record already answered');
    assert.equal(entries.length, (await store.readAll()).length);
    assert.equal(fact.seq, 1);
  });
});

test('--limit judges one move and reports how many are still waiting', async () => {
  await withStore(async (store) => {
    await observed(store, 'first move about Ada', ['Ada Okafor']);
    await observed(store, 'second move about Ada', ['Ada Okafor']);
    await observed(store, 'third move about Ada', ['Ada Okafor']);

    const seen = [];
    const out = capture();
    let code;
    try {
      code = await judgeCommand({ args: ['--limit', '1'], env: BASETEN_ENV, store, fetchImpl: provider(SHOWN, seen) });
    } finally {
      out.restore();
    }

    assert.equal(code, 0);
    assert.equal(seen.length, 1, 'one call, not three');
    assert.equal((await store.readAll()).filter((e) => e.label === 'judgment').length, 1);
    assert.match(out.text(), /judging 1 of 3 unjudged moves \(--limit 1\)/, 'a capped run says it was capped');
    assert.match(out.text(), /The other 2 are still waiting/);
  });
});

test('the moves a limit left out are offered again, in record order', async () => {
  await withStore(async (store) => {
    await observed(store, 'first move', ['Ada Okafor']);
    await observed(store, 'second move', ['Ada Okafor']);

    await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: provider(SHOWN), limit: 1 });
    const afterFirst = movesToJudge(await store.readAll());
    assert.equal(afterFirst.length, 1, 'one move is still waiting');
    assert.equal(afterFirst[0].what.prompt, 'second move', 'and it is the next one in the record');

    await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: provider(SHOWN), limit: 5 });
    assert.equal(movesToJudge(await store.readAll()).length, 0, 'a limit larger than the queue judges the rest');
  });
});

test('--move judges the move it names, not the oldest one in the queue', async () => {
  await withStore(async (store) => {
    await observed(store, 'first move', ['Ada Okafor']);
    const { entry: second } = await observed(store, 'second move', ['Ada Okafor']);
    await observed(store, 'third move', ['Ada Okafor']);

    const seen = [];
    const out = capture();
    let code;
    try {
      code = await judgeCommand({ args: ['--move', String(second.seq)], env: BASETEN_ENV, store, fetchImpl: provider(SHOWN, seen) });
    } finally {
      out.restore();
    }

    assert.equal(code, 0);
    assert.equal(seen.length, 1, 'one call, for the one move named');

    const judgments = (await store.readAll()).filter((e) => e.label === 'judgment');
    assert.equal(judgments.length, 1);
    assert.equal(judgments[0].what.move, second.seq, 'the named move, not seq 1');

    // The moves it did not name are untouched and still offered next time.
    assert.deepEqual(movesToJudge(await store.readAll()).map((e) => e.seq), [1, 3]);
    assert.match(out.text(), /seq 2, picked with --move/);
    assert.match(out.text(), /The other 2 unjudged moves were left alone/);
  });
});

test('--move refuses a sequence the record cannot judge, before any call', async () => {
  await withStore(async (store) => {
    const { entry: fact } = await observed(store, 'a move about Ada', ['Ada Okafor']);
    await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: provider(SHOWN) });
    const judgmentSeq = (await store.readAll()).at(-1).seq;

    const cases = [
      ['99', /no entry with seq 99/],
      [String(judgmentSeq), /is a judgment, not an observed move/],
      [String(fact.seq), /already has a judgment or question naming it/],
    ];

    for (const [seq, expected] of cases) {
      const out = capture();
      let code;
      try {
        code = await judgeCommand({ args: ['--move', seq], env: BASETEN_ENV, store, fetchImpl: async () => assert.fail('no call expected') });
      } finally {
        out.restore();
      }
      assert.equal(code, 2, `refused --move ${seq}`);
      assert.match(out.text(), /No such move to judge/);
      assert.match(out.text(), expected);
    }

    assert.equal((await store.readAll()).length, 2, 'nothing was written');
  });
});

test('--move without a usable seq, or alongside --limit, is refused unread', async () => {
  await withStore(async (store) => {
    await observed(store, 'a move about Ada', ['Ada Okafor']);

    const refused = [
      [['--move'], /Not a good move/],
      [['--move', 'abc'], /Not a good move/],
      [['--move', '0'], /Not a good move/],
      [['--move', '1', '--limit', '1'], /Give one or the other/],
    ];

    for (const [args, expected] of refused) {
      const out = capture();
      let code;
      try {
        code = await judgeCommand({ args, env: BASETEN_ENV, store, fetchImpl: async () => assert.fail('no call expected') });
      } finally {
        out.restore();
      }
      assert.equal(code, 2, `refused ${args.join(' ')}`);
      assert.match(out.text(), expected);
      assert.match(out.text(), /Nothing was sent and nothing was written/);
    }

    assert.equal((await store.readAll()).length, 1, 'nothing was written');
  });
});

test('--move does not open a door around the credentials gate', async () => {
  await withStore(async (store) => {
    const { entry: fact } = await observed(store, 'a move about Ada', ['Ada Okafor']);

    const out = capture();
    let code;
    try {
      code = await judgeCommand({ args: ['--move', String(fact.seq)], env: {}, store, fetchImpl: async () => assert.fail('no call expected') });
    } finally {
      out.restore();
    }

    assert.equal(code, 3, 'still the plug refusal, not a call');
    assert.match(out.text(), /Stopped before the call/);
    assert.equal((await store.readAll()).length, 1);
  });
});

test('a limit that is not a number of moves is refused before anything is read', async () => {
  await withStore(async (store) => {
    await observed(store, 'a move about Ada', ['Ada Okafor']);

    for (const bad of ['0', 'abc', '2.5', '-1']) {
      const out = capture();
      let code;
      try {
        code = await judgeCommand({ args: ['--limit', bad], env: BASETEN_ENV, store, fetchImpl: async () => assert.fail('no call expected') });
      } finally {
        out.restore();
      }
      assert.equal(code, 2, `refused --limit ${bad}`);
      assert.match(out.text(), /Not a good limit/);
    }

    assert.equal((await store.readAll()).length, 1, 'nothing was written');
  });
});

test('an unreadable reply writes nothing rather than guessing', async () => {
  await withStore(async (store) => {
    await observed(store, 'a move about Ada', ['Ada Okafor']);

    const result = await judgeMoves({
      entries: await store.readAll(),
      env: BASETEN_ENV,
      store,
      fetchImpl: provider('the move looks fine to me, eight out of ten'),
    });

    assert.equal(result.written.judgments, 0);
    assert.equal(result.written.questions, 0);
    assert.equal(result.outcomes[0].state, 'unreadable');
    assert.equal((await store.readAll()).length, 1);
  });
});

test('the reply reader refuses a verdict, a missing basis, and an empty observation', () => {
  assert.match(readJudgeReply('no json here').error, /no JSON/);
  assert.match(readJudgeReply('{"basis":"true"}').error, /did not choose a basis/);
  assert.match(readJudgeReply('{"basis":"shown","observation":""}').error, /no observation/);
  assert.match(readJudgeReply('{"basis":"not-shown","question":""}').error, /asked nothing/);

  const good = readJudgeReply('here you go: {"basis":"shown","observation":"the reply supports it"}');
  assert.equal(good.basis, 'shown');
  assert.equal(good.observation, 'the reply supports it');
});

test('the judge is told to observe, and asked only for the two-way choice', () => {
  const messages = judgeMessages({ seq: 7, what: { prompt: 'p', ok: true, response: 'r', subjects: ['Ada Okafor'] } });
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /You do not judge the agent, grade it, or tell it what to do/);
  assert.match(messages[0].content, /"basis": "shown" \| "not-shown"/);
  assert.match(messages[1].content, /move: seq 7/);
  assert.match(messages[1].content, /about: Ada Okafor/);
});

test('a question about a move that names no subject is written, not swallowed', async () => {
  await withStore(async (store, path) => {
    const { entry: fact } = await observed(store, 'a move about nothing in particular', []);
    const before = (await readFile(path, 'utf8')).trim().split('\n');

    const seen = [];
    const result = await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: provider(NOT_SHOWN, seen) });

    assert.equal(seen.length, 1, 'one move, one call');
    assert.equal(result.written.questions, 1, 'the question is written even with no folder to put it in');
    assert.equal(result.written.judgments, 0, 'nothing is called a judgment that has no basis');
    assert.equal(result.outcomes[0].state, 'asked-unfiled');

    const stored = (await store.readAll()).at(-1);
    assert.equal(stored.label, 'question', 'the trace is labelled as the question it is');
    assert.deepEqual(stored.what.subjects, [], 'no subject is invented to give it a folder');
    assert.equal(stored.what.move, fact.seq, 'it still names the move it is about');
    assert.equal(stored.what.question, 'what in the record supports this claim?');

    const after = (await readFile(path, 'utf8')).trim().split('\n');
    assert.deepEqual(after.slice(0, before.length), before, 'the fact it read is byte-identical');

    // The declining moved is named now, so a later run does not pay to ask again.
    assert.deepEqual(movesToJudge(await store.readAll()).map((e) => e.seq), []);
    await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: provider(NOT_SHOWN, seen) });
    assert.equal(seen.length, 1, 'no second call for a move already asked about');
  });
});

test('the command says where a question with no subject went, and exits 0', async () => {
  await withStore(async (store) => {
    await observed(store, 'a move that names no subject', []);

    const out = capture();
    let code;
    try {
      code = await judgeCommand({ env: BASETEN_ENV, store, fetchImpl: provider(NOT_SHOWN) });
    } finally {
      out.restore();
    }

    assert.equal(code, 0, 'a written question is not a failure');
    assert.match(out.text(), /no subject, so it sits in no folder/, 'the report says it was not filed');
    assert.match(out.text(), /belongs to no folder\. It is still in the record/);
    assert.equal((await store.readAll()).filter((e) => e.label === 'question').length, 1);
  });
});
