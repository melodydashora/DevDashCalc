import test from 'node:test';
import assert from 'node:assert/strict';
import { completeTutor, getTutorStatus } from '../tutor-service.js';
import { createStudentRecordLookup } from '../coach-records.js';

const KEYS = { ANTHROPIC_API_KEY: 'fixture-anthropic-key-private', OPENAI_API_KEY: 'fixture-openai-key-private' };
const MODELS = ['claude-fable-5-1', 'claude-opus-5', 'gpt-6-astra', 'gpt-5.6-sol'];
const ENDPOINTS = { anthropic: 'https://api.anthropic.com/v1/messages', text: 'https://api.openai.com/v1/chat/completions', records: 'https://api.openai.com/v1/responses' };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'x-private-diagnostic': 'private-header-marker' } });
const provider = url => url === ENDPOINTS.anthropic ? 'anthropic' : 'openai';
const request = extra => ({ system: 'Use the verified answer key and authorized student context.',
  messages: [{ role: 'user', content: 'Help me choose my next study step.' }], env: { ...KEYS }, ...extra });
const lookup = extra => createStudentRecordLookup({ profileId: 'student-fixture',
  readNotes: async () => ({ totalCount: 1, notes: [{ profileId: 'student-fixture', text: 'Name the inner function first.' }] }), ...extra });
const answer = (url, text = 'Recovered explanation.') => url === ENDPOINTS.anthropic
  ? { type: 'message', role: 'assistant', stop_reason: 'end_turn', usage: { output_tokens: 30 }, content: [{ type: 'text', text }] }
  : url === ENDPOINTS.records ? { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] }
    : { choices: [{ finish_reason: 'stop', message: { content: text } }] };
const refusal = url => url === ENDPOINTS.anthropic
  ? { stop_reason: 'refusal', content: [{ type: 'text', text: 'Do not display partial refusal text.' }] }
  : url === ENDPOINTS.records ? { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No.' }] }] }
    : { choices: [{ finish_reason: 'stop', message: { refusal: 'No.' } }] };
const toolCall = (url, offset) => url === ENDPOINTS.anthropic
  ? { type: 'tool_use', id: `tool-${offset}`, name: 'read_student_records', input: { collection: 'saved_notes', offset } }
  : { type: 'function_call', call_id: `call-${offset}`, name: 'read_student_records', arguments: JSON.stringify({ collection: 'saved_notes', offset }) };
const toolResponse = (url, offsets) => url === ENDPOINTS.anthropic
  ? { type: 'message', role: 'assistant', stop_reason: 'tool_use', usage: { output_tokens: 40 },
    content: [{ type: 'thinking', thinking: '', signature: 'anthropic-only-opaque-state' }, ...offsets.map(offset => toolCall(url, offset))] }
  : { status: 'completed', usage: { output_tokens: 40 }, output: offsets.map(offset => toolCall(url, offset)) };
const assertNoPrivateDiagnostics = value => {
  const serialized = JSON.stringify(value);
  for (const secret of [...Object.values(KEYS), 'private-error-marker', 'private-header-marker', 'private-network-marker']) {
    assert.equal(serialized.includes(secret), false, 'result must not disclose remote diagnostics or credentials');
  }
};

test('default text orchestration attempts Fable, Opus, Astra, then Sol once each', async () => {
  const calls = [];
  const out = await completeTutor(request({ fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body });
    return calls.length < 4 ? response({ error: { message: 'private-error-marker' } }, 503) : response(answer(url));
  } }));
  assert.deepEqual(calls.map(call => call.body.model), MODELS);
  assert.deepEqual(calls.map(call => call.url), [ENDPOINTS.anthropic, ENDPOINTS.anthropic, ENDPOINTS.text, ENDPOINTS.text]);
  assert.equal(out.text, 'Recovered explanation.');
  assert.equal(out.model, 'gpt-5.6-sol');
  assert.equal(out.provider, 'openai');
  assert.equal(out.fallback, true);
  assert.equal(out.failures.length, 3);
  assertNoPrivateDiagnostics(out);
});

test('environment model overrides control every text and record-aware attempt', async () => {
  const models = ['claude-custom-primary', 'claude-custom-backup', 'gpt-custom-primary', 'gpt-custom-backup'];
  const env = { ...KEYS, TUTOR_MODEL_ANTHROPIC: models[0], TUTOR_MODEL_ANTHROPIC_FALLBACK: models[1],
    TUTOR_MODEL_OPENAI: models[2], TUTOR_MODEL_OPENAI_FALLBACK: models[3] };
  for (const recordAware of [false, true]) {
    const sent = [];
    const out = await completeTutor(request({ env, ...(recordAware ? { lookup: lookup() } : {}), fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body); sent.push({ url, body });
      return sent.length < 4 ? response({}, 503) : response(answer(url));
    } }));
    assert.deepEqual(sent.map(call => call.body.model), models);
    assert.deepEqual(sent.map(call => call.url), [ENDPOINTS.anthropic, ENDPOINTS.anthropic,
      recordAware ? ENDPOINTS.records : ENDPOINTS.text, recordAware ? ENDPOINTS.records : ENDPOINTS.text]);
    if (recordAware) assert.ok(sent.every(call => call.body.tools[0].name === 'read_student_records'));
    assert.equal(out.model, models[3]);
    assert.equal(out.text, 'Recovered explanation.');
  }
});

test('refusal is final across vendors in text and record-aware coaching', async () => {
  for (const order of ['anthropic,openai', 'openai,anthropic']) {
    for (const recordAware of [false, true]) {
      const sent = [];
      const out = await completeTutor(request({ env: { ...KEYS, TUTOR_PROVIDERS: order },
        ...(recordAware ? { lookup: lookup() } : {}), fetchImpl: async (url, options) => {
          sent.push(JSON.parse(options.body).model); return response(refusal(url));
        } }));
      assert.deepEqual(sent, [order.startsWith('anthropic') ? MODELS[0] : MODELS[2]]);
      assert.equal(out.refusal, true);
      assert.equal(out.fallback, false);
      assert.equal(out.text, '');
    }
  }
});

test('a refusal remains final without waiting for another context check', async () => {
  let checks = 0, calls = 0;
  const out = await completeTutor(request({
    env: { ...KEYS, TUTOR_TOTAL_TIMEOUT_MS: '1000' },
    assertCurrent: async () => { if (++checks > 1) await new Promise(() => {}); },
    fetchImpl: async url => { calls++; return response(refusal(url)); },
  }));
  assert.equal(out.refusal, true);
  assert.equal(out.text, '');
  assert.equal(calls, 1);
  assert.equal(checks, 1);
});

test('HTTP 401 skips the remaining model at that vendor and recovers through the other vendor', async () => {
  for (const order of ['anthropic,openai', 'openai,anthropic']) {
    for (const recordAware of [false, true]) {
      const sent = [];
      let errorBodyReads = 0;
      const out = await completeTutor(request({ env: { ...KEYS, TUTOR_PROVIDERS: order },
        ...(recordAware ? { lookup: lookup() } : {}), fetchImpl: async (url, options) => {
          sent.push(JSON.parse(options.body).model);
          if (sent.length === 1) return { status: 401, json() { errorBodyReads++; throw new Error('A rejected key must not wait for its error body.'); } };
          return response(answer(url));
        } }));
      assert.deepEqual(sent, order.startsWith('anthropic') ? [MODELS[0], MODELS[2]] : [MODELS[2], MODELS[0]]);
      assert.equal(out.model, sent[1]);
      assert.equal(out.fallback, true);
      assert.equal(out.text, 'Recovered explanation.');
      assert.equal(out.refusal, false);
      assert.equal(errorBodyReads, 0);
      assertNoPrivateDiagnostics(out);
    }
  }
});

test('all-provider failures expose local diagnostics without response headers, bodies, or keys', async () => {
  let attempts = 0;
  const out = await completeTutor(request({ fetchImpl: async () => {
    attempts++;
    if (attempts % 2) throw new Error(`private-network-marker ${Object.values(KEYS).join(' ')}`);
    return response({ error: { message: `private-error-marker ${Object.values(KEYS).join(' ')}` } }, 503);
  } }));
  assert.equal(attempts, 4);
  assert.equal(out.text, '');
  assert.equal(out.failures.length, 4);
  assertNoPrivateDiagnostics(out);
});

test('the total deadline reserves time for later fallbacks after stalled response bodies', async () => {
  const sent = [];
  const out = await completeTutor(request({ env: { ...KEYS, TUTOR_TIMEOUT_MS: '1000', TUTOR_TOTAL_TIMEOUT_MS: '1000' },
    fetchImpl: async (url, options) => {
      sent.push({ model: JSON.parse(options.body).model, signal: options.signal });
      if (sent.length === 4) return response(answer(url, 'Sol still had time to answer.'));
      return { status: 200, ok: true, json: () => new Promise(() => {}) };
    } }));
  assert.deepEqual(sent.map(call => call.model), MODELS);
  assert.equal(out.text, 'Sol still had time to answer.');
  assert.equal(out.fallback, true);
  assert.ok(sent.slice(0, 3).every(call => call.signal.aborted));
  assert.ok(out.failures.every(failure => /timed out/.test(failure)));
});

test('cross-vendor fallback keeps the authorized record dispatcher and a shared eight-read ceiling', async () => {
  const actualReads = [];
  const scoped = lookup({ readNotes: async args => {
    actualReads.push(args);
    return { totalCount: 20, notes: [{ profileId: 'student-fixture', text: `Saved note ${args.offset}.` }] };
  } });
  const rounds = { anthropic: 0, openai: 0 };
  const out = await completeTutor(request({ lookup: scoped, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); const vendor = provider(url); rounds[vendor]++;
    if (vendor === 'anthropic') {
      assert.equal(body.model, MODELS[0]);
      if (rounds.anthropic === 1) return response(toolResponse(url, [0, 1, 2, 3, 4, 5]));
      assert.equal(body.messages.at(-1).content.length, 6);
      return { status: 401, json: () => new Promise(() => {}) };
    }
    assert.equal(body.model, MODELS[2]);
    assert.equal(JSON.stringify(body).includes('anthropic-only-opaque-state'), false);
    if (rounds.openai === 1) {
      assert.deepEqual(body.input, request().messages, 'fallback starts from the original authorized conversation');
      return response(toolResponse(url, [6, 7, 8, 9]));
    }
    const results = body.input.filter(item => item.type === 'function_call_output').map(item => JSON.parse(item.output));
    assert.deepEqual(results.map(item => item.state), ['available', 'available', 'lookup_limit', 'lookup_limit']);
    assert.ok(results.slice(0, 2).every(item => item.profileId === 'student-fixture'));
    return response(answer(url, 'I read eight authorized record pages; more remain unread.'));
  } }));
  assert.deepEqual(actualReads.map(read => read.offset), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.ok(actualReads.every(read => read.profileId === 'student-fixture' && read.limit === 10));
  assert.equal(out.recordReads.length, 8);
  assert.deepEqual(out.recordReads, scoped.reads);
  assert.equal(out.model, MODELS[2]);
  assert.equal(out.fallback, true);
  assert.match(out.text, /eight authorized record pages/);
});

test('lost student authorization stops later models and vendors before another network request', async () => {
  for (const order of ['anthropic,openai', 'openai,anthropic']) {
    let authorized = true, sent = 0;
    const scoped = lookup({ assertCurrent: async () => { if (!authorized) throw new Error('private-error-marker'); } });
    const out = await completeTutor(request({ env: { ...KEYS, TUTOR_PROVIDERS: order }, lookup: scoped,
      fetchImpl: async () => { sent++; authorized = false; return response({}, 503); } }));
    assert.equal(sent, 1);
    assert.equal(out.text, '');
    assert.equal(out.failureKind, 'authorization');
    assertNoPrivateDiagnostics(out);
  }
});

test('public tutor status is a deliberate projection without private attempts or API keys', () => {
  const status = getTutorStatus({ ...KEYS, GEMINI_API_KEY: 'private-gemini-key' });
  assert.deepEqual(status.providers, ['anthropic', 'openai']);
  assert.deepEqual(status.models, MODELS);
  assert.equal(status.available, true);
  assert.deepEqual(Object.keys(status).sort(), ['available', 'coach', 'models', 'providers', 'warnings']);
  assert.equal(Object.hasOwn(status, 'attempts'), false);
  assert.equal(JSON.stringify(status).includes('private-gemini-key'), false);
  assertNoPrivateDiagnostics(status);
});

test('text-only request guards prevent later vendors from receiving revoked context', async () => {
  for (const order of ['anthropic,openai', 'openai,anthropic']) {
    let current = true, sent = 0;
    const out = await completeTutor(request({ env: { ...KEYS, TUTOR_PROVIDERS: order },
      assertCurrent: async () => { if (!current) throw new Error('private-error-marker'); },
      fetchImpl: async () => { sent++; current = false; return response({}, 503); },
    }));
    assert.equal(sent, 1);
    assert.equal(out.text, '');
    assert.equal(out.failureKind, 'authorization');
    assertNoPrivateDiagnostics(out);
  }
  let sent = 0;
  const stopped = await completeTutor(request({ assertCurrent: async () => { throw new Error('private-error-marker'); },
    fetchImpl: async () => { sent++; return response({}); },
  }));
  assert.equal(sent, 0, 'a request already revoked cannot contact the first provider');
  assert.equal(stopped.failureKind, 'authorization');
});

test('a stalled text-only guard remains inside the total request deadline', async () => {
  let sent = 0;
  const started = Date.now();
  const out = await completeTutor(request({ env: { ...KEYS, TUTOR_TIMEOUT_MS: '1000', TUTOR_TOTAL_TIMEOUT_MS: '1000' },
    assertCurrent: () => new Promise(() => {}), fetchImpl: async () => { sent++; return response({}); },
  }));
  assert.equal(sent, 0);
  assert.equal(out.text, '');
  assert.ok(Date.now() - started < 2000, 'authorization checks cannot leave the request waiting indefinitely');
});

test('invalid configuration and missing credentials make no provider requests', async () => {
  for (const env of [{ ...KEYS, TUTOR_PROVIDERS: 'gemini,openai' }, { ...KEYS, TUTOR_MODEL_OPENAI: 'sora-2' },
    { ...KEYS, TUTOR_MODEL_ANTHROPIC: KEYS.ANTHROPIC_API_KEY }, {}]) {
    let sent = 0;
    const status = getTutorStatus(env);
    const out = await completeTutor(request({ env, fetchImpl: async () => { sent++; throw new Error('No fetch is allowed.'); } }));
    assert.equal(status.available, false);
    assert.equal(sent, 0);
    assert.equal(out.text, '');
    assert.ok(out.failures.length > 0);
    assertNoPrivateDiagnostics(status);
    assertNoPrivateDiagnostics(out);
  }
});
