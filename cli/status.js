// Checking the address before blaming the key.
//
// Meta serves GET /v1/status with no key, which makes it the one cheap way to
// tell "the endpoint cannot be reached" apart from "the key was rejected" —
// two problems that need different fixes.

import { API_BASE_URL, STATUS_URL } from '../worker/config.js';
import { describeKeyPresence } from '../worker/index.js';
import { heading, line, note } from './output.js';

export async function statusCommand({ env = process.env, fetchImpl = fetch } = {}) {
  heading('Meta Model API — is the address reachable?');
  line('base url:', API_BASE_URL);
  line('key:', describeKeyPresence(env));

  let response;
  try {
    response = await fetchImpl(STATUS_URL, { signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    line('result:', 'the host did not answer');
    line('detail:', err?.message ?? String(err));
    note('This points at the address or the connection, not the key.');
    return 1;
  }

  const body = await response.text();
  line('result:', `HTTP ${response.status}`);
  if (body) line('said:', body.replace(/\s+/g, ' ').slice(0, 300));

  return response.ok ? 0 : 1;
}
