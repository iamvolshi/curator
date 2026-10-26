// The Meta Model API plug — the Worker agent's path.
//
// The facts (base URL, key variable name, documented default model) were written
// into worker/config.js from Meta's published documentation. This plug reads
// them from there instead of repeating them, so those facts have one home.

import {
  API_BASE_URL,
  CHAT_COMPLETIONS_URL,
  DEFAULT_MODEL,
  KEY_ENV_VAR,
  MODEL_ENV_VAR,
  STATUS_URL,
  resolveModel,
} from '../../worker/config.js';

export const NAME = 'meta';

/** Build this plug's config. Same shape as every other plug. */
export function definePlug(env = process.env) {
  return {
    name: NAME,
    label: 'Meta Model API',
    kind: 'text',
    role: 'worker',
    status: 'ready',
    baseUrl: API_BASE_URL,
    chatUrl: CHAT_COMPLETIONS_URL,
    statusUrl: STATUS_URL,
    replyShape: 'chat-completions',

    keyEnvVar: KEY_ENV_VAR,
    // Only ever used to warn. The API is the authority on whether a key works.
    keyShape: /^LLM_[A-Za-z0-9]+_[A-Za-z0-9_-]+$/,
    keyShapeHint: 'LLM_{id}_{secret}',

    modelEnvVar: MODEL_ENV_VAR,
    defaultModel: DEFAULT_MODEL,
    model: resolveModel(null, env),

    timeoutMs: 60_000,
    blockedReason: null,
    notes: null,

    sources: {
      baseUrl: 'Meta API reference (https://dev.meta.ai/docs/api-reference)',
      key: 'Meta Chat Completions docs (https://dev.meta.ai/docs/protocols/chat-completions)',
      model: 'Meta models page (https://dev.meta.ai/docs/models), the documented default; override with MODEL_ID',
    },
  };
}

export default definePlug;
