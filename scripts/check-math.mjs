#!/usr/bin/env node
// Renders every LaTeX segment in the curriculum with the vendored KaTeX and
// reports anything KaTeX cannot render. A segment that fails here would show
// the learner raw LaTeX or an error box, so this runs alongside the validator.
// Usage: node scripts/check-math.mjs [unit-01 ...]   (no args = every unit in manifest)

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'content');

// katex.min.js is a UMD bundle; evaluate it with a CommonJS-shaped scope so
// it hands us module.exports regardless of this package being type=module.
const katexSource = readFileSync(join(ROOT, 'public/vendor/katex/katex.min.js'), 'utf8');
const mod = { exports: {} };
new Function('module', 'exports', katexSource)(mod, mod.exports);
const katex = mod.exports;

const errors = [];
let currentUnit = '';

function segments(s) {
  // Split a string into math segments: $$...$$ (display) and $...$ (inline).
  const out = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;
  let m;
  while ((m = re.exec(s)) !== null) out.push({ tex: m[1] ?? m[2], display: m[1] !== undefined });
  return out;
}

function render(tex, display, where) {
  try {
    katex.renderToString(tex, { throwOnError: true, displayMode: display, strict: 'ignore' });
  } catch (e) {
    errors.push(`[${currentUnit}] ${where}: ${e.message.replace(/^KaTeX parse error: /, '')}  <<${tex}>>`);
  }
}

function checkText(s, where) {
  if (typeof s !== 'string') return;
  for (const seg of segments(s)) render(seg.tex, seg.display, where);
}

function checkSteps(steps, where) {
  (steps || []).forEach((st, i) => {
    checkText(st.text, `${where} step ${i} text`);
    if (st.math !== undefined) render(st.math, true, `${where} step ${i} math`);
  });
}

function checkUnit(meta) {
  currentUnit = meta.id;
  const path = join(CONTENT, meta.file);
  if (!existsSync(path)) return;
  const u = JSON.parse(readFileSync(path, 'utf8'));
  checkText(u.overview, 'overview');
  for (const s of u.skills || []) checkText(s.name, `skill ${s.id} name`);
  for (const l of u.lessons || []) {
    checkText(l.title, `lesson ${l.id} title`);
    (l.sections || []).forEach((sec, i) => {
      const w = `lesson ${l.id} section ${i}`;
      if (sec.type === 'worked-example') { checkText(sec.title, `${w} title`); checkSteps(sec.steps, w); }
      else if (sec.type !== 'checkpoint') checkText(sec.html, `${w} html`);
    });
  }
  for (const q of u.questions || []) {
    const w = `question ${q.id}`;
    checkText(q.prompt, `${w} prompt`);
    (q.choices || []).forEach((c, i) => checkText(c, `${w} choice ${i}`));
    (q.misconceptions || []).forEach((m, i) => checkText(m, `${w} misconception ${i}`));
    (q.hints || []).forEach((h, i) => checkText(h, `${w} hint ${i}`));
    checkSteps(q.solution, `${w} solution`);
  }
}

const manifest = JSON.parse(readFileSync(join(CONTENT, 'manifest.json'), 'utf8'));
const requested = process.argv.slice(2);
const units = requested.length ? manifest.units.filter((m) => requested.includes(m.id)) : manifest.units;
for (const meta of units) checkUnit(meta);

if (errors.length) {
  for (const e of errors) console.error(`ERROR ${e}`);
  console.error(`\n${errors.length} math rendering error(s).`);
  process.exit(1);
}
console.log(`OK — every math segment in ${units.map((u) => u.id).join(', ')} renders with KaTeX.`);
