// What a judge run was asked to do, or the one usage problem that stops it.
//
// Separated from the report because these rules are about the command line, not
// about the record: they run before a record is read, they send nothing, and a
// check can drive them with no store, no ledger and no provider.
//
// A number is not optional. `--limit` with nothing after it was once read as "not
// given", and the run judged the whole queue — a typo that looked like a cap cost
// one call per move. Both options are refused for the same reason now, and the
// refusal is a usage mistake rather than a call that failed.

import { readOption } from './args.js';
import { heading, note } from './output.js';

/** A value as a usage message can quote it, saying "nothing" when it was missing. */
function given(value) {
  return value === undefined ? 'nothing' : JSON.stringify(value);
}

/**
 * What the command line asked for, or the problem that stops the run before it
 * starts.
 *
 * `--move` names one move and `--limit` caps a queue; together they would leave it
 * unclear which one decides what is judged, so neither is honoured.
 *
 * @returns {{limit: number|null, move: number|null, retryParked: boolean, problem: null|{heading: string, lines: string[]}}}
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
