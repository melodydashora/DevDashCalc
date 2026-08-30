// Calc Coach server — zero dependencies, Node 18+.
// Serves the static app, the curriculum content, and a small JSON progress API
// backed by files in ./data (so progress survives browser changes on Replit).

import { createServer } from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const CONTENT = join(ROOT, 'content');
const DATA = join(ROOT, 'data');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
};
const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj));

// Only allow simple profile names so the file path can never escape ./data.
const profileFile = (name) => {
  const safe = String(name || 'learner').toLowerCase().replace(/[^a-z0-9-]/g, '');
  return join(DATA, `progress-${safe || 'learner'}.json`);
};

async function serveFile(res, base, relPath) {
  const path = normalize(join(base, relPath));
  if (!path.startsWith(base)) return send(res, 403, 'Forbidden', 'text/plain');
  try {
    const body = await readFile(path);
    const ext = path.slice(path.lastIndexOf('.'));
    send(res, 200, body, MIME[ext] || 'application/octet-stream');
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------- AI tutor
// Optional feature: set ANTHROPIC_API_KEY (e.g. in Replit Secrets) and a
// "Talk it through with the tutor" panel appears on answer feedback. Without
// the key the app is fully functional and the button never renders.
//
// The tutor is grounded, never authoritative: every request carries the
// verified solution as ground truth and the system prompt forbids
// contradicting it. Only the question content and the learner's answer to it
// are sent — no name, no progress data.
const TUTOR_MODEL = 'claude-opus-5';

const TUTOR_SYSTEM = `You are the tutor inside Calc Coach, an AP Calculus BC study app. The learner is an autistic professional software developer. Follow these rules exactly.

Style:
- Literal, concrete, calm language. No idioms, no exclamation marks, no rhetorical questions, no emoji.
- Short paragraphs. Define a term before relying on it.
- Write math as LaTeX inside $...$ delimiters (inline) or $$...$$ (display); the app renders it.
- Keep answers under 250 words unless the learner asks for more depth.
- A programming analogy is welcome when it is precise; always say where the analogy breaks.

Ground truth:
- The problem statement, correct answer, and verified solution steps are provided to you. They are authoritative. Never contradict them. If you believe they contain an error, say the app's stored solution is the authority and suggest the learner report it, then reason from the stored solution anyway.
- Never invent a different final answer.

Task:
- When shown the learner's incorrect answer, first diagnose the specific step where their likely reasoning diverged from the correct path, based on the answer they actually gave. Name that step plainly, without blame language, then explain the correct step. Do not restate the entire solution; the app already shows it.
- When shown a correct answer with a question, answer the question directly.
- For follow-up questions, stay on this problem and its concept. If asked about something unrelated to calculus, say plainly that you only discuss calculus here, and invite a calculus question.
- Feedback is information, never judgment. Say "this choice comes from ..." rather than "you made the mistake of ...".`;

async function handleTutor(req, res, url) {
  if (req.method === 'GET') return sendJson(res, 200, { available: Boolean(process.env.ANTHROPIC_API_KEY), model: TUTOR_MODEL });
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'use GET or POST' });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return sendJson(res, 200, { available: false });

  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'body must be valid JSON' }); }
  const { unitId, questionId, learnerAnswer, correct, followUp, transcript } = body || {};

  // Ground the tutor in the verified content straight from disk.
  let unit;
  try {
    const safe = String(unitId || '').replace(/[^a-z0-9-]/g, '');
    unit = JSON.parse(await readFile(join(CONTENT, `${safe}.json`), 'utf8'));
  } catch { return sendJson(res, 404, { error: 'unknown unit' }); }
  const q = (unit.questions || []).find((x) => x.id === questionId);
  if (!q) return sendJson(res, 404, { error: 'unknown question' });

  const answerText = q.type === 'mc'
    ? `The correct choice is ${'ABCDE'[q.answerIndex]}: ${q.choices[q.answerIndex]}`
    : `The correct answer is ${q.answer}`;
  const context = [
    `Problem (from unit "${unit.title}", skill "${q.skillId}"):`,
    q.prompt,
    q.type === 'mc' ? `Choices: ${q.choices.map((c, i) => `${'ABCDE'[i]}. ${c}`).join('  ')}` : '',
    `Verified ${answerText}`,
    `Verified solution steps: ${q.solution.map((s, i) => `(${i + 1}) ${s.text}${s.math ? ` [${s.math}]` : ''}`).join(' ')}`,
    `The learner answered: ${String(learnerAnswer ?? '(no answer)')} — this was ${correct ? 'correct' : 'not correct'}.`,
  ].filter(Boolean).join('\n');

  // Rebuild the short per-question conversation; the client keeps it in memory.
  const messages = [];
  const first = correct
    ? `${context}\n\nThe learner answered correctly and has a question about this problem.`
    : `${context}\n\nExplain where the learner's likely reasoning diverged, based on the answer they gave.`;
  messages.push({ role: 'user', content: first });
  for (const t of Array.isArray(transcript) ? transcript.slice(-8) : []) {
    if (t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string') {
      messages.push({ role: t.role, content: t.text.slice(0, 4000) });
    }
  }
  if (followUp) messages.push({ role: 'user', content: String(followUp).slice(0, 4000) });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: TUTOR_MODEL,
        max_tokens: 2000,
        system: [{ type: 'text', text: TUTOR_SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages,
      }),
    });
    const data = await apiRes.json();
    if (!apiRes.ok) {
      console.error(`[calc-coach] tutor API error ${apiRes.status}:`, data?.error?.message || 'unknown');
      return sendJson(res, 502, { error: 'The tutor service returned an error.' });
    }
    if (data.stop_reason === 'refusal') {
      return sendJson(res, 200, { text: 'The tutor cannot answer that particular question. A question about this calculus problem will work.' });
    }
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!text) return sendJson(res, 502, { error: 'The tutor returned an empty answer.' });
    return sendJson(res, 200, { text });
  } catch (e) {
    console.error('[calc-coach] tutor request failed:', e.message);
    return sendJson(res, 502, { error: 'The tutor could not be reached.' });
  } finally {
    clearTimeout(timer);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  try {
    if (path === '/api/health') return sendJson(res, 200, { ok: true, app: 'calc-coach' });
    if (path === '/api/tutor') return await handleTutor(req, res, url);

    if (path === '/api/progress') {
      const file = profileFile(url.searchParams.get('profile'));
      if (req.method === 'GET') {
        try {
          return send(res, 200, await readFile(file, 'utf8'));
        } catch {
          return sendJson(res, 200, null); // no saved progress yet — the client starts fresh
        }
      }
      if (req.method === 'PUT') {
        const raw = await readBody(req);
        let parsed;
        try { parsed = JSON.parse(raw); } catch { return sendJson(res, 400, { error: 'body must be valid JSON' }); }
        if (typeof parsed !== 'object' || parsed === null) return sendJson(res, 400, { error: 'body must be a JSON object' });
        await mkdir(DATA, { recursive: true });
        const tmp = `${file}.tmp`;
        await writeFile(tmp, JSON.stringify(parsed, null, 2), 'utf8');
        await rename(tmp, file); // atomic: never leaves a half-written progress file
        return sendJson(res, 200, { saved: true });
      }
      return sendJson(res, 405, { error: 'use GET or PUT' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });
    if (path.startsWith('/content/')) return serveFile(res, CONTENT, path.slice('/content/'.length));
    if (path === '/' || path === '/index.html') return serveFile(res, PUBLIC, 'index.html');
    return serveFile(res, PUBLIC, path.slice(1));
  } catch (e) {
    console.error(`[calc-coach] ${req.method} ${path} failed:`, e.message);
    sendJson(res, 500, { error: 'internal error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[calc-coach] listening on http://0.0.0.0:${PORT}`);
});
