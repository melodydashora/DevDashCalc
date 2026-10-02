import { apiFetch } from './auth-ui.js';
let nextNotebookId = 0;

const memoryUrl = (profileId, id) => `/api/continuity?profile=${encodeURIComponent(profileId)}${id ? `&id=${encodeURIComponent(id)}` : ''}`;
async function changeStudentMemo(profileId, id, method, body, signal, failure) {
  const response = await apiFetch(memoryUrl(profileId, id), {
    method, signal,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || failure);
  if (!signal?.aborted) window.dispatchEvent(new CustomEvent('students4ai-memo-saved', { detail: { profileId, action: { POST: 'created', PATCH: 'updated', DELETE: 'deleted' }[method] } }));
  return data;
}

export function saveStudentMemo(profileId, { text, type = 'student_note', source, clientRequestId }, { signal } = {}) {
  return changeStudentMemo(profileId, null, 'POST', { text, type, source, clientRequestId }, signal,
    'Your memory could not be saved. Your text is still here so you can retry.');
}
export function updateStudentMemo(profileId, id, text, { signal } = {}) {
  return changeStudentMemo(profileId, id, 'PATCH', { text }, signal,
    'Your memory could not be updated. Your changes are still here so you can retry.');
}
export function deleteStudentMemo(profileId, id, { signal } = {}) {
  return changeStudentMemo(profileId, id, 'DELETE', null, signal,
    'Your memory could not be removed. Try again.');
}

const element = (tag, className = '', text = '') => {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
};
const button = (text, className = 'secondary') => {
  const node = element('button', className, text); node.type = 'button'; return node;
};
const memoryType = note => note.type === 'coach_note' ? 'Learned from coaching' : 'Your learning memory';
function memoryDetails(note, includeType = true) {
  const details = includeType ? [memoryType(note)] : [];
  const subject = { 'calculus-bc': 'AP Calculus BC', 'calculus-ab': 'AP Calculus AB', physics: 'Physics', all: 'All courses' }[note.source?.subject];
  if (subject) details.push(subject);
  const source = { 'study-coach': 'Study coach', 'question-coach': 'Question coaching', settings: 'Added by you' }[note.source?.kind];
  if (source) details.push(source);
  const created = new Date(note.createdAt), updated = new Date(note.updatedAt);
  if (Number.isFinite(created.getTime())) details.push(`Saved ${created.toLocaleString()}`);
  if (Number.isFinite(updated.getTime()) && updated.getTime() !== created.getTime()) details.push(`Updated ${updated.toLocaleString()}`);
  return details.join(' · ');
}

function memoryIconButton(control, label, pathData) {
  control.className += ' memo-icon-action';
  control.setAttribute('aria-label', `${label} memory`);
  control.title = `${label} memory`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(name, value);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathData); svg.appendChild(path);
  control.replaceChildren(svg, element('span', 'visually-hidden', label));
}

export function mountStudentMemos(root, { profileId, compact = false }) {
  let disposed = false, saving = false, offset = 0, mutations = 0;
  let loadGeneration = 0, loadController, pendingRefresh = false, focusAfterRefresh;
  const noteControls = new Map();
  const requests = new Set(), editing = new Set();
  const notebookId = ++nextNotebookId;
  const inputId = `student-memo-${notebookId}`;
  let pendingText = '', requestId = '';
  const heading = element('h2', '', 'What Astra remembers');
  const introduction = element('p', 'memo-introduction', compact ? "Things I've learned about you from our chats" : 'Memories help your coach remember how you learn. You can add, edit, or remove them. Your saved memories belong to your account and follow you to another computer.');
  const form = element('form', 'memo-form');
  const label = element('label', '', 'A memory for future study'); label.htmlFor = inputId;
  const input = element('textarea'); input.id = inputId; input.rows = 3; input.maxLength = 2000; input.required = true;
  input.placeholder = 'For example: show a coding example before the formula, and help me choose one task.';
  const save = button('Save learning memory', ''); save.type = 'submit';
  const status = element('p', 'memo-status'); status.setAttribute('role', 'status');
  form.append(label, input, save);
  if (!compact) form.appendChild(status);
  const explanation = element('p', 'session-progress', 'Astra can use these memories in future study sessions. Canvas deadlines and verified answer keys remain the authority for those facts.');
  const list = element('div', 'memo-list');
  const count = element('p', 'memo-count session-progress'); count.setAttribute('role', 'status');
  const older = button('Show older memories', 'secondary memo-older'); older.hidden = true;
  const retryLoad = button('Try loading memories again', 'secondary memo-reload'); retryLoad.hidden = true;
  let addMemory;
  root.classList.toggle('memo-compact', compact);
  if (compact) {
    addMemory = element('details', 'memo-add-details');
    addMemory.append(element('summary', '', 'Add a memory'), form);
    root.replaceChildren(introduction, list, count, older, retryLoad, status, addMemory);
  } else root.replaceChildren(heading, introduction, form, explanation, list, count, older, retryLoad);
  const defaultFocus = () => compact && !addMemory.open ? addMemory.querySelector('summary') : input;

  const interacting = () => saving || mutations > 0 || editing.size > 0;
  const controller = () => { const request = new AbortController(); requests.add(request); return request; };
  const refreshWhenReady = () => {
    if (disposed) return;
    older.disabled = !!loadController || interacting();
    retryLoad.disabled = older.disabled;
    if (pendingRefresh && !interacting()) { pendingRefresh = false; load(true); }
  };
  const renderNote = initialNote => {
    let note = initialNote, busy = false;
    const article = element('article', 'card subtle memo-item');
    const details = element('p', 'session-progress', memoryDetails(note, !compact));
    const text = element('p', 'memo-text', note.text);
    const actions = element('div', 'memo-actions');
    const edit = button('Edit', 'secondary memo-edit');
    const remove = button('Remove', 'secondary memo-remove'); actions.append(edit, remove);
    const rowStatus = element('p', 'memo-status'); rowStatus.setAttribute('role', 'status');
    const editor = element('form', 'memo-edit-form'); editor.hidden = true;
    const editLabel = element('label', '', 'Edit learning memory');
    const editInput = element('textarea'); editInput.id = `${inputId}-${note.id}`; editInput.rows = 3; editInput.maxLength = 2000; editInput.required = true;
    editLabel.htmlFor = editInput.id;
    const editActions = element('div', 'memo-actions');
    const saveEdit = button('Save changes', ''); saveEdit.type = 'submit';
    const cancelEdit = button('Cancel'); editActions.append(saveEdit, cancelEdit);
    editor.append(editLabel, editInput, editActions);
    const confirmation = element('div', 'memo-remove-confirmation'); confirmation.hidden = true;
    const confirmText = element('p', '', 'Removing this memory from your coach cannot be undone.');
    const confirmActions = element('div', 'memo-actions');
    const confirmRemove = button('Remove memory'); const cancelRemove = button('Keep memory');
    confirmActions.append(confirmRemove, cancelRemove); confirmation.append(confirmText, confirmActions);
    if (compact) {
      const title = element('div', 'memo-card-heading');
      title.append(element('p', 'memo-type-label', memoryType(note)), actions);
      memoryIconButton(edit, 'Edit', 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z');
      memoryIconButton(remove, 'Remove', 'M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6');
      article.append(title, text, details, editor, confirmation, rowStatus);
    } else article.append(details, text, actions, editor, confirmation, rowStatus);
    noteControls.set(note.id, { edit, remove });
    const closeEditor = () => {
      editing.delete(article); editor.hidden = true; confirmation.hidden = true;
      editInput.value = ''; text.hidden = false; actions.hidden = false;
    };
    const setBusy = value => {
      busy = value;
      for (const control of [edit, remove, editInput, saveEdit, cancelEdit, confirmRemove, cancelRemove]) control.disabled = value;
      article.setAttribute('aria-busy', String(value));
    };
    edit.addEventListener('click', () => {
      if (disposed || busy) return;
      editing.add(article); editInput.value = note.text; rowStatus.textContent = '';
      text.hidden = true; actions.hidden = true; editor.hidden = false; confirmation.hidden = true;
      editInput.focus(); refreshWhenReady();
    });
    cancelEdit.addEventListener('click', () => {
      if (disposed || busy) return;
      closeEditor(); rowStatus.textContent = ''; edit.focus();
      if (pendingRefresh) focusAfterRefresh = { id: note.id, action: 'edit' };
      refreshWhenReady();
    });
    editor.addEventListener('submit', async event => {
      event.preventDefault();
      const nextText = editInput.value.trim();
      if (disposed || busy || !nextText) return;
      const request = controller(); mutations += 1; setBusy(true);
      rowStatus.textContent = 'Saving your changes.';
      try {
        const data = await updateStudentMemo(profileId, note.id, nextText, { signal: request.signal });
        if (disposed) return;
        if (!data.note || data.note.id !== note.id || typeof data.note.text !== 'string') throw new Error('Your changes could not be confirmed. Your text is still here so you can retry.');
        note = data.note; text.textContent = note.text; details.textContent = memoryDetails(note, !compact);
        closeEditor(); rowStatus.textContent = 'Memory updated.';
        focusAfterRefresh = { id: note.id, action: 'edit' };
      } catch (error) {
        if (!disposed) rowStatus.textContent = error.message || 'Your changes could not be saved. Try again.';
      } finally {
        requests.delete(request); mutations -= 1;
        if (!disposed) { setBusy(false); if (editor.hidden) edit.focus(); refreshWhenReady(); }
      }
    });
    remove.addEventListener('click', () => {
      if (disposed || busy) return;
      editing.add(article); rowStatus.textContent = ''; actions.hidden = true;
      confirmation.hidden = false; cancelRemove.focus(); refreshWhenReady();
    });
    cancelRemove.addEventListener('click', () => {
      if (disposed || busy) return;
      closeEditor(); rowStatus.textContent = ''; remove.focus();
      if (pendingRefresh) focusAfterRefresh = { id: note.id, action: 'remove' };
      refreshWhenReady();
    });
    confirmRemove.addEventListener('click', async () => {
      if (disposed || busy) return;
      const request = controller(); mutations += 1; setBusy(true);
      rowStatus.textContent = 'Removing this memory.';
      try {
        const data = await deleteStudentMemo(profileId, note.id, { signal: request.signal });
        if (disposed) return;
        if (!data.deleted) throw new Error('The removal could not be confirmed. Try again.');
        editing.delete(article); article.remove(); defaultFocus().focus();
        status.textContent = 'Memory removed. Astra will no longer look it up.';
        pendingRefresh = true;
      } catch (error) {
        if (!disposed) rowStatus.textContent = error.message || 'Your memory could not be removed. Try again.';
      } finally {
        requests.delete(request); mutations -= 1;
        if (!disposed) { setBusy(false); refreshWhenReady(); }
      }
    });
    return article;
  };
  const load = async (reset = false) => {
    if (disposed) return;
    if (interacting()) { pendingRefresh = true; return; }
    const generation = ++loadGeneration;
    loadController?.abort();
    const request = controller(); loadController = request;
    older.disabled = true; retryLoad.disabled = true;
    const wantedOffset = reset ? 0 : offset;
    try {
      const response = await apiFetch(`${memoryUrl(profileId)}&offset=${wantedOffset}`, { signal: request.signal });
      const data = await response.json();
      if (!response.ok) throw new Error();
      if (disposed || generation !== loadGeneration) return;
      // New memories may arrive while an edit is in progress. Keep that draft
      // on screen and refresh when the learner saves or cancels it.
      if (interacting()) { pendingRefresh = true; return; }
      if (reset) { list.replaceChildren(); noteControls.clear(); }
      const notes = Array.isArray(data.notes) ? data.notes : [];
      notes.forEach(note => list.appendChild(renderNote(note)));
      offset = wantedOffset + notes.length;
      count.textContent = data.totalCount ? `Showing ${offset} of ${data.totalCount} saved memories.${compact ? '' : ' Astra can look up older memories when needed.'}` : 'Memories help your coach remember how you learn. You can add, edit, or remove them.';
      older.hidden = offset >= (data.totalCount || 0); retryLoad.hidden = true;
      if (focusAfterRefresh) {
        (noteControls.get(focusAfterRefresh.id)?.[focusAfterRefresh.action] || defaultFocus()).focus();
        focusAfterRefresh = null;
      }
    } catch {
      if (!disposed && generation === loadGeneration) {
        count.textContent = 'Saved memories could not load. Your saved memories have not been changed.';
        retryLoad.hidden = false;
      }
    } finally {
      requests.delete(request);
      if (generation === loadGeneration) loadController = null;
      if (!disposed && generation === loadGeneration) { older.disabled = interacting(); retryLoad.disabled = older.disabled; }
    }
  };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || saving || disposed) return;
    if (text !== pendingText) { requestId = crypto.randomUUID(); pendingText = text; }
    const request = controller(); saving = true; save.disabled = true; input.disabled = true;
    status.textContent = 'Saving your learning memory.';
    try {
      await saveStudentMemo(profileId, { text, source: { kind: 'settings' }, clientRequestId: requestId }, { signal: request.signal });
      if (disposed) return;
      input.value = ''; requestId = ''; pendingText = '';
      status.textContent = 'Saved for your next study session.';
      pendingRefresh = true;
    } catch (error) { if (!disposed) status.textContent = error.message || 'Your memory could not be saved. Try again.'; }
    finally {
      requests.delete(request); saving = false;
      if (!disposed) { save.disabled = false; input.disabled = false; refreshWhenReady(); }
    }
  });
  older.addEventListener('click', () => load());
  retryLoad.addEventListener('click', () => load(true));
  const refreshSaved = event => {
    if (!disposed && event.detail?.profileId === profileId) { pendingRefresh = true; refreshWhenReady(); }
  };
  window.addEventListener('students4ai-memo-saved', refreshSaved);
  load(true);
  return () => {
    disposed = true; loadGeneration += 1;
    for (const request of requests) request.abort();
    requests.clear(); editing.clear(); noteControls.clear();
    window.removeEventListener('students4ai-memo-saved', refreshSaved);
    for (const field of root.querySelectorAll('textarea')) field.value = '';
    root.replaceChildren();
  };
}
