// The Meta Model API contract, kept in one place so nothing else has to guess.
// Taken from Meta's published documentation on 2026-10-26:
//   base URL + auth : https://dev.meta.ai/docs/api-reference
//   chat request    : https://dev.meta.ai/docs/protocols/chat-completions
//   models          : https://dev.meta.ai/docs/models

export const API_BASE_URL = 'https://api.meta.ai/v1';
export const CHAT_COMPLETIONS_URL = `${API_BASE_URL}/chat/completions`;
export const MODELS_URL = `${API_BASE_URL}/models`;
export const STATUS_URL = `${API_BASE_URL}/status`;

/** The API reads the key from MODEL_API_KEY in Meta's own examples. */
export const KEY_ENV_VAR = 'MODEL_API_KEY';

/** Optional override, so the model can be changed without editing code. */
export const MODEL_ENV_VAR = 'MODEL_ID';

/**
 * muse-spark-1.3 is the model Meta's own documentation uses in its examples,
 * which makes it the documented default. No model choice is settled in this
 * outcome — whichever model actually runs is written into every record, so the
 * choice stays visible instead of assumed.
 */
export const DEFAULT_MODEL = 'muse-spark-1.3';

/** The name this worker is recorded under. */
export const WORKER_NAME = 'meta-model-api';

/** A single short call should not need long; the limit also catches a dead connection. */
export const REQUEST_TIMEOUT_MS = 60_000;

export function resolveModel(explicit, env = process.env) {
  return explicit || env[MODEL_ENV_VAR] || DEFAULT_MODEL;
}
