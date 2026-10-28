// The record as one page a person can read.
//
// Everything on the page comes from the entries handed in. Nothing is typed in
// twice: the counts are counted, every value is escaped, and the page names the
// file it came from and the moment it was made. A page that drifted from the
// record would be a second, unofficial version of it — exactly what this layer
// exists to prevent — so it is a view, and it says so.
//
// No external font, image or script is referenced: the file opens anywhere, and
// nothing on the page can quietly change after it was made. The one piece of
// browser code this page can carry — the live badge and its poller — lives in
// ./browser.js, so it is clear that it runs in the page and not in this process.
//
// This file assembles the document: the counts, the head, the stylesheet, the
// order of the sections, and the foot. The sections themselves live beside it —
// ./cards.js for one entry, ./sections.js for the index, the plugs and the parked
// list, ./markup.js for escaping and the shared words — so a page can gain a
// section without this file having to hold every one of them.

import { liveBadge, liveScript } from './browser.js';
import { entryCard } from './cards.js';
import { count, esc } from './markup.js';
import { renderGraphs, renderIndex, renderParked, renderReadout, renderSocket } from './sections.js';

/** The numbers on the page, counted from the entries rather than assumed. */
function measure(entries) {
  const by = (predicate) => entries.filter(predicate).length;

  return {
    total: entries.length,
    facts: by((e) => e.label === 'fact'),
    judgments: by((e) => e.label === 'judgment'),
    questions: by((e) => e.label === 'question'),
    worked: by((e) => e.what?.ok === true),
    notSent: by((e) => e.what?.noCallMade === true),
    withBody: by((e) => Boolean(e.what?.request?.body)),
    tokens: entries.reduce((sum, e) => sum + (Number(e.what?.usage?.total_tokens) || 0), 0),
    models: [...new Set(entries.map((e) => e.what?.model).filter((m) => typeof m === 'string' && m !== ''))],
  };
}

const STYLE = `
  :root {
    --paper: #f6f3ec;
    --ink: #1a1710;
    --muted: #6b6154;
    --rule: #d9d2c3;
    --fact: #0f5e3f;
    --judgment: #8a3b12;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 3.5rem 1.5rem 4rem;
    background: var(--paper);
    color: var(--ink);
    font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .sheet { max-width: 47rem; margin: 0 auto; }
  .eyebrow {
    margin: 0 0 .6rem;
    font-size: .68rem;
    font-weight: 600;
    letter-spacing: .18em;
    text-transform: uppercase;
    color: var(--muted);
  }
  h1 {
    margin: 0 0 .8rem;
    font: 600 clamp(1.9rem, 5vw, 2.6rem)/1.12 "Iowan Old Style", Georgia, serif;
    letter-spacing: -.015em;
  }
  .deck { margin: 0 0 1.8rem; font-size: 1.02rem; color: var(--muted); }
  .deck strong { color: var(--ink); font-weight: 600; }
  .rule { height: 1px; background: var(--rule); border: 0; margin: 0 0 1.6rem; }
  .legend {
    display: flex; flex-wrap: wrap; gap: .5rem 1.4rem;
    margin: 0 0 2.4rem; padding: 0; list-style: none;
    font-size: .86rem; color: var(--muted);
  }
  .legend li { display: flex; align-items: baseline; gap: .45rem; }
  .chip {
    display: inline-block;
    padding: .1rem .48rem;
    border-radius: 2px;
    font-size: .66rem;
    font-weight: 700;
    letter-spacing: .12em;
    text-transform: uppercase;
    color: var(--paper);
  }
  .chip--fact { background: var(--fact); }
  .chip--judgment { background: var(--judgment); }
  .chip--question { background: none; color: var(--judgment); border: 1px dashed var(--judgment); }
  .chip--delivery { background: none; color: var(--judgment); border: 1px solid var(--judgment); }
  .chip--kind {
    background: none; color: var(--muted);
    border: 1px solid var(--rule); font-weight: 600; letter-spacing: .08em;
  }
  .live {
    display: inline-flex; align-items: center; gap: .5rem;
    margin: 0 0 1.3rem; padding: .26rem .62rem;
    border: 1px solid var(--rule); border-radius: 999px;
    font-size: .72rem; letter-spacing: .04em; color: var(--muted);
  }
  .live__dot { width: .45rem; height: .45rem; border-radius: 50%; background: var(--fact); }
  .live--stopped .live__dot { background: var(--judgment); }
  .index { display: flex; flex-wrap: wrap; align-items: baseline; gap: .4rem; margin: 0 0 1.9rem; }
  .index__label {
    margin-right: .3rem;
    font-size: .64rem; font-weight: 600; letter-spacing: .16em;
    text-transform: uppercase; color: var(--muted);
  }
  .index__link {
    min-width: 1.65rem; padding: .05rem .4rem;
    font: 600 .82rem/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--ink); text-align: center; text-decoration: none;
    border: 1px solid var(--rule); border-radius: 2px;
  }
  .index__link:hover, .index__link:focus-visible {
    background: var(--ink); border-color: var(--ink); color: var(--paper);
  }
  .entry:target { background: rgba(26, 23, 16, .045); }
  .socket { margin: 0 0 2.2rem; }
  .socket h2 {
    margin: 0 0 .5rem;
    font-size: .68rem; font-weight: 600; letter-spacing: .18em;
    text-transform: uppercase; color: var(--muted);
  }
  .socket__note { margin: 0 0 .8rem; max-width: 40rem; font-size: .82rem; color: var(--muted); }
  .socket__list { margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--rule); }
  .socket__row {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: .2rem .7rem;
    padding: .5rem 0; border-bottom: 1px solid var(--rule); font-size: .88rem;
  }
  .socket__name { min-width: 9rem; font-weight: 600; }
  .socket__role {
    font-size: .64rem; letter-spacing: .1em; text-transform: uppercase; color: var(--muted);
  }
  .socket__state { color: var(--muted); }
  .socket__row--called .socket__state { color: var(--fact); font-weight: 600; }
  .socket__last {
    margin-left: auto;
    font: .74rem/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--muted);
  }
  .readout { margin: 0 0 2.2rem; }
  .readout h2 {
    margin: 0 0 .5rem;
    font-size: .68rem; font-weight: 600; letter-spacing: .18em;
    text-transform: uppercase; color: var(--muted);
  }
  .readout__note { margin: 0 0 .8rem; max-width: 40rem; font-size: .82rem; color: var(--muted); }
  .readout__move { margin: .9rem 0 .4rem; font-size: .86rem; color: var(--muted); }
  .readout__list { margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--rule); }
  .readout__row {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: .2rem .7rem;
    padding: .45rem 0; border-bottom: 1px solid var(--rule); font-size: .88rem;
  }
  .readout__kind {
    min-width: 8.5rem;
    font-size: .64rem; letter-spacing: .1em; text-transform: uppercase; color: var(--muted);
  }
  .readout__kind--probable { color: var(--fact); font-weight: 700; }
  .readout__text { flex: 1 1 18rem; }
  .readout__count { margin-left: auto; font: .74rem/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); }
  .readout__aside { padding: .45rem 0; border-bottom: 1px solid var(--rule); font-size: .82rem; color: var(--muted); }
  .readout__drift { margin: .1rem 0 .5rem; font-size: .82rem; font-weight: 600; color: var(--judgment); }
  .parked { margin: 0 0 2.2rem; }
  .parked h2 {
    margin: 0 0 .5rem;
    font-size: .68rem; font-weight: 600; letter-spacing: .18em;
    text-transform: uppercase; color: var(--muted);
  }
  .parked__note { margin: 0 0 .8rem; max-width: 40rem; font-size: .82rem; color: var(--muted); }
  .parked__list { margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--rule); }
  .parked__row {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: .2rem .7rem;
    padding: .5rem 0; border-bottom: 1px solid var(--rule); font-size: .88rem;
  }
  .parked__seq {
    min-width: 1.6rem;
    font: 600 .95rem/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--muted);
  }
  .parked__state { color: var(--judgment); font-weight: 600; }
  .parked__about { color: var(--muted); }
  .parked__subject { margin-left: auto; font-size: .78rem; color: var(--muted); }
  .entry {
    padding: 1.35rem 0 1.5rem;
    border-top: 1px solid var(--rule);
    break-inside: avoid;
  }
  .entry:first-of-type { border-top: 0; padding-top: 0; }
  .entry__head {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: .6rem;
    margin-bottom: .9rem;
  }
  .entry__seq {
    font: 600 1.35rem/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--muted);
    min-width: 1.6rem;
  }
  .entry__when {
    font: .8rem/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--muted);
  }
  .entry__facts {
    margin-left: auto;
    font: .8rem/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--muted);
  }
  .entry__body { margin: 0; padding-left: 2.2rem; }
  .entry__body dt {
    float: left; clear: left; width: 5.4rem;
    font-size: .72rem; font-weight: 600; letter-spacing: .1em;
    text-transform: uppercase; color: var(--muted);
    padding-top: .18rem;
  }
  .entry__body dd {
    margin: 0 0 .55rem 5.4rem;
    font-size: .97rem;
    overflow-wrap: anywhere;
  }
  .entry__body dd:last-child { margin-bottom: 0; }
  .foot {
    margin-top: 3rem; padding-top: 1.2rem;
    border-top: 1px solid var(--rule);
    font-size: .82rem; line-height: 1.6; color: var(--muted);
  }
  .foot code { font: .95em ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink); }
  .empty { padding: 2rem 0; color: var(--muted); }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { max-width: none; }
    .chip { border: 1px solid currentColor; }
  }
`;

/**
 * Render the whole page.
 * @param {Array} entries   the record as read from the file, oldest first
 * @param {{source?: string, generatedAt?: string, parked?: Array}} meta  where it came from, when, and what is parked
 * @returns {string} a complete, self-contained HTML document
 */
export function renderPage(entries, { source = 'the record file', generatedAt = '', plugs = [], live = null, parked = [], readout = null } = {}) {
  const stats = measure(entries);
  // The total is entries, not calls. A judgment and a question are entries and no
  // call was made for either, so "N calls" over a record that holds them said
  // something about the file that was not true of it: one call with a judgment on
  // it read as two calls. What was called is counted where that is known — the
  // foot counts the calls that worked and the calls that were never sent.
  //
  // A question is a third kind of entry, so it gets its own count: a page that
  // folded questions into judgments would misreport what the record holds.
  const deck = [
    count(stats.total, 'entry', 'entries'),
    count(stats.facts, 'fact'),
    count(stats.judgments, 'judgment'),
    count(stats.questions, 'question'),
  ].join(' · ');

  const models = stats.models.length ? stats.models.join(', ') : 'no model recorded yet';

  const body = entries.length
    ? entries.map(entryCard).join('\n')
    : '<p class="empty">Nothing has been recorded yet. The page is empty because the file is.</p>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Overseer — a K-record of ${esc(count(stats.total, 'entry', 'entries'))}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="sheet">
  <p class="eyebrow">The Overseer</p>
  <h1>A record of what actually happened</h1>
  <p class="deck"><strong>${esc(deck)}</strong> — ${esc(models)}</p>
${live ? liveBadge() : ''}  <hr class="rule">
${renderIndex(entries)}${readout ? renderReadout(readout) : ''}${renderGraphs(entries)}${plugs.length ? renderSocket(entries, plugs) : ''}${parked.length ? renderParked(parked) : ''}  <ul class="legend">
    <li><span class="chip chip--fact">fact</span> something observed: a call went out, and this is what came back</li>
    <li><span class="chip chip--judgment">judgment</span> the Overseer's assessment of an observed move, labelled as one</li>
    <li><span class="chip chip--question">question</span> an open question on a subject, sitting in its thread until the record answers it</li>
    <li><span class="chip chip--delivery">delivery</span> the MMRC consolidation of one move's three seat reports, derived from them and checked unchanged</li>
  </ul>
${body}
  <p class="foot">
    Generated from <code>${esc(source)}</code>${generatedAt ? ` on ${esc(generatedAt)}` : ''}.
    Every number and every line above was read from that file at that moment;
    nothing here was typed in by hand.<br>
    ${esc(count(stats.worked, 'call'))} worked · ${esc(count(stats.notSent, 'call'))} never sent ·
    ${esc(count(stats.withBody, 'entry', 'entries'))} kept the request body ·
    ${esc(stats.tokens)} tokens in total.
    ${stats.judgments === 0 && stats.questions === 0 ? 'No judgments or questions yet: the judge has not written one.' : ''}
    This page is a view of the record, not a copy of it — regenerate it after every call.
  </p>
</div>
${live ? liveScript(live.sig ?? '') : ''}</body>
</html>
`;
}
