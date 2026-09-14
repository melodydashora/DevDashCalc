import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Exercise the HTTP handler and inspect the actual provider request without
// making a paid model call, reading learner data, or writing progress.
let child, base, unit;
before(async () => {
  unit = JSON.parse(await readFile(new URL('../content/unit-01.json', import.meta.url), 'utf8'));
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  base = `http://127.0.0.1:${port}`;
  const preload = `globalThis.fetch = async (url, options) => {
    if (url !== 'https://api.openai.com/v1/chat/completions') throw new Error('Unexpected network request in tutor test');
    const payload = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(payload) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };`;
  child = spawn(process.execPath, ['--import', `data:text/javascript;base64,${Buffer.from(preload).toString('base64')}`, 'server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: String(port), DATABASE_URL: '', TUTOR_PROVIDERS: 'openai', OPENAI_API_KEY: 'test-placeholder' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Tutor test server did not start')), 10000);
    child.once('error', reject);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Tutor test server exited: ${code}`)); });
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('listening on')) { clearTimeout(timer); resolve(); }
    });
  });
});
after(async () => {
  if (child && child.exitCode === null) {
    const stopped = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await stopped;
  }
});

async function request(body) {
  const response = await fetch(`${base}/api/tutor`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json();
  return { status: response.status, data, payload: data.text ? JSON.parse(data.text) : null };
}

test('before-answer tutoring grounds hints in the stored problem and forbids answer disclosure', async () => {
  const q = unit.questions.find((question) => question.type === 'mc');
  const result = await request({
    unitId: unit.id, questionId: q.id, phase: 'before-answer',
    learnerAnswer: 'CLIENT ANSWER SHOULD NOT BE USED', correct: true,
    followUp: 'I do not understand the notation.',
    unrelatedCanvasData: 'PRIVATE CANVAS DATA MUST NOT BE FORWARDED',
  });
  assert.equal(result.status, 200);
  const [system, context, followUp] = result.payload.messages;
  assert.match(system.content, /Before-answer mode/);
  assert.match(system.content, /Never reveal or quote the final answer/);
  assert.match(system.content, /one next step/);
  assert.match(context.content, /has not submitted an answer/);
  assert.ok(context.content.includes(q.prompt));
  assert.ok(context.content.includes(q.solution[0].text), 'private grounding comes from stored solution');
  assert.equal(followUp.content, 'I do not understand the notation.');
  assert.doesNotMatch(JSON.stringify(result.payload), /CLIENT ANSWER|PRIVATE CANVAS/);
});

test('after-answer tutoring ignores a forged correct flag and checks the stored multiple-choice key', async () => {
  const q = unit.questions.find((question) => question.type === 'mc');
  const incorrect = (q.answerIndex + 1) % q.choices.length;
  const wrong = await request({ unitId: unit.id, questionId: q.id, chosenIndex: incorrect, correct: true });
  assert.match(wrong.payload.messages[1].content, /checked against the stored key: not correct/);
  const right = await request({ unitId: unit.id, questionId: q.id, chosenIndex: q.answerIndex, correct: false });
  assert.match(right.payload.messages[1].content, /checked against the stored key: correct/);
  assert.doesNotMatch(right.payload.messages[0].content, /Before-answer mode/);
  const missing = await request({ unitId: unit.id, questionId: q.id, correct: true });
  assert.match(missing.payload.messages[1].content, /no grade is established/);
});

test('numeric tutoring uses the answer key and question-specific tolerance, not client correctness', async () => {
  const q = unit.questions.find((question) => question.type === 'numeric');
  assert.ok(q, 'fixture contains a numeric practice item');
  const result = await request({ unitId: unit.id, questionId: q.id, learnerAnswer: String(q.answer), correct: false });
  assert.match(result.payload.messages[1].content, /checked against the stored key: correct/);
});

test('unknown questions/phases are rejected and mastery coaching uses the same private hint grounding', async () => {
  assert.equal((await request({ unitId: unit.id, questionId: 'not-a-question', phase: 'before-answer' })).status, 404);
  assert.equal((await request({ unitId: unit.id, questionId: unit.questions[0].id, phase: 'invented' })).status, 400);
  const bank = JSON.parse(await readFile(new URL('../content/mastery-bank.json', import.meta.url), 'utf8'));
  const q = bank.units[unit.id][0];
  const guided = await request({ unitId: unit.id, questionId: q.id, phase: 'before-answer' });
  assert.equal(guided.status, 200);
  assert.match(guided.payload.messages[0].content, /Before-answer mode/);
  assert.match(guided.payload.messages[0].content, /Never reveal or quote the final answer/);
  const result = await request({ unitId: unit.id, questionId: q.id, phase: 'after-answer', chosenIndex: q.answerIndex });
  assert.equal(result.status, 200);
  assert.match(result.payload.messages[1].content, /checked against the stored key: correct/);
});

test('each canonical free response supports private grounded hints for all its parts', async () => {
  const bank = JSON.parse(await readFile(new URL('../content/mastery-bank.json', import.meta.url), 'utf8'));
  for (const q of bank.freeResponse) {
    const result = await request({
      unitId: q.unitId, questionId: q.id, phase: 'before-answer',
      followUp: 'Please explain the concept in part b without solving it.',
    });
    assert.equal(result.status, 200, q.id);
    const [system, context] = result.payload.messages;
    assert.match(system.content, /no-answer-disclosure rules apply to every part/);
    assert.match(system.content, /never award or deduct points/);
    assert.ok(context.content.includes(q.prompt));
    for (const part of q.parts) {
      assert.ok(context.content.includes(`Part ${part.label}: ${part.prompt}`));
      assert.ok(context.content.includes(part.solution[0].text));
      assert.ok(context.content.includes(part.rubric[0].criterion));
    }
    assert.doesNotMatch(context.content, /correct answer is undefined|checked against the stored key/);
  }
});

test('free-response discussion never invents a grade or uses another unit question', async () => {
  const bank = JSON.parse(await readFile(new URL('../content/mastery-bank.json', import.meta.url), 'utf8'));
  const q = bank.freeResponse[0];
  const mismatch = await request({ unitId: unit.id, questionId: q.id, phase: 'before-answer' });
  assert.equal(mismatch.status, 404, 'FRQ must belong to the requested unit');
  const result = await request({
    unitId: q.unitId, questionId: q.id, phase: 'after-answer', correct: true,
    learnerAnswer: 'I set up the integral, but I need help with integration by parts.',
    history: { attempts: 999, skillScore: 100, recentTotal: 10, wrongCount: 0 },
  });
  assert.equal(result.status, 200);
  const [system, context] = result.payload.messages;
  assert.match(system.content, /No authoritative grade/);
  assert.match(context.content, /I set up the integral/);
  assert.match(context.content, /no grade is established/);
  assert.doesNotMatch(context.content, /checked against the stored key|learner answered correctly|999|mastery 100/);
});
