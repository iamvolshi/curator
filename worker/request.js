// What gets sent to Muse Spark, and how it is described.
//
// Chat Completions takes a list of messages. Muse Spark always reasons, so
// reasoning_effort is left unset (setting it to "none" is an error on this
// model), and temperature/top_p are left at their defaults because the model is
// tuned to run there. A short prompt needs none of the optional fields.

import { CHAT_COMPLETIONS_URL, resolveModel } from './config.js';

/** The request body for one short prompt. Throws if there is no prompt. */
export function buildChatRequest({ prompt, model }, env = process.env) {
  const text = String(prompt ?? '').trim();
  if (text === '') {
    throw new Error('a prompt is required');
  }

  return {
    model: resolveModel(model, env),
    messages: [{ role: 'user', content: text }],
  };
}

/**
 * A description of the request that would be sent, with the key replaced by a
 * placeholder. Used to show what a call would do without making one.
 */
export function describeRequest(body, url = CHAT_COMPLETIONS_URL) {
  return {
    method: 'POST',
    url,
    headers: {
      Authorization: 'Bearer <MODEL_API_KEY>',
      'Content-Type': 'application/json',
    },
    body,
  };
}
