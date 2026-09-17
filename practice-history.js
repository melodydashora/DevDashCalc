// Canonical practice attempts only. No answer keys or client correctness flags.
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,180}$/.test(value);
export function normalizePracticeEvidence(input) {
  if (!input || !safeId(input.attemptId) || !safeId(input.topicId) || !safeId(input.subject)
    || typeof input.correct !== 'boolean' || typeof input.assisted !== 'boolean'
    || ![1, 2, 3].includes(input.difficulty) || !Number.isFinite(Date.parse(input.at))) throw new Error('Invalid canonical practice evidence.');
  return { attemptId: input.attemptId, topicId: input.topicId, subject: input.subject,
    templateId: safeId(input.templateId) ? input.templateId : null, variantId: safeId(input.variantId) ? input.variantId : null,
    difficulty: input.difficulty, correct: input.correct, assisted: input.assisted,
    misconceptionTag: safeId(input.misconceptionTag) ? input.misconceptionTag : null,
    at: new Date(input.at).toISOString(), isReview: Boolean(input.isReview) };
}

export function summarizePracticeHistory(events, now = Date.now()) {
  if (!Array.isArray(events)) throw new Error('Practice history is unavailable.');
  const attempts = new Map();
  for (const input of events) {
    const attempt = normalizePracticeEvidence(input), old = attempts.get(attempt.attemptId);
    // Later assistance can remove independent credit. It can never be undone
    // by retrying an older unassisted event, even across server instances.
    if (old) {
      old.assisted ||= attempt.assisted; old.isReview ||= attempt.isReview;
      continue;
    }
    attempts.set(attempt.attemptId, attempt);
  }
  const topics = new Map();
  for (const row of [...attempts.values()].sort((a, b) => a.at.localeCompare(b.at))) {
    if (!topics.has(row.topicId)) topics.set(row.topicId, { topicId: row.topicId, subject: row.subject, attempts: 0, independentCorrect: 0, incorrect: 0, withHelp: 0, reviews: 0, lastPracticed: null, misconceptionCounts: {} });
    const topic = topics.get(row.topicId);
    topic.attempts++; topic.lastPracticed = row.at;
    if (row.isReview) topic.reviews++;
    else if (!row.correct) { topic.incorrect++; if (row.misconceptionTag) topic.misconceptionCounts[row.misconceptionTag] = (topic.misconceptionCounts[row.misconceptionTag] || 0) + 1; }
    else if (row.assisted) topic.withHelp++;
    else topic.independentCorrect++;
  }
  const result = [...topics.values()].map(topic => {
    const latest = [...attempts.values()].filter(a => a.topicId === topic.topicId && !a.isReview).sort((a, b) => b.at.localeCompare(a.at))[0];
    const needsReview = latest && (!latest.correct || latest.assisted);
    const delay = needsReview ? 1 : 3;
    const reviewAfter = latest ? new Date(Date.parse(latest.at) + delay * 86400000).toISOString() : null;
    return { ...topic, reviewAfter, reviewDue: reviewAfter ? Date.parse(reviewAfter) <= now : false, nextStep: !latest ? 'Try a fresh question to collect independent evidence.' : needsReview ? 'Explain the rule, then try it in a different problem. Revisit it on a later day.' : 'Try a different representation and revisit this topic on a later day.' };
  }).sort((a, b) => Number(b.reviewDue) - Number(a.reviewDue) || b.lastPracticed.localeCompare(a.lastPracticed));
  return { topics: result, retainedCount: attempts.size, recentAttempts: [...attempts.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30),
    notice: 'These are practice observations, not an official SAT score, a diagnosis, or a promise of mastery. Review dates are adjustable suggestions.' };
}
