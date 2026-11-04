# Evaluation and benchmarks — measured, not claimed

All numbers below were measured on this repo, in the state committed here.
Reproduce them with the commands given. No live-model latency or accuracy
number is claimed here, because the offline test suite runs with no key and
no network, and a live call is a single proven call, not a benchmark.

## Test suite

```
$ npm test
tests 295
pass  295
fail  0
duration_ms 4191
```

Measured 3 November 2026, Node 22, `node --test`, offline. The suite covers
the wrapper (one entry per attempt, key never reaches the record), the
append-only store (entries added, never edited), the provider seam, the
worker call path, the judge, the three-seat panel and MMRC consolidation,
folders as a view of the record, the 0–9 greyscale, and the readable record
page (golden-file checks in `checks/`).

## Demo record

The demo story is 49 sentences. Pulled apart by topic tests, it gives
11 chapters:

- Filed (shade 8–9): origin 9, career 9, office 9, certificate 8,
  new rule 9, invoices 9, supplier 9, audit 8 — 8 chapters.
- Grey (shade below 8): Wednesday question 2, conflict 1,
  predecessor 1 — 3 chapters.

The full record behind the demo is 13 entries: 12 facts, 1 question,
0 entries edited. See the live technical report at
https://volshi-curator.web.app/record-engine.html

## Live product

- Live demo: https://volshi-curator.web.app
- Terminal transcript (Muse Spark 1.3 through the wrapper):
  https://volshi-curator.web.app/terminal.html
- Demo video: 2 minutes 59 seconds, under the 3-minute cutoff.
  Submitted video: https://www.youtube.com/watch?v=YC4BOTF0ERU

## What is NOT claimed

- No live-model latency benchmark: the one live Worker call (26 October
  2026, Muse Spark via the Meta Model API) proves the call path, it does
  not measure it.
- No head-to-head accuracy claim against any other system: unmeasured,
  not lost.
- No live open-weights stage in this repo: the Baseten plug is skipped,
  key never obtained. The open-weights bonus leg is not claimed here.
- Muse Image (`muse-image-1.0`) is proprietary, not open weights. It is
  a Meta-tooling leg, not an open-weights leg. Muse Spark / Spark Open /
  Glimmer are text-out only and cannot fill the picture slot.
