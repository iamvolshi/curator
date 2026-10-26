// What every plug has to carry.
//
// All plugs are built from the same shape, so this is checked once and used
// everywhere: the seam refuses to call a malformed plug, and the offline checks
// assert that each plug passes. A plug that is intentionally empty (the picture
// slot) still has to name every field — empty is a value, missing is a bug.

const KINDS = ['text', 'image'];
const STATUSES = ['ready', 'needs-config', 'awaiting-pick', 'needs-parser'];
const ROLES = ['worker', 'overseer', 'picture', 'development'];
const REQUIRED_FIELDS = [
  'name',
  'label',
  'kind',
  'role',
  'status',
  'keyEnvVar',
  'modelEnvVar',
  'defaultModel',
  'model',
  'sources',
];

/** Returns a list of plain-language problems. An empty list means the shape is fine. */
export function checkPlugShape(plug) {
  if (!plug || typeof plug !== 'object' || Array.isArray(plug)) {
    return ['a plug must be an object'];
  }

  const problems = [];

  for (const field of REQUIRED_FIELDS) {
    if (plug[field] === undefined) problems.push(`missing field: ${field}`);
  }

  if (!KINDS.includes(plug.kind)) problems.push(`kind must be one of: ${KINDS.join(', ')}`);
  if (!STATUSES.includes(plug.status)) problems.push(`status must be one of: ${STATUSES.join(', ')}`);
  if (!ROLES.includes(plug.role)) problems.push(`role must be one of: ${ROLES.join(', ')}`);

  // Where each value came from has to be sayable, or nobody can tell a sourced
  // value from an invented one.
  if (plug.sources && typeof plug.sources === 'object') {
    for (const key of ['baseUrl', 'key', 'model']) {
      const value = plug.sources[key];
      if (typeof value !== 'string' || value.trim() === '') {
        problems.push(`sources.${key} must say where that value came from`);
      }
    }
  } else {
    problems.push('sources must be an object naming where each value came from');
  }

  // A plug that says it is ready has to actually have what a call needs.
  if (plug.status === 'ready') {
    if (typeof plug.baseUrl !== 'string' || plug.baseUrl.trim() === '') {
      problems.push('a ready plug needs a base URL');
    }
    if (typeof plug.chatUrl !== 'string' || plug.chatUrl.trim() === '') {
      problems.push('a ready plug needs a chat URL');
    }
    if (typeof plug.model !== 'string' || plug.model.trim() === '') {
      problems.push('a ready plug needs a model');
    }
    if (typeof plug.replyShape !== 'string' || plug.replyShape.trim() === '') {
      problems.push('a ready plug needs a reply shape');
    }
  }

  return problems;
}

/**
 * A short, printable description of a plug: what it is, whether it can be called
 * yet, and where its values came from. Used by the checks and by anything that
 * has to explain the wiring to a person.
 */
export function describePlug(plug) {
  return {
    name: plug.name,
    kind: plug.kind,
    role: plug.role,
    status: plug.status,
    baseUrl: plug.baseUrl,
    model: plug.model,
    modelSource: plug.modelEnvVar,
    keyVariable: plug.keyEnvVar,
    replyShape: plug.replyShape,
    blockedReason: plug.blockedReason,
    sources: plug.sources,
  };
}
