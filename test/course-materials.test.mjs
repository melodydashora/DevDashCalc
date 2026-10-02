import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visiblePortalCourses, courseMaterialPrompt, mountCourseMaterials, COURSE_MATERIAL_KINDS } from '../public/course-materials.js';

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

test('each material kind requests course-grounded material without grading or invented official evidence', () => {
  const course = { id: '42', name: 'World history' };
  const prompts = COURSE_MATERIAL_KINDS.map(({ id }) => courseMaterialPrompt({ course, kind: id, topic: 'Industrialization' }));
  assert.equal(new Set(prompts).size, COURSE_MATERIAL_KINDS.length);
  for (const prompt of prompts) {
    assert.match(prompt, /Course: World history/);
    assert.match(prompt, /Topic I chose: Industrialization/);
    assert.match(prompt, /accessible current instructions and resources/);
    assert.match(prompt, /Name the sources you actually read/);
    assert.match(prompt, /disclose unavailable or incomplete/);
    assert.match(prompt, /Do not invent deadlines or claim this is an official exam, a verified answer key, a grade, or mastery credit/);
  }
  assert.match(prompts[0], /concise study guide/);
  assert.match(prompts[1], /six concise flashcards/);
  assert.match(prompts[2], /wait for my answer before giving an explanation or solution/);
  assert.match(prompts[3], /separate example values/);
});

test('bounded material prompts keep complete grounding rules within the canonical message limit', () => {
  for (const character of ['A', '"', '\\', '\n', '𝒙']) {
    for (const { id } of COURSE_MATERIAL_KINDS) {
      const prompt = courseMaterialPrompt({ course: { id: '42', name: character.repeat(1000) + 'course' }, topic: character.repeat(1000), kind: id });
      assert.ok(prompt.length <= 2000, `${id}: ${prompt.length}`);
      assert.ok(prompt.endsWith('state uncertainty when verification is incomplete.'));
    }
  }
  assert.match(courseMaterialPrompt({ course: { id: 42, name: 'History' } }), /ask me to choose it first/);
  assert.match(courseMaterialPrompt({ course: { id: 42, name: 'History' }, kind: 'unsupported' }), /study guide/);
  for (const course of [null, {}, { id: 'abc', name: 'History' }, { id: '42', name: '' }]) {
    assert.throws(() => courseMaterialPrompt({ course }), /Choose a current course/);
  }
});

class Element extends EventTarget {
  constructor(tag) { super(); this.tag = tag; this.children = []; this.parent = null; this.attributes = {}; this.textContent = ''; this.value = ''; }
  append(...children) { for (const child of children) { this.children.push(child); child.parent = this; } }
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
  assert.deepEqual(calls[0].metadata, { courseId: '42', courseName: course.name });
  assert.match(calls[0].prompt, /Ask one original practice question/);
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
