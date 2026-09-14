import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The server and its imports run in a disposable directory with fabricated
// Canvas responses. The real data folder, database, accounts and tokens are
// never read or modified. Provider calls are intercepted as well.
let sandbox, child, base, output = '';
const originalToken = 'test-original-secret';
const eshaToken = 'test-esha-secret';
const preload = `const gates = new Map();
process.on('message', message => { if (message.release) gates.get(message.release)?.(); });
const waitForTest = key => new Promise(resolve => { gates.set(key, resolve); process.send({ waiting: key }); });
globalThis.fetch = async (url, options = {}) => {
  const address = new URL(String(url));
  if (address.href === 'https://api.openai.com/v1/chat/completions') {
    const payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: payload.messages.map(m => m.content).join('\\n') } }] }), { status: 200 });
  }
  if (address.origin !== 'https://school.example') throw new Error('Unexpected external test request');
  const token = String(options.headers.authorization || '').replace('Bearer ', '');
  const identities = {
    'test-original-secret': { id: '100', name: 'Original learner' },
    'test-esha-secret': { id: '200', name: 'Esha' },
    'test-other-secret': { id: '300', name: 'Other learner' },
    'test-expiring-secret': { id: '400', name: 'Expired learner' },
    'test-slow-auth-secret': { id: '500', name: 'Old expired learner' },
    'test-slow-ok-secret': { id: '600', name: 'Old valid learner' },
    'test-slow-connect-secret': { id: '700', name: 'Pending connection' },
    'test-slow-stored-secret': { id: '800', name: 'Pending remembered connection' },
  };
  const user = identities[token];
  const answer = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  if (!user) return answer({ message: 'Rejected token ' + token }, 401);
  const endpoint = address.pathname.replace('/api/v1/', '');
  if (endpoint === 'users/self' && ['test-slow-connect-secret', 'test-slow-stored-secret'].includes(token)) await waitForTest(token);
  if (endpoint === 'users/self') return answer(user);
  if (token === 'test-expiring-secret') return answer({ message: 'Expired token ' + token }, 401);
  if (endpoint === 'courses' && ['test-slow-auth-secret', 'test-slow-ok-secret'].includes(token)) {
    await waitForTest(token);
    if (token === 'test-slow-auth-secret') return answer({ message: 'Expired token ' + token }, 401);
  }
  // All learners deliberately share Canvas course/assignment ids. This
  // catches any cache or preference lookup accidentally keyed by course only.
  if (endpoint === 'courses') return answer([{ id: '99', name: user.name + ' calculus course', course_code: 'CALC-BC', enrollments: [{ computed_current_score: Number(user.id) / 10 }] }]);
  if (endpoint === 'users/self/missing_submissions') return answer([]);
  if (endpoint === 'courses/99/assignment_groups') return answer([{ id: '1', name: 'Work', assignments: [{ id: '7', name: user.name + ' assignment', points_possible: 10, submission: { workflow_state: 'unsubmitted' } }] }]);
  if (endpoint === 'courses/99/modules') return answer([{ id: '8', name: user.name + ' module', items: [] }]);
  if (endpoint === 'courses/99/users/self/progress') return answer({ requirement_count: 3, requirement_completed_count: 1 });
  throw new Error('Unexpected Canvas endpoint ' + endpoint);
};`;

async function startServer() {
  const socket = createServer();
  await new Promise((done) => socket.listen(0, '127.0.0.1', done));
  const port = socket.address().port;
  await new Promise((done) => socket.close(done));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--import', `data:text/javascript;base64,${Buffer.from(preload).toString('base64')}`, 'server.js'], {
    cwd: sandbox,
    env: { ...process.env, PORT: String(port), DATABASE_URL: '', TUTOR_PROVIDERS: 'openai', OPENAI_API_KEY: 'test-model-secret' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Profile test server did not start')), 10000);
    child.once('error', reject);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Profile test server exited ${code}`)); });
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
      if (String(chunk).includes('listening on')) { clearTimeout(timer); done(); }
    });
  });
}

async function stopServer() {
  if (child && child.exitCode === null) {
    const stopped = new Promise((done) => child.once('exit', done));
    child.kill(); await stopped;
  }
}

before(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'students4ai-canvas-profiles-'));
  await mkdir(join(sandbox, 'public'));
  await mkdir(join(sandbox, 'data'));
  await writeFile(join(sandbox, 'package.json'), '{"type":"module"}');
  for (const file of ['server.js', 'store.js', 'ai-coach.js', 'public/engine.js', 'public/courses.js', 'public/canvas-insights.js']) {
    await copyFile(new URL(`../${file}`, import.meta.url), join(sandbox, file));
  }
  // Simulate an unchanged pre-feature installation's remembered account.
  await writeFile(join(sandbox, 'data/canvas-profile.json'), JSON.stringify({ baseUrl: 'https://school.example', token: originalToken }));
  await writeFile(join(sandbox, 'data/progress-learner.json'), JSON.stringify({ savedAt: 1, settings: { name: 'Original' }, skills: {} }));
  await startServer();
});
after(async () => {
  await stopServer();
  // Delete only this mkdtemp-created test directory, never the project/data.
  const target = resolve(sandbox || '');
  assert.ok(target.startsWith(resolve(tmpdir()) + '\\') || target.startsWith(resolve(tmpdir()) + '/'));
  assert.ok(target.includes('students4ai-canvas-profiles-'));
  await rm(target, { recursive: true, force: true });
});

async function api(path, { profile, method = 'GET', body, cookie } = {}) {
  const url = `${base}/api/canvas/${path}${profile === undefined ? '' : `?profile=${encodeURIComponent(profile)}`}`;
  const response = await fetch(url, {
    method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  const cookies = response.headers.get('set-cookie');
  const text = JSON.stringify(data);
  assert.doesNotMatch(text, /test-[a-z-]+-secret|Bearer /, 'no credentials in responses');
  return { status: response.status, data, cookie: cookies?.split(';')[0] || '', rawCookie: cookies || '' };
}
const connect = (profile, token, remember = true) => api('session', { profile, method: 'POST', body: { baseUrl: 'https://school.example', token, remember } });
function waitingFor(key) {
  return new Promise((done, reject) => {
    const timer = setTimeout(() => { child.off('message', onMessage); reject(new Error('Missing mock gate ' + key)); }, 10000);
    const onMessage = (message) => {
      if (message.waiting !== key) return;
      clearTimeout(timer); child.off('message', onMessage); done();
    };
    child.on('message', onMessage);
  });
}

test('legacy learner remains connected while a new learner starts without inheriting it', async () => {
  const legacy = await api('session');
  assert.equal(legacy.data.profileId, 'learner');
  assert.equal(legacy.data.user.name, 'Original learner');
  assert.match(legacy.cookie, /^canvas_session=/);
  assert.match(legacy.rawCookie, /HttpOnly; SameSite=Strict/);
  const esha = await api('session', { profile: 'student-esha', cookie: legacy.cookie });
  assert.deepEqual(esha.data, { profileId: 'student-esha', connected: false });
});

test('profile cookies, courses, assignments and assessments remain isolated even with identical Canvas ids', async () => {
  const original = await api('session');
  const esha = await connect('student-esha', eshaToken);
  assert.match(esha.cookie, /^canvas_session_student-esha=/);
  const both = `${original.cookie}; ${esha.cookie}`;
  const [a, b] = await Promise.all([
    api('snapshot', { profile: 'learner', cookie: both }),
    api('snapshot', { profile: 'student-esha', cookie: both }),
  ]);
  assert.equal(a.data.user.name, 'Original learner');
  assert.equal(b.data.user.name, 'Esha');
  assert.equal(a.data.courses[0].assignments[0].name, 'Original learner assignment');
  assert.equal(b.data.courses[0].assignments[0].name, 'Esha assignment');
  assert.equal(b.data.courses[0].modules[0].name, 'Esha module');
  const report = await api('assessment', { profile: 'student-esha', method: 'POST', cookie: both, body: { selectedSubject: 'all' } });
  assert.match(report.data.text, /Esha assignment/);
  assert.doesNotMatch(report.data.text, /Original learner/);
});

test('copying another workspace cookie cannot expose or invalidate that workspace session', async () => {
  const original = await api('session');
  const foreignValue = original.cookie.split('=')[1];
  const forged = await api('session', { profile: 'unconnected', cookie: `canvas_session_unconnected=${foreignValue}` });
  assert.equal(forged.data.connected, false);
  assert.equal((await api('session', { cookie: original.cookie })).data.user.name, 'Original learner');
  const transient = await connect('temporary', 'test-other-secret', false);
  assert.equal((await api('session', { profile: 'temporary' })).data.connected, false, 'nonremembered sessions require their own cookie');
  assert.equal((await api('session', { profile: 'temporary', cookie: transient.cookie })).data.user.name, 'Other learner');
});

test('preferences and credential records use separate keys and do not enter progress or static responses', async () => {
  await api('prefs', { method: 'PUT', body: { courseOverrides: { '99': 'hidden' } } });
  await api('prefs', { profile: 'student-esha', method: 'PUT', body: { courseOverrides: { '99': 'shown' } } });
  assert.deepEqual((await api('prefs')).data.courseOverrides, { '99': 'hidden' });
  assert.deepEqual((await api('prefs', { profile: 'student-esha' })).data.courseOverrides, { '99': 'shown' });
  const files = await readdir(join(sandbox, 'data'));
  for (const name of ['canvas-profile.json', 'canvas-prefs.json', 'cv-auth-student-esha.json', 'cv-prefs-student-esha.json']) assert.ok(files.includes(name));
  const progress = await (await fetch(`${base}/api/progress?profile=learner`)).json();
  assert.deepEqual(progress, { savedAt: 1, settings: { name: 'Original' }, skills: {} });
  assert.equal((await fetch(`${base}/data/cv-auth-student-esha.json`)).status, 404);
});

test('failed replacement, disconnect, and revoked token affect only the selected learner', async () => {
  const original = await api('session');
  const failed = await connect('learner', 'test-rejected-secret');
  assert.equal(failed.status, 401);
  assert.equal((await api('session', { cookie: original.cookie })).data.user.name, 'Original learner', 'a mistyped replacement preserves the working connection');
  const disconnected = await api('session', { profile: 'student-esha', method: 'DELETE' });
  assert.equal(disconnected.data.durableDeleted, true);
  assert.equal((await api('session', { profile: 'student-esha' })).data.connected, false);
  assert.equal((await api('session')).data.user.name, 'Original learner');
  const expiring = await connect('student-esha', 'test-expiring-secret');
  assert.equal((await api('snapshot', { profile: 'student-esha', cookie: expiring.cookie })).status, 401);
  assert.equal((await api('session', { profile: 'student-esha' })).data.connected, false);
  assert.equal((await api('session')).data.user.name, 'Original learner');
  assert.doesNotMatch(output, /test-(rejected|expiring)-secret/, 'upstream messages cannot echo tokens into logs');
});

test('remembered profile connections survive restart independently and invalid ids never alias the learner', async () => {
  await connect('student-esha', eshaToken);
  await stopServer(); await startServer();
  assert.equal((await api('session')).data.user.name, 'Original learner');
  assert.equal((await api('session', { profile: 'student-esha' })).data.user.name, 'Esha');
  assert.equal((await api('session', { profile: 'temporary' })).data.connected, false);
  for (const profile of ['', '../learner', 'Esha', 'a'.repeat(56), 'learner/other']) {
    assert.equal((await api('session', { profile })).status, 400);
  }
  const longest = 'a'.repeat(55);
  assert.equal((await api('prefs', { profile: longest, method: 'PUT', body: { courseOverrides: {} } })).status, 200);
  assert.equal(`cv-prefs-${longest}`.length, 64, 'the longest namespace fits the database key limit');
});

test('late failure and success from a replaced connection cannot delete it or send its old data or cookie', async () => {
  for (const token of ['test-slow-auth-secret', 'test-slow-ok-secret']) {
    const profile = token === 'test-slow-auth-secret' ? 'race-auth' : 'race-ok';
    const old = await connect(profile, token);
    const reached = waitingFor(token);
    const pending = api('snapshot', { profile, cookie: old.cookie });
    await reached;
    const replacement = await connect(profile, eshaToken);
    child.send({ release: token });
    const stale = await pending;
    assert.equal(stale.status, 409);
    assert.equal(stale.data.reason, 'connection-changed');
    assert.equal(stale.rawCookie, '', 'an old response cannot replace the current cookie');
    assert.doesNotMatch(JSON.stringify(stale.data), /Old expired|Old valid/);
    assert.equal((await api('session', { profile, cookie: replacement.cookie })).data.user.name, 'Esha');
    assert.equal((await api('session', { profile })).data.user.name, 'Esha', 'the current remembered token survives an old 401');
  }
});

test('disconnect is ordered after pending connection and remembered reconnect without blocking other learners', async () => {
  for (const restore of [false, true]) {
    const profile = restore ? 'race-restore' : 'race-connect';
    const token = restore ? 'test-slow-stored-secret' : 'test-slow-connect-secret';
    if (restore) await writeFile(join(sandbox, `data/cv-auth-${profile}.json`), JSON.stringify({ baseUrl: 'https://school.example', token }));
    const reached = waitingFor(token);
    const pending = restore ? api('session', { profile }) : connect(profile, token);
    await reached;
    const disconnect = api('session', { profile, method: 'DELETE' });
    // A different learner can finish requests while this verification is held.
    assert.equal((await api('session')).data.user.name, 'Original learner');
    // Allow the server to receive the disconnect while Canvas is still pending.
    await new Promise(done => setTimeout(done, 100));
    child.send({ release: token });
    await pending;
    assert.equal((await disconnect).data.durableDeleted, true);
    assert.equal((await api('session', { profile })).data.connected, false);
    assert.ok(!(await readdir(join(sandbox, 'data'))).includes(`cv-auth-${profile}.json`));
  }
  assert.doesNotMatch(output, /test-slow-auth-secret/);
});
