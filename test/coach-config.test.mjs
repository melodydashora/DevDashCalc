import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCoachConfig } from '../coach-config.js';

const KEYS = { ANTHROPIC_API_KEY: 'fixture-anthropic-key-only', OPENAI_API_KEY: 'fixture-openai-key-only' };
const publicStatus = ({ providers, models, warnings, error, timeoutMs, totalTimeoutMs }) => ({ providers, models, warnings, error, timeoutMs, totalTimeoutMs });

test('default coaching uses only OpenAI Astra then Sol even when a legacy Anthropic key exists', () => {
  const config = resolveCoachConfig(KEYS);
  assert.equal(config.error, '');
  assert.deepEqual(config.providers, ['openai']);
  assert.deepEqual(config.models, ['gpt-6-astra', 'gpt-5.6-sol']);
  assert.deepEqual(config.attempts, [
    { provider: 'openai', model: 'gpt-6-astra', apiKey: KEYS.OPENAI_API_KEY },
    { provider: 'openai', model: 'gpt-5.6-sol', apiKey: KEYS.OPENAI_API_KEY },
  ]);
  assert.deepEqual(config.warnings, []);
  assert.equal(config.timeoutMs, 120000);
  assert.equal(config.totalTimeoutMs, 240000);
});

test('explicit OpenAI model settings keep exact IDs and ignore unused legacy model settings', () => {
  const config = resolveCoachConfig({ ...KEYS,
    TUTOR_MODEL_ANTHROPIC: '', TUTOR_MODEL_ANTHROPIC_FALLBACK: 'claude-opus-5',
    TUTOR_MODEL_OPENAI: '  gpt-future.1  ', TUTOR_MODEL_OPENAI_FALLBACK: 'ft:gpt-future:school:custom',
  });
  assert.equal(config.error, '');
  assert.deepEqual(config.models, ['gpt-future.1', 'ft:gpt-future:school:custom']);
});

test('an explicitly blank fallback disables it while a blank primary fails closed', () => {
  const config = resolveCoachConfig({ ...KEYS, TUTOR_MODEL_OPENAI_FALLBACK: ' \t ' });
  assert.equal(config.error, '');
  assert.deepEqual(config.models, ['gpt-6-astra']);
  const invalid = resolveCoachConfig({ ...KEYS, TUTOR_MODEL_OPENAI: '' });
  assert.match(invalid.error, /TUTOR_MODEL_OPENAI/);
  assert.deepEqual(invalid.attempts, []);
});

test('repeated OpenAI names and identical fallback models do not repeat attempts', () => {
  const config = resolveCoachConfig({ ...KEYS, TUTOR_PROVIDERS: ' OpenAI, openai ', TUTOR_MODEL_OPENAI_FALLBACK: 'gpt-6-astra' });
  assert.equal(config.error, '');
  assert.deepEqual(config.providers, ['openai']);
  assert.deepEqual(config.models, ['gpt-6-astra']);
});

test('Anthropic and other unsupported provider selections fail with an actionable safe error', () => {
  for (const value of ['', 'anthropic', 'anthropic,openai', 'openai,anthropic', 'gemini', 'openai,,openai', 'secret-provider-canary', 'constructor', null]) {
    const config = resolveCoachConfig({ ...KEYS, TUTOR_PROVIDERS: value, GEMINI_API_KEY: 'fixture-gemini-key-only' });
    assert.match(config.error, /openai/i);
    assert.deepEqual(config.attempts, []);
    assert.deepEqual(config.providers, []);
    assert.deepEqual(config.models, []);
    assert.doesNotMatch(JSON.stringify(publicStatus(config)), /fixture-|secret-provider-canary/);
  }
  const ignored = resolveCoachConfig({ ...KEYS, GEMINI_API_KEY: 'fixture-gemini-key-only', GOOGLE_API_KEY: 'fixture-google-key-only', TUTOR_MODEL_GEMINI: 'gemini-future' });
  assert.equal(ignored.error, '');
  assert.deepEqual(ignored.providers, ['openai']);
});

test('one OpenAI key is sufficient and non-OpenAI keys never enable coaching', () => {
  const config = resolveCoachConfig({ OPENAI_API_KEY: ` ${KEYS.OPENAI_API_KEY} ` });
  assert.equal(config.error, '');
  assert.deepEqual(config.providers, ['openai']);
  assert.deepEqual(config.models, ['gpt-6-astra', 'gpt-5.6-sol']);
  assert.equal(config.attempts[0].apiKey, KEYS.OPENAI_API_KEY);
  assert.deepEqual(config.warnings, []);
  for (const env of [{}, { ANTHROPIC_API_KEY: KEYS.ANTHROPIC_API_KEY }, { GEMINI_API_KEY: 'fixture-gemini-key-only' }, { OPENAI_API_KEY: ' ' }]) {
    const empty = resolveCoachConfig(env);
    assert.equal(empty.error, '');
    assert.deepEqual(empty.attempts, []);
    assert.deepEqual(empty.providers, []);
    assert.equal(empty.warnings.length, 1);
    assert.match(empty.warnings[0], /OPENAI_API_KEY.*skipped/);
  }
  assert.doesNotMatch(JSON.stringify(publicStatus(config)), /fixture-openai-key-only/);
});

test('invalid model values and incompatible provider families fail without leaking input', () => {
  for (const model of ['', 'has spaces', 'https://private.invalid/model', 'bad/model', 'bad\nmodel', 'm'.repeat(101), 'é-model', ':', null]) {
    const config = resolveCoachConfig({ ...KEYS, TUTOR_MODEL_OPENAI: model });
    assert.match(config.error, /TUTOR_MODEL_OPENAI/);
    assert.deepEqual(config.attempts, []);
    assert.doesNotMatch(JSON.stringify(publicStatus(config)), /private\.invalid|bad\/model|fixture-/);
  }
  for (const model of ['sora', 'sora-2', 'dall-e-3', 'tts-1', 'whisper-1', 'embedding-1', 'text-embedding-3-large', 'gpt-image-1', 'gpt-audio', 'gpt-realtime', 'omni-moderation-latest', 'claude-fable-5-1', 'claude-opus-5', 'gemini-3.7-flash']) {
    assert.ok(resolveCoachConfig({ ...KEYS, TUTOR_MODEL_OPENAI: model }).error, model);
  }
  assert.ok(resolveCoachConfig({ ...KEYS, TUTOR_MODEL_OPENAI_FALLBACK: 'sora-2' }).error);
  for (const key of Object.values(KEYS)) {
    const pastedKey = resolveCoachConfig({ ...KEYS, TUTOR_MODEL_OPENAI: key });
    assert.ok(pastedKey.error);
    assert.doesNotMatch(JSON.stringify(publicStatus(pastedKey)), /fixture-(?:anthropic|openai)-key-only/);
  }
});

test('timeout settings honor boundaries and reject blank, fractional, or out-of-range overrides', () => {
  for (const [timeout, total] of [['1000', '1000'], ['120000', '480000'], [' 30000 ', '90000']]) {
    const config = resolveCoachConfig({ ...KEYS, TUTOR_TIMEOUT_MS: timeout, TUTOR_TOTAL_TIMEOUT_MS: total });
    assert.equal(config.error, '');
    assert.equal(config.timeoutMs, Number(timeout));
    assert.equal(config.totalTimeoutMs, Number(total));
  }
  for (const [name, values] of [
    ['TUTOR_TIMEOUT_MS', ['', '999', '120001', '1.5', '1e3', 'private-timeout-canary', undefined]],
    ['TUTOR_TOTAL_TIMEOUT_MS', ['', '999', '480001', 'Infinity', null]],
  ]) for (const value of values) {
    const config = resolveCoachConfig({ ...KEYS, [name]: value });
    assert.match(config.error, new RegExp(name));
    assert.deepEqual(config.attempts, []);
    assert.doesNotMatch(config.error, /private-timeout-canary/);
  }
});

test('resolution neither mutates its environment nor caches earlier model settings', () => {
  const supplied = Object.freeze({ ...KEYS, TUTOR_PROVIDERS: 'openai', TUTOR_MODEL_OPENAI: 'gpt-first' });
  const before = JSON.stringify(supplied);
  const first = resolveCoachConfig(supplied);
  const second = resolveCoachConfig({ ...supplied, TUTOR_MODEL_OPENAI: 'gpt-next', TUTOR_MODEL_OPENAI_FALLBACK: '' });
  assert.equal(first.models[0], 'gpt-first');
  assert.deepEqual(second.models, ['gpt-next']);
  assert.equal(JSON.stringify(supplied), before);
  assert.doesNotMatch(JSON.stringify(publicStatus(first)), /fixture-(?:anthropic|openai)-key-only/);
  for (const invalid of [null, [], 'invalid']) assert.ok(resolveCoachConfig(invalid).error);
});
