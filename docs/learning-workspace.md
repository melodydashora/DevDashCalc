# Learning workspace and persistence

Implementation guide, September 17, 2026. These behaviors describe the code in
this repository; deployment verification is a separate step.

| Entry | Purpose | Saved state and limits |
| --- | --- | --- |
| Home (`#/home`) | Current Canvas classes, topics from explicitly saved plans, and study tools | Course topics come from plans, not invented school assignments. |
| Course library (`#/library`) | Independent AB/BC lessons/mastery, subject practice, and models | Changing subject preserves progress. SAT, Algebra, and Physics practice are not full authored lesson courses. |
| Study plans (`#/plans`, `#/plans/<id>`) | Choose a course/goal; request or write a draft; edit and explicitly save; reopen and complete steps | Owner-bound, append-only events. 200 plans / 5,000 plan events per workspace; 1–10 topics, 1–12 steps, 1–120 minutes per step and at most 360 minutes total. No delete/archive interface yet. |
| Mixed practice (`#/mixed`, `#/mixed/sat`, `#/mixed/algebra`) | Verified-key questions, explicit checking, help and adaptive follow-ups | Active sessions last at most six hours / 200 questions and end on server restart. Canonical checked attempts persist separately. |
| Build with Astra (`#/build`) | Editable request for a question/set/model explanation with a chosen type of variation | Opens the request in the persistent coach draft without sending. Does not save a plan, run generated code, or create verified graded content. |
| Evidence mysteries (`#/mystery`) | Three original cases, each with evidence, inference and grammar stages | Nine local ungraded stages; explicit Check/Next, hint/explanation, exit anytime. Public keys; page-local progress; no score/mastery. |
| Session timer (`#/focus`) | Optional Prepare / Work / Wrap up and elapsed clock | Browser-local per learner; pause on reload/switch. Suggested time is not a deadline. |

## Practice observations

The server derives evidence from a checked question: attempt/topic/subject IDs,
template/variant IDs, difficulty, correctness, assistance, misconception tag,
original timestamp, and whether it is review. Prompts, choices, keys, and private
generator parameters are excluded. `/api/practice-history` is a read endpoint;
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
