// Course choices are presentation preferences. The host still authorizes the
// current workspace and reconstructs Canvas evidence for every coach request.
const COURSE_ID = /^[0-9]{1,20}$/;
const clean = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';

export function visiblePortalCourses(courses, courseOverrides = {}) {
  const overrides = courseOverrides && typeof courseOverrides === 'object' ? courseOverrides : {};
  return (Array.isArray(courses) ? courses : []).filter(course => {
    const id = String(course?.id ?? '');
    return COURSE_ID.test(id) && !(Object.hasOwn(overrides, id) && overrides[id] === 'hidden');
  });
}

export const COURSE_MATERIAL_KINDS = Object.freeze([
  { id: 'explain', label: 'Explain a topic' },
  { id: 'guide', label: 'Study guide' },
  { id: 'flashcards', label: 'Flashcards' },
  { id: 'question', label: 'Practice' },
  { id: 'example', label: 'Worked example' },
]);
const materialKind = value => COURSE_MATERIAL_KINDS.some(kind => kind.id === value) ? value : 'explain';
export const courseMaterialActivity = kind => ({ question: 'practice', example: 'explain' })[materialKind(kind)] || materialKind(kind);

function identity(course) {
  const courseId = String(course?.id ?? '');
  const courseName = clean(course?.name, 200);
  return COURSE_ID.test(courseId) && courseName ? { courseId, courseName } : null;
}

export function courseMaterialPrompt({ course, kind = 'explain', topic = '', item = null } = {}) {
  const selected = identity(course);
  if (!selected) throw new TypeError('Choose a current course before making materials.');
  const focus = clean(topic, 500);
  const tasks = {
    explain: 'Explain this in a few clear steps, using an example that fits what I already understand.',
    guide: 'Make a short study guide with the main ideas, key terms, and a self-check.',
    flashcards: 'Make six flashcards with clear questions and answers that help me understand and remember this.',
    question: 'Ask me one practice question and wait for my answer. Then give feedback on my reasoning and ask before trying a different kind of question.',
    example: 'Show a worked example with the steps and why they work. Then offer a similar question for me to try.',
  };
  const task = tasks[materialKind(kind)];
  const coursework = item && String(item.courseId) === selected.courseId && COURSE_ID.test(String(item.id)) ? clean(item.title || item.name, 180) : '';
  return [
    `Course: ${selected.courseName}.`,
    ...(coursework ? [`Selected coursework: ${coursework}.`] : []),
    ...(focus ? [`Topic: ${focus}.`] : []),
    task,
  ].join('\n');
}

function node(tag, className = '', text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function field(label, control) {
  const wrap = node('label', 'course-materials-field');
  wrap.append(node('span', '', label), control);
  return wrap;
}

export function mountCourseMaterials(root, { course, canvasItems = [], selectedItemId = null, onGenerate, onContextChange, isCurrent = () => true } = {}) {
  let selected = identity(course), sourceItems = [], itemVersion = '';
  const form = node('form', 'course-materials-form');
  const kind = node('select');
  kind.name = 'kind';
  for (const choice of COURSE_MATERIAL_KINDS) {
    const option = node('option', '', choice.label);
    option.value = choice.id;
    kind.append(option);
  }
  kind.value = 'explain';
  const item = node('select'); item.name = 'itemId';
  const itemField = field('Coursework (optional)', item);
  const topic = node('input');
  topic.type = 'text'; topic.name = 'topic'; topic.maxLength = 500;
  topic.placeholder = 'Choose a topic or leave this blank';
  const generate = node('button', '', 'Ask Astra');
  generate.type = 'submit';
  generate.disabled = !selected || typeof onGenerate !== 'function';
  const fields = node('div', 'course-materials-fields');
  // A direct choice of learning activity.
  // lint-ui: allow
  fields.append(field('What would help?', kind), itemField, field('Topic (optional)', topic), generate);
  const status = node('p', 'course-materials-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  if (!selected) status.textContent = 'Choose a current course before making materials.';
  form.append(fields, status);
  root.append(form);

  const listeners = new AbortController();
  let disposed = false, busy = false, contextBusy = false, contextFailed = false, generation = 0, selectionVersion = '';
  const current = () => !disposed && form.isConnected && isCurrent();
  const selection = () => selected ? { ...selected, itemId: sourceItems.some(row => row.id === item.value) ? item.value : null,
    learningActivity: courseMaterialActivity(kind.value), kind: materialKind(kind.value), topic: clean(topic.value, 500) } : null;
  const controls = () => {
    generate.disabled = !selected || typeof onGenerate !== 'function' || busy || contextBusy || contextFailed;
    kind.disabled = topic.disabled = item.disabled = !selected;
    form.setAttribute('aria-busy', String(busy || contextBusy));
  };
  function cancelPending() {
    if (disposed) return;
    generation++; busy = contextBusy = contextFailed = false; status.textContent = ''; controls();
  }
  function contextChanged() {
    const metadata = selection(), version = JSON.stringify(metadata);
    if (version === selectionVersion) return;
    selectionVersion = version; cancelPending();
    if (!current() || typeof onContextChange !== 'function') return;
    const ownGeneration = generation;
    const failed = () => {
      if (!current() || generation !== ownGeneration) return;
      contextBusy = false; contextFailed = true; controls(); status.textContent = 'These study choices could not be opened. Choose them again.';
    };
    try {
      const result = onContextChange(metadata);
      if (result && typeof result.then === 'function') {
        contextBusy = true; controls();
        Promise.resolve(result).then(() => { if (current() && generation === ownGeneration) { contextBusy = false; controls(); } }, failed);
      }
    } catch { failed(); }
  }
  function updateItems(rows, preferred = item.value) {
    const seen = new Set();
    const next = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = String(row?.id ?? ''), title = clean(row?.title || row?.name, 180);
      if (!selected || String(row?.courseId ?? '') !== selected.courseId || !COURSE_ID.test(id) || !title || seen.has(id)) continue;
      seen.add(id); next.push({ id, courseId: selected.courseId, title });
    }
    const version = JSON.stringify(next);
    if (version !== itemVersion) {
      itemVersion = version; sourceItems = next;
      const any = node('option', '', 'No specific assignment'); any.value = '';
      item.replaceChildren(any);
      for (const row of sourceItems) { const option = node('option', '', row.title); option.value = row.id; item.append(option); }
    }
    item.value = sourceItems.some(row => row.id === String(preferred)) ? String(preferred) : '';
    itemField.hidden = !sourceItems.length;
  }
  updateItems(canvasItems, selectedItemId);
  selectionVersion = JSON.stringify(selection()); controls();
  kind.addEventListener('change', contextChanged, { signal: listeners.signal });
  item.addEventListener('change', contextChanged, { signal: listeners.signal });
  topic.addEventListener('input', contextChanged, { signal: listeners.signal });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!current() || busy || contextBusy || contextFailed || !selected || typeof onGenerate !== 'function') return;
    const version = ++generation;
    const metadata = selection();
    const prompt = courseMaterialPrompt({ course: { id: selected.courseId, name: selected.courseName }, kind: metadata.kind, topic: metadata.topic, item: sourceItems.find(row => row.id === metadata.itemId) });
    busy = true; controls();
    status.textContent = 'Astra is preparing your material in the Coach.';
    try {
      const result = await onGenerate(prompt, metadata);
      if (!current() || version !== generation) return;
      status.textContent = result === false
        ? 'Your request is ready in the Coach draft. Finish the current reply, then select Send.'
        : 'See the Coach below for your request and response.';
    } catch {
      if (current() && version === generation) status.textContent = 'The request could not be sent. Your choices are still here to try again.';
    } finally {
      if (current() && version === generation) {
        busy = false; controls();
      }
    }
  }, { signal: listeners.signal });
  const cleanup = () => {
    if (disposed) return;
    disposed = true; generation++;
    listeners.abort();
    form.remove();
  };
  cleanup.selection = selection;
  cleanup.cancelPending = cancelPending;
  cleanup.updateSources = (value = {}) => {
    if (disposed || !form.isConnected) return;
    const oldCourseId = selected?.courseId, oldItem = item.value;
    if (Object.hasOwn(value, 'course')) selected = identity(value.course);
    if (selected?.courseId !== oldCourseId) { kind.value = 'explain'; topic.value = ''; item.value = ''; }
    if (Object.hasOwn(value, 'canvasItems')) canvasItems = value.canvasItems;
    updateItems(canvasItems); contextChanged(); controls();
    if (oldItem && !item.value && selected?.courseId === oldCourseId && current()) status.textContent = 'That assignment is no longer available here. Choose another item or study a topic.';
  };
  return cleanup;
}
