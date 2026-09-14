import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canvasDetailRequest, normalizeCanvasDetail, appendRetrievalHints } from '../canvas-retrieval.js';

const BASE = 'https://school.instructure.com';
const NOW = Date.parse('2026-09-14T23:00:00Z');
const ref = (type = 'assignment', over = {}) => ({ courseId: '12', type, id: '34', ...over });
const discovery = (over = {}) => ({ ...ref(), title: 'Instructor directions', body: '<p>Readable instructions.</p>', contentStatus: 'available', ...over });

test('typed detail requests only produce the approved course-scoped GET paths', () => {
  for (const [type, path] of [['assignment', 'assignments'], ['quiz', 'quizzes'], ['discussion', 'discussion_topics'], ['file', 'files']]) {
    assert.deepEqual(canvasDetailRequest(ref(type)), { endpoint: `courses/12/${path}/34`, query: type === 'assignment' ? { override_assignment_dates: true } : {} });
  }
  assert.equal(canvasDetailRequest(ref('page', { id: null, pageUrl: 'week-3' })).endpoint, 'courses/12/pages/week-3');
  assert.equal(canvasDetailRequest(ref('page')).endpoint, 'courses/12/pages/page_id%3A34');
  assert.equal(canvasDetailRequest(ref('page', { pageUrl: '34' })).endpoint, 'courses/12/pages/34');
  assert.equal(canvasDetailRequest(ref('page', { pageUrl: '计算介绍' })).endpoint, `courses/12/pages/${encodeURIComponent('计算介绍')}`);
});

test('malformed IDs, other tool types, traversal, URLs, and encoded separators are rejected', () => {
  for (const bad of [ref('external_tool'), ref('Assignment'), ref('assignment', { courseId: '../2' }), ref('assignment', { id: Number.MAX_SAFE_INTEGER + 1 }), ref('assignment', { id: '1?student_id=2' }), ref('assignment', { pageUrl: 'unexpected' })]) {
    assert.throws(() => canvasDetailRequest(bad), /Invalid Canvas/);
  }
  for (const pageUrl of ['../secret', 'foo/bar', 'foo\\bar', 'x?y=z', 'x#y', 'a..b', '%2fsecret', '%252fsecret', 'https://elsewhere/a', 'a\nb', '', 'x'.repeat(256)]) {
    assert.throws(() => canvasDetailRequest(ref('page', { pageUrl })), /Invalid Canvas/);
  }
  assert.equal(canvasDetailRequest(ref('assignment', { id: '9007199254740993' })).endpoint, 'courses/12/assignments/9007199254740993');
});

test('normalization preserves explicit no-date and omits credentials or unrelated users', () => {
  const raw = { id: 34, course_id: 12, name: 'Instructions', description: '<p>Explain your reasoning.</p>', due_at: null, html_url: `${BASE}/courses/12/assignments/34`, updated_at: '2026-09-14T12:00:00Z', token: 'private', submission: { user_id: 999 }, all_dates: [{ due_at: '2026-10-01T00:00:00Z' }] };
  const normalized = normalizeCanvasDetail(raw, ref(), BASE);
  assert.equal(normalized.dueAt, null);
  assert.equal(normalized.dueAtPresent, true);
  assert.equal(normalized.body, raw.description);
  assert.equal(normalized.contentStatus, 'available');
  assert.equal(normalized.htmlUrl, raw.html_url);
  assert.equal(normalized.updatedAt, raw.updated_at);
  assert.ok(Number.isFinite(Date.parse(normalized.readAt)));
  assert.equal('token' in normalized, false);
  assert.equal('submission' in normalized, false);
  assert.equal(normalizeCanvasDetail({ id: 34 }, ref(), BASE).dueAtPresent, false);
  assert.equal(normalizeCanvasDetail({ id: 34, due_at: 'bad date' }, ref(), BASE).dueAt, null);
});

test('normalization uses the correct body field and does not fetch or expose file downloads', () => {
  const page = normalizeCanvasDetail({ page_id: 88, url: 'read-me', title: 'Read', body: '<p>Page body</p>' }, ref('page', { id: null, pageUrl: 'read-me' }), BASE);
  assert.equal(page.id, '88');
  assert.equal(page.pageUrl, 'read-me');
  assert.equal(page.body, '<p>Page body</p>');
  assert.equal(normalizeCanvasDetail({ id: 34, message: '<p>Discussion prompt</p>' }, ref('discussion'), BASE).body, '<p>Discussion prompt</p>');
  assert.equal(normalizeCanvasDetail({ id: 34, description: '<p>Quiz directions</p>', access_code: 'secret' }, ref('quiz'), BASE).body, '<p>Quiz directions</p>');
  const file = normalizeCanvasDetail({ id: 34, display_name: 'Reading.pdf', url: `${BASE}/files/34/download?verifier=secret`, preview_url: 'https://cdn.example/private', body: 'Not file content' }, ref('file'), BASE);
  assert.equal(file.title, 'Reading.pdf');
  assert.equal(file.body, null);
  assert.equal(file.contentStatus, 'metadata-only');
  assert.equal(file.htmlUrl, null);
  assert.doesNotMatch(JSON.stringify(file), /verifier|secret|cdn\.example/);
});

test('same-origin source links remain safe while cross-origin and signed links are excluded', () => {
  for (const html_url of ['https://school.instructure.com.evil.example/a', 'https://elsewhere.example/a', 'http://school.instructure.com/a', 'javascript:alert(1)', `https://user:secret@school.instructure.com/a`, `${BASE}/files/34?verifier=secret`]) {
    assert.equal(normalizeCanvasDetail({ id: 34, html_url }, ref(), BASE).htmlUrl, null);
  }
  assert.equal(normalizeCanvasDetail({ id: 34 }, ref('file', { htmlUrl: `${BASE}/courses/12/modules/items/56` }), BASE).htmlUrl, `${BASE}/courses/12/modules/items/56`);
  assert.throws(() => normalizeCanvasDetail({ id: 99 }, ref(), BASE), /did not match/);
  assert.throws(() => normalizeCanvasDetail({ id: 34, course_id: 99 }, ref(), BASE), /did not match/);
});

test('detail date evidence keeps invalid, absent and explicit null dates distinct', () => {
  const variants = [ [{}, 'not-provided', false], [{ due_at: null }, 'no-date', true],
    [{ due_at: 'not-a-date' }, 'invalid', true], [{ due_at: '' }, 'invalid', true],
    [{ due_at: '2026-09-14T12:00:00Z' }, 'dated', true] ];
  for (const [fields, status, present] of variants) {
    const value = normalizeCanvasDetail({ id: 34, ...fields }, ref(), BASE);
    assert.equal(value.dueDateStatus, status);
    assert.equal(value.dueAtPresent, present);
  }
});

test('content limits and locked content are explicit rather than silently treated as complete', () => {
  const long = normalizeCanvasDetail({ id: 34, description: 'x'.repeat(60001) }, ref(), BASE);
  assert.equal(long.body.length, 60000);
  assert.equal(long.contentStatus, 'truncated');
  const trimmedRubric = normalizeCanvasDetail({ id: 34, description: 'Brief instructions', rubric: Array.from({ length: 51 }, (_, id) => ({ id, description: 'Criterion' })) }, ref(), BASE);
  assert.equal(trimmedRubric.contentStatus, 'truncated', 'a shortened rubric must not be presented as complete');
  const locked = normalizeCanvasDetail({ id: 34, description: 'Hidden instructions', locked_for_user: true, rubric: [{ points: 10 }] }, ref(), BASE);
  assert.equal(locked.body, null);
  assert.equal(locked.contentStatus, 'locked');
  assert.deepEqual(locked.rubric, []);
  assert.equal(normalizeCanvasDetail({ id: 34, description: 'Draft', published: false }, ref(), BASE).contentStatus, 'locked');
  assert.equal(normalizeCanvasDetail({ id: 34, description: ' ' }, ref(), BASE).contentStatus, 'empty');
});

test('retrieval hints append immutably and preserve every previous rule and version', () => {
  const old = Object.freeze({ ruleId: 'original', version: 7, text: 'Keep this rule exactly.', canvasIdentity: 'prior-account' });
  const existing = Object.freeze([old, null]);
  const out = appendRetrievalHints(existing, [discovery()], { canvasIdentity: 'current-account', now: NOW });
  assert.equal(out.length, 3);
  assert.equal(out[0], old);
  assert.equal(out[1], null);
  assert.equal(existing.length, 2);
  assert.match(out[2].ruleId, /^[0-9a-f-]{36}$/);
  assert.deepEqual({ ...out[2], ruleId: 'generated' }, { ruleId: 'generated', version: 1, canvasIdentity: 'current-account', courseId: '12', type: 'assignment', id: '34', pageUrl: null, label: 'Instructor directions', createdAt: new Date(NOW).toISOString(), reason: 'Retrieved readable Canvas content from this reference.' });
  assert.equal('body' in out[2], false, 'rules retain reference metadata, not course bodies');
});

test('hints reject other identities, failed/empty/metadata responses, and unidentified resources', () => {
  const attempts = [discovery({ canvasIdentity: 'other-account' }), discovery({ contentStatus: 'locked' }), discovery({ body: '' }), discovery({ contentStatus: 'error' }), discovery({ type: 'file', contentStatus: 'metadata-only' }), discovery({ id: null }), discovery({ courseId: null })];
  assert.deepEqual(appendRetrievalHints([], attempts, { canvasIdentity: 'current-account', now: NOW }), []);
  assert.deepEqual(appendRetrievalHints([], [discovery()], { now: NOW }), []);
});

test('hint deduplication uses content identity across source titles, page IDs, and page slugs', () => {
  const first = appendRetrievalHints([], [discovery(), discovery({ title: 'Same content in another module' })], { canvasIdentity: 'account', now: NOW });
  assert.equal(first.length, 1);
  assert.equal(appendRetrievalHints(first, [discovery()], { canvasIdentity: 'account', now: NOW }).length, 1);
  const pages = appendRetrievalHints([], [discovery({ type: 'page', id: '88', pageUrl: 'read-me' })], { canvasIdentity: 'account', now: NOW });
  assert.equal(appendRetrievalHints(pages, [discovery({ type: 'page', id: '88', pageUrl: null }), discovery({ type: 'page', id: null, pageUrl: 'read-me' })], { canvasIdentity: 'account', now: NOW }).length, 1);
  assert.equal(appendRetrievalHints(first, [discovery()], { canvasIdentity: 'different-account', now: NOW }).length, 2);
});

test('successful syllabus references are retained and the cap never removes old rules', () => {
  const syllabus = discovery({ type: 'syllabus', id: null, body: 'Course syllabus', title: 'Syllabus' });
  const out = appendRetrievalHints([], [syllabus], { canvasIdentity: 'account', now: NOW });
  assert.equal(out[0].type, 'syllabus');
  assert.equal(out[0].id, '12');
  const existing = Array.from({ length: 1001 }, (_, id) => ({ ruleId: `old-${id}`, version: 1 }));
  const kept = appendRetrievalHints(existing, [discovery()], { canvasIdentity: 'account', now: NOW });
  assert.deepEqual(kept, existing);
  const near = existing.slice(0, 999);
  assert.equal(appendRetrievalHints(near, [discovery(), discovery({ id: '35' })], { canvasIdentity: 'account', now: NOW }).length, 1000);
});
