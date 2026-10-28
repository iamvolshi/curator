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

// The three parts of a prompt live apart so there is one copy of each: the opening
// (who is reading), the choice (what to answer with), and the manner rule (how a
// reading may be worded). The judge and a seat in the panel get the same CHOICE and
// the same MANNER: the contract is one contract, and a seat that answered in a
// different shape would not be readable by the same reader.

/** The two-way choice, and what each answer means. */
const CHOICE = [
  'Answer with JSON only, no prose around it, in exactly this shape:',
  '{"basis": "shown" | "not-shown", "observation": "<one sentence>", "question": "<one sentence, or empty>"}',
  'Use "shown" when the move as recorded carries the basis for what it claims, and write `observation` as one sentence that says what it supports, what it contradicts, or what it bears on.',
  'Use "not-shown" when the basis for what this move claims is not in the record. Then leave `observation` empty and write `question` as one sentence asking what in the record shows that basis.',
];

/** The manner rule: a reading observes, and never directs. */
const MANNER = [
  // A question that names a mechanism is a design suggestion wearing a question
  // mark: "what hash chain anchors this?" presumes a hash chain is the answer.
  // The judge's job here is to ask for evidence, not to propose a fix.
  'A question asks for evidence, not for a change. Do not name a mechanism, technique, tool, or fix, do not propose what the record or the agent should contain, and do not ask for anything to be built, added, or rerun. Ask what shows or supports this move’s claim; never whether something should exist.',
  'Never address the other agent directly. Never use the words you, should, must, next, or recommend, in the observation or the question. No scores, no grades.',
];

/**
 * The numbered contract a panel seat answers in. Every question is answered, in
 * order, cited by its number. Q3 decides the basis (justified or not shown); Q4
 * names the intertopic links; Q5 is the sitting question, "none" when justified.
 */
export const NUMBERED_QUESTIONS = Object.freeze([
  'Q1: What did the worker do? (the deed, observable only)',
  'Q2: What in the record is it based on? (cite the basis entries by number)',
  'Q3: Does the basis justify the deed? Answer with exactly "justified" or "not shown", and nothing else.',
  'Q4: Which other topics does the basis touch? (name each topic, or "none")',
  'Q5: If the basis is not shown, what single question would show it? Otherwise answer "none".',
]);

export const NUMBERED_SYSTEM = [
  'Answer by number, in order, one line per question: "Q1: ..." through "Q5: ...". Every question is answered. No unnumbered prose, no JSON, no restating the move, no new questions. Example reply:',
  'Q1: The worker sent a refund request to the billing API.',
  'Q2: Entry 12, the customer approved the refund.',
  'Q3: justified',
  'Q4: none',
  'Q5: none',
  ...NUMBERED_QUESTIONS,
  ...MANNER,
].join('\n');

/** The single judge's system message. */
export const JUDGE_SYSTEM = [
  'You observe one recorded move made by another agent. You do not judge the agent, grade it, or tell it what to do.',
  ...CHOICE,
  ...MANNER,
].join('\n');

/**
 * A seat's system message: the same job, framed as an opinion contest.
 *
 * The framing is what the panel is for: a model offers its best reading when it is
 * trying to win one, and three judges hedging to the same safe middle would leave
 * the readout nothing to read. The contest changes the effort, not the job — the
 * choice, the manner rule and the reply reader are the judge's own, unchanged.
 */
export const PANEL_SYSTEM = [
  'You are one of three judges in an opinion contest. Each of you reads the same recorded move alone and gives its own reading; you cannot see the others’ answers, and they cannot see yours.',
  'You do not judge the agent, grade it, or tell it what to do. Your reading is compared with two others, so give the reading you would defend rather than the safe middle one.',
  ...CHOICE,
  ...MANNER,
].join('\n');

/**
 * One move, as the judge sees it: the call itself, and nothing about the record.
 *
 * The sequence number and the subject threads are the record's bookkeeping, not the
 * move's content. Put in the frame, they gave the readings something to comment on
 * other than the call (a seq number judged as if it were a claim), so they are left
 * out. The judge sees what was asked, what came back, and what it was sent to.
 */
export function describeMove(move) {
  const what = move.what ?? {};
  const lines = [
    `prompt: ${what.prompt ?? '(none)'}`,
    `outcome: ${what.ok === true ? 'the call worked' : 'the call did not work'}`,
  ];

  if (what.ok === true && what.response) lines.push(`reply: ${what.response}`);
  if (what.ok !== true && what.error?.message) lines.push(`error: ${what.error.message}`);
  if (what.endpoint) lines.push(`sent to: ${what.endpoint}`);
  if (what.model) lines.push(`model: ${what.model}`);

  return lines.join('\n');
}

export function judgeMessages(move) {
  return [
    { role: 'system', content: JUDGE_SYSTEM },
    { role: 'user', content: describeMove(move) },
  ];
}

/**
 * One seat's messages about one move.
 *
 * The same move description goes to every seat: a panel where each judge saw a
 * different framing of the move would be three experiments, not one panel. The
 * seat number is deliberately not in the prompt — a judge told which seat it holds
 * is being told something about itself, and the record is what it is here to read.
 */
export function panelMessages(move) {
  return [
    { role: 'system', content: PANEL_SYSTEM + '\n' + NUMBERED_SYSTEM },
    { role: 'user', content: describeMove(move) },
  ];
}

/**
 * Read a panel seat's numbered answer, or say why it cannot be read.
 *
 * Every Q1–Q5 must appear, in order, exactly once. Q3 must be "justified" or
 * "not shown". Q5 must be "none" when Q3 is justified, and a question otherwise.
 * Anything else is unreadable: the reply is recorded verbatim by the caller, and
 * it counts as no judgment and contributes no nodes or edges.
 */
export function readPanelReply(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

  const answers = {};
  for (const line of lines) {
    const match = /^Q([1-5]):\s*(.*)$/.exec(line);
    if (!match) return { error: 'the reply did not answer by number' };
    const key = `Q${match[1]}`;
    if (answers[key] !== undefined) return { error: `the reply answered ${key} twice` };
    answers[key] = match[2].trim();
  }

  for (let n = 1; n <= 5; n += 1) {
    if (answers[`Q${n}`] === undefined) return { error: `the reply did not answer Q${n}` };
    if (answers[`Q${n}`] === '' && n !== 4) return { error: `the reply left Q${n} empty` };
  }

  const basis = answers.Q3.toLowerCase().replace(/[.]+$/, '');
  if (basis !== 'justified' && basis !== 'not shown') {
    return { error: `Q3 did not say justified or not shown, it said ${JSON.stringify(answers.Q3)}` };
  }

  const sitting = answers.Q5.toLowerCase().replace(/[.]+$/, '');
  if (basis === 'justified' && sitting !== 'none') {
    return { error: 'Q3 is justified but Q5 asked a question' };
  }
  if (basis === 'not shown' && sitting === 'none') {
    return { error: 'Q3 is not shown but Q5 gave no question' };
  }

  return {
    basis: basis === 'justified' ? 'shown' : 'not-shown',
    deed: answers.Q1,
    pool: answers.Q2,
    topics: answers.Q4.toLowerCase() === 'none' ? [] : answers.Q4.split(/[,;]/).map((t) => t.trim()).filter(Boolean),
    observation: basis === 'justified' ? answers.Q1 : '',
    question: basis === 'not shown' ? answers.Q5 : '',
  };
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
