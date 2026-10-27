// Assembling the page, once, for both ways of looking at it.
//
// The static file and the live viewer must show the same page, or one of them is
// a second implementation of the record. So both call this: it decides what the
// page is told (where it came from, when, which plugs exist) and nothing else.

import { isAbsolute, relative } from 'node:path';

import { resolveAll } from '../provider/index.js';
import { renderPage } from '../record/html.js';

/** The path as a reader of the page should see it: relative when it is inside the project. */
export function showablePath(path) {
  const shown = relative(process.cwd(), path);
  if (shown === '' || shown.startsWith('..') || isAbsolute(shown)) return path;
  // Forward slashes: the page may be read on a different kind of machine.
  return shown.replaceAll('\\', '/');
}

/**
 * The plugs, reduced to what the page shows. Which plugs exist is configuration;
 * whether each one answered is read from the record by the renderer.
 */
export function plugSummaries(env = process.env) {
  return resolveAll(env).map((plug) => ({
    name: plug.name,
    label: plug.label,
    role: plug.role,
    status: plug.status,
    chatUrl: plug.chatUrl,
  }));
}

/**
 * The whole page, from the entries handed in.
 * @param {Array} entries                 the record, oldest first
 * @param {object} options
 * @param {string} options.source         the file the entries were read from
 * @param {string} options.generatedAt    when they were read
 * @param {object} [options.env]          environment the plugs are resolved against
 * @param {{sig: string}} [options.live]  when set, the page watches the record and reloads itself
 */
export function buildPage(entries, { source, generatedAt, env = process.env, live = null } = {}) {
  return renderPage(entries, {
    source: showablePath(source),
    generatedAt,
    plugs: plugSummaries(env),
    live,
  });
}
