// Students4AI — single-page app. No build step, no framework.
// All adaptive/mastery logic lives in engine.js (pure, tested); this file is
// data loading, routing, rendering, and persistence.

import * as E from '/engine.js';
import * as CI from '/canvas-insights.js';
import { explorersFor, mountExplorer, explorerTitle } from '/viz.js';
import { mountStudyLab } from '/study-lab.js';
import { activateFocusProfile, subscribeFocusSession } from '/focus-planner.js';
import { STUDY_SUBJECTS, normalizeSubjectId, unitsForSubject, unitForSubject } from '/courses.js';

// ---------------------------------------------------------------- data & state
const CONTENT = { manifest: null, units: new Map(), byNumber: new Map(), failed: [], freeResponse: [] };
const TUTOR = { available: false };
let S = null;                // progress state (engine shape + app extras)
let saveTimer = null;
let tickTimer = null;        // optional elapsed-time display
let labCleanup = null;
let spatialCleanup = null;
let focusCleanup = null;
let activeProfile = 'learner';
let switchingProfile = false;
let profiles = [{ id: 'learner', name: 'My workspace' }];
try {
  const stored = JSON.parse(localStorage.getItem('students4ai-profiles') || 'null');
  if (Array.isArray(stored)) {
    profiles = profiles.concat(stored.filter((p) => p && p.id !== 'learner' && /^[a-z0-9-]{1,50}$/.test(p.id)).slice(0, 20));
    const original = stored.find((p) => p?.id === 'learner');
    if (typeof original?.name === 'string') profiles[0].name = original.name.slice(0, 40);
  }
  const selected = localStorage.getItem('students4ai-active-profile');
  if (profiles.some((p) => p.id === selected)) activeProfile = selected;
} catch { /* Browser storage is optional. */ }

const $ = (sel, root = document) => root.querySelector(sel);
const viewEl = () => $('#view');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderMath(container) {
  const go = () => {
    try {
      window.renderMathInElement(container, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
        ],
        throwOnError: false,
      });
    } catch (e) { console.warn('KaTeX render failed:', e); }
  };
  if (window.renderMathInElement) go();
  else window.addEventListener('katex-ready', go, { once: true });
}

function announce(text) { $('#live-region').textContent = text; }

// ------------------------------------------------------------------ AI tutor
// Availability comes from the server's configured provider chain.
// Conversation lives in memory per question; only this question's content and
// the learner's answer to it are sent to the server.
function mountTutor(container, unit, q, ctx) {
  const before = ctx.phase === 'before-answer';
  if (!TUTOR.available) {
    container.innerHTML = '<section class="coach-card"><h3>Astra AI coach</h3><p>AI coaching is not connected on this server yet. Built-in hints and worked solutions are available.</p></section>';
    return;
  }
  container.innerHTML = `<section class="coach-card"><h3>Astra AI coach</h3><p>Work through this question one step at a time.</p><p class="session-progress">GPT-6 Astra · GPT-5.6 Sol backup</p><div class="btn-row"><button type="button" class="secondary tutor-open">${before ? 'Help me understand this problem' : 'Talk through this question with Astra'}</button></div>${before ? `<p class="session-progress">Ask for the idea, a first step, or a coding example. ${ctx.selfCheck ? 'Use the scoring guide to review your own written work.' : ctx.check ? (ctx.check === 'placement' ? 'Answers solved with coach help do not place a unit. Your assisted practice still helps you learn.' : 'Getting coach help marks this attempt as assisted. It will not count as an independent mastery pass.') : 'Coach help received before checking counts as a hint.'}</p>` : ''}</section>`;
  $('.tutor-open', container).addEventListener('click', () => {
    container.innerHTML = `<div class="tutor-panel">
      <h3>Astra AI coach</h3>
      <p class="session-progress coach-model">GPT-6 Astra · GPT-5.6 Sol backup</p>
      <p class="viz-note">${before ? 'Work through one idea at a time. The tutor is instructed to guide your thinking without giving away the answer.' : 'Ask about a confusing step or compare approaches.'} It uses this question and the stored solution. Your name and Canvas data are not shared.</p>
      <div class="tutor-log" aria-live="polite"></div>
      <p class="tutor-status"></p>
      <div class="btn-row tutor-actions" hidden>${['Explain the idea', 'Help with the first step', 'Use a coding example'].map((label) => `<button type="button" class="secondary tutor-hint-action">${label}</button>`).join('')}</div>
      <div class="numeric-row tutor-ask-row" hidden>
        <input class="tutor-input" aria-label="Ask the AI tutor" type="text" autocomplete="off" placeholder="Tell me which part is confusing">
        <button type="button" class="tutor-send">Send</button>
      </div>
    </div>`;
    const log = $('.tutor-log', container);
    const status = $('.tutor-status', container);
    const askRow = $('.tutor-ask-row', container);
    const input = $('.tutor-input', container);
    const actions = $('.tutor-actions', container);
    const sendBtn = $('.tutor-send', container);
    const transcript = [];

    const addMsg = (role, text) => {
      const div = document.createElement('div');
      div.className = `tutor-msg ${role}`;
      const formatted = esc(text).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
      const paragraphs = formatted.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
      div.innerHTML = `<span class="tutor-who">${role === 'user' ? 'You' : 'Coach'}</span>${paragraphs}`;
      log.appendChild(div);
      renderMath(div);
    };

    const ask = async (followUp) => {
      status.textContent = 'Astra is working through this question. A careful reply can take a minute or more.';
      askRow.hidden = true;
      actions.hidden = true;
      sendBtn.disabled = true;
      try {
        const res = await fetch('/api/tutor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            unitId: unit.id, questionId: q.id,
            phase: before ? 'before-answer' : 'after-answer',
            learnerAnswer: ctx.learnerAnswer, correct: ctx.correct,
            chosenIndex: ctx.chosenIndex,
            history: ctx.history,
            followUp: followUp || undefined,
            transcript,
          }),
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
        if (typeof data.text !== 'string' || !data.text.trim()) throw new Error('No coach reply was returned.');
        ctx.onHelp?.();
        $('.coach-model', container).textContent = data.model === 'gpt-5.6-sol' ? 'Reply from GPT-5.6 Sol · backup coach' : data.model === 'gpt-6-astra' ? 'Reply from GPT-6 Astra' : 'AI coach reply';
        if (followUp) transcript.push({ role: 'user', text: followUp });
        transcript.push({ role: 'assistant', text: data.text });
        addMsg('assistant', data.text);
        status.textContent = '';
      } catch (e) {
        status.textContent = 'The tutor could not answer this time. Your progress here is unaffected; you can try again.';
        console.warn('tutor:', e.message);
      }
      askRow.hidden = false;
      actions.hidden = false;
      sendBtn.disabled = false;
    };

    sendBtn.addEventListener('click', () => {
      const text = input.value.trim();
      if (!text) return;
      addMsg('user', text);
      input.value = '';
      ask(text);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendBtn.click(); });
    actions.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => {
      addMsg('user', button.textContent);
      ask(button.textContent);
    }));
    ask(null);
  });
}

// ---------------------------------------------------------------- persistence
function ensureAppFields(state) {
  state.settings = { ...E.newState().settings, ...state.settings };
  state.settings.subject = normalizeSubjectId(state.settings.subject);
  if (!['full', 'reduced', 'off'].includes(state.settings.motion)) state.settings.motion = 'full';
  state.lessons = state.lessons || {};          // lessonId -> completedAt
  state.lastLocation = state.lastLocation || '';
  state.savedAt = state.savedAt || 0;
  if (!state.createdAt) state.createdAt = Date.now();
  return state;
}

const progressKey = (profile) => profile === 'learner' ? 'calc-coach-progress' : `students4ai-progress-${profile}`;
function save() {
  S.savedAt = Date.now();
  const body = JSON.stringify(S), profile = activeProfile;
  try { localStorage.setItem(progressKey(profile), body); } catch { /* private mode */ }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await fetch(`/api/progress?profile=${encodeURIComponent(profile)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (e) { console.warn('Server save failed; progress is still in this browser.', e); }
  }, 600);
}

async function loadProgress(profile = activeProfile) {
  let server = null;
  let local = null;
  try {
    const res = await fetch(`/api/progress?profile=${encodeURIComponent(profile)}`);
    if (res.ok) server = await res.json();
  } catch { /* offline is fine */ }
  try { local = JSON.parse(localStorage.getItem(progressKey(profile)) || 'null'); } catch { /* ignore */ }
  const pick = (server?.savedAt || 0) >= (local?.savedAt || 0) ? server : local;
  const state = ensureAppFields(pick || E.newState());
  const entry = profiles.find((item) => item.id === profile);
  if (entry && state.settings.name && entry.name !== state.settings.name) {
    entry.name = String(state.settings.name).slice(0, 40);
    try { localStorage.setItem('students4ai-profiles', JSON.stringify(profiles)); } catch { /* optional */ }
  }
  return state;
}

async function switchProfile(profile) {
  if (switchingProfile || profile === activeProfile || !profiles.some((p) => p.id === profile)) return;
  switchingProfile = true;
  mountView('<h1>Opening learner workspace</h1><p>Your current progress is being saved.</p>');
  document.querySelectorAll('#study-controls select').forEach((select) => { select.disabled = true; });
  clearTimeout(saveTimer);
  const previous = activeProfile, body = JSON.stringify(S);
  try { localStorage.setItem(progressKey(previous), body); } catch { /* optional */ }
  try { await fetch(`/api/progress?profile=${encodeURIComponent(previous)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }); } catch { /* browser copy remains */ }
  activeProfile = profile;
  activateFocusProfile(profile);
  $('#focus-status').hidden = true;
  resetCanvas();
  try { localStorage.setItem('students4ai-active-profile', profile); } catch { /* optional */ }
  S = await loadProgress(profile);
  applySettings();
  switchingProfile = false;
  location.hash = '#/home';
  router();
  loadSchoolContext();
}

const subjectLabel = () => STUDY_SUBJECTS.find((s) => s.id === S.settings.subject)?.label || 'AP Calculus BC';
const activeUnit = (id) => {
  const unit = CONTENT.units.get(id);
  return unit ? unitForSubject(unit, S.settings.subject) : null;
};

function studyControls() {
  const root = $('#study-controls');
  if (!root || !S) return;
  root.innerHTML = `<label class="study-profile">Learner <select id="study-profile">${profiles.map((p) => `<option value="${esc(p.id)}" ${p.id === activeProfile ? 'selected' : ''}>${esc(p.id === activeProfile && S.settings.name ? S.settings.name : p.name)}</option>`).join('')}</select></label>
    <label class="course-switcher">Studying <select id="study-subject" class="course-select">${STUDY_SUBJECTS.map((c) => `<option value="${c.id}" ${S.settings.subject === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}</select></label>
    <span class="open-status">All learning modules open</span>`;
  $('#study-profile', root).addEventListener('change', (e) => switchProfile(e.target.value));
  $('#study-subject', root).addEventListener('change', (e) => {
    S.settings.subject = normalizeSubjectId(e.target.value);
    CANVAS.selectedCourseId = null;
    CANVAS.assessment = null;
    const current = CI.currentTermId(CANVAS.terms, Date.now());
    CANVAS.termIds = current ? [current] : null;
    if (CANVAS.snapshot) canvasRebuildInsights();
    save();
    if (location.hash.startsWith('#/canvas/course/')) location.hash = '#/canvas';
    else if (location.hash.startsWith('#/canvas') || location.hash === '#/focus') router();
    else { location.hash = '#/home'; router(); }
  });
}

// ---------------------------------------------------------------- content load
async function loadContent() {
  const res = await fetch('/content/manifest.json');
  if (!res.ok) throw new Error(`manifest.json failed to load (HTTP ${res.status})`);
  CONTENT.manifest = await res.json();
  const results = await Promise.all(CONTENT.manifest.units.map(async (meta) => {
    try {
      const r = await fetch(`/content/${meta.file}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { meta, unit: await r.json() };
    } catch (e) {
      return { meta, error: e.message };
    }
  }));
  for (const r of results) {
    if (r.unit) {
      CONTENT.units.set(r.meta.id, r.unit);
      CONTENT.byNumber.set(r.unit.number, r.unit);
    } else CONTENT.failed.push(`${r.meta.id}: ${r.error}`);
  }
  try {
    const r = await fetch('/content/mastery-bank.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const bank = await r.json();
    for (const [id, unit] of CONTENT.units) unit.masteryQuestions = bank.units[id] || [];
    CONTENT.freeResponse = bank.freeResponse || [];
  } catch { CONTENT.failed.push('The separate mastery question bank could not load. Practice and lessons are available; reload to retry mastery.'); }
}

const allUnits = () => [...CONTENT.units.values()].map((unit) => unitForSubject(unit, S.settings.subject)).filter(Boolean).sort((a, b) => a.number - b.number);
const questionById = (unit, qid) => [...unit.questions, ...(unit.masteryQuestions || [])].find((q) => q.id === qid);
const skillName = (unit, skillId) => unit.skills.find((s) => s.id === skillId)?.name || skillId;
const calculatorLabel = (policy) => policy === 'permitted' || policy === 'allowed' ? 'Calculator permitted' : policy === 'required' ? 'Calculator required' : 'No calculator';

// ---------------------------------------------------------------- shared bits
function setBreadcrumb(parts) {
  $('#breadcrumb').innerHTML = parts.length
    ? `You are here: ${parts.map((p, i) => (i === parts.length - 1 ? `<strong>${esc(p)}</strong>` : esc(p))).join(' › ')}`
    : '';
}

function setNav(active) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === active));
}

function mountView(html, { breadcrumb = [], nav = '' } = {}) {
  clearInterval(tickTimer);
  if (labCleanup) { labCleanup(); labCleanup = null; }
  if (spatialCleanup) { spatialCleanup(); spatialCleanup = null; }
  if (focusCleanup) { focusCleanup(); focusCleanup = null; }
  studyControls();
  const v = viewEl();
  v.innerHTML = html;
  setBreadcrumb(breadcrumb);
  setNav(nav);
  renderMath(v);
  window.scrollTo(0, 0);
  const h1 = $('h1', v);
  if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
  return v;
}

function bar(label, value, max, { done = false } = {}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return `<div class="bar-row">
    <span class="bar-label">${label}</span>
    <span class="bar ${done ? 'done' : ''}" role="img" aria-label="${esc(label)}: ${value} of ${max}"><span style="width:${pct}%"></span></span>
    <span class="bar-num">${value} / ${max}</span>
  </div>`;
}

function skillBars(unit) {
  return unit.skills.map((sk) => {
    const score = E.masteryScore(S, sk.id);
    const mastered = score >= E.MASTERY_THRESHOLD;
    return bar(`${esc(sk.name)}${sk.core ? '' : ' <span class="tag">extra</span>'}`, score, 100, { done: mastered });
  }).join('');
}

function whatsNext(text) {
  return `<div class="whats-next"><span class="kicker">What happens next</span><p>${text}</p></div>`;
}

function startTimerIfEnabled(container) {
  if (!S.settings.showTimer) return;
  const span = document.createElement('span');
  span.className = 'timer';
  span.textContent = 'Elapsed: 0:00';
  container.appendChild(span);
  const t0 = Date.now();
  tickTimer = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    span.textContent = `Elapsed: ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);
}

// -------------------------------------------------------- question interaction
// Two-step everywhere: select (or type), then press "Check answer". Nothing is
// graded on a stray click. `done({correct, hintsUsed, skipped})` fires only
// after the learner presses the explicit continue button.
function mountQuestion(container, unit, q, opts, done) {
  const { hintsAllowed = true, deferFeedback = false, index = 1, total = 1, countsTowardMastery = true } = opts;
  let selected = null;
  let hintsUsed = 0;
  let aiHelpUsed = false;

  const mcHtml = q.type === 'mc'
    ? `<div class="choices" role="group" aria-label="Answer choices">
        ${q.choices.map((c, i) => `<button type="button" class="choice" data-i="${i}" aria-pressed="false"><span class="choice-key">${'ABCDE'[i]}.</span> ${c}</button>`).join('')}
       </div>`
    : `<div class="numeric-row">
        <label for="num-in">Your answer:</label>
        <input id="num-in" type="text" inputmode="text" autocomplete="off" spellcheck="false">
        <span class="numeric-hint">Enter a number. Fractions like <code>3/4</code> and decimals like <code>-1.5</code> are accepted.</span>
       </div>`;

  container.innerHTML = `
    <div class="card">
      <div class="q-meta">
        <span class="session-progress">Question ${index} of ${total}</span>
        <span>Skill: ${esc(skillName(unit, q.skillId))}</span>
        <span>Difficulty ${q.difficulty} of 3</span>
        ${q.bank === 'mastery' ? `<span class="tag">Original AP-style · ${calculatorLabel(q.calculatorPolicy)}</span>` : ''}
      </div>
      <div class="q-prompt">${q.prompt}</div>
      ${mcHtml}
      <div class="hint-area"></div>
      <div class="btn-row">
        <button type="button" class="submit-btn" disabled>Check answer</button>
        ${hintsAllowed ? `<button type="button" class="secondary hint-btn">Show hint (1 of ${q.hints.length})</button>` : ''}
      </div>
      <div class="feedback-area"></div>
      <div class="question-coach"></div>
    </div>`;

  renderMath(container);
  const submitBtn = $('.submit-btn', container);
  const hintArea = $('.hint-area', container);
  const fbArea = $('.feedback-area', container);
  const coachSlot = $('.question-coach', container);
  mountTutor(coachSlot, unit, q, { phase: 'before-answer', check: q.bank === 'mastery' ? 'mastery' : !hintsAllowed ? 'placement' : null, onHelp: () => { aiHelpUsed = true; } });

  if (q.type === 'mc') {
    container.querySelectorAll('.choice').forEach((btn) => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.choice').forEach((b) => b.setAttribute('aria-pressed', 'false'));
        btn.setAttribute('aria-pressed', 'true');
        selected = Number(btn.dataset.i);
        submitBtn.disabled = false;
      });
    });
  } else {
    const input = $('#num-in', container);
    input.addEventListener('input', () => { submitBtn.disabled = input.value.trim() === ''; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !submitBtn.disabled) submitBtn.click(); });
    input.focus();
  }

  if (hintsAllowed) {
    const hintBtn = $('.hint-btn', container);
    hintBtn.addEventListener('click', () => {
      const box = document.createElement('div');
      box.className = 'hint-box';
      box.innerHTML = `<strong>Hint ${hintsUsed + 1}:</strong> ${q.hints[hintsUsed]}`;
      hintArea.appendChild(box);
      renderMath(box);
      hintsUsed += 1;
      if (hintsUsed >= q.hints.length) { hintBtn.disabled = true; hintBtn.textContent = 'All hints shown'; }
      else hintBtn.textContent = `Show hint (${hintsUsed + 1} of ${q.hints.length})`;
    });
  }

  submitBtn.addEventListener('click', () => {
    const response = q.type === 'mc' ? selected : $('#num-in', container).value;
    const grade = E.gradeAnswer(q, response);
    if (grade.unparsed) {
      fbArea.innerHTML = `<div class="feedback notyet"><p>That input could not be read as a number. Use a form like <code>7</code>, <code>-1.5</code>, or <code>3/4</code>, then check again.</p></div>`;
      return;
    }
    submitBtn.disabled = true;
    if (hintsAllowed) { const hb = $('.hint-btn', container); if (hb) hb.disabled = true; }
    container.querySelectorAll('.choice').forEach((b) => { b.disabled = true; });
    const numIn = $('#num-in', container); if (numIn) numIn.disabled = true;
    const countedHints = hintsUsed + Number(aiHelpUsed);

    // History is read before this answer is recorded, so it describes earlier attempts only.
    const qh = E.questionHistory(S, q);
    const sh = E.skillHistory(S, q.skillId);
    const history = {
      attempts: qh.attempts, wrongCount: qh.wrongCount,
      priorWrongChoices: qh.priorWrongChoices.map((c) => ({ index: c.index, count: c.count })),
      skillScore: sh.score, recentTotal: sh.recentTotal, recentWrong: sh.recentWrong, recentWithHints: sh.recentWithHints,
    };
    if (countsTowardMastery) {
      E.recordAnswer(S, { skillId: q.skillId, questionId: q.id, correct: grade.correct, hintsUsed: countedHints, difficulty: q.difficulty, now: Date.now(), choice: q.type === 'mc' ? selected : null });
      save();
    }

    if (deferFeedback) {
      fbArea.innerHTML = `<div class="feedback ${'good'}" style="border-color: var(--border); background: var(--surface-2);">
        <p>Answer recorded. You will see all results at the end.</p>
        <div class="btn-row"><button type="button" class="next-btn">Next</button></div></div>`;
    } else {
      if (q.type === 'mc') {
        const btns = container.querySelectorAll('.choice');
        btns[q.answerIndex].classList.add('reveal-correct');
        if (!grade.correct && selected !== null) btns[selected].classList.add('reveal-chosen');
      }
      const solutionHtml = `<ol class="solution-steps">${q.solution.map((st) =>
        `<li>${st.text}${st.math ? `<div class="step-math">$$${st.math}$$</div>` : ''}</li>`).join('')}</ol>`;
      if (grade.correct) {
        fbArea.innerHTML = `<div class="feedback good">
          <h3>Correct.</h3>
          ${countedHints > 0 ? '<p>You used built-in hints or AI guidance, so this counts as partial credit toward mastery. Solving without help counts fully.</p>' : ''}
          <details><summary>Show the full solution</summary>${solutionHtml}</details>
          <div class="btn-row"><button type="button" class="next-btn">Continue</button></div>
        </div>`;
        announce('Correct.');
      } else {
        fbArea.innerHTML = `<div class="feedback notyet">
          <h3>Not yet.</h3>
          ${grade.misconception ? `<p><strong>About this choice:</strong> ${grade.misconception}</p>` : ''}
          <p><strong>Here is the complete solution:</strong></p>
          ${solutionHtml}
          <div class="viz-slot"></div>
          <div class="btn-row"><button type="button" class="next-btn">Continue</button></div>
        </div>`;
        // The remediation moment: mount the matching interactive explorer so
        // the idea can be *seen and driven*, not just re-read.
        const vizIds = explorersFor(unit, q.skillId);
        const vizSlot = $('.viz-slot', fbArea);
        if (vizIds.length && vizSlot) {
          vizSlot.innerHTML = `<p><strong>Interactive explorer:</strong> the graph below shows the idea this question tested. It changes only when you move its slider or press its buttons.</p>`;
          mountExplorer(vizSlot, vizIds[0]);
        }
        announce('Not yet correct. The full solution and an interactive explorer are shown.');
      }
    }
    renderMath(fbArea);
    if (!deferFeedback) {
      const learnerAnswer = q.type === 'mc'
        ? (selected !== null ? `choice ${'ABCDE'[selected]} (${q.choices[selected]})` : '(none)')
        : String(response);
      mountTutor(coachSlot, unit, q, { learnerAnswer, correct: grade.correct, chosenIndex: q.type === 'mc' ? selected : null, history });
    } else {
      coachSlot.innerHTML = '<section class="coach-card"><h3>Astra AI coach</h3><p>Your answer is recorded. Astra can review it with you when this check is complete.</p></section>';
    }
    $('.next-btn', fbArea).addEventListener('click', () => done({ correct: grade.correct, hintsUsed: countedHints, response }));
    $('.next-btn', fbArea).focus();
  });
}

// ---------------------------------------------------------------- views: home
// Match only explicit topic words; a Canvas title is a pacing hint, never proof
// of mastery. The learner can always choose a different unit.
function canvasPaceHtml() {
  if (!CANVAS.connected || !CANVAS.insights) return '<span class="kicker">School pace</span><h2>Bring your schoolwork into focus</h2><p>Canvas can suggest what to study next using upcoming work. Your independent learning stays open.</p><a class="btn secondary" href="#/canvas">Open Canvas planner</a>';
  const ins = CANVAS.insights;
  const items = [...ins.plan.overdueOpen, ...ins.plan.buckets.flatMap((b) => b.items)];
  const next = items[0];
  if (!next) return '<span class="kicker">School pace</span><h2>Room to explore</h2><p>No open deadlines in the selected Canvas view for the next five days. Choose any learning module.</p><a class="btn secondary" href="#/canvas">Change Canvas course</a>';
  const topicRules = [
    [10, /series|taylor|maclaurin|convergence/i], [9, /polar|parametric|vector/i],
    [7, /differential equation|slope field|euler|logistic/i], [8, /volume|washer|cross.section|area between|arc length/i],
    [6, /integral|integration|riemann|trapezoid|accumulation/i], [5, /mean value|extrema|concavity|curve sketch/i],
    [4, /related rates|linearization|motion/i], [3, /chain rule|implicit|inverse function/i],
    [2, /derivative|differentiation/i], [1, /limit|continuity/i],
  ];
  const match = topicRules.find(([, pattern]) => pattern.test(next.name));
  const unit = match && allUnits().find((u) => u.number === match[0]);
  return '<span class="kicker">School pace · Canvas</span><h2>' + esc(next.name) + '</h2><p>' + esc(next.courseName) + (next.dueAt ? ' · Due ' + esc(canvasDateTime(next.dueAt)) : '') + '</p>' +
    (unit ? '<p>Suggested from the assignment title: Unit ' + unit.number + ', ' + esc(unit.title) + '.</p><a class="btn" href="#/unit/' + unit.id + '">Explore this topic</a> ' : '') +
    '<a class="btn secondary" href="#/canvas/plan">See my school plan</a>';
}

function mountSpatialSection(parent) {
  const details = document.createElement('details');
  details.className = 'card spatial-disclosure';
  details.innerHTML = '<summary>Open the 3D Vector Lab · rotate, play, explore</summary><div class="spatial-slot"></div>';
  const host = $('.spatial-slot', details);
  let cleanup = null, generation = 0;
  const dispose = () => { generation += 1; cleanup?.(); cleanup = null; host.innerHTML = ''; };
  spatialCleanup = dispose;
  details.addEventListener('toggle', async () => {
    if (!details.open) { dispose(); return; }
    const current = ++generation;
    host.innerHTML = '<p>Opening the 3D lab.</p>';
    try {
      const { mountSpatialLab } = await import('/spatial-lab.js');
      if (current !== generation || !details.open || !details.isConnected) return;
      host.innerHTML = '';
      cleanup = mountSpatialLab(host, { motion: document.documentElement.dataset.motion, mastery: Math.max(0, ...allUnits().map((u) => E.unitMastery(S, u))) });
    } catch {
      if (current === generation && details.isConnected) host.innerHTML = '<p>The 3D lab could not load. The interactive 2D graphs remain available.</p>';
    }
  });
  parent.appendChild(details);
}

function viewHome() {
  const m = CONTENT.manifest;
  const units = allUnits();
  const metas = unitsForSubject(m, S.settings.subject);
  const name = S.settings.name ? ', ' + esc(S.settings.name) : '';
  const due = E.reviewQueue(S, units, Date.now(), m.reviewAfterDays);
  const average = units.length ? Math.round(units.reduce((sum, u) => sum + E.unitMastery(S, u), 0) / units.length) : 0;
  const passed = units.filter((u) => S.unitsPassed[u.id]).length;
  const next = [...units].filter((u) => !S.unitsPassed[u.id]).sort((a, b) => E.unitMastery(S, b) - E.unitMastery(S, a) || a.number - b.number)[0] || units[0];
  const cards = metas.map((meta) => {
    const unit = activeUnit(meta.id);
    const complete = Boolean(S.unitsPassed[meta.id]);
    const mastery = unit ? E.unitMastery(S, unit) : 0;
    return '<article class="card unit-card ' + (complete ? 'passed' : '') + '"><div class="unit-num" aria-hidden="true">' + String(meta.number).padStart(2, '0') + '</div><div class="unit-body"><div class="unit-title-row"><h3>' + esc(meta.title) + '</h3>' + (meta.bcOnly ? '<span class="tag bc">BC extension</span>' : '') + '</div><p>' + esc(meta.blurb) + '</p>' + bar('Skill progress', mastery, 100, { done: complete }) + '<div class="btn-row"><a class="btn secondary" href="#/unit/' + meta.id + '">Open module</a><span class="tag ' + (complete ? 'passed' : '') + '">' + (complete ? 'Mastery check passed' : 'Open to explore') + '</span></div></div></article>';
  }).join('');
  const v = mountView(
    '<section class="dashboard-hero"><div><span class="kicker">Students4AI / ' + esc(subjectLabel()) + '</span><h1>Your next idea starts here' + name + '.</h1><p>Move a graph. Test a prediction. Build understanding.</p><p>Practice adapts to your answers. Canvas helps set your pace. Every module stays open.</p><div class="btn-row">' + (next ? '<a class="btn" href="#/practice/' + next.id + '">Continue learning</a>' : '') + '<a class="btn secondary" href="#/canvas/plan">My school plan</a></div></div></section>' +
    '<div class="dashboard-stats"><div><strong>' + units.length + '</strong><span>open modules</span></div><div><strong>' + average + '<small> / 100</small></strong><span>average skill progress</span></div><div><strong>' + passed + '</strong><span>mastery checks passed</span></div><div><strong>' + due.length + '</strong><span>skills ready for review</span></div></div>' +
    (CONTENT.failed.length ? '<div class="card"><p>' + esc(CONTENT.failed.join('; ')) + '</p></div>' : '') +
    '<div id="home-study-lab"></div><div class="unit-grid"><section class="card" id="school-pace">' + canvasPaceHtml() + '</section><section class="card"><span class="kicker">Your learning pace</span><h2>' + (average >= 80 ? 'Explain. Connect. Extend.' : average >= 35 ? 'Make the next connection' : 'Try an idea, then test it') + '</h2><p>' + (average >= 80 ? 'Practice now emphasizes harder applications. Try independent AP-style questions and explain your reasoning.' : 'Adaptive practice returns to skills that need attention and increases difficulty as your answers show understanding.') + '</p><div class="btn-row">' + (next ? '<a class="btn secondary" href="#/practice/' + next.id + '">Practice at my level</a>' : '') + '<a class="btn quiet" href="#/review">Review skills</a></div></section></div>' +
    '<h2>Explore your modules</h2><p>Lessons, practice, and mastery checks are available from the start. Pick a topic because it interests you or because schoolwork needs it.</p><div class="unit-grid">' + cards + '</div>' +
    (!units.length ? '<div class="card"><h3>Physics workspace</h3><p>Choose a physics course in the Canvas dropdown for its assignments, modules, and grades. The independent question library currently covers AP Calculus AB and BC; a physics curriculum has not been added yet.</p><a class="btn" href="#/canvas">Open physics in Canvas</a></div>' : '<details class="card"><summary>Optional placement check</summary><p>Get a starting estimate of familiar units. It does not restrict what you can open, and you can stop at any time.</p><a class="btn secondary" href="#/diagnostic">Start placement check</a></details>'),
    { breadcrumb: ['Home'], nav: 'home' });
  labCleanup = mountStudyLab($('#home-study-lab', v), { motion: document.documentElement.dataset.motion, course: S.settings.subject === 'calculus-ab' ? 'ab' : S.settings.subject === 'physics' ? 'physics' : 'bc', mastery: average });
  if (S.settings.subject !== 'calculus-ab') mountSpatialSection($('#home-study-lab', v));
  const focusEntry = document.createElement('section');
  focusEntry.className = 'card focus-entry';
  focusEntry.innerHTML = '<div><span class="kicker">Make time for one next step</span><h2>Choose a short study session</h2><p>Set the time you have, choose one task, and use a small checklist. Pause whenever you need.</p></div><a class="btn" href="#/focus">Plan my study session</a>';
  v.insertBefore(focusEntry, $('.dashboard-stats', v));
  S.lastLocation = '#/home'; save();
}

async function viewFocus() {
  const v = mountView('<h1>One session, one next step</h1><p>Choose the time you have and one thing to work on. This plan is a starting point you can change.</p><div id="focus-slot"><p>Opening the session planner.</p></div>', { breadcrumb: ['Home', 'Study session'], nav: 'focus' });
  const host = $('#focus-slot', v);
  const profileId = activeProfile;
  try {
    const { mountFocusPlanner } = await import('/focus-planner.js');
    if (!host.isConnected || profileId !== activeProfile) return;
    const ins = CANVAS.insights;
    const task = ins && [...ins.plan.overdueOpen, ...ins.plan.buckets.flatMap((b) => b.items), ...ins.plan.later][0];
    const unit = [...allUnits()].filter((u) => !S.unitsPassed[u.id]).sort((a, b) => E.unitMastery(S, b) - E.unitMastery(S, a) || a.number - b.number)[0] || allUnits()[0];
    host.innerHTML = '';
    focusCleanup = mountFocusPlanner(host, {
      profileId, subject: S.settings.subject, courseLabel: subjectLabel(),
      canvasTask: task ? { name: task.name, dueLabel: task.dueAt ? canvasDateTime(task.dueAt) : 'No due date', href: task.htmlUrl || '#/canvas/plan' } : null,
      suggestedUnit: unit ? { id: unit.id, title: unit.title } : null,
    });
  } catch {
    if (host.isConnected) host.innerHTML = '<p>The study planner could not load. You can still choose a task from <a href="#/canvas/plan">Canvas</a> or open any learning module.</p>';
  }
}

// ---------------------------------------------------------------- views: unit
// Recurring errors, stated plainly. Shown on every unit page in the same place
// so the learner always knows where to look; the empty state says what would appear.
function patternsHtml(unit) {
  const p = E.unitPatterns(S, unit);
  if (!p.repeated.length && !p.skills.length) {
    return `<p>Nothing repeated yet. This section lists any wrong choice you have picked more than once on the same question, with the specific error it comes from, and any skill with several wrong answers among its last ${E.RECENT_WINDOW}.</p>`;
  }
  const skillName = (id) => esc(unit.skills.find((s) => s.id === id)?.name || id);
  const repeated = p.repeated.map(({ question, choices }) => `<li>
      <strong>${skillName(question.skillId)}</strong> — question ${esc(question.id)}:
      ${choices.map((c) => `choice ${'ABCDE'[c.index]} picked ${c.count} times. ${c.misconception ? `This choice comes from: ${c.misconception}` : ''}`).join(' ')}
      <details><summary>Show the question</summary>${question.prompt}</details>
    </li>`).join('');
  const skills = p.skills.map((x) => `<li><strong>${esc(x.skill.name)}</strong>: ${x.recentWrong} of the last ${x.recentTotal} answers were wrong (mastery ${x.score} / 100). Practice serves this skill first until it recovers.</li>`).join('');
  return `${repeated ? `<p><strong>Same wrong choice, more than once:</strong></p><ul class="rules-list">${repeated}</ul>` : ''}
    ${skills ? `<p><strong>Skills with several recent wrong answers:</strong></p><ul class="rules-list">${skills}</ul>` : ''}
    <p class="session-progress">These are counts, not judgments. They exist so the specific error can be named and practiced.</p>`;
}

function mountFreeResponses(unit) {
  const skillIds = new Set(unit.skills.map((s) => s.id));
  const questions = CONTENT.freeResponse.filter((q) => q.unitId === unit.id && q.skillIds.every((id) => skillIds.has(id)));
  if (!questions.length) return;
  const section = document.createElement('section');
  section.innerHTML = `<h2>AP-style free response</h2><p>Original multipart challenges with reasoning and point-by-point rubrics. These are self-checked; they do not change your verified mastery score or predict an AP exam score.</p>`;
  for (const q of questions) {
    const saved = S.freeResponses?.[q.id] || {};
    const article = document.createElement('article');
    article.className = 'card frq-card';
    article.innerHTML = `<span class="tag">${q.points} points · ${calculatorLabel(q.calculatorPolicy)}</span><h3>${esc(q.title)}</h3><div class="q-prompt">${q.prompt}</div>${q.parts.map((part, index) => `<section class="frq-part"><h4>Part ${esc(part.label)} · ${part.points} points</h4><div class="q-prompt">${part.prompt}</div><label>Your reasoning<textarea rows="4" data-part="${index}" maxlength="8000" placeholder="Write equations, explain your method, and include units when needed.">${esc(saved[index] || '')}</textarea></label></section>`).join('')}<div class="btn-row"><button type="button" class="secondary reveal-rubric">Compare with the scoring guide</button></div><div class="frq-rubric" hidden></div>`;
    article.querySelectorAll('textarea').forEach((input) => input.addEventListener('input', () => {
      S.freeResponses ||= {};
      S.freeResponses[q.id] ||= {};
      S.freeResponses[q.id][input.dataset.part] = input.value;
      save();
    }));
    const tutor = document.createElement('div');
    article.appendChild(tutor);
    mountTutor(tutor, unit, q, { phase: 'before-answer', selfCheck: true });
    $('.reveal-rubric', article).addEventListener('click', (event) => {
      const guide = $('.frq-rubric', article);
      guide.hidden = !guide.hidden;
      event.target.textContent = guide.hidden ? 'Compare with the scoring guide' : 'Hide scoring guide';
      if (!guide.innerHTML) {
        guide.innerHTML = `<p><strong>Self-check:</strong> award a point only when your written work meets its criterion. An unchecked point is a useful next practice target.</p>${q.parts.map((part) => `<h4>Part ${esc(part.label)}</h4><ol class="solution-steps">${part.solution.map((step) => `<li>${step.text}${step.math ? `<div class="step-math">$$${step.math}$$</div>` : ''}</li>`).join('')}</ol><div>${part.rubric.map((r) => `<label class="rubric-item"><input type="checkbox" data-points="${r.points}"> ${r.criterion} <span class="tag">${r.points} point${r.points === 1 ? '' : 's'}</span></label>`).join('')}</div>`).join('')}<p class="self-score" aria-live="polite">Self-check: 0 / ${q.points} points.</p>`;
        guide.querySelectorAll('input[type="checkbox"]').forEach((box) => box.addEventListener('change', () => {
          const score = [...guide.querySelectorAll('input:checked')].reduce((n, b) => n + Number(b.dataset.points), 0);
          $('.self-score', guide).textContent = `Self-check: ${score} / ${q.points} points. This is your rubric review, not an automatically verified score.`;
        }));
        renderMath(guide);
      }
    });
    section.appendChild(article);
  }
  viewEl().appendChild(section);
  renderMath(section);
}

function viewUnit(requestedId) {
  const unit = activeUnit(requestedId);
  const m = CONTENT.manifest;
  if (!unit) return mountView(`<h1>Unit not found</h1><p>That unit did not load. <a href="#/home">Back to Home</a>.</p>`, { breadcrumb: ['Home'] });
  const unitId = unit.id; // canonical id from content, not from the URL hash
  const eligible = E.masteryCheckEligible(S, unit);
  const passed = Boolean(S.unitsPassed[unitId]);
  const recommended = E.masteryRecommended(S, unit);
  const lessonRows = unit.lessons.map((l) => {
    const doneAt = S.lessons[l.id];
    return `<div class="card subtle">
      <div class="unit-title-row"><h3 style="margin:0">${doneAt ? '✓ ' : ''}${esc(l.title)}</h3><span class="tag">${doneAt ? 'Completed' : `about ${l.estMinutes} min`}</span></div>
      <div class="btn-row"><a class="btn ${doneAt ? 'secondary' : ''}" href="#/lesson/${unitId}/${l.id}">${doneAt ? 'Reopen lesson' : 'Start lesson'}</a></div>
    </div>`;
  }).join('');

  mountView(`
    <h1>Unit ${unit.number}: ${esc(unit.title)}</h1>
    <p>${unit.overview}</p>
    ${whatsNext(passed
      ? `This unit is passed. You can keep practicing here any time, or continue to the next unit from <a href="#/home">Home</a>.`
      : eligible
        ? `The <strong>Mastery Check</strong> is available with separate AP-style questions. ${recommended ? "Your practice suggests you are ready to try it." : "You can explore it now or build confidence with practice first."}`
        : `Explore the lessons and animated graphs, or start adaptive practice. All units stay available. The separate mastery bank for this view could not be loaded; reload to retry.`)}
    <h2>Skills in this unit</h2>
    <div class="card">${skillBars(unit)}
      <p class="session-progress">Mastery is earned by answering correctly without hints, including at difficulty 2 or higher. Wrong answers lower the score; later correct answers raise it again.</p>
    </div>
    <h2>Patterns in your answers</h2>
    <div class="card">${patternsHtml(unit)}</div>
    <h2>Interactive explorers</h2>
    <div class="card">
      <p>Play an animation, change a parameter, and watch the math respond. Pause at any point to inspect the graph and its data table. Motion controls are available in Settings.</p>
      <div id="explorer-slots"></div>
    </div>
    <h2>Lessons</h2>
    ${lessonRows}
    <h2>Practice</h2>
    <div class="card">
      <p>A practice set has ${m.practiceSetSize} questions. Each question is chosen from your lowest-scoring skill at that skill's current difficulty level.</p>
      <div class="btn-row"><a class="btn" href="#/practice/${unitId}">Start a practice set</a></div>
    </div>
    <h2>Mastery Check</h2>
    <div class="card">
      <p><strong>The rules, in full:</strong></p>
      <ul class="rules-list">
        <li>${unit.masteryCheck.questionCount} original AP-style questions, drawn from a separate mastery bank at difficulty 2 and 3. These are not the practice questions.</li>
        <li>You need ${unit.masteryCheck.passCount} correct to pass.</li>
        <li>No time limit. Astra can help during the check; using coach help marks the attempt assisted and it cannot earn an independent pass.</li>
        <li>Results and full solutions appear after the last question, not during.</li>
        <li>Retakes prioritize questions you have seen least recently. Questions can repeat when the bank is exhausted. Your completed work stays saved.</li>
      </ul>
      ${passed ? `<p class="tag passed" style="display:inline-block">Passed on ${new Date(S.unitsPassed[unitId].passedAt).toLocaleDateString()}</p>` : ''}
      ${eligible
        ? `<div class="btn-row"><a class="btn" href="#/mastery/${unitId}">${passed ? 'Retake' : 'Start'} the Mastery Check</a></div>`
        : `<p>The separate mastery bank for this course is incomplete or could not load. Lessons and practice stay open.</p>`}
    </div>
  `, { breadcrumb: ['Home', `Unit ${unit.number}: ${unit.title}`], nav: 'home' });

  // Explorers are visible immediately; motion settings control playback.
  const slots = $('#explorer-slots');
  for (const vid of explorersFor(unit)) {
    const details = document.createElement('details');
    details.className = 'explorer-details';
    details.innerHTML = `<summary>${explorerTitle(vid)}</summary><div class="explorer-body"></div>`;
    details.addEventListener('toggle', () => {
      const body = details.querySelector('.explorer-body');
      if (details.open && !body.dataset.mounted) {
        body.dataset.mounted = '1';
        mountExplorer(body, vid);
      }
    });
    slots.appendChild(details);
    details.open = true;
  }
  mountFreeResponses(unit);
  if (unit.number === 9) mountSpatialSection($('#explorer-slots').parentElement);
  S.lastLocation = `#/unit/${unitId}`; save();
}

// -------------------------------------------------------------- views: lesson
function viewLesson(requestedUnitId, requestedLessonId) {
  const unit = activeUnit(requestedUnitId);
  const lesson = unit?.lessons.find((l) => l.id === requestedLessonId);
  if (!unit || !lesson) return mountView(`<h1>Lesson not found</h1><p><a href="#/home">Back to Home</a></p>`, { breadcrumb: ['Home'] });
  const unitId = unit.id, lessonId = lesson.id; // canonical ids from content

  const idx = unit.lessons.indexOf(lesson);
  const next = unit.lessons[idx + 1];

  const sectionsHtml = lesson.sections.map((sec, i) => {
    if (sec.type === 'concept') return `<div class="section">${sec.html}</div>`;
    if (sec.type === 'coder-note') return `<div class="section coder-note"><span class="kicker">// for coders</span>${sec.html}</div>`;
    if (sec.type === 'worked-example') {
      return `<div class="section worked-example"><h3>Worked example: ${esc(sec.title)}</h3>
        <ol class="solution-steps">${sec.steps.map((st) => `<li>${st.text}${st.math ? `<div class="step-math">$$${st.math}$$</div>` : ''}</li>`).join('')}</ol></div>`;
    }
    if (sec.type === 'checkpoint') return `<div class="section checkpoint" data-sec="${i}"><h3>Check your understanding</h3><div class="checkpoint-slot"></div></div>`;
    return '';
  }).join('');

  const v = mountView(`
    <h1>${esc(lesson.title)}</h1>
    <p class="session-progress">Unit ${unit.number}, lesson ${idx + 1} of ${unit.lessons.length} · about ${lesson.estMinutes} minutes · checkpoints count toward mastery, and hints are allowed.</p>
    ${sectionsHtml}
    <div class="card">
      <div class="btn-row">
        <button type="button" id="lesson-done" class="${S.lessons[lessonId] ? 'secondary' : ''}">${S.lessons[lessonId] ? 'Lesson already completed — mark again' : 'Mark this lesson complete'}</button>
        <a class="btn secondary" href="#/unit/${unitId}">Back to Unit ${unit.number}</a>
        ${next ? `<a class="btn quiet" href="#/lesson/${unitId}/${next.id}">Next lesson: ${esc(next.title)}</a>` : ''}
      </div>
    </div>
  `, { breadcrumb: ['Home', `Unit ${unit.number}`, lesson.title], nav: 'home' });

  // Mount checkpoint questions in place, one after another within each slot.
  lesson.sections.forEach((sec, i) => {
    if (sec.type !== 'checkpoint') return;
    const slot = $(`.checkpoint[data-sec="${i}"] .checkpoint-slot`, v);
    const qs = sec.questionIds.map((qid) => questionById(unit, qid)).filter(Boolean);
    let k = 0;
    const nextQ = () => {
      if (k >= qs.length) {
        slot.insertAdjacentHTML('beforeend', `<p class="session-progress">Checkpoint finished (${qs.length} of ${qs.length}).</p>`);
        return;
      }
      const holder = document.createElement('div');
      slot.appendChild(holder);
      mountQuestion(holder, unit, qs[k], { hintsAllowed: true, index: k + 1, total: qs.length }, () => { k += 1; nextQ(); });
    };
    nextQ();
  });

  $('#lesson-done', v).addEventListener('click', () => {
    S.lessons[lessonId] = Date.now();
    save();
    location.hash = `#/unit/${unitId}`;
  });
  S.lastLocation = `#/lesson/${unitId}/${lessonId}`; save();
}

// ------------------------------------------------------------ views: practice
function viewPractice(requestedId) {
  const unit = activeUnit(requestedId);
  const m = CONTENT.manifest;
  if (!unit) return mountView(`<h1>Unit not found</h1><p><a href="#/home">Back to Home</a></p>`, { breadcrumb: ['Home'] });
  const unitId = unit.id; // canonical id from content
  const setSize = m.practiceSetSize;
  const before = Object.fromEntries(unit.skills.map((sk) => [sk.id, E.masteryScore(S, sk.id)]));
  const recentIds = [];
  const results = [];

  const v = mountView(`
    <h1>Practice: Unit ${unit.number}</h1>
    <p class="session-progress" id="set-progress">A set is ${setSize} questions. Hints are allowed; solving without hints counts fully toward mastery.</p>
    <div id="timer-slot" class="btn-row"></div>
    <div id="q-slot"></div>
  `, { breadcrumb: ['Home', `Unit ${unit.number}`, 'Practice'], nav: 'home' });
  startTimerIfEnabled($('#timer-slot', v));

  const slot = $('#q-slot', v);
  const askNext = () => {
    if (results.length >= setSize) return showSummary();
    const q = E.pickPracticeQuestion(S, unit, recentIds);
    if (!q) return showSummary();
    recentIds.push(q.id);
    if (recentIds.length > 3) recentIds.shift();
    slot.innerHTML = '';
    mountQuestion(slot, unit, q, { hintsAllowed: true, index: results.length + 1, total: setSize }, (r) => {
      results.push({ q, ...r });
      let streak = 0;
      for (let i = results.length - 1; i >= 0 && results[i].correct; i--) streak += 1;
      const sp = $('#set-progress', v);
      if (sp) sp.textContent = `${results.filter((x) => x.correct).length} of ${results.length} correct so far${streak >= 2 ? ` · ${streak} consecutive correct` : ''}.`;
      askNext();
    });
  };

  const showSummary = () => {
    const correct = results.filter((r) => r.correct).length;
    const skillsTouched = [...new Set(results.map((r) => r.q.skillId))];
    const deltas = skillsTouched.map((sid) => {
      const after = E.masteryScore(S, sid);
      const d = after - (before[sid] ?? 0);
      return `<li>${esc(skillName(unit, sid))}: ${before[sid] ?? 0} → ${after} (${d >= 0 ? '+' : ''}${d})</li>`;
    }).join('');
    const eligible = E.masteryCheckEligible(S, unit);
    slot.innerHTML = `<div class="card">
      <h2>Set complete: ${correct} of ${results.length} correct</h2>
      <p>Mastery changes this set:</p>
      <ul class="rules-list">${deltas}</ul>
      ${whatsNext(eligible
        ? `Try the <strong>Mastery Check</strong> with questions from the separate AP-style bank, or continue adaptive practice.`
        : `Practice continues to adapt as you learn. All lessons and units remain available.`)}
      <div class="btn-row">
        <button type="button" id="another-set">Another set</button>
        ${eligible ? `<a class="btn" href="#/mastery/${unitId}">Start the Mastery Check</a>` : ''}
        <a class="btn secondary" href="#/unit/${unitId}">Back to Unit ${unit.number}</a>
      </div>
    </div>`;
    renderMath(slot);
    $('#another-set', slot).addEventListener('click', () => viewPractice(unitId));
    announce(`Practice set complete. ${correct} of ${results.length} correct.`);
  };

  askNext();
  S.lastLocation = `#/practice/${unitId}`; save();
}

// ------------------------------------------------------------- views: mastery
function viewMastery(requestedId) {
  const unit = activeUnit(requestedId);
  if (!unit) return mountView(`<h1>Unit not found</h1><p><a href="#/home">Back to Home</a></p>`, { breadcrumb: ['Home'] });
  const unitId = unit.id; // canonical id from content
  if (!E.masteryCheckEligible(S, unit)) {
    return mountView(`<h1>Mastery question bank unavailable</h1>
      <p>The separate question bank could not supply a complete check for this view. Reload to try loading it again. <a href="#/unit/${unitId}">Back to the unit</a>.</p>`,
      { breadcrumb: ['Home', `Unit ${unit.number}`, 'Mastery Check'], nav: 'home' });
  }
  const { questionCount, passCount } = unit.masteryCheck;

  const v = mountView(`
    <h1>Mastery Check: Unit ${unit.number}</h1>
    <div class="card">
      <p><strong>Exactly what will happen:</strong></p>
      <ul class="rules-list">
        <li>${questionCount} questions, one at a time. You need ${passCount} correct to pass.</li>
        <li>No time limit. Astra is available on every question. Receiving coach help marks the check assisted; it cannot earn an independent pass.</li>
        <li>After each answer you will only see "answer recorded".</li>
        <li>After question ${questionCount}, you get full results with every solution.</li>
        <li>Passing records a completed mastery check. All modules stay open, whatever your score. Retakes prefer less recently seen questions and may repeat items.</li>
      </ul>
      <div class="btn-row">
        <button type="button" id="start-check">Start now</button>
        <a class="btn secondary" href="#/unit/${unitId}">Go back instead</a>
      </div>
    </div>
    <div id="timer-slot" class="btn-row"></div>
    <div id="q-slot"></div>
  `, { breadcrumb: ['Home', `Unit ${unit.number}`, 'Mastery Check'], nav: 'home' });

  $('#start-check', v).addEventListener('click', () => {
    $('#start-check', v).closest('.card').remove();
    startTimerIfEnabled($('#timer-slot', v));
    const questions = E.sampleMasteryCheck(unit, Math.random, S);
    const answers = [];
    const slot = $('#q-slot', v);
    const ask = () => {
      if (answers.length >= questions.length) return finish();
      const q = questions[answers.length];
      slot.innerHTML = '';
      mountQuestion(slot, unit, q, { hintsAllowed: false, deferFeedback: true, index: answers.length + 1, total: questions.length }, (r) => {
        answers.push({ q, ...r });
        ask();
      });
    };
    const finish = () => {
      const correct = answers.filter((a) => a.correct).length;
      const assisted = answers.some((answer) => answer.hintsUsed > 0);
      const passed = E.recordMasteryCheck(S, unit, correct, questions.length, Date.now(), { assisted });
      save();
      const weakSkills = [...new Set(answers.filter((a) => !a.correct).map((a) => a.q.skillId))];
      const reviewHtml = answers.map((a, i) => `
        <details class="card subtle">
          <summary>Question ${i + 1}: ${a.correct ? 'correct' : 'not correct'} — ${esc(skillName(unit, a.q.skillId))}</summary>
          <div class="q-prompt">${a.q.prompt}</div>
          ${a.q.type === 'mc'
            ? `<p>Your answer: ${a.response !== null && a.response !== undefined ? a.q.choices[a.response] : '(none)'} · Correct answer: ${a.q.choices[a.q.answerIndex]}</p>`
            : `<p>Your answer: ${esc(String(a.response))} · Correct answer: ${a.q.answer}</p>`}
          <ol class="solution-steps">${a.q.solution.map((st) => `<li>${st.text}${st.math ? `<div class="step-math">$$${st.math}$$</div>` : ''}</li>`).join('')}</ol>
          <div class="mastery-tutor-slot" data-index="${i}"></div>
        </details>`).join('');
      slot.innerHTML = `<div class="card">
        <h2>${assisted ? `Assisted check complete: ${correct} of ${questions.length}.` : passed ? `Passed: ${correct} of ${questions.length}.` : `Not passed yet: ${correct} of ${questions.length}. You need ${passCount}.`}</h2>
        ${assisted ? '<p>Astra helped with this attempt, so the score is saved as assisted learning. Try another check without coach help when you want to measure independent mastery. Any earlier pass stays saved.</p>' : ''}
        ${passed
          ? `<p>Your mastery check for Unit ${unit.number} is complete. Continue to any module or try a free-response challenge.</p>`
          : `<p>Your completed lessons and passed checks stay saved. These answers also help adapt future practice. Skills to practice: ${weakSkills.map((sid) => esc(skillName(unit, sid))).join(', ') || '—'}.</p>`}
        <div class="btn-row">
          ${passed
            ? (allUnits().some((u) => u.number === unit.number + 1) ? `<a class="btn" href="#/unit/unit-${String(unit.number + 1).padStart(2, '0')}">Go to Unit ${unit.number + 1}</a>` : `<a class="btn" href="#/home">Back to Home</a>`)
            : `<a class="btn" href="#/practice/${unitId}">Practice the listed skills</a><button type="button" class="secondary" id="retake-btn">Retake mastery check</button>`}
          <a class="btn quiet" href="#/unit/${unitId}">Back to Unit ${unit.number}</a>
        </div>
      </div>
      <h2>Every question, with solutions</h2>
      ${reviewHtml}`;
      renderMath(slot);
      slot.querySelectorAll('.mastery-tutor-slot').forEach((holder) => {
        const answer = answers[Number(holder.dataset.index)];
        mountTutor(holder, unit, answer.q, { phase: 'after-answer', learnerAnswer: String(answer.response), chosenIndex: answer.q.type === 'mc' ? answer.response : null, correct: answer.correct });
      });
      const retake = $('#retake-btn', slot);
      if (retake) retake.addEventListener('click', () => viewMastery(unitId));
      announce(assisted ? `Assisted check complete, ${correct} of ${questions.length}.` : passed ? `Mastery check passed, ${correct} of ${questions.length}.` : `Mastery check: ${correct} of ${questions.length}. ${passCount} needed.`);
      window.scrollTo(0, 0);
    };
    ask();
  });
  S.lastLocation = `#/unit/${unitId}`; save();
}

// ---------------------------------------------------------- views: diagnostic
function viewDiagnostic() {
  const units = allUnits();
  const v = mountView(`
    <h1>Placement check</h1>
    <div class="card">
      <p><strong>Exactly how this works:</strong></p>
      <ul class="rules-list">
        <li>Questions come unit by unit, starting at Unit 1: two questions per unit, plus a third only if you answer exactly one of the first two correctly.</li>
        <li>A unit counts as placed when you answer 2 of its questions correctly without coach help. Astra is available; helped answers count as assisted learning and do not place a unit. You see whether you were right after each question.</li>
        <li>The check stops at the first unit that is not placed, or whenever you press "Stop here". Stopping early does not remove any progress.</li>
        <li>Result: familiar units are marked passed by placement. Every unit stays open, and you can practice or review any time.</li>
      </ul>
      <div class="btn-row"><button type="button" id="diag-start">Begin with Unit 1</button><a class="btn secondary" href="#/home">Not now</a></div>
    </div>
    <div id="q-slot"></div>
  `, { breadcrumb: ['Home', 'Placement check'], nav: 'home' });

  $('#diag-start', v).addEventListener('click', () => {
    $('#diag-start', v).closest('.card').remove();
    const slot = $('#q-slot', v);
    let unitIdx = 0;
    let placedThrough = 0;

    const runUnit = () => {
      if (unitIdx >= units.length) return finish();
      const unit = units[unitIdx];
      const core = E.unitCoreSkills(unit);
      const pool = unit.questions.filter((q) => q.difficulty === 2 && core.some((s) => s.id === q.skillId));
      const bySkill = new Map();
      for (const q of pool) if (!bySkill.has(q.skillId)) bySkill.set(q.skillId, q);
      const picks = [...bySkill.values()].slice(0, 3);
      if (picks.length < 2) { finish(); return; } // content too thin to place — stop cleanly
      let right = 0, asked = 0;
      const askOne = () => {
        const needThird = asked === 2 && right === 1;
        if (asked >= 2 && !needThird) {
          if (right >= 2) { placedThrough = unit.number; unitIdx += 1; runUnit(); }
          else finish();
          return;
        }
        if (needThird && picks.length < 3) { finish(); return; }
        const q = picks[asked];
        slot.innerHTML = `<h2>Unit ${unit.number}: ${esc(unit.title)}</h2>`;
        const holder = document.createElement('div');
        slot.appendChild(holder);
        mountQuestion(holder, unit, q, { hintsAllowed: false, index: asked + 1, total: needThird || asked === 2 ? 3 : 2 }, (r) => {
          asked += 1;
          if (r.correct && r.hintsUsed === 0) right += 1;
          if (asked === 3) {
            if (right >= 2) { placedThrough = unit.number; unitIdx += 1; runUnit(); }
            else finish();
            return;
          }
          askOne();
        });
        holder.insertAdjacentHTML('beforeend', `<div class="btn-row"><button type="button" class="quiet stop-btn">Stop here and apply my placement</button></div>`);
        $('.stop-btn', holder).addEventListener('click', finish);
      };
      askOne();
    };

    const finish = () => {
      E.applyDiagnosticPlacement(S, placedThrough, units, Date.now());
      save();
      slot.innerHTML = `<div class="card">
        <h2>Placement complete</h2>
        <p>${placedThrough === 0
          ? 'You start at Unit 1. Unit 1 is the starting point for every learner who is not placed past it. No progress was removed.'
          : `Units 1 through ${placedThrough} are marked passed by placement. ${units.some((u) => u.number > placedThrough) ? `Your next suggested module is Unit ${placedThrough + 1}.` : 'You can explore any module or try a mastery challenge.'}`}</p>
        <div class="btn-row"><a class="btn" href="#/home">Go to Home</a>
        ${units.some((u) => u.number > placedThrough) ? `<a class="btn secondary" href="#/unit/unit-${String(placedThrough + 1).padStart(2, '0')}">Open Unit ${placedThrough + 1}</a>` : ''}</div>
      </div>`;
      announce('Placement complete.');
    };

    runUnit();
  });
}

// -------------------------------------------------------------- views: review
function viewReview() {
  const m = CONTENT.manifest;
  const due = E.reviewQueue(S, allUnits(), Date.now(), m.reviewAfterDays);
  if (!due.length) {
    return mountView(`<h1>Review</h1>
      <p>Nothing is due for review right now. A skill appears here after it reaches mastery and then goes ${m.reviewAfterDays} days without being practiced. Review is recommended, never required; it never blocks progress.</p>
      <div class="btn-row"><a class="btn secondary" href="#/home">Back to Home</a></div>`,
      { breadcrumb: ['Home', 'Review'], nav: 'review' });
  }
  const sessionItems = due.slice(0, 6);
  const listed = due.map((d) => `<li>${esc(d.skill.name)} (Unit ${d.unit.number}) — last practiced ${new Date(d.lastSeen).toLocaleDateString()}</li>`).join('');
  const v = mountView(`
    <h1>Review</h1>
    <p>${due.length} skill${due.length > 1 ? 's are' : ' is'} due. This session covers up to ${sessionItems.length} of them, one question each, hints allowed.</p>
    <ul class="rules-list">${listed}</ul>
    <div class="btn-row"><button type="button" id="rev-start">Start review session</button><a class="btn secondary" href="#/home">Back to Home</a></div>
    <div id="q-slot"></div>
  `, { breadcrumb: ['Home', 'Review'], nav: 'review' });

  $('#rev-start', v).addEventListener('click', () => {
    $('#rev-start', v).disabled = true;
    const slot = $('#q-slot', v);
    let i = 0, correct = 0;
    const ask = () => {
      if (i >= sessionItems.length) {
        slot.innerHTML = `<div class="card"><h2>Review complete: ${correct} of ${sessionItems.length} correct</h2>
          <p>Each skill answered incorrectly now has a lower mastery score, so practice in that unit will select it more often. Nothing was locked.</p>
          <div class="btn-row"><a class="btn" href="#/home">Back to Home</a></div></div>`;
        announce('Review complete.');
        return;
      }
      const { unit, skill } = sessionItems[i];
      const seen = S.seenQuestions;
      const qs = unit.questions.filter((q) => q.skillId === skill.id && q.difficulty >= 2)
        .sort((a, b) => (seen[a.id]?.last || 0) - (seen[b.id]?.last || 0));
      const q = qs[0] || unit.questions.find((qq) => qq.skillId === skill.id);
      slot.innerHTML = '';
      mountQuestion(slot, unit, q, { hintsAllowed: true, index: i + 1, total: sessionItems.length }, (r) => {
        if (r.correct) correct += 1;
        i += 1; ask();
      });
    };
    ask();
  });
}

// ------------------------------------------------------------ views: settings
function viewSettings() {
  const s = S.settings;
  const v = mountView(`
    <h1>Settings</h1>
    <div class="card">
      <h2>Learner workspaces</h2>
      <p>Each workspace keeps its own practice history, course choice, and display settings. Switch learners using the dropdown above.</p>
      <form id="add-learner" class="numeric-row"><label>New learner name <input name="learnerName" type="text" maxlength="40" required></label><label>Starting course <select name="subject">${STUDY_SUBJECTS.map((course) => `<option value="${course.id}">${esc(course.label)}</option>`).join('')}</select></label><button type="submit">Add learner</button></form>
      <p class="session-progress">Each learner connects their own Canvas account from the Canvas tab. Switching learners also switches the Canvas connection. These are shared-device workspaces, without a separate sign-in for each learner.</p>
    </div>
    <div class="card">
      <h2>Display</h2>
      <p><label>Your name (used only for the greeting): <input id="set-name" type="text" value="${esc(s.name)}" style="font:inherit;padding:0.4rem;border:2px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)"></label></p>
      <p>Text size:
        ${['medium', 'large', 'xlarge'].map((t) => `<label style="margin-right:1rem"><input type="radio" name="textsize" value="${t}" ${s.textSize === t ? 'checked' : ''}> ${t === 'medium' ? 'Standard' : t === 'large' ? 'Large' : 'Extra large'}</label>`).join('')}
      </p>
      <p>Theme:
        ${['system', 'light', 'dark'].map((t) => `<label style="margin-right:1rem"><input type="radio" name="theme" value="${t}" ${s.theme === t ? 'checked' : ''}> ${t[0].toUpperCase()}${t.slice(1)}</label>`).join('')}
      </p>
      <fieldset class="motion-setting"><legend>Animation</legend>
        ${[['full', 'Animated — play graphs and simulations'], ['reduced', 'Reduced — start paused, play when ready'], ['off', 'Off — change graphs with controls only']].map(([value, label]) => `<label><input type="radio" name="motion" value="${value}" ${s.motion === value ? 'checked' : ''}> ${label}</label>`).join(' ')}
        <p class="session-progress">Your device’s reduced-motion preference also prevents automatic playback. Every animation has a pause control. No flashing or sound.</p>
      </fieldset>
      <p><label><input type="checkbox" id="set-timer" ${s.showTimer ? 'checked' : ''}> Show an elapsed-time counter during practice and mastery checks. It only counts up; nothing in this app has a time limit.</label></p>
    </div>
    <div class="card">
      <h2>How this app decides things</h2>
      <ul class="rules-list">
        <li>Mastery per skill is 0–100. Correct without hints raises it the most; hints give half credit; wrong answers lower it. Recent answers count more than old ones.</li>
        <li>A skill can only reach mastery (${E.MASTERY_THRESHOLD}) with correct answers at difficulty 2 or higher.</li>
        <li>All learning modules and complete mastery banks are open from the start. Mastery scores recommend a next step; they never close a module. Practice adapts its skill and difficulty choices to your answers.</li>
        <li>The app counts which wrong choice you picked on each question. Each unit page lists any choice picked twice or more under "Patterns in your answers", and the tutor (when enabled) is told those counts. These counts change nothing about scoring.</li>
        <li>Keyboard: Tab moves between controls, Enter or Space activates, Enter submits a typed answer.</li>
      </ul>
    </div>
    <div class="card">
      <h2>Your data</h2>
      <p>Progress is saved to this server and to this browser after every answer. It is not sent anywhere else.</p>
      <div class="btn-row">
        <button type="button" id="export-btn" class="secondary">Download my progress (JSON)</button>
        <label class="btn secondary" style="cursor:pointer">Import progress<input id="import-file" type="file" accept="application/json" class="visually-hidden"></label>
      </div>
      <h3>Erase progress</h3>
      <p><label><input type="checkbox" id="reset-confirm"> I understand this erases all progress and cannot be undone.</label></p>
      <div class="btn-row"><button type="button" id="reset-btn" disabled>Erase all progress</button></div>
    </div>
  `, { breadcrumb: ['Home', 'Settings'], nav: 'settings' });

  $('#add-learner', v).addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get('learnerName') || '').trim().slice(0, 40);
    if (!name || profiles.length >= 21) return;
    const id = `student-${crypto.randomUUID()}`;
    profiles.push({ id, name });
    try { localStorage.setItem('students4ai-profiles', JSON.stringify(profiles)); } catch { /* optional */ }
    await switchProfile(id);
    S.settings.name = name;
    S.settings.subject = normalizeSubjectId(form.get('subject'));
    if (CANVAS.snapshot) canvasRebuildInsights();
    save(); router();
  });
  $('#set-name', v).addEventListener('input', (e) => {
    S.settings.name = e.target.value.slice(0, 40);
    const profile = profiles.find((p) => p.id === activeProfile);
    if (profile) profile.name = S.settings.name || 'My workspace';
    try { localStorage.setItem('students4ai-profiles', JSON.stringify(profiles)); } catch { /* optional */ }
    save(); studyControls();
  });
  v.querySelectorAll('input[name="textsize"]').forEach((r) => r.addEventListener('change', (e) => { S.settings.textSize = e.target.value; applySettings(); save(); }));
  v.querySelectorAll('input[name="theme"]').forEach((r) => r.addEventListener('change', (e) => { S.settings.theme = e.target.value; applySettings(); save(); }));
  v.querySelectorAll('input[name="motion"]').forEach((r) => r.addEventListener('change', (e) => { S.settings.motion = e.target.value; applySettings(); save(); }));
  $('#set-timer', v).addEventListener('change', (e) => { S.settings.showTimer = e.target.checked; save(); });
  $('#export-btn', v).addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'calc-coach-progress.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#import-file', v).addEventListener('change', async (e) => {
    const importProfile = activeProfile;
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (importProfile !== activeProfile || switchingProfile) return;
      if (!parsed || typeof parsed !== 'object' || !parsed.skills) throw new Error('not a Students4AI progress file');
      S = ensureAppFields(parsed);
      CANVAS.selectedCourseId = null; CANVAS.assessment = null;
      if (CANVAS.snapshot) canvasRebuildInsights();
      applySettings(); save();
      location.hash = '#/home';
    } catch (err) {
      alert(`That file could not be imported: ${err.message}`);
    }
  });
  const resetChk = $('#reset-confirm', v);
  const resetBtn = $('#reset-btn', v);
  resetChk.addEventListener('change', () => { resetBtn.disabled = !resetChk.checked; });
  resetBtn.addEventListener('click', () => {
    S = ensureAppFields(E.newState());
    CANVAS.selectedCourseId = null; CANVAS.assessment = null;
    if (CANVAS.snapshot) canvasRebuildInsights();
    applySettings(); save();
    location.hash = '#/home';
  });
}

// ---------------------------------------------------------------- Canvas LMS
// Optional read-only view of the learner's Canvas courses, reformatted into
// a prioritized plan and a grade report by the pure rules in
// canvas-insights.js. The access token is posted once to this app's server
// and lives only in an expiring server-memory session; nothing Canvas-related
// is kept in S, localStorage, or the progress export, so exporting Calc
// Coach progress can never expose Canvas data. Course and assignment names
// are external data and are shown as Canvas reports them.
const CANVAS = { checked: false, connected: false, user: null, host: '', remembered: false, snapshot: null, insights: null, terms: [], termIds: null, prefs: null, assessment: null, selectedCourseId: null, note: '' };
let canvasGeneration = 0;
const staleCanvasRequest = (error) => error?.name === 'StaleCanvasRequest';
function resetCanvas() {
  canvasGeneration++;
  Object.assign(CANVAS, { checked: false, connected: false, user: null, host: '', remembered: false, snapshot: null, insights: null, terms: [], termIds: null, prefs: null, assessment: null, selectedCourseId: null, note: '' });
}

async function loadSchoolContext() {
  const generation = canvasGeneration;
  try {
    await canvasEnsureSession();
    if (generation !== canvasGeneration) return;
    if (CANVAS.connected && !CANVAS.snapshot) await canvasLoadSnapshot();
    if (generation !== canvasGeneration) return;
    const pace = $('#school-pace');
    if (pace) pace.innerHTML = canvasPaceHtml();
    if (location.hash.startsWith('#/canvas')) router();
  } catch { /* The optional Canvas view has its own retry controls. */ }
}

const canvasDateTime = (iso) => (iso ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : null);
const canvasDateOnly = (iso) => (iso ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso)) : null);

// One consistent lens: the insights are always built from the snapshot plus
// the current term selection (null = every term), the subject rule, and the
// learner's remembered show/hide choices.
function canvasRebuildInsights() {
  CANVAS.insights = CI.buildInsights(CANVAS.snapshot, Date.now(), {
    termIds: CANVAS.termIds || [],
    subjectFilter: true,
    selectedSubject: S.settings.subject,
    selectedCourseId: CANVAS.selectedCourseId,
    courseOverrides: (CANVAS.prefs && CANVAS.prefs.courseOverrides) || {},
  });
}

async function canvasEnsurePrefs() {
  if (CANVAS.prefs) return;
  try {
    const { res, data } = await canvasApi('/api/canvas/prefs');
    CANVAS.prefs = res.ok && data && data.courseOverrides ? { courseOverrides: data.courseOverrides } : { courseOverrides: {} };
  } catch (error) {
    if (staleCanvasRequest(error)) return;
    CANVAS.prefs = { courseOverrides: {} };
  }
}

// Records one show/hide choice, saves it on the server (survives restarts
// and disconnects), and rebuilds the lens.
async function canvasSetCourseOverride(courseId, value) {
  const overrides = { ...((CANVAS.prefs && CANVAS.prefs.courseOverrides) || {}) };
  overrides[String(courseId)] = value;
  CANVAS.prefs = { courseOverrides: overrides };
  try {
    await canvasApi('/api/canvas/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(CANVAS.prefs) });
  } catch (error) {
    if (staleCanvasRequest(error)) return;
    console.warn('Canvas preference save failed; the choice still applies until this page is reloaded.');
  }
  canvasRebuildInsights();
}

async function canvasApi(path, options) {
  const generation = canvasGeneration;
  const scopedPath = `${path}${path.includes('?') ? '&' : '?'}profile=${encodeURIComponent(activeProfile)}`;
  const ensureCurrent = () => {
    if (generation === canvasGeneration) return;
    const error = new Error('Learner changed while Canvas was loading.');
    error.name = 'StaleCanvasRequest';
    throw error;
  };
  let res;
  try { res = await fetch(scopedPath, options); }
  catch (error) { ensureCurrent(); throw error; }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body; status carries the meaning */ }
  ensureCurrent();
  return { res, data };
}

async function canvasEnsureSession() {
  if (CANVAS.checked) return;
  try {
    const { res, data } = await canvasApi('/api/canvas/session');
    if (res.ok) {
      CANVAS.connected = Boolean(data && data.connected);
      CANVAS.user = CANVAS.connected ? data.user : null;
      CANVAS.host = CANVAS.connected ? String(data.host || '') : '';
      CANVAS.remembered = Boolean(CANVAS.connected && data.remembered);
      CANVAS.checked = true; // only a definitive answer is cached
    } else {
      CANVAS.connected = false; // transient server trouble: probe again next visit
    }
  } catch (error) {
    if (staleCanvasRequest(error)) return;
    CANVAS.connected = false; // network hiccup: probe again next visit
  }
}

// Loads one consistent snapshot and computes the insights from it. Returns
// true on success; on failure it stores a calm note in CANVAS.note.
async function canvasLoadSnapshot() {
  const generation = canvasGeneration;
  try {
    const { res, data } = await canvasApi('/api/canvas/snapshot');
    if (res.status === 401) {
      CANVAS.connected = false; CANVAS.user = null; CANVAS.snapshot = null; CANVAS.insights = null;
      CANVAS.note = data && data.reason === 'auth'
        ? 'Canvas did not accept the stored token, so the connection was removed. Connect again with a current token.'
        : 'The Canvas connection has ended. This happens after 8 hours or when the server restarts. Connect again to load current data.';
      return false;
    }
    if (!res.ok) {
      CANVAS.note = (data && data.error) || 'Canvas data could not be loaded this time. Your calculus progress is not affected. Select Refresh to try again.';
      return false;
    }
    CANVAS.snapshot = data;
    await canvasEnsurePrefs();
    if (generation !== canvasGeneration) return false;
    // Canvas keeps courses from earlier school years in its active list, so
    // the views filter by term. The current term (by its Canvas dates) is
    // selected on each load; a still-valid manual selection is kept.
    CANVAS.terms = CI.termsFrom(data.courses);
    const validIds = new Set(CANVAS.terms.map((t) => t.id));
    if (CANVAS.termIds) CANVAS.termIds = CANVAS.termIds.filter((id) => validIds.has(id));
    if (!CANVAS.termIds || !CANVAS.termIds.length) {
      const current = CI.currentTermId(CANVAS.terms, Date.now());
      CANVAS.termIds = current ? [current] : null;
    }
    canvasRebuildInsights();
    CANVAS.note = '';
    return true;
  } catch (error) {
    if (staleCanvasRequest(error)) return false;
    CANVAS.note = 'Canvas data could not be loaded this time. Your calculus progress is not affected. Select Refresh to try again.';
    return false;
  }
}

const canvasNoteHtml = () => (CANVAS.note ? `<p class="canvas-note">${esc(CANVAS.note)}</p>` : '');

function canvasTabsHtml(active) {
  const tab = (href, key, label) => `<a class="canvas-tab${active === key ? ' active' : ''}" href="${href}">${label}</a>`;
  return `<nav class="canvas-tabs" aria-label="Canvas pages">${tab('#/canvas', 'overview', 'Overview')}${tab('#/canvas/plan', 'plan', 'The plan')}${tab('#/canvas/grades', 'grades', 'Grades')}${tab('#/canvas/assessment', 'assessment', 'Assessment')}</nav>`;
}

function canvasHeadHtml() {
  const name = CANVAS.user && CANVAS.user.name ? CANVAS.user.name : 'Canvas learner';
  const selectedCourse = CANVAS.snapshot?.courses.find((course) => course.id === CANVAS.selectedCourseId);
  const selectionLabel = selectedCourse?.name || (CANVAS.selectedCourseId === 'all' ? 'All Canvas courses' : subjectLabel());
  const asOf = CANVAS.snapshot ? ` · Data as of ${esc(canvasDateTime(CANVAS.snapshot.fetchedAt) || CANVAS.snapshot.fetchedAt)}.` : '';
  const remembered = CANVAS.remembered ? ' Connection remembered on this server.' : '';
  return `<div class="canvas-head">
    <h2>${esc(selectionLabel)}</h2>
    <p class="canvas-meta">${esc(S.settings.name || profiles.find((profile) => profile.id === activeProfile)?.name || 'This learner')}’s workspace · Connected to ${esc(CANVAS.host)} as ${esc(name)}.${asOf}${remembered}</p>
    <div class="btn-row">
      <button type="button" class="secondary canvas-refresh">${CANVAS.snapshot ? 'Refresh Canvas data' : 'Load Canvas data'}</button>
      <button type="button" class="quiet canvas-disconnect">Disconnect</button>
    </div>
  </div>`;
}

function canvasTermsHtml() {
  const selection = `<div class="card course-switcher"><label>Canvas course <select id="canvas-course" class="course-select"><option value="subject" ${CANVAS.selectedCourseId === null ? 'selected' : ''}>Match studying: ${esc(subjectLabel())}</option><option value="all" ${CANVAS.selectedCourseId === 'all' ? 'selected' : ''}>All Canvas courses</option>${(CANVAS.snapshot?.courses || []).map((c) => `<option value="${esc(c.id)}" ${CANVAS.selectedCourseId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label><p class="canvas-meta">Choose the school class for your plan, grades, and assessment. The Studying menu above chooses your learning modules.</p></div>`;
  if (!CANVAS.terms.length) return selection;
  const boxes = CANVAS.terms.map((t) => {
    const checked = CANVAS.termIds === null || CANVAS.termIds.includes(t.id) ? ' checked' : '';
    const count = t.courseCount === 1 ? '1 course' : `${t.courseCount} courses`;
    const starts = t.startAt ? `, starts ${esc(canvasDateOnly(t.startAt) || '')}` : '';
    return `<label class="canvas-term"><input type="checkbox" value="${esc(t.id)}"${checked}> <span>${esc(t.name)} — ${count}${starts}</span></label>`;
  }).join('');
  return `${selection}<details><summary>School terms</summary><fieldset class="canvas-terms"><legend>Terms shown</legend>${boxes}
    <p class="canvas-meta">The current term is selected on each data load. Courses in unselected terms remain under Courses in other terms on the Overview. Clear every selection to show every term.</p></fieldset></details>`;
}

// Shared wiring for every connected Canvas page.
function wireCanvasControls(root, rerender) {
  const selectionChanged = () => {
    if (location.hash.startsWith('#/canvas/course/')) location.hash = '#/canvas';
    else rerender();
  };
  $('#canvas-course', root)?.addEventListener('change', (event) => {
    const value = event.target.value;
    selectCanvasCourse(value);
    selectionChanged();
  });
  root.querySelectorAll('.canvas-terms input[type="checkbox"]').forEach((box) => {
    box.addEventListener('change', () => {
      const chosen = [...root.querySelectorAll('.canvas-terms input:checked')].map((b) => b.value);
      CANVAS.termIds = chosen.length ? chosen : null;
      CANVAS.assessment = null;
      canvasRebuildInsights();
      selectionChanged();
    });
  });
  const refresh = $('.canvas-refresh', root);
  if (refresh) {
    refresh.addEventListener('click', async () => {
      refresh.disabled = true;
      refresh.textContent = 'Loading Canvas data. This usually takes under a minute.';
      const ok = await canvasLoadSnapshot();
      announce(ok ? 'Canvas data loaded.' : 'Canvas data could not be loaded.');
      rerender();
    });
  }
  const disconnect = $('.canvas-disconnect', root);
  if (disconnect) {
    disconnect.addEventListener('click', async () => {
      canvasGeneration++;
      disconnect.disabled = true;
      let durable = true;
      try {
        const { data } = await canvasApi('/api/canvas/session', { method: 'DELETE' });
        durable = !data || data.durableDeleted !== false;
      } catch (error) {
        if (staleCanvasRequest(error)) return;
        CANVAS.note = 'Canvas could not be disconnected this time. Try again when the server is reachable.';
        rerender();
        return;
      }
      resetCanvas();
      CANVAS.checked = true;
      CANVAS.note = durable
        ? 'Canvas is disconnected. The token is out of server memory and the saved copies are deleted.'
        : 'Canvas is disconnected and the token is out of server memory. The saved database copy could not be removed this time; select Disconnect again to retry.';
      announce('Canvas is disconnected.');
      rerender();
    });
  }
}

function selectCanvasCourse(value) {
  CANVAS.selectedCourseId = value === 'subject' ? null : value;
  const course = CANVAS.snapshot?.courses.find((item) => item.id === value);
  const termId = value === 'subject' ? CI.currentTermId(CANVAS.terms, Date.now()) : course?.term?.id;
  CANVAS.termIds = termId ? [termId] : null;
  CANVAS.assessment = null;
  canvasRebuildInsights();
}

function canvasConnectHtml() {
  return `${canvasNoteHtml()}
  <div class="card">
    <h2>Connect Canvas for ${esc(S.settings.name || profiles.find((profile) => profile.id === activeProfile)?.name || 'this learner')}</h2>
    <p>Use this learner’s own school address and token. Other learners keep their separate connections and progress.</p>
    <p>Students4AI can show your course data from Canvas, your school's learning system, reformatted into a prioritized plan and a grade report. This page is optional and separate from your calculus progress.</p>
    <p><strong>Exactly how this connection works:</strong></p>
    <ul class="rules-list">
      <li>You enter your school's Canvas web address and a Canvas access token.</li>
      <li>The token is sent only to this Students4AI server. It is never stored in this browser and never added to your progress file or progress exports.</li>
      <li>With Remember selected, the server saves this learner’s address and token in server storage and the configured database so the connection survives restarts. Without it, the token stays only in server memory for up to 8 hours.</li>
      <li>Students4AI reads your active courses, assignments, submission status, scores, and module progress. It reads only; it never changes anything in Canvas.</li>
      <li>Canvas data never changes your Students4AI mastery scores and never unlocks anything.</li>
      <li>The AI assessment page runs only when you select its button. It receives the Canvas data shown in this app, never the token. The math tutor is separate and never sees Canvas data.</li>
      <li>Disconnect removes the token from server memory and deletes the saved copy at once. You can reconnect later with a new or existing token.</li>
    </ul>
    <p>To create a token in Canvas, open Account, then Settings, then select New Access Token. Your school decides whether personal tokens are allowed.</p>
  </div>
  <div class="card">
    <form id="canvas-connect" class="canvas-form">
      <label>Canvas web address
        <input name="baseUrl" type="url" inputmode="url" autocomplete="url" placeholder="https://yourschool.instructure.com" required>
      </label>
      <label>Access token
        <input name="token" type="password" autocomplete="off" spellcheck="false" required>
      </label>
      <label class="canvas-remember"><input type="checkbox" name="remember" checked>
        <span>Remember this learner’s connection on this server. Disconnect removes this learner’s saved token.</span>
      </label>
      <div class="btn-row"><button type="submit">Connect and load my Canvas data</button></div>
      <p class="canvas-meta canvas-connect-status"></p>
    </form>
  </div>`;
}

function wireCanvasConnect(root, rerender) {
  const form = $('#canvas-connect', root);
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = $('.canvas-connect-status', form);
    const button = $('button[type="submit"]', form);
    const formData = new FormData(form);
    const baseUrl = String(formData.get('baseUrl') || '').trim();
    const token = String(formData.get('token') || '').trim();
    const remember = formData.get('remember') !== null;
    if (!baseUrl.startsWith('https://')) {
      status.textContent = 'Enter the Canvas address starting with https://. Your calculus progress is not affected.';
      return;
    }
    button.disabled = true;
    $('input[name="token"]', form).value = '';
    resetCanvas();
    status.textContent = 'Step 1 of 2: confirming the token with Canvas.';
    try {
      const { res, data } = await canvasApi('/api/canvas/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, token, remember }),
      });
      if (!res.ok) {
        status.textContent = (data && data.error) || 'Canvas did not accept that address or token. Check both and try again. Your calculus progress is not affected.';
        button.disabled = false;
        return;
      }
      CANVAS.connected = true;
      CANVAS.checked = true;
      CANVAS.user = data.user || null;
      CANVAS.host = String(data.host || '');
      CANVAS.remembered = Boolean(data.remembered);
      CANVAS.note = '';
      status.textContent = 'Step 2 of 2: loading courses and assignments from Canvas. This usually takes under a minute.';
      const ok = await canvasLoadSnapshot();
      announce(ok ? 'Canvas data loaded.' : 'Canvas connected. The data load did not finish.');
      rerender();
    } catch (error) {
      if (staleCanvasRequest(error)) return;
      status.textContent = 'Canvas could not be reached. Check the address and try again. Your calculus progress is not affected.';
      button.disabled = false;
    }
  });
}

const canvasCountsLine = (ins) => {
  const missing = ins.attention.missing.length;
  const open = ins.plan.overdueOpen.length;
  const upcoming = ins.plan.buckets.reduce((n, b) => n + b.items.length, 0);
  return `${missing} marked missing in Canvas · ${open} past due and still open · ${upcoming} due in the next 5 days`;
};

function canvasItemHtml(item, attention) {
  const side = [];
  const due = canvasDateTime(item.dueAt);
  side.push(due ? `Due ${esc(due)}` : 'No due date');
  if (item.pointsPossible !== null) side.push(`${esc(String(item.pointsPossible))} points possible`);
  if (item.attemptsRemaining !== null) {
    side.push(item.attemptsRemaining === 1 ? '1 attempt remains' : `${item.attemptsRemaining} attempts remain`);
  }
  const tags = [];
  if (item.missing) tags.push('<span class="tag">Marked missing in Canvas</span>');
  if (item.late && item.submittedAt) tags.push('<span class="tag">Submitted late</span>');
  if (item.isQuiz) tags.push('<span class="tag">Quiz</span>');
  if (item.lockKind === 'date') tags.push('<span class="tag">Lock date passed</span>');
  else if (item.lockKind === 'other') tags.push('<span class="tag">Locked in Canvas</span>');
  const link = item.htmlUrl ? ` <a href="${esc(item.htmlUrl)}" target="_blank" rel="noopener">Open in Canvas (new tab)</a>` : '';
  return `<div class="canvas-item${attention ? ' attention' : ''}">
    <div><strong>${esc(item.name)}</strong><span class="canvas-meta">${esc(item.courseName)}</span></div>
    <div class="canvas-item-side"><span class="canvas-meta">${side.join(' · ')}</span>${tags.join(' ')}${link}</div>
  </div>`;
}

function canvasSectionHtml(heading, items, attention, emptyLine) {
  if (!items.length) return emptyLine ? `<h3>${heading} (0)</h3><p class="canvas-meta">${emptyLine}</p>` : '';
  return `<h3>${heading} (${items.length})</h3><div class="canvas-list">${items.map((i) => canvasItemHtml(i, attention)).join('')}</div>`;
}

// The Canvas pages share one shell: tabs, head, note, then content. `wire`
// is an optional per-page hook that attaches that page's own handlers.
function canvasPage(bodyBuilder, breadcrumbTail, activeTab, wire) {
  const generation = canvasGeneration;
  const v = mountView(`
    <h1>Canvas</h1>
    <div id="canvas-body"><p class="canvas-meta">Checking the Canvas connection.</p></div>
  `, { breadcrumb: ['Home', ...breadcrumbTail], nav: 'canvas' });
  const body = $('#canvas-body', v);
  const rerender = () => { if ((location.hash || '').startsWith('#/canvas')) router(); };
  (async () => {
    await canvasEnsureSession();
    if (generation !== canvasGeneration || !body.isConnected) return;
    if (!CANVAS.connected) {
      body.innerHTML = canvasConnectHtml();
      wireCanvasConnect(body, rerender);
      CANVAS.note = '';
      return;
    }
    if (!CANVAS.snapshot) {
      body.innerHTML = `${canvasTabsHtml(activeTab)}${canvasHeadHtml()}${canvasNoteHtml()}
        <p>Canvas data has not finished loading. Select Load Canvas data above to retry.</p>`;
      wireCanvasControls(body, rerender);
      CANVAS.note = '';
      return;
    }
    body.innerHTML = `${canvasTabsHtml(activeTab)}${canvasHeadHtml()}${canvasTermsHtml()}${canvasNoteHtml()}${bodyBuilder()}`;
    wireCanvasControls(body, rerender);
    if (wire) wire(body);
    CANVAS.note = '';
    renderMath(body);
  })();
}

function viewCanvas() {
  canvasPage(() => {
    const ins = CANVAS.insights;
    const snap = CANVAS.snapshot;
    const notes = [];
    if (snap.coursesTruncated) notes.push('Canvas returned more active courses than could be loaded; the first 15 by name are shown.');
    if (snap.missingSubmissionsError) notes.push(snap.missingSubmissionsError);
    if (snap.missingSubmissionsTruncated) notes.push('Canvas returned more missing-assignment entries than could be loaded; that list is incomplete.');
    const courseRows = ins.perCourse.map((row) => {
      const score = row.score === null ? 'No current score' : `Current score ${row.score}${row.grade ? ` (${esc(row.grade)})` : ''}`;
      return `<div class="canvas-course-row">
        <a class="canvas-course" href="#/canvas/course/${esc(row.courseId)}">
          <span><strong>${esc(row.courseName)}</strong><small>${esc(row.courseCode || 'Canvas course')}</small></span>
          <span class="canvas-meta">${score} · ${row.submitted} of ${row.totalAssignments} submitted</span>
        </a>
        <button type="button" class="quiet canvas-focus" data-course-id="${esc(row.courseId)}">Study this course</button>
      </div>`;
    }).join('');
    const hidden = ins.hiddenCourses.length ? `<details class="explorer-details"><summary>Other courses (${ins.hiddenCourses.length})</summary>
      <div class="explorer-body">
        <p class="canvas-meta">These courses are outside your current selection. Choose any one below or choose All Canvas courses in the dropdown.</p>
        <div class="canvas-list">${ins.hiddenCourses.map((c) => `<div class="canvas-item">
          <div><strong>${esc(c.name)}</strong><span class="canvas-meta">Outside the selected view</span></div>
          <div class="canvas-item-side"><button type="button" class="secondary canvas-focus" data-course-id="${esc(c.id)}">Study this course</button></div>
        </div>`).join('')}</div>
      </div></details>` : '';
    const stale = ins.staleCourses.length ? `<details class="explorer-details"><summary>Courses not shown (${ins.staleCourses.length})</summary>
      <div class="explorer-body"><p class="canvas-meta">A course is left out when every dated assignment in it was due more than ${CI.STALE_MONTHS} months ago. These courses are still in Canvas; Students4AI only hides them here.</p>
      <ul>${ins.staleCourses.map((c) => `<li>${esc(c.name)}</li>`).join('')}</ul></div></details>` : '';
    const otherTerms = ins.otherTermCourses.length ? `<details class="explorer-details"><summary>Courses in other terms (${ins.otherTermCourses.length})</summary>
      <div class="explorer-body"><p class="canvas-meta">These courses are in terms that are not selected under Terms shown. Select their term above to include them.</p>
      <ul>${ins.otherTermCourses.map((c) => `<li>${esc(c.name)} — ${esc(c.termName)}</li>`).join('')}</ul></div></details>` : '';
    return `
      <div class="card">
        <h2>Right now</h2>
        <p>${canvasCountsLine(ins)}.</p>
        <p><a href="#/canvas/plan">Open the plan</a> for the full prioritized list, or <a href="#/canvas/grades">open Grades</a> for scores as Canvas reports them.</p>
        ${notes.map((n) => `<p class="canvas-meta">${esc(n)}</p>`).join('')}
      </div>
      <div class="card">
        <h2>Your courses (${ins.perCourse.length})</h2>
        <p class="canvas-meta">Open a course to see its modules, assignments, and statuses. Use the dropdown above to focus the planner on your current work.</p>
        <div class="canvas-list">${courseRows}</div>
        ${hidden}
        ${otherTerms}
        ${stale}
      </div>`;
  }, ['Canvas'], 'overview', (body) => {
    const rerender = () => { if ((location.hash || '').startsWith('#/canvas')) router(); };
    body.querySelectorAll('.canvas-focus').forEach((b) => b.addEventListener('click', () => {
      selectCanvasCourse(b.dataset.courseId);
      rerender();
    }));
  });
}

function viewCanvasPlan() {
  canvasPage(() => {
    const ins = CANVAS.insights;
    const bucketHeading = {
      'within-4-hours': 'Due within 4 hours',
      'within-12-hours': 'Due within 12 hours',
      'within-24-hours': 'Due within 24 hours',
      'within-3-days': 'Due within 3 days',
      'within-5-days': 'Due within 5 days',
    };
    const buckets = ins.plan.buckets.map((b, i) => canvasSectionHtml(bucketHeading[b.id] || b.id, b.items, i < 3, '')).join('');
    const gaps = ins.plan.moduleGaps.length ? `<h3>Module requirements not complete (${ins.plan.moduleGaps.length})</h3>
      <div class="canvas-list">${ins.plan.moduleGaps.map((g) => `<div class="canvas-item">
        <div><strong>${esc(g.courseName)}</strong></div>
        <div class="canvas-item-side"><span class="canvas-meta">${g.requirementCompletedCount} of ${g.requirementCount} requirements complete</span></div>
      </div>`).join('')}</div>` : '';
    const closed = ins.plan.overdueClosed.length ? `<h3>Past due and locked in Canvas (${ins.plan.overdueClosed.length})</h3>
      <p class="canvas-meta">Canvas is not accepting a submission for these right now. The next step is to continue with the plan above. Where the tag reads Lock date passed, the window is over and you can ask the teacher for more time. Where it reads Locked in Canvas, the assignment page in Canvas shows the reason, such as module steps that come first.</p>
      <div class="canvas-list">${ins.plan.overdueClosed.map((i) => canvasItemHtml(i, false)).join('')}</div>
      <details class="explorer-details"><summary>Text you can copy to request more time</summary>
        <div class="explorer-body">
          <p class="canvas-meta">Copy this into an email or a Canvas message and fill in the parts in brackets. Students4AI never sends anything for you.</p>
          <pre class="canvas-copy">Hello [teacher name],

The assignment "[assignment name]" in [course name] is closed in Canvas and I was not able to submit it. I would like to ask for more time. Please let me know if it can be reopened so I can turn it in.

Thank you,
[your name]</pre>
        </div>
      </details>` : '';
    const empty = !ins.plan.overdueOpen.length && !ins.plan.overdueClosed.length && !ins.plan.later.length
      && !ins.plan.noDueDate.length && !ins.plan.moduleGaps.length
      && ins.plan.buckets.every((b) => !b.items.length);
    return `<div class="card">
      <h2>The plan</h2>
      <p class="canvas-meta">How this plan is built: unsubmitted work is grouped by due date. Work that is past due or marked missing comes first while Canvas still accepts a submission. Graded and submitted work leaves the plan. Courses whose dated work all ended more than ${CI.STALE_MONTHS} months ago are not shown. Canvas decides every status.</p>
      ${empty ? '<p>Canvas lists nothing to plan right now. Unsubmitted work with a due date, work marked missing, and incomplete module requirements would appear here.</p>' : ''}
      ${canvasSectionHtml('Past due, and Canvas still accepts a submission', ins.plan.overdueOpen, true, '')}
      ${buckets}
      ${canvasSectionHtml('Due later than 5 days from now', ins.plan.later, false, '')}
      ${canvasSectionHtml('No due date', ins.plan.noDueDate, false, '')}
      ${gaps}
      ${closed}
    </div>`;
  }, ['Canvas', 'The plan'], 'plan');
}

function viewCanvasGrades() {
  canvasPage(() => {
    const ins = CANVAS.insights;
    const snap = CANVAS.snapshot;
    const shownIds = new Set(ins.perCourse.map((c) => c.courseId));
    const rows = ins.perCourse.map((row) => `<tr>
      <td>${esc(row.courseName)}</td>
      <td>${row.score === null ? 'No current score' : row.score}</td>
      <td>${row.grade ? esc(row.grade) : '—'}</td>
    </tr>`).join('');
    const lowLine = ins.attention.courseAlerts.length
      ? `<p class="canvas-note">Courses with a current score below ${CI.LOW_COURSE_SCORE}: ${ins.attention.courseAlerts.map((c) => `${esc(c.courseName)} (${c.score})`).join(', ')}.</p>`
      : '';
    const perCourse = snap.courses.filter((c) => shownIds.has(c.id)).map((course) => {
      const graded = course.assignments.filter((a) => a.submission && a.submission.workflowState === 'graded' && !a.submission.excused);
      const groupById = new Map(course.assignmentGroups.map((g) => [g.id, g]));
      const weightRows = course.applyGroupWeights && course.assignmentGroups.some((g) => g.groupWeight !== null)
        ? `<p class="canvas-meta">Group weights: ${course.assignmentGroups.filter((g) => g.groupWeight !== null).map((g) => `${esc(g.name)} ${g.groupWeight} percent`).join(' · ')}.</p>`
        : '';
      const items = graded.map((a) => {
        const sub = a.submission;
        const low = sub.score !== null && a.pointsPossible !== null && a.pointsPossible > 0 && sub.score / a.pointsPossible < CI.LOW_SCORE_RATIO;
        const scoreText = sub.score === null
          ? 'Graded, no numeric score'
          : `${sub.score} of ${a.pointsPossible === null ? 'unknown' : a.pointsPossible} points${sub.grade ? ` (${esc(sub.grade)})` : ''}`;
        const group = groupById.get(a.groupId);
        return `<div class="canvas-item${low ? ' attention' : ''}">
          <div><strong>${esc(a.name)}</strong><span class="canvas-meta">${esc(group ? group.name : 'Assignments')}</span></div>
          <div class="canvas-item-side"><span class="canvas-meta">${scoreText}</span>${sub.late ? '<span class="tag">Submitted late</span>' : ''}</div>
        </div>`;
      }).join('');
      return `<details class="explorer-details"><summary>${esc(course.name)} — graded work (${graded.length})</summary>
        <div class="explorer-body">${weightRows}${graded.length ? `<div class="canvas-list">${items}</div>` : '<p class="canvas-meta">Canvas reports no graded work in this course yet.</p>'}</div>
      </details>`;
    }).join('');
    return `<div class="card">
      <h2>Grades</h2>
      <p class="canvas-meta">Scores and grades are shown exactly as Canvas reports them. Students4AI does not recompute them, the same way the verified answer key is the only grader for practice questions. Graded work below ${Math.round(CI.LOW_SCORE_RATIO * 100)} percent of its points is marked in amber.</p>
      <table class="simple"><thead><tr><th>Course</th><th>Current score</th><th>Grade</th></tr></thead><tbody>${rows}</tbody></table>
      ${lowLine}
      ${perCourse}
    </div>`;
  }, ['Canvas', 'Grades'], 'grades');
}

function viewCanvasAssessment() {
  canvasPage(() => {
    const prior = CANVAS.assessment ? `
      <h3>Latest assessment</h3>
      <p class="canvas-meta">Generated ${esc(canvasDateTime(new Date(CANVAS.assessment.at).toISOString()) || '')} from a fresh pull of your Canvas data. It is kept until you leave or reload the app.</p>
      <div class="canvas-assessment">${CANVAS.assessment.text.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}</div>` : '';
    return `<div class="card">
      <h2>Assessment</h2>
      <p class="canvas-meta">The assessment is written by the same AI service as the math tutor, from the Canvas data shown on The plan and Grades. It never receives your token. Canvas data is authoritative; where the assessment and Canvas disagree, Canvas is right.</p>
      ${TUTOR.available ? `
      <p>Selecting the button pulls a fresh copy of your Canvas data, applies the same term selection as the other pages, and shows the AI service's written assessment here: the overall picture, what is going well, problem areas by course, and a suggested order of work. Nothing runs on its own.</p>
      <div class="btn-row"><button type="button" class="canvas-assess-btn">${CANVAS.assessment ? 'Ask for a new assessment' : 'Ask for an assessment'}</button></div>
      <p class="canvas-meta canvas-assess-status"></p>
      ${prior}`
    : '<p>No AI service is configured on this server, so the assessment is unavailable. The plan and Grades pages work without it. To enable it, set an API key in Replit Secrets as described in the README.</p>'}
    </div>`;
  },
  ['Canvas', 'Assessment'], 'assessment', (body) => {
    const btn = $('.canvas-assess-btn', body);
    if (!btn) return;
    const status = $('.canvas-assess-status', body);
    btn.addEventListener('click', async () => {
      const requestProfile = activeProfile;
      const lens = JSON.stringify({ termIds: CANVAS.termIds || [], selectedSubject: S.settings.subject, selectedCourseId: CANVAS.selectedCourseId });
      btn.disabled = true;
      status.textContent = 'Waiting for the assessment. This usually takes under a minute.';
      try {
        const { res, data } = await canvasApi('/api/canvas/assessment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: lens,
        });
        if (data && data.available === false) {
          if (status.isConnected) { status.textContent = 'No AI service is configured on this server.'; btn.disabled = false; }
          return;
        }
        if (!res.ok || !data || !data.text) throw new Error((data && data.error) || `HTTP ${res.status}`);
        // The finished assessment lives in CANVAS state, not in this page's
        // DOM, so navigating away while it was being written cannot lose it.
        if (requestProfile !== activeProfile || lens !== JSON.stringify({ termIds: CANVAS.termIds || [], selectedSubject: S.settings.subject, selectedCourseId: CANVAS.selectedCourseId })) return;
        CANVAS.assessment = { text: data.text, at: Date.now() };
        announce('Assessment ready.');
        if ((location.hash || '') === '#/canvas/assessment') router();
      } catch (e) {
        console.warn('Canvas assessment failed:', e);
        if (status.isConnected) {
          status.textContent = 'The assessment could not be created this time. Your progress is unaffected; you can try again.';
          btn.disabled = false;
        }
      }
    });
  });
}

function viewCanvasCourse(courseId) {
  canvasPage(() => {
    // Canonical id comes from the snapshot object, never from the URL hash.
    const course = CANVAS.snapshot.courses.find((c) => c.id === courseId);
    if (!course) {
      return `<div class="card"><p>That course was not in the last Canvas load. Choose a course from the <a href="#/canvas">Canvas overview</a>.</p></div>`;
    }
    const row = CANVAS.insights.perCourse.find((r) => r.courseId === course.id);
    if (!row) return `<div class="card"><h2>${esc(course.name)}</h2><p>This course is outside the current course or term selection. Choose it in the Canvas course dropdown to view its current summary.</p><a class="btn secondary" href="#/canvas">Back to Canvas overview</a></div>`;
    const p = course.moduleProgress;
    const stats = `<div class="canvas-stats">
      ${p && p.requirementCount > 0
        ? `<div><strong>${p.requirementCompletedCount} of ${p.requirementCount}</strong><span>module requirements complete</span></div>`
        : '<div><strong>—</strong><span>Canvas did not report module requirements</span></div>'}
      <div><strong>${row ? row.submitted : 0} of ${course.assignments.length}</strong><span>assignments submitted</span></div>
      <div><strong>${row ? row.missing : 0}</strong><span>marked missing in Canvas</span></div>
    </div>`;
    const modules = course.modules.length ? `<h3>Modules (${course.modules.length})</h3>
      ${course.modules.map((m) => {
        const items = Array.isArray(m.items) ? m.items : null;
        const lines = items === null
          ? '<p class="canvas-meta">Canvas did not return the items in this module.</p>'
          : (items.length ? `<ul>${items.map((it) => {
              const req = it.completionRequirement;
              const state = req ? (req.completed ? 'requirement complete' : 'requirement not complete') : 'no completion requirement';
              return `<li>${esc(it.title)} <span class="canvas-meta">(${esc(it.type)} · ${state})</span></li>`;
            }).join('')}</ul>` : '<p class="canvas-meta">This module has no items.</p>');
        return `<details class="explorer-details" open><summary>${esc(m.name)}</summary><div class="explorer-body">${lines}</div></details>`;
      }).join('')}` : '';
    const sorted = [...course.assignments].sort((a, b) => {
      const ta = a.dueAt === null ? null : Date.parse(a.dueAt);
      const tb = b.dueAt === null ? null : Date.parse(b.dueAt);
      if (ta !== tb) { if (ta === null) return 1; if (tb === null) return -1; return ta - tb; }
      return a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1;
    });
    const assignmentRows = sorted.map((a) => {
      const sub = a.submission;
      const state = sub && sub.excused ? 'Excused'
        : sub && sub.missing ? 'Marked missing'
        : sub && sub.workflowState === 'graded' ? 'Graded'
        : sub && sub.submittedAt ? 'Submitted'
        : 'Not submitted';
      const remaining = CI.attemptsRemaining(a);
      const side = [];
      const due = canvasDateTime(a.dueAt);
      side.push(due ? `Due ${esc(due)}` : 'No due date');
      side.push(sub && sub.score !== null
        ? `${sub.score} of ${a.pointsPossible === null ? 'unknown' : a.pointsPossible} points`
        : (a.pointsPossible === null ? 'No points value' : `${a.pointsPossible} points possible`));
      if (remaining !== null) side.push(remaining === 1 ? '1 attempt remains' : `${remaining} attempts remain`);
      const attention = Boolean(sub && sub.missing && !sub.excused);
      return `<div class="canvas-item${attention ? ' attention' : ''}">
        <div><strong>${esc(a.name)}</strong><span class="canvas-meta">${side.join(' · ')}</span></div>
        <div class="canvas-item-side"><span class="tag">${state}</span>${sub && sub.late && sub.submittedAt ? '<span class="tag">Submitted late</span>' : ''}${a.isQuiz ? '<span class="tag">Quiz</span>' : ''}</div>
      </div>`;
    }).join('');
    return `<div class="card">
      <h2>${esc(course.name)}</h2>
      <p class="canvas-meta">${esc(course.courseCode || 'Canvas course')}${course.term ? ` · ${esc(course.term.name)}` : ''}${course.score !== null ? ` · Current score ${course.score}${course.grade ? ` (${esc(course.grade)})` : ''}` : ' · No current score'}</p>
      ${course.assignmentsError ? `<p class="canvas-note">${esc(course.assignmentsError)}</p>` : ''}
      ${course.assignmentsTruncated ? '<p class="canvas-meta">Canvas returned more assignments than could be loaded; the list below is incomplete.</p>' : ''}
      ${course.modulesTruncated ? '<p class="canvas-meta">Canvas returned more modules or module items than could be loaded; the module list below is incomplete.</p>' : ''}
      ${stats}
      ${modules}
      <h3>Assignments (${course.assignments.length})</h3>
      <p class="canvas-meta">Statuses and scores are shown as Canvas reports them. Students4AI does not infer a cause and does not change your learning path.</p>
      <div class="canvas-list">${assignmentRows}</div>
    </div>`;
  }, ['Canvas', 'Course'], 'overview');
}

// ---------------------------------------------------------------- app plumbing
function applySettings() {
  const s = S.settings;
  const dark = s.theme === 'dark' || (s.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.textsize = s.textSize || 'medium';
  document.documentElement.dataset.motion = s.motion === 'full' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : s.motion;
}

// Route params come from location.hash — user-controllable via a crafted
// link. They are validated against a strict allowlist here, and every view
// additionally switches to the matched content object's own id (unit.id,
// lesson.id) before building any HTML, so hash-derived strings never reach
// innerHTML.
const SAFE_ID = /^[a-z0-9-]{1,64}$/;

function router() {
  if (switchingProfile) return;
  const hash = location.hash || '#/home';
  const parts = hash.slice(2).split('/');
  let [route, a, b] = parts;
  if (a !== undefined && !SAFE_ID.test(a)) { a = undefined; route = 'home'; }
  if (b !== undefined && !SAFE_ID.test(b)) { b = undefined; route = 'home'; }
  if (route === 'home' || route === '') viewHome();
  else if (route === 'unit' && a) viewUnit(a);
  else if (route === 'lesson' && a && b) viewLesson(a, b);
  else if (route === 'practice' && a) viewPractice(a);
  else if (route === 'mastery' && a) viewMastery(a);
  else if (route === 'diagnostic') viewDiagnostic();
  else if (route === 'review') viewReview();
  else if (route === 'focus') viewFocus();
  else if (route === 'canvas' && a === 'plan') viewCanvasPlan();
  else if (route === 'canvas' && a === 'grades') viewCanvasGrades();
  else if (route === 'canvas' && a === 'assessment') viewCanvasAssessment();
  else if (route === 'canvas' && a === 'course' && b) viewCanvasCourse(b);
  else if (route === 'canvas') viewCanvas();
  else if (route === 'settings') viewSettings();
  else viewHome();
}

async function boot() {
  try {
    subscribeFocusSession(({ profileId, status }) => {
      if (profileId !== activeProfile) return;
      const indicator = $('#focus-status');
      indicator.hidden = status !== 'running';
    });
    activateFocusProfile(activeProfile);
    S = await loadProgress();
    applySettings();
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings);
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', applySettings);
    const tutorReady = fetch('/api/tutor').then((r) => r.json()).then((d) => { TUTOR.available = Boolean(d.available); }).catch(() => {});
    await Promise.all([loadContent(), tutorReady]);
    window.addEventListener('hashchange', router);
    router();
    // Keep the interactive home usable while the optional school snapshot loads.
    loadSchoolContext();
  } catch (e) {
    viewEl().innerHTML = `<h1>Students4AI could not start</h1>
      <p>${esc(e.message)}</p>
      <p>Check that the server is running (<code>node server.js</code> in the calculus-coach folder) and reload this page.</p>`;
  }
}

boot();
