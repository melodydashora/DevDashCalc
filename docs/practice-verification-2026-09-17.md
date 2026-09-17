# Practice workspace verification — September 17, 2026

This record covers the local implementation and browser review. It does not
establish that the changes are live. Browser checks used an authenticated
synthetic test workspace; no actual student records were used. Real-provider
study-plan generation was not exercised in that fixture.

## Automated and content checks

- The latest complete suite passed **404 tests** before the final Algebra
  builder-default test was added. After that change, **15 focused tests** and
  language lint passed. The resulting full suite contains **405 tests**; its
  complete run is delegated to CI and is not recorded here as already passed.
- All **48** module syntax checks listed in the updated CI workflow passed
  locally. Documentation links resolved, and `git diff --check` was clean.
- Independent blind solves matched **86 new bank samples**: 30 SAT/AP math,
  24 Algebra, and 32 Reading and Writing passages. One advanced reading stem
  received a pronoun-antecedent edit; the reviewer confirmed the revised stem
  retains a unique answer. All **9 mystery stages** were independently reviewed.
- Mathematical/property tests and KaTeX rendering checks cover generated forms
  and solutions. Blind sample review is evidence about those authored samples,
  not a claim that every possible numerical variation was solved by a person.

## Browser checks

| Area | Observed behavior |
| --- | --- |
| Study plans and Home | Saving requires an explicit action. Saved plans and completion state survive reload. Home shows topics from saved plans rather than substituting curriculum topics for a student's classes. |
| SAT practice | An advanced grammar challenge produces a distinct question. Opening a pre-answer example/strategy records assistance. Wording-only review is labeled as review. |
| Checked history | Independent and assisted checked attempts remain distinct and survive reload. |
| Evidence mysteries | A wrong answer stays at clue 1. A correct check still requires explicit Next before advancing. |
| Models | The 3D canvas renders, and its rotation control works from the keyboard. |
| Build with Astra | Algebra defaults to a linear model and the appropriate subject name. There are now nine curated model/guide previews. |
| Narrow viewport | At 390 px width, reviewed screens had no horizontal overflow. |
| Browser errors | No browser errors were observed during the reviewed flows. |

The bank remains a finite starter library, with locally authored difficulty
and no official SAT/AP score prediction. Mystery progress is page-local and
ungraded. Active mixed sessions remain temporary even though checked history
persists. Production configuration, real-provider plan generation, and the
deployment's actual commit require their own verification; see
[deployment guidance](deployment.md), [workspace boundaries](learning-workspace.md),
and [bank implementation](generated-practice-implementation.md).
