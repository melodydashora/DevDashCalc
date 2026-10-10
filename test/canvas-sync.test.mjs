import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canvasApiUrl, canvasNextUrl, collectCanvasList, collectCanvasSnapshot, createCanvasCollectionState, CANVAS_COLLECTION_LIMITS } from '../canvas-sync.js';

const baseUrl = 'https://school.example/canvas';
const user = { id: '40', name: 'Learner' };
const page = items => ({ items, truncated: false });
function fixture(overrides = {}) {
  const calls = [];
  return {
    baseUrl, user, calls,
    get: async (endpoint, query, options) => {
      calls.push({ method: 'get', endpoint, query, options });
      if (overrides.get) return overrides.get(endpoint, query, options);
      return null;
    },
    list: async (endpoint, query, options) => {
      calls.push({ method: 'list', endpoint, query, options });
      const result = await overrides.list?.(endpoint, query, options);
      return result ?? page(endpoint === 'courses' ? [{ id: '1', name: 'Course' }] : []);
    },
  };
}

test('API URLs preserve deployment prefix and New Quizzes family; pagination keeps exact learner and course scope', () => {
  const first = canvasApiUrl(baseUrl, 'courses/1/students/submissions', { 'student_ids[]': '40', 'include[]': ['submission_comments', 'rubric_assessment'], per_page: 100 });
  assert.equal(first.pathname, '/canvas/api/v1/courses/1/students/submissions');
  assert.equal(canvasApiUrl(baseUrl, 'courses/1/quizzes', {}, 'quiz/v1').pathname, '/canvas/api/quiz/v1/courses/1/quizzes');
  const next = new URL(first); next.searchParams.set('page', '2');
  assert.equal(canvasNextUrl(first, next)?.href, next.href);
  for (const change of [url => url.hostname = 'evil.example', url => url.pathname = '/canvas/api/v1/courses/2/students/submissions', url => url.searchParams.set('student_ids[]', 'all'), url => url.searchParams.set('access_token', 'bad'), url => url.username = 'user']) {
    const bad = new URL(next); change(bad); assert.equal(canvasNextUrl(first, bad), null);
  }
});

test('bounded pagination resumes exactly after collected pages and retains records on subsequent failure', async () => {
  const initialUrl = canvasApiUrl(baseUrl, 'courses', { per_page: 100 });
  const second = new URL(initialUrl); second.searchParams.set('page', '2');
  const first = await collectCanvasList({ initialUrl, maxPages: 1, fetchPage: async () => ({ data: [{ id: '1' }], linkNext: second.href }) });
  assert.equal(first.truncated, true); assert.equal(first.nextCursor, second.href);
  const resumed = await collectCanvasList({ initialUrl, cursor: first.nextCursor, fetchPage: async url => { assert.equal(url.href, second.href); return { data: [{ id: '2' }], linkNext: null }; } });
  assert.equal(resumed.truncated, false); assert.equal(resumed.items[0].id, '2');
  let count = 0;
  const failed = await collectCanvasList({ initialUrl, fetchPage: async () => { if (count++) throw { status: 503, kind: 'canvas' }; return { data: [{ id: '1' }], linkNext: second.href }; } });
  assert.deepEqual(failed.items, [{ id: '1' }]); assert.equal(failed.nextCursor, second.href); assert.equal(failed.error.status, 503);
});

test('pagination rejects repeated links, cross-resource links, non-list responses and propagates rejected tokens', async () => {
  const initialUrl = canvasApiUrl(baseUrl, 'courses');
  assert.equal((await collectCanvasList({ initialUrl, fetchPage: async () => ({ data: [], linkNext: initialUrl.href }) })).reason, 'repeated-page');
  assert.equal((await collectCanvasList({ initialUrl, fetchPage: async () => ({ data: [], linkNext: 'https://evil.example/courses' }) })).reason, 'unsafe-next-link');
  assert.equal((await collectCanvasList({ initialUrl, fetchPage: async () => ({ data: { errors: [] } }) })).reason, 'invalid-list');
  await assert.rejects(collectCanvasList({ initialUrl, fetchPage: async () => { throw Object.assign(new Error('rejected'), { status: 401, kind: 'auth' }); } }), /rejected/);
});

test('collector retains more than fifteen courses and completed, undated, non-app subjects', async () => {
  const f = fixture({ list: async endpoint => endpoint === 'courses' ? page(Array.from({ length: 17 }, (_, i) => ({ id: String(i + 1), name: `Literature ${i}` }))) : endpoint.endsWith('/assignments') ? page([{ id: '2', name: 'Reading', due_at: null, submission: { workflow_state: 'graded', score: 0 } }]) : null });
  const result = await collectCanvasSnapshot(f);
  assert.equal(result.courses.length, 17); assert.equal(result.coursesTruncated, false);
  assert.equal(result.courses[0].assignments[0].dueAt, null); assert.equal(result.courses[0].assignments[0].submission.score, 0);
  assert.equal(f.calls.find(call => call.endpoint === 'courses').query['include[]'].includes('syllabus_body'), true);
});

test('module fallback collects omitted or incomplete inline items and retains distinct placements', async () => {
  const f = fixture({ list: async endpoint => {
    if (endpoint.endsWith('/modules')) return page([{ id: '10', name: 'First', items: [{ id: '20', type: 'Assignment', content_id: '2' }], items_count: 2 }, { id: '11', name: 'Second' }]);
    if (endpoint.endsWith('/modules/10/items')) return page([{ id: '20', type: 'Assignment', content_id: '2' }, { id: '21', type: 'Page', page_url: 'lesson' }]);
    if (endpoint.endsWith('/modules/11/items')) return page([{ id: '22', type: 'Assignment', content_id: '2' }]);
    if (endpoint.endsWith('/assignments')) return page([{ id: '2', name: 'Essay' }]);
    return null;
  }});
  const result = await collectCanvasSnapshot(f);
  assert.equal(result.courses[0].modules[0].items.length, 2);
  const source = result.courses[0].sources.find(item => item.type === 'assignment' && item.id === '2');
  assert.equal(source.placements.length, 2);
  assert.deepEqual(f.calls.find(call => call.endpoint.endsWith('/modules')).query['include[]'], ['items', 'content_details']);
});

test('denied page index does not hide front page or syllabus, and failures remain distinct from empty sources', async () => {
  const f = fixture({
    get: async endpoint => endpoint === 'courses/1' ? { id: '1', syllabus_body: '<p>Course schedule</p>', time_zone: 'America/Chicago' } : endpoint.endsWith('/front_page') ? { page_id: '5', url: 'home', body: '<p>Home schedule</p>' } : null,
    list: async endpoint => { if (endpoint.endsWith('/pages')) throw { status: 403 }; if (endpoint.endsWith('/files')) throw { status: 503 }; return null; },
  });
  const result = await collectCanvasSnapshot(f), course = result.courses[0];
  assert.equal(course.syllabusHtml, '<p>Course schedule</p>'); assert.equal(course.frontPage.bodyHtml, '<p>Home schedule</p>');
  assert.equal(course.collection.pages.state, 'denied'); assert.equal(course.collection.files.state, 'failed'); assert.equal(course.collection.folders.state, 'empty');
  assert.equal(result.collection.complete, false);
});

test('unfinished collection resumes cached sources, combines list pages without duplicate courses, then starts fresh', async () => {
  const state = createCanvasCollectionState(); let coursesCalls = 0;
  const f = fixture({ list: async (endpoint, query, options) => {
    if (endpoint !== 'courses') return null;
    coursesCalls++;
    if (coursesCalls === 1) return { items: [{ id: '1', name: 'Course' }], truncated: true, nextCursor: 'next-page' };
    if (coursesCalls === 2) { assert.equal(options.cursor, 'next-page'); return page([{ id: '1', name: 'Course' }, { id: '2', name: 'Other' }]); }
    return page([{ id: '3', name: 'Refreshed' }]);
  }});
  const first = await collectCanvasSnapshot({ ...f, state }); assert.equal(first.coursesTruncated, true);
  const second = await collectCanvasSnapshot({ ...f, state }); assert.equal(second.courses.length, 2); assert.equal(second.collection.complete, true);
  const third = await collectCanvasSnapshot({ ...f, state }); assert.deepEqual(third.courses.map(course => course.id), ['3']);
});

test('own submission feedback excludes other learners; calendar includes both event and assignment contexts', async () => {
  const f = fixture({ list: async endpoint => {
    if (endpoint.endsWith('/assignments')) return page([{ id: '2', name: 'Essay' }]);
    if (endpoint.endsWith('/students/submissions')) return page([{ id: '8', assignment_id: '2', user_id: '40', workflow_state: 'submitted', submission_comments: [{ id: '4', comment: 'Please review', author_name: 'Teacher' }] }, { id: '9', assignment_id: '2', user_id: '41', submission_comments: [{ comment: 'Other student private feedback' }] }]);
    if (endpoint === 'calendar_events') return page([{ id: 'assignment_2', context_code: 'course_1', title: 'Essay deadline', assignment: { id: '2' } }, { id: '99', context_code: 'course_99', title: 'Foreign' }]);
    return null;
  }});
  const result = await collectCanvasSnapshot(f), course = result.courses[0];
  assert.equal(course.submissions.length, 1); assert.equal(course.assignments[0].submission.workflowState, 'submitted');
  assert.equal(JSON.stringify(result).includes('Other student private feedback'), false);
  assert.equal(f.calls.find(call => call.endpoint.endsWith('/students/submissions')).query['student_ids[]'], '40');
  assert.equal(course.calendarEvents.length, 2); assert.equal(course.calendarEvents[0].assignmentId, '2');
  for (const call of f.calls.filter(call => call.endpoint === 'calendar_events')) { assert.equal(call.query.all_events, true); assert.equal(call.query['context_codes[]'], 'course_1'); }
});

test('page bodies get typed fallback; signed file URLs and locked bodies never enter snapshots', async () => {
  const f = fixture({
    get: async endpoint => endpoint.endsWith('/pages/page_id:8') ? { page_id: '8', body: '<p>Complete reading</p>', url: 'reading' } : null,
    list: async endpoint => endpoint.endsWith('/pages') ? page([{ page_id: '8', url: 'reading' }, { page_id: '9', url: 'locked', locked_for_user: true, body: 'Hidden text' }]) : endpoint.endsWith('/files') ? page([{ id: '4', display_name: 'Syllabus.pdf', url: 'https://storage.example/private?token=secret', html_url: 'https://school.example/file?verifier=secret' }]) : null,
  });
  const result = await collectCanvasSnapshot(f), course = result.courses[0];
  assert.equal(course.pages[0].bodyHtml, '<p>Complete reading</p>'); assert.equal(course.pages[1].bodyHtml, null);
  assert.equal(JSON.stringify(result).includes('secret'), false); assert.equal(course.files[0].htmlUrl, `${baseUrl}/courses/1/files/4`);
});


test('403 throttling remains retryable and inaccessible sources keep partial disclosure after collection finishes', async () => {
  const f = fixture({ list: async endpoint => { if (endpoint.endsWith('/files')) throw { status: 403, kind: 'rate' }; if (endpoint.endsWith('/folders')) throw { status: 403, kind: 'forbidden' }; return null; } });
  const result = await collectCanvasSnapshot(f);
  assert.equal(result.courses[0].collection.files.state, 'failed');
  assert.equal(result.courses[0].collection.folders.state, 'denied');
  assert.equal(result.collection.partial, true); assert.equal(result.collection.unavailableCount, 1);
});

test('aggregate session storage is bounded and capacity limitations cannot claim completeness or resumability', async () => {
  const state = createCanvasCollectionState();
  const description = 'x'.repeat(1024 * 1024);
  const f = fixture({ list: async endpoint => endpoint.endsWith('/assignments') ? page(Array.from({ length: 30 }, (_, index) => ({ id: String(index + 1), name: `Assignment ${index}`, description }))) : null });
  const result = await collectCanvasSnapshot({ ...f, state });
  assert.ok(state.rawBytes <= CANVAS_COLLECTION_LIMITS.rawBytes);
  assert.equal(result.collection.complete, false); assert.equal(result.collection.partial, true);
  assert.ok(result.collection.capacityCount > 0);
  assert.equal(result.courses[0].collection.assignments.state, 'capacity');
  assert.equal(result.courses[0].collection.assignments.resumable, false);
  assert.ok(result.courses[0].assignments.length > 0); assert.ok(result.courses[0].assignments.length < 30);
  assert.match(result.collection.notice, /cannot resume/);
  const initialCount = f.calls.filter(call => call.endpoint.endsWith('/assignments')).length;
  const resumed = await collectCanvasSnapshot({ ...f, state });
  assert.equal(f.calls.filter(call => call.endpoint.endsWith('/assignments')).length, initialCount);
  assert.deepEqual(resumed.courses[0].assignments.map(item => item.id), result.courses[0].assignments.map(item => item.id));
  assert.equal(resumed.collection.complete, false);
});
