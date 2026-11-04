# Architecture

One idea, four small parts, one call path. No part talks to a model except
through the provider seam, and no part writes to the record except through
the wrapper.

```
Agent
  │
  ▼
Wrapper (wrapper/wrap.js) ── writes exactly one labelled entry per attempt,
  │                          before the result is returned
  ▼
Worker (worker/) ── builds the Meta-shaped request
  │
  ▼
Provider seam (provider/) ── provider.call(plug, …)
  │                          only provider/transport.js touches the network
  ▼
Plug ── meta | openrouter | nvidia | inception | picture | baseten (skipped, key never obtained)
```

| Folder | Responsibility, and nothing else |
| --- | --- |
| `wrapper/` | The one path a worker call goes through. Sees every call and every result by construction. |
| `record/` | The append-only record store. Entries are added, never edited or removed. |
| `provider/` | The seam. Plugs describe one provider each: address, key variable, model. |
| `worker/` | The Worker agent's call path. Not a second way out. |
| `judge/` | The single-seat judge, the three-seat panel, and MMRC consolidation. |
| `cli/`, `bin/` | The command line that ties the three together. |
| `test/` | Offline checks. No key and no network needed. |
| `checks/` | Golden-file checks for the record page, panel, and folders views. |

## Labels

Every entry is labelled in the entry itself, so a reader always knows what
kind of statement they are looking at:

- `fact` — something observed. A call went out and this is what came back.
- `judgment` — the Curator's assessment of an observed move, labelled as one.
- `question` — an open follow-up question. It darkens nothing.
- `delivery` — the MMRC consolidation of one move's three seat reports,
  derived from them and checked unchanged.

## Greyscale

Support is counted, not judged. One independent supporting sentence moves
a chapter one shade darker on a 0–9 greyscale:

```
support(chapter) = count of independent supporting sentences
shade(chapter)   = min(support, 9)
filed(chapter)   ⇔ shade ≥ 8
```

Below 8, a chapter stays grey and open. Grey is a legitimate state.
