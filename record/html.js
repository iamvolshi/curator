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

import { liveBadge, liveScript } from './browser.js';

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape text for HTML. Model output is not trusted to be markup. */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

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

/** "3 calls · 3 facts · 0 judgments", with the plural handled once. */
function count(n, singular, plural = `${singular}s`) {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Shorten text for a tooltip, where a long value would be unusable. */
function clip(value, max = 90) {
  const flat = String(value ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}\u2026` : flat;
}

/**
 * A row of entry numbers, each one a link to its own entry.
 * Built from the entries, so the index cannot list a number that is not there.
 */
function renderIndex(entries) {
  if (entries.length === 0) return '';

  const links = entries
    .map((entry) => {
      const what = entry.what ?? {};
      const said = what.ok === false ? 'did not work' : 'worked';
      const about = clip(what.prompt ?? what.kind ?? 'an entry');
      const title = `entry ${entry.seq} \u2014 ${entry.label}, ${said}: ${about}`;
      return `<a class="index__link" href="#entry-${esc(entry.seq)}" title="${esc(title)}">${esc(entry.seq)}</a>`;
    })
    .join('\n    ');

  return `  <nav class="index" aria-label="Entries">
    <span class="index__label">Entries</span>
    ${links}
  </nav>\n`;
}

/** Which plug an entry belongs to, by what the entry itself says it did. */
function belongsTo(entry, plug) {
  const what = entry.what ?? {};
  // A plug prove names its plug outright. A worker call names the address it
  // reached, so the address is what it is matched on.
  if (what.plug) return what.plug === plug.name;
  return Boolean(plug.chatUrl) && what.endpoint === `POST ${plug.chatUrl}`;
}

/** Short, non-alarming words for a slot that cannot be called yet. */
const WAITING = {
  'needs-config': 'not configured yet',
  'awaiting-pick': 'waiting on the provider and model pick',
  'needs-parser': 'cannot read an image reply yet',
};

/**
 * One line per plug: what the record shows for it, or that it is silent.
 * "Never called" is reported as silence, never as a failure — the two are
 * different facts and only one of them is bad news.
 */
function renderSocket(entries, plugs) {
  const rows = plugs.map((plug) => {
    const mine = entries.filter((entry) => belongsTo(entry, plug));
    const worked = mine.filter((entry) => entry.what?.ok === true).length;
    const last = mine.length ? mine[mine.length - 1].when : null;

    let state;
    if (mine.length > 0) {
      const failed = mine.length - worked;
      state = `${count(mine.length, 'call')} \u00b7 ${worked} worked${failed ? ` \u00b7 ${failed} did not` : ''}`;
    } else if (plug.status === 'ready') {
      state = 'ready, not called yet';
    } else {
      state = `not called \u2014 ${WAITING[plug.status] ?? 'not ready'}`;
    }

    return {
      name: plug.label ?? plug.name,
      role: plug.role ?? '',
      state,
      called: mine.length > 0,
      last,
    };
  });

  return `  <section class="socket">
    <h2>Who has actually answered</h2>
    <p class="socket__note">Counted from this record, not from configuration. A plug with no
    entries here has not been called \u2014 which is not the same as having failed.</p>
    <ul class="socket__list">
${rows
    .map(
      (row) => `      <li class="socket__row ${row.called ? 'socket__row--called' : ''}">
        <span class="socket__name">${esc(row.name)}</span>
        <span class="socket__role">${esc(row.role)}</span>
        <span class="socket__state">${esc(row.state)}</span>
        ${row.last ? `<span class="socket__last">last ${esc(row.last)}</span>` : ''}
      </li>`,
    )
    .join('\n')}
    </ul>
  </section>
`;
}

/**
 * The kind of call, in a word.
 *
 * A proof that a plug answers and a piece of real work through that same plug
 * land in the same place on this page, on the same address, sometimes a second
 * apart. Without this they would look identical, so the page says which is which.
 */
const CALL_KINDS = {
  'worker-call': 'worker call',
  'plug-prove': 'prove',
  'plug-task': 'task',
};

function kindChip(what) {
  const words = CALL_KINDS[what.kind];
  if (!words) return '';
  const plug = what.plug ? ` \u00b7 ${what.plug}` : '';
  return `\n        <span class="chip chip--kind">${esc(words + plug)}</span>`;
}

function entryCard(entry) {
  const what = entry.what ?? {};
  // The label is the difference between the three kinds of entry, so it is taken
  // from the entry rather than guessed: a question shown under a fact chip would
  // be a reader mistaking an open question for something observed.
  const label = entry.label === 'judgment' || entry.label === 'question' ? entry.label : 'fact';
  const bad = what.ok === false;

  const rows = [];

  // A judgment and a question hold no call: they read as what they are, not as a
  // JSON blob that a reader has to parse to find the point.
  if (what.kind === 'judgment') {
    if (Number.isInteger(what.move)) rows.push(['Judges', `the move at seq ${what.move}`]);
    if (what.observation !== undefined) rows.push(['Observed', what.observation]);
  }
  if (what.kind === 'question') {
    if (Number.isInteger(what.move)) rows.push(['About', `the move at seq ${what.move}`]);
    if (what.question !== undefined) rows.push(['Asks', what.question]);
  }

  if (what.prompt !== undefined) rows.push(['Asked', what.prompt]);
  if (what.ok === true && what.response !== undefined) rows.push(['Answered', what.response]);
  if (what.endpoint) rows.push(['Sent to', what.endpoint]);
  if (what.request?.body) rows.push(['Body', 'kept exactly as sent']);

  if (bad) {
    rows.push(['Result', what.noCallMade ? 'nothing was sent' : 'the call did not work']);
    if (what.error?.kind) rows.push(['Problem', what.error.kind]);
    if (what.error?.message) rows.push(['Detail', what.error.message]);
    if (what.error?.fix) rows.push(['Fix', what.error.fix]);
  }

  // An entry shape this renderer does not know (a judgment, or anything a later
  // outcome adds) still shows up as what it actually holds, rather than as an
  // empty card that looks like a missing record.
  if (rows.length === 0) rows.push(['Recorded', JSON.stringify(what)]);

  const facts = [];
  if (what.model) facts.push(what.model);
  if (what.usage?.total_tokens !== undefined) facts.push(`${what.usage.total_tokens} tokens`);
  if (what.durationMs !== undefined) facts.push(`${what.durationMs} ms`);

  return `
    <article class="entry ${bad ? 'entry--bad' : ''}" id="entry-${esc(entry.seq)}">
      <div class="entry__head">
        <span class="entry__seq">${esc(entry.seq)}</span>
        <span class="chip chip--${label}">${esc(label)}</span>${kindChip(what)}
        <span class="entry__when">${esc(entry.when)}</span>
        ${facts.length ? `<span class="entry__facts">${esc(facts.join(' · '))}</span>` : ''}
      </div>
      <dl class="entry__body">
        ${rows
          .map(
            ([term, value]) =>
              `<dt>${esc(term)}</dt><dd>${term === 'Body' ? `<em>${esc(value)}</em>` : esc(value)}</dd>`,
          )
          .join('\n        ')}
      </dl>
    </article>`;
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
 * @param {{source?: string, generatedAt?: string}} meta  where it came from, and when
 * @returns {string} a complete, self-contained HTML document
 */
export function renderPage(entries, { source = 'the record file', generatedAt = '', plugs = [], live = null } = {}) {
  const stats = measure(entries);
  // A question is a third kind of entry, so it gets its own count: a page that
  // folded questions into judgments would misreport what the record holds.
  const deck = [
    count(stats.total, 'call'),
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
<title>The Overseer — a K-record of ${esc(count(stats.total, 'call'))}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="sheet">
  <p class="eyebrow">The Overseer</p>
  <h1>A record of what actually happened</h1>
  <p class="deck"><strong>${esc(deck)}</strong> — ${esc(models)}</p>
${live ? liveBadge() : ''}  <hr class="rule">
${renderIndex(entries)}${plugs.length ? renderSocket(entries, plugs) : ''}  <ul class="legend">
    <li><span class="chip chip--fact">fact</span> something observed: a call went out, and this is what came back</li>
    <li><span class="chip chip--judgment">judgment</span> the Overseer's assessment of an observed move, labelled as one</li>
    <li><span class="chip chip--question">question</span> an open question on a subject, sitting in its thread until the record answers it</li>
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
