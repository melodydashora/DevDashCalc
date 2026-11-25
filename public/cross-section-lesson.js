// Both views use the same square, prompt and answer key. The learner chooses
// a representation; changing the camera or the view never submits an answer.
const TARGET = 2;
export function squareSlice(x) {
  const side = x + 1;
  return { side, area: side ** 2, corners: [[x, 0, 0], [x, side, 0], [x, side, side], [x, 0, side]] };
}
const fmt = n => String(Number(n.toFixed(4)));

function sliceDiagram(x) {
  const step = 34, left = 42, bottom = 174;
  const cutX = left + x * step, side = squareSlice(x).side * step;
  return `<svg viewBox="0 0 400 213" aria-hidden="true">
    <text x="25" y="19">Base in the xy-plane</text><text x="215" y="19">Square slice</text>
    <polygon class="slice-base" points="42,174 144,174 144,38 42,140"/>
    <path class="slice-wire" d="M42 31V174H165"/>
    <text x="24" y="45">y</text><text x="162" y="193">x</text>
    <text x="38" y="198">0</text><text x="141" y="198">3</text>
    <line class="slice-mark" x1="${cutX}" x2="${cutX}" y1="${bottom}" y2="${bottom-side}"/>
    <rect class="slice-face" x="218" y="${bottom-side}" width="${side}" height="${side}"/>
    <line class="slice-mark" x1="218" x2="${218+side}" y1="${bottom}" y2="${bottom}"/>
  </svg>`;
}

function sliceModel(x, angle) {
  const radians = angle * Math.PI / 180;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  const tilt = Math.PI / 7;
  function project([u, v, height]) {
    // Rotate around the vertical through the centre of the bounding box.
    const a = u - 1.5, b = v - 2;
    return [202 + 31 * (a * cos - b * sin),
      109 - 31 * ((height - 2) * Math.cos(tilt) + (a * sin + b * cos) * Math.sin(tilt))];
  }
  function square(u) {
    return squareSlice(u).corners.map(project);
  }
  function points(vertices) {
    return vertices.map(p => p.map(fmt).join(',')).join(' ');
  }
  const start = square(0), end = square(3), slice = square(x);
  return `<svg viewBox="0 0 400 213" aria-hidden="true">
    <polygon class="slice-base" points="${points([start[0], end[0], end[1], start[1]])}"/>
    <g class="slice-wire"><polygon points="${points(start)}"/><polygon points="${points(end)}"/>
    ${start.map((p, i) => `<polyline points="${points([p, end[i]])}"/>`).join('')}</g>
    <polygon class="slice-face" points="${points(slice)}"/>
    <polyline class="slice-mark" points="${points(slice.slice(0, 2))}"/>
  </svg>`;
}

const prompts = `<form class="slice-predict">
  <fieldset><legend>1. Predict the area at x = 2</legend>
    <label>Square area (square units) <input name="area" type="number" inputmode="decimal" min="0" step="any" required></label>
    <button type="submit">Check area</button>
  </fieldset></form>
  <p class="slice-area-feedback" role="status"></p>
  <form class="slice-setup" hidden>
    <fieldset><legend>2. Choose the integral for the whole solid</legend>
      <p>Each option integrates from x = 0 to x = 3. Choose the quantity to integrate with respect to x.</p>
      <label><input type="radio" name="integrand" value="side" required> x + 1</label>
      <label><input type="radio" name="integrand" value="square"> (x + 1)²</label>
      <label><input type="radio" name="integrand" value="disk"> π(x + 1)²</label>
      <button type="submit">Check integral</button>
    </fieldset>
  </form>
  <p class="slice-setup-feedback" role="status"></p>
  <form class="slice-finish" hidden>
    <fieldset><legend>Finish practice</legend>
      <label>Mental effort (optional)
        <select name="effort"><option value="">Skip rating</option>
        <option value="1">1 · Very low</option><option value="2">2 · Low</option>
        <option value="3">3 · Moderate</option><option value="4">4 · High</option>
        <option value="5">5 · Very high</option></select>
      </label>
      <label><input type="checkbox" name="accessDifficulty"> I had difficulty using the diagram or controls.</label>
      <button type="submit">Finish practice</button>
    </fieldset>
  </form>
  <p class="slice-finished" role="status"></p>`;

export function mountCrossSectionLesson(container, { onComplete } = {}) {
  const root = document.createElement('section');
  root.className = 'card cross-section-lesson';
  root.innerHTML = `<h2>Volume from square slices</h2>
    <p>Answer two questions at your own pace. Each answer opens a worked explanation. This optional practice has no pass mark.</p>
    <p>The base lies between y = 0 and y = x + 1, from x = 0 to x = 3.
    Every slice perpendicular to the x-axis is a square. Its bottom edge spans the base from one curve to the other.</p>
    <div role="group" aria-label="Choose a view" class="btn-row">
      <button type="button" class="lab-mode" data-view="diagram" aria-pressed="false">2D diagram</button>
      <button type="button" class="lab-mode" data-view="3d" aria-pressed="false">Rotate in 3D</button>
    </div>
    <div class="slice-workspace" hidden>
      <figure><div class="slice-picture"></div><figcaption></figcaption></figure>
      <label class="slice-camera" hidden>Camera angle
        <input type="range" min="-180" max="180" value="-35" step="5"><output>-35°</output>
      </label>
      <label class="slice-location" hidden>Explore the slice at x
        <input type="range" min="0" max="3" value="2" step="0.25"><output>2</output>
      </label>
      ${prompts}
    </div>`;
  container.appendChild(root);

  const select = selector => root.querySelector(selector);
  const camera = select('.slice-camera input'), location = select('.slice-location input');
  const predict = select('.slice-predict'), setup = select('.slice-setup'), finish = select('.slice-finish');
  let mode, initialMode, switchedView = false;
  let firstPredictionCorrect, firstSetupCorrect, completed = false;

  function draw() {
    const x = Number(location.value), angle = Number(camera.value);
    const { side, area } = squareSlice(x);
    select('.slice-picture').innerHTML = mode === 'diagram' ? sliceDiagram(x) : sliceModel(x, angle);
    select('figcaption').textContent = `At x = ${fmt(x)}, the thick edge runs from y = 0 to y = x + 1 and forms the bottom side of the square.` +
      (firstPredictionCorrect === undefined ? '' : ` Its length is ${fmt(side)} units. The square has area ${fmt(area)} square units.`);
    select('.slice-camera output').textContent = angle + '°';
    camera.setAttribute('aria-valuetext', angle + ' degrees');
    select('.slice-location output').textContent = fmt(x);
    location.setAttribute('aria-valuetext', firstPredictionCorrect === undefined ? fmt(x) :
      `x = ${fmt(x)}, side ${fmt(side)}, area ${fmt(area)}`);
  }
  for (const button of root.querySelectorAll('[data-view]')) {
    button.addEventListener('click', () => {
      const next = button.dataset.view;
      if (mode && next !== mode) switchedView = true;
      initialMode ??= next;
      mode = next;
      for (const choice of root.querySelectorAll('[data-view]')) {
        choice.setAttribute('aria-pressed', String(choice.dataset.view === mode));
      }
      select('.slice-workspace').hidden = false;
      select('.slice-camera').hidden = mode !== '3d';
      draw();
    });
  }
  camera.addEventListener('input', draw);
  location.addEventListener('input', draw);
  predict.addEventListener('submit', event => {
    event.preventDefault();
    if (!mode || firstPredictionCorrect !== undefined || !predict.reportValidity()) return;
    firstPredictionCorrect = predict.elements.area.valueAsNumber === squareSlice(TARGET).area;
    predict.querySelector('fieldset').disabled = true;
    const feedback = select('.slice-area-feedback');
    feedback.classList.add('feedback', firstPredictionCorrect ? 'good' : 'notyet');
    feedback.textContent = (firstPredictionCorrect ? 'Correct. ' : 'Not yet. Compare the side length and the area. ') +
      'At x = 2 the side is (2 + 1) − 0 = 3 units, so the area is 3 × 3 = 9 square units. Move the slice to see how its area changes.';
    select('.slice-location').hidden = false;
    setup.hidden = false;
    draw();
    setup.elements.integrand[0].focus();
  });
  setup.addEventListener('submit', event => {
    event.preventDefault();
    if (firstPredictionCorrect === undefined || firstSetupCorrect !== undefined || !setup.reportValidity()) return;
    const answer = setup.elements.integrand.value;
    firstSetupCorrect = answer === 'square';
    setup.querySelector('fieldset').disabled = true;
    const feedback = answer === 'side' ? 'Not yet. The side length needs to be squared to find area. ' :
      answer === 'disk' ? 'Not yet. The factor π applies to circular slices. These slices are squares. ' : 'Correct. ';
    const explanation = select('.slice-setup-feedback');
    explanation.classList.add('feedback', firstSetupCorrect ? 'good' : 'notyet');
    explanation.textContent = feedback +
      'Volume is the integral of (x + 1)² from 0 to 3. An antiderivative is (x + 1)³ / 3, so the volume is (64 − 1) / 3 = 21 cubic units.';
    finish.hidden = false;
    finish.elements.effort.focus();
  });
  finish.addEventListener('submit', event => {
    event.preventDefault();
    if (firstSetupCorrect === undefined || completed) return;
    completed = true;
    finish.querySelector('fieldset').disabled = true;
    select('.slice-finished').textContent = 'Practice complete. You can keep exploring the slices.';
    onComplete?.({ mode, initialMode, switchedView, firstPredictionCorrect, firstSetupCorrect,
      effort: Number(finish.elements.effort.value) || null, accessDifficulty: finish.elements.accessDifficulty.checked });
  });
  return () => root.remove();
}
