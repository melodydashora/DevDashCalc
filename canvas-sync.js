// Read-only Canvas collection. Credentials and resumable raw records stay in
// the server-owned session; the returned snapshot contains normalized data.
import {
  normalizeCourse, normalizeGroup, normalizeAssignment, normalizeModule,
  normalizeModuleProgress, normalizeMissingSubmission, normalizeCanvasPage,
  normalizeCanvasDiscussion, CANVAS_CONTENT_LIMITS,
} from './public/canvas-insights.js';
import { courseTimeStatus } from './public/student-home.js';

export const CANVAS_COLLECTION_LIMITS = Object.freeze({ rawBytes: 24 * 1024 * 1024, recordsPerSource: 10000, courseCount: 200 });
const ID = /^[0-9]{1,20}$/;
const id = value => (typeof value === 'string' || Number.isSafeInteger(value)) && ID.test(String(value)) ? String(value) : null;
const text = (value, limit = 60000) => typeof value === 'string' ? value.slice(0, limit) : null;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const array = value => Array.isArray(value) ? value : [];
const rawKey = value => typeof value?.id === 'string' || Number.isSafeInteger(value?.id) ? String(value.id) : id(value?.page_id) || value?.url || (value?.assignment_id ? `${value.assignment_id}:${value.user_id || ''}` : null);
const terminal = status => ['complete', 'empty', 'denied', 'not-found'].includes(status);
const failure = error => error?.kind === 'budget' ? 'unread' : ['rate', 'network', 'timeout', 'size'].includes(error?.kind) ? 'failed' : error?.status === 403 ? 'denied' : error?.status === 404 ? 'not-found' : 'failed';
const dedupe = (items, key = item => id(item?.id) || id(item?.page_id) || item?.url) => {
  const found = new Map();
  for (const item of array(items)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const identity = key(item);
    if (identity) found.set(String(identity), { ...found.get(String(identity)), ...item });
  }
  return [...found.values()];
};

// No arbitrary API family, host, or path can enter the authenticated transport.
export function canvasApiUrl(baseUrl, endpoint, query = {}, api = 'v1') {
  if (!['v1', 'quiz/v1'].includes(api) || typeof endpoint !== 'string' || !endpoint || endpoint.startsWith('/') || /[?#\\\u0000-\u0020]/.test(endpoint) || /%(?:2e|2f|5c|00|3f|23)/i.test(endpoint) || /(?:^|\/)\.\.(?:\/|$)/.test(endpoint)) throw new TypeError('Invalid Canvas endpoint.');
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password) throw new TypeError('Invalid Canvas origin.');
  const url = new URL(`${base.href.replace(/\/$/, '')}/api/${api}/${endpoint}`);
  for (const [key, values] of Object.entries(query)) for (const value of Array.isArray(values) ? values : [values]) url.searchParams.append(key, String(value));
  return url;
}

// Pagination may change paging parameters, never the resource, learner filter,
// or query scope. This prevents a hostile next-link from broadening a request.
export function canvasNextUrl(initialUrl, value) {
  try {
    const initial = new URL(initialUrl), next = new URL(value, initial);
    if (next.origin !== initial.origin || next.pathname !== initial.pathname || next.username || next.password || next.hash) return null;
    if ([...next.searchParams.keys()].some(key => /^(?:access_token|token|api_key|verifier|signature|x-amz-.+)$/i.test(key))) return null;
    const pagingKey = key => /^(?:page|per_page|bookmark|cursor|after|before|next|last|offset)$/.test(key);
    for (const key of new Set([...initial.searchParams.keys(), ...next.searchParams.keys()])) {
      if (!pagingKey(key) && JSON.stringify(initial.searchParams.getAll(key).sort()) !== JSON.stringify(next.searchParams.getAll(key).sort())) return null;
    }
    return next;
  } catch { return null; }
}

// A single bounded page pass is resumable; failures never erase prior pages.
export async function collectCanvasList({ initialUrl, cursor, fetchPage, maxPages = 5, itemKey = null }) {
  const initial = new URL(initialUrl);
  let url = cursor ? canvasNextUrl(initial, cursor) : initial;
  if (!url) throw new TypeError('Invalid Canvas continuation.');
  const items = [], seen = new Set();
  for (let page = 0; page < Math.max(1, maxPages); page++) {
    if (seen.has(url.href)) return { items, truncated: true, nextCursor: null, reason: 'repeated-page' };
    seen.add(url.href);
    let response;
    try { response = await fetchPage(url); }
    catch (error) {
      if (error?.kind === 'auth' || error?.status === 401) throw error;
      return { items, truncated: true, nextCursor: url.href, error: { kind: error?.kind || 'canvas', status: error?.status || 0 } };
    }
    const values = itemKey ? response.data?.[itemKey] : response.data;
    if (!Array.isArray(values)) return { items, truncated: true, nextCursor: null, reason: 'invalid-list' };
    items.push(...values);
    if (!response.linkNext) return { items, truncated: false, nextCursor: null };
    const next = canvasNextUrl(initial, response.linkNext);
    if (!next) return { items, truncated: true, nextCursor: null, reason: 'unsafe-next-link' };
    url = next;
  }
  return { items, truncated: true, nextCursor: url.href };
}

export function canvasPublicLink(baseUrl, value, external = false) {
  if (typeof value !== 'string' || !value || value.length > 4096) return null;
  try {
    const base = new URL(baseUrl), url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (!external && url.origin !== base.origin)) return null;
    if ([...url.searchParams.keys()].some(key => /^(?:access_token|token|api_key|verifier|signature|x-amz-.+)$/i.test(key))) return null;
    return url.href;
  } catch { return null; }
}

export function createCanvasCollectionState() { return { records: new Map(), complete: false, startedAt: null, rawBytes: 0 }; }

/** Injected GET adapters: get(endpoint, query, {api}) => object;
 * list(endpoint, query, {api,cursor,itemKey}) => {items,truncated,nextCursor,error}.
 * Keep state private to one authenticated Canvas session. An incomplete cycle
 * resumes on the next pull; after completion the next pull starts a fresh one.
 */
export async function collectCanvasSnapshot({ baseUrl, user, get, list, state = createCanvasCollectionState(), now = Date.now() }) {
  if (state.complete || state.startedAt && now - Date.parse(state.startedAt) > 15 * 60_000) { state.records.clear(); state.complete = false; state.startedAt = null; state.rawBytes = 0; }
  state.startedAt ||= new Date(now).toISOString();
  const readAt = new Date(now).toISOString();
  const records = state.records, statuses = {};
  state.rawBytes ||= 0;
  function retain(key, value, status, cursor) {
    const priorBytes = records.get(key)?.bytes || 0;
    const available = Math.max(0, CANVAS_COLLECTION_LIMITS.rawBytes - state.rawBytes + priorBytes);
    let bytes = value === null || Array.isArray(value) && !value.length ? 0 : Buffer.byteLength(JSON.stringify(value));
    if (bytes > available || Array.isArray(value) && value.length > CANVAS_COLLECTION_LIMITS.recordsPerSource) {
      const originalCount = Array.isArray(value) ? value.length : value ? 1 : 0;
      if (Array.isArray(value)) {
        const retained = []; bytes = 2;
        for (const item of value) {
          const itemBytes = Buffer.byteLength(JSON.stringify(item)) + (retained.length ? 1 : 0);
          if (retained.length >= CANVAS_COLLECTION_LIMITS.recordsPerSource || bytes + itemBytes > available) break;
          retained.push(item); bytes += itemBytes;
        }
        value = retained; if (!retained.length) bytes = 0;
      } else { value = null; bytes = 0; }
      status = { ...status, state: 'capacity', reason: 'session-capacity', count: Array.isArray(value) ? value.length : 0, omittedCount: originalCount - (Array.isArray(value) ? value.length : 0), truncated: true, resumable: false };
      cursor = null;
    }
    state.rawBytes += bytes - priorBytes;
    records.set(key, { value, status, cursor, bytes });
    return { value, status };
  }
  const safe = value => canvasPublicLink(baseUrl, value);
  const courseLink = (courseId, path = '') => `${baseUrl}/courses/${courseId}${path}`;
  async function read(key, endpoint, query = {}, { single = false, api = 'v1', itemKey = null, mandatory = false } = {}) {
    const previous = records.get(key);
    if (previous && (terminal(previous.status.state) || previous.status.state === 'capacity')) { statuses[key] = previous.status; return previous.value; }
    let value = single ? null : [], status;
    try {
      if (single) {
        value = await get(endpoint, query, { api });
        status = { state: value ? 'complete' : 'empty', count: value ? 1 : 0, readAt };
      } else {
        const page = await list(endpoint, query, { api, cursor: previous?.cursor || null, itemKey });
        // A cursor continues prior pages; retrying an unsafe/broken page chain
        // starts afresh instead of treating old records as current evidence.
        value = dedupe([...(previous?.cursor || page.error && !array(page.items).length ? array(previous?.value) : []), ...array(page.items)], rawKey);
        const issue = page.error ? failure(page.error) : page.truncated ? 'truncated' : value.length ? 'complete' : 'empty';
        status = { state: issue, count: value.length, readAt, truncated: Boolean(page.truncated), reason: page.reason || null, resumable: Boolean(page.nextCursor) };
        if (mandatory && page.error && !value.length) throw Object.assign(new Error('Canvas could not list the enrolled courses.'), page.error);
        ({ value, status } = retain(key, value, status, page.nextCursor || null));
      }
    } catch (error) {
      if (error?.kind === 'auth' || error?.status === 401 || mandatory && !previous && error?.kind !== 'budget') throw error;
      value = previous?.value ?? value;
      status = { state: failure(error), count: single ? value ? 1 : 0 : value.length, readAt, truncated: Boolean(previous?.cursor), resumable: Boolean(previous?.cursor) };
    }
    if (single || !records.has(key) || records.get(key).status !== status) ({ value, status } = retain(key, value, status, previous?.cursor || null));
    statuses[key] = status;
    return value;
  }
  const rawCourses = await read('courses', 'courses', {
    enrollment_state: 'active', 'include[]': ['total_scores', 'term', 'teachers', 'syllabus_body', 'current_grading_period_scores'],
  }, { mandatory: true });
  const rawMissing = await read('missingSubmissions', 'users/self/missing_submissions', { 'include[]': 'course_id' });
  const courses = [];
  const timingRank = { current: 0, unknown: 1, upcoming: 2, past: 3 };
  rawCourses.sort((a, b) => timingRank[courseTimeStatus(normalizeCourse(a), now)] - timingRank[courseTimeStatus(normalizeCourse(b), now)]);
  if (rawCourses.length > CANVAS_COLLECTION_LIMITS.courseCount) statuses.courses = { ...statuses.courses, state: 'capacity', reason: 'course-capacity', omittedCount: rawCourses.length - CANVAS_COLLECTION_LIMITS.courseCount, truncated: true, resumable: false };
  for (const rawCourse of rawCourses.slice(0, CANVAS_COLLECTION_LIMITS.courseCount)) {
    const courseId = id(rawCourse?.id);
    if (!courseId) continue;
    const prefix = `course:${courseId}:`, endpoint = `courses/${courseId}`;
    const scoped = values => array(values).filter(value => !id(value?.course_id) || id(value.course_id) === courseId);
    const details = await read(`${prefix}details`, endpoint, { 'include[]': ['syllabus_body', 'term', 'teachers', 'total_scores'] }, { single: true });
    const mergedCourse = details && (!id(details.id) || id(details.id) === courseId) ? { ...rawCourse, ...details } : rawCourse;
    const normalized = normalizeCourse(mergedCourse);
    const syllabus = text(mergedCourse.syllabus_body);
    const result = {
      ...normalized, timeZone: text(mergedCourse.time_zone, 100), defaultView: text(mergedCourse.default_view, 100),
      startAt: date(mergedCourse.start_at), endAt: date(mergedCourse.end_at),
      teachers: array(mergedCourse.teachers).map(teacher => ({ id: id(teacher.id), name: text(teacher.display_name ?? teacher.name, 500) })).filter(teacher => teacher.id),
      syllabusBody: syllabus, syllabusHtml: syllabus, syllabusBodyHtml: syllabus,
      syllabusTruncated: typeof mergedCourse.syllabus_body === 'string' && mergedCourse.syllabus_body.length > CANVAS_CONTENT_LIMITS.html,
      syllabusUrl: courseLink(courseId, '/assignments/syllabus'), syllabusReadAt: statuses[`${prefix}details`].readAt,
      assignments: [], assignmentGroups: [], modules: [], moduleProgress: null,
      assignmentsError: null, modulesError: null, assignmentsTruncated: false, modulesTruncated: false,
      pages: [], frontPage: null, homePage: null, pagesTruncated: false,
      announcements: [], discussions: [], quizzes: [], newQuizzes: [], files: [], folders: [], calendarEvents: [], submissions: [], gradingPeriods: [],
      collection: {}, sources: [],
    };
    // Group embedding can be omitted or incomplete. An independent assignment
    // index is essential for teachers who do not use groups/modules at all.
    const rawGroups = scoped(await read(`${prefix}groups`, `${endpoint}/assignment_groups`, { 'include[]': ['assignments', 'submission', 'all_dates'], override_assignment_dates: true }));
    const rawAssignments = scoped(await read(`${prefix}assignments`, `${endpoint}/assignments`, { 'include[]': ['submission', 'all_dates'], override_assignment_dates: true }));
    const assignments = dedupe([...rawGroups.flatMap(group => array(group.assignments).map(assignment => ({ ...assignment, assignment_group_id: assignment.assignment_group_id ?? group.id }))), ...rawAssignments]);
    result.assignmentGroups = rawGroups.map(normalizeGroup);
    result.assignments = assignments.map(raw => ({ ...normalizeAssignment(raw), htmlUrl: safe(raw.html_url) }));
    const rawModules = scoped(await read(`${prefix}modules`, `${endpoint}/modules`, { 'include[]': ['items', 'content_details'] }));
    for (const module of rawModules) {
      if (!id(module?.id)) continue;
      let items = Array.isArray(module.items) ? module.items : null;
      if (items === null || number(module.items_count) !== null && module.items_count > items.length) {
        const fetched = await read(`${prefix}module:${module.id}`, `${endpoint}/modules/${module.id}/items`, { 'include[]': 'content_details' });
        items = dedupe([...array(items), ...fetched]);
        if (!items.length && !terminal(statuses[`${prefix}module:${module.id}`].state)) items = null;
      }
      const normalizedModule = normalizeModule(module, items);
      if (normalizedModule.items) normalizedModule.items = normalizedModule.items.map((item, index) => ({
        ...item, htmlUrl: safe(item.htmlUrl), externalUrl: canvasPublicLink(baseUrl, items[index]?.external_url, true),
      }));
      result.modules.push(normalizedModule);
    }
    result.moduleProgress = normalizeModuleProgress(await read(`${prefix}moduleProgress`, `${endpoint}/users/self/progress`, {}, { single: true }));
    // Fetch independently: a hidden Pages navigation tab need not hide the
    // home page, and a missing front page says nothing about the page index.
    const rawPages = scoped(await read(`${prefix}pages`, `${endpoint}/pages`, { 'include[]': 'body' }));
    for (let index = 0; index < rawPages.length; index++) {
      const page = rawPages[index];
      // Older Canvas releases omit body from lists despite include[]=body.
      // Use a typed page_id path, never a document-supplied URL.
      if (typeof page.body !== 'string' && id(page.page_id) && page.locked_for_user !== true && page.published !== false) {
        const full = await read(`${prefix}page:${page.page_id}`, `${endpoint}/pages/page_id:${page.page_id}`, {}, { single: true });
        if (full && (!id(full.page_id) || id(full.page_id) === id(page.page_id))) rawPages[index] = { ...page, ...full };
      }
    }
    result.pages = dedupe(rawPages, page => id(page.page_id) || page.url).map(raw => ({ ...normalizeCanvasPage(raw), htmlUrl: safe(raw.html_url), bodyHtml: raw.locked_for_user || raw.published === false ? null : text(raw.body) }));
    const frontPage = await read(`${prefix}frontPage`, `${endpoint}/front_page`, {}, { single: true });
    if (frontPage) result.frontPage = { ...normalizeCanvasPage(frontPage), htmlUrl: safe(frontPage.html_url), bodyHtml: frontPage.locked_for_user || frontPage.published === false ? null : text(frontPage.body) };
    result.homePage = result.frontPage;
    result.frontPageReadAt = statuses[`${prefix}frontPage`].readAt;
    const rawAnnouncements = scoped(await read(`${prefix}announcements`, `${endpoint}/discussion_topics`, { only_announcements: true }));
    const rawDiscussions = scoped(await read(`${prefix}discussions`, `${endpoint}/discussion_topics`, { exclude_context_module_locked_topics: false }));
    const discussion = raw => ({ ...normalizeCanvasDiscussion(raw), htmlUrl: safe(raw.html_url), bodyHtml: raw.locked_for_user || raw.published === false ? null : text(raw.message), postedAt: date(raw.posted_at), authorId: id(raw.author?.id), authorName: text(raw.author?.display_name, 500), isAnnouncement: Boolean(raw.is_announcement) });
    result.announcements = rawAnnouncements.map(discussion);
    result.discussions = rawDiscussions.filter(raw => !raw.is_announcement).map(discussion);
    const quiz = raw => ({ id: id(raw.id), assignmentId: id(raw.assignment_id), title: text(raw.title, 4000), bodyHtml: text(raw.description), htmlUrl: safe(raw.html_url), dueAt: date(raw.due_at), unlockAt: date(raw.unlock_at), lockAt: date(raw.lock_at), quizType: text(raw.quiz_type, 100), published: typeof raw.published === 'boolean' ? raw.published : null, bodyTruncated: typeof raw.description === 'string' && raw.description.length > 60000 });
    result.quizzes = scoped(await read(`${prefix}quizzes`, `${endpoint}/quizzes`)).map(quiz);
    result.newQuizzes = scoped(await read(`${prefix}newQuizzes`, `${endpoint}/quizzes`, {}, { api: 'quiz/v1' })).map(quiz);
    result.files = scoped(await read(`${prefix}files`, `${endpoint}/files`)).map(raw => ({
      id: id(raw.id), folderId: id(raw.folder_id), name: text(raw.display_name ?? raw.filename, 4000), filename: text(raw.filename, 4000),
      contentType: text(raw['content-type'], 200), size: number(raw.size), updatedAt: date(raw.updated_at),
      lockedForUser: raw.locked_for_user === true, hiddenForUser: raw.hidden_for_user === true,
      htmlUrl: id(raw.id) ? courseLink(courseId, `/files/${raw.id}`) : null, contentStatus: 'metadata-only',
    })).filter(file => file.id);
    result.folders = scoped(await read(`${prefix}folders`, `${endpoint}/folders`)).map(raw => ({ id: id(raw.id), parentFolderId: id(raw.parent_folder_id), name: text(raw.name, 4000), fullName: text(raw.full_name, 4000), filesCount: number(raw.files_count), foldersCount: number(raw.folders_count), lockedForUser: raw.locked_for_user === true }));
    for (const type of ['event', 'assignment']) {
      const events = await read(`${prefix}calendar:${type}`, 'calendar_events', { 'context_codes[]': `course_${courseId}`, all_events: true, type });
      result.calendarEvents.push(...events.filter(raw => !raw.context_code || raw.context_code === `course_${courseId}`).map(raw => ({ id: id(raw.id) || text(raw.id, 100), type, assignmentId: id(raw.assignment?.id), title: text(raw.title, 4000), bodyHtml: text(raw.description), startAt: date(raw.start_at), endAt: date(raw.end_at), allDay: raw.all_day === true, allDayDate: text(raw.all_day_date, 20), htmlUrl: safe(raw.html_url), locationName: text(raw.location_name, 1000) })));
    }
    if (id(user?.id)) {
      const ownSubmissions = await read(`${prefix}submissions`, `${endpoint}/students/submissions`, { 'student_ids[]': id(user.id), 'include[]': ['submission_comments', 'submission_history', 'rubric_assessment'] });
      result.submissions = ownSubmissions.filter(raw => id(raw.user_id) === id(user.id)).map(raw => ({
        assignmentId: id(raw.assignment_id), ...normalizeAssignment({ submission: raw }).submission,
        comments: array(raw.submission_comments).map(comment => ({ id: id(comment.id), authorId: id(comment.author_id), authorName: text(comment.author_name, 500), text: text(comment.comment), createdAt: date(comment.created_at) })),
        history: array(raw.submission_history).map(item => ({ attempt: number(item.attempt), submittedAt: date(item.submitted_at), gradedAt: date(item.graded_at), workflowState: text(item.workflow_state, 100), score: number(item.score), grade: text(item.grade, 100) })),
        rubricAssessment: raw.rubric_assessment && typeof raw.rubric_assessment === 'object' ? Object.fromEntries(Object.entries(raw.rubric_assessment).map(([criterion, value]) => [criterion, { points: number(value?.points), comments: text(value?.comments) }])) : null,
      }));
      const submissionsByAssignment = new Map(result.submissions.map(submission => [submission.assignmentId, submission]));
      result.assignments = result.assignments.map(assignment => ({ ...assignment, submission: submissionsByAssignment.has(assignment.id) ? { ...assignment.submission, ...submissionsByAssignment.get(assignment.id) } : assignment.submission }));
    }
    result.gradingPeriods = (await read(`${prefix}gradingPeriods`, `${endpoint}/grading_periods`, {}, { itemKey: 'grading_periods' })).map(raw => ({ id: id(raw.id), title: text(raw.title, 4000), startAt: date(raw.start_date), endAt: date(raw.end_date), closeAt: date(raw.close_date), weight: number(raw.weight) }));
    result.collection = Object.fromEntries(Object.entries(statuses).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value]));
    const incomplete = name => !['complete', 'empty'].includes(result.collection[name]?.state);
    result.assignmentsTruncated = incomplete('assignments') && incomplete('groups') || Boolean(result.collection.assignments?.truncated || result.collection.groups?.truncated);
    result.assignmentsError = incomplete('assignments') && incomplete('groups') ? 'Canvas did not provide a complete assignment list for this course.' : null;
    result.modulesTruncated = incomplete('modules') || Object.entries(result.collection).some(([key, value]) => key.startsWith('module:') && !['complete', 'empty'].includes(value.state));
    result.modulesError = incomplete('modules') ? 'Canvas did not return the complete modules for this course.' : null;
    result.pagesTruncated = incomplete('pages') || Object.entries(result.collection).some(([key, value]) => key.startsWith('page:') && !['complete', 'empty'].includes(value.state));
    // Canonical sources are distinct from placements: the same assignment in
    // several modules is one source with all its module relationships intact.
    const sourceMap = new Map();
    const source = (type, item, sourceId = item.id || item.pageUrl) => {
      if (!sourceId) return;
      const key = `${courseId}:${type}:${sourceId}`;
      if (!sourceMap.has(key)) sourceMap.set(key, { key, courseId, type, id: String(sourceId), title: item.title || item.name, htmlUrl: item.htmlUrl || null, placements: [] });
    };
    for (const assignment of result.assignments) source('assignment', assignment);
    for (const page of [...result.pages, ...(result.frontPage ? [result.frontPage] : [])]) source('page', page, page.pageUrl || page.id);
    for (const file of result.files) source('file', file);
    for (const item of result.quizzes) source('quiz', item);
    for (const item of result.newQuizzes) source('new-quiz', item);
    for (const item of result.announcements) source('announcement', item);
    for (const item of result.discussions) source('discussion', item);
    for (const module of result.modules) for (const item of array(module.items)) {
      const type = { Assignment: 'assignment', Page: 'page', File: 'file', Discussion: 'discussion', Quiz: 'quiz' }[item.type];
      const resourceId = type === 'page' ? item.pageUrl || item.contentId : item.contentId;
      if (type && resourceId) {
        source(type, item, resourceId);
        sourceMap.get(`${courseId}:${type}:${resourceId}`).placements.push({ moduleId: module.id, itemId: item.id, title: item.title, position: item.position, indent: item.indent });
      }
    }
    result.sources = [...sourceMap.values()];
    courses.push(result);
  }
  courses.sort((a, b) => timingRank[courseTimeStatus(a, now)] - timingRank[courseTimeStatus(b, now)] || a.name.localeCompare(b.name));
  const pending = Object.entries(statuses).filter(([, status]) => !terminal(status.state));
  const unavailableCount = Object.values(statuses).filter(status => ['denied', 'not-found'].includes(status.state)).length;
  const capacityCount = Object.values(statuses).filter(status => status.state === 'capacity').length;
  const partial = Object.values(statuses).some(status => !['complete', 'empty'].includes(status.state));
  state.complete = pending.length === 0;
  return {
    fetchedAt: readAt, user, canvasBaseUrl: baseUrl, courses,
    coursesTruncated: !['complete', 'empty'].includes(statuses.courses?.state),
    missingSubmissions: rawMissing.map(normalizeMissingSubmission).map(item => ({ ...item, htmlUrl: safe(item.htmlUrl) })),
    missingSubmissionsError: !['complete', 'empty'].includes(statuses.missingSubmissions?.state) ? 'Canvas did not provide its complete missing-assignment list. Assignment missing flags remain available.' : null,
    missingSubmissionsTruncated: Boolean(statuses.missingSubmissions?.truncated),
    collection: { scope: 'active-enrollments', startedAt: state.startedAt, updatedAt: readAt, complete: state.complete, partial, unavailableCount, capacityCount, retainedBytes: state.rawBytes, pendingCount: pending.length, sources: statuses,
      notice: capacityCount ? 'Canvas collection reached its memory or record safety limit. Some sources are incomplete and cannot resume within this collection. Existing readable records are preserved.' : pending.length ? 'Some Canvas sources are incomplete. Refresh resumes unfinished collection; unavailable sources remain identified.' : unavailableCount ? 'Some Canvas sources are unavailable to this account or course. Their status remains visible.' : null },
  };
}
