// The only code in this repository that runs in a browser.
//
// Everything exported here is text: renderPage puts it into the page, and the
// browser runs it there. It is not a way out of this process, which is why the
// check that keeps one network seam in the app skips this file — a `fetch` that
// ends up in a page someone else's browser runs is a different thing from a
// second call path in the app.
//
// That exemption is only safe while this file is inert, so it is held to a rule
// of its own: no imports, no node built-ins, no environment. A check enforces it.
// Nothing here decides anything about the record either — the poller asks the
// viewer for a signature and reloads. The page it reloads is rendered on the
// server, from the file, every time.

/** The line that says this page is watching the record. */
export function liveBadge() {
  return `  <p class="live" data-live>
    <span class="live__dot" aria-hidden="true"></span>
    <span class="live__text">live — watching the record</span>
  </p>
`;
}

/**
 * The poller.
 *
 * It asks for the record's signature and reloads when it changes, so the reload
 * follows the file rather than a fixed interval — a page left open on a quiet
 * record does nothing at all. If the viewer stops, the badge says so instead of
 * failing silently.
 */
export function liveScript(sig) {
  return `<script>
(() => {
  const sig = ${JSON.stringify(sig)};
  const badge = document.querySelector('[data-live]');
  const label = badge && badge.querySelector('.live__text');
  const set = (text, stopped) => {
    if (!badge) return;
    if (label) label.textContent = text;
    badge.classList.toggle('live--stopped', Boolean(stopped));
  };
  async function poll() {
    try {
      const res = await fetch('/state', { cache: 'no-store' });
      const state = await res.json();
      if (state.sig && state.sig !== sig) { location.reload(); return; }
      set('live — watching the record', false);
    } catch {
      set('not updating — the viewer is not running', true);
    }
    setTimeout(poll, 1500);
  }
  setTimeout(poll, 1500);
})();
</script>
`;
}
