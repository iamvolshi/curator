// Shade: how much of a subject the record actually supports.
//
// Greyscale runs 0 (white) to 9 (black). Shade 8-9 is the black band. The band
// is a count, not a verdict: reaching it means eight or nine independent
// supports, nothing more. This file never says a subject is true.
//
// The rule, exactly:
//   - a subject starts at 0;
//   - each INDEPENDENT supporting fact darkens it by one, up to 9;
//   - independent means a distinct observed move — the same move repeated does
//     not stack, and two facts from one move count once;
//   - a judgment does not darken it;
//   - a question does not darken it.
//
// There is no stored shade to get out of step with the facts, because the shade
// is arithmetic over the record and is computed on every read. `recomputeShades`
// exists for the case where some earlier reader kept a number anyway: it reports
// the disagreement and hands back the counted shade, because the counting rule
// wins.

export const MAX_SHADE = 9;

/** 8 and 9 are the black band: fact, by count, not by opinion. */
export const BLACK_BAND = 8;

const BANDS = {
  black: 'black',
  grey: 'grey',
};

/**
 * What makes two facts the same move.
 *
 * A move is an observed call: the same question asked again of the same plug is
 * a repeat of one move, so it darkens nothing new. A different kind of call, or
 * the same question put to a different address, is a different move.
 */
function moveKey(what) {
  return JSON.stringify([what?.kind ?? '', what?.endpoint ?? '', what?.prompt ?? '']);
}

/** Every fact about a subject, one per distinct move, in record order. */
export function supportingFacts(entries, subject) {
  const wanted = String(subject ?? '').trim();
  const seen = new Set();
  const out = [];

  for (const entry of entries) {
    // Only facts are observations. This is the whole of the "a judgment never
    // darkens" and "a question never darkens" rules: they are not facts, so they
    // never reach the count.
    if (entry.label !== 'fact') continue;

    const what = entry.what ?? {};
    const about = Array.isArray(what.subjects) ? what.subjects.map((s) => String(s).trim()) : [];
    if (!about.includes(wanted)) continue;

    const key = moveKey(what);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }

  return out;
}

/**
 * One subject's shade, counted from the record.
 * @returns {{subject: string, shade: number, supports: number, band: string, maxed: boolean, counted: number[]}}
 */
export function shadeFor(entries, subject) {
  const counted = supportingFacts(entries, subject);
  const shade = Math.min(MAX_SHADE, counted.length);

  return {
    subject: String(subject ?? '').trim(),
    shade,
    // How many independent supports the record holds, which can exceed the cap:
    // past 9 the shade stops moving but the count keeps being true.
    supports: counted.length,
    band: shade >= BLACK_BAND ? BANDS.black : BANDS.grey,
    maxed: counted.length >= MAX_SHADE,
    counted: counted.map((entry) => entry.seq),
  };
}

/** How a shade reads on one line: the number, and whether it is in the black band. */
export function describeShade(shade) {
  const band = shade.band === BANDS.black ? 'black band' : 'grey';
  const past = shade.supports > MAX_SHADE ? `, ${shade.supports} supports past the cap` : '';
  return `${shade.shade}/${MAX_SHADE} \u00b7 ${band} \u00b7 ${shade.supports} independent support${shade.supports === 1 ? '' : 's'}${past}`;
}

/**
 * The shade the counting rule gives, against one that was stored elsewhere.
 *
 * A stored shade is only ever a cache. When it disagrees with the count, the
 * count is what is reported and what a reader is told to use.
 *
 * @param {Array} entries                     the record
 * @param {Array<{subject: string, shade: number}>} stored
 */
export function recomputeShades(entries, stored = []) {
  const bySubject = new Map(
    (Array.isArray(stored) ? stored : []).map((item) => [String(item?.subject ?? '').trim(), item?.shade]),
  );

  // A stored subject the record says nothing about is still reported, so a stale
  // shade cannot hide behind the count.
  const names = new Set([...bySubject.keys()]);
  for (const entry of entries) {
    const about = entry.what?.subjects;
    if (Array.isArray(about)) for (const name of about) names.add(String(name).trim());
  }

  return [...names]
    .filter((name) => name !== '')
    .map((subject) => {
      const counted = shadeFor(entries, subject);
      const has = bySubject.has(subject);
      return {
        ...counted,
        stored: has ? bySubject.get(subject) : null,
        disagrees: has && bySubject.get(subject) !== counted.shade,
      };
    });
}
