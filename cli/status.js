// The status command: the whole socket, wiring and reachability.
//
// Wiring is answered from each plug's own config — no address, model, or key is
// written out again here, so this command cannot drift from the plugs it reports.
// Anything the seam does not know is reported as unknown rather than filled in.
//
// Reachability is probed only where a plug declares a key-free health address.
// Meta does; the others do not. Saying so is the honest answer: for a plug with
// no such address, reachability is only ever proven by a real call, which costs
// a key, and inventing a health URL to fill the gap would be making up a fact
// about someone else's service. The point of this command is still the one it
// always had: tell "the address is wrong" apart from "the key was rejected",
// because those two need different fixes.

import { PLUG_NAMES, describeKeyPresence, health, readKey, resolvePlug } from '../provider/index.js';
import { ROUTES, ROUTE_SLOTS } from '../provider/routing.js';
import { heading, line, note } from './output.js';

export async function statusCommand({ env = process.env, fetchImpl = fetch } = {}) {
  let probed = 0;
  let unreachable = 0;
  let callable = 0;

  heading('The socket — every plug, wired and reachable?');
  line('routing:', ROUTE_SLOTS.map((slot) => `${slot} -> ${ROUTES[slot]}`).join('   '));

  for (const name of PLUG_NAMES) {
    const plug = resolvePlug(name, env);

    heading(`${plug.name} — ${plug.label}`);
    line('role:', plug.role);
    line('status:', plug.status);
    line('base url:', describeBaseUrl(plug));
    line('model:', describeModel(plug));
    line('key:', describeKey(plug, env));
    if (plug.blockedReason) line('blocked by:', plug.blockedReason);

    if (plug.status === 'ready') callable++;

    // No declared health address means there is nothing honest to probe.
    if (!plug.statusUrl) {
      line('reachable:', 'not checked — this plug names no key-free health address');
      continue;
    }

    const result = await health(name, { env, fetchImpl });
    probed++;

    if (result.status === null) {
      unreachable++;
      line('reachable:', 'no — the host did not answer');
      line('detail:', result.error ?? 'no reason came back');
      note('  this points at the address or the connection, not at the key');
      continue;
    }

    line('reachable:', `yes — HTTP ${result.status}`);
    if (result.body) line('said:', result.body.replace(/\s+/g, ' ').slice(0, 300));
    if (!result.ok) {
      unreachable++;
      note(`  the host answered, but not with success: HTTP ${result.status}`);
    }
  }

  heading('Summary');
  line('plugs:', `${PLUG_NAMES.length}, of which ${callable} can be called now (${readyNames(env).join(', ') || 'none'})`);
  line('probed:', `${probed} (the rest name no key-free health address)`);
  line('unreachable:', String(unreachable));
  note('');
  note('A plug with no health address is proven by a real call, not by this command.');
  note('No key value is read out or printed by this command.');

  return unreachable === 0 ? 0 : 1;
}

function describeBaseUrl(plug) {
  if (plug.baseUrl) return plug.baseUrl;
  // An empty slot is a decision waiting. A slot that is merely unconfigured is a
  // value waiting. They look the same on screen, so they are not worded the same.
  return plug.status === 'awaiting-pick' || plug.status === 'needs-parser'
    ? 'none — this slot is empty by design'
    : 'none — not configured yet';
}

function describeKey(plug, env) {
  const { key } = readKey(plug, env);
  // Whether it is there is printable; the value never is.
  return key ? `${describeKeyPresence(plug, env)}  (${plug.keyEnvVar})` : describeKeyPresence(plug, env);
}

function describeModel(plug) {
  if (!plug.model) return `none — set ${plug.modelEnvVar}`;
  return plug.defaultModel
    ? `${plug.model}  (${plug.modelEnvVar}, default ${plug.defaultModel})`
    : `${plug.model}  (${plug.modelEnvVar})`;
}

function readyNames(env) {
  return PLUG_NAMES.filter((name) => resolvePlug(name, env).status === 'ready');
}
