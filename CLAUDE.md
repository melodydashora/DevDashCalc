# CLAUDE.md — Students4AI (formerly Calc Coach)

Read this before changing anything. It is short on purpose.

## What this is

An interactive learning workspace with saved course plans, Canvas pacing,
an AP Calculus BC/AB lesson and mastery library, and original adaptive
SAT, Algebra, Physics 1, and Calculus practice. Home shows actual classes
and saved plan topics; Course library holds independent curriculum resources.
Melody's September 14, 2026 direction explicitly replaces the former
motion-free, locked-unit design: make it animated and interactive, adapt as
students improve, and keep every module open. `docs/deployment.md` records the
existing Replit configuration and separates the previously recorded host from
unverified custom-domain plans. Do not infer a domain purchase or connection
from a product name.

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
| Password/session core and relational account ownership | `auth.js`, `account-store.js` |
| Explicit, append-only student continuity notes | `continuity-store.js` |
| Sign-in/enrollment UI and server-only enrollment command | `public/auth-ui.js`, `scripts/create-enrollment.mjs` |
| Environment model/provider settings and shared fallback policy | `coach-config.js`, `tutor-service.js` |
| Anthropic Messages and OpenAI text/Responses transports | `anthropic-coach.js`, `ai-coach.js`, `ai-record-coach.js` |
| Owner-bound learning-record pages | `coach-records.js` |
| Zero-dep Postgres wire client + key→JSON store (tested) | `store.js` |
| Adaptive/mastery logic (pure, tested) | `public/engine.js` |
| Canvas LMS normalization + plan/grades rules (pure, tested) | `public/canvas-insights.js` |
| SPA: routing, views, persistence | `public/app.js` |
| Interactive canvas explorers | `public/viz.js` |
| Animated coding lab with learner-controlled motion | `public/study-lab.js` |
| Optional native WebGL vector lab with 2D fallback | `public/spatial-lab.js` |
| Study session planner with optional elapsed clock | `public/focus-planner.js` |
| Saved plan drafts, explicit save, and completion UI/service | `public/study-plans.js`, `study-plans.js` |
| Canonical checked-attempt summaries and learner-facing observations | `practice-history.js`, `public/practice-insights.js` |
| Mixed topic picker, SAT/Algebra presets, questions, pause and resume | `public/mixed-study.js`, `public/mixed-study.css` |
| Computed question generators and private adaptive session service | `mixed-question-bank.js`, `mixed-sat-bank.js`, `mixed-ap-variants.js`, `mixed-practice.js`, `mixed-practice-api.js` |
| Safe given diagrams and independent interactive examples | `public/question-models.js`, `public/question-models.css` |
| Editable original-practice requests and curated model previews | `public/practice-builder.js`, `public/practice-builder.css` |
| Three optional, ungraded evidence/inference/grammar cases | `public/evidence-mystery.js`, `public/evidence-mystery.css` |
| BC/AB content scope and study-subject selection (pure, tested) | `public/courses.js` |
| Student home course timing, current terms, and refresh rules (pure, tested) | `public/student-home.js` |
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
| Coach configuration, refusal, timeout, and safe-failure tests | `test/coach-config.test.mjs`, `test/ai-coach.test.mjs`, `test/ai-record-coach.test.mjs` |
| Session timing, lifecycle, and saved-field tests | `test/focus-planner.test.mjs` |
| Canvas per-learner connection and cache isolation tests | `test/canvas-profiles.test.mjs` |
| Account cryptography, database contract, enrollment, and HTTP authorization | `test/auth.test.mjs`, `test/account-store.test.mjs`, `test/enrollment-cli.test.mjs`, `test/auth-api.test.mjs` |

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

## Student account boundary

- Replit preview/deployment must use `AUTH_REQUIRED=1`, a configured database,
  and a stable `SESSION_SECRET` of at least 32 bytes. A configuration or database
  failure must fail closed. The local default legacy mode is only for isolated
  private development; existing legacy test fixtures explicitly disable auth.
- Melody authorized direct student signup on September 15, 2026. Replit preview
  and deployment explicitly set `AUTH_ALLOW_SIGNUP=1` for new owned workspaces.
  The server-only enrollment CLI binds an existing progress workspace through a
  hashed, expiring, single-use token; a submitted UUID/name never grants it.
  Preserve legacy progress/Canvas/source-history keys and records when enrolling.
- The six relational tables are `s4ai_users`, `s4ai_workspaces`,
  `s4ai_workspace_members`, `s4ai_sessions`, `s4ai_enrollments`, and
  `s4ai_auth_limits`. Authentication and ownership never fall back to files.
- `s4ai_student_memos` separately stores explicitly saved continuity notes with
  workspace and saving-account foreign keys. Never archive conversation by
  default. Notes append with a client request UUID for safe retries; conflicting
  reuse cannot edit a record. Source metadata is allowlisted, text is bounded to
  2,000 characters, and no edit/delete API exists. The notes API pages 30 records;
  the general study coach initially reads the ten newest and discloses omitted counts.
  The authenticated coach can page through older notes and saved learning
  records using a closed read-only tool. Record lookups use the provider's
  tool transport and recheck ownership; credentials and authentication tables
  are excluded.
  Notes are untrusted context and cannot override existing rules, verified keys,
  current Canvas evidence, or the current student's instruction.
- Passwords use salted scrypt (N=131072,r=8,p=1); random session/enrollment
  tokens are stored only as HMAC hashes. Bound expensive hashes to two active
  and four queued operations. Usernames are normalized ASCII 3–32 characters;
  passwords are untrimmed 15–128 Unicode characters. Sessions last seven days,
  enrollment links 24 hours by default. Secret rotation invalidates both.
- Every protected API authenticates and rechecks workspace ownership before
  progress, Canvas, mixed practice, or coaching. Reject foreign/duplicate profile
  parameters; derive omitted profiles from ownership. Same-origin checks protect
  mutations, private responses are no-store, and HTTPS cookies are Secure,
  HttpOnly, SameSite=Lax, host-only. Signed-out requests must never resolve a
  named Canvas token. Clear the UI and suppress late results on sign-out.
- Password reset, recovery email, admin sharing screens, Canvas OAuth, and
  application-level encryption of remembered Canvas form tokens remain future
  work. Do not claim a complete public student onboarding system.

## Canvas credentials

The current family setup accepts `DEV_API_TOKEN` and `ESHA_API_TOKEN` from
Replit Secrets. These are Canvas tokens, not AI credentials. Dev defaults to
the existing `DEV_API_KEY` name only when `DEV_API_TOKEN` is absent; never
fall back to another token after a configured preferred token is rejected.
Dev's profile defaults to
the original `learner` workspace; Esha requires an explicit
`ESHA_CANVAS_PROFILE_ID` binding. Optional `DEV_CANVAS_PROFILE_ID` changes
Dev's binding. `DEV_CANVAS_URL` / `ESHA_CANVAS_URL` override the shared
`CANVAS_BASE_URL`; the current family address is `https://fisd.instructure.com`.
Never infer a secret binding from a mutable display name or accept a
browser-supplied destination for a server-held secret. Never copy named
secret values into files, database records, API replies, or logs.

The existing own-token form remains available per learner. Manual sessions
and saved credentials take precedence; manual connect and Disconnect disable
automatic secret fallback for that workspace. Explicit secret reconnect can
enable it again. Disconnect cannot remove the Replit secret itself. This
family-mode workspace selector is not authentication. Account mode independently
checks ownership before reaching these existing connection handlers.

## AI coaching configuration

Melody's September 15 direction supersedes the former fixed OpenAI-only
implementation. Provider/model values in Secrets are authoritative. The
default order is **Claude Fable 5.1 → Claude Opus 5 → GPT-6 Astra → GPT-5.6 Sol**;
Melody explicitly confirmed Sol as Astra's fallback. Gemini is disabled.
The interface's study coach remains named Astra, with actual reply model
labels identifying Fable, Opus, Astra, Sol, or another configured model.

- `coach-config.js` resolves `TUTOR_PROVIDERS` (default `anthropic,openai`),
  `TUTOR_MODEL_ANTHROPIC` (`claude-fable-5-1`),
  `TUTOR_MODEL_ANTHROPIC_FALLBACK` (`claude-opus-5`),
  `TUTOR_MODEL_OPENAI` (`gpt-6-astra`), and
  `TUTOR_MODEL_OPENAI_FALLBACK` (`gpt-5.6-sol`). Defaults apply only when
  settings are absent. Blank fallback disables it; blank primary is an error.
  Preserve exact supplied model spelling after trimming surrounding whitespace.
  Never replace an explicit setting with a hardcoded model or silently repair
  a typo. Unknown providers, including `gemini`, fail configuration clearly.
- Only `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` enable providers. Missing keys
  skip their provider with safe warnings, so an OpenAI-only deployment remains
  usable. Gemini/Google credentials do not enable another lane. Normal startup
  does not load `.env`; launch commands must not overwrite model settings.
- `tutor-service.js` controls every production coaching path. A refusal ends
  fallback across vendors. A 401 skips other models sharing that provider key
  and may continue to the next vendor. Service failures, timeouts, and empty
  responses can advance. Nonempty truncated replies retain a visible notice.
  Loss of student authorization ends the request.
- Anthropic Messages uses adaptive thinking, high `output_config.effort`, and
  a 16,000-token output budget. OpenAI text uses Chat Completions with high
  `reasoning_effort` and `max_completion_tokens: 16000`; record-aware OpenAI
  uses Responses with equivalent reasoning/output settings and `store:false`.
  Tool turns share their model-attempt output budget. These limits include
  reasoning and do not promise 16,000 visible answer tokens. Use built-in
  `fetch`; no SDK, package installation, or schema migration is required.
- `TUTOR_TIMEOUT_MS` is the per-attempt ceiling (default 120000; range
  1000–120000). `TUTOR_TOTAL_TIMEOUT_MS` bounds the full request (default
  240000; range 1000–480000). Divide remaining time among remaining fallbacks;
  with four stalled attempts the default allocation is about 60 seconds each.
  Preserve the shared eight-actual-record-read limit across model/provider
  fallback. All providers use the same owner-bound dispatcher and fresh session
  checks. Opaque thinking/tool state stays within its originating attempt.
- `getTutorStatus()` exposes safe provider/model names, availability, warnings,
  and configuration errors. Never serialize the resolver's private `attempts`
  array, API keys, raw error bodies, or an environment dump. The UI identifies
  the actual model that answered. If no provider is available, preserve built-in
  hints, solutions, lessons, and the visible unavailable coach.
- Model specifications and configured key presence do not establish model
  access, successful tool use, or comparative tutoring quality. Verify access
  with a synthetic request and evaluate teaching quality on shared examples.
  After a Secrets change, restart preview and update/republish production.
  On configuration error, correct the named setting or remove it to restore its
  default; a blank fallback disables it. Preserve student data and unrelated
  credentials. The complete settings table and recovery steps are in README.
- Pre-answer prompts request a concept or next step without revealing the
  final answer. Prompts guide model behavior; they are not a guarantee.
  The verified answer key and transparent written-response self-check
  rubrics remain the grading boundary.

## Page coach and Canvas evidence

- Every screen has a persistent bottom coach (`public/page-coach.js`). It
  uses the same configurable provider service. During an active question it uses the
  canonical question handler and assistance callback; there is no second grader.
- Tutor replies and Canvas assessments use the shared DOM link renderer in
  `public/tutor-text.js`. Named Markdown references and plain web addresses
  become clickable links; preserve useful labels, line breaks, lists, and tables.
  Allow only checked HTTP/HTTPS destinations and approved in-app routes. Model
  HTML, code, and image markup remain inert; links open only when selected.
- The page coach reconstructs learner/course/term context on the server in
  `study-coach-context.js`, adapting Vecto's typed-source and ownership pattern.
  Account mode authenticates and authorizes this workspace first; local legacy
  mode remains unauthenticated. Never treat UUID knowledge as account access or
  allow arbitrary table/SQL/URL lookups.
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

## Plans, generated practice, and models (September 17, 2026)

- Mixed practice has 32 topics: 8 Physics, 12 Calculus BC, 8 SAT, 4 Algebra.
  Course presets preserve scope; a learner may explicitly select other topics.
  The finite bank contains 60 AP base families plus 6 alternate forms, 24
  SAT Math and 24 Algebra level/form combinations, and 32 distinct Reading
  and Writing passages (16/8/8 across three locally authored levels).
  See `docs/generated-practice-implementation.md` and `docs/exam-practice-scope.md`.
- Verified generator families supply computed keys on the server. Do not serve
  the bank, numeric answers, parameters, or unseen hints to the browser.
  AI explains a canonical stored generated question and never grades it.
- Wrong answers get one same-concept variation before fair topic/subject
  rotation. Two clean correct answers raise the general topic level.
  A focused family retains its actual authored difficulty when necessary;
  never relabel it to claim a simpler reasoning level.
- Known canceled, unavailable, refused, and failed coach requests do not
  count as help. Received pre-answer help does, including a late reply;
  re-derive evidence after late assistance without deleting the attempt.
- New practice evidence does not alter prior curriculum mastery or Canvas.
  Sessions are profile-scoped server memory, expire after six hours, and
  hold at most 200 questions. Account mode adds the server ownership boundary;
  the standalone profile selector in legacy mode does not authenticate a user.
- Checked-attempt history is separate and durable. Only canonical server
  answers and assistance revisions may append it; never accept client
  correctness/help flags. Deduplicate attempts and preserve later assistance.
  A failed save must preserve grading, disclose the failure, and support an
  idempotent retry. Never turn an unreadable history into an empty result.
- Saved plans require explicit learner save. Validate model drafts as data,
  preserve the selected course and goal, and accept only allowed internal links.
  Plan/attempt records use their own append-only database keys, not whole-state
  progress replacement. Account mode requires database storage; private local
  mode can use atomic files. Coach record tools remain owner-bound and read-only.
- Every Resume/remount reconciles canonical server state. An idempotent
  request must preserve disclosed hints, submitted answers, and assistance.
  Topic changes preserve the current question and apply to the next one.
- Avoid previously seen prompt variants with bounded sampling; disclose
  repeats when finite families are exhausted. Wording-only reviews keep the
  same givens/key and never alter independent credit, streaks, or level.
  A different challenge seeks a supported form; it cannot promise unlimited
  distinct reasoning. Practice observations and review intervals are not
  official scores, a diagnosis, or a guarantee of readiness.
- `question-models.js` accepts only allowlisted givens. Independent examples
  must be labeled and must not reconstruct hidden parameters. Before grading,
  opening an example/strategy counts as help; mixed practice requires successful
  server assistance marking before opening. Supplied-givens diagrams are part
  of the question. Preserve text alternatives, keyboard controls, motion
  preferences, and cleanup on rerender/navigation.
- Build with Astra fills an editable coach prompt; it does not auto-send,
  execute generated scripts, or insert unverified questions into a graded bank.
  Evidence mysteries are optional local puzzles with public keys, no score or
  mastery credit, and no persisted progress. Correct checks unlock only the
  next stage in that case; all other activities remain available.
- Run bank mathematical/property/render tests and independently solve a
  blind example before changing a generator's formula or key.

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
  `DATABASE_URL` is set, in the Postgres `calc_coach_store` table. A per-profile
  queue covers the complete file and awaited database save; temporary filenames
  are unique. Reject older `savedAt` records without overwriting either copy;
  equal timestamps use the last complete request. Reads choose the newer
  file/database timestamp and prefer the file on ties, preserving a later local
  save when its database write failed. Missing/invalid timestamps compare as
  zero. Database failure still preserves the file and is reported in the save
  response. These whole-state, client-timestamp rules apply within one server
  process; they do not merge simultaneous edits, correct clock skew or provide
  distributed concurrency control. Never commit progress or reset either copy
  without explicit permission from Melody.
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
  reject late responses. In account mode, enforce the database ownership check
  before every protected API; never restore the legacy selector as an auth
  fallback. Keep limitations in docs/student-accounts-plan.md explicit.
- Branch, PR to `main`, merge when CI is green.
