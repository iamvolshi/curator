// One entry, as a card on the page.
//
// The card is where a reader learns what an entry is, so the label comes from the
// entry rather than being guessed: a question shown under a fact chip would be an
// open question mistaken for something observed. An entry shape this renderer does
// not know still shows what it actually holds, rather than an empty card that reads
// like a missing record.

import { esc } from './markup.js';

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

export function entryCard(entry) {
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
