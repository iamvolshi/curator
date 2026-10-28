import { fromASeat } from './readout.js';

/**
 * The graph one seat drew for one move, from its numbered answers.
 *
 * Nodes: the move (Q1 deed), its basis (Q2), each topic it touches (Q4), and the
 * question it asks when the basis is not shown (Q5).
 * Edges: the basis justifies the move (only when Q3 says justified); the move
 * touches each topic (Q4); the move asks a question (only when not shown).
 *
 * A seat with no numbered answers, or one that is not a seat's entry, draws
 * nothing: it has no edges to count.
 *
 * @param {object} entry  one record entry, as the panel writes it
 * @returns {{move: number, seat: number, nodes: Array, edges: Array}|null}
 */
export function seatGraph(entry) {
  if (!fromASeat(entry) || !entry.what.numbered) return null;
  const { move, seat, numbered } = entry.what;
  return graphOf({ move, seat, numbered });
}

/**
 * The same graph, from a seat's numbered answers directly (used by the panel report,
 * which holds the answers before they are written to the record).
 *
 * @param {{move: number, seat: number, numbered: object}} seated
 */
export function graphOf({ move, seat, numbered }) {
  const moveId = `move:${move}`;
  const nodes = [{ id: moveId, kind: 'move', text: numbered.deed }];
  const edges = [];

  if (numbered.basis === 'shown') {
    const basisId = `basis:${move}:${seat}`;
    nodes.push({ id: basisId, kind: 'basis', text: numbered.pool });
    edges.push({ from: basisId, to: moveId, kind: 'justifies' });
  }

  for (const topic of numbered.topics ?? []) {
    const topicId = `topic:${topic}`;
    nodes.push({ id: topicId, kind: 'topic', text: topic });
    edges.push({ from: moveId, to: topicId, kind: 'touches' });
  }

  if (numbered.basis === 'not-shown') {
    const questionId = `question:${move}:${seat}`;
    nodes.push({ id: questionId, kind: 'question', text: numbered.sitting });
    edges.push({ from: moveId, to: questionId, kind: 'asks' });
  }

  return { move, seat, nodes, edges };
}
