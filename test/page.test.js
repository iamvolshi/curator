// The record as one page.
//
// Two properties matter and both are checkable without a browser. Everything on
// the page has to come from the entries handed in — the counts counted, not
// typed. And model output is text, not markup, so it has to be escaped: a reply
// that contains a tag must not become a tag on a page shown to someone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pageCommand } from '../cli/page.js';
import { PARK_AFTER, createLedger } from '../judge/attempts.js';
import { renderPage } from '../record/html.js';
import { createStore } from '../record/store.js';

const when = '2026-10-26T23:12:32.281Z';
const URL = 'https://api.meta.ai/v1/chat/completions';

function call(seq, overrides = {}) {
  return {
    seq,
    when,
    label: 'fact',
    what: {
      kind: 'worker-call',
      worker: 'meta-model-api',
      endpoint: `POST ${URL}`,
      request: { method: 'POST', url: URL, body: { model: 'muse-spark-1.3', messages: [] } },
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

test('the page shows every entry with its number and its label', () => {
  const html = renderPage([
    call(1),
    call(2, { prompt: 'a second question', response: 'a second answer', usage: { total_tokens: 647 } }),
    { seq: 3, when, label: 'judgment', what: { kind: 'judgment', about: 1, note: 'on task' } },
  ]);

  assert.match(html, /say ready/);
  assert.match(html, /a second question/);
  assert.match(html, /a second answer/);
  assert.match(html, /chip--fact/);
  assert.match(html, /chip--judgment/);
  assert.match(html, /on task/, 'an entry shape the renderer does not know still shows what it holds');
  assert.match(html, /3 calls/);
  assert.match(html, /2 facts/);
  assert.match(html, /1 judgment/);
});

function judgment(seq, move, subject) {
  return {
    seq,
    when,
    label: 'judgment',
    what: { kind: 'judgment', move, subjects: [subject], observation: 'the result supports the claim about the subject' },
  };
}

function question(seq, move, subject) {
  return {
    seq,
    when,
    label: 'question',
    what: { kind: 'question', move, subjects: [subject], question: 'what else supports this?' },
  };
}

test('a judgment and a question read as themselves, and are counted apart from facts', () => {
  const html = renderPage([call(1), judgment(2, 1, 'Ada Okafor'), question(3, 1, 'Ada Okafor')]);

  assert.match(html, /chip--judgment/);
  // Inside the entry card, not just the legend at the foot of the page: the chip
  // on the card is the one a reader trusts, and it has to say what the entry is.
  assert.match(html, /id="entry-3">[\s\S]{0,240}chip--question">question</, 'a question wears the question chip');
  assert.doesNotMatch(html, /id="entry-3">[\s\S]{0,240}chip--fact/, 'and is never dressed as a fact');
  assert.match(html, /Judges/, 'a judgment says which move it judges');
  assert.match(html, /the move at seq 1/);
  assert.match(html, /Observed/);
  assert.match(html, /Asks/, 'a question says what it asks');
  assert.match(html, /3 calls · 1 fact · 1 judgment · 1 question/, 'the counts do not fold questions into judgments');
  assert.doesNotMatch(html, /No judgments or questions yet/);
});

test('model output is escaped, never trusted as markup', () => {
  const html = renderPage([
    call(1, {
      prompt: '<script>alert(1)</script>',
      response: '<img src=x onerror="alert(2)">',
    }),
  ]);

  assert.equal(html.includes('<script>alert(1)'), false, 'a reply must not become script');
  assert.equal(html.includes('<img src=x'), false, 'a reply must not become an image tag');
  assert.match(html, /&lt;script&gt;/, 'it is shown, but as text');
});

test('the numbers on the page are counted from the entries', () => {
  const html = renderPage([
    call(1),
    call(2, { usage: { total_tokens: 647 } }),
    call(3, {
      ok: false,
      response: null,
      usage: null,
      noCallMade: true,
      request: null,
      error: { kind: 'missing-key', message: 'no key', fix: 'put the key somewhere' },
    }),
  ]);

  assert.match(html, /3 calls/);
  assert.match(html, /2 calls worked/);
  assert.match(html, /1 call never sent/);
  assert.match(html, /833 tokens in total/, '186 + 647, counted, not guessed');
  assert.match(html, /2 entries kept the request body/);
  // The judge exists now, so the sentence changed with it. The property it guards
  // is unchanged: with nothing judged, the page must not imply that anything has
  // been judged or asked.
  assert.match(html, /No judgments or questions yet: the judge has not written one/);
  assert.doesNotMatch(html, /chip--judgment">judgment<\/span>\s*<\/div>/, 'no entry is dressed as a judgment');
});

test('the index links to every entry by its number, and nothing else', () => {
  const html = renderPage([call(1), call(2), call(3)]);

  const links = [...html.matchAll(/<a class="index__link" href="#entry-(\d+)"/g)].map((m) => m[1]);
  const anchors = [...html.matchAll(/<article class="entry[^"]*" id="entry-(\d+)"/g)].map((m) => m[1]);

  assert.deepEqual(links, ['1', '2', '3'], 'one link per entry, in record order');
  assert.deepEqual(anchors, links, 'every link has somewhere to land');
  assert.ok(html.indexOf('class="index"') < html.indexOf('class="entry'), 'the index comes before the entries');
});

test('an entry that did not work says so in its index tooltip', () => {
  const html = renderPage([
    call(1),
    call(2, { ok: false, response: null, error: { kind: 'auth', message: 'no', fix: 'fix it' } }),
  ]);

  const titles = [...html.matchAll(/title="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(titles.some((t) => /entry 1 — fact, worked/.test(t)), true);
  assert.equal(titles.some((t) => /entry 2 — fact, did not work/.test(t)), true);
});

test('an empty record produces a page that says so', () => {
  const html = renderPage([], { source: 'records/k-record.jsonl', generatedAt: when });

  assert.match(html, /Nothing has been recorded yet/);
  assert.match(html, /0 calls/);
  assert.equal(html.includes('class="entry'), false, 'no entry markup is invented');
  assert.match(html, /records\/k-record\.jsonl/);
});

const META = { name: 'meta', label: 'Meta Model API', role: 'worker', status: 'ready', chatUrl: URL };
const BASETEN = {
  name: 'baseten',
  label: 'Baseten',
  role: 'overseer',
  status: 'needs-config',
  chatUrl: 'https://inference.baseten.co/v1/chat/completions',
};
const PICTURE = { name: 'picture', label: 'picture kid', role: 'picture', status: 'awaiting-pick', chatUrl: null };

const BASETEN_URL = 'POST https://inference.baseten.co/v1/chat/completions';

function basetenCall(seq, overrides = {}) {
  return {
    seq,
    when,
    label: 'fact',
    what: {
      kind: 'plug-prove',
      plug: 'baseten',
      role: 'overseer',
      endpoint: BASETEN_URL,
      model: 'a-model',
      prompt: 'say ready',
      ok: true,
      response: 'ready',
      ...overrides,
    },
  };
}

test('a proof and a piece of work through the same plug are told apart', () => {
  const html = renderPage([basetenCall(1), basetenCall(2, { kind: 'plug-task', prompt: 'name three colours' })], {
    plugs: [BASETEN],
  });

  assert.match(html, /chip--kind[^>]*>prove · baseten/, 'a proof says it is a proof');
  assert.match(html, /chip--kind[^>]*>task · baseten/, 'work says it is work');
  assert.match(html, /2 calls · 2 worked/, 'both are still calls on that plug, counted from the record');
});

test('each plug gets a line, and the counts come from the record', () => {
  const html = renderPage([call(1), call(2)], { plugs: [META, BASETEN, PICTURE] });

  assert.match(html, /Who has actually answered/);
  assert.match(html, /Meta Model API/);
  assert.match(html, /2 calls · 2 worked/, 'two worker entries matched to meta by the address they reached');
  assert.match(html, /Baseten/);
  assert.match(html, /not called — not configured yet/);
  assert.match(html, /waiting on the provider and model pick/, 'the empty slot says why it is silent');
});

test('a plug that was never called is shown as silence, not as failure', () => {
  const html = renderPage([call(1)], { plugs: [META, BASETEN] });

  assert.match(html, /the same as having failed/);
  assert.equal(html.includes('2 did not'), false, 'nothing failed, so nothing says it did');
});

test('a plug that was called and failed shows both numbers', () => {
  const html = renderPage(
    [
      basetenCall(1),
      basetenCall(2, {
        ok: false,
        response: null,
        error: { kind: 'auth', message: 'the key was rejected', fix: 'check the key' },
      }),
    ],
    { plugs: [META, BASETEN] },
  );

  assert.match(html, /2 calls · 1 worked · 1 did not/);
  assert.match(html, /the call did not work/, 'the failed entry itself is still shown');
});

test('a plug that is ready but has not been called says exactly that', () => {
  const html = renderPage([basetenCall(1)], { plugs: [META, BASETEN] });

  // Scoped to the row: the footer says "0 calls never sent", which is a different
  // statement and must not be mistaken for this one.
  const row = html.split('<li class="socket__row').find((chunk) => chunk.includes('Meta Model API'));
  assert.ok(row, 'the meta row is on the page');
  assert.match(row, /ready, not called yet/);
  assert.equal(row.includes('0 calls'), false, 'an uncalled plug is not given a call count');
});

test('with no plug information the page simply has no such section', () => {
  const html = renderPage([call(1)]);

  assert.equal(html.includes('Who has actually answered'), false);
});

// A parked move is not an entry, so a page built from the record alone would show
// a move as still being tried when the judge had stopped spending calls on it.
test('the page shows parked moves as waiting, and writes none of them into the record', () => {
  const html = renderPage([call(1)], {
    parked: [
      {
        seq: 1,
        fails: 3,
        prompt: '<b>say ready</b>',
        subjects: ['Ada Okafor'],
        reason: 'the call did not work',
        lastAt: when,
      },
    ],
  });

  assert.match(html, /Parked \u2014 still unjudged, not attempted/);
  assert.match(html, /3 failed attempts/);
  assert.match(html, /the call did not work/);
  assert.match(html, /Ada Okafor/, 'the reader is told which thread it belongs to');
  assert.equal(html.includes('<b>say ready</b>'), false, 'a recorded prompt is still escaped here');
  assert.match(html, /&lt;b&gt;say ready/);
  assert.match(html, /1 call · 1 fact · 0 judgments · 0 questions/, 'a park is not counted as an entry');
  // Scoped to the section: the legend at the foot legitimately names a judgment.
  const section = html.split('<section class="parked">')[1].split('</section>')[0];
  assert.doesNotMatch(section, /chip--judgment/, 'and is never dressed as a judgment');
});

test('with nothing parked the page has no parked section', () => {
  assert.equal(renderPage([call(1)]).includes('Parked'), false);
  assert.equal(renderPage([call(1)], { parked: [] }).includes('Parked'), false);
});

test('the command writes parked moves onto the page, and says it did', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'overseer-page-parked-'));
  try {
    const store = createStore(join(dir, 'records.jsonl'));
    const out = join(dir, 'page.html');
    const ledgerPath = join(dir, 'attempts.json');

    await store.append(call(1));
    const ledger = createLedger(ledgerPath);
    for (let run = 0; run < PARK_AFTER; run += 1) await ledger.noteFailure(1, 'call-failed');

    const printed = [];
    const original = console.log;
    console.log = (...args) => printed.push(args.map(String).join(' '));
    let code;
    try {
      code = await pageCommand({ store, args: ['--out', out], now: () => new Date(when), env: { OVERSEER_LEDGER: ledgerPath } });
    } finally {
      console.log = original;
    }

    assert.equal(code, 0);
    assert.match(printed.join('\n'), /parked:\s+1 move the judge is skipping/);

    const html = await readFile(out, 'utf8');
    assert.match(html, /Parked \u2014 still unjudged, not attempted/);
    assert.match(html, /3 failed attempts/);
    assert.equal((await store.readAll()).length, 1, 'writing the page does not add an entry');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the command writes the page from the file, and the page names the file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'overseer-page-'));
  try {
    const store = createStore(join(dir, 'records.jsonl'));
    const out = join(dir, 'page.html');

    await store.append(call(1));
    const code = await pageCommand({ store, args: ['--out', out], now: () => new Date(when) });

    assert.equal(code, 0);

    const html = await readFile(out, 'utf8');
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /say ready/, 'the entry written to the store is on the page');
    assert.match(html, /1 call\b/);
    assert.equal(html.includes('k-record.jsonl'), false, 'it names the file it actually read');

    const written = await store.readAll();
    assert.equal(written.length, 1, 'reading the record did not add to it');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
