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
    term: raw?.term && raw.term.name ? str(raw.term.name) : null,
    applyGroupWeights: Boolean(raw?.apply_assignment_group_weights),
    score: numOrNull(enr?.computed_current_score),
    grade: enr?.computed_current_grade ? str(enr.computed_current_grade) : null,
  };
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
  return {
    id: str(raw?.id),
    groupId: str(groupId || raw?.assignment_group_id),
    name: str(raw?.name) || 'Untitled assignment',
    dueAt: isoOrNull(raw?.due_at),
    lockAt: isoOrNull(raw?.lock_at),
    unlockAt: isoOrNull(raw?.unlock_at),
    lockedForUser: Boolean(raw?.locked_for_user),
    allowedAttempts: numOrNull(raw?.allowed_attempts),
    pointsPossible: numOrNull(raw?.points_possible),
    isQuiz: Boolean(raw?.is_quiz_assignment) || types.includes('online_quiz'),
    htmlUrl: str(raw?.html_url) || null,
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
  return {
    id: str(raw?.id),
    type: str(raw?.type),
    title: str(raw?.title) || 'Untitled item',
    contentId: raw?.content_id === null || raw?.content_id === undefined ? null : str(raw.content_id),
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

// buildInsights(snapshot, now) -> the plan, the attention lists, the stale
// courses, and one summary row per course. Data only — every learner-facing
// sentence lives in app.js where the language lint scans it.
export function buildInsights(snapshot, now) {
  const courses = Array.isArray(snapshot?.courses) ? snapshot.courses : [];
  const missingList = Array.isArray(snapshot?.missingSubmissions) ? snapshot.missingSubmissions : [];

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
  const courseNameById = new Map(courses.map((c) => [c.id, c.name]));

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
      const closed = a.lockedForUser || (lockTime !== null && lockTime <= now);
      const missingFlag = Boolean(sub && sub.missing) || missingIdSet.has(a.id);
      const done = Boolean(sub && sub.submittedAt) || (sub && sub.workflowState === 'graded');

      if (sub && sub.submittedAt) row.submitted += 1;

      // The plan: each assignment lands in at most one section.
      if (!done) {
        if ((due !== null && due < now) || missingFlag) {
          if (closed) {
            plan.overdueClosed.push(item);
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

  return { generatedAt: now, plan, attention, staleCourses, perCourse };
}
