import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService, hashPassword, verifyPassword } from '../auth.js';
import { createMemoryAccountStore } from './helpers/account-memory-store.mjs';

const SECRET = 'test-session-secret-never-used-in-production-20260914';
const PASSWORD = 'A long test-only password';
function fixture(options = {}) {
  const memory = createMemoryAccountStore();
  let stamp = Date.parse('2026-09-15T00:00:00Z');
  const auth = createAuthService({ store: memory.store, sessionSecret: SECRET, now: () => stamp, ...options });
  return { ...memory, auth, advance: ms => { stamp += ms; } };
}
const code = value => error => error.code === value;

test('password-only sign-in uses salted bounded scrypt and preserves password whitespace', async () => {
  const password = ` ${PASSWORD} `;
  const hash = await hashPassword(password);
  const other = await hashPassword(password);
  assert.match(hash, /^scrypt\$131072\$8\$1\$/);
  assert.notEqual(hash, other);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword(password.trim(), hash), false);
  assert.equal(await verifyPassword(password, 'scrypt$99999999999$8$1$bad$bad'), false);
  await assert.rejects(hashPassword('short password'), code('INVALID_PASSWORD'));
  await assert.rejects(hashPassword('a'.repeat(129)), code('INVALID_PASSWORD'));
  assert.throws(() => createAuthService({ store: {}, sessionSecret: 'short' }), /32 bytes/);
});

test('invite-only registration never accepts a submitted existing workspace ID', async () => {
  const f = fixture();
  await assert.rejects(f.auth.register({ username: 'new-user', password: PASSWORD, profileId: 'learner' }), code('ENROLLMENT_REQUIRED'));
  assert.equal(f.users.size, 0);
  const open = fixture({ allowSelfSignup: true });
  const result = await open.auth.register({ username: ' MiXeD_Name ', password: PASSWORD, profileId: 'learner', displayName: 'New Student' });
  assert.equal(result.user.username, 'mixed_name');
  assert.equal(result.workspaces.length, 1);
  assert.match(result.workspaces[0].profileId, /^student-[0-9a-f-]{36}$/);
  assert.notEqual(result.workspaces[0].profileId, 'learner');
  assert.deepEqual(Object.keys(result.user).sort(), ['displayName', 'id', 'username']);
});

test('enrollment preserves exact legacy workspace name and atomically prevents reuse/reclaim', async () => {
  const f = fixture();
  f.legacyProfiles.add('legacy-child');
  const invite = await f.auth.issueEnrollment({ profileId: 'legacy-child', name: 'Existing Learner' });
  const outcomes = await Promise.allSettled([
    f.auth.register({ username: 'first-child', password: PASSWORD, enrollmentToken: invite.token, displayName: 'My New Label' }),
    f.auth.register({ username: 'second-child', password: PASSWORD, enrollmentToken: invite.token }),
  ]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(x => x.status === 'rejected').reason.code, 'INVALID_ENROLLMENT');
  const result = outcomes.find(x => x.status === 'fulfilled').value;
  assert.equal(result.workspaces[0].profileId, 'legacy-child');
  assert.equal(result.workspaces[0].name, 'Existing Learner');
  assert.equal(f.users.size, 1);
  assert.equal(f.sessions.size, 1);
  await assert.rejects(f.auth.issueEnrollment({ profileId: 'legacy-child', name: 'Other Learner' }), code('WORKSPACE_ALREADY_OWNED'));
  await assert.rejects(f.auth.issueEnrollment({ profileId: 'nonexistent', name: 'Unknown' }), code('PROFILE_NOT_FOUND'));
  const persisted = JSON.stringify(f.calls);
  assert.equal(persisted.includes(invite.token), false);
  assert.equal(persisted.includes(result.token), false);
  assert.equal(persisted.includes(PASSWORD), false);
});

test('expired enrollment creates no account and duplicate username leaves an invitation usable', async () => {
  const f = fixture({ allowSelfSignup: true });
  await f.auth.register({ username: 'already-here', password: PASSWORD });
  f.legacyProfiles.add('old-profile');
  const invite = await f.auth.issueEnrollment({ profileId: 'old-profile', name: 'Original', expiresInMs: 60_000 });
  await assert.rejects(f.auth.register({ username: 'already-here', password: PASSWORD, enrollmentToken: invite.token }), code('USERNAME_TAKEN'));
  assert.equal([...f.invitations.values()][0].consumedAt, undefined);
  f.advance(60_001);
  await assert.rejects(f.auth.register({ username: 'after-expiry', password: PASSWORD, enrollmentToken: invite.token }), code('INVALID_ENROLLMENT'));
  assert.equal(f.users.size, 1);
  assert.equal(f.workspaces.get('old-profile').ownerId, null);
});

test('separate devices receive separate hashed sessions and cannot authorize another workspace', async () => {
  const f = fixture({ allowSelfSignup: true });
  const first = await f.auth.register({ username: 'student-one', password: PASSWORD });
  const second = await f.auth.register({ username: 'student-two', password: PASSWORD });
  const anotherDevice = await f.auth.login({ username: 'STUDENT-ONE', password: PASSWORD });
  assert.notEqual(first.token, anotherDevice.token);
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(f.sessions.has(first.token), false);
  const context = await f.auth.authenticate(first.token);
  assert.equal((await f.auth.authorizeWorkspace(context, first.workspaces[0].profileId)).profileId, first.workspaces[0].profileId);
  await assert.rejects(f.auth.authorizeWorkspace(context, second.workspaces[0].profileId), code('WORKSPACE_FORBIDDEN'));
  // Forged client membership fields do not replace the fresh store check.
  await assert.rejects(f.auth.authorizeWorkspace({ ...context, workspaces: second.workspaces }, second.workspaces[0].profileId), code('WORKSPACE_FORBIDDEN'));
  await f.auth.logout(first.token);
  assert.equal(await f.auth.authenticate(first.token), null);
  assert.ok(await f.auth.authenticate(anotherDevice.token));
  await assert.rejects(f.auth.authorizeWorkspace(context, first.workspaces[0].profileId), code('WORKSPACE_FORBIDDEN'));
  assert.equal(JSON.stringify(f.calls).includes(anotherDevice.token), false);
});

test('expiry, disabled accounts and changed auth versions invalidate sessions and stale authorization contexts', async () => {
  const f = fixture({ allowSelfSignup: true, sessionTtlMs: 1000 });
  const result = await f.auth.register({ username: 'expiry-child', password: PASSWORD });
  const context = await f.auth.authenticate(result.token);
  const user = f.users.get(result.user.id);
  user.status = 'disabled';
  assert.equal(await f.auth.authenticate(result.token), null);
  await assert.rejects(f.auth.authorizeWorkspace(context), code('WORKSPACE_FORBIDDEN'));
  await assert.rejects(f.auth.login({ username: user.username, password: PASSWORD }), code('INVALID_CREDENTIALS'));
  user.status = 'active'; user.authVersion++;
  assert.equal(await f.auth.authenticate(result.token), null);
  user.authVersion--;
  f.advance(1000);
  assert.equal(await f.auth.authenticate(result.token), null);
  assert.equal(await f.auth.authenticate('malformed-cookie'), null);
});

test('persistent limits and unavailable account storage fail closed without exposing underlying errors', async () => {
  const f = fixture({ allowSelfSignup: true });
  const result = await f.auth.register({ username: 'limited-child', password: PASSWORD });
  f.store.consumeRateLimit = async () => false;
  await assert.rejects(f.auth.login({ username: 'limited-child', password: PASSWORD }), code('AUTH_RATE_LIMITED'));
  f.store.authenticate = async () => { throw new Error('postgres: password=private-database-secret'); };
  await assert.rejects(f.auth.authenticate(result.token), error => error.code === 'AUTH_UNAVAILABLE' && !error.message.includes('private'));
  f.store.authorizeWorkspace = async () => { throw new Error('database down'); };
  await assert.rejects(f.auth.authorizeWorkspace({ sessionId: 'ignored', user: result.user }), code('AUTH_UNAVAILABLE'));
});
