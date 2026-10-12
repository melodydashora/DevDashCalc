import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountStudentMemos, updateStudentMemo, deleteStudentMemo } from '../public/continuity-ui.js';

// Only browser event/DOM behavior used by the memories UI is modeled here.
// No DOM dependency, database, real student data, or AI provider is needed.
class MemoryNode {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
    this.className = ''; this.attributes = {}; this.listeners = new Map();
    this.value = ''; this.hidden = false; this.disabled = false; this._text = '';
    this.classList = { toggle: (name, include) => {
      const names = this.className.split(/\s+/).filter(value => value && value !== name);
      if (include) names.push(name);
      this.className = names.join(' '); return include;
    } };
  }
  set innerHTML(_) { throw new Error('Memories must render through safe DOM nodes.'); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
  append(...nodes) { for (const node of nodes) this.appendChild(node); }
  replaceChildren(...nodes) { for (const node of this.children) node.parentNode = null; this.children = []; this._text = ''; this.append(...nodes); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  dispatch(type) { for (const fn of this.listeners.get(type) || []) fn({ preventDefault() {} }); }
  click() { if (!this.disabled) this.dispatch('click'); }
  requestSubmit() { this.dispatch('submit'); }
  focus() { document.activeElement = this; }
  querySelectorAll(selector) {
    const all = node => node.children.flatMap(child => [child, ...all(child)]);
    return all(this).filter(node => selector.startsWith('.') ? node.className.split(/\s+/).includes(selector.slice(1)) : node.tagName === selector.toUpperCase());
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const noteId = '12345678-1234-1234-1234-123456789abc';
const originalNote = { id: noteId, text: 'Show a diagram first.', type: 'coach_note', source: { kind: 'study-coach', subject: 'calculus-bc' }, createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z' };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const settle = () => new Promise(resolve => setImmediate(resolve));
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const named = (root, text) => {
  const result = root.querySelectorAll('button').find(node => node.textContent === text);
  assert.ok(result, `Missing button ${text}`); return result;
};
async function withMemories(fetcher, run, options = {}) {
  const previous = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  const win = globalThis.window = new EventTarget();
  globalThis.document = { createElement: tag => new MemoryNode(tag), createElementNS: (_namespace, tag) => new MemoryNode(tag), activeElement: null };
  globalThis.fetch = fetcher;
  const root = new MemoryNode();
  let cleanup;
  try {
    cleanup = mountStudentMemos(root, { profileId: 'student-a', ...options });
    await settle();
    await run({ root, cleanup, win });
  } finally {
    cleanup?.();
    Object.assign(globalThis, previous);
  }
}

test('memory text remains inert and editable notes show saved and updated source context', async () => {
  const text = '<img src=x onerror=alert(1)> Prefer visual steps.';
  await withMemories(async () => response({ notes: [{ ...originalNote, text, updatedAt: '2026-10-02T11:00:00Z' }], totalCount: 1 }), ({ root }) => {
    assert.equal(root.querySelector('.memo-text').textContent, text);
    assert.match(root.querySelector('.memo-item').textContent, /Learned from coaching · AP Calculus BC · Study coach · Saved .* · Updated /);
    assert.equal(root.querySelectorAll('img').length, 0);
    assert.equal(root.querySelectorAll('script').length, 0);
    assert.doesNotMatch(root.textContent, /append|correction|only when you choose Save/i);
  });
});

test('editing keeps the draft on failure and refreshes the owned note after retry', async () => {
  let stored = originalNote, attempts = 0;
  const calls = [], events = [];
  await withMemories(async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === 'PATCH') {
      attempts += 1;
      if (attempts === 1) return response({ error: 'Connection interrupted. Try again.' }, 503);
      stored = { ...stored, text: JSON.parse(options.body).text, updatedAt: '2026-10-02T11:00:00Z' };
      return response({ note: stored });
    }
    return response({ notes: [stored], totalCount: 1 });
  }, async ({ root, win }) => {
    win.addEventListener('students4ai-memo-saved', event => events.push(event.detail));
    named(root, 'Edit').click();
    const editor = root.querySelector('.memo-edit-form'), draft = editor.querySelector('textarea');
    draft.value = 'Use a small table first.';
    editor.requestSubmit(); await settle();
    assert.equal(editor.hidden, false);
    assert.equal(draft.value, 'Use a small table first.');
    assert.equal(draft.disabled, false);
    assert.match(root.querySelector('.memo-item').textContent, /Connection interrupted/);
    assert.equal(events.length, 0);
    editor.requestSubmit(); await settle();
    assert.equal(root.querySelector('.memo-text').textContent, 'Use a small table first.');
    assert.match(root.querySelector('.memo-item').textContent, /Updated /);
    assert.deepEqual(events, [{ profileId: 'student-a', action: 'updated' }]);
    const patches = calls.filter(call => call.options.method === 'PATCH');
    assert.equal(patches.length, 2);
    assert.ok(patches.every(call => call.url === `/api/continuity?profile=student-a&id=${noteId}`));
    assert.deepEqual(JSON.parse(patches[1].options.body), { text: 'Use a small table first.' });
    assert.equal(document.activeElement, named(root, 'Edit'), 'focus follows the note after the refreshed list is rendered');
  });
});

test('an incoming learned memory does not erase a draft or load another learner workspace', async () => {
  let gets = 0;
  await withMemories(async () => {
    gets += 1;
    return response({ notes: [originalNote], totalCount: 1 });
  }, async ({ root, win }) => {
    named(root, 'Edit').click();
    const editor = root.querySelector('.memo-edit-form'), draft = editor.querySelector('textarea');
    draft.value = 'Unsaved clarification.';
    win.dispatchEvent(new CustomEvent('students4ai-memo-saved', { detail: { profileId: 'student-b', action: 'created' } }));
    win.dispatchEvent(new CustomEvent('students4ai-memo-saved', { detail: { profileId: 'student-a', action: 'created' } }));
    await settle();
    assert.equal(gets, 1);
    assert.equal(draft.value, 'Unsaved clarification.');
    named(editor, 'Cancel').click(); await settle();
    assert.equal(gets, 2);
    assert.equal(root.querySelector('.memo-text').textContent, originalNote.text);
    assert.equal(document.activeElement, named(root, 'Edit'));
  });
});

test('remove asks inline before deleting just one owned memory and preserves it after failure', async () => {
  let deleted = false, deletes = 0;
  const events = [];
  await withMemories(async (url, options = {}) => {
    if (options.method === 'DELETE') {
      assert.equal(url, `/api/continuity?profile=student-a&id=${noteId}`);
      assert.equal(options.body, undefined);
      deletes += 1;
      if (deletes === 1) return response({ error: 'Removal unavailable. Try again.' }, 503);
      deleted = true; return response({ deleted: true, id: noteId });
    }
    return response({ notes: deleted ? [] : [originalNote], totalCount: deleted ? 0 : 1 });
  }, async ({ root, win }) => {
    win.addEventListener('students4ai-memo-saved', event => events.push(event.detail));
    named(root, 'Remove').click();
    assert.equal(deletes, 0);
    assert.equal(root.querySelector('.memo-remove-confirmation').hidden, false);
    assert.equal(document.activeElement, named(root, 'Keep memory'));
    named(root, 'Keep memory').click();
    assert.equal(deletes, 0);
    named(root, 'Remove').click(); named(root, 'Remove memory').click(); await settle();
    assert.equal(root.querySelectorAll('.memo-item').length, 1);
    assert.match(root.textContent, /Removal unavailable/);
    named(root, 'Remove memory').click(); await settle();
    assert.equal(root.querySelectorAll('.memo-item').length, 0);
    assert.match(root.textContent, /Astra will no longer look it up/);
    assert.deepEqual(events, [{ profileId: 'student-a', action: 'deleted' }]);
    assert.equal(document.activeElement, root.querySelector('textarea'));
  });
});

test('unmount aborts a pending mutation and late success cannot show or announce old memories', async () => {
  const late = defer(); let mutationSignal;
  await withMemories(async (_url, options = {}) => {
    if (options.method === 'PATCH') { mutationSignal = options.signal; return late.promise; }
    return response({ notes: [originalNote], totalCount: 1 });
  }, async ({ root, cleanup, win }) => {
    let events = 0; win.addEventListener('students4ai-memo-saved', () => { events += 1; });
    named(root, 'Edit').click();
    const editor = root.querySelector('.memo-edit-form');
    editor.querySelector('textarea').value = 'A private memory for student A.'; editor.requestSubmit();
    cleanup(); cleanup();
    assert.equal(mutationSignal.aborted, true);
    assert.equal(root.children.length, 0);
    late.resolve(response({ note: { ...originalNote, text: 'A private memory for student A.' } }));
    await settle();
    assert.equal(root.children.length, 0);
    assert.equal(events, 0);
    editor.requestSubmit();
    assert.equal(root.children.length, 0);
  });
});

test('adding a memory retries the same request ID without losing failed text and then announces creation', async () => {
  const posted = []; const events = [];
  await withMemories(async (_url, options = {}) => {
    if (options.method === 'POST') {
      posted.push(JSON.parse(options.body));
      return posted.length === 1 ? response({ error: 'Save unavailable.' }, 503) : response({ note: originalNote });
    }
    return response({ notes: [], totalCount: 0 });
  }, async ({ root, win }) => {
    win.addEventListener('students4ai-memo-saved', event => events.push(event.detail));
    const form = root.querySelector('.memo-form'), input = form.querySelector('textarea');
    input.value = 'Please show one step at a time.';
    form.requestSubmit(); await settle();
    assert.equal(input.value, 'Please show one step at a time.');
    assert.equal(input.disabled, false);
    form.requestSubmit(); await settle();
    assert.equal(posted[0].clientRequestId, posted[1].clientRequestId);
    assert.equal(posted[1].source.kind, 'settings');
    assert.equal(input.value, '');
    assert.deepEqual(events, [{ profileId: 'student-a', action: 'created' }]);
  });
});

test('mutation helpers encode profile/id and never report a failed deletion as success', async () => {
  const before = { fetch: globalThis.fetch, window: globalThis.window };
  const calls = []; globalThis.window = new EventTarget(); let events = 0;
  window.addEventListener('students4ai-memo-saved', () => { events += 1; });
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return response({ error: 'This memory is unavailable.' }, 404); };
  try {
    await assert.rejects(updateStudentMemo('a&profile=b', 'id&all=true', 'safe text'), /unavailable/);
    await assert.rejects(deleteStudentMemo('a&profile=b', 'id&all=true'), /unavailable/);
    assert.ok(calls.every(call => call.url === '/api/continuity?profile=a%26profile%3Db&id=id%26all%3Dtrue'));
    assert.equal(events, 0);
  } finally { Object.assign(globalThis, before); }
});

test('a failed initial read offers retry without claiming the learner has no memories', async () => {
  let reads = 0;
  await withMemories(async () => {
    reads += 1;
    return reads === 1 ? response({ error: 'Unavailable.' }, 503) : response({ notes: [originalNote], totalCount: 1 });
  }, async ({ root }) => {
    assert.match(root.querySelector('.memo-count').textContent, /could not load/);
    const retry = root.querySelector('.memo-reload');
    assert.equal(retry.hidden, false);
    assert.equal(retry.disabled, false);
    retry.click(); await settle();
    assert.equal(retry.hidden, true);
    assert.equal(root.querySelector('.memo-text').textContent, originalNote.text);
    assert.equal(reads, 2);
  });
});

test('compact Coach memories put real saved cards before collapsed add controls while preserving accessible editing', async () => {
  let stored = originalNote, deleted = false;
  await withMemories(async (_url, options = {}) => {
    if (options.method === 'PATCH') {
      stored = { ...stored, text: JSON.parse(options.body).text, updatedAt: '2026-10-02T11:00:00Z' };
      return response({ note: stored });
    }
    if (options.method === 'DELETE') { deleted = true; return response({ deleted: true, id: stored.id }); }
    return response({ notes: deleted ? [] : [stored], totalCount: deleted ? 0 : 1 });
  }, async ({ root }) => {
    assert.match(root.className, /memo-compact/);
    assert.equal(root.querySelector('.memo-introduction').textContent, "Things I've learned about you from our chats");
    assert.equal(root.querySelector('h2'), null, 'drawer shell supplies its own Coach Notes title');
    const list = root.querySelector('.memo-list'), details = root.querySelector('.memo-add-details');
    assert.ok(root.children.indexOf(list) < root.children.indexOf(details));
    assert.notEqual(details.open, true, 'manual add form starts collapsed');
    assert.equal(details.querySelector('summary').textContent, 'Add a memory');
    assert.ok(details.querySelector('.memo-form'));
    const row = list.querySelector('.memo-item');
    assert.equal(row.children[0].className, 'memo-card-heading');
    assert.equal(row.querySelector('.memo-type-label').textContent, 'Learned from coaching');
    assert.equal(row.children[1].className, 'memo-text');
    assert.match(row.children[2].textContent, /AP Calculus BC · Study coach · Saved /);
    assert.equal(row.querySelector('.memo-edit').attributes['aria-label'], 'Edit memory');
    assert.equal(row.querySelector('.memo-remove').attributes['aria-label'], 'Remove memory');
    assert.equal(row.querySelectorAll('svg').length, 2);
    named(row, 'Edit').click();
    const editor = row.querySelector('.memo-edit-form');
    editor.querySelector('textarea').value = 'Use a table before the formula.';
    editor.requestSubmit(); await settle();
    assert.equal(root.querySelector('.memo-text').textContent, 'Use a table before the formula.');
    assert.match(root.querySelector('.memo-item').textContent, /Updated /);
    assert.equal(root.querySelector('.memo-type-label').textContent, 'Learned from coaching');
    named(root, 'Remove').click(); named(root, 'Remove memory').click(); await settle();
    assert.equal(root.querySelector('.memo-item'), null);
    assert.equal(document.activeElement, details.querySelector('summary'), 'deletion focuses a visible control while the add form is collapsed');
  }, { compact: true });
});
