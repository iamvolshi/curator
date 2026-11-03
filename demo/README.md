# Curator demo — source of truth

Renamed from Overseer to Curator on 3 November 2026. The live Firebase site URL is unchanged: https://volshi-overseer.web.app

This folder is the demo website source, committed 2026-11-02 after it was
found that the live Firebase site (https://volshi-overseer.web.app) had been
deployed from a local folder that was never committed to GitHub.

- `index.html` is the demo page (seed story, chapters, Life chapters, chat,
  ready prompt, 49-entry record link).
- Presentation cleanup (2026-11-02): seed story collapses after pull-apart
  with a show/hide toggle; Step 2 chapters are accordions, closed by
  default; Life-chapter past entries are collapsed; the grey-chapter
  boilerplate appears once, as a single note, not per chapter.
- Green tiles: the live page showed a dark-green tile per filed chapter
  (IB, AO, LG, CT, $T, $I, DO, AU). Those labels are per-chapter values
  observed on the live page, reproduced here — they are not title initials.
  This file is a live-equivalent reconstruction, not a byte-for-byte copy
  of an uncommitted original, because the original source was never found
  in GitHub or on file.
- Demo logic (parser, greyscale, shades, chat answers, record link) is
  unchanged by the cleanup.

Deploy from this committed file, not from a stray local folder.
