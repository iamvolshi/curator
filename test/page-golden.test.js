// The page, pinned: a fixed set of entries has to render to the same bytes.
//
// page.test.js checks properties — that a label is shown, that markup is escaped.
// This checks the whole document, because every property can still hold while a
// section quietly changes shape, and that is the edit easiest to miss by reading.
// The blessed pages are committed as real files, so a reader can open one and git
// can show the exact lines that moved.
//
// A deliberate change to the renderer means re-blessing them:
//
//     node test/page-golden.test.js --write
//     OVERSEER_WRITE_PAGE_GOLDENS=1 npm test    (the same thing)
//
// Read the diff before committing it: that diff is the change to what the page
// says. The stylesheet is inside these files too — the page carries it — so a
// deliberate styling change re-blesses them as well.
//
// The fixtures are fixed inputs: explicit entries, explicit plugs, a fixed
// moment, nothing read from the environment. So two pages here can differ only
// because the renderer changed, never because the clock or the machine did.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderPage } from '../record/html.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDENS = join(HERE, 'fixtures');

/** Writing is asked for outright, never inferred. */
const WRITE = process.argv.includes('--write') || Boolean(process.env.OVERSEER_WRITE_PAGE_GOLDENS);

const WHEN = '2026-10-26T23:12:32.281Z';
const SOURCE = 'records/k-record.jsonl';
const WORKER_URL = 'https://api.meta.ai/v1/chat/completions';

/** One observed call, in the shape the wrapper writes. */
function call(seq, overrides = {}) {
  return {
    seq,
    when: WHEN,
    label: 'fact',
    what: {
      kind: 'worker-call',
      worker: 'meta-model-api',
      endpoint: `POST ${WORKER_URL}`,
      request: { method: 'POST', url: WORKER_URL, body: { model: 'muse-spark-1.3', messages: [] } },
      model: 'muse-spark-1.3',
      prompt: 'say ready',
      ok: true,
      response: 'ready',
      usage: { total_tokens: 186 },
      durationMs: 1443,
      ...overrides,
    },
  };
}

const META = { name: 'meta', label: 'Meta Model API', role: 'worker', status: 'ready', chatUrl: WORKER_URL };
const BASETEN = {
  name: 'baseten',
  label: 'Baseten',
  role: 'overseer',
  status: 'needs-config',
  chatUrl: 'https://inference.baseten.co/v1/chat/completions',
};
const PICTURE = { name: 'picture', label: 'picture kid', role: 'picture', status: 'awaiting-pick', chatUrl: null };

/**
 * The pages that are pinned, one per branch of the renderer rather than one per
 * idea: nothing recorded, the ordinary call, recorded words that are markup, and
 * a page carrying every kind of entry, all three plugs, a parked move and the
 * live badge at once.
 */
const FIXTURES = [
  {
    name: 'nothing-recorded',
    entries: [],
    options: { source: SOURCE, generatedAt: WHEN },
  },
  {
    name: 'one-call',
    entries: [call(1)],
    options: {},
  },
  {
    name: 'words-that-are-markup',
    entries: [
      call(1, {
        prompt: '<script>alert(1)</script>',
        response: '<img src=x onerror="alert(2)">',
      }),
    ],
    options: { source: SOURCE },
  },
  {
    name: 'every-kind-of-entry',
    entries: [
      call(1),
      call(2, { prompt: 'name three colours', response: 'red, green, blue', usage: { total_tokens: 647 } }),
      call(3, {
        ok: false,
        response: null,
        usage: null,
        noCallMade: true,
        request: null,
        error: { kind: 'missing-key', message: 'the key was not there', fix: 'put it in .env' },
      }),
      {
        seq: 4,
        when: WHEN,
        label: 'judgment',
        what: { kind: 'judgment', move: 1, subjects: ['Ada Okafor'], observation: 'the reply supports the claim about Ada' },
      },
      {
        seq: 5,
        when: WHEN,
        label: 'question',
        what: { kind: 'question', move: 2, subjects: [], question: 'what in the record shows the basis for this?' },
      },
      // An entry shape this renderer does not know: it still has to show what it
      // holds rather than an empty card that reads like a missing record.
      { seq: 6, when: WHEN, label: 'judgment', what: { kind: 'judgment', about: 1, note: 'a shape from a later outcome' } },
    ],
    options: {
      source: SOURCE,
      generatedAt: WHEN,
      plugs: [META, BASETEN, PICTURE],
      parked: [
        {
          seq: 2,
          fails: 3,
          prompt: 'name three colours',
          subjects: ['Ada Okafor'],
          reason: 'the reply could not be read',
          lastAt: WHEN,
        },
      ],
      live: { sig: '262:1761|missing' },
    },
  },
];

/** A line as a failure can show it: short enough to read, never silently cut to nothing. */
function show(line) {
  if (line === undefined) return '(the page ends here)';
  const text = String(line);
  return text.length > 120 ? `${text.slice(0, 119)}\u2026` : text;
}

/**
 * Where two pages part company, as a sentence.
 * Comparing two 14 KB documents tells a reader only that something moved; the
 * line is what turns that into a reason.
 */
function firstDifference(name, blessed, rendered) {
  // A checkout that rewrote the file's line endings is not a change to the page.
  // Saying so is the difference between a one-line fix and an afternoon spent
  // reading a diff where every line moved.
  if (blessed.includes('\r\n') && !rendered.includes('\r\n')) {
    return [
      `the page for "${name}" was checked out with Windows line endings, so nothing can match it:`,
      '  these files are compared byte for byte, so git has to check them out as stored.',
      '  .gitattributes keeps that true (test/fixtures/*.html -text); get the file again with:',
      '    rm test/fixtures/*.html && git checkout -- test/fixtures',
    ].join('\n');
  }

  const before = blessed.split('\n');
  const after = rendered.split('\n');
  const at = before.findIndex((line, i) => line !== after[i]);
  const where =
    at === -1
      ? `the lines agree up to line ${Math.min(before.length, after.length)}, where one page ends and the other does not (blessed ${before.length} lines, rendered ${after.length})`
      : `first difference at line ${at + 1}\n    blessed:  ${show(before[at])}\n    rendered: ${show(after[at])}`;

  return [
    `the page for "${name}" is no longer the page that was blessed:`,
    `  ${where}`,
    'If the renderer changed on purpose, re-bless it and read the diff:',
    '    node test/page-golden.test.js --write',
  ].join('\n');
}

test('every fixed set of entries renders to exactly the page that was blessed', async () => {
  const seen = [];

  for (const fixture of FIXTURES) {
    const html = renderPage(fixture.entries, fixture.options);
    const path = join(GOLDENS, `${fixture.name}.html`);

    if (WRITE) {
      await mkdir(GOLDENS, { recursive: true });
      await writeFile(path, html, 'utf8');
      seen.push(`${fixture.name} (blessed)`);
      continue;
    }

    let blessed;
    try {
      blessed = await readFile(path, 'utf8');
    } catch {
      assert.fail(`no blessed page for "${fixture.name}" at test/fixtures/${fixture.name}.html; create it with: node test/page-golden.test.js --write`);
    }

    assert.equal(html, blessed, firstDifference(fixture.name, blessed, html));
    seen.push(fixture.name);
  }

  assert.equal(seen.length, FIXTURES.length, 'every fixture was rendered');
  if (WRITE) console.log(`blessed ${seen.length} pages: ${seen.join(', ')}`);
});

test('the pinned pages are exactly the fixtures, with none left behind', async () => {
  const files = (await readdir(GOLDENS)).filter((file) => file.endsWith('.html')).sort();

  assert.deepEqual(
    files,
    FIXTURES.map((fixture) => `${fixture.name}.html`).sort(),
    'a page with no fixture, or a fixture with no page, means the set and the files have drifted apart',
  );
  assert.equal(new Set(FIXTURES.map((fixture) => fixture.name)).size, FIXTURES.length, 'one page per name');

  for (const file of files) {
    const html = await readFile(join(GOLDENS, file), 'utf8');
    assert.match(html, /^<!doctype html>/, `${file} is a whole page, not a fragment of one`);
  }
});

test('nothing but the renderer decides these pages', async () => {
  // Two renders of one fixture have to agree, or a blessed page would fail for a
  // reason that has nothing to do with the renderer.
  for (const fixture of FIXTURES) {
    assert.equal(
      renderPage(fixture.entries, fixture.options),
      renderPage(fixture.entries, fixture.options),
      `${fixture.name} renders the same twice`,
    );
  }

  // Nothing in a fixture may come from the environment: a page pinned to a key
  // that is present on one machine is a page that fails on the next.
  const environment = [process.env.BASETEN_API_KEY, process.env.OVERSEER_RECORDS, process.env.npm_lifecycle_event];
  const pages = FIXTURES.map((fixture) => renderPage(fixture.entries, fixture.options)).join('\n');
  for (const value of environment) {
    if (value) assert.equal(pages.includes(value), false, 'no environment value reaches a pinned page');
  }
});
