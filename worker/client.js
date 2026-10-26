// One call to the Meta Model API.
//
// This function never throws. A failed call comes back as a result that says so,
// because the wrapper has to be able to record a failure too — a call that blew
// up is still something that happened, and losing it would be the exact hole
// this project exists to close.

import {
  CHAT_COMPLETIONS_URL,
  KEY_ENV_VAR,
  REQUEST_TIMEOUT_MS,
  WORKER_NAME,
  resolveModel,
} from './config.js';
import { classifyFailure, fixedFailure } from './errors.js';
import { readKey } from './key.js';
import { buildChatRequest } from './request.js';

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
  const { key, problem, warning } = readKey(env);
  if (warning) warnings.push(warning);
  if (problem) warnings.push(problem);

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
  if (!key) {
    return {
      ...base,
      ok: false,
      error: fixedFailure('missing-key', problem),
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

  const startedAt = Date.now();
  let response;
  try {
    response = await fetchImpl(CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err?.name === 'AbortError' || err?.code === 'ABORT_ERR';
    return {
      ...base,
      durationMs: Date.now() - startedAt,
      ok: false,
      error: classifyFailure({
        timedOut,
        networkCode: timedOut ? null : err?.code ?? err?.name,
        message: timedOut
          ? `no answer within ${timeoutMs} ms`
          : err?.message ?? String(err),
      }),
    };
  }

  const durationMs = Date.now() - startedAt;
  const rawText = await response.text();

  // Errors come back as an OpenAI-shaped envelope, but two documented cases do
  // not: an unknown path returns 404 with an empty body, and a few 400s on the
  // Files endpoints are plain text. So parsing is allowed to fail quietly.
  let parsed = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const apiError = parsed?.error ?? null;
    return {
      ...base,
      durationMs,
      ok: false,
      error: classifyFailure({
        httpStatus: response.status,
        apiType: apiError?.type,
        apiCode: apiError?.code,
        message: apiError?.message ?? (rawText || `HTTP ${response.status} with no body`),
      }),
    };
  }

  const choice = parsed?.choices?.[0] ?? null;
  const text = choice?.message?.content ?? null;

  if (typeof text !== 'string' || text.trim() === '') {
    return {
      ...base,
      durationMs,
      ok: false,
      error: fixedFailure(
        'bad-response',
        'the call was answered, but there was no reply text in the response',
        { httpStatus: response.status },
      ),
    };
  }

  return {
    ...base,
    durationMs,
    // The model the API says it used, not the one that was asked for.
    model: parsed?.model ?? chosenModel,
    ok: true,
    text,
    finishReason: choice?.finish_reason ?? null,
    usage: parsed?.usage ?? null,
    error: null,
  };
}

/** The setup problems worth catching before spending a call. */
export function preflight(env = process.env) {
  const { key, problem, warning } = readKey(env);
  return { ready: Boolean(key), problem, warning, envVar: KEY_ENV_VAR };
}
