// Study executes saved plans. Completion belongs to the versioned plan API;
// this browser stores only the selected IDs and the learner's pause choice.
import { createStudyPlanClient, studyPlanActivity, studyPlanStudyRequest } from './study-plans.js';
import { safeTutorHref } from './tutor-text.js';

const ID = /^[a-z0-9-]{1,64}$/;
const PROFILE_ID = /^[a-z0-9-]{1,55}$/;
const PRACTICE_SUBJECTS = new Set(['sat', 'algebra', 'physics', 'calculus-ab', 'calculus-bc']);
const text = (value, max = 2000) => typeof value === 'string' ? value.slice(0, max) : '';
const validId = value => typeof value === 'string' && ID.test(value);

export function createStudySelectionStore({ storage = null } = {}) {
  const key = profileId => PROFILE_ID.test(profileId || '') ? `students4ai-study-selection-${profileId}` : null;
  const value = input => input && validId(input.planId) && validId(input.stepId)
    ? { version: 1, planId: input.planId, stepId: input.stepId, paused: input.paused === true } : null;
  return {
    read(profileId) {
      try {
        const name = key(profileId);
        if (!name) return null;
        const stored = JSON.parse(storage?.getItem(name) || 'null');
        return stored?.version === 1 ? value(stored) : null;
      } catch { return null; }
    },
    write(profileId, input) {
      const name = key(profileId), selected = value(input);
      if (!name || !selected || !storage?.setItem) return false;
      try { storage.setItem(name, JSON.stringify(selected)); return true; }
      catch { return false; }
    },
  };
}

export function studyCourseItems(canvasItems, courseId) {
  const selected = String(courseId ?? '');
  if (!/^[0-9]{1,20}$/.test(selected)) return [];
  const seen = new Set();
  const rows = [];
  for (const item of Array.isArray(canvasItems) ? canvasItems : []) {
    const id = String(item?.id ?? '');
    if (String(item?.courseId ?? '') !== selected || !/^[0-9]{1,20}$/.test(id) || seen.has(id)) continue;
    const title = text(item.title || item.name, 250);
    if (!title) continue;
    seen.add(id);
    const dueTime = typeof item.dueAt === 'string' ? Date.parse(item.dueAt) : NaN;
    rows.push({ id, courseId: selected, title, dueAt: Number.isFinite(dueTime) ? item.dueAt : null,
      dueStatus: Number.isFinite(dueTime) ? 'reported' : item.dueAt == null ? 'not-supplied' : 'unavailable',
      href: safeTutorHref(item.htmlUrl || item.href), type: text(item.type, 40) });
  }
  return rows.sort((a, b) => (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity)
    || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

function usablePlans(rows) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter(plan => {
    if (!plan || !validId(plan.id) || seen.has(plan.id) || !Array.isArray(plan.steps) || !plan.steps.length
      || !plan.course || typeof plan.course.id !== 'string') return false;
    seen.add(plan.id);
    return true;
  }).map(plan => ({ ...plan, steps: plan.steps.filter(step => step && validId(step.id)).slice(0, 12),
    completedStepIds: Array.isArray(plan.completedStepIds) ? [...new Set(plan.completedStepIds.filter(validId))] : [],
  })).filter(plan => plan.steps.length);
}
function node(tag, className = '', content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}
function button(label, action, className = 'secondary') {
  const element = node('button', className, label);
  element.type = 'button'; element.addEventListener('click', action);
  return element;
}
function browserStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

export function mountStudentStudy(root, {
  profileId, selectedPlanId = null, selectedStepId = null, courses = [], canvasItems = [],
  isCurrent = () => true, request, onAskAstra, onPractice, onPlan, onModel, onSelection,
  renderMath, storage = browserStorage(),
} = {}) {
  courses = Array.isArray(courses) ? courses : [];
  canvasItems = Array.isArray(canvasItems) ? canvasItems : [];
  let disposed = false, plans = [], loading = true, loadFailed = false, saving = false, revision = 0;
  let currentCourseLabel = null, instructorVersion = '', pendingInstructorRefresh = false;
  let selectedId = validId(selectedPlanId) ? selectedPlanId : null;
  let stepId = validId(selectedStepId) ? selectedStepId : null;
  const explicitPlan = Boolean(selectedId);
  const place = createStudySelectionStore({ storage });
  const remembered = place.read(profileId);
  let paused = false, storageWarningShown = false, announcedSelection = '';
  if (!selectedId && remembered) { selectedId = remembered.planId; stepId = remembered.stepId; paused = remembered.paused; }

  const section = node('section', 'student-study');
  const picker = node('div', 'card student-study-picker');
  const selectLabel = node('label', 'student-study-field');
  selectLabel.append(node('span', '', 'Saved plan'));
  const select = node('select'); select.name = 'study-plan'; select.disabled = true;
  selectLabel.append(select);
  const planButton = button('Open Plan', () => {
    if (!current()) return;
    const payload = selection();
    if (typeof onPlan === 'function') onPlan(payload);
    else if (globalThis.location) location.hash = payload?.planId ? '#/plans/' + payload.planId : '#/plans';
  }, 'quiet');
  const reload = button('Reload saved plans', () => { if (current() && !saving && !loading) void loadPlans(); }, 'quiet');
  picker.append(selectLabel, planButton, reload);
  const status = node('p', 'student-study-status', 'Loading saved plans.');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const workspace = node('div', 'student-study-workspace');
  const instructor = node('section', 'card student-study-instructor');
  section.append(picker, status, workspace, instructor); root.append(section);
  const current = () => !disposed && section.isConnected && isCurrent();
  const client = createStudyPlanClient({ profileId, request, isCurrent: current });
  const selectedPlan = () => plans.find(plan => plan.id === selectedId) || null;
  const selectedStep = plan => plan?.steps.find(step => step.id === stepId) || null;
  instructor.addEventListener('focusout', () => queueMicrotask(() => {
    if (current() && pendingInstructorRefresh && !instructor.contains?.(document.activeElement)) renderInstructor(selectedPlan());
  }));

  function selection() {
    const plan = selectedPlan(), step = selectedStep(plan);
    if (!plan || !step) return null;
    const payload = studyPlanStudyRequest(plan, step);
    return payload ? { ...payload, paused } : null;
  }
  function announceSelection() {
    const payload = selection();
    const signature = JSON.stringify(payload);
    if (signature === announcedSelection) return;
    announcedSelection = signature;
    try { onSelection?.(payload); } catch { /* The Study controls retain their own state. */ }
  }
  function remember() {
    if (!current() || !selectedId || !stepId) return;
    if (!place.write(profileId, { planId: selectedId, stepId, paused }) && !storageWarningShown) {
      storageWarningShown = true;
      status.textContent = 'Your place could not be saved on this device. Completed steps still save to your plan.';
    }
  }
  function chooseStep(plan, requested) {
    return plan.steps.find(step => step.id === requested)?.id
      || plan.steps.find(step => !plan.completedStepIds.includes(step.id))?.id
      || plan.steps[0]?.id || null;
  }
  function setSelection(planId, requestedStep = null, keepPause = false) {
    const plan = plans.find(item => item.id === planId);
    if (!plan || !current() || saving || loading) return;
    revision++;
    selectedId = plan.id; stepId = chooseStep(plan, requestedStep);
    if (!keepPause) paused = false;
    status.textContent = '';
    render(); remember(); announceSelection();
  }
  select.addEventListener('change', () => setSelection(select.value));

  async function action(callback, payload, pendingMessage, buttonNode) {
    if (!current() || paused || saving || loading || typeof callback !== 'function' || !payload) return;
    const version = revision;
    if (buttonNode) buttonNode.disabled = true;
    status.textContent = pendingMessage;
    try {
      const result = await callback(payload);
      if (current() && version === revision) status.textContent = result === false
        ? 'That action could not open. Your place in the plan is unchanged.' : '';
    } catch {
      if (current() && version === revision) status.textContent = 'That action could not open. You can try again from this step.';
    } finally {
      if (current() && version === revision && buttonNode) buttonNode.disabled = paused || saving;
    }
  }
  async function saveCompletion(plan, step) {
    if (!current() || paused || saving || loading || !text(plan.updatedAt, 100)) return;
    saving = true;
    const wasComplete = plan.completedStepIds.includes(step.id);
    const completed = new Set(plan.completedStepIds.filter(id => plan.steps.some(item => item.id === id)));
    if (wasComplete) completed.delete(step.id); else completed.add(step.id);
    status.textContent = 'Saving this step to your plan.';
    render();
    try {
      const result = await client.complete(plan, [...completed]);
      if (!current()) return;
      const saved = usablePlans([result.plan]).find(item => item.id === plan.id);
      if (!saved || !text(saved.updatedAt, 100) || saved.completedStepIds.includes(step.id) === wasComplete) throw new Error('Unconfirmed completion');
      plans = plans.map(item => item.id === plan.id ? saved : item);
      status.textContent = wasComplete ? 'This step is marked not complete.' : 'Step complete. Choose the next step when you are ready.';
    } catch (error) {
      if (current() && error.name !== 'AbortError') status.textContent = 'The completion change was not confirmed. Reload saved plans before trying again.';
    } finally {
      if (current()) { saving = false; render(); announceSelection(); }
    }
  }
  function renderInstructor(plan) {
    const items = plan ? studyCourseItems(canvasItems, plan.course.id) : [];
    const version = JSON.stringify([plan?.id, items]);
    if (version === instructorVersion) return;
    if (instructor.contains?.(document.activeElement)) { pendingInstructorRefresh = true; return; }
    pendingInstructorRefresh = false;
    instructorVersion = version;
    instructor.replaceChildren(node('h2', '', 'Instructor work for this course'));
    if (!plan) { instructor.hidden = true; return; }
    instructor.hidden = false;
    if (!items.length) {
      instructor.append(node('p', 'canvas-meta', 'No instructor items are available here for this course. Open Canvas to check your current work.'));
      return;
    }
    const list = node('ul', 'student-study-instructor-list');
    for (const item of items.slice(0, 30)) {
      const row = node('li');
      const title = node('a', '', item.title);
      title.href = item.href || '#/canvas/course/' + item.courseId;
      if (item.href && !item.href.startsWith('#/')) { title.target = '_blank'; title.rel = 'noopener noreferrer'; }
      let due = item.dueStatus === 'unavailable' ? 'Due date unavailable' : 'Due date not supplied';
      if (item.dueAt) due = 'Due ' + new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.dueAt));
      row.append(title, node('span', 'canvas-meta', due)); list.append(row);
    }
    instructor.append(list);
    if (items.length > 30) instructor.append(node('p', 'canvas-meta', `${items.length - 30} more instructor items are available in Canvas.`));
  }
  function render() {
    if (!current()) return;
    select.replaceChildren();
    const placeholder = node('option', '', plans.length ? 'Choose a saved plan' : loading ? 'Loading saved plans' : loadFailed ? 'Plans unavailable' : 'No saved plans yet'); placeholder.value = ''; select.append(placeholder);
    for (const plan of plans) {
      const course = (Array.isArray(courses) ? courses : []).find(item => String(item.id) === plan.course.id);
      const option = node('option', '', `${text(course?.name || plan.course.name, 200)} · ${text(plan.title, 160)}`);
      option.value = plan.id; select.append(option);
    }
    select.value = selectedId || ''; select.disabled = loading || saving || !plans.length;
    reload.disabled = loading || saving;
    workspace.replaceChildren();
    currentCourseLabel = null;
    const plan = selectedPlan(), step = selectedStep(plan);
    if (!plan || !step) {
      workspace.append(node('div', 'card student-study-empty', loading ? 'Loading your saved work.'
        : plans.length ? 'Choose a saved plan to open its study steps.'
          : loadFailed ? 'Your saved plans are unavailable. Reload saved plans to try again.'
            : 'Make and save a course plan in Plan, then study its steps here.'));
      renderInstructor(null); return;
    }
    const completed = new Set(plan.completedStepIds);
    const aside = node('nav', 'card student-study-steps'); aside.setAttribute('aria-label', 'Steps in the selected study plan');
    aside.append(node('h2', '', 'Plan steps'), node('p', 'canvas-meta', `${plan.steps.filter(item => completed.has(item.id)).length} of ${plan.steps.length} complete`));
    const steps = node('ol');
    plan.steps.forEach((item, index) => {
      const li = node('li');
      const choose = button(`${index + 1}. ${text(item.title, 160)}${completed.has(item.id) ? ' · Complete' : ''}`, () => {
        if (!current() || saving || loading) return;
        setSelection(plan.id, item.id, true);
      }, 'student-study-step');
      choose.disabled = saving || loading;
      choose.setAttribute('aria-current', item.id === step.id ? 'step' : 'false');
      li.append(choose); steps.append(li);
    });
    aside.append(steps);
    const detail = node('article', 'card student-study-current');
    const course = (Array.isArray(courses) ? courses : []).find(item => String(item.id) === plan.course.id);
    currentCourseLabel = node('span', 'kicker', text(course?.name || plan.course.name, 200));
    detail.append(currentCourseLabel, node('h2', '', text(step.title, 160)));
    detail.append(node('p', 'student-study-instructions', text(step.detail)), node('p', 'canvas-meta', `${Number.isInteger(step.minutes) ? step.minutes : 0} suggested minutes.`));
    const activity = studyPlanActivity(plan);
    const payload = selection();
    const resourceHref = safeTutorHref(step.href);
    if (resourceHref) {
      const resource = node('a', 'btn secondary', 'Open this step’s resource'); resource.href = resourceHref;
      if (!resourceHref.startsWith('#/')) { resource.target = '_blank'; resource.rel = 'noopener noreferrer'; }
      detail.append(resource);
    }
    const actions = node('div', 'student-study-actions');
    const ask = button('Study with Astra', () => void action(value => onAskAstra(value.request, value), payload, 'Opening this step in the Coach.', ask), activity === 'guide' ? '' : 'secondary');
    ask.disabled = paused || saving || loading || typeof onAskAstra !== 'function';
    actions.append(ask);
    if (activity === 'practice' || activity === 'test') {
      const hasPracticeBank = PRACTICE_SUBJECTS.has(payload?.subject);
      const label = hasPracticeBank
        ? activity === 'test' ? 'Choose test topics' : 'Choose practice topics'
        : activity === 'test' ? 'Start test with Astra' : 'Practise with Astra';
      const practice = button(label, () => void action(onPractice, payload, 'Opening practice for this step.', practice), '');
      practice.disabled = paused || saving || loading || typeof onPractice !== 'function'; actions.append(practice);
      detail.append(node('p', 'canvas-meta', hasPracticeBank
        ? 'Choose topics from the app’s checked questions and answer keys. A practice check is not an official exam.'
        : 'Astra uses this course and plan. These questions do not change school grades.'));
    }
    if (activity === 'model') {
      const model = button('Choose a learning model', () => void action(onModel, payload, 'Opening the model choices for this step.', model), '');
      model.disabled = paused || saving || loading || typeof onModel !== 'function'; actions.append(model);
      detail.append(node('p', 'canvas-meta', 'Choose an available interactive example that fits this topic. It uses separate example values.'));
    }
    const complete = button(completed.has(step.id) ? 'Mark not complete' : 'Mark step complete', () => void saveCompletion(plan, step), 'secondary');
    complete.disabled = paused || saving || loading || !text(plan.updatedAt, 100);
    const pause = button(paused ? 'Resume study' : 'Pause study', () => {
      if (!current() || loading) return;
      paused = !paused; revision++;
      status.textContent = paused ? 'Paused. Your selected step is kept on this device.' : 'Study resumed at this step.';
      render(); remember(); announceSelection();
    }, 'quiet');
    pause.disabled = loading;
    actions.append(complete, pause); detail.append(actions);
    if (paused) detail.append(node('p', 'student-study-paused', 'Study paused. Resume when you are ready.'));
    workspace.append(aside, detail);
    renderInstructor(plan);
    try { renderMath?.(detail); } catch { /* The plain-text instructions remain available. */ }
  }
  async function loadPlans() {
    if (!current() || saving) return;
    loading = true;
    loadFailed = false;
    const version = ++revision;
    status.textContent = 'Loading saved plans.';
    render();
    try {
      const result = await client.list();
      if (!current() || version !== revision) return;
      if (!Array.isArray(result.plans)) throw new Error('Invalid saved plan response');
      plans = usablePlans(result.plans);
      let plan = selectedPlan();
      if (!plan && !explicitPlan) { plan = plans[0] || null; selectedId = plan?.id || null; }
      if (plan) stepId = chooseStep(plan, stepId);
      status.textContent = explicitPlan && !plan ? 'That plan is not in this workspace. Choose one of your saved plans.' : '';
      // Only remember IDs after the owned list has resolved this actual plan
      // and step. An unavailable or foreign route must not replace the place.
      if (plan && stepId) remember();
    } catch (error) {
      if (current() && version === revision && error.name !== 'AbortError') {
        loadFailed = true;
        status.textContent = 'Saved plans could not load. Try Reload saved plans; your existing work is preserved.';
      }
    } finally {
      if (current() && version === revision) { loading = false; render(); announceSelection(); }
    }
  }
  void loadPlans();
  return {
    selection,
    updateSources(value = {}) {
      if (!current()) return;
      if (Array.isArray(value.courses)) courses = value.courses;
      if (Array.isArray(value.canvasItems)) canvasItems = value.canvasItems;
      // Background Canvas refreshes must not replace selected plan controls,
      // study actions, math rendering, or keyboard focus in the workspace.
      const plan = selectedPlan();
      for (const option of select.children) {
        const optionPlan = plans.find(item => item.id === option.value);
        if (!optionPlan) continue;
        const course = courses.find(item => String(item.id) === optionPlan.course.id);
        option.textContent = `${text(course?.name || optionPlan.course.name, 200)} · ${text(optionPlan.title, 160)}`;
      }
      if (plan && currentCourseLabel) {
        const course = courses.find(item => String(item.id) === plan.course.id);
        currentCourseLabel.textContent = text(course?.name || plan.course.name, 200);
      }
      renderInstructor(plan);
    },
    dispose() {
      if (disposed) return;
      disposed = true; revision++;
      client.dispose();
      section.remove();
    },
  };
}
