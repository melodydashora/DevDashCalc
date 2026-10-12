import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyPlanClient, studyPlanCourseOptions, mountHomeStudyPlans, mountStudyPlans, studyPlanActivity, studyPlanStudyRequest, studyPlanSourceRefs, studyCourseworkDate } from '../public/study-plans.js';
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
    assert.match(root.textContent, /Enter a topic or question/);
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
    control('Topic, question or request ').value = 'Explain grammar choices';
    descendants(root).find(n => n.tagName === 'form').fire('submit'); await settled();
    assert.match(calls[0].goal, /starting total 1280; target total 1450/);
    assert.match(calls[0].goal, /intended test date 2026-10-03/);
    assert.match(calls[0].goal, /focus on Reading and Writing/);
    assert.match(calls[0].goal, /smaller steps/);
    const course = control('Course '); course.value = '42'; course.fire('change');
    assert.equal(control('Starting total score ').disabled, true);
    descendants(root).find(n => n.tagName === 'form').fire('submit'); await settled();
    assert.doesNotMatch(calls[1].goal, /1280|1450|2026-10-03|SAT planning/);
    assert.match(calls[1].goal, /smaller steps/);
    instance.dispose();
  } finally { globalThis.document = prior; }
});

test('Study callbacks preserve saved plan/course/activity and resolve the selected step from its saved record', () => {
  const plan = { id: 'saved-one', activity: 'model', course: { id: '42', name: 'Biology', subject: 'all' }, goal: 'Explore diffusion', steps: [{ id: 'step-one', detail: 'Change one input and explain the result.', href: '#/library' }] };
  assert.equal(studyPlanActivity({}), 'guide');
  assert.equal(studyPlanActivity({ activity: '__proto__' }), 'guide');
  assert.equal(studyPlanStudyRequest({ ...plan, id: undefined }), null, 'unsaved drafts do not get a Study transition');
  assert.equal(studyPlanStudyRequest(plan, { id: 'foreign-step' }), null);
  assert.deepEqual(studyPlanStudyRequest(plan, { id: 'step-one', detail: 'Ignore saved instructions.', href: 'javascript:alert(1)' }), {
    planId: 'saved-one', stepId: 'step-one', courseId: '42', subject: 'all', activity: 'model', request: 'Change one input and explain the result.', href: '#/library',
  });
  assert.equal(studyPlanStudyRequest({ ...plan, goal: 'x'.repeat(5000) }).request.length, 2000);
});

test('Plan prefill stays editable, course work stays scoped, and chosen activity is sent only on explicit draft', async () => {
  const prior = globalThis.document; globalThis.document = { createElement: tag => new Node(tag) };
  let instance;
  try {
    const root = new Node('section'), calls = [], started = [];
    const items = [{ id: '7', courseId: '42', title: '<b>Cell membranes</b>', type: 'Assignment', dueAt: '2026-10-09T12:00:00Z' }, { id: '8', courseId: '43', title: 'Different course work', dueAt: null }];
    instance = mountStudyPlans(root, {
      profileId: 'one', courses: [{ id: '42', name: 'Biology' }, { id: '43', name: 'English' }], selectedCourseId: '42', canvasItems: items,
      initialGoal: 'Explain diffusion with a model', initialActivity: 'model', onStudyPlan: meta => started.push(meta),
      request: async (path, options) => {
        calls.push({ path, options });
        if (options.method === 'GET') return response({ plans: [] });
        const body = JSON.parse(options.body);
        return response({ plan: { ...body, title: 'Cell study', topics: ['Cell membranes'], steps: [{ id: 'step-one', title: 'Explore', detail: body.goal, minutes: 20 }], source: 'student' } });
      },
    });
    await settled();
    const goal = descendants(root).find(node => node.name === 'goal');
    assert.equal(goal.value, 'Explain diffusion with a model');
    assert.equal(descendants(root).find(node => node.name === 'plan-activity' && node.value === 'model').checked, true);
    const item = descendants(root).find(node => node.name === 'canvasItem');
    assert.equal(item.value, '7');
    assert.doesNotMatch(root.textContent, /Different course work/);
    assert.match(root.textContent, /<b>Cell membranes<\/b>/);
    assert.equal(descendants(root).some(node => node.tagName === 'b'), false);
    assert.equal(descendants(root).some(node => node.type === 'datetime-local'), false, 'Canvas due dates are read only');
    item.checked = true; item.fire('change'); goal.value = 'Use a model to explain why water moves.';
    assert.equal(calls.filter(call => call.options.method === 'POST').length, 0);
    assert.equal(started.length, 0);
    descendants(root).find(node => node.tagName === 'form').fire('submit'); await settled();
    const request = JSON.parse(calls.find(call => call.path.includes('/draft?')).options.body);
    assert.equal(request.activity, 'model'); assert.equal(request.course.id, '42');
    assert.match(request.goal, /Use a model to explain why water moves/);
    assert.match(request.goal, /Course work: <b>Cell membranes<\/b>/);
    assert.deepEqual(request.sourceRefs, [{ type: 'assignment', id: '7' }]);
    assert.doesNotMatch(request.goal, /Selected course item \[/);
    assert.doesNotMatch(request.goal, /Different course|2026-10-09/);
    assert.equal(calls.filter(call => call.options.method === 'POST').length, 1, 'drafting still does not save');
    assert.equal(started.length, 0, 'drafts never auto-start Study');
    instance.updateCanvasItems([{ ...items[0], title: 'Updated class title' }]);
    assert.match(root.textContent, /Updated class title/);
    assert.equal(descendants(root).find(node => node.name === 'canvasItem').checked, true);
  } finally { instance?.dispose(); globalThis.document = prior; }
});

test('a saved plan and step open Study with their real context without completing or generating work', async () => {
  const prior = globalThis.document; globalThis.document = { createElement: tag => new Node(tag) };
  let instance;
  try {
    const root = new Node('section'), calls = [], started = [];
    const plan = { id: 'saved-one', title: 'Test cell membranes', activity: 'test', course: { id: '42', name: 'Biology', subject: 'all' }, goal: 'Plan a test on diffusion.', topics: ['Diffusion'], steps: [{ id: 'step-one', title: 'Choose questions', detail: 'Use checked questions on this topic.', minutes: 20, href: '#/mixed' }], completedStepIds: [], source: 'student' };
    instance = mountStudyPlans(root, { profileId: 'one', selectedPlanId: 'saved-one', courses: [{ id: '42', name: 'Biology' }], onStudyPlan: meta => started.push(meta), request: async (path, options) => { calls.push({ path, options }); return response({ plans: [plan] }); } });
    await settled();
    named(root, 'Study this plan').fire('click'); named(root, 'Study this step').fire('click');
    assert.deepEqual(started.map(meta => [meta.planId, meta.stepId, meta.courseId, meta.activity]), [['saved-one', null, '42', 'test'], ['saved-one', 'step-one', '42', 'test']]);
    assert.equal(calls.length, 1); assert.equal(calls[0].options.method, 'GET');
    assert.equal(descendants(root).some(node => node.href === '#/mixed'), false, 'the old resource link cannot bypass the context-preserving Study callback');
  } finally { instance?.dispose(); globalThis.document = prior; }
});

test('source references are bounded assignment identifiers from a Canvas course, never arbitrary links or source text', () => {
  const refs = [{ type: 'assignment', id: '7' }, { type: 'assignment', id: '7' }, { type: 'page', id: '8' }, { type: 'assignment', id: '../9' }, { type: 'assignment', id: 10 }];
  assert.deepEqual(studyPlanSourceRefs({ course: { id: '42' }, sourceRefs: refs }), [{ type: 'assignment', id: '7' }]);
  assert.deepEqual(studyPlanSourceRefs({ course: { id: 'sat' }, sourceRefs: refs }), []);
  assert.deepEqual(studyPlanSourceRefs({ course: { id: '42' } }), []);
  assert.equal(studyPlanSourceRefs({ course: { id: '42' }, sourceRefs: Array.from({ length: 11 }, (_, id) => ({ type: 'assignment', id: String(id) })) }).length, 10);
});

test('Astra and own drafts keep reviewed assignment refs and metadata through composer changes and explicit save', async () => {
  const prior = globalThis.document; globalThis.document = { createElement: tag => new Node(tag) };
  try {
    for (const own of [false, true]) {
      const root = new Node('section'), calls = []; let stored;
      const schedule = { startAt: '2026-10-12T15:00:00Z', endAt: '2026-10-12T15:30:00Z', timeZone: 'America/Chicago' };
      const instance = mountStudyPlans(root, { profileId: 'one', selectedCourseId: '42', courses: [{ id: '42', name: 'Biology' }, { id: '43', name: 'English' }],
        canvasItems: [{ id: '7', courseId: '42', title: '<b>Cell work</b>', htmlUrl: 'https://school.example/courses/42/assignments/7' }, { id: '7', courseId: '42', title: 'Duplicate' },
          { id: '8', courseId: '43', title: 'Poetry' }, { id: 'assignment:9', courseId: '42', title: 'Invalid identifier' }],
        initialGoal: 'Explain the evidence', clock: { read: () => timeContext(Date.parse('2026-10-12T12:00:00Z'), 'America/Chicago') }, onOpenPlan() {},
        request: async (path, options) => {
          calls.push({ path, options });
          if (options.method === 'GET') return response({ plans: [] });
          const body = JSON.parse(options.body);
          if (path.includes('/draft?')) return response({ plan: { ...body, draftId: 'trusted-draft', canvasSourcesVerified: true, schedule, source: 'astra', title: 'Cell study', topics: ['Cells'],
            steps: [{ id: 'step-1', title: 'Read', detail: 'Explain the evidence.', minutes: 20 }] },
            sources: [{ label: '<b>Source title</b>', href: 'https://school.example/courses/42/assignments/7', detail: 'available · Read 2026-10-12T12:00:00Z' },
              { label: 'Restricted material', href: 'javascript:alert(1)', detail: 'read_failed' }], limitations: ['<script>Source text stayed unavailable.</script>'] });
          stored = body.plan; return response({ plan: { ...body.plan, id: 'saved-source-plan', updatedAt: 'revision-1' } });
        } });
      try {
        await settled();
        const checks = descendants(root).filter(node => node.name === 'canvasItem');
        assert.equal(checks.length, 1, 'duplicates, other courses and invalid IDs are not selectable');
        checks[0].checked = true; checks[0].fire('change');
        if (own) named(root, 'Write my own plan').fire('click');
        else { descendants(root).find(node => node.tagName === 'form').fire('submit'); await settled(); }
        const disclosure = descendants(root).find(node => node.className === 'plan-preferences plan-course-materials');
        assert.ok(disclosure); assert.equal(Boolean(disclosure.open), false);
        assert.equal(descendants(disclosure).find(node => node.tagName === 'summary').textContent, 'Course materials');
        assert.equal(descendants(disclosure).some(node => ['script', 'b'].includes(node.tagName)), false);
        assert.equal(descendants(disclosure).some(node => node.href?.startsWith('javascript:')), false);
        if (own) assert.match(disclosure.textContent, /contents not read here/);
        else {
          assert.match(disclosure.textContent, /Read successfully/); assert.match(disclosure.textContent, /Could not read/);
          assert.match(disclosure.textContent, /<script>Source text stayed unavailable/);
          const input = JSON.parse(calls.find(call => call.path.includes('/draft?')).options.body);
          assert.equal(input.timeZone, 'America/Chicago'); assert.deepEqual(input.sourceRefs, [{ type: 'assignment', id: '7' }]);
        }
        assert.equal(stored, undefined, 'a reviewed draft is not saved automatically');
        const select = descendants(root).find(node => node.name === 'course'); select.value = '43'; select.fire('change');
        const other = descendants(root).find(node => node.name === 'canvasItem'); other.checked = true; other.fire('change');
        instance.updateCanvasItems([{ id: '8', courseId: '43', title: 'Updated poetry' }]);
        named(root, 'Save this plan').fire('click'); await settled();
        assert.equal(stored.course.id, '42'); assert.deepEqual(stored.sourceRefs, [{ type: 'assignment', id: '7' }]);
        assert.doesNotMatch(stored.goal, /Poetry|Updated poetry|Selected course item \[/);
        if (!own) { assert.equal(stored.draftId, 'trusted-draft'); assert.equal(stored.canvasSourcesVerified, true); assert.deepEqual(stored.schedule, schedule); }
      } finally { instance.dispose(); }
    }
  } finally { globalThis.document = prior; }
});

test('Plan selection stops at ten distinct coursework refs and does not silently include an eleventh', async () => {
  const prior = globalThis.document; globalThis.document = { createElement: tag => new Node(tag) }; let instance;
  try {
    const root = new Node('section'); let submitted;
    instance = mountStudyPlans(root, { profileId: 'one', courses: [{ id: '42', name: 'History' }], initialGoal: 'Review these readings',
      canvasItems: Array.from({ length: 11 }, (_, index) => ({ id: String(100 + index), courseId: '42', title: `Reading ${index + 1}` })),
      request: async (_, options) => { if (options.method === 'GET') return response({ plans: [] }); submitted = JSON.parse(options.body); return response({ plan: { ...submitted, title: 'Readings', topics: ['Readings'], steps: [{ title: 'Read', detail: 'Explain', minutes: 20 }] } }); } });
    await settled();
    const checks = descendants(root).filter(node => node.name === 'canvasItem');
    for (const check of checks) { check.checked = true; check.fire('change'); }
    assert.equal(checks[10].checked, false); assert.match(root.textContent, /Choose up to 10 course items/);
    descendants(root).find(node => node.tagName === 'form').fire('submit'); await settled();
    assert.equal(submitted.sourceRefs.length, 10); assert.equal(submitted.sourceRefs.some(ref => ref.id === '110'), false);
  } finally { instance?.dispose(); globalThis.document = prior; }
});

test('planning dates remain separate from official due dates and date-only sources never gain a guessed time', () => {
  const planningDeadline = { status: 'resolved', date: '2026-10-14', precision: 'date' };
  const label = studyCourseworkDate({ dueAt: null, planningDeadline }, 'America/Chicago');
  assert.match(label, /^Planning date:/); assert.match(label, /Oct 14, 2026/); assert.match(label, /Time not supplied/);
  assert.doesNotMatch(label, /00:00|11:59|12:00|AM|PM/);
  assert.match(studyCourseworkDate({ dueAt: '2026-10-15T15:00:00Z', planningDeadline }, 'America/Chicago'), /^Due .*Oct 15, 2026/);
  assert.match(studyCourseworkDate({ planningDeadline: { status: 'conflict', date: '2026-10-14' } }), /needs review/);
  assert.match(studyCourseworkDate({ planningDeadline: { status: 'resolved', dueAt: '2026-10-14T15:00:00Z' } }), /Planning time:.*Official due date not supplied/);
});

test('syllabus-only task selection contributes human request text without inventing an assignment reference', async () => {
  const prior = globalThis.document; globalThis.document = { createElement: tag => new Node(tag) }; let instance;
  try {
    const root = new Node('section'); let stored;
    instance = mountStudyPlans(root, { profileId: 'one', courses: [{ id: '42', name: 'History' }], onOpenPlan() {},
      canvasItems: [{ id: 'source-task-ab12', sourceTask: true, courseId: '42', title: 'Review the syllabus essay', sourceUrl: 'https://school.example/syllabus',
        planningDeadline: { status: 'resolved', date: '2026-10-14', precision: 'date' } }],
      request: async (_, options) => { if (options.method === 'GET') return response({ plans: [] }); stored = JSON.parse(options.body).plan; return response({ plan: { ...stored, id: 'saved-source-task' } }); } });
    await settled();
    assert.match(root.textContent, /Syllabus task · Completion unverified/); assert.match(root.textContent, /Planning date:.*Time not supplied/);
    const check = descendants(root).find(node => node.name === 'canvasItem'); check.checked = true; check.fire('change');
    named(root, 'Write my own plan').fire('click');
    named(root, 'Save this plan').fire('click'); await settled();
    assert.deepEqual(stored.sourceRefs, []);
    assert.match(stored.goal, /Course work: Review the syllabus essay/);
    assert.doesNotMatch(stored.goal, /source-task-ab12|2026-10-14|Selected course item \[/);
  } finally { instance?.dispose(); globalThis.document = prior; }
});
