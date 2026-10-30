import test from 'node:test';
import assert from 'node:assert/strict';

import { MAKER_SKILLS, makerLabel, parseMaker, shapePrompt } from '../cli/maker-style.js';

test('no age or skill picked leaves the prompt untouched', () => {
  const maker = parseMaker({ age: null, skill: null });
  assert.equal(maker.problem, null);
  assert.equal(shapePrompt('a red fox', maker), 'a red fox');
  assert.equal(makerLabel(maker), null);
});

test('a 7-year-old beginner shapes the prompt, and the label says so', () => {
  const maker = parseMaker({ age: '7', skill: 'beginner' });
  assert.equal(maker.problem, null);
  assert.match(shapePrompt('a red fox', maker), /7-year-old's coloured-pencil drawing/);
  assert.match(shapePrompt('a red fox', maker), /just starting out/);
  assert.match(shapePrompt('a red fox', maker), /a red fox$/);
  assert.equal(makerLabel(maker), 'Made like a 7-year-old, beginner');
});

test('age bands differ: a 5-year-old crayons, a 12-year-old shades, an adult draws', () => {
  assert.match(shapePrompt('x', parseMaker({ age: '5', skill: null })), /crayon/);
  assert.match(shapePrompt('x', parseMaker({ age: '12', skill: null })), /shading attempts/);
  assert.match(shapePrompt('x', parseMaker({ age: 'adult', skill: 'master' })), /adult artist's drawing/);
  assert.equal(makerLabel(parseMaker({ age: 'adult', skill: 'master' })), 'Made like an adult, master');
});

test('skill alone is allowed, and a bad age or skill stops instead of guessing', () => {
  assert.match(shapePrompt('x', parseMaker({ age: null, skill: 'skilled' })), /skilled and detailed/);
  assert.match(parseMaker({ age: '2', skill: null }).problem, /--age must be/);
  assert.match(parseMaker({ age: 'banana', skill: null }).problem, /--age must be/);
  assert.match(parseMaker({ age: null, skill: 'godlike' }).problem, /--skill must be one of/);
  assert.deepEqual(MAKER_SKILLS, ['beginner', 'learning', 'confident', 'skilled', 'master']);
});
