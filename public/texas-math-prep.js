// Each entry refers to a specific program and school year. Practice topics
// identify examples in the original Algebra bank, not an exam blueprint.
export const TEXAS_ALGEBRA_ASSESSMENTS = [
  {
    id: '2026-27-staar-eoc',
    schoolYear: '2026–27',
    program: 'STAAR end-of-course',
    description: 'These original Algebra I practice topics include examples of the Texas standards below. Use the released questions to see how TEA assesses them.',
    examples: [
      { topicId: 'algebra-linear', text: 'A.5A · Solve linear equations with variables on both sides.' },
      { topicId: 'algebra-quadratics', text: 'A.7B · Connect linear factors of a quadratic to its zeros.' },
      { topicId: 'algebra-exponents', text: 'A.11B · Simplify expressions using exponent laws.' },
    ],
    links: [
      ['TEA Algebra I assessed curriculum (PDF)', 'https://tea.texas.gov/data-reports/staar/2014-algebra-i-assessed-curriculum.pdf'],
      ['Official STAAR released questions', 'https://tea.texas.gov/data-reports/staar/staar-released-test-questions'],
    ],
  },
  {
    id: '2026-27-staar-interim',
    schoolYear: '2026–27',
    program: 'STAAR Interim',
    description: 'Districts can use this optional assessment during 2026–27, its final school year. A STAAR Interim report estimates STAAR performance at the time of testing. Read past results with the guidance for the school year printed on the report.',
    links: [['TEA STAAR Interim guidance', 'https://tea.texas.gov/assessment-and-accountability/assessment-initiatives/staar-interim-assessments']],
  },
  {
    id: '2027-28-sst',
    schoolYear: '2027–28',
    program: 'Student Success Tool (SST)',
    description: 'Texas plans to introduce the Student Success Tool in 2027–28. The calendar also lists a December 2027 STAAR Algebra I window. Check which assessment your school has scheduled for you.',
    links: [
      ['TEA assessment transition guidance', 'https://tea.texas.gov/taa-letters/house-bill-8-update-and-resources'],
      ['TEA 2027–28 testing calendar (PDF)', 'https://tea.texas.gov/data-reports/test-administration/2027-2028-testing-calendar-sst-final.pdf'],
    ],
  },
];
