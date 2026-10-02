import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visiblePortalCourses, courseMaterialPrompt, courseMaterialActivity, mountCourseMaterials, COURSE_MATERIAL_KINDS } from '../public/course-materials.js';

test('portal visibility excludes only explicitly hidden valid courses and leaves source data unchanged', () => {
  const current = { id: '1', name: 'Current class', term: { endAt: '2030-01-01' } };
  const old = { id: '2', name: 'Older class', term: { endAt: '2001-01-01' } };
  const extra = { id: 3, name: 'Additional class' };
  const source = Object.freeze([current, old, extra]);
  assert.deepEqual(visiblePortalCourses(source, { '1': 'hidden', '2': 'shown' }), [old, extra]);
  assert.deepEqual(visiblePortalCourses(source, { '2': 'hidden' }), [current, extra]);
  assert.deepEqual(visiblePortalCourses(source, { '2': 'shown' }), source, 'restore reveals the original record');
  assert.deepEqual(visiblePortalCourses(source, Object.create({ '1': 'hidden' })), source);
  assert.equal(source[0], current);
  assert.deepEqual(visiblePortalCourses(null), []);
  assert.deepEqual(visiblePortalCourses([null, {}, { id: 'bad' }], null), []);
});

test('each material kind makes a short natural request for the selected course and topic', () => {
  const course = { id: '42', name: 'World history' };
  const prompts = COURSE_MATERIAL_KINDS.map(({ id }) => courseMaterialPrompt({ course, kind: id, topic: 'Industrialization' }));
  assert.equal(new Set(prompts).size, COURSE_MATERIAL_KINDS.length);
  for (const prompt of prompts) {
    assert.match(prompt, /Course: World history/);
    assert.match(prompt, /Topic: Industrialization/);
    assert.ok(prompt.length < 250);
    assert.doesNotMatch(prompt, /coaching rules|reference data|verified answer key|mastery credit/);
  }
  assert.match(prompts[0], /Explain this in a few clear steps/);
  assert.match(prompts[1], /short study guide/);
  assert.match(prompts[2], /six flashcards/);
  assert.match(prompts[3], /one practice question and wait for my answer/);
  assert.match(prompts[3], /feedback on my reasoning/);
  assert.match(prompts[3], /ask before trying a different kind of question/);
  assert.match(prompts[4], /worked example with the steps and why they work/);
  assert.deepEqual(COURSE_MATERIAL_KINDS.map(({ id }) => courseMaterialActivity(id)), ['explain', 'guide', 'flashcards', 'practice', 'explain']);
});

test('course, topic, and assignment text remain bounded within the canonical message limit', () => {
  for (const character of ['A', '"', '\\', '\n', '𝒙']) {
    for (const { id } of COURSE_MATERIAL_KINDS) {
      const prompt = courseMaterialPrompt({ course: { id: '42', name: character.repeat(1000) + 'course' }, topic: character.repeat(1000), kind: id, item: { id: '19', courseId: '42', title: character.repeat(1000) } });
      assert.ok(prompt.length <= 2000, `${id}: ${prompt.length}`);
      assert.doesNotMatch(prompt, /coaching rules|reference data|mastery credit/);
    }
  }
  assert.match(courseMaterialPrompt({ course: { id: 42, name: 'History' } }), /^Course: History\.\nExplain this/);
  assert.match(courseMaterialPrompt({ course: { id: 42, name: 'History' }, kind: 'unsupported' }), /Explain this/);
  assert.doesNotMatch(courseMaterialPrompt({ course: { id: '42', name: 'History' }, item: { id: '19', courseId: '99', title: 'Foreign assignment' } }), /Foreign assignment/);
  for (const course of [null, {}, { id: 'abc', name: 'History' }, { id: '42', name: '' }]) {
    assert.throws(() => courseMaterialPrompt({ course }), /Choose a current course/);
  }
});

class Element extends EventTarget {
  constructor(tag) { super(); this.tag = tag; this.children = []; this.parent = null; this.attributes = {}; this.textContent = ''; this.value = ''; }
  append(...children) { for (const child of children) { this.children.push(child); child.parent = this; } }
  replaceChildren(...children) { for (const child of this.children) child.parent = null; this.children = []; this.append(...children); }
  setAttribute(name, value) { this.attributes[name] = value; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; this.attached = false; }
  get isConnected() { return Boolean(this.attached || this.parent?.isConnected); }
}
function page(t) {
  const previous = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const root = new Element('section'); root.attached = true;
  const all = (node = root) => [node, ...node.children.flatMap(child => all(child))];
  return { root, find: (predicate) => all().find(predicate) };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('Generate sends the exact selected course metadata through the host once and keeps external text inert', async t => {
  const f = page(t), calls = [];
  const pending = deferred();
  const course = { id: 42, name: '<img src=x onerror=alert(1)> History' };
  const cleanup = mountCourseMaterials(f.root, { course, onGenerate: (prompt, metadata) => { calls.push({ prompt, metadata }); return pending.promise; } });
  const form = f.find(node => node.tag === 'form');
  const kind = f.find(node => node.name === 'kind');
  const topic = f.find(node => node.name === 'topic');
  const button = f.find(node => node.tag === 'button');
  assert.deepEqual(calls, []);
  kind.value = 'question'; topic.value = 'A source comparison';
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].metadata, { courseId: '42', courseName: course.name, itemId: null, learningActivity: 'practice', kind: 'question', topic: 'A source comparison' });
  assert.match(calls[0].prompt, /Ask me one practice question/);
  assert.equal(button.disabled, true);
  assert.equal(f.find(node => node.tag === 'img'), undefined);
  pending.resolve({ text: 'A response from the canonical Coach.' });
  await tick();
  assert.equal(button.disabled, false);
  assert.match(f.find(node => node.className === 'course-materials-status').textContent, /Coach below/);
  cleanup();
  assert.equal(f.root.children.length, 0);
});

test('disposed or switched material forms ignore late host results and cannot launch new requests', async t => {
  const f = page(t), pending = deferred();
  let current = true, calls = 0;
  const cleanup = mountCourseMaterials(f.root, { course: { id: '42', name: 'History' }, isCurrent: () => current,
    onGenerate: () => { calls++; return pending.promise; } });
  const form = f.find(node => node.tag === 'form');
  const status = f.find(node => node.className === 'course-materials-status');
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  const waiting = status.textContent;
  current = false;
  cleanup();
  pending.reject(new Error('private error'));
  await tick();
  assert.equal(status.textContent, waiting);
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  assert.equal(calls, 1);
});

test('rejected generation restores the controls and reports a safe retry message', async t => {
  const f = page(t);
  const cleanup = mountCourseMaterials(f.root, { course: { id: '42', name: 'History' }, onGenerate: async () => { throw new Error('private backend detail'); } });
  f.find(node => node.tag === 'form').dispatchEvent(new Event('submit', { cancelable: true }));
  await tick();
  assert.equal(f.find(node => node.tag === 'button').disabled, false);
  const message = f.find(node => node.className === 'course-materials-status').textContent;
  assert.match(message, /could not be sent/);
  assert.doesNotMatch(message, /private backend detail/);
  cleanup();
});

test('coursework choices are owned by the selected course and changing kind, topic, or item never auto-sends', async t => {
  const f = page(t), contexts = [], calls = [];
  const cleanup = mountCourseMaterials(f.root, { course: { id: '42', name: 'Biology' }, canvasItems: [
    { id: '1', courseId: '42', title: 'Cell lab' }, { id: '2', courseId: '99', title: 'Another course' },
    { id: '1', courseId: '42', title: 'Duplicate lab' }, { id: '<script>', courseId: '42', title: 'Invalid item' },
  ], selectedItemId: '1', onContextChange: meta => contexts.push(meta), onGenerate: (prompt, meta) => calls.push({ prompt, meta }) });
  const item = f.find(node => node.name === 'itemId'), kind = f.find(node => node.name === 'kind'), topic = f.find(node => node.name === 'topic');
  assert.equal(item.children.length, 2);
  assert.equal(item.value, '1');
  assert.equal(kind.value, 'explain');
  assert.deepEqual(contexts, []);
  kind.value = 'question'; kind.dispatchEvent(new Event('change'));
  topic.value = 'Cell membranes'; topic.dispatchEvent(new Event('input'));
  item.value = ''; item.dispatchEvent(new Event('change'));
  assert.equal(contexts.length, 3);
  assert.deepEqual(contexts[2], { courseId: '42', courseName: 'Biology', itemId: null, learningActivity: 'practice', kind: 'question', topic: 'Cell membranes' });
  assert.deepEqual(calls, []);
  item.value = '1'; item.dispatchEvent(new Event('change'));
  f.find(node => node.tag === 'form').dispatchEvent(new Event('submit', { cancelable: true })); await tick();
  assert.match(calls[0].prompt, /Selected coursework: Cell lab/);
  assert.equal(calls[0].meta.itemId, '1');
  cleanup();
});

test('source refresh preserves the form and draft while assignment removal and course rename notify current context', t => {
  const f = page(t), contexts = [];
  const course = { id: '42', name: 'Biology' }, items = [{ id: '1', courseId: '42', title: 'Cell lab' }];
  const cleanup = mountCourseMaterials(f.root, { course, canvasItems: items, selectedItemId: '1', onContextChange: meta => contexts.push(meta), onGenerate() {} });
  const topic = f.find(node => node.name === 'topic'), item = f.find(node => node.name === 'itemId');
  topic.value = 'My unfinished topic'; topic.dispatchEvent(new Event('input'));
  contexts.length = 0;
  cleanup.updateSources({ course: { ...course }, canvasItems: [...items] });
  assert.equal(f.find(node => node.name === 'topic'), topic);
  assert.equal(f.find(node => node.name === 'itemId'), item);
  assert.equal(topic.value, 'My unfinished topic');
  assert.equal(item.value, '1');
  assert.deepEqual(contexts, []);
  cleanup.updateSources({ course: { ...course, name: 'Biology honors' }, canvasItems: [] });
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].courseName, 'Biology honors');
  assert.equal(contexts[0].itemId, null);
  assert.equal(topic.value, 'My unfinished topic');
  assert.match(f.find(node => node.className === 'course-materials-status').textContent, /assignment is no longer available/);
  cleanup();
});

test('editing a choice during a pending request prevents its late result from replacing the new context', async t => {
  const f = page(t), old = deferred(), contexts = [], calls = [];
  const cleanup = mountCourseMaterials(f.root, { course: { id: '42', name: 'History' }, onContextChange: meta => contexts.push(meta),
    onGenerate: (prompt, meta) => { calls.push(meta); return calls.length === 1 ? old.promise : Promise.resolve(); } });
  const form = f.find(node => node.tag === 'form'), topic = f.find(node => node.name === 'topic'), button = f.find(node => node.tag === 'button'), status = f.find(node => node.className === 'course-materials-status');
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  assert.equal(topic.disabled, false, 'choices remain available to cancel the old context');
  topic.value = 'New historical period'; topic.dispatchEvent(new Event('input'));
  assert.equal(button.disabled, false);
  assert.equal(contexts.at(-1).topic, 'New historical period');
  form.dispatchEvent(new Event('submit', { cancelable: true })); await tick();
  const currentStatus = status.textContent;
  old.reject(new Error('old failure')); await tick();
  assert.equal(status.textContent, currentStatus);
  assert.equal(button.disabled, false);
  assert.equal(calls.length, 2);
  cleanup();
});

test('leaving Course mode cancels pending form state without losing choices or accepting late completion', async t => {
  const f = page(t), pending = deferred(); let current = true, notifications = 0;
  const cleanup = mountCourseMaterials(f.root, { course: { id: '42', name: 'History' }, isCurrent: () => current,
    onContextChange: () => { notifications++; }, onGenerate: () => pending.promise });
  const topic = f.find(node => node.name === 'topic'), form = f.find(node => node.tag === 'form'), status = f.find(node => node.className === 'course-materials-status');
  topic.value = 'My question'; topic.dispatchEvent(new Event('input'));
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  current = false; cleanup.cancelPending(); current = true;
  pending.resolve(false); await tick();
  assert.equal(status.textContent, '');
  assert.equal(topic.value, 'My question');
  assert.equal(f.find(node => node.tag === 'button').disabled, false);
  assert.equal(notifications, 1);
  cleanup();
});

test('a busy Coach keeps the request as a learner-controlled draft without claiming it was sent', async t => {
  const f = page(t);
  const cleanup = mountCourseMaterials(f.root, { course: { id: '42', name: 'History' }, onGenerate: () => false });
  f.find(node => node.tag === 'form').dispatchEvent(new Event('submit', { cancelable: true })); await tick();
  assert.match(f.find(node => node.className === 'course-materials-status').textContent, /ready in the Coach draft.*Finish the current reply, then select Send/);
  cleanup();
});
