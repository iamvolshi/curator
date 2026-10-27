// One real call, whichever path its plug takes.
//
// Two commands make a real call now: `prove` asks whether a plug is wired and
// answering, and `task` asks it to do a piece of work. What they must not differ
// on is which plug a name resolves to, which call path that plug takes, how the
// attempt is wrapped and recorded, and what happens when the plug is not ready.
// So that part lives here once, and each command keeps only what is its own: the
// kind it records as, and what it reports to the person who ran it.
//
// Neither command calls the other. They are siblings over this.

import { notReadyReport, resolvePlug } from '../provider/index.js';
import { plugForSlot } from '../provider/routing.js';
import { wrapCall } from '../wrapper/wrap.js';
import { runWorkerCall } from '../worker/index.js';
import { runPlugCall } from './plug-call.js';

/** The plug the Worker agent routes to. Its calls keep the worker's own path. */
export const WORKER_PLUG = plugForSlot('worker');

/**
 * Resolve a plug name to the route it takes.
 * Throws for an unknown name, because a typo must not become a default provider.
 */
export function resolveRoute(name, env = process.env) {
  const plug = resolvePlug(name, env);
  return { plug, throughWorker: plug.name === WORKER_PLUG };
}

/**
 * Run one prompt through a route and record it.
 *
 * The worker's own plug keeps the worker path and the `worker-call` kind, so its
 * entries are exactly the shape they have always been. Every other plug gets the
 * plain seam call, marked with the kind the caller names.
 *
 * @param {object} options
 * @param {{plug: object, throughWorker: boolean}} options.route
 * @param {string} options.prompt            what is being asked
 * @param {string} options.kind              the kind most other plugs record as
 * @param {string[]} [options.subjects]      what the call is about, as declared
 * @param {{append: Function}} options.store the record store
 * @returns {Promise<{ok: boolean, entry: object, outcome: object|null, threw: Error|null}>}
 */
export async function callOnce({ route, prompt, env = process.env, fetchImpl = fetch, kind, store, subjects = [] }) {
  const { plug, throughWorker } = route;

  return wrapCall({
    call: throughWorker
      ? (request) => runWorkerCall({ ...request, env, fetchImpl })
      : (request) => runPlugCall(plug.name, { ...request, env, fetchImpl, kind }),
    prompt,
    store,
    // A call that throws has no result to read a kind from, so the caller's kind
    // is the one written in that case.
    kind: throughWorker ? 'worker-call' : kind,
    subjects,
  });
}

// Shared with the judge and every other command that refuses an unready plug, so
// the refusal reads the same wherever it is made.
export { notReadyReport };
