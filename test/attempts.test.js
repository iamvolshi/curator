// Parking: a move whose replies keep failing stops costing a call every run.
//
// The claim has three parts and each needs its own check. Parking must actually
// save the call. It must write nothing — a park is not a verdict, and the record
// must still show the move as unjudged. And it must be reversible: one success
// clears the count, and --retry-parked offers everything again.
//
// The ledger is deliberately not the record. Nothing here may leave an entry, and
// a missing or damaged ledger must read as "no attempts yet" rather than stopping
// a run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { observed as recordedCall, provider } from '../checks/fixtures.js';
import { judgeCommand } from '../cli/judge.js';
import { PARK_AFTER, createLedger, parkedFrom } from '../judge/attempts.js';
import { judgeMoves, movesToJudge, parkedMoves } from '../judge/judge.js';
import { makeEntry } from '../record/entry.js';
import { createStore } from '../record/store.js';

const BASETEN_ENV = { BASETEN_API_KEY: 'baseten-secret', BASETEN_MODEL: 'darrens-pick' };
const SHOWN = JSON.stringify({ basis: 'shown', observation: 'the reply supports the claim about Ada', question: '' });

async function withStores(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'overseer-attempts-'));
  try {
    return await fn(createStore(join(dir, 'records.jsonl')), createLedger(join(dir, 'attempts.json')));
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

/** The moves in these checks are about Ada, so the subject is fixed here. */
const observed = (store, prompt) => recordedCall(store, prompt, ['Ada Okafor']);

function failing(seen = []) {
  return async () => {
    seen.push(1);
    throw new Error('the network was down');
  };
}

test('a move whose replies keep failing is parked, and the park saves the call', async () => {
  await withStores(async (store, ledger) => {
    await observed(store, 'a move about Ada');

    const seen = [];
    for (let run = 1; run <= PARK_AFTER; run += 1) {
      const result = await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: failing(seen), attempts: ledger });
      assert.equal(result.outcomes[0].state, 'call-failed', `run ${run} still attempts the move`);
    }
    assert.equal(seen.length, PARK_AFTER, 'one call per failing run, while it is still being tried');

    // The run that matters: past the threshold, no call at all.
    const parkedRun = await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: failing(seen), attempts: ledger });
    assert.equal(seen.length, PARK_AFTER, 'a parked move costs no call');
    assert.equal(parkedRun.candidates, 0, 'nothing was attempted');
    assert.deepEqual(parkedRun.parked, [{ seq: 1, fails: PARK_AFTER }], 'and the run says which move it skipped and why');
  });
});

test('a park writes nothing, and the record still shows the move as unjudged', async () => {
  await withStores(async (store, ledger) => {
    await observed(store, 'a move about Ada');
    const path = store.path;

    for (let run = 0; run <= PARK_AFTER; run += 1) {
      await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: failing(), attempts: ledger });
    }

    const lines = (await readFile(path, 'utf8')).trim().split('\n');
    assert.equal(lines.length, 1, 'the record holds the fact and nothing else');
    assert.equal(lines[0].includes('"label":"fact"'), true);
    assert.deepEqual(movesToJudge(await store.readAll()).map((e) => e.seq), [1], 'the move is still in the queue');
  });
});

test('parking is a cost bound, not a verdict: one success clears the count', async () => {
  await withStores(async (store, ledger) => {
    await observed(store, 'a move about Ada');

    await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: failing(), attempts: ledger });
    await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: failing(), attempts: ledger });
    assert.equal((await ledger.readAll())['1'].fails, 2, 'two failures counted');

    await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: provider(SHOWN), attempts: ledger });
    assert.deepEqual(await ledger.readAll(), {}, 'the count is gone once the move is judged');
    assert.equal((await store.readAll()).filter((e) => e.label === 'judgment').length, 1);
  });
});

test('a parked move can still be named, and --retry-parked offers it again', async () => {
  await withStores(async (store, ledger) => {
    await observed(store, 'a move about Ada');
    for (let run = 0; run < PARK_AFTER; run += 1) {
      await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: failing(), attempts: ledger });
    }

    // Naming a parked move outranks the bound: the caller asked for this one.
    const named = await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: failing(), attempts: ledger, move: 1 });
    assert.equal(named.outcomes[0].state, 'call-failed', 'the named move was attempted despite being parked');

    const out = capture();
    let code;
    try {
      code = await judgeCommand({ args: ['--retry-parked'], env: BASETEN_ENV, store, ledger, fetchImpl: provider(SHOWN) });
    } finally {
      out.restore();
    }

    assert.equal(code, 0);
    assert.equal((await store.readAll()).filter((e) => e.label === 'judgment').length, 1, 'the retried move is judged');
    assert.deepEqual(await ledger.readAll(), {}, 'and the ledger is empty');
  });
});

test('a missing or damaged ledger reads as no attempts, and never stops a run', async () => {
  await withStores(async (store, ledger) => {
    await observed(store, 'a move about Ada');

    assert.deepEqual(await ledger.readAll(), {}, 'a ledger that was never written reads as empty');

    await writeFile(ledger.path, '{ this is not json', 'utf8');
    assert.deepEqual(await ledger.readAll(), {}, 'a damaged ledger is dropped, not allowed to stop the run');

    const result = await judgeMoves({ entries: await store.readAll(), env: BASETEN_ENV, store, fetchImpl: provider(SHOWN), attempts: ledger });
    assert.equal(result.written.judgments, 1, 'the run went ahead');
  });
});

test('a parked move can be described for a reader, with the subject and the reason', async () => {
  await withStores(async (store, ledger) => {
    await observed(store, 'a move about Ada');
    await ledger.noteFailure(1, 'unreadable');
    await ledger.noteFailure(1, 'unreadable');
    await ledger.noteFailure(1, 'unreadable');

    const parked = parkedMoves(await store.readAll(), await ledger.readAll());

    assert.deepEqual(parked.map((move) => move.seq), [1]);
    assert.equal(parked[0].fails, PARK_AFTER);
    assert.deepEqual(parked[0].subjects, ['Ada Okafor'], 'the reader is told which thread the move belongs to');
    assert.equal(parked[0].prompt, 'a move about Ada', 'and which move it was');
    assert.equal(parked[0].reason, 'the reply could not be read', 'the last failure is said in words');
  });
});

test('a stale count never reports a move the record has since answered', async () => {
  await withStores(async (store, ledger) => {
    await observed(store, 'a move about Ada');
    for (let run = 0; run < PARK_AFTER; run += 1) await ledger.noteFailure(1, 'call-failed');

    // Judged by hand, as a run with --move could do, leaving the count behind.
    await store.append(
      makeEntry({ when: '2026-10-27T00:00:00.000Z', label: 'judgment', what: { kind: 'judgment', move: 1, subjects: ['Ada Okafor'], observation: 'observed' } }),
    );

    assert.deepEqual(
      parkedMoves(await store.readAll(), await ledger.readAll()),
      [],
      'the record says the move is answered, so no view may say it is waiting',
    );
  });
});

test('the threshold is a number of attempts, and only counts what failed', () => {
  const counts = {
    1: { fails: PARK_AFTER },
    2: { fails: PARK_AFTER - 1 },
    3: { fails: 99 },
  };

  assert.deepEqual(
    parkedFrom(counts, PARK_AFTER).map((held) => held.seq),
    [1, 3],
    'at the threshold and past it are parked; just under is not',
  );
  assert.deepEqual(parkedFrom({}, PARK_AFTER), [], 'no counts, nothing parked');
});
