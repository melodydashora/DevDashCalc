# Students4AI — interactive learning, at your pace

Students4AI covers all ten AP Calculus BC units, with a separate AP Calculus
AB view that excludes BC-only content. All modules stay open. Practice adapts
to ongoing performance, while Canvas deadlines suggest useful topics without
limiting independent learning. The future planned domain is students4ai.com.

The coding-inspired lab includes animated derivatives, vector motion, and
Taylor approximations with visible code traces, sliders, playback speed,
pause, and reset. Full, reduced, and off motion settings support individual
preferences; OS reduced-motion settings suppress autoplay. Prompt complexity
changes with mastery, and the learner can explore every available demo.

Learner workspaces keep separate progress and course preferences. In account
mode, each student signs in with a username and password; the server supplies
only the workspaces that account owns. An enrollment link can bind the original
`learner` or another existing workspace without changing its progress keys,
Canvas connection, preferences, or source history. A workspace UUID is a
selection identifier; database-backed account ownership authorizes access.

## Student accounts and deployment

Replit preview and deployment must run with `AUTH_REQUIRED=1`. Set
`DATABASE_URL` and a stable `SESSION_SECRET` of at least 32 bytes in the server
environment. Missing or failed account storage never enables anonymous access.
The bare local server retains its zero-configuration family mode; use that
unauthenticated mode only for isolated private development, never as a fallback
for a deployed account service.

Registration is invite-only by default. The server-side
`scripts/create-enrollment.mjs` command creates a private, single-use setup
link for an existing database progress workspace. The student opens the link
and chooses their own username and password. The command writes the link to
an owner-only file under ignored `data/enrollment-links/` and prints only its
path and expiry. It does not choose a student's password. Setup and actual
relational tables are documented in
[student accounts and remaining work](docs/student-accounts-plan.md).

Usernames use 3–32 letters, numbers, underscores, or hyphens and are normalized
to lowercase. Passwords contain 15–128 Unicode characters and are neither
trimmed nor truncated. The server stores salted scrypt password hashes, and
HMAC hashes of random session and enrollment tokens. Sessions expire after
seven days; enrollment links expire after 24 hours by default. HTTPS sessions
use a Secure, HttpOnly, SameSite=Lax host-only cookie. Mutating requests require
the same origin; progress, Canvas, mixed practice, and coaching require a valid
session and a fresh workspace permission check. Browser copies of workspace
lists cannot grant access. Open Replit's app preview in its own tab when the
embedded preview blocks sign-in cookies.

`AUTH_ALLOW_SIGNUP=1` is an explicit later option for a new random workspace;
it never lets a student claim an existing workspace by submitting its ID.
Password reset, recovery email, administrative account screens, and Canvas
OAuth are not implemented. Rotating `SESSION_SECRET` invalidates existing
sessions and unconsumed enrollment links; retain the key across deployments.

Students can save study notes in the persistent coach's **Coach Notes** panel,
in Settings, or by explicitly remembering a coach reply. These append to
`s4ai_student_memos`, with the owning workspace and the
account that authorized each save. There is no automatic conversation archive.
Notes are limited to 2,000 characters; retrying the same save request cannot
create a duplicate or rewrite an earlier note. The notes API returns up to 30
records per page with a count of older records. The general study coach receives
the ten newest notes and reports how many were omitted. Saved text is untrusted
context, never a new grading rule, verified answer, Canvas deadline, or command.
Earlier notes remain stored; this bounded context is not guaranteed full recall.

## Canvas connections for Dev, Esha, and other learners

Each learner can open **Canvas → Use my own Canvas token**, enter their
school's HTTPS Canvas address and personal token, and connect. Settings also
links to the selected learner's Canvas connection. The token field is masked
and is never prefilled, added to browser storage, or included in progress
exports. With Remember selected, the existing server/database storage keeps
the connection; otherwise it lasts only for the server session.

For the current family setup, Replit Secrets can supply these two tokens:

| Setting | Purpose |
| --- | --- |
| `DEV_API_TOKEN` | Dev's personal Canvas token |
| `ESHA_API_TOKEN` | Esha's personal Canvas token |
| `DEV_CANVAS_PROFILE_ID` | Dev's workspace ID; defaults to the original `learner` workspace |
| `ESHA_CANVAS_PROFILE_ID` | Esha's existing workspace ID; required, with no name-based guessing |
| `CANVAS_BASE_URL` | Shared Canvas address, currently `https://fisd.instructure.com` |
| `DEV_CANVAS_URL`, `ESHA_CANVAS_URL` | Optional per-learner address overrides if their schools differ later |

Tokens belong in Replit Secrets. Workspace IDs and school addresses are
nonsecret server configuration and can go under `[env]` in `.replit`. Restart
the workflow after changing its environment. Neither token is an OpenAI key;
`OPENAI_API_KEY` remains the separate Astra/Sol coaching credential.
Dev's existing `DEV_API_KEY` name is accepted only when `DEV_API_TOKEN` is
absent. A rejected preferred token does not silently try the older name.
The connection-source label identifies the name actually used.

Named tokens are bound to stable workspace IDs and server-configured Canvas
addresses. Changing a display name does not change the binding. A missing,
invalid, or conflicting binding cannot fall back to the other learner's
token. Server-secret values stay in the environment/session memory and are
not copied into application credential files or database rows. The UI shows
only their names, configured status, school address, and connection source.

An existing manual session or remembered connection takes precedence. A
successful manual connection disables automatic named-secret fallback for
that workspace. Disconnect removes saved application credentials and disables
automatic secret reconnection; it cannot delete Replit Secrets. The learner
can explicitly reconnect with the displayed Replit connection button.

With `AUTH_REQUIRED=1`, the account boundary runs before any Canvas credential
lookup or automatic named-secret connection. The original family mode still
exists for private local development. Remembered form credentials continue to
use the existing server-only file/database store; application-level credential
encryption or a managed credential store remains future work.
Canvas's official guidance also requires OAuth for applications used by
multiple users, so manual token entry is not the public-signup path. The
[student-account implementation record](docs/student-accounts-plan.md) separates
the implemented ownership boundary from encrypted credential storage and
institution OAuth setup that remain planned.

## Study-session planning

The optional **Study session** page supports planning with the learner's
existing Canvas coursework and practice resources. It turns available time
into one concrete next step:
choose a 10-, 20-, or 30-minute plan (or enter 5–60 minutes), select a Canvas
task, practice, or a small personal goal, then use Prepare / Work / Wrap up.
An optional elapsed clock counts up. The target is advisory; it never closes
a question, forces a break, or submits work. Sessions can be paused or finished
at any time. Only session timing, goal type, and checklist state are saved in
the browser, separately per learner; Canvas titles and personal goal text are
not stored there.
The session continues while moving between this app's pages. A quiet return
link stays visible while it runs. Switching learners or closing/reloading the
page pauses it, so another student's time never enters the session.

## Mixed Physics and Calculus BC practice

Open **Mixed practice** in the main navigation, or **Open mixed practice** on
Home. Choose any combination of the 20 topic groups, a starting level, and
5, 10, or 15 questions (or continue until you finish). These topic choices
are separate from the main Studying menu. One session can include both subjects.

The server generates numerical variations from 60 original, checked question
families. They represent all eight AP Physics 1 units and all ten Calculus BC
units, including BC-specific integration, differential equations, parametric
and polar curves, series, and Taylor error bounds. This is representative
multiple-choice practice, not every course subtopic, a complete AP exam,
laboratory assessment, or an AP Physics 2/C course. The full lesson and
independent mastery-check curriculum remains Calculus AB/BC.

Select a choice, then **Check answer**. The computed server key grades it;
the AI coach explains the current question without deciding correctness.
A wrong answer produces a new variation of the same concept with the
specific distractor explanation. After one focused follow-up, the session
rotates to other selected topics and the other subject when available.
Two independent correct answers raise a topic's level; wrong answers lower
its general target level. A focused follow-up may retain its actual concept
level, and the interface explains that choice. Hints and received pre-answer
Astra/Sol help are recorded separately and do not increase independent credit.

Pause, resume, change topics, and finish are explicit controls. Topic changes
apply after the current question so selected work is preserved. Reloading
restores the server's question, feedback, and already-revealed hints in a
paused state. The browser stores only the session ID, preferences, and draft
choice per workspace. Sessions and adaptation live in server memory for up
to six hours and end when that server restarts; they do not change existing
curriculum mastery, Canvas grades, or saved learner progress. There are at
most 200 questions per session. Numerical families are finite: the generator
tries to avoid seen prompts and explicitly discloses a repeat if fresh
samples are exhausted.

The bank is independently checked using conservation equations, numerical
derivatives and integrals, 6,000 seeded variants, and KaTeX rendering. Each
of the 60 families also has an independently solved blind sample. No new
package, AI generation call, or Canvas connection is needed to practise.
The optional explanation coach uses the existing Astra-to-Sol configuration.

## Running it

Zero dependencies. Node 18+.

```bash
node server.js          # serves on $PORT or 3000
```

**On Replit:** the included `.replit` already runs `node server.js` — import the repo and press Run. The server binds `0.0.0.0` and reads
`PORT` from the environment, which is exactly what Replit's webview expects.
There is no `npm install` step, so a corrupted `node_modules` can never take
this app down.

Tests and content validation:

```bash
npm test                # engine, course, Canvas, coach, tutor, planner, and store tests
npm run validate        # schema-validates every unit, then renders every math
                        # segment with the vendored KaTeX to catch broken LaTeX
npm run lint            # language lint of the app's own text and of every unit:
                        # no exclamation marks, no shaming phrases, no idioms,
                        # no emoji in anything a learner reads
```

## How the learning model works (the exact rules)

Everything below is deterministic and visible to the learner in-app (Settings →
"How this app decides things"). No hidden scoring.

- **Skills.** Each unit has 4–8 skills. Every question is tagged with one skill
  and a difficulty 1–3.
- **Mastery score (0–100 per skill).** Each answer updates an exponential
  moving average: `new = 0.3 × credit + 0.7 × old`, where credit is 1 for
  correct with no hints, 0.5 for correct with hints, 0 for incorrect. Five
  clean correct answers reach mastery (80) from zero; a wrong answer drops the
  score by about a third of the way to zero — recoverable by design.
- **No mastery on easy questions alone.** Until the learner has a recent
  correct answer at difficulty ≥ 2, the displayed score is capped at 70.
- **Difficulty ladder.** Per skill, position 1–3. Clean correct → up one.
  Wrong, or correct only after 2+ hints → down one. Adaptive practice serves
  questions at the current ladder position, weakest skill first, never the
  same question twice in a row.
- **Mastery Check measures understanding.** Available immediately, with 8
  original AP-style questions from an independent bank, difficulty ≥ 2,
  round-robin across core skills, 7 correct for an independent pass, no time
  limit. Astra is available beneath every question. Receiving coach help
  before answering marks the attempt assisted: its raw score is saved, but
  it cannot earn an independent pass or seed skill mastery. An earlier pass
  remains saved. Opening the coach without receiving help is not assistance.
  No mastery item is a practice item. Retakes prefer unseen/oldest-seen items;
  a finite bank can repeat. Every module remains open regardless of the result.
- **AP-style free response.** Multipart reasoning challenges have 9-point
  self-check rubrics. Written work is saved; self-scores never inflate verified
  mastery. These are original learning activities, not official College Board
  questions, a full exam simulation, or a prediction of an AP score.
- **Placement check (optional).** Up to 3 questions per unit starting at
  Unit 1; a unit places out on 2 correct answers without coach help. Assisted
  answers remain learning attempts and do not count toward placement.
  Stops at the first unit that doesn't
  place out. Placed units count as "passed by placement", with
  their core skills seeded to 85 so review still has something to measure.
- **Spaced review.** A mastered skill untouched for 3+ days appears in Review.
  Review is explicitly recommended-not-required: falling behind on review
  never locks anything, because unpredictable regression would be punishing.
- **Recurring-error tracking.** For multiple-choice questions the app counts
  which wrong choice was picked. Each unit page has a fixed "Patterns in your
  answers" section listing any choice picked twice or more on the same
  question (with its misconception note) and any skill with several recent
  wrong answers. These counts never affect scoring; they exist so the specific
  error can be named and practiced.

## Design decisions for this learner

- **One layout, everywhere.** Header, navigation, breadcrumb, and footer never
  move or change. Every view starts with "You are here: …".
- **All rules stated up front, completely.** The Mastery Check screen lists
  exactly what will happen before it starts, including what is shown after
  each answer and what failing does (nothing).
- **A "What happens next" panel** on unit and practice-summary screens, so the
  path forward is always explicit: lessons → practice → Mastery Check → next
  unit.
- **Literal language.** No idioms, no exclamation marks in teaching text, no
  rhetorical questions. Wrong answers get "Not yet." plus the exact
  misconception behind the chosen distractor and the full worked solution —
  never shaming phrasing, never a red flash.
- **Meaningful, controllable animation.** Graphs respond to parameters and
  playback. Reduced/off motion settings remain available. Incorrect feedback
  uses amber; there is no flashing or sound.
- **No timers by default.** An optional elapsed-time counter (counts up, never
  down) can be turned on in Settings for exam pacing practice; the app itself
  never imposes time pressure.
- **Two-step answering.** Select or type, *then* press "Check answer" — a
  stray click can never submit an answer.
- **`// for coders` callouts.** Every lesson maps the concept to a precise
  programming analogy (limits ↔ loop convergence, derivatives ↔ diffs over a
  shrinking step, Riemann sums ↔ reduce/accumulate, Taylor series ↔ successive
  approximation, Euler's method ↔ explicit time-stepping), including where the
  analogy breaks.
- **Full keyboard operability**, visible focus outlines, `aria-live` result
  announcements, adjustable text size, and light/dark/system themes.

## Optional: the Astra AI coach

Set `OPENAI_API_KEY` in Replit Secrets to connect the coach. The Astra panel
stays visible at the bottom of every question: practice, lesson checkpoints,
mastery checks, placement, and all written-response challenges. It offers
concept, first-step, and coding-example help before an answer, plus worked
reasoning after an answer. Completed mastery checks include a coach for each
question in the results review. Written-response help never awards an
automatic grade.

Receiving coach guidance before answering counts as a hint. Merely opening
the panel or receiving an unavailable/error message does not. An assisted
mastery check saves its raw result but cannot grant an independent pass;
prior passes remain saved. Placement requires two clean correct answers per
unit, so assisted answers do not place a unit.

The pre-answer prompt asks for a concept or next step without disclosing the
final answer. These instructions guide the model; they do not guarantee its
behavior. The server computes correctness from the stored answer key, and
the model never sets mastery scores. Without the key, the panel explains
that AI is unavailable and points to built-in hints and worked solutions.

**Fixed models and fallback.** The math coach and Canvas assessment use the
same two OpenAI models, in this order:

| Order | Model | When used |
|---|---|---|
| Primary | GPT-6 Astra (`gpt-6-astra`) | First attempt for every coaching request |
| Fallback | GPT-5.6 Sol (`gpt-5.6-sol`) | Once after an Astra service failure, timeout, or empty/unusable response |

`OPENAI_API_KEY` is the only AI credential the current app reads. Older
`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `TUTOR_PROVIDERS`, and
`TUTOR_MODEL_*` secrets may remain in Replit, but are ignored. They neither
add providers nor override the fixed model order.

Both models use high reasoning (`reasoning_effort: "high"`) and
`max_completion_tokens: 16000`. This caps completion tokens, including
reasoning, rather than promising 16,000 visible answer tokens. Each attempt
has its own 120-second timeout covering response headers and the full body;
a fallback can therefore require a second attempt. Requests use the OpenAI
Chat Completions API through Node's built-in `fetch` in `ai-coach.js`, without
an SDK or installed dependency.

A refusal is final and is not sent to another model. HTTP 401 is also final
because the models share a credential. Other service failures may try Sol.
A nonempty reply cut off by the completion limit is displayed with an
explicit notice that it stops early; an empty truncated reply can fall back.
Failures contain only locally generated diagnostic text, never raw remote
error bodies or API keys.

`GET /api/tutor` reports availability and the configured models. Successful
reply metadata identifies the model that actually answered, and the coach
panel shows whether the reply came from Astra or the Sol fallback.

The coaching boundary is explicit:

- **Grounded explanations.** The server supplies the verified question,
  answer, solution, and relevant misconception notes as private context.
  The app grades against the key; the coach explains. Written responses use
  their transparent self-check rubrics instead of AI-awarded points.
- **Limited question context.** The math coach receives the problem, the
  learner's answer when applicable, their question or follow-up, and plain
  counts of earlier attempts on that question and skill. It receives no
  learner name, Canvas data, or unrelated progress. The follow-up conversation
  stays in memory and is discarded when the learner moves on.
- **Named recurring errors.** Post-answer discussion uses the stored note
  for the actual wrong choice and relevant attempt counts, so the coach can
  explain a repeated error without guessing its cause.
- **Available learning resources.** Built-in hints, verified worked
  solutions, lessons, and interactive labs remain available when AI is
  unconfigured or a request fails.

The optional **3D Vector Lab** uses native WebGL and needs no Blender,
browser extension, or added package. It draws a rotatable helix and tangent
vector, explicitly identified as an extension beyond the planar AP exam.
It loads on demand, starts paused, and falls back to a 2D projection if a
WebGL context is unavailable or lost.

## Optional: Canvas plan, grades, and assessment

The **Canvas** tab connects to the learner's school Canvas LMS with their
institution URL and a personal access token (Canvas → Account → Settings →
New Access Token), then reformats the pulled data into three pages:

- **The plan** — a prioritized agenda. Unsubmitted work is grouped, in
  order: past due while Canvas still accepts a submission (missing-flagged
  work included), then due within 4 hours, 12 hours, 24 hours, 3 days, and
  5 days, then later, then no due date, then incomplete module
  requirements, and finally work that is past due and closed in Canvas —
  with a literal note that the next step is to continue with open work,
  plus copyable text for asking the teacher for more time (the app never
  sends anything).
- **Grades** — current course scores and grades exactly as Canvas computes
  them (Calc Coach never recomputes a grade, the same way the verified
  answer key is the only grader for practice), assignment-group weights,
  and every graded assignment with its score. Graded work below 70 percent
  of its points is marked in calm amber.
- **Assessment** — on request only, the same Astra-to-Sol model order as the tutor
  reads a fresh pull of the Canvas data (never the token) and writes a
  literal, non-shaming assessment: overall picture, what is going well,
  problem areas by course, and a suggested order of work grounded in the
  plan's due-date rules.

Every rule is a named constant in `public/canvas-insights.js`, pinned by
tests, with no hidden scoring:

| Rule | Threshold |
|---|---|
| Term selection | Canvas keeps old courses "active", so views filter by enrollment term. The current term — the dated term containing today (`currentTermId`; an undated Default Term is never current) — is selected on each load; the learner can change it under "Terms shown". Unselected-term courses are listed by name, never silently dropped; term-less courses always show |
| Course visibility | A dropdown selects the current study subject, an exact Canvas course, or all courses. Explicit selections override older show/hide preferences and apply to the plan, grades, and assessment together. Other courses remain selectable. |
| Due-date priority buckets | 4 h, 12 h, 24 h, 3 days, 5 days (`PLAN_BUCKETS`) |
| Low graded score | below 70 percent of points (`LOW_SCORE_RATIO`) |
| Low course score | below 70 (`LOW_COURSE_SCORE`) |
| Stale course hidden (listed by name, never silently) | all dated work due over 10 months ago (`STALE_MONTHS`); no-due-date work never hides a course |
| Attempts remaining | Canvas `allowed_attempts` minus attempts used; unlimited shows no limit |
| Excused work | never flagged anywhere |

Safety and privacy, by design:

- **Read-only.** Only GET requests reach Canvas (`users/self`, `courses`
  with total scores, per-course `assignment_groups` with assignments and
  submissions, `modules` with items, `users/self/progress` per course, and
  `users/self/missing_submissions`), always with the string-ids header and
  full Link-header pagination (capped and reported, never silent). Nothing
  is ever created, changed, or submitted.
- **The token stays server-side.** It lives in an expiring 8-hour memory
  session behind an HttpOnly, SameSite=Strict cookie scoped to
  `/api/canvas`. With "Remember this connection" selected, the server also
  saves it to learner-scoped files under `data/` (gitignored, file mode 0600) and,
  when `DATABASE_URL` is set, to the app's Postgres store — so the
  connection survives restarts and production redeploys alike; Disconnect
  deletes every copy at once, and the app says so plainly if the database
  copy could not be removed on that attempt. The
  token is never returned by the server, saved in browser persistence, added
  to progress files or exports, logged, or sent to any AI provider. Every Canvas API
  request carries the active workspace identifier; session cookies, remembered
  connections, preferences, and data caches are scoped to that identifier.
  The original `learner` keeps the legacy `canvas-profile` and `canvas-prefs`
  records so existing connections survive the migration. Other profiles use
  `cv-auth-<profile>` and `cv-prefs-<profile>` records. A learner switch clears
  browser Canvas state and discards late responses from the previous learner.
- **HTTPS only, public hosts only.** The URL validator rejects plain HTTP,
  credentialed URLs, and localhost/private/link-local addresses, and
  pagination follows only same-origin links.
- **Separate from learning.** Canvas data never changes mastery scores,
  never unlocks anything, and the math tutor never sees it. Failures state
  their impact: your calculus progress is unaffected.

## Architecture

```
DevDashCalc (repo root)
|-- server.js              # static files + progress, tutor, and Canvas APIs
|-- ai-coach.js            # fixed Astra/Sol requests, safe failures, and timeouts
|-- store.js               # zero-dep Postgres wire client; files remain the fallback
|-- package.json           # no dependencies; scripts only
|-- public/
|   |-- index.html         # shell; vendored KaTeX for math rendering
|   |-- styles.css         # responsive, themeable design system with motion controls
|   |-- engine.js          # adaptive/mastery logic: pure functions, no DOM
|   |-- courses.js         # BC/AB content scope and Canvas subject selection
|   |-- canvas-insights.js # Canvas normalization and plan/grades rules
|   |-- viz.js             # interactive math explorers
|   |-- study-lab.js       # animated graph explorations with visible code traces
|   |-- spatial-lab.js     # optional native WebGL vector lab and 2D fallback
|   |-- focus-planner.js   # optional one-task planning and elapsed clock
|   |-- app.js             # SPA: routing, views, rendering, persistence
|-- content/
|   |-- manifest.json      # the 10 units, ordering, app-wide constants
|   |-- schema.md          # authoring contract for unit content
|   |-- unit-01..10.json   # skills, lessons, and verified practice questions
|   |-- mastery-bank.json # independent AP-style checks and self-checked FRQs
|-- scripts/
|   |-- validate-content.mjs  # enforces the content schema
|   |-- check-math.mjs        # renders math segments with vendored KaTeX
|   |-- qa-tools.mjs          # blind question dumps, answer keys, language lint
|   |-- lint-ui.mjs           # language rules for the app's own text
|-- test/
|   |-- engine.test.mjs         # learning rules and assisted mastery records
|   |-- courses.test.mjs        # BC/AB scope and subject selection
|   |-- canvas-insights.test.mjs # Canvas normalization and planning rules
|   |-- canvas-profiles.test.mjs # connection isolation and overlapping requests
|   |-- ai-coach.test.mjs       # model order, refusal, timeout, and safe failures
|   |-- tutor.test.mjs          # canonical question context and grading boundaries
|   |-- focus-planner.test.mjs  # timing, lifecycle, and saved fields
|   |-- store.test.mjs          # URL parsing and RFC 7677 SCRAM vector
|-- data/                  # runtime progress and Canvas credentials (gitignored)
```

- **Progress persistence** is dual: every answer saves to `localStorage`
  immediately and to the server on a short debounce. `PUT /api/progress`
  serializes each learner's complete file/database save, using a unique
  temporary file and atomic rename. Other learners have independent queues.
  A request with an older `savedAt` cannot replace newer stored progress;
  equal timestamps use the last complete request's record. Missing or invalid
  timestamps compare as zero. Accepted responses report `databaseSaved`
  (`true`, `false`, or `null` when no database is configured).
  Server reads choose the newest `savedAt` across file and database, preferring
  the file on a tie because it commits before the database. This preserves an
  accepted equal-time save if its database write fails, including after restart.
  The browser then compares that result with its local copy. Settings offers
  JSON export/import as a manual backup path. These are whole-state saves using
  client timestamps: they do not merge concurrent edits, correct clock skew,
  or coordinate multiple server processes. The queues protect this server
  process; distributed account storage needs a database-level revision check.
- **The engine is pure and tested.** `public/engine.js` has no DOM or network
  access and is exercised by `test/engine.test.mjs` — the mastery math above
  is pinned by assertions, not prose.
- **Content is data, verified before shipping.** Each unit was authored
  per-unit against `content/schema.md`, then every question was re-solved
  blind by two independent solvers who saw only the prompt and choices
  (`node scripts/qa-tools.mjs blind unit-NN` prints exactly that view); any
  disagreement with the key was adjudicated by a from-scratch re-derivation
  before the unit shipped. A language critic pass then checked every string
  against the invariants above without touching answers. On every change,
  `validate-content.mjs` enforces the structural contract (per-skill question
  minimums, math-delimiter balance, allowed HTML), `check-math.mjs` renders
  every math segment, and the lints reject non-literal language.
- **Math rendering** is KaTeX, vendored locally under `public/vendor/katex/`
  (JS, CSS, and woff2 fonts, ~600 KB) so math renders with or without
  internet access — no CDN dependency at runtime.

## Study coach and finding Canvas instructions

An Astra study-coach box sits below every screen, with quick requests to pick
a next step, find instructions, explain the current page, and check missing
due dates. Replies identify GPT-6 Astra or the GPT-5.6 Sol fallback, link to
retrieved sources, show lookup limitations, and provide explicit navigation
buttons. The student chooses each action. Conversations stay in tab memory
and clear when the learner, course, terms, resource, or active question changes.
During a live question, the question shortcut points to this same bottom coach,
which uses the canonical tutor and hint accounting; help cannot silently earn
an independent mastery pass. Coach Notes opens beside the conversation on a
wide screen and below it on a narrow screen. The signed-out screen retains a
static coach introduction without loading private records or calling AI.

Canvas assignments and module items have **Find instructions** buttons. The
server reconstructs the selected workspace and course, then reads up to four
typed resources from existing assignments, modules, pages, the course home
page, and syllabus references. Publicly shared Google Docs linked from those
materials can be read as bounded text, using no Canvas or Google credentials.
That text lookup shares the same four-detail budget. Private documents stay
explicitly unread with a link to open them. Files and external tools may provide links and metadata without
readable contents; that limitation is shown. This is a bounded lookup, not a
claim that every teacher resource or external document was searched.

The app distinguishes a reported date, an explicitly empty date field, an
omitted/invalid field, and deadline text inside instructions. Teacher prose
never becomes an official deadline automatically. Undated assignments remain
in the plan and are now considered by Home and the study-session picker.
Older courses remain outside automatic pacing, with an explicit option to
inspect their materials without deleting the older-course rule.

Successful source locations become additional retrieval hints in the existing
file/Postgres store (`cv-rule-<profile>`), scoped to the Canvas account and
course. Old entries and versions remain intact. New hints never alter grades,
submit work, change instructor rules, remove old rules, or authorize arbitrary
SQL or URL access. In account mode, the learner selector contains server-owned
workspaces and every request independently verifies that ownership. The local
legacy selector alone is not authentication.

The implementation is in `public/page-coach.js`, `study-coach-context.js`,
`canvas-retrieval.js`, and the server's `/api/canvas/coach` handler. It uses
Node built-ins and the existing Replit `OPENAI_API_KEY`; no installation is needed.

## Adding or editing content

Read `content/schema.md`, edit the unit JSON, then run `npm run validate`.
The validator fails loudly on any structural problem: missing misconception
notes, unbalanced `$` delimiters, a core skill with too few hard questions, a
checkpoint referencing a question that doesn't exist, and so on.
