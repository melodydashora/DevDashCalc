import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefItem, createReedyStudyBrief, mountReedyStudyBrief, sendReedyStudyBrief, REEDY_GUIDE_URL } from '../public/reedy-study-brief.js';

const course = () => ({
  id: 'private-course-id', name: 'Calculus AB', score: 92, account: { name: 'Private learner' }, token: 'secret',
  documents: [{ text: 'Private instructions' }], htmlUrl: 'https://school.example/course/123',
  assignments: [
    { id: 'private-assignment-1', name: 'Limits', dueAt: '2027-01-20T15:00:00-06:00', submission: { score: 98 }, token: 'secret' },
    { id: 'private-assignment-2', name: 'Derivatives', dueAt: null, planningDeadline: { status: 'resolved', date: '2027-01-21', source: 'https://private.example/doc', evidence: 'Private text' } },
    { id: 'private-assignment-3', name: 'Integrals', dueAt: null },
  ],
});
const guideOrigin = new URL(REEDY_GUIDE_URL).origin;
const nonce = '7f6c8a12-1000-4000-8000-c173fcfb0011';

test('only selected titles and dates enter the explicit brief schema, without changing the source', () => {
  const source = course(), before = structuredClone(source);
  const brief = createReedyStudyBrief(source, [1, 0, 1]);
  assert.deepEqual(brief, { format: 'devcalc-reedy-study-brief', version: 1, course: 'Calculus AB', items: [
    { title: 'Derivatives', due: '2027-01-21', source: 'Instructor planning date' },
    { title: 'Limits', due: '2027-01-20T21:00:00.000Z', source: 'Canvas due date' },
  ] });
  assert.doesNotMatch(JSON.stringify(brief), /private|secret|https:|score|submission|account|documents|evidence|Integrals/);
  assert.deepEqual(source, before);
});

test('unknown or conflicting dates remain unknown, and official dates take precedence', () => {
  assert.deepEqual(briefItem(course().assignments[2]), { title: 'Integrals', due: null, source: 'Due date not confirmed' });
  for (const status of ['conflict', 'needs-review', 'unknown']) {
    assert.equal(briefItem({ name: 'Work', planningDeadline: { status, date: '2027-01-21' } }).due, null);
  }
  for (const dueAt of ['2027-02-30T00:00:00Z', '2027-01-21', 'tomorrow', 'https://private.example']) {
    assert.equal(briefItem({ name: 'Work', dueAt }).due, null);
  }
  assert.equal(briefItem({ name: 'Work', planningDeadline: { status: 'resolved', date: '2027-02-30' } }).due, null);
  assert.equal(briefItem({ ...course().assignments[0], planningDeadline: { status: 'resolved', date: '2027-02-01' } }).source, 'Canvas due date');
});

test('labels are bounded and embedded addresses are omitted; invalid selections fail closed', () => {
  const source = course();
  source.name = 'Calculus https://private.example/user teacher@example.com';
  source.assignments[0].name = 'Read www.private.example/file';
  assert.equal(createReedyStudyBrief(source, [0]).course, 'Calculus [link omitted] [address omitted]');
  assert.equal(createReedyStudyBrief(source, [0]).items[0].title, 'Read [link omitted]');
  assert.equal(briefItem({ name: 'x'.repeat(350) }).title.length, 300);
  for (const indexes of [[], [-1], [9], ['0'], [NaN], Array.from({ length: 101 }, (_, i) => i)]) {
    assert.throws(() => createReedyStudyBrief(source, indexes));
  }
  assert.throws(() => createReedyStudyBrief({ name: '', assignments: [] }, [0]));
});

function channel() {
  const events = new Map(), timers = new Map(), sent = [], status = [];
  const peer = { closed: false, postMessage: (data, origin) => sent.push({ data, origin }), focus() {} };
  let timerId = 0, opens = 0;
  const browser = {
    location: { origin: 'https://ailearning4students.com' }, name: '', opener: null,
    open(url, target) { assert.equal(url, REEDY_GUIDE_URL); assert.equal(target, '_blank'); opens++; return peer; },
    addEventListener(type, listener) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(listener); },
    removeEventListener(type, listener) { events.get(type)?.delete(listener); },
    setTimeout(fn, ms) { assert.equal(ms, 60000); timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  return { browser, peer, sent, status, timers, events, opens: () => opens,
    receive(data = { type: 'reedy-guide:ready', nonce }, origin = guideOrigin, source = peer) { for (const fn of [...events.get('message') || []]) fn({ data, origin, source }); },
    hide() { for (const fn of [...events.get('pagehide') || []]) fn(); },
  };
}

test('direct transfer requires the exact guide window, origin, UUID nonce and explicit current selection', () => {
  const h = channel(), brief = createReedyStudyBrief(course(), [1]);
  sendReedyStudyBrief(brief, { browser: h.browser, isCurrent: () => true, status: value => h.status.push(value) });
  assert.deepEqual(h.sent, [{ data: { type: 'devcalc:request-guide' }, origin: guideOrigin }]);
  h.receive(undefined, 'https://unrelated.example');
  h.receive(undefined, guideOrigin, {});
  h.receive({ type: 'reedy-guide:ready', nonce: 'not-a-uuid' });
  h.receive({ type: 'reedy-guide:ready', nonce, extra: true });
  assert.equal(h.sent.length, 1);
  h.receive();
  assert.deepEqual(h.sent[1], { data: { type: 'devcalc:study-brief', nonce, brief }, origin: guideOrigin });
  h.receive();
  assert.equal(h.sent.length, 2, 'a readiness replay cannot transfer twice');
  assert.equal(h.timers.size, 0);
  assert.equal(h.events.get('message').size, 0);
});

test('transfers stop on cancellation, pagehide, timeout, or workspace change', () => {
  for (const condition of ['cancel', 'hide', 'timeout', 'stale']) {
    const h = channel(); let current = true;
    const stop = sendReedyStudyBrief(createReedyStudyBrief(course(), [0]), { browser: h.browser, isCurrent: () => current, status: value => h.status.push(value) });
    if (condition === 'cancel') stop();
    if (condition === 'hide') h.hide();
    if (condition === 'timeout') [...h.timers.values()][0]();
    if (condition === 'stale') current = false;
    h.receive();
    assert.equal(h.sent.length, 1, condition);
    assert.equal(h.events.get('message').size, 0, condition);
    assert.equal(h.timers.size, 0, condition);
  }
});

test('the known guide opener can receive work back, while name alone cannot authorize a transfer', () => {
  const h = channel(); h.browser.name = 'reedyDevCalcWorkspace'; h.browser.opener = h.peer;
  sendReedyStudyBrief(createReedyStudyBrief(course(), [2]), { browser: h.browser, isCurrent: () => true, status() {} });
  assert.equal(h.opens(), 0);
  h.receive(undefined, 'https://unrelated.example');
  assert.equal(h.sent.length, 1);
  h.receive();
  assert.equal(h.sent.length, 2);
});

test('unverified source origins and blocked popups never receive a brief', () => {
  for (const condition of ['unverified', 'blocked']) {
    const h = channel();
    if (condition === 'unverified') h.browser.location.origin = 'https://example.com';
    else h.browser.open = () => null;
    sendReedyStudyBrief(createReedyStudyBrief(course(), [0]), { browser: h.browser, isCurrent: () => true, status: value => h.status.push(value) });
    assert.equal(h.sent.length, 0);
    assert.equal(h.timers.size, 0);
    assert.match(h.status.at(-1), /download/i);
  }
});

class Node {
  constructor(tagName) { this.tagName = tagName; this.children = []; this.text = ''; this.events = {}; this.isConnected = true; this.checked = false; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw new Error('Course and assignment text must stay inert.'); }
  appendChild(node) { this.children.push(node); return node; }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  replaceChildren(...nodes) { this.children = []; this.text = ''; this.append(...nodes); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
  fire(type) { for (const fn of this.events[type] || []) fn({ preventDefault() {} }); }
}
const descendants = node => [node, ...node.children.flatMap(descendants)];

test('the class export panel starts empty, downloads only checked rows, and refuses stale or detached workspaces', t => {
  const original = globalThis.document;
  globalThis.document = { createElement: tag => new Node(tag) };
  t.after(() => { globalThis.document = original; });
  const host = new Node('div'), calls = [], h = channel(); let current = true;
  const stop = mountReedyStudyBrief(host, { course: course(), browser: h.browser, isCurrent: () => current, download: value => calls.push(value) });
  const all = descendants(host), checks = all.filter(node => node.tagName === 'input');
  const form = all.find(node => node.tagName === 'form');
  const download = all.find(node => node.tagName === 'button' && node.type === 'submit');
  const send = all.find(node => node.tagName === 'button' && node.type === 'button');
  assert.ok(checks.every(node => !node.checked)); assert.equal(download.disabled, true); assert.equal(calls.length, 0);
  checks[1].checked = true; checks[1].fire('change');
  assert.equal(download.disabled, false);
  form.fire('submit');
  assert.deepEqual(calls[0], createReedyStudyBrief(course(), [1]));
  send.fire('click');
  checks[2].checked = true; checks[2].fire('change');
  h.receive(); assert.equal(h.sent.length, 1, 'changing selections cancels the pending transfer');
  current = false; form.fire('submit'); assert.equal(calls.length, 1);
  current = true; host.isConnected = false; form.fire('submit'); assert.equal(calls.length, 1);
  stop(); assert.equal(host.children.length, 0);
});
