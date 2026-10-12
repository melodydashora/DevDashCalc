import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoachMemory, COACH_MEMORY_TOOL } from '../coach-memory.js';

const TOOL = COACH_MEMORY_TOOL.name;
const guard = async () => {};
const memoryRequest = { kind: 'preference', text: 'I learn better with diagrams.' };
const create = (overrides = {}) => createCoachMemory({ message: memoryRequest.text,
  remember: async ({ text }) => ({ id: 'saved-memory-id', text }), ...overrides });

test('memory capability requires an explicit saver and bounded raw learner message', () => {
  for (const options of [{}, { message: 'A preference.' }, { remember: async () => {} },
    { remember: async () => {}, message: '' }, { remember: async () => {}, message: 'x'.repeat(2001) }]) assert.equal(createCoachMemory(options), null);
  assert.deepEqual(Object.keys(COACH_MEMORY_TOOL.parameters.properties), ['kind', 'text']);
  assert.equal(COACH_MEMORY_TOOL.parameters.additionalProperties, false);
  assert.equal(COACH_MEMORY_TOOL.parameters.properties.text.maxLength, 500);
});

test('selective quoted memory uses only the bound saver and exposes a confirmed safe receipt', async () => {
  let call; let checks = 0;
  const memory = create({ remember: async (payload, options) => {
    call = { payload, options };
    await options.assertCurrent();
    return { id: 'saved-id', text: payload.text, privateField: 'never-expose' };
  } });
  const controller = new AbortController();
  const result = await memory.execute(TOOL, memoryRequest, { signal: controller.signal, assertCurrent: async () => { checks++; } });
  assert.deepEqual(result, { state: 'saved', id: 'saved-id', ...memoryRequest });
  assert.deepEqual(memory.writes, [result]);
  assert.deepEqual(Object.keys(call.payload).sort(), ['clientRequestId', 'kind', 'text']);
  assert.match(call.payload.clientRequestId, /^[a-f0-9-]{36}$/);
  assert.equal(call.options.signal, controller.signal);
  assert.ok(checks >= 3);
  assert.doesNotMatch(JSON.stringify(result), /never-expose/);
});

test('memory tool rejects unrelated context, invented summaries, selectors, secrets and control characters', async () => {
  let saves = 0;
  const source = `${memoryRequest.text} My password=privatefixturevalue. One\u0001two. ${'x'.repeat(501)}`;
  const memory = create({ message: source, remember: async () => { saves++; } });
  const invalid = [
    { kind: 'grade', text: memoryRequest.text },
    { ...memoryRequest, profileId: 'another-student' },
    { ...memoryRequest, source: { kind: 'settings' } },
    { kind: 'preference', text: 'The student needs visual explanations.' },
    { kind: 'goal', text: 'A quoted assignment from Canvas.' },
    { kind: 'preference', text: 'My password=privatefixturevalue.' },
    { kind: 'preference', text: 'One\u0001two.' },
    { kind: 'preference', text: 'x'.repeat(501) },
    { kind: 'preference', text: 'I' }, null, [],
  ];
  for (const args of invalid) assert.equal((await memory.execute(TOOL, args, { assertCurrent: guard })).state, 'invalid_request');
  assert.equal((await memory.execute('edit_student_memory', memoryRequest, { assertCurrent: guard })).state, 'invalid_request');
  assert.equal(saves, 0);
  assert.deepEqual(memory.writes, []);
});

test('a clear request not to remember prevents new memories even if the model calls the tool', async () => {
  let saves = 0;
  for (const instruction of ['Do not remember this.', 'Please don’t save that.', 'Forget my old learning preferences.']) {
    const memory = create({ message: `${memoryRequest.text} ${instruction}`, remember: async () => { saves++; } });
    assert.equal((await memory.execute(TOOL, memoryRequest, { assertCurrent: guard })).state, 'invalid_request');
  }
  assert.equal(saves, 0);
});

test('each reply saves at most two distinct quotes and repeated calls share one result', async () => {
  const saved = [];
  const texts = ['I prefer diagrams.', 'Short steps help me.', 'I want to practice limits.'];
  const memory = create({ message: texts.join(' '), remember: async (payload) => { saved.push(payload); return { id: `memory-${saved.length}`, text: payload.text }; } });
  const first = await memory.execute(TOOL, { kind: 'preference', text: texts[0] }, { assertCurrent: guard });
  assert.deepEqual(await memory.execute(TOOL, { kind: 'strategy', text: texts[0] }, { assertCurrent: guard }), first);
  assert.equal((await memory.execute(TOOL, { kind: 'strategy', text: texts[1] }, { assertCurrent: guard })).state, 'saved');
  assert.equal((await memory.execute(TOOL, { kind: 'goal', text: texts[2] }, { assertCurrent: guard })).state, 'memory_limit');
  assert.equal(saved.length, 2);
  assert.equal(memory.writes.length, 2);
});

test('concurrent repeats cannot start duplicate writes', async () => {
  let finish, saves = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const memory = create({ remember: async ({ text }) => { saves++; await pending; return { id: 'single-memory', text }; } });
  const one = memory.execute(TOOL, memoryRequest, { assertCurrent: guard });
  const two = memory.execute(TOOL, memoryRequest, { assertCurrent: guard });
  finish();
  assert.deepEqual(await one, await two);
  assert.equal(saves, 1);
});

test('failed or unconfirmed saves never claim success or disclose private storage errors', async () => {
  for (const remember of [async () => { throw new Error('private-storage-error'); }, async () => null,
    async () => ({ id: 'record-id', text: 'A different memory.' })]) {
    const memory = create({ remember });
    const result = await memory.execute(TOOL, memoryRequest, { assertCurrent: guard });
    assert.equal(result.state, 'unavailable');
    assert.deepEqual(memory.writes, [result]);
    assert.doesNotMatch(JSON.stringify(result), /private-storage-error|different memory/);
  }
});

test('revoked ownership and cancellation prevent writes and stop stale receipts', async () => {
  let saves = 0;
  const memory = create({ remember: async ({ text }) => { saves++; return { id: 'saved-id', text }; } });
  await assert.rejects(memory.execute(TOOL, memoryRequest, { assertCurrent: async () => { throw new Error('revoked'); } }));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(memory.execute(TOOL, memoryRequest, { assertCurrent: guard, signal: controller.signal }));
  assert.equal(saves, 0);
  let authorized = true;
  const changed = create({ remember: async ({ text }) => { authorized = false; return { id: 'saved-id', text }; } });
  await assert.rejects(changed.execute(TOOL, memoryRequest, { assertCurrent: async () => { if (!authorized) throw new Error('revoked'); } }));
  assert.deepEqual(changed.writes, []);
});
