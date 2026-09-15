// Persistent page-level coaching. The host supplies context and transport;
// this module stores conversation only in memory and never writes to Canvas.
const MAX_MESSAGE = 2000;
const MAX_REPLY = 24000;
const QUICK_PROMPTS = ['Help me choose my next step', 'Find my Canvas instructions', 'Explain this page', 'Check missing due dates'];
let nextCoachId = 0;

export function safeCoachHref(value) {
  if (typeof value !== 'string' || value.length > 2048 || value !== value.trim()) return null;
  if (/^#\/(?:home|focus|mixed|review|settings|diagnostic|canvas(?:\/(?:plan|grades|assessment|course\/[0-9]+))?|(?:unit|practice|mastery)\/[a-z0-9-]{1,64}|lesson\/[a-z0-9-]{1,64}\/[a-z0-9-]{1,64})$/.test(value)) return value;
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
  if (context.canvasCourse === true) return page;
  return subjects[context.subject] ? `${page} · ${subjects[context.subject]}` : page;
}

export function coachConversationScope(context = {}) {
  return JSON.stringify({
    subject: String(context.subject || ''),
    selectedCourseId: String(context.selectedCourseId || ''),
    questionId: String(context.questionId || ''),
    sessionId: context.questionId ? String(context.sessionId || '') : '',
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

function tableCells(line) {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  const cells = []; let cell = ''; let inCode = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\\' && text[i + 1] === '|') { cell += '|'; i += 1; }
    else if (char === '\x60') { inCode = !inCode; cell += char; }
    else if (char === '|' && !inCode) { cells.push(cell.trim()); cell = ''; }
    else cell += char;
  }
  if (cell.trim() || !text.endsWith('|') || inCode) cells.push(cell.trim());
  return cells;
}

/** Bounded, text-only Markdown blocks. HTML and model-generated links stay text. */
export function parseCoachMarkdown(value) {
  const lines = String(value ?? '').slice(0, MAX_REPLY).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  const heading = (line) => /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line || '');
  const listItem = (line) => /^\s*(?:([-+*])|(\d{1,6})[.)])\s+(.+)$/.exec(line || '');
  const fence = (line) => /^\s*\x60{3}(?:[a-zA-Z0-9_-]+)?\s*$/.test(line || '');
  function tableAt(index) {
    if (!lines[index]?.includes('|') || !lines[index + 1]?.includes('|')) return null;
    const headers = tableCells(lines[index]); const separator = tableCells(lines[index + 1]);
    return headers.length && headers.length === separator.length && separator.every((cell) => /^:?-{3,}:?$/.test(cell)) ? headers : null;
  }
  for (let i = 0; i < lines.length;) {
    if (!lines[i].trim()) { i += 1; continue; }
    if (fence(lines[i])) {
      const code = []; i += 1;
      while (i < lines.length && !/^\s*\x60{3}\s*$/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i += 1;
      blocks.push({ type: 'code', text: code.join('\n') }); continue;
    }
    const title = heading(lines[i]);
    if (title) { blocks.push({ type: 'heading', level: Math.min(6, Math.max(4, title[1].length)), text: title[2] }); i += 1; continue; }
    const headers = tableAt(i);
    if (headers) {
      const rows = []; let totalRows = 0; i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|') && !heading(lines[i]) && !listItem(lines[i]) && !fence(lines[i])) {
        const cells = tableCells(lines[i++]); totalRows += 1;
        if (rows.length < 50) rows.push(headers.slice(0, 8).map((_, index) => cells[index] || ''));
      }
      blocks.push({ type: 'table', headers: headers.slice(0, 8), rows, totalRows, totalColumns: headers.length }); continue;
    }
    const firstItem = listItem(lines[i]);
    if (firstItem) {
      const ordered = Boolean(firstItem[2]); const items = [];
      while (i < lines.length) {
        const item = listItem(lines[i]);
        if (!item || Boolean(item[2]) !== ordered) break;
        items.push(item[3]); i += 1;
      }
      blocks.push({ type: 'list', ordered, start: ordered ? Number(firstItem[2]) : 1, items }); continue;
    }
    const paragraph = [lines[i++]];
    while (i < lines.length && lines[i].trim() && !heading(lines[i]) && !listItem(lines[i]) && !fence(lines[i]) && !tableAt(i)) paragraph.push(lines[i++]);
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
}

export function appendReply(node, text) {
  for (const block of parseCoachMarkdown(text)) {
    if (block.type === 'code') {
      const pre = element('pre'); pre.appendChild(element('code', '', block.text)); node.appendChild(pre);
    } else if (block.type === 'list') {
      const list = element(block.ordered ? 'ol' : 'ul');
      if (block.ordered) list.setAttribute('start', String(block.start));
      for (const text of block.items) { const li = element('li'); appendInline(li, text); list.appendChild(li); }
      node.appendChild(list);
    } else if (block.type === 'table') {
      const wrap = element('div', 'page-coach-table-wrap');
      wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', 'Table; scroll horizontally to view all columns');
      const table = element('table'); const head = element('thead'); const row = element('tr');
      for (const text of block.headers) { const th = element('th'); th.setAttribute('scope', 'col'); appendInline(th, text); row.appendChild(th); }
      head.appendChild(row); table.appendChild(head);
      const body = element('tbody');
      for (const cells of block.rows) {
        const tr = element('tr');
        for (const text of cells) { const td = element('td'); appendInline(td, text); tr.appendChild(td); }
        body.appendChild(tr);
      }
      table.appendChild(body); wrap.appendChild(table); node.appendChild(wrap);
      if (block.totalRows > block.rows.length || block.totalColumns > block.headers.length) node.appendChild(element('p', 'page-coach-table-note', `Showing ${block.rows.length} of ${block.totalRows} rows and ${block.headers.length} of ${block.totalColumns} columns.`));
    } else {
      const paragraph = element(block.type === 'heading' ? `h${block.level}` : 'p');
      appendInline(paragraph, block.text); node.appendChild(paragraph);
    }
  }
}

/**
 * request({ pageContext, message, transcript }, { signal }) resolves to
 * { text, model?, fallback?, sources?: [{label, href?, detail?}], actions?: [{label, href}] }.
 * The second argument lets the host cancel its fetch. Cleanup always ignores
 * late results; call cleanup.refresh() after navigation and remount for a learner.
 * cleanup.ask(message) is for explicit user actions elsewhere on the page;
 * cleanup.focus(message?) opens a draft without submitting it.
 */
export function mountPageCoach(container, { context = () => ({}), request, renderMath, saveMemo, mountNotes, signedOut = false } = {}) {
  const id = `page-coach-${++nextCoachId}`;
  let disposed = false;
  let busy = false;
  let generation = 0;
  let pendingController = null;
  let pendingTurn = null;
  let retryTurn = null;
  let lastScope = null;
  let notesCleanup = null;
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
  if (signedOut) intro.textContent = 'Sign in to get personalized study help from Astra. Your courses, saved learning notes, and progress stay connected to your account.';
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
  const note = element('p', 'page-coach-note', `You choose the next action. Suggested links open only when you click them. This conversation stays in this tab.${saveMemo ? ' Save a learning note when you want Astra to remember something for a future session.' : ''}`); note.id = `${id}-note`;
  if (signedOut) {
    quickRow.hidden = true; form.hidden = true; log.hidden = true;
    note.textContent = 'Personalized coaching starts after sign-in. Ask the app owner for help with account setup.';
  }
  const workspace = element('div', 'page-coach-workspace');
  const conversation = element('div', 'page-coach-conversation');
  const notebook = element('aside', 'page-coach-notebook'); notebook.hidden = true;
  notebook.id = `${id}-notebook`; notebook.setAttribute('aria-label', 'Coach Notes');
  conversation.append(intro, contextLine, quickRow, log, form, note);
  workspace.append(conversation, notebook);
  if (typeof mountNotes === 'function' && !signedOut) {
    const notesButton = element('button', 'secondary', 'Coach Notes'); notesButton.type = 'button';
    notesButton.setAttribute('aria-controls', notebook.id); notesButton.setAttribute('aria-expanded', 'false');
    on(notesButton, 'click', () => {
      notebook.hidden = !notebook.hidden;
      notesButton.setAttribute('aria-expanded', String(!notebook.hidden));
      workspace.classList.toggle('notes-open', !notebook.hidden);
      notesCleanup?.(); notesCleanup = null;
      if (!notebook.hidden) notesCleanup = mountNotes(notebook);
    });
    header.appendChild(notesButton);
  }
  card.append(header, workspace);
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
    const recordReads = Array.isArray(result.recordReads) ? result.recordReads.slice(0, 8) : [];
    if (recordReads.length) {
      const labels = { learning_profile: 'Learning preferences', skills: 'Skill attempts', question_history: 'Question history', mastery_checks: 'Mastery checks', saved_notes: 'Saved learning notes', canvas_courses: 'Canvas classes', canvas_preferences: 'Course choices', retrieval_sources: 'Saved source locations' };
      const details = element('details', 'page-coach-limitations');
      details.appendChild(element('summary', '', 'Learning records checked'));
      const list = element('ul');
      for (const read of recordReads) {
        if (!labels[read?.collection]) continue;
        const status = read.state === 'available' && Number.isInteger(read.count) && Number.isInteger(read.totalCount)
          ? `${read.count} read from ${read.totalCount} saved record${read.totalCount === 1 ? '' : 's'}${read.nextOffset !== null ? '; more records remain' : ''}` : 'Could not be read this time';
        list.appendChild(element('li', '', `${labels[read.collection]}: ${status}.`));
      }
      details.appendChild(list); bubble.appendChild(details);
    }
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

  function addMemoryEditor(bubble, reply, pageContext) {
    if (typeof saveMemo !== 'function') return;
    const details = element('details', 'coach-memo-editor');
    details.appendChild(element('summary', '', 'Remember a learning note from this reply'));
    const label = element('label', '', 'Review the note before saving');
    const input = element('textarea'); input.rows = 4; input.maxLength = 2000;
    input.value = reply.slice(0, 2000); label.appendChild(input);
    const help = element('p', 'session-progress', reply.length > 2000 ? 'This reply is longer than a note. The first 2000 characters are shown; edit this to keep the part that helps you.' : 'Edit this to keep the explanation or study strategy that helps you. Earlier notes stay saved.');
    const button = element('button', 'secondary', 'Save learning note'); button.type = 'button';
    const state = element('p', 'session-progress'); state.setAttribute('role', 'status');
    details.append(label, help, button, state); bubble.appendChild(details);
    let clientRequestId = '', pendingText = '';
    on(button, 'click', async () => {
      if (disposed || button.disabled || !bubble.isConnected) return;
      const text = input.value.trim();
      if (!text) { state.textContent = 'Write the note you want to keep.'; return; }
      if (text !== pendingText) { pendingText = text; clientRequestId = crypto.randomUUID(); }
      button.disabled = true; state.textContent = 'Saving this note for future study.';
      try {
        await saveMemo({ text, type: 'coach_note', clientRequestId, source: {
          kind: pageContext.questionId ? 'question-coach' : 'study-coach',
          ...(pageContext.subject ? { subject: pageContext.subject } : {}),
          ...(pageContext.unitId ? { unitId: pageContext.unitId } : {}),
          ...(pageContext.questionId ? { questionId: pageContext.questionId } : {}),
        } });
        if (disposed || !bubble.isConnected) return;
        state.textContent = 'Saved. You can read your learning notes in Settings.';
        input.disabled = true; button.textContent = 'Note saved';
      } catch (error) {
        if (disposed || !bubble.isConnected) return;
        state.textContent = error.message || 'The note could not be saved. Your draft is still here.';
        button.disabled = false;
      }
    });
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
      if (!result.refusal) addMemoryEditor(bubble, reply, turn.pageContext);
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
    if (disposed || signedOut) return;
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
    notesCleanup?.();
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
