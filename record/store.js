// The record store: append-only, one entry per line, on disk.
//
// Append-only means the file is only ever added to. Nothing here rewrites or
// deletes a line, so what was recorded stays recorded.
//
// One entry per line (JSON Lines) was chosen because it survives a partial
// write without corrupting earlier entries, and you can read it with any tool.

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { checkEntry } from './entry.js';

export const DEFAULT_RECORDS_PATH = 'records/k-record.jsonl';

/** Where records live: an explicit path wins, then OVERSEER_RECORDS, then the default. */
export function resolveRecordsPath(explicit, env = process.env) {
  return resolve(explicit || env.OVERSEER_RECORDS || DEFAULT_RECORDS_PATH);
}

/** Read every entry, oldest first. A file that does not exist yet reads as "nothing recorded". */
async function readAllFrom(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  return raw
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`the record file is damaged on line ${index + 1}: ${path}`);
      }
    });
}

/**
 * Open the store at a path and get back a small handle: { path, append, readAll }.
 * `append` returns the entry as it was actually written, `seq` included, so the
 * caller can show exactly what is on disk rather than what it hoped to write.
 */
export function createStore(filePath) {
  const path = resolveRecordsPath(filePath);

  return {
    path,

    async append(entry) {
      const problem = checkEntry(entry);
      if (problem) throw new Error(`refusing to record a malformed entry: ${problem}`);

      // `seq` is the position in this file, so it is found by counting what is
      // already there. Fine at this scale (one line per call, a handful of
      // calls); a later outcome can move to an index if records get long.
      const existing = await readAllFrom(path);
      const stored = { seq: existing.length + 1, ...entry };

      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, `${JSON.stringify(stored)}\n`, 'utf8');
      return stored;
    },

    async readAll() {
      return readAllFrom(path);
    },
  };
}
