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

/**
 * How many times the MMRC model is asked for one move: the call, then at most one
 * repair. The cap is what stops a model that will not format from being asked
 * forever, and it keeps the repair from becoming a second opinion.
 */
export const MMRC_MAX_ATTEMPTS = 2;

/**
 * Ask for the same form back, and — on a repair — say exactly what was refused.
 * The form is sent again with it, so the model has both sides of the complaint.
 */
function mmrcMessages(body, refused = null) {
  const messages = [
    { role: 'system', content: MMRC_SYSTEM },
    { role: 'user', content: JSON.stringify(body) },
  ];
  if (refused) {
    messages.push({
      role: 'user',
      content: `Your previous reply was refused: ${refused.detail}. Return the form above unchanged, as one JSON object with exactly the keys opinions, highest_probable and questions.`,
    });
  }
  return messages;
}

/**
 * Read the JSON object the model returned, or say why it cannot be read.
 *
 * Local repair first: a reply wrapped in a code fence still holds the form, so the
 * fence is stripped here rather than spending a model call to strip it.
 */
function readMmrcReply(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(String(text ?? ''));
  const raw = fenced ? fenced[1] : String(text ?? '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return { error: 'the reply carried no JSON object' };
  try {
    return { reply: JSON.parse(raw.slice(start, end + 1)) };
  } catch {
    return { error: 'the reply was not valid JSON' };
  }
}

/**
 * Check one reply against the grouping it was given.
 *
 * The grouping is decided in code; the model may only hand it back unchanged —
 * where unchanged is the shared definition below, so a reply that lists the same
 * opinions and questions in another order, or the same cited entries in another
 * order, is the grouping it was given. A reply that cannot be read, or that changes
 * what the grouping says, is refused with the exact reason, which the repair call
 * carries back to the model.
 */
function checkMmrcReply(text, body) {
  const read = readMmrcReply(text);
  if (read.error) return { ok: false, kind: MMRC_FAILURES.unreadableReply, detail: read.error };

  const changed = groupingDifferences(read.reply, body);
  if (changed.length > 0) {
    return {
      ok: false,
      kind: MMRC_FAILURES.alteredGrouping,
      detail: `the MMRC reply changed the grouping it was given (${changed.join(', ')})`,
    };
  }
  return { ok: true };
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
 * One report's grouping, reduced to a comparable string per field.
 *
 * Order is not part of a grouping: opinions and questions are listed in the order
 * the seat reports arrived, a basis is a set of entries, and a support list is a
 * set of judges, so each is sorted before it is written down. Where an opinion sits
 * in the list is not part of what it says either; the sorted list of opinions is.
 *
 * An absent question list is read as an empty one: when no seat asked anything, a
 * report that never wrote the key says what the empty list says, so the absence is
 * not a changed grouping. Whether the key is there is the schema's business; this
 * comparison asks only what the grouping says.
 */
function canonicalGrouping(report) {
  const opinionKey = (opinion) => {
    if (opinion === null || typeof opinion !== 'object') return JSON.stringify(opinion ?? null);
    return JSON.stringify({
      position: opinion.position ?? null,
      basis: Array.isArray(opinion.basis) ? [...opinion.basis].sort((a, b) => a - b) : (opinion.basis ?? null),
      support_count: opinion.support_count ?? null,
      supporting_models: [...(opinion.supporting_models ?? [])].sort(),
      status: opinion.status ?? null,
    });
  };
  const listKey = (items, key) =>
    Array.isArray(items) ? JSON.stringify(items.map(key).sort()) : JSON.stringify(items ?? null);

  return {
    opinions: listKey(report?.opinions, opinionKey),
    highest_probable: opinionKey(report?.highest_probable ?? null),
    questions: listKey(report?.questions ?? [], (question) =>
      JSON.stringify([question?.seat_model_id ?? null, question?.question ?? null]),
    ),
  };
}

/**
 * The fields on which two reports' groupings differ, if any.
 *
 * One definition, used by the live reply check and the stored-report check, so a
 * reply the write path accepts is one the audit will not later call changed. The
 * report's seats are positional and are compared by the caller.
 *
 * @param {object} a  a report body, or an MMRC reply carrying the same three fields
 * @param {object} b  the report body it is compared against
 * @returns {Array<string>} the grouping fields that differ, in report order
 */
function groupingDifferences(a, b) {
  const left = canonicalGrouping(a);
  const right = canonicalGrouping(b);
  return Object.keys(left).filter((field) => left[field] !== right[field]);
}

/**
 * Every stored delivery in the record, checked against the grouping its seat
 * reports give today.
 *
 * A delivery is written once, from the three reports the panel had just written.
 * The record is append-only, so those reports are still there — earlier in the file
 * than the delivery, one per seat — and later entries cannot change them. Re-grouping
 * them now, with the code that reads a cited Q2 today, has to give the same opinions,
 * support counts, statuses and questions the report holds. If it does not, the report
 * and the record have parted ways: the page would show a grouping this code would no
 * longer produce.
 *
 * A move that no longer offers the three reports the delivery was written from is a
 * typed failure rather than a pass: nothing in the record can confirm the grouping.
 *
 * Order is not part of a grouping. The report lists opinions and questions in the
 * order the seat reports arrived — the record's order, not the seats' — and a basis
 * is a set of entries, so the same entries cited in another order are the same
 * basis. Only a changed opinion, count, status or question is a problem, decided by
 * the same definition the live reply check uses.
 *
 * @param {Array} entries the record, oldest first
 * @returns {Array<object>} one entry per delivery that no longer matches — its seq,
 *   its move, and either the typed failure or the fields that differ
 */
export function storedGroupingProblems(entries) {
  const problems = [];

  for (const [index, delivery] of entries.entries()) {
    if (delivery.label !== 'delivery') continue;
    const what = delivery.what ?? {};
    const move = what.move;

    // The latest report per seat before the delivery: exactly the three the
    // consolidator was handed, in seat order, even when a later run wrote more.
    const latest = new Map();
    for (const entry of entries.slice(0, index)) {
      if (!fromASeat(entry) || entry.what.move !== move) continue;
      latest.set(entry.what.seat, entry);
    }
    const inputs = [...latest.values()].sort((a, b) => a.what.seat - b.what.seat);

    const grouped = consolidateReports(inputs, move);
    if (!grouped.ok) {
      problems.push({ seq: delivery.seq, move, kind: grouped.kind, detail: grouped.detail });
      continue;
    }

    // The seats are positional — the first is seat 1 — so their order is compared.
    // The grouping itself is not positional: one shared definition decides that, the
    // same one the live reply check uses, so the audit cannot flag a reply the write
    // path would have accepted.
    const fields = [
      ...(JSON.stringify(grouped.body.seats) !== JSON.stringify(what.seats) ? ['seats'] : []),
      ...groupingDifferences(what, grouped.body),
    ];
    if (fields.length > 0) {
      problems.push({
        seq: delivery.seq,
        move,
        kind: 'grouping_mismatch',
        fields,
        detail: `the seat reports group differently today (${fields.join(', ')})`,
      });
    }
  }

  return problems;
}

/**
 * One line a reader can act on: what a stored delivery no longer matches.
 *
 * Shared by the command's output and the page, so the terminal and the file cannot
 * describe one record differently.
 */
export function describeGroupingProblem(problem) {
  if (problem.kind !== 'grouping_mismatch') return `${problem.kind}: ${problem.detail}`;
  return `the seat reports group differently today (${problem.fields.join(', ')})`;
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
 * A reply that cannot be read or that changes the form is refused, and the model is
 * asked once more with the exact error. After the cap it is a typed failure: a
 * malformed delivery report is no readout, never a freeform one.
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

  // The repair ladder: ask, check, and on a refusal ask once more with the exact
  // error. A transport failure is not a formatting error, so it is not retried.
  let refused = null;
  for (let attempt = 1; attempt <= MMRC_MAX_ATTEMPTS; attempt += 1) {
    const sent = await call(MMRC_PLUG, {
      messages: mmrcMessages(grouped.body, refused),
      model: MMRC_MODEL_ID,
      temperature: MMRC_TEMPERATURE,
      env,
      fetchImpl,
    });
    if (!sent.ok) return failure(MMRC_FAILURES.callFailed, sent.error?.message ?? 'the MMRC call failed');

    // Only the response can name who answered, and a repair cannot supply it, so
    // an unnamed reply stops here rather than spending the second attempt.
    if (!sent.reportedModel) {
      return failure(MMRC_FAILURES.unnamedModel, 'the MMRC response named no model, so the report cannot say who answered');
    }

    const checked = checkMmrcReply(sent.text, grouped.body);
    if (checked.ok) return deliveryFrom(grouped.body, sent.reportedModel);

    refused = checked;
  }

  return failure(refused.kind, `${refused.detail} (after ${MMRC_MAX_ATTEMPTS} attempts, so no report is written)`);
}
