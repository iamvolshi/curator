// The readout: what a move's opinions add up to, as a view of the record.
//
// Two parts, and nothing merged away:
//
//   HIGHEST PROBABLE — the opinion with the most independent agreement behind it,
//   with the count. Independent means a distinct model ID: two opinions from one
//   ID are one judge speaking twice, and an opinion whose judge named no ID cannot
//   be counted as independent at all, because nothing in the record says who it was.
//
//   INTERESTING EDGE GREYS — every opinion that is not the probable one. In a
//   three-seat panel that is the 2-1 dissent; in general, anything a majority of
//   the seated judges did not share. A lone reading nobody else reached is
//   surfaced too. The machine surfaces; it does not decide what is interesting, and
//   it never averages a minority away or lets the majority rewrite it.
//
// This is a view, like a folder: rebuilt from the record on every read, never a
// second store, and it decides nothing about the record. There is no majority when
// no opinion reaches one — then nothing is declared probable and every opinion is
// an edge grey, which is a reading of the panel, not a failure of it.
//
// The panel it reads out is the one the RECORD SHOWS. An entry counts here only
// when it carries the seat the panel wrote, and a majority is more than half of the
// seats a move shows — never the seats this machine happens to be configured with,
// because a page that measured against the local configuration would say two
// different things about one file. The single judge's judgment carries no seat:
// it is one judge's reading, and reading it out against seats it never held would
// report a panel that never sat.

/**
 * How many of the seated judges an opinion has to have behind it to be the
 * probable one: more than half. Three seats need two; four need three.
 */
export function majorityFor(seats) {
  const total = Number.isInteger(seats) && seats > 0 ? seats : 1;
  return Math.floor(total / 2) + 1;
}

/**
 * How two readings are compared.
 *
 * Case and spacing are not readings: two judges who said the same sentence with
 * different punctuation agreed, and a readout that called that a dissent would be
 * reading the keyboard rather than the opinion.
 */
export function sameOpinion(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The widest cited span that is read as the entries inside it. A span wider than
 * this is not a citation a seat could have read, so it is left as the two numbers
 * it wrote rather than becoming a basis of thousands of entries.
 */
export const MAX_CITED_SPAN = 64;

/**
 * A cited range: "4–9", "4-9", "4 to 9", "4 through 9". The boundary checks keep
 * a hyphen inside a longer token — "llama-3-8b", "gpt-4-0613" — from being read as
 * a span of entries: those name a model, not a stretch of the record.
 */
const CITED_RANGE = /(?<![\w.-])(\d+)\s*(?:[–—-]|to|through)\s*(\d+)(?![\w.-])/gi;

/**
 * The entry numbers a seat cited for its basis, from its Q2 answer. Sorted and
 * unique, so the same cited entries compare equal however the seat ordered them.
 *
 * Q2 is prose, so one seat may cite a span ("entries 4–9") where another lists the
 * same entries ("entries 4, 5, 6, 7, 8, 9"). Both cite the same basis, so both are
 * read as the entries inside the span, and the seats group as one opinion.
 */
export function citedEntries(pool) {
  const text = String(pool ?? '');
  const cited = new Set();

  for (const [, from, to] of text.matchAll(CITED_RANGE)) {
    const low = Math.min(Number(from), Number(to));
    const high = Math.max(Number(from), Number(to));
    if (high - low > MAX_CITED_SPAN) continue;
    for (let entry = low; entry <= high; entry += 1) cited.add(entry);
  }

  for (const digits of text.match(/\d+/g) ?? []) cited.add(Number(digits));
  return [...cited].sort((a, b) => a - b);
}

/**
 * Whether the record shows this entry came from a seat: the seat number the panel
 * writes. This is the whole of what makes an entry the panel's — there is no flag
 * to keep in step and no list of models to match against.
 */
function seated(entry) {
  return Number.isInteger(entry.what?.seat);
}

/** Whether this is something a seat said about one move: an opinion, or a question. */
export function fromASeat(entry) {
  return (
    (entry.label === 'judgment' || entry.label === 'question') &&
    seated(entry) &&
    Number.isInteger(entry.what?.move)
  );
}

/**
 * The readout for every move the record shows a panel read, in record order.
 *
 * @param {Array} entries   the record, oldest first
 * @returns {{moves: Array}} one entry per move the record shows seats on, each with
 *   the seats it shows, the majority those seats need, the probable opinion (or
 *   null), every other opinion, and the seats that asked instead of taking a side
 */
export function readPanel(entries) {
  const seen = new Set();
  const moves = [];

  for (const entry of entries) {
    if (!fromASeat(entry)) continue;
    const seq = entry.what.move;
    if (seen.has(seq)) continue;
    seen.add(seq);

    const about = entries.filter((other) => fromASeat(other) && other.what.move === seq);

    // The seats this move shows ARE the panel, and what a majority is follows from
    // them. Counted here, from the entries in hand, so no configuration can change
    // what the page says about this file.
    const seats = about
      .map((other) => other.what.seat)
      .filter((seat, index, all) => all.indexOf(seat) === index);
    const majority = majorityFor(seats.length);

    // A consolidated move reads out the stored MMRC report: its grouping, support
    // and probable opinion were decided once, when it was written. Re-grouping by
    // text here would only ever disagree with it.
    const delivered = entries.filter((other) => other.label === 'delivery' && other.what?.move === seq).pop();
    if (delivered) {
      moves.push(consolidatedMove(seq, seats.length, majority, about, delivered.what));
      continue;
    }

    const byOpinion = new Map();

    for (const held of about) {
      if (held.label !== 'judgment') continue;
      const text = String(held.what?.observation ?? '');
      const key = sameOpinion(text);
      if (key === '') continue;

      if (!byOpinion.has(key)) byOpinion.set(key, { text, ids: [], seats: [], bySeat: new Map() });
      const group = byOpinion.get(key);
      group.seats.push(held.what?.seat ?? null);
      group.bySeat.set(held.what?.seat ?? null, held);
      // The ID is the evidence of who judged. No ID, no independence — the judge is
      // still counted as holding the opinion, and the support count says so.
      const id = typeof held.what?.model === 'string' && held.what.model.trim() !== '' ? held.what.model.trim() : null;
      if (id && !group.ids.includes(id)) group.ids.push(id);
    }

    const opinions = [...byOpinion.values()].map((group) => ({
      text: group.text,
      // The same seat twice is one judge; a distinct ID is what counts.
      seats: group.seats.filter((seat, index) => group.seats.indexOf(seat) === index),
      ids: group.ids,
      support: group.ids.length,
      judges: group.seats.length,
    }));

    // The probable one: the most independent support, by a majority of the seats
    // this move shows, and not a tie. A tie for the top is not a majority of
    // anything, so nothing is declared.
    const top = Math.max(0, ...opinions.map((opinion) => opinion.support));
    const leaders = opinions.filter((opinion) => opinion.support === top);
    const probable = top >= majority && leaders.length === 1 ? leaders[0] : null;
    const edgeGreys = opinions.filter((opinion) => opinion !== probable);

    // A seat that asked what shows the basis took no position on the move. It is
    // reported rather than dropped: a panel of three that came back as two
    // opinions and a question is not a two-seat panel.
    const noPosition = about.filter((other) => other.label === 'question').map((other) => other.what.seat);

    moves.push({ seq, seats: seats.length, majority, probable, edgeGreys, noPosition });
  }

  return { moves };
}

/**
 * One move's readout taken from its stored delivery report. Each reported opinion
 * is matched back to the judgments that cite the same basis, so the text and the
 * seats come from the seats' own entries and the counts come from the report.
 */
function consolidatedMove(seq, seats, majority, about, report) {
  const opinions = report.opinions.map((opinion) => {
    const basis = opinion.basis.join(',');
    const held = about.filter(
      (other) => other.label === 'judgment' && citedEntries(other.what?.numbered?.pool).join(',') === basis,
    );
    return {
      text: String(held[0]?.what?.observation ?? ''),
      seats: held.map((other) => other.what.seat).filter((seat, index, all) => all.indexOf(seat) === index),
      ids: [...opinion.supporting_models],
      support: opinion.support_count,
      judges: held.length,
      // The status the report decided, carried so the readout can say "gray box"
      // for a move no opinion carried, instead of calling every dissent an edge grey.
      status: opinion.status,
    };
  });

  const probable = opinions.find((opinion) => opinion.status === 'highest_probable') ?? null;
  const edgeGreys = opinions.filter((opinion) => opinion !== probable);
  const noPosition = about.filter((other) => other.label === 'question').map((other) => other.what.seat);

  return { seq, seats, majority, probable, edgeGreys, noPosition };
}
