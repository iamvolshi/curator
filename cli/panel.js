// Running the judge panel from the command line.
//
// The order a run happens in, and nothing else: read the options, ask whether the
// panel is seated, read the record, seat every seat on every move, report. What the
// run says belongs to ./panel-report.js; what a seat IS belongs to judge/seats.js;
// what the opinions add up to belongs to judge/readout.js.
//
// The seat check comes before the record is read and before anything is sent,
// because an unseated panel is a configuration mistake: it should cost nothing and
// write nothing, and it should not look like a call that failed.
//
// The readout is read from the record AFTER the run, like every other view of the
// record, so what is printed is what was written and not what the run remembers
// deciding.
//
// Exit codes: see ./panel-report.js.

import { judgePanel } from '../judge/panel.js';
import { readPanel } from '../judge/readout.js';
import { panelConfig, panelProblem } from '../judge/seats.js';
import { createStore } from '../record/store.js';
import { readJudgeOptions, reportOptionProblem } from './judge-options.js';
import { reportNotAPanelOption, reportPanelRun, reportPanelSetup, reportSeatProblem } from './panel-report.js';

export async function panelCommand({ args = [], env = process.env, fetchImpl = fetch, store = createStore() } = {}) {
  // The limit and the move number mean the same thing here as they do for the
  // judge, and they are refused in the same words, so one usage mistake reads the
  // same whichever command it was made on.
  const options = readJudgeOptions(args);
  if (options.problem) {
    reportOptionProblem(options.problem);
    return 2;
  }

  // The judge's park ledger bounds a single judge's cost. The panel's bound is its
  // own shape — three calls per move — so it keeps no ledger to offer again, and
  // saying so is better than accepting a flag that does nothing.
  if (options.retryParked) {
    reportNotAPanelOption([
      '--retry-parked belongs to judge: the panel keeps no ledger of parked moves.',
      'The panel seats every move it is asked for, and stops at the first move it cannot seat.',
    ]);
    return 2;
  }

  const config = panelConfig(env);
  const refused = panelProblem(config, env);
  if (refused) {
    reportSeatProblem(refused, config);
    return 3;
  }

  const entries = await store.readAll();
  reportPanelSetup({ store, entries, config });

  const result = await judgePanel({
    entries,
    env,
    fetchImpl,
    store,
    limit: options.limit,
    move: options.move,
    config,
  });

  const after = await store.readAll();
  return reportPanelRun(result, { ...options, readout: readPanel(after) });
}
