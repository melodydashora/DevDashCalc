import test from 'node:test';
import assert from 'node:assert/strict';
import { coachRequestTarget } from '../public/coach-intent.js';

test('exercise follow-ups keep canonical question context instead of matching isolated school words', () => {
  for (const message of ['Is the change due to acceleration?', 'What does the schedule in this question tell me?', 'Why is my answer wrong?', 'Can you explain that in smaller steps?']) {
    assert.equal(coachRequestTarget(message, { hasQuestion: true }), 'question', message);
  }
});
test('clear portal and memory requests can use the student portal during practice', () => {
  for (const message of ['What is due tomorrow?', 'Help with my study plan', 'What should I study next?', 'What do you remember about me?', 'Open my classes', 'Find my saved notes']) {
    assert.equal(coachRequestTarget(message, { hasQuestion: true }), 'study', message);
  }
  assert.equal(coachRequestTarget('Explain this lesson'), 'study');
  assert.equal(coachRequestTarget('Make a practice question', { hasQuestion: true, hasCourseReference: true }), 'study');
});
