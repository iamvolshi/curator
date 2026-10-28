import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storedSchemaProblems, validateDelivery } from '../judge/delivery.js';

const valid = () => ({
  move: 37,
  mmrc_model_id: 'consolidator-x',
  seats: ['model-a', 'model-b', 'model-c'],
  opinions: [
    {
      position: 'justified',
      basis: [12, 14],
      support_count: 2,
      supporting_models: ['model-a', 'model-b'],
      status: 'highest_probable',
    },
    {
      position: 'not_shown',
      basis: [],
      support_count: 1,
      supporting_models: ['model-c'],
      status: 'edge_grey',
    },
  ],
  highest_probable: {
    position: 'justified',
    basis: [12, 14],
    support_count: 2,
    supporting_models: ['model-a', 'model-b'],
    status: 'highest_probable',
  },
  questions: [],
  derived: true,
});

test('a valid delivery report validates', () => {
  assert.deepEqual(validateDelivery(valid()), { ok: true });
});

test('a missing field is a malformed report', () => {
  const r = valid();
  delete r.seats;
  assert.equal(validateDelivery(r).kind, 'malformed_report');
});

test('an extra field is a malformed report', () => {
  const r = { ...valid(), notes: 'extra' };
  assert.equal(validateDelivery(r).kind, 'malformed_report');
});

test('an opinion with no cited seat report is an uncited opinion', () => {
  const r = valid();
  r.opinions[1].supporting_models = [];
  assert.equal(validateDelivery(r).kind, 'uncited_opinion');
});

test('a basis that is not a list of entries is an invented basis', () => {
  const r = valid();
  r.opinions[0].basis = 'entry 12';
  assert.equal(validateDelivery(r).kind, 'invented_basis');
});

test('a question carrying an observation is a converted question', () => {
  const r = valid();
  r.questions = [{ seat_model_id: 'model-c', question: 'what shows it?', observation: 'it is shown' }];
  assert.equal(validateDelivery(r).kind, 'converted_question');
});

test('a verdict field is a forbidden field', () => {
  const r = { ...valid(), verdict: 'justified' };
  assert.equal(validateDelivery(r).kind, 'forbidden_field');
});

test('a count that repeats one model is malformed', () => {
  const r = valid();
  r.opinions[0].supporting_models = ['model-a', 'model-a'];
  r.opinions[0].support_count = 2;
  assert.equal(validateDelivery(r).kind, 'malformed_report');
});

/** A stored record line for a report body, labelled the way the record labels it. */
function stored(seq, report) {
  return { seq, label: 'delivery', what: { kind: 'delivery', ...report } };
}

test('a stored report whose opinions and questions match the schema is not a problem', () => {
  assert.deepEqual(storedSchemaProblems([stored(1, valid())]), []);
});

test('a stored opinion carrying a field the schema does not define is reported', () => {
  const report = valid();
  report.opinions[0].verdict = 'justified';

  assert.deepEqual(storedSchemaProblems([stored(9, report)]), [
    { seq: 9, move: 37, where: 'opinion 0', fields: ['verdict'] },
  ]);
});

test('a stored question carrying a field the schema does not define is reported', () => {
  const report = valid();
  report.questions = [{ seat_model_id: 'model-c', question: 'what shows it?', observation: 'it is shown' }];

  assert.deepEqual(storedSchemaProblems([stored(4, report)]), [
    { seq: 4, move: 37, where: 'question 0', fields: ['observation'] },
  ]);
});
