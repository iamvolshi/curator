// The call path: what is sent, how failures are told apart, and what comes back.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildChatRequest } from '../worker/request.js';
import { classifyFailure, describeFailure } from '../worker/errors.js';
import { runWorkerCall } from '../worker/client.js';
import { DEFAULT_MODEL } from '../worker/config.js';

const env = { MODEL_API_KEY: 'LLM_test_key' };

function reply(body, { status = 200 } = {}) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

test('the request carries the prompt as a user message and nothing secret', () => {
  const body = buildChatRequest({ prompt: '  say ready  ' }, env);

  assert.equal(body.model, DEFAULT_MODEL);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'say ready' }]);
  assert.equal(JSON.stringify(body).includes('LLM_'), false, 'no key material in the body');
});

test('an empty prompt is refused before anything is sent', () => {
  assert.throws(() => buildChatRequest({ prompt: '   ' }, env), /prompt is required/);
});

test('failures are told apart, because they need different fixes', () => {
  const cases = [
    [{ httpStatus: 401, apiType: 'authentication_error', apiCode: 'invalid_api_key' }, 'auth'],
    [{ httpStatus: 402, apiType: 'billing_error', apiCode: 'billing_not_configured' }, 'billing'],
    [{ httpStatus: 403 }, 'permission'],
    [{ httpStatus: 404, apiCode: 'model_not_found' }, 'model'],
    [{ httpStatus: 404 }, 'endpoint'],
    [{ httpStatus: 429, apiType: 'rate_limit_error' }, 'rate-limit'],
    [{ httpStatus: 400 }, 'bad-request'],
    [{ httpStatus: 500 }, 'server'],
    [{ httpStatus: 503, apiCode: 'service_overloaded' }, 'server'],
    [{ httpStatus: 504, apiCode: 'gateway_timeout' }, 'timeout'],
    [{ timedOut: true }, 'timeout'],
    [{ networkCode: 'ENOTFOUND' }, 'endpoint'],
    [{ httpStatus: 418 }, 'unknown'],
  ];

  for (const [evidence, expected] of cases) {
    assert.equal(classifyFailure(evidence).kind, expected, JSON.stringify(evidence));
  }
});

test('only rate limits and server failures are marked worth retrying unchanged', () => {
  assert.equal(classifyFailure({ httpStatus: 429 }).retryable, true);
  assert.equal(classifyFailure({ httpStatus: 503 }).retryable, true);
  assert.equal(classifyFailure({ httpStatus: 401 }).retryable, false);
  assert.equal(classifyFailure({ httpStatus: 504 }).retryable, false);
});

test('every failure kind carries a fix and reads as a sentence', () => {
  const failure = classifyFailure({ httpStatus: 401, message: 'Unauthorized' });
  assert.ok(failure.fix.length > 10);
  assert.equal(describeFailure(failure).includes('auth'), true);
  assert.equal(describeFailure(failure).includes('401'), true);
});

test('a working call reports the reply and the model the API says it used', async () => {
  const outcome = await runWorkerCall({
    prompt: 'say ready',
    env,
    fetchImpl: async () =>
      reply({
        model: 'muse-spark-1.3',
        choices: [{ message: { role: 'assistant', content: 'ready' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
      }),
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.text, 'ready');
  assert.equal(outcome.model, 'muse-spark-1.3');
  assert.equal(outcome.finishReason, 'stop');
  assert.equal(outcome.usage.total_tokens, 15);
  assert.equal(outcome.error, null);
});

test('a rejected key comes back as an auth failure, not an exception', async () => {
  const outcome = await runWorkerCall({
    prompt: 'say ready',
    env,
    fetchImpl: async (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer LLM_test_key');
      return reply(
        { error: { message: 'Unauthorized', type: 'authentication_error', code: 'invalid_api_key' } },
        { status: 401 },
      );
    },
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.kind, 'auth');
  assert.equal(outcome.error.httpStatus, 401);
});

test('an unknown path that answers with no body at all is still classified', async () => {
  const outcome = await runWorkerCall({
    prompt: 'say ready',
    env,
    fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' }),
  });

  assert.equal(outcome.error.kind, 'endpoint');
  assert.match(outcome.error.message, /404/);
});

test('a call that is answered without any reply text is not called a success', async () => {
  const outcome = await runWorkerCall({
    prompt: 'say ready',
    env,
    fetchImpl: async () => reply({ model: 'muse-spark-1.3', choices: [] }),
  });

  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.kind, 'bad-response');
});

test('with no key, nothing is sent at all', async () => {
  let called = false;
  const outcome = await runWorkerCall({
    prompt: 'say ready',
    env: {},
    fetchImpl: async () => {
      called = true;
      return reply({});
    },
  });

  assert.equal(called, false, 'no request was made');
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.kind, 'missing-key');
  assert.equal(outcome.noCallMade, true);
});

test('a connection that never answers is a timeout, not a mystery', async () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const outcome = await runWorkerCall({
    prompt: 'say ready',
    env,
    fetchImpl: async () => {
      throw abort;
    },
  });

  assert.equal(outcome.error.kind, 'timeout');
  assert.equal(outcome.error.retryable, false);
});
