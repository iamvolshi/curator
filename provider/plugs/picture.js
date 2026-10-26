// The picture kid's plug slot — image-capable, and deliberately empty.
//
// This slot exists so the seam accepts the picture kid without rework once its
// provider is chosen. It is configured exactly like the other plugs: a base URL,
// a key variable name, and a model, each read from the environment.
//
// Nothing is filled in. The provider and the model are Darren's decision
// (open-weights, model TBD), so this outcome does not choose them. Two things
// really are missing, and both are named rather than papered over:
//
//   1. the provider and model themselves;
//   2. how to read an image reply. Every text plug here answers in the
//      chat-completions shape, which carries no image. A real image reply (bytes
//      or a URL) needs its own reader before this slot can run.
//
// Until both are settled the slot refuses to call, so nothing quietly sends an
// image request to a model nobody picked.

const BASE_URL_ENV = 'PICTURE_BASE_URL';
const KEY_ENV = 'PICTURE_API_KEY';
const MODEL_ENV = 'PICTURE_MODEL';

export const NAME = 'picture';

function readEnv(name, env) {
  const raw = env[name];
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

export function definePlug(env = process.env) {
  const baseUrl = readEnv(BASE_URL_ENV, env);
  const model = readEnv(MODEL_ENV, env);
  const chosen = Boolean(baseUrl && model);

  return {
    name: NAME,
    label: 'picture kid',
    kind: 'image',
    role: 'picture',
    // Not ready either way: with no pick there is nothing to call, and with a
    // pick there is still no reader for an image reply.
    status: chosen ? 'needs-parser' : 'awaiting-pick',
    baseUrl,
    chatUrl: null,
    statusUrl: null,
    // No text reader exists for images. This is the open piece, not an oversight.
    replyShape: null,

    keyEnvVar: KEY_ENV,
    keyShape: null,
    keyShapeHint: null,

    modelEnvVar: MODEL_ENV,
    defaultModel: null,
    model,

    timeoutMs: 120_000,
    blockedReason: chosen
      ? 'the picture slot is configured, but reading an image reply is not built yet'
      : `the picture slot has no provider and no model: ${BASE_URL_ENV}, ${KEY_ENV} and ${MODEL_ENV} are unset until Darren picks an open-weights image model`,
    notes: 'Empty on purpose. The open-weights provider and model are Darren\'s decision.',

    sources: {
      baseUrl: `${BASE_URL_ENV} — empty on purpose; the provider is Darren's pick`,
      key: `${KEY_ENV} — empty on purpose; no provider means no key to name`,
      model: `${MODEL_ENV} — empty on purpose; the open-weights model is Darren's pick`,
    },
  };
}

export default definePlug;
