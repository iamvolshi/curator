// Building the two things most checks around the judge need: a move as the wrapper
// really records it, and a provider that answers with a fixed reply.
//
// Both were copied into every file that needed them, which meant a change to the
// shape of a recorded call — or to what counts as a reply — had four places to
// land in and no owner. This is the one copy.
//
// It lives outside `test/` because the runner executes every `.js` under that
// directory: a shared module kept there would be run as a suite of its own and
// fail with "no tests".

import { wrapCall } from '../wrapper/wrap.js';

/**
 * One observed move, recorded by the wrapper: the fixed fields are the ones a real
 * worker call writes, so an entry built here is the same shape the judge will read
 * from a record file.
 */
export function observed(store, prompt, subjects = [], response = 'an answer') {
  return wrapCall({
    call: async () => ({ ok: true, kind: 'worker-call', worker: 'meta-model-api', model: 'muse-spark-1.3', text: response }),
    prompt,
    store,
    subjects,
  });
}

/**
 * A provider that answers with a fixed reply and records every request it was asked
 * to make, so a check can say what a run cost. The URL and the key it was sent with
 * are part of what is recorded: that is how the judge's own plug is distinguished
 * from the Worker's.
 */
export function provider(content, seen = []) {
  return async (url, options) => {
    seen.push({ url, auth: options?.headers?.Authorization });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ model: 'darrens-pick', choices: [{ message: { content } }] }),
    };
  };
}
