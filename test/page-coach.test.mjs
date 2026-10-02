import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeCoachHref, coachContextLabel, coachConversationScope, coachSourceDetail, coachReplyIdentity, parseCoachMarkdown, appendReply, mountPageCoach } from '../public/page-coach.js';

test('reply identity names the actual model and derives backup status from the response', () => {
  for (const [model, name] of [
    ['claude-fable-5-1', 'Claude Fable 5.1'], ['claude-opus-5', 'Claude Opus 5'],
    ['gpt-6-astra', 'GPT-6 Astra'], ['gpt-5.6-sol', 'GPT-5.6 Sol'],
  ]) {
    assert.deepEqual(coachReplyIdentity(model), { speaker: name, caption: `Reply from ${name}` });
    assert.deepEqual(coachReplyIdentity(model, true), { speaker: name, caption: `Reply from ${name} · backup coach` });
  }
});

test('reply identity distinguishes source lookup, future models, and unknown model metadata', () => {
  assert.deepEqual(coachReplyIdentity(null), { speaker: 'Study lookup', caption: 'Source lookup (AI unavailable)' });
  assert.deepEqual(coachReplyIdentity('future-model-v2', true), { speaker: 'AI coach', caption: 'Reply from AI model: future-model-v2 · backup coach' });
  for (const model of ['anthropic', 'openai', 'google', 'gemini', '<script>bad</script>', 'x'.repeat(81), {}]) {
    assert.deepEqual(coachReplyIdentity(model), { speaker: 'AI coach', caption: 'Reply from AI coach (model not reported)' });
  }
});

test('coach links allow known study destinations without accepting arbitrary hash commands', () => {
  for (const href of ['#/home', '#/focus', '#/mixed', '#/review', '#/settings', '#/diagnostic', '#/canvas', '#/canvas/plan', '#/canvas/grades', '#/canvas/assessment', '#/canvas/course/123', '#/unit/unit-09', '#/practice/unit-09', '#/mastery/unit-09', '#/lesson/unit-09/u9-l1']) {
    assert.equal(safeCoachHref(href), href);
  }
  for (const href of ['#/settings/erase', '#/unknown', '#/unit/a/../../settings', '#/lesson/unit-09', '#/canvas/course/not-a-course', '#/focus?execute=1', '#/practice/unit-09#anything']) {
    assert.equal(safeCoachHref(href), null, href);
  }
});

test('external coach links accept HTTP and HTTPS but reject credentials, scripts, and relative URLs', () => {
  assert.equal(safeCoachHref('https://school.example/courses/42?module_item_id=123'), 'https://school.example/courses/42?module_item_id=123');
  assert.equal(safeCoachHref('http://example.com'), 'http://example.com/');
  for (const href of ['javascript:alert(1)', 'data:text/html,x', 'file:///C:/secret', '//evil.example', 'https://user:pass@example.com', '/api/coach', ' https://example.com', 'https://example.com ', '']) {
    assert.equal(safeCoachHref(href), null, href);
  }
  for (const href of [null, undefined, 12, {}, 'https://example.com/' + 'x'.repeat(2048)]) assert.equal(safeCoachHref(href), null);
});

test('page context captions distinguish BC, AB, Physics, and each active activity', () => {
  assert.equal(coachContextLabel({ route: '#/mastery/unit-09', subject: 'calculus-bc' }), 'Mastery check · AP Calculus BC');
  assert.equal(coachContextLabel({ route: '#/practice/unit-01', subject: 'calculus-ab' }), 'Practice question · AP Calculus AB');
  assert.equal(coachContextLabel({ route: '#/canvas/plan', subject: 'physics' }), 'Canvas · Physics');
  assert.equal(coachContextLabel({ route: '#/focus', subject: 'all' }), 'Study session · All courses');
  assert.equal(coachContextLabel({ route: '#/unexpected', subject: 'unknown' }), 'Current page');
  assert.equal(coachContextLabel({ title: 'A school task', route: '#/canvas/plan' }), 'A school task');
  assert.equal(coachContextLabel({ title: 'x'.repeat(200) }).length, 120);
});

test('coach conversation scope follows course/subject and isolates each active question', () => {
  const context = { route: '#/home', subject: 'calculus-bc', selectedCourseId: 42 };
  assert.equal(coachConversationScope(context), coachConversationScope({ ...context, route: '#/canvas/plan', selectedCourseId: '42' }), 'navigation in one course can keep its conversation');
  assert.notEqual(coachConversationScope(context), coachConversationScope({ ...context, subject: 'physics' }));
  assert.notEqual(coachConversationScope(context), coachConversationScope({ ...context, selectedCourseId: 43 }));
  const question = { ...context, unitId: 'unit-09', questionId: 'q1' };
  assert.notEqual(coachConversationScope({ ...question, sessionId: 'session-a' }), coachConversationScope({ ...question, sessionId: 'session-b' }));
  assert.notEqual(coachConversationScope(context), coachConversationScope(question), 'page advice is not sent as prior help on a fresh question');
  assert.notEqual(coachConversationScope(question), coachConversationScope({ ...question, questionId: 'q2' }));
  assert.notEqual(coachConversationScope(question), coachConversationScope({ ...question, unitId: 'unit-10' }));
  assert.notEqual(coachConversationScope(question), coachConversationScope({ ...question, phase: 'after-answer' }));
});

test('specific source targets and school terms cannot reuse another lookup conversation', () => {
  const base = { subject: 'calculus-bc', selectedCourseId: '11', termIds: ['1', '2'] };
  assert.equal(coachConversationScope(base), coachConversationScope({ ...base, termIds: [2, 1, 1] }), 'term order and numeric representation do not change scope');
  for (const field of ['itemId', 'assignmentId', 'moduleItemId', 'planId', 'stepId']) {
    assert.notEqual(coachConversationScope({ ...base, [field]: '100' }), coachConversationScope({ ...base, [field]: '101' }), field);
  }
  assert.notEqual(coachConversationScope(base), coachConversationScope({ ...base, termIds: ['3'] }));
  assert.notEqual(coachConversationScope(base), coachConversationScope({ ...base, termIds: [] }));
});

test('a selected topic isolates Coach context while changing activity within that topic preserves it', () => {
  const base = { selectedCourseId: '42', learningTopic: 'Cell structure', learningActivity: 'explain' };
  assert.equal(coachConversationScope(base), coachConversationScope({ ...base, learningActivity: 'practice' }));
  assert.notEqual(coachConversationScope(base), coachConversationScope({ ...base, learningTopic: 'Cell division' }));
});

test('source details use readable status wording and local timestamp formatting', () => {
  assert.equal(coachSourceDetail('read_failed'), 'Could not read');
  assert.equal(coachSourceDetail('metadata_only'), 'File details only');
  assert.equal(coachSourceDetail('metadata-only'), 'File details only');
  assert.equal(coachSourceDetail('linked-not-read'), 'Link found; content not read');
  assert.equal(coachSourceDetail('not_provided'), 'No content returned');
  const detail = coachSourceDetail('available · Read 2026-09-14T23:41:26.937Z · Source updated 2026-09-01T12:00:00Z');
  assert.match(detail, /^Read successfully · Retrieved /);
  assert.match(detail, /Source updated /);
  assert.doesNotMatch(detail, /2026-09-14T|2026-09-01T/);
  assert.equal(coachSourceDetail(null), '');
  assert.equal(coachSourceDetail('A teacher-provided source note'), 'A teacher-provided source note');
});

test('coach Markdown separates headings, ordered steps, bullets and fenced code', () => {
  const blocks = parseCoachMarkdown('### Next steps\n- Read **instructions**\n- Ask a question\n\n3. Open Canvas\n4. Check dates\n\n\x60\x60\x60js\nconst x = "<script>";\n\x60\x60\x60\nA final paragraph.');
  assert.deepEqual(blocks.map((block) => block.type), ['heading', 'list', 'list', 'code', 'paragraph']);
  assert.deepEqual(blocks[0], { type: 'heading', level: 4, text: 'Next steps' });
  assert.equal(blocks[1].ordered, false);
  assert.equal(blocks[2].start, 3);
  assert.equal(blocks[3].text, 'const x = "<script>";');
  assert.equal(parseCoachMarkdown('\x60\x60\x60\nunclosed code')[0].type, 'code');
});

test('tables require a valid matching separator and preserve escaped and code pipes', () => {
  const [table] = parseCoachMarkdown('| Assignment | Deadline |\n| :--- | ---: |\n| **Quiz** | Sept 18 |\n| A \\| B | \x60a|b\x60 |');
  assert.equal(table.type, 'table');
  assert.deepEqual(table.headers, ['Assignment', 'Deadline']);
  assert.deepEqual(table.rows, [['**Quiz**', 'Sept 18'], ['A | B', '\x60a|b\x60']]);
  assert.equal(parseCoachMarkdown('Assignment | Deadline\n--- | ---\nQuiz | Friday')[0].type, 'table');
  for (const text of ['A | B\nnot | a separator', 'A | B\n--- | --- | ---', 'a || b']) assert.equal(parseCoachMarkdown(text)[0].type, 'paragraph');
});

test('rendered tables are bounded to 50 rows and eight columns', () => {
  const row = Array.from({ length: 10 }, (_, index) => `cell${index}`).join(' | ');
  const [table] = parseCoachMarkdown([row, Array(10).fill('---').join('|'), ...Array(60).fill(row)].join('\n'));
  assert.equal(table.headers.length, 8);
  assert.equal(table.rows.length, 50);
  assert.ok(table.rows.every((cells) => cells.length === 8));
  assert.equal(table.totalRows, 60);
  assert.equal(table.totalColumns, 10);
});

test('reply DOM uses semantic nodes and keeps HTML and unsafe links inert', () => {
  class FixtureNode {
    constructor(tag, text = '') { this.tag = tag; this.children = []; this.attributes = {}; this.text = text; }
    set textContent(text) { this.text = text; this.children = []; }
    get textContent() { return this.text + this.children.map((node) => node.textContent).join(''); }
    set innerHTML(_) { throw new Error('HTML parsing must never be used'); }
    appendChild(child) { this.children.push(child); return child; }
    setAttribute(name, value) { this.attributes[name] = value; }
  }
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => new FixtureNode(tag), createTextNode: (text) => new FixtureNode('#text', text) };
  try {
    const root = new FixtureNode('div');
    appendReply(root, '### Due dates\n| Assignment | Deadline |\n| --- | --- |\n| **Quiz** | <img src=x onerror=alert(1)> |\n\n- First step\n- [unsafe](javascript:alert(1))');
    const all = (node) => [node, ...node.children.flatMap(all)];
    const nodes = all(root);
    assert.ok(nodes.some((node) => node.tag === 'h4' && node.textContent === 'Due dates'));
    assert.equal(nodes.filter((node) => node.tag === 'th' && node.attributes.scope === 'col').length, 2);
    assert.equal(nodes.filter((node) => node.tag === 'li').length, 2);
    assert.ok(nodes.some((node) => node.tag === 'strong' && node.textContent === 'Quiz'));
    assert.ok(nodes.some((node) => node.attributes.role === 'region' && node.tabIndex === 0));
    assert.ok(!nodes.some((node) => ['img', 'script', 'a'].includes(node.tag)));
    assert.match(root.textContent, /<img src=x onerror=alert\(1\)>/);
    assert.match(root.textContent, /javascript:alert\(1\)/);
    const row = Array(9).fill('x').join('|'); const capped = new FixtureNode('div');
    appendReply(capped, [row, Array(9).fill('---').join('|'), ...Array(51).fill(row)].join('\n'));
    assert.match(capped.textContent, /Showing 50 of 51 rows and 8 of 9 columns/);
  } finally { globalThis.document = originalDocument; }
});

// A deliberately small DOM fixture for the coach's event and ownership boundary.
// Browser layout and visual styling are checked separately; these tests exercise
// real callbacks without a DOM package or network/AI services.
class CoachFixtureNode {
  constructor(tag = 'div', text = '') {
    this.tagName = tag.toUpperCase();
    this.children = []; this.parentNode = null; this.attributes = {};
    this.listeners = new Map(); this._text = text; this.className = '';
    this.value = ''; this.hidden = false; this.disabled = false; this.scrollTop = 0;
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(' '); },
      toggle: (name, force) => {
        const present = force === undefined ? !this.classList.contains(name) : force;
        this.classList[present ? 'add' : 'remove'](name); return present;
      },
    };
  }
  get textContent() { return this._text + this.children.map((node) => node.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  set innerHTML(_) { throw new Error('Coach rendering must use safe DOM nodes'); }
  get isConnected() { return this._connected === true || this.parentNode?.isConnected === true; }
  appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
  append(...children) { for (const child of children) this.appendChild(typeof child === 'string' ? new CoachFixtureNode('#text', child) : child); }
  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = []; this._text = ''; this.append(...children);
  }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  dispatch(type, event = {}) {
    const dispatched = { type, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...event };
    for (const callback of [...(this.listeners.get(type) || [])]) callback(dispatched);
  }
  dispatchEvent(event) { this.dispatch(event.type, { detail: event.detail }); return true; }
  click() { if (!this.disabled) this.dispatch('click'); }
  requestSubmit() { this.dispatch('submit'); }
  focus() { document.activeElement = this; }
  getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; }
  querySelectorAll(selector) {
    const matches = (node) => selector.startsWith('.') ? node.classList.contains(selector.slice(1)) : node.tagName === selector.toUpperCase();
    const descendants = (node) => node.children.flatMap((child) => [child, ...descendants(child)]);
    return descendants(this).filter(matches);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

async function withCoach(options, callback) {
  const originals = { document: globalThis.document, window: globalThis.window, CustomEvent: globalThis.CustomEvent };
  globalThis.CustomEvent ||= class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  };
  globalThis.document = {
    activeElement: null,
    createElement: (tag) => new CoachFixtureNode(tag),
    createElementNS: (_namespace, tag) => new CoachFixtureNode(tag),
    createTextNode: (text) => new CoachFixtureNode('#text', text),
    addEventListener() {}, removeEventListener() {},
  };
  const window = globalThis.window = new CoachFixtureNode('window');
  const root = new CoachFixtureNode(); root._connected = true;
  let cleanup;
  try {
    cleanup = mountPageCoach(root, options);
    await callback({ root, window, cleanup, find: (selector) => {
      const node = root.querySelector(selector); assert.ok(node, `Missing coach element ${selector}`); return node;
    } });
  } finally {
    cleanup?.();
    globalThis.document = originals.document; globalThis.window = originals.window; globalThis.CustomEvent = originals.CustomEvent;
  }
}

function deferredReply() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}
const settleCoach = () => new Promise((resolve) => setImmediate(resolve));
const actionNamed = (root, text) => {
  const button = root.querySelectorAll('button').find((node) => node.textContent === text);
  assert.ok(button, `Missing coach action ${text}`); return button;
};

test('mounted coach sends current context and only completed turns as conversation history', async () => {
  const calls = [];
  const context = { route: '#/practice/unit-01', subject: 'calculus-bc', unitId: 'unit-01', questionId: 'q1', sessionId: 'session-a', phase: 'before-answer' };
  await withCoach({ context: () => context, request: async (payload, options) => {
    calls.push({ payload, options }); return { text: 'Use the definition of the derivative.', model: 'gpt-6-astra' };
  } }, async ({ find, cleanup }) => {
    const form = find('.page-coach-form');
    const input = form.querySelector('textarea');
    cleanup.focus('  Explain the first step.  ');
    assert.equal(document.activeElement, input);
    assert.equal(calls.length, 0, 'opening a prepared draft never requests tutoring');
    form.requestSubmit();
    assert.equal(input.value, '');
    assert.equal(form.getAttribute('aria-busy'), 'true');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].payload, { pageContext: context, message: 'Explain the first step.', transcript: [] });
    assert.ok(calls[0].options.signal instanceof AbortSignal);
    await settleCoach();
    assert.equal(form.getAttribute('aria-busy'), 'false');
    assert.equal(find('.page-coach-log').querySelectorAll('article').length, 2);
    assert.match(find('.page-coach-log').textContent, /Reply from GPT-6 Astra/);
    cleanup.ask('What can I try next?');
    assert.deepEqual(calls[1].payload.transcript, [
      { role: 'user', text: 'Explain the first step.' },
      { role: 'assistant', text: 'Use the definition of the derivative.' },
    ]);
    await settleCoach();
  });
});

test('the Coach header stays simple and read-aloud clearly discloses its AI-generated voice when enabled', async () => {
  await withCoach({ audio: { transcribe: async () => '', synthesize: async () => new Blob() } }, async ({ root, find }) => {
    assert.equal(find('.page-coach-subtitle').textContent, 'Your AI study assistant');
    assert.equal(find('.page-coach-voice-state').textContent, 'Read aloud off');
    assert.match(find('.page-coach-contextbar').textContent, /Spoken replies use an AI-generated voice/);
    const toggle = actionNamed(root, 'Read replies aloud');
    assert.match(toggle.getAttribute('aria-describedby'), /-audio-note$/);
    toggle.click();
    assert.match(find('.page-coach-voice-state').textContent, /^AI-generated voice · Replies will be read aloud$/);
    toggle.click();
    assert.equal(find('.page-coach-voice-state').textContent, 'Read aloud off');
  });
});

test('successful source details stay optional while citations and exact reply identity remain available', async () => {
  await withCoach({ request: async () => ({ text: 'Start with your class instructions.', model: 'gpt-6-astra',
    sources: [{ label: 'Class instructions', href: 'https://school.example/instructions', detail: 'available · Read 2026-10-02T12:00:00Z' }],
    rulesAdded: 1,
    recordReads: [{ collection: 'saved_notes', state: 'available', count: 2, totalCount: 2, nextOffset: null }],
  }) }, async ({ find, cleanup }) => {
    cleanup.ask('Help me start.'); await settleCoach();
    const log = find('.page-coach-log');
    assert.match(log.textContent, /Reply from GPT-6 Astra/);
    assert.equal(find('.page-coach-sources').querySelector('a').href, 'https://school.example/instructions');
    assert.equal(find('.page-coach-sources').querySelector('.page-coach-source-detail'), null);
    const details = find('.page-coach-reference-details');
    assert.ok(!details.open);
    assert.match(details.textContent, /Retrieved/);
    assert.match(details.textContent, /Saved 1 additional source location/);
    assert.ok(!find('.page-coach-limitations').open);
    assert.ok(!find('.page-coach-contextbar').open);
    assert.match(find('.page-coach-contextbar').textContent, /This conversation stays in this tab/);
    const userMessage = log.querySelectorAll('article')[0];
    assert.equal(userMessage.querySelector('.page-coach-message-context'), null);
  });
});

test('missing sources and incomplete learning information remain visible with the reply', async () => {
  await withCoach({ request: async () => ({ text: 'I could not read the assignment.', model: 'gpt-6-astra',
    sources: [{ label: 'Assignment', href: 'https://school.example/assignment', detail: 'read_failed' }],
    limitations: ['The assignment content could not be read.'],
    recordReads: [{ collection: 'saved_notes', state: 'available', count: 2, totalCount: 5, nextOffset: 2 }],
  }) }, async ({ find, cleanup }) => {
    cleanup.ask('Read my assignment.'); await settleCoach();
    assert.match(find('.page-coach-sources').textContent, /Could not read/);
    const disclosures = find('.page-coach-log').querySelectorAll('.page-coach-limitations');
    assert.equal(disclosures.length, 2);
    assert.ok(disclosures.every(details => details.open));
    assert.match(disclosures[0].textContent, /more records remain/);
    assert.match(disclosures[1].textContent, /assignment content could not be read/);
  });
});

test('stopping a request aborts transport and ignores a late reply without retaining it in later history', async () => {
  const late = deferredReply(); const calls = [];
  await withCoach({ request: (payload, options) => {
    calls.push({ payload, options }); return calls.length === 1 ? late.promise : Promise.resolve({ text: 'A current reply.' });
  } }, async ({ root, find, cleanup }) => {
    cleanup.ask('A request I want to stop.');
    actionNamed(root, 'Stop waiting').click();
    assert.equal(calls[0].options.signal.aborted, true);
    const stoppedStatus = find('.page-coach-status').textContent;
    late.resolve({ text: 'A late reply that must stay hidden.' }); await settleCoach();
    assert.equal(find('.page-coach-log').querySelectorAll('article').length, 1);
    assert.doesNotMatch(find('.page-coach-log').textContent, /late reply/);
    assert.equal(find('.page-coach-status').textContent, stoppedStatus);
    cleanup.ask('Start a different request.');
    assert.deepEqual(calls[1].payload.transcript, []);
    await settleCoach();
  });
});

test('changing the active question cancels old work and clears drafts and conversation before the next request', async () => {
  const late = deferredReply(); const calls = [];
  let context = { subject: 'calculus-bc', unitId: 'unit-01', questionId: 'q1', sessionId: 'practice-a' };
  await withCoach({ context: () => context, request: (payload, options) => {
    calls.push({ payload, options }); return calls.length === 2 ? late.promise : Promise.resolve({ text: 'Reply for the current question.' });
  } }, async ({ find, cleanup }) => {
    cleanup.ask('Explain question one.'); await settleCoach();
    cleanup.ask('More about question one.');
    cleanup.focus('An unsent draft about question one.');
    context = { ...context, questionId: 'q2' };
    cleanup.refresh();
    assert.equal(calls[1].options.signal.aborted, true);
    assert.equal(find('.page-coach-log').textContent, '');
    assert.equal(find('.page-coach-form').querySelector('textarea').value, '');
    late.resolve({ text: 'Stale question one reply.' }); await settleCoach();
    assert.equal(find('.page-coach-log').textContent, '');
    cleanup.ask('Explain question two.');
    assert.equal(calls[2].payload.pageContext.questionId, 'q2');
    assert.deepEqual(calls[2].payload.transcript, []);
    await settleCoach();
  });
});

test('unmount aborts and removes handlers so old controls and late replies cannot revive a coach', async () => {
  const late = deferredReply(); const calls = []; let mathRenders = 0;
  await withCoach({ request: (payload, options) => { calls.push({ payload, options }); return late.promise; }, renderMath: () => { mathRenders += 1; } }, async ({ root, window, find, cleanup }) => {
    cleanup.ask('A pending question.');
    const form = find('.page-coach-form'); const log = find('.page-coach-log');
    const input = form.querySelector('textarea');
    cleanup(); cleanup();
    assert.equal(root.children.length, 0);
    assert.equal(calls[0].options.signal.aborted, true);
    input.value = 'A stale form request.'; form.requestSubmit();
    cleanup.ask('A stale caller request.'); cleanup.refresh(); window.dispatch('hashchange');
    late.resolve({ text: 'A reply after sign-out.' }); await settleCoach();
    assert.equal(calls.length, 1);
    assert.equal(mathRenders, 0);
    assert.doesNotMatch(log.textContent, /reply after sign-out/);
    assert.equal(window.listeners.get('hashchange')?.size, 0);
  });
});

test('signed-out coach never sends a request or mounts account notes', async () => {
  let requests = 0; let noteMounts = 0;
  await withCoach({ signedOut: true, request: async () => { requests += 1; return { text: 'Private reply.' }; }, mountNotes: () => { noteMounts += 1; } }, async ({ root, find, cleanup }) => {
    cleanup.ask('Read my saved progress.');
    cleanup.focus('Send a draft.'); find('.page-coach-form').requestSubmit();
    for (const button of find('.page-coach-quick').querySelectorAll('button')) button.click();
    await settleCoach();
    assert.equal(requests, 0); assert.equal(noteMounts, 0);
    assert.equal(root.querySelector('.page-coach-notes-toggle'), null);
  });
});

test('notes drawer mounts only on explicit open and cleans up on close and coach unmount without tutoring or saving', async () => {
  const mounted = []; let cleanups = 0; let requests = 0; let saves = 0;
  await withCoach({ request: async () => { requests += 1; return { text: 'Reply.' }; }, saveMemo: async () => { saves += 1; }, mountNotes: (root) => {
    mounted.push(root); return () => { cleanups += 1; };
  } }, async ({ find, cleanup }) => {
    const toggle = find('.page-coach-notes-toggle');
    const notebook = find('.page-coach-notebook');
    const content = find('.page-coach-notebook-content');
    assert.equal(notebook.hidden, true);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(mounted.length, 0);
    toggle.click();
    assert.equal(notebook.hidden, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(mounted, [content]);
    find('.page-coach-notebook-close').click();
    assert.equal(notebook.hidden, true);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(cleanups, 1);
    toggle.click(); toggle.click();
    assert.equal(cleanups, 2);
    assert.equal(notebook.hidden, true);
    toggle.click(); cleanup(); cleanup();
    assert.equal(mounted.length, 3);
    assert.equal(cleanups, 3);
    await settleCoach();
    assert.equal(requests, 0, 'opening notes does not count as received tutoring');
    assert.equal(saves, 0, 'notes and conversations are saved only by explicit save actions');
  });
});

for (const action of ['updated', 'deleted']) {
  test(`an owned memory ${action} event clears retained context, aborts the old reply, and keeps the drawer mounted`, async () => {
    const calls = []; const late = deferredReply(); const mounts = []; let noteCleanups = 0;
    await withCoach({ profileId: 'student-a', request: (payload, options) => {
      calls.push({ payload, options });
      return calls.length === 2 ? late.promise : Promise.resolve({ text: 'Reply based on the current saved memories.', model: 'gpt-6-astra' });
    }, mountNotes: node => {
      mounts.push(node);
      const draft = document.createElement('textarea'); draft.value = 'An open memory edit.'; node.appendChild(draft);
      return () => { noteCleanups += 1; };
    } }, async ({ window, find, cleanup }) => {
      cleanup.ask('Use what you remember about how I learn.'); await settleCoach();
      cleanup.ask('Explain another step using that memory.');
      assert.equal(calls[1].payload.transcript.length, 2);
      find('.page-coach-notes-toggle').click();
      const drawer = find('.page-coach-notebook');
      const draft = find('.page-coach-notebook-content').querySelector('textarea');
      window.dispatchEvent(new CustomEvent('students4ai-memo-saved', { detail: { profileId: 'student-b', action } }));
      assert.equal(calls[1].options.signal.aborted, false, 'another learner cannot reset this Coach');
      assert.equal(find('.page-coach-form').getAttribute('aria-busy'), 'true');
      window.dispatchEvent(new CustomEvent('students4ai-memo-saved', { detail: { profileId: 'student-a', action } }));
      assert.equal(calls[1].options.signal.aborted, true);
      assert.equal(find('.page-coach-form').getAttribute('aria-busy'), 'false');
      assert.match(find('.page-coach-status').textContent, /Memory changed/);
      assert.equal(drawer.hidden, false);
      assert.equal(find('.page-coach-notes-toggle').getAttribute('aria-expanded'), 'true');
      assert.equal(mounts.length, 1);
      assert.equal(noteCleanups, 0, 'memory changes must not unmount the editor that made them');
      assert.equal(find('.page-coach-notebook-content').querySelector('textarea'), draft);
      assert.equal(draft.value, 'An open memory edit.');
      late.resolve({ text: 'This stale reply used a memory that is no longer current.' }); await settleCoach();
      assert.doesNotMatch(find('.page-coach-log').textContent, /This stale reply/);
      assert.match(find('.page-coach-status').textContent, /Memory changed/);
      cleanup.ask('Use my current saved preferences.');
      assert.deepEqual(calls[2].payload.transcript, [], 'old preference-bearing turns cannot enter the next model request');
      await settleCoach();
      assert.equal(drawer.hidden, false);
      assert.equal(noteCleanups, 0);
      cleanup();
      assert.equal(noteCleanups, 1);
      assert.equal(window.listeners.get('students4ai-memo-saved')?.size, 0);
    });
  });
}

test('newly created memories refresh listeners without cancelling the active Coach reply or losing its transcript', async () => {
  const calls = []; const late = deferredReply(); const events = [];
  await withCoach({ profileId: 'student-a', request: (payload, options) => {
    calls.push({ payload, options });
    return calls.length === 1 ? late.promise : Promise.resolve({ text: 'The next explanation.' });
  } }, async ({ window, find, cleanup }) => {
    window.addEventListener('students4ai-memo-saved', event => events.push(event.detail));
    cleanup.ask('Please explain one step at a time.');
    window.dispatchEvent(new CustomEvent('students4ai-memo-saved', { detail: { profileId: 'student-a', action: 'created' } }));
    assert.equal(calls[0].options.signal.aborted, false);
    assert.equal(find('.page-coach-form').getAttribute('aria-busy'), 'true');
    late.resolve({ text: 'First, identify the variable.', model: 'gpt-6-astra', memoryWrites: [
      { state: 'saved', id: 'memory-a', text: 'Prefers one step at a time.', kind: 'preference' },
    ] });
    await settleCoach();
    assert.match(find('.page-coach-log').textContent, /First, identify the variable/);
    assert.match(find('.page-coach-log').textContent, /Memory savedPrefers one step at a time/);
    assert.equal(find('.page-coach-form').getAttribute('aria-busy'), 'false');
    assert.equal(find('.page-coach-status').textContent, '');
    assert.deepEqual(events, [
      { profileId: 'student-a', action: 'created' },
      { profileId: 'student-a', action: 'created' },
    ]);
    cleanup.ask('Continue with the second step.');
    assert.deepEqual(calls[1].payload.transcript, [
      { role: 'user', text: 'Please explain one step at a time.' },
      { role: 'assistant', text: 'First, identify the variable.' },
    ]);
    await settleCoach();
  });
});

test('a failed coaching reply still displays its durable memory receipt and offers access to edit it', async () => {
  let requests = 0, noteMounts = 0; const events = [], calls = [];
  const memoryText = '<img src=x onerror=alert(1)> Show a diagram before formulas.';
  await withCoach({ profileId: 'student-a', request: async payload => {
    calls.push(payload); requests += 1;
    if (requests === 1) {
      const error = new Error('Provider temporarily unavailable.');
      error.memoryWrites = [{ state: 'saved', id: 'memory-a', text: memoryText, kind: 'preference' }];
      throw error;
    }
    return { text: 'The provider is available again.', model: 'gpt-6-astra' };
  }, mountNotes: () => { noteMounts += 1; return () => {}; } }, async ({ root, window, find, cleanup }) => {
    window.addEventListener('students4ai-memo-saved', event => events.push(event.detail));
    cleanup.ask('Please remember that diagrams help me.'); await settleCoach();
    const log = find('.page-coach-log');
    assert.equal(log.querySelectorAll('article').length, 1, 'a saved memory is not presented as a successful AI reply');
    assert.match(log.textContent, /Memory saved/);
    assert.ok(log.textContent.includes(memoryText));
    assert.equal(log.querySelectorAll('img').length, 0, 'memory text is inert');
    assert.match(find('.page-coach-status').textContent, /could not reply/);
    assert.equal(find('.page-coach-form').getAttribute('aria-busy'), 'false');
    assert.deepEqual(events, [{ profileId: 'student-a', action: 'created' }]);
    actionNamed(root, 'Manage memories').click();
    assert.equal(find('.page-coach-notebook').hidden, false);
    assert.equal(noteMounts, 1);
    assert.equal(requests, 1, 'opening saved memory controls does not retry tutoring');
    actionNamed(root, 'Try again').click(); await settleCoach();
    assert.equal(requests, 2);
    assert.deepEqual(calls[1].transcript, [], 'failed replies never become conversation history');
    assert.equal(calls[1].message, calls[0].message);
    assert.match(log.textContent, /The provider is available again/);
    assert.ok(log.textContent.includes(memoryText), 'the successful retry does not erase a confirmed saved memory receipt');
  });
});

test('attachment selection never sends automatically and failed uploads retry the same question until a confirmed reply', async () => {
  const calls = [];
  const note = new File(['Explain this study note.'], 'class-note.txt', { type: 'text/plain' });
  await withCoach({ request: async payload => {
    calls.push(payload);
    if (calls.length === 1) throw new Error('Unavailable');
    return { text: 'Start with the definition.', model: 'gpt-6-astra' };
  } }, async ({ root, find, cleanup }) => {
    const picker = find('.page-coach-file-input'); picker.files = [note]; picker.dispatch('change');
    await settleCoach();
    assert.equal(calls.length, 0);
    assert.equal(find('.page-coach-send').disabled, false);
    assert.equal(find('.page-coach-attachments').children.length, 1);
    assert.doesNotMatch(root.textContent, /Explain this study note/);
    find('.page-coach-form').requestSubmit(); await settleCoach();
    assert.equal(calls[0].message, 'Help me understand the attached study material.');
    assert.equal(Buffer.from(calls[0].attachments[0].data, 'base64').toString(), 'Explain this study note.');
    assert.equal(find('.page-coach-attachments').children.length, 1, 'files stay selected after a failure');
    actionNamed(root, 'Try again').click(); await settleCoach();
    assert.deepEqual(calls[1], calls[0]);
    assert.equal(find('.page-coach-attachments').children.length, 0, 'confirmed replies release upload drafts');
    assert.doesNotMatch(root.textContent, new RegExp(calls[0].attachments[0].data));
    cleanup.ask('Explain one more step.'); await settleCoach();
    assert.equal('attachments' in calls[2], false);
    assert.ok(calls[2].transcript.every(turn => Object.keys(turn).sort().join(',') === 'role,text'));
  });
});

test('removing an attachment after a failure restores the question and cannot resend removed bytes', async () => {
  const calls = [];
  await withCoach({ request: async payload => { calls.push(payload); throw new Error('Unavailable'); } }, async ({ root, find, cleanup }) => {
    const picker = find('.page-coach-file-input'); picker.files = [new File(['My notes'], 'notes.txt', { type: 'text/plain' })]; picker.dispatch('change'); await settleCoach();
    cleanup.focus('Explain my notes.'); find('.page-coach-form').requestSubmit(); await settleCoach();
    find('.page-coach-attachment-remove').click();
    assert.equal(find('.page-coach-form').querySelector('textarea').value, 'Explain my notes.');
    assert.equal(actionNamed(root, 'Try again').hidden, true);
    find('.page-coach-form').requestSubmit(); await settleCoach();
    assert.equal(calls[1].message, 'Explain my notes.');
    assert.equal('attachments' in calls[1], false);
  });
});

test('scope changes and unmount revoke photo previews and prevent late attachment reads from returning', async () => {
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const revoked = []; URL.createObjectURL = () => 'blob:study-photo'; URL.revokeObjectURL = url => revoked.push(url);
  let context = { selectedCourseId: 'one' }, finish;
  try {
    await withCoach({ context: () => context }, async ({ find, cleanup }) => {
      const picker = find('.page-coach-file-input'); picker.files = [new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })]; picker.dispatch('change'); await settleCoach();
      assert.equal(find('.page-coach-attachments').querySelector('img').src, 'blob:study-photo');
      context = { selectedCourseId: 'two' }; cleanup.refresh();
      assert.deepEqual(revoked, ['blob:study-photo']);
      assert.equal(find('.page-coach-attachments').children.length, 0);
      picker.files = [{ name: 'late.jpg', type: 'image/jpeg', size: 1, arrayBuffer: () => new Promise(resolve => { finish = resolve; }) }]; picker.dispatch('change');
      context = { selectedCourseId: 'three' }; cleanup.refresh(); finish(Uint8Array.of(1).buffer); await settleCoach();
      assert.equal(find('.page-coach-attachments').children.length, 0);
      picker.files = [new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })]; picker.dispatch('change'); await settleCoach();
      cleanup();
      assert.deepEqual(revoked, ['blob:study-photo', 'blob:study-photo']);
    });
  } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
});

test('Add to Plan hands off only the reply, original request, and study context on explicit click', async () => {
  const plans = [];
  await withCoach({ context: () => ({ selectedCourseId: 'biology', title: 'Biology' }), onPlan: draft => plans.push(draft), request: async () => ({ text: 'Practice five cell questions.', model: 'gpt-6-astra' }) }, async ({ root, find, cleanup }) => {
    const picker = find('.page-coach-file-input'); picker.files = [new File(['Cell structure'], 'biology.txt', { type: 'text/plain' })]; picker.dispatch('change'); await settleCoach();
    cleanup.ask('Suggest a practice plan.'); await settleCoach();
    assert.deepEqual(plans, []);
    actionNamed(root, 'Add to Plan').click(); await settleCoach();
    assert.deepEqual(plans, [{ text: 'Practice five cell questions.', request: 'Suggest a practice plan.', pageContext: { selectedCourseId: 'biology', title: 'Biology' } }]);
    assert.equal(find('.page-coach-status').textContent, '', 'opening a draft must not claim it was saved');
  });
});

for (const field of ['planId', 'stepId']) {
  test(`changing the selected ${field} cancels stale replies and clears files and retained conversation`, async () => {
    const calls = [], late = deferredReply();
    let context = { route: '#/study', selectedCourseId: 'biology', planId: 'plan-one', stepId: 'step-one' };
    await withCoach({ context: () => context, request: (payload, options) => {
      calls.push({ payload, options });
      return calls.length === 2 ? late.promise : Promise.resolve({ text: 'Work on the selected step.', model: 'gpt-6-astra' });
    } }, async ({ find, cleanup }) => {
      cleanup.ask('Explain this step.'); await settleCoach();
      const picker = find('.page-coach-file-input'); picker.files = [new File(['Old study material'], 'old-plan.txt', { type: 'text/plain' })]; picker.dispatch('change'); await settleCoach();
      cleanup.ask('Use this note for the same step.');
      assert.equal(calls[1].payload.transcript.length, 2);
      context = { ...context, [field]: 'changed-selection' }; cleanup.refresh();
      assert.equal(calls[1].options.signal.aborted, true);
      assert.equal(find('.page-coach-attachments').children.length, 0);
      assert.equal(find('.page-coach-log').children.length, 0);
      late.resolve({ text: 'A stale reply for the old plan.' }); await settleCoach();
      assert.equal(find('.page-coach-log').children.length, 0);
      cleanup.ask('Explain the newly selected step.'); await settleCoach();
      assert.equal(calls[2].payload.pageContext[field], 'changed-selection');
      assert.deepEqual(calls[2].payload.transcript, []);
      assert.equal('attachments' in calls[2].payload, false);
    });
  });
}

test('safe attachment validation errors remain visible while the draft stays available to remove', async () => {
  await withCoach({ request: async () => { throw Object.assign(new Error('This photo could not be read. Choose a JPG, PNG or WebP image.'), { code: 'invalid_attachments' }); } }, async ({ find, cleanup }) => {
    const picker = find('.page-coach-file-input'); picker.files = [new File(['unreadable'], 'photo.jpg', { type: 'image/jpeg' })]; picker.dispatch('change'); await settleCoach();
    cleanup.ask('Explain this photo.'); await settleCoach();
    assert.match(find('.page-coach-status').textContent, /This photo could not be read/);
    assert.equal(find('.page-coach-attachments').children.length, 1);
    assert.equal(find('.page-coach-attachment-remove').disabled, false);
  });
});

test('pausing Study aborts the pending reply and audio preference while preserving the conversation, draft, and attachments for retry', async () => {
  const calls = [], late = deferredReply();
  await withCoach({ context: () => ({ planId: 'plan-one', stepId: 'step-one' }), audio: { transcribe: async () => '', synthesize: async () => new Blob() }, request: (payload, options) => {
    calls.push({ payload, options });
    return calls.length === 2 ? late.promise : Promise.resolve({ text: 'A current explanation.', model: 'gpt-6-astra' });
  } }, async ({ root, find, cleanup }) => {
    actionNamed(root, 'Read replies aloud').click();
    cleanup.pause();
    assert.equal(find('.page-coach-voice-toggle').getAttribute('aria-pressed'), 'false');
    cleanup.ask('Explain the first step.'); await settleCoach();
    const picker = find('.page-coach-file-input'); picker.files = [new File(['Step notes'], 'step.txt', { type: 'text/plain' })]; picker.dispatch('change'); await settleCoach();
    cleanup.ask('Explain my notes.');
    cleanup.focus('An unsent follow-up.');
    cleanup.pause();
    assert.equal(calls[1].options.signal.aborted, true);
    assert.equal(find('.page-coach-form').getAttribute('aria-busy'), 'false');
    assert.equal(find('.page-coach-form').querySelector('textarea').value, 'An unsent follow-up.');
    assert.equal(find('.page-coach-attachments').children.length, 1);
    assert.equal(find('.page-coach-status').textContent, 'Study paused.');
    assert.equal(find('.page-coach-log').querySelectorAll('article').length, 3);
    late.resolve({ text: 'A stale reply after pause.' }); await settleCoach();
    assert.doesNotMatch(find('.page-coach-log').textContent, /stale reply/);
    assert.equal(find('.page-coach-status').textContent, 'Study paused.');
    actionNamed(root, 'Try again').click(); await settleCoach();
    assert.deepEqual(calls[2].payload, calls[1].payload);
    assert.equal(find('.page-coach-form').querySelector('textarea').value, 'An unsent follow-up.');
    assert.equal(find('.page-coach-attachments').children.length, 0);
    cleanup(); cleanup.pause();
  });
});

test('ask reports whether it started, retains busy requests as drafts, and keeps topic history across activity changes', async () => {
  const calls = [], pending = deferredReply();
  let context = { selectedCourseId: '42', learningTopic: 'Cell structure', learningActivity: 'explain' };
  await withCoach({ context: () => context, request: payload => { calls.push(payload); return calls.length === 1 ? pending.promise : Promise.resolve({ text: 'Try this practice question.', model: 'gpt-6-astra' }); } }, async ({ find, cleanup }) => {
    assert.equal(cleanup.ask('Explain cell structure.'), true);
    assert.equal(cleanup.ask('Prepare a practice question.'), false);
    assert.equal(calls.length, 1);
    assert.equal(find('.page-coach-form').querySelector('textarea').value, 'Prepare a practice question.');
    pending.resolve({ text: 'Cells contain specialized structures.', model: 'gpt-6-astra' }); await settleCoach();
    context = { ...context, learningActivity: 'practice' }; cleanup.refresh();
    assert.equal(find('.page-coach-log').querySelectorAll('article').length, 2);
    assert.equal(cleanup.ask('Use the explanation for practice.'), true); await settleCoach();
    assert.deepEqual(calls[1].transcript, [{ role: 'user', text: 'Explain cell structure.' }, { role: 'assistant', text: 'Cells contain specialized structures.' }]);
    context = { ...context, learningTopic: 'Cell division' }; cleanup.refresh();
    assert.equal(find('.page-coach-log').children.length, 0);
    cleanup(); assert.equal(cleanup.ask('A stale request.'), false);
  });
});
