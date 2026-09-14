// Canvas insights — pure functions only. No DOM, no fetch, no Date.now():
// every time-dependent function takes `now` (ms since epoch) as an argument,
// mirroring public/engine.js. Imported by the browser (the Canvas views in
// app.js), by server.js (URL validation, Link-header pagination, response
// normalization), and by test/canvas-insights.test.mjs.
//
// Every rule and threshold is a named export; there is no hidden scoring.
// Canvas is authoritative for grades: nothing here recomputes a score that
// Canvas already reports, the same way the verified answer key is the only
// grader for practice questions.

import { courseMatchesSubject } from './courses.js';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

// The plan's due-date priority buckets, checked in order. An unsubmitted
// assignment due in `delta` ms lands in the first bucket with delta <= ms.
export const PLAN_BUCKETS = [
  { id: 'within-4-hours', ms: 4 * HOUR_MS },
  { id: 'within-12-hours', ms: 12 * HOUR_MS },
  { id: 'within-24-hours', ms: 24 * HOUR_MS },
  { id: 'within-3-days', ms: 3 * DAY_MS },
  { id: 'within-5-days', ms: 5 * DAY_MS },
];

// Graded work below this fraction of points possible is listed under
// attention. Exactly at the ratio is not listed.
export const LOW_SCORE_RATIO = 0.7;

// A course whose current score is below this number is listed under
// attention. Exactly at the number is not listed.
export const LOW_COURSE_SCORE = 70;

// A course is stale — hidden from the plan and grades, listed by name under
// "Courses not shown" — when it has at least one dated assignment and every
// dated assignment was due more than this long ago. Assignments with no due
// date never make a course stale and never hide one.
export const STALE_MONTHS = 10;
export const STALE_MS = STALE_MONTHS * 30 * DAY_MS;

// The subjects the companion apps cover: Calc Coach today, the physics coach
// next. A course whose name or code matches none of these is hidden by
// default (listed under Hidden courses, never silently dropped); the learner
// can show or hide any course, and that choice is remembered.
export const APP_SUBJECT_PATTERNS = [/calculus/i, /\bcalc\b/i, /physics/i];

export function courseMatchesApps(course) {
  const haystack = `${course?.name || ''} ${course?.courseCode || ''}`;
  return APP_SUBJECT_PATTERNS.some((re) => re.test(haystack));
}

// ------------------------------------------------------------- small helpers
const str = (v) => (v === null || v === undefined ? '' : String(v));
const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const isoOrNull = (v) => {
  if (typeof v !== 'string' || v === '') return null;
  return Number.isNaN(Date.parse(v)) ? null : v;
};
const timeOf = (iso) => (iso === null ? null : Date.parse(iso));

// Bounded reference material for on-demand coaching. HTML is retained as data,
// never as trusted markup or instructions; callers must render safely and keep
// Canvas credentials and signed download URLs out of model context.
export const CANVAS_CONTENT_LIMITS = Object.freeze({
  html: 60_000, explanation: 4_000, rubricCriteria: 50,
  rubricRatings: 10, rubricText: 24_000, assignmentDates: 50, locator: 2_048, url: 4_096,
});
const boundedText = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : null;
const textWasTruncated = (value, limit) => typeof value === 'string' && value.length > limit;
const locatorOrNull = (value, limit = CANVAS_CONTENT_LIMITS.locator) => typeof value === 'string' && value.length > 0 && value.length <= limit ? value : null;
const idOrNull = (value) => (typeof value === 'string' || typeof value === 'number' && Number.isSafeInteger(value)) ? locatorOrNull(String(value), 128) : null;
const integerOrNull = (value, min) => {
  const number = numOrNull(value);
  return Number.isSafeInteger(number) && number >= min ? number : null;
};
const booleanOrNull = (value) => typeof value === 'boolean' ? value : null;
const dueDateStatus = (raw) => {
  if (!raw || !Object.prototype.hasOwnProperty.call(raw, 'due_at') || raw.due_at === undefined) return 'not-provided';
  if (raw.due_at === null) return 'no-date';
  return isoOrNull(raw.due_at) === null ? 'invalid' : 'dated';
};
const referenceUrlOrNull = (value) => {
  if (!locatorOrNull(value, CANVAS_CONTENT_LIMITS.url)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? value : null;
  } catch { return null; }
};

function normalizeRubric(raw) {
  const source = Array.isArray(raw) ? raw : [];
  let remaining = CANVAS_CONTENT_LIMITS.rubricText;
  let truncated = source.length > CANVAS_CONTENT_LIMITS.rubricCriteria;
  const text = (value) => {
    const limit = Math.min(CANVAS_CONTENT_LIMITS.explanation, remaining);
    const result = boundedText(value, limit);
    if (textWasTruncated(value, limit)) truncated = true;
    remaining -= result?.length || 0;
    return result;
  };
  const criteria = source.slice(0, CANVAS_CONTENT_LIMITS.rubricCriteria)
    .filter((criterion) => criterion && typeof criterion === 'object' && !Array.isArray(criterion))
    .map((criterion) => {
      const ratings = Array.isArray(criterion.ratings) ? criterion.ratings : [];
      if (ratings.length > CANVAS_CONTENT_LIMITS.rubricRatings) truncated = true;
      return {
        id: idOrNull(criterion.id), description: text(criterion.description),
        longDescription: text(criterion.long_description), points: numOrNull(criterion.points),
        criterionUseRange: booleanOrNull(criterion.criterion_use_range),
        ratings: ratings.slice(0, CANVAS_CONTENT_LIMITS.rubricRatings)
          .filter((rating) => rating && typeof rating === 'object' && !Array.isArray(rating))
          .map((rating) => ({ id: idOrNull(rating.id), description: text(rating.description), longDescription: text(rating.long_description), points: numOrNull(rating.points) })),
      };
    });
  return { criteria, truncated };
}

export function normalizeCanvasPage(raw) {
  return {
    id: idOrNull(raw?.page_id), pageUrl: locatorOrNull(raw?.url),
    title: boundedText(raw?.title, CANVAS_CONTENT_LIMITS.explanation),
    htmlUrl: referenceUrlOrNull(raw?.html_url),
    bodyHtml: boundedText(raw?.body, CANVAS_CONTENT_LIMITS.html),
    bodyTruncated: textWasTruncated(raw?.body, CANVAS_CONTENT_LIMITS.html),
    updatedAt: isoOrNull(raw?.updated_at), published: booleanOrNull(raw?.published),
    lockedForUser: booleanOrNull(raw?.locked_for_user),
    lockExplanation: boundedText(raw?.lock_explanation, CANVAS_CONTENT_LIMITS.explanation),
  };
}

export function normalizeCanvasDiscussion(raw) {
  return {
    id: idOrNull(raw?.id), assignmentId: idOrNull(raw?.assignment_id),
    title: boundedText(raw?.title, CANVAS_CONTENT_LIMITS.explanation),
    htmlUrl: referenceUrlOrNull(raw?.html_url),
    bodyHtml: boundedText(raw?.message, CANVAS_CONTENT_LIMITS.html),
    bodyTruncated: textWasTruncated(raw?.message, CANVAS_CONTENT_LIMITS.html),
    updatedAt: isoOrNull(raw?.updated_at), published: booleanOrNull(raw?.published),
    lockedForUser: booleanOrNull(raw?.locked_for_user),
    lockExplanation: boundedText(raw?.lock_explanation, CANVAS_CONTENT_LIMITS.explanation),
  };
}

// --------------------------------------------------------- URL validation
// The Canvas base URL must be HTTPS against a public host: credentials are
// never sent in clear text, and the server proxy cannot be pointed at local
// or private addresses. DNS rebinding is deliberately not defended — in this
// single-user app the person entering the URL owns the token; the guard
// prevents accidents, not a hostile learner.
export function canvasBaseUrl(value) {
  const raw = str(value).trim();
  if (raw === '' || raw.length > 512) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || host === '') return null;
  if (host.startsWith('[')) return null; // IPv6 literals are never a school domain
  if (host === 'localhost' || host.endsWith('.localhost')) return null;
  if (/^127\.|^10\.|^192\.168\.|^169\.254\.|^0\./.test(host)) return null;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

// ------------------------------------------------------ Link-header paging
// Canvas paginates list endpoints with an RFC 5988 Link response header.
// Returns the rel="next" URL, or null when there is no next page.
export function parseLinkNext(header) {
  if (typeof header !== 'string' || header === '') return null;
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}

// ------------------------------------------------------------- normalizers
// Everything the app touches goes through these: camelCase, string ids,
// numbers checked with Number.isFinite, dates checked with Date.parse.
// Raw Canvas objects never reach the views.
export function normalizeCourse(raw) {
  const enr = Array.isArray(raw?.enrollments) ? raw.enrollments[0] : null;
  return {
    id: str(raw?.id),
    name: str(raw?.name) || str(raw?.course_code) || 'Untitled course',
    courseCode: str(raw?.course_code),
    term: raw?.term && typeof raw.term === 'object'
      ? {
          id: str(raw.term.id),
          name: str(raw.term.name) || 'Unnamed term',
          startAt: isoOrNull(raw.term.start_at),
          endAt: isoOrNull(raw.term.end_at),
        }
      : null,
    applyGroupWeights: Boolean(raw?.apply_assignment_group_weights),
    score: numOrNull(enr?.computed_current_score),
    grade: enr?.computed_current_grade ? str(enr.computed_current_grade) : null,
  };
}

// ------------------------------------------------------------------- terms
// Canvas keeps courses from earlier school years in the "active" enrollment
// list, so the views filter by enrollment term. These two helpers drive the
// "Terms shown" control: the terms present in the snapshot, newest first,
// and which one contains `now`.
export function termsFrom(courses) {
  const map = new Map();
  for (const c of Array.isArray(courses) ? courses : []) {
    if (!c || !c.term || !c.term.id) continue;
    const existing = map.get(c.term.id);
    if (existing) existing.courseCount += 1;
    else map.set(c.term.id, { id: c.term.id, name: c.term.name, startAt: c.term.startAt, endAt: c.term.endAt, courseCount: 1 });
  }
  return [...map.values()].sort((a, b) => {
    const ta = timeOf(a.startAt);
    const tb = timeOf(b.startAt);
    if (ta !== tb) {
      if (ta === null) return 1;
      if (tb === null) return -1;
      return tb - ta; // newest school term first
    }
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

// The current term is the one whose dates contain `now`. A term with no
// dates at all (Canvas's catch-all "Default Term") can never be current —
// old courses often sit in it. Ties go to the latest start date. Returns
// null when no dated term contains `now`.
export function currentTermId(terms, now) {
  let best = null;
  let bestStart = null;
  for (const t of Array.isArray(terms) ? terms : []) {
    const start = timeOf(t.startAt);
    const end = timeOf(t.endAt);
    if (start === null && end === null) continue;
    if (start !== null && start > now) continue;
    if (end !== null && end < now) continue;
    const s = start === null ? -Infinity : start;
    if (best === null || s > bestStart) { best = t.id; bestStart = s; }
  }
  return best;
}

export function normalizeGroup(raw) {
  return {
    id: str(raw?.id),
    name: str(raw?.name) || 'Assignments',
    groupWeight: numOrNull(raw?.group_weight),
  };
}

export function normalizeAssignment(raw, groupId = '') {
  const rawSub = Array.isArray(raw?.submission) ? raw.submission[0] : raw?.submission;
  const sub = rawSub && typeof rawSub === 'object' ? rawSub : null;
  const types = Array.isArray(raw?.submission_types) ? raw.submission_types : [];
  const rubric = normalizeRubric(raw?.rubric);
  const allDates = Array.isArray(raw?.all_dates) ? raw.all_dates : [];
  return {
    id: str(raw?.id),
    groupId: str(groupId || raw?.assignment_group_id),
    name: str(raw?.name) || 'Untitled assignment',
    dueAt: isoOrNull(raw?.due_at),
    // dueAt remains Canvas's effective date for the requesting learner. The
    // supporting dates below must never replace it with another section's date.
    dueDateStatus: dueDateStatus(raw),
    hasOverrides: booleanOrNull(raw?.has_overrides),
    updatedAt: isoOrNull(raw?.updated_at),
    allDatesProvided: Array.isArray(raw?.all_dates),
    allDatesTruncated: allDates.length > CANVAS_CONTENT_LIMITS.assignmentDates,
    allDates: allDates.slice(0, CANVAS_CONTENT_LIMITS.assignmentDates)
      .filter((date) => date && typeof date === 'object' && !Array.isArray(date))
      .map((date) => ({
        id: idOrNull(date.id), base: booleanOrNull(date.base),
        title: boundedText(date.title, CANVAS_CONTENT_LIMITS.explanation),
        dueAt: isoOrNull(date.due_at), dueDateStatus: dueDateStatus(date),
        unlockAt: isoOrNull(date.unlock_at), lockAt: isoOrNull(date.lock_at),
      })),
    lockAt: isoOrNull(raw?.lock_at),
    unlockAt: isoOrNull(raw?.unlock_at),
    lockedForUser: Boolean(raw?.locked_for_user),
    allowedAttempts: numOrNull(raw?.allowed_attempts),
    pointsPossible: numOrNull(raw?.points_possible),
    isQuiz: Boolean(raw?.is_quiz_assignment) || types.includes('online_quiz'),
    htmlUrl: str(raw?.html_url) || null,
    descriptionHtml: boundedText(raw?.description, CANVAS_CONTENT_LIMITS.html),
    descriptionTruncated: textWasTruncated(raw?.description, CANVAS_CONTENT_LIMITS.html),
    submissionTypes: types.filter((type) => typeof type === 'string' && type.length <= 100).slice(0, 20),
    lockExplanation: boundedText(raw?.lock_explanation, CANVAS_CONTENT_LIMITS.explanation),
    rubric: rubric.criteria,
    rubricTruncated: rubric.truncated,
    submission: sub
      ? {
          submittedAt: isoOrNull(sub.submitted_at),
          gradedAt: isoOrNull(sub.graded_at),
          attempt: numOrNull(sub.attempt),
          score: numOrNull(sub.score),
          grade: sub.grade === null || sub.grade === undefined ? null : str(sub.grade),
          late: Boolean(sub.late),
          missing: Boolean(sub.missing),
          excused: Boolean(sub.excused),
          workflowState: str(sub.workflow_state),
        }
      : null,
  };
}

export function normalizeModuleItem(raw) {
  const req = raw?.completion_requirement && typeof raw.completion_requirement === 'object'
    ? raw.completion_requirement
    : null;
  const details = raw?.content_details && typeof raw.content_details === 'object' && !Array.isArray(raw.content_details)
    ? raw.content_details : null;
  return {
    id: str(raw?.id),
    type: str(raw?.type),
    title: str(raw?.title) || 'Untitled item',
    contentId: raw?.content_id === null || raw?.content_id === undefined ? null : str(raw.content_id),
    moduleId: idOrNull(raw?.module_id),
    pageUrl: locatorOrNull(raw?.page_url),
    htmlUrl: referenceUrlOrNull(raw?.html_url),
    position: integerOrNull(raw?.position, 1),
    indent: integerOrNull(raw?.indent, 0),
    contentDetails: details ? {
      dueAt: isoOrNull(details.due_at), unlockAt: isoOrNull(details.unlock_at), lockAt: isoOrNull(details.lock_at),
      lockedForUser: booleanOrNull(details.locked_for_user),
      lockExplanation: boundedText(details.lock_explanation, CANVAS_CONTENT_LIMITS.explanation),
      pointsPossible: numOrNull(details.points_possible),
    } : null,
    completionRequirement: req
      ? {
          type: str(req.type),
          minScore: numOrNull(req.min_score),
          completed: Boolean(req.completed),
        }
      : null,
  };
}

export function normalizeModule(raw, items) {
  return {
    id: str(raw?.id),
    name: str(raw?.name) || 'Untitled module',
    state: raw?.state ? str(raw.state) : null,
    items: Array.isArray(items) ? items.map(normalizeModuleItem) : null,
  };
}

export function normalizeModuleProgress(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    requirementCount: numOrNull(raw.requirement_count) || 0,
    requirementCompletedCount: numOrNull(raw.requirement_completed_count) || 0,
    completedAt: isoOrNull(raw.completed_at),
  };
}

export function normalizeMissingSubmission(raw) {
  return {
    assignmentId: str(raw?.id),
    courseId: str(raw?.course_id),
    name: str(raw?.name) || 'Untitled assignment',
    dueAt: isoOrNull(raw?.due_at),
    pointsPossible: numOrNull(raw?.points_possible),
    htmlUrl: str(raw?.html_url) || null,
  };
}

// --------------------------------------------------------------- attempts
// Canvas uses allowed_attempts -1 (or absent) for unlimited attempts.
// Returns null when attempts are unlimited or unknown, otherwise the count
// of attempts that remain (never below zero).
export function attemptsRemaining(assignment) {
  const allowed = assignment?.allowedAttempts;
  if (allowed === null || allowed === undefined || allowed < 0) return null;
  const used = assignment?.submission?.attempt || 0;
  return Math.max(0, allowed - used);
}

// ----------------------------------------------------------- the insights
// Deterministic ordering for every list: due date ascending with no due
// date last, then course name, then assignment name, then assignment id.
function compareItems(a, b) {
  const ta = timeOf(a.dueAt);
  const tb = timeOf(b.dueAt);
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    if (ta !== tb) return ta - tb;
  }
  if (a.courseName !== b.courseName) return a.courseName < b.courseName ? -1 : 1;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.assignmentId < b.assignmentId ? -1 : a.assignmentId > b.assignmentId ? 1 : 0;
}

function planItem(course, a) {
  const sub = a.submission;
  return {
    courseId: course.id,
    courseName: course.name,
    assignmentId: a.id,
    name: a.name,
    dueAt: a.dueAt,
    pointsPossible: a.pointsPossible,
    attemptsRemaining: attemptsRemaining(a),
    htmlUrl: a.htmlUrl,
    isQuiz: Boolean(a.isQuiz),
    missing: Boolean(sub && sub.missing),
    late: Boolean(sub && sub.late),
    score: sub ? sub.score : null,
    grade: sub ? sub.grade : null,
    submittedAt: sub ? sub.submittedAt : null,
  };
}

// buildInsights(snapshot, now, opts) -> the plan, the attention lists, the
// courses filtered out (by term selection, visibility, or staleness), and
// one summary row per course.
// opts.termIds: when a non-empty array of term ids is given, courses in
//   other terms are excluded and listed under otherTermCourses; a course
//   with no term data is always included (the stale rule still covers it).
// opts.subjectFilter: when true, courses matching no APP_SUBJECT_PATTERNS
//   entry are hidden (reason 'subject') unless overridden. Legacy option:
//   it is ignored whenever an explicit subject/course selection is present.
// opts.selectedSubject: 'calculus-bc' | 'calculus-ab' | 'physics' | 'all'.
// opts.selectedCourseId: a Canvas course id, or 'all'; when set this wins
//   over selectedSubject so an explicitly picked course is always selectable.
// opts.courseOverrides: { [courseId]: 'shown' | 'hidden' } — the learner's
//   remembered legacy choices; 'shown' beats the legacy subject filter, and
//   'hidden' has reason 'manual'. Explicit dropdown selections replace these
//   old visibility choices, so a previously hidden course can be selected.
// Hidden courses are listed under hiddenCourses, never silently dropped.
// Data only — every learner-facing sentence lives in app.js where the
// language lint scans it.
export function buildInsights(snapshot, now, opts = {}) {
  const allCourses = Array.isArray(snapshot?.courses) ? snapshot.courses : [];
  const missingList = Array.isArray(snapshot?.missingSubmissions) ? snapshot.missingSubmissions : [];

  // Term-selection rule (see termsFrom/currentTermId above).
  const termIds = Array.isArray(opts.termIds) && opts.termIds.length ? new Set(opts.termIds.map(String)) : null;
  const overrides = opts.courseOverrides && typeof opts.courseOverrides === 'object' ? opts.courseOverrides : {};
  const selectedCourseId = opts.selectedCourseId == null || opts.selectedCourseId === ''
    ? null : String(opts.selectedCourseId);
  const selectedSubject = opts.selectedSubject == null || opts.selectedSubject === ''
    ? null : opts.selectedSubject;
  const explicitSelection = selectedCourseId !== null || selectedSubject !== null;
  const otherTermCourses = [];
  const hiddenCourses = [];
  const courses = [];
  for (const course of allCourses) {
    if (termIds && course.term && course.term.id && !termIds.has(course.term.id)) {
      otherTermCourses.push({ id: course.id, name: course.name, termName: course.term.name });
      continue;
    }
    const override = overrides[course.id];
    if (!explicitSelection && override === 'hidden') {
      hiddenCourses.push({ id: course.id, name: course.name, courseCode: course.courseCode, reason: 'manual' });
      continue;
    }
    const selected = selectedCourseId !== null
      ? selectedCourseId === 'all' || String(course.id) === selectedCourseId
      : selectedSubject === null || courseMatchesSubject(course, selectedSubject);
    if (!selected || (!explicitSelection && opts.subjectFilter && override !== 'shown' && !courseMatchesApps(course))) {
      hiddenCourses.push({ id: course.id, name: course.name, courseCode: course.courseCode, reason: selectedCourseId ? 'course' : 'subject' });
      continue;
    }
    courses.push(course);
  }
  otherTermCourses.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  hiddenCourses.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Stale-course rule (see STALE_MS above).
  const staleCourses = [];
  const activeCourses = [];
  for (const course of courses) {
    const assignments = Array.isArray(course.assignments) ? course.assignments : [];
    let lastDueAt = null;
    let lastDueMs = null;
    for (const a of assignments) {
      const t = timeOf(a.dueAt);
      if (t !== null && (lastDueMs === null || t > lastDueMs)) {
        lastDueMs = t;
        lastDueAt = a.dueAt;
      }
    }
    if (lastDueMs !== null && lastDueMs < now - STALE_MS) {
      staleCourses.push({ id: course.id, name: course.name, lastDueAt });
    } else {
      activeCourses.push(course);
    }
  }

  const missingIdSet = new Set(missingList.map((m) => m.assignmentId));
  const courseNameById = new Map(allCourses.map((c) => [c.id, c.name]));
  // Missing submissions from courses hidden by the term selection, the
  // visibility rules, or the stale rule stay out of the attention list too —
  // one consistent lens.
  const hiddenCourseIds = new Set([...otherTermCourses, ...hiddenCourses, ...staleCourses].map((c) => c.id));

  const buckets = PLAN_BUCKETS.map((b) => ({ id: b.id, ms: b.ms, items: [] }));
  const plan = {
    overdueOpen: [],
    overdueClosed: [],
    buckets,
    later: [],
    noDueDate: [],
    moduleGaps: [],
  };
  const attention = { missing: [], late: [], lowScores: [], courseAlerts: [] };
  const perCourse = [];
  const missingSeen = new Set();

  for (const course of activeCourses) {
    const assignments = Array.isArray(course.assignments) ? course.assignments : [];
    const row = {
      courseId: course.id,
      courseName: course.name,
      courseCode: course.courseCode,
      score: course.score,
      grade: course.grade,
      missing: 0,
      overdueOpen: 0,
      overdueClosed: 0,
      upcoming: 0,
      submitted: 0,
      totalAssignments: assignments.length,
    };

    for (const a of assignments) {
      const sub = a.submission;
      if (sub && sub.excused) continue; // excused work is never flagged anywhere

      const item = planItem(course, a);
      const due = timeOf(a.dueAt);
      const lockTime = timeOf(a.lockAt);
      // Canvas sets locked_for_user for several causes (a passed lock date,
      // module prerequisites, a future unlock date). Only a passed lock date
      // proves the window is over; other locks are labeled separately so the
      // guidance stays literally true.
      const lockDatePassed = lockTime !== null && lockTime <= now;
      const closed = a.lockedForUser || lockDatePassed;
      const missingFlag = Boolean(sub && sub.missing) || missingIdSet.has(a.id);
      const done = Boolean(sub && sub.submittedAt) || (sub && sub.workflowState === 'graded');

      if (sub && sub.submittedAt) row.submitted += 1;

      // The plan: each assignment lands in at most one section.
      if (!done) {
        if ((due !== null && due < now) || missingFlag) {
          if (closed) {
            plan.overdueClosed.push({ ...item, lockKind: lockDatePassed ? 'date' : 'other' });
            row.overdueClosed += 1;
          } else {
            plan.overdueOpen.push(item);
            row.overdueOpen += 1;
          }
        } else if (due === null) {
          plan.noDueDate.push(item);
        } else {
          const delta = due - now;
          const bucket = buckets.find((b) => delta <= b.ms);
          if (bucket) {
            bucket.items.push(item);
            row.upcoming += 1;
          } else {
            plan.later.push(item);
          }
        }
      }

      // Attention lists: separate axes, independent of the plan.
      if (missingFlag) {
        attention.missing.push(item);
        missingSeen.add(a.id);
        row.missing += 1;
      }
      if (sub && sub.late && sub.submittedAt) attention.late.push(item);
      if (
        sub &&
        sub.workflowState === 'graded' &&
        sub.score !== null &&
        a.pointsPossible !== null &&
        a.pointsPossible > 0 &&
        sub.score / a.pointsPossible < LOW_SCORE_RATIO
      ) {
        attention.lowScores.push({
          ...item,
          ratio: Math.round((sub.score / a.pointsPossible) * 100) / 100,
        });
      }
    }

    if (
      course.moduleProgress &&
      course.moduleProgress.requirementCount > 0 &&
      course.moduleProgress.requirementCompletedCount < course.moduleProgress.requirementCount
    ) {
      plan.moduleGaps.push({
        courseId: course.id,
        courseName: course.name,
        requirementCount: course.moduleProgress.requirementCount,
        requirementCompletedCount: course.moduleProgress.requirementCompletedCount,
      });
    }

    if (course.score !== null && course.score < LOW_COURSE_SCORE) {
      attention.courseAlerts.push({
        courseId: course.id,
        courseName: course.name,
        score: course.score,
        grade: course.grade,
      });
    }

    perCourse.push(row);
  }

  // Canvas's missing-submissions endpoint can name assignments the course
  // fan-out did not return (a truncated list, or an assignment Canvas hides
  // from the course view). They still belong under attention.
  for (const m of missingList) {
    if (missingSeen.has(m.assignmentId)) continue;
    if (hiddenCourseIds.has(m.courseId)) continue;
    // The missing endpoint may name a course absent from the course list.
    // An explicit selection still applies; unknown names cannot establish
    // a subject match, while an exact id does not need name inference.
    if (selectedCourseId && selectedCourseId !== 'all' && String(m.courseId) !== selectedCourseId) continue;
    if (!selectedCourseId && selectedSubject && selectedSubject !== 'all'
      && !allCourses.some((course) => course.id === m.courseId && courseMatchesSubject(course, selectedSubject))) continue;
    missingSeen.add(m.assignmentId);
    attention.missing.push({
      courseId: m.courseId,
      courseName: courseNameById.get(m.courseId) || 'Canvas course',
      assignmentId: m.assignmentId,
      name: m.name,
      dueAt: m.dueAt,
      pointsPossible: m.pointsPossible,
      attemptsRemaining: null,
      htmlUrl: m.htmlUrl,
      isQuiz: false,
      missing: true,
      late: false,
      score: null,
      grade: null,
      submittedAt: null,
    });
  }

  plan.overdueOpen.sort(compareItems);
  plan.overdueClosed.sort(compareItems);
  for (const b of buckets) b.items.sort(compareItems);
  plan.later.sort(compareItems);
  plan.noDueDate.sort(compareItems);
  plan.moduleGaps.sort((a, b) => (a.courseName < b.courseName ? -1 : a.courseName > b.courseName ? 1 : 0));
  attention.missing.sort(compareItems);
  attention.late.sort(compareItems);
  attention.lowScores.sort(compareItems);
  attention.courseAlerts.sort((a, b) => (a.courseName < b.courseName ? -1 : a.courseName > b.courseName ? 1 : 0));
  staleCourses.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  perCourse.sort((a, b) => (a.courseName < b.courseName ? -1 : a.courseName > b.courseName ? 1 : 0));

  return { generatedAt: now, plan, attention, staleCourses, otherTermCourses, hiddenCourses, perCourse };
}
