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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderPage } from '../record/html.js';
import { assertInventory, firstDifference, goldenText, writeRequested } from '../checks/golden.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDENS = join(HERE, 'fixtures');
const SCRIPT = 'node test/page-golden.test.js --write';

/** Writing is asked for outright, never inferred. */
const WRITE = writeRequested('OVERSEER_WRITE_PAGE_GOLDENS');

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

test('every fixed set of entries renders to exactly the page that was blessed', async () => {
  const seen = [];

  for (const fixture of FIXTURES) {
    const html = renderPage(fixture.entries, fixture.options);
    const blessed = await goldenText({ dir: GOLDENS, extension: 'html', name: fixture.name, text: html, write: WRITE, script: SCRIPT });

    if (blessed !== null) {
      assert.equal(html, blessed, firstDifference({ name: fixture.name, blessed, printed: html, noun: 'page', script: SCRIPT, dir: GOLDENS, extension: 'html' }));
    }
    seen.push(fixture.name);
  }

  assert.equal(seen.length, FIXTURES.length, 'every fixture was rendered');
  if (WRITE) console.log(`blessed ${seen.length} pages: ${seen.join(', ')}`);
});

/**
 * The numbers the page states about itself, read back off the page it printed.
 *
 * Read by pattern rather than by position, and every pattern has to match: a page
 * that stops stating one of these numbers as a failure here, not as a quietly
 * green check that compared nothing.
 */
function statedNumbers(name, html) {
  const read = (pattern, what) => {
    const found = html.match(pattern);
    assert.ok(found, `"${name}" no longer states ${what} in the words this check reads`);
    return found.slice(1).map(Number);
  };

  const [title] = read(/<title>[^<]*of (\d+) entr(?:y|ies)<\/title>/, 'the entry count in its title');
  const [total, facts, judgments, questions] = read(
    /<p class="deck"><strong>(\d+) entr(?:y|ies) \u00b7 (\d+) facts? \u00b7 (\d+) judgments? \u00b7 (\d+) questions?<\/strong>/,
    'its entry counts',
  );
  // The foot wraps across lines in the document, so the separators are whitespace,
  // not single spaces.
  const [worked, notSent, withBody, tokens] = read(
    /(\d+) calls? worked\s*\u00b7\s*(\d+) calls? never sent\s*\u00b7\s*(\d+) entr(?:y|ies) kept the request body\s*\u00b7\s*(\d+) tokens in total/,
    'its call totals',
  );

  return { title, total, facts, judgments, questions, worked, notSent, withBody, tokens };
}

/** The same numbers, counted here from the entries the page was built from. */
function counted(entries) {
  const by = (predicate) => entries.filter(predicate).length;

  return {
    title: entries.length,
    total: entries.length,
    facts: by((entry) => entry.label === 'fact'),
    judgments: by((entry) => entry.label === 'judgment'),
    questions: by((entry) => entry.label === 'question'),
    worked: by((entry) => entry.what?.ok === true),
    notSent: by((entry) => entry.what?.noCallMade === true),
    withBody: by((entry) => Boolean(entry.what?.request?.body)),
    tokens: entries.reduce((sum, entry) => sum + (Number(entry.what?.usage?.total_tokens) || 0), 0),
  };
}

test('every number a page states is the number the record holds', () => {
  // The page states its own counts, and a count that disagrees with the entries it
  // was built from is the page misreporting the record — the one thing this whole
  // view exists not to do. Counted again here, apart from the renderer, because a
  // blessed page only pins what it said; it cannot tell whether that was true.
  // This is what found the headline calling a judgment a call.
  for (const fixture of FIXTURES) {
    const stated = statedNumbers(fixture.name, renderPage(fixture.entries, fixture.options));
    assert.deepEqual(stated, counted(fixture.entries), `"${fixture.name}" states numbers its own record does not hold`);
  }
});

test('the pinned pages are exactly the fixtures, with none left behind', async () => {
  await assertInventory({
    dir: GOLDENS,
    extension: 'html',
    names: FIXTURES.map((fixture) => fixture.name),
    validate: (file, html) => assert.match(html, /^<!doctype html>/, `${file} is a whole page, not a fragment of one`),
  });
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
