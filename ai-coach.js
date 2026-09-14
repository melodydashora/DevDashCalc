// Fixed coaching models chosen for Students4AI. Legacy provider/model environment
// variables cannot change this chain. Built-in fetch only; no SDK or dependency.
// Model capabilities: https://developers.openai.com/api/docs/models/gpt-6-astra
// and https://developers.openai.com/api/docs/models/gpt-5.6-sol
export const COACH_MODELS = Object.freeze(['gpt-6-astra', 'gpt-5.6-sol']);
export const COACH_CONFIG = Object.freeze({
  provider: 'openai', reasoningEffort: 'high', maxCompletionTokens: 16_000,
  timeoutMs: 120_000,
});
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

function responseRefused(data) {
  const choice = data?.choices?.[0];
  const message = choice?.message;
  return choice?.finish_reason === 'content_filter'
    || Boolean(typeof message?.refusal === 'string' && message.refusal.trim())
    || Boolean(Array.isArray(message?.content) && message.content.some((part) => part?.type === 'refusal'))
    || ['content_filter', 'content_policy_violation'].includes(data?.error?.code);
}

function responseText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  // Do not turn an unexpected object into a purported answer such as
  // "[object Object]". Only explicit text content parts are usable.
  if (Array.isArray(content)) return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text).join('\n').trim();
  return '';
}

async function requestModel({ apiKey, model, system, messages, fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('coach-timeout'));
    }, timeoutMs);
  });
  try {
    // Cover both response headers and the complete response body. The race
    // also bounds injected transports that do not honor AbortSignal.
    return await Promise.race([deadline, (async () => {
      const response = await fetchImpl(ENDPOINT, {
        method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model, reasoning_effort: COACH_CONFIG.reasoningEffort,
          max_completion_tokens: COACH_CONFIG.maxCompletionTokens,
          messages: [{ role: 'system', content: system }, ...messages],
        }),
      });
      // Authentication is already definitively rejected by the headers. Do
      // not let a stalled error body turn a final 401 into a timeout retry.
      if (response.status === 401) {
        controller.abort();
        return { ok: false, status: 401, data: null };
      }
      let data = null;
      try { data = await response.json(); } catch { /* HTTP status remains useful. */ }
      return { ok: response.ok, status: response.status, data };
    })()]);
  } catch {
    // Never expose fetch errors, response bodies, headers, or the key through
    // diagnostics: remote error messages can echo supplied input or secrets.
    return { failure: controller.signal.aborted ? 'timed out' : 'network request failed' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Astra first, Sol only after a service failure or unusable answer. Refusals
 * are final. A nonempty truncated answer is returned with its flag intact.
 * failures contains only locally generated, safe-to-log diagnostic strings.
 */
export async function completeGPTCoach({ apiKey, system, messages, fetchImpl = fetch, timeoutMs = COACH_CONFIG.timeoutMs } = {}) {
  const failures = [];
  let model = null, fallback = false;
  const result = (extra = {}) => ({ text: '', model, provider: 'openai', fallback, truncated: false, refusal: false, failures: [...failures], ...extra });
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    failures.push('openai: API key is not configured');
    return result();
  }
  if (typeof system !== 'string' || !Array.isArray(messages) || typeof fetchImpl !== 'function') {
    failures.push('openai: invalid coaching request');
    return result();
  }
  const budget = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : COACH_CONFIG.timeoutMs;
  for (const [index, nextModel] of COACH_MODELS.entries()) {
    model = nextModel;
    fallback = index > 0;
    const out = await requestModel({ apiKey: apiKey.trim(), model, system, messages, fetchImpl, timeoutMs: budget });
    if (out.failure) {
      failures.push(`${model}: ${out.failure}`);
      continue;
    }
    if (responseRefused(out.data)) return result({ refusal: true });
    if (!out.ok) {
      const status = Number.isInteger(out.status) ? out.status : 'unknown';
      failures.push(`${model}: HTTP ${status}`);
      // Both models use the same key. A rejected credential cannot be repaired
      // by another model. A model-specific access error (403/404) may recover.
      if (status === 401) return result();
      continue;
    }
    const text = responseText(out.data);
    const truncated = out.data?.choices?.[0]?.finish_reason === 'length';
    if (text) return result({ text, truncated });
    failures.push(`${model}: ${truncated ? 'budget spent with no answer text' : 'empty answer'}`);
  }
  return result();
}
