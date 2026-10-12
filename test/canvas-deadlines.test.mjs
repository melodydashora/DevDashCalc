import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCourseDeadlines, assignmentPlanningTiming, canvasPlainText } from '../public/canvas-deadlines.js';
import { normalizeAssignment, buildInsights } from '../public/canvas-insights.js';
const NOW = Date.parse('2026-10-10T17:00:00Z');
const assignment = (id = '1', name = 'Research essay', extra = {}) => ({ ...normalizeAssignment({ id, name, due_at: null }), ...extra });
const course = (extra = {}) => ({ id: '10', name: 'English', htmlUrl: 'https://school.example/courses/10', timeZone: 'America/Chicago', locale: 'en-US', term: { startAt: '2026-08-01T05:00:00Z', endAt: '2027-06-01T05:00:00Z' }, assignments: [assignment()], ...extra });
const resolve = value => resolveCourseDeadlines(course(value), { now: NOW });
const planned = value => resolve(value).assignments[0].planningDeadline;

test('syllabus due table preserves source and date precision without changing official null', () => {
  const c = course({ syllabusBody: '<table><tr><th>Assignment</th><th>Due date</th><th>Class date</th></tr><tr><td>Research essay</td><td>October 16, 2026</td><td>October 12, 2026</td></tr></table>' });
  const before = JSON.stringify(c);
  const out = resolveCourseDeadlines(c, { now: NOW });
  const a = out.assignments[0];
  assert.equal(a.dueAt, null); assert.equal(a.dueDateStatus, 'no-date');
  assert.equal(a.planningDeadline.status, 'resolved');
  assert.equal(a.planningDeadline.date, '2026-10-16');
  assert.equal(a.planningDeadline.dueAt, null); assert.equal(a.planningDeadline.precision, 'date');
  assert.equal(a.planningDeadline.source, 'syllabus');
  assert.equal(a.planningDeadline.sourceUrl, 'https://school.example/courses/10/assignments/syllabus');
  assert.match(a.planningDeadline.excerpt, /Research essay/);
  assert.equal(JSON.stringify(c), before, 'input is never mutated');
});

test('yearless dates use a unique bounded course term, never the current year', () => {
  assert.equal(planned({ syllabusBody: 'Research essay due January 12.' }).date, '2027-01-12');
  assert.equal(planned({ syllabusBody: 'Research essay due October 16.' }).date, '2026-10-16');
  for (const term of [null, { startAt: '2026-08-01T00:00:00Z' }, { startAt: '2025-08-01T00:00:00Z', endAt: '2027-08-01T00:00:00Z' }]) {
    assert.equal(planned({ syllabusBody: 'Research essay due October 16.', term }).status, 'needs-review');
  }
});

test('impossible, out-of-term, two-digit and locale-ambiguous dates stay for review', () => {
  for (const [text, extra, reason] of [
    ['February 30, 2027', {}, 'invalid-date'], ['October 16, 2025', {}, 'outside-course-term'],
    ['10/16/26', {}, 'two-digit-year'], ['10/11/2026', { locale: null }, 'ambiguous-numeric-date'],
  ]) {
    const out = planned({ syllabusBody: `Research essay due ${text}`, ...extra });
    assert.equal(out.status, 'needs-review', text); assert.equal(out.date, null);
    assert.ok(out.evidence[0].reasons.includes(reason), `${text}: ${JSON.stringify(out.evidence)}`);
  }
  assert.equal(planned({ syllabusBody: 'Research essay due 10/11/2026' }).date, '2026-10-11');
  assert.equal(planned({ syllabusBody: 'Research essay due 11/10/2026', locale: 'en-GB' }).date, '2026-10-11');
});

test('explicit local times use course timezone including DST, but never choose gaps or repeated times', () => {
  const out = planned({ syllabusBody: 'Research essay due October 16, 2026 at 11:59 pm.' });
  assert.equal(out.precision, 'time'); assert.equal(out.dueAt, '2026-10-17T04:59:00.000Z');
  const cases = [['November 1, 2026 at 1:30 am', 'ambiguous-dst-time'], ['March 14, 2027 at 2:30 am', 'nonexistent-dst-time']];
  for (const [text, reason] of cases) {
    const date = planned({ syllabusBody: `Research essay due ${text}` });
    assert.equal(date.status, 'needs-review'); assert.ok(date.evidence[0].reasons.includes(reason));
  }
  assert.equal(planned({ timeZone: null, syllabusBody: 'Research essay due October 16, 2026 at 3 pm' }).status, 'needs-review');
  assert.equal(planned({ syllabusBody: 'Research essay due October 16, 2026 at 3 pm EST' }).status, 'needs-review');
});

test('explicit ISO offset is preserved instead of interpreted in browser timezone', () => {
  const out = planned({ syllabusBody: 'Research essay due 2026-10-16T18:00:00-05:00' });
  assert.equal(out.status, 'resolved'); assert.equal(out.dueAt, '2026-10-16T23:00:00.000Z');
});

test('dated mentions, tentative dates and dates for other assignments do not become deadlines', () => {
  assert.equal(planned({ syllabusBody: 'We discuss Research essay on October 16, 2026.' }).status, 'needs-review');
  assert.equal(planned({ syllabusBody: 'Research essay is tentatively due October 16, 2026.' }).status, 'needs-review');
  assert.equal(planned({ syllabusBody: 'Research essay due October 16, 2026, subject to change.' }).status, 'needs-review');
  assert.equal(planned({ syllabusBody: 'Different essay due October 16, 2026.' }), undefined);
  assert.equal(planned({ syllabusBody: '<table><tr><th>Assignment</th><th>Date</th></tr><tr><td>Research essay</td><td>October 16, 2026</td></tr></table>' }).status, 'needs-review');
});

test('individual table rows prevent dates from attaching to neighboring assignments', () => {
  const out = resolve({ assignments: [assignment('1'), assignment('2', 'Lab report')], syllabusBody: '<table><tr><td>Assignment</td><td>Due</td></tr><tr><td>Research essay</td><td>October 16, 2026</td></tr><tr><td>Lab report</td><td>October 20, 2026</td></tr></table>' });
  assert.deepEqual(out.assignments.map(a => a.planningDeadline.date), ['2026-10-16', '2026-10-20']);
  const complex = resolve({ assignments: [assignment('1'), assignment('2', 'Lab report')], syllabusBody: 'Research essay and Lab report due October 16, 2026 and October 20, 2026 respectively.' });
  assert.ok(complex.assignments.every(a => a.planningDeadline.status === 'needs-review'));
});

test('exact title boundaries and duplicate titles prevent unsafe fuzzy matching', () => {
  const out = resolve({ assignments: [assignment('1', 'Quiz 1'), assignment('2', 'Quiz 10')], syllabusBody: 'Quiz 10 due October 16, 2026' });
  assert.equal(out.assignments[0].planningDeadline, undefined);
  assert.equal(out.assignments[1].planningDeadline.status, 'resolved');
  const duplicated = resolve({ assignments: [assignment('1'), assignment('2')], syllabusBody: 'Research essay due October 16, 2026' });
  assert.ok(duplicated.assignments.every(a => a.planningDeadline.status === 'needs-review'));
});

test('assignment instructions are linked by ID and do not need to repeat their title', () => {
  const out = planned({ assignments: [assignment('1', 'Research essay', { descriptionHtml: '<p>Due October 16, 2026.</p>' })] });
  assert.equal(out.status, 'resolved'); assert.equal(out.source, 'assignment');
});

test('New Quiz instruction dates belong to their assignment and retain distinct source identity and canonical links', () => {
  const htmlUrl = 'https://school.example/canvas/courses/10/assignments/22';
  const out = resolve({ assignments: [assignment('11', 'Classic quiz assignment'), assignment('22', 'New quiz assignment')],
    quizzes: [{ id: '3', assignmentId: '11', bodyHtml: 'Due October 15, 2026.', htmlUrl: 'https://school.example/canvas/courses/10/quizzes/3' }],
    newQuizzes: [{ type: 'new-quiz', id: '3', assignmentId: '22', bodyHtml: 'Due October 16, 2026.', contentStatus: 'available', htmlUrl,
      readAt: '2026-10-10T12:00:00Z', updatedAt: '2026-10-09T12:00:00Z' }],
  });
  assert.deepEqual(out.assignments.map(item => [item.planningDeadline.source, item.planningDeadline.date]), [
    ['quiz', '2026-10-15'], ['new-quiz', '2026-10-16'],
  ]);
  const planned = out.assignments[1].planningDeadline;
  assert.equal(planned.sourceUrl, htmlUrl); assert.equal(planned.evidence[0].sourceId, '3');
  assert.equal(planned.evidence[0].assignmentId, '22');
  assert.equal(planned.evidence[0].readAt, '2026-10-10T12:00:00Z');
  assert.equal(out.assignments[1].dueAt, null, 'inferred instruction date cannot overwrite an official no-date field');
});

test('New Quiz locked or missing instructions stay unread, truncated dates require review, and official dates remain authoritative', () => {
  const quiz = { id: '1', assignmentId: '1', bodyHtml: 'Due October 16, 2026.', contentStatus: 'available' };
  for (const extra of [{ lockedForUser: true }, { published: false }, { contentStatus: 'not_provided' }, { bodyHtml: null }]) {
    assert.equal(planned({ newQuizzes: [{ ...quiz, ...extra }] }), undefined);
  }
  assert.equal(planned({ newQuizzes: [{ ...quiz, bodyTruncated: true, contentStatus: 'truncated' }] }).status, 'needs-review');
  const dueAt = '2026-10-17T12:00:00Z';
  const out = resolve({ assignments: [assignment('1', 'Research essay', { dueAt, dueDateStatus: 'dated' })], newQuizzes: [quiz] });
  assert.equal(out.assignments[0].dueAt, dueAt); assert.equal(out.assignments[0].planningDeadline, undefined);
  assert.equal(out.deadlineReview[0].status, 'official-conflict');
  assert.equal(out.deadlineReview[0].evidence[0].source, 'new-quiz');
});

test('pages, home page, announcement and readable documents can carry source-backed dates', () => {
  for (const [field, value] of [
    ['pages', [{ id: 3, bodyHtml: 'Research essay due October 16, 2026', htmlUrl: 'https://school.example/pages/schedule' }]],
    ['frontPage', { id: 3, bodyHtml: 'Research essay due October 16, 2026' }],
    ['announcements', [{ id: 3, bodyHtml: 'Research essay due October 16, 2026' }]],
    ['documents', [{ id: 3, text: 'Research essay due October 16, 2026', status: 'read', sourceUrl: 'https://example.com/syllabus.pdf' }]],
  ]) assert.equal(planned({ [field]: value }).date, '2026-10-16');
});

test('locked, unpublished, unread and cross-course sources do not silently provide dates', () => {
  for (const extra of [{ lockedForUser: true }, { published: false }, { status: 'unread' }]) {
    assert.equal(planned({ pages: [{ bodyHtml: 'Research essay due October 16, 2026', ...extra }] }), undefined);
  }
  const different = planned({ pages: [{ courseId: '99', bodyHtml: 'Research essay due October 16, 2026' }] });
  assert.equal(different.status, 'needs-review');
  assert.equal(planned({ syllabusBody: 'Research essay due October 16, 2026', syllabusTruncated: true }).status, 'needs-review');
});

test('section-specific sources require matching enrollment rather than all_dates evidence', () => {
  const source = { bodyHtml: 'Research essay due October 16, 2026', sectionIds: ['2'] };
  assert.equal(planned({ pages: [source], enrollmentSectionIds: ['1'] }).status, 'needs-review');
  assert.equal(planned({ pages: [source] }).status, 'needs-review');
  assert.equal(planned({ pages: [source], enrollmentSectionIds: ['2'] }).status, 'resolved');
  assert.equal(planned({ syllabusBody: 'Period 2: Research essay due October 16, 2026' }).status, 'needs-review');
  assert.equal(planned({ syllabusBody: 'Period 2: Research essay due October 16, 2026', enrollmentSectionNames: ['Period 2'] }).status, 'resolved');
  const result = planned({ assignments: [assignment('1', 'Research essay', { allDates: [{ dueAt: '2026-10-16T23:59:00Z', base: false }] })] });
  assert.equal(result, undefined);
});

test('conflicting sources require review unless a newer explicit revision supersedes dated evidence', () => {
  const pages = [{ bodyHtml: 'Research essay due October 16, 2026', updatedAt: '2026-09-01T12:00:00Z' }];
  const announcement = { bodyHtml: 'Research essay due October 20, 2026', updatedAt: '2026-10-09T12:00:00Z' };
  assert.equal(planned({ pages, announcements: [announcement] }).status, 'conflict');
  const updated = { ...announcement, bodyHtml: 'Research essay is now due October 20, 2026' };
  assert.equal(planned({ pages, announcements: [updated] }).status, 'resolved');
  assert.equal(planned({ pages, announcements: [updated] }).date, '2026-10-20');
  assert.equal(planned({ pages: [{ ...pages[0], updatedAt: null }], announcements: [updated] }).status, 'conflict');
  assert.equal(planned({ pages, announcements: [{ ...updated, updatedAt: '2026-10-11T12:00:00Z' }] }).status, 'conflict');
});

test('official dates always win; conflicting syllabus evidence stays explicitly separate', () => {
  const official = '2026-10-18T04:59:00Z';
  const out = resolve({ syllabusBody: 'Research essay due October 16, 2026', assignments: [assignment('1', 'Research essay', { dueAt: official, dueDateStatus: 'dated' })] });
  assert.equal(out.assignments[0].dueAt, official); assert.equal(out.assignments[0].planningDeadline, undefined);
  assert.equal(out.deadlineReview[0].status, 'official-conflict');
  assert.equal(out.assignments[0].deadlineEvidence.length, 1);
});

test('invalid official dates are distinguished from explicit no-date and missing fields', () => {
  for (const status of ['no-date', 'not-provided', 'invalid']) {
    const out = planned({ syllabusBody: 'Research essay due October 16, 2026', assignments: [assignment('1', 'Research essay', { dueDateStatus: status })] });
    assert.equal(out.status, status === 'invalid' ? 'needs-review' : 'resolved');
  }
});

test('date-only planning uses the course day across UTC midnight and DST without inventing hours', () => {
  const c = resolve({ syllabusBody: 'Research essay due October 10, 2026' });
  const a = c.assignments[0];
  const beforeMidnight = Date.parse('2026-10-11T04:59:00Z');
  assert.equal(assignmentPlanningTiming(a, c, beforeMidnight).overdue, false);
  assert.equal(assignmentPlanningTiming(a, c, Date.parse('2026-10-11T05:00:00Z')).overdue, true);
  const insight = buildInsights({ courses: [c] }, beforeMidnight);
  assert.equal(insight.plan.overdueOpen.length, 0);
  assert.equal(insight.plan.buckets.find(b => b.id === 'within-4-hours').items.length, 0);
  const item = insight.plan.buckets.find(b => b.id === 'within-24-hours').items[0];
  assert.equal(item.dueAt, null); assert.equal(item.dueDate, '2026-10-10'); assert.equal(item.dueSource, 'syllabus');
  const dst = resolve({ syllabusBody: 'Research essay due November 1, 2026' });
  assert.equal(assignmentPlanningTiming(dst.assignments[0], dst, Date.parse('2026-11-02T05:59:00Z')).overdue, false);
  assert.equal(assignmentPlanningTiming(dst.assignments[0], dst, Date.parse('2026-11-02T06:00:00Z')).overdue, true);
});

test('unknown course timezone retains the date but cannot claim overdue or hour-level scheduling', () => {
  const c = resolve({ timeZone: null, syllabusBody: 'Research essay due October 10, 2026' });
  const out = assignmentPlanningTiming(c.assignments[0], c, NOW);
  assert.equal(out.date, '2026-10-10'); assert.equal(out.delta, null); assert.equal(out.overdue, false);
});

test('refresh removes stale inferred dates when source is no longer present and ignores executable HTML', () => {
  const c = resolve({ syllabusBody: 'Research essay due October 16, 2026' });
  assert.equal(resolveCourseDeadlines({ ...c, syllabusBody: null }, { now: NOW }).assignments[0].planningDeadline, undefined);
  assert.equal(planned({ syllabusBody: '<script>Research essay due October 16, 2026</script><p>No date provided.</p>' }), undefined);
  assert.equal(canvasPlainText('<p>A &amp; B &#65; &#x42;</p>'), 'A & B A B');
});

test('extracted Word/PDF/CSV table headers retain the deadline column and assignment relationship', () => {
  for (const text of [
    'Assignment\tDue date\tClass date\nResearch essay\tOctober 16, 2026\tOctober 12, 2026',
    'Assignment             Due date                Class date\nResearch essay         October 16, 2026        October 12, 2026',
    'Assignment,Due date,Class date\nResearch essay,"October 16, 2026","October 12, 2026"',
    'Assignment | Due date | Class date\nResearch essay | October 16, 2026 | October 12, 2026',
  ]) {
    const result = planned({ documents: [{ id: 'doc', text, contentStatus: 'available' }] });
    assert.equal(result.status, 'resolved', text); assert.equal(result.date, '2026-10-16');
  }
});

test('learner-specific no-date override is not undone by a general syllabus deadline', () => {
  for (const extra of [{ hasOverrides: true }, { onlyVisibleToOverrides: true }]) {
    const out = planned({ syllabusBody: 'Research essay due October 16, 2026', assignments: [assignment('1', 'Research essay', extra)] });
    assert.equal(out.status, 'needs-review'); assert.equal(out.date, null);
    assert.ok(out.evidence[0].reasons.includes('learner-no-date-override'));
  }
  assert.equal(planned({ syllabusBody: 'Research essay due October 16, 2026' }).status, 'resolved');
});

test('partial documents and section-scoped syllabus headings retain evidence without assigning a deadline', () => {
  assert.equal(planned({ documents: [{ text: 'Research essay due October 16, 2026', contentStatus: 'partial' }] }).status, 'needs-review');
  const section = planned({ syllabusBody: '<h1>English syllabus: Section 2</h1><p>Research essay due October 16, 2026</p>', enrollmentSectionNames: ['Section 1'] });
  assert.equal(section.status, 'needs-review');
  assert.equal(planned({ announcements: [{ bodyHtml: 'Research essay due October 16, 2026', isSectionSpecific: true }] }).status, 'needs-review');
});

test('syllabus-only course yields separate planning tasks from explicit due-table rows', () => {
  const c = resolve({ assignments: [], syllabusBody: '<table><tr><th>Assignment</th><th>Due date</th></tr><tr><td>Research essay</td><td>October 11, 2026</td></tr><tr><td>Group presentation</td><td>October 16, 2026 at 2 pm</td></tr></table>' });
  assert.equal(c.assignments.length, 0); assert.equal(c.planningTasks.length, 2);
  assert.equal(c.planningTasks[0].name, 'Research essay');
  assert.equal(c.planningTasks[0].planningDeadline.date, '2026-10-11');
  for (const task of c.planningTasks) {
    assert.equal(task.completionStatus, 'unverified'); assert.equal(task.sourceTask, true);
    assert.equal('id' in task, false); assert.equal('submission' in task, false);
    assert.equal(task.planningDeadline.evidence[0].assignmentId, null);
  }
  const insight = buildInsights({ courses: [c] }, NOW);
  const items = [...insight.plan.buckets.flatMap(b => b.items), ...insight.plan.later];
  assert.equal(items.length, 2); assert.ok(items.every(i => i.assignmentId === null && i.sourceTaskId && i.sourceTask));
  assert.ok(items.every(i => i.score === null && !i.missing && i.completionStatus === 'unverified'));
  assert.equal(insight.perCourse[0].totalAssignments, 0); assert.equal(insight.perCourse[0].submitted, 0);
  assert.equal(insight.perCourse[0].sourceTasks, 2);
});

test('source-task discovery excludes header, week, category and already-existing assignment rows', () => {
  const c = resolve({ syllabusBody: '<table><tr><th>Assignment</th><th>Due date</th></tr><tr><td>Research essay</td><td>October 11, 2026</td></tr><tr><td>Week 1</td><td>October 12, 2026</td></tr><tr><td>Homework</td><td>October 12, 2026</td></tr><tr><td>No class</td><td>October 12, 2026</td></tr><tr><td>Lab report</td><td>October 15, 2026</td></tr></table>' });
  assert.equal(c.assignments.length, 1); assert.deepEqual(c.planningTasks.map(t => t.name), ['Lab report']);
  assert.equal(c.assignments[0].planningDeadline.date, '2026-10-11');
});

test('source-task identities are stable and duplicate titles group conflicts without completion claims', () => {
  const c = resolve({ assignments: [], syllabusBody: 'Research essay due October 11, 2026', pages: [{ id: '2', bodyHtml: 'Research essay due October 12, 2026' }] });
  assert.equal(c.planningTasks.length, 1); assert.equal(c.planningTasks[0].planningDeadline.status, 'conflict');
  const c2 = resolveCourseDeadlines(c, { now: NOW + 9999999 });
  assert.equal(c.planningTasks[0].sourceTaskId, c2.planningTasks[0].sourceTaskId);
  const insight = buildInsights({ courses: [c] }, NOW);
  assert.equal(insight.plan.noDueDate.length, 1); assert.equal(insight.perCourse[0].submitted, 0);
});

test('an explicit syllabus-only past task remains unverified and current source dates prevent stale-course hiding', () => {
  const c = resolve({ assignments: [], syllabusBody: 'Research essay due October 9, 2026' });
  const insight = buildInsights({ courses: [c] }, NOW);
  assert.equal(insight.plan.overdueOpen.length, 1); assert.equal(insight.plan.overdueOpen[0].completionStatus, 'unverified');
  assert.equal(insight.attention.missing.length, 0); assert.equal(insight.perCourse[0].submitted, 0);
  const withOldAssignment = resolve({ assignments: [assignment('old', 'Old assignment', { dueAt: '2025-01-01T12:00:00Z', dueDateStatus: 'dated' })], syllabusBody: 'Research essay due October 11, 2026' });
  assert.equal(buildInsights({ courses: [withOldAssignment] }, NOW).staleCourses.length, 0);
});

test('copied prior-year syllabus and mixed-section headings cannot manufacture a current learner date', () => {
  for (const heading of ['2025-2026 English syllabus', 'Spring 2026 syllabus']) {
    const out = planned({ syllabusBody: `<h1>${heading}</h1><p>Research essay due October 16</p>` });
    assert.equal(out.status, 'needs-review'); assert.ok(out.evidence[0].reasons.includes('different-source-term'));
  }
  const mixed = planned({ enrollmentSectionNames: ['Section 1'], syllabusBody: '<h1>Section 1</h1><p>Office hours Monday.</p><h1>Section 2</h1><p>Research essay due October 16, 2026</p>' });
  assert.equal(mixed.status, 'needs-review');
  const explicit = planned({ enrollmentSectionNames: ['Section 1'], syllabusBody: '<h1>Section 1</h1><p>Section 2 Research essay due October 16, 2026</p>' });
  assert.equal(explicit.status, 'needs-review');
});

test('date ranges and explicitly negated deadlines are review evidence, not scheduled dates', () => {
  for (const text of ['Research essay due October 16–20, 2026', 'Research essay is not due October 16, 2026', 'Research essay due October 16, 2026 is canceled']) {
    assert.equal(planned({ syllabusBody: text }).status, 'needs-review', text);
  }
});

test('an explicit same-day time refines a date-only source while differing times remain conflicts', () => {
  const syllabusBody = 'Research essay due October 16, 2026';
  const pages = [{ bodyHtml: 'Research essay due October 16, 2026 at 3 pm' }];
  const out = planned({ syllabusBody, pages });
  assert.equal(out.status, 'resolved'); assert.equal(out.precision, 'time'); assert.equal(out.dueAt, '2026-10-16T20:00:00.000Z');
  assert.equal(planned({ syllabusBody, pages: [...pages, { bodyHtml: 'Research essay due October 16, 2026 at 4 pm' }] }).status, 'conflict');
});
