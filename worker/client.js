// One call to the Meta Model API — now a thin adapter over the provider seam.
//
// This module no longer talks to the network itself. It builds the Meta-shaped
// request, hands it to provider.call('meta', ...), and maps the result back to
// the shape the wrapper and the command line already expect. That is deliberate:
// the worker keeps its own vocabulary (a prompt in, a reply out) while there is
// exactly one way out of the process.
//
// Nothing about the Meta call changed in the move: same base URL, same key
// variable, same model, same request body, same failure taxonomy, and a call
// still never throws — a failure comes back as a result, because the wrapper has
// to be able to record it.

import {
  CHAT_COMPLETIONS_URL,
  REQUEST_TIMEOUT_MS,
  WORKER_NAME,
  resolveModel,
} from './config.js';
import { fixedFailure } from './errors.js';
import { buildChatRequest } from './request.js';
import { call as providerCall, preflight as plugPreflight } from '../provider/index.js';

/** The plug the Worker agent routes to. */
const WORKER_PLUG = 'meta';

/**
 * Call Muse Spark once with a short prompt.
 * Returns { ok, worker, endpoint, model, text, finishReason, usage, durationMs, error, warnings }.
 */
export async function runWorkerCall({
  prompt,
  model,
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  const chosenModel = resolveModel(model, env);
  const warnings = [];

  // Checked before the prompt is built, so a setup problem is reported as a setup
  // problem rather than as a bad request.
  const ready = plugPreflight(WORKER_PLUG, env);
  if (ready.warning) warnings.push(ready.warning);
  if (ready.problem) warnings.push(ready.problem);

  const base = {
    worker: WORKER_NAME,
    endpoint: `POST ${CHAT_COMPLETIONS_URL}`,
    model: chosenModel,
    text: null,
    finishReason: null,
    usage: null,
    durationMs: 0,
    warnings,
  };

  // Nothing was sent, so this is not a call failure — it is a setup problem,
  // and it is reported as one.
  if (!ready.ready) {
    return {
      ...base,
      ok: false,
      error: fixedFailure('missing-key', ready.problem),
      noCallMade: true,
    };
  }

  let body;
  try {
    body = buildChatRequest({ prompt, model: chosenModel }, env);
  } catch (err) {
    return {
      ...base,
      ok: false,
      error: fixedFailure('bad-request', err.message),
      noCallMade: true,
    };
  }

  const result = await providerCall(WORKER_PLUG, {
    messages: body.messages,
    model: body.model,
    env,
    fetchImpl,
    timeoutMs,
  });

  return {
    ...base,
    ok: result.ok === true,
    model: result.model ?? chosenModel,
    text: result.text ?? null,
    finishReason: result.finishReason ?? null,
    usage: result.usage ?? null,
    durationMs: result.durationMs ?? 0,
    error: result.error ?? null,
    warnings: [...warnings, ...(result.warnings ?? [])],
    // Kept absent on a call that was tried, exactly as before, so a reader is
    // never told nothing was sent when something was.
    ...(result.noCallMade ? { noCallMade: true } : {}),
  };
}

/** The setup problems worth catching before spending a call. */
export function preflight(env = process.env) {
  const ready = plugPreflight(WORKER_PLUG, env);
  return { ready: ready.ready, problem: ready.problem, warning: ready.warning, envVar: ready.envVar };
}
