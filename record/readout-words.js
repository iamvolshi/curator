// The words a readout uses for one opinion, in one copy.
//
// Two surfaces show the readout: the page, and the panel report on a terminal.
// They must not say different things about the same stored opinion — a row marked
// unbacked in one and printed as "0 seats held it" in the other is how a reader
// learns to distrust both. So the sentence for a row is composed here, and both
// surfaces call the same function. Escape it where it is shown; never rewrite it.
//
// The opinion itself comes from judge/readout.js: its words are the seat's own
// unless the record cannot supply the seat, in which case the marker says why it
// cannot. The count is the report's, with the seats the record places named
// beside it — never a seat count silently smaller than the report's own.

import { count } from './markup.js';

/**
 * The words the readout shows for an opinion.
 *
 * A linked opinion shows what its seat wrote. One the record cannot supply shows
 * the view's own sentence, because there are no words to show and a blank line
 * would read as an opinion nobody wrote.
 */
export function opinionText(opinion) {
  if (opinion.unbacked === true) {
    if (opinion.unbackedReason === 'ambiguous') {
      const contested = (opinion.ambiguousModels ?? []).join(', ') || 'one model';
      return `ambiguous: this record shows more than one seat with ${contested} holding different opinions, so no seat is attached`;
    }
    return `unbacked: the report cites ${opinion.ids.length ? opinion.ids.join(', ') : 'no model'}, and no seat in this record holds this opinion`;
  }

  return String(opinion.text ?? '');
}

/**
 * Who is behind an opinion, stated the way the readout states it.
 *
 * A linked opinion counts the seats the record places and the independent models
 * the report names. A partly placed one says the report counts more than this basis
 * places, and which cited source is left out; an unbacked one says no seat is
 * attached at all. There is no case where the seat count and the report's count
 * disagree without the row saying why.
 */
export function opinionHeldBy(opinion) {
  if (opinion.unbacked === true) {
    return opinion.unbackedReason === 'ambiguous' ? 'no seat attached' : 'no seat in this record';
  }

  const seats = count(opinion.judges, 'seat');
  const support = count(opinion.support, 'independent judge');
  const ids = opinion.ids.length ? ` (${opinion.ids.join(', ')})` : '';

  const partial = opinion.partial ?? null;
  if (!partial) return `${seats} \u00b7 ${support}${ids}`;

  const leftOut = [
    partial.reparse.length
      ? `${partial.reparse.join(', ')} ${partial.reparse.length === 1 ? 'is' : 'are'} not placed by this basis`
      : '',
    partial.missing.length ? `no seat in this record holds ${partial.missing.join(', ')}` : '',
  ]
    .filter((part) => part !== '')
    .join('; ');

  return `${seats} attached \u00b7 the report counts ${support}${ids} \u2014 ${leftOut}`;
}
