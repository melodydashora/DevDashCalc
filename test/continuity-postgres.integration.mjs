// Opt-in real SQL verification, with only disposable randomly prefixed tables.
// RUN_CONTINUITY_DB_TESTS=1 node --test test/continuity-postgres.integration.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { pgQuery, parseDatabaseUrl } from '../store.js';
import { createContinuityStore } from '../continuity-store.js';

const enabled = process.env.RUN_CONTINUITY_DB_TESTS === '1' && Boolean(process.env.DATABASE_URL);
test('real PostgreSQL continuity appends, replay protection, pagination and workspace references', { skip: !enabled, timeout: 120_000 }, async t => {
  const prefix = `test_memo_${randomBytes(8).toString('hex')}_`;
  assert.match(prefix, /^test_memo_[0-9a-f]{16}_$/);
  const names = ['s4ai_users', 's4ai_workspaces', 's4ai_student_memos', 's4ai_student_memos_recent_idx'];
  const aliases = Object.fromEntries(names.map(name => [name, prefix + name]));
  for (const name of Object.values(aliases)) assert.ok(name.length <= 63);
  const pattern = new RegExp(`\\b(${names.join('|')})\\b`, 'g');
  const cfg = parseDatabaseUrl(process.env.DATABASE_URL);
  const query = (sql, params = []) => pgQuery(cfg, sql.replace(pattern, name => aliases[name]), params);
  const store = createContinuityStore({ query });
  const actor = randomUUID(), other = randomUUID();
  const input = extra => ({ profileId: 'memo-a', createdByUserId: actor, clientRequestId: randomUUID(),
    text: 'First draw the problem, then identify the changing values.', type: 'student_note', source: { kind: 'settings' }, ...extra });
  try {
    await query('CREATE TABLE s4ai_users (id uuid PRIMARY KEY)');
    await query('CREATE TABLE s4ai_workspaces (profile_id text PRIMARY KEY)');
    await query('INSERT INTO s4ai_users(id) VALUES ($1::uuid),($2::uuid)', [actor, other]);
    await query('INSERT INTO s4ai_workspaces(profile_id) VALUES ($1),($2)', ['memo-a', 'memo-b']);
    await store.init();

    await t.test('same request racing across stores creates one note; changed content cannot overwrite it', async () => {
      const note = input({});
      const second = createContinuityStore({ query });
      await second.init();
      const results = await Promise.all([store.append(note), second.append(note)]);
      assert.equal(results[0].id, results[1].id);
      assert.deepEqual(results.map(row => row.replayed).sort(), [false, true]);
      assert.equal((await store.list({ profileId: 'memo-a' })).totalCount, 1);
      await assert.rejects(second.append({ ...note, text: 'Replacement content' }), { code: 'CONTINUITY_CONFLICT' });
      assert.equal((await store.list({ profileId: 'memo-a' })).notes[0].text, note.text);
    });

    await t.test('separate profiles, SQL-like note text and pagination use the same bounded snapshot', async () => {
      for (let index = 0; index < 31; index++) await store.append(input({ text: `Planning note ${index}` }));
      await store.append(input({ profileId: 'memo-b', createdByUserId: other, text: "Private B note: '; DROP TABLE users;--" }));
      const recent = await store.list({ profileId: 'memo-a', limit: 999 });
      assert.equal(recent.totalCount, 32); assert.equal(recent.notes.length, 30); assert.equal(recent.omittedCount, 2);
      assert.equal(JSON.stringify(recent).includes('Private B'), false);
      const older = await store.list({ profileId: 'memo-a', offset: 30 });
      assert.equal(older.notes.length, 2); assert.equal(older.omittedCount, 0);
      assert.equal((await store.list({ profileId: 'memo-b' })).totalCount, 1);
      assert.deepEqual(await store.list({ profileId: 'unknown' }), { notes: [], totalCount: 0, omittedCount: 0 });
    });

    await t.test('foreign keys reject invented accounts and workspaces; no note is silently reassigned', async () => {
      await assert.rejects(store.append(input({ profileId: 'unknown' })), { code: 'CONTINUITY_UNAVAILABLE' });
      await assert.rejects(store.append(input({ createdByUserId: randomUUID() })), { code: 'CONTINUITY_UNAVAILABLE' });
      assert.equal((await store.list({ profileId: 'memo-a' })).totalCount, 32);
      const again = createContinuityStore({ query });
      assert.equal((await again.list({ profileId: 'memo-b' })).notes[0].createdByUserId, other);
    });
  } finally {
    for (const name of ['s4ai_student_memos', 's4ai_workspaces', 's4ai_users']) {
      const target = aliases[name];
      assert.match(target, new RegExp(`^${prefix}[a-z0-9_]+$`));
      await pgQuery(cfg, `DROP TABLE IF EXISTS ${target}`);
    }
  }
});
