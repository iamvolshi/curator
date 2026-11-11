// The record sidecar: the one endpoint the Rust entity POSTs to.
//
// One POST per ARCHE call, one `fact` entry per POST, written before the
// result is handed back. This is the record-only slice: the sidecar
// validates the entry, appends it, and returns the stored entry with its
// `seq`. No judging, no panel, no assessment — only facts, exactly as
// sent. The sidecar is the sole writer of the record file.
//
// It binds loopback only, on purpose: the entity runs on the same
// machine, and loopback is the boundary. If this ever leaves loopback,
// auth becomes a new decision first — do not invent it here.
//
// The one hard requirement is serialized appends. The store computes
// `seq` by counting the lines already in the file, so two concurrent
// appends could read the same count and share a `seq` — a duplicate
// sequence number in an append-only record is a corruption, not a
// race to tolerate. Every append runs behind one promise chain, so
// concurrent calls get distinct, strictly increasing, gapless `seq`s
// in the order their appends land.

import { createServer } from 'node:http';

import { checkEntry } from '../record/entry.js';
import { createStore } from '../record/store.js';
import { readOption } from './args.js';
import { line, note } from './output.js';

/** Loopback only, on purpose: the entity runs on the same machine. */
export const HOST = '127.0.0.1';
export const DEFAULT_PORT = 4781;
export const RECORD_PATH = '/v1/record';
export const MAX_BODY_BYTES = 1_000_000;

/**
 * The endpoint's rules for a fact entry, on top of `checkEntry`.
 * Returns a plain description of what is wrong, or null when the
 * entry may be stored. The Rust side guarantees these; the sidecar
 * re-validates, because a caller is never trusted with the record.
 */
export function checkFactEntry(entry) {
  const problem = checkEntry(entry);
  if (problem) return problem;
  if (entry.label !== 'fact') {
    return 'label must be "fact" on this endpoint: judgments, questions and deliveries belong to later slices';
  }
  const { what } = entry;
  if (typeof what.kind !== 'string' || what.kind === '') {
    return 'what.kind must be a non-empty string';
  }
  if (typeof what.prompt !== 'string') {
    return 'what.prompt must be a string';
  }
  if (typeof what.ok !== 'boolean') {
    return 'what.ok must be a boolean';
  }
  if (typeof what.durationMs !== 'number') {
    return 'what.durationMs must be a number';
  }
  if (typeof what.noCallMade !== 'boolean') {
    return 'what.noCallMade must be a boolean';
  }
  if (typeof what.kid !== 'string' || what.kid === '') {
    return 'what.kid must be a non-empty string: a fact without a KID is refused';
  }
  if (what.subjects !== undefined) {
    if (!Array.isArray(what.subjects) || what.subjects.some((s) => typeof s !== 'string')) {
      return 'what.subjects, when present, must be an array of strings';
    }
  }
  return null;
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function sendBadEntry(res, message) {
  send(res, 400, { error: 'bad_entry', message });
}

/** Read the request body as JSON. Throws a bad_entry problem on anything unusable. */
async function readJsonBody(req, maxBodyBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      throw new Error('body too large');
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('body is not JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('body must be a JSON object holding one entry');
  }
  return parsed;
}

/**
 * Start the sidecar on loopback. `store` is a record store handle;
 * `port` 0 asks the OS for an ephemeral port (what tests use).
 * Returns `{ host, port, url, close }`; `url` is the POST target.
 */
export async function startRecordServer({ store, port = DEFAULT_PORT, maxBodyBytes = MAX_BODY_BYTES } = {}) {
  const activeStore = store ?? createStore();

  // One chain for every append: the whole read-count-append step runs
  // behind it, so two concurrent calls can never share a `seq`. A
  // failed append must not break the chain for the next caller, so
  // the chain swallows failures while the caller still sees its own.
  let chain = Promise.resolve();
  function appendSerialized(entry) {
    const run = () => activeStore.append(entry);
    const result = chain.then(run, run);
    chain = result.catch(() => {});
    return result;
  }

  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== RECORD_PATH) {
        send(res, 404, { error: 'not_found', message: `no such route: ${req.method} ${req.url}` });
        return;
      }
      let entry;
      try {
        entry = await readJsonBody(req, maxBodyBytes);
      } catch (err) {
        sendBadEntry(res, err.message);
        return;
      }
      const problem = checkFactEntry(entry);
      if (problem) {
        sendBadEntry(res, problem);
        return;
      }
      let stored;
      try {
        stored = await appendSerialized(entry);
      } catch (err) {
        send(res, 503, { error: 'store_unavailable', message: err.message });
        return;
      }
      send(res, 200, stored);
    } catch (err) {
      // A handler that throws after headers were sent cannot answer;
      // one that throws before can still say the store failed.
      if (!res.headersSent) {
        send(res, 503, { error: 'store_unavailable', message: err.message });
      } else {
        res.destroy();
      }
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const assigned = server.address().port;
  return {
    host: HOST,
    port: assigned,
    url: `http://${HOST}:${assigned}${RECORD_PATH}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function recordServerCommand({ args = [], store = createStore(), env = process.env } = {}) {
  const requested = Number(readOption(args, '--port') ?? DEFAULT_PORT);

  let server;
  try {
    server = await startRecordServer({ store, port: requested });
  } catch (err) {
    note(`The record sidecar could not start on ${HOST}:${requested} — ${err.message}`);
    note('Another process may be using that port. Try --port with a different number.');
    return 1;
  }

  line('record:', store.path);
  line('listening:', server.url);
  // Its own process id: so it can be shown in a preview panel and stopped again
  // without hunting for it by name.
  line('pid:', String(process.pid));
  note('');
  note('Leave this running while the entity makes calls: one POST per ARCHE call, one fact per POST.');
  note('Press Ctrl+C to stop.');

  // Stay up until the process is stopped.
  await new Promise(() => {});
  return 0;
}
