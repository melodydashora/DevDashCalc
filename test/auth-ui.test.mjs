import test from 'node:test';
import assert from 'node:assert/strict';

const ORIGIN = 'https://students4ai.example';
const INVITATION = 'a'.repeat(43);
const SECOND_INVITATION = 'b'.repeat(43);
const PASSWORD = 'Only a synthetic test password';
const decode = value => value.replace(/&(amp|lt|gt|quot|#39);/g,
  (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[entity]));

// Parse the application's own markup, then run its real event handlers. This
// fixture supplies only the DOM operations used by mountAccountGate; it does
// not simulate browser layout, native constraint validation, or actual cookies.
class FixtureNode {
  constructor(tag = 'div', attributes = {}, text = '') {
    this.tagName = tag.toUpperCase();
    this.attributes = new Map(Object.entries(attributes));
    this.children = [];
    this.text = text;
    this.value = attributes.value || '';
    this.listeners = new Map();
    this.disabled = false;
  }
  set innerHTML(html) {
    this.children = [];
    this.text = '';
    const stack = [this];
    for (const part of html.match(/<[^>]+>|[^<]+/g) || []) {
      if (part.startsWith('</')) { stack.pop(); continue; }
      if (part.startsWith('<')) {
        const tag = /^<([a-z][a-z0-9-]*)/i.exec(part)?.[1];
        if (!tag) continue;
        const attributes = {};
        for (const match of part.matchAll(/([a-zA-Z][\w-]*)="([^"]*)"/g)) attributes[match[1]] = decode(match[2]);
        const node = new FixtureNode(tag, attributes);
        stack.at(-1).children.push(node);
        if (!['input', 'br', 'hr', 'img', 'meta', 'link'].includes(tag)) stack.push(node);
      } else stack.at(-1).children.push(new FixtureNode('#text', {}, decode(part)));
    }
    assert.equal(stack.length, 1, 'auth markup has balanced non-void tags');
  }
  get textContent() { return this.text + this.children.map(node => node.textContent).join(''); }
  set textContent(text) { this.text = String(text); this.children = []; }
  get elements() {
    return Object.fromEntries(this.descendants().filter(node => node.tagName === 'INPUT')
      .map(node => [node.getAttribute('name'), node]));
  }
  descendants() { return this.children.flatMap(node => [node, ...node.descendants()]); }
  querySelectorAll(selector) {
    return this.descendants().filter(node => {
      if (selector.startsWith('#')) return node.getAttribute('id') === selector.slice(1);
      const attribute = /^([a-z]+)\[([\w-]+)="([^"]*)"\]$/.exec(selector);
      if (attribute) return node.tagName === attribute[1].toUpperCase() && node.getAttribute(attribute[2]) === attribute[3];
      return node.tagName === selector.toUpperCase();
    });
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  focus() { this.focused = true; }
  reset() { for (const field of Object.values(this.elements)) field.value = ''; }
  async dispatch(type) {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    for (const handler of this.listeners.get(type) || []) await handler(event);
    return event;
  }
}

let fixtureId = 0;
async function fixture(t, { hash = '#/login', session = {}, notice = '', respond } = {}) {
  const originals = new Map(['window', 'location', 'history', 'FormData', 'fetch']
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  const location = { origin: ORIGIN, pathname: '/', search: '', hash };
  const history = { replaceState(_state, _title, value) {
    const url = new URL(value, ORIGIN);
    Object.assign(location, { pathname: url.pathname, search: url.search, hash: url.hash });
  } };
  const window = { sessionStorage: storage };
  window.top = window;
  const requests = [];
  const response = respond || (() => ({ ok: true, data: { authenticated: true, user: { username: 'fixture-student' } } }));
  let cleanup;
  t.after(() => {
    cleanup?.();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  Object.assign(globalThis, {
    window, location, history,
    FormData: class {
      constructor(form) { this.values = Object.fromEntries(Object.entries(form.elements).map(([key, field]) => [key, field.value])); }
      get(key) { return this.values[key] ?? null; }
    },
    fetch: async (path, options) => {
      const request = { path, ...options, data: JSON.parse(options.body) };
      requests.push(request);
      const result = await response(request);
      return { ok: result.ok, json: async () => result.data };
    },
  });
  const ui = await import(`../public/auth-ui.js?fixture=${++fixtureId}`);
  const root = new FixtureNode();
  const changes = [];
  const authenticated = [];
  let mountedKey;
  function mount(message = '') {
    cleanup?.();
    mountedKey = ui.accountGateKey();
    cleanup = ui.mountAccountGate(root, {
      session, notice: message,
      onSetupChanged(next) {
        changes.push({ message: next, key: ui.accountGateKey() });
        if (mountedKey !== ui.accountGateKey()) mount(next);
        else root.querySelector('#account-message').textContent = next;
      },
      onAuthenticated: async data => { authenticated.push(data); },
    });
  }
  ui.captureEnrollment();
  mount(notice);
  return {
    root, ui, values, location, requests, changes, authenticated,
    form: () => root.querySelector('#account-form'),
    status: () => root.querySelector('#account-message').textContent,
    fill(fields) { for (const [key, value] of Object.entries(fields)) root.querySelector('#account-form').elements[key].value = value; },
    submit: () => root.querySelector('#account-form').dispatch('submit'),
    async click(selector) {
      const node = root.querySelector(selector);
      assert.ok(node, `rendered control ${selector}`);
      const event = await node.dispatch('click');
      if (!event.defaultPrevented && node.tagName === 'A') {
        location.hash = node.getAttribute('href');
        ui.captureEnrollment();
        mount();
      }
    },
    navigate(nextHash) { location.hash = nextHash; ui.captureEnrollment(); mount(); },
    dispose() { cleanup?.(); },
  };
}

test('sign-in exposes Create account and signup without an invitation cannot post credentials', async t => {
  const f = await fixture(t);
  assert.equal(f.root.querySelector('a[href="#/signup"]').textContent, 'Create account');
  assert.ok(f.form().elements.username);
  assert.ok(f.form().elements.password);
  await f.click('a[href="#/signup"]');
  assert.equal(f.location.hash, '#/signup');
  assert.ok(f.form().elements.invitation);
  assert.equal(f.form().elements.username, undefined);
  assert.equal(f.form().elements.password, undefined);
  await f.submit();
  assert.equal(f.requests.length, 0);
  assert.equal(f.form().elements.invitation.getAttribute('aria-invalid'), 'true');
  assert.equal(f.form().elements.invitation.focused, true);
  assert.match(f.status(), /complete Students4AI setup link/);
});

test('pasted same-origin invitation changes the gate key and opens the credential form without a POST', async t => {
  const f = await fixture(t, { hash: '#/signup' });
  const before = f.ui.accountGateKey();
  f.fill({ invitation: `${ORIGIN}/#/signup?enrollment=${INVITATION}` });
  await f.submit();
  assert.equal(f.requests.length, 0);
  assert.equal(f.changes.length, 1);
  assert.equal(f.changes[0].message, '');
  assert.notEqual(f.ui.accountGateKey(), before);
  assert.equal(f.location.hash, '#/signup');
  assert.equal(f.form().elements.invitation, undefined);
  assert.ok(f.form().elements.confirmPassword);
  assert.match(f.root.textContent, /invitation is ready/);
  assert.equal(JSON.parse([...f.values.values()][0]).token, INVITATION);
});

test('foreign-origin and malformed invitation input stays on entry and makes no request', async t => {
  const f = await fixture(t, { hash: '#/signup' });
  for (const invitation of [`https://another.example/#/signup?enrollment=${INVITATION}`, 'not-an-invitation']) {
    f.fill({ invitation });
    await f.submit();
    assert.equal(f.requests.length, 0);
    assert.equal(f.values.size, 0);
    assert.ok(f.form().elements.invitation);
  }
});

test('registration sends the captured invitation and fake credentials, then clears setup storage', async t => {
  const f = await fixture(t, { hash: `#/signup?enrollment=${INVITATION}` });
  const form = f.form();
  f.fill({ username: ' fixture-student ', password: PASSWORD, confirmPassword: PASSWORD });
  await f.submit();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].path, '/api/auth/register');
  assert.equal(f.requests[0].method, 'POST');
  assert.deepEqual(f.requests[0].data, { username: 'fixture-student', password: PASSWORD, enrollmentToken: INVITATION });
  assert.equal(f.authenticated.length, 1);
  assert.equal(f.values.size, 0);
  assert.equal(f.ui.accountGateKey(), 'signup:');
  assert.equal(form.elements.password.value, '');
  assert.equal(form.elements.confirmPassword.value, '');
});

test('rejected invalid or consumed invitation clears it and reopens entry with the server message', async t => {
  const f = await fixture(t, {
    hash: `#/signup?enrollment=${INVITATION}`,
    respond: () => ({ ok: false, data: { code: 'INVALID_ENROLLMENT', error: 'This invitation is invalid, expired, or already used.' } }),
  });
  f.fill({ username: 'fixture-student', password: PASSWORD, confirmPassword: PASSWORD });
  await f.submit();
  assert.equal(f.requests.length, 1);
  assert.equal(f.authenticated.length, 0);
  assert.equal(f.values.size, 0);
  assert.ok(f.form().elements.invitation);
  assert.equal(f.form().elements.password, undefined);
  assert.equal(f.status(), 'This invitation is invalid, expired, or already used.');
  f.fill({ invitation: SECOND_INVITATION });
  await f.submit();
  assert.ok(f.form().elements.password);
  assert.equal(f.status(), '');
  assert.equal(JSON.parse([...f.values.values()][0]).token, SECOND_INVITATION);
});

test('back to sign-in clears invitation and signup notice before rendering login fields', async t => {
  const f = await fixture(t, { hash: `#/signup?enrollment=${INVITATION}`, notice: 'Previous setup notice' });
  await f.click('#account-back');
  assert.equal(f.location.hash, '#/login');
  assert.equal(f.values.size, 0);
  assert.equal(f.ui.accountGateKey(), 'login:');
  assert.equal(f.status(), '');
  assert.ok(f.form().elements.password);
  assert.equal(f.form().elements.confirmPassword, undefined);
  assert.equal(f.requests.length, 0);
});

test('authenticated account-switch explanation survives invitation entry and change separately from status', async t => {
  const f = await fixture(t, { hash: '#/signup', session: { authenticated: true, user: { username: 'fixture-current' } } });
  const warning = /signed in as fixture-current\. Creating another student account will switch this browser to that student\./;
  assert.match(f.root.textContent, warning);
  f.fill({ invitation: INVITATION });
  await f.submit();
  assert.equal(f.status(), '');
  assert.match(f.root.textContent, warning);
  await f.click('#account-change-invitation');
  assert.ok(f.form().elements.invitation);
  assert.equal(f.values.size, 0);
  assert.equal(f.status(), '');
  assert.match(f.root.textContent, warning);
});

test('password confirmation prevents registration and username rejection keeps an invitation retryable', async t => {
  const f = await fixture(t, {
    hash: `#/signup?enrollment=${INVITATION}`,
    respond: () => ({ ok: false, data: { code: 'USERNAME_TAKEN', error: 'That username is unavailable.' } }),
  });
  f.fill({ username: 'fixture-student', password: PASSWORD, confirmPassword: 'A different synthetic password' });
  await f.submit();
  assert.equal(f.requests.length, 0);
  assert.equal(f.form().elements.confirmPassword.focused, true);
  f.fill({ confirmPassword: PASSWORD });
  await f.submit();
  assert.equal(f.requests.length, 1);
  assert.match(f.status(), /username is unavailable/);
  assert.ok(f.form().elements.password);
  assert.equal(JSON.parse([...f.values.values()][0]).token, INVITATION);
  assert.equal(f.form().querySelector('button').disabled, false);
});

test('a disposed registration response cannot clear a replacement invitation or authenticate a stale view', async t => {
  let complete;
  const waiting = new Promise(resolve => { complete = resolve; });
  const f = await fixture(t, { hash: `#/signup?enrollment=${INVITATION}`, respond: () => waiting });
  f.fill({ username: 'fixture-student', password: PASSWORD, confirmPassword: PASSWORD });
  const submitted = f.submit();
  assert.equal(f.requests.length, 1);
  f.navigate(`#/signup?enrollment=${SECOND_INVITATION}`);
  complete({ ok: true, data: { authenticated: true } });
  await submitted;
  assert.equal(f.authenticated.length, 0);
  assert.equal(JSON.parse([...f.values.values()][0]).token, SECOND_INVITATION);
  assert.ok(f.form().elements.password);
  assert.equal(f.status(), '');
});
