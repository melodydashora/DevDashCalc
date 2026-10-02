// Audio input is transcribed into the ordinary Coach request. Speech only reads
// the text that the canonical Coach already returned. No conversational model,
// additional reasoning, student-record access, or audio archive lives here.
export const SPEECH_MODEL = 'gpt-4o-mini-tts';
export const TRANSCRIPTION_MODEL = 'gpt-transcribe';
export const COACH_VOICES = Object.freeze(['marin', 'cedar']);
export const MAX_RECORDING_BYTES = 6 * 1024 * 1024;
const SPEECH_MODELS = new Set([SPEECH_MODEL, 'gpt-4o-mini-tts-2025-12-15']);
const TRANSCRIPTION_MODELS = new Set([TRANSCRIPTION_MODEL, 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe']);
const AUDIO_TYPES = { 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' };
const MAX_AUDIO_RESPONSE_BYTES = 4 * 1024 * 1024;
const WINDOW_MS = 60_000;

export class CoachAudioError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'CoachAudioError';
    this.status = status;
    this.code = code;
  }
}

function configuration(env) {
  const speechModel = env.OPENAI_SPEECH_MODEL === undefined ? SPEECH_MODEL : String(env.OPENAI_SPEECH_MODEL).trim();
  const transcriptionModel = env.OPENAI_TRANSCRIBE_MODEL === undefined ? TRANSCRIPTION_MODEL : String(env.OPENAI_TRANSCRIBE_MODEL).trim();
  let error;
  if (!SPEECH_MODELS.has(speechModel)) error = 'OPENAI_SPEECH_MODEL must name a supported speech model.';
  else if (!TRANSCRIPTION_MODELS.has(transcriptionModel)) error = 'OPENAI_TRANSCRIBE_MODEL must name a supported transcription model.';
  const apiKey = typeof env.OPENAI_API_KEY === 'string' ? env.OPENAI_API_KEY.trim() : '';
  if (!error && !apiKey) error = 'Coach audio needs an OpenAI API key on the server.';
  return { speechModel: SPEECH_MODELS.has(speechModel) ? speechModel : null,
    transcriptionModel: TRANSCRIPTION_MODELS.has(transcriptionModel) ? transcriptionModel : null, apiKey, error };
}

export function getCoachAudioStatus(env = process.env) {
  const config = configuration(env);
  return { available: !config.error, voices: [...COACH_VOICES], speechModel: config.speechModel,
    transcriptionModel: config.transcriptionModel, ...(config.error ? { error: config.error } : {}) };
}

function recording(audio, suppliedType) {
  const mimeType = typeof suppliedType === 'string' ? suppliedType.split(';')[0].trim().toLowerCase() : '';
  if (!Object.hasOwn(AUDIO_TYPES, mimeType)) throw new CoachAudioError(400, 'audio-format', 'Record audio as WebM, MP4, MP3, or WAV.');
  if (typeof audio !== 'string' || !audio.length || audio.length > Math.ceil(MAX_RECORDING_BYTES * 4 / 3)
    || audio.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) {
    throw new CoachAudioError(400, 'audio-recording', 'Provide an audio recording of up to 6 MiB.');
  }
  const bytes = Buffer.from(audio, 'base64');
  if (!bytes.length || bytes.length > MAX_RECORDING_BYTES || bytes.toString('base64') !== audio) {
    throw new CoachAudioError(400, 'audio-recording', 'Provide an audio recording of up to 6 MiB.');
  }
  return { bytes, mimeType, extension: AUDIO_TYPES[mimeType] };
}

function invalidResponse() {
  return new CoachAudioError(502, 'audio-response', 'The audio service returned an invalid response. Try again.');
}

async function readBounded(response, limit, signal) {
  if (!response.body?.getReader) throw invalidResponse();
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw invalidResponse();
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
  }
}

export function createCoachAudioService({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 30_000 } = {}) {
  const recent = new Map();
  let pending = 0;

  function claim(scope, operation) {
    const time = now();
    for (const [id, entry] of recent) {
      for (const kind of ['speech', 'transcribe']) entry[kind] = entry[kind].filter(at => time - at < WINDOW_MS);
      if (!entry.pending && !entry.speech.length && !entry.transcribe.length) recent.delete(id);
    }
    const entry = recent.get(scope) || { speech: [], transcribe: [], pending: 0 };
    if (entry.pending >= 2 || entry[operation].length >= (operation === 'speech' ? 30 : 6)) {
      throw new CoachAudioError(429, 'audio-rate-limit', 'Coach audio has received several requests. Wait one minute before trying again.');
    }
    if (pending >= 64 || (!recent.has(scope) && recent.size >= 2000)) throw new CoachAudioError(503, 'audio-busy', 'Coach audio is busy. Try again shortly.');
    entry.pending++;
    entry[operation].push(time);
    recent.set(scope, entry);
    pending++;
    return () => { entry.pending--; pending--; };
  }

  async function run(operation, { scope, assertCurrent, signal }, build, decode) {
    if (typeof scope !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(scope) || typeof assertCurrent !== 'function') {
      throw new CoachAudioError(401, 'authentication_required', 'Sign in again to use coach audio.');
    }
    const config = configuration(env);
    if (config.error) throw new CoachAudioError(503, 'audio-unavailable', config.error);
    const release = claim(scope, operation), controller = new AbortController();
    let timer, currentResponse, abortReject;
    const cancelled = new CoachAudioError(409, 'audio-cancelled', 'The audio request was canceled.');
    const abort = () => { controller.abort(); abortReject?.(cancelled); };
    const check = async () => {
      if (controller.signal.aborted || signal?.aborted) throw cancelled;
      try { await assertCurrent(); }
      catch { throw new CoachAudioError(401, 'authentication_required', 'Sign in again to use coach audio.'); }
      if (controller.signal.aborted || signal?.aborted) throw cancelled;
    };
    const deadline = new Promise((_, reject) => {
      abortReject = reject;
      timer = setTimeout(() => {
        controller.abort();
        reject(new CoachAudioError(504, 'audio-timeout', 'The audio service did not reply in time. Try again.'));
      }, Math.max(1, Math.min(30_000, timeoutMs)));
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const perform = async () => {
      try {
        await check();
        const { url, body, headers } = build(config);
        currentResponse = await fetchImpl(url, { method: 'POST', headers: { authorization: `Bearer ${config.apiKey}`, ...headers }, body, signal: controller.signal });
        if (!currentResponse.ok) {
          throw new CoachAudioError(currentResponse.status === 429 ? 503 : 502, 'audio-provider', 'The audio service could not complete this request. Try again later.');
        }
        await check();
        const result = await decode(currentResponse, config, controller.signal);
        await check();
        return result;
      } catch (error) {
        controller.abort();
        void currentResponse?.body?.cancel().catch(() => {});
        if (error instanceof CoachAudioError) throw error;
        throw new CoachAudioError(502, 'audio-provider', 'The audio service could not complete this request. Try again later.');
      }
    };
    try { return await Promise.race([perform(), deadline]); }
    catch (error) {
      controller.abort();
      void currentResponse?.body?.cancel().catch(() => {});
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      release();
    }
  }

  async function speech({ text, voice = COACH_VOICES[0], ...owned } = {}) {
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new CoachAudioError(400, 'audio-text', 'Read aloud accepts 1 to 2000 characters at a time.');
    if (!COACH_VOICES.includes(voice)) throw new CoachAudioError(400, 'audio-voice', 'Choose Marin or Cedar for read aloud.');
    return run('speech', owned, config => ({
      url: 'https://api.openai.com/v1/audio/speech', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.speechModel, input: text, voice, response_format: 'mp3',
        instructions: 'Read the supplied text clearly and faithfully. Do not add, answer, summarize, paraphrase, or change the text.' }),
    }), async (response, config, signal) => {
      const type = (response.headers?.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!['audio/mpeg', 'audio/mp3', 'application/octet-stream'].includes(type)) throw invalidResponse();
      const audio = await readBounded(response, MAX_AUDIO_RESPONSE_BYTES, signal);
      const mp3 = audio.length >= 3 && (audio.subarray(0, 3).toString('ascii') === 'ID3' || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0));
      if (!mp3) throw invalidResponse();
      return { audio, model: config.speechModel, voice };
    });
  }

  async function transcribe({ audio, mimeType, ...owned } = {}) {
    const input = recording(audio, mimeType);
    return run('transcribe', owned, config => {
      const body = new FormData();
      body.set('model', config.transcriptionModel);
      body.set('response_format', 'json');
      body.set('file', new Blob([input.bytes], { type: input.mimeType }), `question.${input.extension}`);
      return { url: 'https://api.openai.com/v1/audio/transcriptions', body };
    }, async (response, config, signal) => {
      const bytes = await readBounded(response, 64_000, signal);
      let result;
      try { result = JSON.parse(bytes.toString('utf8')); } catch { throw invalidResponse(); }
      if (typeof result?.text !== 'string') throw invalidResponse();
      const text = result.text.trim();
      if (!text) throw new CoachAudioError(422, 'audio-empty', 'No speech was recognized. Record your question again or type it.');
      if (text.length > 2000) throw new CoachAudioError(422, 'audio-too-long', 'That recording contains more than 2000 characters. Record a shorter question or type it.');
      return { text, model: config.transcriptionModel };
    });
  }

  return { status: () => getCoachAudioStatus(env), speech, transcribe };
}
