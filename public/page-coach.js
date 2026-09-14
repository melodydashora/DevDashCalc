// Persistent page-level coaching. The host supplies context and transport;
// this module stores conversation only in memory and never writes to Canvas.
const MAX_MESSAGE = 2000;
const MAX_REPLY = 24000;
const QUICK_PROMPTS = ['Help me choose my next step', 'Find my Canvas instructions', 'Explain this page', 'Check missing due dates'];
let nextCoachId = 0;

export function safeCoachHref(value) {
  if (typeof value !== 'string' || value.length > 2048 || value !== value.trim()) return null;
  if (/^#\/(?:home|focus|review|settings|diagnostic|canvas(?:\/(?:plan|grades|assessment|course\/[0-9]+))?|(?:unit|practice|mastery)\/[a-z0-9-]{1,64}|lesson\/[a-z0-9-]{1,64}\/[a-z0-9-]{1,64})$/.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function coachContextLabel(context = {}) {
  const route = String(context.route || '#/home').replace(/^#\//, '').split('/')[0];
  const pages = { home: 'Home', focus: 'Study session', review: 'Review', settings: 'Settings', diagnostic: 'Placement check', canvas: 'Canvas', unit: 'Learning module', lesson: 'Lesson', practice: 'Practice question', mastery: 'Mastery check' };
  const subjects = { 'calculus-bc': 'AP Calculus BC', 'calculus-ab': 'AP Calculus AB', physics: 'Physics', all: 'All courses' };
  const page = typeof context.title === 'string' && context.title.trim() ? context.title.slice(0, 120) : pages[route] || 'Current page';
  return subjects[context.subject] ? `${page} · ${subjects[context.subject]}` : page;
}

export function coachConversationScope(context = {}) {
  return JSON.stringify({
    subject: String(context.subject || ''),
    selectedCourseId: String(context.selectedCourseId || ''),
    questionId: String(context.questionId || ''),
    unitId: context.questionId ? String(context.unitId || '') : '',
    phase: context.questionId ? String(context.phase || context.questionPhase || '') : '',
    itemId: String(context.itemId || ''),
    assignmentId: String(context.assignmentId || ''),
    moduleItemId: String(context.moduleItemId || ''),
    termIds: Array.isArray(context.termIds) ? [...new Set(context.termIds.map(String))].sort() : [],
  });
}

export function coachSourceDetail(value) {
  if (typeof value !== 'string') return '';
  const statuses = { available: 'Read successfully', read_failed: 'Could not read', 'read-failed': 'Could not read', partial: 'Partly read', unavailable: 'Unavailable', not_read: 'Not read', 'not-read': 'Not read', metadata_only: 'File details only', 'metadata-only': 'File details only', 'linked-not-read': 'Link found; content not read', locked: 'Access restricted', truncated: 'Partly read (text limit)', empty: 'Empty source', not_provided: 'No content returned' };
  return value.slice(0, 500)
    .replace(/^(available|read[_-]failed|partial|unavailable|not[_-]read|metadata[_-]only|linked-not-read|locked|truncated|empty|not_provided)\b/, (status) => statuses[status])
    .replace(/ · Read /g, ' · Retrieved ')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, (timestamp) => {
      const date = new Date(timestamp);
      return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : timestamp;
    });
}

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function appendInline(node, text) {
  // A small, text-only Markdown subset. AI text never becomes HTML or links.
  const parts = text.split(/(\*\*[^*\n]+\*\*|\x60[^\x60\n]+\x60)/g);
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) node.appendChild(element('strong', '', part.slice(2, -2)));
    else if (part.startsWith('\x60') && part.endsWith('\x60') && part.length > 2) node.appendChild(element('code', '', part.slice(1, -1)));
    else node.appendChild(document.createTextNode(part));
  }
}

function appendReply(node, text) {
  const pieces = text.split(/\x60{3}(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)\x60{3}/g);
  pieces.forEach((piece, index) => {
    if (index % 2) {
      const pre = element('pre'); pre.appendChild(element('code', '', piece)); node.appendChild(pre);
      return;
    }
    for (const paragraph of piece.split(/\n\s*\n/).filter((part) => part.trim())) {
      const p = element('p'); appendInline(p, paragraph); node.appendChild(p);
    }
  });
}

/**
 * request({ pageContext, message, transcript }, { signal }) resolves to
 * { text, model?, fallback?, sources?: [{label, href?, detail?}], actions?: [{label, href}] }.
 * The second argument lets the host cancel its fetch. Cleanup always ignores
 * late results; call cleanup.refresh() after navigation and remount for a learner.
 * cleanup.ask(message) is for explicit user actions elsewhere on the page;
 * cleanup.focus(message?) opens a draft without submitting it.
 */
export function mountPageCoach(container, { context = () => ({}), request, renderMath } = {}) {
  const id = `page-coach-${++nextCoachId}`;
  let disposed = false;
  let busy = false;
  let generation = 0;
  let pendingController = null;
  let pendingTurn = null;
  let retryTurn = null;
  let lastScope = null;
  const transcript = [];
  const removers = [];
  const on = (target, type, handler) => {
    target.addEventListener(type, handler);
    removers.push(() => target.removeEventListener(type, handler));
  };
  const readContext = () => {
    try {
      const value = context();
      return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
    } catch { return {}; }
  };

  const card = element('section', 'page-coach');
  card.setAttribute('aria-labelledby', `${id}-title`);
  const header = element('div', 'page-coach-heading');
  const title = element('h3', '', 'Astra study coach'); title.id = `${id}-title`;
  const tag = element('span', 'page-coach-tag', 'ONE NEXT STEP');
  header.append(title, tag);
  const intro = element('p', 'page-coach-intro', 'Ask Astra to explain this page, find your school instructions, or help you choose what to do next.');
  const contextLine = element('p', 'page-coach-context');
  const quickRow = element('div', 'page-coach-quick');
  quickRow.setAttribute('aria-label', 'Quick requests for Astra');
  const quickButtons = QUICK_PROMPTS.map((prompt) => {
    const button = element('button', 'secondary', prompt); button.type = 'button';
    on(button, 'click', () => begin(prompt)); quickRow.appendChild(button); return button;
  });
  const log = element('div', 'page-coach-log');
  log.setAttribute('role', 'log'); log.setAttribute('aria-live', 'polite'); log.setAttribute('aria-label', 'Conversation with Astra');
  const form = element('form', 'page-coach-form');
  const label = element('label', '', 'Ask Astra'); label.htmlFor = `${id}-input`;
  const input = element('textarea'); input.id = `${id}-input`; input.rows = 2; input.maxLength = MAX_MESSAGE;
  input.placeholder = 'Describe your task and the part you want help with.';
  input.setAttribute('aria-describedby', `${id}-note`);
  const actions = element('div', 'page-coach-form-actions');
  const send = element('button', '', 'Ask Astra'); send.type = 'submit';
  const cancel = element('button', 'secondary', 'Stop waiting'); cancel.type = 'button'; cancel.hidden = true;
  const retry = element('button', 'secondary', 'Try again'); retry.type = 'button'; retry.hidden = true;
  const status = element('span', 'page-coach-status'); status.setAttribute('role', 'status');
  actions.append(send, cancel, retry, status);
  form.append(label, input, actions);
  const note = element('p', 'page-coach-note', 'You choose the next action. Suggested links open only when you click them. This conversation stays in this tab.'); note.id = `${id}-note`;
  card.append(header, intro, contextLine, quickRow, log, form, note);
  container.replaceChildren(card);

  function refresh() {
    if (disposed) return;
    const pageContext = readContext();
    const scope = coachConversationScope(pageContext);
    if (lastScope !== null && scope !== lastScope) {
      generation += 1; pendingController?.abort(); pendingController = null;
      pendingTurn = null; retryTurn = null; retry.hidden = true;
      transcript.length = 0; log.replaceChildren(); input.value = ''; setBusy(false);
      status.textContent = 'Started a fresh coach conversation for this study context.';
    }
    lastScope = scope;
    contextLine.textContent = `This page: ${coachContextLabel(pageContext)}`;
  }

  function setBusy(value) {
    busy = value;
    send.disabled = value;
    for (const button of quickButtons) button.disabled = value;
    cancel.hidden = !value;
    form.setAttribute('aria-busy', String(value));
  }

  function addMessage(role, text, caption) {
    const bubble = element('article', `page-coach-message ${role}`);
    bubble.appendChild(element('p', 'page-coach-who', role === 'user' ? 'You' : 'Astra'));
    if (caption) bubble.appendChild(element('p', 'page-coach-message-context', caption));
    const content = element('div', 'page-coach-message-content');
    if (role === 'user') content.textContent = text;
    else appendReply(content, text);
    bubble.appendChild(content); log.appendChild(bubble);
    if (role !== 'user' && typeof renderMath === 'function') {
      try { renderMath(content); } catch { /* Plain-text math stays readable. */ }
    }
    return bubble;
  }

  function addReferences(bubble, result) {
    const limitations = Array.isArray(result.limitations) ? result.limitations.filter((item) => typeof item === 'string' && item.trim()).slice(0, 12) : [];
    if (limitations.length) {
      const details = element('details', 'page-coach-limitations');
      details.appendChild(element('summary', '', 'Source lookup limits'));
      const list = element('ul');
      for (const limitation of limitations) list.appendChild(element('li', '', limitation.slice(0, 700)));
      details.appendChild(list); bubble.appendChild(details);
    }
    if (Number.isSafeInteger(result.rulesAdded) && result.rulesAdded > 0) {
      bubble.appendChild(element('p', 'page-coach-remembered', `Remembered ${result.rulesAdded} additional source location${result.rulesAdded === 1 ? '' : 's'}. Earlier hints kept.`));
    }
    const sources = Array.isArray(result.sources) ? result.sources.slice(0, 12) : [];
    if (sources.length) {
      const sourceBox = element('div', 'page-coach-sources');
      sourceBox.appendChild(element('p', '', 'Sources used'));
      const list = element('ul');
      for (const source of sources) {
        if (!source || typeof source.label !== 'string' || !source.label.trim()) continue;
        const li = element('li');
        const href = safeCoachHref(source.href);
        if (href) li.appendChild(makeLink(source.label.slice(0, 180), href));
        else li.textContent = source.label.slice(0, 180);
        if (typeof source.detail === 'string' && source.detail.trim()) li.appendChild(element('span', 'page-coach-source-detail', coachSourceDetail(source.detail)));
        list.appendChild(li);
      }
      if (list.children.length) { sourceBox.appendChild(list); bubble.appendChild(sourceBox); }
    }
    const recommendations = Array.isArray(result.actions) ? result.actions.slice(0, 6) : [];
    const row = element('div', 'page-coach-links');
    for (const action of recommendations) {
      const href = safeCoachHref(action?.href);
      if (!href || typeof action.label !== 'string' || !action.label.trim()) continue;
      const link = makeLink(action.label.slice(0, 120), href); link.className = 'btn secondary'; row.appendChild(link);
    }
    if (row.children.length) bubble.appendChild(row);
  }

  function makeLink(labelText, href) {
    const link = element('a', '', labelText); link.href = href;
    if (!href.startsWith('#/')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', `${labelText} (opens in a new tab)`); }
    return link;
  }

  async function ask(turn) {
    const ownGeneration = ++generation;
    pendingTurn = turn;
    pendingController = new AbortController();
    retryTurn = null; retry.hidden = true;
    setBusy(true);
    status.textContent = 'Astra is looking at your request. A careful reply can take a minute or more.';
    try {
      if (typeof request !== 'function') throw new Error('No coach transport');
      const result = await request({ pageContext: turn.pageContext, message: turn.message, transcript: transcript.slice(-12).map((entry) => ({ ...entry })) }, { signal: pendingController.signal });
      if (disposed || generation !== ownGeneration) return;
      if (!result || typeof result.text !== 'string' || !result.text.trim()) throw new Error('Empty coach reply');
      const reply = result.text.trim().slice(0, MAX_REPLY);
      const modelLabel = result.model === 'gpt-6-astra' ? 'Reply from GPT-6 Astra' : result.model === 'gpt-5.6-sol' ? 'Reply from GPT-5.6 Sol · backup coach' : result.model ? 'AI coach reply' : 'Source lookup (AI unavailable)';
      const bubble = addMessage('assistant', reply, modelLabel);
      addReferences(bubble, result);
      turn.bubble.classList.remove('is-pending');
      transcript.push({ role: 'user', text: turn.message }, { role: 'assistant', text: reply });
      if (transcript.length > 12) transcript.splice(0, transcript.length - 12);
      status.textContent = '';
      // Scroll only within the conversation, never jump the entire study page.
      log.scrollTop += bubble.getBoundingClientRect().top - log.getBoundingClientRect().top;
    } catch {
      if (disposed || generation !== ownGeneration) return;
      turn.bubble.classList.remove('is-pending');
      retryTurn = turn; retry.hidden = false;
      status.textContent = 'Astra could not reply this time. Your message is still here. Try again when you are ready.';
    } finally {
      if (!disposed && generation === ownGeneration) { pendingController = null; pendingTurn = null; setBusy(false); }
    }
  }

  function begin(message) {
    if (disposed) return;
    refresh();
    if (busy) return;
    const text = String(message || '').trim().slice(0, MAX_MESSAGE);
    if (!text) { input.focus(); return; }
    const pageContext = readContext();
    const bubble = addMessage('user', text, coachContextLabel(pageContext)); bubble.classList.add('is-pending');
    ask({ message: text, pageContext, bubble });
  }

  on(form, 'submit', (event) => {
    event.preventDefault();
    if (busy || !input.value.trim()) return;
    const message = input.value; input.value = ''; begin(message);
  });
  on(input, 'keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); form.requestSubmit(); }
  });
  on(retry, 'click', () => { if (!busy && retryTurn) ask(retryTurn); });
  on(cancel, 'click', () => {
    generation += 1;
    pendingController?.abort(); pendingController = null;
    pendingTurn?.bubble.classList.remove('is-pending'); retryTurn = pendingTurn; pendingTurn = null;
    retry.hidden = !retryTurn; setBusy(false);
    status.textContent = 'Stopped waiting. Your message stays here; you can try it again or ask something else.';
  });
  on(window, 'hashchange', refresh);
  refresh();

  const cleanup = () => {
    if (disposed) return;
    disposed = true; generation += 1; pendingController?.abort();
    transcript.length = 0; retryTurn = null; pendingTurn = null;
    for (const remove of removers) remove();
    card.remove();
  };
  cleanup.refresh = refresh;
  cleanup.focus = (message) => {
    if (disposed) return;
    if (typeof message === 'string') input.value = message.slice(0, MAX_MESSAGE);
    input.focus();
  };
  cleanup.ask = (message) => {
    if (disposed) return;
    refresh();
    const text = String(message || '').trim().slice(0, MAX_MESSAGE);
    cleanup.focus(busy ? text : undefined);
    if (!busy) begin(text);
  };
  return cleanup;
}
