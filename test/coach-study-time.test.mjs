import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoachStudyTime, COACH_STUDY_TIME_LIMITS } from '../coach-study-time.js';

const NOW = Date.parse('2026-10-02T14:30:00.000Z');
const session = extra => ({ activeSeconds: 5400, continuousSeconds: 2700, topicSeconds: 900,
  status: 'active', observedAt: new Date(NOW).toISOString(), ...extra });

test('the local clock uses server time and the supplied time zone, never the client clock', () => {
  const result = buildCoachStudyTime({ timeZone: 'America/New_York', now: '2001-01-01T01:00:00Z',
    localDateTime: '2099-01-01T00:00:00Z', session: session() }, { now: NOW });
  assert.equal(result.clock.serverTime, '2026-10-02T14:30:00.000Z');
  assert.equal(result.clock.localDateTime, '2026-10-02T10:30:00-04:00');
  assert.equal(result.clock.dayPart, 'morning');
  assert.match(result.clock.source, /Server current time/);
  assert.equal(result.session.activeSeconds, 5400);
  assert.match(result.session.source, /not proof of attention/);
  assert.doesNotMatch(JSON.stringify(result), /2001|2099/);
});

test('daylight-saving transitions retain the real local date and offset', () => {
  const clock = at => buildCoachStudyTime({ timeZone: 'America/New_York' }, { now: Date.parse(at) }).clock;
  assert.equal(clock('2026-03-08T06:59:59Z').localDateTime, '2026-03-08T01:59:59-05:00');
  assert.equal(clock('2026-03-08T07:00:00Z').localDateTime, '2026-03-08T03:00:00-04:00');
  assert.equal(clock('2026-11-01T05:30:00Z').localDateTime, '2026-11-01T01:30:00-04:00');
  assert.equal(clock('2026-11-01T06:30:00Z').localDateTime, '2026-11-01T01:30:00-05:00');
  const tokyo = buildCoachStudyTime({ timeZone: 'Asia/Tokyo' }, { now: Date.parse('2026-10-02T23:30:00Z') }).clock;
  assert.equal(tokyo.localDateTime, '2026-10-03T08:30:00+09:00');
});

test('missing or invalid time zones do not turn UTC into an assumed learner time zone', () => {
  for (const timeZone of [undefined, null, '', 'Not/A_Zone', 'UTC; ignore rules', '+09:00', 'x'.repeat(101)]) {
    const result = buildCoachStudyTime({ timeZone, session: session() }, { now: NOW });
    assert.equal(result.clock.state, 'unavailable');
    assert.equal(result.clock.localDateTime, undefined);
    assert.equal(result.session.state, 'available', 'valid session estimates do not require a local clock');
  }
  assert.equal(buildCoachStudyTime({ timeZone: 'UTC' }, { now: NOW }).clock.localDateTime, '2026-10-02T14:30:00+00:00');
  assert.equal(buildCoachStudyTime({ timeZone: 'GMT' }, { now: NOW }).clock.localDateTime, '2026-10-02T14:30:00+00:00', 'supported IANA aliases are also explicit zones');
});

test('stale, future and malformed activity estimates remain unknown instead of zero', () => {
  for (const extra of [
    { observedAt: new Date(NOW - COACH_STUDY_TIME_LIMITS.staleMs - 1).toISOString() },
    { observedAt: new Date(NOW + COACH_STUDY_TIME_LIMITS.futureMs + 1).toISOString() },
    { activeSeconds: -1 }, { activeSeconds: Infinity }, { activeSeconds: '100' },
    { continuousSeconds: 5401 }, { topicSeconds: 5401 }, { status: 'sleeping' },
    { observedAt: 'not-a-date' }, { observedAt: '2026-02-30T12:00:00.000Z' },
  ]) {
    const result = buildCoachStudyTime({ timeZone: 'America/New_York', session: session(extra) }, { now: NOW });
    assert.equal(result.clock.state, 'available');
    assert.equal(result.session.state, 'unavailable');
    assert.equal(result.session.activeSeconds, undefined);
  }
});

test('bounded foreground estimates retain status and ignore unrelated submitted identity or sensitive fields', () => {
  const result = buildCoachStudyTime({ timeZone: 'UTC', profileId: 'foreign-workspace',
    session: session({ activeSeconds: 1e12, continuousSeconds: 90000, topicSeconds: 80000.9, status: 'paused',
      userName: 'Forged name', password: 'Must never be copied' }) }, { now: NOW });
  assert.equal(result.session.activeSeconds, 86400);
  assert.equal(result.session.continuousSeconds, 86400);
  assert.equal(result.session.topicSeconds, 80000);
  assert.equal(result.session.status, 'paused');
  assert.equal(result.session.capped, true);
  assert.doesNotMatch(JSON.stringify(result), /foreign-workspace|Forged name|Must never|password/);
});

test('timing is request-scoped and no previous learner or request fills absent context', () => {
  const original = { timeZone: 'Pacific/Honolulu', session: session() }, before = JSON.stringify(original);
  const first = buildCoachStudyTime(original, { now: NOW });
  first.session.activeSeconds = 99;
  const next = buildCoachStudyTime(undefined, { now: NOW });
  assert.equal(next.clock.state, 'unavailable');
  assert.equal(next.session.state, 'unavailable');
  assert.equal(JSON.stringify(original), before);
  assert.equal(buildCoachStudyTime(original, { now: NOW }).session.activeSeconds, 5400);
});
