// The provider seam.
//
// Every model call in this app goes through `call`. There is no second way out:
// the only network code is in ./transport.js, and the offline checks fail if any
// other file calls fetch or reaches into a plug directly.
//
// The seam does four things, in this order, so that "nothing was sent" is always
// distinguishable from "something was sent and it failed":
//
//   1. check the plug is wired correctly;
//   2. check the plug is callable at all (a slot can be waiting on a decision);
//   3. check a key is present;
//   4. send exactly one request.
//
// Steps 1-3 never touch the network, and their failures are marked noCallMade.

import { fixedFailure } from '../worker/errors.js';
import { describeKeyPresence, readKey } from './keys.js';
import { checkPlugShape, describePlug } from './shape.js';
import { resolvePlug } from './registry.js';
import { sendGet, sendJson } from './transport.js';

export { PLUG_NAMES, resolveAll, resolvePlug } from './registry.js';
export { ROUTES, ROUTE_SLOTS, plugForSlot } from './routing.js';
export { checkPlugShape, describePlug } from './shape.js';
export { describeKeyPresence, readKey } from './keys.js';

/**
 * Can this plug be called right now? Answers without touching the network and
 * without revealing the key.
 */
export function preflight(name, env = process.env) {
  const plug = resolvePlug(name, env);
  const { key, problem, warning } = readKey(plug, env);

  return {
    plug: plug.name,
    status: plug.status,
    ready: Boolean(key) && plug.status === 'ready',
    keyPresent: Boolean(key),
    // A setup problem that stopped a call before it happened, if any.
    problem: problem ?? (plug.status === 'ready' ? null : plug.blockedReason),
    warning,
    envVar: plug.keyEnvVar,
  };
}

/**
 * Why a plug cannot be called, in the plug's own words.
 *
 * A slot waiting on a decision is blocked by the decision, not by its key, so
 * what the plug says it needs comes first; the key problem is reported
 * separately, and only when it is a second, different thing. This lives next to
 * preflight because it is a reading of preflight, and every command that refuses
 * a call has to refuse it for the same reason.
 */
export function notReadyReport(plug, ready) {
  const says = plug.status === 'ready' ? null : plug.blockedReason;
  const primary = says ?? ready.problem ?? `the ${plug.name} plug is not ready`;
  const keyProblem = ready.problem && ready.problem !== primary ? ready.problem : null;
  return { status: plug.status, primary, keyProblem };
}

/**
 * Make one call through one plug.
 *
 * @param {string} name                    plug name, e.g. 'meta'
 * @param {object} request
 * @param {Array}  request.messages        chat messages
 * @param {string} [request.model]         model; defaults to the plug's resolved model
 * @param {object} [request.env]           environment to read the key and config from
 * @param {Function} [request.fetchImpl]   test seam; defaults to the global fetch
 * @param {number} [request.timeoutMs]     overrides the plug's timeout
 * @returns {Promise<object>} a result that never throws for a call that was tried
 */
export async function call(name, { messages, model, env = process.env, fetchImpl = fetch, timeoutMs } = {}) {
  const plug = resolvePlug(name, env);
  const requestedModel = model ?? plug.model ?? null;

  const base = {
    plug: plug.name,
    kind: plug.kind,
    endpoint: plug.chatUrl ? `POST ${plug.chatUrl}` : null,
    // What was sent, filled in only once something really is sent. Nothing went
    // out before that, so there is nothing honest to put here.
    request: null,
    model: requestedModel,
    text: null,
    finishReason: null,
    usage: null,
    durationMs: 0,
    warnings: [],
  };

  const shapeProblems = checkPlugShape(plug);
  if (shapeProblems.length > 0) {
    return {
      ...base,
      ok: false,
      error: fixedFailure(
        'missing-config',
        `the ${plug.name} plug is not wired correctly: ${shapeProblems.join('; ')}`,
      ),
      noCallMade: true,
    };
  }

  if (plug.status !== 'ready') {
    return {
      ...base,
      ok: false,
      error: fixedFailure('missing-config', plug.blockedReason, {
        fix: 'this slot is waiting on a decision, not on a retry: name the provider and model for it, then call again',
      }),
      noCallMade: true,
    };
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      ...base,
      ok: false,
      error: fixedFailure('bad-request', 'a call needs at least one message'),
      noCallMade: true,
    };
  }

  const { key, problem } = readKey(plug, env);
  if (!key) {
    return {
      ...base,
      ok: false,
      error: fixedFailure('missing-key', problem, {
        fix: `put the key in ${plug.keyEnvVar} — ${plug.sources.key}`,
      }),
      noCallMade: true,
    };
  }

  const body = { model: requestedModel, messages };

  const sent = await sendJson({
    url: plug.chatUrl,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body,
    timeoutMs: timeoutMs ?? plug.timeoutMs,
    fetchImpl,
  });

  // What was sent, for the record. This is the same object the transport
  // serialised, so re-serialising the stored copy gives back exactly what went
  // over the wire. The Authorization header is deliberately not part of it: a
  // record that can be handed to someone must not carry a key.
  const request = { method: 'POST', url: plug.chatUrl, body };

  if (!sent.ok) {
    return { ...base, request, ok: false, durationMs: sent.durationMs, error: sent.error };
  }

  const choice = sent.parsed?.choices?.[0] ?? null;
  const text = choice?.message?.content ?? null;

  if (typeof text !== 'string' || text.trim() === '') {
    return {
      ...base,
      // It was sent, so the body is part of the record even though the reply was
      // unusable.
      request,
      ok: false,
      durationMs: sent.durationMs,
      error: fixedFailure(
        'bad-response',
        'the call was answered, but there was no reply text in the response',
        { httpStatus: sent.status },
      ),
    };
  }

  return {
    ...base,
    request,
    ok: true,
    durationMs: sent.durationMs,
    // The model the API says it used, not the one that was asked for.
    model: sent.parsed?.model ?? requestedModel,
    text,
    finishReason: choice?.finish_reason ?? null,
    usage: sent.parsed?.usage ?? null,
    error: null,
  };
}

/**
 * Ask a plug whether its address is reachable. Key-free, and not a model call, so
 * it answers "is the address wrong?" separately from "was the key rejected?".
 */
export async function health(name, { env = process.env, fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  const plug = resolvePlug(name, env);

  if (!plug.statusUrl) {
    return {
      plug: plug.name,
      url: null,
      ok: false,
      status: null,
      body: null,
      error: `the ${plug.name} plug has no key-free health address`,
    };
  }

  const result = await sendGet({ url: plug.statusUrl, timeoutMs, fetchImpl });
  return { plug: plug.name, url: plug.statusUrl, ...result };
}
