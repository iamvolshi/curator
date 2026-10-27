// Shade: counted, never judged.
//
// Every assertion here is one line of the rule: 0 with no supports, +1 per
// independent support, cap at 9, 8-9 is the black band, a repeated move does not
// stack, a judgment darkens nothing, a question darkens nothing, and the count
// beats any stored number that disagrees with it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BLACK_BAND, MAX_SHADE, recomputeShades, shadeFor, supportingFacts } from '../record/shades.js';

const when = '2026-10-27T02:00:00.000Z';

let seq = 0;

/** A fact about a subject. Each prompt is a distinct move. */
function fact(prompt, subjects, overrides = {}) {
  seq += 1;
  return {
    seq,
    when,
    label: 'fact',
    what: {
      kind: 'worker-call',
      worker: 'meta-model-api',
      endpoint: 'POST https://api.meta.ai/v1/chat/completions',
      prompt,
      ok: true,
      response: 'an answer',
      ...overrides,
      ...(Array.isArray(subjects) ? { subjects } : {}),
    },
  };
}

function judgment(subjects, move) {
  seq += 1;
  return { seq, when, label: 'judgment', what: { kind: 'judgment', move, subjects, observation: 'the result supports it' } };
}

function question(subjects) {
  seq += 1;
  return { seq, when, label: 'question', what: { kind: 'question', subjects, question: 'what else supports this?' } };
}

const SUBJECT = 'Ada Okafor';

test('a subject starts white, and each independent fact darkens it by one', () => {
  assert.equal(shadeFor([], SUBJECT).shade, 0, 'nothing recorded, nothing supported');

  const one = shadeFor([fact('move one', [SUBJECT])], SUBJECT);
  assert.equal(one.shade, 1);
  assert.equal(one.band, 'grey');

  const three = shadeFor(
    [fact('move one', [SUBJECT]), fact('move two', [SUBJECT]), fact('move three', [SUBJECT])],
    SUBJECT,
  );
  assert.equal(three.shade, 3);
  assert.equal(three.supports, 3);
});

test('the shade stops at nine, while the count keeps being true', () => {
  const facts = Array.from({ length: 12 }, (_, i) => fact(`move ${i}`, [SUBJECT]));
  const shade = shadeFor(facts, SUBJECT);

  assert.equal(shade.shade, MAX_SHADE, 'capped at 9');
  assert.equal(shade.supports, 12, 'twelve supports happened, and the shade says nine');
  assert.equal(shade.maxed, true);
});

test('eight is the black band, and seven is not', () => {
  const seven = Array.from({ length: 7 }, (_, i) => fact(`move ${i}`, [SUBJECT]));
  const eight = Array.from({ length: 8 }, (_, i) => fact(`move ${i}`, [SUBJECT]));

  assert.equal(shadeFor(seven, SUBJECT).band, 'grey');
  assert.equal(shadeFor(seven, SUBJECT).shade, BLACK_BAND - 1);
  assert.equal(shadeFor(eight, SUBJECT).band, 'black');
  assert.equal(shadeFor(eight, SUBJECT).shade, BLACK_BAND);
});

test('the same move repeated counts once', () => {
  const repeated = [
    fact('the very same question', [SUBJECT]),
    fact('the very same question', [SUBJECT]),
    fact('the very same question', [SUBJECT]),
  ];

  const shade = shadeFor(repeated, SUBJECT);
  assert.equal(shade.supports, 1, 'three calls of one move are one support');
  assert.equal(shade.shade, 1);
});

test('the same question put to a different address is a different move', () => {
  const two = [
    fact('the very same question', [SUBJECT]),
    fact('the very same question', [SUBJECT], { endpoint: 'POST https://openrouter.ai/api/v1/chat/completions' }),
  ];
  assert.equal(shadeFor(two, SUBJECT).supports, 2);
});

test('a judgment darkens nothing, and a question darkens nothing', () => {
  const record = [fact('one move', [SUBJECT]), judgment([SUBJECT], 1), question([SUBJECT]), judgment([SUBJECT], 1)];

  const shade = shadeFor(record, SUBJECT);
  assert.equal(shade.shade, 1, 'only the fact counts');
  assert.equal(supportingFacts(record, SUBJECT).length, 1);
});

test('a fact about another subject does not darken this one', () => {
  const record = [fact('about Ada', [SUBJECT]), fact('about Lagos', ['Lagos'])];
  assert.equal(shadeFor(record, SUBJECT).shade, 1);
  assert.equal(shadeFor(record, 'Lagos').shade, 1);
});

test('recomputation reproduces a stored shade, and the count wins when it does not', () => {
  const record = [fact('one move', [SUBJECT]), fact('two move', [SUBJECT])];

  const agreeing = recomputeShades(record, [{ subject: SUBJECT, shade: 2 }]);
  assert.equal(agreeing[0].shade, 2);
  assert.equal(agreeing[0].disagrees, false);

  const stale = recomputeShades(record, [{ subject: SUBJECT, shade: 7 }]);
  assert.equal(stale[0].shade, 2, 'the counted shade is what is reported');
  assert.equal(stale[0].stored, 7, 'the disagreement is named rather than hidden');
  assert.equal(stale[0].disagrees, true);

  const ghost = recomputeShades(record, [{ subject: 'Nobody Recorded', shade: 9 }]);
  assert.equal(ghost.find((s) => s.subject === 'Nobody Recorded').shade, 0, 'a stored shade with no facts is zero');
  assert.equal(ghost.find((s) => s.subject === 'Nobody Recorded').disagrees, true);
});
