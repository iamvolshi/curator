// The judge panel: three seats read one move, and what they say is recorded.
//
// One move, one panel, and every seat's reading written as its own entry — three
// judgments for a three-seat panel, never one merged opinion and never a majority
// speaking for a minority. What the three add up to is decided somewhere else, by
// a view over the record (judge/readout.js), because a run that summarised its own
// panel would be a summary nobody could check.
//
// A judgment carries the model ID the response NAMED, and nothing else stands in
// for it. A response that names no model writes the judgment with the ID missing,
// and that opinion counts as zero independent support downstream: an opinion whose
// judge is unknown is not evidence of two judges agreeing.
//
// The manner rule is enforced per seat, exactly as the single judge enforces it. A
// seat whose reading directs the agent has produced nothing writable, so the bank
// gets its chance and nothing is written from the directive. Nothing the code
// writes is derived from it either — the record must not hold the direction.
//
// Failover never invents an opinion and never changes one: it fills an EMPTY seat,
// labels the substitution (which seat, which model left, which plug and model ID
// filled it), and only when the seat itself produced nothing. A bank plug offering
// the same model as the seat it would fill is skipped: the same judge twice is not
// a second judge, and recording it would look like agreement.
//
// All-or-nothing per move: a move whose panel cannot be completed writes nothing at
// all, and the run stops there rather than writing a two-seat panel that would read
// like a complete one. Moves already written before it stay written, and the report
// says exactly what was and was not recorded.

import { call } from '../provider/index.js';
import { makeEntry } from '../record/entry.js';
import { normalizeSubjectList } from '../record/folders.js';
import { consolidateMove } from './mmrc.js';
import { DELIVERY_KIND } from './delivery.js';
import { JUDGMENT_KIND, QUESTION_KIND, moveBySeq, movesToJudge } from './judge.js';
import { panelMessages, readPanelReply } from './prompt.js';
import { bankOption, panelConfig, panelProblem, seatEnv } from './seats.js';
import { directs } from './wording.js';

/** What one seat's attempt came to. */
export const SEAT_STATES = Object.freeze({
  opinion: 'opinion',
  asked: 'asked',
  unreadable: 'unreadable',
  callFailed: 'call-failed',
  directed: 'directed',
});

/** A seat that produced something writable: an opinion, or a question about the basis. */
const WRITABLE = new Set([SEAT_STATES.opinion, SEAT_STATES.asked]);

/** How a seat's failure is said when a bank plug fills it. */
export const SEAT_FAIL_WORDS = Object.freeze({
  [SEAT_STATES.callFailed]: 'the call did not work',
  [SEAT_STATES.unreadable]: 'the reply could not be read',
  [SEAT_STATES.directed]: 'the reading directed the agent, so it was refused',
});

/** The first phrase in any of the prose a seat writes that directs, or null. */
function directionIn(texts) {
  for (const text of texts) {
    const found = directs(text);
    if (found) return found;
  }
  return null;
}

/**
 * One call through one plug, and what came back.
 *
 * The model is the one asked for; the ID is the one the response named, kept apart
 * on purpose. Everything a seat does — reading, refusing a directive, asking for a
 * basis — is decided here, from the reply, and never from what the caller hoped to
 * get.
 */
async function ask({ plugName, model, env, move, fetchImpl }) {
  const sent = await call(plugName, { messages: panelMessages(move), model, env, fetchImpl });
  const base = { plug: plugName, model };

  if (!sent.ok) {
    return {
      ...base,
      state: SEAT_STATES.callFailed,
      id: null,
      detail: sent.error?.message ?? 'the call did not work',
      error: sent.error ?? null,
    };
  }

  const read = readPanelReply(sent.text);
  if (read.error) return { ...base, state: SEAT_STATES.unreadable, id: null, detail: read.error };

  // The evidence of who judged: the response's own model field, or nothing.
  const id = sent.reportedModel ?? null;
  const numbered = { deed: read.deed, pool: read.pool, basis: read.basis, topics: read.topics, sitting: read.question || 'none' };

  const direction = directionIn([read.deed, read.pool, ...read.topics, read.question]);
  if (direction) {
    return { ...base, state: SEAT_STATES.directed, id, detail: `the wording directed: ${direction}` };
  }

  if (read.basis === 'not-shown') {
    return { ...base, state: SEAT_STATES.asked, id, question: read.question, numbered };
  }

  return { ...base, state: SEAT_STATES.opinion, id, observation: read.observation, numbered };
}

/**
 * Seat one seat for one move, and say whether it had to be filled.
 *
 * @returns {Promise<{opinion: object|null, substitution: object|null, skips: Array, last: object}>}
 */
async function seatSeat({ seat, move, bank, env, fetchImpl, log }) {
  const first = await ask({ plugName: seat.plugName, model: seat.model, env: seatEnv(seat, env), move, fetchImpl });
  log.push({ seat: seat.seat, filled: false, ...first });

  if (WRITABLE.has(first.state)) return { opinion: first, substitution: null, skips: [], last: first };

  // The seat produced nothing writable, so the bank goes next, in the order given.
  const skips = [];
  const departedReason = `${SEAT_FAIL_WORDS[first.state]}${first.detail && first.state === SEAT_STATES.callFailed ? ` (${first.detail})` : ''}`;

  for (const name of bank) {
    const option = bankOption(name, env);

    if (!option.ready) {
      skips.push({ plug: name, why: option.problem });
      continue;
    }
    if (option.model === seat.model) {
      skips.push({
        plug: name,
        why: `it offers the same model as the seat (${option.model}), so a fill would be the same judge twice`,
      });
      continue;
    }

    const filled = await ask({ plugName: name, model: option.model, env, move, fetchImpl });
    log.push({ seat: seat.seat, filled: true, ...filled });

    if (WRITABLE.has(filled.state)) {
      return {
        opinion: filled,
        substitution: {
          seat: seat.seat,
          departed: seat.model,
          departedReason,
          plug: name,
          filledBy: filled.id ?? null,
        },
        skips,
        last: first,
      };
    }

    const why = `${SEAT_FAIL_WORDS[filled.state] ?? 'it produced nothing writable'}${filled.detail && filled.state === SEAT_STATES.callFailed ? ` (${filled.detail})` : ''}`;
    skips.push({ plug: name, why });
  }

  return { opinion: null, substitution: null, skips, last: first };
}

/**
 * Run the panel over the record's unjudged moves.
 *
 * @returns {Promise<{
 *   refused: null|object,     the panel itself is not seated: nothing was read or sent
 *   problem: string|null,     the named move cannot be judged
 *   waiting: number,          moves unjudged when it started
 *   candidates: number,       moves this run set out to seat
 *   outcomes: Array,          one per completed move: what each seat held
 *   attempts: Array,          every call the run made, in order
 *   written: {judgments: number, questions: number},
 *   stopped: null|object,     the move the run stopped at, and why
 * }>}
 */
export async function judgePanel({
  entries,
  env = process.env,
  fetchImpl = fetch,
  store,
  now = () => new Date(),
  limit = null,
  move = null,
  config = panelConfig(env),
} = {}) {
  const waiting = movesToJudge(entries);
  const refused = panelProblem(config, env);

  const empty = {
    problem: null,
    waiting: waiting.length,
    candidates: 0,
    outcomes: [],
    attempts: [],
    written: { judgments: 0, questions: 0 },
    stopped: null,
    seats: config.seats,
    bank: config.bank,
  };

  if (refused) return { ...empty, refused };

  const chosen = Number.isInteger(move) ? moveBySeq(entries, move) : null;
  const nothing = { ...empty, refused: null };
  if (chosen?.problem) return { ...nothing, problem: chosen.problem };

  const queue = chosen ? [chosen.move] : waiting;
  const candidates = Number.isInteger(limit) && limit > 0 ? queue.slice(0, limit) : queue;

  const outcomes = [];
  const attempts = [];
  const written = { judgments: 0, questions: 0 };
  let stopped = null;

  for (const seatedMove of candidates) {
    const panel = [];

    for (const seat of config.seats) {
      const seated = await seatSeat({ seat, move: seatedMove, bank: config.bank, env, fetchImpl, log: attempts });
      if (!seated.opinion) {
        stopped = {
          seq: seatedMove.seq,
          seat: seat.seat,
          plug: seat.plugName,
          model: seat.model,
          state: seated.last.state,
          detail: seated.last.detail ?? null,
          skips: seated.skips,
        };
        break;
      }
      panel.push({ seat, seated });
    }

    // Nothing was written for this move: a panel of two would read like a panel of
    // three, and the record must not look like it holds an opinion nobody gave.
    if (stopped) break;

    const subjects = normalizeSubjectList(seatedMove.what?.subjects);
    const seatEntries = [];

    // Written together, in seat order, once every seat has said something. The
    // entries are appended, never edited: a seat's reading is what it said.
    for (const { seat, seated } of panel) {
      const { opinion, substitution } = seated;
      const id = opinion.id;
      const when = now().toISOString();

      const stored = await store.append(
        makeEntry({
          when,
          label: opinion.state === SEAT_STATES.opinion ? 'judgment' : 'question',
          what: {
            kind: opinion.state === SEAT_STATES.opinion ? JUDGMENT_KIND : QUESTION_KIND,
            move: seatedMove.seq,
            subjects,
            seat: seat.seat,
            // The ID the response named. `modelIdMissing` is written instead when it
            // named none, so nothing downstream can count an unknown judge as one.
            model: id,
            ...(id ? {} : { modelIdMissing: true }),
            ...(substitution ? { substitution } : {}),
            ...(opinion.state === SEAT_STATES.opinion
              ? { observation: opinion.observation }
              : { question: opinion.question }),
            numbered: opinion.numbered,
          },
        }),
      );
      seatEntries.push(stored);

      if (opinion.state === SEAT_STATES.opinion) written.judgments += 1;
      else written.questions += 1;
    }

    // The MMRC consolidation runs over the three seat entries just written. A
    // failure here is reported on this move; it does not undo the seat entries,
    // which are what the seats said.
    const consolidated = await consolidateMove(seatEntries, seatedMove.seq, { env, fetchImpl });
    let consolidation;
    if (consolidated.ok) {
      await store.append(
        makeEntry({
          when: now().toISOString(),
          label: 'delivery',
          what: { kind: DELIVERY_KIND, ...consolidated.report },
        }),
      );
      consolidation = { state: 'written' };
    } else {
      consolidation = { state: 'failed', kind: consolidated.kind, detail: consolidated.detail };
    }

    outcomes.push({
      seq: seatedMove.seq,
      consolidation,
      seats: panel.map(({ seat, seated }) => ({
        seat: seat.seat,
        plug: seated.opinion.plug,
        model: seated.opinion.id,
        asked: seated.opinion.state === SEAT_STATES.asked,
        numbered: seated.opinion.numbered ?? null,
        substitution: seated.substitution,
      })),
    });
  }

  return {
    refused: null,
    problem: null,
    waiting: waiting.length,
    candidates: candidates.length,
    outcomes,
    attempts,
    written,
    stopped,
    seats: config.seats,
    bank: config.bank,
  };
}
