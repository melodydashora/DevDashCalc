import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coachAudioSupported, createCoachAudio } from '../public/coach-audio.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
function stream() {
  const track = { stopped: 0, onended: null, stop() { this.stopped++; } };
  return { track, getTracks: () => [track] };
}
function fixture(overrides = {}) {
  const states = [], transcripts = [], requests = [], speech = [], chunks = [];
  const streams = [], recorders = [], audios = [], created = [], revoked = [], timers = new Map();
  let timerId = 0;
  const controller = createCoachAudio({
    transcribe: async (body, options) => { requests.push({ body, options }); return { text: 'Explain this step.', model: 'gpt-4o-mini-transcribe' }; },
    synthesize: async (body, options) => { speech.push({ body, options }); return new Blob([body.text], { type: 'audio/mpeg' }); },
    getUserMedia: async () => { const media = stream(); streams.push(media); return media; },
    isTypeSupported: (type) => type === 'audio/webm;codecs=opus',
    createRecorder: (media, options) => {
      const recorder = {
        media, options, mimeType: options.mimeType, state: 'inactive', stopped: 0,
        start(timeslice) { this.timeslice = timeslice; this.state = 'recording'; },
        stop() { this.stopped++; this.state = 'inactive'; this.onstop?.(); },
        data(text = 'audio-bytes') { this.ondataavailable?.({ data: new Blob([text], { type: this.mimeType }) }); },
      };
      recorders.push(recorder); return recorder;
    },
    createAudio: () => {
      const audio = {
        src: '', played: 0, paused: 0,
        play() { this.played++; return Promise.resolve(); },
        pause() { this.paused++; },
        removeAttribute() {}, load() {},
        playing() { this.onplaying?.(); }, end() { this.onended?.(); },
      };
      audios.push(audio); return audio;
    },
    createObjectURL: (blob) => { const url = `blob:clip-${created.length + 1}`; created.push({ url, blob }); return url; },
    revokeObjectURL: (url) => revoked.push(url),
    onTranscript: (text) => { transcripts.push(text); return true; },
    onState: (state) => states.push(state),
    onChunk: (value) => chunks.push(value),
    setTimer: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimer: (id) => timers.delete(id),
    ...overrides,
  });
  return { controller, states, transcripts, requests, speech, streams, recorders, audios, chunks, created, revoked, timers };
}

test('recording support requires a supported webm or mp4 container, never ogg-only support', () => {
  assert.equal(coachAudioSupported({}), false);
  class Recorder { static isTypeSupported(type) { return type === 'audio/mp4'; } }
  const scope = { navigator: { mediaDevices: { getUserMedia() {} } }, MediaRecorder: Recorder };
  assert.equal(coachAudioSupported(scope), true);
  Recorder.isTypeSupported = (type) => type === 'audio/ogg';
  assert.equal(coachAudioSupported(scope), false);
});

test('recording starts explicitly and only Send recording transcribes through the host', async () => {
  const f = fixture();
  assert.equal(f.streams.length, 0);
  assert.equal(await f.controller.startRecording(), true);
  assert.equal(f.recorders[0].timeslice, 1000);
  assert.equal(f.recorders[0].options.mimeType, 'audio/webm;codecs=opus');
  f.recorders[0].data('first');
  f.recorders[0].data(' second');
  assert.equal(f.requests.length, 0);
  assert.equal(f.controller.finishRecording(), true);
  await tick();
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0].body, { audio: Buffer.from('first second').toString('base64'), mimeType: 'audio/webm' });
  assert.deepEqual(f.transcripts, ['Explain this step.']);
  assert.equal(f.streams[0].track.stopped, 1);
  assert.equal(f.states.at(-1).phase, 'idle');
  assert.equal(f.speech.length, 0, 'transcription never creates an independent spoken response');
  assert.equal(f.timers.size, 0);
});

test('mp4 recording is selected when the browser cannot record webm', async () => {
  const f = fixture({ isTypeSupported: (type) => type === 'audio/mp4' });
  assert.equal(await f.controller.startRecording(), true);
  f.recorders[0].data();
  f.controller.finishRecording();
  await tick();
  assert.equal(f.requests[0].body.mimeType, 'audio/mp4');
});

test('cancelling while permission is pending resolves promptly and stops the late microphone', async () => {
  const permission = deferred();
  const f = fixture({ getUserMedia: () => permission.promise });
  const starting = f.controller.startRecording();
  f.controller.cancelRecording();
  assert.equal(await starting, false);
  const late = stream();
  permission.resolve(late);
  await tick();
  assert.equal(late.track.stopped, 1);
  assert.equal(f.recorders.length, 0);
  assert.equal(f.requests.length, 0);
  assert.equal(f.states.at(-1).phase, 'idle');
});

test('cancelling transcription aborts the request and suppresses late text in a newer recording', async () => {
  const response = deferred();
  let signal;
  const f = fixture({ transcribe: (_body, options) => { signal = options.signal; return response.promise; } });
  await f.controller.startRecording();
  f.recorders[0].data();
  f.controller.finishRecording();
  await tick();
  assert.equal(f.states.at(-1).phase, 'transcribing');
  f.controller.cancelRecording();
  assert.equal(signal.aborted, true);
  await f.controller.startRecording();
  response.resolve({ text: 'A stale question.' });
  await tick();
  assert.deepEqual(f.transcripts, []);
  assert.equal(f.states.at(-1).phase, 'recording');
  f.controller.stop();
});

test('stopping at two minutes retains audio for explicit send instead of automatically submitting', async () => {
  const f = fixture();
  await f.controller.startRecording();
  f.recorders[0].data();
  const timer = [...f.timers.values()].find((value) => value.delay === 120000);
  timer.callback();
  assert.equal(f.streams[0].track.stopped, 1);
  assert.equal(f.requests.length, 0);
  assert.match(f.states.at(-1).message, /2-minute limit.*Send recording or Cancel/);
  f.controller.finishRecording();
  await tick();
  assert.deepEqual(f.transcripts, ['Explain this step.']);
});

test('recording byte limits and oversized transcripts fail without sending partial questions', async () => {
  const f = fixture();
  await f.controller.startRecording();
  f.recorders[0].ondataavailable({ data: new Blob([new Uint8Array(6 * 1024 * 1024 + 1)]) });
  assert.equal(f.states.at(-1).phase, 'error');
  assert.match(f.states.at(-1).message, /6 MB limit/);
  assert.equal(f.streams[0].track.stopped, 1);
  assert.equal(f.requests.length, 0);
  const long = fixture({ transcribe: async () => ({ text: 'x'.repeat(2001) }) });
  await long.controller.startRecording();
  long.recorders[0].data();
  long.controller.finishRecording();
  await tick();
  assert.deepEqual(long.transcripts, []);
  assert.match(long.states.at(-1).message, /question is too long/);
});

test('microphone denial, empty recording, and request timeout give safe errors and release resources', async () => {
  const denied = new Error('private diagnostic');
  denied.name = 'NotAllowedError';
  const f = fixture({ getUserMedia: async () => { throw denied; } });
  assert.equal(await f.controller.startRecording(), false);
  assert.match(f.states.at(-1).message, /Microphone access was not allowed/);
  assert.doesNotMatch(JSON.stringify(f.states), /private diagnostic/);
  const empty = fixture();
  await empty.controller.startRecording();
  empty.controller.finishRecording();
  await tick();
  assert.match(empty.states.at(-1).message, /recording was empty/);
  assert.equal(empty.streams[0].track.stopped, 1);
  const response = deferred();
  let signal;
  const stalled = fixture({ transcribe: (_body, options) => { signal = options.signal; return response.promise; } });
  await stalled.controller.startRecording();
  stalled.recorders[0].data();
  stalled.controller.finishRecording();
  await tick();
  const timer = [...stalled.timers.values()].find((value) => value.delay === 60000);
  timer.callback();
  await tick();
  assert.equal(signal.aborted, true);
  assert.equal(stalled.states.at(-1).phase, 'error');
  response.resolve({ text: 'Too late.' });
  await tick();
  assert.deepEqual(stalled.transcripts, []);
});

test('speech sends only the canonical text in ordered bounded chunks and reports actual clip playback', async () => {
  const f = fixture();
  const text = ('Use the product rule. Then simplify the expression.\n').repeat(24) + 'A final line. ';
  const speaking = f.controller.speak(text, 'cedar');
  await tick();
  assert.equal(f.chunks.filter(Boolean).length, 0, 'fetching a clip does not claim it is spoken');
  assert.equal(f.speech.length, 2, 'prefetches one future clip');
  let index = 0;
  while (f.audios[index]) {
    const audio = f.audios[index];
    audio.playing();
    const announced = f.chunks.filter(Boolean).at(-1);
    assert.equal(announced.index, index);
    assert.equal(announced.text, f.speech[index].body.text);
    audio.end();
    await tick();
    index++;
  }
  assert.equal(await speaking, true);
  assert.equal(f.speech.map((call) => call.body.text).join(''), text);
  assert.ok(f.speech.every((call) => call.body.text.length <= 400 && call.body.voice === 'cedar'));
  assert.ok(f.chunks.filter(Boolean).every((value) => value.total === index));
  assert.equal(f.chunks.at(-1), null);
  assert.equal(f.states.at(-1).phase, 'idle');
  assert.deepEqual(f.revoked, f.created.map((entry) => entry.url));
  assert.equal(f.timers.size, 0);
});

test('sentence and unicode chunking preserves every character without splitting surrogate pairs', async () => {
  const f = fixture();
  const text = ' '.repeat(3) + '数学'.repeat(198) + '𝒙'.repeat(400) + '\nEnd.  ';
  const speaking = f.controller.speak(text);
  await tick();
  let index = 0;
  while (f.audios[index]) { f.audios[index++].end(); await tick(); }
  assert.equal(await speaking, true);
  assert.equal(f.speech.map((call) => call.body.text).join(''), text);
  assert.ok(f.speech.every((call) => !/[\uD800-\uDBFF]$/.test(call.body.text) && !/^[\uDC00-\uDFFF]/.test(call.body.text)));
});

test('stopping playback aborts prefetched audio, revokes the active URL, and ignores late events', async () => {
  const next = deferred();
  const signals = [];
  let count = 0;
  const f = fixture({ synthesize: (_body, options) => {
    signals.push(options.signal);
    return ++count === 1 ? Promise.resolve(new Blob(['first'])) : next.promise;
  } });
  const speaking = f.controller.speak('A sentence. '.repeat(80));
  await tick();
  const latePlaying = f.audios[0].onplaying;
  const lateEnd = f.audios[0].onended;
  f.audios[0].playing();
  f.controller.stopPlayback();
  assert.equal(await speaking, false);
  assert.equal(signals[1].aborted, true);
  assert.equal(f.audios[0].src, '');
  assert.ok(f.audios[0].paused > 0);
  assert.deepEqual(f.revoked, [f.created[0].url]);
  const previousChunks = f.chunks.length;
  latePlaying();
  lateEnd();
  next.resolve(new Blob(['late audio']));
  await tick();
  assert.equal(f.chunks.length, previousChunks);
  assert.equal(f.created.length, 1);
  assert.equal(f.states.at(-1).phase, 'idle');
});

test('late synthesis from a stopped reply cannot play during a new reply', async () => {
  const old = deferred();
  let count = 0;
  const f = fixture({ synthesize: () => ++count === 1 ? old.promise : Promise.resolve(new Blob(['new'])) });
  const first = f.controller.speak('Old reply.');
  await tick();
  const second = f.controller.speak('New reply.');
  await tick();
  old.resolve(new Blob(['old']));
  await tick();
  assert.equal(await first, false);
  assert.equal(f.audios.length, 1);
  f.audios[0].playing();
  assert.equal(f.chunks.filter(Boolean).at(-1).text, 'New reply.');
  f.audios[0].end();
  assert.equal(await second, true);
});

test('old clip callbacks cannot advance or caption a later clip in the same reply', async () => {
  const f = fixture();
  const speaking = f.controller.speak('A sentence. '.repeat(70));
  await tick();
  const staleEnd = f.audios[0].onended;
  const stalePlaying = f.audios[0].onplaying;
  f.audios[0].end();
  await tick();
  const count = f.chunks.length;
  staleEnd();
  stalePlaying();
  await tick();
  assert.equal(f.chunks.length, count);
  assert.equal(f.audios.length, 2, 'stale ended does not complete the current clip');
  f.controller.stop();
  assert.equal(await speaking, false);
});

test('playback failure clears URLs and callbacks without exposing provider diagnostics', async () => {
  const f = fixture({ createAudio: () => ({ src: '', play: () => Promise.reject(new Error('private diagnostic')), pause() {}, load() {} }) });
  assert.equal(await f.controller.speak('A coach reply.'), false);
  assert.equal(f.states.at(-1).phase, 'error');
  assert.doesNotMatch(JSON.stringify(f.states), /private diagnostic/);
  assert.deepEqual(f.revoked, f.created.map((entry) => entry.url));
  assert.equal(f.chunks.at(-1), null);
});

test('recording stops existing playback and read-aloud never interrupts an active recording', async () => {
  const f = fixture();
  const speaking = f.controller.speak('A coach reply.');
  await tick();
  await f.controller.startRecording();
  assert.equal(await speaking, false);
  assert.equal(f.audios[0].src, '');
  assert.equal(await f.controller.speak('Another reply.'), false);
  assert.equal(f.recorders[0].state, 'recording');
  assert.match(f.states.at(-1).message, /Finish or cancel/);
  f.controller.stop();
  assert.equal(f.streams[0].track.stopped, 1);
});
