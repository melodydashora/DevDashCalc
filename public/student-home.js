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

// Home topics come only from explicit saved plan rows, never from an
// independent curriculum manifest or guessed words in a course title.
export function homePlanTopics(plans) {
  const result = [];
  for (const plan of Array.isArray(plans) ? plans : []) {
    if (!plan || !/^[a-z0-9-]{1,64}$/.test(plan.id || '') || !plan.course || typeof plan.course.name !== 'string') continue;
    const topics = [...new Set((Array.isArray(plan.topics) ? plan.topics : [])
      .filter(topic => typeof topic === 'string').map(topic => topic.trim().slice(0, 200)).filter(Boolean))];
    if (!topics.length) continue;
    result.push({ planId: plan.id, title: typeof plan.title === 'string' ? plan.title.slice(0, 160) : '',
      courseId: String(plan.course.id || ''), courseName: plan.course.name.slice(0, 200),
      source: plan.source === 'astra' ? 'astra' : 'student', topics });
  }
  return result;
}
