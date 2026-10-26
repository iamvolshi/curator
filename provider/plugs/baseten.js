// The Baseten plug — the Overseer agent's path.
//
// Baseten's hosted inference path is OpenAI-compatible, so the call shape is the
// same as the other two plugs. The base URL and the key variable name were given
// in the handoff. The model was deliberately NOT given: Darren picks it at prove
// time, so there is no default here and a call without one is refused rather
// than sent to a model nobody chose.

const BASE_URL = 'https://inference.baseten.co/v1';
const KEY_ENV = 'BASETEN_API_KEY';
const MODEL_ENV = 'BASETEN_MODEL';

export const NAME = 'baseten';

function readEnv(name, env) {
  const raw = env[name];
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

export function definePlug(env = process.env) {
  const model = readEnv(MODEL_ENV, env);

  return {
    name: NAME,
    label: 'Baseten',
    kind: 'text',
    role: 'overseer',
    status: model ? 'ready' : 'needs-config',
    baseUrl: BASE_URL,
    chatUrl: `${BASE_URL}/chat/completions`,
    statusUrl: null,
    replyShape: 'chat-completions',

    keyEnvVar: KEY_ENV,
    keyShape: null,
    keyShapeHint: null,

    modelEnvVar: MODEL_ENV,
    // No default on purpose: the model is Darren's pick, not this outcome's.
    defaultModel: null,
    model,

    timeoutMs: 60_000,
    blockedReason: model
      ? null
      : `the baseten plug has no model yet: set ${MODEL_ENV} to the model Darren picks`,
    notes: null,

    sources: {
      baseUrl: 'given in the OCME-02 handoff: https://inference.baseten.co/v1',
      key: `the handoff names ${KEY_ENV} as the key variable`,
      model: `${MODEL_ENV} — no default; the model is unset until Darren picks one`,
    },
  };
}

export default definePlug;
