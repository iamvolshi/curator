// Every word a judge run puts on screen, and every exit code it ends on.
//
// The command itself decides the order a run happens in; this decides what the
// run says about it. That split matters because the report is the only place some
// of it is visible at all — a parked move writes nothing to the record by design —
// so "how a park reads" has to be changeable in one file, not in the middle of a
// hundred-line procedure.
//
// A failed reply is named with the judge's own words (`FAIL_WORDS`), not a second
// copy of them, so the report and the page cannot drift apart in how they describe
// the same failure.
//
// Exit codes, and what each one means to a caller:
//   0 the run finished cleanly (which includes "nothing attempted: the rest is
//     parked", because that is a bound doing its job, not a failure)
//   2 the limit or the move number was not usable, or the named move is not one
//     this record can judge
//   3 the Overseer's plug is not ready, so nothing was attempted
//   4 a model call did not work
//   5 a reply was refused for its wording, or could not be read; nothing was
//     written for that move, or a question was written in its place

import { JUDGE_PLUG, FAIL_WORDS } from '../judge/judge.js';
import { describeKeyPresence } from '../provider/index.js';
import { readOption } from './args.js';
import { heading, line, note } from './output.js';

/** How a move's outcome is said in the run's own list. */
const STATE_WORDS = {
  judged: 'judgment written',
  asked: 'question written',
  'asked-unfiled': 'question written \u2014 no subject, so it sits in no folder',
  'asked-instead': 'question written instead \u2014 the wording directed',
  'asked-instead-unfiled':
    'question written instead \u2014 the wording directed, and no subject, so it sits in no folder',
  unreadable: `nothing written \u2014 ${FAIL_WORDS.unreadable}, so the move stays unjudged`,
  'call-failed': `nothing written \u2014 ${FAIL_WORDS['call-failed']}, so the move stays unjudged`,
};

/** A value as a usage message can quote it, saying "nothing" when it was missing. */
function given(value) {
  return value === undefined ? 'nothing' : JSON.stringify(value);
}

/**
 * What the command line asked for, or the one problem that stops the run.
 *
 * A number is not optional: `--limit` with nothing after it used to be read as
 * "not given" and the run judged the whole queue, so a typo that looked like a cap
 * cost one call per move. Both options are refused for the same reason, before the
 * record is read, so a usage mistake is never reported as a call that failed.
 */
export function readJudgeOptions(args) {
  const limitAsked = args.includes('--limit');
  const rawLimit = readOption(args, '--limit');

  if (limitAsked) {
    if (rawLimit === undefined || !/^\d+$/.test(rawLimit) || Number(rawLimit) < 1) {
      return {
        problem: {
          heading: 'Not a good limit',
          lines: [`--limit takes a whole number of moves, 1 or more; it was given ${given(rawLimit)}.`],
        },
      };
    }
  }

  const moveAsked = args.includes('--move');
  const rawMove = readOption(args, '--move');

  if (moveAsked) {
    if (rawMove === undefined || !/^\d+$/.test(rawMove) || Number(rawMove) < 1) {
      return {
        problem: {
          heading: 'Not a good move',
          lines: [`--move takes the seq of one recorded move, 1 or more; it was given ${given(rawMove)}.`],
        },
      };
    }
    // `--move` names one move; `--limit` caps a queue. Together they would leave
    // it unclear which one decides what is judged, so neither is honoured.
    if (limitAsked) {
      return {
        problem: {
          heading: 'Two ways to choose a move',
          lines: ['--move judges one named move; --limit caps how many are judged. Give one or the other.'],
        },
      };
    }
  }

  return {
    limit: limitAsked ? Number(rawLimit) : null,
    move: moveAsked ? Number(rawMove) : null,
    retryParked: args.includes('--retry-parked'),
    problem: null,
  };
}

/** A usage problem, said plainly: what was wrong, and that nothing happened. */
export function reportOptionProblem(problem) {
  heading(problem.heading);
  for (const text of problem.lines) note(text);
  note('Nothing was sent and nothing was written.');
}

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
    if (move !== null) {
      line('chosen:', `seq ${move}, picked with --move`);
      if (result.waiting > 1) {
        note(`The other ${result.waiting - 1} unjudged moves were left alone.`);
      }
    } else if (limit !== null && result.waiting > result.candidates) {
      // Only when a cap was actually given. Parked moves also make the count of
      // attempts smaller than the queue, and saying "capped" there would be a
      // plain untruth about how this run was asked for — the park section below
      // is where that shortfall belongs.
      line('capped:', `judging ${result.candidates} of ${result.waiting} unjudged moves (--limit ${limit})`);
      note(`The other ${result.waiting - result.candidates} are still waiting, in record order.`);
    }
    for (const outcome of result.outcomes) {
      const words = STATE_WORDS[outcome.state] ?? outcome.state;
      line(`seq ${outcome.seq}`, `${words}${outcome.detail ? `  (${outcome.detail})` : ''}`);
    }
  }

  // Parked moves are reported, not hidden: a run that quietly skipped work would
  // look exactly like a run that had none to do.
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
  if (result.outcomes.some((o) => o.state === 'asked-unfiled' || o.state === 'asked-instead-unfiled')) {
    note('A question about a move that names no subject belongs to no folder. It is still in the record, and that move is not judged again.');
  }
  // Said out loud, because these two look like the refusal above in the log and
  // are the opposite in the record: nothing was decided about the move, so
  // nothing is written and the next run offers it again.
  if (result.outcomes.some((o) => o.state === 'unreadable' || o.state === 'call-failed')) {
    note('A move whose call failed or whose reply could not be read keeps its place in the queue: nothing was learned about it, so nothing is written in its place, and the next run offers it again.');
  }
  note('');
  note('Every fact entry this run read is still exactly as it was. Judgments and questions are appended after them.');

  const failed = result.outcomes.some((o) => o.state === 'call-failed');
  const unreadable = result.outcomes.some((o) => o.state === 'unreadable');
  const directed = result.outcomes.some((o) => o.state === 'asked-instead' || o.state === 'asked-instead-unfiled');

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
