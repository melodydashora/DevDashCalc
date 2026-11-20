import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  guideMeta, guideSources, guideTopics, guideDeadlines, guideChecklist,
  filterGuideTopics, upcomingGuideDeadlines,
} from '../public/reedy-guide-data.js';

const ids = (entries) => entries.map((entry) => entry.id);
const deadline = (id) => guideDeadlines.find((entry) => entry.id === id);

test('school-guide search finds practical questions across title, instructions and keywords', () => {
  assert.ok(ids(filterGuideTopics({ query: '  WHEN   APPLY  ' })).includes('application'));
  assert.ok(ids(filterGuideTopics({ query: 'parent CWID' })).includes('permission-forms'));
  assert.ok(ids(filterGuideTopics({ query: 'new vs returning' })).includes('new-or-returning'));
  assert.ok(ids(filterGuideTopics({ query: 'MCOL December 18' })).includes('career-plan'));
  assert.deepEqual(filterGuideTopics({ query: 'permission meteorite' }), [], 'all words must match rather than broadening to an unrelated result');
});

test('audience and category filters combine with search without adding new-student tasks to returning-only results', () => {
  const returning = filterGuideTopics({ audience: 'returning', category: 'enrollment' });
  assert.ok(ids(returning).includes('new-or-returning'));
  assert.ok(ids(returning).includes('registration'));
  assert.ok(!ids(returning).includes('application'));
  assert.ok(!ids(returning).includes('permission-forms'));
  assert.ok(returning.every((entry) => entry.category === 'enrollment' && entry.audiences.includes('returning')));
  assert.deepEqual(ids(filterGuideTopics({ audience: 'new', category: 'enrollment', query: 'parent workflow CWID' })), ['permission-forms']);
  assert.deepEqual(ids(filterGuideTopics({ audience: 'returning', category: 'costs', query: 'May 7' })), ['costs', 'spring-cycle']);
  assert.deepEqual(filterGuideTopics({ audience: 'unknown' }), []);
  assert.deepEqual(filterGuideTopics({ category: 'unknown' }), []);
});

test('search and date filtering do not reorder or mutate shared source data', () => {
  const before = JSON.stringify({ guideTopics, guideDeadlines });
  const results = filterGuideTopics();
  assert.notEqual(results, guideTopics);
  results.reverse();
  const dates = upcomingGuideDeadlines('2027-01-20');
  assert.notEqual(dates, guideDeadlines);
  dates.reverse();
  assert.equal(JSON.stringify({ guideTopics, guideDeadlines }), before);
});

test('Spring and Fall billing dates remain separate and the book-bundle opening is not a closing deadline', () => {
  assert.deepEqual([deadline('spring-payment').date, deadline('spring-payment').cycle], ['2026-12-09', 'spring-2027']);
  assert.deepEqual([deadline('fall-payment').date, deadline('fall-payment').cycle], ['2027-05-07', 'fall-2027']);
  const books = deadline('spring-books');
  assert.equal(books.date, '2026-12-08');
  assert.match(books.title, /opens/i);
  assert.equal(books.endDate, undefined);
  assert.match(books.detail, /closing date is not established/i);
});

test('Fall enrollment deadlines keep school year, applicable audience and stated time', () => {
  assert.equal(guideMeta.term, 'Fall 2027');
  assert.equal(guideMeta.schoolYear, '2027–28');
  assert.deepEqual([deadline('career-closes').date, deadline('career-closes').time], ['2026-12-18', '5 p.m. Central']);
  assert.equal(deadline('final-requests').date, '2027-02-11');
  assert.deepEqual([deadline('new-application-permission').date, deadline('new-application-permission').audience], ['2027-03-02', 'new']);
  assert.deepEqual([deadline('new-holds').date, deadline('new-holds').audience], ['2027-04-02', 'new']);
  assert.equal(deadline('fall-payment').audience, 'all');
  assert.ok(['career-closes', 'counselor-window', 'final-requests', 'new-application-permission', 'new-holds', 'fall-payment']
    .every((id) => deadline(id).cycle === 'fall-2027'));
});

test('upcoming dates retain an ongoing counselor window through its final day', () => {
  assert.ok(ids(upcomingGuideDeadlines('2027-01-20')).includes('counselor-window'));
  assert.ok(ids(upcomingGuideDeadlines('2027-02-05')).includes('counselor-window'));
  assert.ok(!ids(upcomingGuideDeadlines('2027-02-06')).includes('counselor-window'));
  assert.ok(ids(upcomingGuideDeadlines('2027-05-07')).includes('fall-payment'), 'the due date remains visible on its own day');
  assert.ok(!ids(upcomingGuideDeadlines('2027-05-08')).includes('fall-payment'));
  assert.deepEqual(upcomingGuideDeadlines('2028-01-01'), []);
  assert.deepEqual(ids(upcomingGuideDeadlines()), ids(upcomingGuideDeadlines(guideMeta.reviewedAt)));
});

test('invalid calendar input does not produce misleading upcoming results', () => {
  for (const invalid of ['2027-02-30', '2027-13-01', '2027-2-01', '2027-01-20T00:00:00Z', '', null, 20270120]) {
    assert.deepEqual(upcomingGuideDeadlines(invalid), [], String(invalid));
  }
});

test('College-wide dates stay distinguishable from school enrollment deadlines', () => {
  const college = guideDeadlines.filter((entry) => entry.cycle === 'college-2027');
  assert.deepEqual(ids(college), ['fall-start', 'fall-census', 'fall-withdrawal', 'fall-finals']);
  assert.ok(college.every((entry) => entry.sourceIds.includes('collin-calendar-2027')));
  assert.match(deadline('fall-census').detail, /16-week/);
  assert.match(deadline('fall-withdrawal').detail, /16-week/);
  assert.equal(deadline('fall-finals').endDate, '2027-12-12');
  assert.ok(ids(upcomingGuideDeadlines('2027-12-10')).includes('fall-finals'));
});

test('every displayed guidance item has valid provenance and bulletins do not invent public URLs', () => {
  const sourceIds = new Set(ids(guideSources));
  for (const collection of [guideSources, guideTopics, guideDeadlines, guideChecklist]) {
    assert.equal(new Set(ids(collection)).size, collection.length, 'IDs must remain unique within each collection');
  }
  for (const item of [...guideTopics, ...guideDeadlines, ...guideChecklist]) {
    assert.ok(item.sourceIds.length > 0, item.id);
    assert.ok(item.sourceIds.every((id) => sourceIds.has(id)), `${item.id} references an unknown source`);
  }
  for (const source of guideSources) {
    assert.match(source.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(source.title && source.scope);
    if (source.kind === 'School bulletin') assert.equal(source.url, null);
    else {
      const url = new URL(source.url);
      assert.equal(url.protocol, 'https:');
      assert.equal(url.hostname, 'www.collin.edu');
      assert.equal(url.username + url.password, '');
    }
  }
  assert.match(guideMeta.disclaimer, /not an official/i);
  assert.match(guideMeta.disclaimer, /not a live school feed/i);
});

test('the shared guide excludes the family planner’s personal records and private source addresses', () => {
  const sharedText = JSON.stringify({ guideMeta, guideSources, guideTopics, guideDeadlines, guideChecklist });
  assert.doesNotMatch(sharedText, /\b(?:Dev|Esha|Melody|Dashora)\b/i);
  assert.doesNotMatch(sharedText, /mail\.google\.com|gmail\.com|authuser=|#all\/|k12\.friscoisd\.org/i);
  assert.doesNotMatch(sharedText, /appgprj_|libfile_|profileId|studentId|accessToken|apiToken|sessionSecret/i);
  assert.doesNotMatch(sharedText, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
});
