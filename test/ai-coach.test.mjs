import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completeGPTCoach, COACH_MODELS, COACH_CONFIG } from '../ai-coach.js';

const KEY = 'test-placeholder-key';
const request = { apiKey: KEY, system: 'Guide one step at a time.', messages: [{ role: 'user', content: 'Explain the concept.' }] };
const reply = (content = 'Start with the rate of change.', finish_reason = 'stop', extra = {}) => ({ choices: [{ finish_reason, message: { content, ...extra } }] });
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
function transport(...replies) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, payload: JSON.parse(options.body) });
    assert.ok(calls.length <= replies.length, 'must not attempt an extra model');
    const next = replies[calls.length - 1];
    return typeof next === 'function' ? next(url, options) : next;
  };
  return { calls, fetchImpl };
}

test('Astra success uses fixed OpenAI endpoint, high reasoning, and the full output budget', async () => {
  const mock = transport(response(reply('  A grounded explanation.  ')));
  const out = await completeGPTCoach({ ...request, fetchImpl: mock.fetchImpl });
  assert.deepEqual(out, { text: 'A grounded explanation.', model: 'gpt-6-astra', provider: 'openai', fallback: false, truncated: false, refusal: false, failures: [] });
  assert.deepEqual(COACH_MODELS, ['gpt-6-astra', 'gpt-5.6-sol']);
  assert.ok(Object.isFrozen(COACH_MODELS));
  assert.ok(Object.isFrozen(COACH_CONFIG));
  assert.equal(COACH_CONFIG.timeoutMs, 120000);
  const { url, options, payload } = mock.calls[0];
  assert.equal(url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.authorization, `Bearer ${KEY}`);
  assert.equal(options.signal.aborted, false);
  assert.deepEqual(payload, {
    model: 'gpt-6-astra', reasoning_effort: 'high', max_completion_tokens: 16000,
    messages: [{ role: 'system', content: request.system }, ...request.messages],
  });
});

test('HTTP errors use Sol once, preserving the same instructions and high reasoning', async () => {
  for (const status of [400, 403, 404, 429, 500, 503]) {
    const mock = transport(response({ error: { message: `DO NOT EXPOSE ${KEY}` } }, status), response(reply('Sol explanation.')));
    const out = await completeGPTCoach({ ...request, fetchImpl: mock.fetchImpl });
    assert.equal(out.text, 'Sol explanation.');
    assert.equal(out.model, 'gpt-5.6-sol');
    assert.equal(out.fallback, true);
    assert.deepEqual(out.failures, [`gpt-6-astra: HTTP ${status}`]);
    assert.deepEqual(mock.calls.map((call) => call.payload.model), COACH_MODELS);
    assert.equal(mock.calls[1].payload.reasoning_effort, 'high');
    assert.deepEqual(mock.calls[1].payload.messages, mock.calls[0].payload.messages);
    assert.doesNotMatch(JSON.stringify(out), /DO NOT EXPOSE|test-placeholder-key/);
  }
});

test('network failure is sanitized before fallback and two service failures end the chain', async () => {
  const mock = transport(() => { throw new Error(`network details ${KEY}`); }, response({ error: { message: KEY } }, 503));
  const out = await completeGPTCoach({ ...request, fetchImpl: mock.fetchImpl });
  assert.equal(out.text, '');
  assert.equal(out.model, 'gpt-5.6-sol');
  assert.equal(out.fallback, true);
  assert.deepEqual(out.failures, ['gpt-6-astra: network request failed', 'gpt-5.6-sol: HTTP 503']);
  assert.doesNotMatch(JSON.stringify(out), /network details|test-placeholder-key/);
});

test('missing credentials make no request and HTTP 401 is final for the shared credential', async () => {
  const unused = transport();
  for (const apiKey of [undefined, null, '', '   ']) {
    const out = await completeGPTCoach({ ...request, apiKey, fetchImpl: unused.fetchImpl });
    assert.equal(out.model, null);
    assert.equal(out.fallback, false);
    assert.deepEqual(out.failures, ['openai: API key is not configured']);
  }
  assert.equal(unused.calls.length, 0);
  const mock = transport(response({ error: { message: `Invalid key ${KEY}` } }, 401));
  const out = await completeGPTCoach({ ...request, fetchImpl: mock.fetchImpl });
  assert.equal(mock.calls.length, 1);
  assert.equal(out.refusal, false, 'authentication failure is not a model refusal');
  assert.deepEqual(out.failures, ['gpt-6-astra: HTTP 401']);
  assert.doesNotMatch(JSON.stringify(out), /Invalid key|test-placeholder-key/);
});

test('a refusal is final even when answer text is also present or the response is an HTTP error', async () => {
  const refused = [
    [reply('Do not show partial text.', 'content_filter')],
    [reply('Do not show partial text.', 'stop', { refusal: 'Cannot help with that.' })],
    [reply([{ type: 'text', text: 'Partial' }, { type: 'refusal', refusal: 'Declined.' }])],
    [{ error: { code: 'content_policy_violation', message: 'Declined.' } }, 400],
  ];
  for (const [data, status] of refused) {
    const mock = transport(response(data, status));
    const out = await completeGPTCoach({ ...request, fetchImpl: mock.fetchImpl });
    assert.equal(out.refusal, true);
    assert.equal(out.text, '');
    assert.equal(out.fallback, false);
    assert.equal(mock.calls.length, 1);
    assert.deepEqual(out.failures, []);
  }
});

test('401 is final from response headers even if its error body would never complete', async () => {
  let bodyReads = 0;
  const mock = transport(() => ({
    ok: false, status: 401,
    json: () => { bodyReads++; return new Promise(() => {}); },
  }));
  const out = await completeGPTCoach({ ...request, timeoutMs: 10, fetchImpl: mock.fetchImpl });
  assert.equal(mock.calls.length, 1);
  assert.equal(bodyReads, 0);
  assert.equal(mock.calls[0].options.signal.aborted, true);
  assert.equal(out.fallback, false);
  assert.deepEqual(out.failures, ['gpt-6-astra: HTTP 401']);
});

test('a refusal from Sol remains final and preserves the preceding service failure', async () => {
  const mock = transport(response(reply('')), response(reply(null, 'stop', { refusal: 'Declined.' })));
  const out = await completeGPTCoach({ ...request, fetchImpl: mock.fetchImpl });
  assert.equal(out.refusal, true);
  assert.equal(out.model, 'gpt-5.6-sol');
  assert.equal(out.fallback, true);
  assert.deepEqual(out.failures, ['gpt-6-astra: empty answer']);
});

test('nonempty truncated text is returned as truncated without another model call', async () => {
  const mock = transport(response(reply('Partial explanation', 'length')));
  const out = await completeGPTCoach({ ...request, fetchImpl: mock.fetchImpl });
  assert.equal(out.text, 'Partial explanation');
  assert.equal(out.truncated, true);
  assert.equal(out.fallback, false);
  assert.equal(mock.calls.length, 1);
});

test('empty, malformed, and reasoning-only responses try Sol without fabricating text', async () => {
  const emptyReplies = [
    response(reply('   ')), response(reply(null)), response(reply({ unexpected: 'object' })),
    response({ choices: [] }), response(reply(null, 'length')),
    new Response('not JSON', { status: 200 }),
  ];
  for (const empty of emptyReplies) {
    const mock = transport(empty, response(reply('Recovered.')));
    const out = await completeGPTCoach({ ...request, fetchImpl: mock.fetchImpl });
    assert.equal(out.text, 'Recovered.');
    assert.equal(out.fallback, true);
    assert.equal(mock.calls.length, 2);
    assert.match(out.failures[0], /empty answer|budget spent with no answer text/);
  }
});

test('text content parts are joined while unknown parts never become answer text', async () => {
  const mock = transport(response(reply([{ type: 'text', text: 'First.' }, { type: 'unknown', text: 'Ignore.' }, { type: 'text', text: 'Second.' }])));
  const out = await completeGPTCoach({ ...request, fetchImpl: mock.fetchImpl });
  assert.equal(out.text, 'First.\nSecond.');
});

test('each model has an independent timeout including a stalled body, with no real network', async () => {
  for (const blocked of [
    () => new Promise(() => {}),
    () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }),
  ]) {
    const mock = transport(blocked, response(reply('Fallback after timeout.')));
    const out = await completeGPTCoach({ ...request, timeoutMs: 10, fetchImpl: mock.fetchImpl });
    assert.equal(out.text, 'Fallback after timeout.');
    assert.deepEqual(out.failures, ['gpt-6-astra: timed out']);
    assert.equal(mock.calls[0].options.signal.aborted, true);
    assert.equal(mock.calls[1].options.signal.aborted, false);
    assert.notEqual(mock.calls[0].options.signal, mock.calls[1].options.signal);
  }
  const both = transport(() => new Promise(() => {}), () => new Promise(() => {}));
  const failed = await completeGPTCoach({ ...request, timeoutMs: 10, fetchImpl: both.fetchImpl });
  assert.equal(failed.text, '');
  assert.deepEqual(failed.failures, ['gpt-6-astra: timed out', 'gpt-5.6-sol: timed out']);
});
