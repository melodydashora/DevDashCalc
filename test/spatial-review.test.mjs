import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountSpatialReview, recordSpatialCheck, recordSpatialLesson, spatialReviewDue } from '../public/spatial-review.js';

const day = 86400000;
const start = Date.UTC(2026, 10, 24, 15);
const complete = mode => recordSpatialLesson(undefined, {
  mode, initialMode: 'diagram', switchedView: mode === '3d',
  firstPredictionCorrect: false, firstSetupCorrect: true, effort: 3, accessDifficulty: true,
}, start);
const response = { area: 8, setup: 'triangle', usedHelp: false };

test('a learner schedules the same two-week check after either view; nothing is due early', () => {
  for (const mode of ['diagram', '3d']) {
    const first = complete(mode);
    assert.equal(spatialReviewDue(first, start + 15 * day), false);
    const scheduled = { ...first, scheduled: true };
    assert.equal(spatialReviewDue(scheduled, start + 14 * day - 1), false);
    assert.equal(recordSpatialCheck(scheduled, response, start + day), scheduled);
    assert.equal(spatialReviewDue(scheduled, start + 14 * day), true);
    assert.equal(spatialReviewDue(undefined, start), false);
  }
});

test('revisiting a lesson keeps its original observation and flags the intervening practice', () => {
  const first = { ...complete('diagram'), scheduled: true };
  const repeated = recordSpatialLesson(first, { mode: '3d' }, start + 13 * day);
  assert.deepEqual(repeated.lesson, first.lesson);
  assert.equal(repeated.lastPracticeAt, start + 13 * day);
  assert.equal(spatialReviewDue(repeated, start + 14 * day), true);
});

test('incorrect, independent and assisted check results stay distinct from immediate practice and effort', () => {
  for (const [hintUsed, usedHelp, assisted] of [[false, false, false], [true, false, true], [false, true, true]]) {
    const scheduled = { ...complete('3d'), scheduled: true, hintUsed };
    const checked = recordSpatialCheck(scheduled, { area: 8, setup: 'square', usedHelp }, start + 14 * day);
    assert.deepEqual(checked.result, { checkedAt: start + 14 * day, areaCorrect: true, setupCorrect: false, assisted });
    assert.equal(checked.lesson.effort, 3);
    assert.equal(checked.lesson.accessDifficulty, true);
    assert.equal(checked.lesson.firstPredictionCorrect, false);
    assert.equal(spatialReviewDue(checked, start + 15 * day), false);
    assert.equal(recordSpatialCheck(checked, response, start + 15 * day), checked);
  }
});

test('malformed input cannot consume the one fresh question', () => {
  const record = { ...complete('3d'), scheduled: true };
  for (const invalid of [{ ...response, area: NaN }, { ...response, setup: '' }]) {
    assert.equal(recordSpatialCheck(record, invalid, start + 20 * day), record);
  }
  assert.equal(spatialReviewDue({ ...record, completedAt: Infinity }, start), false);
});

test('receiving coach guidance still counts after returning to an unanswered check', () => {
  const helped = { ...complete('diagram'), scheduled: true, hintUsed: false, coachHelp: true };
  assert.equal(recordSpatialCheck(helped, response, start + 16 * day).result.assisted, true);
});

test('the lesson links to a newly due check; only the separate review records coach help', t => {
  let when = start + 14 * day - 1;
  let record = { ...complete('diagram'), scheduled: true };
  let onDue;
  t.mock.method(globalThis, 'setTimeout', callback => { onDue = callback; });
  const adapter = { now: () => when, getRecord: () => record, setRecord: next => { record = next; } };
  const host = {
    innerHTML: '',
    insertAdjacentHTML(_, html) { this.innerHTML += html; },
    querySelector(selector) {
      const match = selector === 'form' ? '<form' : selector.slice(1);
      return this.innerHTML.includes(match) ? {} : null;
    },
    replaceChildren() { this.innerHTML = ''; },
  };
  const lesson = mountSpatialReview(host, { ...adapter, reviewOnly: false });
  assert.match(host.innerHTML, /Remove scheduled check/);
  when++;
  onDue();
  assert.match(host.innerHTML, /href="#\/cross-sections\/review"/);
  assert.doesNotMatch(host.innerHTML, /<form|right triangle/);
  lesson.markCoachHelp();
  assert.equal(record.coachHelp, undefined);
  lesson.destroy();

  const review = mountSpatialReview(host, adapter);
  assert.match(host.innerHTML, /<form/);
  review.markCoachHelp();
  assert.equal(record.coachHelp, true);
  review.destroy();
});
