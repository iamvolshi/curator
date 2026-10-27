// What the judge is asked, and how its answer is read.
//
// The model is asked for one of two things, and nothing else:
//   - `shown`: the record shows the basis for the move, so the judge observes it;
//   - `not-shown`: the record does not show the basis, so no judgment is written
//     and a question is written in its place.
//
// That choice is the model's, because only it is reading the move's content. What
// it does NOT choose is the label, the entry shape, the subjects, or whether the
// entry is written at all — those are decided here and in judge.js, from the
// record. A model that answered "true" or "8/10" would still produce a labelled
// observation, because the shape is not something it supplies.

/** The system message: manner, and the two-way choice. */
const SYSTEM = [
  'You observe one recorded move made by another agent. You do not judge the agent, grade it, or tell it what to do.',
  'Answer with JSON only, no prose around it, in exactly this shape:',
  '{"basis": "shown" | "not-shown", "observation": "<one sentence>", "question": "<one sentence, or empty>"}',
  'Use "shown" when the move as recorded carries the basis for what it claims, and write `observation` as one sentence that says what it supports, what it contradicts, or what it bears on.',
  'Use "not-shown" when the basis for what this move claims is not in the record. Then leave `observation` empty and write `question` as one sentence asking what in the record shows that basis.',
  // A question that names a mechanism is a design suggestion wearing a question
  // mark: "what hash chain anchors this?" presumes a hash chain is the answer.
  // The judge's job here is to ask for evidence, not to propose a fix.
  'A question asks for evidence, not for a change. Do not name a mechanism, technique, tool, or fix, do not propose what the record or the agent should contain, and do not ask for anything to be built, added, or rerun. Ask what shows or supports this move’s claim; never whether something should exist.',
  'Never address the other agent directly. Never use the words you, should, must, next, or recommend, in the observation or the question. No scores, no grades.',
].join('\n');

/** One move, as the judge sees it. */
export function describeMove(move) {
  const what = move.what ?? {};
  const lines = [
    `move: seq ${move.seq}`,
    `prompt: ${what.prompt ?? '(none)'}`,
    `outcome: ${what.ok === true ? 'the call worked' : 'the call did not work'}`,
  ];

  if (what.ok === true && what.response) lines.push(`reply: ${what.response}`);
  if (what.ok !== true && what.error?.message) lines.push(`error: ${what.error.message}`);
  if (what.endpoint) lines.push(`sent to: ${what.endpoint}`);
  if (what.model) lines.push(`model: ${what.model}`);
  if (Array.isArray(what.subjects) && what.subjects.length) lines.push(`about: ${what.subjects.join(', ')}`);

  return lines.join('\n');
}

export function judgeMessages(move) {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: describeMove(move) },
  ];
}

/**
 * Read the judge's answer, or say why it cannot be read.
 *
 * Anything other than the two-way shape is reported as unreadable, not guessed
 * at: a judgment invented from a malformed reply would be this code's opinion
 * wearing the model's name.
 */
export function readJudgeReply(text) {
  const raw = String(text ?? '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return { error: 'the reply carried no JSON object' };

  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { error: 'the reply was not valid JSON' };
  }

  const basis = typeof parsed.basis === 'string' ? parsed.basis.trim() : '';
  const observation = typeof parsed.observation === 'string' ? parsed.observation.trim() : '';
  const question = typeof parsed.question === 'string' ? parsed.question.trim() : '';

  if (basis !== 'shown' && basis !== 'not-shown') {
    return { error: `the reply did not choose a basis, it said ${JSON.stringify(basis)}` };
  }
  if (basis === 'shown' && observation === '') {
    return { error: 'the reply said the basis is shown but gave no observation' };
  }
  if (basis === 'not-shown' && question === '') {
    return { error: 'the reply said the basis is not shown but asked nothing' };
  }

  return { basis, observation, question };
}
