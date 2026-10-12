// Shared fallback policy. Provider transports receive one explicitly selected
// model; configuration is read from the server environment for each request.
import { resolveCoachConfig } from './coach-config.js';
import { completeGPTCoach } from './ai-coach.js';
import { completeRecordCoach } from './ai-record-coach.js';
import { createCoachMemory, COACH_MEMORY_TOOL, COACH_MEMORY_SYSTEM } from './coach-memory.js';

export function getTutorStatus(env = process.env) {
  const { providers, models, warnings, error } = resolveCoachConfig(env);
  return { available: !error && models.length > 0, providers, models,
    coach: 'Astra', warnings, ...(error ? { configurationError: error } : {}) };
}

export async function completeTutor({ system, messages, attachments, lookup, remember, memoryMessage, assertCurrent: requestGuard, env = process.env, fetchImpl = fetch }) {
  const config = resolveCoachConfig(env);
  // Writable memory exists only when the authenticated host explicitly adds
  // a saver and raw current student message alongside its owner-bound lookup.
  const memory = lookup ? createCoachMemory({ remember, message: memoryMessage }) : null;
  const failures = [];
  const skippedProviders = new Set();
  const deadline = Date.now() + config.totalTimeoutMs;
  let model = null, provider = null, attempted = 0, toolCount = 0;
  const result = extra => ({ text: '', model, provider, fallback: attempted > 1,
    refusal: false, truncated: false, recordReads: lookup?.reads || [], memoryWrites: memory?.writes || [], failures: [...failures], ...extra });
  if (config.error) return result({ failures: [`configuration: ${config.error}`] });
  if (!config.attempts.length) return result({ failures: ['No configured tutor provider is available.'] });

  for (const [index, entry] of config.attempts.entries()) {
    if (skippedProviders.has(entry.provider)) continue;
    const remaining = deadline - Date.now();
    if (remaining <= 0) { failures.push('Tutor request reached its time limit.'); break; }
    // Reserve time for every remaining configured OpenAI model.
    const remainingAttempts = config.attempts.slice(index).filter(item => !skippedProviders.has(item.provider)).length;
    const timeoutMs = Math.max(1, Math.min(config.timeoutMs, Math.floor(remaining / remainingAttempts)));
    const attemptDeadline = Date.now() + timeoutMs;
    model = entry.model; provider = entry.provider; attempted++;
    let active = true, authorizationLost = false;
    const assertCurrent = async () => {
      if (!active || Date.now() >= attemptDeadline) throw new Error('Tutor request ended.');
      let timer;
      const timeout = new Error('Tutor request ended.');
      try {
        await Promise.race([
          (async () => { if (requestGuard) await requestGuard(); if (lookup) await lookup.assertCurrent(); })(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(timeout), Math.max(1, attemptDeadline - Date.now())); }),
        ]);
      } catch (error) {
        if (error === timeout) throw timeout;
        authorizationLost = true;
        throw new Error('Student session or request context is no longer authorized.');
      } finally { clearTimeout(timer); }
      if (!active || Date.now() >= attemptDeadline) throw new Error('Tutor request ended.');
    };
    const scopedLookup = lookup ? { ...lookup, assertCurrent,
      tools: memory ? [...lookup.tools, COACH_MEMORY_TOOL] : lookup.tools,
      maxToolCalls: memory ? 10 : 8,
      async execute(name, args, options = {}) {
        await assertCurrent();
        if (options.signal?.aborted) throw new Error('Record lookup was cancelled.');
        if (memory && name === COACH_MEMORY_TOOL.name) return memory.execute(name, args, { ...options, assertCurrent });
        if (toolCount >= 8) return { state: 'lookup_limit', message: 'The record lookup limit was reached. Use the available context and disclose unread records.' };
        toolCount++;
        const value = await lookup.execute(name, args, options);
        await assertCurrent();
        return value;
      },
    } : undefined;
    try {
      await assertCurrent();
      const options = { apiKey: entry.apiKey, model, models: [model], system: memory ? `${system}\n${COACH_MEMORY_SYSTEM}` : system, messages, attachments,
        lookup: scopedLookup, fetchImpl, timeoutMs: Math.max(1, attemptDeadline - Date.now()) };
      const out = lookup ? await completeRecordCoach(options) : await completeGPTCoach(options);
      failures.push(...(out.failures || []));
      if (authorizationLost || out.failureKind === 'authorization') return result({ failureKind: 'authorization' });
      // Refusals are final across model fallbacks. They are not service outages.
      if (out.refusal) return result({ refusal: true });
      if (out.text) {
        await assertCurrent();
        return result({ text: out.text, truncated: Boolean(out.truncated) });
      }
      // A rejected key cannot be repaired by a second model at the same vendor.
      if (out.failureKind === 'authentication') skippedProviders.add(provider);
    } catch {
      failures.push(`${provider}: tutor request unavailable`);
      if (authorizationLost) return result({ failureKind: 'authorization' });
    } finally { active = false; }
  }
  return result();
}
