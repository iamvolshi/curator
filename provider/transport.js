// The only place in this app that touches the network.
//
// Everything else — the worker call path, the status command, every plug — goes
// through these two functions. That is what makes "there is one seam" a fact
// instead of a convention: the offline checks assert that no other file calls
// fetch at all.
//
// This code was moved here unchanged from the Meta call path, so the behaviour of
// that path is exactly what it was: the same request, the same reply reading, and
// the same failure classification.

import { classifyFailure } from '../worker/errors.js';

/**
 * POST a JSON body and come back with a result that describes what happened.
 * Never throws: a broken connection is a result too, and it has to be recordable.
 */
export async function sendJson({ url, headers, body, timeoutMs, fetchImpl = fetch }) {
  const startedAt = Date.now();
  let response;
  let rawText;

  // The body is read inside the same try: a timeout can fire while the reply is
  // still arriving, and that must come back as a result, not a thrown error.
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    rawText = await response.text();
  } catch (err) {
    // AbortSignal.timeout rejects with TimeoutError, not AbortError.
    const timedOut = err?.name === 'AbortError' || err?.name === 'TimeoutError' || err?.code === 'ABORT_ERR';
    return {
      ok: false,
      status: null,
      durationMs: Date.now() - startedAt,
      parsed: null,
      error: classifyFailure({
        timedOut,
        networkCode: timedOut ? null : err?.code ?? err?.name,
        message: timedOut ? `no answer within ${timeoutMs} ms` : err?.message ?? String(err),
      }),
    };
  }

  const durationMs = Date.now() - startedAt;

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
      ok: false,
      status: response.status,
      durationMs,
      parsed,
      error: classifyFailure({
        httpStatus: response.status,
        apiType: apiError?.type,
        apiCode: apiError?.code,
        message: apiError?.message ?? (rawText || `HTTP ${response.status} with no body`),
      }),
    };
  }

  return { ok: true, status: response.status, durationMs, parsed, error: null };
}

/** A plain GET, for the key-free reachability check. Never throws. */
export async function sendGet({ url, timeoutMs, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.text();
    return { ok: response.ok, status: response.status, body, error: null };
  } catch (err) {
    return { ok: false, status: null, body: null, error: err?.message ?? String(err) };
  }
}
