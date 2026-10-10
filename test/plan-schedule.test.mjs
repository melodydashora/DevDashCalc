import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlanSchedule, localDateTimeToInstant, planProgress, planReminderCandidates } from '../public/plan-schedule.js';

const schedule = (extra = {}) => ({ startAt: '2026-10-10T12:00:00-05:00', endAt: '2026-10-10T13:00:00-05:00', timeZone: 'America/Chicago', ...extra });
const plan = (extra = {}) => ({ id: 'a-plan', title: 'Explain diffusion', steps: [{ id: 'a', minutes: 10 }, { id: 'b', minutes: 20 }, { id: 'c', minutes: 30 }], completedStepIds: [], schedule: schedule(), ...extra });
const at = text => Date.parse(text);

test('schedules normalize explicit instants and retain zone without default reminder permission', () => {
  const normalized = normalizePlanSchedule(schedule());
  assert.equal(normalized.startAt, '2026-10-10T17:00:00.000Z');
  assert.equal(normalized.endAt, '2026-10-10T18:00:00.000Z');
  assert.equal(normalized.timeZone, 'America/Chicago');
  assert.equal(normalized.remindersEnabled, false);
  assert.deepEqual(normalizePlanSchedule(schedule({ reminderLeadMinutes: [15, 60, 15, 0] })).reminderLeadMinutes, [60, 15, 0]);
  assert.equal(normalizePlanSchedule(null), null);
});

test('invalid civil dates, bare dates, ambiguous offsets, wrong zones and reversed/zero intervals fail', () => {
  for (const startAt of ['2026-10-10', '2026-10-10T12:00', '2026-02-30T12:00:00Z', '2026-10-10T24:00Z', '2026-10-10T12:00+25:00', 'bad']) {
    assert.throws(() => normalizePlanSchedule(schedule({ startAt })), { status: 400 });
  }
  for (const extra of [{ timeZone: 'Mars/Central' }, { endAt: '2026-10-10T12:00:00-05:00' }, { endAt: '2026-10-10T11:00:00-05:00' },
    { remindersEnabled: 'yes' }, { reminderLeadMinutes: [-1] }, { reminderLeadMinutes: [10081] }, { reminderLeadMinutes: [1.5] }, { reminderLeadMinutes: [0, 1, 2, 3, 4, 5] }]) {
    assert.throws(() => normalizePlanSchedule(schedule(extra)), { status: 400 });
  }
});

test('local date conversion uses named zone and rejects DST gaps and repeated times', () => {
  assert.equal(localDateTimeToInstant('2026-10-10T12:00', 'America/Chicago'), '2026-10-10T17:00:00.000Z');
  assert.equal(localDateTimeToInstant('2026-01-10T12:00', 'America/Chicago'), '2026-01-10T18:00:00.000Z');
  assert.equal(localDateTimeToInstant('2026-10-10T00:00', 'Asia/Kolkata'), '2026-10-09T18:30:00.000Z');
  assert.equal(localDateTimeToInstant('2026-10-10T00:00:00', 'UTC'), '2026-10-10T00:00:00.000Z');
  assert.throws(() => localDateTimeToInstant('2026-03-08T02:30', 'America/Chicago'), /does not exist/);
  assert.throws(() => localDateTimeToInstant('2026-11-01T01:30', 'America/Chicago'), /occurs twice/);
  assert.throws(() => localDateTimeToInstant('2026-04-05T01:45', 'Australia/Lord_Howe'), /occurs twice/);
  assert.throws(() => localDateTimeToInstant('2026-10-04T02:15', 'Australia/Lord_Howe'), /does not exist/);
  assert.throws(() => localDateTimeToInstant('2026-02-30T00:00', 'UTC'), /valid calendar/);
  // The caller can resolve an overlap deliberately using an explicit offset.
  assert.equal(normalizePlanSchedule(schedule({ startAt: '2026-11-01T01:30:00-05:00', endAt: '2026-11-01T01:30:00-06:00' })).endAt, '2026-11-01T07:30:00.000Z');
});

test('actual checked completion stays separate from elapsed time and weighted planned pace', () => {
  const p = plan({ completedStepIds: ['a', 'a', 'foreign'] });
  const progress = planProgress(p, at('2026-10-10T17:30Z'));
  assert.equal(progress.completionPercent, 33.3);
  assert.equal(progress.timeElapsedPercent, 50);
  assert.equal(progress.plannedCompletionPercent, 66.7);
  assert.equal(progress.paceDifferencePercent, -33.4);
  assert.equal(progress.scheduleStatus, 'in-progress');
  assert.equal(planProgress(p, at('2026-10-10T10:00Z')).timeElapsedPercent, 0);
  const after = planProgress(p, at('2026-10-11T10:00Z'));
  assert.equal(after.timeElapsedPercent, 100); assert.equal(after.completionPercent, 33.3); assert.equal(after.complete, false); assert.equal(after.scheduleStatus, 'overdue');
  assert.deepEqual(p.completedStepIds, ['a', 'a', 'foreign'], 'reading progress never changes checks');
  const done = planProgress(plan({ completedStepIds: ['a', 'b', 'c'] }), at('2026-10-09T00:00Z'));
  assert.equal(done.completionPercent, 100); assert.equal(done.timeElapsedPercent, 0); assert.equal(done.scheduleStatus, 'complete');
});

test('old plans, missing steps, duplicate IDs and bad stored schedules remain readable without NaN', () => {
  for (const p of [null, {}, { steps: [] }, plan({ schedule: undefined }), plan({ schedule: schedule({ endAt: '2020-01-01T00:00Z' }) })]) {
    const result = planProgress(p, at('2026-10-10T17:30Z'));
    assert.equal(result.timeElapsedPercent, null); assert.equal(result.scheduleStatus, 'unscheduled'); assert.equal(result.complete, false);
    assert.ok(Number.isFinite(result.completionPercent));
  }
  assert.equal(planProgress(plan(), NaN).timeElapsedPercent, null);
  assert.equal(planProgress({ steps: [{ id: 'a' }, { id: 'a' }], completedStepIds: ['a'] }).completionPercent, 100);
});

test('reminders need explicit opt-in, use bounded lead windows, and suppress completed plans', () => {
  const time = at('2026-10-10T16:50Z');
  assert.deepEqual(planReminderCandidates(plan(), { now: time }), []);
  const p = plan({ schedule: schedule({ remindersEnabled: true, reminderLeadMinutes: [60, 15] }) });
  const candidates = planReminderCandidates(p, { now: time, profileId: 'one' });
  assert.deepEqual(candidates.map(r => [r.kind, r.leadMinutes]), [['start', 15]]);
  assert.equal(candidates[0].triggerAt, '2026-10-10T16:45:00.000Z');
  assert.deepEqual(candidates, planReminderCandidates(structuredClone(p), { now: time + 1000, profileId: 'one' }));
  assert.notEqual(candidates[0].id, planReminderCandidates(p, { now: time, profileId: 'two' })[0].id);
  assert.deepEqual(planReminderCandidates({ ...p, completedStepIds: ['a', 'b', 'c'] }, { now: time }), []);
  assert.deepEqual(planReminderCandidates(p, { now: at('2026-10-10T17:50Z') }).map(r => r.kind), ['due']);
  assert.deepEqual(planReminderCandidates(p, { now: at('2026-10-10T18:00Z') }).map(r => r.kind), ['overdue']);
  assert.deepEqual(planReminderCandidates(p, { now: at('2026-10-12T18:00Z') }), []);
  assert.deepEqual(planReminderCandidates(p, { now: NaN }), []);
});

test('a zero-lead reminder is due at the saved end before transitioning to overdue', () => {
  const p = plan({ schedule: schedule({ remindersEnabled: true, reminderLeadMinutes: [0] }) });
  assert.deepEqual(planReminderCandidates(p, { now: at('2026-10-10T17:00Z') }).map(r => r.kind), ['start']);
  assert.deepEqual(planReminderCandidates(p, { now: at('2026-10-10T17:59:59Z') }), []);
  assert.deepEqual(planReminderCandidates(p, { now: at('2026-10-10T18:00Z') }).map(r => [r.kind, r.leadMinutes]), [['due', 0]]);
  assert.deepEqual(planReminderCandidates(p, { now: at('2026-10-10T18:05Z') }).map(r => r.kind), ['overdue']);
});
