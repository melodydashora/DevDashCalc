import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCoachAttachments, MAX_COACH_ATTACHMENT_BYTES, MAX_COACH_NOTE_CHARACTERS } from '../public/coach-attachments.js';

const photo = () => new File([Uint8Array.from([255, 216, 255, 224, 0, 0])], 'problem.jpg', { type: 'image/jpeg' });
const note = (text = 'Use a diagram to explain this step.', name = 'study.txt', type = 'text/plain') => new File([text], name, { type });
function fixture() {
  const created = [], revoked = [];
  const draft = createCoachAttachments({ createObjectURL: file => { const url = `blob:photo-${created.length}`; created.push({ file, url }); return url; }, revokeObjectURL: url => revoked.push(url) });
  return { draft, created, revoked };
}

test('attachment previews expose only metadata; explicit snapshots encode the original files', async () => {
  const { draft, created, revoked } = fixture();
  assert.equal(await draft.add([photo(), note()]), true);
  assert.equal(draft.items.length, 2);
  assert.equal(created.length, 1);
  assert.equal(draft.items[0].previewUrl, created[0].url);
  assert.equal(draft.items[1].previewUrl, '');
  assert.ok(draft.items.every(item => !('data' in item) && !('text' in item)));
  const payload = draft.snapshot();
  assert.deepEqual(Object.keys(payload[0]), ['name', 'mimeType', 'data']);
  assert.equal(Buffer.from(payload[1].data, 'base64').toString(), 'Use a diagram to explain this step.');
  payload[0].data = 'changed';
  assert.notEqual(draft.snapshot()[0].data, 'changed');
  draft.remove(draft.items[0].id);
  assert.deepEqual(revoked, [created[0].url]);
  draft.clear(); draft.clear();
  assert.deepEqual(draft.snapshot(), []);
  assert.equal(revoked.length, 1, 'each preview is revoked once');
});

test('count, combined size, empty files, and unsupported types fail before reading files', async () => {
  const { draft } = fixture();
  let reads = 0;
  const fake = (size, type = 'image/jpeg') => ({ name: 'large.jpg', type, size, arrayBuffer() { reads += 1; throw new Error('must not read'); } });
  await assert.rejects(draft.add([photo(), photo(), photo()]), /up to 2/);
  await assert.rejects(draft.add([fake(MAX_COACH_ATTACHMENT_BYTES + 1)]), /6 MB combined/);
  await assert.rejects(draft.add([fake(0)]), /empty/);
  await assert.rejects(draft.add([fake(1, 'image/svg+xml')]), /JPG, PNG, WebP/);
  await draft.add([note('hello')]);
  await assert.rejects(draft.add([fake(MAX_COACH_ATTACHMENT_BYTES)]), /6 MB combined/);
  assert.equal(reads, 0);
  assert.equal(draft.items.length, 1);
});

test('plain notes are bounded UTF-8 and a rejected batch leaves existing attachments intact', async () => {
  const { draft, created } = fixture();
  await assert.rejects(draft.add([photo(), note('x'.repeat(MAX_COACH_NOTE_CHARACTERS + 1))]), /12,000/);
  assert.deepEqual(draft.items, []);
  assert.equal(created.length, 0);
  await assert.rejects(draft.add([new File([Uint8Array.of(255)], 'invalid.txt', { type: 'text/plain' })]), /UTF-8/);
  await assert.rejects(draft.add([note(' \n ')]), /readable study material/);
  await assert.rejects(draft.add([note('hidden\0bytes')]), /readable study material/);
  await draft.add([note('x'.repeat(7000), 'first.txt', '')]);
  await assert.rejects(draft.add([note('y'.repeat(6000))]), /12,000/);
  assert.equal(draft.items.length, 1);
  draft.remove(draft.items[0].id);
  assert.equal(await draft.add([note('y'.repeat(6000))]), true);
});

test('clearing the owner scope during file reading prevents stale attachments and previews', async () => {
  const { draft, created } = fixture();
  let finish;
  const pending = draft.add([{ name: 'pending.png', type: 'image/png', size: 1, arrayBuffer: () => new Promise(resolve => { finish = resolve; }) }]);
  assert.equal(draft.loading, true);
  draft.clear();
  finish(Uint8Array.of(1).buffer);
  assert.equal(await pending, false);
  assert.equal(draft.loading, false);
  assert.deepEqual(draft.items, []);
  assert.equal(created.length, 0);
});

test('a preview creation failure revokes earlier previews without partially adding the batch', async () => {
  const revoked = []; let count = 0;
  const draft = createCoachAttachments({ createObjectURL() { if (count++) throw new Error('Preview unavailable'); return 'blob:first'; }, revokeObjectURL: url => revoked.push(url) });
  await assert.rejects(draft.add([photo(), photo()]), /Preview unavailable/);
  assert.deepEqual(revoked, ['blob:first']);
  assert.deepEqual(draft.items, []);
  assert.equal(draft.loading, false);
});
