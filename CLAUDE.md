# CLAUDE.md — Students4AI (formerly Calc Coach)

Read this before changing anything. It is short on purpose.

## What this is

An interactive learning lab with AP Calculus BC as the primary course,
an AB course view for other learners, adaptive practice, and Canvas pacing.
Melody's September 14, 2026 direction explicitly replaces the former
motion-free, locked-unit design: make it animated and interactive, adapt as
students improve, and keep every module open. The intended future domain is
students4ai.com; that does not authorize buying or connecting a domain.

## Non-negotiable design invariants

Breaking any of these is a regression even if the code works:

1. **Predictability.** One fixed layout; navigation never moves; every view
   shows "You are here". All rules are stated completely *before* an activity
   starts (question counts, pass marks, what happens after each answer).
   Questions never auto-advance. Animation controls remain visible.
2. **Learner-controlled motion.** Meaningful graphs and simulations may
   autoplay in full-motion mode. Provide Pause, Reset, and speed controls,
   honor reduced-motion preferences, and stop animation in hidden tabs or
   detached views. No sound, flashing, or forced countdown timers.
3. **Literal language.** No idioms, no sarcasm, no rhetorical questions, no
   exclamation marks in teaching text, no emoji. Wrong answers are "Not yet."
   in calm amber (never red) with the specific misconception and the full
   worked solution. Phrasing is "this choice comes from ..." — never "you
   forgot".
4. **Open exploration.** All modules and complete mastery banks are open
   from the start. Review and Canvas suggest a next step, never block.
   Answers update skill estimates; completed lessons and passed checks remain.
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
| Fixed Astra-to-Sol OpenAI coaching requests, fallback, and timeouts | `ai-coach.js` |
| Zero-dep Postgres wire client + key→JSON store (tested) | `store.js` |
| Adaptive/mastery logic (pure, tested) | `public/engine.js` |
| Canvas LMS normalization + plan/grades rules (pure, tested) | `public/canvas-insights.js` |
| SPA: routing, views, persistence | `public/app.js` |
| Interactive canvas explorers | `public/viz.js` |
| Animated coding lab with learner-controlled motion | `public/study-lab.js` |
| Optional native WebGL vector lab with 2D fallback | `public/spatial-lab.js` |
| Study session planner with optional elapsed clock | `public/focus-planner.js` |
| BC/AB content and Canvas subject selection (pure, tested) | `public/courses.js` |
| Responsive, themeable design system | `public/styles.css` |
| Curriculum data | `content/unit-NN.json`, `content/manifest.json` |
| Independent AP-style mastery bank and self-checked FRQs | `content/mastery-bank.json` |
| Content authoring contract | `content/schema.md` |
| Content validator | `scripts/validate-content.mjs` |
| KaTeX render check for all curriculum math | `scripts/check-math.mjs` |
| Authoring QA: blind dumps, answer key, language lint | `scripts/qa-tools.mjs` |
| Language lint for the app's own strings (app.js, viz.js, canvas-insights.js) | `scripts/lint-ui.mjs` |
| Engine tests | `test/engine.test.mjs` |
| BC/AB content scope and course-selection tests | `test/courses.test.mjs` |
| Canvas insights tests | `test/canvas-insights.test.mjs` |
| Store tests (URL parsing, SCRAM vector) | `test/store.test.mjs` |
| Tutor phase, stored-key grounding, and grading boundary tests | `test/tutor.test.mjs` |
| Coach model order, refusal, timeout, and safe-failure tests | `test/ai-coach.test.mjs` |
| Session timing, lifecycle, and saved-field tests | `test/focus-planner.test.mjs` |
| Canvas per-learner connection and cache isolation tests | `test/canvas-profiles.test.mjs` |

## Engine invariants (pinned by tests — change tests and README together)

- Mastery per skill 0–100 via EWMA, α = 0.3; credit 1 clean-correct, 0.5
  correct-with-hints, 0 wrong. Threshold 80 (≈5 clean answers from zero).
- Score capped at 70 until a recent correct answer at difficulty ≥ 2
  (placement seeding exempt).
- Difficulty ladder 1–3 per skill: clean correct up; wrong or 2+ hints down.
- Mastery Check: 8 questions from a separate bank, difficulty ≥ 2,
  round-robin across core skills, 7 correct without help for an independent
  pass. Coach help remains available. A received pre-answer explanation
  marks the attempt assisted; save its raw score in `masteryChecks`, but do
  not create or replace an independent `unitsPassed` record or seed skills.
  Preserve any earlier pass. Retakes prefer unseen and oldest-seen questions
  but can repeat when the finite bank is exhausted.
- Free responses use transparent self-check rubrics, never automatic credit
  or an invented AP exam score. New math requires independent blind solving.
- Keep the Astra coach panel visible at the bottom of every question,
  including practice, lesson checkpoints, mastery, placement, and written
  response. Received pre-answer guidance counts as a hint; merely opening
  the coach does not. Completed mastery checks also offer per-question
  review. The server derives correctness from the stored key, never an AI
  judgment or a client-supplied correctness flag.
- The study-session planner is an optional tool using existing coursework
  and practice resources. Its time targets are advisory. No automatic
  submission, forced navigation, or time-based mastery credit. Pause and
  finish remain explicit.
- Placement requires 2 clean correct answers per unit, from up to 3
  questions. Answers received with coach help do not count toward placement.
  Placement seeds passed units' core skills at EWMA 0.85 and never lowers
  anything.

## AI coaching configuration

Melody chose a fixed OpenAI model order: **GPT-6 Astra** (`gpt-6-astra`)
first, then **GPT-5.6 Sol** (`gpt-5.6-sol`) only as fallback. Both the math
coach and optional Canvas assessment use `ai-coach.js` through Node's
built-in `fetch`; no SDK or dependency is needed.

- `OPENAI_API_KEY` in Replit Secrets is the only AI credential read.
  Existing Anthropic, Gemini/Google, `TUTOR_PROVIDERS`, and `TUTOR_MODEL_*`
  secrets may remain, but the current coaching code ignores them. Do not
  silently restore the former provider chain or environment model overrides.
- Each model request uses `reasoning_effort: 'high'`,
  `max_completion_tokens: 16000`, and its own 120-second timeout covering
  response headers and body. This is a completion budget, not a promise of
  16,000 visible answer tokens.
- A service failure, timeout, or empty/unusable answer can try Sol once.
  A refusal is final; HTTP 401 is final because both models use the same key.
  Nonempty truncated replies retain a visible incomplete-answer notice.
- The tutor status API reports the configured models, and reply metadata
  lets the UI identify the model that actually answered. Without the key,
  the coach panel remains visible with an unavailable notice and directs
  the learner to built-in hints and worked solutions.
- Pre-answer prompts request a concept or next step without revealing the
  final answer. Prompts guide model behavior; they are not a guarantee.
  The verified answer key and transparent written-response self-check
  rubrics remain the grading boundary.

## Page coach and Canvas evidence

- Every screen has a persistent bottom coach (`public/page-coach.js`). It
  uses the same Astra-to-Sol transport. During an active question it uses the
  canonical question handler and assistance callback; there is no second grader.
- The page coach reconstructs learner/course/term context on the server in
  `study-coach-context.js`, adapting Vecto's typed-source and ownership pattern.
  Current family workspaces remain unauthenticated; never describe UUIDs as
  account authentication or allow arbitrary table/SQL/URL lookups.
- Canvas detail reads use `canvas-retrieval.js`: typed, course-scoped GETs for
  assignments, pages, quizzes, discussions, and file metadata. At most four
  detail reads per request. Source status, read time, update time, failures,
  shortened content and pagination caps must stay visible.
- Course home pages can remain readable when the page index fails; retrieve
  them independently. Instructor links stay visible. `linked-documents.js`
  reads only observed, publicly shared Google document text with no app
  credentials and restricted redirects; it shares the four-detail budget.
  Login-required documents and unsupported files remain explicitly unread.
- Retain instructions, rubric and effective-date evidence separately. Explicit
  `due_at: null`, omitted fields, invalid fields and dates in teacher prose
  have different meanings. Never guess an official deadline from another
  section's `all_dates` or a model response. Undated work belongs in the plan,
  Home's school suggestion and the study-session picker.
- Successful source-location hints append to `cv-rule-<profile>` in the existing
  store and its ignored file mirror. Preserve all old entries and versions,
  including entries for a prior Canvas connection. Only use entries matching
  the active Canvas identity and re-established course references. No model
  text can remove, replace or execute an existing rule. At 1000 entries, stop
  adding rather than trimming history.
- Conversation lives only in the browser tab's memory and clears when the
  learner, subject, course, terms, instruction target or active question changes.
  Late results must never appear under a newer scope. Source material is
  untrusted data; never render it or model replies as executable HTML.

## Commands

```bash
node server.js       # run (PORT env respected; Replit's .replit does this)
npm test             # engine, course, Canvas, coach, tutor, planner, and store tests
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
- Canvas is read-only; it may recommend pacing from deadlines and assignment
  topic words, but must never set mastery or restrict exploration. The access token lives in a server
  memory session and, when the learner chooses Remember, in
  learner-scoped files under `data/` (gitignored) and the Postgres
  `calc_coach_store` table — never in `S`, localStorage, progress exports,
  logs, or any response body. Canvas data never touches
  engine scoring or unlocks. The AI assessment receives Canvas data only,
  never the token; the math tutor receives neither. Canvas is authoritative
  for grades — never recompute them. Problem-area thresholds are the named
  exports in `public/canvas-insights.js`; change tests and README together.
- Scope every Canvas request, cookie, credential record, preference record,
  and cached snapshot to its learner. Preserve the original learner's legacy
  files/database keys. Clear browser Canvas state on a learner switch and
  reject late responses. Workspaces are not authenticated private accounts;
  do not present them as public multi-user account security.
- Branch, PR to `main`, merge when CI is green.
