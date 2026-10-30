// The picture kid's plug — Muse Image on the Meta Model API.
//
// Darren's pick, 2026-10-30: use a Muse model for the images. That pick needed
// one correction before it could be wired, and it is recorded here so nobody
// re-wires it wrong later:
//
//   * Muse Spark, Muse Spark Open and Muse Glimmer do NOT make pictures.
//     Spark reads images and writes text and code; Spark Open takes text,
//     image, video and audio in and gives text out; Glimmer is the small
//     Spark-family model for local and edge use. None of them has an image
//     output, so none of them can fill this slot.
//   * The Muse model that makes pictures is a separate one: Muse Image,
//     `muse-image-1.0`, on the Meta Model API at /v1/images/generations.
//     It is proprietary, not open weights, so this is a Meta-tooling leg,
//     not the open-weights bonus leg. If the bonus leg is wanted later, it
//     needs an open-weights image model, not a Muse text model.
//
// The wiring reuses the Worker's own Meta setup on purpose: Muse Image uses
// the same base URL and the same key as Muse Spark, so there is no second
// key to buy and no second address to learn. The base and the model can be
// overridden in the environment, but the defaults are the picked ones, not
// guesses: base https://api.meta.ai/v1, model muse-image-1.0, key MODEL_API_KEY.
//
// The image reply reader lives here too. An images-generations reply is not
// a chat reply: it carries `data`, one entry per image, each with either
// `b64_json` (the image bytes, base64) or `url` (where to fetch it). A reply
// with neither is unusable, and the reader says so instead of pretending
// an empty entry is a picture.

const DEFAULT_BASE_URL = 'https://api.meta.ai/v1';
const DEFAULT_MODEL = 'muse-image-1.0';
const BASE_URL_ENV = 'PICTURE_BASE_URL';
const MODEL_ENV = 'PICTURE_MODEL';
// Deliberately the Worker's key variable, not a new one: Muse Image is on
// the same Meta Model API, with the same auth as Muse Spark.
const KEY_ENV = 'MODEL_API_KEY';

export const NAME = 'picture';

function readEnv(name, env) {
  const raw = env[name];
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

export function definePlug(env = process.env) {
  const baseUrl = readEnv(BASE_URL_ENV, env) ?? DEFAULT_BASE_URL;
  const model = readEnv(MODEL_ENV, env) ?? DEFAULT_MODEL;
  const imagesUrl = `${baseUrl}/images/generations`;

  return {
    name: NAME,
    label: 'picture kid',
    kind: 'image',
    role: 'picture',
    status: 'ready',
    baseUrl,
    // The generation endpoint doubles as this plug's call URL, so the
    // plug-shape check (a ready plug needs a call URL) passes on the
    // address that is actually called. The generic text call never uses
    // it: it refuses image plugs before sending anything.
    chatUrl: imagesUrl,
    imageUrl: imagesUrl,
    statusUrl: null,
    replyShape: 'images-generations',

    keyEnvVar: KEY_ENV,
    keyShape: /^LLM_[A-Za-z0-9]+_[A-Za-z0-9_-]+$/,
    keyShapeHint: 'LLM_{id}_{secret}',

    modelEnvVar: MODEL_ENV,
    defaultModel: DEFAULT_MODEL,
    model,

    timeoutMs: 120_000,
    blockedReason: null,
    notes:
      "Muse Image, not a Muse text model: Spark, Spark Open and Glimmer are text-out only and cannot draw. Muse Image is Meta's image model, proprietary, not open weights — a Meta-tooling leg, not the open-weights bonus leg.",

    sources: {
      baseUrl: 'Meta Model API base, same as the Worker plug (https://api.meta.ai/v1); override with PICTURE_BASE_URL',
      key: 'MODEL_API_KEY — the Worker key; Muse Image uses the same base and auth as Muse Spark',
      model: 'muse-image-1.0 — Meta\'s image model, Darren\'s pick 2026-10-30; override with PICTURE_MODEL',
    },
  };
}

/**
 * Read an images-generations reply into an image, or say why it is not one.
 *
 * Returns { image } on success, where image is { source, data, revisedPrompt }:
 * source 'base64' means data is base64 image bytes; source 'url' means data
 * is an address to fetch. Returns { problem } when the reply has no image:
 * no data array, an empty first entry, or an entry with neither b64_json
 * nor url. Nothing here guesses a format from a filename that is not there.
 */
export function readImageReply(parsed) {
  const entry = parsed?.data?.[0] ?? null;
  if (!entry || typeof entry !== 'object') {
    return { problem: 'the image reply had no data entry' };
  }
  const revisedPrompt =
    typeof entry.revised_prompt === 'string' && entry.revised_prompt.trim() !== ''
      ? entry.revised_prompt
      : null;
  if (typeof entry.b64_json === 'string' && entry.b64_json.trim() !== '') {
    return { image: { source: 'base64', data: entry.b64_json.trim(), revisedPrompt } };
  }
  if (typeof entry.url === 'string' && entry.url.trim() !== '') {
    return { image: { source: 'url', data: entry.url.trim(), revisedPrompt } };
  }
  return { problem: 'the image reply had no image bytes and no image URL' };
}

export default definePlug;
