// Astra's function calls use Responses (Chat Completions is text-only for Astra).
// https://developers.openai.com/api/docs/guides/function-calling
// Only the closed, read-only student-record dispatcher is provided by the server.
import { COACH_MODELS, COACH_CONFIG } from './ai-coach.js';
import { RECORD_SYSTEM } from './coach-records.js';
const ENDPOINT = 'https://api.openai.com/v1/responses';

export async function completeRecordCoach({ apiKey, system, messages, lookup, fetchImpl = fetch, timeoutMs = COACH_CONFIG.timeoutMs }) {
  const failures = [];
  const base = { text: '', model: null, fallback: false, refusal: false, truncated: false, failures, recordReads: lookup.reads };
  if (!apiKey?.trim()) return { ...base, failures: ['openai: API key is not configured'] };
  let toolCount = 0;
  for (const [index, model] of COACH_MODELS.entries()) {
    const result = { ...base, model, fallback: index > 0 };
    const controller = new AbortController();
    let timer;
    const deadline = new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ failure: 'timed out' }); }, timeoutMs); });
    try {
      const out = await Promise.race([deadline, (async () => {
        const input = messages.map(message => ({ ...message }));
        let tokens = COACH_CONFIG.maxCompletionTokens;
        for (let round = 0; round < 9; round++) {
          if (controller.signal.aborted) return { failure: 'timed out' };
          await lookup.assertCurrent();
          const response = await fetchImpl(ENDPOINT, { method: 'POST', signal: controller.signal,
            headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey.trim()}` },
            body: JSON.stringify({ model, instructions: `${system}\n${RECORD_SYSTEM}`, input,
              reasoning: { effort: COACH_CONFIG.reasoningEffort }, max_output_tokens: Math.max(512, tokens),
              store: false, include: ['reasoning.encrypted_content'], tools: lookup.tools, parallel_tool_calls: false,
              tool_choice: toolCount >= 8 || tokens < 1024 ? 'none' : 'auto' }),
          });
          if (response.status === 401) { controller.abort(); return { failure: 'HTTP 401', final: true }; }
          const data = await response.json().catch(() => null);
          if (controller.signal.aborted) return { failure: 'timed out' };
          const output = Array.isArray(data?.output) ? data.output : [];
          if (output.some(item => item?.type === 'message' && item.content?.some(part => part.type === 'refusal'))
            || ['content_filter', 'content_policy_violation'].includes(data?.error?.code)
            || data?.incomplete_details?.reason === 'content_filter') return { refusal: true };
          if (!response.ok) return { failure: `HTTP ${response.status}` };
          if (data?.status === 'failed') return { failure: 'unusable response' };
          tokens -= Number.isFinite(data?.usage?.output_tokens) ? Math.max(0, data.usage.output_tokens) : 0;
          const calls = output.filter(item => item?.type === 'function_call');
          if (calls.length) {
            if (toolCount >= 8 || calls.length > 8 - toolCount || calls.some(call => typeof call.call_id !== 'string' || typeof call.arguments !== 'string' || call.arguments.length > 2000)) return { failure: 'record lookup limit' };
            // Reasoning items, including encrypted state, return only to OpenAI.
            input.push(...output);
            for (const call of calls) {
              if (controller.signal.aborted) return { failure: 'timed out' };
              toolCount++;
              let args;
              try { args = JSON.parse(call.arguments); } catch { args = null; }
              const value = await lookup.execute(call.name, args);
              if (controller.signal.aborted) return { failure: 'timed out' };
              input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(value) });
            }
            continue;
          }
          const text = output.filter(item => item?.type === 'message' && item.role === 'assistant')
            .flatMap(item => Array.isArray(item.content) ? item.content : []).filter(part => part.type === 'output_text' && typeof part.text === 'string').map(part => part.text).join('\n').trim();
          if (text) { await lookup.assertCurrent(); return { text, truncated: data.status === 'incomplete' }; }
          return { failure: 'empty answer' };
        }
        return { failure: 'record lookup limit' };
      })()]);
      if (!out.failure) return { ...result, ...out };
      failures.push(`${model}: ${out.failure}`);
      if (out.final) return result;
    } catch {
      failures.push(`${model}: request unavailable`);
    } finally { clearTimeout(timer); }
  }
  return { ...base, model: COACH_MODELS[1], fallback: true };
}
