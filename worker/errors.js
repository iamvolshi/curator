// Telling failures apart, because they have different fixes.
//
// Meta's own error reference (https://dev.meta.ai/docs/error-handling) lists the
// status codes and error types this maps. A failure that is not recognised stays
// "unknown" rather than being filed under a guess, so a wrong guess never sends
// someone to fix the wrong thing.

export const KINDS = [
  'missing-key',
  'auth',
  'billing',
  'permission',
  'model',
  'endpoint',
  'rate-limit',
  'server',
  'timeout',
  'bad-request',
  'bad-response',
  'unknown',
];

const FIXES = {
  'missing-key': `put a Meta Model API key in MODEL_API_KEY — there is one in the Model API dashboard`,
  auth: 'the key was rejected: check it in the Model API dashboard, and check that MODEL_API_KEY holds the current value',
  billing: 'the account cannot be charged: check the balance and payment method in the Model API dashboard',
  permission: 'the key is real but not allowed to use this model or endpoint: check its access in the Model API dashboard',
  model: 'the API does not know that model id: correct MODEL_ID, or leave it unset to use the documented default',
  endpoint: 'the address or the connection is wrong: check the base URL and the network in between',
  'rate-limit': 'too many requests for now: wait, then retry',
  server: "the API's own side failed: retrying is reasonable",
  timeout: 'do not simply retry the same request, it will usually time out again: make it shorter, or stream it',
  'bad-request': 'the request was rejected: read the message and fix what was sent',
  'bad-response': 'the API answered, but not in the shape expected: read the message',
  unknown: 'read the message; this is not a failure the scaffold recognises',
};

// Only these two are worth sending again unchanged.
const RETRYABLE = new Set(['rate-limit', 'server']);

/**
 * Name a failure from whatever evidence the attempt produced.
 * Every argument is optional; whatever is known is used, in order of how
 * trustworthy it is. Returns { kind, retryable, fix, ... } — never throws.
 */
export function classifyFailure({
  httpStatus,
  apiType,
  apiCode,
  message,
  networkCode,
  timedOut,
} = {}) {
  const kind = pickKind({ httpStatus, apiType, apiCode, networkCode, timedOut });

  return {
    kind,
    retryable: RETRYABLE.has(kind),
    fix: FIXES[kind],
    httpStatus: httpStatus ?? null,
    apiType: apiType ?? null,
    apiCode: apiCode ?? null,
    message: message === undefined || message === null ? null : String(message),
  };
}

/**
 * A failure the caller already knows the name of, because it happened before
 * anything was sent: no key, nothing to ask, no reply in the answer.
 * Kept separate from classifyFailure so that function stays purely about
 * reading evidence, never about being told the answer.
 */
export function fixedFailure(kind, message, extra = {}) {
  if (!KINDS.includes(kind)) throw new Error(`unknown failure kind: ${kind}`);
  return {
    kind,
    retryable: RETRYABLE.has(kind),
    fix: FIXES[kind],
    httpStatus: null,
    apiType: null,
    apiCode: null,
    message: message === undefined || message === null ? null : String(message),
    ...extra,
  };
}

function pickKind({ httpStatus, apiType, apiCode, networkCode, timedOut }) {
  // A connection that never answered, or a request the server gave up on.
  if (timedOut) return 'timeout';
  if (networkCode) return 'endpoint';
  if (apiCode === 'gateway_timeout') return 'timeout';

  // The type is the stable field; the code fills in the detail.
  if (httpStatus === 401 || apiType === 'authentication_error' || apiCode === 'invalid_api_key') {
    return 'auth';
  }
  if (httpStatus === 402 || apiType === 'billing_error') return 'billing';
  if (httpStatus === 403) return 'permission';
  if (httpStatus === 404) {
    // A 404 with no error body is an unknown path; model_not_found is a real model problem.
    return apiCode === 'model_not_found' ? 'model' : 'endpoint';
  }
  if (httpStatus === 429 || apiType === 'rate_limit_error') return 'rate-limit';
  if (httpStatus === 400 || httpStatus === 413) return 'bad-request';
  if (httpStatus === 504) return 'timeout';
  if (httpStatus >= 500) return 'server';

  return 'unknown';
}

/** One plain sentence about a failure, safe to print. */
export function describeFailure(error) {
  if (!error) return 'no failure recorded';
  const status = error.httpStatus ? ` (HTTP ${error.httpStatus})` : '';
  return `${error.kind}${status} — ${error.fix}`;
}
