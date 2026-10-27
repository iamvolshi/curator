// Every word a judge run puts on screen once its options were accepted, and the
// exit codes those outcomes end on.
//
// The command decides the order a run happens in and the command line decides what
// was asked for (./judge-options.js); this decides what the run says about it. That
// split matters because the report is the only place some of it is visible at all —
// a parked move writes nothing to the record by design — so "how a park reads" has
// to be changeable in one file, not in the middle of a hundred-line procedure.
//
// A failed reply is named with the judge's own words (`FAIL_WORDS`), not a second
// copy of them, so the report and the page cannot drift apart in how they describe
// the same failure.

import { JUDGE_PLUG, FAIL_WORDS, OUTCOME_STATES } from '../judge/judge.js';
import { describeKeyPresence } from '../provider/index.js';
import { heading, line, note } from './output.js';

/**
 * How a move's outcome is said in the run's own list, keyed by the states the
 * judge can emit. A check holds the two sides in step: a state with no words here
 * would print as a bare identifier, which is a report nobody asked for.
 */
export const STATE_WORDS = Object.freeze({
  [OUTCOME_STATES.judged]: 'judgment written',
  [OUTCOME_STATES.asked]: 'question written',
  [OUTCOME_STATES.askedUnfiled]: 'question written \u2014 no subject, so it sits in no folder',
  [OUTCOME_STATES.askedInstead]: 'question written instead \u2014 the wording directed',
  [OUTCOME_STATES.askedInsteadUnfiled]:
    'question written instead \u2014 the wording directed, and no subject, so it sits in no folder',
  [OUTCOME_STATES.unreadable]: `nothing written \u2014 ${FAIL_WORDS.unreadable}, so the move stays unjudged`,
  [OUTCOME_STATES.callFailed]: `nothing written \u2014 ${FAIL_WORDS['call-failed']}, so the move stays unjudged`,
});

/**
 * What this run is about to work with, printed before any call is made — so a
 * refusal from the plug is read in the context that produced it.
 */
export function reportSetup({ store, entries, plug, env = process.env }) {
  heading(`Overseer \u2014 the judge (${JUDGE_PLUG})`);
  line('record file:', store.path);
  line('entries read:', String(entries.length));
  line('model:', plug.model ?? `none \u2014 set ${plug.modelEnvVar}`);
  line('key:', describeKeyPresence(plug, env));
}

/**
 * What happened, in the order a reader needs it: what stopped the run, which move
 * went which way, what is parked, what the record gained, and how the run ended.
 *
 * @returns {number} the exit code this run ends on
 */
export function reportRun(result, { limit = null, move = null } = {}) {
  if (result.refused) {
    heading('Stopped before the call');
    note(`The ${JUDGE_PLUG} plug is not callable, so no call was made and nothing was written.`);
    line('status:', result.refused.status);
    line('missing:', result.refused.missing);
    if (result.refused.keyProblem) line('also:', result.refused.keyProblem);
    line('handy:', 'put what it needs in a file named .env next to this repo; the npm scripts read it, and it stays out of git');
    return 3;
  }

  // The named move is checked against the record before the plug is, so this is a
  // fact about what the record holds, not a call that failed.
  if (result.problem) {
    heading('No such move to judge');
    note(result.problem);
    note('Nothing was sent and nothing was written.');
    return 2;
  }

  heading('The moves');
  if (result.candidates === 0) {
    note(
      (result.parked ?? []).length > 0
        ? 'Nothing attempted: every move still unjudged is parked. --retry-parked tries them again.'
        : 'Nothing to judge: every observed move already has a judgment or a question.',
    );
  } else {
    // Said out loud, so a capped or picked run is never mistaken for a complete one.
    //
    // The two notes count different things on purpose. A cap note says which moves
    // the cap deferred, so it counts what was offerable — a parked move was never
    // the cap's to defer, and counting it there produced "judging 2 of 3" beside a
    // park section naming the third. A pick note says this was one move out of the
    // queue, so it counts the whole queue: every other unjudged move really was
    // left alone, and the park section says which of them are waiting on a retry.
    if (move !== null) {
      line('chosen:', `seq ${move}, picked with --move`);
      if (result.waiting > 1) {
        note(`The other ${result.waiting - 1} unjudged moves were left alone.`);
      }
    } else if (limit !== null && result.offerable > result.candidates) {
      line('capped:', `judging ${result.candidates} of ${result.offerable} unjudged moves (--limit ${limit})`);
      note(`The other ${result.offerable - result.candidates} are still waiting, in record order.`);
    }
    for (const outcome of result.outcomes) {
      // Fall back to the identifier rather than swallow an outcome this table has
      // not been taught: a check holds the two in step, and a run that printed a
      // bare word is still more honest than a run that printed nothing.
      const words = STATE_WORDS[outcome.state] ?? outcome.state;
      line(`seq ${outcome.seq}`, `${words}${outcome.detail ? `  (${outcome.detail})` : ''}`);
    }
  }

  // Parked moves are reported, not hidden: a run that quietly skipped work would
  // look exactly like a run that had none to do. The list the judge returns already
  // excludes anything this run touched, so a named move that was parked cannot be
  // reported as skipped after being judged.
  const parked = result.parked ?? [];
  if (parked.length > 0) {
    heading('Parked \u2014 still unjudged, not attempted');
    for (const held of parked) {
      line(`seq ${held.seq}`, `${held.fails} failed attempts, last one not recorded`);
    }
    note('They are still in the record as unjudged, and nothing was written about them. --retry-parked tries them again.');
  }

  heading('What the record gained');
  line('judgments:', String(result.written.judgments));
  line('questions:', String(result.written.questions));
  // A judgment is appended, never substituted: the facts it judges are unchanged.
  if (
    result.outcomes.some(
      (o) => o.state === OUTCOME_STATES.askedUnfiled || o.state === OUTCOME_STATES.askedInsteadUnfiled,
    )
  ) {
    note('A question about a move that names no subject belongs to no folder. It is still in the record, and that move is not judged again.');
  }
  // Said out loud, because these two look like the refusal above in the log and
  // are the opposite in the record: nothing was decided about the move, so
  // nothing is written and the next run offers it again.
  if (result.outcomes.some((o) => o.state === OUTCOME_STATES.unreadable || o.state === OUTCOME_STATES.callFailed)) {
    note('A move whose call failed or whose reply could not be read keeps its place in the queue: nothing was learned about it, so nothing is written in its place, and the next run offers it again.');
  }
  note('');
  note('Every fact entry this run read is still exactly as it was. Judgments and questions are appended after them.');

  const failed = result.outcomes.some((o) => o.state === OUTCOME_STATES.callFailed);
  const unreadable = result.outcomes.some((o) => o.state === OUTCOME_STATES.unreadable);
  const directed = result.outcomes.some(
    (o) => o.state === OUTCOME_STATES.askedInstead || o.state === OUTCOME_STATES.askedInsteadUnfiled,
  );

  if (failed) {
    note('result: a model call did not work');
    return 4;
  }
  if (directed) {
    note('result: a reply was refused for its wording, and the gap it left was recorded as a question');
    return 5;
  }
  if (unreadable) {
    note('result: something was left unwritten rather than written badly');
    return 5;
  }
  // Not "clean": a run that attempted nothing because the rest is parked has not
  // judged anything, and saying clean would read as a finished queue.
  if (parked.length > 0 && result.candidates === 0) {
    note('result: nothing attempted \u2014 what is left is parked, not judged');
    return 0;
  }
  note('result: clean');
  return 0;
}
