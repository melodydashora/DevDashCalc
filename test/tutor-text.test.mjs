import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTutorInline, safeTutorHref } from '../public/tutor-text.js';
import { appendReply } from '../public/page-coach.js';
import { appendMixedPrompt } from '../public/mixed-study.js';

class FixtureNode {
  constructor(tag, text = '') { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.text = text; }
  set textContent(text) { this.text = text; this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set innerHTML(_) { throw new Error('Tutor text must never be parsed as HTML.'); }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes[name] = value; }
}
const descendants = node => [node, ...node.children.flatMap(descendants)];
const anchors = node => descendants(node).filter(child => child.tagName === 'A');
function withDom(callback) {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new FixtureNode(tag), createTextNode: text => new FixtureNode('#text', text) };
  try { callback(new FixtureNode('div')); } finally { globalThis.document = previous; }
}

test('named Canvas, Google Drive, and myPLTW resource links are clickable with their resource names', () => withDom(root => {
  appendTutorInline(root, 'Open [Canvas assignment](https://school.example/courses/42/assignments/7), [Google Drive instructions](https://drive.google.com/file/d/example/view?usp=sharing), or [myPLTW lesson](https://my.pltw.org/course/lesson).');
  assert.deepEqual(anchors(root).map(link => link.textContent), ['Canvas assignment', 'Google Drive instructions', 'myPLTW lesson']);
  assert.deepEqual(anchors(root).map(link => link.attributes.href), ['https://school.example/courses/42/assignments/7', 'https://drive.google.com/file/d/example/view?usp=sharing', 'https://my.pltw.org/course/lesson']);
  for (const link of anchors(root)) {
    assert.equal(link.attributes.target, '_blank');
    assert.equal(link.attributes.rel, 'noopener noreferrer');
    assert.match(link.attributes['aria-label'], /opens in a new tab/);
  }
  assert.equal(root.textContent, 'Open Canvas assignment, Google Drive instructions, or myPLTW lesson.');
}));

test('plain web URLs retain queries and balanced parentheses while sentence punctuation stays outside the link', () => withDom(root => {
  const text = 'Read (https://school.example/page_(one)). Then http://school.example/a?x=1&y=2#step, and https://school.example/last.”';
  appendTutorInline(root, text);
  assert.deepEqual(anchors(root).map(link => link.attributes.href), ['https://school.example/page_(one)', 'http://school.example/a?x=1&y=2#step', 'https://school.example/last']);
  assert.equal(root.textContent, text);
}));

test('named URLs accept balanced or escaped parentheses and angle-wrapped destinations', () => withDom(root => {
  appendTutorInline(root, '[One](https://example.com/a_(b)) [Two](https://example.com/a_\\(b\\)) [Three](<https://example.com/third>) <https://example.com/fourth>');
  assert.deepEqual(anchors(root).map(link => link.attributes.href), ['https://example.com/a_(b)', 'https://example.com/a_(b)', 'https://example.com/third', 'https://example.com/fourth']);
}));

test('only explicit web URLs and approved app routes become navigation targets', () => {
  assert.equal(safeTutorHref('https://example.com/a%20file.pdf'), 'https://example.com/a%20file.pdf');
  assert.equal(safeTutorHref('http://example.com'), 'http://example.com/');
  for (const value of ['#/home', '#/mixed', '#/settings', '#/canvas/course/42', '#/lesson/unit-01/lesson-1']) assert.equal(safeTutorHref(value), value);
  for (const value of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<svg>', 'vbscript:msgbox(1)', 'file:///C:/private.txt', 'C:\\Users\\student\\file.txt', '//evil.example', '/api/erase', '#/settings/erase', '#/home?run=1',
    'https://user:password@example.com', 'https://user@example.com', 'https:example.com', 'http:/example.com', 'https:\\example.com', 'https://example.com/\\evil', 'https://example.com/%5cevil',
    'https://exa\tmple.com', 'https://example.com/\npath', 'https://example.com/\u0000path', 'https://example.com/%0apath', 'https://example.com/%00path', 'https://example.com/\u202epath', 'https://example.com/%E2%80%AEpath', 'https://example.com/%C2%85path',
    'https://example.com/"onclick="alert(1)', ' https://example.com', 'https://example.com ', 'https://example.com/' + 'x'.repeat(2048), null, {}, 42]) {
    assert.equal(safeTutorHref(value), null, String(value));
  }
});

test('malicious Markdown destinations remain text instead of executable or partially trusted anchors', () => withDom(root => {
  const values = ['javascript:alert(1)', 'data:text/html,<svg>', 'vbscript:msgbox(1)', '//evil.example', 'file:///C:/private.txt', 'https://user:pass@example.com', 'https://example.com/%0apath', 'https://exa\tmple.com', 'https://example.com/"onclick="alert(1)'];
  appendTutorInline(root, values.map(value => `[unsafe](${value})`).join('\n'));
  assert.equal(anchors(root).length, 0);
  assert.ok(root.textContent.includes('javascript:alert(1)'));
}));

test('HTML, images, link-label markup, and inline code never create active content', () => withDom(root => {
  appendTutorInline(root, '<a href="https://evil.example">fake</a> <img src="https://evil.example/pixel" onerror="alert(1)"> ![pixel](https://evil.example/pixel) `[code](https://example.com/code)` [<img src=x onerror=alert(1)>](https://school.example/assignment)');
  const all = descendants(root);
  assert.equal(anchors(root).length, 1);
  assert.equal(anchors(root)[0].attributes.href, 'https://school.example/assignment');
  assert.equal(anchors(root)[0].textContent, '<img src=x onerror=alert(1)>');
  assert.ok(!all.some(node => ['IMG', 'SCRIPT', 'IFRAME', 'SVG', 'OBJECT'].includes(node.tagName)));
  assert.ok(all.some(node => node.tagName === 'CODE' && node.textContent === '[code](https://example.com/code)'));
}));

test('newlines, bold labels, and internal navigation survive link rendering without nested anchors', () => withDom(root => {
  appendTutorInline(root, 'First line\n**Open [the assignment](https://school.example/assignment)**\n[Study home](#/home)');
  assert.equal(descendants(root).filter(node => node.tagName === 'BR').length, 2);
  assert.ok(descendants(root).some(node => node.tagName === 'STRONG' && node.textContent === 'Open the assignment'));
  assert.deepEqual(anchors(root).map(link => link.textContent), ['the assignment', 'Study home']);
  assert.equal(anchors(root)[1].attributes.href, '#/home');
  assert.equal(anchors(root)[1].attributes.target, undefined);
  assert.ok(anchors(root).every(link => anchors(link).length === 1));
}));

test('shared reply rendering links paragraphs, lists, headings, and tables while fenced code stays code', () => withDom(root => {
  appendReply(root, '#### [Course](https://school.example/course)\nFirst line\nhttps://school.example/help\n\n- [Assignment](https://school.example/assignment)\n\n| Resource | Link |\n| --- | --- |\n| Notes | [Read notes](https://drive.google.com/file/d/example/view) |\n\n```js\nconst url = "https://example.com/code";\n```');
  assert.equal(anchors(root).length, 4);
  assert.ok(descendants(root).some(node => node.tagName === 'P'));
  assert.ok(descendants(root).some(node => node.tagName === 'LI' && anchors(node).length === 1));
  assert.ok(descendants(root).some(node => node.tagName === 'TD' && anchors(node).length === 1));
  assert.ok(descendants(root).some(node => node.tagName === 'PRE' && anchors(node).length === 0));
  assert.equal(descendants(root).filter(node => node.tagName === 'BR').length, 1);
}));

test('mixed question prompts use the same link rules while preserving authored structure and code', () => withDom(root => {
  appendMixedPrompt(root, '<p>See [class instructions](https://school.example/instructions).</p><p>Help: http://school.example/help.</p><code>https://example.com/code</code><img src="https://example.com/pixel">');
  assert.deepEqual(anchors(root).map(link => link.attributes.href), ['https://school.example/instructions', 'http://school.example/help']);
  assert.ok(descendants(root).some(node => node.tagName === 'CODE' && anchors(node).length === 0));
  assert.ok(!descendants(root).some(node => node.tagName === 'IMG'));
}));

test('oversized and malformed text remains bounded and readable', () => withDom(root => {
  appendTutorInline(root, '['.repeat(26000));
  assert.equal(root.textContent.length, 24000);
  assert.equal(anchors(root).length, 0);
}));
