import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePracticeEvidence, summarizePracticeHistory } from '../practice-history.js';
const attempt = extra => ({ attemptId: 'a-1', topicId: 'sat-linear', subject: 'sat', difficulty: 2,
  templateId: 'linear', variantId: 'equation', correct: true, assisted: false, misconceptionTag: null, at: '2026-09-17T10:00:00Z', isReview: false, ...extra });

test('only bounded canonical observations are retained, with no question key or prompt', () => {
  const safe = normalizePracticeEvidence(attempt({ numericAnswer: 7, answerIndex: 1, prompt: 'private', parameters: { x: 7 }, profileId: 'another' }));
  assert.doesNotMatch(JSON.stringify(safe), /numericAnswer|answerIndex|parameters|private|another/);
  assert.throws(() => normalizePracticeEvidence(attempt({ correct: 'true' })));
  assert.throws(() => normalizePracticeEvidence(attempt({ at: 'not a date' })));
  assert.throws(() => normalizePracticeEvidence(attempt({ topicId: '../escape' })));
});
test('replayed answers count once and late assistance can only remove independence', () => {
  const events = [attempt(), attempt(), attempt({ assisted: true }), attempt()];
  const result = summarizePracticeHistory(events);
  assert.equal(result.retainedCount, 1); assert.equal(result.topics[0].attempts, 1);
  assert.equal(result.topics[0].independentCorrect, 0); assert.equal(result.topics[0].withHelp, 1);
});
test('review attempts are separate from fresh evidence and mistakes retain named patterns', () => {
  const result = summarizePracticeHistory([attempt(), attempt({ attemptId: 'a-2', isReview: true }), attempt({ attemptId: 'a-3', correct: false, misconceptionTag: 'sign-error' })]);
  const topic = result.topics[0];
  assert.equal(topic.attempts, 3); assert.equal(topic.independentCorrect, 1); assert.equal(topic.reviews, 1); assert.equal(topic.incorrect, 1);
  assert.deepEqual(topic.misconceptionCounts, { 'sign-error': 1 });
  assert.doesNotMatch(JSON.stringify(result), /predictedScore|masteryScore|diagnosisCode/);
});
test('later-day suggestions use the latest fresh evidence and never a repeated review', () => {
  const now = Date.parse('2026-09-19T12:00:00Z');
  const result = summarizePracticeHistory([
    attempt({ correct: false }),
    attempt({ attemptId: 'a-2', isReview: true, at: '2026-09-19T11:00:00Z' }),
    attempt({ attemptId: 'b-1', topicId: 'algebra-linear', subject: 'algebra', at: '2026-09-18T10:00:00Z' }),
  ], now);
  const sat = result.topics.find(t => t.subject === 'sat'), algebra = result.topics.find(t => t.subject === 'algebra');
  assert.equal(sat.reviewAfter, '2026-09-18T10:00:00.000Z'); assert.equal(sat.reviewDue, true);
  assert.equal(algebra.reviewAfter, '2026-09-21T10:00:00.000Z'); assert.equal(algebra.reviewDue, false);
});
