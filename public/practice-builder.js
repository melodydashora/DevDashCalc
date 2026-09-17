// A learner edits an ordinary request before opening it in the persistent
// coach. Curated previews run local, reviewed models; requests never execute code.
import { mountQuestionModel } from './question-models.js';

export const PRACTICE_VARIATIONS = Object.freeze([
  { id: 'scenario', label: 'New situation', instruction: 'Use a materially different situation with the same target skill. Change how the information must be interpreted, not only names or numbers.' },
  { id: 'representation', label: 'Different representation', instruction: 'Change the representation, such as a verbal description, table, graph or equation. Make me translate between representations to solve it.' },
  { id: 'unknown', label: 'Different unknown', instruction: 'Change which quantity is unknown and which quantities are given. Require rearranging or choosing a different step, rather than substituting new numbers into the same question.' },
  { id: 'multistep', label: 'Combine two steps', instruction: 'Combine two connected reasoning steps within this topic. State all needed givens and avoid adding an unrelated advanced topic.' },
  { id: 'explain', label: 'Explain or diagnose', instruction: 'Ask me to justify a claim, compare methods, or diagnose a plausible error. Require reasoning rather than another numerical substitution.' },
  { id: 'reword', label: 'Same reasoning, simpler wording', instruction: 'Keep the skill and reasoning the same, and use shorter, literal wording. Explicitly label this as a reworded practice item rather than a new reasoning variation.' },
]);

export const PRACTICE_MODEL_CHOICES = Object.freeze([
  { id: 'linear', label: 'Linear function graph', question: { topicId: 'sat-linear' }, scope: 'Algebra and SAT Math; slope, intercept and changes between coordinates.', request: 'Use a linear function graph with labeled axes. Connect its slope and intercept to an equation or situation, then ask me to predict or explain a change.' },
  { id: 'solid', label: '3D solid of revolution', question: { skillId: 'u8-volumes-washers' }, scope: 'Calculus volume and cross sections; rotating a region around an axis.', request: 'Use the visible 3D solid-of-revolution example. Explain how its radius, slice area and volume relate. Suggest a mathematically consistent change to the generating curve or axis.' },
  { id: 'derivative', label: '2D curve and tangent', question: { topicId: 'bc-derivatives' }, scope: 'Calculus slopes and derivatives.', request: 'Use a curve and tangent model that connects the selected point to its derivative.' },
  { id: 'accumulation', label: '2D accumulation and rectangles', question: { topicId: 'bc-integration' }, scope: 'Calculus area, accumulation and numerical approximation.', request: 'Use an accumulation model with rectangles, stated endpoints and a named approximation method.' },
  { id: 'vector', label: '2D position and velocity', question: { topicId: 'bc-parametric' }, scope: 'Planar parametric motion, within AP Calculus BC scope.', request: 'Use a planar parametric path with position and a tangent velocity vector. Distinguish speed from a velocity component.' },
  { id: 'spring', label: 'Spring motion and energy', question: { topicId: 'physics-oscillations' }, scope: 'Physics oscillation and conservation of energy.', request: 'Use a spring model with mass, spring constant and amplitude stated. Explain the changing displacement, velocity and energy.' },
  { id: 'forces', label: 'Force diagram', question: { topicId: 'physics-forces' }, scope: 'Physics force directions and Newton’s second law.', request: 'Use a force diagram with a stated coordinate direction and all relevant forces.' },
  { id: 'triangle', label: 'Right-triangle geometry', question: { topicId: 'sat-geometry' }, scope: 'SAT geometry; lengths and angles, without calculus.', request: 'Use a right-triangle diagram with labeled givens. Leave the requested unknown unlabeled until I answer.' },
  { id: 'reading', label: 'Reading evidence guide', question: { topicId: 'sat-reading-evidence' }, scope: 'SAT Reading and Writing; no spatial model is needed.', request: 'Use a short original passage and an evidence map connecting a claim to specific supporting words. Do not add an unrelated 3D object.' },
]);

const text = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export function practiceBuilderDefaults(subject) {
  const id = ({ ab: 'calculus-ab', bc: 'calculus-bc' })[subject] || subject;
  const defaults = {
    'calculus-ab': { courseName: 'AP Calculus AB', model: 'solid', topicPlaceholder: 'For example: choosing disk or washer radii' },
    'calculus-bc': { courseName: 'AP Calculus BC', model: 'solid', topicPlaceholder: 'For example: choosing disk or washer radii' },
    physics: { courseName: 'AP Physics 1', model: 'spring', topicPlaceholder: 'For example: connecting spring motion and energy' },
    sat: { courseName: 'SAT', model: 'triangle', topicPlaceholder: 'For example: supporting a claim with evidence or solving a linear equation' },
    algebra: { courseName: 'Algebra', model: 'linear', topicPlaceholder: 'For example: connecting slope, intercept and a linear equation' },
    all: { courseName: 'All courses', model: 'linear', topicPlaceholder: 'Name the course and skill, such as linear relationships' },
  };
  return defaults[id] || { courseName: 'my selected course', model: 'linear', topicPlaceholder: 'Name the course topic or skill you want to practice' };
}

export function buildPracticeRequest({ courseName, subject, topic, goal = 'question', variation = 'scenario', model, count = 5 } = {}) {
  const defaults = practiceBuilderDefaults(subject);
  const course = text(courseName, 160) || defaults.courseName;
  const focus = text(topic) || 'a suitable next topic in this course; identify the skill before asking the question';
  const change = PRACTICE_VARIATIONS.find((item) => item.id === variation) || PRACTICE_VARIATIONS[0];
  const visual = PRACTICE_MODEL_CHOICES.find((item) => item.id === model) || PRACTICE_MODEL_CHOICES.find((item) => item.id === defaults.model);
  const quantity = Number.isInteger(Number(count)) ? Math.max(2, Math.min(10, Number(count))) : 5;
  const lines = [`Help me practice ${course}.`, `Topic or skill: ${focus}.`, ''];
  if (goal === 'model') {
    lines.push('Goal: help me understand an interactive model.', visual.request,
      `The selected preview is an independent example for ${visual.scope} Check whether that scope fits my topic; if it does not, explain the mismatch and propose a relevant model.`,
      'Give me one observation or prediction to make with the visible controls, then wait for my answer.',
      'A request in this chat does not run or replace the model. Explain any proposed change in words and equations; do not claim that you changed the app or executed a new 3D scene.');
  } else {
    lines.push(goal === 'set' ? `Goal: a practice set of ${quantity} original questions, presented one at a time.` : 'Goal: one original practice question.',
      `Required variation: ${change.instruction}`,
      'State the skill, givens and what I need to find. Ask the first question and wait for my answer. Do not reveal the answer or worked solution before I attempt it.',
      'After my answer, explain the reasoning and the specific error if needed. Ask before moving to the next question.');
  }
  lines.push('', 'Keep the practice within the named course. Use original practice, not a claimed official or released SAT/AP exam question.',
    'Check the mathematics and the uniqueness of any multiple-choice answer. If the answer cannot be verified, say what is uncertain instead of claiming it is checked.',
    'Use a relevant diagram, table or representation where it helps. State when you use separate example values. Never invent missing givens.',
    'This is coach-led practice, with no official exam score or automatic mastery credit.');
  return lines.join('\n');
}

function node(tag, className, value) { const el = document.createElement(tag); if (className) el.className = className; if (value !== undefined) el.textContent = value; return el; }
function selectControl(title, options, selected) {
  const wrap = node('label', 'practice-builder-field'); wrap.append(node('span', '', title)); const select = node('select');
  for (const { id, label } of options) { const option = node('option', '', label); option.value = id; option.selected = id === selected; select.append(option); }
  wrap.append(select); return { wrap, select };
}

export function mountPracticeBuilder(container, { courseName, subject = 'calculus-bc', courses = [], onAskAstra, renderMath, motion } = {}) {
  const defaults = practiceBuilderDefaults(subject);
  const root = node('section', 'practice-builder'); container.append(root);
  const listeners = new AbortController(); let disposed = false, previewCleanup = () => {};
  root.append(node('h2', '', 'Build a request for Astra'), node('p', 'practice-builder-intro', 'Choose what should change, review the request, then open it in Astra. A different situation, representation or unknown practices a different reasoning step.'));
  const mysteryLink = node('a', 'btn secondary', 'Practice evidence and grammar with a mystery'); mysteryLink.href = '#/mystery'; root.append(mysteryLink);
  const layout = node('div', 'practice-builder-layout'), form = node('div', 'practice-builder-form'), preview = node('aside', 'practice-builder-preview'); layout.append(form, preview); root.append(layout);
  const options = [{ id: 'current', label: text(courseName, 160) || defaults.courseName }];
  for (const course of courses) { const name = text(course?.name || course?.title || course?.label, 160); if (name && !options.some((item) => item.label === name)) options.push({ id: `course-${options.length}`, label: name }); }
  const course = selectControl('Course', options, 'current'); form.append(course.wrap);
  const topicLabel = node('label', 'practice-builder-field'); topicLabel.append(node('span', '', 'Topic or skill')); const topic = node('input'); topic.type = 'text'; topic.maxLength = 500; topic.placeholder = defaults.topicPlaceholder; topicLabel.append(topic); form.append(topicLabel);
  const goal = selectControl('What to make', [{ id: 'question', label: 'One new question' }, { id: 'set', label: 'A practice set' }, { id: 'model', label: 'A model exploration' }], 'question'); form.append(goal.wrap);
  const variation = selectControl('How the reasoning should change', PRACTICE_VARIATIONS, 'scenario'); form.append(variation.wrap);
  const count = selectControl('Questions in the set', [{ id: '3', label: '3 questions' }, { id: '5', label: '5 questions' }, { id: '10', label: '10 questions' }], '5'); count.wrap.hidden = true; form.append(count.wrap);
  const model = selectControl('Available model preview', PRACTICE_MODEL_CHOICES, defaults.model); preview.append(model.wrap);
  const scope = node('p', 'practice-builder-scope'); preview.append(scope);
  preview.append(node('p', 'practice-builder-note', 'These working previews use separate example values. The 3D solid fits volume and cross-section questions; other topics use the representation that explains them. A chat request can ask for a change, but does not execute new model code.'));
  const modelSlot = node('div', 'question-model-slot'); preview.append(modelSlot);
  const updatePreview = () => { previewCleanup(); modelSlot.replaceChildren(); const selected = PRACTICE_MODEL_CHOICES.find((item) => item.id === model.select.value); scope.textContent = selected.scope; previewCleanup = mountQuestionModel(modelSlot, { question: selected.question, motion }); renderMath?.(modelSlot); };
  const write = node('button', 'secondary', 'Write request from these choices'); write.type = 'button'; form.append(write);
  const requestLabel = node('label', 'practice-builder-field'); requestLabel.append(node('span', '', 'Request you can edit')); const request = node('textarea'); request.rows = 17; request.maxLength = 6000; requestLabel.append(request); form.append(requestLabel);
  const open = node('button', '', 'Open request in Astra'); open.type = 'button'; open.disabled = typeof onAskAstra !== 'function'; form.append(open);
  const status = node('p', 'practice-builder-status'); status.setAttribute('role', 'status'); form.append(status);
  const regenerate = () => {
    request.value = buildPracticeRequest({ courseName: options.find((item) => item.id === course.select.value)?.label, subject, topic: topic.value, goal: goal.select.value, variation: variation.select.value, model: model.select.value, count: count.select.value });
    status.textContent = 'Request prepared. Edit it if needed, then open it in Astra.';
  };
  write.addEventListener('click', regenerate, { signal: listeners.signal });
  const changed = () => { count.wrap.hidden = goal.select.value !== 'set'; variation.wrap.hidden = goal.select.value === 'model'; status.textContent = 'Choices changed. Select Write request to update the text. Your edits are preserved until then.'; };
  for (const control of [course.select, topic, goal.select, variation.select, count.select]) control.addEventListener('change', changed, { signal: listeners.signal });
  model.select.addEventListener('change', () => { updatePreview(); changed(); }, { signal: listeners.signal });
  open.addEventListener('click', async () => {
    if (disposed || typeof onAskAstra !== 'function') return;
    const value = request.value.trim(); if (!value) { status.textContent = 'Write or enter a request first.'; request.focus(); return; }
    open.disabled = true;
    try { await onAskAstra(value); if (!disposed) status.textContent = 'The request is open in Astra. Review and send it there when ready.'; }
    catch { if (!disposed) status.textContent = 'Astra could not open the request. Your text is still here to copy or try again.'; }
    finally { if (!disposed) open.disabled = false; }
  }, { signal: listeners.signal });
  updatePreview(); regenerate();
  const cleanup = () => { if (disposed) return; disposed = true; listeners.abort(); previewCleanup(); observer.disconnect(); root.remove(); };
  const observer = new MutationObserver(() => { if (!root.isConnected) cleanup(); }); observer.observe(document.body, { childList: true, subtree: true });
  return cleanup;
}
