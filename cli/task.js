// Running real work through a plug, and recording it.
//
// A prove is a check: it answers "is this plug wired, and does it answer?", and
// its entry says so. Work is not a check — it is the thing the record exists to
// hold. So work gets its own command and its own kind ('plug-task') instead of
// borrowing prove's, where entries would read like proofs and a reader could no
// longer tell a piece of real work apart from a check that a plug works.
//
// What it shares with prove is the part that must never differ: which plug a name
// resolves to, which call path that plug takes, and that a plug which is not ready
// sends nothing and records nothing.
//
// It reports the work: the reply that came back, and the entry read out of the
// file. It does not report a pass or a fail, because it is not checking anything.
//
// Exit codes: 0 the call worked | 2 unknown plug, or nothing to do
//             3 the plug is not ready, so nothing was attempted
//             4 the call did not work (and was recorded as such)

import { createStore } from '../record/store.js';
import { renderEntry } from '../record/render.js';
// The seam's preflight, not the worker's: the worker's always answers for the
// Worker's plug, which would name the wrong environment variable for any other.
import { describeKeyPresence, preflight } from '../provider/index.js';
import { readOption } from './args.js';
import { WORKER_PLUG, callOnce, notReadyReport, resolveRoute } from './call-once.js';
import { TASK_KIND } from './plug-call.js';
import { heading, line, note } from './output.js';

export async function taskCommand({
  args = [],
  env = process.env,
  fetchImpl = fetch,
  store = createStore(),
} = {}) {
  // No default prompt, on purpose: a default would be this command inventing work
  // that nobody asked for.
  const prompt = readOption(args, '--prompt');
  // Real work goes to the Worker agent's plug unless another one is named.
  const wanted = readOption(args, '--plug') ?? WORKER_PLUG;

  let route;
  try {
    route = resolveRoute(wanted, env);
  } catch (err) {
    heading('No such plug');
    note(`${err.message}.`);
    return 2;
  }

  const { plug } = route;

  heading(`Overseer — one task through the wrapper (${plug.name})`);
  line('record file:', store.path);
  line('model:', plug.model ?? `none — set ${plug.modelEnvVar}`);
  line('key:', describeKeyPresence(plug, env));

  // Refused before anything else happens, so nothing is sent and nothing is
  // recorded: a task with no task is a usage mistake, not a failed call.
  if (prompt === undefined) {
    heading('Nothing to do');
    note('A task needs something to do: pass --prompt "...".');
    note('Nothing was sent and nothing was recorded.');
    return 2;
  }
  line('prompt:', JSON.stringify(prompt));

  const ready = preflight(plug.name, env);

  // Stopping here is not a failed call: nothing was attempted and nothing was
  // recorded, which is a different fact from "the call did not work".
  if (!ready.ready) {
    heading('Stopped before the call');
    note(`The ${plug.name} plug is not ready, so the task was not run and nothing was recorded.`);
    const { primary, keyProblem } = notReadyReport(plug, ready);
    line('status:', plug.status);
    line('missing:', primary);
    if (keyProblem) line('also:', keyProblem);
    line('handy:', 'put what it needs in a file named .env next to this repo; the npm scripts read it, and it stays out of git');
    return 3;
  }

  heading('The call');
  const { ok, outcome } = await callOnce({
    route,
    prompt,
    env,
    fetchImpl,
    store,
    kind: TASK_KIND,
  });

  for (const warning of outcome?.warnings ?? []) {
    line('warning:', warning);
  }

  if (ok) {
    line('call:', 'worked');
    line('model:', outcome.model);
    line('reply:', JSON.stringify(outcome.text));
    if (outcome.finishReason) line('stopped:', outcome.finishReason);
    if (outcome.usage) line('tokens:', `${outcome.usage.total_tokens ?? '?'} in total`);
    line('took:', `${outcome.durationMs} ms`);
  } else {
    line('call:', 'did not work');
    line('detail:', outcome?.error?.message ?? 'no message came back');
  }

  heading('The entry, read back from the file');
  // Read back rather than trust the write: the record is the thing this command
  // exists to fill, so what is in the file is what gets shown.
  const stored = (await store.readAll()).at(-1);
  note(stored ? renderEntry(stored) : '(the file is empty)');

  if (!ok) {
    note('');
    note('A call that did not work is still recorded: an unwritten failure is the hole this layer closes.');
    return 4;
  }

  return 0;
}
