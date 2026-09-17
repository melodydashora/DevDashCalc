import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPracticeRequest, practiceBuilderDefaults, PRACTICE_VARIATIONS, PRACTICE_MODEL_CHOICES } from '../public/practice-builder.js';
import { getQuestionModel } from '../public/question-models.js';

test('requests wait for the learner, identify original practice and do not promise grading credit', () => {
  const prompt = buildPracticeRequest({ subject: 'calculus-ab', topic: 'washers', goal: 'question' });
  assert.match(prompt, /AP Calculus AB/); assert.match(prompt, /Topic or skill: washers/);
  assert.match(prompt, /wait for my answer/); assert.match(prompt, /Do not reveal the answer/);
  assert.match(prompt, /original practice/); assert.match(prompt, /no official exam score or automatic mastery credit/);
});

test('substantive variation requests change reasoning rather than only names or numbers', () => {
  const prompts = PRACTICE_VARIATIONS.map(({ id }) => buildPracticeRequest({ variation: id }));
  assert.equal(new Set(prompts).size, PRACTICE_VARIATIONS.length);
  assert.match(prompts[0], /not only names or numbers/);
  assert.match(prompts[1], /translate between representations/);
  assert.match(prompts[2], /which quantity is unknown/);
  assert.match(prompts[3], /two connected reasoning steps/);
  assert.match(prompts[4], /diagnose a plausible error/);
  assert.match(prompts[5], /reworded practice item rather than a new reasoning variation/);
});

test('sets are bounded and delivered one at a time with explicit learner continuation', () => {
  assert.match(buildPracticeRequest({ goal: 'set', count: 999 }), /10 original questions, presented one at a time/);
  assert.match(buildPracticeRequest({ goal: 'set', count: -9 }), /2 original questions/);
  assert.match(buildPracticeRequest({ goal: 'set', count: NaN }), /5 original questions/);
  assert.match(buildPracticeRequest({ goal: 'set' }), /Ask before moving to the next question/);
});

test('model requests disclose preview scope and never claim to execute a new scene', () => {
  const prompt = buildPracticeRequest({ goal: 'model', model: 'solid', subject: 'physics', topic: 'springs' });
  assert.match(prompt, /3D solid-of-revolution/); assert.match(prompt, /Check whether that scope fits my topic/);
  assert.match(prompt, /does not run or replace the model/); assert.match(prompt, /do not claim that you changed the app/);
  assert.match(prompt, /wait for my answer/);
  for (const choice of PRACTICE_MODEL_CHOICES) assert.ok(getQuestionModel(choice.question), choice.id);
});

test('topic and course text remain bounded literal requests, with safe fallback choices', () => {
  const prompt = buildPracticeRequest({ courseName: 'A'.repeat(300), topic: 'B'.repeat(900), variation: 'missing', model: 'unknown' });
  assert.ok(prompt.includes('A'.repeat(160))); assert.ok(!prompt.includes('A'.repeat(161)));
  assert.ok(prompt.includes('B'.repeat(500))); assert.ok(!prompt.includes('B'.repeat(501)));
  assert.doesNotThrow(() => buildPracticeRequest({ courseName: {}, topic: null }));
});

test('course aliases, Algebra and all-course requests use subject-appropriate names and preview defaults', () => {
  assert.equal(practiceBuilderDefaults('bc').courseName, 'AP Calculus BC');
  assert.equal(practiceBuilderDefaults('ab').courseName, 'AP Calculus AB');
  assert.deepEqual(practiceBuilderDefaults('bc'), practiceBuilderDefaults('calculus-bc'));
  assert.deepEqual(practiceBuilderDefaults('ab'), practiceBuilderDefaults('calculus-ab'));
  assert.equal(practiceBuilderDefaults('algebra').courseName, 'Algebra');
  assert.equal(practiceBuilderDefaults('all').courseName, 'All courses');
  assert.equal(practiceBuilderDefaults('algebra').model, 'linear');
  assert.equal(getQuestionModel(PRACTICE_MODEL_CHOICES.find(choice => choice.id === 'linear').question).kind, 'linear');
  for (const subject of ['sat', 'algebra', 'all', 'physics']) assert.doesNotMatch(practiceBuilderDefaults(subject).topicPlaceholder, /disk|washer/);
  const prompt = buildPracticeRequest({ subject: 'algebra', goal: 'model' });
  assert.match(prompt, /Help me practice Algebra/);
  assert.match(prompt, /linear function graph/);
  assert.doesNotMatch(prompt, /solid-of-revolution|my selected course/);
});
