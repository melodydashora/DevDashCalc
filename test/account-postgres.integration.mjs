// Explicit opt-in only: RUN_ACCOUNT_DB_TESTS=1 DATABASE_URL=... node --test
// test/account-postgres.integration.mjs. All identifiers are substituted with
// a generated test prefix; no production account/progress rows are queried.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { pgQuery, parseDatabaseUrl } from '../store.js';
import { createAccountStore } from '../account-store.js';
import { createAuthService } from '../auth.js';

const enabled = process.env.RUN_ACCOUNT_DB_TESTS === '1' && Boolean(process.env.DATABASE_URL);
test('real PostgreSQL isolated account transactions and durable sessions', { skip: !enabled, timeout: 180_000 }, async t => {
  const prefix = `test_s4ai_${randomBytes(8).toString('hex')}_`;
  assert.match(prefix, /^test_s4ai_[a-f0-9]{16}_$/);
  const identifiers = ['s4ai_users', 's4ai_workspaces', 's4ai_workspace_members', 's4ai_sessions', 's4ai_sessions_user_idx', 's4ai_enrollments', 's4ai_auth_limits', 'calc_coach_store'];
  const aliases = Object.fromEntries(identifiers.map(name => [name, prefix + name]));
  for (const alias of Object.values(aliases)) assert.ok(alias.length <= 63);
  const pattern = new RegExp(`\\b(${identifiers.join('|')})\\b`, 'g');
  const cfg = parseDatabaseUrl(process.env.DATABASE_URL);
  const query = (sql, params = []) => pgQuery(cfg, sql.replace(pattern, name => aliases[name]), params);
  const secret = randomBytes(32).toString('hex');
  const password = 'Integration fixture password only';
  const store = createAccountStore({ query });
  const service = () => createAuthService({ store: createAccountStore({ query }), sessionSecret: secret, allowSelfSignup: true });
  const auth = service();
  const profiles = ['legacy-race', 'legacy-duplicate', 'legacy-multi'];
  let first;
  try {
    await query('CREATE TABLE calc_coach_store (key text PRIMARY KEY, value jsonb NOT NULL)');
    for (const profile of profiles) await query('INSERT INTO calc_coach_store(key,value) VALUES ($1,$2::jsonb)', [`progress-${profile}`, JSON.stringify({ savedAt: 1, settings: { name: 'Original' } })]);
    await store.init();

    await t.test('concurrent enrollment has one owner, no orphan user and preserved legacy progress', async () => {
      const invite = await auth.issueEnrollment({ profileId: profiles[0], name: 'Original' });
      const attempts = await Promise.allSettled([
        auth.register({ username: 'race-first', password, enrollmentToken: invite.token }),
        service().register({ username: 'race-second', password, enrollmentToken: invite.token }),
      ]);
      assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 1);
      assert.equal(attempts.find(x => x.status === 'rejected').reason.code, 'INVALID_ENROLLMENT');
      first = attempts.find(x => x.status === 'fulfilled').value;
      assert.equal(first.workspaces[0].profileId, profiles[0]);
      assert.equal(first.workspaces[0].name, 'Original');
      assert.equal((await query('SELECT count(*)::text FROM s4ai_users'))[0][0], '1');
      assert.equal((await query('SELECT value->>\'savedAt\' FROM calc_coach_store WHERE key=$1', [`progress-${profiles[0]}`]))[0][0], '1');
      await assert.rejects(auth.register({ username: 'race-reuse', password, enrollmentToken: invite.token }), { code: 'INVALID_ENROLLMENT' });
    });

    await t.test('duplicate username rolls back the entire invitation transaction and permits correct retry', async () => {
      const invite = await auth.issueEnrollment({ profileId: profiles[1], name: 'Second Original' });
      await assert.rejects(auth.register({ username: first.user.username, password, enrollmentToken: invite.token }), { code: 'USERNAME_TAKEN' });
      const result = await auth.register({ username: 'retry-unique', password, enrollmentToken: invite.token, displayName: 'New Account Label' });
      assert.equal(result.workspaces[0].name, 'Second Original');
      await assert.rejects(auth.issueEnrollment({ profileId: profiles[1], name: 'Claim Again' }), { code: 'WORKSPACE_ALREADY_OWNED' });
    });

    await t.test('two distinct invitations cannot claim the same existing workspace twice', async () => {
      const a = await auth.issueEnrollment({ profileId: profiles[2], name: 'Third Original' });
      const b = await auth.issueEnrollment({ profileId: profiles[2], name: 'Different Label' });
      const attempts = await Promise.allSettled([
        auth.register({ username: 'multi-first', password, enrollmentToken: a.token }),
        service().register({ username: 'multi-second', password, enrollmentToken: b.token }),
      ]);
      assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 1);
      assert.equal(attempts.find(x => x.status === 'rejected').reason.code, 'INVALID_ENROLLMENT');
      assert.equal((await query('SELECT count(*)::text FROM s4ai_users'))[0][0], '3');
    });

    await t.test('sessions survive service recreation and enforce current ownership, revocation and disabled users', async () => {
      const recreated = service();
      const context = await recreated.authenticate(first.token);
      assert.equal(context.user.id, first.user.id);
      assert.equal(typeof context.expiresAt, 'number');
      assert.equal((await recreated.authorizeWorkspace(context, profiles[0])).profileId, profiles[0]);
      await assert.rejects(recreated.authorizeWorkspace(context, profiles[1]), { code: 'WORKSPACE_FORBIDDEN' });
      const login = await recreated.login({ username: first.user.username.toUpperCase(), password });
      assert.notEqual(login.token, first.token);
      await recreated.logout(first.token);
      assert.equal(await service().authenticate(first.token), null);
      assert.ok(await service().authenticate(login.token));
      await query("UPDATE s4ai_users SET status='disabled' WHERE id=$1::uuid", [first.user.id]);
      assert.equal(await service().authenticate(login.token), null);
      await assert.rejects(recreated.authorizeWorkspace(context, profiles[0]), { code: 'WORKSPACE_FORBIDDEN' });
    });

    await t.test('parameters cannot change SQL structure, and only hash forms are retained', async () => {
      assert.equal(await store.findUser("name'; DROP TABLE s4ai_users;--"), null);
      const hashes = await query('SELECT password_hash FROM s4ai_users');
      assert.ok(hashes.length >= 3);
      assert.ok(hashes.every(([hash]) => /^scrypt\$131072\$8\$1\$/.test(hash) && !hash.includes(password)));
      const sessionHashes = await query('SELECT token_hash FROM s4ai_sessions');
      assert.ok(sessionHashes.every(([hash]) => /^[a-f0-9]{64}$/.test(hash) && hash !== first.token));
    });
  } finally {
    // Fixed, dependency-ordered names belonging only to this generated fixture.
    // No CASCADE: an unexpected external dependency must block cleanup.
    const cleanup = ['s4ai_auth_limits', 's4ai_enrollments', 's4ai_sessions', 's4ai_workspace_members', 's4ai_workspaces', 's4ai_users', 'calc_coach_store'];
    for (const name of cleanup) {
      const target = aliases[name];
      assert.match(target, new RegExp(`^${prefix}[a-z0-9_]+$`));
      await pgQuery(cfg, `DROP TABLE IF EXISTS ${target}`);
    }
  }
});
