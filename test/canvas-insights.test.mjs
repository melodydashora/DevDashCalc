import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as CI from '../public/canvas-insights.js';

// Frozen clock, same convention as engine.test.mjs — the module never calls
// Date.now(); `now` is always passed in.
const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = (t) => new Date(t).toISOString();

function makeAssignment(over = {}) {
  const { submission, ...rest } = over;
  return {
    id: 'a1',
    groupId: 'g1',
    name: 'Assignment',
    dueAt: null,
    lockAt: null,
    unlockAt: null,
    lockedForUser: false,
    allowedAttempts: null,
    pointsPossible: 10,
    isQuiz: false,
    htmlUrl: null,
    submission: submission === undefined ? null : submission,
    ...rest,
  };
}

function makeSubmission(over = {}) {
  return {
    submittedAt: null,
    gradedAt: null,
    attempt: null,
    score: null,
    grade: null,
    late: false,
    missing: false,
    excused: false,
    workflowState: 'unsubmitted',
    ...over,
  };
}

function makeCourse(over = {}) {
  return {
    id: 'c1',
    name: 'AP Calculus BC',
    courseCode: 'CALC',
    term: null,
    applyGroupWeights: false,
    score: null,
    grade: null,
    moduleProgress: null,
    assignmentGroups: [],
    modules: [],
    assignments: [],
    ...over,
  };
}

function makeSnapshot(courses, missingSubmissions = []) {
  return { fetchedAt: iso(NOW), user: { id: 'u1', name: 'Learner' }, courses, missingSubmissions };
}

const allPlanItems = (insights) => [
  ...insights.plan.overdueOpen,
  ...insights.plan.overdueClosed,
  ...insights.plan.buckets.flatMap((b) => b.items),
  ...insights.plan.later,
  ...insights.plan.noDueDate,
];

// ------------------------------------------------------------ canvasBaseUrl

test('canvasBaseUrl accepts a plain https school domain and strips extras', () => {
  assert.equal(
    CI.canvasBaseUrl('https://school.instructure.com/?x=1#y'),
    'https://school.instructure.com',
    'search, hash, and the trailing slash are removed'
  );
  assert.equal(
    CI.canvasBaseUrl('  https://school.instructure.com/canvas/  '),
    'https://school.instructure.com/canvas',
    'a path prefix is kept without its trailing slash'
  );
});

test('canvasBaseUrl rejects everything that is not a public https origin', () => {
  const rejected = [
    'http://school.instructure.com',
    'https://user:pw@school.instructure.com',
    'https://localhost',
    'https://api.localhost',
    'https://127.0.0.1',
    'https://10.1.2.3',
    'https://192.168.1.1',
    'https://169.254.0.1',
    'https://172.16.0.1',
    'https://172.31.9.9',
    'https://0.0.0.0',
    'https://[::1]',
    'not a url',
    '',
    null,
    'https://' + 'x'.repeat(600) + '.com',
  ];
  for (const value of rejected) {
    assert.equal(CI.canvasBaseUrl(value), null, `rejects ${String(value).slice(0, 40)}`);
  }
  assert.equal(CI.canvasBaseUrl('https://172.32.0.1'), 'https://172.32.0.1', '172.32 is outside the private range');
});

// ------------------------------------------------------------ parseLinkNext

test('parseLinkNext finds the rel next URL in a real Canvas Link header', () => {
  const header =
    '<https://school.instructure.com/api/v1/courses?page=1&per_page=100>; rel="current",' +
    '<https://school.instructure.com/api/v1/courses?page=2&per_page=100>; rel="next",' +
    '<https://school.instructure.com/api/v1/courses?page=1&per_page=100>; rel="first",' +
    '<https://school.instructure.com/api/v1/courses?page=3&per_page=100>; rel="last"';
  assert.equal(
    CI.parseLinkNext(header),
    'https://school.instructure.com/api/v1/courses?page=2&per_page=100'
  );
});

test('parseLinkNext returns null without a next relation or without a header', () => {
  assert.equal(CI.parseLinkNext('<https://x.example/api?page=1>; rel="current"'), null);
  assert.equal(CI.parseLinkNext(''), null);
  assert.equal(CI.parseLinkNext(undefined), null);
});

// -------------------------------------------------------------- normalizers

test('normalizers coerce ids to strings and junk numbers and dates to null', () => {
  const a = CI.normalizeAssignment({
    id: 123,
    name: 'Quiz 1',
    due_at: 'not a date',
    points_possible: 'abc',
    allowed_attempts: '3',
    submission_types: ['online_quiz'],
    submission: { submitted_at: null, score: '7.5', grade: 4, late: 1, workflow_state: 'graded' },
  }, 456);
  assert.equal(a.id, '123', 'assignment id is a string');
  assert.equal(a.groupId, '456', 'group id is a string');
  assert.equal(a.dueAt, null, 'an unparseable date becomes null');
  assert.equal(a.pointsPossible, null, 'a non-numeric points value becomes null');
  assert.equal(a.allowedAttempts, 3, 'numeric strings are accepted');
  assert.equal(a.isQuiz, true, 'online_quiz submission type marks a quiz');
  assert.equal(a.submission.score, 7.5);
  assert.equal(a.submission.grade, '4', 'grade is a string');
  assert.equal(a.submission.late, true);

  const c = CI.normalizeCourse({
    id: 9,
    name: '',
    course_code: 'BIO',
    term: { id: 77, name: '2026-2027', start_at: '2026-08-10T00:00:00Z', end_at: null },
    enrollments: [{ computed_current_score: '88.5', computed_current_grade: 'B+' }],
  });
  assert.equal(c.id, '9');
  assert.equal(c.name, 'BIO', 'course code fills in an empty name');
  assert.equal(c.score, 88.5);
  assert.equal(c.grade, 'B+');
  assert.deepEqual(c.term, { id: '77', name: '2026-2027', startAt: '2026-08-10T00:00:00Z', endAt: null }, 'term keeps id, name, and dates');
});

// ---------------------------------------------------------------- attempts

test('assignment coaching metadata preserves instructions and rubric without changing grades or rules', () => {
  const raw = {
    id: 123, name: 'Explain the motion', description: '<p>Use the graph and justify the sign.</p>',
    submission_types: ['online_upload', 'external_tool'], locked_for_user: true,
    lock_explanation: 'Available after the preceding module.', points_possible: 10,
    submission: { score: 7, grade: '7', workflow_state: 'graded' },
    rubric: [{ id: '_criterion-a', description: 'Reasoning', long_description: 'Connect the graph to the sign.', points: '4', criterion_use_range: false, ratings: [{ id: 8, description: 'Supported', points: 4 }] }],
  };
  const before = JSON.stringify(raw);
  const a = CI.normalizeAssignment(raw);
  assert.equal(a.descriptionHtml, raw.description);
  assert.equal(a.descriptionTruncated, false);
  assert.deepEqual(a.submissionTypes, raw.submission_types);
  assert.equal(a.lockExplanation, raw.lock_explanation);
  assert.deepEqual(a.rubric, [{ id: '_criterion-a', description: 'Reasoning', longDescription: 'Connect the graph to the sign.', points: 4, criterionUseRange: false, ratings: [{ id: '8', description: 'Supported', longDescription: null, points: 4 }] }]);
  assert.equal(a.rubricTruncated, false);
  assert.equal(a.submission.score, 7);
  assert.equal(a.lockedForUser, true);
  assert.equal(JSON.stringify(raw), before, 'normalization does not mutate external input');
});

test('coaching text and rubric caps report incomplete material explicitly', () => {
  const limit = CI.CANVAS_CONTENT_LIMITS;
  const a = CI.normalizeAssignment({
    description: 'x'.repeat(limit.html + 1),
    rubric: Array.from({ length: limit.rubricCriteria + 1 }, (_, id) => ({ id, description: 'r'.repeat(limit.explanation + 1), ratings: Array.from({ length: limit.rubricRatings + 1 }, () => ({ description: 'rating', points: 1 })) })),
  });
  assert.equal(a.descriptionHtml.length, limit.html);
  assert.equal(a.descriptionTruncated, true);
  assert.equal(a.rubric.length, limit.rubricCriteria);
  assert.equal(a.rubricTruncated, true);
  assert.ok(a.rubric.every((criterion) => criterion.ratings.length <= limit.rubricRatings));
  const allRubricText = a.rubric.flatMap((criterion) => [criterion.description, criterion.longDescription, ...criterion.ratings.flatMap((rating) => [rating.description, rating.longDescription])]);
  assert.ok(allRubricText.reduce((total, value) => total + (value?.length || 0), 0) <= limit.rubricText);
  const missing = CI.normalizeAssignment({ description: { unsafe: 'not text' }, rubric: [null, 7, [], { points: 'invalid' }] });
  assert.equal(missing.descriptionHtml, null);
  assert.equal(missing.descriptionTruncated, false);
  assert.deepEqual(missing.submissionTypes, []);
  assert.equal(missing.rubric.length, 1);
  assert.equal(missing.rubric[0].id, null, 'missing identifiers are not invented');
  assert.equal(missing.rubric[0].points, null);
});

test('page module items retain their locator, hierarchy, and lock details independently of contentId', () => {
  const item = CI.normalizeModuleItem({
    id: '9007199254740993', module_id: '9007199254740994', type: 'Page', title: 'Read before starting',
    page_url: 'week-3-instructions', html_url: 'https://school.instructure.com/courses/2/modules/items/3',
    position: '2', indent: 1,
    content_details: { due_at: iso(NOW), lock_at: 'bad date', locked_for_user: true, lock_explanation: 'Complete the previous module.', points_possible: '10' },
    completion_requirement: { type: 'must_view', completed: false },
  });
  assert.equal(item.id, '9007199254740993');
  assert.equal(item.moduleId, '9007199254740994');
  assert.equal(item.contentId, null, 'Canvas Page items can be retrieved through page_url');
  assert.equal(item.pageUrl, 'week-3-instructions');
  assert.equal(item.htmlUrl, 'https://school.instructure.com/courses/2/modules/items/3');
  assert.equal(item.position, 2);
  assert.equal(item.indent, 1);
  assert.deepEqual(item.contentDetails, { dueAt: iso(NOW), unlockAt: null, lockAt: null, lockedForUser: true, lockExplanation: 'Complete the previous module.', pointsPossible: 10 });
  assert.deepEqual(item.completionRequirement, { type: 'must_view', minScore: null, completed: false });
});

test('module metadata preserves unknown values and rejects unsafe links or invented identities', () => {
  const item = CI.normalizeModuleItem({ page_url: 'x'.repeat(CI.CANVAS_CONTENT_LIMITS.locator + 1), html_url: 'javascript:alert(1)', module_id: {}, position: -1, indent: 1.5, content_details: {} });
  assert.equal(item.pageUrl, null, 'an overlong locator is rejected, never truncated to another identity');
  assert.equal(item.moduleId, null);
  assert.equal(item.position, null);
  assert.equal(item.indent, null);
  assert.equal(item.htmlUrl, null);
  assert.equal(item.contentDetails.lockedForUser, null, 'missing lock status is unknown');
  assert.equal(CI.normalizeModuleItem({}).contentDetails, null);
  for (const url of ['http://school.example/a', 'https://name:password@school.example/a', 'data:text/html,test']) {
    assert.equal(CI.normalizeModuleItem({ html_url: url }).htmlUrl, null);
  }
});

test('on-demand page and discussion normalizers expose only bounded source fields', () => {
  const page = CI.normalizeCanvasPage({ page_id: 7, url: '7', title: 'Page whose slug is numeric', body: '<p>Course instructions.</p>', html_url: 'https://school.example/courses/2/pages/7', published: true, updated_at: iso(NOW), token: 'must never be copied', editor: { name: 'do not copy' } });
  assert.equal(page.id, '7');
  assert.equal(page.pageUrl, '7');
  assert.equal(page.bodyHtml, '<p>Course instructions.</p>');
  assert.equal(page.bodyTruncated, false);
  assert.equal(page.lockedForUser, null);
  assert.equal(page.updatedAt, iso(NOW));
  assert.equal('token' in page, false);
  assert.equal('editor' in page, false);
  const discussion = CI.normalizeCanvasDiscussion({ id: 12, assignment_id: 99, message: 'x'.repeat(CI.CANVAS_CONTENT_LIMITS.html + 10), title: 'Explain your reasoning', participants: [{ name: 'Do not copy classmates' }], entries: ['Do not copy classmates'], locked_for_user: false });
  assert.equal(discussion.id, '12');
  assert.equal(discussion.assignmentId, '99');
  assert.equal(discussion.bodyHtml.length, CI.CANVAS_CONTENT_LIMITS.html);
  assert.equal(discussion.bodyTruncated, true);
  assert.equal(discussion.lockedForUser, false);
  assert.equal('participants' in discussion, false);
  assert.equal('entries' in discussion, false);
  assert.equal(CI.normalizeCanvasPage({}).id, null);
  assert.equal(CI.normalizeCanvasDiscussion({}).bodyHtml, null);
});

test('adding coaching reference content leaves deterministic plan and grade outputs unchanged', () => {
  const raw = { id: 14, name: 'Assignment', due_at: iso(NOW + DAY), points_possible: 10, submission: { score: 8, grade: '8', workflow_state: 'graded' } };
  const plain = CI.normalizeAssignment(raw);
  const enriched = CI.normalizeAssignment({ ...raw, description: '<p>Read the instructions.</p>', rubric: [{ id: 1, points: 999, description: 'Metadata cannot alter a Canvas grade.' }] });
  const baseline = CI.buildInsights(makeSnapshot([makeCourse({ assignments: [plain] })]), NOW);
  const withMetadata = CI.buildInsights(makeSnapshot([makeCourse({ assignments: [enriched] })]), NOW);
  assert.deepEqual(withMetadata, baseline);
});

test('date evidence distinguishes Canvas null from missing or invalid fields without inferring a due date', () => {
  for (const [raw, status, dueAt] of [
    [{}, 'not-provided', null], [{ due_at: null }, 'no-date', null],
    [{ due_at: 'invalid' }, 'invalid', null], [{ due_at: '' }, 'invalid', null],
    [{ due_at: iso(NOW) }, 'dated', iso(NOW)],
  ]) {
    const assignment = CI.normalizeAssignment(raw);
    assert.equal(assignment.dueDateStatus, status);
    assert.equal(assignment.dueAt, dueAt);
  }
  const a = CI.normalizeAssignment({ due_at: null, has_overrides: true, updated_at: iso(NOW), all_dates: [
    { base: true, due_at: iso(NOW + DAY) },
    { id: 55, title: 'Another section date', due_at: iso(NOW + 2 * DAY), student_ids: [123, 456] },
  ] });
  assert.equal(a.dueAt, null, 'other dates never overwrite the requesting learner effective date');
  assert.equal(a.dueDateStatus, 'no-date');
  assert.equal(a.hasOverrides, true);
  assert.equal(a.updatedAt, iso(NOW));
  assert.equal(a.allDatesProvided, true);
  assert.equal(a.allDatesTruncated, false);
  assert.equal(a.allDates[0].base, true);
  assert.equal(a.allDates[0].id, null);
  assert.equal(a.allDates[1].id, '55');
  assert.equal('student_ids' in a.allDates[1], false);
});

test('all_dates evidence is bounded and preserves absent versus explicitly empty results', () => {
  assert.equal(CI.normalizeAssignment({}).allDatesProvided, false);
  assert.equal(CI.normalizeAssignment({ all_dates: null }).allDatesProvided, false);
  assert.equal(CI.normalizeAssignment({ all_dates: [] }).allDatesProvided, true);
  const a = CI.normalizeAssignment({ all_dates: Array.from({ length: CI.CANVAS_CONTENT_LIMITS.assignmentDates + 1 }, (_, id) => ({ id, due_at: null })) });
  assert.equal(a.allDates.length, CI.CANVAS_CONTENT_LIMITS.assignmentDates);
  assert.equal(a.allDatesTruncated, true);
  assert.ok(a.allDates.every((date) => date.dueDateStatus === 'no-date'));
});

test('attempts remaining is null when unlimited and never below zero', () => {
  assert.equal(CI.attemptsRemaining(makeAssignment({ allowedAttempts: -1 })), null, '-1 means unlimited');
  assert.equal(CI.attemptsRemaining(makeAssignment({ allowedAttempts: null })), null, 'absent means unlimited');
  assert.equal(
    CI.attemptsRemaining(makeAssignment({ allowedAttempts: 3, submission: makeSubmission({ attempt: 1 }) })),
    2
  );
  assert.equal(
    CI.attemptsRemaining(makeAssignment({ allowedAttempts: 1, submission: makeSubmission({ attempt: 5 }) })),
    0,
    'over-attempted work reports zero, not a negative number'
  );
});

// ------------------------------------------------------------ buildInsights

test('an assignment Canvas marks missing lands in overdue-open and under attention', () => {
  const course = makeCourse({
    assignments: [makeAssignment({ dueAt: iso(NOW - DAY), submission: makeSubmission({ missing: true }) })],
  });
  const out = CI.buildInsights(makeSnapshot([course]), NOW);
  assert.equal(out.plan.overdueOpen.length, 1, 'past due and open stays actionable');
  assert.equal(out.plan.overdueOpen[0].missing, true, 'the item carries the missing flag');
  assert.equal(out.attention.missing.length, 1);
  assert.equal(allPlanItems(out).length, 1, 'the assignment appears in exactly one plan section');
});

test('past-due work that Canvas has locked lands in overdue-closed, not overdue-open', () => {
  const byLockDate = makeAssignment({ id: 'a1', dueAt: iso(NOW - 2 * DAY), lockAt: iso(NOW - DAY), submission: makeSubmission() });
  const byFlag = makeAssignment({ id: 'a2', dueAt: iso(NOW - 2 * DAY), lockedForUser: true, submission: makeSubmission() });
  const stillOpen = makeAssignment({ id: 'a3', dueAt: iso(NOW - 2 * DAY), lockAt: iso(NOW + DAY), submission: makeSubmission() });
  const out = CI.buildInsights(makeSnapshot([makeCourse({ assignments: [byLockDate, byFlag, stillOpen] })]), NOW);
  assert.deepEqual(out.plan.overdueClosed.map((i) => i.assignmentId), ['a1', 'a2']);
  assert.deepEqual(out.plan.overdueOpen.map((i) => i.assignmentId), ['a3'], 'a future lock date keeps it open');
  assert.equal(out.plan.overdueClosed[0].lockKind, 'date', 'a passed lock date is labeled as such');
  assert.equal(out.plan.overdueClosed[1].lockKind, 'other', 'locked_for_user without a passed lock date is another kind of lock');
});

test('an excused assignment appears in no plan section and no attention list', () => {
  const course = makeCourse({
    assignments: [
      makeAssignment({ dueAt: iso(NOW - DAY), submission: makeSubmission({ missing: true, excused: true }) }),
    ],
  });
  const out = CI.buildInsights(makeSnapshot([course]), NOW);
  assert.equal(allPlanItems(out).length, 0);
  assert.equal(out.attention.missing.length, 0);
});

test('unsubmitted work sorts into the due-date buckets in spec order', () => {
  const mk = (id, delta) => makeAssignment({ id, dueAt: iso(NOW + delta), submission: makeSubmission() });
  const course = makeCourse({
    assignments: [
      mk('h4', 3 * HOUR),
      mk('h12', 11 * HOUR),
      mk('h24', 23 * HOUR),
      mk('d3', 2 * DAY),
      mk('d5', 4 * DAY),
      mk('later', 6 * DAY),
    ],
  });
  const out = CI.buildInsights(makeSnapshot([course]), NOW);
  const byBucket = Object.fromEntries(out.plan.buckets.map((b) => [b.id, b.items.map((i) => i.assignmentId)]));
  assert.deepEqual(byBucket['within-4-hours'], ['h4']);
  assert.deepEqual(byBucket['within-12-hours'], ['h12']);
  assert.deepEqual(byBucket['within-24-hours'], ['h24']);
  assert.deepEqual(byBucket['within-3-days'], ['d3']);
  assert.deepEqual(byBucket['within-5-days'], ['d5']);
  assert.deepEqual(out.plan.later.map((i) => i.assignmentId), ['later']);
});

test('bucket boundaries: due exactly now is within 4 hours; due exactly at a cutoff stays in that bucket', () => {
  const course = makeCourse({
    assignments: [
      makeAssignment({ id: 'now', dueAt: iso(NOW), submission: makeSubmission() }),
      makeAssignment({ id: 'exact4h', dueAt: iso(NOW + 4 * HOUR), submission: makeSubmission() }),
      makeAssignment({ id: 'exact5d', dueAt: iso(NOW + 5 * DAY), submission: makeSubmission() }),
    ],
  });
  const out = CI.buildInsights(makeSnapshot([course]), NOW);
  const byBucket = Object.fromEntries(out.plan.buckets.map((b) => [b.id, b.items.map((i) => i.assignmentId)]));
  assert.deepEqual(byBucket['within-4-hours'], ['now', 'exact4h'], 'due now is not overdue and sorts first');
  assert.deepEqual(byBucket['within-5-days'], ['exact5d']);
  assert.equal(out.plan.overdueOpen.length, 0);
});

test('submitted and graded work leaves the plan but keeps its attention flags', () => {
  const course = makeCourse({
    assignments: [
      makeAssignment({
        id: 'late1',
        dueAt: iso(NOW - DAY),
        submission: makeSubmission({ submittedAt: iso(NOW - HOUR), late: true }),
      }),
      makeAssignment({
        id: 'gradedmissing',
        dueAt: iso(NOW - DAY),
        submission: makeSubmission({ missing: true, workflowState: 'graded', score: 0 }),
      }),
    ],
  });
  const out = CI.buildInsights(makeSnapshot([course]), NOW);
  assert.equal(allPlanItems(out).length, 0, 'neither is actionable in the plan');
  assert.deepEqual(out.attention.late.map((i) => i.assignmentId), ['late1']);
  assert.deepEqual(out.attention.missing.map((i) => i.assignmentId), ['gradedmissing']);
});

test('late requires a submission; unsubmitted missing work is not listed as late', () => {
  const course = makeCourse({
    assignments: [
      makeAssignment({ dueAt: iso(NOW - DAY), submission: makeSubmission({ missing: true, late: true }) }),
    ],
  });
  const out = CI.buildInsights(makeSnapshot([course]), NOW);
  assert.equal(out.attention.late.length, 0);
  assert.equal(out.attention.missing.length, 1);
});

test('graded work below 70 percent is flagged; exactly 70 percent and zero points possible are not', () => {
  const mk = (id, score, pointsPossible) =>
    makeAssignment({
      id,
      pointsPossible,
      submission: makeSubmission({ workflowState: 'graded', score, submittedAt: iso(NOW - DAY) }),
    });
  const course = makeCourse({ assignments: [mk('low', 6.9, 10), mk('edge', 7, 10), mk('zero', 0, 0)] });
  const out = CI.buildInsights(makeSnapshot([course]), NOW);
  assert.deepEqual(out.attention.lowScores.map((i) => i.assignmentId), ['low']);
  assert.equal(out.attention.lowScores[0].ratio, 0.69);
  assert.equal(CI.LOW_SCORE_RATIO, 0.7, 'the threshold is the exported constant');
});

test('a course current score below 70 raises a course alert; at 70 it does not', () => {
  const out = CI.buildInsights(
    makeSnapshot([
      makeCourse({ id: 'c1', name: 'A course', score: 69.9 }),
      makeCourse({ id: 'c2', name: 'B course', score: 70 }),
      makeCourse({ id: 'c3', name: 'C course', score: null }),
    ]),
    NOW
  );
  assert.deepEqual(out.attention.courseAlerts.map((c) => c.courseId), ['c1']);
  assert.equal(CI.LOW_COURSE_SCORE, 70, 'the threshold is the exported constant');
});

test('incomplete module requirements produce one gap entry; complete or absent data produces none', () => {
  const out = CI.buildInsights(
    makeSnapshot([
      makeCourse({ id: 'c1', name: 'A', moduleProgress: { requirementCount: 10, requirementCompletedCount: 7, completedAt: null } }),
      makeCourse({ id: 'c2', name: 'B', moduleProgress: { requirementCount: 5, requirementCompletedCount: 5, completedAt: null } }),
      makeCourse({ id: 'c3', name: 'C', moduleProgress: null }),
      makeCourse({ id: 'c4', name: 'D', moduleProgress: { requirementCount: 0, requirementCompletedCount: 0, completedAt: null } }),
    ]),
    NOW
  );
  assert.deepEqual(out.plan.moduleGaps, [
    { courseId: 'c1', courseName: 'A', requirementCount: 10, requirementCompletedCount: 7 },
  ]);
});

test('a course whose dated work all ended over 10 months ago is stale; a no-due-date assignment never makes one stale', () => {
  const oldDue = iso(NOW - CI.STALE_MS - DAY);
  const stale = makeCourse({
    id: 'old',
    name: 'Old course',
    assignments: [
      makeAssignment({ id: 'o1', dueAt: oldDue, submission: makeSubmission() }),
      makeAssignment({ id: 'o2', dueAt: null, submission: makeSubmission() }),
    ],
  });
  const current = makeCourse({
    id: 'cur',
    name: 'Current course',
    assignments: [
      makeAssignment({ id: 'k1', dueAt: oldDue, submission: makeSubmission() }),
      makeAssignment({ id: 'k2', dueAt: iso(NOW + DAY), submission: makeSubmission() }),
    ],
  });
  const undated = makeCourse({ id: 'und', name: 'Undated course', assignments: [makeAssignment({ id: 'u1', dueAt: null, submission: makeSubmission() })] });
  const out = CI.buildInsights(makeSnapshot([stale, current, undated]), NOW);
  assert.deepEqual(out.staleCourses, [{ id: 'old', name: 'Old course', lastDueAt: oldDue }]);
  assert.deepEqual(out.perCourse.map((r) => r.courseId).sort(), ['cur', 'und'], 'stale courses leave the summary');
  assert.equal(allPlanItems(out).some((i) => i.courseId === 'old'), false, 'stale course work leaves the plan');
  assert.equal(CI.STALE_MONTHS, 10, 'the threshold is the exported constant');
});

test('the missing-submissions endpoint fills in work the course list did not return, deduped by id', () => {
  const course = makeCourse({
    assignments: [makeAssignment({ id: 'dup', dueAt: iso(NOW - DAY), submission: makeSubmission({ missing: true }) })],
  });
  const missing = [
    { assignmentId: 'dup', courseId: 'c1', name: 'Duplicate', dueAt: iso(NOW - DAY), pointsPossible: 10, htmlUrl: null },
    { assignmentId: 'extra', courseId: 'c1', name: 'Extra item', dueAt: iso(NOW - 2 * DAY), pointsPossible: 5, htmlUrl: null },
  ];
  const out = CI.buildInsights(makeSnapshot([course], missing), NOW);
  assert.deepEqual(out.attention.missing.map((i) => i.assignmentId), ['extra', 'dup'], 'due date ordering, no duplicate');
  assert.equal(out.attention.missing[1].courseName, 'AP Calculus BC', 'course name resolved from the snapshot');
});

test('every list is ordered by due date, then course name, then assignment name, then id', () => {
  const c1 = makeCourse({
    id: 'c1',
    name: 'Alpha',
    assignments: [
      makeAssignment({ id: 'z9', name: 'Same', dueAt: iso(NOW + 2 * DAY), submission: makeSubmission() }),
      makeAssignment({ id: 'a1', name: 'Same', dueAt: iso(NOW + 2 * DAY), submission: makeSubmission() }),
      makeAssignment({ id: 'b1', name: 'Later item', dueAt: iso(NOW + 2 * DAY + HOUR), submission: makeSubmission() }),
    ],
  });
  const c2 = makeCourse({
    id: 'c2',
    name: 'Beta',
    assignments: [makeAssignment({ id: 'm1', name: 'Same', dueAt: iso(NOW + 2 * DAY), submission: makeSubmission() })],
  });
  const out = CI.buildInsights(makeSnapshot([c1, c2]), NOW);
  const d3 = out.plan.buckets.find((b) => b.id === 'within-3-days').items;
  assert.deepEqual(
    d3.map((i) => i.assignmentId),
    ['a1', 'z9', 'm1', 'b1'],
    'same due date: Alpha before Beta, then id a1 before z9; later due date last'
  );
});

test('an empty snapshot produces empty lists and no throw', () => {
  const out = CI.buildInsights(makeSnapshot([]), NOW);
  assert.equal(allPlanItems(out).length, 0);
  assert.deepEqual(out.attention, { missing: [], late: [], lowScores: [], courseAlerts: [] });
  assert.deepEqual(out.staleCourses, []);
  assert.deepEqual(out.perCourse, []);
  assert.equal(out.generatedAt, NOW);
});

test('per-course summary rows count submitted, missing, overdue, and upcoming work', () => {
  const course = makeCourse({
    assignments: [
      makeAssignment({ id: 's1', dueAt: iso(NOW - DAY), submission: makeSubmission({ submittedAt: iso(NOW - DAY) }) }),
      makeAssignment({ id: 'm1', dueAt: iso(NOW - DAY), submission: makeSubmission({ missing: true }) }),
      makeAssignment({ id: 'u1', dueAt: iso(NOW + DAY), submission: makeSubmission() }),
      makeAssignment({ id: 'l1', dueAt: iso(NOW - DAY), lockedForUser: true, submission: makeSubmission() }),
    ],
  });
  const out = CI.buildInsights(makeSnapshot([course]), NOW);
  assert.deepEqual(out.perCourse, [
    {
      courseId: 'c1',
      courseName: 'AP Calculus BC',
      courseCode: 'CALC',
      score: null,
      grade: null,
      missing: 1,
      overdueOpen: 1,
      overdueClosed: 1,
      upcoming: 1,
      submitted: 1,
      totalAssignments: 4,
    },
  ]);
});

// ------------------------------------------------------------------- terms

const term = (id, name, startAt, endAt) => ({ id, name, startAt, endAt });

test('termsFrom dedupes terms across courses and sorts newest school term first', () => {
  const courses = [
    makeCourse({ id: 'c1', term: term('t1', '2025-2026', iso(NOW - 400 * DAY), iso(NOW - 40 * DAY)) }),
    makeCourse({ id: 'c2', term: term('t2', '2026-2027', iso(NOW - 20 * DAY), null) }),
    makeCourse({ id: 'c3', term: term('t2', '2026-2027', iso(NOW - 20 * DAY), null) }),
    makeCourse({ id: 'c4', term: term('t0', 'Default Term', null, null) }),
    makeCourse({ id: 'c5', term: null }),
  ];
  const terms = CI.termsFrom(courses);
  assert.deepEqual(terms.map((t) => t.id), ['t2', 't1', 't0'], 'newest start first, undated last');
  assert.equal(terms[0].courseCount, 2, 'both 2026-2027 courses counted once per course');
});

test('the current term is the dated term containing now; an undated Default Term is never current', () => {
  const terms = [
    term('t0', 'Default Term', null, null),
    term('t1', '2025-2026', iso(NOW - 400 * DAY), iso(NOW - 40 * DAY)),
    term('t2', '2026-2027', iso(NOW - 20 * DAY), iso(NOW + 300 * DAY)),
  ];
  assert.equal(CI.currentTermId(terms, NOW), 't2');
  assert.equal(CI.currentTermId([terms[0], terms[1]], NOW), null, 'no dated term contains now');
  const openEnded = [term('a', 'Fall', iso(NOW - 100 * DAY), null), term('b', 'Spring', iso(NOW - 10 * DAY), null)];
  assert.equal(CI.currentTermId(openEnded, NOW), 'b', 'ties go to the latest start date');
});

test('a term selection excludes other-term courses everywhere and lists them; term-less courses always stay', () => {
  const oldCourse = makeCourse({
    id: 'old', name: 'Geometry 22-23', term: term('t1', '2022-2023', iso(NOW - 900 * DAY), iso(NOW - 500 * DAY)),
    assignments: [makeAssignment({ id: 'o1', dueAt: iso(NOW - DAY), submission: makeSubmission({ missing: true }) })],
  });
  const nowCourse = makeCourse({
    id: 'cur', name: 'AP Calculus BC', term: term('t2', '2026-2027', iso(NOW - 20 * DAY), null),
    assignments: [makeAssignment({ id: 'k1', dueAt: iso(NOW + DAY), submission: makeSubmission() })],
  });
  const termless = makeCourse({
    id: 'none', name: 'Advisory', term: null,
    assignments: [makeAssignment({ id: 'n1', dueAt: iso(NOW + DAY), submission: makeSubmission() })],
  });
  const missing = [{ assignmentId: 'o1', courseId: 'old', name: 'Old thing', dueAt: iso(NOW - DAY), pointsPossible: 10, htmlUrl: null }];
  const out = CI.buildInsights(makeSnapshot([oldCourse, nowCourse, termless], missing), NOW, { termIds: ['t2'] });
  assert.deepEqual(out.otherTermCourses, [{ id: 'old', name: 'Geometry 22-23', termName: '2022-2023' }]);
  assert.deepEqual(out.perCourse.map((r) => r.courseId).sort(), ['cur', 'none'], 'term-less course stays');
  assert.equal(out.attention.missing.length, 0, 'missing work in an unselected term is not shown');
  assert.equal(allPlanItems(out).some((i) => i.courseId === 'old'), false);
  const unfiltered = CI.buildInsights(makeSnapshot([oldCourse, nowCourse, termless], missing), NOW);
  assert.equal(unfiltered.otherTermCourses.length, 0, 'no selection means every term is included');
  assert.equal(unfiltered.attention.missing.length, 1);
});

// -------------------------------------------------------- course visibility

test('courseMatchesApps matches calculus and physics courses by name or code', () => {
  const match = (name, courseCode = '') => CI.courseMatchesApps({ name, courseCode });
  assert.equal(match('AP Calculus BC'), true);
  assert.equal(match('Calc 3 Honors'), true);
  assert.equal(match('AP Physics 1 S1 (SCAIFE, K.)'), true);
  assert.equal(match('Algebra 2 S1'), false, 'algebra is not a covered subject');
  assert.equal(match('Health Science S1'), false);
  assert.equal(match('Weird Name', 'CALC-BC'), true, 'the course code also counts');
});

test('with the subject filter on, non-matching courses hide with reason subject and leave every list', () => {
  const calc = makeCourse({
    id: 'calc', name: 'AP Calculus BC',
    assignments: [makeAssignment({ id: 'c1', dueAt: iso(NOW + DAY), submission: makeSubmission() })],
  });
  const health = makeCourse({
    id: 'health', name: 'Health Science S1', courseCode: 'HS',
    assignments: [makeAssignment({ id: 'h1', dueAt: iso(NOW - DAY), submission: makeSubmission({ missing: true }) })],
  });
  const missing = [{ assignmentId: 'h1', courseId: 'health', name: 'Health thing', dueAt: iso(NOW - DAY), pointsPossible: 10, htmlUrl: null }];
  const out = CI.buildInsights(makeSnapshot([calc, health], missing), NOW, { subjectFilter: true });
  assert.deepEqual(out.hiddenCourses, [{ id: 'health', name: 'Health Science S1', courseCode: 'HS', reason: 'subject' }]);
  assert.deepEqual(out.perCourse.map((r) => r.courseId), ['calc']);
  assert.equal(out.attention.missing.length, 0, 'missing work in a hidden course stays hidden');
  assert.equal(allPlanItems(out).some((i) => i.courseId === 'health'), false);
});

test('overrides win: shown reveals a non-matching course, hidden hides a matching one', () => {
  const calc = makeCourse({ id: 'calc', name: 'AP Calculus BC' });
  const health = makeCourse({ id: 'health', name: 'Health Science S1' });
  const out = CI.buildInsights(makeSnapshot([calc, health]), NOW, {
    subjectFilter: true,
    courseOverrides: { health: 'shown', calc: 'hidden' },
  });
  assert.deepEqual(out.perCourse.map((r) => r.courseId), ['health'], 'shown override reveals it');
  assert.deepEqual(out.hiddenCourses, [{ id: 'calc', name: 'AP Calculus BC', courseCode: 'CALC', reason: 'manual' }]);
});

test('without the subject filter and without overrides, no course is hidden', () => {
  const out = CI.buildInsights(makeSnapshot([makeCourse({ id: 'c1', name: 'Health Science S1' })]), NOW);
  assert.deepEqual(out.hiddenCourses, []);
  assert.equal(out.perCourse.length, 1);
});

test('explicit all courses replaces old subject hiding and manual hiding without changing term scope', () => {
  const term = { id: 'now', name: 'This year' };
  const courses = [
    makeCourse({ id: 'calc', name: 'AP Calculus BC', term }),
    makeCourse({ id: 'physics', name: 'Physics', term }),
    makeCourse({ id: 'health', name: 'Health', term }),
    makeCourse({ id: 'old', name: 'Old English', term: { id: 'past', name: 'Last year' } }),
  ];
  const snapshot = makeSnapshot(courses);
  for (const selection of [{ selectedSubject: 'all' }, { selectedCourseId: 'all', selectedSubject: 'physics' }]) {
    const out = CI.buildInsights(snapshot, NOW, {
      ...selection, subjectFilter: true, courseOverrides: { health: 'hidden' }, termIds: ['now'],
    });
    assert.deepEqual(out.perCourse.map((c) => c.courseId), ['calc', 'health', 'physics']);
    assert.deepEqual(out.hiddenCourses, []);
    assert.deepEqual(out.otherTermCourses.map((c) => c.id), ['old']);
  }
});

test('BC, AB, and Physics selections consistently filter grades, tasks, and missing assignments', () => {
  const courses = [
    makeCourse({ id: 'bc', name: 'AP Calculus BC', score: 50 }),
    makeCourse({ id: 'ab', name: 'AP Calculus AB', score: 50 }),
    makeCourse({ id: 'physics', name: 'Physics', courseCode: 'PHYS', score: 50 }),
  ].map((course) => ({ ...course, assignments: [makeAssignment({ id: `${course.id}-task`, dueAt: iso(NOW - DAY) })] }));
  const missing = courses.map((course) => ({ courseId: course.id, assignmentId: `${course.id}-extra`, name: 'Missing', dueAt: null }));
  missing.push({ courseId: 'unknown', assignmentId: 'unknown-task', name: 'Unlisted class', dueAt: null });
  for (const [selectedSubject, courseId] of [['calculus-bc', 'bc'], ['calculus-ab', 'ab'], ['physics', 'physics']]) {
    const out = CI.buildInsights(makeSnapshot(courses, missing), NOW, {
      selectedSubject, courseOverrides: { physics: 'shown' },
    });
    assert.deepEqual(out.perCourse.map((c) => c.courseId), [courseId]);
    assert.deepEqual(allPlanItems(out).map((item) => item.courseId), [courseId]);
    assert.deepEqual(out.attention.courseAlerts.map((item) => item.courseId), [courseId]);
    assert.deepEqual(out.attention.missing.map((item) => item.courseId), [courseId]);
  }
});

test('an explicitly selected course wins over subject and old hidden preferences', () => {
  const courses = [
    makeCourse({ id: 'bc', name: 'AP Calculus BC' }),
    makeCourse({ id: 'english', name: 'English', courseCode: 'ENG' }),
  ];
  const missing = [
    { courseId: 'english', assignmentId: 'english-task', name: 'Essay', dueAt: null },
    { courseId: 'unknown', assignmentId: 'unknown-task', name: 'Other', dueAt: null },
  ];
  const out = CI.buildInsights(makeSnapshot(courses, missing), NOW, {
    selectedCourseId: 'english', selectedSubject: 'calculus-bc', subjectFilter: true,
    courseOverrides: { english: 'hidden', bc: 'shown' },
  });
  assert.deepEqual(out.perCourse.map((c) => c.courseId), ['english']);
  assert.deepEqual(out.hiddenCourses.map((c) => [c.id, c.reason]), [['bc', 'course']]);
  assert.deepEqual(out.attention.missing.map((item) => item.courseId), ['english']);
});

test('the plan bucket cutoffs are the exported spec constants', () => {
  assert.deepEqual(
    CI.PLAN_BUCKETS.map((b) => b.ms),
    [4 * HOUR, 12 * HOUR, 24 * HOUR, 3 * DAY, 5 * DAY],
    'due within 4 hours, 12 hours, 24 hours, 3 days, 5 days'
  );
});
