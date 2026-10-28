// The MMRC delivery report: the strict form one consolidated readout takes.
//
// This module checks a report's shape. It never reads the model's prose and it
// judges nothing. A report that does not match the schema is a typed failure,
// never a readout, so there is no freeform path and no verdict slot to fill.

/** The `what.kind` a delivery entry carries, beside the `delivery` label. */
export const DELIVERY_KIND = 'delivery';

export const POSITIONS = Object.freeze(['justified', 'not_shown']);
export const STATUSES = Object.freeze(['highest_probable', 'edge_grey', 'gray_box']);

const TOP_KEYS = ['move', 'mmrc_model_id', 'seats', 'opinions', 'highest_probable', 'questions', 'derived'];
const OPINION_KEYS = ['position', 'basis', 'support_count', 'supporting_models', 'status'];
const QUESTION_KEYS = ['seat_model_id', 'question'];

/** Keys a report may never carry: the form has no place for a verdict. */
export const FORBIDDEN_KEYS = Object.freeze(['verdict', 'consensus', 'confidence', 'summary', 'conclusion']);

function exactKeys(obj, expected) {
  const keys = Object.keys(obj);
  const extra = keys.filter((key) => !expected.includes(key));
  const missing = expected.filter((key) => !keys.includes(key));
  return { extra, missing };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(kind, detail) {
  return { ok: false, kind, detail };
}

/**
 * Check one delivery report against the schema.
 *
 * @returns {{ok: true} | {ok: false, kind: string, detail: string}}
 *   kind is one of: malformed_report, forbidden_field, uncited_opinion,
 *   invented_basis, converted_question
 */
export function validateDelivery(report) {
  if (!isPlainObject(report)) return fail('malformed_report', 'the report must be an object');

  for (const key of Object.keys(report)) {
    if (FORBIDDEN_KEYS.includes(key)) return fail('forbidden_field', `the report carries "${key}", which the form does not have`);
  }

  const top = exactKeys(report, TOP_KEYS);
  if (top.missing.length) return fail('malformed_report', `missing field: ${top.missing[0]}`);
  if (top.extra.length) return fail('malformed_report', `extra field: ${top.extra[0]}`);

  if (!Number.isInteger(report.move)) return fail('malformed_report', 'move must be an integer');
  if (typeof report.mmrc_model_id !== 'string' || report.mmrc_model_id.trim() === '') {
    return fail('malformed_report', 'mmrc_model_id must name the model that answered');
  }
  if (report.derived !== true) return fail('malformed_report', 'derived must be true');
  if (!Array.isArray(report.seats) || report.seats.length === 0) {
    return fail('malformed_report', 'seats must be a non-empty list of model IDs');
  }
  if (!Array.isArray(report.opinions)) return fail('malformed_report', 'opinions must be a list');
  if (!Array.isArray(report.questions)) return fail('malformed_report', 'questions must be a list');

  for (const [index, opinion] of report.opinions.entries()) {
    if (!isPlainObject(opinion)) return fail('malformed_report', `opinion ${index} must be an object`);
    const shape = exactKeys(opinion, OPINION_KEYS);
    if (shape.missing.length) return fail('malformed_report', `opinion ${index} is missing ${shape.missing[0]}`);
    if (shape.extra.length) return fail('malformed_report', `opinion ${index} has extra field ${shape.extra[0]}`);
    if (!POSITIONS.includes(opinion.position)) {
      return fail('malformed_report', `opinion ${index} position must be justified or not_shown`);
    }
    if (!STATUSES.includes(opinion.status)) return fail('malformed_report', `opinion ${index} has an unknown status`);
    if (!Array.isArray(opinion.supporting_models) || opinion.supporting_models.length === 0) {
      return fail('uncited_opinion', `opinion ${index} cites no seat report`);
    }
    if (!Array.isArray(opinion.basis)) return fail('invented_basis', `opinion ${index} basis must be a list of entry IDs`);
    const distinct = new Set(opinion.supporting_models);
    if (distinct.size !== opinion.supporting_models.length) {
      return fail('malformed_report', `opinion ${index} counts one model twice`);
    }
    if (opinion.support_count !== distinct.size) {
      return fail('malformed_report', `opinion ${index} support_count does not match its distinct models`);
    }
  }

  for (const [index, question] of report.questions.entries()) {
    if (!isPlainObject(question)) return fail('malformed_report', `question ${index} must be an object`);
    if ('observation' in question || 'judgment' in question) {
      return fail('converted_question', `question ${index} was converted to a judgment`);
    }
    const shape = exactKeys(question, QUESTION_KEYS);
    if (shape.missing.length || shape.extra.length) {
      return fail('malformed_report', `question ${index} must carry exactly seat_model_id and question`);
    }
  }

  if (report.highest_probable !== null) {
    if (!isPlainObject(report.highest_probable)) {
      return fail('malformed_report', 'highest_probable must be an opinion or null');
    }
    const probable = report.opinions.find((o) => o.status === 'highest_probable');
    if (!probable) return fail('malformed_report', 'highest_probable is set but no opinion is marked highest_probable');
  }

  return { ok: true };
}
