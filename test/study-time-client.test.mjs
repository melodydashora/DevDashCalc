import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyTimeTracker } from '../public/study-time.js';

function fixture(options = {}) {
  let wall = Date.parse('2026-10-02T23:40:00Z'), mono = 0;
  const tracker = createStudyTimeTracker({ now: () => wall, monotonicNow: () => mono, timeZone: 'America/New_York', ...options });
  const context = changes => tracker.setContext({ profileId: 'student-a', scopeKey: 'course:42', isStudy: true, paused: false, ...changes });
  return { tracker, context, advance(ms) { wall += ms; mono += ms; }, shiftWall(ms) { wall += ms; }, shiftMono(ms) { mono += ms; } };
}
const counters = tracker => {
  const { activeSeconds, continuousSeconds, topicSeconds, status } = tracker.snapshot().session;
  return { activeSeconds, continuousSeconds, topicSeconds, status };
};

test('foreground study accumulates an estimate without repeated snapshots double counting', () => {
  const f = fixture(); f.context(); f.advance(61_900);
  assert.deepEqual(counters(f.tracker), { activeSeconds: 61, continuousSeconds: 61, topicSeconds: 61, status: 'active' });
  assert.deepEqual(counters(f.tracker), { activeSeconds: 61, continuousSeconds: 61, topicSeconds: 61, status: 'active' });
  const snapshot = f.tracker.snapshot();
  assert.equal(snapshot.timeZone, 'America/New_York');
  assert.equal(snapshot.session.observedAt, '2026-10-02T23:41:01.900Z');
  assert.deepEqual(Object.keys(snapshot.session), ['activeSeconds', 'continuousSeconds', 'topicSeconds', 'status', 'observedAt']);
  assert.doesNotMatch(JSON.stringify(snapshot), /student-a|course:42/);
});

test('idle counting ends five minutes after interaction and resuming starts new continuous time', () => {
  const f = fixture(); f.context(); f.advance(120_000); f.tracker.activity();
  f.advance(600_000);
  assert.deepEqual(counters(f.tracker), { activeSeconds: 420, continuousSeconds: 0, topicSeconds: 420, status: 'idle' });
  f.advance(600_000); f.context();
  assert.equal(f.tracker.snapshot().session.activeSeconds, 420);
  assert.equal(f.tracker.snapshot().session.status, 'idle');
  f.tracker.activity(); f.advance(10_000);
  assert.deepEqual(counters(f.tracker), { activeSeconds: 430, continuousSeconds: 10, topicSeconds: 430, status: 'active' });
});

test('hidden time and hidden activity are excluded and returning starts a fresh continuous estimate', () => {
  const f = fixture(); f.context(); f.advance(30_000); f.tracker.visibility(false);
  f.advance(3_600_000); f.tracker.activity();
  assert.deepEqual(counters(f.tracker), { activeSeconds: 30, continuousSeconds: 0, topicSeconds: 30, status: 'paused' });
  f.tracker.visibility(true); f.advance(20_000);
  assert.deepEqual(counters(f.tracker), { activeSeconds: 50, continuousSeconds: 20, topicSeconds: 50, status: 'active' });
});

test('pause and non-study time are excluded without discarding cumulative totals', () => {
  const f = fixture(); f.context(); f.advance(50_000); f.context({ paused: true });
  f.advance(500_000); f.tracker.activity();
  assert.deepEqual(counters(f.tracker), { activeSeconds: 50, continuousSeconds: 0, topicSeconds: 50, status: 'paused' });
  f.context(); f.advance(20_000); f.context({ isStudy: false }); f.advance(500_000);
  assert.deepEqual(counters(f.tracker), { activeSeconds: 70, continuousSeconds: 0, topicSeconds: 70, status: 'paused' });
  f.context(); f.advance(5_000);
  assert.deepEqual(counters(f.tracker), { activeSeconds: 75, continuousSeconds: 5, topicSeconds: 75, status: 'active' });
});

test('changing topic resets topic time while preserving continuous and session totals', () => {
  const f = fixture(); f.context(); f.advance(120_000); f.context({ scopeKey: 'course:43' });
  assert.deepEqual(counters(f.tracker), { activeSeconds: 120, continuousSeconds: 120, topicSeconds: 0, status: 'active' });
  f.tracker.activity(); f.advance(40_000);
  assert.deepEqual(counters(f.tracker), { activeSeconds: 160, continuousSeconds: 160, topicSeconds: 40, status: 'active' });
});

test('learner changes and sign-out reset every counter, including when the tab is hidden', () => {
  const f = fixture(); f.context(); f.advance(90_000); f.tracker.visibility(false);
  f.context({ profileId: 'student-b' }); f.advance(60_000);
  assert.deepEqual(counters(f.tracker), { activeSeconds: 0, continuousSeconds: 0, topicSeconds: 0, status: 'paused' });
  f.tracker.visibility(true); f.advance(10_000);
  assert.equal(f.tracker.snapshot().session.activeSeconds, 10);
  f.context({ profileId: null }); f.advance(20_000); f.tracker.activity();
  assert.deepEqual(counters(f.tracker), { activeSeconds: 0, continuousSeconds: 0, topicSeconds: 0, status: 'paused' });
  f.context();
  assert.equal(f.tracker.snapshot().session.activeSeconds, 0);
});

test('monotonic elapsed time is independent of wall-clock rollback or forward correction', () => {
  const f = fixture(); f.context(); f.advance(20_000); f.shiftWall(-3_600_000);
  assert.equal(f.tracker.snapshot().session.activeSeconds, 20);
  assert.equal(f.tracker.snapshot().session.observedAt, '2026-10-02T22:40:20.000Z');
  f.advance(10_000); f.shiftWall(7_200_000);
  assert.deepEqual(counters(f.tracker), { activeSeconds: 30, continuousSeconds: 30, topicSeconds: 30, status: 'active' });
  // A broken or fallback elapsed clock can never subtract time or count it twice.
  f.shiftMono(-10_000); assert.equal(f.tracker.snapshot().session.activeSeconds, 30);
  f.shiftMono(15_000); assert.equal(f.tracker.snapshot().session.activeSeconds, 35);
});

test('counters are capped at one day and a missing time zone is not assumed to be UTC', () => {
  const f = fixture({ timeZone: 'Not/A_Zone' }); f.context();
  for (let i = 0; i < 1500; i++) { f.advance(60_000); f.tracker.activity(); }
  assert.deepEqual(counters(f.tracker), { activeSeconds: 86400, continuousSeconds: 86400, topicSeconds: 86400, status: 'active' });
  assert.equal(f.tracker.snapshot().timeZone, null);
  assert.equal(createStudyTimeTracker({ timeZone: 'UTC' }).snapshot().timeZone, 'UTC');
});

test('an injected wall clock alone supports deterministic elapsed time and dispose clears learner state', () => {
  let time = Date.parse('2026-10-02T23:40:00Z');
  const tracker = createStudyTimeTracker({ now: () => time, timeZone: null });
  tracker.setContext({ profileId: 'student-a', scopeKey: 'course:42', isStudy: true });
  time += 15_000;
  assert.equal(tracker.snapshot().session.activeSeconds, 15);
  tracker.dispose(); time += 60_000;
  tracker.activity(); tracker.visibility(true);
  tracker.setContext({ profileId: 'student-a', isStudy: true });
  assert.deepEqual(counters(tracker), { activeSeconds: 0, continuousSeconds: 0, topicSeconds: 0, status: 'paused' });
});
