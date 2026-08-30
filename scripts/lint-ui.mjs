#!/usr/bin/env node
// Language lint for the app's own learner-facing strings (public/app.js and
// public/viz.js), applying CLAUDE.md invariant 3 to code, not just content:
// no exclamation marks, no shaming phrases, no idioms, no emoji, no
// rhetorical questions in text the learner reads.
//
// It tokenizes every string literal and template literal in the source
// (expressions inside ${...} are skipped), strips HTML tags and math, and
// checks the remaining prose. A string that must legitimately contain a
// flagged character can be preceded on its own line by
//   // lint-ui: allow
// Usage: node scripts/lint-ui.mjs [file ...]   (default: public/app.js public/viz.js)
// Exit 1 on errors; warnings are informational.

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['public/app.js', 'public/viz.js'];

const shaming = /\b(you forgot|you made|you missed|you failed|you neglected|you should have|your mistake|careless|wrong again|try harder)\b/i;
const idioms = /\b(plug and chug|piece of cake|no-brainer|nail(ed|s)? (it|down)|in a nutshell|rule of thumb|at the end of the day|long story short|hang in there|slam dunk|by luck|where you left off|keeps? .{0,20} honest|hugs?|pokes?|tell the same story|blows? up|the trick|boils down|heads up|bottom line|on the fly|dive in|hit the ground|kick off|wrap your head|under the hood)\b/i;
const emoji = /\p{Extended_Pictographic}/u;
const minimizers = /\b(simply|obviously|of course|clearly|just click|easy|trivial(ly)?)\b/i;

// Extract string and template literals with their line numbers. A small
// state machine is enough for this codebase: it skips comments and regex-free
// code, and handles ${...} nesting inside templates.
function literals(src) {
  const out = [];
  let i = 0, line = 1;
  const n = src.length;
  const allowLines = new Set();
  src.split('\n').forEach((l, idx) => { if (/^\s*\/\/\s*lint-ui:\s*allow\s*$/.test(l)) allowLines.add(idx + 2); });
  function readTemplate(startLine) {
    // i is just past the opening backtick
    let text = '', depth = 0;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { text += src[i + 1] === 'n' ? ' ' : src[i + 1] ?? ''; i += 2; continue; }
      if (c === '\n') line += 1;
      if (c === '`') { i += 1; return text; }
      if (c === '$' && src[i + 1] === '{') {
        i += 2; depth = 1;
        while (i < n && depth > 0) {
          const d = src[i];
          if (d === '\n') line += 1;
          if (d === '{') depth += 1;
          else if (d === '}') depth -= 1;
          else if (d === '`') { const s = line; i += 1; out.push({ line: s, text: readTemplate(s), allowed: allowLines.has(s) }); continue; }
          else if (d === '\'' || d === '"') { const s = line; i += 1; out.push({ line: s, text: readQuoted(d), allowed: allowLines.has(s) }); continue; }
          i += 1;
        }
        text += ' X ';
        continue;
      }
      text += c; i += 1;
    }
    return text;
  }
  function readQuoted(q) {
    let text = '';
    while (i < n) {
      const c = src[i];
      if (c === '\\') { text += src[i + 1] ?? ''; i += 2; continue; }
      if (c === q) { i += 1; return text; }
      if (c === '\n') return text;
      text += c; i += 1;
    }
    return text;
  }
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line += 1; i += 1; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && src[i + 1] === '*') { while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line += 1; i += 1; } i += 2; continue; }
    if (c === '`') { const start = line; i += 1; out.push({ line: start, text: readTemplate(start), allowed: allowLines.has(start) }); continue; }
    if (c === '\'' || c === '"') { const start = line; i += 1; out.push({ line: start, text: readQuoted(c), allowed: allowLines.has(start) }); continue; }
    i += 1;
  }
  return out;
}

const stripMath = (s) => s.replace(/\$\$[\s\S]+?\$\$/g, ' ').replace(/\$[^$]+?\$/g, ' ');
const stripTags = (s) => s.replace(/<[^>]*>/g, ' ');

const errors = [], warnings = [];
for (const f of files) {
  const path = join(ROOT, f);
  const src = readFileSync(path, 'utf8');
  const rel = relative(ROOT, path);
  for (const lit of literals(src)) {
    if (lit.allowed) continue;
    const plain = stripTags(stripMath(lit.text)).replace(/\s+/g, ' ').trim();
    // Only prose is judged: skip selectors, ids, class lists, and code-like fragments.
    if (!/[a-zA-Z]{3,}\s+[a-zA-Z]{2,}/.test(plain)) continue;
    const where = `${rel}:${lit.line}`;
    const snippet = plain.length > 90 ? `${plain.slice(0, 90)}…` : plain;
    if (/!/.test(plain)) errors.push(`${where}: exclamation mark: "${snippet}"`);
    if (shaming.test(plain)) errors.push(`${where}: shaming phrase "${plain.match(shaming)[0]}": "${snippet}"`);
    if (idioms.test(plain)) errors.push(`${where}: idiom or figure of speech "${plain.match(idioms)[0]}": "${snippet}"`);
    if (emoji.test(lit.text)) errors.push(`${where}: emoji: "${snippet}"`);
    if (minimizers.test(plain)) warnings.push(`${where}: minimizer "${plain.match(minimizers)[0]}": "${snippet}"`);
    if (/\?/.test(plain) && !/(placeholder|aria-label)/i.test(lit.text)) warnings.push(`${where}: question mark (rhetorical questions are not allowed in app text): "${snippet}"`);
  }
}

for (const e of errors) console.log(`ERROR ${e}`);
for (const w of warnings) console.log(`WARN  ${w}`);
console.log(`${errors.length} error(s), ${warnings.length} warning(s) in ${files.join(', ')}.`);
process.exit(errors.length ? 1 : 0);
