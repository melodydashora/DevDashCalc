// Course timing comes from Canvas, never from the learner's name or diagnosis.
// Unknown dates stay unknown; a missing assignment deadline does not archive a class.
export function courseTimeStatus(course, now) {
  const start = Date.parse(course?.term?.startAt || '');
  const end = Date.parse(course?.term?.endAt || '');
  if (!Number.isFinite(now)) return 'unknown';
  if (Number.isFinite(start) && Number.isFinite(end) && start > end) return 'unknown';
  if (Number.isFinite(end) && end < now) return 'past';
  if (Number.isFinite(start) && start > now) return 'upcoming';
  return Number.isFinite(start) || Number.isFinite(end) ? 'current' : 'unknown';
}

export function homeCourseGroups(snapshot, now) {
  const groups = { current: [], past: [], upcoming: [], unknown: [] };
  for (const course of Array.isArray(snapshot?.courses) ? snapshot.courses : []) {
    if (!course || !/^[0-9]{1,20}$/.test(String(course.id))) continue;
    groups[courseTimeStatus(course, now)].push(course);
  }
  for (const courses of Object.values(groups)) courses.sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)));
  return groups;
}

export function currentHomeTermIds(terms, now) {
  return (Array.isArray(terms) ? terms : []).filter(term => courseTimeStatus({ term }, now) === 'current').map(term => term.id);
}

export function canvasRefreshDue(fetchedAt, now, intervalMs = 300000) {
  const read = Date.parse(fetchedAt || '');
  return !Number.isFinite(read) || now - read >= intervalMs;
}
