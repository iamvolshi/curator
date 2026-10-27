// Folders: a view of the record, one per subject.
//
// These check the three things the invariant claims. A folder appears only for a
// subject an entry named. Every entry about a subject lands in that folder, in
// record order. And a folder cannot disagree with the record, because it is read
// out of it every time rather than copied.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { foldersCommand } from '../cli/folders.js';
import { makeEntry } from '../record/entry.js';
import { folderNamed, foldersFrom, normalizeSubjectList, subjectsOf, unfiledQuestions } from '../record/folders.js';
import { createStore } from '../record/store.js';
import { wrapCall } from '../wrapper/wrap.js';

const when = '2026-10-27T02:00:00.000Z';

async function withStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'overseer-folders-'));
  try {
    return await fn(createStore(join(dir, 'records.jsonl')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function capture() {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.map(String).join(' '));
  return {
    text: () => lines.join('\n'),
    restore: () => {
      console.log = original;
    },
  };
}

/** One fact entry, about the subjects given. Written by the wrapper, as always. */
async function observed(store, prompt, subjects = [], seqHint = '') {
  return wrapCall({
    call: async () => ({ ok: true, kind: 'worker-call', worker: 'meta-model-api', model: 'muse-spark-1.3', text: `an answer about ${seqHint}` }),
    prompt,
    store,
    subjects,
  });
}

// A judgment and a question name their subject the same way a call does — with
// `subjects` — so folders need exactly one rule for placement, not three.
async function judgment(store, move, subject, observation) {
  return store.append(
    makeEntry({ when, label: 'judgment', what: { kind: 'judgment', move, subjects: [subject], observation } }),
  );
}

async function question(store, subject, asked) {
  return store.append(
    makeEntry({ when, label: 'question', what: { kind: 'question', subjects: [subject], question: asked } }),
  );
}

test('exactly the folders the named subjects warrant, in first-observation order', async () => {
  await withStore(async (store) => {
    await observed(store, 'first move', ['Ada Okafor']);
    await observed(store, 'second move', ['Lagos']);
    await observed(store, 'third move', ['Ada Okafor', 'Lagos']);
    await observed(store, 'a move about nothing');

    const folders = foldersFrom(await store.readAll());

    assert.deepEqual(
      folders.map((f) => f.name),
      ['Ada Okafor', 'Lagos'],
      'two subjects named, two folders — and an unsubjected entry invents none',
    );
    assert.equal(folders[0].entries.length, 2, 'the entry naming both is in both folders');
    assert.equal(folders[1].entries.length, 2);
  });
});

test('a subject nobody named has no folder, and nothing creates one to hold it', async () => {
  await withStore(async (store) => {
    await observed(store, 'a move about nothing at all');
    const entries = await store.readAll();

    assert.deepEqual(foldersFrom(entries), [], 'no subjects declared, no folders');
    const ghost = folderNamed(entries, 'Primed Subject');
    assert.equal(ghost.entries.length, 0, 'asking for a subject does not make it exist');
  });
});

test('read-back is in record order and every label is visible', async () => {
  await withStore(async (store) => {
    const fact = await observed(store, 'a move about Ada', ['Ada Okafor']);
    await judgment(store, fact.entry.seq, 'Ada Okafor', 'the result supports the claim about Ada');
    await question(store, 'Ada Okafor', 'what else supports this?');

    const folder = folderNamed(await store.readAll(), 'Ada Okafor');

    assert.deepEqual(
      folder.entries.map((e) => e.label),
      ['fact', 'judgment', 'question'],
      'a fact, a judgment and a question all live in the same subject thread',
    );
    assert.deepEqual(
      folder.entries.map((e) => e.seq),
      [...folder.entries.map((e) => e.seq)].sort((a, b) => a - b),
      'record order, not arrival-at-the-folder order',
    );

    const out = capture();
    let code;
    try {
      code = await foldersCommand({ args: ['--subject', 'Ada Okafor'], store });
    } finally {
      out.restore();
    }
    assert.equal(code, 0);
    for (const label of ['fact', 'judgment', 'question']) {
      assert.match(out.text(), new RegExp(`label:\\s+${label}`), `the read-back shows the ${label} label`);
    }
  });
});

test('a question with no subject is shown on its own shelf, and files nothing', async () => {
  await withStore(async (store) => {
    const fact = await observed(store, 'a move about nothing');
    await store.append(
      makeEntry({
        when,
        label: 'question',
        what: { kind: 'question', move: fact.entry.seq, subjects: [], question: 'what anchors this entry?' },
      }),
    );

    const entries = await store.readAll();
    assert.deepEqual(foldersFrom(entries), [], 'the question created no folder to sit in');
    assert.deepEqual(unfiledQuestions(entries).map((e) => e.seq), [2]);

    // The record can hold unfiled questions while declaring no subject at all.
    // That is the shape of this record, and the shelf has to survive it.
    const out = capture();
    let code;
    try {
      code = await foldersCommand({ args: [], store });
    } finally {
      out.restore();
    }
    assert.equal(code, 0);
    assert.match(out.text(), /No folder exists yet/);
    assert.match(out.text(), /Unfiled/);
    assert.match(out.text(), /seq 2 \u2014 about the move at seq 1/);
    assert.match(out.text(), /what anchors this entry\?/);
    assert.match(out.text(), /Unfiled questions: 1/);
  });
});

test('only a question that names no subject is unfiled', async () => {
  await withStore(async (store) => {
    const fact = await observed(store, 'a move about Ada', ['Ada Okafor']);
    await store.append(
      makeEntry({ when, label: 'judgment', what: { kind: 'judgment', move: fact.entry.seq, subjects: [], observation: 'no subject named' } }),
    );
    await question(store, 'Ada Okafor', 'a filed question about Ada');
    await store.append(
      makeEntry({ when, label: 'question', what: { kind: 'question', move: fact.entry.seq, subjects: [], question: 'an unfiled question' } }),
    );

    const entries = await store.readAll();
    const unfiled = unfiledQuestions(entries);

    assert.deepEqual(unfiled.map((e) => e.seq), [4], 'a filed question, a subject-less judgment and a fact are not unfiled');
    assert.deepEqual(foldersFrom(entries).map((f) => f.name), ['Ada Okafor'], 'the shelf did not add a folder');

    const out = capture();
    try {
      await foldersCommand({ args: [], store });
    } finally {
      out.restore();
    }
    const [, shelf = ''] = out.text().split(/Unfiled \u2014/);
    assert.match(shelf, /an unfiled question/, 'the unfiled question is on the shelf');
    assert.doesNotMatch(shelf, /a filed question about Ada/, 'a question in a folder is not repeated on the shelf');
  });
});

test('with nothing unfiled there is no shelf, so an empty section is never printed', async () => {
  await withStore(async (store) => {
    await observed(store, 'a move about Ada', ['Ada Okafor']);

    const out = capture();
    try {
      await foldersCommand({ args: [], store });
    } finally {
      out.restore();
    }
    assert.doesNotMatch(out.text(), /Unfiled/);
  });
});

test('a subject is one folder however it was spaced', async () => {
  assert.deepEqual(normalizeSubjectList([' Ada ', 'Ada', '', '  ', null, 'Lagos']), ['Ada', 'Lagos']);
  assert.deepEqual(subjectsOf({ what: {} }), [], 'an entry that names nothing names nothing');
});

test('an entry about nothing keeps the old entry shape', async () => {
  await withStore(async (store) => {
    const plain = await observed(store, 'a move about nothing');
    const about = await observed(store, 'a move about Ada', ['Ada Okafor']);

    assert.equal(Object.hasOwn(plain.entry.what, 'subjects'), false, 'no subjects key when none were declared');
    assert.deepEqual(about.entry.what.subjects, ['Ada Okafor']);
  });
});

test('the folders command lists one line per folder and says when there are none', async () => {
  await withStore(async (store) => {
    const empty = capture();
    let code;
    try {
      code = await foldersCommand({ args: [], store });
    } finally {
      empty.restore();
    }
    assert.equal(code, 0);
    assert.match(empty.text(), /No folder exists yet/);
    assert.doesNotMatch(empty.text(), /Fri/, 'an empty record lists nothing that looks like a folder');

    await observed(store, 'a move about Ada', ['Ada Okafor']);
    await observed(store, 'another about Lagos', ['Lagos']);

    const filled = capture();
    try {
      code = await foldersCommand({ args: [], store });
    } finally {
      filled.restore();
    }
    assert.equal(code, 0);
    assert.match(filled.text(), /Ada Okafor/);
    assert.match(filled.text(), /Lagos/);
    assert.match(filled.text(), /Subjects: 2/);
  });
});
