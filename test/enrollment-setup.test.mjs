import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnrollmentSetup, parseEnrollmentInput } from '../public/enrollment-setup.js';

const ORIGIN = 'https://students.example.test';
const FIRST = 'a'.repeat(43);
const SECOND = 'b'.repeat(43);
const KEY = 'students4ai-enrollment-setup';
const DAY = 24 * 60 * 60 * 1000;
const INITIAL_TIME = Date.parse('2026-09-15T10:00:00Z');
const invite = token => `${ORIGIN}/#/signup?enrollment=${token}`;

function memoryStorage(initial = []) {
  const data = new Map(initial);
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
  };
}

function page({ url = `${ORIGIN}/#/signup`, storage = memoryStorage(), now = () => INITIAL_TIME } = {}) {
  const location = new URL(url);
  const history = { replaceState(_state, _title, path) { location.href = new URL(path, location).href; } };
  return { location, storage, setup: createEnrollmentSetup({ location, history, storage, now }) };
}

test('setup input accepts raw codes or exact same-origin invitation links', () => {
  assert.equal(parseEnrollmentInput(`  ${FIRST}\n`, ORIGIN), FIRST);
  assert.equal(parseEnrollmentInput(invite(FIRST), ORIGIN), FIRST);
  const base64url = 'aZ09_-'.repeat(7) + '_';
  assert.equal(parseEnrollmentInput(base64url, ORIGIN), base64url);
  for (const value of [null, {}, '', 'a'.repeat(42), 'a'.repeat(44), '+'.repeat(43),
    invite(FIRST).replace(ORIGIN, 'https://other.example.test'),
    invite(FIRST).replace('https:', 'http:'),
    `https://user:password@students.example.test/#/signup?enrollment=${FIRST}`,
    `${ORIGIN}/other/#/signup?enrollment=${FIRST}`,
    `${ORIGIN}/?enrollment=${FIRST}#/signup`,
    `${ORIGIN}/?source=email#/signup?enrollment=${FIRST}`,
    `${ORIGIN}/#/login?enrollment=${FIRST}`,
    `${ORIGIN}/#/signup?enrollment=${FIRST}&enrollment=${SECOND}`,
    `${ORIGIN}/#/signup?enrollment=${FIRST}&next=/home`,
    `/#/signup?enrollment=${FIRST}`, `//students.example.test/#/signup?enrollment=${FIRST}`,
    `${ORIGIN}/#/signup?enrollment=${FIRST.slice(0, 20)}\n${FIRST.slice(20)}`,
  ]) assert.equal(parseEnrollmentInput(value, ORIGIN), '', `Rejected input: ${String(value)}`);
});

test('captured invitation survives a reload as a new helper instance in the same tab', () => {
  let instant = INITIAL_TIME;
  const original = page({ url: invite(FIRST), now: () => instant });
  assert.equal(original.setup.capture(), true);
  assert.equal(original.setup.token(), FIRST);
  assert.equal(original.location.hash, '#/signup');
  const saved = original.storage.getItem(KEY);
  instant += 5000;
  assert.equal(original.setup.capture(), true);
  assert.equal(original.storage.getItem(KEY), saved, 'Repeated capture does not extend local expiry');
  const reloaded = page({ url: original.location.href, storage: original.storage, now: () => instant });
  assert.equal(reloaded.setup.token(), '');
  assert.equal(reloaded.setup.capture(), true);
  assert.equal(reloaded.setup.token(), FIRST);
  assert.equal(reloaded.storage.getItem(KEY), saved, 'Reload preserves the original save time');
});

test('separate tab storage isolates invites and ordinary initial routes do not activate stored setup', () => {
  const first = page({ url: invite(FIRST) });
  first.setup.capture();
  assert.equal(page().setup.capture(), false);
  const login = page({ url: `${ORIGIN}/#/login`, storage: first.storage });
  assert.equal(login.setup.capture(), false);
  assert.equal(login.setup.token(), '');
  login.location.hash = '#/signup';
  assert.equal(login.setup.capture(), true);
  assert.equal(login.setup.token(), FIRST);
});

test('an explicit different invitation replaces both memory and stored child setup', () => {
  const current = page({ url: invite(FIRST) });
  current.setup.capture();
  current.location.href = invite(SECOND);
  assert.equal(current.setup.capture(), true);
  assert.equal(current.setup.token(), SECOND);
  assert.equal(JSON.parse(current.storage.getItem(KEY)).token, SECOND);
  assert.equal(page({ storage: current.storage }).setup.capture(), true);
});

test('malformed explicit invitation clears the previous child instead of falling back', () => {
  for (const fragment of ['#/signup?enrollment=wrong', '#/signup?enrollment=',
    `#/signup?enrollment=${FIRST}&enrollment=${SECOND}`, '#/signup?other=wrong']) {
    const current = page({ url: invite(FIRST) });
    current.setup.capture();
    current.location.hash = fragment;
    assert.equal(current.setup.capture(), false);
    assert.equal(current.setup.token(), '');
    assert.equal(current.storage.getItem(KEY), null);
    current.location.hash = '#/signup';
    assert.equal(current.setup.capture(), false);
    assert.equal(page({ storage: current.storage }).setup.capture(), false);
  }
});

test('stored invitations expire at 24 hours and malformed or future records are discarded', () => {
  for (const record of ['broken json', '[]', 'null', JSON.stringify({ token: FIRST }),
    JSON.stringify({ token: 'invalid', savedAt: INITIAL_TIME }),
    JSON.stringify({ token: FIRST, savedAt: String(INITIAL_TIME) }),
    JSON.stringify({ token: FIRST, savedAt: INITIAL_TIME + 1 }),
    JSON.stringify({ token: FIRST, savedAt: INITIAL_TIME - DAY }),
  ]) {
    const current = page({ storage: memoryStorage([[KEY, record]]) });
    assert.equal(current.setup.capture(), false);
    assert.equal(current.setup.token(), '');
    assert.equal(current.storage.getItem(KEY), null);
  }
  let instant = INITIAL_TIME;
  const current = page({ url: invite(FIRST), now: () => instant });
  current.setup.capture();
  instant += DAY - 1;
  assert.equal(current.setup.token(), FIRST);
  instant++;
  assert.equal(current.setup.token(), '');
  assert.equal(current.storage.getItem(KEY), null);
});

test('unavailable or failed storage keeps the full link so reload still captures it', () => {
  const denied = () => { throw new Error('Storage unavailable'); };
  for (const storage of [null, { getItem: denied, setItem: denied, removeItem: denied },
    { getItem: () => null, setItem: () => {}, removeItem: () => {} }]) {
    const original = page({ url: invite(FIRST), storage });
    assert.equal(original.setup.capture(), true);
    assert.equal(original.location.href, invite(FIRST));
    assert.equal(page({ url: original.location.href, storage }).setup.capture(), true);
    assert.equal(original.setup.remember(SECOND), true);
    assert.equal(original.setup.token(), SECOND);
    assert.equal(original.location.href, invite(SECOND));
  }
});

test('remember accepts a validated code, clear removes it, and invalid replacements cannot reuse it', () => {
  const current = page({ url: `${ORIGIN}/#/login` });
  assert.equal(current.setup.remember(FIRST), true);
  assert.equal(current.setup.token(), FIRST);
  assert.equal(current.location.hash, '#/signup');
  assert.equal(current.setup.remember('wrong'), false);
  assert.equal(current.setup.token(), '');
  assert.equal(current.storage.getItem(KEY), null);
  current.setup.remember(SECOND);
  current.setup.clear();
  assert.equal(current.setup.token(), '');
  assert.equal(current.storage.getItem(KEY), null);
  const unavailable = page({ url: invite(FIRST), storage: null });
  unavailable.setup.capture();
  unavailable.setup.clear();
  assert.equal(unavailable.location.hash, '#/signup');
  assert.equal(unavailable.setup.token(), '');
});

test('storage reads and history failures do not prevent an in-memory setup', () => {
  const denied = () => { throw new Error('Unavailable'); };
  const storage = { getItem: denied, setItem: denied, removeItem: denied };
  assert.equal(page({ storage }).setup.capture(), false);
  const location = new URL(invite(FIRST));
  const setup = createEnrollmentSetup({ location, storage: memoryStorage(), history: { replaceState: denied }, now: () => INITIAL_TIME });
  assert.equal(setup.capture(), true);
  assert.equal(setup.token(), FIRST);
  assert.equal(location.href, invite(FIRST));
  setup.clear();
  assert.equal(setup.token(), '');
});

test('a malformed replacement cannot revive a prior invite when storage refuses to erase it', () => {
  const denied = () => { throw new Error('Storage write unavailable'); };
  const storage = {
    getItem: () => JSON.stringify({ token: FIRST, savedAt: INITIAL_TIME }),
    setItem: denied,
    removeItem: denied,
  };
  const current = page({ storage });
  assert.equal(current.setup.capture(), true);
  assert.equal(current.setup.token(), FIRST);
  current.location.hash = '#/signup?enrollment=wrong';
  assert.equal(current.setup.capture(), false);
  current.location.hash = '#/signup';
  assert.equal(current.setup.capture(), false);
  assert.equal(current.setup.token(), '');
  current.setup.clear();
  assert.equal(current.setup.capture(), false);
});
