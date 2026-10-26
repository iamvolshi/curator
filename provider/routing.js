// Agent-to-plug routing.
//
// This table is fixed by the handoff and is not a suggestion. One slot per agent
// that makes model calls, one plug named for each. A slot points at a plug name,
// never at a URL or a model directly: nothing routes around the plugs.

export const ROUTES = Object.freeze({
  /** The Worker agent does the user's task. It runs on Meta. */
  worker: 'meta',
  /** The Overseer agent judges the Worker's moves. It runs on Baseten. */
  overseer: 'baseten',
  /**
   * The picture kid makes one image per subject folder. The slot is wired, the
   * plug is empty: the open-weights provider and model are Darren's pick.
   */
  picture: 'picture',
});

/** The routing slots, in the order above. */
export const ROUTE_SLOTS = Object.freeze(Object.keys(ROUTES));

/** Which plug an agent name routes to. Throws on a name that is not routed. */
export function plugForSlot(slot) {
  const plug = ROUTES[slot];
  if (!plug) {
    throw new Error(`no route for "${slot}"; the routed slots are ${ROUTE_SLOTS.join(', ')}`);
  }
  return plug;
}
