import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyPlanClient, studyPlanCourseOptions, mountHomeStudyPlans, mountStudyPlans, studyPlanActivity, studyPlanStudyRequest } from '../public/study-plans.js';

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
    const items = [{ id: 'assignment:7', courseId: '42', title: '<b>Cell membranes</b>', type: 'Assignment', dueAt: '2026-10-09T12:00:00Z' }, { id: 'assignment:8', courseId: '43', title: 'Different course work', dueAt: null }];
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
    assert.equal(item.value, 'assignment:7');
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
    assert.match(request.goal, /Selected course item \[assignment:7\]: <b>Cell membranes<\/b>/);
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
