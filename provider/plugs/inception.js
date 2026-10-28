// The Inception Labs plug — a provisional judge seat's provider.
//
// Inception serves an OpenAI-compatible chat-completions API, so a call through
// this plug has the same shape as the other text plugs. The endpoint was given
// by the project owner: https://api.inceptionlabs.ai/v1/chat/completions. It was
// not checked against Inception's documentation here.
//
// The model is NOT chosen here. A seat names its own model (judge/seats.js), and
// this plug's model is only what it offers when the bank fills a seat. It is
// unset until someone names it.

const BASE_URL = 'https://api.inceptionlabs.ai/v1';
const KEY_ENV = 'INCEPTION_API_KEY';
const MODEL_ENV = 'INCEPTION_MODEL';

export const NAME = 'inception';

function readEnv(name, env) {
  const raw = env[name];
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

export function definePlug(env = process.env) {
  const model = readEnv(MODEL_ENV, env);

  return {
    name: NAME,
    label: 'Inception Labs',
    kind: 'text',
    role: 'judge',
    status: model ? 'ready' : 'needs-config',
    baseUrl: BASE_URL,
    chatUrl: `${BASE_URL}/chat/completions`,
    statusUrl: null,
    replyShape: 'chat-completions',

    keyEnvVar: KEY_ENV,
    keyShape: null,
    keyShapeHint: null,

    modelEnvVar: MODEL_ENV,
    // No default on purpose: the model is named by whoever seats it.
    defaultModel: null,
    model,

    timeoutMs: 60_000,
    blockedReason: model
      ? null
      : `the inception plug has no model yet: set ${MODEL_ENV} to the model it should offer when the bank fills a seat`,
    notes: 'Judge-panel provider. A seat names its own model (PANEL_SEAT2_MODEL, PANEL_SEAT3_MODEL); this plug\u2019s model is what it offers as a fill.',

    sources: {
      baseUrl: 'given by the project owner: https://api.inceptionlabs.ai/v1/chat/completions (base https://api.inceptionlabs.ai/v1)',
      key: `an API key from Inception Labs, read from ${KEY_ENV}`,
      model: `${MODEL_ENV} \u2014 no default; the model is unset until it is named`,
    },
  };
}

export default definePlug;
