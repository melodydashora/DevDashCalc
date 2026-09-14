import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../public/engine.js';

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const makeUnit = () => ({
  id: 'unit-01',
  number: 1,
  title: 'Test Unit',
  skills: [
    { id: 'u1-a', name: 'Skill A', core: true },
    { id: 'u1-b', name: 'Skill B', core: true },
    { id: 'u1-c', name: 'Skill C', core: false },
  ],
  questions: [
    // 6 questions per core skill spread over difficulties, 2 for the extra skill
    ...['u1-a', 'u1-b'].flatMap((sid, si) =>
      [1, 1, 2, 2, 3, 3].map((d, i) => ({
        id: `u1-q${si}${i}0`.padEnd(7, '0').slice(0, 7), // unique-ish ids
        skillId: sid, difficulty: d, type: 'mc',
        prompt: 'p', choices: ['a', 'b', 'c'], answerIndex: 0,
        misconceptions: [null, 'm', 'm'],
        hints: ['h1', 'h2'], solution: [{ text: 's1' }, { text: 's2' }],
      }))),
    { id: 'u1-qc1', skillId: 'u1-c', difficulty: 1, type: 'numeric', prompt: 'p', answer: 0.5, hints: ['h1', 'h2'], solution: [{ text: 's1' }, { text: 's2' }] },
    { id: 'u1-qc2', skillId: 'u1-c', difficulty: 2, type: 'numeric', prompt: 'p', answer: 2, hints: ['h1', 'h2'], solution: [{ text: 's1' }, { text: 's2' }] },
  ],
  masteryQuestions: ['u1-a', 'u1-b'].flatMap((skillId, si) =>
    [2, 2, 3, 3].map((difficulty, i) => ({ id: `mastery-${si}-${i}`, skillId, difficulty, type: 'mc' }))),
  masteryCheck: { questionCount: 4, passCount: 4 },
});

const manifest = { units: [
  { id: 'unit-01', number: 1 }, { id: 'unit-02', number: 2 }, { id: 'unit-03', number: 3 },
] };

function answerN(state, skillId, n, { correct = true, hintsUsed = 0, difficulty = 2, qid = 'q' } = {}) {
  for (let i = 0; i < n; i++) {
    E.recordAnswer(state, { skillId, questionId: `${qid}${i}`, correct, hintsUsed, difficulty, now: NOW + i });
  }
}

test('mastery grows with clean correct answers and reaches threshold in ~5', () => {
  const s = E.newState();
  answerN(s, 'u1-a', 4, { difficulty: 2 });
  assert.ok(E.masteryScore(s, 'u1-a') < E.MASTERY_THRESHOLD, 'not mastered after 4');
  answerN(s, 'u1-a', 1, { difficulty: 2, qid: 'q5-' });
  assert.ok(E.masteryScore(s, 'u1-a') >= E.MASTERY_THRESHOLD, 'mastered after 5');
  assert.ok(E.isMastered(s, 'u1-a'));
});

test('hints give half credit — hint-only answering cannot reach mastery', () => {
  const s = E.newState();
  answerN(s, 'u1-a', 20, { hintsUsed: 1, difficulty: 2 });
  // EWMA converges to 0.5 -> score 50
  assert.ok(E.masteryScore(s, 'u1-a') <= 55);
  assert.ok(!E.isMastered(s, 'u1-a'));
});

test('difficulty-1-only correct answers are capped below mastery', () => {
  const s = E.newState();
  answerN(s, 'u1-a', 12, { difficulty: 1 });
  assert.equal(E.masteryScore(s, 'u1-a'), E.MASTERY_THRESHOLD - 10, 'capped at threshold-10');
  // one recent correct at difficulty 2 lifts the cap
  E.recordAnswer(s, { skillId: 'u1-a', questionId: 'qx', correct: true, hintsUsed: 0, difficulty: 2, now: NOW + 100 });
  assert.ok(E.masteryScore(s, 'u1-a') >= E.MASTERY_THRESHOLD);
});

test('wrong answers lower mastery and the difficulty ladder moves both ways', () => {
  const s = E.newState();
  answerN(s, 'u1-a', 6, { difficulty: 2 });
  const before = E.masteryScore(s, 'u1-a');
  assert.equal(s.skills['u1-a'].difficulty, 3, 'ladder tops out at 3');
  E.recordAnswer(s, { skillId: 'u1-a', questionId: 'qw', correct: false, hintsUsed: 0, difficulty: 3, now: NOW + 50 });
  assert.ok(E.masteryScore(s, 'u1-a') < before, 'score drops on wrong answer');
  assert.equal(s.skills['u1-a'].difficulty, 2, 'ladder steps down on wrong answer');
  E.recordAnswer(s, { skillId: 'u1-a', questionId: 'qh', correct: true, hintsUsed: 2, difficulty: 2, now: NOW + 51 });
  assert.equal(s.skills['u1-a'].difficulty, 1, 'correct via 2+ hints also steps down');
});

test('all existing units are open from a fresh state; invalid unit numbers stay unavailable', () => {
  const s = E.newState();
  for (const unit of manifest.units) assert.ok(E.unitUnlocked(s, manifest, unit.number));
  for (const invalid of [-1, 0, 4, NaN, '1']) assert.equal(E.unitUnlocked(s, manifest, invalid), false);
  assert.deepEqual(s.unitsPassed, {}, 'opening modules never fabricates a mastery pass');
});

test('mastery scores recommend a check; a complete bank makes it accessible immediately', () => {
  const unit = makeUnit();
  const s = E.newState();
  assert.ok(E.masteryCheckEligible(s, unit), 'no score gate');
  assert.ok(!E.masteryRecommended(s, unit));
  answerN(s, 'u1-a', 6, { difficulty: 2 });
  assert.ok(!E.masteryRecommended(s, unit), 'one core skill is not enough for recommendation');
  answerN(s, 'u1-b', 6, { difficulty: 2, qid: 'qb' });
  assert.ok(E.masteryRecommended(s, unit), 'both core skills mastered; extra skill u1-c ignored');
});

test('recordMasteryCheck records a pass exactly at passCount', () => {
  const unit = makeUnit();
  const s = E.newState();
  assert.equal(E.recordMasteryCheck(s, unit, 3, 4, NOW), false);
  assert.ok(!s.unitsPassed['unit-01']);
  assert.equal(E.recordMasteryCheck(s, unit, 4, 4, NOW), true);
  assert.ok(s.unitsPassed['unit-01']);
  const pass = { ...s.unitsPassed['unit-01'] };
  for (const [correct, total] of [[4, 3], [5, 4], [-1, 4], [3.5, 4], [4, NaN], [4, 5]]) {
    assert.equal(E.recordMasteryCheck(s, unit, correct, total, NOW + 100), false);
  }
  assert.equal(E.recordMasteryCheck(s, unit, 0, 4, NOW + 100), false);
  assert.deepEqual(s.unitsPassed['unit-01'], pass, 'invalid or failed attempts preserve an earned pass');
});

test('pickPracticeQuestion targets the weakest skill at its ladder difficulty and avoids repeats', () => {
  const unit = makeUnit();
  const s = E.newState();
  answerN(s, 'u1-a', 5, { difficulty: 2 }); // A mastered, B untouched (weakest core)
  const q1 = E.pickPracticeQuestion(s, unit, []);
  assert.equal(q1.skillId, 'u1-b', 'weakest core skill first');
  assert.equal(q1.difficulty, 1, 'untouched skill starts at ladder difficulty 1');
  const q2 = E.pickPracticeQuestion(s, unit, [q1.id]);
  assert.notEqual(q2.id, q1.id, 'recent ids are excluded');
});

test('sampleMasteryCheck: difficulty >= 2, core skills only, spread across skills', () => {
  const unit = makeUnit();
  let seed = 42;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const sample = E.sampleMasteryCheck(unit, rand);
  assert.equal(sample.length, 4);
  assert.ok(sample.every((q) => q.difficulty >= 2), 'all difficulty >= 2');
  assert.ok(sample.every((q) => q.skillId !== 'u1-c'), 'non-core excluded');
  const bySkill = new Set(sample.map((q) => q.skillId));
  assert.equal(bySkill.size, 2, 'round-robin covers both core skills');
  assert.equal(new Set(sample.map((q) => q.id)).size, 4, 'no duplicate questions');
  assert.ok(sample.every((q) => unit.masteryQuestions.includes(q)), 'dedicated bank only');
  assert.ok(sample.every((q) => !unit.questions.some((p) => p.id === q.id)), 'no practice ids');
});

test('incomplete or duplicate mastery banks never fall back to practice or return a short check', () => {
  const unit = makeUnit();
  for (const bank of [[], unit.masteryQuestions.slice(0, 3), Array(8).fill(unit.masteryQuestions[0]), unit.questions]) {
    unit.masteryQuestions = bank;
    assert.equal(E.masteryCheckEligible(E.newState(), unit), false);
    assert.deepEqual(E.sampleMasteryCheck(unit), []);
  }
  delete unit.masteryQuestions;
  assert.deepEqual(E.sampleMasteryCheck(unit), [], 'legacy practice items do not become mastery questions');
});

test('explicit inline mastery bank is excluded from every practice selection', () => {
  const unit = makeUnit();
  unit.questions.push(...unit.masteryQuestions.map((q) => ({ ...q, bank: 'mastery' })));
  delete unit.masteryQuestions;
  const state = E.newState();
  assert.equal(E.sampleMasteryCheck(unit).length, 4);
  const recent = [];
  let question;
  while ((question = E.pickPracticeQuestion(state, unit, recent))) {
    assert.notEqual(question.bank, 'mastery');
    recent.push(question.id);
  }
  assert.equal(recent.length, unit.questions.filter((q) => q.bank !== 'mastery').length);
});

test('mastery retakes prefer unseen questions while still covering each core skill', () => {
  const unit = makeUnit();
  const state = E.newState();
  const first = E.sampleMasteryCheck(unit, () => 0.5, state);
  for (const q of first) E.recordAnswer(state, { skillId: q.skillId, questionId: q.id, correct: true, hintsUsed: 0, difficulty: q.difficulty, now: NOW });
  const second = E.sampleMasteryCheck(unit, () => 0.5, state);
  assert.equal(second.length, 4);
  assert.ok(second.every((q) => !first.some((seen) => seen.id === q.id)));
  assert.equal(new Set(second.map((q) => q.skillId)).size, 2);
});

test('diagnostic placement seeds mastery, marks units passed, and never lowers progress', () => {
  const unit = makeUnit();
  const s = E.newState();
  answerN(s, 'u1-a', 10, { difficulty: 3 }); // already very strong
  const strongBefore = s.skills['u1-a'].ewma;
  E.applyDiagnosticPlacement(s, 1, [unit], NOW);
  assert.ok(s.diagnostic.completed);
  assert.equal(s.diagnostic.placedThroughUnit, 1);
  assert.ok(s.unitsPassed['unit-01'].byPlacement);
  assert.ok(E.isMastered(s, 'u1-b'), 'core skill seeded to mastery');
  assert.ok(s.skills['u1-a'].ewma >= strongBefore, 'existing strong skill not lowered');
  assert.ok(!s.skills['u1-c'], 'non-core skills are not seeded');
});

test('reviewQueue: mastered skills go stale after N days, oldest first, and never include unmastered', () => {
  const unit = makeUnit();
  const s = E.newState();
  answerN(s, 'u1-a', 6, { difficulty: 2 });
  answerN(s, 'u1-b', 6, { difficulty: 2, qid: 'qb' });
  s.skills['u1-a'].lastSeen = NOW - 5 * DAY;
  s.skills['u1-b'].lastSeen = NOW - 10 * DAY;
  answerN(s, 'u1-c', 1, { correct: false, qid: 'qc' }); // unmastered
  s.skills['u1-c'].lastSeen = NOW - 30 * DAY;
  const due = E.reviewQueue(s, [unit], NOW, 3);
  assert.deepEqual(due.map((d) => d.skill.id), ['u1-b', 'u1-a'], 'oldest first, unmastered excluded');
  assert.equal(E.reviewQueue(s, [unit], NOW, 30).length, 0, 'nothing due with a long window');
});

test('parseNumericInput handles integers, decimals, fractions, junk', () => {
  assert.equal(E.parseNumericInput('7'), 7);
  assert.equal(E.parseNumericInput(' -1.5 '), -1.5);
  assert.equal(E.parseNumericInput('3/4'), 0.75);
  assert.equal(E.parseNumericInput('-3/4'), -0.75);
  assert.equal(E.parseNumericInput('1/0'), null);
  assert.equal(E.parseNumericInput('pi'), null);
  assert.equal(E.parseNumericInput(''), null);
});

test('gradeAnswer: mc misconceptions and numeric tolerance', () => {
  const mc = { type: 'mc', answerIndex: 1, misconceptions: ['wrong-a', null, 'wrong-c'] };
  assert.deepEqual(E.gradeAnswer(mc, 1), { correct: true, misconception: null });
  assert.deepEqual(E.gradeAnswer(mc, 2), { correct: false, misconception: 'wrong-c' });
  const num = { type: 'numeric', answer: 0.333, tolerance: 0.001 };
  assert.ok(E.gradeAnswer(num, '1/3').correct, 'fraction within tolerance');
  assert.ok(!E.gradeAnswer(num, '0.34').correct, 'outside tolerance');
  assert.ok(E.gradeAnswer(num, 'x').unparsed, 'junk flagged as unparsed, not wrong');
});

test('event history is capped so state stays small', () => {
  const s = E.newState();
  answerN(s, 'u1-a', 50, { difficulty: 2 });
  assert.equal(s.skills['u1-a'].events.length, E.EVENT_CAP);
});

test('wrong multiple-choice picks are counted per question and never affect scoring', () => {
  const a = E.newState(), b = E.newState();
  E.recordAnswer(a, { skillId: 'u1-a', questionId: 'q1', correct: false, hintsUsed: 0, difficulty: 2, now: NOW, choice: 1 });
  E.recordAnswer(b, { skillId: 'u1-a', questionId: 'q1', correct: false, hintsUsed: 0, difficulty: 2, now: NOW });
  assert.equal(E.masteryScore(a, 'u1-a'), E.masteryScore(b, 'u1-a'));
  assert.equal(a.skills['u1-a'].difficulty, b.skills['u1-a'].difficulty);
  E.recordAnswer(a, { skillId: 'u1-a', questionId: 'q1', correct: false, hintsUsed: 0, difficulty: 2, now: NOW + 1, choice: 1 });
  E.recordAnswer(a, { skillId: 'u1-a', questionId: 'q1', correct: true, hintsUsed: 0, difficulty: 2, now: NOW + 2, choice: 0 });
  assert.deepEqual(a.seenQuestions.q1.wrongChoices, { 1: 2 }); // correct picks are not counted
  assert.equal(b.seenQuestions.q1.wrongChoices, undefined);     // numeric answers record no choice
});

test('questionHistory, skillHistory, and unitPatterns name repeated errors', () => {
  const unit = makeUnit();
  const state = E.newState();
  const q = unit.questions[0]; // skill u1-a, choices a/b/c, answer 0
  assert.deepEqual(E.questionHistory(state, q), { attempts: 0, correctCount: 0, wrongCount: 0, priorWrongChoices: [] });
  assert.deepEqual(E.unitPatterns(state, unit), { repeated: [], skills: [] });

  E.recordAnswer(state, { skillId: q.skillId, questionId: q.id, correct: false, hintsUsed: 0, difficulty: q.difficulty, now: NOW, choice: 2 });
  E.recordAnswer(state, { skillId: q.skillId, questionId: q.id, correct: false, hintsUsed: 1, difficulty: q.difficulty, now: NOW + 1, choice: 2 });
  E.recordAnswer(state, { skillId: q.skillId, questionId: q.id, correct: false, hintsUsed: 0, difficulty: q.difficulty, now: NOW + 2, choice: 1 });
  E.recordAnswer(state, { skillId: q.skillId, questionId: q.id, correct: true, hintsUsed: 2, difficulty: q.difficulty, now: NOW + 3, choice: 0 });

  const qh = E.questionHistory(state, q);
  assert.equal(qh.attempts, 4);
  assert.equal(qh.wrongCount, 3);
  assert.deepEqual(qh.priorWrongChoices.map((c) => [c.index, c.count, c.misconception]), [[2, 2, 'm'], [1, 1, 'm']]);

  const sh = E.skillHistory(state, q.skillId);
  assert.equal(sh.recentTotal, 4);
  assert.equal(sh.recentWrong, 3);
  assert.equal(sh.recentWithHints, 1);
  assert.equal(sh.score, E.masteryScore(state, q.skillId));

  const p = E.unitPatterns(state, unit);
  assert.equal(p.repeated.length, 1);
  assert.equal(p.repeated[0].question.id, q.id);
  assert.deepEqual(p.repeated[0].choices.map((c) => c.index), [2]); // only the choice picked twice
  assert.equal(p.skills.length, 1);
  assert.equal(p.skills[0].skill.id, q.skillId);
  assert.equal(E.skillHistory(state, 'never-seen').recentTotal, 0);
});
