import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeCourseGroups, courseTimeStatus, currentHomeTermIds, canvasRefreshDue } from '../public/student-home.js';
const now = Date.parse('2026-09-14T18:00:00Z');
const current = { id: '347', startAt: '2026-08-11T00:00:00Z', endAt: '2027-05-15T00:00:00Z' };
test('the student home includes all current subjects and keeps previous physics out of current classes', () => {
  const courses = [
    { id: '1', name: 'AP Biology', term: current, assignments: [] },
    { id: '2', name: 'AP Calculus AB', term: current, assignments: [{ dueAt: null }] },
    { id: '3', name: 'AP Physics last year', term: { endAt: '2026-05-15T00:00:00Z' } },
    { id: '4', name: 'School announcements', term: { id: '1' } },
    { id: '5', name: 'Next term', term: { startAt: '2027-08-01T00:00:00Z' } },
  ];
  const before = structuredClone(courses);
  const grouped = homeCourseGroups({ courses }, now);
  assert.deepEqual(grouped.current.map(c => c.id), ['1', '2']);
  assert.deepEqual(grouped.past.map(c => c.id), ['3']);
  assert.deepEqual(grouped.unknown.map(c => c.id), ['4']);
  assert.deepEqual(grouped.upcoming.map(c => c.id), ['5']);
  assert.deepEqual(courses, before);
});
test('yearly and semester terms can both be current without assigning undated courses to either', () => {
  assert.deepEqual(currentHomeTermIds([current, { id: '348', startAt: '2026-09-01', endAt: '2026-12-31' }, { id: '1' }], now), ['347', '348']);
  assert.equal(courseTimeStatus({ term: { startAt: 'invalid', endAt: 'invalid' } }, now), 'unknown');
  assert.equal(courseTimeStatus({ term: { startAt: '2027-01-01', endAt: '2026-01-01' } }, now), 'unknown');
});
test('refresh is due for a missing or five-minute-old snapshot, not after every UI update', () => {
  assert.equal(canvasRefreshDue(null, now), true);
  assert.equal(canvasRefreshDue(new Date(now - 299999).toISOString(), now), false);
  assert.equal(canvasRefreshDue(new Date(now - 300000).toISOString(), now), true);
});
