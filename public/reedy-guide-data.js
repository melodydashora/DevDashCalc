// Shared school guidance only. Personal schedules, preferences and records belong
// in the learner's existing workspace, never in this general reference module.

export const guideMeta = {
  title: 'Reedy planning guide',
  reviewedAt: '2026-11-19',
  schoolYear: '2027–28',
  term: 'Fall 2027',
  disclaimer: 'Independent planning guide, not an official Reedy High School or Collin College service. This is a dated guidance snapshot, not a live school feed. Verify current instructions and student-specific eligibility before acting.',
};

export const guideSources = [
  {
    id: 'reedy-fall-2027',
    title: 'Collin Dual Credit Enrollment Process—Fall 2027',
    date: '2026-11-18',
    url: null,
    kind: 'School bulletin',
    scope: 'General Reedy instructions supplied for this guide. Includes new and continuing student steps and Fall 2027 deadlines. The original email is not distributed here.',
  },
  {
    id: 'reedy-career-2027',
    title: '4 Year Plan Updates and Course Registration Details for 2027–28',
    date: '2026-11-03',
    url: null,
    kind: 'School bulletin',
    scope: 'General Reedy Career Plan instructions supplied for this guide. Establishes the HAC closing time, individual verification window and final course-request deadline.',
  },
  {
    id: 'reedy-spring-2027',
    title: 'Collin Dual Credit—Semester 2 payment deadline',
    date: '2026-11-09',
    url: null,
    kind: 'School bulletin',
    scope: 'General Spring 2027 billing guidance supplied for this guide. A student must check actual registration, charges and applicable waivers; receipt of a notice is not proof of an individual balance.',
  },
  {
    id: 'collin-frisco',
    title: 'Collin College: Frisco ISD dual credit',
    date: '2026-11-19',
    url: 'https://www.collin.edu/dual-credit/schools/frisco-isd',
    kind: 'Official guidance',
    scope: 'Reviewed November 19, 2026. School approval, account setup, applicable holds, staff-coordinated registration, Workday schedule review and payment. School deadlines may be earlier than College-wide dates.',
  },
  {
    id: 'collin-access',
    title: 'Collin ACCESS: dual-credit FAQ',
    date: '2026-11-19',
    url: 'https://www.collin.edu/studentresources/disabilityservices/dualcredit',
    kind: 'Official guidance',
    scope: 'Reviewed November 19, 2026. Student-led college accommodations, the CWID prerequisite and student consent for parental involvement.',
  },
  {
    id: 'collin-calendar-2027',
    title: 'Collin College 2027–2028 academic calendar',
    date: '2026-02-23',
    url: 'https://www.collin.edu/calendars/pdfs/2027-28-academic-calendar.pdf',
    kind: 'Official calendar',
    scope: 'Document dated February 23, 2026. General Fall 2027 calendar; census and withdrawal dates here apply to standard 16-week sections. Confirm the actual section schedule.',
  },
];

export const guideTopics = [
  {
    id: 'eligibility',
    title: 'Start with graduation timing and eligibility',
    category: 'career',
    audiences: ['new', 'returning'],
    summary: 'Confirm that high-school dual credit is the relevant route for the term you are planning.',
    steps: [
      'Check current grade, expected graduation date and remaining graduation requirements.',
      'If graduation is expected before Fall 2027, ask which post-graduation college enrollment process applies instead.',
      'Review the current transcript and Career Plan with the school counselor before choosing courses.',
    ],
    needed: ['Current student record and transcript', 'Expected graduation date', 'Counselor confirmation of the applicable enrollment route'],
    sourceIds: ['reedy-career-2027', 'collin-frisco'],
    keywords: ['who can take', 'eligible', 'eligibility', 'senior', 'graduation', 'graduate', 'grade', 'after high school', 'before choosing'],
  },
  {
    id: 'ap-and-dual-credit',
    title: 'Compare AP and dual-credit options',
    category: 'learning',
    audiences: ['new', 'returning'],
    summary: 'Keep an AP course, a proposed dual-credit option and a confirmed college registration as separate records.',
    steps: [
      'List courses already completed, currently in progress and proposed for next year.',
      'Ask the counselor to verify graduation credit, the exact college course rubric, prerequisites and any overlap.',
      'Check the intended college’s credit policy before relying on an AP result or college course for a future degree.',
      'Use the DevCalc library for independent study; browsing a topic does not request or enroll in a school course.',
    ],
    needed: ['Current schedule and completed-credit record', 'Exact proposed course title and code', 'Student preference and workload considerations', 'Receiving college credit policy'],
    sourceIds: ['reedy-career-2027', 'collin-frisco'],
    keywords: ['ap versus dual credit', 'ap vs dual credit', 'compare courses', 'college credit', 'calculus', 'study', 'learning', 'choose', 'choices'],
  },
  {
    id: 'career-plan',
    title: 'Find the right Career Plan course entries',
    category: 'career',
    audiences: ['new', 'returning'],
    summary: 'Reedy identifies dual-credit requests with MCOL or COLM course codes in Career Plan.',
    steps: [
      'Review the 2027–28 Career Plan in HAC with the student and family.',
      'Record the exact MCOL or COLM entry for any proposed dual-credit course; ask the counselor if the entry is unclear.',
      'HAC closes for these changes on December 18, 2026 at 5 p.m. Central.',
      'The entries roll into next year’s course requests over winter break. A planning note in this guide does not change HAC.',
    ],
    needed: ['Dated 2027–28 Career Plan view', 'Exact subject, title and MCOL/COLM code', 'Student preference and family decision before a requested change'],
    sourceIds: ['reedy-career-2027', 'reedy-fall-2027'],
    keywords: ['hac', 'home access center', 'career plan', 'four year', '4 year', 'mcol', 'colm', 'when closes', 'deadline', 'request courses', 'course requests'],
  },
  {
    id: 'new-or-returning',
    title: 'Choose the new or returning student route',
    category: 'enrollment',
    audiences: ['new', 'returning'],
    summary: 'Reedy says students already in dual credit who want to continue do not need to reapply.',
    steps: [
      'Verify actual prior or current dual-credit enrollment and account status before selecting a route.',
      'Returning students check their MCOL/COLM requests and meet with the counselor. Reedy lists no further routine enrollment steps until payment is due.',
      'New students follow the application, CWID, student and parent permission, applicable hold and registration process.',
      'Ask about account-specific issues rather than assuming a CWID or declared program alone proves returning enrollment.',
    ],
    needed: ['Prior/current college schedule or transcript', 'Current account status', 'School confirmation if the route is uncertain'],
    sourceIds: ['reedy-fall-2027'],
    keywords: ['new versus returning', 'new vs returning', 'continuing', 'already enrolled', 'reapply', 'apply again', 'which route', 'student status'],
  },
  {
    id: 'application',
    title: 'New-student application timing and steps',
    category: 'enrollment',
    audiences: ['new'],
    summary: 'The school’s Fall 2027 ApplyTexas deadline is March 2, 2027. The resulting CWID is needed for permission forms.',
    steps: [
      'First confirm new-student status, school approval and the correct college and entry term.',
      'Review the ApplyTexas application details before any separate submission.',
      'Keep admissions and CWID emails, which may arrive separately. Check the student’s inbox and junk folder.',
      'Prepare early enough to receive the CWID before completing the dependent permission workflow.',
    ],
    needed: ['Confirmed new-student route', 'Correct institution and term', 'Reviewed application information', 'Admissions emails and CWID when issued'],
    sourceIds: ['reedy-fall-2027'],
    keywords: ['when apply', 'application deadline', 'applytexas', 'apply texas', 'admission', 'admissions', 'cwid', 'college id', 'new student', 'march 2'],
  },
  {
    id: 'permission-forms',
    title: 'Student and parent permission forms',
    category: 'enrollment',
    audiences: ['new'],
    summary: 'The student workflow comes first; the parent form follows. Reedy’s permission deadline is March 2, 2027.',
    steps: [
      'Watch for FISD workflow emails beginning in January, including junk folders.',
      'The student needs the CWID to complete the student electronic permission form, even if the form email arrives first.',
      'After the student completes that step, the first guardian in the school record receives the parent form.',
      'Confirm Parent Portal access and review the actual terms before signing. This guide provides no signature or consent.',
    ],
    needed: ['CWID', 'Authentic student workflow email', 'Correct first guardian in the school record', 'Parent Portal access', 'Actual permission terms for review'],
    sourceIds: ['reedy-fall-2027'],
    keywords: ['permission forms', 'permission slip', 'student form', 'parent form', 'guardian', 'signature', 'workflow', 'portal', 'when due', 'march 2'],
  },
  {
    id: 'holds',
    title: 'Review applicable Collin holds',
    category: 'enrollment',
    audiences: ['new', 'returning'],
    summary: 'Reedy’s new-student instructions set April 2, 2027 for applicable holds. Check what actually blocks the student’s registration.',
    steps: [
      'Review the account’s specific hold names and placement or prerequisite requirements.',
      'Check safety-training status and any required documentation.',
      'Collin notes that school-managed permission holds can remain visible; not every visible hold is a registration error.',
      'Campus immunization requirements depend on where the course meets. Ask about the actual course location before assuming a requirement applies.',
    ],
    needed: ['Exact Workday hold names', 'Placement/TSIA evidence or applicable exemption', 'Course prerequisites', 'Delivery location and applicable documentation'],
    sourceIds: ['reedy-fall-2027', 'collin-frisco'],
    keywords: ['hold', 'holds', 'blocked', 'registration error', 'tsi', 'tsia', 'tsia2', 'safety training', 'meningitis', 'immunization', 'april 2'],
  },
  {
    id: 'counselor-verification',
    title: 'Meet with the counselor and verify requests',
    category: 'career',
    audiences: ['new', 'returning'],
    summary: 'Individual verification runs January 11–February 5, 2027. Course requests are finalized February 11.',
    steps: [
      'Confirm the student’s individual appointment within the school’s verification window.',
      'Bring course selections, remaining requirements, questions and backup preferences.',
      'Discuss period and location choices at the meeting; Reedy says these do not need to be selected during the initial Career Plan review.',
      'Reconcile the resulting requests before February 11, 2027. Confirm any later exception with the school rather than assuming it applies.',
    ],
    needed: ['Appointment confirmation', 'Current Career Plan and transcript', 'Exact proposed course codes', 'Period/location preferences and backup choices'],
    sourceIds: ['reedy-career-2027', 'reedy-fall-2027'],
    keywords: ['counselor meeting', 'appointment', 'one on one', '1 on 1', 'verification', 'when meet', 'schedule changes', 'final requests', 'february 11', 'location', 'period'],
  },
  {
    id: 'registration',
    title: 'School-coordinated college registration',
    category: 'enrollment',
    audiences: ['new', 'returning'],
    summary: 'School and Collin staff coordinate partnering-student registration. Review the resulting Workday schedule.',
    steps: [
      'Verify that the school has the intended course requests and required enrollment steps are resolved.',
      'Wait for the actual registration confirmation rather than treating a request as a registered seat.',
      'Compare the student, term, course, section and delivery format in Workday with the agreed plan.',
      'Record any discrepancy for the school counselor before a separate payment decision.',
    ],
    needed: ['School-approved request list', 'College registration confirmation', 'Student-specific Workday schedule', 'Exact term, section and delivery format'],
    sourceIds: ['reedy-fall-2027', 'collin-frisco'],
    keywords: ['who registers', 'register classes', 'registration', 'registered', 'workday', 'schedule', 'seat', 'section', 'confirmation'],
  },
  {
    id: 'costs',
    title: 'Fall tuition, fees and payment review',
    category: 'costs',
    audiences: ['new', 'returning'],
    summary: 'Reedy’s Fall 2027 tuition and fee deadline is May 7, 2027. The amount owed must come from the student’s actual account.',
    steps: [
      'Check registration and an itemized bill for the correct student and term.',
      'Review tuition, books, other fees and any applicable waiver or payment arrangement.',
      'Use the school’s deadline even if a general College payment date is later.',
      'Make any payment or book-bundle decision separately. This guide does not authorize or process payment.',
    ],
    needed: ['Correct registered course/term', 'Itemized tuition, books and other fees', 'Confirmed waiver and balance status', 'A separate payment decision'],
    sourceIds: ['reedy-fall-2027', 'collin-frisco'],
    keywords: ['when pay', 'payment deadline', 'tuition', 'fees', 'cost', 'costs', 'books', 'waiver', 'balance', 'may 7'],
  },
  {
    id: 'spring-cycle',
    title: 'Keep Spring 2027 separate from Fall planning',
    category: 'costs',
    audiences: ['new', 'returning'],
    summary: 'The November 9 notice sets December 9, 2026 for Spring 2027 payment. It is a different cycle from the May 7 Fall deadline.',
    steps: [
      'Verify whether the student has Spring 2027 registered courses and an actual balance.',
      'The notice says the Spring book-bundle opt-out opens December 8, 2026; it does not establish the closing date.',
      'Check required course materials, itemized charges and any waiver before choosing an opt-out or payment.',
      'Do not infer that payment was made, or is owed, from receipt of a general notice.',
    ],
    needed: ['Student-specific Spring schedule', 'Current itemized balance', 'Book-bundle terms and opt-out closing date', 'Confirmation of any applicable waiver'],
    sourceIds: ['reedy-spring-2027'],
    keywords: ['spring 2027', 'current term', 'future term', 'semester 2', 'december 9', 'december 8', 'book bundle', 'opt out', 'when pay'],
  },
  {
    id: 'support',
    title: 'Plan college accommodations with ACCESS',
    category: 'support',
    audiences: ['new', 'returning'],
    summary: 'High-school accommodations do not automatically transfer to college courses. Collin’s process is student-led.',
    steps: [
      'After receiving a CWID, the student can begin the ACCESS process; Collin encourages early planning.',
      'Identify the requested supports and ask which documentation is required.',
      'Arrange parent involvement with the student’s consent and participation.',
      'Keep requested supports separate from the college’s approved accommodations.',
    ],
    needed: ['CWID', 'Student’s requested supports', 'Required documentation', 'Student consent where needed', 'ACCESS review and approval status'],
    sourceIds: ['collin-access'],
    keywords: ['supports', 'support', 'access', 'accommodations', 'disability services', '504', 'iep', 'parent consent', 'when apply'],
  },
];

export const guideDeadlines = [
  {
    id: 'spring-books', date: '2026-12-08', cycle: 'spring-2027',
    title: 'Spring book-bundle opt-out opens', audience: 'all',
    detail: 'Opening date from the November 9 notice. The opt-out closing date is not established here; verify current terms and course materials.',
    sourceIds: ['reedy-spring-2027'],
  },
  {
    id: 'spring-payment', date: '2026-12-09', cycle: 'spring-2027',
    title: 'Spring 2027 payment deadline', audience: 'all',
    detail: 'Separate from Fall 2027. Verify the student’s Spring registration, actual balance, fees and any waiver before deciding.',
    sourceIds: ['reedy-spring-2027'],
  },
  {
    id: 'career-closes', date: '2026-12-18', time: '5 p.m. Central', cycle: 'fall-2027',
    title: 'Career Plan closes in HAC', audience: 'all',
    detail: 'For students planning the 2027–28 Reedy school year. Entries become course requests over winter break.',
    sourceIds: ['reedy-career-2027'],
  },
  {
    id: 'counselor-window', date: '2027-01-11', endDate: '2027-02-05', cycle: 'fall-2027',
    title: 'Individual counselor verification window', audience: 'all',
    detail: 'Confirm the student’s actual appointment. Review selections, graduation fit, period and location.',
    sourceIds: ['reedy-career-2027', 'reedy-fall-2027'],
  },
  {
    id: 'final-requests', date: '2027-02-11', cycle: 'fall-2027',
    title: 'Course requests finalized', audience: 'all',
    detail: 'The school describes limited exceptions afterward. Verify applicability with the counselor before relying on an exception.',
    sourceIds: ['reedy-career-2027'],
  },
  {
    id: 'new-application-permission', date: '2027-03-02', cycle: 'fall-2027',
    title: 'New-student application and permission forms due', audience: 'new',
    detail: 'ApplyTexas and student/parent permission steps share this deadline. The CWID is required before completing the student workflow.',
    sourceIds: ['reedy-fall-2027'],
  },
  {
    id: 'new-holds', date: '2027-04-02', cycle: 'fall-2027',
    title: 'Applicable new-student holds resolved', audience: 'new',
    detail: 'Verify blocking holds, placement and required documents with Collin. Some school-managed permission holds can remain visible.',
    sourceIds: ['reedy-fall-2027', 'collin-frisco'],
  },
  {
    id: 'fall-payment', date: '2027-05-07', cycle: 'fall-2027',
    title: 'Fall 2027 tuition and fees due', audience: 'all',
    detail: 'Reedy’s deadline for new and continuing participants. Student-specific registration, charges and payment status require confirmation.',
    sourceIds: ['reedy-fall-2027'],
  },
  {
    id: 'fall-start', date: '2027-08-23', cycle: 'college-2027',
    title: 'Collin Fall classes begin', audience: 'all',
    detail: 'General College calendar. Confirm the actual registered section’s start date and school schedule.',
    sourceIds: ['collin-calendar-2027'],
  },
  {
    id: 'fall-census', date: '2027-09-08', cycle: 'college-2027',
    title: 'Fall 16-week census date', audience: 'all',
    detail: 'Standard 16-week sections only. Confirm session length and section-specific dates.',
    sourceIds: ['collin-calendar-2027'],
  },
  {
    id: 'fall-withdrawal', date: '2027-11-01', cycle: 'college-2027',
    title: 'Fall 16-week withdrawal deadline', audience: 'all',
    detail: 'Standard 16-week sections only. Any withdrawal needs separate review of high-school and college consequences.',
    sourceIds: ['collin-calendar-2027'],
  },
  {
    id: 'fall-finals', date: '2027-12-06', endDate: '2027-12-12', cycle: 'college-2027',
    title: 'Collin Fall final exam week', audience: 'all',
    detail: 'General College exam week. The individual course’s exact exam date is not established by this guide.',
    sourceIds: ['collin-calendar-2027'],
  },
];

export const guideChecklist = [
  { id: 'eligibility', title: 'Verify graduation timing and enrollment eligibility', needed: 'Current grade, expected graduation date, remaining requirements and the applicable Fall 2027 enrollment route.', sourceIds: ['reedy-career-2027', 'collin-frisco'] },
  { id: 'current-records', title: 'Review current courses and earned credit', needed: 'A dated transcript and current schedule; AP and college credit evidence; possible course overlap.', sourceIds: ['reedy-career-2027'] },
  { id: 'career-codes', title: 'Check exact MCOL/COLM entries in Career Plan', needed: 'Student, term, exact course code/title and whether the entry is already present.', sourceIds: ['reedy-fall-2027'] },
  { id: 'route', title: 'Confirm new or returning dual-credit status', needed: 'Actual prior/current college enrollment and account status, not just an application or CWID.', sourceIds: ['reedy-fall-2027'] },
  { id: 'choice', title: 'Record preferences before any course change', needed: 'Student preference, family decision, graduation fit, prerequisites, preferred format and a backup option.', sourceIds: ['reedy-career-2027', 'collin-frisco'] },
  { id: 'meeting', title: 'Prepare the counselor verification questions', needed: 'Appointment confirmation, course list, period/location options and any unresolved discrepancy.', sourceIds: ['reedy-career-2027', 'reedy-fall-2027'] },
  { id: 'support', title: 'Plan any college support requests', needed: 'Requested supports, documentation needed, student participation/consent and ACCESS approval status.', sourceIds: ['collin-access'] },
  { id: 'costs', title: 'Review registration and costs before payment', needed: 'Workday section schedule, itemized tuition/books/fees, applicable waivers, exact balance and a separate payment decision.', sourceIds: ['reedy-fall-2027', 'collin-frisco'] },
];

/** Return a new topic list. Every search term must occur in the topic's text. */
export function filterGuideTopics({ query = '', audience = 'all', category = 'all' } = {}) {
  const terms = String(query).toLocaleLowerCase('en-US').trim().split(/\s+/u).filter(Boolean);
  return guideTopics.filter((topic) => {
    if (audience !== 'all' && !topic.audiences.includes(audience)) return false;
    if (category !== 'all' && topic.category !== category) return false;
    const text = [topic.title, topic.category, topic.summary, ...topic.audiences,
      ...topic.steps, ...topic.needed, ...topic.keywords].join(' ').toLocaleLowerCase('en-US');
    return terms.every((term) => text.includes(term));
  });
}

/** Keep future deadlines and currently open date ranges without mutating data. */
export function upcomingGuideDeadlines(todayISO = '2026-11-19') {
  if (typeof todayISO !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(todayISO)) return [];
  const parsed = new Date(`${todayISO}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== todayISO) return [];
  return guideDeadlines.filter((deadline) => (deadline.endDate || deadline.date) >= todayISO)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
