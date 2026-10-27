// Running the judge from the command line.
//
// This file decides only the order a run happens in: read the options, clear the
// parking ledger when asked, read the record, resolve the plug, judge, report.
// Every word it prints and every exit code it ends on belongs to ./judge-report.js,
// so a change to how a park or a refusal reads lands in one place.
//
// The judge writes entries, so a run reports what was written and, just as
// importantly, what was not and why. Three things stop an entry being written for
// a move: the plug is not callable (no call is made at all), the reply could not be
// read, or the wording directed the agent instead of observing it. The third of
// those still leaves a trace — a question in the record's own words, naming the
// move — so a refusal is never a silence and never costs another call.
//
// `--limit N` judges at most N moves, so a first live run against a paid endpoint
// can cost one call instead of one per move in the record. `--move N` judges the
// one move with that seq, so a run can read a single judgment rather than the
// oldest one the queue happens to hold. Neither takes a default: a bare `--limit`
// was once read as "not given" and judged the whole queue, which is the one
// mistake here that spends money, so both options now refuse it.
//
// `--retry-parked` puts every parked move back in the running. It is also the
// honest answer to a ledger that got out of step: the counts are disposable.

import { PARK_AFTER, createLedger } from '../judge/attempts.js';
import { JUDGE_PLUG, judgeMoves } from '../judge/judge.js';
import { createStore } from '../record/store.js';
import { resolvePlug } from '../provider/index.js';
import { readJudgeOptions, reportOptionProblem, reportRun, reportSetup } from './judge-report.js';

export async function judgeCommand({ args = [], env = process.env, fetchImpl = fetch, store = createStore(), ledger = createLedger(undefined, env) } = {}) {
  // Refused before anything is read or sent: a limit nobody can honour is a usage
  // mistake, not a call that failed.
  const options = readJudgeOptions(args);
  if (options.problem) {
    reportOptionProblem(options.problem);
    return 2;
  }

  if (options.retryParked) await ledger.reset();

  const entries = await store.readAll();
  const plug = resolvePlug(JUDGE_PLUG, env);

  reportSetup({ store, entries, plug, env });

  const result = await judgeMoves({
    entries,
    env,
    fetchImpl,
    store,
    limit: options.limit,
    move: options.move,
    attempts: ledger,
    parkAfter: PARK_AFTER,
  });

  return reportRun(result, options);
}
