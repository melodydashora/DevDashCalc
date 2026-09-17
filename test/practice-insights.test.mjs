import test from 'node:test';
import assert from 'node:assert/strict';
import { practiceInsightRows, mountPracticeInsights } from '../public/practice-insights.js';

test('practice observations keep independent work, help, and review counts distinct without estimating scores', () => {
  const rows = practiceInsightRows([{ topicId: 'sat-writing-conventions', subject: 'sat', attempts: 5, independentCorrect: 1, incorrect: 2, withHelp: 1, reviews: 1, misconceptionCounts: { 'verb-agreement': 2, '<script>': 100 }, nextStep: 'Explain the rule and try a different problem.', reviewAfter: 'invalid' }, { topicId: 'algebra-linear', subject: 'algebra', attempts: -1 }], 'sat');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].independentCorrect, 1);
  assert.equal(rows[0].withHelp, 1);
  assert.equal(rows[0].reviews, 1);
  assert.equal(rows[0].href, '#/mixed/sat');
  assert.deepEqual(rows[0].patterns, ['Verb agreement (2)']);
  assert.equal(rows[0].reviewAfter, null);
  assert.equal('score' in rows[0], false);
});

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.text = ''; this.isConnected = true; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(value) { throw new Error('Untrusted text must not become HTML'); }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); }
  replaceChildren(...nodes) { this.text = ''; this.children = nodes; }
}
const settled = () => new Promise(resolve => setImmediate(resolve));

test('insights are owner-scoped, render text inertly, and abort on disposal', async () => {
  const previous = globalThis.document; globalThis.document = { createElement: tag => new Node(tag) };
  try {
    const root = new Node('section'); let signal;
    const dispose = mountPracticeInsights(root, { profileId: 'learner-one', request: async (url, options) => {
      assert.equal(url, '/api/practice-history?profile=learner-one'); signal = options.signal;
      return { ok: true, json: async () => ({ topics: [{ topicId: 'sat-data', subject: 'sat', nextStep: '<img src=x>' }] }) };
    } });
    await settled(); assert.match(root.textContent, /<img src=x>/);
    dispose(); assert.equal(signal.aborted, true);
  } finally { globalThis.document = previous; }
});

test('a late history response cannot reveal the previous learner after switching', async () => {
  const previous = globalThis.document; globalThis.document = { createElement: tag => new Node(tag) };
  try {
    const root = new Node('section'); let resolve, current = true;
    const waiting = new Promise(done => { resolve = done; });
    const dispose = mountPracticeInsights(root, { profileId: 'learner-one', isCurrent: () => current, request: () => waiting });
    current = false;
    resolve({ ok: true, json: async () => ({ topics: [{ topicId: 'sat-data', subject: 'sat', nextStep: 'Private prior learner observation' }] }) });
    await settled(); assert.doesNotMatch(root.textContent, /Private prior learner/); dispose();
  } finally { globalThis.document = previous; }
});
