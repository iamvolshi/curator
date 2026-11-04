# Live demo panel — three judges, 4 November 2026

Live demo: https://volshi-curator.web.app

## Seats

| Seat | Model | Route |
| --- | --- | --- |
| Judge 1 | Meta Muse 1.3 | Meta Model API, no max_tokens cap |
| Judge 2 | Meta Muse 1.1 | Meta Model API |
| Judge 3 | OpenRouter Glimmer (`meta/muse-glimmer-30b`), Meta's open-weights 30B model | OpenRouter, max_tokens 4000 |

Earlier seats are superseded in the live demo: NVIDIA Glimmer was swapped out because NVIDIA blocks browser-origin calls, and OpenRouter Spark Open was swapped out because it burned its token cap on reasoning and returned nulls/errors. The repo's configurable panel (NVIDIA / Inception seats, Baseten single judge) is described in the README body and is not the live demo's seating.

## How it answers

- **Panel of opinions.** Each seat is one voice of three and cannot see the others. Three separate opinions, never one merged opinion.
- **Open-weights leg.** Judge 3 is Meta's open-weights 30B model, Glimmer. Judges 1 and 2 (Muse 1.3, Muse 1.1) and the picture kid (Muse Image) are hosted Meta Model API models, not open-weights — the open-weights claim rests on Judge 3 alone, and it is made as such.
- **Synthesis (MMRC).** A Meta call consolidates the three replies. Judge 1's reply shows immediately; the synthesis replaces it in the same place. If synthesis fails within 30 seconds, Judge 1's reply stands.
- **Majority, dissent kept.** The majority opinion is the highest probable. A 2–1 readout is probable NOT JUSTIFIED (or whatever the majority says), with the dissent — including CANNOT TELL — kept on screen, never dropped. With no majority, no probable is declared and every reading is surfaced.
- **Judges only for grading.** Judges are called only for confused, ambiguous, or reasoning questions: authorised, believed, justified, conflict, explain, reasoning, should.
- **Deterministic first.** List / show-me questions, and any question with an answer straight from the record, are answered deterministically and labelled "Agent — deterministic, no judges called". No deterministic hit means fall through to the judges, never guess.
- **Not-knowing is first-class.** When the record does not say — for example, why Ada became head of records on Tuesday, beyond Priya Nair naming her — the answer is "I do not know it", registered and visible, never filled with a plausible guess.
- **Appended updates are addressed explicitly.** When an update is appended to the record, every judge and the synthesis must state it, say whether it changes the conclusion, and say why not if it does not. An appended update is never silently dropped.
- **Errors are honest.** A seat that errors shows an ✗, not a ✓. Plain-language errors, 60-second timeouts on the standalone panel.

## Standalone judge panel

The demo's standalone panel judges one move — "Ada approved the $11,500 invoice on Wednesday" — against the Tuesday Priya rule and the Friday sign-off, with inquisitor questions Q1–Q5. Seats render per-seat as each returns. Verified readout: probable NOT JUSTIFIED (2 of 3), dissent kept (CANNOT TELL).

## Wednesday sequence

In the Jobs chat, "Run it: answer, update, ask again": (1) ask whether Ada was authorised on Wednesday and wait for the judges, (2) apply the Wednesday update — Priya confirms the old rule covered it — as a NEW entry, old entry not edited, Wednesday chapter stays grey at 5/9, (3) ask the same question again and watch the answer change in full view, old uncertainty still underneath.
