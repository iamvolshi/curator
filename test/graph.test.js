import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seatGraph } from '../judge/graph.js';

const seatEntry = (what) => ({ label: 'judgment', what: { move: 4, seat: 1, ...what } });

test('a justified move draws a basis that justifies it, and its topics', () => {
  const g = seatGraph(
    seatEntry({
      numbered: {
        deed: 'the reply supports the claim',
        pool: 'fact 1 in the record',
        basis: 'shown',
        topics: ['dates', 'sources'],
        sitting: 'none',
      },
    }),
  );
  assert.equal(g.nodes.filter((n) => n.kind === 'move').length, 1);
  assert.equal(g.nodes.filter((n) => n.kind === 'basis').length, 1);
  assert.deepEqual(
    g.edges.filter((e) => e.kind === 'justifies').map((e) => [e.from, e.to]),
    [['basis:4:1', 'move:4']],
  );
  assert.deepEqual(
    g.edges.filter((e) => e.kind === 'touches').map((e) => e.to),
    ['topic:dates', 'topic:sources'],
  );
  assert.equal(g.nodes.some((n) => n.kind === 'question'), false);
});

test('a move that touches topics across the record links each one from the move', () => {
  const g = seatGraph(
    seatEntry({
      numbered: { deed: 'the deed', pool: 'p', basis: 'shown', topics: ['a', 'b', 'c'], sitting: 'none' },
    }),
  );
  const touches = g.edges.filter((e) => e.kind === 'touches');
  assert.equal(touches.length, 3);
  assert.ok(touches.every((e) => e.from === 'move:4'));
});

test('a move whose basis is not shown asks a question and draws no justification', () => {
  const g = seatGraph(
    seatEntry({
      numbered: { deed: 'the deed', pool: 'p', basis: 'not-shown', topics: [], sitting: 'which entry shows the date?' },
    }),
  );
  assert.equal(g.edges.some((e) => e.kind === 'justifies'), false);
  assert.deepEqual(
    g.edges.filter((e) => e.kind === 'asks').map((e) => [e.from, e.to]),
    [['move:4', 'question:4:1']],
  );
  assert.equal(g.nodes.find((n) => n.kind === 'question').text, 'which entry shows the date?');
});

test('an entry with no numbered answers draws nothing', () => {
  assert.equal(seatGraph(seatEntry({})), null);
});
