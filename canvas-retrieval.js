// Read-only, typed Canvas references. Discovery and active-learner authorization
// happen upstream; this module never accepts a URL as an API request target.
import { randomUUID } from 'node:crypto';
import { CANVAS_CONTENT_LIMITS, normalizeAssignment, normalizeCanvasPage, normalizeCanvasDiscussion } from './public/canvas-insights.js';

const TYPES = new Set(['assignment', 'page', 'quiz', 'discussion', 'file']);
const numericId = (value) => {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const id = String(value);
  return /^[0-9]{1,20}$/.test(id) ? id : null;
};
const pageLocator = (value) => {
  if (typeof value !== 'string' || !value || value.length > 255 || value.trim() !== value) return null;
  // Retain real Unicode slugs, but no path separators, traversal, query,
  // fragment, encoded separators, credentials, or control characters.
  return /[\/\\?#%:@\u0000-\u0020\u007f]/.test(value) || value.includes('..') ? null : value;
};
const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : null;
const date = (value) => typeof value === 'string' && value && Number.isFinite(Date.parse(value)) ? value : null;
const own = (object, key) => Boolean(object && Object.prototype.hasOwnProperty.call(object, key));

function checkedRef(ref) {
  const courseId = numericId(ref?.courseId), type = ref?.type;
  if (!courseId || !TYPES.has(type)) throw new TypeError('Invalid Canvas detail reference.');
  const id = numericId(ref?.id);
  const hasPageUrl = ref?.pageUrl !== undefined && ref.pageUrl !== null;
  const pageUrl = hasPageUrl ? pageLocator(ref.pageUrl) : null;
  if (type === 'page' ? hasPageUrl ? !pageUrl : !id : !id || hasPageUrl) throw new TypeError('Invalid Canvas resource identifier.');
  return { courseId, type, id, pageUrl };
}

export function canvasDetailRequest(ref) {
  const { courseId, type, id, pageUrl } = checkedRef(ref);
  const paths = { assignment: 'assignments', page: 'pages', quiz: 'quizzes', discussion: 'discussion_topics', file: 'files' };
  // Canvas gives a numeric page slug precedence over a numeric page ID.
  // Explicit page_id syntax avoids fetching a different page with that slug.
  const resource = type === 'page' ? pageUrl || `page_id:${id}` : id;
  return {
    endpoint: `courses/${courseId}/${paths[type]}/${encodeURIComponent(resource)}`,
    query: type === 'assignment' ? { override_assignment_dates: true } : {},
  };
}

function sameOriginLink(value, baseUrl) {
  if (typeof value !== 'string' || value.length > CANVAS_CONTENT_LIMITS.url) return null;
  try {
    const base = new URL(baseUrl), url = new URL(value);
    if (base.protocol !== 'https:' || base.username || base.password || url.protocol !== 'https:' || url.origin !== base.origin || url.username || url.password) return null;
    if ([...url.searchParams.keys()].some((key) => /^(?:access_token|token|api_key|verifier|signature|x-amz-.+)$/i.test(key))) return null;
    return url.href;
  } catch { return null; }
}

export function normalizeCanvasDetail(raw, ref, baseUrl) {
  const identity = checkedRef(ref);
  const rawId = numericId(identity.type === 'page' ? raw?.page_id : raw?.id);
  const rawCourse = numericId(raw?.course_id);
  if ((rawCourse && rawCourse !== identity.courseId) || (rawId && identity.id && !identity.pageUrl && rawId !== identity.id)) throw new TypeError('Canvas response did not match the requested resource.');
  const page = identity.type === 'page' ? normalizeCanvasPage(raw) : null;
  const discussion = identity.type === 'discussion' ? normalizeCanvasDiscussion(raw) : null;
  const assignment = identity.type === 'assignment' ? normalizeAssignment(raw) : null;
  const originalBody = identity.type === 'file' ? null : page ? raw?.body : discussion ? raw?.message : raw?.description;
  const boundedBody = text(originalBody, CANVAS_CONTENT_LIMITS.html);
  const locked = raw?.locked_for_user === true || raw?.published === false;
  const body = locked || identity.type === 'file' ? null : boundedBody;
  const hasBody = typeof body === 'string' && body.trim().length > 0;
  const contentStatus = identity.type === 'file' ? 'metadata-only' : locked ? 'locked'
    : !hasBody ? 'empty' : originalBody.length > CANVAS_CONTENT_LIMITS.html || assignment?.rubricTruncated ? 'truncated' : 'available';
  return {
    type: identity.type, id: rawId || identity.id, courseId: identity.courseId,
    pageUrl: page?.pageUrl || identity.pageUrl,
    title: text(raw?.title ?? raw?.name ?? raw?.display_name ?? ref?.title, CANVAS_CONTENT_LIMITS.explanation),
    body, dueAt: date(raw?.due_at), dueAtPresent: own(raw, 'due_at') && raw.due_at !== undefined,
    dueDateStatus: !own(raw, 'due_at') || raw.due_at === undefined ? 'not-provided' : raw.due_at === null ? 'no-date' : date(raw.due_at) ? 'dated' : 'invalid',
    // File download/preview URLs can carry credentials. Only an explicit safe
    // Canvas html_url (or discovered module wrapper) is exposed to the caller.
    htmlUrl: sameOriginLink(raw?.html_url, baseUrl) || sameOriginLink(ref?.htmlUrl, baseUrl),
    updatedAt: date(raw?.updated_at), readAt: new Date().toISOString(),
    rubric: locked ? [] : assignment?.rubric || [],
    contentStatus,
  };
}

function hintRef(discovery) {
  if (discovery?.type === 'syllabus') {
    const courseId = numericId(discovery.courseId);
    return courseId ? { courseId, type: 'syllabus', id: courseId, pageUrl: null } : null;
  }
  try { return checkedRef(discovery); } catch { return null; }
}

function contentKeys(identity, ref) {
  const prefix = JSON.stringify([identity, ref.courseId, ref.type]);
  const keys = [];
  if (ref.id) keys.push(`${prefix}:id:${ref.id}`);
  if (ref.type === 'page' && ref.pageUrl) keys.push(`${prefix}:page:${ref.pageUrl}`);
  return keys;
}

// These are source-location hints, never replacements for existing rules.
// Old entries (including old versions or other identities) remain intact.
export function appendRetrievalHints(existing, discoveries, { canvasIdentity, now = Date.now() } = {}) {
  const previous = Array.isArray(existing) ? existing : [];
  const result = [...previous];
  if (typeof canvasIdentity !== 'string' || !canvasIdentity.trim() || canvasIdentity.length > 512 || !Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) return result;
  const seen = new Set();
  for (const entry of previous) {
    if (entry?.canvasIdentity !== canvasIdentity) continue;
    const ref = hintRef(entry);
    if (ref) for (const key of contentKeys(canvasIdentity, ref)) seen.add(key);
  }
  for (const discovery of Array.isArray(discoveries) ? discoveries.slice(0, 1000) : []) {
    if (result.length >= 1000) break; // never trim older records, even above cap
    if (discovery?.canvasIdentity !== undefined && discovery.canvasIdentity !== canvasIdentity) continue;
    if (!['available', 'truncated'].includes(discovery?.contentStatus) || typeof discovery?.body !== 'string' || !discovery.body.trim()) continue;
    const ref = hintRef(discovery);
    if (!ref || ref.type === 'file') continue;
    const keys = contentKeys(canvasIdentity, ref);
    if (!keys.length || keys.some((key) => seen.has(key))) continue;
    result.push({
      ruleId: randomUUID(), version: 1, canvasIdentity, ...ref,
      label: text(discovery.title ?? discovery.label ?? discovery.name, 300) || `${ref.type} ${ref.id || ref.pageUrl}`,
      createdAt: new Date(now).toISOString(),
      reason: ref.type === 'syllabus' ? 'Retrieved a readable Canvas course syllabus.' : 'Retrieved readable Canvas content from this reference.',
    });
    for (const key of keys) seen.add(key);
  }
  return result;
}
