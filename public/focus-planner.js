// A learner-controlled study session. This timer does not grade answers,
// change Canvas, or save school-task titles/URLs in browser storage.
export const MIN_SESSION_MINUTES = 5;
export const MAX_SESSION_MINUTES = 60;
const goalTypes = ['school', 'practice', 'own'];
const statuses = ['idle', 'running', 'paused', 'finished'];

export function sessionBudget(value) {
  const number = typeof value === 'number' || typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(number)
    ? Math.max(MIN_SESSION_MINUTES, Math.min(MAX_SESSION_MINUTES, Math.round(number))) : 20;
}

export function newPlannerState(goalType = 'practice') {
  return {
    budgetMinutes: 20, elapsedMs: 0, startedAt: null, status: 'idle',
    goalType: goalTypes.includes(goalType) ? goalType : 'practice',
    checklist: [false, false, false],
  };
}

export function sessionElapsed(state, now) {
  const accumulated = Number.isFinite(state.elapsedMs) && state.elapsedMs >= 0 ? state.elapsedMs : 0;
  return accumulated + (state.status === 'running' && Number.isFinite(state.startedAt)
    ? Math.max(0, now - state.startedAt) : 0);
}

export function transitionSession(state, action, now) {
  if (!Number.isFinite(now)) return state;
  if (action === 'start' || action === 'resume') {
    if (state.status === 'running') return state;
    const base = state.status === 'finished'
      ? { ...newPlannerState(state.goalType), budgetMinutes: state.budgetMinutes } : state;
    return { ...base, status: 'running', startedAt: now };
  }
  if (action === 'pause' && state.status !== 'running') return state;
  if (action === 'pause' || action === 'finish') {
    return { ...state, elapsedMs: sessionElapsed(state, now), startedAt: null, status: action === 'finish' ? 'finished' : 'paused' };
  }
  return state;
}

// Explicit allowlist: arbitrary fields, including assignment data, are never
// persisted. The same function validates data read back from browser storage.
export function plannerStorageValue(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const status = statuses.includes(source.status) ? source.status : 'idle';
  const startedAt = status === 'running' && Number.isFinite(source.startedAt) && source.startedAt >= 0 ? source.startedAt : null;
  return {
    budgetMinutes: sessionBudget(source.budgetMinutes),
    elapsedMs: Number.isFinite(source.elapsedMs) && source.elapsedMs >= 0 ? source.elapsedMs : 0,
    startedAt,
    status: status === 'running' && startedAt === null ? 'paused' : status,
    goalType: goalTypes.includes(source.goalType) ? source.goalType : 'practice',
    checklist: [0, 1, 2].map((index) => source.checklist?.[index] === true),
  };
}

export function restorePlannerState(raw, now) {
  const state = plannerStorageValue(raw);
  // A returning learner explicitly resumes. If the page closed before its
  // final pause save, account for elapsed wall-clock time exactly once.
  return state.status === 'running' ? transitionSession(state, 'pause', now) : state;
}

export function sessionTargetReached(state, now) {
  return sessionElapsed(state, now) >= sessionBudget(state.budgetMinutes) * 60_000;
}

function plannerProfile(profileId) {
  return /^[a-z0-9-]{1,64}$/.test(String(profileId)) ? String(profileId) : 'learner';
}

// A session belongs to the learner and this open app, rather than to a route's
// DOM. No interval is needed while practicing: elapsed time comes from startedAt.
// The injected storage/clock also let lifecycle tests exercise real boundaries.
export function createPlannerSessionStore({ storage = null, now = Date.now } = {}) {
  const sessions = new Map();
  const subscribers = new Set();
  let activeProfile = null;
  const persist = (profileId, state) => {
    try { storage?.setItem(`students4ai-focus-${profileId}`, JSON.stringify(plannerStorageValue(state))); } catch { /* optional */ }
  };
  const notify = (profileId, state) => {
    for (const listener of subscribers) listener({ profileId, status: state.status });
  };
  const pause = (profileId) => {
    const state = sessions.get(profileId);
    if (!state || state.status !== 'running') return;
    const paused = transitionSession(state, 'pause', now());
    sessions.set(profileId, paused);
    persist(profileId, paused);
    notify(profileId, paused);
  };
  return {
    activate(profileId) {
      const next = plannerProfile(profileId);
      if (activeProfile && activeProfile !== next) pause(activeProfile);
      activeProfile = next;
      return next;
    },
    read(profileId, goalType = 'practice') {
      const profile = plannerProfile(profileId);
      if (!sessions.has(profile)) {
        let state = newPlannerState(goalType);
        try {
          const stored = storage?.getItem(`students4ai-focus-${profile}`);
          if (stored) state = restorePlannerState(JSON.parse(stored), now());
        } catch { /* A session still works without browser storage. */ }
        sessions.set(profile, state);
        persist(profile, state);
      }
      return plannerStorageValue(sessions.get(profile));
    },
    write(profileId, raw) {
      const profile = plannerProfile(profileId);
      let state = plannerStorageValue(raw);
      // A late event from a disposed learner view cannot restart their timer.
      if (profile !== activeProfile && state.status === 'running') state = transitionSession(state, 'pause', now());
      sessions.set(profile, state);
      persist(profile, state);
      notify(profile, state);
      return plannerStorageValue(state);
    },
    pauseAll() {
      for (const profile of sessions.keys()) pause(profile);
    },
    status(profileId) {
      return sessions.get(plannerProfile(profileId))?.status || 'idle';
    },
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
  };
}

let pageSessions;
function focusSessions() {
  if (!pageSessions) {
    let storage = null;
    try { storage = window.localStorage; } catch { /* optional */ }
    pageSessions = createPlannerSessionStore({ storage });
    // Keep this page-level listener even when the planner is unmounted. Leaving
    // the app or reloading pauses, while hash navigation and hidden tabs do not.
    window.addEventListener('pagehide', () => pageSessions.pauseAll());
  }
  return pageSessions;
}

export function activateFocusProfile(profileId) {
  return focusSessions().activate(profileId);
}

export function pauseFocusSessions() {
  pageSessions?.pauseAll();
}

export function subscribeFocusSession(listener) {
  return focusSessions().subscribe(listener);
}

export function getFocusSessionStatus(profileId) {
  return focusSessions().status(profileId);
}

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function elapsedLabel(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function safeSchoolLink(href) {
  if (typeof href !== 'string' || !href) return null;
  try {
    const url = new URL(href, window.location.href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
}

export function mountFocusPlanner(container, {
  profileId = 'learner', subject = 'calculus-bc', courseLabel = '', canvasTask = null, suggestedUnit = null,
} = {}) {
  const sessions = focusSessions();
  const safeProfile = sessions.activate(profileId);
  let state = sessions.read(safeProfile, canvasTask ? 'school' : suggestedUnit ? 'practice' : 'own');
  let disposed = false;
  const listeners = [];
  const on = (target, type, handler) => {
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  };
  const save = () => { state = sessions.write(safeProfile, state); };

  const card = element('section', 'card focus-planner');
  card.setAttribute('aria-label', 'Study session planner');
  const heading = element('h2', '', 'One small study session');
  const intro = element('p', '', 'Choose one useful step and some time for it. You can pause, keep working, or finish whenever you need.');
  const course = element('p', 'session-progress', courseLabel ? `Studying: ${courseLabel}` : 'Choose a task that fits what you are studying.');
  const controls = element('div', 'focus-controls');
  const goalLabel = element('label', '', 'Focus for this session ');
  const goal = element('select');
  goal.setAttribute('aria-label', 'Focus for this session');
  for (const [value, label] of [['school', 'One school task'], ['practice', 'One practice question'], ['own', 'My own small goal']]) {
    const option = element('option', '', label);
    option.value = value;
    goal.appendChild(option);
  }
  goal.value = state.goalType;
  goalLabel.appendChild(goal);
  const budgetLabel = element('label', '', 'Planned minutes ');
  const budget = element('input');
  budget.type = 'number'; budget.min = String(MIN_SESSION_MINUTES); budget.max = String(MAX_SESSION_MINUTES); budget.step = '1';
  budget.value = String(state.budgetMinutes);
  budget.setAttribute('aria-label', 'Planned minutes, from 5 to 60');
  budgetLabel.appendChild(budget);
  const presets = element('div', 'btn-row');
  const presetButtons = [10, 20, 30].map((minutes) => {
    const button = element('button', 'secondary', `${minutes} min`);
    button.type = 'button';
    on(button, 'click', () => { state.budgetMinutes = minutes; budget.value = String(minutes); save(); render(); });
    presets.appendChild(button);
    return button;
  });
  controls.append(goalLabel, budgetLabel, presets);
  const ownLabel = element('label', 'focus-own-goal', 'My next small action ');
  const ownGoal = element('input');
  ownGoal.type = 'text'; ownGoal.maxLength = 180;
  ownGoal.placeholder = 'For example: set up part a before calculating.';
  ownLabel.appendChild(ownGoal);
  const ownNote = element('p', 'session-progress', 'Your own goal text stays on this page only. Session time and checklist progress are saved in this browser.');
  const nextStep = element('div', 'focus-next-step');
  const nextTitle = element('h3', '', 'Your next step');
  const nextText = element('p');
  const taskInfo = element('p', 'session-progress');
  const taskLinks = element('div', 'btn-row');
  nextStep.append(nextTitle, nextText, taskInfo, taskLinks);
  const checklist = element('ol', 'focus-checklist');
  const steps = [
    'Prepare: open the task and choose one small action.',
    'Work: try that action; ask for a hint if needed.',
    'Wrap up: decide what to do next before finishing.',
  ];
  const checks = steps.map((text, index) => {
    const li = element('li');
    const label = element('label');
    const check = element('input'); check.type = 'checkbox'; check.checked = state.checklist[index];
    label.append(check, element('span', '', text)); li.appendChild(label); checklist.appendChild(li);
    on(check, 'change', () => { state.checklist[index] = check.checked; save(); renderNextStep(); });
    return check;
  });
  const timerLabel = element('label');
  const showTimer = element('input'); showTimer.type = 'checkbox';
  timerLabel.append(showTimer, document.createTextNode(' Show elapsed time'));
  const progress = element('div', 'focus-progress'); progress.hidden = true;
  const elapsed = element('p'); elapsed.setAttribute('aria-live', 'off');
  const meter = element('progress'); meter.setAttribute('aria-label', 'Elapsed time compared with the plan');
  progress.append(elapsed, meter);
  const actions = element('div', 'btn-row focus-actions');
  const startPause = element('button', '', 'Start session'); startPause.type = 'button';
  const finish = element('button', 'secondary', 'Finish session'); finish.type = 'button';
  actions.append(startPause, finish);
  const navigationNote = element('p', 'session-progress', 'Your session keeps running when you open Practice, Canvas, or another study page. Return to Study session to pause or finish. Switching learners, reloading, or closing this app pauses it.');
  const status = element('p', 'focus-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  card.append(heading, intro, course, controls, ownLabel, ownNote, nextStep, checklist, timerLabel, progress, actions, navigationNote, status);
  container.replaceChildren(card);

  function renderNextStep() {
    ownLabel.hidden = state.goalType !== 'own';
    ownNote.hidden = state.goalType !== 'own';
    taskLinks.replaceChildren();
    let action;
    let info = '';
    const addLink = (label, href, external = false) => {
      if (!href) return;
      const link = element('a', 'btn secondary', label); link.href = href;
      if (external) { link.target = '_blank'; link.rel = 'noopener'; }
      taskLinks.appendChild(link);
    };
    if (state.goalType === 'school') {
      action = canvasTask?.name ? `Open ${canvasTask.name} and read its first question or instruction.` : 'Choose one school task from your Canvas planner, then read its first instruction.';
      info = canvasTask?.dueLabel ? `School due date: ${canvasTask.dueLabel}` : 'Choose one part of the task for this session; finishing the whole assignment is not required.';
      const href = safeSchoolLink(canvasTask?.href);
      if (href) addLink('Open school task in a new tab', href, true);
      else addLink('Choose a school task', '#/canvas/plan');
      if (/^#\/unit\/[a-z0-9-]{1,64}$/.test(canvasTask?.unitHref || '')) addLink('Open related learning module', canvasTask.unitHref);
    } else if (state.goalType === 'practice') {
      const validUnit = suggestedUnit && /^[a-z0-9-]{1,64}$/.test(suggestedUnit.id);
      action = validUnit ? `Open ${suggestedUnit.title} and try the first practice question.` : 'Choose one learning module and try one practice question.';
      info = subject === 'physics' && !validUnit ? 'Physics schoolwork is available through Canvas. You can choose a school task or your own goal.' : 'You can pause after one question. Use a hint or ask the tutor when you need help.';
      addLink(validUnit ? 'Open practice question' : 'Choose a learning module', validUnit ? `#/practice/${suggestedUnit.id}` : '#/home');
    } else {
      action = ownGoal.value.trim() || 'Write one small action above that you can begin without finishing the whole task.';
      info = 'Use a concrete action, such as reading one question, drawing a diagram, or writing the first equation.';
    }
    const firstUnchecked = state.checklist.findIndex((checked) => !checked);
    nextTitle.textContent = firstUnchecked < 0 ? 'Your session checklist is complete' : ['Prepare', 'Work on one step', 'Wrap up'][firstUnchecked];
    nextText.textContent = firstUnchecked === 2 ? 'Choose the next action you will return to, then finish when you are ready.'
      : firstUnchecked < 0 ? 'You can finish this session or keep working on your chosen task.' : action;
    taskInfo.textContent = info;
  }

  function render(updateStep = true) {
    if (disposed) return;
    const now = Date.now();
    const running = state.status === 'running';
    budget.disabled = running; goal.disabled = running; ownGoal.disabled = running;
    for (const button of presetButtons) button.disabled = running;
    startPause.textContent = running ? 'Pause session' : state.status === 'paused' ? 'Resume session' : state.status === 'finished' ? 'Start another session' : 'Start session';
    finish.disabled = state.status === 'idle' || state.status === 'finished';
    elapsed.textContent = `Elapsed ${elapsedLabel(sessionElapsed(state, now))} · Planned ${state.budgetMinutes} minutes`;
    meter.max = state.budgetMinutes * 60_000;
    meter.value = Math.min(meter.max, sessionElapsed(state, now));
    const message = state.status === 'finished' ? 'Session finished. Your session time and checklist stay saved; your school assignment status is unchanged.'
      : state.status === 'paused' ? 'Paused. Your elapsed time is saved. Resume when you are ready.'
      : running && sessionTargetReached(state, now) ? 'You reached your planned time. You can keep working, pause, or finish. Nothing stops automatically.'
      : running ? 'Session started. Focus on one useful step.' : 'Ready when you are. The planned time is a guide, not a deadline.';
    if (status.textContent !== message) status.textContent = message;
    if (updateStep) renderNextStep();
  }

  on(budget, 'change', () => { state.budgetMinutes = sessionBudget(budget.value); budget.value = String(state.budgetMinutes); save(); render(); });
  on(goal, 'change', () => { state.goalType = goal.value; save(); renderNextStep(); });
  on(ownGoal, 'input', renderNextStep);
  on(showTimer, 'change', () => { progress.hidden = !showTimer.checked; });
  on(startPause, 'click', () => {
    state = transitionSession(state, state.status === 'running' ? 'pause' : 'start', Date.now());
    checks.forEach((check, index) => { check.checked = state.checklist[index]; });
    save(); render();
  });
  on(finish, 'click', () => { state = transitionSession(state, 'finish', Date.now()); save(); render(); });
  listeners.push(sessions.subscribe(({ profileId: changedProfile }) => {
    if (changedProfile !== safeProfile || disposed) return;
    state = sessions.read(safeProfile);
    render(false);
  }));
  on(document, 'visibilitychange', () => { if (!document.hidden) render(false); });
  // Clock ticks never recreate task links, preserving keyboard focus.
  const interval = setInterval(() => render(false), 1000);
  save(); render();
  return () => {
    if (disposed) return;
    disposed = true; clearInterval(interval);
    for (const remove of listeners) remove();
  };
}
