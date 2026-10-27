// A viewer that rebuilds the page from the record on every request.
//
// While a demo runs, entries appear as calls are made, and rebuilding a file by
// hand between calls is the kind of step people forget. So this serves the page
// itself: every request reads the record again and renders it with the same
// renderer the static page uses. There is no second copy of the data and no
// second implementation of the page.
//
// The page it serves carries a signature of the file it was built from. A small
// script in that page asks /state for the current signature and reloads when it
// changes — so the reload happens in the browser, without rerendering the whole
// page on a timer that nothing needs.
//
// It binds to loopback only. It serves the page and its signature and nothing
// else: no file paths, no directory listing, no way to read the record as JSON.

import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';

import { createStore } from '../record/store.js';
import { line, note } from './output.js';
import { buildPage } from './view.js';

/** Loopback only, on purpose: this is a viewer for the person running the demo. */
export const HOST = '127.0.0.1';
export const DEFAULT_PORT = 4780;

/** No external loads, no frames, no forms: the page is a document and a poller. */
const CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "connect-src 'self'",
  "img-src data:",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * A cheap, stable signature of the record file. Appending a line always changes
 * its size, so size plus modification time is enough to see that it grew.
 */
async function signature(path) {
  try {
    const info = await stat(path);
    return `${info.size}:${Math.round(info.mtimeMs)}`;
  } catch (err) {
    if (err.code === 'ENOENT') return 'missing';
    throw err;
  }
}

/**
 * Start the viewer.
 * @returns {Promise<{url: string, port: number, host: string, close: Function}>}
 */
export async function startLiveServer({
  store = createStore(),
  env = process.env,
  port = DEFAULT_PORT,
  host = HOST,
  now = () => new Date(),
} = {}) {
  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', `http://${host}`);
    const send = (status, headers, body) => {
      res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
      res.end(body);
    };

    try {
      if (pathname === '/state') {
        send(200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify({ sig: await signature(store.path) }));
        return;
      }

      if (pathname === '/' || pathname === '/index.html') {
        // Read and render now, so the page can never show an older record than
        // the one on disk at the moment it was asked for.
        const entries = await store.readAll();
        const sig = await signature(store.path);
        const html = buildPage(entries, {
          source: store.path,
          generatedAt: now().toISOString(),
          env,
          live: { sig },
        });
        send(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP }, html);
        return;
      }

      send(404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'not found');
    } catch (err) {
      send(500, { 'Content-Type': 'text/plain; charset=utf-8' }, `the viewer could not read the record: ${err.message}`);
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;

  return {
    url: `http://${host}:${actualPort}/`,
    port: actualPort,
    host,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** The command: start the viewer and stay up until stopped. */
export async function liveCommand({ args = [], store = createStore(), env = process.env } = {}) {
  const requested = Number(readPort(args) ?? DEFAULT_PORT);

  let viewer;
  try {
    viewer = await startLiveServer({ store, env, port: requested });
  } catch (err) {
    note(`The viewer could not start on ${HOST}:${requested} — ${err.message}`);
    note('Another process may be using that port. Try --port with a different number.');
    return 1;
  }

  line('watching:', store.path);
  line('open:', viewer.url);
  // Its own process id: so it can be shown in a preview panel and stopped again
  // without hunting for it by name.
  line('pid:', String(process.pid));
  note('');
  note('Leave this running while calls are made: the page reloads itself when the record grows.');
  note('Press Ctrl+C to stop.');

  // Stay up until the process is stopped. Nothing here polls: the page does.
  await new Promise(() => {});
  return 0;
}

function readPort(args) {
  const index = args.indexOf('--port');
  const value = index === -1 ? undefined : args[index + 1];
  return value && /^\d+$/.test(value) ? Number(value) : undefined;
}
