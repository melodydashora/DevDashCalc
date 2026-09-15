import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeCoachHref, coachContextLabel, coachConversationScope, coachSourceDetail, parseCoachMarkdown, appendReply } from '../public/page-coach.js';

test('coach links allow known study destinations without accepting arbitrary hash commands', () => {
  for (const href of ['#/home', '#/focus', '#/review', '#/settings', '#/diagnostic', '#/canvas', '#/canvas/plan', '#/canvas/grades', '#/canvas/assessment', '#/canvas/course/123', '#/unit/unit-09', '#/practice/unit-09', '#/mastery/unit-09', '#/lesson/unit-09/u9-l1']) {
    assert.equal(safeCoachHref(href), href);
  }
  for (const href of ['#/settings/erase', '#/unknown', '#/unit/a/../../settings', '#/lesson/unit-09', '#/canvas/course/not-a-course', '#/focus?execute=1', '#/practice/unit-09#anything']) {
    assert.equal(safeCoachHref(href), null, href);
  }
});

test('external coach links require HTTPS and reject credentials, script URLs, and relative URLs', () => {
  assert.equal(safeCoachHref('https://school.example/courses/42?module_item_id=123'), 'https://school.example/courses/42?module_item_id=123');
  for (const href of ['javascript:alert(1)', 'data:text/html,x', 'file:///C:/secret', '//evil.example', 'https://user:pass@example.com', 'http://example.com', '/api/coach', ' https://example.com', 'https://example.com ', '']) {
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
  assert.notEqual(coachConversationScope(context), coachConversationScope(question), 'page advice is not sent as prior help on a fresh question');
  assert.notEqual(coachConversationScope(question), coachConversationScope({ ...question, questionId: 'q2' }));
  assert.notEqual(coachConversationScope(question), coachConversationScope({ ...question, unitId: 'unit-10' }));
  assert.notEqual(coachConversationScope(question), coachConversationScope({ ...question, phase: 'after-answer' }));
});

test('specific source targets and school terms cannot reuse another lookup conversation', () => {
  const base = { subject: 'calculus-bc', selectedCourseId: '11', termIds: ['1', '2'] };
  assert.equal(coachConversationScope(base), coachConversationScope({ ...base, termIds: [2, 1, 1] }), 'term order and numeric representation do not change scope');
  for (const field of ['itemId', 'assignmentId', 'moduleItemId']) {
    assert.notEqual(coachConversationScope({ ...base, [field]: '100' }), coachConversationScope({ ...base, [field]: '101' }), field);
  }
  assert.notEqual(coachConversationScope(base), coachConversationScope({ ...base, termIds: ['3'] }));
  assert.notEqual(coachConversationScope(base), coachConversationScope({ ...base, termIds: [] }));
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

test('reply DOM uses semantic nodes and keeps HTML and links inert', () => {
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
