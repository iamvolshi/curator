// The live proof for Outcome 1.
//
// One short prompt goes out through the wrapper to Muse Spark. Then the record
// file is read back from disk — not from memory — and each thing the outcome
// claims is checked against what is actually stored.
//
// Exit codes: 0 everything held, 3 no key so nothing was attempted,
// 4 the call did not work, 5 the call worked but a stored item did not match.

import { createStore } from '../record/store.js';
import { renderEntry } from '../record/render.js';
import { wrapCall } from '../wrapper/wrap.js';
import {
  buildChatRequest,
  describeFailure,
  describeRequest,
  preflight,
  resolveModel,
  runWorkerCall,
} from '../worker/index.js';
import { describeKeyPresence, resolvePlug } from '../provider/index.js';
import { heading, line, note, check } from './output.js';

/** Short and ordinary on purpose: this proves the path, it is not a benchmark. */
export const DEFAULT_PROMPT = 'Reply with the single word: ready';

export async function proveCommand({ args = [], env = process.env, fetchImpl = fetch } = {}) {
  const dryRun = args.includes('--dry-run');
  const prompt = readOption(args, '--prompt') ?? DEFAULT_PROMPT;
  const store = createStore();

  heading('Overseer — one call through the wrapper');
  line('record file:', store.path);
  line('model:', resolveModel(null, env));
  line('key:', describeKeyPresence(resolvePlug('meta', env), env));
  line('prompt:', JSON.stringify(prompt));

  // A dry run shows the request that would go out. It makes no call and writes
  // no record, because recording a call that never happened would be a lie.
  if (dryRun) {
    heading('Dry run — nothing sent, nothing recorded');
    const body = buildChatRequest({ prompt }, env);
    note(JSON.stringify(describeRequest(body), null, 2));
    return 0;
  }

  const ready = preflight(env);
  if (!ready.ready) {
    heading('Stopped before the call');
    note('No Meta Model API key was found, so no call was made and nothing was recorded.');
    line('missing:', ready.envVar);
    line('unblocks:', 'a Meta Model API key from the Model API dashboard, set as MODEL_API_KEY');
    line('handy:', 'put it in a file named .env next to this repo; the npm scripts read it, and it stays out of git');
    return 3;
  }

  const before = await store.readAll();

  heading('The call');
  const { ok, entry, outcome } = await wrapCall({
    call: (request) => runWorkerCall({ ...request, env, fetchImpl }),
    prompt,
    store,
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

  if (ok) {
    all.push(check(stored?.what?.response === outcome.text, 'the stored reply is the reply that came back'));
  }

  const checksPassed = all.every(Boolean);
  note('');
  note(`result: ${ok && checksPassed ? 'PASS' : 'FAILED'}`);

  if (!ok) return 4;
  return checksPassed ? 0 : 5;
}

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}
