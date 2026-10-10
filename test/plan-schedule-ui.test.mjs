import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPlanSchedule, mountPlanReminders } from '../public/plan-schedule-ui.js';
import { timeContext } from '../public/time-context.js';

class Node {
  constructor(tagName) { this.tagName = tagName; this.children = []; this.text = ''; this.value = ''; this.events = {}; this.isConnected = true; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw new Error('Source text must stay inert.'); }
  appendChild(node) { this.children.push(node); node.parentNode = this; return node; }
  append(...nodes) { for (const node of nodes) this.appendChild(node); }
  replaceChildren(...nodes) { this.children = []; this.text = ''; this.append(...nodes); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, listener) { (this.events[name] ||= []).push(listener); }
  fire(name) { for (const listener of this.events[name] || []) listener({ preventDefault() {} }); }
  reportValidity() { return descendants(this).every(node => !node.required || Boolean(node.value)); }
}
const descendants = root => [root, ...root.children.flatMap(descendants)];
const named = (root, name) => descendants(root).find(node => node.name === name);
const button = (root, text) => descendants(root).find(node => node.tagName === 'button' && node.textContent === text);
const form = root => descendants(root).find(node => node.tagName === 'form');
const settled = () => new Promise(resolve => setImmediate(resolve));
const basePlan = () => ({ id: 'plan-one', title: 'Review <script>inert</script>', steps: [{ id: 'one', minutes: 30 }, { id: 'two', minutes: 30 }], completedStepIds: ['one'] });
const schedule = (extra = {}) => ({ startAt: '2026-10-10T17:00:00.000Z', endAt: '2026-10-10T18:00:00.000Z', timeZone: 'America/Chicago', remindersEnabled: false, reminderLeadMinutes: [15], ...extra });

function harness(t, now = '2026-10-10T17:30:00Z') {
  const saved = { document: globalThis.document, Notification: globalThis.Notification, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };
  const intervals = new Map(), listeners = new Set(), instances = [];
  let epoch = Date.parse(now), serial = 0;
  globalThis.document = { createElement: tag => new Node(tag), addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
  globalThis.setInterval = fn => { intervals.set(++serial, fn); return serial; };
  globalThis.clearInterval = id => intervals.delete(id);
  delete globalThis.Notification;
  const root = new Node('section'), clock = { read: () => timeContext(epoch, 'America/Chicago') };
  t.after(() => { for (const instance of instances) instance.dispose(); Object.assign(globalThis, saved); });
  return { root, clock, intervals, listeners, keep: instance => { instances.push(instance); return instance; },
    at: value => { epoch = Date.parse(value); for (const tick of [...intervals.values()]) tick(); } };
}

test('saved times and progress use the shared clock and explicit zone while completion stays based on checked steps', t => {
  const h = harness(t), plan = { ...basePlan(), schedule: schedule() };
  const instance = h.keep(mountPlanSchedule(h.root, { plan, clock: h.clock }));
  assert.equal(named(h.root, 'plan-start').value, '2026-10-10T12:00');
  assert.equal(named(h.root, 'plan-end').value, '2026-10-10T13:00');
  assert.match(h.root.textContent, /1 of 2 steps complete · 50%/);
  assert.match(h.root.textContent, /50% of scheduled time elapsed/);
  h.at('2026-10-10T18:00:00Z');
  assert.match(h.root.textContent, /1 of 2 steps complete · 50%/);
  assert.match(h.root.textContent, /100% of scheduled time elapsed/);
  instance.updatePlan({ ...plan, completedStepIds: ['one', 'two'] });
  assert.match(h.root.textContent, /2 of 2 steps complete · 100%/);
  assert.doesNotMatch(h.root.textContent, /Planned finish time has passed/);
});

test('an explicit save converts local inputs in the chosen timezone, persists opt-in, and remove sends null', async t => {
  const h = harness(t), plan = basePlan(), calls = [];
  h.keep(mountPlanSchedule(h.root, { plan, clock: h.clock, onUpdate: async value => { calls.push(value); return { ...plan, schedule: value }; } }));
  assert.equal(named(h.root, 'plan-time-zone').value, 'America/Chicago');
  assert.equal(named(h.root, 'plan-start').value, '');
  assert.equal(calls.length, 0);
  named(h.root, 'plan-start').value = '2026-10-11T09:00';
  named(h.root, 'plan-end').value = '2026-10-11T10:00';
  named(h.root, 'plan-reminders').checked = true;
  form(h.root).fire('submit'); await settled();
  assert.deepEqual(calls[0], { startAt: '2026-10-11T14:00:00.000Z', endAt: '2026-10-11T15:00:00.000Z', timeZone: 'America/Chicago', remindersEnabled: true, reminderLeadMinutes: [15] });
  assert.match(h.root.textContent, /Schedule saved/);
  button(h.root, 'Remove schedule').fire('click'); await settled();
  assert.equal(calls[1], null);
  assert.match(h.root.textContent, /No schedule saved/);
});

test('DST gaps and repeated local times explain the problem and do not write a guessed instant', async t => {
  const h = harness(t); let writes = 0;
  h.keep(mountPlanSchedule(h.root, { plan: basePlan(), clock: h.clock, onUpdate: async () => { writes++; } }));
  named(h.root, 'plan-start').value = '2026-03-08T02:30';
  named(h.root, 'plan-end').value = '2026-03-08T04:00';
  form(h.root).fire('submit'); await settled();
  assert.match(h.root.textContent, /does not exist because the clock changes/);
  named(h.root, 'plan-start').value = '2026-11-01T01:30';
  named(h.root, 'plan-end').value = '2026-11-01T03:00';
  form(h.root).fire('submit'); await settled();
  assert.match(h.root.textContent, /occurs twice because the clock changes/);
  assert.equal(writes, 0);
});

test('an existing offset-resolved DST overlap is preserved when only its reminders change', async t => {
  const h = harness(t), plan = { ...basePlan(), schedule: schedule({ startAt: '2026-11-01T07:30:00.000Z', endAt: '2026-11-01T08:30:00.000Z' }) };
  let saved;
  h.keep(mountPlanSchedule(h.root, { plan, clock: h.clock, onUpdate: async value => { saved = value; return { ...plan, schedule: value }; } }));
  assert.equal(named(h.root, 'plan-start').value, '2026-11-01T01:30');
  named(h.root, 'plan-reminders').checked = true;
  form(h.root).fire('submit'); await settled();
  assert.equal(saved.startAt, '2026-11-01T07:30:00.000Z');
  assert.equal(saved.remindersEnabled, true);
});

test('failed writes retain editing input and a disposed panel ignores late successful writes', async t => {
  const h = harness(t), plan = basePlan(); let resolve;
  const instance = h.keep(mountPlanSchedule(h.root, { plan, clock: h.clock, onUpdate: async () => { throw new Error('Newer plan exists. Reopen it before saving.'); } }));
  named(h.root, 'plan-start').value = '2026-10-11T09:00'; named(h.root, 'plan-end').value = '2026-10-11T10:00';
  form(h.root).fire('submit'); await settled();
  assert.match(h.root.textContent, /Newer plan exists/);
  assert.equal(named(h.root, 'plan-start').value, '2026-10-11T09:00');
  instance.dispose();
  const late = h.keep(mountPlanSchedule(h.root, { plan, clock: h.clock, onUpdate: () => new Promise(done => { resolve = done; }) }));
  named(h.root, 'plan-start').value = '2026-10-11T09:00'; named(h.root, 'plan-end').value = '2026-10-11T10:00';
  form(h.root).fire('submit');
  late.dispose(); const before = h.root.textContent;
  resolve({ ...plan, schedule: schedule() }); await settled();
  assert.equal(h.root.textContent, before);
  assert.equal(h.intervals.size, 0); assert.equal(h.listeners.size, 0);
});

test('global reminders are opt-in, profile scoped, inert, deduplicated, and require a button click for browser permission', async t => {
  const h = harness(t, '2026-10-10T16:46:00Z'), notifications = []; let requests = 0;
  class Notification {
    static permission = 'default';
    static async requestPermission() { requests++; this.permission = 'granted'; return 'granted'; }
    constructor(title, options) { this.title = title; this.options = options; notifications.push(this); }
    close() { this.closed = true; }
  }
  globalThis.Notification = Notification;
  let plans = [{ ...basePlan(), schedule: schedule() }];
  const monitor = h.keep(mountPlanReminders(h.root, { getPlans: () => plans, clock: h.clock, profileId: 'learner-a' }));
  assert.equal(h.root.hidden, true); assert.equal(requests, 0); assert.equal(notifications.length, 0);
  plans = [{ ...plans[0], schedule: schedule({ remindersEnabled: true }) }]; monitor.refresh();
  assert.equal(h.root.hidden, false);
  assert.match(h.root.textContent, /Review <script>inert<\/script>: Your planned study time starts soon/);
  assert.equal(descendants(h.root).some(node => node.tagName === 'script'), false);
  assert.equal(requests, 0);
  button(h.root, 'Enable browser notifications').fire('click'); await settled();
  assert.equal(requests, 1); assert.equal(notifications.length, 1);
  assert.match(notifications[0].options.tag, /learner-a/);
  monitor.refresh(); h.at('2026-10-10T16:47:00Z');
  assert.equal(notifications.length, 1);
  plans = [{ ...plans[0], completedStepIds: ['one', 'two'] }]; monitor.refresh();
  assert.match(h.root.textContent, /No study reminders are due/);
  monitor.dispose(); assert.equal(notifications[0].closed, true);
});

test('externally managed schedule panels never duplicate global reminders or request notification permission', async t => {
  const h = harness(t, '2026-10-10T16:46:00Z'); let requests = 0;
  globalThis.Notification = class { static permission = 'default'; static async requestPermission() { requests++; return 'granted'; } };
  h.keep(mountPlanSchedule(h.root, { plan: { ...basePlan(), schedule: schedule({ remindersEnabled: true }) }, clock: h.clock, remindersManagedExternally: true }));
  assert.match(h.root.textContent, /Remind me while the app is open/);
  assert.doesNotMatch(h.root.textContent, /starts soon/);
  const enable = button(h.root, 'Enable browser notifications'); assert.equal(enable.hidden, true);
  enable.fire('click'); await settled(); assert.equal(requests, 0);
});

test('browser denial retains in-app reminders and a late permission grant cannot notify after disposal', async t => {
  const h = harness(t, '2026-10-10T16:46:00Z'), plans = [{ ...basePlan(), schedule: schedule({ remindersEnabled: true }) }];
  let resolve, delivered = 0;
  class Notification {
    static permission = 'default';
    static requestPermission() { return new Promise(done => { resolve = done; }); }
    constructor() { delivered++; }
  }
  globalThis.Notification = Notification;
  const monitor = h.keep(mountPlanReminders(h.root, { getPlans: () => plans, clock: h.clock, profileId: 'one' }));
  button(h.root, 'Enable browser notifications').fire('click'); resolve('denied'); await settled();
  assert.match(h.root.textContent, /In-app reminders remain on/);
  assert.match(h.root.textContent, /starts soon/);
  button(h.root, 'Enable browser notifications').fire('click'); monitor.dispose();
  Notification.permission = 'granted'; resolve('granted'); await settled();
  assert.equal(delivered, 0);
});

test('a failed plan refresh exposes the error, stops stale delivery, closes existing notices, and recovers', async t => {
  const h = harness(t, '2026-10-10T16:46:00Z'), plan = { ...basePlan(), schedule: schedule({ remindersEnabled: true }) };
  const notifications = []; let failure = false;
  globalThis.Notification = class {
    static permission = 'granted';
    constructor() { notifications.push(this); }
    close() { this.closed = true; }
  };
  const monitor = h.keep(mountPlanReminders(h.root, { getPlans: () => {
    if (failure) throw new Error('Plan reminders could not be refreshed. Open Study plans to try again.');
    return [plan];
  }, clock: h.clock, profileId: 'one' }));
  button(h.root, 'Enable browser notifications').fire('click'); await settled();
  assert.equal(notifications.length, 1);
  failure = true; monitor.refresh();
  assert.equal(h.root.hidden, false);
  assert.match(h.root.textContent, /Plan reminders could not be refreshed/);
  assert.equal(button(h.root, 'Turn off browser notifications').disabled, true);
  assert.equal(notifications[0].closed, true);
  assert.doesNotMatch(h.root.textContent, /starts soon/);
  h.at('2026-10-10T17:46:00Z'); assert.equal(notifications.length, 1);
  failure = false; monitor.refresh();
  assert.equal(button(h.root, 'Turn off browser notifications').disabled, false);
  assert.doesNotMatch(h.root.textContent, /could not be refreshed/);
  assert.match(h.root.textContent, /ends soon/);
  assert.equal(notifications.length, 2);
});
