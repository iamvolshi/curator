// Assembling the page, once, for both ways of looking at it.
//
// The static file and the live viewer must show the same page, or one of them is
// a second implementation of the record. So both call this: it decides what the
// page is told (where it came from, when, which plugs exist) and nothing else.

import { isAbsolute, relative } from 'node:path';

import { createLedger, resolveLedgerPath } from '../judge/attempts.js';
import { storedGroupingProblems } from '../judge/consolidate.js';
import { parkedMoves } from '../judge/judge.js';
import { readPanel } from '../judge/readout.js';
import { resolveAll } from '../provider/index.js';
import { renderPage } from '../record/html.js';

/** The path as a reader of the page should see it: relative when it is inside the project. */
export function showablePath(path) {
  const shown = relative(process.cwd(), path);
  if (shown === '' || shown.startsWith('..') || isAbsolute(shown)) return path;
  // Forward slashes: the page may be read on a different kind of machine.
  return shown.replaceAll('\\', '/');
}

/**
 * The plugs, reduced to what the page shows. Which plugs exist is configuration;
 * whether each one answered is read from the record by the renderer.
 */
export function plugSummaries(env = process.env) {
  return resolveAll(env).map((plug) => ({
    name: plug.name,
    label: plug.label,
    role: plug.role,
    status: plug.status,
    chatUrl: plug.chatUrl,
  }));
}

/** Where the parked counts live, beside the record unless the environment moves it. */
export function ledgerPathFor(env = process.env) {
  return resolveLedgerPath(null, env);
}

/**
 * The moves the judge has stopped attempting, read from the ledger beside the
 * record. Both ways of looking at the page call this, so the static file and the
 * live viewer cannot disagree about what is parked.
 *
 * A missing ledger is not an error: it means nothing has been parked.
 */
export async function parkedFor(entries, env = process.env) {
  const ledger = createLedger(ledgerPathFor(env));
  return parkedMoves(entries, await ledger.readAll());
}

/**
 * The panel's readout for these entries, counted against the seats THE RECORD shows
 * — not against the panel this machine is configured with. A view measured against
 * the local configuration would say different things about one file, and the page
 * exists to say what the file holds.
 *
 * Like the parked list, this is read from the record on every render: it is a view,
 * and a page built from a stale copy would be a second, unofficial record.
 *
 * A record no panel wrote shows nothing here: a judgment the single judge wrote
 * carries no seat, so there is no panel to read out and the page says nothing about
 * one.
 */
export function readoutFor(entries, groupingProblems = []) {
  return readPanel(entries, groupingProblems);
}

/**
 * The whole page, from the entries handed in.
 * @param {Array} entries                 the record, oldest first
 * @param {object} options
 * @param {string} options.source         the file the entries were read from
 * @param {string} options.generatedAt    when they were read
 * @param {object} [options.env]          environment the plugs are resolved against
 * @param {{sig: string}} [options.live]  when set, the page watches the record and reloads itself
 * @param {Array} [options.parked]        moves the judge is skipping, still unjudged
 * @param {Array} [options.groupingProblems]  stored deliveries whose grouping no
 *   longer matches the record; computed here when the caller has not, so the static
 *   file and the live viewer mark the same moves
 */
export function buildPage(
  entries,
  { source, generatedAt, env = process.env, live = null, parked = [], groupingProblems = storedGroupingProblems(entries) } = {},
) {
  return renderPage(entries, {
    source: showablePath(source),
    generatedAt,
    plugs: plugSummaries(env),
    live,
    parked,
    readout: readoutFor(entries, groupingProblems),
  });
}
