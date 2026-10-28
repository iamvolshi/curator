// The MMRC consolidation: one move's three seat reports, grouped into the strict
// delivery form.
//
// Grouping is by position and cited basis, never by wording. Two seats that
// justify the move from the same cited entries are one opinion, however they
// phrased it; two seats that say the same sentence from different entries are two.
// Support is counted by distinct model ID, so one model speaking twice is stacking,
// not independent agreement.
//
// This module judges nothing. It reads the three reports the record holds for the
// move, groups them, and says what the form would show. A move without three seat
// reports, or a report that cannot be read, is a typed failure and never a partial
// readout. Dissent is never averaged or merged: it stands as an edge grey, or as the
// gray box when nothing reaches a majority.

import { call } from '../provider/index.js';
import { plugForSlot } from '../provider/routing.js';
import { MMRC_MODEL_ID, MMRC_TEMPERATURE } from '../worker/config.js';
import { citedEntries, fromASeat, majorityFor } from './readout.js';
import { SEATS } from './seats.js';
import { validateDelivery } from './delivery.js';

/** The Muse plug the MMRC call runs on: the worker slot, which routes to meta. */
const MMRC_PLUG = plugForSlot('worker');

/** The typed failure a live MMRC call can end in, besides the ones above. */
export const MMRC_FAILURES = Object.freeze({
  callFailed: 'call_failed',
  unreadableReply: 'unreadable_reply',
  alteredGrouping: 'altered_grouping',
  unnamedModel: 'unnamed_model',
});

/**
 * The MMRC instruction. The grouping is already decided in code, so the model is
 * asked only to hand the same form back as JSON, and to change nothing in it.
 */
export const MMRC_SYSTEM = [
  'You are the MMRC consolidator for one move. Three seat reports have already been',
  'grouped by position and cited basis. Do not regroup, reword, add, or drop anything.',
  'Reply with one JSON object only, with exactly these keys: opinions, highest_probable,',
  'questions. Copy them from the form you are given, unchanged.',
].join(' ');

function mmrcMessages(body) {
  return [
    { role: 'system', content: MMRC_SYSTEM },
    { role: 'user', content: JSON.stringify(body) },
  ];
}

/** Read the JSON object the model returned, or say why it cannot be read. */
function readMmrcReply(text) {
  const raw = String(text ?? '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return { error: 'the reply carried no JSON object' };
  try {
    return { reply: JSON.parse(raw.slice(start, end + 1)) };
  } catch {
    return { error: 'the reply was not valid JSON' };
  }
}

/** The two typed failures a consolidation can end in, besides a validation failure. */
export const CONSOLIDATION_FAILURES = Object.freeze({
  insufficientReports: 'insufficient_reports',
  malformedInput: 'malformed_input',
});

function failure(kind, detail) {
  return { ok: false, kind, detail };
}

function modelOf(report) {
  const id = report.what?.model;
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : null;
}

/**
 * Whether one seat report can be read at all. A report the form cannot place is
 * malformed input, and the whole move fails rather than being consolidated without it.
 *
 * @returns {string|null} what is wrong, or null when the report can be read
 */
function unreadable(report) {
  const seat = report.what.seat;
  const numbered = report.what.numbered;
  if (!numbered || (numbered.basis !== 'shown' && numbered.basis !== 'not-shown')) {
    return `seat ${seat} has no readable basis answer`;
  }
  if (!modelOf(report)) return `seat ${seat} names no model, so its support cannot be counted`;

  if (report.label === 'judgment') {
    if (numbered.basis !== 'shown') return `seat ${seat} gave a judgment on a basis that is not shown`;
    if (typeof report.what.observation !== 'string' || report.what.observation.trim() === '') {
      return `seat ${seat} gave a judgment with no observation`;
    }
    if (citedEntries(numbered.pool).length === 0) return `seat ${seat} cites no entry for its basis`;
  } else {
    if (numbered.basis !== 'not-shown') return `seat ${seat} asked a question on a basis that is shown`;
    if (typeof report.what.question !== 'string' || report.what.question.trim() === '') {
      return `seat ${seat} asked a question with no text`;
    }
  }
  return null;
}

/**
 * Consolidate one move's three seat reports into the body of a delivery report.
 *
 * The body is everything the form holds except the MMRC model, which only the
 * model's own response can name. Pass it to deliveryFrom with that ID.
 *
 * @param {Array} entries   the record, oldest first
 * @param {number} move     the move seq to consolidate
 * @returns {{ok: true, body: object} | {ok: false, kind: string, detail: string}}
 */
export function consolidateReports(entries, move) {
  const reports = entries.filter((entry) => fromASeat(entry) && entry.what.move === move);
  const seats = [...new Set(reports.map((report) => report.what.seat))].sort((a, b) => a - b);

  if (seats.length !== reports.length) {
    return failure(CONSOLIDATION_FAILURES.malformedInput, 'a seat has more than one report for this move');
  }
  if (seats.length !== SEATS) {
    return failure(
      CONSOLIDATION_FAILURES.insufficientReports,
      `this move has ${seats.length} of ${SEATS} seat reports, so no consolidation is written`,
    );
  }

  for (const report of reports) {
    const problem = unreadable(report);
    if (problem) return failure(CONSOLIDATION_FAILURES.malformedInput, problem);
  }

  // Opinions: judgments grouped by position (always justified here) and cited basis.
  const groups = new Map();
  for (const report of reports.filter((r) => r.label === 'judgment')) {
    const basis = citedEntries(report.what.numbered.pool);
    const key = `justified|${basis.join(',')}`;
    if (!groups.has(key)) groups.set(key, { basis, models: [] });
    const group = groups.get(key);
    const id = modelOf(report);
    if (!group.models.includes(id)) group.models.push(id);
  }

  const opinions = [...groups.values()].map((group) => ({
    position: 'justified',
    basis: group.basis,
    support_count: group.models.length,
    supporting_models: group.models,
    status: 'gray_box',
  }));

  // The probable opinion: the most independent support, at least a majority of the
  // seats this move shows, and not a tie. Otherwise nothing is declared.
  const majority = majorityFor(seats.length);
  const top = Math.max(0, ...opinions.map((opinion) => opinion.support_count));
  const leaders = opinions.filter((opinion) => opinion.support_count === top);
  const probable = top >= majority && leaders.length === 1 ? leaders[0] : null;

  for (const opinion of opinions) {
    if (probable === null) opinion.status = 'gray_box';
    else opinion.status = opinion === probable ? 'highest_probable' : 'edge_grey';
  }

  // Questions stand as questions. A seat that asked took no position on the move.
  const questions = reports
    .filter((r) => r.label === 'question')
    .map((r) => ({ seat_model_id: modelOf(r), question: r.what.question.trim() }));

  const seatModels = reports
    .slice()
    .sort((a, b) => a.what.seat - b.what.seat)
    .map((r) => modelOf(r));

  return {
    ok: true,
    body: {
      move,
      seats: seatModels,
      opinions,
      highest_probable: probable,
      questions,
    },
  };
}

/**
 * Assemble a consolidated body into a delivery report, with the MMRC model the
 * response named, and check it against the schema before it is returned.
 *
 * @param {object} body          from consolidateReports
 * @param {string} mmrcModelId   the model ID from the MMRC response, never from config
 * @returns {{ok: true, report: object} | {ok: false, kind: string, detail: string}}
 */
export function deliveryFrom(body, mmrcModelId) {
  const report = {
    move: body.move,
    mmrc_model_id: mmrcModelId,
    seats: body.seats,
    opinions: body.opinions,
    highest_probable: body.highest_probable,
    questions: body.questions,
    derived: true,
  };
  const checked = validateDelivery(report);
  if (!checked.ok) return failure(checked.kind, checked.detail);
  return { ok: true, report };
}

/**
 * Consolidate one move live: group the seat reports in code, have the MMRC model
 * hand the same form back, then check that it changed nothing before the report is
 * written. The model ID in the report is the one the response named, never config.
 *
 * @param {Array} entries   the record, oldest first
 * @param {number} move     the move seq to consolidate
 * @param {object} [options]
 * @param {object} [options.env]       environment for the key lookup
 * @param {Function} [options.fetchImpl]
 * @returns {Promise<{ok: true, report: object} | {ok: false, kind: string, detail: string}>}
 */
export async function consolidateMove(entries, move, { env = process.env, fetchImpl = fetch } = {}) {
  const grouped = consolidateReports(entries, move);
  if (!grouped.ok) return grouped;

  const sent = await call(MMRC_PLUG, {
    messages: mmrcMessages(grouped.body),
    model: MMRC_MODEL_ID,
    temperature: MMRC_TEMPERATURE,
    env,
    fetchImpl,
  });
  if (!sent.ok) return failure(MMRC_FAILURES.callFailed, sent.error?.message ?? 'the MMRC call failed');

  const read = readMmrcReply(sent.text);
  if (read.error) return failure(MMRC_FAILURES.unreadableReply, read.error);

  // The grouping is decided in code. The model may only hand it back unchanged.
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (
    !same(read.reply.opinions, grouped.body.opinions) ||
    !same(read.reply.highest_probable, grouped.body.highest_probable) ||
    !same(read.reply.questions, grouped.body.questions)
  ) {
    return failure(MMRC_FAILURES.alteredGrouping, 'the MMRC reply changed the grouping it was given, so no report is written');
  }

  if (!sent.reportedModel) {
    return failure(MMRC_FAILURES.unnamedModel, 'the MMRC response named no model, so the report cannot say who answered');
  }

  return deliveryFrom(grouped.body, sent.reportedModel);
}
