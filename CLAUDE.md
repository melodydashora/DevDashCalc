# CLAUDE.md — students4ai

Read this before changing anything. It is short on purpose.

## What this is

An adaptive AP Calculus BC tutor (formerly "Calc Coach"; renamed to
**students4ai** at Dev's direction, 2026-09) built for **one specific
learner: an autistic professional software developer**. Every design decision
below exists for him. `README.md` has the full rationale; this file is the
contract.

Per Dev's direction (relayed by Melody, 2026-09): **every unit is open** —
mastery is measured and certified, never used to lock content. Internal
identifiers (`calc-coach-progress` localStorage key, `calc_coach_store`
Postgres table, `data/progress-*.json`) keep their old names so existing
saved progress keeps loading; only learner-facing naming changed.

## Non-negotiable design invariants

Breaking any of these is a regression even if the code works:

1. **Predictability.** One fixed layout; navigation never moves; every view
   shows "You are here". All rules are stated completely *before* an activity
   starts (question counts, pass marks, what happens after each answer).
   Nothing appears without a user action, and nothing advances on a timer.
   (In the Mastery Check, "Check answer" records and shows the next question
   in one press — that is a user action, and the check's rules screen says
   it will happen. The earlier separate "Next" press read as the app doing
   nothing and caused repeated submit presses.)
2. **No sensory surprises.** No animation, no sound, no flashing, no
   countdown timers (the optional timer counts up only). Motion happens only
   when the learner drags a control.
3. **Literal language.** No idioms, no sarcasm, no rhetorical questions, no
   exclamation marks in teaching text, no emoji. Wrong answers are "Not yet."
   in calm amber (never red) with the specific misconception and the full
   worked solution. Phrasing is "this choice comes from ..." — never "you
   forgot".
4. **Progress is never taken away.** Units never re-lock. Review recommends,
   never blocks. Failing a Mastery Check changes nothing.
5. **Two-step answering.** Select or type, then an explicit "Check answer".
   A stray click must never submit.
6. **Zero dependencies.** No `npm install`, ever. Server = Node built-ins
   only (`node:http`; `store.js` speaks the Postgres wire protocol itself
   over `node:net`/`node:tls`/`node:crypto`); AI APIs via built-in `fetch`;
   KaTeX is vendored in `public/vendor/katex/`. This is what makes the app
   immune to Replit `node_modules` corruption. Do not add packages.
7. **The verified answer key is the only grader.** The AI tutor explains and
   is instructed never to contradict the key; it must never grade, and no
   generated math may enter the content files without independent
   verification.

## Architecture (all paths from repo root)

| Piece | File |
|---|---|
| Server: static + progress API + tutor proxy + Canvas proxy | `server.js` |
| Zero-dep Postgres wire client + key→JSON store (tested) | `store.js` |
| Adaptive/mastery logic (pure, tested) | `public/engine.js` |
| Canvas LMS normalization + plan/grades rules (pure, tested) | `public/canvas-insights.js` |
| SPA: routing, views, persistence | `public/app.js` |
| Interactive canvas explorers | `public/viz.js` |
| Design system (calm, themeable, motion-free) | `public/styles.css` |
| Curriculum data | `content/unit-NN.json`, `content/manifest.json` |
| Content authoring contract | `content/schema.md` |
| Content validator | `scripts/validate-content.mjs` |
| KaTeX render check for all curriculum math | `scripts/check-math.mjs` |
| Authoring QA: blind dumps, answer key, language lint | `scripts/qa-tools.mjs` |
| Language lint for the app's own strings (app.js, viz.js, canvas-insights.js) | `scripts/lint-ui.mjs` |
| Engine tests | `test/engine.test.mjs` |
| Canvas insights tests | `test/canvas-insights.test.mjs` |
| Store tests (URL parsing, SCRAM vector) | `test/store.test.mjs` |

## Engine invariants (pinned by tests — change tests and README together)

- Mastery per skill 0–100 via EWMA, α = 0.3; credit 1 clean-correct, 0.5
  correct-with-hints, 0 wrong. Threshold 80 (≈5 clean answers from zero).
- Score capped at 70 until a recent correct answer at difficulty ≥ 2
  (placement seeding exempt).
- Difficulty ladder 1–3 per skill: clean correct up; wrong or 2+ hints down.
- Every unit is open (`unitUnlocked` always true; sequential unlocking
  removed at Dev's direction). The Mastery Check certifies a unit as passed;
  it does not gate anything and can be attempted at any time.
- Mastery Check: 8 questions, difficulty ≥ 2, round-robin across core
  skills, 7 to pass, no hints, unlimited fresh retakes.
- Placement seeds passed units' core skills at EWMA 0.85 and never lowers
  anything.
- Multiple-choice options render in a fresh random order per showing (the
  stored keys skew heavily toward index 0); grading and wrong-choice counts
  key on the original index, so shuffling never touches scoring.
- Review never repeats a question within a session and serves each skill's
  least-recently-seen question across sessions (`pickReviewQuestion`).

## Commands

```bash
node server.js       # run (PORT env respected; Replit's .replit does this)
npm test             # 17 engine + 29 Canvas-insights + 6 store tests (node --test)
npm run validate     # schema-validate all units, then render every math segment with KaTeX
npm run lint         # language lint of app text and every unit (no exclamation marks, shaming, idioms, emoji)
```

Run all of them before pushing. CI (`.github/workflows/ci.yml`) runs syntax
checks, the tests, and validation, math rendering, and lint of every unit
file present.

## Working rules

- Route params from `location.hash` are untrusted: the router allowlists
  them (`^[a-z0-9-]{1,64}$`) and views re-derive ids from content objects.
  Never interpolate hash-derived strings into `innerHTML`.
- Content edits must keep `npm run validate` clean. Every multiple-choice
  distractor needs a misconception note; hints never reveal the answer;
  solutions are complete enough to follow when stuck.
- If you change a question's answer, re-derive it yourself from scratch
  first — the keys were independently verified and a "fix" that breaks a
  correct key teaches wrong math. New questions are verified by blind
  re-solving: `node scripts/qa-tools.mjs blind unit-NN` prints prompts and
  choices only, so a second solver can work without seeing the key.
- Learner progress lives in `data/progress-*.json` (gitignored) and, when
  `DATABASE_URL` is set, in the Postgres `calc_coach_store` table (reads
  prefer the database; writes go to both; database failures fall back to
  files and never block the learner). Never commit it; never reset either
  copy without explicit permission from Melody.
- Canvas is read-only and display-only: the access token lives in a server
  memory session and, when the learner chooses Remember, in
  `data/canvas-profile.json` (gitignored) and the Postgres
  `calc_coach_store` table — never in `S`, localStorage, progress exports,
  logs, or any response body. Canvas data never touches
  engine scoring or unlocks. The AI assessment receives Canvas data only,
  never the token; the math tutor receives neither. Canvas is authoritative
  for grades — never recompute them. Problem-area thresholds are the named
  exports in `public/canvas-insights.js`; change tests and README together.
- Branch, PR to `main`, merge when CI is green.
