// Run the same language checks on Windows and Replit without a shell loop.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const runs = [['scripts/lint-ui.mjs', 'public/app.js', 'public/auth-ui.js', 'public/canvas-account.js', 'public/continuity-ui.js', 'public/viz.js', 'public/study-lab.js', 'public/spatial-lab.js', 'public/focus-planner.js', 'public/page-coach.js', 'public/mixed-study.js', 'public/study-plans.js', 'public/practice-insights.js', 'public/practice-builder.js', 'public/evidence-mystery.js', 'public/question-models.js', 'public/canvas-insights.js']];
for (const file of readdirSync('content').filter((f) => /^unit-\d+\.json$/.test(f))) runs.push(['scripts/qa-tools.mjs', 'lint', file.replace('.json', '')]);
for (const args of runs) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
