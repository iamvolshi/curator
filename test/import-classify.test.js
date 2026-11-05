import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMessage, extractDate } from '../import/classify.js';

// Wednesday 4 November 2026: "tomorrow" is the 5th, "Friday" is the 6th.
const NOW = new Date('2026-11-04T12:00:00Z');

test('classify: an appointment with a future date is scheduled', () => {
  const result = classifyMessage({ text: "Let's meet for coffee on Saturday at 10" }, { now: NOW });
  assert.equal(result.type, 'appointment');
  assert.equal(result.status, 'scheduled');
  assert.equal(result.date, '2026-11-07');
});

test('classify: an invitation with a future date is scheduled', () => {
  const result = classifyMessage({ text: "You're invited to the gallery opening next Friday evening" }, { now: NOW });
  assert.equal(result.type, 'invitation');
  assert.equal(result.status, 'scheduled');
  assert.equal(result.date, '2026-11-13');
});

test('classify: a contact request with no date is pending', () => {
  const result = classifyMessage({ text: 'Great to connect here. I would love an intro to anyone hiring.' }, { now: NOW });
  assert.equal(result.type, 'contact-request');
  assert.equal(result.status, 'pending');
  assert.equal(result.date, null);
});

test('classify: a commitment with a date is scheduled; without one it is pending', () => {
  const dated = classifyMessage({ text: "I'll send you the slides by Friday, promise" }, { now: NOW });
  assert.equal(dated.type, 'commitment');
  assert.equal(dated.status, 'scheduled');
  assert.equal(dated.date, '2026-11-06');

  const undated = classifyMessage({ text: "I'll think of who fits and get back to you" }, { now: NOW });
  assert.equal(undated.type, 'commitment');
  assert.equal(undated.status, 'pending');
});

test('classify: plain chat with no hook is other / pending', () => {
  const result = classifyMessage({ text: 'That poster mockup looks great, love the colours' }, { now: NOW });
  assert.equal(result.type, 'other');
  assert.equal(result.status, 'pending');
});

test('classify: done wording wins — the thing already happened', () => {
  const result = classifyMessage({ text: 'Had a great time at the market today, thanks for coming' }, { now: NOW });
  assert.equal(result.status, 'done');
  const sent = classifyMessage({ text: 'Done — sent it this morning' }, { now: NOW });
  assert.equal(sent.status, 'done');
});

test('classify: a named date in the past is done', () => {
  const result = classifyMessage({ text: 'We met for lunch on 12 October, went well' }, { now: NOW });
  assert.equal(result.status, 'done');
  assert.equal(result.date, '2026-10-12');
});

test('classify: an Invitations.csv row is a contact-request even with flat text', () => {
  const result = classifyMessage({ text: 'Hello, I would like to connect.', context: 'invitation' }, { now: NOW });
  assert.equal(result.type, 'contact-request');
});

test('classify: a Connections.csv row is done — the connection already exists', () => {
  const result = classifyMessage({ text: 'Connected on LinkedIn with Priya Nair', context: 'connection' }, { now: NOW });
  assert.equal(result.type, 'contact-request');
  assert.equal(result.status, 'done');
});

test('extractDate: tomorrow, today, weekdays, named and numeric dates', () => {
  assert.equal(extractDate('see you tomorrow', NOW), '2026-11-05');
  assert.equal(extractDate('call today at 3', NOW), '2026-11-04');
  assert.equal(extractDate('coffee on Friday', NOW), '2026-11-06');
  assert.equal(extractDate('gallery opening next Friday', NOW), '2026-11-13');
  assert.equal(extractDate('lunch on Saturday', NOW), '2026-11-07');
  assert.equal(extractDate('the launch is 12 November', NOW), '2026-11-12');
  assert.equal(extractDate('the launch is November 12', NOW), '2026-11-12');
  assert.equal(extractDate('deadline 2026-11-20', NOW), '2026-11-20');
  assert.equal(extractDate('meet on 12/11/2026', NOW), '2026-11-12');
  // A weekday named on its own day means next week, not today.
  assert.equal(extractDate('see you Wednesday', NOW), '2026-11-11');
});

test('extractDate: a bare time is not a date — uncertain stays pending', () => {
  assert.equal(extractDate('call at 3, let me know', NOW), null);
  assert.equal(extractDate('no date in this message at all', NOW), null);
  const result = classifyMessage({ text: 'call at 3, let me know' }, { now: NOW });
  assert.equal(result.status, 'pending');
});
