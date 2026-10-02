# Learning workspace and persistence

Implementation guide, October 2, 2026. These behaviors describe the code in
this repository; deployment verification is a separate step.

| Entry | Purpose | Saved state and limits |
| --- | --- | --- |
| Home (`#/home`) | Personalized greeting and three touch-friendly destinations: Study, Plan, Canvas | Desktop navigation is horizontal; phones use the right-side menu. Account settings are in the header. |
| Canvas (`#/canvas`) | Refresh/check school courses and add/remove them from Plan | Existing learner-owned course visibility preferences persist membership. Removing a course does not alter Canvas or erase saved work; it can be added again. Preference-read/write failures remain visible. |
| Study (`#/study`, `#/study/<planId>/<stepId>`) | Work through saved plan steps, view instructor items for that course, use practice, models, and the bottom Coach | Completion uses the owned plan API; only selected IDs and pause choice are stored locally. The server resolves selected plan/step context from owned records. |
| Course library (`#/library`) | Independent AB/BC lessons/mastery, subject practice, and models | Changing subject preserves progress. SAT, Algebra, and Physics practice are not full authored lesson courses. |
| Plan (`#/plans`, `#/plans/<id>`) | Choose a Canvas course and items, add a topic/question, select Guide/Practice/Test/Model, then review and save steps for Study | Owner-bound, append-only events. 200 plans / 5,000 plan events per workspace; 1–10 topics, 1–12 steps, 1–120 minutes per step and at most 360 minutes total. No delete/archive interface yet. |
| Mixed practice (`#/mixed`, `#/mixed/sat`, `#/mixed/algebra`) | Verified-key questions, explicit checking, help and adaptive follow-ups | Active sessions last at most six hours / 200 questions and end on server restart. Canonical checked attempts persist separately. |
| Build with Astra (`#/build`) | Editable request for a question/set/model explanation with a chosen type of variation | Opens the request in the persistent coach draft without sending. Does not save a plan, run generated code, or create verified graded content. |
| Evidence mysteries (`#/mystery`) | Three original cases, each with evidence, inference and grammar stages | Nine local ungraded stages; explicit Check/Next, hint/explanation, exit anytime. Public keys; page-local progress; no score/mastery. |
| Session timer (`#/focus`) | Optional Prepare / Work / Wrap up and elapsed clock | Browser-local per learner; pause on reload/switch. Suggested time is not a deadline. |

## Practice observations

The server derives evidence from a checked question: attempt/topic/subject IDs,
template/variant IDs, difficulty, correctness, assistance, misconception tag,
original timestamp, and whether it is review. Prompts, choices, keys, and private
generator parameters are excluded. Bounded hashes of checked prompt/problem variants are stored only internally to reduce repetition across sessions; public history omits them. Recent unchecked exposures remain in server memory. Existing alternate question forms are preferred where available; a finite bank can still repeat, with review-only disclosure. `/api/practice-history` is a read endpoint;
clients cannot write their own correctness or help claims.

Database storage uses `practice-<profile>` and `plans-<profile>` keys in
`calc_coach_store`. `dbAppendRecords` atomically appends records; plan projections
use creation IDs and completion events, and history projections deduplicate
attempts. A later help/review revision cannot be undone by retrying an older
unassisted record. Whole-progress saves cannot erase either collection.
Without a database, isolated private local mode uses atomic JSON files.
Authenticated mode fails closed if database storage is unavailable.

Practice currently limits stored events to 10,000 per workspace; assistance
revisions can use another event, so this is not a promise of 10,000 questions.
The summary returns topic totals and the 30 newest deduplicated attempts.
Incorrect answers, correct answers with help, independent correct answers, and
reviews are separate. The latest fresh attempt suggests review after one day
if incorrect/helped, otherwise three days; these are simple adjustable
heuristics, not scientifically calibrated retention estimates.

The answer endpoint awaits persistence. A failed write leaves the canonical
answer checked and displays a retry action. It does not falsely report that
history saved. Failed history reads display unavailable rather than zero
attempts. The coach can page through `practice_history` and `study_plans` using
the same account/workspace boundary as other records. Access to a collection
does not mean all of it was read or will always fit in coach context.

## Content and assistance boundaries

See [the bank record](generated-practice-implementation.md) for exact counts,
review semantics, and sample verification, and [exam scope](exam-practice-scope.md)
for official structures. These are original activities. Locally authored
difficulty, practice correctness, and optional self-reported SAT goals cannot
establish an official score or readiness for a target score.

`validateQuestionVisual` admits only specified points, triangle legs, or bar
values/labels. Given diagrams show supplied information without calculating
unknowns. Other question models are labeled independent examples or reasoning
guides. Opening one before checking is assistance: authored practice marks its
existing help state; mixed practice first receives server confirmation. After
checking, the examples can be explored freely. No private answer parameter is
copied into public model metadata.

Models use existing native canvas patterns with no package dependencies. The
3D solid of revolution is a projected mathematical model, not arbitrary code
from a coach response. Numerical text/tables and keyboard controls remain
available. Playback is learner-started and honors reduced motion; hidden or
detached views stop animation, and callers dispose old models before rerenders.

Model previews and coach-generated questions in Build are independent learning
activities. They do not award graded-bank credit. A learner can choose new
scenarios, representations, unknowns, multistep reasoning, explanation/error
analysis, or wording-only review. Wording alone is explicitly distinguished
from a new reasoning task.

## Coach inputs and memories

The persistent GPT Coach uses authored lesson context, current verified practice
questions, owned saved-plan steps, and the student’s scoped Canvas resources.
Voice input is transcribed into the same text request; optional chunked speech
reads that response without word highlighting. There is no separate voice brain.

Students can attach two JPEG/PNG/WebP photos or UTF-8 text notes, up to 6 MiB
combined and 12,000 note characters. Camera/gallery selection is explicit; files
are removed after a successful reply or workspace/context change. Failed sends
retain the draft for retry. Upload bytes are request-scoped, excluded from
transcripts and persistent memories, and sent as real image content to the GPT
provider. Upload text cannot authorize memory-writing tools. HEIC/PDF files are
not supported by this first upload path.

Astra can save selective observations from what the learner says, with confirmed
write receipts. Learners can edit/remove saved notes. Add to Plan on a reply opens
an editable draft; it does not silently save the response or carry attachments.
Test requests remain learning activities: only the existing checked bank awards
practice credit. Interactive models come from the available reviewed library;
arbitrary generated scripts are not executed.
