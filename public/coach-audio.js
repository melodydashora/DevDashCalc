// Audio only transports a learner's recorded question and reads the canonical
// study coach's reply. It never starts a separate conversational model.
const RECORDING_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
const MAX_RECORDING_BYTES = 6 * 1024 * 1024;
const MAX_RECORDING_MS = 120000;
const MAX_MESSAGE = 2000;
const MAX_REPLY = 24000;
const REQUEST_TIMEOUT_MS = 60000;

export function coachAudioSupported(scope = globalThis) {
  return typeof scope.navigator?.mediaDevices?.getUserMedia === 'function'
    && typeof scope.MediaRecorder === 'function'
    && typeof scope.MediaRecorder.isTypeSupported === 'function'
    && RECORDING_TYPES.some((type) => scope.MediaRecorder.isTypeSupported(type));
}

function speechChunks(text) {
  const chunks = [];
  let offset = 0;
  while (offset < text.length) {
    let length = Math.min(400, text.length - offset);
    if (offset + length < text.length) {
      const candidate = text.slice(offset, offset + length);
      const sentences = [...candidate.matchAll(/[.!?](?:\s+)|\n+/g)];
      const boundary = sentences.at(-1);
      if (boundary && boundary.index + boundary[0].length >= 120) length = boundary.index + boundary[0].length;
      else {
        const spaces = [...candidate.matchAll(/\s+/g)];
        const space = spaces.at(-1);
        if (space && space.index + space[0].length >= 200) length = space.index + space[0].length;
      }
      // A chunk boundary must not split a surrogate pair.
      if (/[\uD800-\uDBFF]/.test(text[offset + length - 1])) length--;
    }
    chunks.push(text.slice(offset, offset + length));
    offset += length;
  }
  return chunks;
}

async function base64Audio(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const parts = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  }
  return btoa(parts.join(''));
}

/**
 * transcribe({audio: base64, mimeType}, {signal}) returns {text, model}.
 * synthesize({text, voice}, {signal}) returns an audio Blob.
 * onTranscript(text) sends the question through the host's canonical coach.
 * onChunk({text,index,total}) reports a clip starting, and null clears it.
 * Factories below are optional browser-independent test adapters.
 */
export function createCoachAudio({
  transcribe,
  synthesize,
  onTranscript = () => false,
  onState = () => {},
  onChunk = () => {},
  getUserMedia = globalThis.navigator?.mediaDevices?.getUserMedia?.bind(globalThis.navigator.mediaDevices),
  createRecorder = typeof globalThis.MediaRecorder === 'function' ? (stream, options) => new MediaRecorder(stream, options) : null,
  isTypeSupported = globalThis.MediaRecorder?.isTypeSupported?.bind(globalThis.MediaRecorder),
  createAudio = typeof globalThis.document?.createElement === 'function' ? () => document.createElement('audio') : null,
  createObjectURL = globalThis.URL?.createObjectURL?.bind(globalThis.URL),
  revokeObjectURL = globalThis.URL?.revokeObjectURL?.bind(globalThis.URL),
  encodeAudio = base64Audio,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timer) => clearTimeout(timer),
} = {}) {
  let recording = null;
  let playback = null;
  let recordingSerial = 0;
  let playbackSerial = 0;

  function currentRecording(run) { return recording === run && !run.closed; }
  function currentPlayback(run) { return playback === run && !run.closed; }
  function emit(phase, message) {
    const state = { phase };
    if (message) state.message = message;
    try { onState(state); } catch { /* Rendering cannot retain audio resources. */ }
  }
  function chunk(value) { try { onChunk(value); } catch { /* Captions do not control playback. */ } }
  function idle() {
    if (recording) emit(recording.phase, recording.message);
    else if (playback) emit(playback.phase);
    else emit('idle');
  }
  function stopMicrophone(run) {
    if (run.mediaStopped) return;
    run.mediaStopped = true;
    for (const track of run.media?.getTracks?.() || []) {
      track.onended = null;
      try { track.stop(); } catch { /* Already stopped. */ }
    }
  }
  function disposeRecording(run) {
    run.closed = true;
    run.controller.abort();
    clearTimer(run.timer);
    run.resolveStart(false);
    if (run.recorder) {
      run.recorder.ondataavailable = run.recorder.onstop = run.recorder.onerror = null;
      if (run.recorder.state !== 'inactive') {
        try { run.recorder.stop(); } catch { /* Already stopped. */ }
      }
    }
    stopMicrophone(run);
    run.chunks = [];
  }
  function failRecording(run, message) {
    if (!currentRecording(run)) return;
    recording = null;
    disposeRecording(run);
    emit('error', message);
  }
  function cancelRecording() {
    recordingSerial++;
    const run = recording;
    recording = null;
    if (run) disposeRecording(run);
    idle();
  }
  function releaseClip(run) {
    if (run.audio) {
      const audio = run.audio;
      audio.onplaying = audio.onended = audio.onerror = null;
      try { audio.pause(); } catch { /* Already detached. */ }
      audio.removeAttribute?.('src');
      audio.src = '';
      try { audio.load?.(); } catch { /* Already detached. */ }
      run.audio = null;
    }
    if (run.url) {
      try { revokeObjectURL(run.url); } catch { /* Already revoked. */ }
      run.url = null;
    }
  }
  function disposePlayback(run) {
    run.closed = true;
    run.controller.abort();
    run.finishClip?.(false);
    releaseClip(run);
    run.chunks = [];
  }
  function failPlayback(run, message) {
    if (!currentPlayback(run)) return;
    playback = null;
    disposePlayback(run);
    chunk(null);
    emit('error', message);
  }
  function stopPlayback() {
    playbackSerial++;
    const run = playback;
    playback = null;
    if (run) disposePlayback(run);
    chunk(null);
    idle();
  }
  function stop() {
    // Invalidate both epochs before stopping either resource.
    recordingSerial++;
    playbackSerial++;
    const capture = recording, output = playback;
    recording = playback = null;
    if (capture) disposeRecording(capture);
    if (output) disposePlayback(output);
    chunk(null);
    emit('idle');
  }
  function request(run, callback, body) {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      let settled = false;
      let timer;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        run.controller.signal.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(value);
      };
      const abort = () => { controller.abort(); finish(new Error('Audio stopped')); };
      run.controller.signal.addEventListener('abort', abort, { once: true });
      if (run.controller.signal.aborted) { abort(); return; }
      timer = setTimer(() => { controller.abort(); finish(new Error('Audio request timed out')); }, REQUEST_TIMEOUT_MS);
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new Error('Audio stopped');
        return callback(body, { signal: controller.signal });
      }).then(
        (value) => finish(null, value),
        (error) => finish(error),
      );
    });
  }
  async function transcribeRecording(run) {
    if (!currentRecording(run) || run.transcribing) return false;
    run.transcribing = true;
    run.phase = 'transcribing';
    run.message = undefined;
    clearTimer(run.timer);
    stopMicrophone(run);
    emit('transcribing');
    try {
      if (!run.bytes) {
        failRecording(run, 'The recording was empty. Please record your question again.');
        return false;
      }
      const blob = new Blob(run.chunks, { type: run.mimeType });
      run.chunks = [];
      const audio = await encodeAudio(blob);
      if (!currentRecording(run)) return false;
      const result = await request(run, transcribe, { audio, mimeType: run.mimeType });
      if (!currentRecording(run)) return false;
      if (typeof result?.text !== 'string' || !result.text.trim()) {
        failRecording(run, 'No words were found in that recording. Please try again or type your question.');
        return false;
      }
      const text = result.text.trim();
      if (text.length > MAX_MESSAGE) {
        failRecording(run, 'That question is too long to send. Please record a shorter question or type it.');
        return false;
      }
      recording = null;
      disposeRecording(run);
      idle();
      try {
        const accepted = onTranscript(text);
        Promise.resolve(accepted).then((value) => {
          if (recordingSerial === run.id && value === false) emit('error', 'The coach could not accept that question. Please try again when it is ready.');
        }, () => {
          if (recordingSerial === run.id) emit('error', 'That question could not be sent. Please try again or use text.');
        });
      } catch {
        if (recordingSerial === run.id) emit('error', 'That question could not be sent. Please try again or use text.');
      }
      return true;
    } catch {
      if (currentRecording(run)) failRecording(run, 'The recording could not be transcribed. Please try again or use text.');
      return false;
    }
  }
  function endCapture(run, send) {
    if (!currentRecording(run) || run.transcribing) return false;
    run.send = send;
    clearTimer(run.timer);
    if (run.recorderStopped) {
      if (send) void transcribeRecording(run);
      return true;
    }
    try {
      if (run.recorder?.state !== 'inactive') run.recorder.stop();
      stopMicrophone(run);
    } catch { failRecording(run, 'The recording could not be finished. Please try again or use text.'); return false; }
    return true;
  }
  async function capture(run, mimeType) {
    try {
      const media = await getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (!currentRecording(run)) { for (const track of media.getTracks()) track.stop(); return; }
      run.media = media;
      run.recorder = createRecorder(media, { mimeType });
      const actualType = (run.recorder.mimeType || mimeType).split(';')[0].toLowerCase();
      if (!['audio/webm', 'audio/mp4'].includes(actualType)) throw new Error('Unsupported recording type');
      run.mimeType = actualType;
      for (const track of media.getTracks()) track.onended = () => {
        if (currentRecording(run) && !run.mediaStopped) failRecording(run, 'Your microphone stopped. Please record your question again or use text.');
      };
      run.recorder.ondataavailable = (event) => {
        if (!currentRecording(run) || !event.data?.size) return;
        if (!Number.isFinite(event.data.size) || run.bytes + event.data.size > MAX_RECORDING_BYTES) {
          failRecording(run, 'The recording reached the 6 MB limit. Please record a shorter question.');
          return;
        }
        run.chunks.push(event.data);
        run.bytes += event.data.size;
      };
      run.recorder.onerror = () => failRecording(run, 'The microphone could not record audio. Please try again or use text.');
      run.recorder.onstop = () => {
        if (!currentRecording(run)) return;
        run.recorderStopped = true;
        stopMicrophone(run);
        if (run.send) void transcribeRecording(run);
        else {
          run.message = run.limitReached
            ? 'Recording stopped at the 2-minute limit. Select Send recording or Cancel.'
            : 'Recording stopped. Select Send recording or Cancel.';
          emit('recording', run.message);
        }
      };
      run.recorder.start(1000);
      run.phase = 'recording';
      run.timer = setTimer(() => { run.limitReached = true; endCapture(run, false); }, MAX_RECORDING_MS);
      emit('recording');
      run.resolveStart(true);
    } catch (error) {
      if (!currentRecording(run)) return;
      const denied = ['NotAllowedError', 'SecurityError'].includes(error?.name);
      const missing = ['NotFoundError', 'DevicesNotFoundError'].includes(error?.name);
      failRecording(run, denied ? 'Microphone access was not allowed. You can enable it in your browser or use text.'
        : missing ? 'No microphone is available. Connect a microphone or use text.'
          : 'Recording is unavailable. Please try again or use text.');
    }
  }
  function startRecording() {
    if (recording) return recording.started;
    stopPlayback();
    if (![transcribe, getUserMedia, createRecorder, isTypeSupported].every((value) => typeof value === 'function')) {
      emit('error', 'Recording is unavailable in this browser. You can use text.');
      return Promise.resolve(false);
    }
    const mimeType = RECORDING_TYPES.find((type) => isTypeSupported(type));
    if (!mimeType) {
      emit('error', 'This browser does not support a recording format the coach can read. You can use text.');
      return Promise.resolve(false);
    }
    const run = {
      id: ++recordingSerial, closed: false, controller: new AbortController(),
      phase: 'requesting-mic', media: null, mediaStopped: false, recorder: null,
      recorderStopped: false, chunks: [], bytes: 0, send: false, transcribing: false,
    };
    run.started = new Promise((resolve) => { run.resolveStart = resolve; });
    recording = run;
    emit('requesting-mic');
    void capture(run, mimeType);
    return run.started;
  }
  function finishRecording() {
    const run = recording;
    if (!run || run.phase !== 'recording') return false;
    return endCapture(run, true);
  }
  async function loadSpeech(run, text) {
    try {
      const blob = await request(run, synthesize, { text, voice: run.voice });
      if (!(blob instanceof Blob) || !blob.size || blob.size > 8 * 1024 * 1024) throw new Error('Invalid audio');
      return { blob };
    } catch (error) { return { error }; }
  }
  function playClip(run, blob, index) {
    return new Promise((resolve, reject) => {
      let settled = false, announced = false;
      run.finishClip = (complete) => {
        if (settled) return;
        settled = true;
        run.finishClip = null;
        resolve(complete);
      };
      const finish = run.finishClip;
      run.url = createObjectURL(blob);
      run.audio = createAudio();
      const audio = run.audio;
      audio.preload = 'auto';
      audio.src = run.url;
      audio.onplaying = () => {
        if (!currentPlayback(run) || run.audio !== audio || announced) return;
        announced = true;
        run.phase = 'speaking';
        emit('speaking');
        chunk({ text: run.chunks[index], index, total: run.chunks.length });
      };
      const failed = () => {
        if (settled) return;
        settled = true;
        run.finishClip = null;
        reject(new Error('Audio playback failed'));
      };
      audio.onended = () => { if (currentPlayback(run) && run.audio === audio) finish(true); };
      audio.onerror = failed;
      try { Promise.resolve(audio.play()).catch(failed); }
      catch { failed(); }
    });
  }
  async function playReply(run) {
    let pending = loadSpeech(run, run.chunks[0]);
    try {
      for (let index = 0; index < run.chunks.length; index++) {
        run.phase = 'loading-audio';
        emit('loading-audio');
        const result = await pending;
        if (!currentPlayback(run)) return false;
        if (result.error) throw result.error;
        // Only one future clip is prefetched, with the same abortable lifecycle.
        pending = index + 1 < run.chunks.length ? loadSpeech(run, run.chunks[index + 1]) : null;
        const complete = await playClip(run, result.blob, index);
        if (!currentPlayback(run) || !complete) return false;
        releaseClip(run);
      }
      if (!currentPlayback(run)) return false;
      playback = null;
      disposePlayback(run);
      chunk(null);
      idle();
      return true;
    } catch {
      if (currentPlayback(run)) failPlayback(run, 'The reply could not be played. You can read the coach response or try Read aloud again.');
      return false;
    }
  }
  function speak(text, voice = 'marin') {
    if (recording) {
      emit(recording.phase, 'Finish or cancel your recording before playing a reply.');
      return Promise.resolve(false);
    }
    stopPlayback();
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_REPLY) {
      emit('error', 'This reply cannot be read aloud. You can read it in the conversation.');
      return Promise.resolve(false);
    }
    if (!['marin', 'cedar'].includes(voice) || ![synthesize, createAudio, createObjectURL, revokeObjectURL].every((value) => typeof value === 'function')) {
      emit('error', 'Audio playback is unavailable. You can read the coach response.');
      return Promise.resolve(false);
    }
    const run = {
      id: ++playbackSerial, closed: false, controller: new AbortController(),
      phase: 'loading-audio', chunks: speechChunks(text), voice, audio: null, url: null, finishClip: null,
    };
    playback = run;
    return playReply(run);
  }
  return { startRecording, finishRecording, cancelRecording, speak, stopPlayback, stop };
}
