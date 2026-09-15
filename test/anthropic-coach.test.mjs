import test from 'node:test';
import assert from 'node:assert/strict';
import { completeAnthropicCoach } from '../anthropic-coach.js';
import { createStudentRecordLookup, RECORD_SYSTEM } from '../coach-records.js';

const KEY = 'synthetic-anthropic-key';
const MODEL = 'claude-fable-5-1';
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
const answer = (text = 'Start with the inner and outer functions.', stop_reason = 'end_turn', tokens = 40) => ({
  type: 'message', role: 'assistant', model: MODEL, stop_reason, usage: { output_tokens: tokens }, content: [{ type: 'text', text }],
});
const call = (input = { collection: 'saved_notes', offset: 0 }, name = 'read_student_records', id = 'toolu_fixture') => ({ type: 'tool_use', id, name, input });
const callsResponse = (calls, tokens = 100, prefix = []) => ({ type: 'message', role: 'assistant', model: MODEL,
  stop_reason: 'tool_use', usage: { output_tokens: tokens }, content: [...prefix, ...calls] });
const request = (extra = {}) => ({ apiKey: KEY, model: MODEL, system: 'Use the verified answer key.',
  messages: [{ role: 'user', content: 'Help me use what I learned before.' }], ...extra });
const lookup = (extra = {}) => createStudentRecordLookup({ profileId: 'student-fixture',
  readNotes: async () => ({ totalCount: 1, notes: [{ profileId: 'student-fixture', text: 'Name the inner and outer functions first.' }] }), ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = () => new Promise(done => setImmediate(done));

test('one-model Messages request uses documented adaptive thinking and top-level effort without forced tools or fallback', async () => {
  for (const model of [MODEL, 'claude-opus-5', 'Claude-Future_Name:2026.09']) {
    let sent = 0;
    const result = await completeAnthropicCoach(request({ model, fetchImpl: async (url, options) => {
      sent++;
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['x-api-key'], KEY);
      assert.equal(options.headers['anthropic-version'], '2023-06-01');
      const body = JSON.parse(options.body);
      assert.equal(body.model, model);
      assert.deepEqual(body.thinking, { type: 'adaptive' });
      assert.deepEqual(body.output_config, { effort: 'high' });
      assert.equal(body.max_tokens, 16000);
      for (const absent of ['fallbacks', 'temperature', 'top_p', 'top_k', 'store', 'tools', 'tool_choice']) assert.equal(Object.hasOwn(body, absent), false);
      return response(answer());
    } }));
    assert.equal(sent, 1);
    assert.equal(result.provider, 'anthropic');
    assert.equal(result.model, model);
    assert.ok(result.text);
    assert.equal(result.refusal, false);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.recordReads, []);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(KEY));
  }
});

test('record tool round trip preserves complete opaque assistant blocks and unchanged prefix only within this model', async () => {
  const reads = lookup();
  const history = [{ role: 'user', content: 'Read my previous note.' }];
  const untouched = JSON.stringify(history);
  const prefix = [
    { type: 'thinking', thinking: '', signature: 'opaque-thinking-signature', extra_future_field: { opaque: true } },
    { type: 'redacted_thinking', data: 'opaque-redacted-data' },
    { type: 'text', text: 'I will check your saved note.' },
  ];
  const first = callsResponse([call()], 100, prefix);
  const bodies = [];
  const result = await completeAnthropicCoach(request({ messages: history, lookup: reads, fetchImpl: async (_, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    if (bodies.length === 1) {
      assert.equal(body.system, `${request().system}\n${RECORD_SYSTEM}`);
      assert.equal(body.tools[0].name, reads.tools[0].name);
      assert.equal(body.tools[0].strict, true);
      assert.deepEqual(body.tools[0].input_schema.required, reads.tools[0].parameters.required);
      assert.deepEqual(body.tool_choice, { type: 'auto' });
      return response(first);
    }
    assert.equal(body.model, MODEL);
    assert.equal(body.system, bodies[0].system);
    assert.deepEqual(body.tools, bodies[0].tools);
    assert.equal(body.max_tokens, 15900);
    assert.deepEqual(body.messages.slice(0, 1), history);
    assert.deepEqual(body.messages[1], { role: 'assistant', content: first.content });
    assert.equal(body.messages[2].role, 'user');
    assert.equal(body.messages[2].content.length, 1);
    const output = body.messages[2].content[0];
    assert.equal(output.type, 'tool_result');
    assert.equal(output.tool_use_id, 'toolu_fixture');
    assert.match(output.content, /inner and outer/);
    return response(answer());
  } }));
  assert.equal(bodies.length, 2);
  assert.equal(JSON.stringify(history), untouched);
  assert.equal(result.recordReads[0].count, 1);
  assert.doesNotMatch(JSON.stringify(result), /opaque-thinking|opaque-redacted|synthetic-anthropic/);
});

test('Anthropic strict tool schemas omit numeric bounds without changing shared schema or local validation', async () => {
  let noteReads = 0;
  const records = lookup({ readNotes: async () => { noteReads++; return {}; } });
  const originalTools = structuredClone(records.tools);
  let transmitted;
  const result = await completeAnthropicCoach(request({ lookup: records, fetchImpl: async (_, options) => {
    transmitted = JSON.parse(options.body).tools[0];
    return response(answer());
  } }));
  assert.ok(result.text);
  assert.equal(transmitted.strict, true);
  assert.deepEqual(transmitted.input_schema, {
    ...originalTools[0].parameters,
    properties: {
      ...originalTools[0].parameters.properties,
      offset: { type: 'integer', description: 'Minimum: 0. Maximum: 100000.' },
    },
  });
  assert.equal(Object.hasOwn(transmitted.input_schema.properties.offset, 'minimum'), false);
  assert.equal(Object.hasOwn(transmitted.input_schema.properties.offset, 'maximum'), false);
  assert.deepEqual(records.tools, originalTools);
  assert.equal(records.tools[0].parameters.properties.offset.minimum, 0);
  assert.equal(records.tools[0].parameters.properties.offset.maximum, 100000);
  for (const offset of [-1, 100001, 0.5]) {
    const rejected = await records.execute('read_student_records', { collection: 'saved_notes', offset });
    assert.equal(rejected.state, 'invalid_request');
  }
  assert.equal(noteReads, 0);
});

test('classifier refusals discard partial output and requested tools without retrying', async () => {
  for (const refused of [
    { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'general_harms', explanation: 'Provider explanation' }, content: [] },
    { stop_reason: 'refusal', content: [{ type: 'text', text: 'Incomplete unsafe partial response' }, call()] },
    { error: { code: 'content_policy_violation', message: KEY } },
    { error: { type: 'content_filter', message: KEY } },
  ]) {
    let requests = 0, executions = 0;
    const records = lookup();
    records.execute = async () => { executions++; return {}; };
    const result = await completeAnthropicCoach(request({ lookup: records, fetchImpl: async () => { requests++; return response(refused); } }));
    assert.equal(requests, 1);
    assert.equal(executions, 0);
    assert.equal(result.refusal, true);
    assert.equal(result.text, '');
    assert.equal(result.failureKind, undefined);
    assert.deepEqual(result.failures, []);
    assert.doesNotMatch(JSON.stringify(result), /unsafe partial|Provider explanation|synthetic-anthropic/);
  }
});

test('provider authentication and service errors remain classified and never echo response errors', async () => {
  const missing = await completeAnthropicCoach(request({ apiKey: '', fetchImpl: () => { throw new Error('must not request'); } }));
  assert.equal(missing.failureKind, 'authentication');
  const unauthorized = await completeAnthropicCoach(request({ fetchImpl: async () => ({ status: 401, json: () => new Promise(() => {}) }) }));
  assert.equal(unauthorized.failureKind, 'authentication');
  assert.match(unauthorized.failures[0], /HTTP 401/);
  for (const status of [400, 403, 429, 503, 529]) {
    let requests = 0;
    const result = await completeAnthropicCoach(request({ fetchImpl: async () => { requests++; return response({ error: { message: KEY } }, status); } }));
    assert.equal(requests, 1);
    assert.equal(result.failureKind, 'service');
    assert.match(result.failures[0], new RegExp(`HTTP ${status}`));
    assert.doesNotMatch(JSON.stringify(result), new RegExp(KEY));
  }
  const thrown = await completeAnthropicCoach(request({ fetchImpl: async () => { throw new Error(`URL contains ${KEY}`); } }));
  assert.equal(thrown.failureKind, 'service');
  assert.doesNotMatch(JSON.stringify(thrown), /URL contains|synthetic-anthropic/);
});

test('owner authorization is checked before requests, before lookups, and before a final answer', async () => {
  for (const stage of ['before-request', 'before-tool', 'before-answer']) {
    let authorizations = 0, executions = 0, requests = 0;
    const records = lookup({ assertCurrent: async () => {
      if (++authorizations >= (stage === 'before-request' ? 1 : 2)) throw new Error(`revoked ${KEY}`);
    } });
    records.execute = async () => { executions++; return {}; };
    const result = await completeAnthropicCoach(request({ lookup: records, fetchImpl: async () => {
      requests++;
      return response(stage === 'before-tool' ? callsResponse([call()]) : answer());
    } }));
    assert.equal(result.failureKind, 'authorization');
    assert.equal(result.text, '');
    assert.equal(executions, 0);
    assert.equal(requests, stage === 'before-request' ? 0 : 1);
    assert.doesNotMatch(JSON.stringify(result), /revoked|synthetic-anthropic/);
  }
});

test('unknown tool names and invalid input shapes reach the closed dispatcher without record access', async () => {
  let noteReads = 0, requests = 0;
  const records = lookup({ readNotes: async () => { noteReads++; return {}; } });
  const toolCalls = [call({ sql: 'select *' }, 'arbitrary_database', 'tool_unknown'),
    call(['saved_notes'], 'read_student_records', 'tool_array'), call(null, null, 'tool_null'),
    call({ collection: 'saved_notes', offset: 0, profileId: 'someone-else' }, 'read_student_records', 'tool_foreign')];
  const result = await completeAnthropicCoach(request({ lookup: records, fetchImpl: async (_, options) => {
    if (++requests === 1) return response(callsResponse(toolCalls));
    const outputs = JSON.parse(options.body).messages.at(-1).content;
    assert.equal(outputs.length, 4);
    for (const output of outputs) {
      assert.equal(output.is_error, true);
      assert.equal(JSON.parse(output.content).state, 'invalid_request');
    }
    return response(answer('Only your own approved records can be read.'));
  } }));
  assert.equal(noteReads, 0);
  assert.ok(result.text);
});

test('malformed, duplicate, excessive, or truncated tool calls execute no records', async () => {
  for (const data of [
    callsResponse([call({}, 'read_student_records', '')]),
    callsResponse([call(), call()]),
    callsResponse(Array.from({ length: 9 }, (_, index) => call({}, 'read_student_records', `tool_${index}`))),
    callsResponse([call({ input: 'x'.repeat(2001) })]),
    { ...callsResponse([call()]), stop_reason: 'max_tokens' },
    { ...callsResponse([call()]), stop_reason: 'end_turn' },
  ]) {
    let executions = 0;
    const records = lookup();
    records.execute = async () => { executions++; return {}; };
    const result = await completeAnthropicCoach(request({ lookup: records, fetchImpl: async () => response(data) }));
    assert.equal(executions, 0);
    assert.equal(result.failureKind, 'service');
    assert.equal(result.text, '');
  }
});

test('eight tool calls permit one final ninth request with tools disabled and cumulative token budget', async () => {
  let requests = 0, executions = 0;
  const records = lookup();
  records.execute = async () => { executions++; return { state: 'available', records: [] }; };
  const result = await completeAnthropicCoach(request({ lookup: records, fetchImpl: async (_, options) => {
    const body = JSON.parse(options.body);
    requests++;
    assert.equal(body.max_tokens, 16000 - (requests - 1) * 100);
    if (requests <= 8) return response(callsResponse([call({}, 'read_student_records', `tool_${requests}`)]));
    assert.deepEqual(body.tool_choice, { type: 'none' });
    return response(answer());
  } }));
  assert.equal(requests, 9);
  assert.equal(executions, 8);
  assert.ok(result.text);
});

test('cumulative model and tool-output budgets cannot restart on another round', async () => {
  let requests = 0;
  const result = await completeAnthropicCoach(request({ maxOutputTokens: 2000, lookup: lookup(), fetchImpl: async (_, options) => {
    requests++;
    const body = JSON.parse(options.body);
    if (requests === 1) return response(callsResponse([call()], 1200));
    assert.equal(body.max_tokens, 800);
    assert.deepEqual(body.tool_choice, { type: 'none' });
    return response(answer('A short answer.', 'max_tokens', 800));
  } }));
  assert.equal(requests, 2);
  assert.equal(result.truncated, true);

  for (const perRead of [32001, 25000]) {
    let calls = 0;
    const records = lookup();
    records.execute = async () => ({ record: 'x'.repeat(perRead) });
    const limited = await completeAnthropicCoach(request({ lookup: records, fetchImpl: async () => {
      calls++;
      return response(callsResponse([call({}, 'read_student_records', `tool_${calls}`)]));
    } }));
    assert.equal(limited.failureKind, 'service');
    assert.match(limited.failures[0], /record output limit/);
    assert.equal(calls, perRead > 32000 ? 1 : 8);
  }
});

test('missing usage or exhausted cumulative output ends a tool round before executing records', async () => {
  for (const usage of [undefined, { output_tokens: 16000 }, { output_tokens: -1 }]) {
    let executions = 0;
    const records = lookup();
    records.execute = async () => { executions++; return {}; };
    const result = await completeAnthropicCoach(request({ lookup: records, fetchImpl: async () => response({ ...callsResponse([call()]), usage }) }));
    assert.equal(executions, 0);
    assert.match(result.failures[0], /output token budget/);
  }
});

test('truncation is explicit; empty and unsupported stop reasons never masquerade as answers', async () => {
  for (const reason of ['max_tokens', 'model_context_window_exceeded']) {
    const result = await completeAnthropicCoach(request({ fetchImpl: async () => response(answer('Partial explanation.', reason)) }));
    assert.equal(result.truncated, true);
    assert.equal(result.text, 'Partial explanation.');
  }
  for (const data of [answer('', 'end_turn'), answer('Paused text', 'pause_turn'), answer('Unknown state', 'unexpected')]) {
    const result = await completeAnthropicCoach(request({ fetchImpl: async () => response(data) }));
    assert.equal(result.failureKind, 'service');
    assert.equal(result.text, '');
  }
});

test('one deadline aborts a stalled body and prevents late tool dispatch after body completion', async () => {
  const body = deferred();
  let executions = 0, signal;
  const records = lookup(); records.execute = async () => { executions++; return {}; };
  const result = await completeAnthropicCoach(request({ lookup: records, timeoutMs: 15, fetchImpl: async (_, options) => {
    signal = options.signal;
    return { ok: true, status: 200, json: () => body.promise };
  } }));
  assert.match(result.failures[0], /timed out/);
  assert.equal(signal.aborted, true);
  body.resolve(callsResponse([call()]));
  await flush();
  assert.equal(executions, 0);
});

test('a timed-out authorization cannot start a late fetch or record lookup', async () => {
  for (const stallAt of [1, 2]) {
    const authorization = deferred();
    let checks = 0, requests = 0, executions = 0;
    const records = lookup({ assertCurrent: async () => { if (++checks === stallAt) await authorization.promise; } });
    records.execute = async () => { executions++; return {}; };
    const result = await completeAnthropicCoach(request({ lookup: records, timeoutMs: 15, fetchImpl: async () => {
      requests++; return response(callsResponse([call()]));
    } }));
    assert.match(result.failures[0], /timed out/);
    authorization.resolve();
    await flush();
    assert.equal(requests, stallAt === 1 ? 0 : 1);
    assert.equal(executions, 0);
  }
});

test('a stalled record read expires without a follow-up request or late mutation of returned read metadata', async () => {
  const reading = deferred();
  let requests = 0, signal;
  const records = lookup();
  records.execute = async (_name, _args, options) => {
    signal = options.signal;
    await reading.promise;
    records.reads.push({ collection: 'saved_notes', count: 1 });
    return { state: 'available', records: [{ text: 'Late result' }] };
  };
  const result = await completeAnthropicCoach(request({ lookup: records, timeoutMs: 15, fetchImpl: async () => {
    requests++; return response(callsResponse([call()]));
  } }));
  assert.match(result.failures[0], /timed out/);
  assert.equal(signal.aborted, true);
  reading.resolve();
  await flush();
  assert.equal(requests, 1);
  assert.deepEqual(result.recordReads, []);
});

test('an owner rejection inside tool execution cannot reach a continuation request', async () => {
  let requests = 0;
  const records = lookup();
  records.execute = async () => { const error = new Error(`revoked ${KEY}`); error.status = 403; throw error; };
  const result = await completeAnthropicCoach(request({ lookup: records, fetchImpl: async () => {
    requests++; return response(callsResponse([call()]));
  } }));
  assert.equal(result.failureKind, 'authorization');
  assert.equal(requests, 1);
  assert.equal(result.text, '');
  assert.doesNotMatch(JSON.stringify(result), /revoked|synthetic-anthropic/);
});

test('foreign opaque histories and invalid configuration are rejected without a network request', async () => {
  for (const extra of [
    { messages: [{ role: 'assistant', content: 'Unsupported prefill' }] },
    { messages: [{ role: 'user', content: [{ type: 'reasoning', encrypted_content: 'foreign opaque block' }] }] },
    { messages: [{ role: 'tool', content: 'Foreign tool state' }] },
    { reasoningEffort: 'unbounded' }, { model: 'https://untrusted.example' }, { maxOutputTokens: 0 },
  ]) {
    let requests = 0;
    const result = await completeAnthropicCoach(request({ ...extra, fetchImpl: async () => { requests++; return response(answer()); } }));
    assert.equal(requests, 0);
    assert.equal(result.failureKind, 'service');
    assert.doesNotMatch(JSON.stringify(result), /foreign opaque|untrusted\.example/);
  }
});
