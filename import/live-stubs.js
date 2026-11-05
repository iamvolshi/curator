// Live-route stubs: named sockets for the day a live route exists.
//
// NOT LIVE. Nothing in this file makes a network call, holds a token, or
// talks to Meta or LinkedIn. Each function says so and returns the reason,
// because a stub that pretended to be connected would be a lie in the
// record's own codebase. See docs/import-live-routes.md for why there is no
// live route today: the WhatsApp Cloud API cannot read personal history and
// Meta bars general-purpose AI assistants from the platform; LinkedIn's
// Messages API is approved-partners only and its Compliance API is closed.
//
// When (and if) a route ever opens, the shape is already here: a receiver
// takes a payload, returns parsed messages in the shape the importers take,
// and the import path in import/import.js does the rest. Until then these
// sockets stay unwired: no command calls them, no token is configured for
// them, and wiring one up means replacing the stub body, not flipping a flag.

/** Where a live WhatsApp webhook receiver would sit. Not live. */
export function whatsappWebhookReceiver() {
  return {
    live: false,
    route: 'whatsapp-webhook',
    reason:
      'No live route: the WhatsApp Cloud API is business-number-only and ' +
      'cannot read personal chat history (one-time 180-day 1:1 replay only, ' +
      'via coexistence opt-in, no groups), and Meta bars general-purpose AI ' +
      'assistants from the platform since 15 January 2026. ' +
      'Import from a chat export instead: node bin/overseer.js import --whatsapp <file.txt>.',
  };
}

/** Where a live LinkedIn sync would sit. Not live. */
export function linkedInSync() {
  return {
    live: false,
    route: 'linkedin-sync',
    reason:
      'No live route: the LinkedIn Messages API is restricted to approved ' +
      'partners with no published application, the Compliance API is closed ' +
      '("may not be requested"), and the DMA Member Data Portability API is ' +
      'EEA/Switzerland only. ' +
      'Import from a data archive instead: node bin/overseer.js import --linkedin <file.zip>.',
  };
}

/** Both sockets, for a status command that wants to list them. */
export function liveImportRoutes() {
  return [whatsappWebhookReceiver(), linkedInSync()];
}
