// The wrapper.
//
// Every worker call goes through here. That is what makes it able to see every
// call and every result: there is no other path, so there is nothing to miss.
//
// It writes exactly one `fact` entry per attempt — one call in, one record out.
// The entry is filled in from what actually came back, never from what the
// caller expected, and a call that failed is recorded as faithfully as one that
// worked. The record is written before the result is handed to the caller, so a
// caller that ignores the result still cannot make the record disappear.

import { makeEntry } from '../record/entry.js';

/**
 * Run one worker call and record it.
 *
 * @param {object} options
 * @param {(request: {prompt: string}) => Promise<object>} options.call  the worker call
 * @param {string} options.prompt        what is being asked
 * @param {{append: Function}} options.store  the record store
 * @param {() => Date} [options.now]     clock, injectable so tests are steady
 * @param {() => number} [options.clock] timer, injectable for the same reason
 * @returns {Promise<{ok: boolean, entry: object, outcome: object|null, threw: Error|null}>}
 */
export async function wrapCall({
  call,
  prompt,
  store,
  now = () => new Date(),
  clock = Date.now,
} = {}) {
  if (typeof call !== 'function') {
    throw new Error('wrapCall needs a call function to wrap');
  }
  if (!store || typeof store.append !== 'function') {
    throw new Error('wrapCall needs a record store');
  }

  const when = now().toISOString();
  const startedAt = clock();
  let outcome = null;
  let threw = null;

  // A worker that throws must not take the caller down with it, and must not
  // produce a missing record either.
  try {
    outcome = await call({ prompt });
  } catch (err) {
    threw = err;
  }

  const durationMs = clock() - startedAt;
  const what = threw ? entryForThrow(threw, prompt, durationMs) : entryForOutcome(outcome, prompt, durationMs);

  const entry = makeEntry({ when, label: 'fact', what });
  const stored = await store.append(entry);

  return { ok: what.ok === true, entry: stored, outcome, threw };
}

function entryForOutcome(outcome, prompt, durationMs) {
  const result = outcome ?? {};
  return {
    kind: 'worker-call',
    worker: result.worker ?? null,
    endpoint: result.endpoint ?? null,
    model: result.model ?? null,
    prompt: String(prompt ?? ''),
    ok: result.ok === true,
    response: result.text ?? null,
    finishReason: result.finishReason ?? null,
    usage: result.usage ?? null,
    durationMs: result.durationMs ?? durationMs,
    error: result.error ?? null,
    warnings: result.warnings ?? [],
    // True when nothing was sent, so a reader is never told a call happened
    // when the setup stopped it first.
    noCallMade: result.noCallMade === true,
  };
}

function entryForThrow(err, prompt, durationMs) {
  return {
    kind: 'worker-call',
    worker: null,
    endpoint: null,
    model: null,
    prompt: String(prompt ?? ''),
    ok: false,
    response: null,
    finishReason: null,
    usage: null,
    durationMs,
    error: {
      kind: 'unknown',
      retryable: false,
      fix: 'the worker threw instead of returning a result; fix the worker so it reports failures as results',
      httpStatus: null,
      apiType: null,
      apiCode: null,
      message: err?.message ?? String(err),
    },
    warnings: [],
    noCallMade: true,
  };
}
