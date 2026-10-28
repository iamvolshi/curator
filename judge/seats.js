// The panel's seats, and the bank behind them.
//
// A seat is a place an opinion comes from: seat 1 is the main seat (Muse, through
// the existing meta plug), and seats 2 and 3 are the provisional free seats. Each
// seat names a plug — so every opinion goes out through the one provider seam —
// and a model variable, because which model sits in a seat is a decision someone
// makes and not one this file makes.
//
// The bank is the plugs that fill a seat when the one seated in it fails. Its
// order is configurably free-first, because failover is the one place in this
// build that can add spend without anyone asking for it: the default holds the
// free plugs only, and putting a paid plug behind a seat is a decision to make on
// purpose.
//
// Nothing here calls anything. This module answers what the panel is, so the run
// can refuse before it reads the record or sends a request.

import { PLUG_NAMES, notReadyReport, preflight, resolvePlug } from '../provider/index.js';

/** A panel is three seats. The readout's "majority of seated judges" is over this. */
export const SEATS = 3;

/** Which plug serves each seat unless said otherwise, and where its model comes from. */
const SEAT_PLUGS = ['meta', 'nvidia', 'nvidia'];
const SEAT_PLUG_ENV = ['PANEL_SEAT1_PLUG', 'PANEL_SEAT2_PLUG', 'PANEL_SEAT3_PLUG'];
const SEAT_MODEL_ENV = [null, 'PANEL_SEAT2_MODEL', 'PANEL_SEAT3_MODEL'];

export const BANK_ENV = 'PANEL_BANK';

/**
 * Free first. NVIDIA Build's endpoints are free by design; OpenRouter is the
 * interim development path and may be either. baseten and meta are deliberately
 * absent: both are paid, and a paid plug in the bank adds spend by surprise.
 */
export const DEFAULT_BANK = Object.freeze(['nvidia', 'openrouter']);

function readEnv(name, env) {
  if (!name) return null;
  const raw = env[name];
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
}

/**
 * The panel as configured: one entry per seat, plus the bank's plug names.
 *
 * A seat's model is what its own variable names, or the plug's own model when that
 * variable is unset — so a seat can be served by a plug that already has a model,
 * and a plug that has none leaves the seat unseated until someone names one.
 */
export function panelConfig(env = process.env) {
  const seats = SEAT_PLUGS.map((fallback, index) => {
    const seat = index + 1;
    const plugName = readEnv(SEAT_PLUG_ENV[index], env) ?? fallback;
    const modelEnvVar = SEAT_MODEL_ENV[index];
    const plug = resolvePlug(plugName, env);

    return {
      seat,
      plugName: plug.name,
      plug,
      modelEnvVar,
      model: readEnv(modelEnvVar, env) ?? plug.model ?? null,
    };
  });

  return { seats, bank: panelBank(env) };
}

/** The bank's plug names, in the order they would fill a seat. */
export function panelBank(env = process.env) {
  // Saying nothing gets the default. Saying nothing at all (`PANEL_BANK=`) is
  // itself an answer: a panel with no bank, where a failed seat refuses the run.
  if (!(BANK_ENV in env)) return [...DEFAULT_BANK];
  return String(env[BANK_ENV] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

/**
 * The environment a seat's call is made with: the seat's own model, in the plug's
 * model variable.
 *
 * The seam's rule is that a plug is callable only when a model has been chosen, and
 * that rule is what stops a request going to a model nobody picked. A seat naming
 * its model IS that choice, so the seat's model is what the plug is resolved with —
 * the same mechanism every other plug already uses, no special case in the seam, and
 * nothing about the plug's own model (the one the bank offers) involved.
 */
export function seatEnv(seat, env = process.env) {
  if (!seat.model || !seat.plug.modelEnvVar) return env;
  return { ...env, [seat.plug.modelEnvVar]: seat.model };
}

/** One seat, as a line a person reads: which seat, which plug, which model. */
export function describeSeat(seat) {
  const source = seat.modelEnvVar ? ` via ${seat.modelEnvVar}` : ' from the plug\u2019s own model';
  return `seat ${seat.seat} \u2014 ${seat.plugName} using ${seat.model ?? 'no model'}${seat.model ? source : ''}`;
}

/**
 * What stops this panel being run at all, or null when every seat is seated.
 *
 * Two things stop it and both are configuration, not failure: a seat whose plug
 * cannot be called (no key, or a slot waiting on a decision), and a seat with no
 * model. A bank name that is not a plug stops it too, because a typo there would
 * otherwise look like a bank that filled nothing.
 *
 * This is asked BEFORE the record is read and before anything is sent, so an
 * unseated panel costs nothing and writes nothing.
 *
 * @returns {null|{where: 'seat'|'bank', seat: number|null, status: string, missing: string, keyProblem: string|null}}
 */
export function panelProblem({ seats, bank } = panelConfig(process.env), env = process.env) {
  const notAPlug = bank.filter((name) => !PLUG_NAMES.includes(name));
  if (notAPlug.length > 0) {
    return {
      where: 'bank',
      seat: null,
      status: 'needs-config',
      missing: `the ${BANK_ENV} bank names ${notAPlug.map((name) => `"${name}"`).join(', ')}, which ${notAPlug.length === 1 ? 'is not a plug' : 'are not plugs'}; the plugs are ${PLUG_NAMES.join(', ')}`,
      keyProblem: null,
    };
  }

  for (const seat of seats) {
    const seatEnvironment = seatEnv(seat, env);
    const ready = preflight(seat.plugName, seatEnvironment);

    // No model is a decision not made, and it is reported first because it is the
    // one the reader can act on without guessing. A missing key is still named
    // beside it when there is one, so two things to set are not found one run at a
    // time. The plug's own model is not part of this: a seat that names its model
    // is the choice the seam's model rule exists to require.
    if (!seat.model) {
      const named = seat.modelEnvVar ? `${seat.modelEnvVar}, or ` : '';
      return {
        where: 'seat',
        seat: seat.seat,
        status: 'needs-config',
        missing: `nothing is seated in seat ${seat.seat}: set ${named}the ${seat.plugName} plug\u2019s own model`,
        keyProblem: ready.keyPresent ? null : ready.problem,
      };
    }

    if (!ready.ready) {
      const report = notReadyReport(resolvePlug(seat.plugName, seatEnvironment), ready);
      return {
        where: 'seat',
        seat: seat.seat,
        status: report.status,
        missing: `seat ${seat.seat} cannot be called: ${report.primary}`,
        keyProblem: report.keyProblem,
      };
    }
  }

  return null;
}

/**
 * One bank plug, as the fill loop needs it: whether it can be called, and with
 * which model. A bank plug that cannot be called is not an error — it is a seat
 * that stays empty, and the run says which ones and why.
 *
 * A callable plug always has a model (the shape check requires one), so there is
 * no third state here: either it can fill a seat, or the plug's own words say what
 * is missing.
 */
export function bankOption(name, env = process.env) {
  const plug = resolvePlug(name, env);
  const ready = preflight(name, env);

  return {
    name: plug.name,
    model: plug.model ?? null,
    ready: ready.ready,
    problem: ready.ready ? null : notReadyReport(plug, ready).primary,
  };
}
