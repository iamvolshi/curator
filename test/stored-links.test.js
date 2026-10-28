// The check on stored delivery reports: every opinion they hold has to still find
// its seats in the record.
//
// A delivery is written once and read forever. The page marks a row it cannot link,
// but a marker is the fallback, not the alarm: the alarm is this check, run by the
// suite and by the page command, so a change that stops a stored opinion linking is
// caught before anyone is shown a page whose readout has drifted from the record.
//
// The last test reads the record this repo keeps. That is deliberate: the page is
// built from that file, so the check that protects a reader has to be a check on
// that file, not only on fixtures that were written to pass.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { storedGroupingProblems } from '../judge/consolidate.js';
import { storedLinkProblems } from '../judge/readout.js';
import { createStore } from '../record/store.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The record this repo keeps: the deliveries in it are the ones a reader sees. */
const LIVE_RECORD = join(HERE, '..', 'records', 'k-record.jsonl');
const WHEN = '2026-10-26T23:12:32.281Z';

/** One seat's judgment, carrying the numbered basis a stored delivery is matched by. */
function seat(seq, seatNumber, model, pool, observation) {
  return {
    seq,
    when: WHEN,
    label: 'judgment',
    what: {
      kind: 'seat-judgment',
      move: 1,
      subjects: [],
      seat: seatNumber,
      model,
      observation,
      numbered: { deed: 'the move', pool, basis: 'shown', topics: [], sitting: 'none' },
    },
  };
}

/** One stored delivery for move 1, with the opinions handed in. */
function delivery(seq, opinions) {
  return {
    seq,
    when: WHEN,
    label: 'delivery',
    what: {
      kind: 'delivery',
      move: 1,
      mmrc_model_id: 'model-m',
      seats: opinions.length > 0 ? ['model-a', 'model-b'] : [],
      opinions,
      highest_probable: null,
      questions: [],
      derived: true,
    },
  };
}

test('a stored opinion that still finds its seats is not a problem', () => {
  const entries = [
    seat(1, 1, 'model-a', 'entry 1', 'the reply supports the claim'),
    seat(2, 2, 'model-b', 'entry 2', 'the reply restates the prompt'),
    delivery(3, [
      { position: 'justified', basis: [1], support_count: 1, supporting_models: ['model-a'], status: 'gray_box' },
      { position: 'justified', basis: [2], support_count: 1, supporting_models: ['model-b'], status: 'gray_box' },
    ]),
  ];

  assert.deepEqual(storedLinkProblems(entries), [], 'both opinions are placed, so there is nothing to report');
});

test('a stored opinion the record cannot back is a problem, with the reason', () => {
  const entries = [
    seat(1, 1, 'model-a', 'entry 1', 'the reply supports the claim'),
    delivery(2, [
      { position: 'justified', basis: [99], support_count: 1, supporting_models: ['model-z'], status: 'gray_box' },
    ]),
  ];

  assert.deepEqual(storedLinkProblems(entries), [
    {
      seq: 2,
      move: 1,
      basis: [99],
      supporting_models: ['model-z'],
      reason: 'absent',
      models: [],
    },
  ]);
});

test('a stored opinion on a model the record seats twice under different readings is ambiguous', () => {
  const entries = [
    seat(1, 1, 'model-a', 'entries 7\u20139', 'the approval entry covers the deed'),
    seat(2, 2, 'model-a', 'entry 12', 'the approval entry names another basis'),
    delivery(3, [
      { position: 'justified', basis: [99], support_count: 1, supporting_models: ['model-a'], status: 'gray_box' },
    ]),
  ];

  assert.deepEqual(storedLinkProblems(entries), [
    {
      seq: 3,
      move: 1,
      basis: [99],
      supporting_models: ['model-a'],
      reason: 'ambiguous',
      models: ['model-a'],
    },
  ]);
});

test('a stored opinion only some of its cited seats place is a problem that names the rest', () => {
  const entries = [
    seat(1, 1, 'model-a', 'entry 1', 'the reply supports the claim'),
    seat(2, 2, 'model-b', 'entry 2', 'the reply restates the prompt'),
    delivery(3, [
      { position: 'justified', basis: [1], support_count: 2, supporting_models: ['model-a', 'model-b'], status: 'gray_box' },
    ]),
  ];

  assert.deepEqual(storedLinkProblems(entries), [
    {
      seq: 3,
      move: 1,
      basis: [1],
      supporting_models: ['model-a', 'model-b'],
      reason: 'partial',
      reparse: ['model-b'],
      missing: [],
    },
  ]);
});

test('a cited source the record does not seat at all is named as missing', () => {
  const entries = [
    seat(1, 1, 'model-a', 'entry 1', 'the reply supports the claim'),
    delivery(2, [
      { position: 'justified', basis: [1], support_count: 2, supporting_models: ['model-a', 'model-z'], status: 'gray_box' },
    ]),
  ];

  assert.deepEqual(storedLinkProblems(entries), [
    {
      seq: 2,
      move: 1,
      basis: [1],
      supporting_models: ['model-a', 'model-z'],
      reason: 'partial',
      reparse: [],
      missing: ['model-z'],
    },
  ]);
});

test('a superseded delivery is checked too, not only the one the page shows', () => {
  // Re-running MMRC writes a new derivation; the page shows the newest report for
  // the move. The older one is still in the record, and a link that broke in it is
  // still a fact about the record, so the check does not look only at the last one.
  const entries = [
    seat(1, 1, 'model-a', 'entry 1', 'the reply supports the claim'),
    delivery(2, [
      { position: 'justified', basis: [99], support_count: 1, supporting_models: ['model-z'], status: 'gray_box' },
    ]),
    delivery(3, [
      { position: 'justified', basis: [1], support_count: 1, supporting_models: ['model-a'], status: 'gray_box' },
    ]),
  ];

  assert.deepEqual(
    storedLinkProblems(entries).map((problem) => problem.seq),
    [2],
    'the superseded report is the broken one, and it is still reported',
  );
});

test('every stored delivery in the live record still links all its opinions to seats', async () => {
  const entries = await createStore(LIVE_RECORD).readAll();
  const deliveries = entries.filter((entry) => entry.label === 'delivery');

  assert.ok(
    deliveries.length > 0,
    `the live record holds no delivery to check, so this check would pass without checking anything: ${LIVE_RECORD}`,
  );
  assert.deepEqual(
    storedLinkProblems(entries),
    [],
    'a stored delivery opinion no longer finds the seat it cites; the page would show a marked row, and the record or the reading that broke it needs a look before this is published',
  );
});

test('every stored delivery in the live record still groups its seats the way the code does today', async () => {
  const entries = await createStore(LIVE_RECORD).readAll();
  const deliveries = entries.filter((entry) => entry.label === 'delivery');

  assert.ok(
    deliveries.length > 0,
    `the live record holds no delivery to check, so this check would pass without checking anything: ${LIVE_RECORD}`,
  );
  assert.deepEqual(
    storedGroupingProblems(entries),
    [],
    'a stored delivery no longer groups the way its seat reports do; the page would show a grouping this code would not produce',
  );
});
