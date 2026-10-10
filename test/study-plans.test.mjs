import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyPlanClient, studyPlanCourseOptions, mountHomeStudyPlans, mountStudyPlans } from '../public/study-plans.js';
import { timeContext } from '../public/time-context.js';

const response = data => ({ ok: true, json: async () => data });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('plans offer every verified Canvas class, study subjects including SAT, and a named custom class', () => {
  const choices = studyPlanCourseOptions([{ id: '2', name: 'English' }, { id: '1', name: 'Biology' }, { id: '2', name: 'Duplicate' }, { id: 'bad', name: 'Bad ID' }], [{ id: 'sat', label: 'SAT' }, { id: 'all', label: 'All courses' }]);
  assert.deepEqual(choices.map(c => c.id), ['1', '2', 'sat', 'all', 'custom']);
  assert.deepEqual(choices.find(c => c.id === 'sat'), { id: 'sat', name: 'SAT', subject: 'sat', kind: 'subject' });
  assert.equal(choices.find(c => c.id === '2').subject, 'all');
});

test('API operations remain owner-scoped and completion includes the expected version', async () => {
  const calls = [];
  const client = createStudyPlanClient({ profileId: 'student-one', request: async (path, options) => { calls.push({ path, options }); return response({ plans: [], plan: { id: 'plan-one' } }); } });
  await client.list();
  const draft = { course: { id: 'sat', name: 'SAT', subject: 'sat' }, goal: 'Review algebra', minutes: 20 };
  await client.draft(draft);
  await client.save({ id: 'plan-one', draftId: 'draft-token', source: 'astra' }, 'request-one');
  await client.complete({ id: 'plan-one', updatedAt: '2026-09-17T00:00:00Z' }, ['step-one']);
  assert.deepEqual(calls.map(c => c.path), ['/api/study-plans?profile=student-one', '/api/study-plans/draft?profile=student-one', '/api/study-plans?profile=student-one', '/api/study-plans/plan-one?profile=student-one']);
  assert.deepEqual(calls.map(c => c.options.method), ['GET', 'POST', 'POST', 'PATCH']);
  assert.deepEqual(JSON.parse(calls[2].options.body), { plan: { id: 'plan-one', draftId: 'draft-token', source: 'astra' }, requestId: 'request-one' });
  assert.deepEqual(JSON.parse(calls[3].options.body), { completedStepIds: ['step-one'], expectedUpdatedAt: '2026-09-17T00:00:00Z' });
  client.dispose();
});

test('schedule patches stay owner-scoped, carry the saved revision, and can explicitly clear the schedule', async () => {
  const calls = [], client = createStudyPlanClient({ profileId: 'student-two', request: async (path, options) => {
    calls.push({ path, options }); return response({ plan: { id: 'plan-two', updatedAt: 'new-version' } });
  } });
  try {
    const schedule = { startAt: '2026-10-11T14:00:00Z', endAt: '2026-10-11T15:00:00Z', timeZone: 'America/Chicago', remindersEnabled: true, reminderLeadMinutes: [15] };
    await client.schedule({ id: 'plan-two', updatedAt: 'old-version' }, schedule);
    await client.schedule({ id: 'plan-two', updatedAt: 'new-version' }, null);
    assert.deepEqual(calls.map(call => call.path), ['/api/study-plans/plan-two?profile=student-two', '/api/study-plans/plan-two?profile=student-two']);
    assert.ok(calls.every(call => call.options.method === 'PATCH' && call.options.cache === 'no-store'));
    assert.deepEqual(JSON.parse(calls[0].options.body), { schedule, expectedUpdatedAt: 'old-version' });
    assert.deepEqual(JSON.parse(calls[1].options.body), { schedule: null, expectedUpdatedAt: 'new-version' });
  } finally { client.dispose(); }
});

test('late replies cannot return another learner workspace data after switching', async () => {
  const gate = deferred(); let current = true;
  const client = createStudyPlanClient({ profileId: 'first', isCurrent: () => current, request: () => gate.promise });
  const pending = client.list(); current = false;
  gate.resolve(response({ plans: [{ title: 'Previous learner private plan' }] }));
  await assert.rejects(pending, { name: 'AbortError' });
});

test('disposing aborts active requests and prevents further requests', async () => {
  let signal; const gate = deferred();
  const client = createStudyPlanClient({ profileId: 'first', request: (path, options) => { signal = options.signal; return gate.promise; } });
  const pending = client.list(); client.dispose();
  assert.equal(signal.aborted, true);
  gate.resolve(response({ plans: [] }));
  await assert.rejects(pending, { name: 'AbortError' });
  await assert.rejects(client.save({}, 'ignored'), { name: 'AbortError' });
});

class Node {
  constructor(tag) { this.tagName = tag; this.children = []; this.isConnected = true; this.value = ''; this.text = ''; this.events = {}; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
  set innerHTML(value) { throw new Error('Untrusted markup must not be used'); }
  appendChild(node) { this.children.push(node); node.parentNode = this; return node; }
  append(...nodes) { for (const node of nodes) this.appendChild(node); }
  replaceChildren(...nodes) { this.children = []; this.text = ''; this.append(...nodes); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, listener) { (this.events[name] ||= []).push(listener); }
  fire(name) { for (const listener of this.events[name] || []) listener({ preventDefault() {} }); }
  querySelectorAll(selector) { const tags = selector.split(',').map(s => s.trim()); return descendants(this).filter(n => n !== this && tags.includes(n.tagName)); }
  remove() { this.parentNode.children = this.parentNode.children.filter(n => n !== this); this.isConnected = false; }
  focus() {}
  reportValidity() { return this.querySelectorAll('input, textarea, select').every(n => !n.required || Boolean(n.value)); }
}
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
function named(root, label) { return descendants(root).find(node => node.text === label); }
const settled = () => new Promise(resolve => setImmediate(resolve));

test('saving a schedule then checking a step uses the canonical schedule revision and preserves its dates', async () => {
  const priorDocument = globalThis.document, priorDispatch = globalThis.dispatchEvent;
  globalThis.document = { createElement: tag => new Node(tag) };
  let events = 0, instance;
  globalThis.dispatchEvent = event => { if (event.type === 'students4ai-plans-changed') events++; };
  try {
    let stored = { id: 'scheduled-one', title: 'Review formulas', goal: 'Explain formulas', course: { id: 'sat', name: 'SAT', subject: 'sat' },
      topics: ['Equations'], steps: [{ id: 'one', title: 'Review equations', detail: 'Explain two examples.', minutes: 20 }], completedStepIds: [], source: 'student', updatedAt: 'revision-1' };
    const calls = [];
    const request = async (path, options) => {
      if (options.method === 'GET') return response({ plans: [stored] });
      const body = JSON.parse(options.body); calls.push(body);
      assert.equal(path, '/api/study-plans/scheduled-one?profile=learner');
      assert.equal(body.expectedUpdatedAt, stored.updatedAt);
      stored = { ...stored, ...('schedule' in body ? { schedule: body.schedule } : { completedStepIds: body.completedStepIds }), updatedAt: 'revision-' + (calls.length + 1) };
      return response({ plan: stored });
    };
    const root = new Node('section'), now = Date.parse('2026-10-10T17:00:00Z');
    instance = mountStudyPlans(root, { profileId: 'learner', selectedPlanId: 'scheduled-one', subjects: [{ id: 'sat', label: 'SAT' }], request,
      clock: { now: () => now, read: () => timeContext(now, 'America/Chicago') } });
    await settled();
    const input = name => descendants(root).find(node => node.name === name);
    input('plan-start').value = '2026-10-11T09:00'; input('plan-end').value = '2026-10-11T10:00'; input('plan-reminders').checked = true;
    descendants(root).find(node => node.tagName === 'form' && descendants(node).some(child => child.name === 'plan-start')).fire('submit');
    await settled();
    assert.equal(calls[0].expectedUpdatedAt, 'revision-1');
    assert.equal(stored.schedule.startAt, '2026-10-11T14:00:00.000Z');
    assert.equal(stored.schedule.endAt, '2026-10-11T15:00:00.000Z');
    assert.equal(stored.schedule.remindersEnabled, true);
    assert.match(root.textContent, /Schedule saved/);
    const check = descendants(root).find(node => node.type === 'checkbox' && !node.name);
    check.checked = true; check.fire('change'); await settled();
    assert.equal(calls[1].expectedUpdatedAt, 'revision-2');
    assert.deepEqual(stored.completedStepIds, ['one']);
    assert.equal(stored.schedule.startAt, '2026-10-11T14:00:00.000Z');
    assert.match(root.textContent, /1 of 1 steps complete · 100%/);
    assert.equal(events, 2);
  } finally { instance?.dispose(); globalThis.document = priorDocument; globalThis.dispatchEvent = priorDispatch; }
});

test('closing the learner plan during a schedule save aborts it and suppresses late rendering and reminder events', async () => {
  const priorDocument = globalThis.document, priorDispatch = globalThis.dispatchEvent;
  globalThis.document = { createElement: tag => new Node(tag) };
  let instance, events = 0, signal; globalThis.dispatchEvent = () => { events++; };
  const gate = deferred();
  try {
    const plan = { id: 'old-learner-plan', title: 'Old learner plan', goal: 'Review', course: { id: 'sat', name: 'SAT', subject: 'sat' }, topics: ['Equations'],
      steps: [{ id: 'one', title: 'Review', detail: 'Explain an equation.', minutes: 10 }], completedStepIds: [], source: 'student', updatedAt: 'revision-1' };
    const root = new Node('section');
    instance = mountStudyPlans(root, { profileId: 'old-learner', selectedPlanId: plan.id, subjects: [{ id: 'sat', label: 'SAT' }], request: async (_, options) => {
      if (options.method === 'GET') return response({ plans: [plan] });
      signal = options.signal; return gate.promise;
    } });
    await settled();
    descendants(root).find(node => node.name === 'plan-start').value = '2026-10-11T09:00';
    descendants(root).find(node => node.name === 'plan-end').value = '2026-10-11T10:00';
    descendants(root).find(node => node.tagName === 'form' && descendants(node).some(child => child.name === 'plan-start')).fire('submit');
    instance.dispose(); assert.equal(signal.aborted, true);
    root.textContent = 'New learner workspace';
    gate.resolve(response({ plan: { ...plan, updatedAt: 'revision-2', schedule: { startAt: '2026-10-11T14:00:00Z', endAt: '2026-10-11T15:00:00Z', timeZone: 'America/Chicago' } } }));
    await settled();
    assert.equal(root.textContent, 'New learner workspace');
    assert.equal(events, 0);
  } finally { instance?.dispose(); globalThis.document = priorDocument; globalThis.dispatchEvent = priorDispatch; }
});

test('Home renders saved topic text inertly and provides plan links without inserting a topic catalogue', async () => {
  const prior = globalThis.document;
  globalThis.document = { createElement: tag => new Node(tag) };
  try {
    const root = new Node('section');
    const dispose = mountHomeStudyPlans(root, { profileId: 'one', request: async () => response({ plans: [{ id: 'plan-one', title: '<img src=x>', course: { id: '42', name: 'English' }, topics: ['<script>source text</script>'], source: 'astra' }] }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.match(root.textContent, /<img src=x>/);
    assert.match(root.textContent, /<script>source text<\/script>/);
    const nodes = [root]; for (let i = 0; i < nodes.length; i++) nodes.push(...nodes[i].children);
    assert.ok(nodes.some(node => node.href === '#/plans/plan-one'));
    assert.equal(nodes.some(node => node.tagName === 'script' || node.tagName === 'img'), false);
    assert.doesNotMatch(root.textContent, /AP Calculus|Physics|Vector Lab/);
    dispose();
  } finally { globalThis.document = prior; }
});

test('a class deep link waits for Canvas loading without overriding a deliberate course change', async () => {
  const prior = globalThis.document;
  globalThis.document = { createElement: tag => new Node(tag) };
  try {
    const root = new Node('section');
    const instance = mountStudyPlans(root, { profileId: 'one', selectedCourseId: '42', subjects: [{ id: 'sat', label: 'SAT' }], request: async () => response({ plans: [] }) });
    const select = descendants(root).find(n => n.tagName === 'select');
    assert.equal(select.value, 'sat');
    instance.updateCourses([{ id: '42', name: 'Biology' }]);
    assert.equal(select.value, '42');
    select.value = 'custom'; select.fire('change');
    instance.updateCourses([{ id: '42', name: 'Biology' }, { id: '43', name: 'English' }]);
    assert.equal(select.value, 'custom');
    instance.dispose();
  } finally { globalThis.document = prior; }
});

test('drafting never saves automatically, explicit save preserves draft identity, and reopening checks off a durable step', async () => {
  const prior = globalThis.document;
  globalThis.document = { createElement: tag => new Node(tag) };
  try {
    let stored = null, opened = null;
    const calls = [];
    const generated = { draftId: 'trusted-draft', title: 'Review transformations', goal: 'Explain transformations', course: { id: 'sat', name: 'SAT', subject: 'sat' }, topics: ['Linear functions'], steps: [{ id: 'step-one', title: 'Compare two graphs', detail: '<script>inert</script>', minutes: 15 }], completedStepIds: [], source: 'astra' };
    const request = async (path, options) => {
      calls.push({ path, options });
      if (options.method === 'GET') return response({ plans: stored ? [stored] : [] });
      const body = JSON.parse(options.body);
      if (path.includes('/draft?')) return response({ plan: generated, available: true });
      if (options.method === 'PATCH') {
        assert.equal(body.expectedUpdatedAt, 'version-one');
        stored = { ...stored, completedStepIds: body.completedStepIds, updatedAt: 'version-two' };
      } else stored = { ...body.plan, id: 'saved-one', updatedAt: 'version-one' };
      return response({ plan: stored });
    };
    const root = new Node('section');
    const options = { profileId: 'one', subjects: [{ id: 'sat', label: 'SAT' }], request };
    let instance = mountStudyPlans(root, { ...options, onOpenPlan: id => { opened = id; } });
    await settled();
    const form = descendants(root).find(n => n.tagName === 'form');
    const goal = descendants(root).find(n => n.name === 'goal');
    goal.value = 'Explain transformations';
    form.fire('submit'); await settled();
    assert.equal(calls.filter(c => c.options.method === 'POST').length, 1);
    assert.equal(stored, null);
    assert.match(root.textContent, /Review your draft/);
    named(root, 'Save this plan').fire('click'); await settled();
    assert.equal(stored.draftId, 'trusted-draft');
    assert.equal(opened, 'saved-one');
    assert.equal(stored.steps[0].detail, '<script>inert</script>');
    instance.dispose();
    instance = mountStudyPlans(root, { ...options, selectedPlanId: 'saved-one' });
    await settled();
    const check = descendants(root).find(n => n.type === 'checkbox');
    assert.equal(check.checked, false);
    check.checked = true; check.fire('change'); await settled();
    assert.deepEqual(stored.completedStepIds, ['step-one']);
    assert.equal(descendants(root).find(n => n.type === 'checkbox').checked, true);
    assert.equal(descendants(root).some(n => n.tagName === 'script'), false);
    instance.dispose();
  } finally { globalThis.document = prior; }
});

test('writing an own plan requires a goal before opening the editor', async () => {
  const prior = globalThis.document;
  globalThis.document = { createElement: tag => new Node(tag) };
  try {
    const root = new Node('section');
    const instance = mountStudyPlans(root, { profileId: 'one', subjects: [{ id: 'sat', label: 'SAT' }], request: async () => response({ plans: [] }) });
    named(root, 'Write my own plan').fire('click');
    assert.match(root.textContent, /Enter a goal/);
    assert.doesNotMatch(root.textContent, /Review your draft/);
    instance.dispose();
  } finally { globalThis.document = prior; }
});

test('optional SAT goals and chosen pacing become learner goal text only for SAT plans', async () => {
  const prior = globalThis.document;
  globalThis.document = { createElement: tag => new Node(tag) };
  try {
    const calls = [];
    const root = new Node('section');
    const instance = mountStudyPlans(root, {
      profileId: 'one', subject: 'sat', courses: [{ id: '42', name: 'Biology' }], subjects: [{ id: 'sat', label: 'SAT' }],
      request: async (path, options) => {
        if (options.method === 'GET') return response({ plans: [] });
        const body = JSON.parse(options.body); calls.push(body);
        return response({ plan: { ...body, title: 'A draft', topics: ['Evidence'], steps: [{ id: 'step-one', title: 'Review', detail: 'Explain a choice', minutes: 20 }], source: 'student' }, available: false });
      },
    });
    await settled();
    const control = label => named(root, label).children[0];
    assert.equal(control('Starting total score ').value, '');
    assert.equal(control('Target total score ').value, '');
    assert.equal(control('Test date ').value, '');
    control('Starting total score ').value = '1280';
    control('Target total score ').value = '1450';
    control('Test date ').value = '2026-10-03';
    control('Focus section ').value = 'reading-writing';
    control('Your pace ').value = 'small';
    control('Your goal ').value = 'Explain grammar choices';
    descendants(root).find(n => n.tagName === 'form').fire('submit'); await settled();
    assert.match(calls[0].goal, /starting total 1280; target total 1450/);
    assert.match(calls[0].goal, /intended test date 2026-10-03/);
    assert.match(calls[0].goal, /focus on Reading and Writing/);
    assert.match(calls[0].goal, /smaller steps/);
    const course = control('Class or study subject '); course.value = '42'; course.fire('change');
    assert.equal(control('Starting total score ').disabled, true);
    descendants(root).find(n => n.tagName === 'form').fire('submit'); await settled();
    assert.doesNotMatch(calls[1].goal, /1280|1450|2026-10-03|SAT planning/);
    assert.match(calls[1].goal, /smaller steps/);
    instance.dispose();
  } finally { globalThis.document = prior; }
});
