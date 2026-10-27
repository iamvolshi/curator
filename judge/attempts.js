// How many times a move's reply has failed to arrive, remembered between runs.
//
// This is NOT the record. The record holds what was observed — facts, judgments,
// questions — and nothing else, appended once and never edited. This file holds a
// count of failed attempts, which is operational state: it says nothing about the
// move, so it must not be an entry, and it is disposable. Delete it and every move
// is tried again.
//
// Why it exists at all: a call that never arrived, or a reply that could not be
// read, writes nothing and leaves the move queued — correctly, because nothing was
// decided about it. Without a count, one move whose reply never parses costs a
// call on every run forever. The count parks it after a few attempts without
// writing it off: the record still shows it unjudged, the queue still holds it,
// and `--retry-parked` offers it again.
//
// A ledger that is missing or damaged reads as "no attempts recorded", because a
// count must never be able to stop a run the way a damaged record would.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { DEFAULT_RECORDS_PATH } from '../record/store.js';

/** How many failed attempts park a move. Small on purpose: a cost bound, not a verdict. */
export const PARK_AFTER = 3;

export const DEFAULT_LEDGER_NAME = 'judge-attempts.json';

/** Beside the record unless told otherwise, so one checkout keeps one set. */
export function resolveLedgerPath(explicit, env = process.env) {
  if (explicit) return resolve(explicit);
  if (env.OVERSEER_LEDGER) return resolve(env.OVERSEER_LEDGER);
  return join(dirname(resolve(env.OVERSEER_RECORDS || DEFAULT_RECORDS_PATH)), DEFAULT_LEDGER_NAME);
}

/**
 * Open the ledger at a path: { path, readAll, noteFailure, clear, reset }.
 * `noteFailure` returns the new count, so a caller can report the attempt that
 * parked the move rather than only the state it is in.
 */
export function createLedger(filePath) {
  const path = resolveLedgerPath(filePath);

  async function readAll() {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      // Missing and damaged both mean "nothing recorded", which retries everything.
      return {};
    }
  }

  async function write(counts) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(counts, null, 2)}\n`, 'utf8');
  }

  return {
    path,
    readAll,

    async noteFailure(seq, state, when = new Date().toISOString()) {
      const counts = await readAll();
      const key = String(seq);
      const fails = (counts[key]?.fails ?? 0) + 1;
      counts[key] = { fails, lastState: state, lastAt: when };
      await write(counts);
      return fails;
    },

    /** A move that was judged, or whose refusal was recorded, is no longer failing. */
    async clear(seq) {
      const counts = await readAll();
      const key = String(seq);
      if (!(key in counts)) return;
      delete counts[key];
      await write(counts);
    },

    /** Parked moves are offered again: `--retry-parked` starts every count at zero. */
    async reset() {
      await write({});
    },
  };
}

/** The moves at or past the parking threshold, with their counts, by seq. */
export function parkedFrom(counts, parkAfter = PARK_AFTER) {
  return Object.entries(counts ?? {})
    .map(([seq, held]) => ({ seq: Number(seq), fails: held?.fails ?? 0 }))
    .filter((held) => Number.isInteger(held.seq) && held.fails >= parkAfter)
    .sort((a, b) => a.seq - b.seq);
}
