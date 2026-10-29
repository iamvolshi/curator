// The pure grouping: one move's three seat reports, grouped into the strict
// delivery form.
//
// Grouping is by position and cited basis, never by wording. Two seats that
// justify the move from the same cited entries are one opinion, however they
// phrased it; two seats that say the same sentence from different entries are two.
// Support is counted by distinct model ID, so one model speaking twice is stacking,
// not independent agreement.
//
// This module judges nothing and calls nothing. It reads the three reports the
// record holds for the move, groups them, and says what the form would show. A
// move without three seat reports, or a report that cannot be read, is a typed
// failure and never a partial readout. Dissent is never averaged or merged: it
// stands as an edge grey, or as the gray box when nothing reaches a majority.
// The live MMRC call lives in mmrc.js and borrows this module's grouping.

import { citedEntries, fromASeat, majorityFor } from './readout.js';
import { SEATS } from './seats.js';
import { validateDelivery } from './delivery.js';

/** The two typed failures a consolidation can end in, besides a validation failure. */
export const CONSOLIDATION_FAILURES = Object.freeze({
  insufficientReports: 'insufficient_reports',
  malformedInput: 'malformed_input',
});

export function failure(kind, detail) {
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

/** One opinion, reduced to a comparable string: basis and support are sets. */
function opinionKey(opinion) {
  if (opinion === null || typeof opinion !== 'object') return JSON.stringify(opinion ?? null);
  return JSON.stringify({
    position: opinion.position ?? null,
    basis: Array.isArray(opinion.basis) ? [...opinion.basis].sort((a, b) => a - b) : (opinion.basis ?? null),
    support_count: opinion.support_count ?? null,
    supporting_models: [...(opinion.supporting_models ?? [])].sort(),
    status: opinion.status ?? null,
  });
}

/** One question, reduced to a comparable string. */
function questionKey(question) {
  return JSON.stringify([question?.seat_model_id ?? null, question?.question ?? null]);
}

/** A set-valued list, reduced to a comparable string: arrival order is not grouping. */
function setListKey(items, key) {
  return Array.isArray(items) ? JSON.stringify(items.map(key).sort()) : JSON.stringify(items ?? null);
}

/**
 * The grouping policy, one row per field, in report order.
 *
 * positional: whether list order is part of what the field says. Seats are
 * positional — the first entry is seat 1 — while opinions, bases, support lists
 * and questions are sets, so each is sorted before it is written down.
 *
 * absentEqualsEmpty: whether a report that never wrote the key says what the
 * empty value says. An absent question list reads as empty (no seat asked
 * anything) and an absent probable reads as null (no opinion is highest); an
 * absent opinion or seat list stays drift, because the page renders "Opinions 0"
 * from the list and seats name each judge. Absent is the only forgiven absence:
 * an explicit null is a value the grouping never produces, so it is drift even
 * where the absent key reads as empty. Whether the key is there is the
 * schema's business; this comparison asks only what the grouping says.
 *
 * inReply: whether the MMRC reply carries the field. The reply hands back only
 * opinions, highest_probable and questions; seats are checked on the stored path
 * alone, through this same table.
 */
const GROUPING_FIELDS = Object.freeze([
  {
    name: 'seats',
    positional: true,
    absentEqualsEmpty: false,
    inReply: false,
    emptyValue: [],
    canonical: (value) => (value === undefined ? undefined : JSON.stringify(value)),
  },
  {
    name: 'opinions',
    positional: false,
    absentEqualsEmpty: false,
    inReply: true,
    emptyValue: [],
    canonical: (value) => setListKey(value, opinionKey),
  },
  {
    name: 'highest_probable',
    positional: false,
    absentEqualsEmpty: true,
    inReply: true,
    emptyValue: null,
    canonical: (value) => opinionKey(value ?? null),
  },
  {
    name: 'questions',
    positional: false,
    absentEqualsEmpty: true,
    inReply: true,
    emptyValue: [],
    canonical: (value) => setListKey(value, questionKey),
  },
]);

/**
 * One report's grouping, reduced to a comparable string per field, as the
 * policy table above decides: absent keys read as the table's empty value only
 * where absentEqualsEmpty says so.
 */
function canonicalGrouping(report, { includeSeats = false } = {}) {
  const source = report ?? {};
  const out = {};
  for (const field of GROUPING_FIELDS) {
    if (field.name === 'seats' && !includeSeats) continue;
    const raw = source[field.name];
    const value = raw === undefined && field.absentEqualsEmpty ? field.emptyValue : raw;
    out[field.name] = field.canonical(value);
  }
  return out;
}

/**
 * The fields on which two reports' groupings differ, if any.
 *
 * One definition, used by the live reply check and the stored-report check, so a
 * reply the write path accepts is one the audit will not later call changed. The
 * live reply carries no seats, so it is compared without them; the stored check
 * passes includeSeats and gets all four fields from this same table.
 *
 * @param {object} a  a report body, or an MMRC reply carrying the reply fields
 * @param {object} b  the report body it is compared against
 * @returns {Array<string>} the grouping fields that differ, in report order
 */
export function groupingDifferences(a, b, { includeSeats = false } = {}) {
  const left = canonicalGrouping(a, { includeSeats });
  const right = canonicalGrouping(b, { includeSeats });
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
 * What counts as a changed grouping is the policy table above, shared with the
 * live reply check.
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

    // Every field, seats included, through the one policy table above — the same
    // definition the live reply check uses, so the audit cannot flag a reply the
    // write path would have accepted.
    const fields = groupingDifferences(what, grouped.body, { includeSeats: true });
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
