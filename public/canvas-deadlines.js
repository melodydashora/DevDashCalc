// Deterministic, source-backed planning dates. Canvas dueAt is always official.
// This module never fetches, executes source HTML, guesses a year from the clock,
// or substitutes all_dates (which may belong to a different learner/section).
const LIST_LIMIT = 500;
const TEXT_LIMIT = 60_000;
const DAY = 86400000;
const list = value => Array.isArray(value) ? value : [];
const string = value => typeof value === 'string' ? value : '';
const canonical = value => string(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const validInstant = value => typeof value === 'string' && /T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
function safeUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function canvasPlainText(value) {
  return string(value).slice(0, TEXT_LIMIT)
    .replace(/<!--[^]*?-->/g, '').replace(/<(script|style|noscript)\b[^>]*>[^]*?<\/\1\s*>/gi, '')
    .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>|<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|#160);/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#(?:39|x27);/gi, "'")
    .replace(/&#(\d+);|&#x([a-f\d]+);/gi, (_, dec, hex) => {
      const code = parseInt(dec || hex, dec ? 10 : 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }).replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').trim();
}
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_PATTERN = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE_PATTERN = new RegExp(`\\b(?:\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}(?::\\d{2})?(?:Z|[+-]\\d{2}:?\\d{2}))?|${MONTH_PATTERN}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_PATTERN}\\.?(?:,?\\s+\\d{4})?|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?)\\b`, 'gi');
function ymd(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && year <= 2200 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
}
export function validTimeZone(value) {
  if (!string(value)) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0); return value; } catch { return null; }
}
export function dateInTimeZone(now, timeZone) {
  if (!Number.isFinite(now) || !validTimeZone(timeZone)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = type => parts.find(entry => entry.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function termBounds(course) {
  const useCourseDates = course.restrictEnrollmentsToCourseDates === true;
  const start = useCourseDates ? course.startAt || course.term?.startAt : course.term?.startAt || course.startAt;
  const end = useCourseDates ? course.endAt || course.term?.endAt : course.term?.endAt || course.endAt;
  const zone = validTimeZone(course.timeZone);
  const day = value => validInstant(value) ? (zone ? dateInTimeZone(Date.parse(value), zone) : value.slice(0, 10)) : /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : null;
  return { start: day(start), end: day(end) };
}
function parseDate(token, course, sourceText) {
  let year, month, day;
  const iso = token.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const numeric = token.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (iso) { [, year, month, day] = iso.map(Number); }
  else if (numeric) {
    let a = +numeric[1], b = +numeric[2]; year = numeric[3] ? +numeric[3] : null;
    if (year && year < 100) return { reason: 'two-digit-year' };
    const us = course.locale === 'en-US' || /\bmm\s*\/\s*dd\b/i.test(sourceText);
    const dayFirst = /^(?:en-GB|en-AU|en-NZ|fr|de)/i.test(course.locale || '') || /\bdd\s*\/\s*mm\b/i.test(sourceText);
    if (a <= 12 && b <= 12 && a !== b && !us && !dayFirst) return { reason: 'ambiguous-numeric-date' };
    [month, day] = dayFirst || a > 12 ? [b, a] : [a, b];
  } else {
    const name = token.match(new RegExp(MONTH_PATTERN, 'i'))?.[0];
    month = MONTHS.findIndex(value => value.startsWith(name?.toLowerCase().slice(0, 3))) + 1;
    const digits = token.match(/\d+/g) || [];
    day = +digits[0]; year = digits[1] ? +digits[1] : null;
  }
  const bounds = termBounds(course);
  if (!year) {
    if (!bounds.start || !bounds.end) return { reason: 'year-not-established' };
    const candidates = [];
    for (let y = +bounds.start.slice(0, 4); y <= +bounds.end.slice(0, 4) && y <= +bounds.start.slice(0, 4) + 5; y++) {
      const candidate = ymd(y, month, day);
      if (candidate && candidate >= bounds.start && candidate <= bounds.end) candidates.push(candidate);
    }
    if (candidates.length !== 1) return { reason: candidates.length ? 'ambiguous-year' : 'outside-course-term' };
    return { date: candidates[0], yearBasis: 'course-term' };
  }
  const date = ymd(year, month, day);
  if (!date) return { reason: 'invalid-date' };
  if (bounds.start && date < bounds.start || bounds.end && date > bounds.end) return { date, reason: 'outside-course-term' };
  return { date, yearBasis: 'explicit', ...(token.includes('T') && validInstant(token) ? { dueAt: new Date(token).toISOString() } : {}) };
}
function localInstant(date, hour, minute, zone) {
  // Matching all possible offsets also detects nonexistent and repeated DST
  // wall-clock times; neither is silently shifted or resolved arbitrarily.
  const target = `${date} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const initial = Date.parse(`${date}T00:00:00Z`) + (hour * 60 + minute) * 60000;
  const matches = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const time = initial - offset * 60000;
    const parts = formatter.formatToParts(time); const part = type => parts.find(value => value.type === type)?.value;
    if (`${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}` === target) matches.push(time);
  }
  return matches.length === 1 ? { dueAt: new Date(matches[0]).toISOString() } : { reason: matches.length ? 'ambiguous-dst-time' : 'nonexistent-dst-time' };
}
function extractTime(line, date, course) {
  const pattern = /\b(?:(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)|(\d{1,2}):(\d{2})|noon|midnight)\b/gi;
  const matches = [...line.matchAll(pattern)];
  const match = matches[0];
  if (!match) return { precision: 'date', dueAt: null };
  let hour = +(match[1] || match[4] || (match[0].toLowerCase() === 'noon' ? 12 : 0));
  const minute = +(match[2] || match[5] || 0);
  if (match[3]) {
    if (hour < 1 || hour > 12) return { reason: 'invalid-time' };
    hour = hour % 12 + (/^p/i.test(match[3]) ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return { reason: 'invalid-time' };
  if (matches.length > 1 || /\b(?:between|from)\s+\d[^\n]*(?:\bto\b|–)/i.test(line)) return { reason: 'time-range' };
  const zone = validTimeZone(course.timeZone);
  if (!zone) return { reason: 'time-zone-not-established' };
  const instant = localInstant(date, hour, minute, zone);
  if (instant.reason) return instant;
  const explicitZone = line.match(/\b(UTC|GMT|[ECMP][DS]T|[A-Z][a-z_]+\/[A-Za-z_]+)\b/);
  if (explicitZone) {
    const abbreviation = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' }).formatToParts(Date.parse(instant.dueAt)).find(p => p.type === 'timeZoneName')?.value;
    if (explicitZone[1] !== zone && explicitZone[1] !== abbreviation) return { reason: 'time-zone-conflict' };
  }
  return { ...instant, precision: 'time', timeZone: zone };
}
function splitCells(line, delimiter) {
  if (delimiter !== ',') return line.split(delimiter).map(cell => canvasPlainText(cell).trim());
  // A quoted CSV date such as "October 16, 2026" remains one cell.
  const result = []; let cell = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (ch === ',' && !quoted) { result.push(cell.trim()); cell = ''; }
    else cell += ch;
  }
  result.push(cell.trim());
  return quoted ? [] : result;
}
function textRecords(text) {
  const records = []; let headers = [], delimiter = null;
  for (const raw of string(text).split(/\r?\n/)) {
    if (!raw.trim()) { headers = []; delimiter = null; continue; }
    const possibleDelimiter = raw.includes('\t') ? '\t' : raw.includes('|') ? '|' : / {2,}/.test(raw.trim()) ? / {2,}/ : raw.includes(',') ? ',' : null;
    const proposed = possibleDelimiter ? splitCells(raw.trim(), possibleDelimiter) : [];
    const isHeader = proposed.length > 1 && proposed.some(cell => /^(?:assignment|activity|task|assessment|topic)$/i.test(cell)) && proposed.some(cell => /\b(?:due|deadline|submit)\b/i.test(cell));
    if (isHeader) { headers = proposed; delimiter = possibleDelimiter; continue; }
    const cells = delimiter ? splitCells(raw.trim(), delimiter) : [];
    const dueColumns = headers.map((header, index) => /\b(?:due|deadline|submit)\b/i.test(header) ? index : -1).filter(index => index >= 0);
    const table = headers.length > 0 && cells.length === headers.length;
    const line = canvasPlainText(raw);
    const values = table ? dueColumns.map(index => cells[index]).filter(Boolean) : [];
    const titleIndex = headers.findIndex(header => /^(?:assignment|activity|task|assessment|deliverable|homework)$/i.test(header));
    if (line) records.push({ text: line, dateText: values.length ? values.join(' | ') : line, explicitDue: table && dueColumns.length > 0 || /\b(?:due|deadline|submit(?:ted)? by|turn in by)\b/i.test(line), table, taskTitle: table && titleIndex >= 0 ? cells[titleIndex] : null });
  }
  return records;
}
function recordsFromHtml(html) {
  const records = [];
  // Preserve table cell boundaries: a date in another column must not drift
  // onto an unrelated assignment or be mistaken for its due date.
  const remaining = string(html).slice(0, TEXT_LIMIT).replace(/<table\b[^>]*>([^]*?)<\/table>/gi, (_, table) => {
    let headers = [];
    for (const row of table.matchAll(/<tr\b[^>]*>([^]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([^]*?)<\/t[dh]>/gi)].map(cell => canvasPlainText(cell[1]));
      if (!cells.length) continue;
      if (/<th\b/i.test(row[1]) || !headers.length && cells.some(cell => /^(?:due(?: date)?|deadline|assignment|date|topic|week|activity)$/i.test(cell))) { headers = cells; continue; }
      const dueColumns = headers.map((header, index) => /\b(?:due|deadline|submit)\b/i.test(header) ? index : -1).filter(index => index >= 0);
      const values = dueColumns.map(index => cells[index]).filter(Boolean);
      const titleIndex = headers.findIndex(header => /^(?:assignment|activity|task|assessment|deliverable|homework)$/i.test(header));
      records.push({ text: cells.join(' | '), dateText: values.length ? values.join(' | ') : cells.join(' | '), explicitDue: dueColumns.length > 0, table: true, taskTitle: titleIndex >= 0 ? cells[titleIndex] : null });
    }
    return '\n';
  });
  // Keep raw TSV/CSV and pdftotext's aligned spaces until their headers are read.
  // HTML outside tables still gets paragraph boundaries from canvasPlainText.
  records.push(...textRecords(/<[a-z][^>]*>/i.test(remaining) ? canvasPlainText(remaining) : remaining));
  return { records: records.slice(0, LIST_LIMIT), truncated: records.length > LIST_LIMIT };
}
function collectSources(course) {
  const sources = [];
  const add = (source, kind, assignmentId = null) => {
    if (!source || source.lockedForUser === true || source.published === false) return;
    const body = source.bodyHtml ?? source.body ?? source.text ?? source.contentText ?? source.descriptionHtml;
    if (typeof body !== 'string' || !body.trim()) return;
    const status = source.contentStatus ?? source.status;
    if (status && !['available', 'read', 'complete', 'completed', 'truncated', 'partial', 'ok', 'success'].includes(status)) return;
    sources.push({ ...source, kind, assignmentId, body: body.slice(0, TEXT_LIMIT), sourceUrl: safeUrl(source.htmlUrl || source.sourceUrl || source.url), truncated: body.length > TEXT_LIMIT || source.bodyTruncated === true || source.truncated === true || status === 'truncated', partial: status === 'partial' });
  };
  const syllabus = course.syllabusBody ?? course.syllabusBodyHtml ?? course.syllabusHtml;
  if (typeof syllabus === 'string') add({ id: course.id, title: 'Course syllabus', bodyHtml: syllabus, htmlUrl: course.syllabusUrl || (course.htmlUrl ? `${course.htmlUrl.replace(/\/$/, '')}/assignments/syllabus` : null), updatedAt: course.syllabusUpdatedAt, bodyTruncated: course.syllabusTruncated }, 'syllabus');
  add(course.frontPage || course.homePage, 'page');
  for (const page of list(course.pages)) add(page, 'page');
  for (const announcement of list(course.announcements)) add(announcement, 'announcement');
  for (const quiz of list(course.quizzes)) add(quiz, 'quiz', quiz.assignmentId ?? null);
  for (const quiz of list(course.newQuizzes)) add(quiz, 'new-quiz', quiz.assignmentId ?? quiz.id ?? null);
  for (const document of [...list(course.documents), ...list(course.contentSources)]) add(document, document.kind || 'document');
  for (const assignment of list(course.assignments)) add({ ...assignment, bodyHtml: assignment.descriptionHtml }, 'assignment', assignment.id);
  return { sources: sources.slice(0, LIST_LIMIT), truncated: sources.length > LIST_LIMIT };
}
function sectionReason(course, source, line) {
  const learnerIds = list(course.enrollmentSectionIds).map(String);
  const scopeIds = list(source.sectionIds).map(String);
  if (source.courseId != null && String(source.courseId) !== String(course.id)) return 'different-course';
  if (source.isSectionSpecific === true && !scopeIds.length) return 'section-not-established';
  if (scopeIds.length && (!learnerIds.length || !scopeIds.some(id => learnerIds.includes(id)))) return 'section-not-established';
  const pattern = /\b(?:section|period|block)\s+(?:no\.?\s*)?([a-z]?\d+[a-z]?|[a-z])\b/gi;
  const lineSections = [...line.matchAll(pattern)].map(match => canonical(match[0]));
  const headingSections = [...`${source.title || ''} ${canvasPlainText(source.body).slice(0, 300)}`.matchAll(pattern)].map(match => canonical(match[0]));
  const sections = [...new Set(lineSections.length ? lineSections : headingSections)];
  if (sections.length) {
    const names = list(course.enrollmentSectionNames).map(canonical);
    if (sections.length !== 1 || !names.some(name => name.includes(sections[0]))) return 'section-not-established';
  }
  return null;
}
function sourceTermReason(course, source) {
  const bounds = termBounds(course);
  if (!bounds.start || !bounds.end) return null;
  const heading = canvasPlainText(`${source.title || ''}\n${source.body}`).slice(0, 200);
  const schoolYear = heading.match(/\b(20\d{2})\s*[-–/]\s*(20\d{2})\b/);
  if (schoolYear && (+schoolYear[1] !== +bounds.start.slice(0, 4) || +schoolYear[2] !== +bounds.end.slice(0, 4))) return 'different-source-term';
  const season = heading.match(/\b(fall|spring|summer|winter)\s+(20\d{2})\b/i);
  if (!season) return null;
  const year = +season[2], name = season[1].toLowerCase();
  const start = `${year}-${name === 'fall' ? '07-01' : name === 'summer' ? '05-01' : name === 'winter' ? '12-01' : '01-01'}`;
  const end = `${name === 'winter' ? year + 1 : year}-${name === 'fall' ? '12-31' : name === 'summer' ? '09-30' : name === 'winter' ? '03-31' : '06-30'}`;
  return end < bounds.start || start > bounds.end ? 'different-source-term' : null;
}
function matchedAssignments(assignments, source, line) {
  if (source.assignmentId != null) return assignments.filter(a => String(a.id) === String(source.assignmentId));
  const normalized = ` ${canonical(line)} `;
  return assignments.filter(a => {
    const name = canonical(a.name);
    return name.length >= 4 && name !== 'untitled assignment' && normalized.includes(` ${name} `);
  });
}
function sourceTaskTitle(record) {
  if (!record.explicitDue) return null;
  let title = record.taskTitle;
  if (!title) {
    // Untabulated prose must be a short, unambiguous task statement, not an
    // arbitrary sentence mentioning a deadline or the instructor's policy.
    title = record.text.match(/^([\p{L}\p{N}][^:;.!?]{3,120}?)\s+(?:is\s+)?(?:now\s+)?due\b/iu)?.[1];
    if (!title || !/\b(?:essay|quiz|exam|test|report|project|homework|assignment|problem set|lab|presentation|worksheet|discussion|reflection|journal|portfolio|draft|reading)\b/i.test(title)) return null;
  }
  title = canvasPlainText(title).replace(/^[-*•]\s*/, '').trim();
  if (title.length < 4 || title.length > 160 || /\b(?:tbd|none|no class|holiday|optional|cancelled|canceled|not due|week\s*\d+|module\s*\d+)\b/i.test(title)) return null;
  if (/^(?:assignment|activity|task|assessment|topic|date|due date|deadline|reading|readings|class|syllabus|schedule|calendar|week|homework|quiz|exam|test|project)$/i.test(title)) return null;
  if (/\b(?:instructor|teacher|syllabus|office hours|every|weekly|policy)\b/i.test(title)) return null;
  return title;
}
function sourceTaskKey(courseId, source, title) {
  const text = `${courseId}|${source.kind}|${source.id || source.sourceUrl || source.title || ''}|${canonical(title)}`;
  // Stable opaque local identifier; never a Canvas assignment ID or API path.
  let hash = 2166136261;
  for (const ch of text) { hash ^= ch.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return `source-task-${(hash >>> 0).toString(16)}`;
}
function summarize(evidence) {
  const { date = null, dueAt = null, precision = null, source, sourceUrl, excerpt, timeZone = null } = evidence;
  return { date, dueAt, precision, timeZone, source, sourceUrl, excerpt };
}
export function resolveCourseDeadlines(course, { now } = {}) {
  if (!course || typeof course !== 'object') return course;
  const canvasAssignments = list(course.assignments);
  const collected = collectSources(course);
  const sources = collected.sources.map(source => { const parsed = recordsFromHtml(source.body); return { ...source, records: parsed.records, truncated: source.truncated || parsed.truncated }; });
  const sourceTasks = new Map();
  for (const source of sources) {
    if (source.assignmentId != null) continue;
    for (const record of source.records) {
      const title = sourceTaskTitle(record);
      if (!title || matchedAssignments(canvasAssignments, source, record.text).length) continue;
      const name = canonical(title);
      if (sourceTasks.has(name) || sourceTasks.size >= LIST_LIMIT) continue;
      const sourceTaskId = sourceTaskKey(course.id, source, title);
      sourceTasks.set(name, { id: sourceTaskId, sourceTaskId, sourceTask: true, name: title, source: source.kind, sourceUrl: source.sourceUrl, dueAt: null, dueDateStatus: 'not-provided', completionStatus: 'unverified' });
    }
  }
  const assignments = [...canvasAssignments, ...sourceTasks.values()];
  const evidenceById = new Map(assignments.map(a => [String(a.id), []]));
  const names = new Map();
  for (const a of assignments) { const key = canonical(a.name); names.set(key, (names.get(key) || 0) + 1); }
  for (const source of sources) {
    for (const record of source.records) {
      const matches = matchedAssignments(assignments, source, record.text);
      if (!matches.length) continue;
      const revised = record.dateText.match(/\b(?:now due|(?:deadline|due date)\s+(?:is\s+)?(?:changed|moved|extended|rescheduled)\s+to|(?:extended|rescheduled)\s+to)\s*/i);
      const dateText = revised ? record.dateText.slice(revised.index + revised[0].length) : record.dateText;
      const tokens = [...dateText.matchAll(DATE_PATTERN)].map(match => match[0]);
      if (!tokens.length) continue;
      for (const assignment of matches) {
        const reasons = [];
        const explicitDue = record.explicitDue || /\b(?:due|deadline|submit(?:ted)? by|turn in by)\b/i.test(record.text);
        if (!explicitDue) reasons.push('date-purpose-not-established');
        if (/\b(?:not due|no longer due|cancelled|canceled|withdrawn)\b/i.test(record.text)) reasons.push('cancelled-or-negated-deadline');
        if (new RegExp(`(?:\\d{1,2})\\s*(?:[–—]|-(?!\\d{2}-)|\\bto\\b|\\bthrough\\b)\\s*(?:\\d{1,2}|${MONTH_PATTERN})`, 'i').test(dateText.replace(/\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2}))?/g, ''))) reasons.push('date-range');
        if (matches.length > 1 && tokens.length > 1) reasons.push('multiple-assignments-and-dates');
        if (!source.assignmentId && names.get(canonical(assignment.name)) > 1) reasons.push('duplicate-assignment-title');
        const scopeReason = sectionReason(course, source, record.text) || sourceTermReason(course, source);
        if (scopeReason) reasons.push(scopeReason);
        if (source.truncated) reasons.push('source-truncated');
        if (source.partial) reasons.push('source-partially-read');
        if (assignment.dueDateStatus === 'no-date' && (assignment.hasOverrides === true || assignment.onlyVisibleToOverrides === true)) reasons.push('learner-no-date-override');
        if (/\b(?:tentative(?:ly)?|provisional(?:ly)?|tbd|subject to change|approximately|around)\b/i.test(record.text)) reasons.push('tentative-date');
        for (const token of tokens.slice(0, 10)) {
          const parsed = parseDate(token, course, source.body);
          const time = parsed.date && !parsed.dueAt ? extractTime(dateText, parsed.date, course) : { precision: parsed.dueAt ? 'time' : 'date' };
          const reason = [...reasons, parsed.reason, time.reason].filter(Boolean);
          const entry = { ...parsed, ...time, source: source.kind, sourceId: source.id == null ? null : String(source.id), sourceUrl: source.sourceUrl, excerpt: record.text.slice(0, 700), assignmentId: assignment.sourceTask ? null : String(assignment.id), ...(assignment.sourceTask ? { sourceTaskId: assignment.sourceTaskId } : {}), status: reason.length ? 'needs-review' : 'candidate', reasons: reason, updatedAt: validInstant(source.updatedAt || source.postedAt) ? (source.updatedAt || source.postedAt) : null, revision: Boolean(revised), readAt: validInstant(source.readAt) ? source.readAt : null, documentVersionHash: /^[a-f0-9]{16,128}$/i.test(source.documentVersionHash || '') ? source.documentVersionHash : null };
          const evidence = evidenceById.get(String(assignment.id));
          if (evidence.length < 40 && !evidence.some(old => old.source === entry.source && old.sourceUrl === entry.sourceUrl && old.excerpt === entry.excerpt && old.date === entry.date && old.dueAt === entry.dueAt)) evidence.push(entry);
        }
      }
    }
  }
  const deadlineReview = [];
  const resolved = assignments.map(assignment => {
    // Always rederive; stale cached inferences must not survive a source change.
    const { planningDeadline: previous, deadlineEvidence: previousEvidence, ...result } = assignment;
    const evidence = evidenceById.get(String(assignment.id)) || [];
    if (!evidence.length) return result;
    const candidates = evidence.filter(item => item.status === 'candidate');
    const key = item => item.dueAt || item.date;
    const distinctDates = new Set(candidates.map(item => item.date));
    const distinctTimes = new Set(candidates.filter(item => item.dueAt).map(item => item.dueAt));
    let chosen = candidates.find(item => item.dueAt) || candidates[0];
    // A same-day explicit time refines a date-only source; different times or
    // calendar days remain a conflict instead of arbitrarily choosing one.
    let status = candidates.length && distinctDates.size === 1 && distinctTimes.size <= 1 ? 'resolved' : candidates.length ? 'conflict' : 'needs-review';
    // A clear, newer dated revision can supersede an older source, not an
    // official Canvas date. A mere newer page edit is not a schedule revision.
    if (status === 'conflict') {
      const revisions = candidates.filter(item => item.revision && item.updatedAt && (!Number.isFinite(now) || Date.parse(item.updatedAt) <= now)).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      const latest = revisions[0];
      if (latest && candidates.every(item => key(item) === key(latest) || item.updatedAt && Date.parse(item.updatedAt) < Date.parse(latest.updatedAt))) { chosen = latest; status = 'resolved'; }
    }
    if (validInstant(assignment.dueAt)) {
      const officialDate = dateInTimeZone(Date.parse(assignment.dueAt), course.timeZone) || assignment.dueAt.slice(0, 10);
      const conflicts = candidates.filter(item => item.dueAt ? Date.parse(item.dueAt) !== Date.parse(assignment.dueAt) : item.date !== officialDate);
      if (conflicts.length) deadlineReview.push({ assignmentId: String(assignment.id), status: 'official-conflict', officialDueAt: assignment.dueAt, evidence });
      return { ...result, deadlineEvidence: evidence };
    }
    // Invalid official fields merit review rather than concealing an API error.
    if (assignment.dueDateStatus === 'invalid' && status === 'resolved') status = 'needs-review';
    const planningDeadline = { ...(status === 'resolved' ? summarize(chosen) : { date: null, dueAt: null, precision: null, source: null, sourceUrl: null, excerpt: null }), status, evidence };
    if (status !== 'resolved') deadlineReview.push({ assignmentId: assignment.sourceTask ? null : String(assignment.id), ...(assignment.sourceTask ? { sourceTaskId: assignment.sourceTaskId } : {}), status, evidence });
    return { ...result, planningDeadline };
  });
  const planningTasks = resolved.filter(task => task.sourceTask).filter(task => task.planningDeadline).map(({ id, dueAt, dueDateStatus, ...task }) => task);
  return { ...course, assignments: resolved.filter(task => !task.sourceTask), planningTasks, deadlineReview,
    deadlineResolution: { sourceCount: sources.length, sourceLimit: LIST_LIMIT, sourceTaskCount: planningTasks.length, truncated: collected.truncated || sources.some(source => source.truncated) || sourceTasks.size >= LIST_LIMIT, method: 'explicit-source-evidence' } };
}

// Calendar-day comparison is separate from a timestamp. A date-only deadline
// is due today for the entire course-local day; no 23:59 deadline is invented.
export function assignmentPlanningTiming(assignment, course, now) {
  if (validInstant(assignment?.dueAt)) return { dueAt: assignment.dueAt, date: null, precision: 'time', source: 'canvas', delta: Date.parse(assignment.dueAt) - now, overdue: Date.parse(assignment.dueAt) < now };
  const planning = assignment?.planningDeadline;
  if (planning?.status !== 'resolved') return { dueAt: null, date: null, precision: null, source: null, delta: null, overdue: false };
  if (validInstant(planning.dueAt)) return { dueAt: planning.dueAt, date: planning.date, precision: 'time', source: planning.source, delta: Date.parse(planning.dueAt) - now, overdue: Date.parse(planning.dueAt) < now };
  const today = dateInTimeZone(now, course?.timeZone);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(planning.date || '') ? planning.date : null;
  const days = today && date ? (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY : null;
  return { dueAt: null, date, precision: 'date', source: planning.source, delta: days === null ? null : days * DAY, overdue: days !== null && days < 0 };
}
