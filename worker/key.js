// Reading the API key.
//
// Nothing in this file ever returns or prints the key's value. Callers get the
// key only to put it in a request header, plus a plain sentence about whether it
// is there and whether it looks like a Meta Model API key.

import { KEY_ENV_VAR } from './config.js';

// Meta documents the shape as LLM_{id}_{secret} (see the 401 section of
// https://dev.meta.ai/docs/error-handling). The shape is only ever used to
// warn: the API itself is the only authority on whether a key works, and a
// warning that wrongly fired would be worse than no warning.
const EXPECTED_SHAPE = /^LLM_[A-Za-z0-9]+_[A-Za-z0-9_-]+$/;

export function readKey(env = process.env) {
  const raw = env[KEY_ENV_VAR];

  if (typeof raw !== 'string' || raw.trim() === '') {
    return {
      key: null,
      problem: `no ${KEY_ENV_VAR} was found in the environment`,
      warning: null,
    };
  }

  const key = raw.trim();
  return {
    key,
    problem: null,
    warning: EXPECTED_SHAPE.test(key)
      ? null
      : `${KEY_ENV_VAR} does not look like a Meta Model API key (expected LLM_{id}_{secret}); if the call is rejected, check the key itself first`,
  };
}

/** A note about the key that is safe to print. Never includes any part of the value. */
export function describeKeyPresence(env = process.env) {
  const { key, warning } = readKey(env);
  if (!key) return `not set (${KEY_ENV_VAR} is empty or missing)`;
  return warning ? 'set, but the shape looks unusual' : 'set';
}
