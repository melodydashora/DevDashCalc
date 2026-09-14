import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeCoachHref, coachContextLabel, coachConversationScope, coachSourceDetail } from '../public/page-coach.js';

test('coach links allow known study destinations without accepting arbitrary hash commands', () => {
  for (const href of ['#/home', '#/focus', '#/review', '#/settings', '#/diagnostic', '#/canvas', '#/canvas/plan', '#/canvas/grades', '#/canvas/assessment', '#/canvas/course/123', '#/unit/unit-09', '#/practice/unit-09', '#/mastery/unit-09', '#/lesson/unit-09/u9-l1']) {
    assert.equal(safeCoachHref(href), href);
  }
  for (const href of ['#/settings/erase', '#/unknown', '#/unit/a/../../settings', '#/lesson/unit-09', '#/canvas/course/not-a-course', '#/focus?execute=1', '#/practice/unit-09#anything']) {
    assert.equal(safeCoachHref(href), null, href);
  }
});

test('external coach links require HTTPS and reject credentials, script URLs, and relative URLs', () => {
  assert.equal(safeCoachHref('https://school.example/courses/42?module_item_id=123'), 'https://school.example/courses/42?module_item_id=123');
  for (const href of ['javascript:alert(1)', 'data:text/html,x', 'file:///C:/secret', '//evil.example', 'https://user:pass@example.com', 'http://example.com', '/api/coach', ' https://example.com', 'https://example.com ', '']) {
    assert.equal(safeCoachHref(href), null, href);
  }
  for (const href of [null, undefined, 12, {}, 'https://example.com/' + 'x'.repeat(2048)]) assert.equal(safeCoachHref(href), null);
});

test('page context captions distinguish BC, AB, Physics, and each active activity', () => {
  assert.equal(coachContextLabel({ route: '#/mastery/unit-09', subject: 'calculus-bc' }), 'Mastery check · AP Calculus BC');
  assert.equal(coachContextLabel({ route: '#/practice/unit-01', subject: 'calculus-ab' }), 'Practice question · AP Calculus AB');
  assert.equal(coachContextLabel({ route: '#/canvas/plan', subject: 'physics' }), 'Canvas · Physics');
  assert.equal(coachContextLabel({ route: '#/focus', subject: 'all' }), 'Study session · All courses');
  assert.equal(coachContextLabel({ route: '#/unexpected', subject: 'unknown' }), 'Current page');
  assert.equal(coachContextLabel({ title: 'A school task', route: '#/canvas/plan' }), 'A school task');
  assert.equal(coachContextLabel({ title: 'x'.repeat(200) }).length, 120);
});

test('coach conversation scope follows course/subject and isolates each active question', () => {
  const context = { route: '#/home', subject: 'calculus-bc', selectedCourseId: 42 };
  assert.equal(coachConversationScope(context), coachConversationScope({ ...context, route: '#/canvas/plan', selectedCourseId: '42' }), 'navigation in one course can keep its conversation');
  assert.notEqual(coachConversationScope(context), coachConversationScope({ ...context, subject: 'physics' }));
  assert.notEqual(coachConversationScope(context), coachConversationScope({ ...context, selectedCourseId: 43 }));
  const question = { ...context, unitId: 'unit-09', questionId: 'q1' };
  assert.notEqual(coachConversationScope(context), coachConversationScope(question), 'page advice is not sent as prior help on a fresh question');
  assert.notEqual(coachConversationScope(question), coachConversationScope({ ...question, questionId: 'q2' }));
  assert.notEqual(coachConversationScope(question), coachConversationScope({ ...question, unitId: 'unit-10' }));
  assert.notEqual(coachConversationScope(question), coachConversationScope({ ...question, phase: 'after-answer' }));
});

test('specific source targets and school terms cannot reuse another lookup conversation', () => {
  const base = { subject: 'calculus-bc', selectedCourseId: '11', termIds: ['1', '2'] };
  assert.equal(coachConversationScope(base), coachConversationScope({ ...base, termIds: [2, 1, 1] }), 'term order and numeric representation do not change scope');
  for (const field of ['itemId', 'assignmentId', 'moduleItemId']) {
    assert.notEqual(coachConversationScope({ ...base, [field]: '100' }), coachConversationScope({ ...base, [field]: '101' }), field);
  }
  assert.notEqual(coachConversationScope(base), coachConversationScope({ ...base, termIds: ['3'] }));
  assert.notEqual(coachConversationScope(base), coachConversationScope({ ...base, termIds: [] }));
});

test('source details use readable status wording and local timestamp formatting', () => {
  assert.equal(coachSourceDetail('read_failed'), 'Could not read');
  assert.equal(coachSourceDetail('metadata_only'), 'File details only');
  assert.equal(coachSourceDetail('metadata-only'), 'File details only');
  assert.equal(coachSourceDetail('linked-not-read'), 'Link found; content not read');
  assert.equal(coachSourceDetail('not_provided'), 'No content returned');
  const detail = coachSourceDetail('available · Read 2026-09-14T23:41:26.937Z · Source updated 2026-09-01T12:00:00Z');
  assert.match(detail, /^Read successfully · Retrieved /);
  assert.match(detail, /Source updated /);
  assert.doesNotMatch(detail, /2026-09-14T|2026-09-01T/);
  assert.equal(coachSourceDetail(null), '');
  assert.equal(coachSourceDetail('A teacher-provided source note'), 'A teacher-provided source note');
});
