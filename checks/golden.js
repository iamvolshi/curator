// The shared half of a pinned check: blessed text on disk, compared byte for byte,
// failing on the line that moved.
//
// Three things in this repository are pinned this way — the page a record renders
// to, the words `records` prints back, and the report a judge run gives — and the
// comparing, the re-blessing and the failure message are the same for all three.
// They live here so a fourth pin is a file of fixtures rather than another copy of
// this machinery.
//
// This is NOT a test file. It sits outside `test/` because the runner executes
// every `.js` under that directory, so a shared module kept there would be run as
// a suite of its own and fail with "no tests".
//
// A check imports what it needs and keeps its own fixtures: what is fixed, and why
// those inputs can only differ because the thing under test changed, belongs with
// the thing being pinned.

import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Re-blessing is asked for outright, never inferred from a failing comparison:
 * a check that quietly rewrote its own answer would never fail.
 */
export function writeRequested(envVar) {
  return process.argv.includes('--write') || Boolean(process.env[envVar]);
}

/** A line as a failure can show it, so a long entry does not bury the point. */
function show(line) {
  if (line === undefined) return '(the output ends here)';
  const text = String(line);
  return text.length > 120 ? `${text.slice(0, 119)}\u2026` : text;
}

/**
 * Where two texts part company, as a sentence a reader can act on.
 *
 * Comparing whole outputs says only that something moved; the line turns that into
 * a reason. The checkout case is called out first because a clone that rewrote the
 * file's line endings is not a change to what the thing says, and reporting it as
 * one sends a reader to the wrong file.
 *
 * @param {object} options
 * @param {string} options.noun       what is pinned: 'page', 'read-back', 'run'
 * @param {string} options.script     the command that re-blesses it
 * @param {string} options.dir        the fixture directory, for the checkout hint
 * @param {string} options.extension  the fixture's extension
 */
export function firstDifference({ name, blessed, printed, noun, script, dir, extension }) {
  if (blessed.includes('\r\n') && !printed.includes('\r\n')) {
    return [
      `the blessed ${noun} for "${name}" was checked out with Windows line endings, so nothing can match it:`,
      '  these files are compared byte for byte, so git has to check them out as stored.',
      '  .gitattributes keeps that true; get the file again with:',
      `    rm ${dir}/*.${extension} && git checkout -- ${dir}`,
    ].join('\n');
  }

  const before = blessed.split('\n');
  const after = printed.split('\n');
  const at = before.findIndex((line, i) => line !== after[i]);
  const where =
    at === -1
      ? `the lines agree up to line ${Math.min(before.length, after.length)}, where one ${noun} ends and the other does not (blessed ${before.length} lines, printed ${after.length})`
      : `first difference at line ${at + 1}\n    blessed: ${show(before[at])}\n    printed: ${show(after[at])}`;

  return [
    `the ${noun} for "${name}" is no longer what was blessed:`,
    `  ${where}`,
    `If the ${noun} changed on purpose, re-bless it and read the diff:`,
    `    ${script}`,
  ].join('\n');
}

/**
 * The blessed text for one fixture, or (when re-blessing) the act of writing it.
 *
 * Returns null while writing, so a caller can bless and compare in one loop
 * without a second flag to keep in step.
 */
export async function goldenText({ dir, extension, name, text, write, script }) {
  const path = join(dir, `${name}.${extension}`);

  if (write) {
    await mkdir(dir, { recursive: true });
    await writeFile(path, text, 'utf8');
    return null;
  }

  try {
    return await readFile(path, 'utf8');
  } catch {
    assert.fail(`no blessed ${extension} file for "${name}" at ${path}; create it with: ${script}`);
  }
}

/**
 * The blessed files have to be exactly the fixtures, or the set and the files have
 * drifted: a fixture with no file would be silently unpinned, and a file with no
 * fixture would be a copy nobody regenerates.
 *
 * @param {object} options
 * @param {string[]} options.names     the fixture names, in order
 * @param {Function} options.validate  (file, text) => void, for what a whole file is
 */
export async function assertInventory({ dir, extension, names, validate }) {
  const files = (await readdir(dir)).filter((file) => file.endsWith(`.${extension}`)).sort();

  assert.deepEqual(
    files,
    names.map((name) => `${name}.${extension}`).sort(),
    'a file with no fixture, or a fixture with no file, means the set and the files have drifted apart',
  );
  assert.equal(new Set(names).size, names.length, 'one file per name');

  for (const name of names) {
    const text = await readFile(join(dir, `${name}.${extension}`), 'utf8');
    validate(`${name}.${extension}`, text);
  }
}
