import test from 'node:test';
import assert from 'node:assert/strict';
import { mountCanvasAccount } from '../public/canvas-account.js';

const CONNECTED = { connected: true, userName: 'Fixture student', host: 'school.example', remembered: true };
const TOKEN = 'synthetic-canvas-token-only';
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Small fixture for authored markup and real event handlers, not browser layout
// or native form validation. No DOM dependency or real school requests needed.
class FixtureNode {
  constructor(tag = 'div', attributes = {}, text = '') {
    this.tagName = tag.toUpperCase();
    this.attributes = new Map(Object.entries(attributes));
    this.children = [];
    this.text = text;
    this.value = attributes.value || '';
    this.listeners = new Map();
    this.disabled = false;
    this.hidden = false;
    this.checked = false;
  }
  set innerHTML(html) {
    this.children = [];
    const stack = [this];
    for (const part of html.match(/<[^>]+>|[^<]+/g) || []) {
      if (part.startsWith('</')) { stack.pop(); continue; }
      if (!part.startsWith('<')) { stack.at(-1).children.push(new FixtureNode('#text', {}, part)); continue; }
      const tag = /^<([a-z][a-z0-9-]*)/i.exec(part)?.[1];
      if (!tag) continue;
      const attributes = Object.fromEntries([...part.matchAll(/([a-zA-Z][\w-]*)="([^"]*)"/g)].map(match => [match[1], match[2]]));
      const node = new FixtureNode(tag, attributes);
      node.hidden = /\shidden(?:\s|>)/.test(part);
      node.checked = /\schecked(?:\s|>)/.test(part);
      stack.at(-1).children.push(node);
      if (!['input', 'br', 'hr'].includes(tag)) stack.push(node);
    }
    assert.equal(stack.length, 1, 'authored tags balance');
  }
  get textContent() { return this.text + this.children.map(node => node.textContent).join(''); }
  set textContent(value) { this.text = String(value); this.children = []; }
  descendants() { return this.children.flatMap(node => [node, ...node.descendants()]); }
  querySelector(selector) {
    return this.descendants().find(node => selector.startsWith('.')
      ? (node.getAttribute('class') || '').split(/\s+/).includes(selector.slice(1))
      : selector.startsWith('#') ? node.getAttribute('id') === selector.slice(1)
        : node.tagName === selector.toUpperCase()) || null;
  }
  get elements() {
    return Object.fromEntries(this.descendants().filter(node => node.tagName === 'INPUT')
      .map(node => [node.getAttribute('name'), node]));
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  focus() { if (!this.disabled) this.focused = true; }
  async dispatch(type) {
    for (const listener of this.listeners.get(type) || []) await listener({ preventDefault() {} });
  }
}

function fixture(t, options = {}) {
  const root = new FixtureNode();
  const connections = [];
  let disconnections = 0;
  const cleanup = mountCanvasAccount(root, {
    profileName: 'Fixture workspace',
    loadConnection: options.loadConnection || (async () => ({ connected: false })),
    connect: async request => { connections.push(request); return options.connect ? options.connect(request) : CONNECTED; },
    disconnect: async () => { disconnections++; return options.disconnect ? options.disconnect() : { connected: false }; },
  });
  t.after(cleanup);
  const form = root.querySelector('form');
  return {
    root, form, connections, cleanup,
    get disconnections() { return disconnections; },
    status: () => root.querySelector('.canvas-account-status').textContent,
    identity: () => root.querySelector('.canvas-account-identity').textContent,
    click: selector => root.querySelector(selector).dispatch('click'),
    submit: () => form.dispatch('submit'),
    fill({ baseUrl = 'https://school.example/', token = TOKEN, remember = true } = {}) {
      form.elements.baseUrl.value = baseUrl;
      form.elements.token.value = token;
      form.elements.remember.checked = remember;
    },
  };
}

test('Canvas is optional and adding a token opens a blank password field in the same card', async t => {
  const f = fixture(t);
  await flush();
  assert.equal(f.root.querySelector('h2').textContent, 'Canvas connection');
  assert.match(f.root.textContent, /Lessons, practice, and mastery checks are available without Canvas/);
  assert.equal(f.root.querySelector('a').getAttribute('href'), '#/home');
  assert.equal(f.root.querySelector('a').textContent, 'Continue learning');
  assert.equal(f.form.hidden, true);
  await f.click('.canvas-account-edit');
  assert.equal(f.form.hidden, false);
  assert.equal(f.form.elements.token.getAttribute('type'), 'password');
  assert.equal(f.form.elements.token.getAttribute('autocomplete'), 'off');
  assert.equal(f.form.elements.token.getAttribute('maxlength'), '2048');
  assert.equal(f.form.elements.token.value, '');
  assert.equal(f.form.elements.remember.checked, true);
  assert.match(f.root.textContent, /server, then to your school/);
  assert.equal(f.connections.length, 0);
});

test('connection summary uses inert text and never renders a saved token from an adapter', async t => {
  const f = fixture(t, { loadConnection: async () => ({ ...CONNECTED, userName: '<img src=x>', token: TOKEN, prepared: true }) });
  await flush();
  assert.match(f.identity(), /<img src=x>/);
  assert.equal(f.root.querySelector('img'), null);
  assert.doesNotMatch(f.root.textContent, new RegExp(TOKEN));
  assert.equal(f.form.elements.token.value, '');
  assert.equal(f.form.elements.baseUrl.value, 'https://school.example');
  assert.equal(f.root.querySelector('.canvas-account-edit').textContent, 'Update Canvas token');
  assert.equal(f.root.querySelector('.canvas-account-disconnect').hidden, false);
  assert.match(f.root.textContent, /prepared for your learning workspace/);
});

test('submitting clears the token immediately and disables duplicate mutation until the verified summary returns', async t => {
  const waiting = deferred();
  const f = fixture(t, { connect: () => waiting.promise });
  await flush();
  await f.click('.canvas-account-edit');
  f.fill({ remember: false });
  const submitted = f.submit();
  assert.equal(f.form.elements.token.value, '');
  assert.equal(f.form.elements.token.disabled, true);
  assert.match(f.status(), /Verifying and saving/);
  assert.deepEqual(f.connections, [{ baseUrl: 'https://school.example', token: TOKEN, remember: false }]);
  await f.submit();
  await f.click('.canvas-account-disconnect');
  await f.click('.canvas-account-cancel');
  assert.equal(f.connections.length, 1);
  assert.equal(f.disconnections, 0);
  assert.equal(f.form.hidden, false);
  waiting.resolve({ ...CONNECTED, remembered: false });
  await submitted;
  assert.equal(f.form.hidden, true);
  assert.equal(f.form.elements.token.disabled, false);
  assert.match(f.identity(), /Connected as Fixture student to school.example/);
  assert.match(f.root.textContent, /up to 8 hours or until the server restarts/);
  assert.match(f.status(), /connection is ready/);
});

test('failed token update keeps the previous identity and allows retry without echoing an error or secret', async t => {
  let attempts = 0;
  const f = fixture(t, { loadConnection: async () => CONNECTED, connect: async () => {
    if (++attempts === 1) throw new Error(`Provider error containing ${TOKEN}`);
    return { ...CONNECTED, userName: 'Updated fixture student' };
  } });
  await flush();
  await f.click('.canvas-account-edit');
  f.fill();
  await f.submit();
  assert.match(f.identity(), /Connected as Fixture student/);
  assert.equal(f.form.hidden, false);
  assert.equal(f.form.elements.token.value, '');
  assert.equal(f.form.elements.token.focused, true);
  assert.equal(f.form.elements.token.disabled, false);
  assert.doesNotMatch(f.root.textContent, /Provider error|synthetic-canvas-token/);
  assert.match(f.status(), /could not confirm the updated connection/);
  f.fill({ token: 'another-fixture-token' });
  await f.submit();
  assert.match(f.identity(), /Updated fixture student/);
  assert.equal(f.form.hidden, true);
});

test('invalid school URLs and absent tokens make no connection request and clear the token input', async t => {
  const f = fixture(t);
  await flush();
  await f.click('.canvas-account-edit');
  for (const baseUrl of ['http://school.example', 'https://user:pass@school.example', 'https://school.example/courses', 'https://school.example/?key=value']) {
    f.fill({ baseUrl });
    await f.submit();
    assert.equal(f.connections.length, 0);
    assert.equal(f.form.elements.token.value, '');
    assert.match(f.status(), /HTTPS address/);
  }
  for (const token of ['', 'x'.repeat(2049)]) {
    f.fill({ token });
    await f.submit();
    assert.equal(f.connections.length, 0);
    assert.match(f.status(), /access token/);
  }
});

test('initial load failure leaves manual setup available and never invents a disconnected account', async t => {
  const f = fixture(t, { loadConnection: async () => { throw new Error('private provider failure'); } });
  await flush();
  assert.equal(f.identity(), 'Canvas connection status is unavailable.');
  assert.match(f.status(), /enter a token to connect, or continue learning/);
  assert.doesNotMatch(f.root.textContent, /private provider failure/);
  await f.click('.canvas-account-edit');
  assert.equal(f.form.hidden, false);
  assert.equal(f.form.elements.baseUrl.disabled, false);
});

test('late initial load cannot replace a new verified connection or erase a typed school address', async t => {
  const loading = deferred();
  const f = fixture(t, { loadConnection: () => loading.promise });
  await flush();
  await f.click('.canvas-account-edit');
  f.fill({ baseUrl: 'https://new-school.example' });
  await f.submit();
  loading.resolve({ ...CONNECTED, userName: 'Old fixture identity', host: 'old-school.example' });
  await flush();
  assert.match(f.identity(), /Connected as Fixture student/);
  assert.doesNotMatch(f.identity(), /Old fixture/);
  assert.equal(f.form.elements.baseUrl.value, 'https://new-school.example');
});

test('disconnect happens only on its button, prevents duplicates, and keeps learning available', async t => {
  const waiting = deferred();
  const f = fixture(t, { loadConnection: async () => CONNECTED, disconnect: () => waiting.promise });
  await flush();
  assert.equal(f.disconnections, 0);
  const clicked = f.click('.canvas-account-disconnect');
  await f.click('.canvas-account-disconnect');
  assert.equal(f.disconnections, 1);
  waiting.resolve({ connected: false });
  await clicked;
  assert.equal(f.identity(), 'Canvas is not connected.');
  assert.equal(f.root.querySelector('.canvas-account-disconnect').hidden, true);
  assert.equal(f.root.querySelector('.canvas-account-edit').textContent, 'Add Canvas token');
  assert.match(f.status(), /lessons and saved progress are still available/);
});

test('failed disconnect keeps existing connection and resets controls for another attempt', async t => {
  const f = fixture(t, { loadConnection: async () => CONNECTED, disconnect: async () => { throw new Error(TOKEN); } });
  await flush();
  await f.click('.canvas-account-disconnect');
  assert.match(f.identity(), /Connected as Fixture student/);
  assert.match(f.status(), /disconnect could not be confirmed/);
  assert.equal(f.root.querySelector('.canvas-account-disconnect').disabled, false);
  assert.doesNotMatch(f.status(), new RegExp(TOKEN));
});

test('cancel and disposal clear typed tokens, and pending results cannot modify a later profile card', async t => {
  const connecting = deferred();
  const f = fixture(t, { connect: () => connecting.promise });
  await flush();
  await f.click('.canvas-account-edit');
  f.fill();
  await f.click('.canvas-account-cancel');
  assert.equal(f.form.elements.token.value, '');
  assert.equal(f.form.hidden, true);
  await f.click('.canvas-account-edit');
  f.fill();
  const submitted = f.submit();
  f.cleanup();
  f.root.textContent = 'Another profile card';
  connecting.resolve(CONNECTED);
  await submitted;
  assert.equal(f.root.textContent, 'Another profile card');
  assert.equal(f.form.elements.token.value, '');
});

test('disposed initial loading and disconnect responses leave a replacement card untouched', async t => {
  const loading = deferred();
  const first = fixture(t, { loadConnection: () => loading.promise });
  await flush();
  first.cleanup();
  first.root.textContent = 'Replacement after load';
  loading.resolve(CONNECTED);
  await flush();
  assert.equal(first.root.textContent, 'Replacement after load');

  const removing = deferred();
  const second = fixture(t, { loadConnection: async () => CONNECTED, disconnect: () => removing.promise });
  await flush();
  const clicked = second.click('.canvas-account-disconnect');
  second.cleanup();
  second.root.textContent = 'Replacement after disconnect';
  removing.resolve({ connected: false });
  await clicked;
  assert.equal(second.root.textContent, 'Replacement after disconnect');
});

test('an unverified connect result cannot replace the previous connection or reflect an unsafe notice', async t => {
  const f = fixture(t, { loadConnection: async () => CONNECTED,
    connect: async () => ({ connected: false, notice: `Unverified provider detail ${TOKEN}` }) });
  await flush();
  await f.click('.canvas-account-edit');
  f.fill();
  await f.submit();
  assert.match(f.identity(), /Connected as Fixture student/);
  assert.equal(f.form.hidden, false);
  assert.equal(f.form.elements.token.value, '');
  assert.match(f.status(), /could not confirm the updated connection/);
  assert.doesNotMatch(f.root.textContent, /Unverified provider detail|synthetic-canvas-token/);
});

test('partial saved-connection cleanup exposes a retry until durable removal succeeds', async t => {
  let attempts = 0;
  const f = fixture(t, { loadConnection: async () => CONNECTED, disconnect: async () => ++attempts === 1
    ? { connected: false, retryDisconnect: true, notice: 'Some saved connection data could not be removed. Retry disconnecting.' }
    : { connected: false, retryDisconnect: false } });
  await flush();
  await f.click('.canvas-account-disconnect');
  const button = f.root.querySelector('.canvas-account-disconnect');
  assert.equal(f.identity(), 'Canvas is not connected.');
  assert.equal(button.hidden, false);
  assert.equal(button.textContent, 'Retry removing saved connection');
  assert.match(f.root.textContent, /Some saved connection data could not be removed/);
  await f.click('.canvas-account-disconnect');
  assert.equal(f.disconnections, 2);
  assert.equal(button.hidden, true);
  assert.equal(f.root.querySelector('.canvas-account-notice').hidden, true);
});
