// Deliberate, browser-only handoff of selected coursework. Never serialize a
// Canvas record itself: construct every exported field from this allowlist.
export const REEDY_GUIDE_URL = 'https://reedy-devcalc-guide.mstklz78.chatgpt.site/#canvas';
export const MAX_BRIEF_ITEMS = 100;
export const DEVCALC_ORIGINS = ['https://ailearning4students.com', 'https://dev-dash-calc.replit.app'];
const GUIDE_ORIGIN = new URL(REEDY_GUIDE_URL).origin;
const READY_NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function label(value, limit) {
  return typeof value === 'string' ? value
    .replace(/(?:https?:\/\/|www\.)\S+/gi, '[link omitted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[address omitted]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : null;
}

function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !calendarDate(value.slice(0, 10))) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function briefItem(assignment) {
  const title = label(assignment?.name, 300);
  if (!title) return null;
  const official = instant(assignment?.dueAt);
  if (official) return { title, due: official, source: 'Canvas due date' };
  const planning = assignment?.planningDeadline;
  const proposed = planning?.status === 'resolved' && !assignment?.dueAt
    ? instant(planning.dueAt) || calendarDate(planning.date) : null;
  return { title, due: proposed || null, source: proposed ? 'Instructor planning date' : 'Due date not confirmed' };
}

export function createReedyStudyBrief(course, selectedIndexes) {
  const name = label(course?.name, 200);
  if (!name) throw new Error('This course does not have a name to include.');
  const assignments = Array.isArray(course?.assignments) ? course.assignments : [];
  const indexes = [...new Set(selectedIndexes)];
  if (!indexes.length || indexes.length > MAX_BRIEF_ITEMS) throw new Error(`Choose between 1 and ${MAX_BRIEF_ITEMS} assignments.`);
  const items = indexes.map(index => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= assignments.length) throw new Error('The assignment selection is no longer available. Reopen the class.');
    const item = briefItem(assignments[index]);
    if (!item) throw new Error('An assignment has no title. Choose another assignment.');
    return item;
  });
  return { format: 'devcalc-reedy-study-brief', version: 1, course: name, items };
}

export function downloadReedyStudyBrief(brief) {
  const file = new Blob([JSON.stringify(brief, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'reedy-study-brief.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function sendReedyStudyBrief(brief, { isCurrent, status, browser = window } = {}) {
  if (!DEVCALC_ORIGINS.includes(browser.location.origin) || !isCurrent()) {
    status('Open this class in the signed-in DevCalc app to send selected work. You can download a file instead.');
    return () => {};
  }
  const peer = browser.name === 'reedyDevCalcWorkspace' && browser.opener && !browser.opener.closed
    ? browser.opener : browser.open(REEDY_GUIDE_URL, '_blank');
  if (!peer) {
    status('The browser blocked the Reedy guide tab. Download the file and open the guide to import it.');
    return () => {};
  }
  let active = true, timer;
  const stop = () => {
    active = false;
    browser.removeEventListener('message', ready);
    browser.removeEventListener('pagehide', stop);
    browser.clearTimeout(timer);
  };
  const ready = event => {
    const data = event.data;
    if (!active || event.origin !== GUIDE_ORIGIN || event.source !== peer || !data || typeof data !== 'object'
      || Object.keys(data).length !== 2 || data.type !== 'reedy-guide:ready'
      || typeof data.nonce !== 'string' || !READY_NONCE.test(data.nonce)) return;
    stop();
    if (peer.closed || !isCurrent()) {
      status('The workspace or Canvas data changed. Reopen this class and select the assignments again.');
      return;
    }
    try {
      peer.postMessage({ type: 'devcalc:study-brief', nonce: data.nonce, brief }, GUIDE_ORIGIN);
      status('Selected work sent to the Reedy guide for your review. Accept it in that tab to use it.');
      peer.focus();
    } catch { status('The guide could not receive the selected work. Download a file instead.'); }
  };
  browser.addEventListener('message', ready);
  browser.addEventListener('pagehide', stop);
  timer = browser.setTimeout(() => {
    stop(); status('The guide did not respond in time. Try again or download a file.');
  }, 60000);
  status('Waiting for the Reedy guide. Review and accept the selected work there.');
  // No private content is sent until this exact window returns a valid nonce.
  // A newly opened guide also announces readiness after it loads.
  try { peer.postMessage({ type: 'devcalc:request-guide' }, GUIDE_ORIGIN); } catch { /* wait for readiness */ }
  return stop;
}

export function mountReedyStudyBrief(host, { course, isCurrent = () => false, download = downloadReedyStudyBrief, browser = window } = {}) {
  let pendingSend = () => {};
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const details = element('details', '', 'explorer-details');
  details.appendChild(element('summary', 'Use selected work in the Reedy guide'));
  const body = element('div', '', 'explorer-body');
  body.appendChild(element('h3', label(course?.name, 200)));
  body.appendChild(element('p', 'Choose assignments below, then download a file to review in the Reedy guide. It contains this course name, selected assignment titles, dates and date-source labels. The file stays on this device until you choose where to use it.', 'canvas-meta'));
  body.appendChild(element('p', 'Grades, student/account details, Canvas IDs, links, credentials and course documents are excluded. This does not submit work or change Canvas, course requests or enrollment.', 'canvas-meta'));
  body.appendChild(element('p', 'You can also send the selected rows to the Reedy guide. Review and accept them in that tab before using them. Only the selected brief is sent.', 'canvas-meta'));
  const form = element('form');
  const selected = new Set();
  const list = element('div', '', 'canvas-list');
  const button = element('button', 'Download Reedy study brief', 'secondary');
  button.type = 'submit'; button.disabled = true;
  const sendButton = element('button', 'Open selected work in Reedy Guide', 'secondary');
  sendButton.type = 'button'; sendButton.disabled = true;
  const canSend = DEVCALC_ORIGINS.includes(browser.location.origin);
  const status = element('p', 'No assignments selected.', 'canvas-meta');
  status.setAttribute('role', 'status');
  let count = 0;
  (Array.isArray(course?.assignments) ? course.assignments : []).forEach((assignment, index) => {
    const item = briefItem(assignment);
    if (!item) return;
    count++;
    const row = element('label', '', 'canvas-item reedy-brief-choice');
    const checkbox = element('input'); checkbox.type = 'checkbox';
    const text = element('span');
    text.append(element('strong', item.title), element('span', `${item.due || 'Date not confirmed'} · ${item.source}`, 'canvas-meta'));
    row.append(checkbox, text); list.appendChild(row);
    checkbox.addEventListener('change', () => {
      pendingSend();
      if (checkbox.checked) selected.add(index); else selected.delete(index);
      button.disabled = !selected.size || selected.size > MAX_BRIEF_ITEMS || !isCurrent();
      sendButton.disabled = button.disabled || !canSend;
      status.textContent = selected.size > MAX_BRIEF_ITEMS ? `Choose at most ${MAX_BRIEF_ITEMS} assignments.` : `${selected.size} assignment${selected.size === 1 ? '' : 's'} selected. Review the names and dates before downloading.`;
    });
  });
  if (!count) body.appendChild(element('p', 'No named assignments are available in this Canvas load. Refresh Canvas or return after assignments are posted.', 'canvas-meta'));
  const actions = element('div', '', 'btn-row'); actions.append(sendButton, button);
  form.append(list, actions, status);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!host.isConnected || !isCurrent()) {
      button.disabled = true;
      status.textContent = 'The workspace or Canvas data changed. Reopen this class and select the assignments again.';
      return;
    }
    try {
      pendingSend();
      download(createReedyStudyBrief(course, [...selected]));
      status.textContent = 'Download started. Open the Reedy guide and choose this file when you are ready to review it.';
    } catch (error) { status.textContent = error.message; }
  });
  sendButton.addEventListener('click', () => {
    pendingSend();
    if (!host.isConnected || !isCurrent()) {
      status.textContent = 'The workspace or Canvas data changed. Reopen this class and select the assignments again.';
      return;
    }
    try {
      const brief = createReedyStudyBrief(course, [...selected]);
      pendingSend = sendReedyStudyBrief(brief, { browser, isCurrent: () => host.isConnected && isCurrent(), status: text => { status.textContent = text; } });
    } catch (error) { status.textContent = error.message; }
  });
  if (!canSend) body.appendChild(element('p', 'Direct transfer is available in the deployed DevCalc app. You can download a file from this preview.', 'canvas-meta'));
  const link = element('a', 'Open the Reedy guide');
  link.href = REEDY_GUIDE_URL; link.target = '_blank'; link.rel = 'noopener noreferrer';
  body.append(form, link); details.appendChild(body); host.replaceChildren(details);
  return () => { pendingSend(); host.replaceChildren(); };
}
