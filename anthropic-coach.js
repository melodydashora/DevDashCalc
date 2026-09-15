// One model per invocation; provider/model fallback belongs to the orchestrator.
// https://platform.claude.com/docs/en/models/fable-5-1/whats-new-fable-5-1
// https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls
import { RECORD_SYSTEM } from './coach-records.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const FILTER_CODES = new Set(['content_filter', 'content_policy_violation', 'refusal_error']);
const MAX_TOOL_CALLS = 8;
const MAX_ROUNDS = 9;
const MAX_TOOL_RESULT_CHARS = 32000;
const MAX_TOOL_TOTAL_CHARS = 192000;

class CoachFailure extends Error {
  constructor(kind, reason) { super(reason); this.kind = kind; this.reason = reason; }
}
const fail = (reason, kind = 'service') => { throw new CoachFailure(kind, reason); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function textMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) fail('invalid conversation');
  const output = messages.map(message => {
    if (!['user', 'assistant'].includes(message?.role)) fail('invalid conversation');
    if (typeof message.content === 'string') return { role: message.role, content: message.content };
    if (!Array.isArray(message.content) || !message.content.length
      || message.content.some(part => part?.type !== 'text' || typeof part.text !== 'string')) fail('invalid conversation');
    // Histories supplied by another provider may contain text, never its opaque
    // reasoning/tool state. Only this invocation adds Anthropic thinking below.
    return { role: message.role, content: message.content.map(part => ({ type: 'text', text: part.text })) };
  });
  if (output.at(-1).role !== 'user') fail('invalid conversation');
  return output;
}

function translateTools(lookup) {
  if (!lookup) return [];
  if (typeof lookup.assertCurrent !== 'function' || typeof lookup.execute !== 'function'
    || !Array.isArray(lookup.tools) || !lookup.tools.length) fail('invalid record lookup');
  return lookup.tools.map(tool => {
    if (tool?.type !== 'function' || typeof tool.name !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(tool.name)
      || typeof tool.description !== 'string' || !object(tool.parameters)) fail('invalid record lookup');
    return { name: tool.name, description: tool.description,
      input_schema: JSON.parse(JSON.stringify(tool.parameters)), ...(tool.strict === true ? { strict: true } : {}) };
  });
}

export async function completeAnthropicCoach({ apiKey, model, system, messages, lookup,
  fetchImpl = fetch, timeoutMs = 120000, maxOutputTokens = 16000, reasoningEffort = 'high' } = {}) {
  const safeModel = typeof model === 'string' && model.length <= 100
    && /^claude-[A-Za-z0-9][A-Za-z0-9._:-]*$/i.test(model) ? model : null;
  const result = extra => ({ text: '', model: safeModel, provider: 'anthropic', refusal: false, truncated: false,
    failures: [], recordReads: Array.isArray(lookup?.reads) ? lookup.reads.map(read => ({ ...read })) : [], ...extra });
  if (typeof apiKey !== 'string' || !apiKey.trim()) return result({ failureKind: 'authentication', failures: ['anthropic: API key is not configured'] });
  if (!safeModel || typeof system !== 'string' || !EFFORTS.has(reasoningEffort)
    || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 128000
    || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000) {
    return result({ failureKind: 'service', failures: ['anthropic: invalid request configuration'] });
  }

  const controller = new AbortController();
  const expiresAt = Date.now() + timeoutMs;
  let timer;
  const checkDeadline = () => { if (controller.signal.aborted || Date.now() >= expiresAt) fail('timed out'); };
  const authorize = async () => {
    checkDeadline();
    if (lookup) {
      try { await lookup.assertCurrent(); }
      catch { checkDeadline(); fail('student authorization unavailable', 'authorization'); }
    }
    checkDeadline();
  };
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new CoachFailure('service', 'timed out')); }, timeoutMs);
  });
  try {
    const outcome = await Promise.race([deadline, (async () => {
      const conversation = textMessages(messages);
      const tools = translateTools(lookup);
      const instructions = lookup ? `${system}\n${RECORD_SYSTEM}` : system;
      let remaining = maxOutputTokens;
      let toolCalls = 0;
      let toolChars = 0;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        await authorize();
        if (remaining < 1) fail('output token budget exhausted');
        const allowTools = tools.length > 0 && toolCalls < MAX_TOOL_CALLS && remaining >= 1024;
        const response = await fetchImpl(ENDPOINT, { method: 'POST', signal: controller.signal,
          headers: { 'content-type': 'application/json', 'x-api-key': apiKey.trim(), 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: safeModel, system: instructions, messages: conversation,
            max_tokens: remaining, thinking: { type: 'adaptive' }, output_config: { effort: reasoningEffort },
            ...(tools.length ? { tools, tool_choice: { type: allowTools ? 'auto' : 'none' } } : {}) }),
        });
        checkDeadline();
        // Do not wait on an error body to recognize an invalid provider key.
        if (response.status === 401) fail('HTTP 401', 'authentication');
        let data;
        try { data = await response.json(); } catch { checkDeadline(); fail('unreadable response'); }
        checkDeadline();
        const content = Array.isArray(data?.content) ? data.content : [];
        if (data?.stop_reason === 'refusal' || data?.stop_details?.type === 'refusal'
          || content.some(part => part?.type === 'refusal') || FILTER_CODES.has(data?.error?.type)
          || FILTER_CODES.has(data?.error?.code) || FILTER_CODES.has(data?.stop_reason)) {
          await authorize();
          // Classifier refusals can contain partial text: never display it or
          // invoke a requested tool, and never request server-side fallback.
          return { refusal: true };
        }
        if (!response.ok) fail(Number.isInteger(response.status) ? `HTTP ${response.status}` : 'request unavailable');
        if (data?.type === 'error' || !Array.isArray(data?.content)) fail('unusable response');
        const calls = content.filter(part => part?.type === 'tool_use');
        const truncated = ['max_tokens', 'model_context_window_exceeded'].includes(data.stop_reason);
        const usage = data?.usage?.output_tokens;
        const accounted = Number.isSafeInteger(usage) && usage >= 0;
        if (accounted) remaining -= usage;
        if (calls.length || data.stop_reason === 'tool_use') {
          if (data.stop_reason !== 'tool_use' || !calls.length) fail(truncated ? 'truncated tool request' : 'invalid tool response');
          if (!allowTools || !lookup || toolCalls + calls.length > MAX_TOOL_CALLS) fail('record lookup limit');
          if (!accounted || remaining < 1) fail('output token budget exhausted');
          const ids = new Set();
          for (const call of calls) {
            if (typeof call.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(call.id) || ids.has(call.id)) fail('invalid tool response');
            ids.add(call.id);
            if (JSON.stringify(call.input)?.length > 2000) fail('record argument limit');
          }
          // Fable 5.1 binds thinking to its original prefix. Keep all returned
          // content unchanged and append tool results; never rewrite old turns.
          conversation.push({ role: 'assistant', content });
          const outputs = [];
          for (const call of calls) {
            await authorize();
            toolCalls++;
            const name = typeof call.name === 'string' && call.name.length <= 128 ? call.name : '';
            const args = object(call.input) ? call.input : null;
            let value;
            try { value = await lookup.execute(name, args, { signal: controller.signal }); }
            catch (error) {
              checkDeadline();
              if (error?.status === 401 || error?.status === 403) fail('student authorization unavailable', 'authorization');
              fail('record lookup unavailable');
            }
            await authorize();
            const encoded = JSON.stringify(value);
            if (typeof encoded !== 'string' || encoded.length > MAX_TOOL_RESULT_CHARS
              || toolChars + encoded.length > MAX_TOOL_TOTAL_CHARS) fail('record output limit');
            toolChars += encoded.length;
            outputs.push({ type: 'tool_result', tool_use_id: call.id, content: encoded,
              ...(['invalid_request', 'unavailable'].includes(value?.state) ? { is_error: true } : {}) });
          }
          conversation.push({ role: 'user', content: outputs });
          continue;
        }
        if (!['end_turn', 'stop_sequence', 'max_tokens', 'model_context_window_exceeded'].includes(data.stop_reason)) fail('unexpected stop reason');
        const answer = content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n').trim();
        if (!answer) fail('empty answer');
        await authorize();
        return { text: answer, truncated };
      }
      fail('record lookup limit');
    })()]);
    return result(outcome);
  } catch (error) {
    return result({ failureKind: error instanceof CoachFailure ? error.kind : 'service',
      failures: [`anthropic: ${error instanceof CoachFailure ? error.reason : 'request unavailable'}`] });
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
