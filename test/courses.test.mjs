import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeSubjectId, unitsForSubject, unitForSubject, courseMatchesSubject, BC_ONLY_SKILL_IDS } from '../public/courses.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../content/manifest.json', import.meta.url)));
const units = manifest.units.map((meta) => JSON.parse(fs.readFileSync(new URL(`../content/${meta.file}`, import.meta.url))));

test('BC is the default and includes all ten units; AB includes eight; Physics has no calculus curriculum', () => {
  assert.equal(normalizeSubjectId(undefined), 'calculus-bc');
  assert.equal(normalizeSubjectId('unknown'), 'calculus-bc');
  assert.equal(unitsForSubject(manifest).length, 10);
  assert.equal(unitsForSubject(manifest, 'calculus-ab').length, 8);
  assert.equal(unitsForSubject(manifest, 'physics').length, 0);
  assert.equal(unitsForSubject(manifest, 'all').length, 10);
  assert.equal(unitForSubject(units[8], 'calculus-ab'), null);
  assert.equal(unitForSubject(units[9], 'calculus-ab'), null);
  assert.equal(unitForSubject(units[0], 'physics'), null);
});

test('AB filters BC-only skills, lessons, checkpoints, and mastery without changing original content', () => {
  const before = JSON.stringify(units);
  for (const unit of units.slice(0, 8)) {
    const withMastery = { ...unit, masteryQuestions: unit.skills.map((s) => ({ id: `m-${s.id}`, skillId: s.id })) };
    const ab = unitForSubject(withMastery, 'calculus-ab');
    assert.ok(ab.skills.every((s) => !BC_ONLY_SKILL_IDS.includes(s.id)));
    assert.ok(ab.questions.every((q) => ab.skills.some((s) => s.id === q.skillId)));
    assert.ok(ab.masteryQuestions.every((q) => ab.skills.some((s) => s.id === q.skillId)));
    for (const lesson of ab.lessons) {
      assert.ok(lesson.skillIds.every((id) => ab.skills.some((s) => s.id === id)));
      for (const section of lesson.sections.filter((s) => s.type === 'checkpoint')) {
        assert.ok(section.questionIds.length);
        assert.ok(section.questionIds.every((id) => ab.questions.some((q) => q.id === id)));
      }
    }
    assert.match(ab.examWeight, /AB multiple choice/);
    assert.equal(unitForSubject(unit, 'calculus-bc'), unit, 'BC retains every original topic');
  }
  assert.equal(JSON.stringify(units), before);
});

test('the mixed exponential/logistic lesson keeps its full exponential example and checkpoint for AB', () => {
  const ab = unitForSubject(units[6], 'calculus-ab');
  const lesson = ab.lessons.find((l) => l.id === 'u7-l5');
  assert.deepEqual(lesson.skillIds, ['u7-exponential-models']);
  assert.deepEqual(lesson.sections.map((s) => s.type), ['concept', 'worked-example', 'checkpoint']);
  assert.match(lesson.sections[1].title, /half-life/);
  assert.doesNotMatch(JSON.stringify(lesson), /logistic|Euler/);
  assert.doesNotMatch(ab.overview, /logistic|Euler|BC exam/);
});

test('Canvas subject matching distinguishes explicit AB/BC and handles unqualified calculus and physics', () => {
  const match = (name, subject, courseCode = '') => courseMatchesSubject({ name, courseCode }, subject);
  assert.equal(match('AP Calculus BC', 'calculus-bc'), true);
  assert.equal(match('AP Calculus AB', 'calculus-bc'), false);
  assert.equal(match('AP Calculus BC', 'calculus-ab'), false);
  assert.equal(match('AP Calculus AB', 'calculus-ab'), true);
  assert.equal(match('Calculus AB/BC', 'calculus-bc'), true);
  assert.equal(match('Calculus', 'calculus-ab'), true);
  assert.equal(match('Calculus', 'calculus-bc'), true);
  assert.equal(match('Period 2', 'calculus-bc', 'CALC-BC'), true);
  assert.equal(match('AP Physics 1', 'physics'), true);
  assert.equal(match('Period 3', 'physics', 'PHYS'), true);
  assert.equal(match('Chemistry', 'physics'), false);
  assert.equal(match('Chemistry', 'all'), true);
});
