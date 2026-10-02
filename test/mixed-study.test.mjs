import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendMixedPrompt, mixedSubjectLabel, mixedProviderLabel, mixedSummaryAfter, mountMixedStudy } from '../public/mixed-study.js';
import { createMixedPracticeService } from '../mixed-practice.js';

class FixtureNode {
  constructor(tag, text = '') { this.tagName = tag.toUpperCase(); this.children = []; this.text = text; this.attributes = {}; }
  set textContent(text) { this.text = text; this.children = []; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }
  set innerHTML(_) { throw new Error('Prompt rendering must not parse arbitrary HTML'); }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes[name] = value; }
}
function withFixture(callback) {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new FixtureNode(tag), createTextNode: (text) => new FixtureNode('#text', text) };
  try { callback(new FixtureNode('div')); } finally { globalThis.document = original; }
}
const descendants = (node) => [node, ...node.children.flatMap(descendants)];

test('generated prompt structure preserves authored paragraphs and LaTeX without literal HTML wrappers', () => withFixture((root) => {
  appendMixedPrompt(root, '<p>A cart has position $x(t)=t^2$.</p><p>Find its <strong>velocity</strong> at $t=3$.</p>');
  assert.equal(root.children.filter((child) => child.tagName === 'P').length, 2);
  assert.ok(descendants(root).some((child) => child.tagName === 'STRONG' && child.textContent === 'velocity'));
  assert.match(root.textContent, /\$x\(t\)=t\^2\$/);
  assert.doesNotMatch(root.textContent, /<p>|<strong>/);
}));

test('mixed prompt attributes and unsupported active tags never become executable DOM', () => withFixture((root) => {
  appendMixedPrompt(root, '<p onclick="alert(1)">A &lt; B &amp; C</p><img src="https://example.invalid/pixel"><script>alert(1)</script><a href="javascript:alert(1)">link</a>');
  const nodes = descendants(root);
  assert.ok(!nodes.some((child) => ['IMG', 'SCRIPT', 'A'].includes(child.tagName)));
  assert.equal(root.children[0].textContent, 'A < B & C');
  assert.equal(root.children[0].onclick, undefined);
  assert.match(root.textContent, /<script>alert\(1\)<\/script>/);
}));

test('generated prompt supports nested lists, basic tables and line breaks', () => withFixture((root) => {
  appendMixedPrompt(root, '<ul><li>First<br>step</li><li><em>Second</em></li></ul><table><tr><th>t</th><td>3</td></tr></table><p>After table</p>');
  const nodes = descendants(root);
  assert.equal(nodes.filter((child) => child.tagName === 'LI').length, 2);
  assert.equal(nodes.filter((child) => child.tagName === 'BR').length, 1);
  assert.equal(nodes.filter((child) => child.tagName === 'TABLE').length, 1);
  assert.equal(root.children.at(-1).textContent, 'After table');
}));

test('subject and provider labels identify the actual course and source', () => {
  assert.equal(mixedSubjectLabel('physics'), 'AP Physics 1');
  assert.equal(mixedSubjectLabel('calculus-bc'), 'AP Calculus BC');
  for (const [model, label] of [
    ['claude-fable-5-1', 'Claude Fable 5.1'], ['claude-opus-5', 'Claude Opus 5'],
    ['gpt-6-astra', 'GPT-6 Astra'], ['gpt-5.6-sol', 'GPT-5.6 Sol'],
  ]) {
    assert.equal(mixedProviderLabel(model), label);
    assert.equal(mixedProviderLabel(model, true), `${label} (backup)`);
  }
  assert.equal(mixedProviderLabel(null), 'Verified question generator');
  assert.equal(mixedProviderLabel('future-model-v2', true), 'AI model: future-model-v2 (backup)');
  for (const model of ['anthropic', 'openai', 'google', 'gemini', '<script>bad</script>', 'x'.repeat(81), {}]) {
    assert.equal(mixedProviderLabel(model), 'AI coach (model not reported)');
  }
});

test('an older answer response cannot erase newly received coaching assistance', () => {
  const latest = { attempted: 3, assisted: 2, independentCorrect: 1 };
  assert.equal(mixedSummaryAfter(latest, { attempted: 3, assisted: 1, independentCorrect: 2 }), latest);
  const next = { attempted: 4, assisted: 2, independentCorrect: 2 };
  assert.equal(mixedSummaryAfter(latest, next), next);
  assert.equal(mixedSummaryAfter({}, latest), latest);
});

class StudyNode {
  constructor(tag = 'div', text = '') {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
    this.className = ''; this.attributes = {}; this.listeners = new Map(); this._text = text; this._value = '';
    this.disabled = false; this.checked = false; this.selected = false; this.open = false;
  }
  set innerHTML(_) { throw new Error('Study UI must construct safe DOM.'); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  get value() { return this.tagName === 'SELECT' && !this._value ? (this.children.find(child => child.selected) || this.children[0])?.value || '' : this._value; }
  set value(value) { this._value = String(value); }
  appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
  append(...children) { for (const child of children) this.appendChild(typeof child === 'string' ? new StudyNode('#text', child) : child); }
  replaceChildren(...children) { for (const child of this.children) child.parentNode = null; this.children = []; this._text = ''; this.append(...children); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  after(child) { const parent = this.parentNode; if (parent) { child.remove(); child.parentNode = parent; parent.children.splice(parent.children.indexOf(this) + 1, 0, child); } }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(callback); }
  dispatch(type) { for (const callback of this.listeners.get(type) || []) callback({ preventDefault() {}, target: this }); }
  click() { if (!this.disabled) this.dispatch('click'); }
  requestSubmit() { this.dispatch('submit'); }
  focus() { document.activeElement = this; }
  querySelectorAll(selector) {
    const all = node => node.children.flatMap(child => [child, ...all(child)]);
    const matches = (node, part) => {
      const tag = /^[a-z][a-z0-9-]*/i.exec(part)?.[0];
      if (tag && node.tagName !== tag.toUpperCase()) return false;
      if ([...part.matchAll(/\.([\w-]+)/g)].some(match => !node.className.split(/\s+/).includes(match[1]))) return false;
      if (part.includes(':checked') && !node.checked) return false;
      return [...part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(([, key, value]) => value === undefined ? key in node || key in node.attributes : String(node[key] ?? node.attributes[key]) === value);
    };
    return all(this).filter(node => selector.split(',').some(part => matches(node, part.trim())));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const studyTopics = [{ id: 'linear', subject: 'algebra', title: 'Linear equations', description: 'Solve one-step equations.' }, { id: 'forces', subject: 'physics', title: 'Forces', description: 'Connect force and motion.' }];
const studyQuestion = { id: 'question-1', topicId: 'linear', subject: 'algebra', difficulty: 1, prompt: '<p>Solve $x+2=5$.</p>', choices: ['3', '7'], hintsCount: 1 };
const settleStudy = () => new Promise(resolve => setImmediate(resolve));
const studyButton = (root, text) => {
  const result = root.querySelectorAll('button').find(button => button.textContent === text);
  assert.ok(result, `Missing Study action ${text}`); return result;
};
let nextStudyFixture = 0;
async function withStudy(request, run) {
  const old = { document: globalThis.document, sessionStorage: globalThis.sessionStorage };
  const storage = new Map();
  globalThis.document = { createElement: tag => new StudyNode(tag), createTextNode: text => new StudyNode('#text', text), activeElement: null };
  globalThis.sessionStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const root = new StudyNode(), calls = [], contexts = [], coachDrafts = [];
  let cleanup;
  try {
    cleanup = mountMixedStudy(root, {
      profileId: `study-fixture-${++nextStudyFixture}`, initialSubject: 'algebra',
      onQuestionContext: context => contexts.push(context), onAskCoach: message => coachDrafts.push(message),
      request: async (path, body, options) => {
        calls.push({ path, body, options });
        if (path === '/api/mixed/topics' && !body) return { topics: studyTopics };
        return request(path, body, options);
      },
    });
    await settleStudy();
    await run({ root, cleanup, calls, contexts, coachDrafts });
  } finally { cleanup?.(); Object.assign(globalThis, old); }
}

test('Study setup retains selected topics and full pre-activity rules behind one clearly labeled disclosure', async () => {
  await withStudy(async () => assert.fail('No practice request should occur before Start study'), async ({ root, calls }) => {
    assert.equal(root.querySelector('h1').textContent, 'Study');
    assert.equal(root.querySelector('h2').textContent, 'Choose topics');
    const guide = root.querySelector('.mixed-practice-guide');
    assert.equal(guide.querySelector('summary').textContent, 'How practice works');
    assert.equal(guide.open, false);
    for (const rule of [/no pass mark or required timer/i, /Questions never advance/, /raise the practice level/, /recorded as help/, /Repeated problems are labeled/, /six hours/, /not an official AP or SAT score/, /eight significant digits/]) assert.match(guide.textContent, rule);
    const choices = root.querySelectorAll('input[name="topic"]');
    assert.equal(choices.length, 2);
    assert.equal(choices[0].checked, true); assert.equal(choices[1].checked, false);
    for (const choice of choices) choice.checked = false;
    root.querySelector('.mixed-topic-form').requestSubmit(); await settleStudy();
    assert.match(root.querySelector('.mixed-selection-status').textContent, /Select at least one topic/);
    assert.equal(calls.length, 1, 'empty topic selection never starts a session');
    assert.doesNotMatch(root.textContent, /generator|local practice level|authored|calibrations/i);
  });
});

test('Study keeps checking explicit, shows useful feedback, and opens the existing Coach without a second request', async () => {
  await withStudy(async (path, body) => {
    if (path === '/api/mixed/session') return { sessionId: 'session-study-123', summary: { attempted: 0, independentCorrect: 0, assisted: 0 } };
    if (path === '/api/mixed/next') return { question: studyQuestion, selectionReason: 'Your selected algebra topic.', summary: { attempted: 0, independentCorrect: 0, assisted: 0 } };
    if (path === '/api/mixed/answer') {
      assert.equal(body.answerIndex, 1);
      return { correct: false, answerIndex: 0, chosenIndex: 1, misconception: 'This choice adds two instead of subtracting it.', solution: ['Subtract 2 from both sides.', 'The value is 3.'], summary: { attempted: 1, independentCorrect: 0, assisted: 0 } };
    }
    assert.fail(`Unexpected practice request ${path}`);
  }, async ({ root, calls, contexts, coachDrafts }) => {
    root.querySelector('.mixed-topic-form').requestSubmit(); await settleStudy();
    assert.deepEqual(calls[1].body.topicIds, ['linear']);
    const context = contexts.at(-1);
    assert.equal(context.sessionId, 'session-study-123'); assert.equal(context.questionId, studyQuestion.id); assert.equal(context.phase, 'before-answer');
    assert.equal(root.querySelector('.mixed-question-details').open, false);
    assert.equal(root.querySelector('.mixed-progress-details').open, false);
    assert.equal(root.querySelector('.mixed-coach-callout').querySelectorAll('h3').length, 0);
    const beforeCoach = calls.length;
    studyButton(root, 'Ask Astra about this question').click();
    assert.equal(calls.length, beforeCoach);
    assert.match(coachDrafts[0], /without giving away the answer/);
    const radio = root.querySelectorAll('input[name="mixed-answer"]')[1];
    radio.checked = true; radio.dispatch('change'); await settleStudy();
    assert.equal(calls.filter(call => call.path === '/api/mixed/answer').length, 0, 'choosing a radio never checks the answer');
    studyButton(root, 'Check answer').click(); await settleStudy();
    const feedback = root.querySelector('.mixed-feedback');
    assert.match(feedback.textContent, /Not yet\./); assert.match(feedback.textContent, /Subtract 2 from both sides/);
    assert.equal(contexts.at(-1).phase, 'after-answer');
    const more = root.querySelector('.mixed-more-practice');
    assert.equal(more.open, false);
    assert.equal(more.querySelector('summary').textContent, 'More practice options');
    assert.ok(studyButton(root, 'Next question'));
    assert.ok(studyButton(more, 'Same problem, new wording')); assert.ok(studyButton(more, 'New challenge on this topic'));
    assert.equal(calls.filter(call => call.path === '/api/mixed/next').length, 1, 'feedback never auto-advances');
    studyButton(root, 'Ask Astra about this question').click();
    assert.match(coachDrafts[1], /worked solution/);
  });
});

test('repeated questions retain a visible no-credit notice and open selection details rather than hiding that limitation', async () => {
  await withStudy(async path => path === '/api/mixed/session'
    ? { sessionId: 'session-study-repeat' }
    : { question: { ...studyQuestion, reviewOnly: true }, selectionReason: 'A previously seen problem is repeated after checking for an unused variation.' }, async ({ root }) => {
    root.querySelector('.mixed-topic-form').requestSubmit(); await settleStudy();
    assert.match(root.querySelector('.mixed-review-note').textContent, /does not count as a new independent answer/);
    assert.equal(root.querySelector('.mixed-question-details').open, true);
    assert.match(root.querySelector('.mixed-question-details').textContent, /previously seen problem/);
  });
});

test('a saved-history read failure stays visible through question and pause without entering a collapsed detail', async () => {
  const historyNotice = 'Saved practice history could not be read. Recent questions from this running server are still checked, but earlier questions may repeat.';
  await withStudy(async path => path === '/api/mixed/session'
    ? { sessionId: 'session-study-history', historyNotice }
    : { question: studyQuestion }, async ({ root }) => {
    root.querySelector('.mixed-topic-form').requestSubmit(); await settleStudy();
    let notice = root.querySelector('.mixed-session-notice');
    assert.equal(notice.textContent, historyNotice);
    assert.equal(notice.attributes.role, 'status');
    assert.equal(notice.parentNode.className, 'mixed-study');
    studyButton(root, 'Pause session').click();
    notice = root.querySelector('.mixed-session-notice');
    assert.equal(notice.textContent, historyNotice);
    assert.ok(studyButton(root, 'Resume session'));
  });
});

async function withScopedStudy(run) {
  const old = { document: globalThis.document, sessionStorage: globalThis.sessionStorage };
  const storage = new Map(), calls = [], cleanups = [];
  const topics = [...studyTopics, { id: 'sat-linear', subject: 'sat', title: 'SAT equations', domainGroup: 'Math' }];
  let serial = 0;
  // Use the actual server session service: separate plans must coexist under
  // one real learner profile, not pass only with a permissive transport mock.
  const service = createMixedPracticeService({ topics, randomId: () => `scoped-session-${++serial}`, randomSeed: () => `seed-${++serial}`,
    generateQuestion: input => ({ ...input, id: input.seed, type: 'mc', subject: topics.find(topic => topic.id === input.topicId).subject,
      prompt: `Practice ${input.topicId} ${input.seed}.`, choices: ['Checked choice', 'Another choice'], answerIndex: 0,
      misconceptions: [null, 'This choice uses the opposite operation.'], hints: ['Check the operation.'], solution: ['Use the checked choice.'] }),
  });
  globalThis.document = { createElement: tag => new StudyNode(tag), createTextNode: text => new StudyNode('#text', text), activeElement: null };
  globalThis.sessionStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const profileId = `study-scope-${++nextStudyFixture}`;
  const mount = async (options = {}, implementation = mountMixedStudy) => {
    const root = new StudyNode(), contexts = [];
    const cleanup = implementation(root, { profileId, ...options, onQuestionContext: value => contexts.push(value), request: async (path, body, transport) => {
      calls.push({ path, body, profileId: transport.profileId });
      if (path === '/api/mixed/topics') return { topics: service.topics() };
      if (path === '/api/mixed/session') return service.create(transport.profileId, body);
      if (path === '/api/mixed/next') return service.next(transport.profileId, body.sessionId);
      if (path.startsWith('/api/mixed/session?')) return service.restore(transport.profileId, new URL(path, 'http://fixture').searchParams.get('sessionId'));
      assert.fail(`Unexpected scoped practice request ${path}`);
    } });
    cleanups.push(cleanup); await settleStudy();
    return { root, cleanup, contexts };
  };
  try { await run({ mount, storage, calls, profileId, service }); }
  finally { for (const cleanup of cleanups) cleanup(); Object.assign(globalThis, old); }
}

test('saved plan and step workspaces independently pause and restore the same learner’s exact practice without duplicate sessions', async () => {
  await withScopedStudy(async ({ mount, storage, calls, profileId }) => {
    const planA = '11111111-1111-4111-8111-111111111111', planB = '22222222-2222-4222-8222-222222222222';
    const scopeA = `${planA}:step-1`, scopeB = `${planB}:step-1`;
    let a = await mount({ workspaceId: scopeA, initialSubject: 'sat' });
    assert.deepEqual(a.root.querySelectorAll('input[name="topic"]:checked').map(input => input.value), ['sat-linear']);
    a.root.querySelector('.mixed-topic-form').requestSubmit(); await settleStudy();
    const questionA = a.contexts.at(-1), answer = a.root.querySelectorAll('input[name="mixed-answer"]')[1];
    answer.checked = true; answer.dispatch('change');
    a.cleanup();

    let b = await mount({ workspaceId: scopeB, initialSubject: 'physics' });
    assert.deepEqual(b.root.querySelectorAll('input[name="topic"]:checked').map(input => input.value), ['forces']);
    b.root.querySelector('.mixed-topic-form').requestSubmit(); await settleStudy();
    const questionB = b.contexts.at(-1);
    assert.equal(questionB.subject, 'physics'); assert.notEqual(questionB.sessionId, questionA.sessionId);
    studyButton(b.root, 'Pause session').click(); b.cleanup();
    assert.equal(JSON.parse(storage.get(`students4ai-mixed-${profileId}:${scopeA}`)).sessionId, questionA.sessionId);
    assert.equal(JSON.parse(storage.get(`students4ai-mixed-${profileId}:${scopeB}`)).sessionId, questionB.sessionId);

    a = await mount({ workspaceId: scopeA, initialSubject: 'sat' });
    studyButton(a.root, 'Resume session').click(); await settleStudy();
    assert.equal(a.contexts.at(-1).questionId, questionA.questionId);
    assert.equal(a.contexts.at(-1).topicId, 'sat-linear');
    assert.equal(a.root.querySelectorAll('input[name="mixed-answer"]')[1].checked, true, 'the unanswered choice stays with its plan');
    a.cleanup();

    // A fresh module has no memory cache, exercising a real sessionStorage restore.
    const reloaded = await import(`../public/mixed-study.js?scope-reload=${profileId}`);
    b = await mount({ workspaceId: scopeB, initialSubject: 'physics' }, reloaded.mountMixedStudy);
    studyButton(b.root, 'Resume session').click(); await settleStudy();
    assert.equal(b.contexts.at(-1).questionId, questionB.questionId); assert.equal(b.contexts.at(-1).topicId, 'forces');
    assert.ok(b.root.querySelectorAll('input[name="mixed-answer"]').every(input => !input.checked), 'another plan never receives the first plan’s draft');
    b.cleanup();
    const otherStep = await mount({ workspaceId: `${planA}:step-2`, initialSubject: 'algebra' });
    assert.equal(otherStep.root.querySelector('h2').textContent, 'Choose topics');
    assert.deepEqual(otherStep.root.querySelectorAll('input[name="topic"]:checked').map(input => input.value), ['linear']);
    const otherLearner = await mount({ profileId: `${profileId}-other`, workspaceId: scopeA, initialSubject: 'sat' });
    assert.equal(otherLearner.root.querySelector('h2').textContent, 'Choose topics');
    const creates = calls.filter(call => call.path === '/api/mixed/session');
    assert.equal(creates.length, 2, 'switching or reloading plans restores explicit IDs instead of creating duplicate sessions');
    assert.ok(creates.every(call => call.profileId === profileId));
    assert.ok(calls.every(call => !call.profileId.includes(planA) && !call.profileId.includes(planB)), 'plan scopes never change the authenticated server profile');
  });
});

test('unscoped practice preserves its old storage key and rejects malformed plan scopes before sending requests', async () => {
  await withScopedStudy(async ({ mount, storage, calls, profileId }) => {
    const first = await mount({ initialSubject: 'algebra' });
    first.root.querySelector('.mixed-topic-form').requestSubmit(); await settleStudy();
    const question = first.contexts.at(-1); first.cleanup();
    assert.equal(JSON.parse(storage.get(`students4ai-mixed-${profileId}`)).sessionId, question.sessionId);
    const reloaded = await import(`../public/mixed-study.js?legacy-reload=${profileId}`);
    const resumed = await mount({ initialSubject: 'physics' }, reloaded.mountMixedStudy);
    studyButton(resumed.root, 'Resume session').click(); await settleStudy();
    assert.equal(resumed.contexts.at(-1).questionId, question.questionId);
    assert.equal(calls.filter(call => call.path === '/api/mixed/session').length, 1);
    const count = calls.length;
    for (const workspaceId of ['', {}, 'plan', '../plan', '11111111-1111-4111-8111-111111111111:', '11111111-1111-4111-8111-111111111111:step/1', `11111111-1111-4111-8111-111111111111:${'x'.repeat(104)}`]) {
      await assert.rejects(mount({ workspaceId }), /valid saved plan and step/);
    }
    assert.equal(calls.length, count, 'invalid scopes never fall back to shared practice');
  });
});
