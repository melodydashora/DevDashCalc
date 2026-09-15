import test from 'node:test';
import assert from 'node:assert/strict';
import { completeRecordCoach } from '../ai-record-coach.js';
import { createStudentRecordLookup } from '../coach-records.js';
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
const message = text => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const call = (args, name = 'read_student_records') => ({ type: 'function_call', call_id: 'call-records', name, arguments: JSON.stringify(args) });
const request = () => ({ apiKey: 'fixture-key', system: 'Use the checked answer key.', messages: [{ role: 'user', content: 'What did I save last time?' }],
  lookup: createStudentRecordLookup({ profileId: 'student-a', readNotes: async () => ({ totalCount: 1, notes: [{ profileId: 'student-a', text: 'Write inner and outer functions first.' }] }) }) });

test('Astra Responses tool cycle preserves reasoning, passes typed outputs, and disables API storage', async () => {
  const calls = [];
  const result = await completeRecordCoach({ ...request(), fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(body.store, false);
    assert.equal(body.reasoning.effort, 'high'); assert.equal(body.parallel_tool_calls, false);
    if (calls.length === 1) return response({ status: 'completed', usage: { output_tokens: 100 }, output: [{ type: 'reasoning', id: 'reasoning-id', encrypted_content: 'opaque-fixture', summary: [] }, call({ collection: 'saved_notes', offset: 0 })] });
    assert.ok(body.input.some(item => item.type === 'reasoning' && item.encrypted_content === 'opaque-fixture'));
    const record = body.input.find(item => item.type === 'function_call_output');
    assert.equal(record.call_id, 'call-records'); assert.match(record.output, /inner and outer/);
    assert.equal(body.max_output_tokens, 15900);
    return response({ status: 'completed', output: [message('Your saved strategy starts with inner and outer functions.')] });
  } });
  assert.equal(result.model, 'gpt-6-astra'); assert.equal(result.fallback, false);
  assert.equal(result.recordReads[0].count, 1); assert.equal(calls.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /opaque-fixture|fixture-key/);
});

test('service failures fall back only to Sol, while refusals and authentication failures are final', async () => {
  for (const kind of ['service', 'refusal', 'authentication']) {
    const models = [];
    const result = await completeRecordCoach({ ...request(), fetchImpl: async (_, options) => {
      models.push(JSON.parse(options.body).model);
      if (models.length > 1) return response({ status: 'completed', output: [message('Recovered by Sol.')] });
      return kind === 'service' ? response({ error: { message: 'private error fixture-key' } }, 503)
        : kind === 'authentication' ? { status: 401, json: () => new Promise(() => {}) }
          : response({ output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] });
    } });
    assert.deepEqual(models, kind === 'service' ? ['gpt-6-astra', 'gpt-5.6-sol'] : ['gpt-6-astra']);
    assert.equal(result.refusal, kind === 'refusal'); assert.doesNotMatch(JSON.stringify(result), /private error|fixture-key/);
  }
});

test('unexpected tool names and selectors never become arbitrary lookups', async () => {
  let noteReads = 0, turns = 0;
  const options = request(); options.lookup = createStudentRecordLookup({ profileId: 'student-a', readNotes: async () => { noteReads++; return {}; } });
  const result = await completeRecordCoach({ ...options, fetchImpl: async (_, options) => {
    turns++; const input = JSON.parse(options.body).input;
    if (turns === 1) return response({ output: [call({ collection: 'saved_notes', offset: 0, profileId: 'student-b' })] });
    assert.equal(JSON.parse(input.find(item => item.type === 'function_call_output').output).state, 'invalid_request');
    return response({ status: 'completed', output: [message('Only your own records can be checked.')] });
  } });
  assert.equal(noteReads, 0); assert.ok(result.text);
});

test('the deadline covers a stalled response body and a stalled record read', async () => {
  for (const stalledTool of [false, true]) {
    const options = request();
    if (stalledTool) options.lookup.execute = () => new Promise(() => {});
    let calls = 0;
    const result = await completeRecordCoach({ ...options, timeoutMs: 15, fetchImpl: async (_, options) => {
      calls++;
      if (JSON.parse(options.body).model === 'gpt-5.6-sol') return response({ status: 'completed', output: [message('Fallback after deadline.')] });
      return stalledTool ? response({ output: [call({ collection: 'saved_notes', offset: 0 })] }) : { ok: true, status: 200, json: () => new Promise(() => {}) };
    } });
    assert.equal(result.fallback, true); assert.equal(calls, 2); assert.match(result.failures[0], /timed out/);
  }
});
