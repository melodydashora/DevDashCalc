# Practice scope and current exam structures

Verified against College Board's official pages on September 17, 2026. The target AP administration is **May 2027**. Older exam summaries can have different counts and timings.

| Exam | Current structure | App implications |
| --- | --- | --- |
| SAT | Reading and Writing: 54 questions, two 32-minute modules. Math: 44 questions, two 35-minute modules. The second module in each section depends on performance in the first. There is a 10-minute break between sections. | A short generated topic set is skill practice, not a full adaptive SAT simulation. Math includes multiple choice and student-produced responses; an MC-only bank does not cover every response format. |
| AP Calculus AB and BC, May 2027 | 42 MC questions in 100 minutes: 29 without a calculator in 62 minutes, then 13 with a graphing calculator in 38 minutes. Six FRQs in 90 minutes: two calculator questions in 30 minutes, four noncalculator questions in 60 minutes. Each section contributes 50%. | Preserve AB/BC topic boundaries and calculator labels. Do not reuse the former 45-question/105-minute MC structure for 2027 practice. |
| AP Physics 1, May 2027 | 42 MC questions in 85 minutes and four FRQs in 95 minutes, each section worth 50%. The FRQ categories are mathematical routines, translation between representations, experimental design and analysis, and qualitative/quantitative translation. | Representative MC questions across eight units do not provide the FRQ, experimental-design or laboratory coverage of the complete course/exam. |

Sources: [SAT structure](https://satsuite.collegeboard.org/sat/whats-on-the-test/structure), [AP Calculus AB exam](https://apcentral.collegeboard.org/courses/ap-calculus-ab/exam), [AP Calculus BC exam](https://apcentral.collegeboard.org/courses/ap-calculus-bc/exam), [AP Physics 1 exam](https://apcentral.collegeboard.org/courses/ap-physics-1/exam).

Both calculus pages explicitly identify the 2026–27 updates and say the course content has not changed. Calculus and Physics 1 are hybrid digital exams: students answer MC questions and read FRQ prompts in Bluebook, then handwrite FRQ responses. The existing browser practice UI is not a reproduction of that examination workflow.

SAT Math covers algebra, advanced math, problem-solving and data analysis, and geometry/trigonometry. AP calculus should not be relabeled SAT Math simply because it is mathematics. See [College Board's SAT Math specifications](https://satsuite.collegeboard.org/k12-educators/about/alignment/math).

## Content and labeling decisions

- Label generated items as **original practice** or **original AP-style/SAT-style practice**, with their actual subject and topic. Do not describe them as released College Board questions, a complete official exam, or an official score predictor.
- Keep a source label separate from alignment. The official pages define scope; they do not make this app's generated content official.
- Keep the stored, independently checked key as the grader. AI explanations do not establish correctness. Free-response practice needs a stated rubric and appropriate review; MC performance does not supply a verified AP score.
- Keep practice timers optional. A session with hints and interactive examples is a learning activity. Calculator-restricted or independent assessments must state which support is allowed before they start.
- Link to College Board's [Bluebook practice](https://bluebook.collegeboard.org/students/practice) for official SAT full-length practice and AP/SAT interface previews. College Board directs full AP practice to AP Classroom; Bluebook does not provide full-length AP practice exams.
- A supplied diagram may show the question's given information. A separate interactive model must be visibly labeled **Independent example**, use its own values and avoid presenting itself as the actual problem. Do not export hidden generator parameters that could contain an answer (for example, an unknown projectile flight time).
- Reading and Writing practice benefits from a reasoning or sentence-structure guide. It should not receive an unrelated 3D object. Three-dimensional revolution diagrams belong with volume/cross-section concepts; the optional helix remains a beyond-exam extension.

These are implementation and labeling decisions based on the verified scope. They are not a license determination for republishing College Board content. This implementation adds original content rather than copying exam questions.
