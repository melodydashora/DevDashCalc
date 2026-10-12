# Canvas collection and planning coverage

Audit baseline: `c0cfbb43fa52f037b3a07e596dcb8932a8541fdb` (PR #24). This matrix compares the verified implementation with the requested comprehensive pulls, cleanup, categorization, syllabus discovery, and planning behavior. The exact previously supplied standalone cleanup functions were not present in this checkout; this is not a claim of line-by-line equivalence to unavailable code.

| Rule | Baseline | Current implementation and reference | Remaining work |
|---|---|---|---|
| Consistent IDs, dates, nullable fields and content states | Covered, narrower schema | `public/canvas-insights.js`: `normalizeCourse`, `normalizeAssignment`, `normalizeGroup`, `normalizeModule`, `normalizeModuleItem`; retains instructors, timezone, sections, drop rules, prerequisites and source relationships | Source schemas remain allowlisted, not lossless backups |
| Broad course collection with pagination | Partial: first 15 courses and capped lists | `canvas-sync.js`: `collectCanvasSnapshot`, `collectCanvasList`; active enrollments, resumed pagination, partial and capacity states | Completed/inactive enrollments need an explicit scope option |
| Syllabus/home/page discovery in routine pulls | Partial, coach-request dependent | `collectCanvasSnapshot` collects syllabus, front page, page bodies; `canvas-documents.js`: `discoverCourseDocuments` follows observed course references and examines file metadata | External LMS/LTI systems and arbitrary private links require separate supported integrations |
| Assignment/calendar-independent course sources | Partial | Collector includes assignments, groups, modules/items, announcements, discussion topic bodies, Classic and New Quiz indexes, calendars, files/folders and grading periods | Discussion replies, New Quiz item banks/questions, media transcripts and hidden sources remain unread |
| File content, not only metadata | Mostly missing | `canvas-documents.js`: `enrichCourseDocuments`, `extractDocumentText`; text/HTML/CSV/TSV, DOCX, public Google Docs and optional PDF text extraction | OCR, handwriting, image-only PDFs, legacy DOC, spreadsheets, slides, authenticated external docs remain unsupported |
| Learner-effective deadline precedence | Covered | `normalizeAssignment`, `public/canvas-deadlines.js`: `resolveCourseDeadlines`; official `dueAt` preserved; no borrowing other learners' `all_dates` | Conflicts and explicit undated learner overrides need human review |
| Fill missing planning dates from syllabus/instructions | Missing | `resolveCourseDeadlines`; exact assignment title/ID matching, term/section checks, evidence, revision conflicts, date-only precision, timezone and DST validation | Ambiguous relative dates, copied terms, date ranges and incomplete source content stay reviewable |
| Syllabus-only work without Canvas assignments | Missing | `resolveCourseDeadlines` emits separate `planningTasks`; `buildInsights` includes explicit dated tasks, with no invented Canvas ID, grades or completion | Learner confirmation/editing of extracted tasks would improve difficult schedules |
| Deduplicate placements while retaining organization | Partial | Collector `sources` graph connects canonical course/type/ID records to module placements; assignment groups and independent assignment index merged | Cross-source equivalence beyond exact identity remains conservative |
| Submission completion and grading | Partial | Own-user submission history, feedback and rubrics; documented submission states; `buildInsights` excludes excused work and preserves unknowns | Canvas remains the authority for scores; syllabus tasks have unverified completion |
| Source-aware coaching | Partial, bounded on-demand retrieval | `study-coach-context.js`: `loadStudyCoachContext`; reuses collected bodies/documents, separately labels planning deadlines and read states; `server.js` retains discovered locations | Coach context is still bounded; source coverage details disclose omissions |
| Saved schedules, progress and reminders | Missing | `study-plans.js`: `update`; `public/plan-schedule.js`: `normalizePlanSchedule`, `planProgress`, `planReminderCandidates`; `public/plan-schedule-ui.js` provides explicit save and opt-in | Browser/in-app reminders require the app to remain open; no push/email/SMS or closed-app delivery |
| Consistent current time | Missing shared source | `public/time-context.js`: `createAppClock`; authenticated `/api/time`; header, plan progress/reminders and server coach context share timezone/clock conventions | Device fallback is labeled; server time accuracy depends on deployment clock |

## Collection behavior and limits

`server.js` serializes collection within each Canvas credential session. An unfinished cycle resumes on later refreshes; a finished cycle starts fresh next time. Credential changes invalidate access to prior session results. The normal client refresh remains every five minutes while visible, and a learner can refresh manually.

Each pass has 180 authenticated collection requests and a 45-second budget; each list advances at most five pages per pass. Raw collection has explicit 24 MB/session, 10,000 records/source and 200-course safety ceilings. Current courses are prioritized. Capacity-limited data is disclosed and is not falsely marked complete. Unfinished raw-state cycles restart after 15 minutes; deployments needing very large institutions should move cursors and normalized records to durable background jobs.

Document collection has a separate shared 20-second/eight-read pass, at most three new reads per course, and rotates starting courses. Matching file versions reuse extracted text for at most six hours; changed source content, file timestamps and locks invalidate it. Unverified older text is labeled unread and cannot silently become a current deadline. Downloads are capped at 8 MB, server extraction at 60,000 characters/document and snapshot extracted text at 8 MB. Signed download URLs and credentials are never retained as citations.

PDF extraction uses an optional local `pdftotext` executable. It is not installed by this change. If unavailable, the file is explicitly unsupported/unread; image content is never claimed as read. DOCX extraction validates ZIP structure, sizes and CRCs. Metadata reads are course-scoped; file bytes use tokenless downloads restricted to the Canvas origin and recognized Instructure file hosts. Public Google Docs use the existing unauthenticated text export.

Completing all supported requests is different from reading every possible instructor artifact. `snapshot.collection.partial`, per-course `collection`, and document `contentStatus` describe that difference. Permission errors, not-found responses, rate limits, truncated sources and unread files remain visible. No Canvas writes, roster harvest, classmates' submissions, grade recomputation or mastery updates are introduced.

## Deadline and schedule semantics

An official Canvas deadline always remains official. A `planningDeadline` is separate sourced evidence. Explicit dates can populate planning when Canvas omits a due date; a missing time does not become 11:59 PM. An explicitly undated learner override, incompatible section/term, contradictory source, ambiguous numeric format, DST gap/overlap, relative deadline or negated date requires review. Syllabus-only rows remain separately labeled tasks with unverified completion.

Plan schedules store UTC instants with the learner's chosen IANA timezone. Local inputs that occur zero or two times during a clock change are rejected. Schedule targets never rewrite instructor deadlines. Actual completion is the fraction of checked steps; elapsed time and suggested pace are separate. Save conflicts preserve canonical records and require refresh rather than silently overwriting another tab. Drafted model text cannot enable schedules or reminders.

Reminder opt-in is persisted per plan. Browser notification permission requires an explicit click, and enabling browser delivery lasts for the open tab. Notifications and pending results are disposed on workspace changes/sign-out. A failed refresh pauses reminder delivery until saved plans can be read again. Background-tab timers can be delayed; closed-app delivery requires future service-worker/push infrastructure.

## Documentation used

Official Instructure Canvas API references were checked for course includes, optional page bodies, assignment overrides, announcement date windows, list pagination/throttling, calendar context and own-submission scope:

- [Courses](https://developerdocs.instructure.com/services/canvas/resources/courses)
- [Assignments](https://developerdocs.instructure.com/services/canvas/resources/assignments)
- [Pages](https://developerdocs.instructure.com/services/canvas/resources/pages)
- [Modules](https://developerdocs.instructure.com/services/canvas/resources/modules)
- [Announcements](https://developerdocs.instructure.com/services/canvas/resources/announcements)
- [Discussion topics](https://developerdocs.instructure.com/services/canvas/resources/discussion_topics)
- [Calendar events](https://developerdocs.instructure.com/services/canvas/resources/calendar_events)
- [Submissions](https://developerdocs.instructure.com/services/canvas/resources/submissions)
- [Files](https://developerdocs.instructure.com/services/canvas/resources/files)
- [Pagination](https://developerdocs.instructure.com/services/canvas/basics/file.pagination)
- [Throttling](https://developerdocs.instructure.com/services/canvas/basics/file.throttling)

## Recommended next changes

The October 12 integration retains the approved Home/Coach interface and
connects Canvas selections to saved Plan and Study context. See
[Learning workspace](learning-workspace.md#canvas-plan-and-study-continuity).

1. Add a learner review screen for ambiguous/source-only tasks and explicit corrections with provenance.
2. Move large pulls into durable resumable jobs, with incremental revisions and deployment metrics.
3. Add opt-in OCR and supported private-document integrations, with equally explicit read/partial states.
4. Add push infrastructure only if reminders must arrive after the browser closes.
