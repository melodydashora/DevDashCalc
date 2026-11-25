// Follow-up on the cross-section lesson. The caller supplies the current
// profile's progress adapter. The lesson and its check never alter unit mastery.
const FORTNIGHT = 14 * 24 * 60 * 60 * 1000;
const isMode = mode => mode === 'diagram' || mode === '3d';
const isTime = value => Number.isFinite(value) && value >= 0 && value < 8.64e15 - FORTNIGHT;
const hasLesson = record => record?.version === 1 && isTime(record.completedAt) && isMode(record.lesson?.mode);

export function recordSpatialLesson(record, lesson, now) {
  if (!isMode(lesson?.mode) || !isTime(now)) return record;
  if (hasLesson(record)) {
    if (record.result || now <= record.lastPracticeAt) return record;
    return { ...record, lastPracticeAt: now };
  }
  return {
    version: 1, completedAt: now, lastPracticeAt: now, scheduled: false, hintUsed: false,
    lesson: {
      mode: lesson.mode, initialMode: isMode(lesson.initialMode) ? lesson.initialMode : lesson.mode,
      switchedView: lesson.switchedView === true, accessDifficulty: lesson.accessDifficulty === true,
      firstPredictionCorrect: lesson.firstPredictionCorrect === true,
      firstSetupCorrect: lesson.firstSetupCorrect === true,
      effort: Number.isInteger(lesson.effort) && lesson.effort >= 1 && lesson.effort <= 5 ? lesson.effort : null,
    },
    result: null,
  };
}

export function spatialReviewDue(record, now = Date.now()) {
  return hasLesson(record) && record.scheduled === true && !record.result && isTime(now)
    && now >= record.completedAt + FORTNIGHT;
}

export function recordSpatialCheck(record, { area, setup, usedHelp }, now) {
  if (!spatialReviewDue(record, now) || !Number.isFinite(area) || !['width', 'triangle', 'square'].includes(setup)) return record;
  return {
    ...record,
    result: {
      checkedAt: now, areaCorrect: area === 8, setupCorrect: setup === 'triangle',
      assisted: record.hintUsed === true || record.coachHelp === true || usedHelp === true,
    },
  };
}

const setupOptions = [
  ['width', 'Integral of (6 − x) from 0 to 6'],
  ['triangle', 'Integral of (6 − x)² / 2 from 0 to 6'],
  ['square', 'Integral of (6 − x)² from 0 to 6'],
];

export function mountSpatialReview(host, { getRecord, setRecord, now = Date.now, reviewOnly = true }) {
  let disposed = false, wake;
  const update = (record, focus) => {
    if (disposed) return;
    setRecord(record);
    render(focus);
  };
  const showHint = () => {
    host.querySelector('.review-hint').hidden = false;
    host.querySelector('.review-help').disabled = true;
  };
  function render(focus = false) {
    if (disposed) return;
    clearTimeout(wake);
    const record = getRecord();
    host.innerHTML = '<h2 tabindex="-1">Two-week cross-section check</h2>';
    const add = html => host.insertAdjacentHTML('beforeend', html);
    if (!hasLesson(record)) {
      add('<p>After the two lesson predictions, you can schedule a fresh problem to check what you remember.</p>');
    } else if (record.result) {
      const { areaCorrect, setupCorrect, assisted, checkedAt } = record.result;
      const delayDays = Math.floor((checkedAt - record.completedAt) / 86400000);
      const recentPractice = record.lastPracticeAt > record.completedAt && isTime(record.lastPracticeAt) && isTime(checkedAt)
        ? ` You repeated the lesson ${Math.max(0, Math.floor((checkedAt - record.lastPracticeAt) / 86400000))} days before this check.` : '';
      add(`<p role="status">First follow-up response · ${assisted ? 'with help' : 'without reported help'}${Number.isFinite(delayDays) ? ` · ${delayDays} days after the lesson` : ''}.${recentPractice}</p>
        <ul><li>Slice area · ${areaCorrect ? 'correct' : 'Not yet. Review the area calculation below.'}</li><li>Volume setup · ${setupCorrect ? 'correct' : 'Not yet. Review the integral below.'}</li></ul>
        <p>At x = 2 the two legs measure 6 − 2 = 4 units. The triangular slice has area 4 × 4 / 2 = 8 square units. At any x, the area is (6 − x)² / 2. Integrate that area from x = 0 to x = 6 to find the volume.</p>`);
    } else if (!record.scheduled || !spatialReviewDue(record, now())) {
      const due = record.completedAt + FORTNIGHT;
      const date = new Date(due).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      if (record.scheduled) {
        add(`<p role="status">Your follow-up opens ${date}. You can keep practicing at your own pace.</p>
          <button type="button" class="quiet review-plan">Remove scheduled check</button>`);
        wake = setTimeout(() => render(), Math.min(0x7fffffff, Math.max(1, due - now())));
      } else {
        add(`<p>This optional problem checks how you use cross-sections in a different solid. ${now() >= due ? 'You can take it now.' : `It opens ${date}, two weeks after your first lesson.`}</p>
          <button type="button" class="secondary review-plan">${now() >= due ? 'Open follow-up check' : 'Schedule the two-week check'}</button>`);
      }
      host.querySelector('.review-plan').onclick = () => {
        const current = getRecord();
        if (hasLesson(current) && !current.result) update({ ...current, scheduled: !current.scheduled }, true);
      };
    } else if (!reviewOnly) {
      add('<p><a href="#/cross-sections/review">Take your two-week cross-section check</a></p>');
    } else {
      add(`<p>On 0 ≤ x ≤ 6, a solid's base lies between y = x and y = 6. Each slice perpendicular to the x-axis is a right triangle with both legs equal to that vertical width.</p>
        <form class="review-form canvas-form">
          <label>Area of the triangular slice at x = 2, in square units <input name="area" type="number" step="any" required></label>
          <label>Choose the integral that gives the volume
            <select name="setup" required><option value="">Select an integral</option>${setupOptions.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>
          </label>
          <label><input type="checkbox" name="help"> I used a worked example, tutor, or other help with the math.</label>
          <p>There are two parts and one submission. After you submit, you will see both results and the solution. Using a hint or asking Astra for help with this problem marks the response as assisted.</p>
          <button type="button" class="secondary review-help">Show a hint</button>
          <p class="review-hint" role="status" hidden>Subtract the lower y-value from the upper one to find each leg. A right triangle's area is half the product of its legs.</p>
          <p class="review-coach-help" role="status" hidden>Coach guidance received. Your response will be recorded as assisted.</p>
          <button type="submit">Check my reasoning</button>
        </form>`);
      if (record.hintUsed) showHint();
      if (record.coachHelp) host.querySelector('.review-coach-help').hidden = false;
      host.querySelector('.review-help').onclick = () => {
        const current = getRecord();
        if (!spatialReviewDue(current, now())) return;
        setRecord({ ...current, hintUsed: true });
        showHint();
      };
      const form = host.querySelector('form');
      form.onsubmit = event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const current = getRecord(), result = recordSpatialCheck(current, {
          area: form.elements.area.valueAsNumber, setup: form.elements.setup.value, usedHelp: form.elements.help.checked,
        }, now());
        if (result !== current) update(result, true);
      };
    }
    if (focus) host.querySelector('h2')?.focus();
  }
  render();
  return {
    complete(lesson) {
      if (disposed) return;
      const current = getRecord(), result = recordSpatialLesson(current, lesson, now());
      if (result !== current) update(result);
    },
    markCoachHelp() {
      const current = getRecord();
      if (disposed || !reviewOnly || !spatialReviewDue(current, now()) || current.coachHelp) return;
      const status = host.querySelector('.review-coach-help');
      if (!status) return;
      setRecord({ ...current, coachHelp: true });
      status.hidden = false;
    },
    destroy() { disposed = true; clearTimeout(wake); host.replaceChildren(); },
  };
}
