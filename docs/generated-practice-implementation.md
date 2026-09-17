# Generated practice implementation — 2026-09-17

The mixed practice bank now offers Algebra, AP Physics 1, AP Calculus BC, and original SAT Math and Reading and Writing practice. The SAT material is a starter library, not a full course, official exam, calibrated difficulty scale, or score predictor. No mixed-practice event awards curriculum mastery or changes Canvas grades.

## Question and review behavior

- `next(..., {mode:'adaptive'})` follows the existing wrong-answer/help follow-up and subject rotation. Two independently correct fresh questions can increase the locally authored topic level.
- `mode:'wording'` creates an explicitly labeled review of the same checked question. Givens, choices, answer key, and worked solution remain identical. Mathematics is excluded from text replacement. Neither correct nor incorrect wording reviews alter independent evidence, streaks, or adaptive level.
- `mode:'challenge'` stays on the current selected topic, prefers another supported form, and tries fresh parameters within a bounded search. Some forms vary representation or context while retaining the same underlying reasoning. The UI does not promise a new reasoning family every time.
- Duplicate detection checks normalized visible prompts and stable canonical parameters at the same topic/level. A finite bank may be exhausted; repeated problems are disclosed and counted as reviews, without independent credit. Adaptive rotation continues after review.

The catalog has 32 topics: 8 Physics, 12 Calculus BC, 8 SAT, and 4 Algebra. Physics/Calculus retain 60 original base families and gain 6 alternate mathematical forms. SAT Math and Algebra each offer 24 level/form combinations. SAT Reading and Writing contains 32 distinct original passages: 16 at starter level, 8 at intermediate level, and 8 at advanced level. Higher reading levels use different passages, not renamed starter items. Levels are locally authored and not official exam calibration.

## Integration contracts

`mountMixedStudy(container, options)` accepts `initialSubject`, `initialTopicIds`, and `motion`. A new setup can be preset to `sat`, `algebra`, `physics`, or a calculus course scope. A running session is preserved. Topic metadata includes `unitNumber`, `courseScopes`, and `domainGroup`. SAT and Algebra have no calculus curriculum units and match only their own course names.

Public question data includes a narrowly sanitized `visual` descriptor, `reviewOnly`, `practiceMode`, and `difficultyBasis`. Hidden answer keys and parameters remain server-owned. Exact-givens diagrams are part of the question; independent example models and reading strategies require an explicit learner action and successful server assistance marking before they open pre-answer. Every rerender and route cleanup disposes the previous model.

`service.attemptEvidence(profileId, sessionId, questionId)` returns `null` before a checked answer, then canonical `{attemptId, topicId, subject, templateId, variantId, difficulty, correct, assisted, misconceptionTag, at, isReview}`. `at` is the original attempt timestamp in ISO 8601 format. Evidence excludes prompts, choices, keys, and private parameters.

The API accepts optional `recordAttempt({profileId,evidence})`, awaited after completed answers and assistance revisions. A storage failure preserves canonical grading and returns `historySaved:false` with a notice. The UI provides an idempotent retry of the same checked answer. Persistence adapters should upsert by learner and attempt ID, preserving later assistance revisions; they must never trust client correctness or help claims.

Server dependencies added: `mixed-sat-bank.js` and `mixed-ap-variants.js`. New test entry: `test/mixed-extensions.test.mjs`.

## Verification and remaining scope

Focused generator, service/API, UI-helper, and course tests passed. Numerical tests cover the original 60 AP families, 2,160 SAT/Algebra seeded combinations, 300 alternate AP combinations, unique choices, and equation-based verification. All new forms and worked mathematical solutions render with the vendored KaTeX renderer. Tests also cover wording-review credit, adaptive continuation, finite-bank repetition, safe visual data, fixed reading content, and persistence failures/revisions. Language lint passed; syntax checks passed for every changed implementation module.

Independent blind review matched all 86 sampled answers: 30 SAT/AP math, 24 Algebra, and 32 reading passages. One advanced reading stem received a pronoun-antecedent editorial correction; the independent reviewer confirmed the revised sentence preserves its unique answer. Review files and key-comparison records are in `C:\Users\melod\Documents\Codex\2026-09-17\students4ai-practice`.

Root owns full integration, persistence storage, authenticated route verification, and final browser checks. The finite starter bank does not by itself establish readiness for a target SAT score or complete domain coverage. Several topics still vary parameter values or context within a limited set of reasoning forms; further authored content can expand that range without changing grading or review semantics.
