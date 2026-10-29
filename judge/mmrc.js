// The MMRC live call: one move's grouped form, handed to the model and back.
//
// The grouping is decided in code (see consolidate.js); the model is asked only
// to hand the same form back as JSON, and to change nothing in it. A reply that
// cannot be read, or that changes the grouping, is refused, and the model is
// asked once more with the exact error. After the cap it is a typed failure: a
// malformed delivery report is no readout, never a freeform one.

import { call } from '../provider/index.js';
import { plugForSlot } from '../provider/routing.js';
import { MMRC_MODEL_ID, MMRC_TEMPERATURE } from '../worker/config.js';
import { consolidateReports, deliveryFrom, failure, groupingDifferences } from './consolidate.js';

/** The Muse plug the MMRC call runs on: the worker slot, which routes to meta. */
const MMRC_PLUG = plugForSlot('worker');

/** The typed failure a live MMRC call can end in, besides the ones the grouping gives. */
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
 * where unchanged is the shared definition in consolidate.js, so a reply that
 * lists the same opinions and questions in another order, or the same cited
 * entries in another order, is the grouping it was given. A reply that cannot be
 * read, or that changes what the grouping says, is refused with the exact reason,
 * which the repair call carries back to the model.
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
