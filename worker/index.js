// The call path to Muse Spark. `runWorkerCall` is the one function the wrapper wraps.
//
// "Worker" here means this module: the thing that makes the model call. It uses
// only `fetch` and plain objects, so it runs unchanged in Node or in a Worker
// runtime — nothing in it is tied to either.

export { runWorkerCall, preflight } from './client.js';
export { classifyFailure, describeFailure, fixedFailure, KINDS } from './errors.js';
export { buildChatRequest, describeRequest } from './request.js';
export {
  DEFAULT_MODEL,
  CHAT_COMPLETIONS_URL,
  MODEL_ENV_VAR,
  WORKER_NAME,
  resolveModel,
} from './config.js';
