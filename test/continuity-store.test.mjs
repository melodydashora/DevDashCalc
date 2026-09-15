import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createContinuityStore } from '../continuity-store.js';

const actor = '00000000-0000-4000-8000-000000000001';
const noteInput = (extra = {}) => ({ profileId: 'student-a', createdByUserId: actor, clientRequestId: randomUUID(),
  text: 'A small diagram helps me understand related rates.', type: 'student_note', source: { kind: 'settings', subject: 'calculus-bc' }, ...extra });
function fixture() {
  const records = new Map(), calls = [];
  let tick = Date.parse('2026-09-15T00:00:00Z');
  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.startsWith('CREATE')) return [];
    if (sql.startsWith('INSERT')) {
      const [id, profile, user, request, text, type, source] = params;
      const key = `${profile}:${request}`;
      if (records.has(key)) return [];
      const row = [id, profile, text, type, source, new Date(tick++).toISOString(), user];
      records.set(key, row); return [row];
    }
    if (sql.includes('client_request_id=$2')) {
      const [profile, request, text, type, source, user] = params;
      const row = records.get(`${profile}:${request}`);
      return row && row[2] === text && row[3] === type && row[4] === source && row[6] === user ? [row] : [];
    }
    const [profile, limit, offset] = params;
    const rows = [...records.values()].filter(row => row[1] === profile).sort((a, b) => b[5].localeCompare(a[5]));
    return [[String(rows.length), JSON.stringify(rows.slice(offset, offset + limit))]];
  };
  return { store: createContinuityStore({ query }), records, calls };
}

test('notes parameterize text and retain only bounded allowlisted source metadata', async () => {
  const f = fixture();
  const text = "Use a table; the coding example is '; DROP TABLE users; --";
  const input = noteInput({ text, source: { kind: 'question-coach', subject: 'calculus-bc', unitId: 'unit-02', questionId: 'u2m001',
    token: 'private-value', transcript: ['private conversation'], href: 'https://example.test/?token=private-value', createdAt: 'yesterday' } });
  const saved = await f.store.append(input);
  assert.equal(saved.text, text);
  assert.equal(saved.createdByUserId, actor);
  assert.equal(saved.replayed, false);
  assert.match(saved.id, /^[0-9a-f-]{36}$/);
  assert.equal(saved.createdAt, '2026-09-15T00:00:00.000Z');
  assert.deepEqual(saved.source, { kind: 'question-coach', subject: 'calculus-bc', unitId: 'unit-02', questionId: 'u2m001' });
  const insert = f.calls.find(call => call.sql.startsWith('INSERT'));
  assert.equal(insert.sql.includes(text), false);
  assert.ok(insert.params.includes(text));
  assert.equal(JSON.stringify(insert.params).includes('private-value'), false);
});

test('concurrent duplicate saves append once and a changed payload cannot reuse its request ID', async () => {
  const f = fixture(), input = noteInput();
  const saved = await Promise.all([f.store.append(input), f.store.append(input)]);
  assert.equal(saved[0].id, saved[1].id);
  assert.deepEqual(saved.map(row => row.replayed).sort(), [false, true]);
  assert.equal(f.records.size, 1);
  for (const changed of [{ text: 'Changed note' }, { type: 'coach_note' }, { source: { kind: 'study-coach' } }, { createdByUserId: randomUUID() }]) {
    await assert.rejects(f.store.append({ ...input, ...changed }), { code: 'CONTINUITY_CONFLICT', status: 409 });
  }
  assert.equal((await f.store.list({ profileId: 'student-a' })).notes[0].text, input.text);
  assert.equal(f.calls.some(call => /\b(?:UPDATE|DELETE)\b/.test(call.sql)), false);
});

test('independent profiles, recent note cap, older pages and counts remain scoped', async () => {
  const f = fixture();
  for (let index = 0; index < 34; index++) await f.store.append(noteInput({ text: `Student A note ${index}` }));
  await f.store.append(noteInput({ profileId: 'student-b', text: 'Student B private note' }));
  const first = await f.store.list({ profileId: 'student-a', limit: 500 });
  assert.equal(first.notes.length, 30);
  assert.equal(first.totalCount, 34);
  assert.equal(first.omittedCount, 4);
  assert.equal(first.notes[0].text, 'Student A note 33');
  assert.equal(JSON.stringify(first).includes('Student B'), false);
  const older = await f.store.list({ profileId: 'student-a', offset: 30 });
  assert.equal(older.notes.length, 4);
  assert.equal(older.totalCount, 34);
  assert.equal(older.omittedCount, 0);
  assert.equal(older.notes[0].text, 'Student A note 3');
  assert.deepEqual(await f.store.list({ profileId: 'no-notes' }), { notes: [], totalCount: 0, omittedCount: 0 });
});

test('invalid notes and obvious credentials are rejected before SQL; failed storage remains unavailable', async () => {
  const f = fixture();
  for (const changed of [{ profileId: '../other' }, { text: '  ' }, { text: 'a'.repeat(2001) }, { text: '\u0000bad' },
    { type: 'system_instruction' }, { source: { subject: 'arbitrary-subject' } }, { clientRequestId: [randomUUID()] },
    { text: 'Authorization: Bearer secret-token-never-store-this' }, { text: 'API_TOKEN=secret-token-never-store-this' }]) {
    await assert.rejects(f.store.append(noteInput(changed)), error => error.status === 400);
  }
  await assert.rejects(f.store.list({ profileId: 'student-a', offset: 100001 }), { code: 'CONTINUITY_INVALID' });
  assert.equal(f.calls.length, 0);
  let down = true;
  const store = createContinuityStore({ query: async sql => {
    if (down) throw new Error('postgres connection password=do-not-expose');
    return sql.startsWith('CREATE') ? [] : [['0', '[]']];
  } });
  await assert.rejects(store.list({ profileId: 'student-a' }), error => error.status === 503 && !error.message.includes('password'));
  down = false;
  assert.deepEqual(await store.list({ profileId: 'student-a' }), { notes: [], totalCount: 0, omittedCount: 0 });
});
