// What the judge is asked, and what a reply is allowed to say.
//
// These are pure: no store, no network, no key. The prompt is a contract the
// model is held to, so it is checked as text — the two-way choice, and the
// instruction not to direct. The reply reader is checked against every way a
// reply can be unusable, because an unreadable reply must write nothing rather
// than be guessed at. The directive table is checked from both sides: every
// phrase on it is caught, and every pattern in it still catches something, so a
// rule that quietly stopped working would show up here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readJudgeReply, judgeMessages } from '../judge/prompt.js';
import { DIRECTIVE_PATTERNS, directs } from '../judge/wording.js';

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

// A question that names a mechanism is a design suggestion wearing a question
// mark. The live run produced one — "what tamper-evident hash chain or digital
// signature anchors this entry?" — and the prompt as written allowed it, so the
// fix is in the prompt. This pins the constraint, because nothing else in the
// code can tell a request for evidence from a proposal.
test('the question is told to ask for evidence, not to propose a mechanism', () => {
  const system = judgeMessages({ seq: 1, what: {} })[0].content;

  assert.match(system, /A question asks for evidence, not for a change/, 'the question is scoped to evidence');
  assert.match(system, /Do not name a mechanism, technique, tool, or fix/, 'naming a mechanism is refused in so many words');
  assert.match(system, /asking what in the record shows that basis/, 'it asks what the record shows, not what should exist');
  assert.match(system, /in the observation or the question/, 'the banned words cover both fields, not just observations');
});
