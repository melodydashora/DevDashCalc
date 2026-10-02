import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudySelectionStore, studyCourseItems, mountStudentStudy } from '../public/student-study.js';

function storage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = data => ({ ok: true, json: async () => data });
const makePlan = (changes = {}) => ({
  id: 'plan-one', title: 'Review current work', goal: 'Explain the relationship',
  course: { id: '42', name: 'AP Physics', subject: 'physics' }, activity: 'guide',
  updatedAt: '2026-10-02T01:00:00Z', completedStepIds: [],
  steps: [
    { id: 'step-1', title: 'Read an example', detail: 'Explain the example in your own words.', minutes: 5 },
    { id: 'step-2', title: 'Apply the idea', detail: 'Try a second example, then compare the reasoning.', minutes: 10 },
  ], ...changes,
});

test('local selection stores only IDs and pause state under the correct learner key', () => {
  const local = storage(), store = createStudySelectionStore({ storage: local });
  assert.equal(store.write('student-a', { planId: 'plan-one', stepId: 'step-2', paused: true, title: 'Private text', token: 'secret' }), true);
  assert.deepEqual(store.read('student-a'), { version: 1, planId: 'plan-one', stepId: 'step-2', paused: true });
  assert.equal(store.read('student-b'), null);
  assert.doesNotMatch([...local.values.values()][0], /Private text|token|secret/);
  assert.equal(store.write('../student-a', { planId: 'plan-one', stepId: 'step-1' }), false);
  assert.equal(store.write('student-a', { planId: 'bad/plan', stepId: 'step-1' }), false);
  local.setItem('students4ai-study-selection-student-b', '{invalid');
  assert.equal(store.read('student-b'), null);
  const blocked = createStudySelectionStore({ storage: { getItem() { throw new Error(); }, setItem() { throw new Error(); } } });
  assert.equal(blocked.read('student-a'), null);
  assert.equal(blocked.write('student-a', { planId: 'plan-one', stepId: 'step-1' }), false);
});

test('instructor items remain course scoped, preserve unknown dates, and reject unsafe links', () => {
  const items = [
    { id: '3', courseId: '42', title: 'Unknown date', dueAt: null },
    { id: '1', courseId: '42', title: 'Later task', dueAt: '2026-10-04T10:00:00Z', htmlUrl: 'https://school.example/courses/42/assignments/1' },
    { id: '2', courseId: '42', name: 'Earlier task', dueAt: '2026-10-03T10:00:00Z', htmlUrl: 'javascript:bad()' },
    { id: '4', courseId: '42', title: 'Invalid date', dueAt: 'unknown' },
    { id: '5', courseId: '43', title: 'Other learner or course item', dueAt: '2026-10-01T10:00:00Z' },
    { id: '1', courseId: '42', title: 'Duplicate' },
  ];
  const rows = studyCourseItems(items, 42);
  assert.deepEqual(rows.map(row => row.id), ['2', '1', '4', '3']);
  assert.equal(rows[0].href, null);
  assert.equal(rows.find(row => row.id === '3').dueStatus, 'not-supplied');
  assert.equal(rows.find(row => row.id === '4').dueStatus, 'unavailable');
  assert.equal(items[0].dueAt, null);
  assert.deepEqual(studyCourseItems(items, 'sat'), []);
});

class Node {
  constructor(tag) { this.tagName = tag; this.children = []; this.value = ''; this.text = ''; this.events = {}; this.parentNode = null; this.attached = false; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_value) { throw new Error('Untrusted markup must not be used'); }
  get isConnected() { return Boolean(this.attached || this.parentNode?.isConnected); }
  append(...children) { for (const child of children) { this.children.push(child); child.parentNode = this; } }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { for (const child of this.children) child.parentNode = null; this.children = []; this.text = ''; this.append(...children); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, listener) { (this.events[name] ||= []).push(listener); }
  fire(name) { for (const listener of this.events[name] || []) listener({ preventDefault() {} }); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; this.attached = false; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  focus() { document.activeElement = this; }
}
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
function fixture(t, options = {}) {
  const old = globalThis.document;
  globalThis.document = { createElement: tag => new Node(tag), activeElement: null };
  t.after(() => { if (old === undefined) delete globalThis.document; else globalThis.document = old; });
  const root = new Node('section'); root.attached = true;
  const calls = [], selected = [];
  const instance = mountStudentStudy(root, { profileId: 'student-a', storage: storage(),
    request: async (path, request) => { calls.push({ path, request }); return response({ plans: [makePlan()] }); },
    onSelection: value => selected.push(value), ...options });
  t.after(() => instance.dispose());
  const find = label => descendants(root).find(node => node.text === label);
  const byClass = name => descendants(root).find(node => node.className === name);
  return { root, instance, calls, selected, find, byClass };
}

test('Study opens the selected saved step, shows instructor work and keeps text inert without auto-running it', async t => {
  const asked = [];
  const plan = makePlan({ completedStepIds: ['step-1'], title: '<script>Plan title</script>' });
  const f = fixture(t, { request: async () => response({ plans: [plan] }), onAskAstra: (...args) => asked.push(args),
    canvasItems: [{ id: '9', courseId: '42', title: '<img src=x> Assignment', dueAt: null }, { id: '8', courseId: '43', title: 'Other course' }] });
  await tick();
  assert.equal(f.instance.selection().stepId, 'step-2');
  assert.equal(f.instance.selection().courseId, '42');
  assert.match(f.root.textContent, /<script>Plan title<\/script>/);
  assert.match(f.root.textContent, /<img src=x> Assignment/);
  assert.doesNotMatch(f.root.textContent, /Other course/);
  assert.equal(descendants(f.root).some(node => ['script', 'img'].includes(node.tagName)), false);
  assert.deepEqual(asked, []);
  f.find('Study with Astra').fire('click');
  await tick();
  assert.equal(asked[0][0], plan.steps[1].detail);
  assert.equal(asked[0][1].planId, plan.id);
  assert.equal(asked[0][1].stepId, 'step-2');
});

test('practice and model actions carry the saved plan subject and activity instead of a global course', async t => {
  const calls = [];
  const f = fixture(t, { request: async () => response({ plans: [makePlan({ activity: 'test' }), makePlan({ id: 'model-plan', activity: 'model', course: { id: 'sat', name: 'SAT', subject: 'sat' } })] }),
    onPractice: payload => calls.push(payload), onModel: payload => calls.push(payload) });
  await tick();
  f.find('Choose test topics').fire('click'); await tick();
  assert.equal(calls[0].subject, 'physics');
  assert.equal(calls[0].activity, 'test');
  const select = descendants(f.root).find(node => node.name === 'study-plan');
  select.value = 'model-plan'; select.fire('change');
  f.find('Choose a learning model').fire('click'); await tick();
  assert.equal(calls[1].subject, 'sat');
  assert.equal(calls[1].activity, 'model');
  assert.equal(calls[1].planId, 'model-plan');
});

test('a course without a supported question bank offers Astra practice without claiming checked questions', async t => {
  const calls = [];
  const course = { id: '42', name: 'World history', subject: 'all' };
  const f = fixture(t, { request: async () => response({ plans: [makePlan({ activity: 'test', course }), makePlan({ id: 'practice-plan', activity: 'practice', course })] }),
    onPractice: payload => calls.push(payload) });
  await tick();
  assert.doesNotMatch(f.root.textContent, /checked questions|answer keys|Choose test topics/);
  assert.match(f.root.textContent, /These questions do not change school grades/);
  f.find('Start test with Astra').fire('click'); await tick();
  assert.equal(calls[0].subject, 'all');
  assert.equal(calls[0].courseId, '42');
  const select = descendants(f.root).find(node => node.name === 'study-plan');
  select.value = 'practice-plan'; select.fire('change');
  f.find('Practise with Astra').fire('click'); await tick();
  assert.equal(calls[1].activity, 'practice');
  assert.equal(calls[1].planId, 'practice-plan');
});

test('completion uses the canonical versioned API, waits for confirmation, and never advances the step', async t => {
  const gate = deferred(), calls = [];
  let plan = makePlan();
  const f = fixture(t, { request: async (path, options) => {
    calls.push({ path, options });
    if (options.method === 'GET') return response({ plans: [plan] });
    return gate.promise;
  } });
  await tick();
  f.find('Mark step complete').fire('click');
  await tick();
  assert.equal(calls[1].path, '/api/study-plans/plan-one?profile=student-a');
  assert.deepEqual(JSON.parse(calls[1].options.body), { completedStepIds: ['step-1'], expectedUpdatedAt: plan.updatedAt });
  assert.match(f.root.textContent, /0 of 2 complete/);
  assert.equal(f.find('Mark step complete').disabled, true);
  plan = { ...plan, completedStepIds: ['step-1'], updatedAt: '2026-10-02T01:00:01Z' };
  gate.resolve(response({ plan }));
  await tick();
  assert.match(f.root.textContent, /1 of 2 complete/);
  assert.ok(f.find('Mark not complete'));
  assert.equal(f.instance.selection().stepId, 'step-1');
  assert.match(f.root.textContent, /Choose the next step when you are ready/);
});

test('failed completion preserves the old state and reload reconciles a competing saved version', async t => {
  let plan = makePlan();
  const f = fixture(t, { request: async (_path, options) => {
    if (options.method === 'GET') return response({ plans: [plan] });
    plan = { ...plan, completedStepIds: ['step-2'], updatedAt: '2026-10-02T01:00:02Z' };
    return { ok: false, json: async () => ({ error: 'This plan changed on another screen.' }) };
  } });
  await tick();
  f.find('Mark step complete').fire('click'); await tick();
  assert.match(f.root.textContent, /completion change was not confirmed/);
  assert.match(f.root.textContent, /0 of 2 complete/);
  f.find('Reload saved plans').fire('click'); await tick();
  assert.match(f.root.textContent, /1 of 2 complete/);
  assert.equal(f.instance.selection().stepId, 'step-1');
});

test('pause and selected step survive remount for that learner without writing completion', async t => {
  const local = storage(), calls = [];
  const options = { storage: local, request: async (_path, request) => { calls.push(request.method); return response({ plans: [makePlan()] }); } };
  const f = fixture(t, options);
  await tick();
  f.find('2. Apply the idea').fire('click');
  f.find('Pause study').fire('click');
  assert.equal(f.instance.selection().paused, true);
  assert.equal(f.find('Mark step complete').disabled, true);
  f.instance.dispose();
  const restored = fixture(t, options); await tick();
  assert.equal(restored.instance.selection().stepId, 'step-2');
  assert.equal(restored.instance.selection().paused, true);
  restored.find('Resume study').fire('click');
  assert.equal(restored.instance.selection().paused, false);
  assert.deepEqual(calls, ['GET', 'GET']);
  const other = fixture(t, { ...options, profileId: 'student-b' }); await tick();
  assert.equal(other.instance.selection().stepId, 'step-1');
  assert.equal(other.instance.selection().paused, false);
});

test('an owned route selection replaces the remembered place only after its plan is validated', async t => {
  const local = storage(), store = createStudySelectionStore({ storage: local }), gate = deferred();
  store.write('student-a', { planId: 'plan-one', stepId: 'step-1', paused: true });
  const plans = [makePlan(), makePlan({ id: 'plan-two' })];
  const f = fixture(t, { storage: local, selectedPlanId: 'plan-two', selectedStepId: 'step-2', request: () => gate.promise });
  assert.equal(store.read('student-a').planId, 'plan-one');
  gate.resolve(response({ plans })); await tick();
  assert.deepEqual(store.read('student-a'), { version: 1, planId: 'plan-two', stepId: 'step-2', paused: false });
  f.instance.dispose();
  const restored = fixture(t, { storage: local, request: async () => response({ plans }) }); await tick();
  assert.equal(restored.instance.selection().planId, 'plan-two');
  assert.equal(restored.instance.selection().stepId, 'step-2');
});

test('Canvas refresh preserves workspace controls, active focus, and selected step', async t => {
  const f = fixture(t, { courses: [{ id: '42', name: 'Old course label' }] });
  await tick();
  const workspace = f.byClass('student-study-workspace');
  const detail = f.byClass('card student-study-current');
  const complete = f.find('Mark step complete');
  complete.focus();
  f.instance.updateSources({ courses: [{ id: '42', name: 'Current course label' }], canvasItems: [{ id: '10', courseId: '42', title: 'New instructor task', dueAt: null }] });
  assert.equal(f.byClass('student-study-workspace'), workspace);
  assert.equal(f.byClass('card student-study-current'), detail);
  assert.equal(f.find('Mark step complete'), complete);
  assert.equal(document.activeElement, complete);
  assert.equal(f.instance.selection().stepId, 'step-1');
  assert.match(f.root.textContent, /Current course label/);
  assert.match(f.root.textContent, /New instructor task/);
});

test('background instructor updates wait while its link has focus', async t => {
  const f = fixture(t, { canvasItems: [{ id: '10', courseId: '42', title: 'Original task' }] });
  await tick();
  const instructor = f.byClass('card student-study-instructor');
  f.find('Original task').focus();
  f.instance.updateSources({ canvasItems: [{ id: '11', courseId: '42', title: 'Updated task' }] });
  assert.match(instructor.textContent, /Original task/);
  assert.doesNotMatch(instructor.textContent, /Updated task/);
  document.activeElement = null;
  instructor.fire('focusout'); await tick();
  assert.match(instructor.textContent, /Updated task/);
});

test('loading failures are unavailable state, not an empty saved-plan claim', async t => {
  const f = fixture(t, { request: async () => { throw new Error('database unavailable'); } });
  await tick();
  assert.match(f.root.textContent, /saved plans are unavailable/);
  assert.doesNotMatch(f.root.textContent, /No saved plans yet|Make and save a course plan/);
  assert.equal(f.find('Reload saved plans').disabled, false);
});

test('late plan loads are aborted on disposal and cannot update a different workspace', async t => {
  const gate = deferred();
  let signal, current = true;
  const f = fixture(t, { isCurrent: () => current, request: (_path, options) => { signal = options.signal; return gate.promise; } });
  current = false;
  f.instance.dispose();
  assert.equal(signal.aborted, true);
  gate.resolve(response({ plans: [makePlan({ title: 'Previous learner private plan' })] }));
  await tick();
  assert.equal(f.root.children.length, 0);
  assert.deepEqual(f.selected, []);
});

test('a completion reply after leaving Study cannot render or announce the old learner state', async t => {
  const gate = deferred();
  let signal;
  const plan = makePlan();
  const f = fixture(t, { request: (_path, options) => {
    if (options.method === 'GET') return Promise.resolve(response({ plans: [plan] }));
    signal = options.signal;
    return gate.promise;
  } });
  await tick();
  f.find('Mark step complete').fire('click');
  await tick();
  const selectionCount = f.selected.length;
  f.instance.dispose();
  assert.equal(signal.aborted, true);
  gate.resolve(response({ plan: { ...plan, completedStepIds: ['step-1'], updatedAt: '2026-10-02T01:00:04Z' } }));
  await tick();
  assert.equal(f.root.children.length, 0);
  assert.equal(f.selected.length, selectionCount);
});

test('an unknown explicit plan does not silently open another saved plan', async t => {
  const local = storage(), store = createStudySelectionStore({ storage: local });
  store.write('student-a', { planId: 'plan-one', stepId: 'step-2', paused: true });
  const f = fixture(t, { storage: local, selectedPlanId: 'foreign-plan' });
  await tick();
  assert.equal(f.instance.selection(), null);
  assert.match(f.root.textContent, /not in this workspace/);
  assert.equal(f.find('Mark step complete'), undefined);
  assert.deepEqual(store.read('student-a'), { version: 1, planId: 'plan-one', stepId: 'step-2', paused: true });
});
