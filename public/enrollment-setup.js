// Invitation persistence is tab-scoped. The server still decides whether a
// single-use invitation is valid, unclaimed, and within its actual expiry.
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const STORAGE_KEY = 'students4ai-enrollment-setup';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function fragmentToken(hash) {
  if (!hash.startsWith('#/signup?')) return '';
  const params = new URLSearchParams(hash.slice('#/signup?'.length));
  const entries = [...params];
  return entries.length === 1 && entries[0][0] === 'enrollment' && TOKEN.test(entries[0][1]) ? entries[0][1] : '';
}

export function parseEnrollmentInput(value, origin) {
  if (typeof value !== 'string') return '';
  const input = value.trim();
  if (TOKEN.test(input)) return input;
  if (input.length > 4096 || !/^https?:\/\//i.test(input) || /[\u0000-\u0020\u007f\\]/.test(input)) return '';
  try {
    const url = new URL(input);
    const expected = new URL(origin);
    if (!/^https?:$/.test(expected.protocol) || url.origin !== expected.origin
      || url.username || url.password || url.pathname !== '/' || url.search) return '';
    return fragmentToken(url.hash);
  } catch { return ''; }
}

export function createEnrollmentSetup({ location, history, storage, now = Date.now }) {
  let active = null;
  let canRestore = true;

  const validRecord = record => record && typeof record === 'object' && !Array.isArray(record)
    && typeof record.token === 'string' && TOKEN.test(record.token)
    && Number.isFinite(record.savedAt) && record.savedAt <= now() && now() - record.savedAt < MAX_AGE_MS;

  function forgetStored() {
    try { storage?.removeItem(STORAGE_KEY); }
    catch {
      // Some storage adapters can still overwrite a key when removal fails.
      try { storage?.setItem(STORAGE_KEY, ''); } catch { /* Storage is optional. */ }
    }
  }

  function replaceHash(hash) {
    try { history.replaceState(null, '', `${location.pathname}${location.search}${hash}`); }
    catch { /* Keeping the current URL still allows the server-checked flow. */ }
  }

  function clear() {
    active = null;
    canRestore = false;
    forgetStored();
    if (location.hash.startsWith('#/signup?')) replaceHash('#/signup');
  }

  function token() {
    if (active && !validRecord(active)) clear();
    return active?.token || '';
  }

  function persist() {
    try {
      if (!storage) return false;
      const serialized = JSON.stringify(active);
      storage.setItem(STORAGE_KEY, serialized);
      return storage.getItem(STORAGE_KEY) === serialized;
    } catch { return false; }
  }

  function remember(value) {
    active = null;
    canRestore = false;
    forgetStored();
    if (typeof value !== 'string' || !TOKEN.test(value)) {
      if (location.hash.startsWith('#/signup?')) replaceHash('#/signup');
      return false;
    }
    active = { token: value, savedAt: now() };
    const stored = persist();
    replaceHash(stored ? '#/signup' : `#/signup?enrollment=${encodeURIComponent(value)}`);
    return true;
  }

  function capture() {
    if (location.hash.startsWith('#/signup?')) {
      // An explicit replacement, including a malformed one, must never fall
      // back to the previous child's invitation.
      active = null;
      canRestore = false;
      forgetStored();
      const candidate = parseEnrollmentInput(`${location.origin}${location.pathname}${location.search}${location.hash}`, location.origin);
      if (!candidate) return false;
      active = { token: candidate, savedAt: now() };
      if (persist()) replaceHash('#/signup');
      return true;
    }
    if (location.hash !== '#/signup') return Boolean(token());
    if (token()) return true;
    if (!canRestore) return false;
    canRestore = false;
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
      if (validRecord(saved)) active = { token: saved.token, savedAt: saved.savedAt };
      else forgetStored();
    } catch { forgetStored(); }
    return Boolean(token());
  }

  return { capture, token, remember, clear };
}
