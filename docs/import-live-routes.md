# Live routes for import — what does not exist, and why

This document states plainly: **there is no live WhatsApp or LinkedIn
route for Curator, and none is faked.** The import path reads files you
export yourself (see [docs/import.md](./import.md)). The code carries
named sockets for live routes (`import/live-stubs.js`) that return
`{ live: false, reason }` and make no network call. This page is the
evidence for why those sockets stay unwired.

Checked 5 November 2026. Platform terms change; re-check before acting on
any of this.

## WhatsApp: no read path for personal history

- **The Cloud API is a send pipe, not a store.** Its messages reference
  documents exactly one endpoint, `POST /{Phone-Number-ID}/messages`.
  There is no `GET`, and nothing returns a conversation you already had.
  Meta's own overview says message contents are "communicated via
  webhook" — once, at the moment they happen. If your listener was not
  built yet, the message is gone from your side of the wire.
- **The one exception is a migration tool, not a read API.** When a
  business onboards a WhatsApp Business app number onto the Cloud API and
  agrees to share chats, a one-time `history` webhook fires covering
  messages sent or received within **180 days** of onboarding. Group chats
  are excluded, and media asset IDs arrive only for media sent within 14
  days of onboarding. One-time, partner-gated, 180 days, no groups.
- **Coexistence is Business-app only.** Meta's coexistence flow lets a
  WhatsApp **Business** app number keep working on the phone while also
  connecting to the Cloud API, with an opt-in to share history (180 days,
  1:1 only, no groups). A personal WhatsApp Messenger number is not
  eligible — coexistence is for Business app numbers.
- **General-purpose AI assistants are barred.** From **15 January 2026**,
  section 4.7 of Meta's Terms for the WhatsApp Business Platform bars AI
  providers from the platform when a general-purpose AI assistant is the
  primary functionality on offer — the rule that took ChatGPT and
  Perplexity off WhatsApp. The nuance matters and is stated here, not
  hidden: a business using AI to serve its *own* customers (support,
  bookings, order tracking) is still allowed, and EEA/Brazil numbers are
  carved out. Curator as a general-purpose assistant reading a person's
  own chats is on the barred side of that line, not the business side.

Sources: Meta WhatsApp Business Platform terms §4.7 (as updated 23 Sep
2026); Meta history webhook reference; Meta coexistence documentation;
reporting at https://respond.io/blog/whatsapp-general-purpose-chatbots-ban
and https://blog.getmanifest.ai/meta-whatsapp-ai-chatbot-policy/.

**What this means:** the only honest WhatsApp route is the one built
here — the user exports a chat on their phone and Curator reads the file.
Anything claiming live personal-history sync is either a Business number,
a one-time 180-day migration, or an unofficial client (which WhatsApp's
terms forbid and which risks the account).

## LinkedIn: no inbox API for a personal account

- **Messages API — approved partners only, no public application.**
  LinkedIn's own documentation: "Usage of this API is restricted to
  approved partners, subject to limitations via API agreement." There is
  no published application process for becoming one, and the endpoint
  forbids automation and scheduling in any case.
- **Compliance API — closed.** LinkedIn's Getting Access page lists the
  `r_compliance` / `w_compliance` permissions "for reference purposes
  only. Access is closed and may not be requested." The closest sanctioned
  read-side inbox capability is unavailable to everyone, including
  enterprises.
- **Self-service access covers no messaging.** Without approval, a
  developer gets OpenID Connect (`profile`, `email`) and `w_member_social`
  (post, comment, react). No messaging or inbox permission exists in that
  tier, and Partner Program applications are open to incorporated companies
  only — not individual developers.
- **DMA Member Data Portability — EEA/Switzerland only.** LinkedIn's
  Member Data Portability API, built for the EU Digital Markets Act, is
  available only to members located in the European Economic Area and
  Switzerland, and only covers changelog events from the past 28 days.
  Darren is US-based (North Carolina), so this route is closed to him
  regardless of what it covers.

Sources: LinkedIn Messages API,
https://learn.microsoft.com/en-us/linkedin/shared/integrations/communications/messages;
LinkedIn Getting Access (Compliance closed),
https://learn.microsoft.com/th-th/linkedin/shared/authentication/getting-access;
LinkedIn Member Data Portability (Member),
https://learn.microsoft.com/en-us/linkedin/dma/member-data-portability/member-data-portability-member/?view=li-dma-data-portability-2026-08;
analysis at https://www.trykondo.com/blog/linkedin-messaging-api-inbox-access.

**What this means:** the only honest LinkedIn route is the one built
here — the user requests their own data archive and Curator reads the
CSV files. Third-party session-based tools exist that scrape through a
logged-in session; they operate outside LinkedIn's approved API and carry
account-restriction risk, and Curator does not use them.

## The sockets

`import/live-stubs.js` holds `whatsappWebhookReceiver()` and
`linkedInSync()`. Each returns `{ live: false, route, reason }` and touches
no network, no token, no credential. If a route ever opens — a new
partner program, a DMA expansion, a terms change — the shape is already
there: a receiver takes a payload, returns parsed messages in the shape
the importers take, and `import/import.js` does the rest. Wiring one up
means replacing the stub body and proving the route with a real account,
not flipping a flag. Until then, do not wire them, do not invent
endpoints, and do not claim a live connection.
