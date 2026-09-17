# Students4AI — interactive learning, at your pace

Students4AI brings a learner's classes, saved study plans, and practice into one
workspace. The authored lesson and mastery-check library covers all ten AP
Calculus BC units, with an AB view that excludes BC-only content. Separate
original practice covers AP Physics 1, SAT Math and Reading and Writing, and
Algebra. All modules stay open. Canvas deadlines and saved practice observations
suggest useful topics without limiting independent learning.

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

Students can sign up directly with **Create account**, choose a username and
password, and start a new learning workspace. Replit preview and deployment
explicitly enable this with `AUTH_ALLOW_SIGNUP=1`.

For an existing workspace, the server-side `scripts/create-enrollment.mjs`
command creates a private, single-use setup
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

The sign-in screen has a **Create account** entry. Students with prepared work
can open their private setup link or select **Use a setup invitation** and paste
the link or invitation code. An invalid invitation stays in invitation setup
until the student explicitly chooses another path; it cannot silently create a
blank workspace. Unfinished invited setup survives a page refresh in that tab.
Passwords are never saved in browser storage.

After signing in, **Settings → Canvas connection** lets a student add or update
their own Canvas token, see the verified connection, or disconnect. Canvas is
optional: lessons, practice, and mastery checks work without it. Remembered
token updates wait for the database write before reporting success.

Public signup creates a new random workspace; it never lets a student claim an
existing workspace by submitting its ID. Deployments that deliberately disable
`AUTH_ALLOW_SIGNUP` retain invitation-only registration.
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
the ten newest notes and reports how many were omitted from initial context. Saved text is untrusted
context, never a new grading rule, verified answer, Canvas deadline, or command.
Earlier notes remain stored and can be retrieved through the authenticated
`read_student_records` tool. General, curriculum-question, and mixed-question
coaching can read older notes and exact saved skill/question/mastery records.
General study coaching also has the current Canvas class directory, course
visibility preferences, and saved source-location hints. Each lookup is bound
to the owner established by the server; it accepts no profile, SQL, URL, or
arbitrary table name. Ownership and session validity are checked again before
tool reads and model requests. The reply displays which record pages were read.

The tool-enabled coach uses Anthropic Messages or OpenAI Responses through
the shared provider configuration described below. Both receive the same
owner-bound record tools; OpenAI Responses uses `store:false`. Pages contain
at most ten records and 24,000 characters. At most eight actual tool reads
occur across the whole reply, including provider/model fallbacks. Opaque
thinking and tool-conversation state remain within their originating provider
attempt. Missing data and remaining pages are explicit. This
provides record access, not guaranteed full recall. Authentication tables and
Canvas credentials are excluded. Focus sessions remain browser-local, and an
active mixed session is temporary. Explicitly saved study plans and checked
practice observations are durable, owner-bound records available through
`study_plans` and `practice_history`; they are separate from coach notes and
from an automatic conversation archive.

## Home, course library, and saved plans

**Home** shows current Canvas classes, topics from plans the learner has actually
saved, and entry points for fresh practice and study tools. **Course library**
holds the independent lessons, mastery checks, and learning models. Changing
the **Studying** selection changes this view; it does not reset progress or
make independent curriculum topics appear to be school assignments.

Open **Study plans**, choose a Canvas class, independent subject, or custom
class, and enter a goal. **Draft a plan with Astra** prepares an editable draft;
**Write my own plan** works without the coach. Review the topics and steps,
then explicitly save. Saved plans reopen from Home or Study plans with their
completed steps. Optional SAT baseline, target, and test-date fields guide
planning; they are self-reported goals, not verified scores or predictions.

Plans support 1–10 topics and 1–12 steps, up to 360 suggested minutes per plan.
Each workspace currently supports 200 saved plans and 5,000 plan events.
Drafting does not save, and a step checkbox does not award mastery. Account
mode stores plans and checked-practice history in the database. Private local
mode can use files when no database is configured. A failed read is shown as
unavailable, not as an empty history. See the
[practice and persistence guide](docs/learning-workspace.md) for the boundaries.

## Canvas connections for Dev, Esha, and other learners

The signed-in Home page lists that learner's current Canvas classes across all
subjects. Canvas term dates separate current, past, and upcoming classes;
undated school resources remain available in an additional-courses section.
Missing assignment due dates never hide a class. A refresh runs on sign-in,
when switching learners, every five minutes while visible, and on returning
to a tab when the last snapshot is at least five minutes old. Concurrent
snapshot requests share one load; the learner selector and coach draft stay
mounted while course cards update.

Each class has Open class, Study plan, Ask Astra, and Quick study actions. Quick study
asks for one short recall question and waits for the learner's answer; it
uses the chosen Canvas class and does not award mastery credit. AB homes do
not promote BC-only practice. Every learner can still open the study planner
and practice tools from navigation. The full authored curriculum currently
covers AB and BC; coaching across other Canvas subjects is a separate feature.

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
`OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are separate coaching credentials;
neither is a Canvas token.
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

## Original SAT, Algebra, Physics, and Calculus practice

Open **Start fresh practice** on Home or a practice entry in Course library.
SAT and Algebra open with their own topics selected. Mixed practice can combine
selected topics; choose a starting level and 5, 10, or 15 questions, or continue
until you finish. There are 32 topic groups: 8 Physics, 12 Calculus BC, 8 SAT,
and 4 Algebra. The starting course scope preserves AB/BC distinctions.

This is a finite starter bank. Physics/Calculus have 60 original base families
and 6 alternate mathematical forms. SAT Math and Algebra each offer 24
level/form combinations. SAT Reading and Writing has 32 distinct original
passages: 16 starter, 8 intermediate, and 8 advanced. Reading levels use
different passages; all difficulty labels are locally authored, not official
exam calibration. Numerical variation does not mean every question requires
a different reasoning method. These are representative multiple-choice
activities, not complete SAT/AP exams, all course subtopics, a score predictor,
or Physics laboratory/FRQ coverage. See the
[current exam scope](docs/exam-practice-scope.md) and
[bank implementation record](docs/generated-practice-implementation.md).

Select a choice, then **Check answer**. The computed server key grades it;
the AI coach explains the current question without deciding correctness.
A wrong answer produces a new variation of the same concept with the
specific distractor explanation. After one focused follow-up, the session
rotates to other selected topics and the other subject when available.
Two independent correct answers raise a topic's level; wrong answers lower
its general target level. A focused follow-up may retain its actual concept
level, and the interface explains that choice. Hints and received pre-answer
coach help are recorded separately and do not increase independent credit.
After checking, **Same problem, new wording** reviews the same problem and cannot
increase independent credit or level. **New challenge on this topic** stays on the
selected topic and seeks another supported form or fresh parameters. The finite
bank discloses repeats; repeated questions count as review.

Pause, resume, change topics, and finish are explicit controls. Topic changes
apply after the current question so selected work is preserved. Reloading
restores the server's question, feedback, and already-revealed hints in a
paused state. The browser stores only the session ID, preferences, and draft
choice per workspace. Sessions and adaptation live in server memory for up
to six hours and end when that server restarts, with at most 200 questions per
session. Checked answers are saved separately as durable practice observations,
including later assistance corrections. Study plans and SAT/Algebra
library views summarize independent correct answers, incorrect answers,
helped correct answers, reviews, and patterns to revisit. If persistence fails,
the answer remains checked and the UI offers **Retry saving this answer**.
Saved observations do not change curriculum mastery or Canvas grades. Suggested
one-day/three-day review intervals are adjustable heuristics, not promises of
retention or score gains.

The bank has mathematical property tests, seeded numerical checks, rendered
solutions, and independent blind reviews of authored sample questions. No new
package, AI generation call, or Canvas connection is needed to practise. The
optional explanation coach uses the shared configurable provider order.

## Build with Astra, models, and evidence mysteries

**Build with Astra** helps write a request for a new question, practice set, or
interactive-model explanation. Choose a topic and a meaningful variation such
as a new representation, unknown, or multistep task. Edit the request, then
open it in Astra; this fills the coach draft and does not send automatically.
Requests say to wait for the learner's answer. Coach-generated practice is
ungraded and does not silently enter the verified bank. A model-change request
asks Astra to explain or propose a change; it cannot execute invented code.

Question models use the question's supplied givens when available, or clearly
label their own values as an **Independent example**. Calculus and physics
examples include tangent/accumulation graphs, motion and force relationships,
and a rotatable 3D solid of revolution. Reading and Writing uses a reasoning
guide. Models have keyboard controls, text/table alternatives, learner-started
playback, pause/reset/speed controls where animated, reduced-motion support,
and cleanup when leaving the view. Opening an example or strategy before
checking counts as help; a diagram of givens is part of the question.

The SAT library and Build page link to **Evidence mysteries**: three original
short cases with three stages each, combining an evidence clue, an inference,
and grammar. Check a choice, then explicitly select Next after a correct answer.
Hints and worked explanations remain available; other cases and the rest of
the app stay open. This optional activity has no SAT score or mastery credit,
and its progress lasts only while the page is open. Its keys are public because
it is an ungraded learning puzzle.

## Running it

Zero dependencies. Node 18+.

```bash
node server.js          # serves on $PORT or 3000
```

**On Replit:** the included `.replit` already runs `node server.js` — import the repo and press Run. The server binds `0.0.0.0` and reads
`PORT` from the environment, which is exactly what Replit's webview expects.
There is no `npm install` step, so a corrupted `node_modules` can never take
this app down.

The tracked deployment target is Replit `cloudrun`; GitHub CI checks the code
but does not deploy. See [deployment and release checks](docs/deployment.md)
for the known Replit host, configuration, and verification steps.

Tests and content validation:

```bash
npm test                # application, bank, plans/history, models, and account tests
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

Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or both in Replit Secrets to connect
the coach. Astra remains the study-coach name in the interface; each reply
identifies the provider model that actually answered. The Astra panel
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
the model never sets mastery scores. Without an enabled provider key, the panel explains
that AI is unavailable and points to built-in hints and worked solutions.

### Model settings in Replit Secrets

`coach-config.js` reads the server environment for each request, and
`tutor-service.js` applies the same configuration to general study coaching,
question coaching, mixed practice, and Canvas assessment. Set the following
values in the appropriate Replit environment. API keys stay in Secrets and
are never included in status responses.

| Setting | Default when absent / value to enter | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Add your own Anthropic API key | Enables the Anthropic provider |
| `OPENAI_API_KEY` | Add your own OpenAI API key | Enables the OpenAI provider |
| `TUTOR_PROVIDERS` | `anthropic,openai` | Provider order; use `openai` or `anthropic` to select only one |
| `TUTOR_MODEL_ANTHROPIC` | `claude-fable-5-1` | Anthropic primary model: Claude Fable 5.1 |
| `TUTOR_MODEL_ANTHROPIC_FALLBACK` | `claude-opus-5` | Anthropic fallback: Claude Opus 5 |
| `TUTOR_MODEL_OPENAI` | `gpt-6-astra` | OpenAI primary: GPT-6 Astra |
| `TUTOR_MODEL_OPENAI_FALLBACK` | `gpt-5.6-sol` | OpenAI fallback: GPT-5.6 Sol, as confirmed by Melody |
| `TUTOR_TIMEOUT_MS` | `120000` | Per-attempt ceiling; integer from 1,000 to 120,000 milliseconds |
| `TUTOR_TOTAL_TIMEOUT_MS` | `240000` | Whole-request budget; integer from 1,000 to 480,000 milliseconds |

With both keys and no overrides, attempts run in this order: **Fable 5.1 →
Opus 5 → Astra → Sol**. A provider with no key is skipped with a configuration
warning. Supplying a primary or fallback model setting takes precedence over
its default. An explicitly blank fallback disables that attempt; an explicitly
blank primary is a configuration error. Repeated provider names and identical
primary/fallback IDs do not cause duplicate attempts.

Model IDs keep the supplied spelling and case after surrounding whitespace is
trimmed. Use exact provider catalog IDs; a typo such as `Opus-5` is not silently
rewritten. The validator rejects malformed IDs and obvious non-tutoring or
wrong-provider names. These checks cannot establish that an account has access
to a model. The default order reflects Melody's current preference. Model
specifications and successful API requests do not establish comparative
tutoring quality; compare representative student questions separately.

Gemini is disabled. `GEMINI_API_KEY`, `GOOGLE_API_KEY`, and
`TUTOR_MODEL_GEMINI` do not enable it. Listing `gemini` or an unknown provider
in `TUTOR_PROVIDERS` produces a configuration error. Existing unused Secrets
can remain stored. Normal startup does not load `.env`, and tracked launch
commands do not set model values or overwrite these settings. Defaults apply
only when the corresponding setting is absent.

### Reasoning, tools, and fallback behavior

Anthropic uses its Messages API with adaptive thinking, high
`output_config.effort`, and a 16,000-token output budget. OpenAI text requests
use Chat Completions with high `reasoning_effort` and
`max_completion_tokens: 16000`. OpenAI record-aware requests use Responses
with high `reasoning.effort` and `max_output_tokens`, sharing the 16,000-token
budget across tool turns. These budgets include reasoning; they do not promise
16,000 visible answer tokens. All transports use Node's built-in `fetch`.

The total request budget defaults to 240 seconds, with a 120-second ceiling
for an individual attempt. Before each attempt, the service divides the
remaining time across remaining fallbacks so a stalled primary cannot consume
the whole budget. With four configured attempts that all stall, each receives
approximately 60 seconds. Fast failures leave more time for later attempts.
Timeouts cover response headers, bodies, and tool turns.

A refusal is final across providers. HTTP 401 skips the remaining models at
that provider because they share the rejected key; another configured provider
can still answer. Other service failures and empty/unusable responses can
advance to the next attempt. Loss of student authorization ends the request.
A nonempty reply cut off by the completion limit is displayed with an
explicit notice that it stops early; an empty truncated reply can fall back.
Failures contain only locally generated diagnostic text, never raw remote
error bodies or API keys. The same owner-bound tools and shared eight-read
limit apply to every provider; fallback does not grant additional data access.

### Operator verification and recovery

Run `node scripts/check-tutor-models.mjs` on the server to print the safe
configuration summary. Adding `--smoke` makes a small paid tool-capability
request to each configured model using synthetic notes only. It verifies that
each model can read a fixture note and return its marker; it does not access
student accounts, Canvas, or the student database, and never prints API keys.

After changing Secrets, restart the development workflow. Update the production
environment and republish for deployed requests to receive the change. While
signed in, check `GET /api/tutor`: `getTutorStatus()` projects only availability,
provider/model names, missing-key warnings, and any `configurationError`.
Configured availability means a usable configuration and key are present;
provider access and working model capabilities require a real request to verify.

If configuration fails, correct the named setting. Remove an override to use
its default, or set a fallback to an empty string to disable it. Remove
unsupported providers from `TUTOR_PROVIDERS`. For a 401, update that provider's
key; for an unavailable model, verify the exact catalog ID and account access.
Use a synthetic, non-student prompt for verification. Never print keys, dump
the environment, or publish the private `attempts` array from the resolver.
Changing model configuration requires no database migration or new dependency.
Keep student data, account credentials, Canvas tokens, and unrelated Secrets
intact while correcting the coaching configuration.

The coaching boundary is explicit:

- **Grounded explanations.** The server supplies the verified question,
  answer, solution, and relevant misconception notes as private context.
  The app grades against the key; the coach explains. Written responses use
  their transparent self-check rubrics instead of AI-awarded points.
- **Grounded question context.** The math coach receives the problem, the
  learner's answer when applicable, their question or follow-up, and plain
  counts of earlier attempts on that question and skill. Authenticated
  requests can retrieve the student's saved learning profile, exact history,
  and notes through owner-bound record tools. Raw Canvas credentials and
  authentication tables are never included. The follow-up conversation stays
  in memory and is discarded when the learner moves on.
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
- **Assessment** — on request only, the same configurable model order as the tutor
  reads a fresh pull of the Canvas data (never the token) and writes a
  literal, non-shaming assessment: overall picture, what is going well,
  problem areas by course, and a suggested order of work grounded in the
  plan's due-date rules.

Every rule is a named constant in `public/canvas-insights.js`, pinned by
tests, with no hidden scoring:

| Rule | Threshold |
|---|---|
| Term selection | Canvas keeps old courses "active", so views filter by enrollment term. All dated terms containing today are initially selected, including overlapping yearly and semester terms; an undated Default Term is never assumed current. The learner can change "Terms shown". Home separates current, past, upcoming, and undated classes; older classes remain available for practice and undated classes remain accessible |
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
|-- coach-config.js        # environment model/provider settings and safe validation
|-- tutor-service.js       # provider fallback, total time budget, shared record limit
|-- anthropic-coach.js     # Anthropic Messages + owner-bound record tool adapter
|-- ai-coach.js            # OpenAI text requests, safe failures, and timeouts
|-- ai-record-coach.js     # OpenAI Responses + owner-bound record tool adapter
|-- store.js               # zero-dep Postgres wire client; files remain the fallback
|-- study-plans.js         # validated drafts and append-only saved plan projection
|-- practice-history.js    # canonical checked-attempt summaries and review suggestions
|-- mixed-question-bank.js # private verified families and topic catalog
|-- mixed-sat-bank.js      # original SAT/Algebra forms and reading passages
|-- mixed-ap-variants.js   # alternate AP mathematical forms
|-- mixed-practice.js      # temporary canonical questions and adaptive session state
|-- mixed-practice-api.js  # authenticated grading/help and history persistence hook
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
|   |-- study-plans.js     # editable drafts, explicit save, and completed steps
|   |-- practice-insights.js # saved observations, help/review distinctions
|   |-- mixed-study.js     # fresh practice, wording review, and challenge controls
|   |-- question-models.js # safe given diagrams and labeled interactive examples
|   |-- practice-builder.js # editable requests and curated model previews
|   |-- evidence-mystery.js # optional evidence/inference/grammar cases
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

- **Curriculum progress persistence** is dual: every curriculum answer saves to `localStorage`
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
- **Plans and checked mixed-practice observations** use separate append-only
  records, so whole-progress saves cannot erase them. Account mode awaits
  database persistence; unavailable storage is surfaced. The
  [persistence guide](docs/learning-workspace.md) covers event limits, help
  revisions, and the distinction from temporary active sessions.
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
due dates. Replies identify the actual configured model that answered, link to
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

Tutor replies, source descriptions, and Canvas assessments show named Markdown
references and plain web addresses as clickable links. The shared renderer
preserves paragraphs, headings, lists, and tables, checks link destinations,
and opens external references in a new tab only when selected. HTML, images,
and code in a reply are never executed or automatically loaded.

The implementation is in `public/page-coach.js`, `public/tutor-text.js`,
`study-coach-context.js`, `canvas-retrieval.js`, and the server's
`/api/canvas/coach` handler. It uses Node built-ins and the configurable tutor
service described above; no installation is needed.

## Adding or editing content

Read `content/schema.md`, edit the unit JSON, then run `npm run validate`.
The validator fails loudly on any structural problem: missing misconception
notes, unbalanced `$` delimiters, a core skill with too few hard questions, a
checkpoint referencing a question that doesn't exist, and so on.
