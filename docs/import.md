# Importing WhatsApp and LinkedIn into the record

Curator's record holds what your agent did. This import holds what people
said to you — so the record can answer "what am I due, what is done, what
is still open" from your own messages, not just from model calls.

There is no live connection behind this. WhatsApp and LinkedIn offer no
live route a personal account can use — see
[docs/import-live-routes.md](./import-live-routes.md). What exists is
export-and-import: you export your own data, Curator reads the file, and
one fact entry per message lands in the K-record through the store, exactly
like any other entry. No model call is made anywhere in the import path.

## What you do with your own data

**WhatsApp** — on your phone, open the chat, tap the chat name → More →
Export chat (without media is fine; media arrives as an "omitted" marker,
never as a file Curator reads). Send the .txt to yourself and save it.

**LinkedIn** — on desktop, request the larger data archive at
https://www.linkedin.com/mypreferences/d/download-my-data — pick the
larger archive, wait for the email (up to 24 hours), download within 72
hours. You get a ZIP of CSVs.

Then, from the repo root:

```sh
node bin/overseer.js import --whatsapp ./chat.txt --record /tmp/my-record.jsonl
node bin/overseer.js import --linkedin ./Basic_LinkedInDataExport_*.zip --record /tmp/my-record.jsonl
node bin/overseer.js due --record /tmp/my-record.jsonl
```

`--record` is a scratch record. Leave it off and the import lands in the
default record (`records/k-record.jsonl`) — only do that when you mean it.

## What an import writes

One fact entry per message:

```json
{"seq": 1, "when": "2026-10-12T09:14:00.000Z", "label": "fact",
 "what": {"kind": "whatsapp-import", "source": "whatsapp",
          "endpoint": "whatsapp:Weekend plans", "sender": "Mara Ellison",
          "text": "Are you still up for coffee on Saturday?",
          "prompt": "Are you still up for coffee on Saturday?",
          "hash": "sha256-of-the-original-text",
          "subjects": ["Weekend plans"],
          "classification": {"type": "appointment", "status": "scheduled",
                             "date": "2026-11-07",
                             "reason": "appointment wording …; named date 2026-11-07 is ahead"},
          "snapshotDate": "2026-11-05"}}
```

Provenance lives in `what`: the kind, the source, the sender, the original
text untouched, and a SHA-256 hash of that text. `prompt` repeats the text
on purpose: shades dedupe by move key (kind, endpoint, prompt), so each
message must carry its own text as its prompt or two messages would count
as one move. `subjects` is the chat / conversation title, declared by the
importer — never guessed from the prose, per the folders rule. `when` is
the message's own timestamp; `snapshotDate` is the day it was imported
(the export itself carries no reliable export date).

## Classification — deterministic, no model

`import/classify.js` sorts each message into appointment / invitation /
contact-request / commitment / other, with a status of done / scheduled /
pending, from keyword lists and date rules written in that file. A weekday
name means the next one; "tomorrow" means tomorrow; explicit dates are
read day-first. Anything uncertain is pending, never guessed — a wrong
"scheduled" is a missed meeting, a wrong "pending" is just a message to
look at. The `reason` field names the rule that fired, so any result can
be argued with.

## Dedupe

Re-importing the same file appends nothing. The import collects the
content hash of every entry already in the record and skips any message
whose hash is there — or that appears twice in one file. The report says
parsed / appended / skipped-duplicate / pending, per file and in total.

## The WhatsApp 40,000-message cap

WhatsApp caps an export at about 40,000 messages. A file that stops at
the cap looks exactly like a chat that ended there, so the parser never
truncates and never pretends to know: it parses every line, counts what
it found, and flags `capped: true` when the count reaches the cap, so the
report can say the chat may continue past the file. Export again after
the cap and import the new file — dedupe keeps the overlap out.

## The due view

`node bin/overseer.js due` reads the record and lists, from imported
entries only:

- **Scheduled** — a dated appointment or invitation, today or ahead,
  earliest first
- **Done** — classified done, most recent first
- **Pending** — no date, or awaiting a reply

Grouped by source (WhatsApp / LinkedIn) and by chapter, with each
chapter's shade beside it. It is a view: it writes nothing.

There is deliberately no day→week→month→quarter summary pipeline here.
The notes describe that concept; the code does not implement it, and this
import does not pretend otherwise. The due view is built on what exists:
folders, shades, and the classification on each imported entry.

## Formats the parsers accept

**WhatsApp `.txt`** — Android `[12/3/26, 14:05] Name: text` (day first,
24-hour) and iOS `[3/12/2026, 2:05:33 PM] Name: text` (month first,
12-hour, seconds). `--date-order dmy|mdy` says which the export uses
(default `dmy`); a date with one half over 12 answers itself. Multi-line
messages, system lines ("Messages are end-to-end encrypted…", "X created
this group"), and `<Media omitted>` placeholders are handled; a message
with no sender line is a system line, not a message.

**LinkedIn ZIP or extracted folder** — `messages.csv` (header: CONVERSATION
ID, CONVERSATION TITLE, FROM, TO, DATE, SUBJECT, CONTENT, FOLDER),
`Invitations.csv` (FROM, TO, SENT AT, MESSAGE), `Connections.csv` (First
Name, Last Name, URL, Email Address, Company, Position, Connected On).
LinkedIn publishes no schema for these files, so the header is validated
and a mismatch fails cleanly with a named error
(`LINKEDIN_HEADER_MISMATCH`) instead of misreading a column. A missing
file is not an error — an export may simply not contain it. Dates like
`2024-05-01 12:34:56 UTC` are read as UTC.

## Files

| File | What it does |
| --- | --- |
| `import/whatsapp.js` | WhatsApp export parser |
| `import/linkedin.js` | LinkedIn ZIP/CSV parser (dependency-free ZIP reader) |
| `import/classify.js` | Deterministic type + status classification |
| `import/import.js` | The import path: parse → classify → append via the store, deduped |
| `import/prioritise.js` | The scheduled / done / pending view over the record |
| `import/live-stubs.js` | Named sockets for live routes — NOT LIVE, never wired |
| `cli/import.js`, `cli/due.js` | `import` and `due` commands |
| `demo-import.mjs` | Demo: imports the fictional samples into a scratch record and renders the view (`npm run demo:import`) |
| `test/fixtures/sample-whatsapp-chat.txt`, `test/fixtures/linkedin/` | Fictional sample exports — invented people, invented messages, never real message content |

## Trying it

```sh
npm run demo:import   # imports the samples twice into a temp record, shows dedupe + the due view
npm test              # 295 existing tests plus the import tests
```
