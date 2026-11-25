import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendMixedPrompt, mixedSubjectLabel, mixedProviderLabel, mixedSummaryAfter, texasAlgebraGuide } from '../public/mixed-study.js';
import { ALGEBRA_TOPICS } from '../mixed-sat-bank.js';

class FixtureNode {
  constructor(tag, text = '') { this.tagName = tag.toUpperCase(); this.children = []; this.text = text; this.attributes = {}; }
  set textContent(text) { this.text = text; this.children = []; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }
  set innerHTML(_) { throw new Error('Prompt rendering must not parse arbitrary HTML'); }
  appendChild(child) {
    if (this.tagName === 'SELECT' && !this.children.length) this.value = child.value;
    this.children.push(child); return child;
  }
  append(...children) { for (const child of children) this.appendChild(child); }
  replaceChildren() { this.children = []; }
  addEventListener(event, fn) { this['on' + event] = fn; }
  setAttribute(name, value) { this.attributes[name] = value; }
}
function withFixture(callback) {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new FixtureNode(tag), createTextNode: (text) => new FixtureNode('#text', text) };
  try { callback(new FixtureNode('div')); } finally { globalThis.document = original; }
}
const descendants = (node) => [node, ...node.children.flatMap(descendants)];

test('Texas Algebra prep chooses available practice only on request and keeps programs distinct', () => withFixture((form) => {
  const boxes = [...ALGEBRA_TOPICS.map((topic) => topic.id), 'sat-linear'].map((value) => ({ value, checked: true }));
  form.querySelectorAll = (selector) => {
    assert.equal(selector, 'input[name="topic"]');
    return boxes;
  };
  const guide = texasAlgebraGuide(form);
  const findTag = (name) => descendants(guide).find((child) => child.tagName === name);
  const picker = findTag('SELECT');
  assert.equal(picker.value, '2026-27-staar-eoc');
  assert.match(guide.textContent, /A\.5A/);
  assert.equal(boxes.filter((box) => box.checked).length, 5);
  findTag('BUTTON').onclick();
  const chosen = () => boxes.filter((box) => box.checked).map((box) => box.value);
  const aligned = ['algebra-linear', 'algebra-quadratics', 'algebra-exponents'];
  assert.deepEqual(chosen(), aligned);
  assert.match(guide.textContent, /3 topics selected/);
  for (const [assessment, details] of [['2026-27-staar-interim', /final school year/], ['2027-28-sst', /transition guidance/]]) {
    picker.value = assessment; picker.onchange();
    assert.match(guide.textContent, details);
    assert.equal(findTag('BUTTON'), undefined);
    assert.ok(descendants(guide).filter((child) => child.tagName === 'A').every((link) => new URL(link.href).hostname === 'tea.texas.gov'));
    assert.deepEqual(chosen(), aligned);
  }
}));

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
