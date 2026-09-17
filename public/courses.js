// Course selection is a view over shared content, never a progress reset.
// AB scope follows College Board's AB/BC Course and Exam Description:
// https://apcentral.collegeboard.org/media/pdf/ap-calculus-ab-and-bc-course-and-exam-description.pdf
export const STUDY_SUBJECTS = [
  { id: 'calculus-bc', label: 'AP Calculus BC', curriculum: true },
  { id: 'calculus-ab', label: 'AP Calculus AB', curriculum: true },
  { id: 'physics', label: 'Physics', curriculum: false },
  { id: 'sat', label: 'SAT practice', curriculum: false },
  { id: 'algebra', label: 'Algebra', curriculum: false },
  { id: 'all', label: 'All courses', curriculum: false },
];

export function normalizeSubjectId(value, fallback = 'calculus-bc') {
  return STUDY_SUBJECTS.some((subject) => subject.id === value) ? value : fallback;
}

export const BC_ONLY_SKILL_IDS = Object.freeze([
  'u6-integration-by-parts', 'u6-partial-fractions', 'u6-improper-integral-limits',
  'u7-euler-method', 'u7-logistic-models', 'u8-arc-length',
]);
const bcSkills = new Set(BC_ONLY_SKILL_IDS);
// Current 2026–27 multiple-choice weights, from the AP Central AB course page.
const abWeights = ['10–15%', '10–15%', '5–10%', '10–15%', '15–20%', '15–20%', '5–10%', '10–15%'];
const abDescriptions = {
  'unit-06': 'Approximate accumulation with Riemann sums and trapezoids, connect definite integrals to antiderivatives with the Fundamental Theorem of Calculus, and integrate using substitution, long division, and completing the square.',
  'unit-07': 'Translate rate descriptions into differential equations, verify solutions, read slope fields, solve separable equations with initial conditions, and model exponential growth and decay.',
  'unit-08': 'Use definite integrals for average value, motion, accumulation, area between curves, and volumes by cross sections, discs, and washers.',
};

function unitInSubject(unit, subjectId) {
  if (subjectId === 'physics' || subjectId === 'sat' || subjectId === 'algebra') return false;
  return subjectId !== 'calculus-ab' || (!unit.bcOnly && unit.number <= 8);
}

function abMetadata(unit) {
  const updated = { ...unit, examWeight: `${abWeights[unit.number - 1]} of AB multiple choice` };
  if (abDescriptions[unit.id]) {
    if ('blurb' in unit) updated.blurb = abDescriptions[unit.id];
    if ('overview' in unit) updated.overview = abDescriptions[unit.id];
  }
  return updated;
}

// Returns visible manifest rows. No source objects are modified.
export function unitsForSubject(manifest, subjectId = 'calculus-bc') {
  const subject = normalizeSubjectId(subjectId);
  return manifest.units.filter((unit) => unitInSubject(unit, subject))
    .map((unit) => subject === 'calculus-ab' ? abMetadata(unit) : unit);
}

// Returns a complete filtered unit, or null when outside the chosen course.
// Keep stable skill/question ids so existing learner history remains useful.
export function unitForSubject(unit, subjectId = 'calculus-bc') {
  const subject = normalizeSubjectId(subjectId);
  if (!unitInSubject(unit, subject)) return null;
  if (subject !== 'calculus-ab') return unit;
  const skills = unit.skills.filter((skill) => !bcSkills.has(skill.id));
  const skillIds = new Set(skills.map((skill) => skill.id));
  const questions = unit.questions.filter((question) => skillIds.has(question.skillId));
  const questionIds = new Set(questions.map((question) => question.id));
  const lessons = unit.lessons.filter((lesson) => lesson.skillIds.some((id) => skillIds.has(id)))
    .map((lesson) => {
      // The authored u7-l5 has exponential concept/example/checkpoint first;
      // all following sections teach logistic growth. Pin that boundary in
      // tests instead of guessing topic membership from free-form prose.
      const abExponentialLesson = lesson.id === 'u7-l5';
      const sections = (abExponentialLesson ? lesson.sections.slice(0, 3) : lesson.sections)
        .map((section) => section.type === 'checkpoint'
          ? { ...section, questionIds: section.questionIds.filter((id) => questionIds.has(id)) } : section)
        .filter((section) => section.type !== 'checkpoint' || section.questionIds.length);
      return {
        ...lesson,
        ...(abExponentialLesson ? { title: 'Exponential growth and decay models', estMinutes: 12 } : {}),
        skillIds: lesson.skillIds.filter((id) => skillIds.has(id)),
        sections,
      };
    });
  return {
    ...abMetadata(unit), skills, questions, lessons,
    ...(Array.isArray(unit.masteryQuestions)
      ? { masteryQuestions: unit.masteryQuestions.filter((question) => skillIds.has(question.skillId)) } : {}),
  };
}

// Canvas names vary by school. Recognize explicit AB/BC markers, but retain
// an unqualified calculus course under either calculus view. A course-id
// selector can always select a course regardless of its name or code.
export function courseMatchesSubject(course, subjectId) {
  const subject = normalizeSubjectId(subjectId, 'all');
  if (subject === 'all') return true;
  const text = `${course?.name || ''} ${course?.courseCode || ''}`;
  if (subject === 'physics') return /physics|\bphys\b/i.test(text);
  if (subject === 'sat') return /\bsat\b|\bpsat\b/i.test(text);
  if (subject === 'algebra') return /\balgebra\b/i.test(text);
  if (!/calculus|\bcalc\b/i.test(text)) return false;
  const hasAB = /\bab\b/i.test(text);
  const hasBC = /\bbc\b/i.test(text);
  return subject === 'calculus-bc' ? !hasAB || hasBC : !hasBC || hasAB;
}
