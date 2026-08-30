// Calc Coach server — zero dependencies, Node 18+.
// Serves the static app, the curriculum content, and a small JSON progress API
// backed by files in ./data (so progress survives browser changes on Replit).

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canvasBaseUrl, parseLinkNext, normalizeCourse, normalizeGroup, normalizeAssignment,
  normalizeModule, normalizeModuleProgress, normalizeMissingSubmission, buildInsights,
} from './public/canvas-insights.js';
import { hasDatabase, dbGet, dbSet, dbDelete } from './store.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const CONTENT = join(ROOT, 'content');
const DATA = join(ROOT, 'data');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
};
const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj));

// Only allow simple profile names so the file path can never escape ./data.
const profileSlug = (name) => {
  const safe = String(name || 'learner').toLowerCase().replace(/[^a-z0-9-]/g, '');
  return safe || 'learner';
};
const profileFile = (name) => join(DATA, `progress-${profileSlug(name)}.json`);

// ----------------------------------------------------------- durable store
// Postgres (DATABASE_URL — Replit's dev database "helium" and the
// production deploy's database both provide one) is the durable copy of
// learner progress, the remembered Canvas connection, and the Canvas view
// preferences; the data/ files remain the zero-config fallback and a local
// mirror, and they seed the database the first time it is reachable. Reads
// prefer the database; writes go to both; a database failure never blocks
// the learner — it is logged (rate-limited) and the file path continues.
let dbWarnedAt = 0;
function dbTrouble(op, e) {
  const now = Date.now();
  if (now - dbWarnedAt > 60_000) {
    dbWarnedAt = now;
    console.error(`[calc-coach] database ${op} failed; using files:`, e.message);
  }
}
async function storeRead(key) {
  if (!hasDatabase()) return null;
  try { return await dbGet(key); } catch (e) { dbTrouble('read', e); return null; }
}
function storeWrite(key, value) {
  if (!hasDatabase()) return;
  dbSet(key, value).catch((e) => dbTrouble('write', e));
}
function storeRemove(key) {
  if (!hasDatabase()) return;
  dbDelete(key).catch((e) => dbTrouble('delete', e));
}

async function serveFile(res, base, relPath) {
  const path = normalize(join(base, relPath));
  if (!path.startsWith(base)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    const body = await readFile(path);
    const ext = path.slice(path.lastIndexOf('.'));
    send(res, 200, body, MIME[ext] || 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// --------------------------------------------------------------- Canvas LMS
// Optional read-only integration: the learner connects with their school's
// HTTPS Canvas URL and a personal access token. The token lives only in the
// in-memory session below (8-hour sliding expiry) behind an HttpOnly,
// SameSite=Strict cookie — never on disk, never in progress files, never in
// a response body or log line, and never given to the AI tutor. The proxy
// only reads from Canvas; it never creates, changes, or submits anything.
// URL validation, Link-header pagination parsing, and all response
// normalization are pure functions in public/canvas-insights.js (tested).
const CANVAS_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const CANVAS_TIMEOUT_MS = 20_000;
const CANVAS_MAX_PAGES = 5; // per list; pages hold 100 items — hitting the cap is reported, never silent
const CANVAS_MAX_COURSES = 15; // snapshot fan-out cap, surfaced as coursesTruncated
const CANVAS_MAX_SESSIONS = 8; // single learner; bounds memory if the connect form loops
const CANVAS_FANOUT = 3; // concurrent Canvas requests during a snapshot (Canvas throttles bursts)
const CANVAS_NUMERIC_ID = /^[0-9]{1,20}$/;
const canvasSessions = new Map(); // id -> { baseUrl, token, expiresAt, user }

// Expired sessions are swept on a timer as well as on access, so an
// abandoned token does not sit in memory for the life of the process.
setInterval(() => {
  const cutoff = Date.now();
  for (const [id, s] of canvasSessions) if (s.expiresAt <= cutoff) canvasSessions.delete(id);
}, 15 * 60 * 1000).unref();

class CanvasError extends Error {
  // kind: 'auth' | 'forbidden' | 'rate' | 'notfound' | 'canvas' | 'timeout' | 'network'
  constructor(kind, status, detail) {
    super(`canvas ${kind} ${status}: ${detail}`);
    this.kind = kind;
    this.status = status;
  }
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => {
    const i = part.indexOf('=');
    if (i < 0) return [];
    const raw = part.slice(i + 1);
    // A raw % is legal in a cookie value (RFC 6265), and another app or an
    // extension can set one on this host — never let it throw.
    let value;
    try { value = decodeURIComponent(raw); } catch { value = raw; }
    return [part.slice(0, i).trim(), value];
  }).filter((pair) => pair.length));
}

function canvasSession(req) {
  const id = parseCookies(req).canvas_session;
  const session = id ? canvasSessions.get(id) : undefined;
  if (!session || session.expiresAt <= Date.now()) {
    if (id) canvasSessions.delete(id);
    return null;
  }
  return { id, session };
}

// ------------------------------------------------- remembered connection
// The single learner can choose to remember the connection: the URL and
// token are saved to data/canvas-profile.json (gitignored, never served,
// never part of a progress export), and the server reconnects from it after
// a restart. Disconnect deletes the file.
const CANVAS_PROFILE_FILE = join(DATA, 'canvas-profile.json');

function validCanvasProfile(parsed) {
  const baseUrl = canvasBaseUrl(parsed?.baseUrl);
  const token = typeof parsed?.token === 'string' ? parsed.token.trim() : '';
  if (!baseUrl || token === '' || token.length > 2048) return null;
  return { baseUrl, token };
}

async function canvasStoreSave(baseUrl, token) {
  await mkdir(DATA, { recursive: true });
  const tmp = `${CANVAS_PROFILE_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify({ baseUrl, token }), { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, CANVAS_PROFILE_FILE);
  storeWrite('canvas-profile', { baseUrl, token });
}

async function canvasStoreLoad() {
  const fromDb = validCanvasProfile(await storeRead('canvas-profile'));
  if (fromDb) return fromDb;
  try {
    const fromFile = validCanvasProfile(JSON.parse(await readFile(CANVAS_PROFILE_FILE, 'utf8')));
    if (fromFile) storeWrite('canvas-profile', fromFile); // seed the durable copy
    return fromFile;
  } catch {
    return null;
  }
}

async function canvasStoreDelete() {
  try { await unlink(CANVAS_PROFILE_FILE); } catch { /* already gone */ }
  storeRemove('canvas-profile');
}

// ------------------------------------------------- remembered view choices
// Per-course show/hide choices (course ids only, no credentials) live in
// their own gitignored file, so they survive restarts and disconnects alike
// and are never part of a progress export.
const CANVAS_PREFS_FILE = join(DATA, 'canvas-prefs.json');

function sanitizeOverrides(raw) {
  const overrides = {};
  const source = raw && typeof raw === 'object' ? raw : {};
  for (const [id, v] of Object.entries(source).slice(0, 200)) {
    if (CANVAS_NUMERIC_ID.test(id) && (v === 'shown' || v === 'hidden')) overrides[id] = v;
  }
  return overrides;
}

async function canvasPrefsLoad() {
  const fromDb = await storeRead('canvas-prefs');
  if (fromDb) return { courseOverrides: sanitizeOverrides(fromDb.courseOverrides) };
  try {
    const parsed = JSON.parse(await readFile(CANVAS_PREFS_FILE, 'utf8'));
    const prefs = { courseOverrides: sanitizeOverrides(parsed?.courseOverrides) };
    storeWrite('canvas-prefs', prefs); // seed the durable copy
    return prefs;
  } catch {
    return { courseOverrides: {} };
  }
}

async function canvasPrefsSave(prefs) {
  await mkdir(DATA, { recursive: true });
  const tmp = `${CANVAS_PREFS_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(prefs, null, 2), 'utf8');
  await rename(tmp, CANVAS_PREFS_FILE);
  storeWrite('canvas-prefs', prefs);
}

// Returns the cookie session, or silently reconnects from the remembered
// profile when there is one. A remembered token Canvas rejects outright is
// deleted so a revoked token cannot cause a reconnect loop.
async function canvasSessionOrStored(req, res) {
  const found = canvasSession(req);
  if (found) return found;
  const stored = await canvasStoreLoad();
  if (!stored) return null;
  // A cookie-less client with a remembered profile reuses the existing
  // remembered session instead of minting one per request.
  for (const [id, s] of canvasSessions) {
    if (s.remembered && s.baseUrl === stored.baseUrl && s.token === stored.token && s.expiresAt > Date.now()) {
      setCanvasCookie(req, res, id, CANVAS_SESSION_TTL_MS / 1000);
      return { id, session: s };
    }
  }
  const candidate = { baseUrl: stored.baseUrl, token: stored.token, expiresAt: Date.now() + CANVAS_SESSION_TTL_MS, user: null, remembered: true };
  try {
    const user = await canvasGet(candidate, 'users/self');
    candidate.user = { id: String(user?.id ?? ''), name: String(user?.name || 'Canvas learner') };
  } catch (e) {
    if (e instanceof CanvasError && e.kind === 'auth') await canvasStoreDelete();
    console.error('[calc-coach] canvas: stored-profile reconnect failed:', e.message);
    return null;
  }
  evictCanvasSessions();
  const id = randomUUID();
  canvasSessions.set(id, candidate);
  setCanvasCookie(req, res, id, CANVAS_SESSION_TTL_MS / 1000);
  return { id, session: candidate };
}

function setCanvasCookie(req, res, id, maxAgeSeconds) {
  // `Secure` only behind Replit's HTTPS proxy (which sets x-forwarded-proto);
  // plain-HTTP localhost development keeps the cookie without it.
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `canvas_session=${encodeURIComponent(id)}; Path=/api/canvas; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`);
}

// The sliding 8-hour expiry has to move the cookie too, not just the
// in-memory session — otherwise the browser drops the cookie 8 hours after
// connect and the renewed session becomes unreachable.
function renewCanvasSession(req, res, found) {
  found.session.expiresAt = Date.now() + CANVAS_SESSION_TTL_MS;
  setCanvasCookie(req, res, found.id, CANVAS_SESSION_TTL_MS / 1000);
}

function evictCanvasSessions() {
  while (canvasSessions.size >= CANVAS_MAX_SESSIONS) {
    let oldest = null;
    for (const [id, s] of canvasSessions) {
      if (!oldest || s.expiresAt < oldest.expiresAt) oldest = { id, expiresAt: s.expiresAt };
    }
    canvasSessions.delete(oldest.id);
  }
}

function canvasErrorFrom(status, data) {
  const detail = String(data?.errors?.[0]?.message || data?.message || `HTTP ${status}`).slice(0, 240);
  if (status === 401) return new CanvasError('auth', status, detail);
  if (status === 403) return /rate limit/i.test(detail) ? new CanvasError('rate', status, detail) : new CanvasError('forbidden', status, detail);
  if (status === 404) return new CanvasError('notfound', status, detail);
  return new CanvasError('canvas', status, detail);
}

async function canvasFetch(session, urlObj) {
  let response;
  try {
    response = await fetch(urlObj, {
      headers: { authorization: `Bearer ${session.token}`, accept: 'application/json+canvas-string-ids' },
      signal: AbortSignal.timeout(CANVAS_TIMEOUT_MS),
    });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      throw new CanvasError('timeout', 0, `no reply in ${CANVAS_TIMEOUT_MS}ms`);
    }
    throw new CanvasError('network', 0, String(e?.cause?.code || e?.message || 'fetch failed').slice(0, 240));
  }
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) throw canvasErrorFrom(response.status, data);
  return { data, linkNext: parseLinkNext(response.headers.get('link')) };
}

// baseUrl may include a path prefix (https://school.edu/canvas), so the API
// path is appended to it as a string, never resolved against the origin.
function canvasUrl(session, endpoint, query = {}) {
  const url = new URL(`${session.baseUrl}/api/v1/${String(endpoint).replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(query)) {
    for (const entry of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(entry));
  }
  return url;
}

async function canvasGet(session, endpoint, query = {}) {
  const { data } = await canvasFetch(session, canvasUrl(session, endpoint, query));
  return data;
}

// Canvas paginates lists via the Link response header. Follows rel="next" up
// to CANVAS_MAX_PAGES pages; a next URL is followed only on the session's own
// origin, so a hostile header cannot turn this proxy into a generic fetcher.
async function canvasGetAll(session, endpoint, query = {}) {
  const items = [];
  let url = canvasUrl(session, endpoint, { ...query, per_page: 100 });
  const origin = new URL(session.baseUrl).origin;
  for (let page = 0; page < CANVAS_MAX_PAGES; page++) {
    const { data, linkNext } = await canvasFetch(session, url);
    if (Array.isArray(data)) items.push(...data);
    if (!linkNext) return { items, truncated: false };
    // A next link exists, so the list is provably incomplete if we stop here
    // for any reason — that is truncation and is reported as such.
    let next;
    try { next = new URL(linkNext); } catch { return { items, truncated: true }; }
    if (next.origin !== origin) return { items, truncated: true };
    url = next;
  }
  return { items, truncated: true };
}

// Bounded-concurrency map so a snapshot never bursts Canvas's throttle bucket.
async function mapLimit(values, limit, fn) {
  const out = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, values.length)) }, async () => {
    while (nextIndex < values.length) {
      const i = nextIndex++;
      out[i] = await fn(values[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// A link is only shown to the learner when it points back into their own
// Canvas instance — origin equality, not a prefix check, so a superstring
// host such as school.edu.evil.com can never pass.
function canvasSafeLink(baseUrl, htmlUrl) {
  if (typeof htmlUrl !== 'string' || htmlUrl === '') return null;
  try {
    return new URL(htmlUrl).origin === new URL(baseUrl).origin ? htmlUrl : null;
  } catch {
    return null;
  }
}

async function canvasSnapshot(session) {
  const coursesPage = await canvasGetAll(session, 'courses', {
    enrollment_state: 'active',
    'include[]': ['total_scores', 'term'],
  });
  const allCourses = coursesPage.items.map(normalizeCourse).filter((c) => CANVAS_NUMERIC_ID.test(c.id));
  allCourses.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const kept = allCourses.slice(0, CANVAS_MAX_COURSES);
  const coursesTruncated = coursesPage.truncated || allCourses.length > kept.length;

  let missingSubmissions = [];
  let missingSubmissionsError = null;
  let missingSubmissionsTruncated = false;
  try {
    const page = await canvasGetAll(session, 'users/self/missing_submissions', { 'include[]': 'course_id' });
    missingSubmissionsTruncated = page.truncated;
    missingSubmissions = page.items
      .map(normalizeMissingSubmission)
      .map((m) => ({ ...m, htmlUrl: canvasSafeLink(session.baseUrl, m.htmlUrl) }));
  } catch (e) {
    // Some institutions disable this endpoint; the per-assignment missing
    // flags still cover it, so this degrades instead of failing.
    missingSubmissionsError = 'Canvas did not provide its missing-assignment list. The missing flag on each assignment is used instead.';
    console.error('[calc-coach] canvas: missing_submissions failed:', e.message);
  }

  const courses = await mapLimit(kept, CANVAS_FANOUT, async (course) => {
    const result = {
      ...course,
      moduleProgress: null,
      assignmentGroups: [],
      modules: [],
      assignments: [],
      assignmentsTruncated: false,
      modulesTruncated: false,
      assignmentsError: null,
    };
    try {
      // One call per course returns the groups (with weights) and every
      // assignment with the learner's submission. Quizzes arrive as their
      // shadow assignments, which sidesteps the Quiz API's extra permissions.
      const page = await canvasGetAll(session, `courses/${course.id}/assignment_groups`, {
        'include[]': ['assignments', 'submission'],
      });
      result.assignmentsTruncated = page.truncated;
      for (const rawGroup of page.items) {
        const group = normalizeGroup(rawGroup);
        result.assignmentGroups.push(group);
        for (const rawAssignment of Array.isArray(rawGroup?.assignments) ? rawGroup.assignments : []) {
          const assignment = normalizeAssignment(rawAssignment, group.id);
          assignment.htmlUrl = canvasSafeLink(session.baseUrl, assignment.htmlUrl);
          result.assignments.push(assignment);
        }
      }
    } catch (e) {
      result.assignmentsError = 'Canvas did not return the assignments for this course.';
      console.error(`[calc-coach] canvas: assignments for course ${course.id} failed:`, e.message);
    }
    try {
      const page = await canvasGetAll(session, `courses/${course.id}/modules`, { 'include[]': 'items' });
      result.modulesTruncated = page.truncated;
      result.modules = await mapLimit(page.items, 1, async (rawModule) => {
        let items = Array.isArray(rawModule?.items) ? rawModule.items : null;
        const moduleId = String(rawModule?.id ?? '');
        if (items === null && CANVAS_NUMERIC_ID.test(moduleId)) {
          // Canvas omits items for very large modules; fetch them directly.
          try {
            const itemsPage = await canvasGetAll(session, `courses/${course.id}/modules/${moduleId}/items`);
            items = itemsPage.items;
            if (itemsPage.truncated) result.modulesTruncated = true;
          } catch {
            items = null;
          }
        }
        return normalizeModule(rawModule, items);
      });
    } catch (e) {
      console.error(`[calc-coach] canvas: modules for course ${course.id} failed:`, e.message);
    }
    try {
      result.moduleProgress = normalizeModuleProgress(
        await canvasGet(session, `courses/${course.id}/users/self/progress`)
      );
    } catch {
      result.moduleProgress = null; // many courses have no module requirements; not an error
    }
    return result;
  });

  return {
    fetchedAt: new Date().toISOString(),
    user: session.user,
    coursesTruncated,
    missingSubmissions,
    missingSubmissionsError,
    missingSubmissionsTruncated,
    courses,
  };
}

// Calm, literal error sentences (invariant 3 applies to server strings too,
// even though the language lint only scans client files). Detail stays in
// the server log; the token appears in no message, ever.
// dropStored: when an ESTABLISHED session's token is rejected, the remembered
// profile holds that same dead token and is deleted with it. A failed NEW
// connect attempt (POST) passes false — its candidate token was never saved,
// and a working remembered profile must not be deleted by a typo.
async function sendCanvasError(req, res, e, sessionId, dropStored = true) {
  const kind = e instanceof CanvasError ? e.kind : 'canvas';
  console.error('[calc-coach] canvas:', kind, e instanceof CanvasError ? e.status : '', e.message);
  if (kind === 'auth') {
    if (sessionId) canvasSessions.delete(sessionId);
    if (dropStored) await canvasStoreDelete();
    setCanvasCookie(req, res, '', 0);
    return sendJson(res, 401, {
      connected: false,
      reason: 'auth',
      error: 'Canvas did not accept the access token. It may have expired or been deleted. Create a new token in Canvas and connect again.',
    });
  }
  if (kind === 'forbidden') return sendJson(res, 403, { error: 'Canvas denied access to this data. Your institution may restrict what a personal token can read.' });
  if (kind === 'rate') return sendJson(res, 503, { error: 'Canvas is limiting requests right now. Wait one minute and try again.' });
  if (kind === 'notfound') return sendJson(res, 404, { error: 'Canvas reports that this data does not exist.' });
  if (kind === 'timeout') return sendJson(res, 504, { error: 'Canvas did not reply within 20 seconds. Try again, or check the Canvas URL.' });
  if (kind === 'network') return sendJson(res, 502, { error: 'Canvas could not be reached at that address. Check the URL and try again.' });
  return sendJson(res, 502, { error: 'Canvas returned an error for this request. Your Calc Coach progress is unaffected.' });
}

// ------------------------------------------------------ the AI assessment
// Reuses the tutor's provider chain (same keys, same fallback order) to
// write a grounded assessment of the pulled Canvas data. The model receives
// the data below and nothing else — never the token, never Calc Coach
// progress. The client shows the button only when GET /api/tutor reports a
// provider is configured.
const CANVAS_ASSESSMENT_SYSTEM = `You are an academic progress analyst inside Calc Coach, a study app. You are writing for one specific learner, an autistic professional software developer. Follow these rules exactly.

Style rules:
- Literal language only. No idioms, no sarcasm, no rhetorical questions, no exclamation marks, no emoji, no markdown syntax.
- Never shame. Never write "you forgot", "you failed", or "you should have". State facts calmly: "3 assignments are marked missing in Canvas."
- Short headings on their own line, then short paragraphs or plain hyphen lists.

Grounding rules:
- Every statement must come from the data provided. Never invent an assignment, course, score, or date. When data is absent, say it is absent.
- The data is authoritative. Report scores and grades exactly as given; do not recompute or estimate grades.

Write the assessment in this exact order:
1. Overall picture — two or three sentences.
2. What is going well — specific items from the data.
3. Problem areas — grouped by course, most affected course first, with the specific assignments and dates.
4. A suggested order of work — follow the due-date order in the data; work that is past due and still open comes first. For work that is past due and closed, the suggestion is to continue with open work and, if wanted, ask the teacher for more time.
5. One closing sentence that is factual and calm.

Keep the whole assessment under 400 words. Plain text only.`;

function canvasAssessmentContext(snapshot, insights) {
  const lines = [];
  const item = (i) => `- ${i.name} (${i.courseName})${i.dueAt ? ` due ${i.dueAt}` : ', no due date'}${i.pointsPossible !== null ? `, ${i.pointsPossible} points` : ''}${i.score !== null ? `, score ${i.score}` : ''}`;
  const section = (title, list, cap = 30) => {
    if (!list.length) return;
    lines.push('', `${title} (${list.length}):`);
    for (const i of list.slice(0, cap)) lines.push(item(i));
    if (list.length > cap) lines.push(`- and ${list.length - cap} more`);
  };
  lines.push(`Data pulled from Canvas at ${snapshot.fetchedAt}.`);
  lines.push('', 'Course summaries:');
  for (const r of insights.perCourse) {
    lines.push(`- ${r.courseName}: current score ${r.score === null ? 'not reported' : r.score}${r.grade ? ` (${r.grade})` : ''}; ${r.submitted} of ${r.totalAssignments} assignments submitted; ${r.missing} marked missing; ${r.overdueOpen} past due and still open; ${r.overdueClosed} past due and closed; ${r.upcoming} due in the next 5 days.`);
  }
  section('Past due, and Canvas still accepts a submission', insights.plan.overdueOpen);
  section('Past due and closed in Canvas', insights.plan.overdueClosed);
  for (const b of insights.plan.buckets) section(`Due ${b.id.replace(/-/g, ' ')}`, b.items);
  section('Due later than 5 days from now', insights.plan.later, 15);
  section('No due date', insights.plan.noDueDate, 15);
  section('Marked missing in Canvas', insights.attention.missing);
  section('Submitted late', insights.attention.late, 15);
  section('Graded below 70 percent of points possible', insights.attention.lowScores);
  if (insights.plan.moduleGaps.length) {
    lines.push('', 'Module requirements not complete:');
    for (const g of insights.plan.moduleGaps) lines.push(`- ${g.courseName}: ${g.requirementCompletedCount} of ${g.requirementCount} complete`);
  }
  if (insights.staleCourses.length) {
    lines.push('', `Courses left out because every dated assignment ended over 10 months ago: ${insights.staleCourses.map((c) => c.name).join(', ')}.`);
  }
  if (insights.otherTermCourses.length) {
    lines.push('', `Courses left out by the learner's term selection (earlier or other school terms): ${insights.otherTermCourses.map((c) => `${c.name} (${c.termName})`).join(', ')}. Do not analyze these.`);
  }
  if (insights.hiddenCourses.length) {
    lines.push('', `Courses the learner has hidden from this view: ${insights.hiddenCourses.map((c) => c.name).join(', ')}. Do not analyze these.`);
  }
  return `Analyze this learner's Canvas data and write the assessment described in your instructions.\n\n${lines.join('\n')}`.slice(0, 60_000);
}

async function handleCanvasAssessment(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'use POST' });
  if (!providerChain().length) return sendJson(res, 200, { available: false });
  const found = await canvasSessionOrStored(req, res);
  if (!found) return sendJson(res, 401, { connected: false, reason: 'disconnected', error: 'Connect Canvas to ask for an assessment.' });
  renewCanvasSession(req, res, found); // sliding renewal, cookie included
  // The learner's term selection travels with the request so the assessment
  // sees the same lens as the plan and grades pages.
  let termIds = [];
  try {
    const body = JSON.parse((await readBody(req, 20_000)) || '{}');
    if (Array.isArray(body?.termIds)) {
      termIds = body.termIds.slice(0, 50).map((t) => String(t)).filter((t) => CANVAS_NUMERIC_ID.test(t));
    }
  } catch { /* an empty or invalid body means no term filter */ }
  try {
    const snapshot = await canvasSnapshot(found.session);
    const prefs = await canvasPrefsLoad();
    const insights = buildInsights(snapshot, Date.now(), { termIds, subjectFilter: true, courseOverrides: prefs.courseOverrides });
    const out = await completeWithFallback({
      system: CANVAS_ASSESSMENT_SYSTEM,
      messages: [{ role: 'user', content: canvasAssessmentContext(snapshot, insights) }],
    });
    if (out.refusal) return sendJson(res, 200, { text: 'The AI service declined to analyze this data. The plan and Grades pages still show everything Canvas reported.' });
    if (out.text) {
      const text = out.truncated
        ? `${out.text}\n\nThis assessment reached its length limit and stops early. Ask for a new assessment to get a complete one.`
        : out.text;
      return sendJson(res, 200, { text });
    }
    console.error('[calc-coach] canvas assessment: every provider failed —', out.failures.join(' | '));
    return sendJson(res, 502, { error: 'The assessment service could not be reached.' });
  } catch (e) {
    return sendCanvasError(req, res, e, found.id);
  }
}

async function handleCanvas(req, res, url) {
  const path = url.pathname;

  if (path === '/api/canvas/assessment') return handleCanvasAssessment(req, res);

  // View preferences (course show/hide). Same trust model as /api/progress:
  // this is a single-learner app and the file holds no credentials.
  if (path === '/api/canvas/prefs') {
    if (req.method === 'GET') return sendJson(res, 200, await canvasPrefsLoad());
    if (req.method === 'PUT') {
      let body;
      try { body = JSON.parse(await readBody(req, 50_000)); } catch { return sendJson(res, 400, { error: 'body must be valid JSON' }); }
      const overrides = sanitizeOverrides(body?.courseOverrides);
      await canvasPrefsSave({ courseOverrides: overrides });
      return sendJson(res, 200, { saved: true, courseOverrides: overrides });
    }
    return sendJson(res, 405, { error: 'use GET or PUT' });
  }

  if (path === '/api/canvas/session') {
    if (req.method === 'GET') {
      const found = await canvasSessionOrStored(req, res);
      if (!found) return sendJson(res, 200, { connected: false });
      renewCanvasSession(req, res, found);
      return sendJson(res, 200, {
        connected: true,
        user: found.session.user,
        host: new URL(found.session.baseUrl).host,
        remembered: Boolean(found.session.remembered),
      });
    }
    if (req.method === 'DELETE') {
      // Single-user app: Disconnect means the token leaves server memory
      // entirely, not just the session this cookie names.
      canvasSessions.clear();
      await canvasStoreDelete();
      setCanvasCookie(req, res, '', 0);
      return sendJson(res, 200, { connected: false });
    }
    if (req.method === 'POST') {
      let body;
      try { body = JSON.parse(await readBody(req, 20_000)); } catch { return sendJson(res, 400, { error: 'body must be valid JSON' }); }
      const baseUrl = canvasBaseUrl(body?.baseUrl);
      const token = typeof body?.token === 'string' ? body.token.trim() : '';
      const remember = Boolean(body?.remember);
      if (!baseUrl || token === '' || token.length > 2048) {
        return sendJson(res, 400, { error: 'Enter an HTTPS Canvas URL and an access token.' });
      }
      const candidate = { baseUrl, token, expiresAt: Date.now() + CANVAS_SESSION_TTL_MS, user: null, remembered: remember };
      try {
        const user = await canvasGet(candidate, 'users/self');
        candidate.user = { id: String(user?.id ?? ''), name: String(user?.name || 'Canvas learner') };
      } catch (e) {
        return sendCanvasError(req, res, e, null, false);
      }
      if (remember) await canvasStoreSave(baseUrl, token);
      else await canvasStoreDelete();
      // Oldest-first eviction keeps the store bounded even if the form loops.
      evictCanvasSessions();
      const id = randomUUID();
      canvasSessions.set(id, candidate);
      setCanvasCookie(req, res, id, CANVAS_SESSION_TTL_MS / 1000);
      return sendJson(res, 200, { connected: true, user: candidate.user, host: new URL(baseUrl).host, remembered: remember });
    }
    return sendJson(res, 405, { error: 'use GET, POST, or DELETE' });
  }

  if (path === '/api/canvas/snapshot') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'use GET' });
    const found = await canvasSessionOrStored(req, res);
    if (!found) return sendJson(res, 401, { connected: false, reason: 'disconnected', error: 'Connect Canvas to load this data.' });
    renewCanvasSession(req, res, found); // sliding renewal, cookie included
    try {
      return sendJson(res, 200, await canvasSnapshot(found.session));
    } catch (e) {
      return sendCanvasError(req, res, e, found.id);
    }
  }

  return sendJson(res, 404, { error: 'unknown Canvas endpoint' });
}

// ---------------------------------------------------------------- AI tutor
// Optional feature: set ANTHROPIC_API_KEY (e.g. in Replit Secrets) and a
// "Talk it through with the tutor" panel appears on answer feedback. Without
// the key the app is fully functional and the button never renders.
//
// The tutor is grounded, never authoritative: every request carries the
// verified solution as ground truth and the system prompt forbids
// contradicting it. Only the question content and the learner's answer to it
// are sent — no name, no progress data.
// ---------------------------------------------------------------- providers
// One adapter per vendor, all behind the same call: complete({ system,
// messages }) -> { text } or { refusal: true }. Built-in fetch only. The tutor
// tries the chain in order and answers from the first provider that works; a
// provider is in the chain only when its key is set, and every model id comes
// from the environment so nothing here is tied to one vendor or one model.
//   ANTHROPIC_API_KEY                  TUTOR_MODEL_ANTHROPIC  (default claude-opus-5)
//   OPENAI_API_KEY                     TUTOR_MODEL_OPENAI     (default gpt-5)
//   GEMINI_API_KEY or GOOGLE_API_KEY   TUTOR_MODEL_GEMINI     (default gemini-2.5-pro)
//   TUTOR_PROVIDERS="anthropic,openai,gemini" reorders or limits the chain.
// Generous by choice: a cap is not a spend, and a cut-off explanation is
// worse than a slow one for this learner. Extended thinking is enabled for
// the Anthropic lane; the timeout leaves room for it.
const PROVIDER_TIMEOUT_MS = 120_000;
const MAX_TUTOR_TOKENS = 16_000;
const THINKING_BUDGET_TOKENS = 10_000;

class ProviderError extends Error {
  constructor(provider, status, message) { super(`${provider} ${status}: ${message || 'unknown error'}`); this.status = status; }
}

async function postJson(url, headers, body, signal) {
  const res = await fetch(url, { method: 'POST', signal, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { res, data };
}

const ADAPTERS = {
  anthropic: {
    key: () => process.env.ANTHROPIC_API_KEY,
    model: () => process.env.TUTOR_MODEL_ANTHROPIC || 'claude-opus-5',
    async complete({ key, model, system, messages, signal }) {
      const { res, data } = await postJson('https://api.anthropic.com/v1/messages',
        { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        {
          model,
          max_tokens: MAX_TUTOR_TOKENS,
          thinking: { type: 'enabled', budget_tokens: THINKING_BUDGET_TOKENS },
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages,
        }, signal);
      if (!res.ok) throw new ProviderError('anthropic', res.status, data?.error?.message);
      if (data?.stop_reason === 'refusal') return { refusal: true };
      return {
        text: (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(),
        truncated: data?.stop_reason === 'max_tokens',
      };
    },
  },
  openai: {
    key: () => process.env.OPENAI_API_KEY,
    model: () => process.env.TUTOR_MODEL_OPENAI || 'gpt-5',
    async complete({ key, model, system, messages, signal }) {
      const { res, data } = await postJson('https://api.openai.com/v1/chat/completions',
        { authorization: `Bearer ${key}` },
        { model, max_completion_tokens: MAX_TUTOR_TOKENS, messages: [{ role: 'system', content: system }, ...messages] }, signal);
      if (!res.ok) throw new ProviderError('openai', res.status, data?.error?.message);
      const choice = data?.choices?.[0];
      if (choice?.finish_reason === 'content_filter') return { refusal: true };
      return { text: String(choice?.message?.content || '').trim(), truncated: choice?.finish_reason === 'length' };
    },
  },
  gemini: {
    key: () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    model: () => process.env.TUTOR_MODEL_GEMINI || 'gemini-2.5-pro',
    async complete({ key, model, system, messages, signal }) {
      const { res, data } = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { 'x-goog-api-key': key },
        {
          system_instruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { maxOutputTokens: MAX_TUTOR_TOKENS },
        }, signal);
      if (!res.ok) throw new ProviderError('gemini', res.status, data?.error?.message);
      if (data?.promptFeedback?.blockReason) return { refusal: true };
      const cand = data?.candidates?.[0];
      if (cand && ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST'].includes(cand.finishReason)) return { refusal: true };
      return {
        text: (cand?.content?.parts || []).map((p) => p.text || '').join('').trim(),
        truncated: cand?.finishReason === 'MAX_TOKENS',
      };
    },
  },
};

// Providers whose key is present, in the configured order.
function providerChain() {
  const order = (process.env.TUTOR_PROVIDERS || 'anthropic,openai,gemini')
    .split(',').map((n) => n.trim().toLowerCase()).filter((n) => ADAPTERS[n]);
  return order.filter((n) => Boolean(ADAPTERS[n].key()));
}

// First provider that answers wins. A refusal is final (it is not shopped to
// another vendor); any error or empty answer moves to the next provider.
async function completeWithFallback({ system, messages }) {
  const failures = [];
  for (const name of providerChain()) {
    const adapter = ADAPTERS[name];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const out = await adapter.complete({ key: adapter.key(), model: adapter.model(), system, messages, signal: controller.signal });
      if (out.refusal) return { refusal: true, provider: name };
      // A reply cut off by the token budget must never be presented as
      // complete (the app promises complete explanations): callers append a
      // literal notice when truncated text is still worth showing, and a
      // fully-consumed budget with no text moves to the next provider.
      if (out.text) return { text: out.text, truncated: Boolean(out.truncated), provider: name };
      failures.push(out.truncated ? `${name}: budget spent with no answer text` : `${name}: empty answer`);
    } catch (e) {
      failures.push(e instanceof ProviderError ? e.message : `${name}: ${e.name === 'AbortError' ? 'timed out' : e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return { failures };
}

const TUTOR_SYSTEM = `You are the tutor inside Calc Coach, an AP Calculus BC study app. The learner is an autistic professional software developer. Follow these rules exactly.

Style:
- Literal, concrete, calm language. No idioms, no exclamation marks, no rhetorical questions, no emoji.
- Short paragraphs. Define a term before relying on it.
- Write math as LaTeX inside $...$ delimiters (inline) or $$...$$ (display); the app renders it.
- Keep answers under 250 words unless the learner asks for more depth.
- A programming analogy is welcome when it is precise; always say where the analogy breaks.

Ground truth:
- The problem statement, correct answer, and verified solution steps are provided to you. They are authoritative. Never contradict them. If you believe they contain an error, say the app's stored solution is the authority and suggest the learner report it, then reason from the stored solution anyway.
- Never invent a different final answer.

Task:
- When shown the learner's incorrect answer, first diagnose the specific step where their likely reasoning diverged from the correct path, based on the answer they actually gave. Name that step plainly, without blame language, then explain the correct step. Do not restate the entire solution; the app already shows it.
- When shown a correct answer with a question, answer the question directly.
- For follow-up questions, stay on this problem and its concept. If asked about something unrelated to calculus, say plainly that you only discuss calculus here, and invite a calculus question.
- Feedback is information, never judgment. Say "this choice comes from ..." rather than "you made the mistake of ...".
- Learner history, when provided, is factual and describes attempts before this one. If the same wrong choice was picked before, say so plainly, name the specific error behind it (the stored misconception note is provided), and address that error first. Do not speculate beyond what the history states.`;

// Turns the client's attempt counts into plain sentences. Every number is
// re-validated here and misconception text is taken from the stored content,
// never from the client.
function historyLines(q, history, chosenIndex, correct) {
  const lines = [];
  const n = (v, max = 100000) => (Number.isInteger(v) && v >= 0 && v <= max ? v : null);
  const label = (i) => 'ABCDE'[i];
  const isMc = q.type === 'mc';
  if (isMc && !correct && n(chosenIndex, 4) !== null && chosenIndex < q.choices.length && q.misconceptions?.[chosenIndex]) {
    lines.push(`Stored misconception note for the learner's choice ${label(chosenIndex)}: ${q.misconceptions[chosenIndex]}`);
  }
  if (!history || typeof history !== 'object') return lines;
  const attempts = n(history.attempts), wrong = n(history.wrongCount) ?? 0;
  if (attempts === null || attempts === 0) {
    lines.push('This was the learner\'s first attempt at this question.');
  } else {
    const picks = (Array.isArray(history.priorWrongChoices) ? history.priorWrongChoices : [])
      .map((c) => ({ index: n(c?.index, 4), count: n(c?.count) }))
      .filter((c) => isMc && c.index !== null && c.count && c.index < q.choices.length)
      .map((c) => `${label(c.index)} (${c.count} time${c.count === 1 ? '' : 's'})`);
    lines.push(`Learner history on this question before this attempt: ${attempts} attempt${attempts === 1 ? '' : 's'}, ${wrong} wrong${picks.length ? `; wrong choices picked before: ${picks.join(', ')}` : ''}.`);
  }
  const score = n(history.skillScore, 100), rt = n(history.recentTotal, 50), rw = n(history.recentWrong, 50) ?? 0, rh = n(history.recentWithHints, 50) ?? 0;
  if (score !== null && rt) lines.push(`Learner history on this skill: mastery ${score} of 100; of the last ${rt} answer${rt === 1 ? '' : 's'} on it, ${rw} wrong and ${rh} correct only with hints.`);
  return lines;
}

async function handleTutor(req, res, url) {
  const chain = providerChain();
  // Reports availability and the vendor chain only; model ids never reach the browser.
  if (req.method === 'GET') return sendJson(res, 200, { available: chain.length > 0, providers: chain });
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'use GET or POST' });
  if (!chain.length) return sendJson(res, 200, { available: false });

  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'body must be valid JSON' }); }
  const { unitId, questionId, learnerAnswer, correct, followUp, transcript, chosenIndex, history } = body || {};

  // Ground the tutor in the verified content straight from disk.
  let unit;
  try {
    const safe = String(unitId || '').replace(/[^a-z0-9-]/g, '');
    unit = JSON.parse(await readFile(join(CONTENT, `${safe}.json`), 'utf8'));
  } catch { return sendJson(res, 404, { error: 'unknown unit' }); }
  const q = (unit.questions || []).find((x) => x.id === questionId);
  if (!q) return sendJson(res, 404, { error: 'unknown question' });

  const answerText = q.type === 'mc'
    ? `The correct choice is ${'ABCDE'[q.answerIndex]}: ${q.choices[q.answerIndex]}`
    : `The correct answer is ${q.answer}`;
  const context = [
    `Problem (from unit "${unit.title}", skill "${q.skillId}"):`,
    q.prompt,
    q.type === 'mc' ? `Choices: ${q.choices.map((c, i) => `${'ABCDE'[i]}. ${c}`).join('  ')}` : '',
    `Verified ${answerText}`,
    `Verified solution steps: ${q.solution.map((s, i) => `(${i + 1}) ${s.text}${s.math ? ` [${s.math}]` : ''}`).join(' ')}`,
    `The learner answered: ${String(learnerAnswer ?? '(no answer)').slice(0, 500)} — this was ${correct ? 'correct' : 'not correct'}.`,
    ...historyLines(q, history, chosenIndex, Boolean(correct)),
  ].filter(Boolean).join('\n');

  // Rebuild the short per-question conversation; the client keeps it in memory.
  const messages = [];
  const first = correct
    ? `${context}\n\nThe learner answered correctly and has a question about this problem.`
    : `${context}\n\nExplain where the learner's likely reasoning diverged, based on the answer they gave.`;
  messages.push({ role: 'user', content: first });
  for (const t of Array.isArray(transcript) ? transcript.slice(-8) : []) {
    if (t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string') {
      messages.push({ role: t.role, content: t.text.slice(0, 4000) });
    }
  }
  if (followUp) messages.push({ role: 'user', content: String(followUp).slice(0, 4000) });

  const out = await completeWithFallback({ system: TUTOR_SYSTEM, messages });
  if (out.refusal) {
    return sendJson(res, 200, { text: 'The tutor cannot answer that particular question. A question about this calculus problem will work.' });
  }
  if (out.text) {
    const text = out.truncated
      ? `${out.text}\n\nThis reply reached its length limit and stops early. Ask a follow-up question to continue from this point.`
      : out.text;
    return sendJson(res, 200, { text });
  }
  console.error('[calc-coach] tutor: every provider failed —', out.failures.join(' | '));
  return sendJson(res, 502, { error: 'The tutor could not be reached.' });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  try {
    if (path === '/api/health') return sendJson(res, 200, { ok: true, app: 'calc-coach' });
    if (path === '/api/tutor') return await handleTutor(req, res, url);
    if (path.startsWith('/api/canvas/')) return await handleCanvas(req, res, url);

    if (path === '/api/progress') {
      const slug = profileSlug(url.searchParams.get('profile'));
      const file = profileFile(slug);
      if (req.method === 'GET') {
        const fromDb = await storeRead(`progress-${slug}`);
        if (fromDb !== null) return sendJson(res, 200, fromDb);
        try {
          const raw = await readFile(file, 'utf8');
          try { storeWrite(`progress-${slug}`, JSON.parse(raw)); } catch { /* unreadable mirror stays file-only */ }
          return send(res, 200, raw);
        } catch {
          return sendJson(res, 200, null); // no saved progress yet — the client starts fresh
        }
      }
      if (req.method === 'PUT') {
        const raw = await readBody(req);
        let parsed;
        try { parsed = JSON.parse(raw); } catch { return sendJson(res, 400, { error: 'body must be valid JSON' }); }
        if (typeof parsed !== 'object' || parsed === null) return sendJson(res, 400, { error: 'body must be a JSON object' });
        await mkdir(DATA, { recursive: true });
        const tmp = `${file}.tmp`;
        await writeFile(tmp, JSON.stringify(parsed, null, 2), 'utf8');
        await rename(tmp, file); // atomic: never leaves a half-written progress file
        storeWrite(`progress-${slug}`, parsed);
        return sendJson(res, 200, { saved: true });
      }
      return sendJson(res, 405, { error: 'use GET or PUT' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });
    if (path.startsWith('/content/')) return serveFile(res, CONTENT, path.slice('/content/'.length));
    if (path === '/' || path === '/index.html') return serveFile(res, PUBLIC, 'index.html');
    return serveFile(res, PUBLIC, path.slice(1));
  } catch (e) {
    console.error(`[calc-coach] ${req.method} ${path} failed:`, e.message);
    sendJson(res, 500, { error: 'internal error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[calc-coach] listening on http://0.0.0.0:${PORT}`);
});
