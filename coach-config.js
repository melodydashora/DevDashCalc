// Resolve each request from its supplied environment. No dotenv loader or
// process.env assignment can override deployment Secrets here.
// attempts contains private API keys; only providers/models/warnings/error
// and timeout values belong in status responses or diagnostics.
const PROVIDERS = Object.freeze({
  anthropic: Object.freeze({ key: 'ANTHROPIC_API_KEY', primary: 'TUTOR_MODEL_ANTHROPIC', fallback: 'TUTOR_MODEL_ANTHROPIC_FALLBACK',
    primaryDefault: 'claude-fable-5-1', fallbackDefault: 'claude-opus-5' }),
  openai: Object.freeze({ key: 'OPENAI_API_KEY', primary: 'TUTOR_MODEL_OPENAI', fallback: 'TUTOR_MODEL_OPENAI_FALLBACK',
    primaryDefault: 'gpt-6-astra', fallbackDefault: 'gpt-5.6-sol' }),
});
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const NON_TUTOR_MODEL = /^(?:sora|dall[-_]?e|tts|whisper|(?:text[-_])?embeddings?|gpt-image|gpt-audio|gpt-realtime|(?:omni|text)-moderation)(?:$|[-_.:])/i;

function compatibleModel(provider, model) {
  if (!MODEL_ID.test(model) || NON_TUTOR_MODEL.test(model)) return false;
  if (provider === 'openai') return !/^(?:claude|gemini)(?:$|[-_.:])/i.test(model);
  return !/^(?:gpt|chatgpt|gemini|o[0-9]+)(?:$|[-_.:])/i.test(model);
}

export function resolveCoachConfig(env = process.env) {
  const result = { attempts: [], providers: [], models: [], warnings: [], error: '', timeoutMs: 120000, totalTimeoutMs: 240000 };
  const fail = message => ({ ...result, attempts: [], providers: [], models: [], error: message });
  if (!env || typeof env !== 'object' || Array.isArray(env)) return fail('Coaching configuration must be an environment object.');
  const has = name => Object.hasOwn(env, name);

  for (const [name, field, maximum] of [['TUTOR_TIMEOUT_MS', 'timeoutMs', 120000], ['TUTOR_TOTAL_TIMEOUT_MS', 'totalTimeoutMs', 480000]]) {
    if (!has(name)) continue;
    const raw = env[name];
    if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw.trim())) return fail(`${name} must be a whole number of milliseconds within the supported range.`);
    const value = Number(raw.trim());
    if (!Number.isSafeInteger(value) || value < 1000 || value > maximum) return fail(`${name} must be between 1000 and ${maximum} milliseconds.`);
    result[field] = value;
  }

  let order = ['anthropic', 'openai'];
  if (has('TUTOR_PROVIDERS')) {
    if (typeof env.TUTOR_PROVIDERS !== 'string' || !env.TUTOR_PROVIDERS.trim()) return fail('TUTOR_PROVIDERS must list anthropic, openai, or both.');
    const selected = env.TUTOR_PROVIDERS.split(',').map(value => value.trim().toLowerCase());
    if (selected.some(provider => !Object.hasOwn(PROVIDERS, provider))) return fail('TUTOR_PROVIDERS contains an unsupported provider. Only anthropic and openai are enabled.');
    order = [...new Set(selected)];
  }

  for (const provider of order) {
    const settings = PROVIDERS[provider];
    const ids = [];
    for (const [name, defaultModel, optional] of [[settings.primary, settings.primaryDefault, false], [settings.fallback, settings.fallbackDefault, true]]) {
      const raw = has(name) ? env[name] : defaultModel;
      if (typeof raw !== 'string') return fail(`${name} must contain a valid model ID.`);
      const model = raw.trim();
      if (!model && optional) continue;
      const isConfiguredKey = Object.values(PROVIDERS).some(definition => typeof env[definition.key] === 'string' && env[definition.key].trim() === model);
      if (!model || isConfiguredKey || !compatibleModel(provider, model)) return fail(`${name} must contain a compatible text or tool-capable model ID.`);
      // Keep spelling and case exact. Catalog validation belongs to the
      // provider; changing a misspelled model silently would ignore Secrets.
      if (!ids.includes(model)) ids.push(model);
    }
    const key = typeof env[settings.key] === 'string' ? env[settings.key].trim() : '';
    if (!key) {
      result.warnings.push(`${settings.key} is missing; ${provider} coaching is skipped.`);
      continue;
    }
    result.providers.push(provider);
    for (const model of ids) result.attempts.push({ provider, model, apiKey: key });
  }
  result.models = result.attempts.map(attempt => attempt.model);
  return result;
}
