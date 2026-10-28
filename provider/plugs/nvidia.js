// The NVIDIA plug — the provisional free seats' provider.
//
// NVIDIA Build serves free endpoints over an OpenAI-compatible API, so a call
// through this plug has the same shape as every other text plug. The facts are
// NVIDIA's own, from NVIDIA's own pages:
//
//   https://build.nvidia.com/models
//     the free endpoints, and where a key comes from (a free developer account)
//   https://forums.developer.nvidia.com/t/384067
//     NVIDIA Build's own example request: base URL
//     https://integrate.api.nvidia.com/v1, endpoint /chat/completions, and Bearer
//     authentication with a key generated on NVIDIA Build.
//
// What is deliberately NOT here is a model. The two free seats are wired
// provisionally: which model sits in seat 2 and which in seat 3 is Darren's pick,
// so each seat names its own (judge/seats.js) and neither is chosen here. This
// plug's own model is the one it offers when the bank fills a seat, and it is
// unset until someone names it: a call without a model is refused rather than
// sent to a model nobody chose.

const BASE_URL = 'https://integrate.api.nvidia.com/v1';
const KEY_ENV = 'NVIDIA_API_KEY';
const MODEL_ENV = 'NVIDIA_MODEL';

export const NAME = 'nvidia';

function readEnv(name, env) {
  const raw = env[name];
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

export function definePlug(env = process.env) {
  const model = readEnv(MODEL_ENV, env);

  return {
    name: NAME,
    label: 'NVIDIA Build',
    kind: 'text',
    role: 'judge',
    status: model ? 'ready' : 'needs-config',
    baseUrl: BASE_URL,
    chatUrl: `${BASE_URL}/chat/completions`,
    // No key-free health address is documented for it, and inventing one would be
    // making up a fact about someone else's service.
    statusUrl: null,
    replyShape: 'chat-completions',

    keyEnvVar: KEY_ENV,
    // No shape is asserted: NVIDIA's own API is the authority on whether a key
    // works, and a guessed prefix would only ever be a false warning.
    keyShape: null,
    keyShapeHint: null,

    modelEnvVar: MODEL_ENV,
    // No default on purpose: the model is Darren's pick, not this outcome's.
    defaultModel: null,
    model,

    timeoutMs: 60_000,
    blockedReason: model
      ? null
      : `the nvidia plug has no model yet: set ${MODEL_ENV} to the model it should offer when the bank fills a seat`,
    notes:
      'Provisional free seat provider. A seat names its own model (PANEL_SEAT2_MODEL, PANEL_SEAT3_MODEL); this plug\u2019s model is what it offers as a fill.',

    sources: {
      baseUrl: 'NVIDIA Build\u2019s published example request (https://forums.developer.nvidia.com/t/384067): https://integrate.api.nvidia.com/v1',
      key: `a key generated on https://build.nvidia.com/models, read from ${KEY_ENV}`,
      model: `${MODEL_ENV} — no default; the model is unset until it is named`,
    },
  };
}

export default definePlug;
