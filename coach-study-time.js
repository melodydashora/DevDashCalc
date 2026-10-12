// Request-scoped clock and browser activity estimates. Nothing is persisted,
// scheduled, or inferred about the student's attention, health, or sleep.
export const COACH_STUDY_TIME_LIMITS = Object.freeze({ seconds: 86_400, staleMs: 5 * 60_000, futureMs: 2 * 60_000 });

export const COACH_STUDY_TIME_SYSTEM = `Timing context is optional. Its local clock is calculated from the server's current time and the browser-reported IANA time zone; use it only when clock.state is available. Never assume the learner is in UTC or infer their local time from source timestamps. Session durations are browser-reported estimates of foreground study activity, not proof of attention, uninterrupted work, performance, fatigue, sleep, or age. An unavailable or stale session does not mean zero study time. Do not infer a bedtime or need for sleep from the clock alone.
Answer the student's learning question first unless they ask for timing or planning help. Use known, stated needs and the recent conversation when offering situational guidance. If a long continuous activity estimate makes a pause relevant, offer one brief, optional break or stopping-point suggestion after helping with the question. Treat durations as adjustable planning information, not a medical or attention limit. Do not repeatedly remind or nag: check recent conversation and respect a declined suggestion. Paused or idle status does not describe an ongoing uninterrupted session. Never block learning, force a break, start a countdown, claim a scheduled reminder, or award progress from time spent. A suitable local-time greeting may use the supplied learner name when a greeting is useful; do not add a greeting to every answer.`;

function localClock(rawZone, now) {
  const unavailable = { state: 'unavailable', reason: 'A valid local time zone was not supplied.' };
  if (typeof rawZone !== 'string' || rawZone.length > 100
    || !/^[A-Za-z][A-Za-z0-9_+\-/]{0,99}$/.test(rawZone)) return unavailable;
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: rawZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' });
    const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
    const offset = parts.timeZoneName === 'GMT' ? '+00:00' : parts.timeZoneName.replace(/^GMT/, '');
    if (!/^[+-]\d{2}:\d{2}$/.test(offset)) return unavailable;
    const hour = Number(parts.hour), timeZone = formatter.resolvedOptions().timeZone;
    return { state: 'available', source: 'Server current time with browser-reported IANA time zone.', timeZone,
      serverTime: new Date(now).toISOString(),
      localDateTime: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`,
      dayPart: hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 22 ? 'evening' : 'night' };
  } catch { return unavailable; }
}

function studySession(raw, now) {
  const unavailable = reason => ({ state: 'unavailable', reason });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return unavailable('No study activity estimate was supplied.');
  const names = ['activeSeconds', 'continuousSeconds', 'topicSeconds'];
  if (!names.every(name => typeof raw[name] === 'number' && Number.isFinite(raw[name]) && raw[name] >= 0)
    || raw.continuousSeconds > raw.activeSeconds || raw.topicSeconds > raw.activeSeconds
    || !['active', 'paused', 'idle'].includes(raw.status)
    || typeof raw.observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(raw.observedAt)) {
    return unavailable('The supplied study activity estimate was invalid.');
  }
  const observedAt = Date.parse(raw.observedAt), age = now - observedAt;
  const canonicalObservation = raw.observedAt.replace(/(?:\.(\d{1,3}))?Z$/, (_match, fraction) => `.${(fraction || '').padEnd(3, '0')}Z`);
  if (!Number.isFinite(observedAt) || new Date(observedAt).toISOString() !== canonicalObservation
    || age > COACH_STUDY_TIME_LIMITS.staleMs || age < -COACH_STUDY_TIME_LIMITS.futureMs) {
    return unavailable('The study activity estimate was stale or its observation time could not be checked.');
  }
  return { state: 'available', source: 'Browser-reported foreground activity estimate; not proof of attention or learning.',
    status: raw.status, observedAt: new Date(observedAt).toISOString(), observationAgeSeconds: Math.max(0, Math.floor(age / 1000)),
    ...Object.fromEntries(names.map(name => [name, Math.min(COACH_STUDY_TIME_LIMITS.seconds, Math.floor(raw[name]))])),
    capped: names.some(name => raw[name] > COACH_STUDY_TIME_LIMITS.seconds) };
}

export function buildCoachStudyTime(raw, { now = Date.now() } = {}) {
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw new TypeError('Use a valid server time.');
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return { clock: localClock(input.timeZone, now), session: studySession(input.session, now) };
}
