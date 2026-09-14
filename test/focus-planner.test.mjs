import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newPlannerState, sessionBudget, sessionElapsed, transitionSession,
  plannerStorageValue, restorePlannerState, sessionTargetReached, createPlannerSessionStore,
} from '../public/focus-planner.js';

test('session duration accepts bounded whole minutes and handles invalid persisted values', () => {
  assert.equal(sessionBudget(3), 5);
  assert.equal(sessionBudget(90), 60);
  assert.equal(sessionBudget('10'), 10);
  assert.equal(sessionBudget(29.8), 30);
  for (const value of ['', null, undefined, Infinity, NaN, {}, 'unknown']) assert.equal(sessionBudget(value), 20);
});

test('elapsed time uses wall-clock differences across hidden tabs and pause/resume cycles', () => {
  let state = transitionSession(newPlannerState(), 'start', 1000);
  assert.equal(sessionElapsed(state, 61000), 60000, 'no tick counting dependency');
  state = transitionSession(state, 'pause', 61000);
  assert.equal(sessionElapsed(state, 121000), 60000, 'time while paused is excluded');
  state = transitionSession(state, 'resume', 121000);
  assert.equal(sessionElapsed(state, 151000), 90000);
  state = transitionSession(state, 'pause', 151000);
  assert.equal(state.elapsedMs, 90000);
  assert.equal(state.startedAt, null);
});

test('restoring an interrupted running session accounts for elapsed time once and requires resume', () => {
  const running = transitionSession(newPlannerState('school'), 'start', 1000);
  const restored = restorePlannerState(JSON.parse(JSON.stringify(plannerStorageValue(running))), 121000);
  assert.equal(restored.status, 'paused');
  assert.equal(restored.elapsedMs, 120000);
  assert.equal(sessionElapsed(restored, 181000), 120000);
  assert.equal(restorePlannerState(restored, 181000).elapsedMs, 120000);
});

test('a planned target is advisory, does not finish the session, and finish freezes elapsed time', () => {
  let state = { ...newPlannerState(), budgetMinutes: 10 };
  state = transitionSession(state, 'start', 0);
  assert.equal(sessionTargetReached(state, 599999), false);
  assert.equal(sessionTargetReached(state, 600000), true);
  assert.equal(state.status, 'running');
  assert.equal(sessionElapsed(state, 900000), 900000, 'working beyond the target is allowed');
  state = transitionSession(state, 'finish', 900000);
  assert.equal(state.status, 'finished');
  assert.equal(sessionElapsed(state, 1000000), 900000);
  assert.deepEqual(state.checklist, [false, false, false], 'finish never invents task completion');
});

test('starting another session resets only session time/checklist and retains its plan', () => {
  const finished = { ...newPlannerState('own'), status: 'finished', budgetMinutes: 30, elapsedMs: 900000, checklist: [true, true, true] };
  const next = transitionSession(finished, 'start', 2000000);
  assert.equal(next.budgetMinutes, 30);
  assert.equal(next.goalType, 'own');
  assert.equal(next.elapsedMs, 0);
  assert.equal(next.startedAt, 2000000);
  assert.deepEqual(next.checklist, [false, false, false]);
  assert.equal(finished.elapsedMs, 900000, 'the transition is pure');
});

test('storage is allowlisted and contains no school assignment or free-text goal data', () => {
  const value = plannerStorageValue({
    ...newPlannerState('school'), budgetMinutes: 25,
    canvasTask: { name: 'Private assignment', href: 'https://school.example/task' },
    name: 'Private assignment', href: 'https://school.example/task', ownGoal: 'Private goal', subject: 'physics',
    checklist: [true, false, true, true],
  });
  assert.deepEqual(Object.keys(value).sort(), ['budgetMinutes', 'checklist', 'elapsedMs', 'goalType', 'startedAt', 'status']);
  assert.deepEqual(value.checklist, [true, false, true]);
  assert.doesNotMatch(JSON.stringify(value), /Private|school\.example|physics/);
});

test('invalid running timestamps and clock reversal cannot produce negative elapsed time', () => {
  const restored = restorePlannerState({ status: 'running', startedAt: 'bad', elapsedMs: -1, goalType: 'unknown' }, 1000);
  assert.equal(restored.status, 'paused');
  assert.equal(restored.elapsedMs, 0);
  assert.equal(restored.goalType, 'practice');
  const state = transitionSession(newPlannerState(), 'start', 5000);
  assert.equal(sessionElapsed(state, 4000), 0);
  assert.equal(transitionSession(state, 'resume', 6000), state, 'duplicate starts do not reset a running timer');
});

function sessionHarness() {
  let time = 1000;
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const sessions = createPlannerSessionStore({ storage, now: () => time });
  return { sessions, values, storage, now: () => time, advance: (milliseconds) => { time += milliseconds; } };
}

test('an active learner session continues through practice and repeated route mounts without ticks', () => {
  const { sessions, now, advance } = sessionHarness();
  sessions.activate('bc-learner');
  let state = sessions.read('bc-learner', 'practice');
  state = sessions.write('bc-learner', transitionSession(state, 'start', now()));
  advance(60000); // The planner DOM and its interval are absent on Practice.
  sessions.activate('bc-learner');
  state = sessions.read('bc-learner');
  assert.equal(state.status, 'running');
  assert.equal(sessionElapsed(state, now()), 60000);
  advance(60000);
  state = sessions.read('bc-learner');
  assert.equal(sessionElapsed(state, now()), 120000, 'remounts do not restart or double-count');
  sessions.write('bc-learner', transitionSession(state, 'pause', now()));
  advance(60000);
  assert.equal(sessionElapsed(sessions.read('bc-learner'), now()), 120000);
});

test('switching learners pauses the previous session and keeps plans/checklists independent', () => {
  const { sessions, now, advance, values } = sessionHarness();
  sessions.activate('bc-learner');
  const bc = { ...sessions.read('bc-learner'), budgetMinutes: 30, checklist: [true, false, false] };
  sessions.write('bc-learner', transitionSession(bc, 'start', now()));
  advance(45000);
  sessions.activate('esha');
  assert.equal(sessions.status('bc-learner'), 'paused');
  const esha = sessions.read('esha', 'school');
  assert.equal(esha.status, 'idle');
  assert.equal(esha.goalType, 'school');
  assert.deepEqual(esha.checklist, [false, false, false]);
  sessions.write('esha', transitionSession(esha, 'start', now()));
  advance(15000);
  sessions.activate('bc-learner');
  assert.equal(sessions.read('bc-learner').elapsedMs, 45000);
  assert.equal(sessions.read('bc-learner').budgetMinutes, 30);
  assert.deepEqual(sessions.read('bc-learner').checklist, [true, false, false]);
  assert.equal(sessions.read('esha').elapsedMs, 15000);
  assert.equal(sessions.status('bc-learner'), 'paused', 'switching back never starts a clock');
  assert.equal(JSON.parse(values.get('students4ai-focus-bc-learner')).status, 'paused');
});

test('closing from another route pauses once and a fresh page waits for explicit resume', () => {
  const { sessions, storage, now, advance } = sessionHarness();
  sessions.activate('learner');
  sessions.write('learner', transitionSession(sessions.read('learner'), 'start', now()));
  advance(70000);
  sessions.pauseAll(); // The app-level pagehide listener also runs off the planner route.
  advance(5000);
  sessions.pauseAll();
  advance(3600000);
  const nextPage = createPlannerSessionStore({ storage, now });
  nextPage.activate('learner');
  const restored = nextPage.read('learner');
  assert.equal(restored.status, 'paused');
  assert.equal(restored.elapsedMs, 70000, 'time after pagehide is excluded');
});

test('status subscriptions support a quiet indicator and detach without stopping the session', () => {
  const { sessions, now, advance } = sessionHarness();
  const seen = [];
  sessions.activate('learner');
  const unsubscribe = sessions.subscribe((event) => seen.push(event));
  sessions.write('learner', transitionSession(sessions.read('learner'), 'start', now()));
  unsubscribe();
  advance(60000);
  const state = sessions.read('learner');
  assert.equal(state.status, 'running');
  sessions.write('learner', transitionSession(state, 'finish', now()));
  assert.deepEqual(seen, [{ profileId: 'learner', status: 'running' }]);
  assert.equal(sessions.status('learner'), 'finished');
  assert.equal(sessions.read('learner').elapsedMs, 60000);
});

test('unavailable storage and stale learner events cannot restart an inactive timer', () => {
  let time = 1000;
  const storage = { getItem() { throw Error('unavailable'); }, setItem() { throw Error('unavailable'); } };
  const sessions = createPlannerSessionStore({ storage, now: () => time });
  sessions.activate('first');
  sessions.write('first', transitionSession(sessions.read('first'), 'start', time));
  time = 10000;
  sessions.activate('second');
  const stale = transitionSession(sessions.read('first'), 'resume', time);
  sessions.write('first', stale);
  assert.equal(sessions.status('first'), 'paused');
  assert.equal(sessions.read('first').elapsedMs, 9000);
  assert.equal(sessions.read('second').status, 'idle');
});
