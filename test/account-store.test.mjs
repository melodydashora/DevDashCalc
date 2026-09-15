import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountStore } from '../account-store.js';

test('account SQL binds hostile input as parameters and initializes once for parallel requests', async () => {
  const calls = [];
  const store = createAccountStore({ query: async (sql, params = []) => { calls.push({ sql, params }); return []; } });
  const username = "child'; DROP TABLE s4ai_users; --";
  await Promise.all([store.findUser(username), store.findUser('other')]);
  assert.equal(calls.filter(c => c.sql.startsWith('CREATE TABLE IF NOT EXISTS s4ai_users')).length, 1);
  const search = calls.find(c => c.params.includes(username));
  assert.ok(search);
  assert.equal(search.sql.includes(username), false);
  assert.match(search.sql, /u.username=\$1/);
});

test('invited registration is one locked data-modifying statement and invalid invite has no follow-up writes', async () => {
  const calls = [];
  const store = createAccountStore({ query: async (sql, params = []) => { calls.push({ sql, params }); return []; } });
  await assert.rejects(store.register({ enrollmentHash: 'hashed-token', username: 'test' }), { code: 'INVALID_ENROLLMENT' });
  const mutations = calls.filter(c => !c.sql.startsWith('CREATE'));
  assert.equal(mutations.length, 1);
  assert.match(mutations[0].sql, /FOR UPDATE OF e,w/);
  assert.match(mutations[0].sql, /w.owner_user_id IS NULL/);
  assert.match(mutations[0].sql, /e.expires_at>\$2::timestamptz/);
  assert.match(mutations[0].sql, /INSERT INTO s4ai_sessions/);
});

test('fresh workspace authorization checks membership, current account and unrevoked session', async () => {
  let sqlSeen = '';
  const store = createAccountStore({ query: async (sql) => {
    if (sql.startsWith('CREATE')) return [];
    sqlSeen = sql;
    return [['workspace-id', 'owned-profile', 'Student', 'owner']];
  } });
  assert.deepEqual(await store.authorizeWorkspace('session-id', 'user-id', 'owned-profile', '2026-09-15T00:00:00Z'),
    { id: 'workspace-id', profileId: 'owned-profile', name: 'Student', role: 'owner' });
  for (const check of ['s.revoked_at IS NULL', "u.status='active'", 's.auth_version=u.auth_version', "m.role='owner'", 'w.profile_id=$4']) assert.ok(sqlSeen.includes(check));
});

test('failed schema initialization retries and never returns an authenticated fallback', async () => {
  let fail = true;
  const store = createAccountStore({ query: async () => { if (fail) throw new Error('database unavailable'); return []; } });
  await assert.rejects(store.authenticate('hash', '2026-09-15T00:00:00Z'), /database unavailable/);
  fail = false;
  assert.equal(await store.authenticate('hash', '2026-09-15T00:00:00Z'), null);
});
