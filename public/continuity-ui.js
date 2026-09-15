import { apiFetch } from './auth-ui.js';
let nextNotebookId = 0;

export async function saveStudentMemo(profileId, { text, type = 'student_note', source, clientRequestId }) {
  const response = await apiFetch(`/api/continuity?profile=${encodeURIComponent(profileId)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, type, source, clientRequestId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Your note could not be saved. It is still here so you can retry.');
  window.dispatchEvent(new CustomEvent('students4ai-memo-saved', { detail: { profileId } }));
  return data;
}

export function mountStudentMemos(root, { profileId }) {
  let disposed = false, saving = false, offset = 0;
  let loadGeneration = 0;
  const inputId = `student-memo-${++nextNotebookId}`;
  let pendingText = '', requestId = '';
  root.innerHTML = `<h2>What Astra remembers</h2>
    <p>Save learning preferences, explanations that helped, or a next step for later. These notes belong to your account and follow you to another computer. Astra can look up your saved notes when helping you, including older ones.</p>
    <form class="memo-form"><label for="${inputId}">A note for future study</label><textarea id="${inputId}" rows="3" maxlength="2000" required placeholder="For example: show a coding example before the formula, and help me choose one task."></textarea><button type="submit">Save learning note</button><p class="memo-status" role="status"></p></form>
    <p class="session-progress">Notes are saved only when you choose Save. New notes keep the earlier history. Add a correction if something changes. Canvas deadlines and verified answer keys remain the authority for those facts.</p>
    <div class="memo-list"></div><p class="memo-count session-progress"></p><button type="button" class="secondary memo-older" hidden>Show older notes</button>`;
  const form = root.querySelector('form'), input = root.querySelector('textarea');
  const status = root.querySelector('.memo-status'), list = root.querySelector('.memo-list');
  const older = root.querySelector('.memo-older'), count = root.querySelector('.memo-count');
  const renderNote = note => {
    const article = document.createElement('article'); article.className = 'card subtle';
    const label = document.createElement('p'); label.className = 'session-progress';
    const date = new Date(note.createdAt);
    label.textContent = `${note.type === 'coach_note' ? 'Saved from coaching' : 'Your learning note'}${Number.isFinite(date.getTime()) ? ` · ${date.toLocaleString()}` : ''}`;
    const text = document.createElement('p'); text.className = 'memo-text'; text.textContent = note.text;
    article.append(label, text); return article;
  };
  const load = async (reset = false) => {
    const generation = ++loadGeneration;
    older.disabled = true;
    const wantedOffset = reset ? 0 : offset;
    try {
      const response = await apiFetch(`/api/continuity?profile=${encodeURIComponent(profileId)}&offset=${wantedOffset}`);
      const data = await response.json();
      if (!response.ok) throw new Error();
      if (disposed || generation !== loadGeneration) return;
      if (reset) list.replaceChildren();
      const notes = Array.isArray(data.notes) ? data.notes : [];
      notes.forEach(note => list.appendChild(renderNote(note)));
      offset = wantedOffset + notes.length;
      count.textContent = data.totalCount ? `Showing ${offset} of ${data.totalCount} saved notes. Astra starts with recent context and can look up older notes when needed.` : 'No saved learning notes yet.';
      older.hidden = offset >= data.totalCount;
    } catch {
      if (!disposed && generation === loadGeneration) count.textContent = 'Saved notes could not load. Existing notes have not been changed.';
    } finally { if (!disposed && generation === loadGeneration) older.disabled = false; }
  };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || saving || disposed) return;
    if (text !== pendingText) { requestId = crypto.randomUUID(); pendingText = text; }
    saving = true; form.querySelector('button').disabled = true;
    status.textContent = 'Saving your learning note.';
    try {
      await saveStudentMemo(profileId, { text, source: { kind: 'settings' }, clientRequestId: requestId });
      if (disposed) return;
      input.value = ''; requestId = ''; pendingText = '';
      status.textContent = 'Saved for your next study session.';
      await load(true);
    } catch (error) { if (!disposed) status.textContent = error.message || 'Your note could not be saved. Try again.'; }
    finally { saving = false; if (!disposed) form.querySelector('button').disabled = false; }
  });
  older.addEventListener('click', () => load());
  const refreshSaved = event => { if (!disposed && event.detail?.profileId === profileId) load(true); };
  window.addEventListener('students4ai-memo-saved', refreshSaved);
  load(true);
  return () => { disposed = true; window.removeEventListener('students4ai-memo-saved', refreshSaved); };
}
