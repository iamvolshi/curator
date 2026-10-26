// Reading a plug's key.
//
// Nothing here ever returns or prints a key's value to a caller that prints. The
// value is handed back only so provider.call can put it in a request header; what
// a caller can show is one plain sentence about whether it is there.
//
// The shape check is per plug, and optional: a wrong shape only ever warns,
// because the provider itself is the only authority on whether a key works.

export function readKey(plug, env = process.env) {
  const raw = env[plug.keyEnvVar];

  if (typeof raw !== 'string' || raw.trim() === '') {
    return {
      key: null,
      problem: `no ${plug.keyEnvVar} was found in the environment`,
      warning: null,
    };
  }

  const key = raw.trim();

  if (!plug.keyShape) {
    return { key, problem: null, warning: null };
  }

  return {
    key,
    problem: null,
    warning: plug.keyShape.test(key)
      ? null
      : `${plug.keyEnvVar} does not look like a ${plug.label} key (expected ${plug.keyShapeHint}); if the call is rejected, check the key itself first`,
  };
}

/** A note about the key that is safe to print. Never includes any part of the value. */
export function describeKeyPresence(plug, env = process.env) {
  const { key, warning } = readKey(plug, env);
  if (!key) return `not set (${plug.keyEnvVar} is empty or missing)`;
  return warning ? 'set, but the shape looks unusual' : 'set';
}
