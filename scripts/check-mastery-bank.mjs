#!/usr/bin/env node
// Validate the separately authored mastery bank and render its math without dependencies.
// --blind prints only prompts/choices for independent answer-key review.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { BC_ONLY_SKILL_IDS } from '../public/courses.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'));
const bank = read('content/mastery-bank.json');
const requested = process.argv.slice(2).filter((arg) => /^unit-\d{2}$/.test(arg));
const selected = (id) => !requested.length || requested.includes(id);
if (process.argv.includes('--blind')) {
  for (const [unitId, questions] of Object.entries(bank.units)) {
    if (!selected(unitId)) continue;
    console.log(JSON.stringify({ unitId, questions: questions.map(({ id, prompt, choices, calculatorPolicy }) => ({ id, prompt, choices, calculatorPolicy })) }));
  }
  for (const { id, unitId, title, prompt, parts } of bank.freeResponse) {
    if (selected(unitId)) console.log(JSON.stringify({ id, unitId, title, prompt, parts: parts.map(({ label, prompt }) => ({ label, prompt })) }));
  }
  process.exit(0);
}

const katexModule = { exports: {} };
new Function('module', 'exports', readFileSync(join(root, 'public/vendor/katex/katex.min.js'), 'utf8'))(katexModule, katexModule.exports);
const ids = new Set();
const practiceIds = new Set();
const practicePrompts = new Set();
const masteryPrompts = new Set();
const normalizePrompt = (prompt) => prompt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const units = new Map();
const bcSkills = new Set(BC_ONLY_SKILL_IDS);
let mathSegments = 0;
let mcCount = 0;

function checkStrings(value, path) {
  if (typeof value === 'string') {
    assert.equal((value.match(/\$/g) || []).length % 2, 0, `${path}: unmatched math delimiter`);
    assert(!/<\s*(script|iframe|img|style)\b|\bon\w+\s*=|\bstyle\s*=/i.test(value), `${path}: unsafe HTML`);
    for (const match of value.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g)) {
      katexModule.exports.renderToString(match[1] ?? match[2], { throwOnError: true, strict: 'ignore', displayMode: match[1] !== undefined });
      mathSegments++;
    }
  } else if (Array.isArray(value)) value.forEach((item, index) => checkStrings(item, `${path}[${index}]`));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'math') {
        katexModule.exports.renderToString(item, { throwOnError: true, strict: 'ignore', displayMode: true });
        mathSegments++;
      } else checkStrings(item, `${path}.${key}`);
    }
  }
}

for (let number = 1; number <= 10; number++) {
  const id = `unit-${String(number).padStart(2, '0')}`;
  const unit = read(`content/${id}.json`);
  units.set(id, unit);
  for (const question of unit.questions) {
    practiceIds.add(question.id);
    practicePrompts.add(normalizePrompt(question.prompt));
  }
}
assert.equal(bank.version, 1);
assert(typeof bank.sourceNote === 'string' && bank.sourceNote.includes('not endorsed'));
assert.equal(Object.keys(bank.units).length, 10, 'all ten BC units must have a bank');

for (const [unitId, questions] of Object.entries(bank.units)) {
  const unit = units.get(unitId);
  assert(unit, `unknown unit ${unitId}`);
  const skillIds = new Set(unit.skills.map((skill) => skill.id));
  const coreSkillIds = new Set(unit.skills.filter((skill) => skill.core).map((skill) => skill.id));
  assert(questions.length >= 8, `${unitId}: fewer than eight questions`);
  for (const question of questions) {
    const { id } = question;
    assert(!ids.has(id) && !practiceIds.has(id), `${id}: repeated or practice id`);
    ids.add(id);
    assert(new RegExp(`^u${unit.number}-m\\d{3}$`).test(id), `${id}: invalid mastery id`);
    assert(skillIds.has(question.skillId), `${id}: unknown skill`);
    assert([2, 3].includes(question.difficulty), `${id}: mastery difficulty must be 2 or 3`);
    assert.equal(question.type, 'mc');
    assert.equal(question.bank, 'mastery');
    assert.equal(question.apStyle, true);
    assert(question.conceptFamilyId && question.representation, `${id}: missing metadata`);
    assert(['not-permitted', 'required'].includes(question.calculatorPolicy), `${id}: invalid calculator policy`);
    assert.equal(question.choices.length, 4, `${id}: exactly four choices required`);
    assert.equal(new Set(question.choices).size, 4, `${id}: repeated choices`);
    assert(Number.isInteger(question.answerIndex) && question.answerIndex >= 0 && question.answerIndex < 4, `${id}: invalid key`);
    assert.equal(question.misconceptions.length, 4, `${id}: missing choice explanations`);
    question.misconceptions.forEach((note, index) => {
      if (index === question.answerIndex) assert.equal(note, null, `${id}: correct choice must have null misconception`);
      else assert(typeof note === 'string' && note.trim().length > 12, `${id}: incomplete distractor explanation`);
    });
    assert.deepEqual(question.hints, [], `${id}: mastery questions must be unassisted`);
    assert(question.solution.length >= 2, `${id}: worked solution needs at least two steps`);
    const normalized = normalizePrompt(question.prompt);
    assert(!practicePrompts.has(normalized) && !masteryPrompts.has(normalized), `${id}: duplicate prompt`);
    masteryPrompts.add(normalized);
    checkStrings(question, id);
    mcCount++;
  }
  for (const skillId of coreSkillIds) assert(questions.some((q) => q.skillId === skillId), `${unitId}: missing core skill ${skillId}`);
  const coreCount = questions.filter((q) => coreSkillIds.has(q.skillId)).length;
  assert(coreCount >= 8, `${unitId}: fewer than eight core mastery questions`);
  if (unit.number <= 8) {
    const abCount = questions.filter((q) => coreSkillIds.has(q.skillId) && !bcSkills.has(q.skillId)).length;
    assert(abCount >= 8, `${unitId}: AB filtering leaves fewer than eight core questions`);
  }
}
assert(bank.freeResponse.length >= 4, 'at least four written-response questions required');
for (const question of bank.freeResponse) {
  assert(!ids.has(question.id) && !practiceIds.has(question.id), `${question.id}: duplicate FRQ id`);
  ids.add(question.id);
  const unit = units.get(question.unitId);
  assert(unit, `${question.id}: unknown unit`);
  assert(question.skillIds.every((id) => unit.skills.some((skill) => skill.id === id)), `${question.id}: unknown skill`);
  assert.equal(question.gradingMode, 'self-check');
  assert(question.gradingNote.includes('not an automated grade'), `${question.id}: grading must be transparent`);
  assert.equal(question.points, 9);
  assert.equal(question.parts.reduce((sum, part) => sum + part.points, 0), 9, `${question.id}: part points must sum to 9`);
  for (const part of question.parts) {
    assert(part.solution.length >= 2, `${question.id}${part.label}: incomplete solution`);
    assert.equal(part.rubric.reduce((sum, row) => sum + row.points, 0), part.points, `${question.id}${part.label}: rubric mismatch`);
    assert(part.rubric.every((row) => Number.isInteger(row.points) && row.points > 0 && row.criterion), `${question.id}${part.label}: invalid rubric row`);
  }
  checkStrings(question, question.id);
}
for (const number of [6, 7, 9, 10]) assert(bank.freeResponse.some((q) => q.unitId === `unit-${String(number).padStart(2, '0')}`), `missing unit ${number} FRQ`);
console.log(`Mastery bank: ${mcCount} distinct MCQs and ${bank.freeResponse.length} self-check FRQs validated; ${mathSegments} math segments rendered; every AB unit retains at least eight core questions.`);
