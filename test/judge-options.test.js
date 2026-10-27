// The judge command's options: --move, --limit, and what either refuses.
//
// These drive the command rather than the judge, because the thing under test is
// what the command does with what it was asked for — how many moves it reaches,
// which one it picks, and what it refuses before spending a call. The refusals
// matter as much as the runs: a seq the record cannot judge, a limit that is not
// a number, and a missing key must all stop with nothing sent and nothing
// written, and each says which of those it was.
//
// The judging itself is in judge.test.js; the prompt and the reply reader are in
// judge-prompt.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { observed, provider } from '../checks/fixtures.js';
import { judgeCommand } from '../cli/judge.js';
import { judgeMoves, movesToJudge } from '../judge/judge.js';
import { createStore } from '../record/store.js';

const BASETEN_ENV = { BASETEN_API_KEY: 'baseten-secret', BASETEN_MODEL: 'darrens-pick' };

async function withStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'overseer-judge-options-'));
  try {
    return await fn(createStore(join(dir, 'records.jsonl')));
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


const SHOWN = JSON.stringify({ basis: 'shown', observation: 'the reply supports the claim about Ada', question: '' });
const NOT_SHOWN = JSON.stringify({ basis: 'not-shown', observation: '', question: 'what in the record supports this claim?' });

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

test('a refused reply exits 5 and says the gap it left was recorded', async () => {
  await withStore(async (store) => {
    await observed(store, 'a move about Ada', ['Ada Okafor']);

    const directing = JSON.stringify({
      basis: 'shown',
      observation: 'the reply supports the claim, but you should add a timing figure next',
      question: '',
    });

    const out = capture();
    let code;
    try {
      code = await judgeCommand({ env: BASETEN_ENV, store, fetchImpl: provider(directing) });
    } finally {
      out.restore();
    }

    // Still 5: a judgment was refused. What changed is that the refusal is no
    // longer invisible — it is an entry, and the run says so.
    assert.equal(code, 5);
    assert.match(out.text(), /question written instead/);
    assert.match(out.text(), /the gap it left was recorded as a question/);
    assert.equal((await store.readAll()).filter((e) => e.label === 'question').length, 1, 'the trace is in the record');
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
