// The reply shapes and the observed move that the panel tests share.
//
// A seat's reply is numbered Q1–Q5. These are the replies a seat can give: the same
// opinion, a different one, a third, one that asks for a basis not shown, and one
// that directs the agent. Each test states which of them its run needs.

const WHEN = '2026-10-27T09:00:00.000Z';

// The Q2 pool is the entries a seat cites. Seats that cite the same entries are one
// opinion; seats that cite different entries are different readings, so the distinct
// replies below cite distinct entries.
export const numbered = (deed, basis, topics, sitting, pool = 'fact 1 in the record') =>
  [`Q1: ${deed}`, `Q2: ${pool}`, `Q3: ${basis}`, `Q4: ${topics}`, `Q5: ${sitting}`].join('\n');

export const SAME = numbered('the reply supports the claim about Ada', 'justified', 'none', 'none');
export const OTHER = numbered('the reply restates the prompt without evidence', 'justified', 'none', 'none', 'fact 2 in the record');
export const THIRD = numbered('the reply is about a different subject', 'justified', 'none', 'none', 'fact 3 in the record');
export const NOT_SHOWN = numbered('the reply makes no claim', 'not shown', 'none', 'what in the record supports this claim?');
export const DIRECTING = numbered('the reply supports the claim, but you should add a timing figure next', 'justified', 'none', 'none');

/** One observed move, as the wrapper records it. */
export function fact(seq, prompt = 'say ready', subjects = ['Ada Okafor']) {
  return {
    seq,
    when: WHEN,
    label: 'fact',
    what: { kind: 'worker-call', worker: 'meta-model-api', model: 'muse-spark-1.3', prompt, ok: true, response: 'ready', subjects },
  };
}
