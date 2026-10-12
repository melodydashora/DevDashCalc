// Shared by the server and browser. Time suggests pace; only checked steps
// determine completion. These helpers never save a plan or send notifications.
export class PlanScheduleError extends Error {
  constructor(message) { super(message); this.name = 'PlanScheduleError'; this.status = 400; }
}
const fail = message => { throw new PlanScheduleError(message); };
const clamp = value => Math.max(0, Math.min(100, value));
const percentage = (part, total) => total > 0 ? Math.round(clamp(part / total * 100) * 10) / 10 : 0;

function timeZoneName(value) {
  if (typeof value !== 'string' || value.length > 100 || !/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)*$/.test(value)) fail('Choose a valid time zone.');
  try { return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone; }
  catch { fail('Choose a valid time zone.'); }
}

function civilTime(parts) {
  const [year, month, day, hour, minute, second = 0, millisecond = 0] = parts.map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day); date.setUTCHours(hour, minute, second, millisecond);
  if (year < 1 || year > 9999 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
    || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) fail('Enter a valid calendar date and time.');
  return date.getTime();
}

// Never let the server's or browser's implicit local timezone interpret a date.
function explicitInstant(value) {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) fail('Include an explicit UTC offset with each scheduled date and time.');
  const time = civilTime([...match.slice(1, 6), match[6] || '0', (match[7] || '').padEnd(3, '0') || '0']);
  const zone = match[8];
  if (zone === 'Z') return time;
  const hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(4));
  if (hours > 23 || minutes > 59) fail('Enter a valid UTC offset.');
  const instant = time - (zone[0] === '+' ? 1 : -1) * (hours * 60 + minutes) * 60_000;
  if (new Date(instant).getUTCFullYear() < 1 || new Date(instant).getUTCFullYear() > 9999) fail('Choose a date between years 1 and 9999.');
  return instant;
}

/** A date-only syllabus date cannot become a timed schedule without learner input. */
export function normalizePlanSchedule(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) fail('Provide a schedule with a start, end, and time zone.');
  const start = explicitInstant(value.startAt), end = explicitInstant(value.endAt);
  if (end <= start) fail('Choose an end time after the start time.');
  const timeZone = timeZoneName(value.timeZone);
  if (value.remindersEnabled !== undefined && typeof value.remindersEnabled !== 'boolean') fail('Choose whether to enable reminders.');
  const leads = value.reminderLeadMinutes === undefined ? [15] : value.reminderLeadMinutes;
  if (!Array.isArray(leads) || leads.length > 5 || leads.some(n => !Number.isInteger(n) || n < 0 || n > 10080)) fail('Choose up to five reminder lead times from 0 to 10080 minutes.');
  return { startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), timeZone,
    remindersEnabled: value.remindersEnabled === true, reminderLeadMinutes: [...new Set(leads)].sort((a, b) => b - a) };
}

/**
 * Convert a datetime-local value using the chosen zone, never the host zone.
 * DST gaps and overlaps are rejected: the caller can request another local
 * time or accept an explicit offset through normalizePlanSchedule instead.
 */
export function localDateTimeToInstant(value, timeZone) {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) fail('Enter a complete local date and time.');
  const parts = [...match.slice(1, 6), match[6] || '0'].map(Number), naive = civilTime(parts);
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timeZoneName(timeZone), calendar: 'gregory', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const inZone = time => {
    const result = Object.fromEntries(formatter.formatToParts(time).map(part => [part.type, part.value]));
    return ['year', 'month', 'day', 'hour', 'minute', 'second'].map(key => Number(result[key]));
  };
  const offsets = new Set([-48, -24, -12, -6, 0, 6, 12, 24, 48].map(hours => {
    const sample = naive + hours * 3600_000;
    return civilTime(inZone(sample)) - sample;
  }));
  const candidates = [...offsets].map(offset => naive - offset).filter(time => inZone(time).every((value, index) => value === parts[index]));
  if (!candidates.length) fail('This local time does not exist because the clock changes. Choose another time.');
  if (candidates.length > 1) fail('This local time occurs twice because the clock changes. Choose another time or supply an explicit UTC offset.');
  return new Date(candidates[0]).toISOString();
}

function readableSchedule(plan) {
  try { return normalizePlanSchedule(plan?.schedule); } catch { return null; }
}

/** Completion is actual checked steps, not elapsed time, grades, or mastery. */
export function planProgress(plan, now = Date.now()) {
  const seen = new Set(), steps = (Array.isArray(plan?.steps) ? plan.steps : []).filter(step => {
    if (typeof step?.id !== 'string' || !step.id || seen.has(step.id)) return false;
    seen.add(step.id); return true;
  });
  const checked = new Set(Array.isArray(plan?.completedStepIds) ? plan.completedStepIds : []);
  const completedSteps = steps.filter(step => checked.has(step.id)).length;
  const complete = steps.length > 0 && completedSteps === steps.length;
  const schedule = readableSchedule(plan);
  const time = now instanceof Date ? now.getTime() : now;
  const timed = schedule && Number.isFinite(time);
  const start = timed ? Date.parse(schedule.startAt) : null, end = timed ? Date.parse(schedule.endAt) : null;
  const timeElapsedPercent = timed ? percentage(time - start, end - start) : null;
  const completionPercent = percentage(completedSteps, steps.length);
  // Each suggested step duration occupies part of the saved time window.
  // A partly elapsed step is only an advisory planned fraction, never checked.
  const weights = steps.map(step => Number.isFinite(step.minutes) && step.minutes > 0 ? step.minutes : 1);
  let budget = timed ? (timeElapsedPercent / 100) * weights.reduce((a, b) => a + b, 0) : 0, plannedSteps = 0;
  if (timed) for (const minutes of weights) { plannedSteps += Math.min(1, Math.max(0, budget / minutes)); budget -= minutes; }
  const plannedCompletionPercent = timed ? percentage(plannedSteps, steps.length) : null;
  return { totalSteps: steps.length, completedSteps, completionPercent, complete, timeElapsedPercent, plannedCompletionPercent,
    paceDifferencePercent: timed ? Math.round((completionPercent - plannedCompletionPercent) * 10) / 10 : null,
    scheduleStatus: !timed ? 'unscheduled' : complete ? 'complete' : time < start ? 'upcoming' : time < end ? 'in-progress' : 'overdue' };
}

/**
 * Return currently relevant reminder candidates only, never notifications.
 * The caller must additionally verify browser permission, active ownership,
 * and deduplicate stable IDs. No candidates exist without explicit plan opt-in.
 * Past lead windows expire when the next lead begins. A missed start expires
 * after five minutes; a zero-lead due notice lasts five minutes, then becomes
 * overdue. An overdue notice expires one day after the saved end time.
 */
export function planReminderCandidates(plan, { now = Date.now(), profileId = '' } = {}) {
  const schedule = readableSchedule(plan), time = now instanceof Date ? now.getTime() : now;
  if (!schedule?.remindersEnabled || !Number.isFinite(time) || !plan?.id || planProgress(plan, time).complete) return [];
  const start = Date.parse(schedule.startAt), end = Date.parse(schedule.endAt);
  const key = JSON.stringify([String(profileId), String(plan.id), schedule.startAt, schedule.endAt, schedule.timeZone, schedule.reminderLeadMinutes]);
  const candidate = (kind, triggerAt, expiresAt, leadMinutes = null) => ({ id: `${key}:${kind}:${leadMinutes ?? 'none'}`, planId: String(plan.id), kind,
    triggerAt: new Date(triggerAt).toISOString(), expiresAt: new Date(expiresAt).toISOString(), leadMinutes,
    title: typeof plan.title === 'string' ? plan.title : 'Study plan', timeZone: schedule.timeZone });
  const dueExpires = end + (schedule.reminderLeadMinutes.includes(0) ? 300_000 : 0);
  if (time >= dueExpires) return time < end + 86400_000 ? [candidate('overdue', dueExpires, end + 86400_000)] : [];
  const result = [];
  for (const [kind, anchor, expiry] of [['start', start, Math.min(end, start + 300_000)], ['due', end, dueExpires]]) {
    const leads = schedule.reminderLeadMinutes;
    for (let index = 0; index < leads.length; index++) {
      const trigger = anchor - leads[index] * 60_000;
      const expires = Math.min(expiry, index + 1 < leads.length ? anchor - leads[index + 1] * 60_000 : expiry);
      if (time >= trigger && time < expires) result.push(candidate(kind, trigger, expires, leads[index]));
    }
  }
  return result;
}
