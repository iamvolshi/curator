// The live proof for one plug.
//
// One short prompt goes out through the wrapper. Then the record file is read
// back from disk — not from memory — and each thing the proof claims is checked
// against what is actually stored.
//
// With no --plug it proves the plug the Worker agent routes to, through the
// worker's own call path. With --plug NAME it proves that plug by one plain call
// through the seam. Either way it is one real call, one recorded fact entry, and
// the entry read back.
//
// Exit codes: 0 everything held, 2 unknown plug name, 3 the plug is not ready so
// nothing was attempted, 4 the call did not work, 5 the call worked but a stored
// item did not match.

import { createStore } from '../record/store.js';
import { renderEntry } from '../record/render.js';
import { buildChatRequest, describeFailure, describeRequest } from '../worker/index.js';
// The one owner of the can-this-plug-be-called check.
import { describeKeyPresence, preflight } from '../provider/index.js';
import { readOption } from './args.js';
import { WORKER_PLUG, callOnce, reportNotReady, resolveRoute } from './call-once.js';
import { PROVE_KIND, describePlugRequest } from './plug-call.js';
import { heading, line, note, check } from './output.js';

/** Short and ordinary on purpose: this proves the path, it is not a benchmark. */
export const DEFAULT_PROMPT = 'Reply with the single word: ready';

export async function proveCommand({
  args = [],
  env = process.env,
  fetchImpl = fetch,
  store = createStore(),
} = {}) {
  const dryRun = args.includes('--dry-run');
  const prompt = readOption(args, '--prompt') ?? DEFAULT_PROMPT;
  const wanted = readOption(args, '--plug') ?? WORKER_PLUG;

  let route;
  try {
    route = resolveRoute(wanted, env);
  } catch (err) {
    heading('No such plug');
    note(`${err.message}.`);
    return 2;
  }

  // The Worker's plug is proven the way it has always been proven. Proving it by
  // another route would write a different entry for the same call.
  const { plug, throughWorker } = route;
  const ready = preflight(plug.name, env);

  heading(`Overseer — one call through the wrapper (${plug.name})`);
  line('record file:', store.path);
  line('model:', plug.model ?? `none — set ${plug.modelEnvVar}`);
  line('key:', describeKeyPresence(plug, env));
  line('prompt:', JSON.stringify(prompt));

  // A dry run shows the request that would go out. It makes no call and writes
  // no record, because recording a call that never happened would be a lie.
  if (dryRun) {
    heading('Dry run — nothing sent, nothing recorded');
    const request = throughWorker
      ? describeRequest(buildChatRequest({ prompt }, env))
      : describePlugRequest(plug, prompt);
    note(JSON.stringify(request, null, 2));
    return 0;
  }

  // Stopping here is not a failed call: nothing was attempted and nothing was
  // recorded, which is a different fact from "the call did not work".
  if (!ready.ready) {
    reportNotReady(plug, ready, `The ${plug.name} plug is not ready, so no call was made and nothing was recorded.`);
    return 3;
  }

  const before = await store.readAll();

  heading('The call');
  const { ok, entry, outcome } = await callOnce({ route, prompt, env, fetchImpl, store, kind: PROVE_KIND });

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
    line('problem:', describeFailure(outcome?.error));
  }

  heading('The entry, read back from the file');
  const after = await store.readAll();
  const stored = after.at(-1);
  note(stored ? renderEntry(stored) : '(the file is empty)');

  heading('Checks against what is stored');
  const written = after.length - before.length;
  const all = [
    check(written === 1, 'exactly one entry was written', `${written} written`),
    check(stored?.label === 'fact', "the entry's label is 'fact'", String(stored?.label)),
    check(stored?.seq === after.length, 'the entry sits last in the file', `seq ${stored?.seq}`),
    check(stored?.when === entry.when, 'the stored timestamp is the one that was recorded'),
    check(stored?.what?.prompt === prompt, 'the stored prompt is the prompt that was sent'),
    check(
      stored?.what?.model === (outcome?.model ?? null),
      'the stored model is the model the call reports',
      String(stored?.what?.model),
    ),
  ];

  // A prove on any other plug has to say which plug answered, or a reader cannot
  // tell it from a call the Worker made.
  if (!throughWorker) {
    all.push(check(stored?.what?.plug === plug.name, 'the entry names the plug that was called', String(stored?.what?.plug)));
  }

  if (ok) {
    all.push(check(stored?.what?.response === outcome.text, 'the stored reply is the reply that came back'));
  }

  const checksPassed = all.every(Boolean);
  note('');
  note(`result: ${ok && checksPassed ? 'PASS' : 'FAILED'}`);

  if (!ok) return 4;
  return checksPassed ? 0 : 5;
}
