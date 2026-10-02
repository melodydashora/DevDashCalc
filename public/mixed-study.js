// One question at a time across selected courses. The server owns generation,
// answer keys, grading and adaptation; this view never guesses correctness.
import { apiFetch } from './auth-ui.js';
import { appendTutorInline } from './tutor-text.js';
import { getQuestionModel, mountQuestionModel } from './question-models.js';
const workspaces = new Map();
let nextViewId = 0;

function node(tag, className = '', text = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function button(text, action, className = 'secondary') {
  const el = node('button', className, text); el.type = 'button'; el.addEventListener('click', action); return el;
}

function linkedNode(tag, className, text) {
  const el = node(tag, className); appendTutorInline(el, text); return el;
}

// Author-controlled prompts use a small HTML vocabulary. Preserve its structure
// without copying attributes, executing markup, or enabling embedded resources.
export function appendMixedPrompt(container, value) {
  const allowed = new Set(['p', 'br', 'strong', 'em', 'code', 'sub', 'sup', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td']);
  const stack = [container];
  const decode = (text) => text.replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }[entity]));
  for (const token of String(value ?? '').split(/(<\/?[a-zA-Z][^>]*>)/g)) {
    if (!token) continue;
    const tag = /^<(\/)?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>$/.exec(token);
    if (!tag) {
      if (stack.some(el => el.tagName?.toLowerCase() === 'code')) stack.at(-1).appendChild(document.createTextNode(decode(token)));
      else appendTutorInline(stack.at(-1), decode(token));
      continue;
    }
    if (!allowed.has(tag[2].toLowerCase())) { stack.at(-1).appendChild(document.createTextNode(decode(token))); continue; }
    const name = tag[2].toLowerCase();
    if (tag[1]) {
      const index = stack.findLastIndex((el, index) => index > 0 && el.tagName.toLowerCase() === name);
      if (index > 0) stack.length = index;
    } else {
      const el = node(name); stack.at(-1).appendChild(el);
      if (name !== 'br') stack.push(el);
    }
  }
}

export function mixedSubjectLabel(subject) {
  if (/^physics/.test(String(subject))) return 'AP Physics 1';
  if (subject === 'sat') return 'SAT practice';
  if (subject === 'algebra') return 'Algebra';
  return subject === 'calculus-bc' ? 'AP Calculus BC' : 'Study topic';
}

export function mixedPresetTopicIds(topics, { initialSubject, initialTopicIds } = {}) {
  const known = new Set(topics.map(topic => topic.id));
  if (Array.isArray(initialTopicIds)) {
    const selected = [...new Set(initialTopicIds.filter(id => known.has(id)))];
    if (selected.length) return selected;
  }
  const selected = topics.filter(topic => topic.subject === initialSubject || topic.courseScopes?.includes(initialSubject)).map(topic => topic.id);
  return selected.length ? selected : topics.map(topic => topic.id);
}

export function mixedSummaryAfter(current, incoming) {
  if (!incoming || typeof incoming !== 'object') return current;
  // Received pre-answer coaching can arrive after the answer HTTP response.
  // A response serialized earlier must not restore independent credit.
  if (Number(incoming.attempted) <= Number(current.attempted) && Number(incoming.assisted) < Number(current.assisted)) return current;
  return incoming;
}

export function mixedProviderLabel(model, fallback = false) {
  if (model == null || (typeof model === 'string' && !model.trim())) return 'Verified question generator';
  const names = new Map([
    ['claude-fable-5-1', 'Claude Fable 5.1'], ['claude-opus-5', 'Claude Opus 5'],
    ['gpt-6-astra', 'GPT-6 Astra'], ['gpt-5.6-sol', 'GPT-5.6 Sol'],
  ]);
  const modelId = typeof model === 'string' && /^[a-z0-9][a-z0-9._:-]{0,79}$/i.test(model) ? model : '';
  const providerOnly = /^(?:anthropic|openai|google|gemini)$/i.test(modelId);
  const label = names.get(modelId) || (modelId && !providerOnly ? `AI model: ${modelId}` : 'AI coach (model not reported)');
  return `${label}${fallback ? ' (backup)' : ''}`;
}

function newWorkspace() {
  return { topics: [], topicIds: [], target: 10, difficulty: 1, sessionId: null, question: null, feedback: null, summary: {}, completed: 0, phase: 'setup', reason: '', historyNotice: '', hints: [], hintsRemaining: null, assisted: false, answer: null };
}

function workspaceKey(profile, workspaceId) {
  if (workspaceId == null) return profile;
  // This is a local plan/step namespace, never an API profile or authorization.
  if (typeof workspaceId !== 'string' || workspaceId.length > 140 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?::[a-z0-9_-]+)?$/i.test(workspaceId)) {
    throw new TypeError('Choose a valid saved plan and step for this practice workspace.');
  }
  return `${profile}:${workspaceId}`;
}

/**
 * onQuestionContext(context|null) connects the persistent Astra footer.
 * onAskCoach(message) opens that footer on an explicit learner click.
 * request(path, body, {signal,profileId}) may supply an isolated test transport.
 * cleanup.markAssisted() records received pre-answer help in the current view;
 * the server remains authoritative. Cleanup pauses this in-memory workspace.
 * workspaceId optionally isolates local pause/resume by saved plan UUID and
 * optional :stepId. Requests retain the original authenticated profileId.
 */
export function mountMixedStudy(container, { profileId = 'learner', workspaceId, renderMath, onQuestionContext, onAskCoach, request, initialSubject, initialTopicIds, motion } = {}) {
  const profile = String(profileId); const viewId = `mixed-${++nextViewId}`;
  const key = workspaceKey(profile, workspaceId);
  if (!workspaces.has(key)) workspaces.set(key, newWorkspace());
  const state = workspaces.get(key);
  if (!state.sessionId && state.topics.length && (initialSubject || initialTopicIds)) state.topicIds = mixedPresetTopicIds(state.topics, {initialSubject,initialTopicIds});
  const storageKey = `students4ai-mixed-${key}`;
  let storedDraft = null;
  if (!state.sessionId && !state.topics.length) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (saved && typeof saved.sessionId === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(saved.sessionId)) {
        state.sessionId = saved.sessionId;
        state.target = [0, 5, 10, 15].includes(saved.target) ? saved.target : 10;
        state.difficulty = [1, 2, 3].includes(saved.difficulty) ? saved.difficulty : 1;
        storedDraft = saved.draft;
      }
    } catch { /* Storage is optional. */ }
  }
  const disabledBeforeRequest = new WeakMap();
  let disposed = false; let busy = false; let generation = 0; let pending = null; let retry = null;
  let shell; let region; let status; let toolbar; let topicEditor = null;
  let modelCleanup = null;
  const openedModels = new Set();
  const send = request || (async (path, body, { signal, method }) => {
    const response = await apiFetch(`${path}${path.includes('?') ? '&' : '?'}profile=${encodeURIComponent(profile)}`, {
      method: method || (body ? 'POST' : 'GET'), signal,
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok || result.error) { const error = new Error(result.error || 'The study service could not complete this request.'); error.code = result.code; throw error; }
    return result;
  });
  const math = (el) => { try { renderMath?.(el); } catch { /* Plain text remains available. */ } };
  function persist() {
    try {
      if (!state.sessionId) sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, JSON.stringify({ sessionId: state.sessionId, target: state.target, difficulty: state.difficulty,
        draft: state.question && !state.feedback ? { questionId: state.question.id, index: state.answer } : null }));
    } catch { /* Storage is optional. */ }
  }
  const announce = (text) => { if (!disposed) status.textContent = text; };
  function context() {
    if (!state.question || !['question', 'feedback'].includes(state.phase)) return null;
    return { sessionId: state.sessionId, questionId: state.question.id, topicId: state.question.topicId, subject: state.question.subject,
      phase: state.feedback ? 'after-answer' : 'before-answer', assisted: state.assisted,
      learnerAnswer: state.answer, title: 'Study question' };
  }
  const notifyContext = () => { if (!disposed) onQuestionContext?.(context()); };
  function setBusy(value) {
    busy = value;
    shell.setAttribute('aria-busy', String(value));
    for (const control of shell.querySelectorAll('button, input, select')) {
      if (value) { disabledBeforeRequest.set(control, control.disabled); control.disabled = true; }
      else control.disabled = disabledBeforeRequest.get(control) ?? control.disabled;
    }
  }
  async function operation(task, waiting, success) {
    if (disposed || busy) return;
    const own = ++generation; pending = new AbortController(); retry = () => operation(task, waiting, success);
    setBusy(true); announce(waiting);
    try {
      const result = await task(pending.signal);
      if (disposed || own !== generation) return;
      if (result?.error) throw new Error(result.error);
      retry = null; busy = false; success(result); persist(); render();
    } catch (error) {
      if (disposed || own !== generation) return;
      setBusy(false); announce(error.message || 'The request did not finish. Your current work is still here.');
      if (error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_LIMIT' && state.sessionId) {
        retry = null;
        status.appendChild(button('Start a new session', () => { state.sessionId = null; reset(); })); return;
      }
      const retryButton = button('Try again', () => { retryButton.remove(); retry?.(); });
      status.appendChild(document.createTextNode(' ')); status.appendChild(retryButton);
    } finally { if (own === generation) pending = null; }
  }
  function api(path, body, signal) { return send(`/api/mixed/${path}`, body, { signal, profileId: profile }); }
  function summary(result) {
    if (result?.summary && typeof result.summary === 'object') {
      state.summary = mixedSummaryAfter(state.summary, result.summary);
      if (Number.isFinite(state.summary.attempted)) state.completed = state.summary.attempted;
    }
  }
  function currentTopic() { return state.topics.find((topic) => topic.id === state.question?.topicId); }
  function focusTitle() { region.querySelector('h2')?.focus(); }

  function acceptQuestion(result) {
    if (typeof result.historyNotice === 'string') state.historyNotice = result.historyNotice;
    const q = result.question;
    if (!q || typeof q.id !== 'string' || typeof q.prompt !== 'string' || !Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > 8) throw new Error('The question was incomplete. Try again to load it.');
    const sameQuestion = state.question?.id === q.id;
    state.answer = sameQuestion ? state.answer : null;
    state.hints = Array.isArray(q.revealedHints) ? q.revealedHints : sameQuestion ? state.hints : [];
    state.hintsRemaining = Number.isFinite(q.hintsUsed) ? Math.max(0, q.hintsCount - q.hintsUsed) : null;
    state.assisted = Boolean(q.assisted || sameQuestion && state.assisted);
    state.question = q; state.feedback = null;
    state.reason = String(result.selectionReason || 'This question comes from your selected topics.'); state.phase = 'question'; summary(result);
  }
  function reconcile(saved, paused = true) {
    if (typeof saved.historyNotice === 'string') state.historyNotice = saved.historyNotice;
    const draft = state.question ? { questionId: state.question.id, index: state.answer } : storedDraft;
    state.topicIds = saved.topicIds; summary(saved);
    if (saved.question) {
      acceptQuestion(saved); state.feedback = saved.feedback || null;
      state.assisted = Boolean(saved.question.assisted || saved.feedback?.assisted);
      state.answer = saved.feedback?.chosenIndex ?? (draft?.questionId === saved.question.id && Number.isInteger(draft.index) && draft.index >= 0 && draft.index < saved.question.choices.length ? draft.index : null);
    } else { state.question = null; state.feedback = null; }
    state.resumePhase = state.feedback ? 'feedback' : 'question'; state.phase = paused ? 'paused' : state.resumePhase;
  }
  function resume() {
    operation(async (signal) => {
      const saved = await api(`session?sessionId=${encodeURIComponent(state.sessionId)}`, undefined, signal);
      return saved.question ? saved : api('next', { sessionId: state.sessionId }, signal);
    }, 'Restoring your current question and checked progress.', (result) => { reconcile(result, false); queueMicrotask(focusTitle); });
  }
  function nextQuestion(mode = 'adaptive') {
    operation((signal) => api('next', { sessionId: state.sessionId, mode }, signal), mode === 'wording' ? 'Preparing a wording review of the same problem.' : 'Preparing your next question.', (result) => {
      acceptQuestion(result); queueMicrotask(focusTitle);
    });
  }
  function start(topicIds, target, difficulty) {
    const requestId = crypto.randomUUID();
    operation(async (signal) => {
      const session = await api('session', { topicIds, difficulty, requestId }, signal);
      if (!session.sessionId) throw new Error('The study session could not start.');
      state.historyNotice = typeof session.historyNotice === 'string' ? session.historyNotice : '';
      state.sessionId = session.sessionId; state.topicIds = topicIds; state.target = target; state.difficulty = difficulty; state.completed = 0; summary(session); persist();
      return api('next', { sessionId: session.sessionId }, signal);
    }, 'Starting your session and preparing one question.', (result) => { acceptQuestion(result); queueMicrotask(focusTitle); });
  }
  function checkAnswer() {
    const checked = region.querySelector('input[name="mixed-answer"]:checked');
    if (!checked) { announce('Choose an answer, then select Check answer.'); return; }
    const answerIndex = Number(checked.value); state.answer = answerIndex;
    operation((signal) => api('answer', { sessionId: state.sessionId, questionId: state.question.id, answerIndex }, signal), 'Checking your answer.', (result) => {
      if (typeof result.correct !== 'boolean') throw new Error('The answer check was incomplete. Try again.');
      state.feedback = result; state.assisted = Boolean(result.assisted || state.assisted); state.completed = Number.isFinite(result.summary?.attempted) ? result.summary.attempted : state.completed + 1; state.phase = 'feedback'; summary(result);
      queueMicrotask(() => region.querySelector('.mixed-feedback h3')?.focus());
    });
  }
  function hint() {
    operation((signal) => api('hint', { sessionId: state.sessionId, questionId: state.question.id }, signal), 'Opening a hint for this question.', (result) => {
      const text = typeof result.hint === 'string' ? result.hint : result.hint?.text;
      if (typeof text !== 'string' || !text.trim()) throw new Error('No hint was returned. Your answer is unchanged.');
      state.hints.push(text); state.assisted = true;
      if (Number.isFinite(result.hintsRemaining)) state.hintsRemaining = result.hintsRemaining;
    });
  }
  function pause() { state.resumePhase = state.phase; state.phase = 'paused'; render(); }
  function finish() { state.phase = 'complete'; render(); focusTitle(); }
  function reset() {
    const topics = state.topics; const selected = state.topicIds;
    if (state.sessionId) send(`/api/mixed/session?sessionId=${encodeURIComponent(state.sessionId)}`, undefined, { method: 'DELETE', profileId: profile }).catch(() => {});
    Object.assign(state, newWorkspace(), { topics, topicIds: selected }); persist(); render();
  }

  function makeTopicPicker(selectedIds, { editing = false } = {}) {
    const form = node('form', 'mixed-topic-form');
    const intro = node('p', 'mixed-muted', editing ? 'Changes apply to the next question. Finish the question already on screen first.' : 'Select the topics you want to practise.');
    form.appendChild(intro);
    const groups = node('div', 'mixed-topic-groups');
    for (const subject of ['algebra','physics','calculus-bc','sat']) {
      const topics = state.topics.filter((topic) => topic.subject === subject);
      if (!topics.length) continue;
      const group = node('fieldset', `mixed-topic-group mixed-${subject}`);
      group.appendChild(node('legend', '', mixedSubjectLabel(subject)));
      const groupActions = node('div', 'mixed-topic-shortcuts');
      const chooseGroup = (value) => { for (const box of group.querySelectorAll('input')) box.checked = value; };
      groupActions.append(button('Select all', () => chooseGroup(true), 'quiet'), button('Clear', () => chooseGroup(false), 'quiet'));
      group.appendChild(groupActions);
      for (const topic of topics) {
        const label = node('label', 'mixed-topic-option'); const input = node('input'); input.type = 'checkbox'; input.value = topic.id; input.name = 'topic'; input.checked = selectedIds.includes(topic.id);
        const copy = node('span'); copy.appendChild(node('span', 'mixed-topic-title', String(topic.title)));
        if (topic.description) copy.appendChild(node('small', '', (subject === 'sat' ? `${topic.domainGroup}: ` : '') + String(topic.description)));
        label.append(input, copy); group.appendChild(label);
      }
      groups.appendChild(group);
    }
    form.appendChild(groups);
    let length; let level;
    if (!editing) {
      const options = node('div', 'mixed-session-options');
      const lengthLabel = node('label', '', 'Session length'); length = node('select'); length.id = `${viewId}-length`;
      for (const [value, text] of [[5, '5 questions'], [10, '10 questions'], [15, '15 questions'], [0, 'Continue until I finish']]) { const option = node('option', '', text); option.value = value; option.selected = state.target === value; length.appendChild(option); }
      lengthLabel.appendChild(length);
      const levelLabel = node('label', '', 'Starting level'); level = node('select'); level.id = `${viewId}-level`;
      for (const [value, text] of [[1, 'Build the idea'], [2, 'Apply the idea'], [3, 'Connect ideas']]) { const option = node('option', '', text); option.value = value; option.selected = state.difficulty === value; level.appendChild(option); }
      levelLabel.appendChild(level); options.append(lengthLabel, levelLabel); form.appendChild(options);
    }
    const error = node('p', 'mixed-selection-status'); error.setAttribute('role', 'status'); form.appendChild(error);
    const submit = node('button', '', editing ? 'Apply topic changes' : 'Start study'); submit.type = 'submit';
    const row = node('div', 'btn-row'); row.appendChild(submit);
    if (editing) row.appendChild(button('Cancel', () => { topicEditor.remove(); topicEditor = null; }));
    form.appendChild(row);
    form.addEventListener('submit', (event) => {
      event.preventDefault(); if (busy) return;
      const topicIds = [...form.querySelectorAll('input[name="topic"]:checked')].map((input) => input.value);
      if (!topicIds.length) { error.textContent = 'Select at least one topic before continuing.'; return; }
      if (editing) operation((signal) => api('topics', { sessionId: state.sessionId, topicIds }, signal), 'Updating the topics for your next question.', (result) => { state.topicIds = result.topicIds || topicIds; summary(result); topicEditor = null; });
      else start(topicIds, Number(length.value), Number(level.value));
    });
    return form;
  }

  function practiceGuide() {
    const details = node('details', 'mixed-details mixed-practice-guide');
    details.appendChild(node('summary', '', 'How practice works'));
    const rules = node('ul', 'mixed-rules');
    for (const text of [
      'Choose 5, 10 or 15 questions, or continue until you decide to finish. There is no pass mark or required timer.',
      'Select an answer, then Check answer. Read the feedback before choosing Next question. Questions never advance on their own.',
      'After a wrong answer, practise the same idea again. Two correct answers without help can raise the practice level. Some passages stay at one level.',
      'Hints, learning examples and Astra explanations received before checking are recorded as help. They do not count as independent correct answers.',
      'More practice options lets you review the same problem with new wording or try another challenge. Repeated problems are labeled and do not add independent credit.',
      'Pause or finish whenever you need. You can return to this session for up to six hours, unless the service restarts.',
      'This is practice, not an official AP or SAT score or an independent mastery check. SAT practice includes Math and Reading and Writing topics; it is not a complete SAT course.',
      'Decimal answer choices are rounded to eight significant digits.',
    ]) rules.appendChild(node('li', '', text));
    details.appendChild(rules); return details;
  }
  function renderSetup() {
    const panel = node('section', 'card mixed-setup');
    panel.appendChild(node('h2', '', 'Choose topics'));
    panel.appendChild(node('p', 'mixed-setup-intro', 'Work on one subject or select a mix. You choose when to check an answer and move to the next question.'));
    panel.appendChild(practiceGuide());
    panel.appendChild(makeTopicPicker(state.topicIds)); region.appendChild(panel);
  }
  function renderProgress() {
    const strip = node('div', 'mixed-progress-strip');
    const count = node('p', 'mixed-count', `${state.completed} ${state.target ? `of ${state.target}` : ''} answered`);
    strip.appendChild(count);
    if (state.target) { const progress = node('progress'); progress.max = state.target; progress.value = Math.min(state.target, state.completed); progress.setAttribute('aria-label', 'Questions answered'); strip.appendChild(progress); }
    const tags = node('div', 'mixed-progress-tags');
    const independent = Number(state.summary.independentCorrect ?? state.summary.cleanCorrect);
    const assisted = Number(state.summary.assisted ?? state.summary.assistedCount);
    if (Number.isFinite(independent)) tags.appendChild(node('span', '', `${independent} independent correct`));
    if (Number.isFinite(assisted)) tags.appendChild(node('span', '', `${assisted} with help`));
    if (state.summary.reviewed) tags.appendChild(node('span', '', `${state.summary.reviewed} review answers`));
    region.appendChild(strip);
    if (tags.children.length) {
      const details = node('details', 'mixed-details mixed-progress-details');
      details.append(node('summary', '', 'Session progress'), tags); region.appendChild(details);
    }
  }
  function renderQuestion() {
    renderProgress();
    const question = state.question; const topic = currentTopic();
    const card = node('section', `card mixed-question mixed-${question.subject}`);
    const top = node('div', 'mixed-question-top');
    top.append(node('span', 'mixed-subject-tag', mixedSubjectLabel(question.subject)), node('span', 'mixed-level-tag', topic?.adaptiveDifficulty === false ? 'Starter passage set' : `Practice level ${question.difficulty || 1} of 3`)); card.appendChild(top);
    const heading = node('h2', '', topic?.title || 'Study question'); heading.tabIndex = -1; card.appendChild(heading);
    const about = node('details', 'mixed-details mixed-question-details');
    about.appendChild(node('summary', '', 'About this question'));
    const why = node('div', 'mixed-why'); why.append(node('strong', '', 'Why this question'), linkedNode('p', '', state.reason)); about.appendChild(why);
    const prompt = node('div', 'mixed-prompt'); appendMixedPrompt(prompt, question.prompt); card.appendChild(prompt);
    if (question.reviewOnly) {
      card.appendChild(node('p', 'mixed-review-note', 'Review question: this does not count as a new independent answer or change your practice level.'));
      about.open = true;
    }
    const model = node('div', 'mixed-question-model'); card.appendChild(model);
    const descriptor = getQuestionModel(question);
    if (descriptor?.mode === 'givens' || state.feedback || openedModels.has(question.id)) modelCleanup = mountQuestionModel(model, {question,motion});
    else if (descriptor) {
      model.appendChild(button('Explore a learning model', () => operation(
        signal => api('assisted', {sessionId:state.sessionId,questionId:question.id}, signal),
        'Opening an example for this question.', result => {
          if (result.assisted !== true) throw new Error('Help could not be recorded. Try again to open the learning model.');
          state.assisted = true; summary(result); openedModels.add(question.id);
        })));
      model.appendChild(node('p', 'mixed-muted', 'Opening this example or strategy counts as help for the current answer.'));
    }
    about.appendChild(node('p', 'mixed-source', question.model || question.provider ? `Question wording: ${mixedProviderLabel(question.model || question.provider, question.fallback)}. The answer is checked separately.` : 'This practice question has a checked answer and worked solution.'));
    card.appendChild(about);
    const options = node('fieldset', 'mixed-answer-options');
    options.appendChild(node('legend', 'visually-hidden', 'Choose one answer'));
    question.choices.forEach((choice, index) => {
      const label = node('label', 'mixed-answer-option'); const input = node('input'); input.type = 'radio'; input.name = 'mixed-answer'; input.value = index; input.checked = state.answer === index; input.disabled = Boolean(state.feedback);
      const choiceText = typeof choice === 'string' ? choice : String(choice.text || choice.label || '');
      input.setAttribute('aria-label', `${String.fromCharCode(65 + index)}: ${choiceText}`);
      input.addEventListener('change', () => { state.answer = index; persist(); announce('Answer selected. Select Check answer when ready.'); });
      const letter = node('span', 'mixed-choice-letter', String.fromCharCode(65 + index)); const content = node('span', 'mixed-choice-text', choiceText);
      label.append(input, letter, content); options.appendChild(label);
    });
    card.appendChild(options);
    if (state.hints.length) {
      const hintBox = node('aside', 'mixed-hints'); hintBox.appendChild(node('h3', '', 'Hints used'));
      const list = node('ol'); for (const text of state.hints) list.appendChild(linkedNode('li', '', text)); hintBox.appendChild(list); card.appendChild(hintBox);
    }
    if (!state.feedback) {
      const actions = node('div', 'btn-row'); actions.appendChild(button('Check answer', checkAnswer, ''));
      if (question.hintsCount !== 0 && state.hintsRemaining !== 0) actions.appendChild(button(state.hints.length ? 'Show another hint' : 'Show a hint', hint));
      card.appendChild(actions);
      card.appendChild(node('p', 'mixed-help-note', state.assisted ? 'Help received. This answer will be recorded as assisted.' : 'Hints or a received Astra explanation mark this answer as assisted.'));
    } else {
      const feedback = node('section', `mixed-feedback ${state.feedback.correct ? 'is-correct' : 'is-not-yet'}`);
      const title = node('h3', '', state.feedback.correct ? 'Correct.' : 'Not yet.'); title.tabIndex = -1; feedback.appendChild(title);
      if(state.feedback.historyNotice){
        const notice=node('p','mixed-history-notice',state.feedback.historyNotice);notice.setAttribute('role','status');feedback.appendChild(notice);
        feedback.appendChild(button('Retry saving this answer',()=>operation(signal=>api('answer',{sessionId:state.sessionId,questionId:question.id,answerIndex:state.feedback.chosenIndex},signal),'Saving the checked answer to practice history.',result=>{state.feedback=result;summary(result);})));
      }
      if (state.assisted) feedback.appendChild(node('p', 'mixed-help-note', 'Recorded with help. This practice still guides your next question.'));
      if (state.feedback.misconception) feedback.appendChild(linkedNode('p', '', state.feedback.misconception));
      if (Number.isInteger(state.feedback.answerIndex) && question.choices[state.feedback.answerIndex] !== undefined) feedback.appendChild(node('p', 'mixed-verified-answer', `Answer: ${String.fromCharCode(65 + state.feedback.answerIndex)}. ${question.choices[state.feedback.answerIndex]}`));
      feedback.appendChild(node('h4', '', 'Worked solution'));
      const solution = state.feedback.solution;
      if (Array.isArray(solution)) {
        const list = node('ol');
        for (const step of solution) {
          const item = linkedNode('li', '', typeof step === 'string' ? step : String(step.text || ''));
          if (step && typeof step.math === 'string' && step.math.trim()) item.appendChild(node('div', 'mixed-step-math', `$$${step.math}$$`));
          list.appendChild(item);
        }
        feedback.appendChild(list);
      }
      else feedback.appendChild(linkedNode('div', 'mixed-solution', String(solution || 'The answer has been checked. Ask Astra to explain the steps.')));
      card.appendChild(feedback);
      const actions = node('div', 'btn-row');
      if (state.target && state.completed >= state.target) actions.appendChild(button('See session summary', finish, ''));
      else actions.appendChild(button('Next question', () => nextQuestion('adaptive'), ''));
      card.appendChild(actions);
      const more = node('details', 'mixed-details mixed-more-practice');
      more.appendChild(node('summary', '', 'More practice options'));
      const extraActions = node('div', 'btn-row');
      extraActions.append(button('Same problem, new wording', () => nextQuestion('wording')), button('New challenge on this topic', () => nextQuestion('challenge')));
      more.append(node('p', 'mixed-muted', 'A wording review keeps the same information and answer. A new challenge changes the problem. You may see a labeled repeat when no unused variation is available.'), extraActions);
      card.appendChild(more);
    }
    const coach = node('aside', 'mixed-coach-callout');
    coach.appendChild(node('p', '', 'Ask about this question in the Coach below.'));
    if (onAskCoach) coach.appendChild(button('Ask Astra about this question', () => onAskCoach(state.feedback ? 'Explain the worked solution for this question one step at a time.' : 'Help me understand the idea in this question without giving away the answer.')));
    card.appendChild(coach); region.appendChild(card); math(card);
  }
  function renderPaused() {
    renderProgress(); const card = node('section', 'card mixed-paused'); const title = node('h2', '', 'Session paused'); title.tabIndex = -1;
    card.append(title, node('p', '', 'Your question and selected answer stay here. Resume when you are ready.'));
    const row = node('div', 'btn-row'); row.append(button('Resume session', resume, ''), button('Finish session', finish));
    card.appendChild(row); region.appendChild(card);
  }
  function renderComplete() {
    renderProgress(); const card = node('section', 'card mixed-complete'); const title = node('h2', '', 'Session complete'); title.tabIndex = -1;
    card.append(title, node('p', '', `${state.completed} ${state.completed === 1 ? 'question answered' : 'questions answered'}. This is practice progress, not an AP or SAT score or an independent mastery pass.`));
    if (state.summary.nextStep) card.appendChild(node('p', 'mixed-next-step', String(state.summary.nextStep)));
    if (Array.isArray(state.summary.byTopic)) {
      const list = node('ul', 'mixed-summary-topics');
      for (const result of state.summary.byTopic.filter((item) => item.attempted > 0)) {
        const topic = state.topics.find((item) => item.id === result.topicId);
        const item = node('li'); item.append(node('strong', '', topic?.title || result.topicId), node('span', '', `${result.attempted} answered; ${result.independentCorrect || 0} independent correct; ${result.assisted || 0} with help.`));
        if (result.lastMisconception) item.appendChild(node('p', '', String(result.lastMisconception)));
        list.appendChild(item);
      }
      if (list.children.length) {
        const details = node('details', 'mixed-details mixed-topic-results');
        details.append(node('summary', '', 'Results by topic'), list); card.appendChild(details);
      }
    }
    card.appendChild(node('p', 'mixed-muted', 'Continue with the same topics or choose a different mix.'));
    const row = node('div', 'btn-row'); row.append(button('Choose a new session', reset, ''), button('Continue this session', () => { state.target = 0; nextQuestion(); }));
    card.appendChild(row); region.appendChild(card);
  }
  function render() {
    if (disposed) return;
    modelCleanup?.(); modelCleanup = null;
    container.replaceChildren(); shell = node('section', 'mixed-study'); shell.setAttribute('aria-label', 'Study practice');
    const header = node('div', 'mixed-heading'); header.append(node('h1', '', 'Study'), node('p', '', 'Choose topics. Work through one question at a time.'));
    shell.appendChild(header); toolbar = node('div', 'mixed-toolbar');
    if (state.sessionId && ['question', 'feedback', 'paused'].includes(state.phase)) {
      if (state.phase !== 'paused') toolbar.appendChild(button('Pause session', pause));
      toolbar.appendChild(button('Change topics', () => {
        if (topicEditor) { topicEditor.remove(); topicEditor = null; return; }
        topicEditor = node('section', 'card mixed-topic-editor'); topicEditor.append(node('h2', '', 'Change topics'), makeTopicPicker(state.topicIds, { editing: true })); toolbar.after(topicEditor);
      }));
      if (state.phase !== 'paused') toolbar.appendChild(button('Finish session', finish, 'quiet'));
      toolbar.appendChild(node('span', 'mixed-muted', `${state.topicIds.length} topics selected`));
    }
    shell.appendChild(toolbar);
    if (state.historyNotice) {
      const notice = node('p', 'mixed-session-notice', state.historyNotice); notice.setAttribute('role', 'status'); shell.appendChild(notice);
    }
    region = node('div', 'mixed-content'); shell.appendChild(region);
    status = node('p', 'mixed-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); shell.appendChild(status); container.appendChild(shell);
    topicEditor = null;
    if (!state.topics.length) announce('Loading available topics.');
    else if (state.phase === 'setup') renderSetup();
    else if (state.phase === 'paused') renderPaused();
    else if (state.phase === 'complete') renderComplete();
    else renderQuestion();
    notifyContext();
  }
  render();
  if (!state.topics.length) operation(async (signal) => {
    const result = await api('topics', undefined, signal);
    if (state.sessionId) {
      try { result.restoredSession = await api(`session?sessionId=${encodeURIComponent(state.sessionId)}`, undefined, signal); }
      catch (error) { if (error.code !== 'SESSION_EXPIRED') throw error; state.sessionId = null; persist(); result.expired = true; }
    }
    return result;
  }, 'Loading available topics and any saved session.', (result) => {
    if (!Array.isArray(result.topics) || !result.topics.length) throw new Error('No study topics are available yet. Try again.');
    state.topics = result.topics; state.topicIds = mixedPresetTopicIds(result.topics, {initialSubject,initialTopicIds});
    if (result.restoredSession) {
      reconcile(result.restoredSession);
    }
    if (result.expired) queueMicrotask(() => announce('The previous session expired or the server restarted. Choose topics to start a new session.'));
  });
  else if (state.sessionId) {
    const wasComplete = state.phase === 'complete';
    operation((signal) => api(`session?sessionId=${encodeURIComponent(state.sessionId)}`, undefined, signal), 'Restoring your saved session progress.', (result) => {
      reconcile(result); if (wasComplete) state.phase = 'complete';
    });
  }
  const cleanup = () => {
    if (disposed) return;
    disposed = true; generation += 1; pending?.abort();
    modelCleanup?.(); modelCleanup = null;
    if (['question', 'feedback'].includes(state.phase)) { state.resumePhase = state.phase; state.phase = 'paused'; }
    onQuestionContext?.(null); container.replaceChildren();
  };
  cleanup.markAssisted = (result = {}) => {
    if (disposed || !state.question || result.assisted === false || result.questionId && result.questionId !== state.question.id) return;
    state.assisted = true;
    if (state.feedback) state.feedback.assisted = true;
    summary(result);
    const note = region.querySelector('.mixed-help-note'); if (note) note.textContent = state.feedback ? 'Recorded with help. This practice still guides your next question.' : 'Help received. This answer will be recorded as assisted.';
    if (state.feedback && !note) region.querySelector('.mixed-feedback h3')?.after(node('p', 'mixed-help-note', 'Recorded with help. This practice still guides your next question.'));
    const tags = region.querySelector('.mixed-progress-tags');
    if (tags && result.summary) { tags.replaceChildren(node('span', '', `${state.summary.independentCorrect || 0} independent correct`), node('span', '', `${state.summary.assisted || 0} with help`)); }
  };
  cleanup.getQuestionContext = context;
  return cleanup;
}
