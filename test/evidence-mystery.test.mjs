import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MYSTERY_CASES, createMysteryState, transitionMystery, checkMysteryAnswer } from '../public/evidence-mystery.js';

test('every case has evidence, inference and grammar with specific feedback for each choice', () => {
  assert.equal(MYSTERY_CASES.length, 3);
  for (const item of MYSTERY_CASES) {
    assert.deepEqual(item.stages.map((stage) => stage.kind), ['Evidence', 'Inference', 'Grammar']);
    for (const stage of item.stages) {
      assert.equal(stage.choices.length, 4); assert.equal(new Set(stage.choices).size, 4);
      assert.equal(stage.feedback.length, 4); assert.ok(stage.feedback.every((value) => value.length > 20));
      assert.ok(stage.evidence && stage.hint && stage.explanation);
    }
  }
});

test('selecting or checking a wrong clue cannot advance; correct check still waits for Next', () => {
  const initial = createMysteryState('observatory');
  assert.equal(transitionMystery(initial, { type: 'next' }), initial);
  const selected = transitionMystery(initial, { type: 'select', index: 0 });
  assert.equal(selected.solved, false); assert.equal(selected.stageIndex, 0);
  const wrong = transitionMystery(selected, { type: 'check' });
  assert.equal(wrong.solved, false); assert.equal(wrong.feedback.correct, false);
  assert.equal(transitionMystery(wrong, { type: 'next' }), wrong);
  const corrected = transitionMystery(transitionMystery(wrong, { type: 'select', index: 1 }), { type: 'check' });
  assert.equal(corrected.solved, true); assert.equal(corrected.stageIndex, 0); assert.equal(corrected.completed.length, 0);
  const next = transitionMystery(corrected, { type: 'next' });
  assert.equal(next.stageIndex, 1); assert.equal(next.selectedIndex, null); assert.equal(next.solved, false);
});

test('hints and worked explanations mark help but cannot unlock a clue', () => {
  const initial = createMysteryState('gallery-clock');
  const helped = transitionMystery(transitionMystery(initial, { type: 'hint' }), { type: 'solution' });
  assert.equal(helped.helped, true); assert.equal(helped.showHint, true); assert.equal(helped.showSolution, true);
  assert.equal(helped.solved, false); assert.equal(transitionMystery(helped, { type: 'next' }), helped);
  const checked = transitionMystery(transitionMystery(helped, { type: 'select', index: 2 }), { type: 'check' });
  const next = transitionMystery(checked, { type: 'next' });
  assert.deepEqual(next.completed, [{ stageIndex: 0, helped: true }]); assert.equal(next.helped, false);
});

test('finishing requires all three explicit checks and transitions; restarting isolates progress', () => {
  let state = createMysteryState('encoded-label');
  for (const answer of [1, 0, 3]) {
    state = transitionMystery(state, { type: 'select', index: answer });
    state = transitionMystery(state, { type: 'check' });
    assert.equal(state.done, false);
    state = transitionMystery(state, { type: 'next' });
  }
  assert.equal(state.done, true); assert.equal(state.completed.length, 3);
  assert.equal(transitionMystery(state, { type: 'next' }), state);
  assert.deepEqual(transitionMystery(state, { type: 'restart' }), createMysteryState('encoded-label'));
  assert.equal(createMysteryState('gallery-clock').completed.length, 0);
});

test('invalid answer values cannot pass and unknown cases fail explicitly', () => {
  for (const value of [null, '1', -1, 4, 1.5, NaN]) assert.equal(checkMysteryAnswer('observatory', 0, value), null);
  assert.equal(checkMysteryAnswer('missing', 0, 0), null);
  assert.throws(() => createMysteryState('missing'));
  assert.throws(() => transitionMystery({ caseId: 'observatory', stageIndex: 99 }, { type: 'next' }));
});
