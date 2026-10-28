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
import { buildPage } from '../cli/view.js';
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

/** One seat's judgment, as the panel records it: the ID is the one the reply named. */
function held(seq, move, seat, model, observation) {
  return {
    seq,
    when,
    label: 'judgment',
    what: { kind: 'judgment', move, subjects: [], seat, model, observation },
  };
}

test('the page carries the panel\u2019s readout, counted from the seats the record shows', () => {
  // The readout is a view, so it is built where the page is built, from the entries
  // in hand — not handed to the renderer by whoever remembered to. The panel it is
  // counted against is the one the record shows: the seat numbers these entries
  // carry, three of them, so a majority is two.
  const html = buildPage(
    [
      call(1),
      held(2, 1, 1, 'muse-spark-1.3', 'the reply supports the claim'),
      held(3, 1, 2, 'free-a', 'the reply supports the claim'),
      held(4, 1, 3, 'free-b', 'the reply restates the prompt'),
      // A second move showing two seats, and two readings that disagree: a majority
      // of two seats is two, so nothing is declared here.
      held(5, 2, 2, 'free-a', 'the reply is about a different subject'),
      held(6, 2, 3, 'free-b', 'the reply names something else'),
    ],
    { source: 'records/k-record.jsonl', generatedAt: when, env: {} },
  );

  assert.match(html, /highest probable/);
  assert.match(html, /the reply supports the claim/);
  assert.match(html, /2 seats \u00b7 2 independent judges \(muse-spark-1\.3, free-a\)/);
  assert.match(html, /edge grey[\s\S]{0,200}the reply restates the prompt/, 'the dissent is on the page with the probable reading');
  assert.match(
    html,
    /the majority of the 2 seats this move shows/,
    'the number a move is counted against is the one its own seats need \u2014 not the configured panel\u2019s',
  );
});

test('a consolidated move reads out its delivery report, and the gray box is labelled as one', () => {
  // The delivery is the readout for a move it covers: the page takes the grouping
  // and the statuses from it, and calls non-convergence the gray box rather than a
  // dissent nobody declared.
  const seat = (seq, seatNumber, model, pool, observation) => ({
    seq,
    when,
    label: 'judgment',
    what: {
      kind: 'seat-judgment',
      move: 1,
      subjects: [],
      seat: seatNumber,
      model,
      observation,
      numbered: { deed: 'the move', pool, basis: 'shown', topics: [], sitting: 'none' },
    },
  });

  const html = buildPage(
    [
      call(1),
      seat(2, 1, 'muse-spark-1.3', 'entry 1', 'the reply supports the claim'),
      seat(3, 2, 'free-a', 'entry 2', 'the reply restates the prompt'),
      {
        seq: 4,
        when,
        label: 'delivery',
        what: {
          kind: 'delivery',
          move: 1,
          mmrc_model_id: 'muse-spark-1.3',
          seats: ['muse-spark-1.3', 'free-a'],
          opinions: [
            { position: 'justified', basis: [1], support_count: 1, supporting_models: ['muse-spark-1.3'], status: 'gray_box' },
            { position: 'justified', basis: [2], support_count: 1, supporting_models: ['free-a'], status: 'gray_box' },
          ],
          highest_probable: null,
          questions: [],
          derived: true,
        },
      },
    ],
    { source: 'records/k-record.jsonl', generatedAt: when, env: {} },
  );

  assert.match(html, /gray box[\s\S]{0,240}the reply supports the claim/, 'no opinion carried the move, so every reading stands in the gray box');
  assert.doesNotMatch(html, /edge grey[\s\S]{0,240}the reply supports the claim/, 'non-convergence is not called a dissent');
});

test('the page reads a stored delivery with the seats it cites, even when its basis re-parses differently', () => {
  // A report's basis is fixed when it is written; how a cited Q2 is read is not. The
  // stored basis here is the two numbers an older read made of "entries 7\u20139", which
  // today reads as three entries \u2014 so the basis alone matches no seat.
  const seat = (seq, seatNumber, model, pool, observation) => ({
    seq,
    when,
    label: 'judgment',
    what: {
      kind: 'seat-judgment',
      move: 1,
      subjects: [],
      seat: seatNumber,
      model,
      observation,
      numbered: { deed: 'the move', pool, basis: 'shown', topics: [], sitting: 'none' },
    },
  });

  const html = buildPage(
    [
      call(1),
      seat(2, 1, 'model-a', 'entries 7\u20139', 'the approval entry covers the deed'),
      seat(3, 2, 'model-b', 'entry 12', 'a dissent from another basis'),
      {
        seq: 4,
        when,
        label: 'delivery',
        what: {
          kind: 'delivery',
          move: 1,
          mmrc_model_id: 'model-m',
          seats: ['model-a', 'model-b'],
          opinions: [
            { position: 'justified', basis: [7, 9], support_count: 1, supporting_models: ['model-a'], status: 'gray_box' },
            { position: 'justified', basis: [12], support_count: 1, supporting_models: ['model-b'], status: 'gray_box' },
          ],
          highest_probable: null,
          questions: [],
          derived: true,
        },
      },
    ],
    { source: 'records/k-record.jsonl', generatedAt: when, env: {} },
  );

  assert.match(html, /readout__text">the approval entry covers the deed</, 'the opinion is shown with the seat that wrote it');
  assert.match(html, /1 seat \u00b7 1 independent judge \(model-a\)/, 'and counted against that seat, not against nobody');
});

test('a stored opinion the record cannot back is marked unbacked on the page', () => {
  // The report cites a model and a basis the record does not hold. The row is shown
  // — a stored derivation is never dropped — but it says it is unbacked, and it does
  // not report itself as held by zero seats beside a count.
  const seat = (seq, seatNumber, model, pool, observation) => ({
    seq,
    when,
    label: 'judgment',
    what: {
      kind: 'seat-judgment',
      move: 1,
      subjects: [],
      seat: seatNumber,
      model,
      observation,
      numbered: { deed: 'the move', pool, basis: 'shown', topics: [], sitting: 'none' },
    },
  });

  const html = buildPage(
    [
      call(1),
      seat(2, 1, 'model-a', 'entry 1', 'the reply supports the claim'),
      {
        seq: 3,
        when,
        label: 'delivery',
        what: {
          kind: 'delivery',
          move: 1,
          mmrc_model_id: 'model-m',
          seats: ['model-a', 'model-z'],
          opinions: [
            { position: 'justified', basis: [1], support_count: 1, supporting_models: ['model-a'], status: 'gray_box' },
            { position: 'justified', basis: [99], support_count: 1, supporting_models: ['model-z'], status: 'gray_box' },
          ],
          highest_probable: null,
          questions: [],
          derived: true,
        },
      },
    ],
    { source: 'records/k-record.jsonl', generatedAt: when, env: {} },
  );

  assert.match(
    html,
    /readout__text">unbacked: the report cites model-z, and no seat in this record holds this opinion</,
    'the row says why it has no words instead of showing a blank opinion',
  );
  assert.match(html, /readout__count">no seat in this record</, 'and it is not reported as held by zero seats');
  assert.doesNotMatch(html, /readout__count">0 seats/);
  assert.match(html, /readout__text">the reply supports the claim</, 'the opinion the record does back still reads as itself');
});

test('a stored opinion the record seats twice with two readings is shown as ambiguous', () => {
  // One model on two seats that disagree, with a basis no longer read the way the
  // report read it: the page cannot say which seat the report meant, so the row says
  // the link is ambiguous instead of attaching either seat's words.
  const seat = (seq, seatNumber, model, pool, observation) => ({
    seq,
    when,
    label: 'judgment',
    what: {
      kind: 'seat-judgment',
      move: 1,
      subjects: [],
      seat: seatNumber,
      model,
      observation,
      numbered: { deed: 'the move', pool, basis: 'shown', topics: [], sitting: 'none' },
    },
  });

  const html = buildPage(
    [
      call(1),
      seat(2, 1, 'model-a', 'entries 7\u20139', 'the approval entry covers the deed'),
      seat(3, 2, 'model-a', 'entry 12', 'the approval entry names another basis'),
      {
        seq: 4,
        when,
        label: 'delivery',
        what: {
          kind: 'delivery',
          move: 1,
          mmrc_model_id: 'model-m',
          seats: ['model-a'],
          opinions: [
            { position: 'justified', basis: [7, 9], support_count: 1, supporting_models: ['model-a'], status: 'gray_box' },
            { position: 'justified', basis: [12], support_count: 1, supporting_models: ['model-a'], status: 'gray_box' },
          ],
          highest_probable: null,
          questions: [],
          derived: true,
        },
      },
    ],
    { source: 'records/k-record.jsonl', generatedAt: when, env: {} },
  );

  assert.match(
    html,
    /readout__text">ambiguous: this record shows more than one seat with model-a holding different opinions, so no seat is attached</,
    'the row says the link is ambiguous rather than attaching either seat',
  );
  assert.match(html, /readout__count">no seat attached</, 'and no seat count is claimed for it');
  assert.match(html, /readout__text">the approval entry names another basis</, 'the opinion the basis still places reads with its seat');
});

test('a stored opinion only some of its cited seats place says which one is missing', () => {
  // The report counted two models under one basis; this record's reading of that
  // basis places one. The row keeps the seat it can name and says the other is not
  // placed, so the short seat count is explained instead of reading as a panel that
  // shrank. The report's own count is repeated exactly as stored.
  const seat = (seq, seatNumber, model, pool, observation) => ({
    seq,
    when,
    label: 'judgment',
    what: {
      kind: 'seat-judgment',
      move: 1,
      subjects: [],
      seat: seatNumber,
      model,
      observation,
      numbered: { deed: 'the move', pool, basis: 'shown', topics: [], sitting: 'none' },
    },
  });

  const html = buildPage(
    [
      call(1),
      seat(2, 1, 'model-a', 'entry 1', 'the reply supports the claim'),
      seat(3, 2, 'model-b', 'entry 2', 'the reply restates the prompt'),
      {
        seq: 4,
        when,
        label: 'delivery',
        what: {
          kind: 'delivery',
          move: 1,
          mmrc_model_id: 'model-m',
          seats: ['model-a', 'model-b'],
          opinions: [
            { position: 'justified', basis: [1], support_count: 2, supporting_models: ['model-a', 'model-b'], status: 'gray_box' },
          ],
          highest_probable: null,
          questions: [],
          derived: true,
        },
      },
    ],
    { source: 'records/k-record.jsonl', generatedAt: when, env: {} },
  );

  assert.match(
    html,
    /readout__count">1 seat attached \u00b7 the report counts 2 independent judges \(model-a, model-b\) \u2014 model-b is not placed by this basis</,
    'the row names the cited seat the basis does not place',
  );
  assert.doesNotMatch(html, /readout__count">1 seat \u00b7 2 independent judges/, 'and not the bare short count it used to print');
  assert.match(html, /readout__text">the reply supports the claim</, 'the words of the seat it does place are still shown');
});

test('a record no panel wrote carries no readout, because no panel sat', () => {
  // The single judge's judgment carries no seat. A page that read it out would say
  // "no opinion reached 2 independent judges" about a move one judge answered — a
  // claim about a panel that never sat, which is the one thing this section must
  // never become.
  const html = buildPage(
    [
      call(1),
      {
        seq: 2,
        when,
        label: 'judgment',
        what: { kind: 'judgment', move: 1, subjects: [], observation: 'the reply supports the claim' },
      },
    ],
    { source: 'records/k-record.jsonl', generatedAt: when, env: {} },
  );

  assert.equal(html.includes('<section class="readout"'), false, 'no seat in the record, so the page says nothing about a panel');
  assert.equal(html.includes('the majority of the'), false, 'and it states no majority for one to be measured against');
  assert.match(html, /the reply supports the claim/, 'the judgment itself is still on the page, labelled as a judgment');
});

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
  // The total is entries, not calls: this record holds three entries and made two
  // calls, so "3 calls" would be the page misreporting the file it came from.
  assert.match(html, /3 entries/);
  assert.match(html, /2 facts/);
  assert.match(html, /1 judgment/);
  assert.match(html, /2 calls worked/);
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
  assert.match(html, /3 entries · 1 fact · 1 judgment · 1 question/, 'the counts do not fold questions into judgments');
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

  // Entries, not calls: three entries, and the one where nothing was sent is not a
  // call the page may count.
  assert.match(html, /3 entries/);
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
  assert.match(html, /0 entries/);
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
  assert.match(html, /2 entries · 2 worked/, 'both are still entries for that plug, counted from the record');
});

test('each plug gets a line, and the counts come from the record', () => {
  const html = renderPage([call(1), call(2)], { plugs: [META, BASETEN, PICTURE] });

  assert.match(html, /Who has actually answered/);
  assert.match(html, /Meta Model API/);
  assert.match(html, /2 entries · 2 worked/, 'two worker entries matched to meta by the address they reached');
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

  assert.match(html, /2 entries · 1 worked · 1 did not work/);
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

test('an entry that recorded no call is never reported as one that worked or one that failed', () => {
  const html = renderPage(
    [
      call(1),
      call(2, {
        ok: false,
        response: null,
        usage: null,
        noCallMade: true,
        request: null,
        error: { kind: 'missing-key', message: 'no key', fix: 'put it in .env' },
      }),
    ],
    { plugs: [META] },
  );

  // Three places describe this entry: its index tooltip, its plug's row, and the
  // foot. The foot counts it as never sent, so the other two cannot say a call was
  // made and failed — or nothing at all — about the same entry.
  const titles = [...html.matchAll(/title="([^"]*)"/g)].map((match) => match[1]);
  assert.equal(titles.some((title) => /entry 2 \u2014 fact, never sent/.test(title)), true, 'the tooltip says nothing was sent');
  assert.match(html, /1 never sent/, 'the plug row says so too');
  assert.equal(html.includes('1 did not work'), false, 'no call went out for that entry, so none failed');
  assert.equal(titles.some((title) => /entry 1 \u2014 fact, worked/.test(title)), true, 'the call that did work still says so');
});

test('a judgment is not described as a call that worked', () => {
  const html = renderPage([call(1), judgment(2, 1, 'Ada Okafor')]);

  const titles = [...html.matchAll(/title="([^"]*)"/g)].map((match) => match[1]);
  assert.equal(titles.some((title) => /entry 2 \u2014 judgment: /.test(title)), true, 'a judgment is named as one, with no call word');
  assert.equal(titles.some((title) => /judgment, worked/.test(title)), false, 'no call was made for a judgment');
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
  assert.match(html, /1 entry · 1 fact · 0 judgments · 0 questions/, 'a park is not counted as an entry');
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

test('the command reports a stored opinion that no longer links, and still writes the page', async () => {
  // The check runs before the page is opened: the person building it is told which
  // cited source the basis no longer places, and the command exits non-zero so a
  // script notices. The page is still written, with the row marked — refusing to
  // write would hide the record, which is the worse answer.
  const dir = await mkdtemp(join(tmpdir(), 'overseer-page-links-'));
  try {
    const store = createStore(join(dir, 'records.jsonl'));
    const out = join(dir, 'page.html');

    await store.append(call(1));
    await store.append({
      seq: 2,
      when,
      label: 'judgment',
      what: {
        kind: 'seat-judgment',
        move: 1,
        subjects: [],
        seat: 1,
        model: 'model-a',
        observation: 'the reply supports the claim',
        numbered: { deed: 'the move', pool: 'entry 1', basis: 'shown', topics: [], sitting: 'none' },
      },
    });
    await store.append({
      seq: 3,
      when,
      label: 'delivery',
      what: {
        kind: 'delivery',
        move: 1,
        mmrc_model_id: 'model-m',
        seats: ['model-a', 'model-z'],
        opinions: [
          { position: 'justified', basis: [1], support_count: 2, supporting_models: ['model-a', 'model-z'], status: 'gray_box' },
        ],
        highest_probable: null,
        questions: [],
        derived: true,
      },
    });

    const printed = [];
    const original = console.log;
    console.log = (...args) => printed.push(args.map(String).join(' '));
    let code;
    try {
      code = await pageCommand({
        store,
        args: ['--out', out],
        now: () => new Date(when),
        env: { OVERSEER_LEDGER: join(dir, 'attempts.json') },
      });
    } finally {
      console.log = original;
    }

    const text = printed.join('\n');
    assert.equal(code, 1, 'a stored opinion with no seat behind it fails the command');
    assert.match(text, /links:\s+1 stored opinion no longer links to a seat/);
    assert.match(text, /seq 3, move 1: no seat in this record holds model-z for entries 1/);

    const html = await readFile(out, 'utf8');
    assert.match(
      html,
      /readout__count">1 seat attached \u00b7 the report counts 2 independent judges \(model-a, model-z\) \u2014 no seat in this record holds model-z</,
      'the page still shows the row, marked, rather than hiding the record',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the command reports a stored delivery that no longer groups as its seat reports do', async () => {
  // Every opinion still links to a seat, so the link check passes. What disagrees is
  // the grouping itself: the stored report declares no probable, while the three
  // seat reports group today into a probable opinion. The command has to say which,
  // or a reader would think the page's grouping is the code's.
  const dir = await mkdtemp(join(tmpdir(), 'overseer-page-grouping-'));
  try {
    const store = createStore(join(dir, 'records.jsonl'));
    const out = join(dir, 'page.html');

    await store.append(call(1));
    const seat = (seq, seatNumber, model, pool) => ({
      seq,
      when,
      label: 'judgment',
      what: {
        kind: 'seat-judgment',
        move: 1,
        subjects: [],
        seat: seatNumber,
        model,
        observation: 'the move follows from the cited entries',
        numbered: { deed: 'the move', pool, basis: 'shown', topics: [], sitting: 'none' },
      },
    });
    await store.append(seat(2, 1, 'model-a', 'entry 1'));
    await store.append(seat(3, 2, 'model-b', 'entry 1'));
    await store.append(seat(4, 3, 'model-c', 'entry 2'));

    const probable = {
      position: 'justified',
      basis: [1],
      support_count: 2,
      supporting_models: ['model-a', 'model-b'],
      status: 'highest_probable',
    };
    await store.append({
      seq: 5,
      when,
      label: 'delivery',
      what: {
        kind: 'delivery',
        move: 1,
        mmrc_model_id: 'model-m',
        seats: ['model-a', 'model-b', 'model-c'],
        opinions: [
          probable,
          { position: 'justified', basis: [2], support_count: 1, supporting_models: ['model-c'], status: 'edge_grey' },
        ],
        highest_probable: null,
        questions: [],
        derived: true,
      },
    });

    const printed = [];
    const original = console.log;
    console.log = (...args) => printed.push(args.map(String).join(' '));
    let code;
    try {
      code = await pageCommand({
        store,
        args: ['--out', out],
        now: () => new Date(when),
        env: { OVERSEER_LEDGER: join(dir, 'attempts.json') },
      });
    } finally {
      console.log = original;
    }

    const text = printed.join('\n');
    assert.equal(code, 1, 'a stored grouping that disagrees with the record fails the command');
    assert.match(text, /links:\s+every stored delivery still finds the seats it cites/, 'the link check itself passes');
    assert.match(text, /grouping:\s+1 stored delivery no longer matches its seat reports/);
    assert.match(text, /seq 5, move 1: the seat reports group differently today \(highest_probable\)/);
    const html = await readFile(out, 'utf8');
    assert.match(html, /readout__kind readout__kind--probable">highest probable/, 'the page is still written');
    assert.match(
      html,
      /readout__drift">the rows below are what the stored report says; the seat reports group differently today \(highest_probable\)</,
      'the page itself marks the move whose stored grouping the record no longer produces',
    );
    // The live viewer builds the page without passing a problem list, so the default
    // has to compute it: both ways of looking at the record mark the same move.
    const live = buildPage(await store.readAll(), { source: 'records/k-record.jsonl', generatedAt: when, env: {} });
    assert.match(live, /<p class="readout__drift">/, 'the live viewer marks it too');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the command reports a stored opinion carrying a field the schema does not define', async () => {
  // Every opinion still links and the grouping still matches, so the first two
  // checks pass. The report itself carries a verdict on an opinion, which the form
  // has no place for; the command has to name it, or a reader would never learn the
  // stored report holds something this code would not write.
  const dir = await mkdtemp(join(tmpdir(), 'overseer-page-schema-'));
  try {
    const store = createStore(join(dir, 'records.jsonl'));
    const out = join(dir, 'page.html');

    await store.append(call(1));
    const seat = (seq, seatNumber, model, pool) => ({
      seq,
      when,
      label: 'judgment',
      what: {
        kind: 'seat-judgment',
        move: 1,
        subjects: [],
        seat: seatNumber,
        model,
        observation: 'the move follows from the cited entries',
        numbered: { deed: 'the move', pool, basis: 'shown', topics: [], sitting: 'none' },
      },
    });
    await store.append(seat(2, 1, 'model-a', 'entry 1'));
    await store.append(seat(3, 2, 'model-b', 'entry 1'));
    await store.append(seat(4, 3, 'model-c', 'entry 2'));

    const probable = {
      position: 'justified',
      basis: [1],
      support_count: 2,
      supporting_models: ['model-a', 'model-b'],
      status: 'highest_probable',
      verdict: 'justified',
    };
    await store.append({
      seq: 5,
      when,
      label: 'delivery',
      what: {
        kind: 'delivery',
        move: 1,
        mmrc_model_id: 'model-m',
        seats: ['model-a', 'model-b', 'model-c'],
        opinions: [
          probable,
          { position: 'justified', basis: [2], support_count: 1, supporting_models: ['model-c'], status: 'edge_grey' },
        ],
        highest_probable: probable,
        questions: [],
        derived: true,
      },
    });

    const printed = [];
    const original = console.log;
    console.log = (...args) => printed.push(args.map(String).join(' '));
    let code;
    try {
      code = await pageCommand({
        store,
        args: ['--out', out],
        now: () => new Date(when),
        env: { OVERSEER_LEDGER: join(dir, 'attempts.json') },
      });
    } finally {
      console.log = original;
    }

    const text = printed.join('\n');
    assert.equal(code, 1, 'a stored field outside the schema fails the command');
    assert.match(text, /links:\s+every stored delivery still finds the seats it cites/, 'the link check itself passes');
    assert.match(text, /grouping:\s+every stored delivery still groups the way its seat reports do/, 'the grouping check itself passes');
    assert.match(text, /schema:\s+1 stored opinion or question carries a field the schema does not define/);
    assert.match(text, /seq 5, move 1: opinion 0 carries verdict, which the schema does not define/);
    assert.equal(
      (await readFile(out, 'utf8')).includes('<p class="readout__drift">'),
      false,
      'a delivery that still groups the way the record does is not marked',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
