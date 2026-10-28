// The plugs this build has, by name.
//
// A plug is a definition (a function of the environment), not a frozen object:
// two of the three read their base URL or model from the environment, so a plug
// is only meaningful once an environment has been resolved against it. Resolving
// is cheap and side-effect free, so callers do it per call.

import meta from './plugs/meta.js';
import openrouter from './plugs/openrouter.js';
import baseten from './plugs/baseten.js';
import nvidia from './plugs/nvidia.js';
import inception from './plugs/inception.js';
import picture from './plugs/picture.js';

const DEFINITIONS = Object.freeze({
  meta,
  openrouter,
  baseten,
  nvidia,
  inception,
  picture,
});

/** Every plug name, in a stable order. */
export const PLUG_NAMES = Object.freeze(Object.keys(DEFINITIONS));

/**
 * Build one plug's config for a given environment.
 * An unknown name is a programming error, so it throws rather than falling back
 * to some default provider — a silent fallback would be a call nobody intended.
 */
export function resolvePlug(name, env = process.env) {
  const define = DEFINITIONS[name];
  if (!define) {
    throw new Error(`unknown plug: "${name}"; the plugs are ${PLUG_NAMES.join(', ')}`);
  }
  return define(env);
}

/** Every plug, resolved for one environment. */
export function resolveAll(env = process.env) {
  return PLUG_NAMES.map((name) => resolvePlug(name, env));
}
