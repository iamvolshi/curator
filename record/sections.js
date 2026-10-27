// The page's sections, other than the entries themselves.
//
// Three of them, each answering a different question a reader arrives with: which
// entry is which (the index), who has actually answered (the plugs), and what the
// judge has stopped attempting (the parked list). They are separated from the
// document that arranges them for one reason — a page grows sections, and the file
// that assembles the page should not also have to hold every one of them.

import { clip, count, esc } from './markup.js';

/**
 * A row of entry numbers, each one a link to its own entry.
 * Built from the entries, so the index cannot list a number that is not there.
 */
export function renderIndex(entries) {
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
export function renderSocket(entries, plugs) {
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
 * The moves the judge has stopped attempting.
 *
 * A parked move has no entry of its own — a park is not a judgment — so a page
 * built only from the record would show a subject as finished while one of its
 * moves had quietly stopped being tried. It is shown as waiting, and the note
 * says where the fact comes from: a count in a file beside the record, not an
 * entry in it.
 */
export function renderParked(parked) {
  const rows = parked
    .map(
      (move) => `      <li class="parked__row">
        <span class="parked__seq">${esc(move.seq)}</span>
        <span class="parked__state">${esc(count(move.fails, 'failed attempt'))}</span>
        <span class="parked__about">${esc(clip(move.prompt || 'a move with no prompt recorded'))}</span>
        <span class="parked__subject">${esc(move.subjects?.length ? move.subjects.join(', ') : 'no subject')} \u00b7 ${esc(move.reason)}</span>
      </li>`,
    )
    .join('\n');

  return `  <section class="parked">
    <h2>Parked \u2014 still unjudged, not attempted</h2>
    <p class="parked__note">The judge's replies for these moves kept failing, so it stopped
    spending calls on them. Nothing is decided about a move here: it is still unjudged, it is
    not in the record as judged, and <code>--retry-parked</code> offers it again.</p>
    <ul class="parked__list">
${rows}
    </ul>
  </section>
`;
}
