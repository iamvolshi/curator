import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  consolidateReports,
  consolidateMove,
  deliveryFrom,
  MMRC_FAILURES,
  MMRC_MAX_ATTEMPTS,
  storedGroupingProblems,
} from '../judge/consolidate.js';
import { citedEntries } from '../judge/readout.js';
import { MMRC_MODEL_ID, MMRC_TEMPERATURE } from '../worker/config.js';

const MMRC = 'mmrc/model-under-test';
const WHEN = '2026-10-27T09:00:00.000Z';

function judgment(seat, model, pool, observation = 'the move is supported by the cited entries') {
  return {
    label: 'judgment',
    what: {
      kind: 'seat-judgment',
      move: 1,
      seat,
      model,
      observation,
      numbered: { deed: 'the move', pool, basis: 'shown', topics: [], sitting: 'none' },
    },
  };
}

function asked(seat, model, question = 'what in the record shows the basis?') {
  return {
    label: 'question',
    what: {
      kind: 'seat-question',
      move: 1,
      seat,
      model,
      question,
      numbered: { deed: 'the move', pool: 'none', basis: 'not-shown', topics: [], sitting: question },
    },
  };
}

const FACT = { label: 'fact', what: { kind: 'fact', move: 1, note: 'not a seat' } };

function assertValid(result) {
  assert.equal(result.ok, true, result.detail);
  const delivered = deliveryFrom(result.body, MMRC);
  assert.equal(delivered.ok, true, delivered.detail);
  return delivered.report;
}

test('an agreeing pair with a dissent consolidates to one highest probable and one edge grey', () => {
  const entries = [
    FACT,
    judgment(1, 'model-a', 'entries 4 and 9'),
    judgment(2, 'model-b', '9, 4', 'a different sentence about the same basis'),
    judgment(3, 'model-c', 'entry 12', 'a dissent from another basis'),
  ];
  const report = assertValid(consolidateReports(entries, 1));

  assert.equal(report.opinions.length, 2);
  const probable = report.opinions.find((o) => o.status === 'highest_probable');
  const grey = report.opinions.find((o) => o.status === 'edge_grey');
  assert.deepEqual(probable.basis, [4, 9]);
  assert.equal(probable.support_count, 2);
  assert.deepEqual(probable.supporting_models, ['model-a', 'model-b']);
  assert.deepEqual(grey.basis, [12]);
  assert.equal(grey.support_count, 1);
  assert.deepEqual(report.highest_probable, probable);
  assert.equal(report.mmrc_model_id, MMRC);
  assert.equal(report.derived, true);
  assert.deepEqual(report.seats, ['model-a', 'model-b', 'model-c']);
});

test('an all-dissent move consolidates to the gray box with no highest probable', () => {
  const entries = [
    judgment(1, 'model-a', 'entry 1'),
    judgment(2, 'model-b', 'entry 2'),
    judgment(3, 'model-c', 'entry 3'),
  ];
  const report = assertValid(consolidateReports(entries, 1));

  assert.equal(report.highest_probable, null);
  assert.equal(report.opinions.length, 3);
  for (const opinion of report.opinions) assert.equal(opinion.status, 'gray_box');
});

test('an all-questions move has no opinions, no highest probable, and the questions stand', () => {
  const entries = [
    asked(1, 'model-a', 'what shows entry six?'),
    asked(2, 'model-b', 'who wrote the first line?'),
    asked(3, 'model-c', 'where is the approval?'),
  ];
  const report = assertValid(consolidateReports(entries, 1));

  assert.deepEqual(report.opinions, []);
  assert.equal(report.highest_probable, null);
  assert.deepEqual(report.questions, [
    { seat_model_id: 'model-a', question: 'what shows entry six?' },
    { seat_model_id: 'model-b', question: 'who wrote the first line?' },
    { seat_model_id: 'model-c', question: 'where is the approval?' },
  ]);
});

test('a move-37 shape groups same position and same basis into one opinion, counted by model', () => {
  // Three different wordings, one basis: the same opinion, three independent judges.
  const entries = [
    judgment(1, 'model-a', 'entries 7, 8', 'the approval entry supports the deed'),
    judgment(2, 'model-b', 'entries 8 and 7', 'the deed follows from the approval'),
    judgment(3, 'model-c', 'entry 7 and entry 8', 'the approval is what the move relies on'),
  ];
  const report = assertValid(consolidateReports(entries, 1));

  assert.equal(report.opinions.length, 1);
  const [only] = report.opinions;
  assert.equal(only.status, 'highest_probable');
  assert.equal(only.support_count, 3);
  assert.deepEqual(only.supporting_models, ['model-a', 'model-b', 'model-c']);
});

test('a cited span and the same entries listed are one basis, so the seats group as one opinion', () => {
  // Q2 is prose: one seat cites a stretch of the record, another lists the same
  // entries. They read the same basis, so they are one opinion — not two.
  const entries = [
    FACT,
    judgment(1, 'model-a', 'entries 7\u20139', 'the approval entry covers the deed'),
    judgment(2, 'model-b', 'entries 7, 8 and 9', 'the deed follows from the approval'),
    judgment(3, 'model-c', 'entry 12', 'a dissent from another basis'),
  ];
  const report = assertValid(consolidateReports(entries, 1));

  assert.equal(report.opinions.length, 2);
  const probable = report.opinions.find((o) => o.status === 'highest_probable');
  assert.deepEqual(probable.basis, [7, 8, 9], 'the span is the entries inside it');
  assert.equal(probable.support_count, 2);
  assert.deepEqual(probable.supporting_models, ['model-a', 'model-b']);
});

test('a cited span is read the same however the range is written', () => {
  const span = [4, 5, 6, 7, 8, 9];
  for (const pool of ['entries 4\u20139', 'entries 4-9', 'entries 4 \u2014 9', 'entries 4 to 9', 'entries 4 through 9', 'entries 9\u20134']) {
    assert.deepEqual(citedEntries(pool), span, pool);
  }
  assert.deepEqual(citedEntries('entries 4, 5, 6, 7, 8, 9'), span, 'the listed form is the same basis');
});

test('a span too wide to be a citation is left as its two numbers, and a hyphen inside a name is not a span', () => {
  assert.deepEqual(citedEntries('entries 1\u20139999'), [1, 9999], 'no seat read ten thousand entries');
  assert.deepEqual(citedEntries('llama-3-8b'), [3, 8], 'the numbers stay as written; the name is not expanded into a stretch');
});

test('the same model twice is stacking, not support', () => {
  const entries = [
    judgment(1, 'model-a', 'entry 5'),
    judgment(2, 'model-a', 'entry 5', 'the same judge speaking again'),
    judgment(3, 'model-c', 'entry 6'),
  ];
  const report = assertValid(consolidateReports(entries, 1));

  assert.equal(report.highest_probable, null, 'one model twice must not reach a majority');
  const stacked = report.opinions.find((o) => o.basis[0] === 5);
  assert.equal(stacked.support_count, 1);
  assert.deepEqual(stacked.supporting_models, ['model-a']);
});

test('a partial panel is a typed failure, never a partial consolidation', () => {
  const entries = [judgment(1, 'model-a', 'entry 1'), judgment(2, 'model-b', 'entry 1')];
  const result = consolidateReports(entries, 1);

  assert.equal(result.ok, false);
  assert.equal(result.kind, 'insufficient_reports');
});

test('a seat with a basis that does not match its label is malformed input', () => {
  const judgedNotShown = judgment(3, 'model-c', 'entry 1');
  judgedNotShown.what.numbered.basis = 'not-shown';
  const result = consolidateReports([judgment(1, 'model-a', 'entry 1'), judgment(2, 'model-b', 'entry 1'), judgedNotShown], 1);

  assert.equal(result.ok, false);
  assert.equal(result.kind, 'malformed_input');
});

test('a judgment that cites no entry is malformed input, not an uncited opinion', () => {
  const entries = [judgment(1, 'model-a', 'entry 1'), judgment(2, 'model-b', 'entry 1'), judgment(3, 'model-c', 'no entries here')];
  const result = consolidateReports(entries, 1);

  assert.equal(result.ok, false);
  assert.equal(result.kind, 'malformed_input');
});

test('a seat whose response named no model is malformed input, because its support cannot be counted', () => {
  const unnamed = judgment(3, undefined, 'entry 1');
  const result = consolidateReports([judgment(1, 'model-a', 'entry 1'), judgment(2, 'model-b', 'entry 1'), unnamed], 1);

  assert.equal(result.ok, false);
  assert.equal(result.kind, 'malformed_input');
});

test('two reports from one seat are malformed input, not a fourth opinion', () => {
  const entries = [
    judgment(1, 'model-a', 'entry 1'),
    judgment(2, 'model-b', 'entry 1'),
    judgment(2, 'model-b', 'entry 2'),
  ];
  const result = consolidateReports(entries, 1);

  assert.equal(result.ok, false);
  assert.equal(result.kind, 'malformed_input');
});

test('the live call sends the configured model and temperature and writes the model the response named', async () => {
  const entries = [
    FACT,
    judgment(1, 'model-a', 'entry 4'),
    judgment(2, 'model-b', 'entry 4', 'a different sentence about the same basis'),
    judgment(3, 'model-c', 'entry 12', 'a dissent from another basis'),
  ];
  const grouped = consolidateReports(entries, 1).body;
  let sentBody = null;
  const fetchImpl = async (url, options) => {
    sentBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          model: 'muse-spark-1.3',
          choices: [{ message: { content: JSON.stringify({ opinions: grouped.opinions, highest_probable: grouped.highest_probable, questions: grouped.questions }) }, finish_reason: 'stop' }],
        }),
    };
  };

  const result = await consolidateMove(entries, 1, { env: { MODEL_API_KEY: 'LLM_test_key' }, fetchImpl });

  assert.equal(result.ok, true, result.detail);
  assert.equal(sentBody.model, MMRC_MODEL_ID);
  assert.equal(sentBody.temperature, MMRC_TEMPERATURE);
  assert.equal(result.report.mmrc_model_id, 'muse-spark-1.3');
});

test('a reply that lists the same grouping in another order, and its basis in another order, is not a change', async () => {
  // Order is not part of a grouping: a report lists opinions in the record's arrival
  // order, and a basis is a set of entries. The write path and the audit share one
  // definition, so what this accepts the audit will not later call altered.
  const entries = [
    FACT,
    judgment(1, 'model-a', 'entries 4 and 9'),
    judgment(2, 'model-b', '9, 4', 'a different sentence about the same basis'),
    judgment(3, 'model-c', 'entry 12', 'a dissent from another basis'),
  ];
  const grouped = consolidateReports(entries, 1).body;
  const reply = {
    opinions: [...grouped.opinions].reverse().map((opinion) => ({ ...opinion, basis: [...opinion.basis].reverse() })),
    highest_probable: grouped.highest_probable,
    questions: [...grouped.questions].reverse(),
  };
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ model: 'muse-spark-1.3', choices: [{ message: { content: JSON.stringify(reply) } }] }),
    };
  };

  const result = await consolidateMove(entries, 1, { env: { MODEL_API_KEY: 'LLM_test_key' }, fetchImpl });

  assert.equal(result.ok, true, result.detail);
  assert.equal(calls, 1, 'the reply is the same grouping, so it is not sent back for repair');
});

test('a reply that changes the grouping writes no report, after the repair cap', async () => {
  const entries = [FACT, judgment(1, 'model-a', 'entry 4'), judgment(2, 'model-b', 'entry 4'), judgment(3, 'model-c', 'entry 12')];
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ model: 'muse-spark-1.3', choices: [{ message: { content: '{"opinions":[],"highest_probable":null,"questions":[]}' } }] }),
    };
  };

  const result = await consolidateMove(entries, 1, { env: { MODEL_API_KEY: 'LLM_test_key' }, fetchImpl });

  assert.equal(result.ok, false);
  assert.equal(result.kind, MMRC_FAILURES.alteredGrouping);
  assert.equal(calls, MMRC_MAX_ATTEMPTS, 'the repair is capped, so a model that will not format is not asked forever');
  assert.match(result.detail, /no report is written/);
});

test('a fenced reply is repaired locally, without spending a second call', async () => {
  const entries = [FACT, judgment(1, 'model-a', 'entry 4'), judgment(2, 'model-b', 'entry 4'), judgment(3, 'model-c', 'entry 12')];
  const grouped = consolidateReports(entries, 1).body;
  const form = JSON.stringify({ opinions: grouped.opinions, highest_probable: grouped.highest_probable, questions: grouped.questions });
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ model: 'muse-spark-1.3', choices: [{ message: { content: `\u0060\u0060\u0060json\n${form}\n\u0060\u0060\u0060` } }] }),
    };
  };

  const result = await consolidateMove(entries, 1, { env: { MODEL_API_KEY: 'LLM_test_key' }, fetchImpl });

  assert.equal(result.ok, true, result.detail);
  assert.equal(calls, 1, 'the fence is stripped here, not by another model call');
});

test('a refused reply is asked once more with the exact error, and the repair is written', async () => {
  const entries = [FACT, judgment(1, 'model-a', 'entry 4'), judgment(2, 'model-b', 'entry 4'), judgment(3, 'model-c', 'entry 12')];
  const grouped = consolidateReports(entries, 1).body;
  const form = JSON.stringify({ opinions: grouped.opinions, highest_probable: grouped.highest_probable, questions: grouped.questions });
  const bodies = [];
  const fetchImpl = async (url, options) => {
    bodies.push(JSON.parse(options.body));
    const content = bodies.length === 1 ? '{"opinions":[],"highest_probable":null,"questions":[]}' : form;
    return { ok: true, status: 200, text: async () => JSON.stringify({ model: 'muse-spark-1.3', choices: [{ message: { content } }] }) };
  };

  const result = await consolidateMove(entries, 1, { env: { MODEL_API_KEY: 'LLM_test_key' }, fetchImpl });

  assert.equal(result.ok, true, result.detail);
  assert.equal(bodies.length, 2);
  const repair = bodies[1].messages.at(-1).content;
  assert.match(repair, /changed the grouping it was given/, 'the repair carries the exact refusal');
});

test('a response that names no model stops before the repair attempt', async () => {
  const entries = [FACT, judgment(1, 'model-a', 'entry 4'), judgment(2, 'model-b', 'entry 4'), judgment(3, 'model-c', 'entry 12')];
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: '{"opinions":[],"highest_probable":null,"questions":[]}' } }] }),
    };
  };

  const result = await consolidateMove(entries, 1, { env: { MODEL_API_KEY: 'LLM_test_key' }, fetchImpl });

  assert.equal(result.ok, false);
  assert.equal(result.kind, MMRC_FAILURES.unnamedModel);
  assert.equal(calls, 1, 'a repair cannot supply the missing model ID');
});

test('a failed call writes no report and names the failure', async () => {
  const entries = [FACT, judgment(1, 'model-a', 'entry 4'), judgment(2, 'model-b', 'entry 4'), judgment(3, 'model-c', 'entry 12')];
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => '' });

  const result = await consolidateMove(entries, 1, { env: { MODEL_API_KEY: 'LLM_test_key' }, fetchImpl });

  assert.equal(result.ok, false);
  assert.equal(result.kind, MMRC_FAILURES.callFailed);
});

test('a call that never runs for a move with missing reports makes no call', async () => {
  const fetchImpl = async () => assert.fail('no call expected for an incomplete move');
  const result = await consolidateMove([judgment(1, 'model-a', 'entry 1')], 1, { env: { MODEL_API_KEY: 'LLM_test_key' }, fetchImpl });

  assert.equal(result.ok, false);
  assert.equal(result.kind, 'insufficient_reports');
});

test('reports for other moves are not part of this move', () => {
  const other = judgment(3, 'model-z', 'entry 1');
  other.what.move = 2;
  const entries = [judgment(1, 'model-a', 'entry 1'), judgment(2, 'model-b', 'entry 1'), other];
  const result = consolidateReports(entries, 1);

  assert.equal(result.ok, false);
  assert.equal(result.kind, 'insufficient_reports');
});

/** Stored seat reports as record lines, with the position a line has. */
function recorded(reports, from = 1) {
  return reports.map((report, index) => ({ seq: from + index, when: WHEN, ...report }));
}

/** A stored delivery entry: the report body, labelled as the record labels it. */
function stored(seq, report) {
  return { seq, when: WHEN, label: 'delivery', what: { kind: 'delivery', ...report } };
}

test('a stored delivery whose grouping still matches its seat reports is not a problem', () => {
  const entries = recorded([judgment(1, 'model-a', 'entry 4'), judgment(2, 'model-b', 'entry 4'), judgment(3, 'model-c', 'entry 12')]);
  const report = assertValid(consolidateReports(entries, 1));
  entries.push(stored(4, report));

  assert.deepEqual(storedGroupingProblems(entries), []);
});

/**
 * One deviation from the grouping the code produces, and the fields the audit must
 * name for it — none where the deviation only reorders something a grouping holds
 * as a set, or drops a field the grouping has nothing to say for: the probable when
 * no opinion is highest, and the question list when no seat asked anything. A
 * changed support count or probable is a changed grouping even when every seat still
 * links to its opinion, which is why the link check cannot stand in for this one.
 */
const GROUPING_CASES = [
  {
    name: 'a reordered opinion list is the same grouping',
    reports: [judgment(1, 'model-a', 'entry 4'), judgment(2, 'model-b', 'entry 4'), judgment(3, 'model-c', 'entry 12')],
    edit: (report) => ({ ...report, opinions: [...report.opinions].reverse() }),
    fields: [],
  },
  {
    name: 'a reversed basis is the same grouping',
    reports: [
      judgment(1, 'model-a', 'entries 4 and 9'),
      judgment(2, 'model-b', '9, 4', 'a different sentence about the same basis'),
      judgment(3, 'model-c', 'entry 12', 'a dissent from another basis'),
    ],
    edit: (report) => ({ ...report, opinions: report.opinions.map((opinion) => ({ ...opinion, basis: [...opinion.basis].reverse() })) }),
    fields: [],
  },
  {
    name: 'reordered questions are the same grouping',
    reports: [
      judgment(1, 'model-a', 'entry 4'),
      asked(2, 'model-b', 'what in the record shows the basis?'),
      asked(3, 'model-c', 'where is the entry that shows it?'),
    ],
    edit: (report) => ({ ...report, questions: [...report.questions].reverse() }),
    fields: [],
  },
  {
    name: 'reordered support lists are the same grouping',
    reports: [judgment(1, 'model-a', 'entry 4'), judgment(2, 'model-b', 'entry 4'), judgment(3, 'model-c', 'entry 12')],
    edit: (report) => ({
      ...report,
      opinions: report.opinions.map((opinion) =>
        opinion.supporting_models.length > 1
          ? { ...opinion, supporting_models: [...opinion.supporting_models].reverse() }
          : opinion,
      ),
    }),
    fields: [],
  },
  {
    // Seats are positional — the first is seat 1 — so unlike an opinion list this
    // is not a set: the same three models in another order name another seat.
    name: 'reordered seats are named',
    reports: [judgment(1, 'model-a', 'entry 4'), judgment(2, 'model-b', 'entry 4'), judgment(3, 'model-c', 'entry 12')],
    edit: (report) => ({ ...report, seats: [...report.seats].reverse() }),
    fields: ['seats'],
  },
  {
    name: 'a changed support count is named',
    reports: [judgment(1, 'model-a', 'entry 4'), judgment(2, 'model-b', 'entry 4'), judgment(3, 'model-c', 'entry 12')],
    edit: (report) => ({
      ...report,
      opinions: report.opinions.map((opinion, index) =>
        index === 1 ? { ...opinion, support_count: 2, supporting_models: [...opinion.supporting_models, 'model-a'] } : opinion,
      ),
    }),
    fields: ['opinions'],
  },
  {
    name: 'a changed probable is named',
    reports: [judgment(1, 'model-a', 'entry 1'), judgment(2, 'model-b', 'entry 2'), judgment(3, 'model-c', 'entry 3')],
    edit: (report) => ({ ...report, highest_probable: report.opinions[0] }),
    fields: ['highest_probable'],
  },
  {
    name: 'a changed question is named',
    reports: [
      judgment(1, 'model-a', 'entry 4'),
      asked(2, 'model-b', 'what in the record shows the basis?'),
      asked(3, 'model-c', 'where is the entry that shows it?'),
    ],
    edit: (report) => ({
      ...report,
      questions: report.questions.map((question, index) =>
        index === 0 ? { ...question, question: 'what in the record supports the basis?' } : question,
      ),
    }),
    fields: ['questions'],
  },
  {
    name: 'a changed position is named',
    reports: [judgment(1, 'model-a', 'entry 4'), judgment(2, 'model-b', 'entry 4'), judgment(3, 'model-c', 'entry 12')],
    edit: (report) => ({
      ...report,
      opinions: report.opinions.map((opinion, index) => (index === 0 ? { ...opinion, position: 'not_shown' } : opinion)),
    }),
    fields: ['opinions'],
  },
  {
    name: 'a changed status is named',
    reports: [judgment(1, 'model-a', 'entry 4'), judgment(2, 'model-b', 'entry 4'), judgment(3, 'model-c', 'entry 12')],
    edit: (report) => ({
      ...report,
      opinions: report.opinions.map((opinion, index) => (index === 0 ? { ...opinion, status: 'edge_grey' } : opinion)),
    }),
    fields: ['opinions'],
  },
  {
    name: 'a dropped opinion list is named',
    reports: [judgment(1, 'model-a', 'entry 4'), judgment(2, 'model-b', 'entry 4'), judgment(3, 'model-c', 'entry 12')],
    edit: ({ opinions, ...rest }) => rest,
    fields: ['opinions'],
  },
  {
    // An all-question move leaves the report no opinions. Unlike an empty question
    // list, the absence is named: the card renders "Opinions 0" from this list, so a
    // report that never wrote it is missing part of what the page shows.
    name: 'a dropped empty opinion list is named',
    reports: [
      asked(1, 'model-a', 'what shows entry six?'),
      asked(2, 'model-b', 'who wrote the first line?'),
      asked(3, 'model-c', 'where is the approval?'),
    ],
    edit: ({ opinions, ...rest }) => rest,
    fields: ['opinions'],
  },
  {
    // An older build wrote a report without the field; the questions it was written
    // from are still in the record, so the absence is a changed grouping, not an empty one.
    name: 'a dropped question list is named',
    reports: [
      judgment(1, 'model-a', 'entry 4'),
      asked(2, 'model-b', 'what in the record shows the basis?'),
      asked(3, 'model-c', 'where is the entry that shows it?'),
    ],
    edit: ({ questions, ...rest }) => rest,
    fields: ['questions'],
  },
  {
    // An all-judgment move asks nothing, so a report that never wrote the key says
    // what the empty list says. A list with questions in it still has to be there:
    // the row above covers that, and the empty case is not drift.
    name: 'a dropped empty question list is the same grouping',
    reports: [judgment(1, 'model-a', 'entry 1'), judgment(2, 'model-b', 'entry 2'), judgment(3, 'model-c', 'entry 3')],
    edit: ({ questions, ...rest }) => rest,
    fields: [],
  },
  {
    // Three distinct opinions leave no probable, so the field has nothing to say:
    // a report that never wrote the key grouped the same seats as one that wrote null.
    name: 'a dropped empty probable is the same grouping',
    reports: [judgment(1, 'model-a', 'entry 1'), judgment(2, 'model-b', 'entry 2'), judgment(3, 'model-c', 'entry 3')],
    edit: ({ highest_probable, ...rest }) => rest,
    fields: [],
  },
  {
    // The agreeing pair gives the code a probable, so leaving the key out says
    // something the grouping does not — the absence is drift, not silence.
    name: 'a dropped declared probable is named',
    reports: [judgment(1, 'model-a', 'entry 4'), judgment(2, 'model-b', 'entry 4'), judgment(3, 'model-c', 'entry 12')],
    edit: ({ highest_probable, ...rest }) => rest,
    fields: ['highest_probable'],
  },
  {
    // An agreeing pair gives the code a probable and the third seat a question, so
    // both absences are drift, named in the order the report lists them.
    name: 'a dropped probable and question list name both fields',
    reports: [
      judgment(1, 'model-a', 'entry 4'),
      judgment(2, 'model-b', 'entry 4'),
      asked(3, 'model-c', 'where is the entry that shows it?'),
    ],
    edit: ({ highest_probable, questions, ...rest }) => rest,
    fields: ['highest_probable', 'questions'],
  },
];

test('the canonical grouping names a changed field and forgives a reordering', () => {
  for (const row of GROUPING_CASES) {
    const entries = recorded(row.reports);
    const report = assertValid(consolidateReports(entries, 1));
    const kept = row.edit(report);
    // Every row has to depart from the report, or it proves nothing: a row that only
    // reorders still changes the stored bytes, so a silent no-op edit would pass a
    // row whose fields say nothing changed.
    assert.notEqual(JSON.stringify(kept), JSON.stringify(report), `${row.name}: the fixture does not deviate`);
    entries.push(stored(4, kept));

    const problems = storedGroupingProblems(entries);
    assert.equal(problems.length, row.fields.length > 0 ? 1 : 0, row.name);
    if (row.fields.length === 0) continue;
    assert.equal(problems[0].kind, 'grouping_mismatch', row.name);
    assert.equal(problems[0].seq, 4, row.name);
    assert.equal(problems[0].move, 1, row.name);
    assert.deepEqual(problems[0].fields, row.fields, row.name);
  }
});

test('a delivery grouped from seat reports recorded out of seat order is not a problem', () => {
  // The record keeps the order the reports arrived in, so a delivery can be written
  // with seat 2's opinion first. Re-derived from the reports in seat order, the same
  // opinions come out differently listed; that is not a changed grouping.
  const entries = recorded([
    judgment(2, 'model-b', 'entry 12'),
    judgment(1, 'model-a', 'entry 4'),
    judgment(3, 'model-c', 'entry 4'),
  ]);
  const report = assertValid(consolidateReports(entries, 1));
  assert.deepEqual(report.opinions.map((opinion) => opinion.basis), [[12], [4]], 'the stored order followed the record, not the seats');
  entries.push(stored(4, report));

  assert.deepEqual(storedGroupingProblems(entries), []);
});

test('a delivery with fewer than three reports before it is a typed problem, never a pass', () => {
  const entries = recorded([judgment(1, 'model-a', 'entry 1'), judgment(2, 'model-b', 'entry 2')]);
  entries.push(
    stored(3, {
      move: 1,
      mmrc_model_id: MMRC,
      seats: ['model-a', 'model-b'],
      opinions: [],
      highest_probable: null,
      questions: [],
      derived: true,
    }),
  );

  const problems = storedGroupingProblems(entries);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, 'insufficient_reports');
});

test('a delivery is checked against the reports before it, not a later run\u2019s', () => {
  // The record is append-only, so a later panel run on the same move writes its three
  // reports after the delivery. That delivery was grouped from the reports in force
  // when it was written, and those are the ones the check must use.
  const first = recorded([judgment(1, 'model-a', 'entry 1'), judgment(2, 'model-b', 'entry 1'), judgment(3, 'model-c', 'entry 1')]);
  const firstReport = assertValid(consolidateReports(first, 1));
  const entries = [...first, stored(4, firstReport)];

  const later = recorded(
    [judgment(1, 'model-a', 'entry 2'), judgment(2, 'model-b', 'entry 2'), judgment(3, 'model-c', 'entry 2')],
    entries.length + 1,
  );
  entries.push(...later);
  const laterReport = assertValid(consolidateReports(later, 1));
  entries.push(stored(entries.length + 1, laterReport));

  assert.deepEqual(storedGroupingProblems(entries), [], 'each delivery is checked against the reports in force when it was written');
});

test('every drifted delivery is reported, not only the first', () => {
  // Every other record here holds at most one drifted delivery, so a check that
  // stopped at its first problem would pass them all. Two moves each get a delivery
  // that no longer groups the way its seat reports do, and both have to be named.
  const first = recorded([judgment(1, 'model-a', 'entry 4'), judgment(2, 'model-b', 'entry 4'), judgment(3, 'model-c', 'entry 12')]);
  const firstDrift = assertValid(consolidateReports(first, 1));
  firstDrift.opinions = firstDrift.opinions.map((opinion, index) =>
    index === 1 ? { ...opinion, support_count: 2, supporting_models: [...opinion.supporting_models, 'model-a'] } : opinion,
  );

  const secondFrom = first.length + 2;
  const second = recorded([judgment(1, 'model-a', 'entry 1'), judgment(2, 'model-b', 'entry 2'), judgment(3, 'model-c', 'entry 3')], secondFrom);
  for (const entry of second) entry.what.move = 2;
  const secondDrift = assertValid(consolidateReports(second, 2));
  secondDrift.highest_probable = secondDrift.opinions[0];

  const entries = [...first, stored(first.length + 1, firstDrift), ...second, stored(secondFrom + second.length, secondDrift)];

  const problems = storedGroupingProblems(entries);
  assert.deepEqual(problems.map((problem) => problem.seq), [first.length + 1, secondFrom + second.length]);
  assert.deepEqual(problems.map((problem) => problem.move), [1, 2], 'each problem is reported against its own move');
  assert.deepEqual(problems.map((problem) => problem.fields), [['opinions'], ['highest_probable']], 'each delivery names its own drift');
});
