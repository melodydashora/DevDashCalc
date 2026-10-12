// Study executes saved plans. Completion belongs to the versioned plan API;
// this browser stores only the selected IDs and the learner's pause choice.
import { createStudyPlanClient, studyPlanActivity, studyPlanStudyRequest, studyPlanSourceRefs, studyCourseworkDate } from './study-plans.js';
import { safeTutorHref } from './tutor-text.js';
import { mountCourseMaterials, visiblePortalCourses } from './course-materials.js';

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
    const sourceTask = item?.sourceTask === true;
    if (String(item?.courseId ?? '') !== selected || !(sourceTask ? /^source-task-[a-z0-9_-]{1,100}$/i : /^[0-9]{1,20}$/).test(id) || seen.has(id)) continue;
    const title = text(item.title || item.name, 250);
    if (!title) continue;
    seen.add(id);
    const dueTime = typeof item.dueAt === 'string' ? Date.parse(item.dueAt) : NaN;
    rows.push({ id, courseId: selected, title, dueAt: Number.isFinite(dueTime) ? item.dueAt : null,
      dueStatus: Number.isFinite(dueTime) ? 'reported' : item.dueAt == null ? 'not-supplied' : 'unavailable',
      href: safeTutorHref(item.htmlUrl || item.sourceUrl || item.href), type: text(item.type, 40),
      ...(sourceTask ? { sourceTask: true } : {}), ...(item.planningDeadline ? { planningDeadline: item.planningDeadline } : {}) });
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
  profileId, selectedPlanId = null, selectedStepId = null, courses = [], canvasItems = [], courseItems = canvasItems,
  isCurrent = () => true, request, onAskAstra, onPractice, onPlan, onModel, onSelection,
  selectedCourseId = null, selectedItemId = null, onCourseSelection, onCourseGenerate,
  renderMath, clock, storage = browserStorage(),
} = {}) {
  let separateCourseItems = courseItems !== canvasItems;
  courses = Array.isArray(courses) ? courses : [];
  canvasItems = Array.isArray(canvasItems) ? canvasItems : [];
  courseItems = Array.isArray(courseItems) ? courseItems : [];
  let disposed = false, plans = [], loading = true, loadFailed = false, saving = false, revision = 0, loadRevision = 0;
  let currentCourseLabel = null, instructorVersion = '', pendingInstructorRefresh = false;
  const explicitCourse = /^[0-9]{1,20}$/.test(String(selectedCourseId ?? ''));
  let courseId = explicitCourse ? String(selectedCourseId) : null;
  let mode = explicitCourse ? 'course' : 'plan', modeChosen = explicitCourse;
  let courseMaterials = null, mountedCourseId = null, courseContext = null, announcedCourse = '', courseOptionsVersion = '';
  let selectedId = validId(selectedPlanId) ? selectedPlanId : null;
  let stepId = validId(selectedStepId) ? selectedStepId : null;
  const explicitPlan = Boolean(selectedId);
  const place = createStudySelectionStore({ storage });
  const remembered = place.read(profileId);
  let paused = false, storageWarningShown = false, announcedSelection = '';
  if (!selectedId && remembered) { selectedId = remembered.planId; stepId = remembered.stepId; paused = remembered.paused; }

  const section = node('section', 'student-study');
  const modes = node('div', 'student-study-mode-switch');
  modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', 'Study mode');
  const courseMode = button('Course', () => setMode('course'));
  const planMode = button('Saved plan', () => setMode('plan'));
  modes.append(courseMode, planMode);
  const coursePanel = node('section', 'card student-study-course');
  const courseLabel = node('label', 'student-study-field');
  courseLabel.append(node('span', '', 'Course'));
  const courseSelect = node('select'); courseSelect.name = 'study-course';
  courseLabel.append(courseSelect);
  const courseMessage = node('p', 'canvas-meta');
  const courseForm = node('div', 'student-study-course-materials');
  coursePanel.append(courseLabel, courseMessage, courseForm);
  const planPanel = node('div', 'student-study-plan');
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
  planPanel.append(picker, status, workspace);
  section.append(modes, coursePanel, planPanel, instructor); root.append(section);
  const current = () => !disposed && section.isConnected && isCurrent();
  const client = createStudyPlanClient({ profileId, request, isCurrent: current });
  const selectedPlan = () => plans.find(plan => plan.id === selectedId) || null;
  const selectedStep = plan => plan?.steps.find(step => step.id === stepId) || null;
  const courseChoices = () => {
    const seen = new Set();
    return visiblePortalCourses(courses).filter(course => {
      const id = String(course.id);
      if (seen.has(id) || !text(course.name, 200).trim()) return false;
      seen.add(id); return true;
    });
  };
  const selectedCourse = () => courseChoices().find(course => String(course.id) === courseId) || null;
  const instructorContext = () => mode === 'plan' ? selectedPlan()
    : selectedCourse() ? { id: 'course-' + courseId, course: selectedCourse() } : null;
  instructor.addEventListener('focusout', () => queueMicrotask(() => {
    if (current() && pendingInstructorRefresh && !instructor.contains?.(document.activeElement)) renderInstructor(instructorContext());
  }));

  function selection() {
    if (mode !== 'plan') return null;
    const plan = selectedPlan(), step = selectedStep(plan);
    if (!plan || !step) return null;
    const payload = studyPlanStudyRequest(plan, step);
    return payload ? { ...payload, paused } : null;
  }
  function courseSelection() {
    if (mode !== 'course') return null;
    const course = selectedCourse();
    if (!course) return null;
    const context = courseMaterials?.selection?.() || courseContext || {};
    const item = studyCourseItems(courseItems, courseId).find(item => item.id === context.itemId);
    return { courseId, courseName: text(course.name, 200), itemId: item?.id || null,
      kind: context.kind || 'explain', learningActivity: context.learningActivity || 'explain', topic: text(context.topic, 500) };
  }
  function announceSelection() {
    const announcePlan = () => {
      const payload = selection(), signature = JSON.stringify(payload);
      if (signature === announcedSelection) return;
      announcedSelection = signature;
      try { onSelection?.(payload); } catch { /* The Study controls retain their own state. */ }
    };
    const announceCourse = () => {
      const payload = courseSelection(), signature = JSON.stringify(payload);
      if (signature === announcedCourse) return;
      announcedCourse = signature;
      try { onCourseSelection?.(payload); } catch { /* The course controls retain their own state. */ }
    };
    // Clear the previous mode before setting the active Coach context.
    if (mode === 'course') { announcePlan(); announceCourse(); }
    else { announceCourse(); announcePlan(); }
  }
  function setMode(nextMode) {
    if (!current() || saving || nextMode === mode) return;
    if (mode === 'course') courseMaterials?.cancelPending?.();
    mode = nextMode; modeChosen = true; revision++;
    render();
    if (mode === 'plan' && selectedPlan()) remember();
    announceSelection();
  }
  function renderCourse() {
    const choices = courseChoices();
    if (!courseId && !explicitCourse) courseId = choices[0] ? String(choices[0].id) : null;
    const optionsVersion = JSON.stringify(choices.map(course => [String(course.id), text(course.name, 200)]));
    if (courseOptionsVersion !== optionsVersion && document.activeElement !== courseSelect) {
      courseOptionsVersion = optionsVersion;
      const placeholder = node('option', '', choices.length ? 'Choose a course' : 'No Canvas courses available');
      placeholder.value = '';
      courseSelect.replaceChildren(placeholder);
      for (const course of choices) {
        const option = node('option', '', text(course.name, 200)); option.value = String(course.id); courseSelect.append(option);
      }
    }
    const course = selectedCourse();
    courseSelect.value = course?.id ? String(course.id) : '';
    courseSelect.disabled = !choices.length;
    courseMessage.hidden = Boolean(course);
    courseMessage.textContent = choices.length
      ? 'Choose one of your current courses to study.' : 'Connect Canvas to see your courses here. You can also study from a saved plan.';
    if (!course || mountedCourseId !== courseId) {
      courseMaterials?.(); courseMaterials = null; mountedCourseId = null; courseContext = null;
      if (course) {
        mountedCourseId = courseId;
        courseMaterials = mountCourseMaterials(courseForm, {
          course, canvasItems: studyCourseItems(courseItems, courseId), selectedItemId,
          isCurrent: () => current() && mode === 'course' && mountedCourseId === courseId,
          onContextChange(meta) { courseContext = meta; if (current() && mode === 'course') announceSelection(); },
          onGenerate: typeof onCourseGenerate !== 'function' ? undefined : prompt => {
            if (!current() || mode !== 'course' || typeof onCourseGenerate !== 'function') return false;
            const meta = courseSelection();
            if (!meta) return false;
            announceSelection();
            return onCourseGenerate(prompt, meta);
          },
        });
      }
    } else courseMaterials?.updateSources?.({ course, canvasItems: studyCourseItems(courseItems, courseId) });
  }
  courseSelect.addEventListener('change', () => {
    if (!current() || mode !== 'course') return;
    const course = courseChoices().find(course => String(course.id) === courseSelect.value);
    if (!course || String(course.id) === courseId) return;
    courseId = String(course.id); selectedItemId = null; revision++;
    renderCourse(); renderInstructor(instructorContext()); announceSelection();
  });
  courseSelect.addEventListener('focusout', () => queueMicrotask(() => {
    if (current()) renderCourse();
  }));
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
    if (!plan || !current() || mode !== 'plan' || saving || loading) return;
    revision++;
    selectedId = plan.id; stepId = chooseStep(plan, requestedStep);
    if (!keepPause) paused = false;
    status.textContent = '';
    render(); remember(); announceSelection();
  }
  select.addEventListener('change', () => setSelection(select.value));

  async function action(callback, payload, pendingMessage, buttonNode) {
    if (!current() || mode !== 'plan' || paused || saving || loading || typeof callback !== 'function' || !payload) return;
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
    if (!current() || mode !== 'plan' || paused || saving || loading || !text(plan.updatedAt, 100)) return;
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
      globalThis.dispatchEvent?.(new Event('students4ai-plans-changed'));
      status.textContent = wasComplete ? 'This step is marked not complete.' : 'Step complete. Choose the next step when you are ready.';
    } catch (error) {
      if (current() && error.name !== 'AbortError') status.textContent = 'The completion change was not confirmed. Reload saved plans before trying again.';
    } finally {
      if (current()) { saving = false; render(); announceSelection(); }
    }
  }
  function renderInstructor(plan) {
    const items = plan ? studyCourseItems(canvasItems, plan.course.id) : [];
    const refs = studyPlanSourceRefs(plan), sourceIds = new Set(refs.map(ref => ref.id));
    const verified = plan?.canvasSourcesVerified === true;
    const unconfirmed = mode === 'plan' && /^[0-9]{1,20}$/.test(plan?.course?.id || '') && !verified;
    const selectedItems = verified && refs.length ? studyCourseItems(courseItems, plan.course.id).filter(item => !item.sourceTask && sourceIds.has(item.id)) : [];
    const otherItems = verified && refs.length ? items.filter(item => item.sourceTask || !sourceIds.has(item.id)) : items;
    const version = JSON.stringify([plan?.id, refs, verified, unconfirmed, selectedItems, otherItems]);
    if (version === instructorVersion) return;
    if (instructor.contains?.(document.activeElement)) { pendingInstructorRefresh = true; return; }
    pendingInstructorRefresh = false;
    instructorVersion = version;
    instructor.replaceChildren(node('h2', '', refs.length ? 'Course materials' : unconfirmed ? 'Current Canvas course work' : 'Instructor work for this course'));
    if (!plan) { instructor.hidden = true; return; }
    instructor.hidden = false;
    if (unconfirmed && !refs.length) instructor.append(node('p', 'canvas-meta', 'This current Canvas list has not been confirmed as the source for your saved plan. Your saved study steps are still available.'));
    function itemList(rows) {
      const list = node('ul', 'student-study-instructor-list');
      for (const item of rows.slice(0, 30)) {
        const row = node('li');
        const title = node('a', '', item.title);
        title.href = item.href || '#/canvas/course/' + item.courseId;
        if (item.href && !item.href.startsWith('#/')) { title.target = '_blank'; title.rel = 'noopener noreferrer'; }
        const due = item.dueStatus === 'unavailable' ? 'Due date unavailable' : studyCourseworkDate(item, clock?.read().timeZone);
        row.append(title, node('span', 'canvas-meta', due));
        if (item.sourceTask) row.append(node('span', 'canvas-meta', 'Syllabus task · Completion unverified'));
        list.append(row);
      }
      return list;
    }
    if (refs.length) {
      const selected = node('section', 'student-study-selected-sources');
      selected.append(node('h3', '', 'Selected coursework'));
      if (!verified) selected.append(node('p', 'canvas-meta', 'The selected coursework has not been confirmed against your current Canvas connection. Open Canvas and reload saved plans to check it.'));
      else {
        if (selectedItems.length) selected.append(itemList(selectedItems), node('p', 'canvas-meta', 'These are the selected items in your current Canvas list. Open an item to read its instructions.'));
        const missing = refs.length - selectedItems.length;
        if (missing) selected.append(node('p', 'canvas-meta', `${missing} selected ${missing === 1 ? 'item is' : 'items are'} unavailable in the current Canvas list. Open Canvas to check the work and due dates.`));
      }
      instructor.append(selected);
      if (otherItems.length) instructor.append(node('h3', '', verified ? 'Other instructor work' : 'Current Canvas course work'));
      if (!verified && otherItems.length) instructor.append(node('p', 'canvas-meta', 'This current list is separate from the unconfirmed sources for your saved plan.'));
    }
    if (!otherItems.length) {
      if (!refs.length) instructor.append(node('p', 'canvas-meta', unconfirmed ? 'No current Canvas items are available here. Open Canvas to check your current work.' : 'No instructor items are available here for this course. Open Canvas to check your current work.'));
      return;
    }
    instructor.append(itemList(otherItems));
    if (otherItems.length > 30) instructor.append(node('p', 'canvas-meta', `${otherItems.length - 30} more instructor items are available in Canvas.`));
  }
  function courseForPlan(plan) {
    if (/^[0-9]{1,20}$/.test(plan.course.id) && plan.canvasSourcesVerified !== true) return plan.course;
    return courses.find(item => String(item.id) === plan.course.id) || plan.course;
  }
  function render() {
    if (!current()) return;
    courseMode.setAttribute('aria-pressed', String(mode === 'course'));
    planMode.setAttribute('aria-pressed', String(mode === 'plan'));
    courseMode.disabled = planMode.disabled = saving;
    coursePanel.hidden = mode !== 'course'; planPanel.hidden = mode !== 'plan';
    renderCourse();
    select.replaceChildren();
    const placeholder = node('option', '', plans.length ? 'Choose a saved plan' : loading ? 'Loading saved plans' : loadFailed ? 'Plans unavailable' : 'No saved plans yet'); placeholder.value = ''; select.append(placeholder);
    for (const plan of plans) {
      const course = courseForPlan(plan);
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
      renderInstructor(instructorContext()); return;
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
    const course = courseForPlan(plan);
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
      if (!current() || mode !== 'plan' || loading) return;
      paused = !paused; revision++;
      status.textContent = paused ? 'Paused. Your selected step is kept on this device.' : 'Study resumed at this step.';
      render(); remember(); announceSelection();
    }, 'quiet');
    pause.disabled = loading;
    actions.append(complete, pause); detail.append(actions);
    if (paused) detail.append(node('p', 'student-study-paused', 'Study paused. Resume when you are ready.'));
    workspace.append(aside, detail);
    renderInstructor(instructorContext());
    try { renderMath?.(detail); } catch { /* The plain-text instructions remain available. */ }
  }
  async function loadPlans() {
    if (!current() || saving) return;
    loading = true;
    loadFailed = false;
    revision++;
    const version = ++loadRevision;
    status.textContent = 'Loading saved plans.';
    render();
    try {
      const result = await client.list();
      if (!current() || version !== loadRevision) return;
      if (!Array.isArray(result.plans)) throw new Error('Invalid saved plan response');
      plans = usablePlans(result.plans);
      let plan = selectedPlan();
      if (!plan && !explicitPlan) { plan = plans[0] || null; selectedId = plan?.id || null; }
      if (plan) stepId = chooseStep(plan, stepId);
      if (!modeChosen && !explicitPlan && !plan) mode = 'course';
      status.textContent = explicitPlan && !plan ? 'That plan is not in this workspace. Choose one of your saved plans.' : '';
      // Only remember IDs after the owned list has resolved this actual plan
      // and step. An unavailable or foreign route must not replace the place.
      if (mode === 'plan' && plan && stepId) remember();
    } catch (error) {
      if (current() && version === loadRevision && error.name !== 'AbortError') {
        loadFailed = true;
        status.textContent = 'Saved plans could not load. Try Reload saved plans; your existing work is preserved.';
      }
    } finally {
      if (current() && version === loadRevision) { loading = false; render(); announceSelection(); }
    }
  }
  void loadPlans();
  if (mode === 'course') announceSelection();
  return {
    selection,
    courseSelection,
    mode: () => mode,
    updateSources(value = {}) {
      if (!current()) return;
      if (Array.isArray(value.courses)) courses = value.courses;
      if (Array.isArray(value.canvasItems)) canvasItems = value.canvasItems;
      if (Array.isArray(value.courseItems)) { courseItems = value.courseItems; separateCourseItems = true; }
      else if (!separateCourseItems && Array.isArray(value.canvasItems)) courseItems = value.canvasItems;
      // Background Canvas refreshes must not replace selected plan controls,
      // study actions, math rendering, or keyboard focus in the workspace.
      const plan = selectedPlan();
      for (const option of select.children) {
        const optionPlan = plans.find(item => item.id === option.value);
        if (!optionPlan) continue;
        const course = courseForPlan(optionPlan);
        option.textContent = `${text(course?.name || optionPlan.course.name, 200)} · ${text(optionPlan.title, 160)}`;
      }
      if (plan && currentCourseLabel) {
        const course = courseForPlan(plan);
        currentCourseLabel.textContent = text(course?.name || plan.course.name, 200);
      }
      renderCourse();
      renderInstructor(instructorContext());
      announceSelection();
    },
    dispose() {
      if (disposed) return;
      disposed = true; revision++; loadRevision++;
      courseMaterials?.(); courseMaterials = null;
      client.dispose();
      section.remove();
    },
  };
}
