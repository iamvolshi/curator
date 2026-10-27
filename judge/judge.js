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
 * Judge every move that has not been judged yet.
 *
 * Refuses before anything is sent when the Overseer's plug is not callable, so a
 * missing Baseten key produces no call and no entry — the same discipline as the
 * prove commands.
 *
 * @returns {Promise<{
 *   refused: null|{status: string, missing: string, keyProblem: string|null},
 *   outcomes: Array<{seq: number, state: string, detail?: string}>,
 *   written: {judgments: number, questions: number},
 *   candidates: number,
 * }>}
 */
export async function judgeMoves({ entries, env = process.env, fetchImpl = fetch, store, now = () => new Date() }) {
  const ready = preflight(JUDGE_PLUG, env);

  if (!ready.ready) {
    // The same refusal the prove and task commands make, for the same reasons.
    const report = notReadyReport(resolvePlug(JUDGE_PLUG, env), ready);
    return {
      refused: { status: report.status, missing: report.primary, keyProblem: report.keyProblem },
      outcomes: [],
      written: { judgments: 0, questions: 0 },
      candidates: 0,
    };
  }

  const candidates = movesToJudge(entries);
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
      // A question with no subject has no thread to sit in, so it is not written.
      if (subjects.length === 0) {
        outcomes.push({ seq: move.seq, state: 'nowhere-to-ask', detail: 'the move names no subject' });
        continue;
      }
      await store.append(
        makeEntry({ when, label: 'question', what: { kind: QUESTION_KIND, move: move.seq, subjects, question: read.question } }),
      );
      written.questions += 1;
      outcomes.push({ seq: move.seq, state: 'asked', detail: read.question });
      continue;
    }

    await store.append(
      makeEntry({ when, label: 'judgment', what: { kind: JUDGMENT_KIND, move: move.seq, subjects, observation: read.observation } }),
    );
    written.judgments += 1;
    outcomes.push({ seq: move.seq, state: 'judged', detail: read.observation });
  }

  return { refused: null, outcomes, written, candidates: candidates.length };
}
