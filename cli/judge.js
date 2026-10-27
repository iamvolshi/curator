// Running the judge from the command line.
//
// The judge writes entries, so this command reports what was written and, just as
// importantly, what was not and why. Three things stop an entry: the plug is not
// callable (no call is made at all), the reply could not be read, or the wording
// directed the Worker instead of observing it.
//
// `--limit N` judges at most N moves, so a first live run against a paid
// endpoint can cost one call instead of one per move in the record. `--move N`
// judges the one move with that seq, so a run can read a single judgment rather
// than the oldest one the queue happens to hold.
//
// Exit codes: 0 the run finished cleanly | 1 unexpected problem
//             2 the limit or the move number was not usable, or the named move
//               is not one this record can judge
//             3 the Overseer's plug is not ready, so nothing was attempted
//             4 a model call did not work
//             5 the run wrote nothing for a move because its wording directed

import { judgeMoves, JUDGE_PLUG } from '../judge/judge.js';
import { createStore } from '../record/store.js';
import { describeKeyPresence, resolvePlug } from '../provider/index.js';
import { readOption } from './args.js';
import { heading, line, note } from './output.js';

const STATE_WORDS = {
  judged: 'judgment written',
  asked: 'question written',
  directed: 'nothing written \u2014 the wording directed',
  unreadable: 'nothing written \u2014 the reply could not be read',
  'call-failed': 'nothing written \u2014 the call did not work',
  'nowhere-to-ask': 'nothing written \u2014 the move names no subject to ask in',
};

export async function judgeCommand({ args = [], env = process.env, fetchImpl = fetch, store = createStore() } = {}) {
  // Refused before anything is read or sent: a limit nobody can honour is a usage
  // mistake, not a call that failed.
  const rawLimit = readOption(args, '--limit');
  let limit = null;
  if (rawLimit !== undefined) {
    if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1) {
      heading('Not a good limit');
      note(`--limit takes a whole number of moves, 1 or more; it was given ${JSON.stringify(rawLimit)}.`);
      note('Nothing was sent and nothing was written.');
      return 2;
    }
    limit = Number(rawLimit);
  }

  // `--move` names one move; `--limit` caps a queue. Together they would leave it
  // unclear which one decides what is judged, so neither is honoured.
  const moveAsked = args.includes('--move');
  const rawMove = readOption(args, '--move');
  let move = null;
  if (moveAsked) {
    if (rawMove === undefined || !/^\d+$/.test(rawMove) || Number(rawMove) < 1) {
      heading('Not a good move');
      note(`--move takes the seq of one recorded move, 1 or more; it was given ${rawMove === undefined ? 'nothing' : JSON.stringify(rawMove)}.`);
      note('Nothing was sent and nothing was written.');
      return 2;
    }
    if (rawLimit !== undefined) {
      heading('Two ways to choose a move');
      note('--move judges one named move; --limit caps how many are judged. Give one or the other.');
      note('Nothing was sent and nothing was written.');
      return 2;
    }
    move = Number(rawMove);
  }

  const entries = await store.readAll();
  const plug = resolvePlug(JUDGE_PLUG, env);

  heading(`Overseer \u2014 the judge (${JUDGE_PLUG})`);
  line('record file:', store.path);
  line('entries read:', String(entries.length));
  line('model:', plug.model ?? `none \u2014 set ${plug.modelEnvVar}`);
  line('key:', describeKeyPresence(plug, env));

  const result = await judgeMoves({ entries, env, fetchImpl, store, limit, move });

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
    note('Nothing to judge: every observed move already has a judgment or a question.');
  } else {
    // Said out loud, so a capped or picked run is never mistaken for a complete one.
    if (move !== null) {
      line('chosen:', `seq ${move}, picked with --move`);
      if (result.waiting > 1) {
        note(`The other ${result.waiting - 1} unjudged moves were left alone.`);
      }
    } else if (result.waiting > result.candidates) {
      line('capped:', `judging ${result.candidates} of ${result.waiting} unjudged moves (--limit ${limit})`);
      note(`The other ${result.waiting - result.candidates} are still waiting, in record order.`);
    }
    for (const outcome of result.outcomes) {
      const words = STATE_WORDS[outcome.state] ?? outcome.state;
      line(`seq ${outcome.seq}`, `${words}${outcome.detail ? `  (${outcome.detail})` : ''}`);
    }
  }

  heading('What the record gained');
  line('judgments:', String(result.written.judgments));
  line('questions:', String(result.written.questions));
  // A judgment is appended, never substituted: the facts it judges are unchanged.
  note('');
  note('Every fact entry this run read is still exactly as it was. Judgments and questions are appended after them.');

  const failed = result.outcomes.some((o) => o.state === 'call-failed');
  const unreadable = result.outcomes.some((o) => o.state === 'unreadable');
  const directed = result.outcomes.some((o) => o.state === 'directed');

  if (failed) {
    note('result: a model call did not work');
    return 4;
  }
  if (unreadable || directed) {
    note('result: something was left unwritten rather than written badly');
    return 5;
  }
  note('result: clean');
  return 0;
}
