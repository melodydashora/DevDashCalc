// Explicit portal requests can leave an active exercise. Ambiguous follow-ups
// stay with its canonical tutor, including answer-key and assistance rules.
export function coachRequestTarget(message, { hasQuestion = false, hasCourseReference = false } = {}) {
  if (hasCourseReference || !hasQuestion) return 'study';
  const text = String(message || '').toLowerCase();
  if (/\b(?:this|current|the)\s+(?:question|problem|exercise|answer|equation|solution)\b|\b(?:my answer|answer choice|option [a-d]|step \d+)\b/.test(text)) return 'question';
  // lint-ui: allow
  const portal = /\b(?:canvas|my (?:classes|courses|assignments|grades|schedule|study plan|saved plans|saved notes|memories)|study schedule|study plan|coursework|deadlines?|calendar)\b/.test(text)
    // lint-ui: allow
    || /\b(?:what(?:'s| is)?|when is|when are)\b.{0,55}\bdue\b/.test(text)
    || /\b(?:plan my|what (?:should|can|do) i (?:study|work on)|switch (?:my |the )?(?:course|topic|subject))\b/.test(text)
    || /\b(?:remember|forget|save|remove|delete|edit)\b.{0,60}\b(?:about me|my preferences|memory|memories|notes?)\b/.test(text);
  return portal ? 'study' : 'question';
}
