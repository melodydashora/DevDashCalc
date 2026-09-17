import { apiFetch } from './auth-ui.js';

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const bounded = (value, max = 600) => typeof value === 'string' ? value.slice(0, max) : '';
const label = value => String(value).replace(/^(?:bc|sat|algebra|physics)-/, '').replace(/[-_:]+/g, ' ').replace(/^./, first => first.toUpperCase());

export function practiceInsightRows(value, subject = null) {
  return (Array.isArray(value) ? value : []).filter(row => row && /^[a-z0-9-]{1,80}$/.test(row.topicId || '') && (!subject || row.subject === subject)).slice(0, 60).map(row => ({
    topicId: row.topicId, title: bounded(row.title, 160) || label(row.topicId),
    attempts: count(row.attempts), independentCorrect: count(row.independentCorrect), incorrect: count(row.incorrect), withHelp: count(row.withHelp), reviews: count(row.reviews),
    reviewAfter: typeof row.reviewAfter === 'string' && Number.isFinite(Date.parse(row.reviewAfter)) ? new Date(row.reviewAfter).toLocaleDateString() : null,
    reviewDue: row.reviewDue === true, nextStep: bounded(row.nextStep),
    patterns: Object.entries(row.misconceptionCounts && typeof row.misconceptionCounts === 'object' ? row.misconceptionCounts : {}).filter(([tag, n]) => /^[a-z0-9-]{1,80}$/.test(tag) && count(n) > 0).slice(0, 5).map(([tag, n]) => label(tag) + ' (' + n + ')'),
    href: ['sat', 'algebra'].includes(row.subject) ? '#/mixed/' + row.subject : '#/mixed',
  }));
}

function element(tag, className = '', content = '') {
  const node = document.createElement(tag); if (className) node.className = className; if (content) node.textContent = content; return node;
}

export function mountPracticeInsights(container, { profileId, subject = null, isCurrent = () => true, request = apiFetch } = {}) {
  let disposed = false;
  const controller = new AbortController();
  const current = () => !disposed && container.isConnected && isCurrent();
  const heading = () => element('h2', '', 'Your recent practice patterns');
  container.replaceChildren(heading(), element('p', '', 'Loading saved practice observations.'));
  (async () => {
    try {
      const response = await request('/api/practice-history?profile=' + encodeURIComponent(profileId), { signal: controller.signal, cache: 'no-store' });
      if (!current()) return;
      if (!response.ok) throw new Error('Saved practice observations are unavailable. Reopen this page to try again.');
      const result = await response.json();
      if (!current()) return;
      const rows = practiceInsightRows(result.topics, subject);
      container.replaceChildren(heading(), element('p', 'canvas-meta', 'These observations come from saved practice attempts. They describe practice, not an official test score. Review dates are suggestions; choose when to return.'));
      if (!rows.length) { container.appendChild(element('p', '', 'No practice observations are saved for this view yet. Try a question to start a record you can revisit.')); return; }
      const grid = element('div', 'saved-topic-grid');
      for (const row of rows) {
        const card = element('article', 'card saved-topic-card');
        card.append(element('h3', '', row.title), element('p', '', row.attempts + ' saved attempts: ' + row.independentCorrect + ' correct independently, ' + row.incorrect + ' incorrect, ' + row.withHelp + ' correct with help, and ' + row.reviews + ' review attempts.'));
        if (row.patterns.length) card.appendChild(element('p', '', 'Patterns to revisit: ' + row.patterns.join('; ') + '.'));
        if (row.reviewAfter) card.appendChild(element('p', 'canvas-meta', 'Suggested review ' + (row.reviewDue ? 'available now; planned from ' : 'from ') + row.reviewAfter + '.'));
        if (row.nextStep) card.appendChild(element('p', '', row.nextStep));
        const link = element('a', 'btn secondary', 'Choose follow-up practice'); link.href = row.href; card.appendChild(link);
        grid.appendChild(card);
      }
      container.appendChild(grid);
    } catch (error) {
      if (current() && error.name !== 'AbortError') container.replaceChildren(heading(), element('p', '', 'Saved practice observations are unavailable. Reopen this page to try again.'));
    }
  })();
  return () => { disposed = true; controller.abort(); };
}
