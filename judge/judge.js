// The judge: reads the record's observable moves and writes what it observes.
//
// It is its own path through the provider seam — the Overseer's plug, never the
// Worker's — and it never touches a fact entry. What it adds is judgment entries
// and question entries, appended after the facts, labelled as what they are.
//
// The model is asked exactly one thing per move: whether the record shows the
// basis for it. If it does, the model writes the observation and this code writes
// a `judgment`. If it does not, no judgment is written and a `question` is written
// instead — because a judgment that needs something the record does not show is
// not a judgment this record can support.
//
// A question about a move that names no subject has no folder to sit in, and it is
// written anyway. Not writing it was the older behaviour and it was a hole: the
// move the judge declined left no trace at all, so the record could not show that
// the judge had looked and found nothing, and the move stayed in the queue to cost
// another call on every later run. An entry that belongs to no folder is a normal
// entry; a decision not to record something is not.
//
// The manner rule is enforced here, not trusted to the model: wording that
// directs stops the entry being written, and the run says which phrase did it.

import { call, notReadyReport, preflight, resolvePlug } from '../provider/index.js';
import { plugForSlot } from '../provider/routing.js';
import { makeEntry } from '../record/entry.js';
import { normalizeSubjectList } from '../record/folders.js';
import { judgeMessages, readJudgeReply } from './prompt.js';
import { directs } from './wording.js';

/** The Overseer's slot. The judge never runs on the Worker's plug. */
export const JUDGE_SLOT = 'overseer';
export const JUDGE_PLUG = plugForSlot(JUDGE_SLOT);

export const JUDGMENT_KIND = 'judgment';
export const QUESTION_KIND = 'question';

/** Moves that already have a judgment or a question naming them, by seq. */
export function alreadyNamed(entries) {
  const named = new Set();
  for (const entry of entries) {
    const what = entry.what ?? {};
    if (entry.label !== 'judgment' && entry.label !== 'question') continue;
    if (Number.isInteger(what.move)) named.add(what.move);
  }
  return named;
}

/**
 * The moves still worth judging: observed facts that nothing has named yet, in
 * record order. Asking the same judge about the same move twice would double the
 * record without doubling what it knows.
 */
export function movesToJudge(entries) {
  const named = alreadyNamed(entries);
  return entries.filter((entry) => entry.label === 'fact' && !named.has(entry.seq));
}

/**
 * The one move a caller named, resolved against the record.
 *
 * Only an observed fact can be judged, and only once: a judgment or a question
 * already naming it means this move has been answered, and judging it again would
 * add a line without adding anything known. Every refusal here is a fact about
 * the record, so it is reported rather than worked around.
 *
 * @returns {{move: object|null, problem: string|null}}
 */
export function moveBySeq(entries, seq) {
  const move = entries.find((entry) => entry.seq === seq) ?? null;

  if (!move) {
    return { move: null, problem: `the record has no entry with seq ${seq}` };
  }
  if (move.label !== 'fact') {
    return { move: null, problem: `seq ${seq} is a ${move.label}, not an observed move; only facts are judged` };
  }
  if (alreadyNamed(entries).has(seq)) {
    return { move: null, problem: `seq ${seq} already has a judgment or question naming it, so judging it again would double the record` };
  }

  return { move, problem: null };
}

/**
 * Judge every move that has not been judged yet.
 *
 * Refuses before anything is sent when the Overseer's plug is not callable, so a
 * missing Baseten key produces no call and no entry — the same discipline as the
 * prove commands.
 *
 * `limit` caps how many moves one run will judge, because a first live run
 * against a paid endpoint should be able to cost one call rather than all of
 * them. The moves it does not reach are left unjudged, not skipped: the next run
 * offers them again, in record order.
 *
 * `move` names exactly one move by its seq, for reading a single judgment before
 * spending on the rest. It is resolved against the record before the plug is
 * checked, so a sequence that cannot be judged is reported as a fact about the
 * record rather than hidden behind a missing key.
 *
 * @returns {Promise<{
 *   refused: null|{status: string, missing: string, keyProblem: string|null},
 *   problem: string|null,  why the named move could not be judged
 *   outcomes: Array<{seq: number, state: string, detail?: string}>,
 *   written: {judgments: number, questions: number},
 *   candidates: number,   how many moves this run attempted
 *   waiting: number,      how many were unjudged when it started
 * }>}
 */
export async function judgeMoves({ entries, env = process.env, fetchImpl = fetch, store, now = () => new Date(), limit = null, move = null }) {
  const waiting = movesToJudge(entries);
  const chosen = Number.isInteger(move) ? moveBySeq(entries, move) : null;
  const nothing = { outcomes: [], written: { judgments: 0, questions: 0 }, waiting: waiting.length };

  if (chosen?.problem) {
    return { refused: null, problem: chosen.problem, candidates: 0, ...nothing };
  }

  const ready = preflight(JUDGE_PLUG, env);

  if (!ready.ready) {
    // The same refusal the prove and task commands make, for the same reasons.
    const report = notReadyReport(resolvePlug(JUDGE_PLUG, env), ready);
    return {
      refused: { status: report.status, missing: report.primary, keyProblem: report.keyProblem },
      problem: null,
      outcomes: [],
      written: { judgments: 0, questions: 0 },
      candidates: 0,
      waiting: waiting.length,
    };
  }

  const candidates = chosen
    ? [chosen.move]
    : Number.isInteger(limit) && limit > 0
      ? waiting.slice(0, limit)
      : waiting;
  const outcomes = [];
  const written = { judgments: 0, questions: 0 };

  for (const move of candidates) {
    const sent = await call(JUDGE_PLUG, { messages: judgeMessages(move), env, fetchImpl });

    if (!sent.ok) {
      outcomes.push({ seq: move.seq, state: 'call-failed', detail: sent.error?.message ?? 'the call did not work' });
      continue;
    }

    const read = readJudgeReply(sent.text);
    if (read.error) {
      // Nothing is written from a reply that cannot be read: a guess here would
      // be this code's opinion wearing the model's name.
      outcomes.push({ seq: move.seq, state: 'unreadable', detail: read.error });
      continue;
    }

    const subjects = normalizeSubjectList(move.what?.subjects);
    const when = now().toISOString();
    const wording = read.basis === 'shown' ? read.observation : read.question;
    const direction = directs(wording);
    if (direction) {
      outcomes.push({ seq: move.seq, state: 'directed', detail: direction });
      continue;
    }

    if (read.basis === 'not-shown') {
      // Written whether or not the move names a subject. The entry still names the
      // move, so the question is anchored to the one thing that is certain about
      // it; a subject would only decide which folder reads it.
      await store.append(
        makeEntry({ when, label: 'question', what: { kind: QUESTION_KIND, move: move.seq, subjects, question: read.question } }),
      );
      written.questions += 1;
      outcomes.push(
        subjects.length === 0
          ? { seq: move.seq, state: 'asked-unfiled', detail: read.question }
          : { seq: move.seq, state: 'asked', detail: read.question },
      );
      continue;
    }

    await store.append(
      makeEntry({ when, label: 'judgment', what: { kind: JUDGMENT_KIND, move: move.seq, subjects, observation: read.observation } }),
    );
    written.judgments += 1;
    outcomes.push({ seq: move.seq, state: 'judged', detail: read.observation });
  }

  return { refused: null, problem: null, outcomes, written, candidates: candidates.length, waiting: waiting.length };
}
