# Overseer

The K-record accountability layer for agent calls. This repository is the floor
for the Overseer: the piece that sits between an agent and a model, sees every
call, and writes down what happened.

This is **Outcome 1** of the build plan. It delivers four things and no more:

1. The repository itself.
2. A scaffold that runs without hand-patching.
3. One real Muse Spark call through the Meta Model API.
4. One `fact` entry written to the record and read back with its label intact.

All four are done. The live call was made on 26 October 2026 — see
[Which plugs are proven](#which-plugs-are-proven).

**Outcome 2** adds the provider seam: one function every model call goes through,
three plugs behind it, and a fixed routing table. See
[Where model calls go](#where-model-calls-go).

**Outcome 3** makes the first live run: the `meta` plug is called for real, and
the `fact` entry it produced is read back from the file.

## What is here

Four small parts, one idea each.

| Folder | What it is |
| --- | --- |
| `wrapper/` | The one path a worker call goes through. Because it is the only path, it sees every call and every result by construction, and it writes exactly one record entry per attempt. |
| `record/` | The append-only record store. Entries are added, never edited or removed. Each entry carries what happened, when, and a label. |
| `provider/` | The provider seam. Every model call goes through `provider.call(plug, …)`, and the only file that touches the network is `provider/transport.js`. Plugs describe one provider each: address, key variable, where the model comes from. |
| `worker/` | The Worker agent's call path. It builds the Meta-shaped request and hands it to the seam — it is not a second way out. "Worker" here means this module: the thing that makes the model call. |
| `cli/`, `bin/` | The command line that ties the three together. |

### The two labels

Every entry is labelled, so a reader always knows what kind of statement they
are looking at:

- **`fact`** — something observed. A call went out and this is what came back.
- **`judgment`** — the Overseer's assessment of an observed move. Labelled, in
the entry itself, so no reader can mistake it for an observed fact.
- **`question`** — an open follow-up question on a subject, sitting in that
subject's thread. It is not a fact and not a judgment, and it darkens nothing.
When the move it is about names no subject, the question is written anyway and
belongs to no folder: an entry filed nowhere still exists, whereas silence would
leave the skipped move looking like one nobody looked at.

A judgment never changes a fact, and a question never darkens a shade. The
labels are what keep the three apart.

### Folders, the judge, and shade

A **folder** is a view of the record, one per subject: the entries that name
that subject, in record order, with their labels visible. It is rebuilt from the
record on every read, so it cannot lose an entry or disagree with it, and nothing
seeds one. A subject is **declared**, never guessed — `task --subject "..."`
says what the work is about. Guessing from prose was available and it was wrong:
this record's own text would have produced a folder called "Company Logs Every
AI Agent Call Permanently", because a Title Case headline looks exactly like a
proper noun.

`npm run folders` lists one folder per subject, and under them a shelf of
**unfiled questions** — questions whose move named no subject. They belong to no
folder by design, and the shelf exists so they can be read without opening the
record file. It appears even when the record declares no subjects at all, which
is this record's shape, and it is absent when nothing is unfiled, rather than
being an empty heading. **Parked** moves are listed here too — read within the
subject folder that is missing the move, and in their own section under the
folders — because a park writes no entry, so this is the one place a subject
could otherwise look finished while a move had stopped being tried. A parked
move is shown as waiting, never as judged.

`judge --limit N` judges at most N moves. What it does not reach is left
unjudged, not skipped — the next run offers it again, in record order — and the
run says so rather than looking complete.

`judge --move N` judges the one move with that seq, for reading a single judgment
before spending on the rest. `--limit` takes the front of the queue, which is not
always the move worth reading first; `--move` names it. Only an unjudged fact can
be named: a seq that is not in the record, that is already a judgment or a
question, or that already has one naming it is refused with exit 2, before any
call. The two options are alternatives, so giving both is also refused.

The **judge** reads the observed moves (facts) and appends what it observes. For
each move it asks the Overseer's model one question — does the record show the
basis? If it does, a `judgment` is written naming that move by sequence. If it
does not, no judgment is written and a `question` is written instead, because a
judgment needing something the record does not show is not one this record can
support. The question asks what in the record shows the basis for that move, and
the prompt forbids naming a mechanism, technique, tool or fix — a question asks
for evidence, not for a change, so "what hash chain anchors this?" is not one. A question about a move that names no subject is written too — unfiled,
but recorded and visible, and naming the move — because the older behaviour, not
writing it, let a move the judge declined leave no trace at all, and left it in
the queue to cost another call every later run. Wording that directs the agent ("you should…") is never written: the model's
directive cannot go in the record, and neither can silence, so the gap is written
instead as a question in the record's own words, naming the move, saying why no
observation was written, and — because the move is now named — leaving the queue.
The run names the phrase that was refused. A call that never arrived, and a
reply that arrived unreadable, write nothing at all and leave the move in the
queue: nothing was decided about that move, so an entry would assert a gap
nobody observed, and naming the move would spend the retry a bad reply deserves.
The run says which of the three happened, and the next run offers those moves
again. Because that leaves a persistently broken move costing a call on every
run, the judge keeps a count of failed attempts per move in
`records/judge-attempts.json` — deliberately not part of the record, and ignored
by git. At three failed attempts a move is **parked**: not attempted, nothing
written about it, still unjudged in the record, and listed by the run that
skipped it. `--retry-parked` clears the counts and offers everything again, and
deleting the file does the same. A success clears the count on its own. The judge runs on the
`baseten` plug and never touches a fact entry; without Baseten credentials it
refuses before any call, writing nothing.

**Shade** runs 0 (white) to 9 (black), and 8–9 is the black band. It is counted,
not judged: each independent supporting fact about a subject darkens it by one,
the same move repeated does not stack, and a judgment or a question darkens
nothing. Past nine the shade stops moving while the support count keeps being
true. There is no stored shade — it is recomputed from the facts on every read,
and where an old number disagrees with the count, the count wins.

### What a `fact` entry looks like

One entry per line, in `records/k-record.jsonl`:

```json
{"seq":1,"when":"2026-10-26T23:12:32.281Z","label":"fact","what":{"kind":"worker-call","worker":"meta-model-api","endpoint":"POST https://api.meta.ai/v1/chat/completions","model":"muse-spark-1.3","prompt":"Reply with the single word: ready","ok":true,"response":"ready","finishReason":"stop","usage":{"completion_tokens":171,"prompt_tokens":15,"total_tokens":186,"completion_tokens_details":{"reasoning_tokens":161},"prompt_tokens_details":{"cached_tokens":0}},"durationMs":1443,"error":null,"warnings":[],"noCallMade":false}}
```

A call that fails is recorded just as faithfully. A call that fails and is not
written down is exactly the hole this layer exists to close.

A prove call through any other plug writes the same entry with
`kind: "plug-prove"`, plus `plug` and `role` naming which plug was called. Real
work through any other plug writes it with `kind: "plug-task"`. The kind is read
from the result rather than assumed, so the entry says what happened and not what
the caller intended.

Entries also carry `request`: the method, the URL, and the exact body that was
sent. That is the same object the transport serialised, so re-serialising the
stored copy gives back byte for byte what went over the wire — an offline check
asserts exactly that against the string the transport actually sent. The
`Authorization` header is deliberately left out, because a record that can be
handed to someone must not carry a key. A call that was never sent records
`request: null`, and the first entries in this repository predate the field, so
they have none — they are left as written, because the record is append-only.

## Where model calls go

Every model call in this repo goes through one function,
`provider.call(plug, { messages, model, … })`. There is no second way out: the
only file that touches the network is `provider/transport.js`, and an offline
check fails if any other file calls `fetch` or reaches for a plug directly.

A **plug** is one provider, described the same way every time: a base URL, the
name of the environment variable holding its key, where its model comes from, and
a plain statement of where each of those values came from.

| Plug | Serves | Address | Key variable | Model |
| --- | --- | --- | --- | --- |
| `meta` | the Worker agent | `https://api.meta.ai/v1` | `MODEL_API_KEY` | `muse-spark-1.3`, Meta's documented default |
| `baseten` | the Overseer agent | `https://inference.baseten.co/v1` | `BASETEN_API_KEY` | unset on purpose: `BASETEN_MODEL` is Darren's pick |
| `openrouter` | interim development path, in no routing slot | `OPENROUTER_BASE_URL` | `OPENROUTER_API_KEY` | `OPENROUTER_MODEL`, none assumed |
| `picture` | the picture kid | — | — | — |

Routing is fixed in `provider/routing.js`: Worker → `meta`, Overseer → `baseten`,
picture kid → `picture`. A slot names a plug, never a URL or a model, so nothing
routes around the seam. `openrouter` is wired as a plug but sits in no slot.

The `picture` slot is wired but **empty on purpose**. The open-weights image
provider and its model are Darren's decision, so no address and no model are
filled in, and the slot refuses to call rather than sending a request to a model
nobody chose. It also has no reader for an image reply yet — the text plugs all
answer in the chat-completions shape, which carries no image. Both gaps are named
in `provider/plugs/picture.js` rather than papered over.

### Which plugs are proven

`meta` has been called for real. The other three have not, and the repo does not
claim otherwise:

| Plug | Wired | Live call |
| --- | --- | --- |
| `meta` | yes | **proven** — `muse-spark-1.3` answered `"ready"` in 1443 ms (186 tokens), one `fact` entry at `seq` 1 |
| `baseten` | yes | **blocked** on `BASETEN_API_KEY` and `BASETEN_MODEL` |
| `openrouter` | yes | **blocked** on `OPENROUTER_BASE_URL`, `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` |
| `picture` | slot only | **blocked** on the provider and model pick, and on an image reply reader |

## Running it

Needs Node 22.9 or newer. There are no dependencies to install.

```bash
npm test                # the offline checks, no key and no network needed
npm run prove:dry       # show the exact request that would be sent; sends nothing
npm run prove           # one real call on the Worker's plug (meta), recorded, read back
npm run prove:baseten   # the same, on the Overseer's plug
npm run prove:openrouter
npm run task -- --prompt "..."   # one real piece of work, recorded
npm run folders         # one folder per subject, plus any unfiled questions
npm run judge           # the Overseer observes the moves (needs Baseten)
npm run judge -- --limit 1   # ...and a first run can cost one call, not one per move
npm run judge -- --move 5    # ...or judge the one move with seq 5, whichever it is
npm run judge -- --retry-parked  # offer every move that kept failing again
npm run records         # read the record file back
npm run page            # write the record out as one readable page (record.html)
npm run live            # serve that page on 127.0.0.1 and keep it up to date
npm run status          # every plug: wiring, and whether its address answers; no key needed
```

`page` builds a single self-contained HTML file from the record as it is at that
moment — no external font, image or script, so it opens anywhere and can be
printed to PDF. Every number on it is counted from the entries, and every line of
model output is escaped rather than trusted as markup. A compact index of entry
numbers links straight to each entry, and each entry carries the matching anchor.
At the top it lists every
plug with what the record shows for it: the calls each one answered, counted from
the file, and the plugs that have never been called — reported as silence, which
is not the same as failure. Each entry also says what kind of call it was — a
worker call, a prove, or a task — so a check that a plug answers is not mistaken
for a piece of real work through the same plug. A move the judge has parked gets
a section of its own there, saying it is still unjudged and giving the count and
the last failure, so the page does not read as a subject fully accounted for.
The file is generated and
ignored by git: a committed copy would be a stale second version of the record.
Regenerate it after every call with `--out PATH` if you want it somewhere else.

`live` serves that same page on `127.0.0.1:4780` and rebuilds it from the record on
every request, so nothing has to be regenerated by hand between calls. The page
carries a signature of the file it was built from and asks the viewer whether it
has changed; when a call lands, the page reloads itself. That signature covers the
parking ledger as well as the record, since a run that parks a move writes nothing
to the record by design and the open page would otherwise keep saying the move was
still being tried. It binds to loopback only,
serves the page and that one signature and nothing else, and stops with Ctrl+C. Both
ways of looking at the record call the same renderer — the live one is not a second
implementation that could disagree with the saved page.

`status` reports every plug — its address, where its model comes from, whether its
key is present, and whether it can be called yet — then probes reachability
**only** where the plug names a key-free health address. Meta does, at
`/v1/status`. For a plug with none, it says so instead of guessing at a URL:
those addresses are proven by a real call, not by this command.

To make a real call, put a Meta Model API key in `MODEL_API_KEY`. Copy
`.env.example` to `.env` and fill it in — the npm scripts read `.env`
automatically, and `.env` is ignored by git.

```bash
npm run prove
```

`prove` makes **one** call, then reads the entry back **from the file** and
checks what is stored against what happened: one entry written, label `fact`,
timestamp, prompt, model, reply. It exits non-zero if anything does not match,
and it makes no call at all when the plug is not ready.

`--plug NAME` says which plug to prove. With no `--plug` it proves the Worker's
own plug, `meta`, through the worker's call path — unchanged. Any other plug is
proven by one plain call through the seam, and its entry is marked `plug-prove`
instead of `worker-call`, so a reader can tell a plug being checked apart from
the Worker doing a task. Add `--prompt "..."` to send your own prompt instead of
the default short one.

Exit codes: `0` everything held · `2` unknown plug name · `3` the plug is not
ready, so nothing was attempted · `4` the call did not work · `5` the call worked
but a stored item did not match.

`task` is the other way to make a real call, and it is not a prove: it runs one
piece of work through a plug and records it. A prove answers "is this plug wired,
and does it answer?"; work is the thing the record exists to hold, so the two get
different kinds (`plug-prove` and `plug-task`) and a reader can tell them apart.

```bash
npm run task -- --prompt "Name the three colours of a traffic light."
npm run task -- --plug baseten --prompt "..."
```

It prints the reply and the entry read back out of the file — no pass, no fail,
because it is not checking anything. With no `--plug` the work goes to the
Worker's plug (`meta`) through the worker's own call path, so its entry is a
`worker-call` like every other worker call. It has **no default prompt**: a task
with nothing to do is refused before anything is sent, rather than this command
inventing work. A plug that is not ready sends nothing and records nothing, and a
call that fails is recorded as faithfully as one that worked.

## The model

`muse-spark-1.3`. Meta's own documentation uses that model in its examples, so
it is the documented default, and it is set in one place:
[`worker/config.js`](worker/config.js). No model choice is settled in this
outcome — whichever model actually runs is written into every entry, taken from
what the API reports back, so the choice stays visible instead of assumed.
Override it with `MODEL_ID`.

## Telling failures apart

The three kinds of failure that get confused with each other have different
fixes, so they are named separately rather than lumped into "it didn't work":
the key was rejected (`auth`), the account cannot be charged (`billing`), or the
address or connection is wrong (`endpoint`). Only rate limits and server
failures are marked worth retrying unchanged — a non-streaming gateway timeout
is explicitly **not**, because the same request will usually time out again.
Anything not recognised stays `unknown` rather than being filed under a guess.

The mapping follows Meta's published error reference, listed below.

## Known limits

- The record store computes an entry's position (`seq`) by counting the lines
  already there. Fine at this scale — one line per call — and worth replacing
  with an index when records get long.
- Stored text is not truncated. A model reply and the request body are kept
  whole, and deliberately not printed in full by the read-back.
- One process at a time. There is no lock on the record file.
- Nothing here talks to a network except `provider/transport.js`.
- Proving a plug is a real, paid call. Nothing rate-limits it or stops it being
  run in a loop; one call per plug is the intention, not an enforcement.
- The record file is tracked in git, so a live call leaves one uncommitted line
  in the working tree.
- The picture slot has no reader for an image reply. Every plug here reads the
  chat-completions shape; an image answer (bytes or a URL) needs its own reader
  before that slot can run.

## Where the API facts came from

Read on 26 October 2026, so the next person does not have to re-derive them:

- API reference, base URL and auth — <https://dev.meta.ai/docs/api-reference>
- Chat Completions request and parameters — <https://dev.meta.ai/docs/protocols/chat-completions>
- Models and the `muse-spark-1.3` default — <https://dev.meta.ai/docs/models>
- Error types, status codes and retry guidance — <https://dev.meta.ai/docs/error-handling>
