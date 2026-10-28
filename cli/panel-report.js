// Every word a panel run puts on screen, and the exit code it ends on.
//
// The command decides the order a run happens in; this decides what the run says
// about it. The readout is printed here as the view it is — rebuilt from the record
// after the run, never summarised from the run's own memory — so what a reader sees
// is what the record holds.
//
// Exit codes, and what each one means to a caller:
//   0 the run finished cleanly (including "nothing to judge", which is a finished
//     queue and not a failure)
//   2 the options were not usable, or the named move is not one this record can judge
//   3 a seat is not seated, so nothing was read and nothing was sent
//   4 a model call did not work, and no bank plug filled that seat
//   5 a reply could not be read, or a reading directed the agent, and no bank plug
//     filled that seat

import { SEAT_STATES } from '../judge/panel.js';
import { describeSeat } from '../judge/seats.js';
import { heading, line, note } from './output.js';
import { graphOf } from '../judge/graph.js';

/** How one seat's attempt reads in the run's own list. Exported so a test can hold
 * it to the states the panel can actually come to. */
export const SEAT_WORDS = {
  [SEAT_STATES.opinion]: 'judgment written',
  [SEAT_STATES.asked]: 'question written \u2014 this seat did not see the basis',
  [SEAT_STATES.unreadable]: 'nothing written \u2014 the reply could not be read',
  [SEAT_STATES.callFailed]: 'nothing written \u2014 the call did not work',
  [SEAT_STATES.directed]: 'nothing written \u2014 the reading directed the agent, so it was refused',
};

/** Prints a plain description of a seat or bank problem, and nothing else. */
export function reportSeatProblem(problem, config) {
  heading('The panel is not seated');
  note('Nothing was read and nothing was sent.');
  line('seat:', problem.seat === null ? 'not a seat \u2014 the bank' : String(problem.seat));
  line('status:', problem.status);
  line('missing:', problem.missing);
  if (problem.keyProblem) line('also:', problem.keyProblem);
  note('');
  for (const seat of config.seats) note(`  ${describeSeat(seat)}`);
  note(`  bank: ${config.bank.length ? config.bank.join(', ') : '(empty \u2014 no failover)'}`);
}

/** A usage problem that is the panel's own, not the judge's. */
export function reportNotAPanelOption(lines) {
  heading('Not a panel option');
  for (const text of lines) note(text);
  note('Nothing was sent and nothing was written.');
}

/** What this run is about to do, printed before any call is made. */
export function reportPanelSetup({ store, entries, config }) {
  heading(`Overseer \u2014 the judge panel (${config.seats.length} seats)`);
  line('record file:', store.path);
  line('entries read:', String(entries.length));
  for (const seat of config.seats) line(`seat ${seat.seat}:`, describeSeat(seat).replace(/^seat \d+ \u2014 /, ''));
  line('bank:', config.bank.length ? config.bank.join(', ') : '(empty \u2014 no failover)');
}

/** The seats of one completed move, in seat order. */
function printPanel(outcome) {
  for (const held of outcome.seats) {
    const id = held.model ?? 'no model ID in the reply';
    const fill = held.substitution
      ? `  [filled by ${held.substitution.plug}: ${held.substitution.departed} left \u2014 ${held.substitution.departedReason}]`
      : '';
    line(`seat ${held.seat}`, `${held.asked ? SEAT_WORDS[SEAT_STATES.asked] : SEAT_WORDS[SEAT_STATES.opinion]}  (${id})${fill}`);
    if (held.numbered) printGraph(outcome.seq, held);
  }
}

/** One seat's numbered answers and the graph they draw, so a reader can check both. */
function printGraph(seq, held) {
  const g = graphOf({ move: seq, seat: held.seat, numbered: held.numbered });
  for (const [i, q] of ['deed', 'pool', 'basis', 'topics', 'sitting'].entries()) {
    const value = Array.isArray(held.numbered[q]) ? held.numbered[q].join(', ') || 'none' : held.numbered[q];
    note(`    Q${i + 1} ${q}: ${value}`);
  }
  for (const e of g.edges) note(`    edge ${e.kind}: ${e.from} -> ${e.to}`);
}

/** One opinion as the readout shows it: its words, and who held it. */
function printOpinion(prefix, opinion) {
  // Support is counted by ID, so an opinion held by two seats that named none is
  // reported as held by two seats and supported by nobody — the two numbers are
  // different facts and the readout keeps them apart.
  const holders = opinion.ids.length ? opinion.ids.join(', ') : 'no model ID, so it counts as no independent judge';
  note(`${prefix}${JSON.stringify(opinion.text)}`);
  note(`    ${opinion.judges} seat(s) held it, ${opinion.support} independent: ${holders}`);
}

function printReadout(readout) {
  heading('The readout \u2014 highest probable, and the edge greys (the seats the record shows)');

  if (readout.moves.length === 0) {
    note('No move in the record has been read by a panel yet: the readout is built from the seats the record shows, and not one move here shows a seat.');
    return;
  }

  for (const move of readout.moves) {
    note(`seq ${move.seq}`);
    if (move.probable) {
      printOpinion('  highest probable: ', move.probable);
    } else if (move.edgeGreys.length === 0) {
      note('  highest probable: none \u2014 no seat offered an opinion: every seat asked what shows the basis');
    } else {
      // The move's own seats, not the configured panel's: this number is read from
      // the record beside the opinions it was counted from.
      note(
        `  highest probable: none declared \u2014 no opinion reached ${move.majority} independent judge(s), the majority of the ${move.seats} seat(s) this move shows`,
      );
    }
    for (const grey of move.edgeGreys) {
      printOpinion('  edge grey:        ', grey);
    }
    for (const seat of move.noPosition) {
      note(`  seat ${seat === null ? '(unrecorded)' : seat} asked what shows the basis, so it took no position on this move`);
    }
  }
}

/**
 * What happened, in the order a reader needs it: what stopped the run, which seat
 * said what, what the panels add up to, and how the run ended.
 *
 * @returns {number} the exit code this run ends on
 */
export function reportPanelRun(result, { limit = null, move = null, readout = null } = {}) {
  // The named move is checked against the record before anything is sent, so this
  // is a fact about what the record holds, not a call that failed.
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
    if (move !== null) line('chosen:', `seq ${move}, picked with --move`);
    else if (limit !== null && result.waiting > result.candidates) {
      line('capped:', `seating ${result.candidates} of ${result.waiting} unjudged moves (--limit ${limit})`);
      note(`The other ${result.waiting - result.candidates} are still waiting, in record order.`);
    }

    for (const outcome of result.outcomes) {
      line(`seq ${outcome.seq}`, `${outcome.seats.length} of ${result.seats.length} seats wrote something`);
      printPanel(outcome);
      if (outcome.consolidation.state === 'written') {
        note('  consolidation: written (MMRC delivery report)');
      } else {
        note(`  consolidation: NOT written \u2014 ${outcome.consolidation.kind}: ${outcome.consolidation.detail}`);
      }
    }
  }

  // A seat that could not be seated stops the run: a panel of two would read like a
  // panel of three. What was written before it stays written, and this says so.
  if (result.stopped) {
    const stopWord = result.stopped.state === SEAT_STATES.callFailed ? 'the call did not work' : 'the reply was refused or could not be read';
    heading('The panel stopped');
    note(`seq ${result.stopped.seq}: seat ${result.stopped.seat} (${result.stopped.plug} using ${result.stopped.model}) produced nothing writable \u2014 ${stopWord}.`);
    if (result.stopped.detail) line('detail:', result.stopped.detail);
    for (const skip of result.stopped.skips) line(`bank ${skip.plug}:`, `could not fill the seat \u2014 ${skip.why}`);
    note('The bank had no plug left that could fill it, so nothing was written for this move.');
    note(
      result.outcomes.length === 0
        ? 'Nothing was written: the record is untouched.'
        : `The ${result.outcomes.length} move(s) judged before it are in the record; nothing was written about seq ${result.stopped.seq}.`,
    );
  }

  heading('What the record gained');
  line('judgments:', String(result.written.judgments));
  line('questions:', String(result.written.questions));
  line('calls:', String(result.attempts.length));
  note('');
  note('Every fact entry this run read is still exactly as it was. Judgments and questions are appended after them.');

  if (readout) printReadout(readout);

  if (result.stopped) {
    note('');
    note('result: the panel could not be completed');
    return result.stopped.state === SEAT_STATES.callFailed ? 4 : 5;
  }

  note('');
  note('result: clean');
  return 0;
}
