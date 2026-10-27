// The judge, judging.
//
// What these can check without a Baseten key: that a judgment names the move it
// judges and carries the judgment label, that directing wording stops an entry
// instead of writing it, that a question lands in its subject's thread, that a
// question with no subject is still written, that the facts it reads are left
// byte-identical, and that without credentials the whole path refuses before it
// touches the network.
//
// What they cannot check: that Baseten answers or that its judgements are good.
// Both are live questions. The options that decide WHICH move is judged, and how
// the command reports them, live in judge-options.test.js; the prompt and the
// reply reader, which need neither a store nor a key, live in
// judge-prompt.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { observed, provider } from '../checks/fixtures.js';
import { DIRECTED_QUESTION, judgeMoves, movesToJudge } from '../judge/judge.js';
import { directs } from '../judge/wording.js';
import { createStore } from '../record/store.js';
import { shadeFor } from '../record/shades.js';

const BASETEN_ENV = { BASETEN_API_KEY: 'baseten-secret', BASETEN_MODEL: 'darrens-pick' };

async function withStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'overseer-judge-'));
  try {
    return await fn(createStore(join(dir, 'records.jsonl')), join(dir, 'records.jsonl'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

const DIRECTING = JSON.stringify({
  basis: 'shown',
  observation: 'the reply supports the claim, but you should add a timing figure next',
  question: '',
});

test('wording that directs is never written, and the refusal is recorded in its place', async () => {
  await withStore(async (store) => {
    const { entry: fact } = await observed(store, 'a move about Ada', ['Ada Okafor']);

    const result = await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: provider(DIRECTING) });

    assert.equal(result.written.judgments, 0, 'the directive is never written as a judgment');
    assert.equal(result.written.questions, 1, 'the refusal is recorded, rather than left as a silence');
    assert.equal(result.outcomes[0].state, 'asked-instead');
    assert.match(result.outcomes[0].detail, /you should/i, 'the report names the phrase that stopped it');

    const stored = (await store.readAll()).at(-1);
    assert.equal(stored.label, 'question', 'the trace reads as a question, not as a judgment');
    assert.equal(stored.what.question, DIRECTED_QUESTION);
    assert.equal(stored.what.move, fact.seq, 'it names the move, so the move leaves the queue');
    assert.deepEqual(stored.what.subjects, ['Ada Okafor'], 'and it sits in that move\u2019s subject thread');

    // The one thing the record must not hold is the direction itself.
    assert.doesNotMatch(JSON.stringify(stored), /you should/i, 'the model\u2019s directive is not in the record');

    assert.deepEqual(movesToJudge(await store.readAll()).map((e) => e.seq), [], 'the move is not offered again');
  });
});

test('a refused reply is not paid for twice', async () => {
  await withStore(async (store) => {
    await observed(store, 'a move about Ada', ['Ada Okafor']);

    const seen = [];
    await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: provider(DIRECTING, seen) });
    await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: provider(DIRECTING, seen) });

    assert.equal(seen.length, 1, 'the second run has nothing left to ask about');
    assert.equal((await store.readAll()).length, 2, 'the fact and one trace, appended once');
  });
});

test('the trace the code writes passes the manner rule it stands in for', async () => {
  assert.equal(directs(DIRECTED_QUESTION), null, 'the record-authored question directs nothing');

  await withStore(async (store) => {
    await observed(store, 'a move that names no subject');

    const result = await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: provider(DIRECTING) });

    assert.equal(result.outcomes[0].state, 'asked-instead-unfiled', 'no subject, so the trace is unfiled');
    const stored = (await store.readAll()).at(-1);
    assert.deepEqual(stored.what.subjects, [], 'no subject is invented for it');
    assert.equal(stored.what.question, DIRECTED_QUESTION);
  });
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

    // Unlike a refusal, nothing was decided about the move, so it keeps its
    // place: a malformed reply deserves the retry that naming the move would end.
    assert.deepEqual(movesToJudge(await store.readAll()).map((e) => e.seq), [1], 'the move is still queued');
  });
});

test('a call that fails writes nothing and leaves the move for the next run', async () => {
  await withStore(async (store) => {
    await observed(store, 'a move about Ada', ['Ada Okafor']);

    let asked = 0;
    const down = async () => {
      asked += 1;
      throw new Error('the network was down');
    };

    const result = await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: down });

    assert.equal(asked, 1, 'the call was attempted once');
    assert.equal(result.outcomes[0].state, 'call-failed');
    assert.equal(result.written.judgments + result.written.questions, 0, 'nothing is written for a call that never arrived');
    assert.equal((await store.readAll()).length, 1, 'only the fact is in the record');
    assert.deepEqual(movesToJudge(await store.readAll()).map((e) => e.seq), [1], 'the move keeps its place');

    // And the retry that place exists for: the same move is judged once a reply
    // arrives, so a blip does not become a verdict.
    await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: provider(SHOWN) });
    assert.equal((await store.readAll()).filter((e) => e.label === 'judgment').length, 1, 'the next run judges it');
  });
});

test('in one run, a refusal is recorded and a failure is not', async () => {
  await withStore(async (store) => {
    await observed(store, 'first move about Ada', ['Ada Okafor']);
    await observed(store, 'second move about Ada', ['Ada Okafor']);

    let call = 0;
    const mixed = async () => {
      call += 1;
      if (call === 1) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ model: 'darrens-pick', choices: [{ message: { content: DIRECTING } }] }) };
      }
      throw new Error('the network was down');
    };

    const result = await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: mixed });

    assert.deepEqual(result.outcomes.map((o) => o.state), ['asked-instead', 'call-failed'], 'one was refused, one never arrived');

    const questions = (await store.readAll()).filter((e) => e.label === 'question');
    assert.equal(questions.length, 1, 'one trace — for the refusal only');
    assert.equal(questions[0].what.move, 1, 'and it names the move that was refused');

    assert.deepEqual(movesToJudge(await store.readAll()).map((e) => e.seq), [2], 'the failed move is the one still queued');
  });
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
