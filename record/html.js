// The record as one page a person can read.
//
// Everything on the page comes from the entries handed in. Nothing is typed in
// twice: the counts are counted, every value is escaped, and the page names the
// file it came from and the moment it was made. A page that drifted from the
// record would be a second, unofficial version of it — exactly what this layer
// exists to prevent — so it is a view, and it says so.
//
// No external font, image or script is referenced: the file opens anywhere, and
// nothing on the page can quietly change after it was made.

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

function entryCard(entry) {
  const what = entry.what ?? {};
  const label = entry.label === 'judgment' ? 'judgment' : 'fact';
  const bad = what.ok === false;

  const rows = [];

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
    <article class="entry ${bad ? 'entry--bad' : ''}">
      <div class="entry__head">
        <span class="entry__seq">${esc(entry.seq)}</span>
        <span class="chip chip--${label}">${esc(label)}</span>
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
export function renderPage(entries, { source = 'the record file', generatedAt = '' } = {}) {
  const stats = measure(entries);
  const deck = [
    count(stats.total, 'call'),
    count(stats.facts, 'fact'),
    count(stats.judgments, 'judgment'),
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
  <hr class="rule">
  <ul class="legend">
    <li><span class="chip chip--fact">fact</span> something observed: a call went out, and this is what came back</li>
    <li><span class="chip chip--judgment">judgment</span> an assessment someone made about an observation</li>
  </ul>
${body}
  <p class="foot">
    Generated from <code>${esc(source)}</code>${generatedAt ? ` on ${esc(generatedAt)}` : ''}.
    Every number and every line above was read from that file at that moment;
    nothing here was typed in by hand.<br>
    ${esc(count(stats.worked, 'call'))} worked · ${esc(count(stats.notSent, 'call'))} never sent ·
    ${esc(count(stats.withBody, 'entry', 'entries'))} kept the request body ·
    ${esc(stats.tokens)} tokens in total.
    ${stats.judgments === 0 ? 'No judgments yet: the agent that writes them is not built.' : ''}
    This page is a view of the record, not a copy of it — regenerate it after every call.
  </p>
</div>
</body>
</html>
`;
}
