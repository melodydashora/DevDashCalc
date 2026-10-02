import test from 'node:test';
import assert from 'node:assert/strict';
import { completeTutor, getTutorStatus } from '../tutor-service.js';
import { createStudentRecordLookup } from '../coach-records.js';

const KEYS = { ANTHROPIC_API_KEY: 'fixture-anthropic-key-private', OPENAI_API_KEY: 'fixture-openai-key-private' };
const MODELS = ['gpt-6-astra', 'gpt-5.6-sol'];
const ENDPOINTS = { text: 'https://api.openai.com/v1/chat/completions', records: 'https://api.openai.com/v1/responses' };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'x-private-diagnostic': 'private-header-marker' } });
const request = extra => ({ system: 'Use the verified answer key and authorized student context.',
  messages: [{ role: 'user', content: 'Help me choose my next study step.' }], env: { ...KEYS }, ...extra });
const lookup = extra => createStudentRecordLookup({ profileId: 'student-fixture',
  readNotes: async () => ({ totalCount: 1, notes: [{ profileId: 'student-fixture', text: 'Name the inner function first.' }] }), ...extra });
const answer = (url, text = 'Recovered explanation.') => url === ENDPOINTS.records
  ? { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] }
  : { choices: [{ finish_reason: 'stop', message: { content: text } }] };
const refusal = url => url === ENDPOINTS.records
  ? { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No.' }] }] }
  : { choices: [{ finish_reason: 'stop', message: { refusal: 'No.' } }] };
const toolResponse = (offsets, opaqueState) => ({ status: 'completed', usage: { output_tokens: 40 }, output: [
  ...(opaqueState ? [{ type: 'reasoning', encrypted_content: opaqueState }] : []),
  ...offsets.map(offset => ({ type: 'function_call', call_id: `call-${offset}`, name: 'read_student_records', arguments: JSON.stringify({ collection: 'saved_notes', offset }) })),
] });
const assertNoPrivateDiagnostics = value => {
  const serialized = JSON.stringify(value);
  for (const secret of [...Object.values(KEYS), 'private-error-marker', 'private-header-marker', 'private-network-marker']) {
    assert.equal(serialized.includes(secret), false, 'result must not disclose remote diagnostics or credentials');
  }
};

test('default text orchestration attempts only OpenAI Astra then Sol, even with an Anthropic key', async () => {
  const calls = [];
  const out = await completeTutor(request({ fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body });
    return calls.length === 1 ? response({ error: { message: 'private-error-marker' } }, 503) : response(answer(url));
  } }));
  assert.deepEqual(calls.map(call => call.body.model), MODELS);
  assert.deepEqual(calls.map(call => call.url), [ENDPOINTS.text, ENDPOINTS.text]);
  assert.equal(out.text, 'Recovered explanation.');
  assert.equal(out.model, 'gpt-5.6-sol');
  assert.equal(out.provider, 'openai');
  assert.equal(out.fallback, true);
  assert.equal(out.failures.length, 1);
  assertNoPrivateDiagnostics(out);
});

test('only an OpenAI key is needed to serve a current student coaching request', async () => {
  const sent = [];
  const out = await completeTutor(request({ env: { OPENAI_API_KEY: KEYS.OPENAI_API_KEY }, fetchImpl: async (url, options) => {
    sent.push({ url, body: JSON.parse(options.body) }); return response(answer(url));
  } }));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, ENDPOINTS.text);
  assert.equal(sent[0].body.model, MODELS[0]);
  assert.equal(out.text, 'Recovered explanation.');
  assert.equal(out.fallback, false);
});

test('environment model overrides control every OpenAI text and record-aware attempt', async () => {
  const models = ['gpt-custom-primary', 'gpt-custom-backup'];
  const env = { ...KEYS, TUTOR_MODEL_OPENAI: models[0], TUTOR_MODEL_OPENAI_FALLBACK: models[1] };
  for (const recordAware of [false, true]) {
    const sent = [];
    const out = await completeTutor(request({ env, ...(recordAware ? { lookup: lookup() } : {}), fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body); sent.push({ url, body });
      return sent.length === 1 ? response({}, 503) : response(answer(url));
    } }));
    assert.deepEqual(sent.map(call => call.body.model), models);
    assert.deepEqual(sent.map(call => call.url), Array(2).fill(recordAware ? ENDPOINTS.records : ENDPOINTS.text));
    if (recordAware) assert.ok(sent.every(call => call.body.tools[0].name === 'read_student_records'));
    assert.equal(out.model, models[1]);
    assert.equal(out.text, 'Recovered explanation.');
  }
});

test('refusal is final across model fallback in text and record-aware coaching', async () => {
  for (const recordAware of [false, true]) {
    const sent = [];
    const out = await completeTutor(request({ ...(recordAware ? { lookup: lookup() } : {}), fetchImpl: async (url, options) => {
      sent.push(JSON.parse(options.body).model); return response(refusal(url));
    } }));
    assert.deepEqual(sent, [MODELS[0]]);
    assert.equal(out.refusal, true);
    assert.equal(out.fallback, false);
    assert.equal(out.text, '');
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

test('HTTP 401 skips the fallback sharing that OpenAI key and never switches to Anthropic', async () => {
  for (const recordAware of [false, true]) {
    const sent = []; let errorBodyReads = 0;
    const out = await completeTutor(request({ ...(recordAware ? { lookup: lookup() } : {}), fetchImpl: async (url, options) => {
      sent.push({ url, model: JSON.parse(options.body).model });
      return { status: 401, json() { errorBodyReads++; throw new Error('A rejected key must not wait for its error body.'); } };
    } }));
    assert.deepEqual(sent, [{ url: recordAware ? ENDPOINTS.records : ENDPOINTS.text, model: MODELS[0] }]);
    assert.equal(out.text, '');
    assert.equal(out.refusal, false);
    assert.equal(errorBodyReads, 0);
    assertNoPrivateDiagnostics(out);
  }
});

test('all-model failures expose local diagnostics without response headers, bodies, or keys', async () => {
  let attempts = 0;
  const out = await completeTutor(request({ fetchImpl: async () => {
    attempts++;
    if (attempts % 2) throw new Error(`private-network-marker ${Object.values(KEYS).join(' ')}`);
    return response({ error: { message: `private-error-marker ${Object.values(KEYS).join(' ')}` } }, 503);
  } }));
  assert.equal(attempts, 2);
  assert.equal(out.text, '');
  assert.equal(out.failures.length, 2);
  assertNoPrivateDiagnostics(out);
});

test('the total deadline reserves time for Sol after a stalled Astra response body', async () => {
  const sent = [];
  const out = await completeTutor(request({ env: { ...KEYS, TUTOR_TIMEOUT_MS: '1000', TUTOR_TOTAL_TIMEOUT_MS: '1000' },
    fetchImpl: async (url, options) => {
      sent.push({ model: JSON.parse(options.body).model, signal: options.signal });
      if (sent.length === 2) return response(answer(url, 'Sol still had time to answer.'));
      return { status: 200, ok: true, json: () => new Promise(() => {}) };
    } }));
  assert.deepEqual(sent.map(call => call.model), MODELS);
  assert.equal(out.text, 'Sol still had time to answer.');
  assert.equal(out.fallback, true);
  assert.equal(sent[0].signal.aborted, true);
  assert.ok(out.failures.every(failure => /timed out/.test(failure)));
});

test('OpenAI model fallback keeps owner-bound record tools and a shared eight-read ceiling', async () => {
  const actualReads = [];
  const scoped = lookup({ readNotes: async args => {
    actualReads.push(args);
    return { totalCount: 20, notes: [{ profileId: 'student-fixture', text: `Saved note ${args.offset}.` }] };
  } });
  const rounds = new Map();
  const out = await completeTutor(request({ lookup: scoped, fetchImpl: async (url, options) => {
    assert.equal(url, ENDPOINTS.records);
    const body = JSON.parse(options.body); const round = (rounds.get(body.model) || 0) + 1; rounds.set(body.model, round);
    if (body.model === MODELS[0]) {
      if (round === 1) return response(toolResponse([0, 1, 2, 3, 4, 5], 'primary-only-opaque-state'));
      assert.equal(body.input.filter(item => item.type === 'function_call_output').length, 6);
      return response({}, 503);
    }
    assert.equal(body.model, MODELS[1]);
    assert.equal(JSON.stringify(body).includes('primary-only-opaque-state'), false);
    if (round === 1) {
      assert.deepEqual(body.input, request().messages, 'fallback starts from the original authorized conversation');
      return response(toolResponse([6, 7, 8, 9]));
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
  assert.equal(out.model, MODELS[1]);
  assert.equal(out.fallback, true);
  assert.match(out.text, /eight authorized record pages/);
});

test('lost student authorization stops record-aware model fallback before another network request', async () => {
  let authorized = true, sent = 0;
  const scoped = lookup({ assertCurrent: async () => { if (!authorized) throw new Error('private-error-marker'); } });
  const out = await completeTutor(request({ lookup: scoped,
    fetchImpl: async () => { sent++; authorized = false; return response({}, 503); } }));
  assert.equal(sent, 1);
  assert.equal(out.text, '');
  assert.equal(out.failureKind, 'authorization');
  assertNoPrivateDiagnostics(out);
});

test('public tutor status reports only OpenAI without private attempts or API keys', () => {
  const status = getTutorStatus({ ...KEYS, GEMINI_API_KEY: 'private-gemini-key' });
  assert.deepEqual(status.providers, ['openai']);
  assert.deepEqual(status.models, MODELS);
  assert.equal(status.available, true);
  assert.deepEqual(Object.keys(status).sort(), ['available', 'coach', 'models', 'providers', 'warnings']);
  assert.equal(Object.hasOwn(status, 'attempts'), false);
  assert.equal(JSON.stringify(status).includes('private-gemini-key'), false);
  assertNoPrivateDiagnostics(status);
});

test('text-only request guards prevent fallback from receiving revoked context', async () => {
  let current = true, sent = 0;
  const out = await completeTutor(request({
    assertCurrent: async () => { if (!current) throw new Error('private-error-marker'); },
    fetchImpl: async () => { sent++; current = false; return response({}, 503); },
  }));
  assert.equal(sent, 1);
  assert.equal(out.text, '');
  assert.equal(out.failureKind, 'authorization');
  assertNoPrivateDiagnostics(out);
  sent = 0;
  const stopped = await completeTutor(request({ assertCurrent: async () => { throw new Error('private-error-marker'); },
    fetchImpl: async () => { sent++; return response({}); },
  }));
  assert.equal(sent, 0, 'a request already revoked cannot contact OpenAI');
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

test('legacy Claude selections, invalid settings, and non-OpenAI credentials never contact a provider', async () => {
  for (const env of [{ ...KEYS, TUTOR_PROVIDERS: 'anthropic' }, { ...KEYS, TUTOR_PROVIDERS: 'anthropic,openai' },
    { ...KEYS, TUTOR_PROVIDERS: 'gemini,openai' }, { ...KEYS, TUTOR_MODEL_OPENAI: 'sora-2' },
    { ...KEYS, TUTOR_MODEL_OPENAI: KEYS.ANTHROPIC_API_KEY }, { ANTHROPIC_API_KEY: KEYS.ANTHROPIC_API_KEY }, {}]) {
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

test('automatic memory requires both an owner-bound lookup and the current raw learner message', async () => {
  let saved = 0;
  for (const extra of [
    { remember: async () => { saved++; }, memoryMessage: 'I prefer diagrams.' },
    { lookup: lookup(), remember: async () => { saved++; } },
    { lookup: lookup(), memoryMessage: 'I prefer diagrams.' },
  ]) {
    const out = await completeTutor(request({ ...extra, fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.tools?.some(tool => tool.name === 'remember_student_memory') || false, false);
      return response(answer(url));
    } }));
    assert.equal(out.text, 'Recovered explanation.');
    assert.deepEqual(out.memoryWrites, []);
  }
  assert.equal(saved, 0);
});

test('confirmed learning memory receipts and the two-write limit survive OpenAI model fallback', async () => {
  const texts = ['I prefer diagrams.', 'Short steps help me.', 'I want to review limits.'];
  const saves = [], rounds = new Map();
  const memoryCall = (text, index) => ({ type: 'function_call', call_id: `memory-${index}`, name: 'remember_student_memory', arguments: JSON.stringify({ kind: 'preference', text }) });
  const out = await completeTutor(request({ lookup: lookup(), memoryMessage: texts.join(' '),
    remember: async (payload, options) => {
      await options.assertCurrent(); saves.push(payload); return { id: `saved-${saves.length}`, text: payload.text };
    }, fetchImpl: async (url, options) => {
      assert.equal(url, ENDPOINTS.records);
      const body = JSON.parse(options.body), round = (rounds.get(body.model) || 0) + 1;
      rounds.set(body.model, round);
      assert.ok(body.tools.some(tool => tool.name === 'remember_student_memory'));
      assert.match(body.instructions, /exact quote from this student's current message/);
      if (body.model === MODELS[0]) return round === 1
        ? response({ usage: { output_tokens: 100 }, output: [memoryCall(texts[0], 0)] }) : response({}, 503);
      if (round === 1) return response({ usage: { output_tokens: 100 }, output: texts.map(memoryCall) });
      const results = body.input.filter(item => item.type === 'function_call_output').map(item => JSON.parse(item.output));
      assert.deepEqual(results.map(item => item.state), ['saved', 'saved', 'memory_limit']);
      return response(answer(url, 'I will use diagrams and short steps. Two learning memories are saved in Coach Notes.'));
    } }));
  assert.equal(out.fallback, true);
  assert.equal(saves.length, 2);
  assert.deepEqual(saves.map(save => save.text), texts.slice(0, 2));
  assert.deepEqual(out.memoryWrites.map(write => write.text), texts.slice(0, 2));
  assert.ok(out.memoryWrites.every(write => write.state === 'saved'));
});

test('memory tools add two bounded saves without reducing the eight owner-bound read allowance', async () => {
  const texts = ['I prefer diagrams.', 'Short steps help me.'];
  let turns = 0, saves = 0;
  const out = await completeTutor(request({ lookup: lookup(), memoryMessage: texts.join(' '),
    remember: async ({ text }) => ({ id: `saved-${++saves}`, text }), fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      if (++turns === 1) return response({ usage: { output_tokens: 100 }, output: [
        ...toolResponse([0, 1, 2, 3, 4, 5, 6, 7]).output,
        ...texts.map((text, index) => ({ type: 'function_call', call_id: `memory-${index}`, name: 'remember_student_memory', arguments: JSON.stringify({ kind: 'strategy', text }) })),
      ] });
      assert.equal(body.tool_choice, 'none');
      return response(answer(url, 'I checked the available history and saved your learning preferences.'));
    } }));
  assert.equal(turns, 2);
  assert.equal(out.recordReads.length, 8);
  assert.equal(out.memoryWrites.length, 2);
  assert.equal(saves, 2);
});

test('failed memory persistence is disclosed without failing an otherwise useful tutoring reply', async () => {
  let turns = 0;
  const out = await completeTutor(request({ lookup: lookup(), memoryMessage: 'I prefer diagrams.',
    remember: async () => { throw new Error('private-storage-canary'); }, fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      if (++turns === 1) return response({ usage: { output_tokens: 100 }, output: [{ type: 'function_call', call_id: 'save-memory', name: 'remember_student_memory', arguments: JSON.stringify({ kind: 'preference', text: 'I prefer diagrams.' }) }] });
      assert.equal(JSON.parse(body.input.find(item => item.type === 'function_call_output').output).state, 'unavailable');
      return response(answer(url, 'I can use a diagram in this reply. This preference was not saved.'));
    } }));
  assert.match(out.text, /not saved/);
  assert.equal(out.memoryWrites[0].state, 'unavailable');
  assert.doesNotMatch(JSON.stringify(out), /private-storage-canary/);
});
