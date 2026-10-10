import test from 'node:test';
import assert from 'node:assert/strict';
import { timeContext, validTimeZone, createAppClock } from '../public/time-context.js';

test('clock exposes one instant in the selected timezone across day and DST boundaries', () => {
  const context = timeContext(Date.parse('2026-10-11T02:30:00Z'), 'America/Chicago');
  assert.equal(context.localDate, '2026-10-10');
  assert.match(context.localTime, /9:30:00 PM/);
  assert.equal(validTimeZone('not/a/zone'), null);
  assert.equal(timeContext(0, 'not/a/zone').timeZone, 'UTC');
  assert.notEqual(timeContext(Date.parse('2026-11-01T06:30:00Z'), 'America/Chicago').localTime,
    timeContext(Date.parse('2026-11-01T07:30:00Z'), 'America/Chicago').localTime);
});

test('server clock resists device wall-clock jumps and rejects delayed or malformed samples', () => {
  let mono = 100, wall = 5000;
  const clock = createAppClock({ wallNow: () => wall, monotonicNow: () => mono, timeZone: 'UTC' });
  assert.equal(clock.read().source, 'device');
  mono = 300;
  assert.equal(clock.synchronize(100_000, 100), true);
  assert.equal(clock.now(), 100_100);
  wall += 1_000_000; mono += 1000;
  assert.equal(clock.now(), 101_100);
  assert.equal(clock.synchronize('bad', 100), false);
  assert.equal(clock.synchronize(0, mono - 40_000), false);
  assert.equal(clock.synchronize(0, mono + 1), false);
  assert.equal(clock.read().source, 'server');
});
