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
import { readImageReply } from './plugs/picture.js';
import { sendGet, sendJson } from './transport.js';

export { readImageReply };

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
  // A plug can be ready in its own right and still have no key. Reporting its
  // static status then would say "ready" about a seat that cannot be called.
  const status = plug.status === 'ready' && !ready.keyPresent ? 'missing-key' : plug.status;
  return { status, primary, keyProblem };
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
 * @param {number} [request.temperature]   sent only when given; otherwise the model's default applies
 * @returns {Promise<object>} a result that never throws for a call that was tried
 */
export async function call(name, { messages, model, env = process.env, fetchImpl = fetch, timeoutMs, temperature } = {}) {
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
    // The model the response NAMED, or null when it named none. Kept apart from
    // `model` because `model` falls back to the model that was asked for, and a
    // reader who cannot tell a named model from an assumed one cannot tell a
    // substitution from the model it meant to call.
    reportedModel: null,
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

  // An image plug is not a text plug with a different URL. Sending a chat
  // body to an images endpoint would be a request nobody meant, so the
  // text call refuses image plugs outright and points at callImage instead.
  if (plug.kind === 'image') {
    return {
      ...base,
      ok: false,
      error: fixedFailure('bad-request', 'the picture plug makes images, not text: use callImage with a prompt', {
        fix: 'callImage(name, { prompt }) — a text call cannot carry an image reply',
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

  const body = {
    model: requestedModel,
    messages,
    ...(temperature === undefined ? {} : { temperature }),
  };

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
    reportedModel: namedModel(sent.parsed),
    text,
    finishReason: choice?.finish_reason ?? null,
    usage: sent.parsed?.usage ?? null,
    error: null,
  };
}

/**
 * Make one image through an image plug.
 *
 * The same seam rules as a text call, in the same order: shape, ready,
 * prompt, key, then exactly one request. The body is only model + prompt:
 * nothing else is sent, because nothing else has been checked against
 * this endpoint. The reply is read by the picture plug's reader, which
 * knows what an images-generations reply actually carries.
 *
 * @param {string} name                    plug name, e.g. 'picture'
 * @param {object} request
 * @param {string} request.prompt          what the picture should show
 * @param {string} [request.model]         model; defaults to the plug's resolved model
 * @param {object} [request.env]           environment to read the key and config from
 * @param {Function} [request.fetchImpl]   test seam; defaults to the global fetch
 * @param {number} [request.timeoutMs]     overrides the plug's timeout
 * @returns {Promise<object>} a result that never throws for a call that was tried
 */
export async function callImage(name, { prompt, model, env = process.env, fetchImpl = fetch, timeoutMs } = {}) {
  const plug = resolvePlug(name, env);
  const requestedModel = model ?? plug.model ?? null;

  const base = {
    plug: plug.name,
    kind: plug.kind,
    endpoint: plug.imageUrl ? `POST ${plug.imageUrl}` : null,
    request: null,
    model: requestedModel,
    reportedModel: null,
    image: null,
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

  if (plug.kind !== 'image') {
    return {
      ...base,
      ok: false,
      error: fixedFailure('bad-request', 'callImage is only for image plugs: a text plug answers through call', {
        fix: 'use call(name, { messages }) for a text plug',
      }),
      noCallMade: true,
    };
  }

  const text = typeof prompt === 'string' ? prompt.trim() : '';
  if (text === '') {
    return {
      ...base,
      ok: false,
      error: fixedFailure('bad-request', 'an image call needs a prompt'),
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

  const body = { model: requestedModel, prompt: text };
  const url = plug.imageUrl ?? plug.chatUrl;

  const sent = await sendJson({
    url,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body,
    timeoutMs: timeoutMs ?? plug.timeoutMs,
    fetchImpl,
  });

  const request = { method: 'POST', url, body };

  if (!sent.ok) {
    return { ...base, request, ok: false, durationMs: sent.durationMs, error: sent.error };
  }

  const { image, problem: readProblem } = readImageReply(sent.parsed);
  if (!image) {
    return {
      ...base,
      request,
      ok: false,
      durationMs: sent.durationMs,
      error: fixedFailure('bad-response', `the call was answered, but ${readProblem}`, {
        httpStatus: sent.status,
      }),
    };
  }

  return {
    ...base,
    request,
    ok: true,
    durationMs: sent.durationMs,
    model: sent.parsed?.model ?? requestedModel,
    reportedModel: namedModel(sent.parsed),
    image,
    usage: sent.parsed?.usage ?? null,
    error: null,
  };
}

/**
 * The model a response named, or null when it named none.
 *
 * A response with no model field is not a response with the requested model: it is
 * a response that does not say who answered. The two are different facts, and the
 * judge panel is built on telling them apart — an opinion whose model is unknown
 * cannot be counted as an independent one.
 */
function namedModel(parsed) {
  const named = parsed?.model;
  return typeof named === 'string' && named.trim() !== '' ? named.trim() : null;
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
