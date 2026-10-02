// Explicit drafts and saved plans. Model text is always rendered as text.
import { apiFetch } from './auth-ui.js';
import { homePlanTopics } from './student-home.js';

const PLAN_ID = /^[a-z0-9-]{1,64}$/;
const text = (value, max = 2000) => typeof value === 'string' ? value.slice(0, max) : '';
const aborted = () => Object.assign(new Error('This study workspace is no longer open.'), { name: 'AbortError' });
const ACTIVITIES = {
  guide: { label: 'Guide', description: 'Explain a topic', request: 'Guide me through the idea in clear steps.' },
  practice: { label: 'Practice', description: 'Work on questions', request: 'Plan questions on this topic, with feedback after I answer.' },
  test: { label: 'Test', description: 'Plan a practice test', request: 'Plan a practice test on the requested material using checked questions where available.' },
  model: { label: 'Model', description: 'Explore an interactive model', request: 'Include an interactive model or 3D activity where a suitable learning model is available.' },
};

export function studyPlanActivity(plan) {
  return Object.hasOwn(ACTIVITIES, plan?.activity || '') ? plan.activity : 'guide';
}

export function studyPlanStudyRequest(plan, step = null) {
  if (!PLAN_ID.test(plan?.id || '') || !plan.course?.id) return null;
  const selectedStep = step ? plan.steps?.find(item => item.id === step.id) : null;
  if (step && !selectedStep) return null;
  const href = stepHref(selectedStep?.href);
  return { planId: plan.id, stepId: selectedStep?.id || null, courseId: String(plan.course.id), subject: plan.course.subject || 'all',
    activity: studyPlanActivity(plan), request: text(selectedStep?.detail || plan.goal), ...(href ? { href } : {}) };
}

export function studyPlanCourseOptions(courses = [], subjects = []) {
  const options = [];
  const seen = new Set();
  for (const course of Array.isArray(courses) ? courses : []) {
    const id = String(course?.id || '');
    if (!/^[0-9]{1,20}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    options.push({ id, name: text(course.name, 200) || 'Canvas class', subject: 'all', kind: 'canvas' });
  }
  options.sort((a, b) => a.name.localeCompare(b.name));
  for (const subject of Array.isArray(subjects) ? subjects : []) {
    if (!PLAN_ID.test(subject?.id || '') || seen.has(subject.id)) continue;
    seen.add(subject.id);
    options.push({ id: subject.id, name: text(subject.label, 200), subject: subject.id, kind: 'subject' });
  }
  options.push({ id: 'custom', name: 'Another class', subject: 'all', kind: 'custom' });
  return options;
}

export function createStudyPlanClient({ profileId, request = apiFetch, isCurrent = () => true } = {}) {
  let disposed = false;
  const controllers = new Set();
  const current = () => !disposed && isCurrent();
  async function call(path = '', method = 'GET', body) {
    if (!current()) throw aborted();
    const controller = new AbortController();
    controllers.add(controller);
    try {
      const response = await request('/api/study-plans' + path + '?profile=' + encodeURIComponent(profileId), {
        method, signal: controller.signal, cache: 'no-store',
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      if (!current()) throw aborted();
      const result = await response.json().catch(() => ({}));
      if (!current()) throw aborted();
      if (!response.ok) throw new Error(text(result.error, 500) || 'The study plan could not be saved or loaded. Try again.');
      return result;
    } finally { controllers.delete(controller); }
  }
  return {
    list: () => call(),
    draft: body => call('/draft', 'POST', body),
    save: (plan, requestId) => call('', 'POST', { plan, requestId }),
    complete: (plan, completedStepIds) => call('/' + encodeURIComponent(plan.id), 'PATCH', { completedStepIds, expectedUpdatedAt: plan.updatedAt }),
    dispose() { disposed = true; for (const controller of controllers) controller.abort(); controllers.clear(); },
  };
}

function element(tag, className = '', content = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content) node.textContent = content;
  return node;
}
function field(label, control) { const node = element('label', 'plan-field', label); node.appendChild(control); return node; }
function button(label, action, className = 'secondary') {
  const node = element('button', className, label); node.type = 'button'; node.addEventListener('click', action); return node;
}
function planLink(plan, label = 'Open saved plan') {
  if (!PLAN_ID.test(plan?.id || '')) return element('span', '', label);
  const node = element('a', 'btn secondary', label); node.href = '#/plans/' + plan.id; return node;
}
function stepHref(value) {
  return typeof value === 'string' && /^#\/(?:library|build|mystery|plans|focus|mixed(?:\/(?:sat|algebra))?|canvas(?:\/plan|\/course\/\d{1,20})?|(?:unit|practice)\/unit-\d{2})$/.test(value) ? value : null;
}
function sourceLabel(plan) {
  return plan.source === 'astra' ? 'Drafted with Astra' : 'Student plan';
}
function readableGoal(value, max = 2000) {
  return text(value).replace(/^Selected course item \[[a-zA-Z0-9_.:-]{1,120}\]: /gm, 'Course work: ').slice(0, max);
}

export function mountHomeStudyPlans(container, { profileId, isCurrent = () => true, request = apiFetch } = {}) {
  const client = createStudyPlanClient({ profileId, request, isCurrent: () => container.isConnected && isCurrent() });
  container.replaceChildren(element('h2', '', 'Your saved course topics'), element('p', '', 'Loading your saved study plans.'));
  client.list().then(result => {
    if (!container.isConnected || !isCurrent()) return;
    const plans = Array.isArray(result.plans) ? result.plans : [];
    container.replaceChildren(element('h2', '', 'Your saved course topics'));
    container.appendChild(element('p', 'canvas-meta', 'Topics shown here come from study plans you saved for a class or study subject.'));
    const topics = homePlanTopics(plans);
    if (!topics.length) container.appendChild(element('p', '', 'No course topics have been saved yet. Choose a class and draft a plan with Astra, or write your own.'));
    else {
      const grid = element('div', 'saved-topic-grid');
      for (const group of topics) {
        const card = element('article', 'card saved-topic-card');
        card.append(element('span', 'kicker', group.courseName), element('h3', '', group.title));
        const list = element('ul', 'plan-topic-list');
        for (const topic of group.topics) list.appendChild(element('li', '', topic));
        card.append(list, element('p', 'canvas-meta', group.source === 'astra' ? 'Saved from an Astra draft' : 'Saved by you'), planLink({ id: group.planId }));
        grid.appendChild(card);
      }
      container.appendChild(grid);
    }
    const link = element('a', 'btn secondary', 'Open study plans'); link.href = '#/plans'; container.appendChild(link);
  }).catch(error => {
    if (error.name === 'AbortError' || !container.isConnected || !isCurrent()) return;
    container.replaceChildren(element('h2', '', 'Your saved course topics'), element('p', '', error.message));
    const link = element('a', 'btn secondary', 'Open study plans and try again'); link.href = '#/plans'; container.appendChild(link);
  });
  return () => client.dispose();
}

export function mountStudyPlans(container, {
  profileId, courses = [], subjects = [], selectedCourseId = null, subject = 'all', selectedPlanId = null,
  canvasItems = [], selectedCanvasItemIds = [], initialGoal = '', initialActivity = 'guide', onStudyPlan,
  isCurrent = () => true, request = apiFetch, onOpenPlan = id => { location.hash = '#/plans/' + id; },
} = {}) {
  let disposed = false, busy = false, plans = [], planRevision = 0, draft = null, draftRequestId = null, editorValues = null;
  const current = () => !disposed && container.isConnected && isCurrent();
  const client = createStudyPlanClient({ profileId, request, isCurrent: current });
  const form = element('form', 'card study-plan-form');
  form.append(element('h2', '', 'Plan your study'), element('p', '', 'Choose a course and the work you want to do. Add a topic or question, then review your plan before saving.'));
  const courseSelect = element('select'); courseSelect.name = 'course';
  let courseOptions = [], pendingCourseId = selectedCourseId == null ? null : String(selectedCourseId);
  const customName = element('input'); customName.type = 'text'; customName.maxLength = 160; customName.placeholder = 'Class name';
  const customField = field('Class name ', customName);
  const goal = element('textarea'); goal.name = 'goal'; goal.rows = 3; goal.maxLength = 1000;
  goal.value = text(initialGoal, 1000);
  goal.placeholder = 'For example: help me understand photosynthesis, practise question 4, or plan a test on this chapter.';
  let activity = studyPlanActivity({ activity: initialActivity });
  const activityChoices = element('fieldset', 'plan-activity-choices');
  // This asks the learner to select an activity.
  // lint-ui: allow
  activityChoices.appendChild(element('legend', '', 'What would help you?'));
  for (const [id, option] of Object.entries(ACTIVITIES)) {
    const label = element('label', 'plan-activity-choice');
    const input = element('input'); input.type = 'radio'; input.name = 'plan-activity'; input.value = id; input.checked = id === activity;
    input.addEventListener('change', () => { if (input.checked) activity = id; });
    const copy = element('span'); copy.append(element('strong', '', option.label), element('small', '', option.description));
    label.append(input, copy); activityChoices.appendChild(label);
  }
  let availableItems = Array.isArray(canvasItems) ? canvasItems : [];
  const selectedItems = new Set(selectedCanvasItemIds.map(String));
  const courseItems = element('fieldset', 'plan-course-items');
  const minutes = element('input'); minutes.type = 'number'; minutes.min = '5'; minutes.max = '120'; minutes.value = '20'; minutes.required = true;
  const pace = element('select');
  for (const [id, label] of [['balanced', 'A balanced pace'], ['small', 'Smaller steps with more time to think'], ['challenge', 'Brisker steps and deeper challenges']]) {
    const option = element('option', '', label); option.value = id; pace.appendChild(option);
  }
  pace.value = 'balanced';
  const satFields = element('fieldset', 'plan-sat-fields');
  satFields.append(element('legend', '', 'Optional SAT goals'), element('p', '', 'Use scores from an official practice test if you have them. A target helps plan your work; it is not a score prediction.'));
  function scoreInput(min, max) { const input = element('input'); input.type = 'number'; input.min = String(min); input.max = String(max); input.step = '10'; return input; }
  const startingTotal = scoreInput(400, 1600), targetTotal = scoreInput(400, 1600);
  const mathScore = scoreInput(200, 800), readingScore = scoreInput(200, 800);
  const testDate = element('input'); testDate.type = 'date';
  const sectionFocus = element('select');
  for (const [id, label] of [['both', 'Math and Reading and Writing'], ['math', 'Math'], ['reading-writing', 'Reading and Writing']]) {
    const option = element('option', '', label); option.value = id; sectionFocus.appendChild(option);
  }
  sectionFocus.value = 'both';
  const satInputs = element('div', 'plan-fields');
  satInputs.append(field('Starting total score ', startingTotal), field('Target total score ', targetTotal), field('Math starting score ', mathScore), field('Reading and Writing starting score ', readingScore), field('Test date ', testDate), field('Focus section ', sectionFocus));
  satFields.appendChild(satInputs);
  const controls = element('div', 'plan-fields');
  controls.append(field('Course ', courseSelect), customField);
  const preferences = element('details', 'plan-preferences');
  preferences.appendChild(element('summary', '', 'Time, pace and optional goals'));
  const preferenceFields = element('div', 'plan-fields');
  preferenceFields.append(field('Planned minutes ', minutes), field('Your pace ', pace));
  preferences.append(preferenceFields, satFields);
  const actions = element('div', 'btn-row');
  const ask = element('button', '', 'Make a draft with Astra'); ask.type = 'submit';
  const own = button('Write my own plan', () => {
    const course = chosenCourse(); if (!course || !validGoal() || !form.reportValidity()) return;
    const request = planGoal();
    const topic = goal.value.trim() || chosenItems().map(item => item.title).join(', ');
    showDraft({ title: text(topic, 160) || 'Study ' + course.name, course, activity, goal: request, topics: [text(topic, 160)],
      steps: [{ id: 'step-1', title: ACTIVITIES[activity].label + ': ' + text(topic, 150), detail: request, minutes: Number(minutes.value) || 20 }], completedStepIds: [], source: 'student' }, 'Review the topics and steps before saving.');
  });
  actions.append(ask, own);
  const status = element('p', 'plan-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  form.append(controls, courseItems, field('Topic, question or request ', goal), activityChoices, preferences, actions, status);
  const editor = element('section', 'plan-draft-slot');
  const saved = element('section', 'saved-plans');
  const detail = element('section', 'saved-plan-detail');
  container.replaceChildren(...(selectedPlanId ? [detail, form, editor, saved] : [form, editor, detail, saved]));

  function updateCourses(nextCourses) {
    if (!current()) return;
    const previous = courseSelect.value;
    courseOptions = studyPlanCourseOptions(nextCourses, subjects);
    courseSelect.replaceChildren();
    for (const item of courseOptions) {
      const option = element('option', '', item.name + (item.kind === 'canvas' ? ' · Canvas' : ''));
      option.value = item.id; courseSelect.appendChild(option);
    }
    courseSelect.value = pendingCourseId && courseOptions.some(c => c.id === pendingCourseId) ? pendingCourseId
      : courseOptions.some(c => c.id === previous) ? previous
      : courseOptions.some(c => c.id === subject) ? subject : courseOptions[0].id;
    if (courseSelect.value === pendingCourseId) pendingCourseId = null;
    showCourseFields();
  }
  courseSelect.addEventListener('change', () => { pendingCourseId = null; showCourseFields(); });
  updateCourses(courses);
  function showCourseFields() {
    customField.hidden = courseSelect.value !== 'custom';
    satFields.hidden = courseSelect.value !== 'sat';
    for (const input of satFields.querySelectorAll('input, select')) input.disabled = busy || satFields.hidden;
    renderCourseItems();
  }
  function chosenItems() {
    return availableItems.filter(item => String(item?.courseId) === courseSelect.value && typeof item?.title === 'string' && /^[a-zA-Z0-9_.:-]{1,120}$/.test(String(item?.id)) && selectedItems.has(String(item?.id)));
  }
  function renderCourseItems() {
    courseItems.replaceChildren();
    courseItems.hidden = !courseOptions.some(course => course.id === courseSelect.value && course.kind === 'canvas');
    if (courseItems.hidden) return;
    courseItems.appendChild(element('legend', '', 'Course work'));
    const items = availableItems.filter(item => String(item?.courseId) === courseSelect.value && typeof item?.title === 'string' && /^[a-zA-Z0-9_.:-]{1,120}$/.test(String(item?.id)));
    if (!items.length) courseItems.appendChild(element('p', 'canvas-meta', 'No course items are available here yet. You can still enter a topic or question below.'));
    for (const item of items.slice(0, 60)) {
      const label = element('label', 'plan-course-item'); const input = element('input'); input.type = 'checkbox'; input.name = 'canvasItem'; input.value = String(item.id); input.checked = selectedItems.has(String(item.id)); input.disabled = busy;
      input.addEventListener('change', () => { if (input.checked) selectedItems.add(String(item.id)); else selectedItems.delete(String(item.id)); });
      const copy = element('span'); copy.appendChild(element('strong', '', text(item.title, 200)));
      const date = item.dueAt ? new Date(item.dueAt) : null;
      const metadata = [text(item.type, 60), date && Number.isFinite(date.getTime()) ? 'Due ' + date.toLocaleString() : 'No due date supplied'].filter(Boolean).join(' · ');
      copy.appendChild(element('small', '', metadata)); label.append(input, copy); courseItems.appendChild(label);
    }
    if (items.length > 60) courseItems.appendChild(element('p', 'canvas-meta', 'Showing the first 60 items for this course. Use Canvas to see the rest.'));
  }
  function updateCanvasItems(items) {
    if (current()) { availableItems = Array.isArray(items) ? items : []; renderCourseItems(); }
  }
  function chosenCourse() {
    const selected = courseOptions.find(item => item.id === courseSelect.value);
    if (!selected) { status.textContent = 'Choose a class for this plan.'; return null; }
    if (selected.id === 'custom' && !customName.value.trim()) { status.textContent = 'Enter the class name.'; customName.focus(); return null; }
    return { id: selected.id, name: selected.id === 'custom' ? customName.value.trim() : selected.name, subject: selected.subject };
  }
  function validGoal() {
    if (!goal.value.trim() && !chosenItems().length) { status.textContent = 'Enter a topic or question, or select course work for this plan.'; goal.focus(); return false; }
    if (planGoal().length > 2000) { status.textContent = 'Shorten your request or select fewer course items so this plan stays focused.'; return false; }
    return true;
  }
  function planGoal() {
    const lines = [goal.value.trim() || 'Work on the selected course items.', 'Requested activity: ' + ACTIVITIES[activity].label + '. ' + ACTIVITIES[activity].request];
    for (const item of chosenItems()) lines.push('Selected course item [' + String(item.id) + ']: ' + text(item.title, 180));
    if (pace.value === 'small') lines.push('Pace: use smaller steps, time to think, and an optional hint before increasing difficulty.');
    else if (pace.value === 'challenge') lines.push('Pace: move briskly when I show understanding and deepen the reasoning instead of repeating a template.');
    if (courseSelect.value === 'sat') {
      const context = [];
      if (startingTotal.value) context.push('starting total ' + startingTotal.value);
      if (targetTotal.value) context.push('target total ' + targetTotal.value);
      if (mathScore.value) context.push('Math starting score ' + mathScore.value);
      if (readingScore.value) context.push('Reading and Writing starting score ' + readingScore.value);
      if (testDate.value) context.push('intended test date ' + testDate.value);
      if (sectionFocus.value !== 'both') context.push('focus on ' + (sectionFocus.value === 'math' ? 'Math' : 'Reading and Writing'));
      if (context.length) lines.push('Self-reported SAT planning goals: ' + context.join('; ') + '. Use these to plan practice, not predict a score.');
    }
    return lines.join('\n');
  }
  function setBusy(value) {
    busy = value;
    for (const control of form.querySelectorAll('input, textarea, select, button')) control.disabled = value;
    for (const control of editor.querySelectorAll('input, textarea, button')) control.disabled = value;
    showCourseFields();
  }
  async function run(work) {
    if (busy || !current()) return;
    setBusy(true);
    try { await work(); }
    catch (error) { if (current() && error.name !== 'AbortError') status.textContent = error.message; }
    finally { if (current()) setBusy(false); }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    const course = chosenCourse(); if (!course || !validGoal() || !form.reportValidity()) return;
    run(async () => {
      status.textContent = 'Astra is preparing a draft. It has not been saved.';
      const result = await client.draft({ course, goal: planGoal(), minutes: Number(minutes.value), activity });
      if (!current()) return;
      if (!result.plan) throw new Error('A draft was not returned. You can write your own plan.');
      showDraft(result.plan, result.notice || (result.available === false ? 'Astra is unavailable. Review and edit this starter plan before saving.' : 'Review the Astra draft below. It has not been saved.'));
    });
  });

  function showDraft(value, notice) {
    draft = value; draftRequestId = crypto.randomUUID(); editorValues = null;
    status.textContent = notice;
    renderEditor();
  }
  function renderEditor() {
    editor.replaceChildren(); if (!draft) return;
    const card = element('div', 'card study-plan-draft');
    card.append(element('h2', '', 'Review your draft'), element('p', 'canvas-meta', text(draft.course?.name, 200) + ' · ' + sourceLabel(draft)));
    const title = element('input'); title.type = 'text'; title.maxLength = 160; title.value = text(draft.title, 160); title.required = true;
    const topics = element('textarea'); topics.rows = 3; topics.maxLength = 4000; topics.value = (Array.isArray(draft.topics) ? draft.topics : []).filter(t => typeof t === 'string').join('\n');
    card.append(field('Plan title ', title), field('Topics to save, one per line (1 to 10) ', topics));
    const rows = element('div', 'plan-step-editors');
    const stepInputs = [];
    function addStep(step = {}) {
      if (stepInputs.filter(input => !input.removed).length >= 12) { status.textContent = 'Use no more than 12 steps in one plan.'; return; }
      step = { id: 'step-' + crypto.randomUUID(), ...step };
      const row = element('fieldset', 'plan-step-editor');
      row.appendChild(element('legend', '', 'Step ' + (stepInputs.length + 1)));
      const name = element('input'); name.type = 'text'; name.maxLength = 160; name.value = text(step.title, 160); name.required = true;
      const description = element('textarea'); description.rows = 2; description.maxLength = 2000; description.value = text(step.detail); description.required = true;
      const duration = element('input'); duration.type = 'number'; duration.min = '1'; duration.max = '120'; duration.value = String(step.minutes || 10);
      row.append(field('Action ', name), field('Instructions ', description), field('Minutes ', duration));
      const inputs = { source: step, name, description, duration, removed: false };
      row.appendChild(button('Remove step', () => { inputs.removed = true; row.remove(); }));
      stepInputs.push(inputs); rows.appendChild(row);
    }
    for (const step of Array.isArray(draft.steps) && draft.steps.length ? draft.steps : [{}]) addStep(step);
    card.append(rows, button('Add a step', () => addStep()));
    editorValues = () => ({ ...draft, title: title.value.trim(),
      topics: [...new Set(topics.value.split('\n').map(t => t.trim()).filter(Boolean))],
      steps: stepInputs.filter(step => !step.removed).map((step, index) => ({ ...step.source, id: step.source.id || 'step-' + (index + 1), title: step.name.value.trim(), detail: step.description.value.trim(), minutes: Number(step.duration.value) })),
    });
    const row = element('div', 'btn-row');
    row.append(button('Save this plan', () => run(async () => {
      const edited = editorValues();
      if (!edited.topics.length || edited.topics.length > 10 || edited.topics.some(topic => topic.length > 160)) {
        status.textContent = 'Include 1 to 10 topics, each no longer than 160 characters.'; return;
      }
      if (!edited.title || !edited.steps.length || edited.steps.length > 12 || edited.steps.some(step => !step.title || !step.detail || !Number.isInteger(step.minutes) || step.minutes < 1 || step.minutes > 120) || edited.steps.reduce((sum, step) => sum + step.minutes, 0) > 360) {
        status.textContent = 'Use a title and 1 to 12 steps with an action and instructions. Each step needs 1–120 minutes, with no more than 360 minutes total.'; return;
      }
      status.textContent = 'Saving your plan.';
      const result = await client.save(edited, draftRequestId);
      if (!current()) return;
      if (!result.plan?.id) throw new Error('The saved plan could not be confirmed. Try saving again.');
      plans = [result.plan, ...plans.filter(plan => plan.id !== result.plan.id)];
      planRevision += 1;
      draft = null; editor.replaceChildren(); renderSaved();
      status.textContent = 'Plan saved. Open it in Study when you are ready.';
      onOpenPlan(result.plan.id);
    }), ''), button('Discard this draft', () => { draft = null; editor.replaceChildren(); status.textContent = 'Draft discarded. Saved plans are unchanged.'; }));
    card.appendChild(row); editor.appendChild(card);
    if (busy) for (const control of editor.querySelectorAll('input, textarea, button')) control.disabled = true;
  }

  function studyAction(plan, step = null) {
    return button(step ? 'Study this step' : 'Study this plan', () => {
      if (!current() || busy) return;
      const payload = studyPlanStudyRequest(plan, step);
      if (payload) onStudyPlan(payload);
    }, step ? 'secondary plan-study-step' : 'plan-study-start');
  }
  function renderDetail(plan) {
    detail.replaceChildren(); if (!plan) return;
    const card = element('article', 'card saved-plan-open');
    card.append(element('span', 'kicker', text(plan.course?.name, 200)), element('h2', '', text(plan.title, 160)), element('p', '', readableGoal(plan.goal)), element('p', 'canvas-meta', sourceLabel(plan)));
    if (typeof onStudyPlan === 'function') card.appendChild(studyAction(plan));
    if (Array.isArray(plan.topics) && plan.topics.length) card.appendChild(element('p', 'canvas-meta', 'Topics: ' + plan.topics.filter(t => typeof t === 'string').join(' · ')));
    const list = element('ol', 'saved-plan-steps');
    const completed = new Set(Array.isArray(plan.completedStepIds) ? plan.completedStepIds : []);
    for (const step of Array.isArray(plan.steps) ? plan.steps : []) {
      const row = element('li', 'saved-plan-step');
      const check = element('input'); check.type = 'checkbox'; check.checked = completed.has(step.id);
      const label = element('label', 'plan-step-check'); label.append(check, element('strong', '', text(step.title, 200)));
      row.append(label, element('p', '', text(step.detail)), element('p', 'canvas-meta', String(step.minutes || 0) + ' planned minutes'));
      if (typeof onStudyPlan === 'function') row.appendChild(studyAction(plan, step));
      const href = stepHref(step.href);
      if (href && typeof onStudyPlan !== 'function') { const link = element('a', 'btn quiet', 'Open study resource'); link.href = href; row.appendChild(link); }
      check.addEventListener('change', () => {
        const wanted = check.checked; check.checked = completed.has(step.id);
        run(async () => {
          for (const input of list.querySelectorAll('input')) input.disabled = true;
          const next = new Set(completed); if (wanted) next.add(step.id); else next.delete(step.id);
          try {
            const result = await client.complete(plan, [...next]);
            if (!current()) return;
            plans = plans.map(item => item.id === plan.id ? result.plan : item);
            planRevision += 1;
            renderSaved(); status.textContent = 'Completed steps saved.';
          } finally { if (current()) for (const input of list.querySelectorAll('input')) input.disabled = false; }
        });
      });
      list.appendChild(row);
    }
    card.appendChild(list); detail.appendChild(card);
  }
  function renderSaved() {
    saved.replaceChildren(element('h2', '', 'Your saved plans'));
    if (!plans.length) saved.appendChild(element('p', '', 'No study plans have been saved yet. Make a draft above and save the steps you want to use.'));
    const grid = element('div', 'saved-plan-grid');
    for (const plan of plans) {
      const card = element('article', 'card saved-plan-summary');
      card.append(element('span', 'kicker', text(plan.course?.name, 200)), element('h3', '', text(plan.title, 160)), element('p', '', readableGoal(plan.goal, 300)), element('p', 'canvas-meta', (plan.completedStepIds?.length || 0) + ' of ' + (plan.steps?.length || 0) + ' steps complete'), planLink(plan));
      if (typeof onStudyPlan === 'function') card.appendChild(studyAction(plan));
      grid.appendChild(card);
    }
    saved.appendChild(grid);
    const selected = plans.find(plan => plan.id === selectedPlanId);
    renderDetail(selected);
    if (selectedPlanId && !selected) detail.appendChild(element('p', 'card', 'This plan is not in your saved workspace. Choose a plan below.'));
  }
  saved.appendChild(element('p', '', 'Loading saved plans.'));
  client.list().then(result => { if (current()) {
    const incoming = Array.isArray(result.plans) ? result.plans : [];
    plans = planRevision ? [...plans, ...incoming.filter(plan => !plans.some(currentPlan => currentPlan.id === plan.id))] : incoming;
    renderSaved();
  } })
    .catch(error => { if (current() && error.name !== 'AbortError') { saved.replaceChildren(element('h2', '', 'Your saved plans'), element('p', '', error.message)); } });
  return { updateCourses, updateCanvasItems, dispose() { disposed = true; client.dispose(); } };
}
