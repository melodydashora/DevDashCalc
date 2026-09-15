import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudentRecordLookup } from '../coach-records.js';

test('learning records are paged, copied, and project only learning fields', async () => {
  const progress = { savedAt: 100, token: 'secret-fixture', settings: { name: 'Fixture', subject: 'calculus-bc', password: 'secret-fixture' },
    skills: Object.fromEntries(Array.from({ length: 13 }, (_, i) => ['skill-' + i, { ewma: .4, difficulty: 2, privateKey: 'secret-fixture', events: [{ qid: 'q1', correct: false, choice: 1, token: 'secret-fixture' }] }])) };
  const lookup = createStudentRecordLookup({ profileId: 'student-a', progress });
  progress.settings.name = 'Changed later'; progress.skills['skill-0'].events[0].correct = true;
  const profile = await lookup.execute('read_student_records', { collection: 'learning_profile', offset: 0 });
  assert.equal(profile.records[0].settings.name, 'Fixture');
  const page = await lookup.execute('read_student_records', { collection: 'skills', offset: 0 });
  assert.equal(page.records.length, 10); assert.equal(page.nextOffset, 10); assert.equal(page.totalCount, 13);
  assert.equal(page.records[0].events[0].correct, false);
  assert.doesNotMatch(JSON.stringify({ profile, page }), /secret-fixture|privateKey|password|token/);
  const rest = await lookup.execute('read_student_records', { collection: 'skills', offset: page.nextOffset });
  assert.equal(rest.records.length, 3); assert.equal(rest.nextOffset, null);
  assert.equal(lookup.reads.length, 3);
});

test('older notes use a server-bound profile and reject alternate identities, SQL, and tables', async () => {
  const calls = [];
  const lookup = createStudentRecordLookup({ profileId: 'student-a', readNotes: async options => {
    calls.push(options); return { totalCount: 31, notes: [{ id: 'older', profileId: 'student-a', text: 'Older chain-rule strategy', type: 'student_note', source: { kind: 'settings', token: 'secret-fixture' } }] };
  } });
  for (const args of [{ collection: 's4ai_users', offset: 0 }, { collection: 'saved_notes', offset: 0, profileId: 'student-b' }, { collection: 'saved_notes', offset: -1 }, { collection: 'saved_notes', offset: 0, sql: 'SELECT *' }]) {
    assert.equal((await lookup.execute('read_student_records', args)).state, 'invalid_request');
  }
  assert.equal(calls.length, 0);
  const page = await lookup.execute('read_student_records', { collection: 'saved_notes', offset: 30 });
  assert.deepEqual(calls, [{ profileId: 'student-a', offset: 30, limit: 10 }]);
  assert.match(page.records[0].text, /Older chain-rule/); assert.equal(page.nextOffset, null);
  assert.doesNotMatch(JSON.stringify(page), /secret-fixture/);
});

test('missing data is unknown, a failed read reveals no database error, and revoked access stops reads', async () => {
  let active = true, reads = 0;
  const lookup = createStudentRecordLookup({ profileId: 'student-a', assertCurrent: async () => { if (!active) throw new Error('revoked'); },
    readNotes: async () => { reads++; throw new Error('postgres://private-password'); } });
  assert.equal((await lookup.execute('read_student_records', { collection: 'skills', offset: 0 })).state, 'unavailable');
  const notes = await lookup.execute('read_student_records', { collection: 'saved_notes', offset: 0 });
  assert.equal(notes.state, 'unavailable'); assert.doesNotMatch(JSON.stringify(notes), /postgres|password/);
  active = false;
  await assert.rejects(lookup.execute('read_student_records', { collection: 'saved_notes', offset: 0 }), /revoked/);
  assert.equal(reads, 1);
});

test('a defective adapter cannot return another student note', async () => {
  const lookup = createStudentRecordLookup({ profileId: 'student-a', readNotes: async () => ({ totalCount: 1, notes: [{ profileId: 'student-b', text: 'Other child private note' }] }) });
  const result = await lookup.execute('read_student_records', { collection: 'saved_notes', offset: 0 });
  assert.equal(result.state, 'unavailable'); assert.doesNotMatch(JSON.stringify(result), /Other child/);
});

test('cancellation during the initial owner check prevents a late note read', async () => {
  let enteredOwnerCheck, releaseOwnerCheck;
  const entered = new Promise(resolve => { enteredOwnerCheck = resolve; });
  const held = new Promise(resolve => { releaseOwnerCheck = resolve; });
  const controller = new AbortController();
  let noteReads = 0;
  const lookup = createStudentRecordLookup({ profileId: 'student-a', assertCurrent: async () => {
    enteredOwnerCheck();
    await held;
  }, readNotes: async () => { noteReads++; return { totalCount: 0, notes: [] }; } });
  const pending = lookup.execute('read_student_records', { collection: 'saved_notes', offset: 0 }, { signal: controller.signal });
  const rejected = assert.rejects(pending, /cancelled/);
  await entered;
  controller.abort();
  releaseOwnerCheck();
  await rejected;
  assert.equal(noteReads, 0);
  assert.deepEqual(lookup.reads, []);
});

test('cancellation during a note read prevents late records and read metadata from returning', async () => {
  let enteredNoteRead, releaseNoteRead;
  const entered = new Promise(resolve => { enteredNoteRead = resolve; });
  const held = new Promise(resolve => { releaseNoteRead = resolve; });
  const controller = new AbortController();
  let returned, noteReads = 0;
  const lookup = createStudentRecordLookup({ profileId: 'student-a', readNotes: async () => {
    noteReads++;
    enteredNoteRead();
    await held;
    return { totalCount: 1, notes: [{ profileId: 'student-a', text: 'Late note that must not reach the provider.' }] };
  } });
  const pending = lookup.execute('read_student_records', { collection: 'saved_notes', offset: 0 }, { signal: controller.signal })
    .then(value => { returned = value; return value; });
  const rejected = assert.rejects(pending, /cancelled/);
  await entered;
  controller.abort();
  releaseNoteRead();
  await rejected;
  assert.equal(noteReads, 1);
  assert.equal(returned, undefined);
  assert.deepEqual(lookup.reads, []);
});
