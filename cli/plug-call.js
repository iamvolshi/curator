// One call through any plug, shaped the way the wrapper records it.
//
// The Worker's own plug has a richer path (worker/client.js): it builds a
// Meta-shaped request and keeps the worker's vocabulary, a prompt in and a reply
// out. This is the plain path for every other plug — one short message in,
// whatever came back out — and it exists so a plug can be proven on its own.
// "This plug works" is only worth anything when a real call returned, and only a
// call on that plug can answer it.
//
// Everything about the request comes from the plug: its address, its key
// variable, its model. Nothing is written out again here, so there is no second
// copy to drift from the first.
//
// The caller names the kind, because two different things come through here: a
// plug being checked ('plug-prove') and a plug doing real work ('plug-task').
// Either way it is not 'worker-call', so a reader of the record can tell a call
// on another plug apart from the Worker agent working. They are different things
// and the record says which happened.

import { call, resolvePlug } from '../provider/index.js';
import { fixedFailure } from '../worker/errors.js';

/** The record kind a plug prove writes. Never used for the Worker's own calls. */
export const PROVE_KIND = 'plug-prove';

/** The record kind real work through a plug writes. Not a proof of anything. */
export const TASK_KIND = 'plug-task';

/**
 * Make one short call through one named plug.
 * Returns the shape the wrapper records: { kind, plug, role, ok, text, error, … }.
 * Never throws for a call that was tried — the seam reports failures as results.
 */
export async function runPlugCall(name, { prompt, env = process.env, fetchImpl = fetch, kind = PROVE_KIND } = {}) {
  const plug = resolvePlug(name, env);
  const text = String(prompt ?? '').trim();

  const base = {
    kind,
    plug: plug.name,
    role: plug.role,
    endpoint: plug.chatUrl ? `POST ${plug.chatUrl}` : null,
    // The seam fills this in only when a request really goes out.
    request: null,
    model: plug.model ?? null,
    text: null,
    finishReason: null,
    usage: null,
    durationMs: 0,
    warnings: [],
  };

  // Refused here rather than passed on, so the message is about the prompt
  // instead of about the call.
  if (text === '') {
    return { ...base, ok: false, error: fixedFailure('bad-request', 'a prompt is required'), noCallMade: true };
  }

  // The seam decides everything else: a slot waiting on a decision, a missing key,
  // or one real request. Whatever it decides comes back as a result.
  const result = await call(name, {
    messages: [{ role: 'user', content: text }],
    env,
    fetchImpl,
  });

  return {
    ...base,
    ok: result.ok === true,
    endpoint: result.endpoint ?? base.endpoint,
    request: result.request ?? null,
    model: result.model ?? base.model,
    text: result.text ?? null,
    finishReason: result.finishReason ?? null,
    usage: result.usage ?? null,
    durationMs: result.durationMs ?? 0,
    error: result.error ?? null,
    warnings: result.warnings ?? [],
    // Left absent when a call was tried, so nothing reads as "nothing was sent"
    // when something was.
    ...(result.noCallMade ? { noCallMade: true } : {}),
  };
}

/**
 * The request a plug prove would send, with the key replaced by a placeholder.
 * Used by the dry run, which has to show the call without making one.
 */
export function describePlugRequest(plug, prompt) {
  return {
    method: 'POST',
    url: plug.chatUrl,
    headers: {
      Authorization: `Bearer <${plug.keyEnvVar}>`,
      'Content-Type': 'application/json',
    },
    body: {
      model: plug.model,
      messages: [{ role: 'user', content: String(prompt ?? '').trim() }],
    },
  };
}
