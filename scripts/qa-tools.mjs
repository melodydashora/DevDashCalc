#!/usr/bin/env node
// Authoring QA helpers. Each subcommand prints to stdout.
//
//   node scripts/qa-tools.mjs blind unit-06 [from] [to]
//       Prints questions from..to (0-based, to exclusive) WITHOUT answers,
//       solutions, hints, or misconception notes — for an independent solver
//       who must re-derive every answer from scratch.
//   node scripts/qa-tools.mjs key unit-06
//       Prints the answer key: id, type, answer (choice index or number).
//   node scripts/qa-tools.mjs lint unit-06
//       Language and structure lint for the CLAUDE.md invariants that the
//       schema validator does not cover. Exit 1 on errors; warnings are
//       informational.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, unitId, ...rest] = process.argv.slice(2);
if (!cmd || !unitId) { console.error('usage: qa-tools.mjs <blind|key|lint> unit-NN [args]'); process.exit(2); }
const u = JSON.parse(readFileSync(join(ROOT, 'content', `${unitId}.json`), 'utf8'));

if (cmd === 'blind') {
  // blind unit-NN [from] [to]   or   blind unit-NN --ids u6-q003,u6-q010
  let picked;
  if (rest[0] === '--ids') { const ids = new Set((rest[1] || '').split(',')); picked = u.questions.filter((q) => ids.has(q.id)); }
  else { const from = Number(rest[0] ?? 0), to = Number(rest[1] ?? u.questions.length); picked = u.questions.slice(from, to); }
  for (const q of picked) {
    const out = { id: q.id, type: q.type, difficulty: q.difficulty, prompt: q.prompt };
    if (q.type === 'mc') out.choices = q.choices;
    else out.tolerance = q.tolerance ?? 0.001;
    console.log(JSON.stringify(out));
  }
} else if (cmd === 'key') {
  for (const q of u.questions) console.log(JSON.stringify({ id: q.id, type: q.type, answer: q.type === 'mc' ? q.answerIndex : q.answer }));
} else if (cmd === 'lint') {
  const errors = [], warnings = [];
  const stripMath = (s) => s.replace(/\$\$[\s\S]+?\$\$/g, ' ').replace(/\$[^$]+?\$/g, ' ');
  const stripTags = (s) => s.replace(/<[^>]+>/g, ' ');
  const shaming = /\b(you forgot|you made|you missed|you failed|you neglected|you should have|your mistake|careless)\b/i;
  const idioms = /\b(plug and chug|piece of cake|no-brainer|nail(ed)? it|in a nutshell|rule of thumb|at the end of the day|long story short|hang in there|slam dunk|nutshell)\b/i;
  const emoji = /\p{Extended_Pictographic}/u;
  const check = (s, where, { allowQuestion = false } = {}) => {
    if (typeof s !== 'string') return;
    const plain = stripTags(stripMath(s));
    if (/!/.test(plain)) errors.push(`${where}: exclamation mark in prose: "${plain.match(/[^.]*![^.]*/)[0].trim().slice(0, 80)}"`);
    if (shaming.test(plain)) errors.push(`${where}: shaming phrase "${plain.match(shaming)[0]}" — say what the choice comes from instead`);
    if (idioms.test(plain)) errors.push(`${where}: idiom "${plain.match(idioms)[0]}"`);
    if (emoji.test(s)) errors.push(`${where}: contains an emoji`);
    if (!allowQuestion && /\?/.test(plain)) warnings.push(`${where}: contains a question mark (rhetorical questions are not allowed in teaching text)`);
  };
  check(u.overview, 'overview');
  for (const l of u.lessons) {
    l.sections.forEach((sec, i) => {
      const w = `lesson ${l.id} section ${i}`;
      if (sec.type === 'worked-example') sec.steps.forEach((st, j) => check(st.text, `${w} step ${j}`));
      else if (sec.type !== 'checkpoint') check(sec.html, `${w} ${sec.type}`);
    });
  }
  for (const q of u.questions) {
    const w = `question ${q.id}`;
    check(q.prompt, `${w} prompt`, { allowQuestion: true });
    (q.hints || []).forEach((h, i) => check(h, `${w} hint ${i}`, { allowQuestion: true }));
    (q.misconceptions || []).forEach((m, i) => check(m, `${w} misconception ${i}`));
    (q.solution || []).forEach((st, i) => check(st.text, `${w} solution step ${i}`));
    if (q.type === 'mc') {
      const correct = q.choices[q.answerIndex];
      const norm = (s) => s.replace(/\s+/g, '').toLowerCase();
      for (const [i, h] of q.hints.entries()) {
        if (norm(correct).length >= 4 && norm(h).includes(norm(correct))) warnings.push(`${w} hint ${i}: contains the correct choice text verbatim`);
      }
      const seen = new Set();
      for (const c of q.choices) { if (seen.has(norm(c))) errors.push(`${w}: duplicate choice "${c}"`); seen.add(norm(c)); }
    }
  }
  for (const e of errors) console.log(`ERROR [${unitId}] ${e}`);
  for (const w of warnings) console.log(`WARN  [${unitId}] ${w}`);
  console.log(`${errors.length} error(s), ${warnings.length} warning(s).`);
  process.exit(errors.length ? 1 : 0);
} else { console.error(`unknown command ${cmd}`); process.exit(2); }
