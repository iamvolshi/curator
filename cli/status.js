// The status command: is the Meta address reachable?
//
// It asks the meta plug for its key-free health address, so the answer comes from
// the plug's own config rather than from a URL written out again here. Meta
// serves GET /v1/status with no key, which makes it the one cheap way to tell
// "the endpoint cannot be reached" apart from "the key was rejected" — two
// problems that need different fixes.

import { describeKeyPresence, health, resolvePlug } from '../provider/index.js';
import { heading, line, note } from './output.js';

export async function statusCommand({ env = process.env, fetchImpl = fetch } = {}) {
  const plug = resolvePlug('meta', env);

  heading('Meta Model API — is the address reachable?');
  line('base url:', plug.baseUrl);
  line('key:', describeKeyPresence(plug, env));

  const result = await health('meta', { env, fetchImpl });

  if (result.status === null) {
    line('result:', 'the host did not answer');
    line('detail:', result.error ?? 'no reason came back');
    note('This points at the address or the connection, not the key.');
    return 1;
  }

  line('result:', `HTTP ${result.status}`);
  if (result.body) line('said:', result.body.replace(/\s+/g, ' ').slice(0, 300));

  return result.ok ? 0 : 1;
}
