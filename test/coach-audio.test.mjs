import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCoachAudioService, getCoachAudioStatus, SPEECH_MODEL, TRANSCRIPTION_MODEL, CoachAudioError, MAX_RECORDING_BYTES } from '../coach-audio.js';

const KEY = 'fixture-openai-key-do-not-disclose';
const MP3 = Buffer.from('ID3\x04\x00\x00\x00fixture-audio', 'binary');
const owned = { scope: 'workspace-fixture', assertCurrent: async () => {} };
const speechRequest = { ...owned, text: '  The derivative of x squared is 2x.\n', voice: 'marin' };
const transcriptionRequest = { ...owned, audio: Buffer.from('fixture-recording').toString('base64'), mimeType: 'audio/webm;codecs=opus' };
const audioResponse = () => new Response(MP3, { headers: { 'content-type': 'audio/mpeg' } });
const transcriptResponse = (text = 'Explain this step.') => new Response(JSON.stringify({ text, private_metadata: KEY }), { headers: { 'content-type': 'application/json' } });
function fixture(options = {}) {
  const calls = [];
  const service = createCoachAudioService({ env: { OPENAI_API_KEY: KEY }, ...options,
    fetchImpl: async (url, init) => { calls.push({ url, init }); return options.fetchImpl ? options.fetchImpl(url, init) : url.endsWith('/speech') ? audioResponse() : transcriptResponse(); },
  });
  return { service, calls };
}
function isSafeError(status, code) {
  return error => {
    assert.ok(error instanceof CoachAudioError);
    assert.equal(error.status, status);
    if (code) assert.equal(error.code, code);
    assert.doesNotMatch(error.message, /fixture-openai-key|RAW_PROVIDER_ERROR|private-account/);
    return true;
  };
}

test('audio status exposes only availability and supported model and voice names', () => {
  const ready = getCoachAudioStatus({ OPENAI_API_KEY: KEY, UNRELATED_SECRET: 'private-account' });
  assert.deepEqual(ready, { available: true, speechModel: 'gpt-4o-mini-tts', transcriptionModel: 'gpt-transcribe', voices: ['marin', 'cedar'] });
  assert.doesNotMatch(JSON.stringify(ready), /fixture-openai-key|private-account|apiKey/);
  for (const key of [undefined, '', '  ']) {
    assert.equal(getCoachAudioStatus({ OPENAI_API_KEY: key }).available, false);
    assert.match(getCoachAudioStatus({ OPENAI_API_KEY: key }).error, /API key/);
  }
  const custom = getCoachAudioStatus({ OPENAI_API_KEY: KEY, OPENAI_SPEECH_MODEL: ' gpt-4o-mini-tts-2025-12-15 ', OPENAI_TRANSCRIBE_MODEL: 'gpt-4o-mini-transcribe' });
  assert.equal(custom.available, true);
  assert.equal(custom.speechModel, 'gpt-4o-mini-tts-2025-12-15');
  assert.equal(custom.transcriptionModel, 'gpt-4o-mini-transcribe');
  for (const [setting, model] of [['OPENAI_SPEECH_MODEL', ''], ['OPENAI_SPEECH_MODEL', 'gpt-live-1'], ['OPENAI_TRANSCRIBE_MODEL', ' '], ['OPENAI_TRANSCRIBE_MODEL', 'RAW_PROVIDER_ERROR']]) {
    const result = getCoachAudioStatus({ OPENAI_API_KEY: KEY, [setting]: model });
    assert.equal(result.available, false);
    assert.match(result.error, new RegExp(setting));
    assert.doesNotMatch(result.error, /RAW_PROVIDER_ERROR/);
  }
});

test('speech reads the exact supplied text through the speech endpoint without another conversation', async () => {
  let ownershipChecks = 0;
  const { service, calls } = fixture();
  const result = await service.speech({ ...speechRequest, voice: 'cedar', assertCurrent: async () => { ownershipChecks++; } });
  assert.deepEqual(result, { audio: MP3, model: SPEECH_MODEL, voice: 'cedar' });
  assert.equal(ownershipChecks, 3);
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, 'https://api.openai.com/v1/audio/speech');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.authorization, `Bearer ${KEY}`);
  assert.equal(init.headers['content-type'], 'application/json');
  const body = JSON.parse(init.body);
  assert.equal(body.input, speechRequest.text, 'preserve every character, including leading space and line breaks');
  assert.equal(body.model, SPEECH_MODEL);
  assert.equal(body.voice, 'cedar');
  assert.equal(body.response_format, 'mp3');
  assert.match(body.instructions, /Do not add, answer, summarize, paraphrase, or change/);
  assert.deepEqual(Object.keys(body).sort(), ['input', 'instructions', 'model', 'response_format', 'voice']);
  assert.doesNotMatch(init.body, /fixture-openai-key|workspace-fixture/);
});

test('transcription uploads only the bounded recording and safely projects its text', async () => {
  const { service, calls } = fixture();
  const result = await service.transcribe(transcriptionRequest);
  assert.deepEqual(result, { text: 'Explain this step.', model: TRANSCRIPTION_MODEL });
  assert.doesNotMatch(JSON.stringify(result), /fixture-openai-key|private_metadata/);
  const { url, init } = calls[0];
  assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(init.headers.authorization, `Bearer ${KEY}`);
  assert.equal(init.headers['content-type'], undefined, 'fetch sets the multipart boundary');
  assert.ok(init.body instanceof FormData);
  assert.deepEqual([...init.body.keys()], ['model', 'response_format', 'file']);
  assert.equal(init.body.get('model'), TRANSCRIPTION_MODEL);
  assert.equal(init.body.get('response_format'), 'json');
  const file = init.body.get('file');
  assert.equal(file.type, 'audio/webm');
  assert.equal(file.name, 'question.webm');
  assert.equal(Buffer.from(await file.arrayBuffer()).toString('base64'), transcriptionRequest.audio);
});

test('unsupported voices, speech text, recordings and formats never reach OpenAI', async () => {
  const { service, calls } = fixture();
  for (const text of [null, '', '  ', {}, 'x'.repeat(2001)]) await assert.rejects(service.speech({ ...speechRequest, text }), isSafeError(400, 'audio-text'));
  for (const voice of ['unsupported', 'Marin', '', null, {}]) await assert.rejects(service.speech({ ...speechRequest, voice }), isSafeError(400, 'audio-voice'));
  for (const audio of [null, '', {}, 'not base64', 'YQ', 'YQ===', 'YR==', 'a'.repeat(Math.ceil(MAX_RECORDING_BYTES * 4 / 3) + 4)]) {
    await assert.rejects(service.transcribe({ ...transcriptionRequest, audio }), isSafeError(400, 'audio-recording'));
  }
  for (const mimeType of [undefined, 'video/webm', 'audio/ogg', 'text/html', {}]) await assert.rejects(service.transcribe({ ...transcriptionRequest, mimeType }), isSafeError(400, 'audio-format'));
  assert.equal(calls.length, 0);
});

test('supported recording MIME types use fixed safe filenames', async () => {
  const { service, calls } = fixture();
  for (const [mimeType, extension] of [['audio/webm', 'webm'], ['audio/mp4;codecs=mp4a.40.2', 'mp4'], ['audio/mpeg', 'mp3'], ['audio/wav', 'wav']]) {
    await service.transcribe({ ...transcriptionRequest, mimeType });
    assert.equal(calls.at(-1).init.body.get('file').name, `question.${extension}`);
  }
});

test('missing credentials and invalid explicit models fail without a provider request', async () => {
  for (const env of [{}, { OPENAI_API_KEY: KEY, OPENAI_SPEECH_MODEL: ' ' }, { OPENAI_API_KEY: KEY, OPENAI_TRANSCRIBE_MODEL: 'unknown' }]) {
    const { service, calls } = fixture({ env });
    await assert.rejects(service.speech(speechRequest), isSafeError(503, 'audio-unavailable'));
    await assert.rejects(service.transcribe(transcriptionRequest), isSafeError(503, 'audio-unavailable'));
    assert.equal(calls.length, 0);
  }
});

test('missing or invalidated ownership cannot initiate a paid audio request', async () => {
  const { service, calls } = fixture();
  for (const scope of [undefined, '../private-account']) await assert.rejects(service.speech({ ...speechRequest, scope }), isSafeError(401));
  await assert.rejects(service.speech({ ...speechRequest, assertCurrent: undefined }), isSafeError(401));
  await assert.rejects(service.transcribe({ ...transcriptionRequest, assertCurrent: async () => { throw new Error('private-account'); } }), isSafeError(401));
  assert.equal(calls.length, 0);
});

test('provider failures never expose raw errors and do not consume error bodies', async () => {
  for (const operation of ['speech', 'transcribe']) {
    for (const status of [400, 401, 403, 429, 500, 503]) {
      let bodyRead = false;
      const { service } = fixture({ fetchImpl: async () => ({ ok: false, status, body: { getReader: () => { bodyRead = true; }, cancel: async () => {} } }) });
      await assert.rejects(service[operation](operation === 'speech' ? speechRequest : transcriptionRequest), isSafeError(status === 429 ? 503 : 502, 'audio-provider'));
      assert.equal(bodyRead, false);
    }
    const { service } = fixture({ fetchImpl: async () => { throw new Error(`RAW_PROVIDER_ERROR ${KEY}`); } });
    await assert.rejects(service[operation](operation === 'speech' ? speechRequest : transcriptionRequest), isSafeError(502, 'audio-provider'));
  }
});

test('malformed, empty, wrong-type, and oversized provider replies are safely rejected', async () => {
  for (const buildResponse of [
    () => new Response('', { headers: { 'content-type': 'audio/mpeg' } }),
    () => new Response(`RAW_PROVIDER_ERROR ${KEY}`, { headers: { 'content-type': 'application/json' } }),
    () => new Response(`RAW_PROVIDER_ERROR ${KEY}`, { headers: { 'content-type': 'audio/mpeg' } }),
    () => new Response(Buffer.alloc(4 * 1024 * 1024 + 1), { headers: { 'content-type': 'audio/mpeg' } }),
  ]) {
    const { service } = fixture({ fetchImpl: async () => buildResponse() });
    await assert.rejects(service.speech(speechRequest), isSafeError(502, 'audio-response'));
  }
  for (const body of ['', `RAW_PROVIDER_ERROR ${KEY}`, '{}', JSON.stringify({ text: null }), 'x'.repeat(64_001)]) {
    const { service } = fixture({ fetchImpl: async () => new Response(body) });
    await assert.rejects(service.transcribe(transcriptionRequest), isSafeError(502, 'audio-response'));
  }
});

test('empty speech and overlong transcripts receive explicit errors without silent truncation', async () => {
  for (const [text, code] of [['   ', 'audio-empty'], ['x'.repeat(2001), 'audio-too-long']]) {
    const { service } = fixture({ fetchImpl: async () => transcriptResponse(text) });
    await assert.rejects(service.transcribe(transcriptionRequest), isSafeError(422, code));
  }
});

test('late authorization loss suppresses both generated audio and transcribed text', async () => {
  for (const operation of ['speech', 'transcribe']) {
    for (const invalidAt of [2, 3]) {
      let checks = 0;
      const { service } = fixture();
      const request = operation === 'speech' ? speechRequest : transcriptionRequest;
      await assert.rejects(service[operation]({ ...request, assertCurrent: async () => {
        if (++checks === invalidAt) throw new Error('private-account session was revoked');
      } }), isSafeError(401, 'authentication_required'));
      assert.equal(checks, invalidAt);
    }
  }
});

test('timeouts bound uncooperative fetches and response bodies; browser cancellation aborts pending work', async () => {
  for (const operation of ['speech', 'transcribe']) {
    for (const fetchImpl of [async () => new Promise(() => {}), async () => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'audio/mpeg' } })]) {
      const { service, calls } = fixture({ timeoutMs: 10, fetchImpl });
      await assert.rejects(service[operation](operation === 'speech' ? speechRequest : transcriptionRequest), isSafeError(504, 'audio-timeout'));
      assert.equal(calls[0].init.signal.aborted, true);
    }
  }
  const { service, calls } = fixture({ fetchImpl: async () => new Promise(() => {}) });
  const controller = new AbortController();
  const pending = service.speech({ ...speechRequest, signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, isSafeError(409, 'audio-cancelled'));
  assert.equal(calls[0].init.signal.aborted, true);
});

test('per-workspace audio limits allow two pending requests and reset without sharing between students', async () => {
  const finish = [];
  const first = fixture({ fetchImpl: async () => new Promise(resolve => { finish.push(resolve); }) });
  const waiting = [first.service.speech(speechRequest), first.service.speech(speechRequest)];
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(first.service.speech(speechRequest), isSafeError(429));
  finish.forEach(resolve => resolve(audioResponse()));
  await Promise.all(waiting);
  let time = 100_000;
  const { service, calls } = fixture({ now: () => time });
  for (let i = 0; i < 6; i++) await service.transcribe(transcriptionRequest);
  await assert.rejects(service.transcribe(transcriptionRequest), isSafeError(429));
  for (let i = 0; i < 30; i++) await service.speech(speechRequest);
  await assert.rejects(service.speech(speechRequest), isSafeError(429));
  await service.transcribe({ ...transcriptionRequest, scope: 'workspace-other' });
  time += 60_001;
  await service.transcribe(transcriptionRequest);
  assert.equal(calls.length, 38);
});
