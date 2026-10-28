// The page's sections, other than the entries themselves.
//
// Three of them, each answering a different question a reader arrives with: which
// entry is which (the index), who has actually answered (the plugs), and what the
// judge has stopped attempting (the parked list). They are separated from the
// document that arranges them for one reason — a page grows sections, and the file
// that assembles the page should not also have to hold every one of them.

import { callOutcome, clip, count, esc } from './markup.js';
import { seatGraph } from '../judge/graph.js';

/**
 * A row of entry numbers, each one a link to its own entry.
 * Built from the entries, so the index cannot list a number that is not there.
 */
export function renderIndex(entries) {
  if (entries.length === 0) return '';

  const links = entries
    .map((entry) => {
      const what = entry.what ?? {};
      // The word comes from the shared one, so the tooltip cannot call an entry that
      // recorded no call "worked" — or a judgment anything about a call at all.
      const said = callOutcome(what);
      const about = clip(what.prompt ?? what.kind ?? 'an entry');
      const title = `entry ${entry.seq} \u2014 ${entry.label}${said ? `, ${said}` : ''}: ${about}`;
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
 * different facts and only one of them is bad news. The same rule applies inside
 * a row that has entries: one that recorded no call at all is counted as never
 * sent rather than folded in with the ones that went out and failed.
 */
export function renderSocket(entries, plugs) {
  const rows = plugs.map((plug) => {
    const mine = entries.filter((entry) => belongsTo(entry, plug));
    const worked = mine.filter((entry) => entry.what?.ok === true).length;
    const neverSent = mine.filter((entry) => entry.what?.noCallMade === true).length;
    const didNot = mine.filter((entry) => callOutcome(entry.what) === 'did not work').length;
    const last = mine.length ? mine[mine.length - 1].when : null;

    let state;
    if (mine.length > 0) {
      // Entries, not calls: this plug's entries can include one where nothing was
      // sent, and counting those as calls would put a count on the row that the
      // record does not hold.
      state = [
        count(mine.length, 'entry', 'entries'),
        `${worked} worked`,
        neverSent ? `${neverSent} never sent` : '',
        didNot ? `${didNot} did not work` : '',
      ]
        .filter((part) => part !== '')
        .join(' \u00b7 ');
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
 * The panel's readout, on the page.
 *
 * Two parts, and they are drawn apart on purpose: the opinion with the most
 * independent agreement behind it, and every opinion that is not that one. A page
 * that showed only the probable one would let the majority delete the dissent, and
 * a page that averaged them would show a sentence nobody said.
 *
 * Support is counted by model ID, and the count says so in words: "2 independent"
 * is two judges who named two different models, and a seat that named none is
 * shown as holding an opinion without counting as an independent judge.
 *
 * The panel is the one the RECORD shows: the seats are the seat numbers the panel
 * wrote on this move, and a majority is more than half of them. Nothing is measured
 * against the panel this machine is configured with, so one file renders one readout
 * on any machine — and a judgment the single judge wrote carries no seat, so it is
 * never read out as a panel that agreed on nothing.
 */
export function renderReadout(readout) {
  if (!readout || readout.moves.length === 0) return '';

  const opinionRow = (kind, opinion) => {
    // A consolidated move's report names the box: gray box when no opinion reached
    // a majority, so the page does not call non-convergence a dissent.
    const label = kind === 'probable' ? 'highest probable' : opinion.status === 'gray_box' ? 'gray box' : 'edge grey';
    // A stored opinion is the report's word about a seat, and the seat is read from
    // this record. When the record cannot supply the seat, the row says why in the
    // text column instead of showing a blank opinion, and the count says no seat is
    // behind it rather than "0 seats" beside a count. A seat that is missing and a
    // model the record seats twice with different readings are told apart: the
    // first is a gap, the second is a link this view refuses to guess.
    const unbacked = opinion.unbacked === true;
    const ambiguous = unbacked && opinion.unbackedReason === 'ambiguous';
    const contested = (opinion.ambiguousModels ?? []).join(', ') || 'one model';
    // The opinion has seats behind it, but the report named more sources than this
    // basis places. The row keeps the words it can read and says which source is
    // left out, so a seat count below the report's own count is explained instead
    // of reading as a panel that shrank.
    const partial = unbacked ? null : (opinion.partial ?? null);
    const leftOut = partial
      ? [
          partial.reparse.length
            ? `${partial.reparse.join(', ')} ${partial.reparse.length === 1 ? 'is' : 'are'} not placed by this basis`
            : '',
          partial.missing.length ? `no seat in this record holds ${partial.missing.join(', ')}` : '',
        ]
          .filter((part) => part !== '')
          .join('; ')
      : '';
    const text = ambiguous
      ? `ambiguous: this record shows more than one seat with ${contested} holding different opinions, so no seat is attached`
      : unbacked
        ? `unbacked: the report cites ${opinion.ids.length ? opinion.ids.join(', ') : 'no model'}, and no seat in this record holds this opinion`
        : opinion.text;
    const heldBy = unbacked
      ? ambiguous
        ? 'no seat attached'
        : 'no seat in this record'
      : partial
        ? `${count(opinion.judges, 'seat')} attached \u00b7 the report counts ${count(opinion.support, 'independent judge')}${
            opinion.ids.length ? ` (${opinion.ids.join(', ')})` : ''
          } \u2014 ${leftOut}`
        : `${count(opinion.judges, 'seat')} \u00b7 ${count(opinion.support, 'independent judge')}${opinion.ids.length ? ` (${opinion.ids.join(', ')})` : ''}`;
    return `      <li class="readout__row">
        <span class="readout__kind ${kind === 'probable' ? 'readout__kind--probable' : ''}">${esc(label)}</span>
        <span class="readout__text">${esc(text)}</span>
        <span class="readout__count">${esc(heldBy)}</span>
      </li>`;
  };

  const rows = readout.moves
    .map((move) => {
      // The numbers are the move's own: the seats the record shows it had, and the
      // majority those seats need. One number standing for every move would be a
      // number the record does not hold.
      const head = `    <p class="readout__move">seq ${esc(move.seq)} \u2014 ${
        move.probable
          ? 'one opinion has more independent agreement behind it than the others'
          : move.edgeGreys.length === 0
            ? 'no seat offered an opinion: every seat asked what shows the basis'
            : esc(
                `none declared: no opinion reached ${count(move.majority, 'independent judge')}, the majority of the ${count(move.seats, 'seat')} this move shows`,
              )
      }</p>`;
      const probable = move.probable ? opinionRow('probable', move.probable) : '';
      const greys = move.edgeGreys.map((opinion) => opinionRow('grey', opinion)).join('\n');
      const noPosition = move.noPosition
        .map((seat) => `      <li class="readout__aside">seat ${esc(seat === null ? 'unrecorded' : seat)} asked what shows the basis, so it took no position</li>`)
        .join('\n');

      return `${head}
    <ul class="readout__list">
${[probable, greys, noPosition].filter((part) => part !== '').join('\n')}
    </ul>`;
    })
    .join('\n');

  return `  <section class="readout">
    <h2>The readout \u2014 highest probable, and the edge greys</h2>
    <p class="readout__note">Counted from this record: the seats are the ones each move
    shows, and a majority is more than half of them. Nothing here is merged: a minority reading is shown
    beside the probable one, never averaged into it and never dropped.</p>
${rows}
  </section>\n`;
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
/**
 * The graph each seat drew from its numbered answers, one per seat that wrote them.
 *
 * Built from the entries themselves, so a page shows only what the record holds. An
 * entry with no numbered answers draws nothing, and a page with none returns nothing,
 * which leaves it exactly as it was before the graph existed.
 */
export function renderGraphs(entries) {
  const graphs = entries.map(seatGraph).filter((graph) => graph !== null);
  if (graphs.length === 0) return '';

  const EDGE_WORDS = { justifies: 'justifies', touches: 'touches', asks: 'asks' };
  const rows = graphs
    .map((graph) => {
      const textOf = new Map(graph.nodes.map((node) => [node.id, node.text]));
      const head = `    <p class="readout__move">seq ${esc(graph.move)} \u2014 seat ${esc(graph.seat)}: ${
        count(graph.nodes.length, 'node')} \u00b7 ${count(graph.edges.length, 'edge', 'edges')}</p>`;
      const edges = graph.edges.length
        ? graph.edges
            .map(
              (edge) => `      <li class="readout__row">
        <span class="readout__kind">${esc(EDGE_WORDS[edge.kind] ?? edge.kind)}</span>
        <span class="readout__text">${esc(textOf.get(edge.from) ?? edge.from)} \u2192 ${esc(textOf.get(edge.to) ?? edge.to)}</span>
      </li>`,
            )
            .join('\n')
        : '      <li class="readout__aside">no edges: this seat drew the move alone</li>';
      return `${head}
    <ul class="readout__list">
${edges}
    </ul>`;
    })
    .join('\n');

  return `  <section class="readout">
    <h2>The graph \u2014 each seat's numbered answers</h2>
    <p class="readout__note">Drawn from the numbered answers the seats wrote: the move and its basis, the topics it
    touches, and the question it asks when the basis is not shown. Each edge is a seat's
    answer, not a fact the record holds on its own.</p>
${rows}
  </section>\n`;
}

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
