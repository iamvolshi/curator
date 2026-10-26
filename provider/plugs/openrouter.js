// The OpenRouter plug — the interim development path.
//
// OpenRouter speaks the same OpenAI-compatible chat shape as the other two, so
// nothing about the call itself is special. What is special is what is NOT
// here: no base URL and no model are baked in. Both come from the environment,
// because neither was given to this outcome and guessing one would be inventing
// a decision that belongs to Darren.

const BASE_URL_ENV = 'OPENROUTER_BASE_URL';
const KEY_ENV = 'OPENROUTER_API_KEY';
const MODEL_ENV = 'OPENROUTER_MODEL';

export const NAME = 'openrouter';

function readEnv(name, env) {
  const raw = env[name];
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

export function definePlug(env = process.env) {
  const baseUrl = readEnv(BASE_URL_ENV, env);
  const model = readEnv(MODEL_ENV, env);

  const missing = [];
  if (!baseUrl) missing.push(`${BASE_URL_ENV} (the OpenAI-compatible base URL)`);
  if (!model) missing.push(`${MODEL_ENV} (the model to use)`);

  return {
    name: NAME,
    label: 'OpenRouter',
    kind: 'text',
    role: 'development',
    status: baseUrl && model ? 'ready' : 'needs-config',
    baseUrl,
    chatUrl: baseUrl ? `${baseUrl.replace(/\/+$/, '')}/chat/completions` : null,
    statusUrl: null,
    replyShape: 'chat-completions',

    keyEnvVar: KEY_ENV,
    keyShape: null,
    keyShapeHint: null,

    modelEnvVar: MODEL_ENV,
    // No default on purpose: no model was named for this plug.
    defaultModel: null,
    model,

    timeoutMs: 60_000,
    blockedReason: missing.length ? `the openrouter plug needs ${missing.join(' and ')}` : null,
    notes: 'Interim development path. It is wired as a plug but sits in no routing slot.',

    sources: {
      baseUrl: `${BASE_URL_ENV} — read from the environment; nothing baked in`,
      key: `${KEY_ENV} — read from the environment`,
      model: `${MODEL_ENV} — read from the environment; no model is assumed`,
    },
  };
}

export default definePlug;
