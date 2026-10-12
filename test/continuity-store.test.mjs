import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createContinuityStore } from '../continuity-store.js';
import { createStudentRecordLookup } from '../coach-records.js';

const actor = '00000000-0000-4000-8000-000000000001';
const noteInput = (extra = {}) => ({ profileId: 'student-a', createdByUserId: actor, clientRequestId: randomUUID(),
  text: 'A small diagram helps me understand related rates.', type: 'student_note', source: { kind: 'settings', subject: 'calculus-bc' }, ...extra });
function fixture(seed = []) {
  const records = new Map(seed), calls = [];
  let tick = Date.parse('2026-09-15T00:00:00Z');
  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.startsWith('CREATE') || sql.startsWith('ALTER')) return [];
    if (sql.startsWith('INSERT')) {
      const [id, profile, user, request, text, type, source] = params;
      const key = `${profile}:${request}`;
      if (records.has(key)) return [];
      const row = [id, profile, text, type, source, new Date(tick++).toISOString(), user, null, null];
      records.set(key, row); return [row.slice(0, 8)];
    }
    if (sql.startsWith('UPDATE')) {
      const [profile, id, text] = params;
      const row = [...records.values()].find(row => row[1] === profile && row[0] === id);
      if (!row) return [];
      if (sql.includes('deleted_at=COALESCE')) {
        if (!row[8]) row[7] = row[8] = new Date(tick++).toISOString();
        row[2] = '[Removed learning note]'; row[4] = '{}';
        return [[row[0]]];
      }
      if (row[8]) return [];
      if (row[2] !== text) row[7] = new Date(tick++).toISOString();
      row[2] = text;
      return [row.slice(0, 8)];
    }
    if (sql.includes('client_request_id=$2')) {
      const [profile, request, text, type, source, user] = params;
      const row = records.get(`${profile}:${request}`);
      return row && !row[8] && row[2] === text && row[3] === type && row[4] === source && row[6] === user ? [row.slice(0, 8)] : [];
    }
    const [profile, limit, offset] = params;
    const rows = [...records.values()].filter(row => row[1] === profile && !row[8])
      .sort((a, b) => (b[7] || b[5]).localeCompare(a[7] || a[5]) || b[0].localeCompare(a[0]));
    return [[String(rows.length), JSON.stringify(rows.slice(offset, offset + limit).map(row => row.slice(0, 8)))]];
  };
  return { store: createContinuityStore({ query }), records, calls, query };
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
  assert.equal(saved.updatedAt, saved.createdAt);
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

test('learning memories retain SAT and Algebra subject context through storage and reading', async () => {
  const f = fixture();
  for (const subject of ['sat', 'algebra']) {
    const saved = await f.store.append(noteInput({ type: 'coach_note', source: { kind: 'study-coach', subject } }));
    assert.equal(saved.source.subject, subject);
  }
  const notes = await f.store.list({ profileId: 'student-a' });
  assert.deepEqual(notes.notes.map(note => note.source.subject).sort(), ['algebra', 'sat']);
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
    return /^(CREATE|ALTER)/.test(sql) ? [] : [['0', '[]']];
  } });
  await assert.rejects(store.list({ profileId: 'student-a' }), error => error.status === 503 && !error.message.includes('password'));
  down = false;
  assert.deepEqual(await store.list({ profileId: 'student-a' }), { notes: [], totalCount: 0, omittedCount: 0 });
});

test('editing an owned note preserves identity and provenance, refreshes recent context, and retries safely', async () => {
  const f = fixture(), input = noteInput({ type: 'coach_note', source: { kind: 'study-coach', subject: 'calculus-bc' } });
  const saved = await f.store.append(input);
  await f.store.append(noteInput({ text: 'A more recent memory.' }));
  const text = "Use a graph first; a literal example is '; DROP TABLE users; --";
  const edited = await f.store.update({ profileId: input.profileId, id: saved.id, text,
    type: 'system_instruction', source: { token: 'must-not-be-saved' }, createdByUserId: randomUUID() });
  assert.equal(edited.text, text);
  for (const key of ['id', 'profileId', 'createdAt', 'createdByUserId', 'type', 'source']) assert.deepEqual(edited[key], saved[key]);
  assert.ok(edited.updatedAt > saved.updatedAt);
  assert.deepEqual(await f.store.update({ profileId: input.profileId, id: saved.id, text }), edited);
  assert.equal(f.records.size, 2);
  const recent = await f.store.list({ profileId: input.profileId, limit: 1 });
  assert.equal(recent.notes[0].id, saved.id);
  assert.equal(recent.notes[0].text, text);
  await assert.rejects(f.store.append(input), { status: 409, code: 'CONTINUITY_CONFLICT' });
  assert.equal((await f.store.list({ profileId: input.profileId })).notes[0].text, text);
  const mutation = f.calls.find(call => call.sql.startsWith('UPDATE'));
  assert.match(mutation.sql, /WHERE profile_id=\$1 AND id=\$2::uuid AND deleted_at IS NULL/);
  assert.equal(mutation.sql.includes(text), false);
  assert.deepEqual(mutation.params, [input.profileId, saved.id, text]);
  const listing = f.calls.find(call => call.sql.startsWith('SELECT\n'));
  assert.equal((listing.sql.match(/ORDER BY COALESCE\(updated_at,created_at\) DESC,id DESC/g) || []).length, 2);
});

test('note IDs cannot cross learner boundaries and absent versus foreign IDs have the same result', async () => {
  const f = fixture();
  const saved = await f.store.append(noteInput());
  const foreign = await f.store.append(noteInput({ profileId: 'student-b', text: 'Student B needs a visual example.' }));
  const before = structuredClone([...f.records]);
  for (const method of ['update', 'remove']) {
    const failures = [];
    for (const request of [{ profileId: 'student-b', id: saved.id }, { profileId: 'student-a', id: foreign.id }, { profileId: 'student-a', id: randomUUID() }]) {
      await assert.rejects(f.store[method]({ ...request, text: 'An unauthorized replacement.' }), error => {
        failures.push({ status: error.status, code: error.code, message: error.message });
        return error.status === 404 && error.code === 'CONTINUITY_NOT_FOUND';
      });
    }
    assert.deepEqual(failures[0], failures[1]);
    assert.deepEqual(failures[1], failures[2]);
  }
  assert.deepEqual([...f.records], before);
  assert.equal((await f.store.list({ profileId: 'student-b' })).notes[0].text, foreign.text);
});

test('removal erases text and source, excludes all read pages, and cannot be undone by save or edit retries', async () => {
  const f = fixture(), input = noteInput();
  const saved = await f.store.append(input);
  await f.store.append(noteInput({ text: 'Keep this other learning memory.' }));
  const removed = await f.store.remove({ profileId: input.profileId, id: saved.id });
  assert.deepEqual(removed, { deleted: true, id: saved.id });
  assert.deepEqual(await f.store.remove({ profileId: input.profileId, id: saved.id }), removed);
  assert.equal(f.records.size, 2, 'the original request ID stays reserved');
  const tombstone = f.records.get(`${input.profileId}:${input.clientRequestId}`);
  assert.equal(tombstone[2], '[Removed learning note]');
  assert.equal(tombstone[4], '{}');
  assert.ok(tombstone[8]);
  await assert.rejects(f.store.append(input), { status: 409, code: 'CONTINUITY_CONFLICT' });
  await assert.rejects(f.store.append({ ...input, text: '[Removed learning note]', source: {} }), { status: 409, code: 'CONTINUITY_CONFLICT' });
  await assert.rejects(f.store.update({ profileId: input.profileId, id: saved.id, text: 'A late edit.' }), { status: 404, code: 'CONTINUITY_NOT_FOUND' });
  const current = await f.store.list({ profileId: input.profileId });
  assert.equal(current.totalCount, 1);
  assert.equal(current.omittedCount, 0);
  assert.equal(current.notes[0].text, 'Keep this other learning memory.');
  const older = await f.store.list({ profileId: input.profileId, offset: 1 });
  assert.deepEqual(older, { notes: [], totalCount: 1, omittedCount: 0 });
  const listing = f.calls.find(call => call.sql.startsWith('SELECT\n'));
  assert.equal((listing.sql.match(/WHERE profile_id=\$1 AND deleted_at IS NULL/g) || []).length, 2);
});

test('the read-only coaching lookup immediately uses edited memories and omits removed memories', async () => {
  const f = fixture();
  const saved = await f.store.append(noteInput());
  await f.store.append(noteInput({ profileId: 'student-b', text: 'Private foreign context.' }));
  const lookup = createStudentRecordLookup({ profileId: 'student-a', readNotes: options => f.store.list(options) });
  const read = () => lookup.execute('read_student_records', { collection: 'saved_notes', offset: 0 });
  assert.equal((await read()).records[0].text, saved.text);
  await f.store.update({ profileId: 'student-a', id: saved.id, text: 'Use a diagram and one question at a time.' });
  const edited = await read();
  assert.equal(edited.records[0].text, 'Use a diagram and one question at a time.');
  assert.equal(JSON.stringify(edited).includes('Private foreign'), false);
  await f.store.remove({ profileId: 'student-a', id: saved.id });
  const removed = await read();
  assert.equal(removed.state, 'available');
  assert.equal(removed.totalCount, 0);
  assert.deepEqual(removed.records, []);
});

test('removal remains final when an edit is already in flight or retries after deletion', async () => {
  for (const removeFirst of [false, true]) {
    const f = fixture(), saved = await f.store.append(noteInput());
    const edit = () => f.store.update({ profileId: 'student-a', id: saved.id, text: 'A pending edit.' });
    const remove = () => f.store.remove({ profileId: 'student-a', id: saved.id });
    const results = await Promise.allSettled(removeFirst ? [remove(), edit()] : [edit(), remove()]);
    const deletion = results[removeFirst ? 0 : 1];
    assert.equal(deletion.status, 'fulfilled');
    assert.deepEqual(deletion.value, { deleted: true, id: saved.id });
    assert.deepEqual(await f.store.list({ profileId: 'student-a' }), { notes: [], totalCount: 0, omittedCount: 0 });
    await assert.rejects(edit(), { status: 404, code: 'CONTINUITY_NOT_FOUND' });
  }
});

test('additive schema initialization leaves pre-existing learning memories intact', async () => {
  const id = randomUUID(), request = randomUUID(), createdAt = '2026-08-01T00:00:00.000Z';
  const oldRow = [id, 'student-a', 'An existing saved learning preference.', 'student_note', '{"kind":"settings"}', createdAt, actor];
  const f = fixture([[`student-a:${request}`, structuredClone(oldRow)]]);
  await f.store.init();
  assert.deepEqual(f.records.get(`student-a:${request}`), oldRow);
  const note = (await f.store.list({ profileId: 'student-a' })).notes[0];
  assert.equal(note.id, id); assert.equal(note.text, oldRow[2]); assert.equal(note.updatedAt, createdAt);
  const second = createContinuityStore({ query: f.query });
  assert.deepEqual((await second.list({ profileId: 'student-a' })).notes[0], note);
  const schema = f.calls.filter(call => /^(CREATE|ALTER)/.test(call.sql));
  assert.equal(schema.filter(call => call.sql === 'ALTER TABLE s4ai_student_memos ADD COLUMN IF NOT EXISTS updated_at timestamptz').length, 2);
  assert.equal(schema.filter(call => call.sql === 'ALTER TABLE s4ai_student_memos ADD COLUMN IF NOT EXISTS deleted_at timestamptz').length, 2);
  assert.equal(f.calls.some(call => /\b(?:DROP|TRUNCATE|DELETE)\b/.test(call.sql)), false);
  assert.equal(f.calls.some(call => call.sql.startsWith('UPDATE')), false);
});

test('edit and remove validate IDs and text before SQL and report storage failure without leaking details', async () => {
  const f = fixture(), id = randomUUID();
  for (const text of ['', 'a'.repeat(2001), '\u0000invalid', 'API_TOKEN=do-not-save-this-token', 'password=do-not-save-this-password']) {
    await assert.rejects(f.store.update({ profileId: 'student-a', id, text }), error => error.status === 400);
  }
  for (const method of ['update', 'remove']) {
    for (const invalid of [{ profileId: '../other', id }, { profileId: 'student-a', id: '*' }, { profileId: 'student-a', id: [id] }]) {
      await assert.rejects(f.store[method]({ ...invalid, text: 'Valid text' }), { status: 400, code: 'CONTINUITY_INVALID' });
    }
  }
  assert.equal(f.calls.length, 0);
  const store = createContinuityStore({ query: async sql => {
    if (/^(CREATE|ALTER)/.test(sql)) return [];
    throw new Error('Database credentials: password=private-value');
  } });
  for (const method of ['update', 'remove']) {
    await assert.rejects(store[method]({ profileId: 'student-a', id, text: 'Valid text' }), error =>
      error.status === 503 && error.code === 'CONTINUITY_UNAVAILABLE' && !error.message.includes('private-value'));
  }
});
