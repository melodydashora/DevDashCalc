// A small visual workbench and the shared, opt-in animation transport.
// The home demo can start in full motion; reduced/off modes never autoplay.
// Sliders remain usable with motion off.

const activePlayers = new Map();
let lifecycleObserver;

function currentMotion(fallback) {
  const configured = document.documentElement.dataset.motion || fallback;
  if (['full', 'reduced', 'off'].includes(configured)) return configured;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full';
}

function observePlayers() {
  if (lifecycleObserver) return;
  lifecycleObserver = new MutationObserver((records) => {
    const settingsChanged = records.some((record) => record.type === 'attributes');
    for (const [element, player] of activePlayers) {
      if (!element.isConnected) player.destroy();
      else if (settingsChanged) player.refresh();
    }
  });
  lifecycleObserver.observe(document.documentElement, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['data-motion', 'data-theme', 'data-textsize'],
  });
  document.addEventListener('visibilitychange', pauseHidden);
}

function pauseHidden() {
  if (document.hidden) for (const player of activePlayers.values()) player.pause();
}

/** Animate one slider; return { play, pause, refresh, destroy }.
 * update(value) redraws without dispatching an input event. Manual input pauses.
 * Reverse is useful for watching h approach zero. No timers or scores change.
 */
export function attachPlayback(container, {
  range, update, reset, reverse = false, duration = 12000, motion, autoplay = false, loop = false,
  description = 'Play moves the highlighted parameter once. Drag the slider to inspect any step.',
}) {
  const controls = document.createElement('div');
  controls.className = 'viz-playback';
  controls.innerHTML = `<div class="viz-transport">
    <button type="button" class="viz-play">Play</button>
    <button type="button" class="secondary viz-reset">Reset</button>
    <label class="viz-speed">Speed <select aria-label="Animation speed">
      <option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option>
    </select></label>
    <span class="viz-play-state" role="status">Paused</span>
  </div><p class="viz-play-help"></p>`;
  container.appendChild(controls);
  const button = controls.querySelector('.viz-play');
  const state = controls.querySelector('.viz-play-state');
  const speed = controls.querySelector('select');
  const help = controls.querySelector('.viz-play-help');
  const initial = Number(range.value);
  let running = false, frameId = 0, previous = 0, cursor = initial, disposed = false;
  let mode = currentMotion(motion);
  const set = (value) => {
    range.value = String(value);
    update(Number(range.value));
  };
  const pause = () => {
    running = false;
    cancelAnimationFrame(frameId);
    frameId = 0;
    previous = 0;
    button.textContent = 'Play';
    button.setAttribute('aria-pressed', 'false');
    state.textContent = mode === 'off' ? 'Motion off' : 'Paused';
  };
  const tick = (timestamp) => {
    if (!running || disposed) return;
    if (!container.isConnected) { destroy(); return; }
    if (document.hidden) { pause(); return; }
    const details = container.closest('details');
    if (details && !details.open) { pause(); return; }
    const elapsed = previous ? Math.min(timestamp - previous, 100) : 0;
    previous = timestamp;
    const min = Number(range.min), max = Number(range.max), step = Number(range.step) || 1;
    const rate = Number(speed.value) * (mode === 'reduced' ? 0.5 : 1);
    cursor += (reverse ? -1 : 1) * elapsed * rate * (max - min) / duration;
    const value = Math.max(min, Math.min(max, min + Math.round((cursor - min) / step) * step));
    if (value !== Number(range.value)) set(value);
    if (reverse ? cursor <= min : cursor >= max) {
      if (typeof loop === 'function' ? loop() : loop) { cursor = reverse ? max : min; }
      else { pause(); state.textContent = 'Complete'; return; }
    }
    frameId = requestAnimationFrame(tick);
  };
  const toggle = () => {
    if (running) { pause(); return; }
    if (disposed || mode === 'off' || document.hidden) return;
    const min = Number(range.min), max = Number(range.max);
    cursor = Number(range.value);
    if (reverse ? cursor <= min : cursor >= max) { cursor = reverse ? max : min; set(cursor); }
    running = true;
    previous = 0;
    button.textContent = 'Pause';
    button.setAttribute('aria-pressed', 'true');
    state.textContent = 'Playing';
    frameId = requestAnimationFrame(tick);
  };
  const resetPlayer = () => { pause(); if (reset) reset(); else set(initial); };
  const refresh = () => {
    const nextMode = currentMotion(motion);
    if (nextMode !== mode) { mode = nextMode; pause(); }
    button.disabled = mode === 'off';
    help.textContent = mode === 'off'
      ? 'Motion is off. Use the slider to inspect each step. Change motion in Settings to enable Play.'
      : `${description}${mode === 'reduced' ? ' Reduced motion uses half the selected speed.' : ''}`;
    update(Number(range.value));
  };
  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => update(Number(range.value))) : null;
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    pause();
    activePlayers.delete(container);
    range.removeEventListener('input', pause);
    button.removeEventListener('click', toggle);
    controls.querySelector('.viz-reset').removeEventListener('click', resetPlayer);
    mediaQuery.removeEventListener('change', refresh);
    resizeObserver?.disconnect();
    if (!activePlayers.size) {
      lifecycleObserver?.disconnect();
      lifecycleObserver = undefined;
      document.removeEventListener('visibilitychange', pauseHidden);
    }
  };
  const player = { play: () => { if (!running) toggle(); }, pause, refresh, destroy };
  activePlayers.get(container)?.destroy();
  activePlayers.set(container, player);
  range.addEventListener('input', pause);
  button.addEventListener('click', toggle);
  controls.querySelector('.viz-reset').addEventListener('click', resetPlayer);
  mediaQuery.addEventListener('change', refresh);
  resizeObserver?.observe(container);
  observePlayers();
  pause();
  refresh();
  if (autoplay && mode === 'full') player.play();
  return player;
}

function polynomial(x, terms) {
  let sum = 0, term = x;
  for (let k = 0; k < terms; k++) {
    if (k > 0) term *= -x * x / ((2 * k) * (2 * k + 1));
    sum += term;
  }
  return sum;
}

/** Home-page workbench. Returns cleanup; routes may also remove its container. */
export function mountStudyLab(container, { motion, course = 'bc', mastery = 0 } = {}) {
  const isBC = String(course).toLowerCase().includes('bc');
  const isPhysics = course === 'physics';
  const shell = document.createElement('section');
  shell.className = 'study-lab';
  shell.setAttribute('aria-label', 'Calculus visual lab');
  shell.innerHTML = `<div class="lab-heading">
    <div><p class="lab-eyebrow">STUDENTS4AI / CALCULUS LAB</p>
      <h2>Make the math move.</h2>
      <p class="lab-intro">Change a value. Watch the graph. Trace the calculation.</p></div>
    <span class="lab-course-tag"></span>
  </div>
  <div class="lab-modes" role="group" aria-label="Visual lab topic"></div>
  <div class="lab-workspace">
    <div class="lab-visual"><div class="lab-pane-title"><span>GRAPH OUTPUT</span><span class="lab-graph-label"></span></div>
      <canvas role="img"></canvas><div class="lab-legend"></div></div>
    <div class="lab-console"><div class="lab-pane-title"><span>CALCULATION TRACE</span><span>JavaScript</span></div>
      <pre><code></code></pre><div class="lab-metrics"></div></div>
  </div>
  <div class="lab-control-area"><label class="viz-slider">
    <span class="viz-slider-label"></span><input type="range" min="0" max="1000" step="1" value="125">
    <output class="viz-slider-out"></output></label></div>
  <p class="lab-explanation"></p><div class="lab-challenge"></div>`;
  container.appendChild(shell);
  shell.querySelector('.lab-course-tag').textContent = isPhysics ? 'EXPLORING PHYSICS' : isBC ? 'AP CALCULUS BC' : 'AP CALCULUS AB';
  if (isPhysics) {
    shell.setAttribute('aria-label', 'Mathematics of motion lab');
    shell.querySelector('.lab-eyebrow').textContent = 'STUDENTS4AI / MATHEMATICS OF MOTION';
  }
  const canvas = shell.querySelector('canvas');
  const range = shell.querySelector('input');
  const code = shell.querySelector('code');
  const metrics = shell.querySelector('.lab-metrics');
  const output = shell.querySelector('output');
  const note = shell.querySelector('.lab-explanation');
  const modes = isBC
    ? [['parametric', '01 / Vector motion'], ['series', '02 / Taylor series'], ['derivative', '03 / Derivatives']]
    : isPhysics ? [['parametric', '01 / Vector motion'], ['derivative', '02 / Rates of change']]
      : [['derivative', '01 / Derivatives']];
  const level = Number.isFinite(mastery) ? Math.max(0, Math.min(100, mastery)) : 0;
  let selected = isBC && level >= 60 ? 'series' : modes[0][0];
  let player;
  const num = (n) => Math.abs(n) < 0.00005 ? '0.0000' : n.toFixed(4);
  const textMetric = (label, value) => `<div><span>${label}</span><strong>${value}</strong></div>`;

  const draw = () => {
    const progress = Number(range.value) / Number(range.max);
    const styles = getComputedStyle(document.documentElement);
    const color = (name) => styles.getPropertyValue(name).trim();
    const accent = color('--accent'), green = color('--good'), amber = color('--notyet');
    const width = Math.max(250, canvas.parentElement.clientWidth - 2);
    const height = 282;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = height * dpr;
    canvas.style.width = '100%'; canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bounds = selected === 'series' ? [-5, 5, -2.1, 2.1] : [-4, 4, -3, 3];
    const [xmin, xmax, ymin, ymax] = bounds;
    const X = (x) => 28 + (x - xmin) / (xmax - xmin) * (width - 48);
    const Y = (y) => 18 + (ymax - y) / (ymax - ymin) * (height - 40);
    const line = (x1, y1, x2, y2, stroke, weight = 1) => {
      ctx.beginPath(); ctx.strokeStyle = stroke; ctx.lineWidth = weight;
      ctx.moveTo(X(x1), Y(y1)); ctx.lineTo(X(x2), Y(y2)); ctx.stroke();
    };
    ctx.fillStyle = color('--muted'); ctx.font = '10px ui-monospace, monospace';
    for (let x = Math.ceil(xmin); x <= xmax; x++) {
      line(x, ymin, x, ymax, color('--border'));
      if (x !== 0) ctx.fillText(String(x), X(x) - 3, Y(0) + 14);
    }
    for (let y = Math.ceil(ymin); y <= ymax; y++) line(xmin, y, xmax, y, color('--border'));
    line(xmin, 0, xmax, 0, color('--muted'));
    line(0, ymin, 0, ymax, color('--muted'));
    ctx.fillText('x', width - 13, Y(0) + 4); ctx.fillText('y', X(0) + 6, 12);
    const curve = (fx, fy, start, end, stroke, dashed = false) => {
      ctx.save(); ctx.beginPath(); ctx.rect(27, 17, width - 46, height - 38); ctx.clip();
      ctx.beginPath(); ctx.strokeStyle = stroke; ctx.lineWidth = 2.4; ctx.setLineDash(dashed ? [6, 5] : []);
      for (let i = 0; i <= 240; i++) {
        const t = start + i * (end - start) / 240;
        const x = X(fx(t)), y = Y(fy(t));
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke(); ctx.restore();
    };
    const dot = (x, y, fill) => {
      ctx.beginPath(); ctx.arc(X(x), Y(y), 6, 0, Math.PI * 2);
      ctx.fillStyle = color('--surface'); ctx.fill(); ctx.strokeStyle = fill; ctx.lineWidth = 3; ctx.stroke();
    };
    if (selected === 'parametric') {
      const t = progress * 2 * Math.PI, x = 3 * Math.cos(t), y = 2 * Math.sin(t);
      const vx = -3 * Math.sin(t), vy = 2 * Math.cos(t);
      curve((v) => 3 * Math.cos(v), (v) => 2 * Math.sin(v), 0, 2 * Math.PI, color('--border'));
      curve((v) => 3 * Math.cos(v), (v) => 2 * Math.sin(v), 0, t, accent);
      line(x, y, x + 0.42 * vx, y + 0.42 * vy, amber, 3);
      const angle = Math.atan2(Y(y + vy * 0.42) - Y(y), X(x + vx * 0.42) - X(x));
      ctx.fillStyle = amber; ctx.beginPath();
      const tipX = X(x + vx * 0.42), tipY = Y(y + vy * 0.42);
      ctx.moveTo(tipX, tipY); ctx.lineTo(tipX - 10 * Math.cos(angle - 0.45), tipY - 10 * Math.sin(angle - 0.45));
      ctx.lineTo(tipX - 10 * Math.cos(angle + 0.45), tipY - 10 * Math.sin(angle + 0.45)); ctx.fill();
      dot(x, y, accent);
      code.textContent = `const t = ${num(t)};\n\nconst position = [\n  3 * Math.cos(t),\n  2 * Math.sin(t)\n];\n\nconst velocity = [\n  -3 * Math.sin(t),\n   2 * Math.cos(t)\n];\n\nconst speed = Math.hypot(\n  ...velocity\n);`;
      metrics.innerHTML = textMetric('position [x, y]', `[${x.toFixed(2)}, ${y.toFixed(2)}]`) + textMetric('speed |v|', num(Math.hypot(vx, vy)));
      output.textContent = `${t.toFixed(2)} rad`;
    } else if (selected === 'series') {
      const terms = Number(range.value);
      const degree = 2 * terms - 1, evaluationX = 3;
      const approx = polynomial(evaluationX, terms), exact = Math.sin(evaluationX);
      curve((x) => x, Math.sin, -5, 5, accent);
      curve((x) => x, (x) => polynomial(x, terms), -5, 5, amber, true);
      if (approx >= ymin && approx <= ymax) dot(evaluationX, approx, amber);
      dot(evaluationX, exact, accent);
      code.textContent = `const x = 3;\nconst terms = ${terms}; // degree ${degree}\nlet sum = 0;\nlet term = x;\n\nfor (let k = 0; k < terms; k++) {\n  if (k > 0) term *=\n    -x*x / ((2*k)*(2*k+1));\n  sum += term;\n}\n\nconst error = Math.abs(\n  sum - Math.sin(x)\n);`;
      metrics.innerHTML = textMetric('P(3)', num(approx)) + textMetric('absolute error at x = 3', num(Math.abs(approx - exact)));
      output.textContent = `degree ${degree}`;
    } else {
      const x = -2 + 4 * progress, f = (v) => v ** 3 / 3 - v, slope = x * x - 1;
      curve((v) => v, f, -3, 3, accent);
      line(x - 0.75, f(x) - 0.75 * slope, x + 0.75, f(x) + 0.75 * slope, amber, 2.4);
      dot(x, f(x), accent);
      code.textContent = `const x = ${num(x)};\n\nconst f = x => x**3 / 3 - x;\nconst df = x => x*x - 1;\n\nconst point = [x, f(x)];\nconst slope = df(x);\n\n// Tangent line at x:\nconst tangent = u =>\n  f(x) + slope * (u - x);`;
      metrics.innerHTML = textMetric('f(x)', num(f(x))) + textMetric('derivative f′(x)', num(slope));
      output.textContent = `x = ${x.toFixed(2)}`;
    }
    range.setAttribute('aria-valuetext', output.textContent);
  };

  const choose = (id) => {
    player?.pause();
    selected = id;
    range.min = id === 'series' ? '1' : '0';
    range.max = id === 'series' ? '7' : '1000';
    range.value = id === 'parametric' ? '125' : id === 'series' ? '1' : '500';
    shell.querySelectorAll('.lab-mode').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === id)));
    const labels = {
      parametric: ['Time t', 'position(t) → velocity(t)', 'Path travelled', 'Velocity vector', 'The point follows x(t) = 3 cos t, y(t) = 2 sin t. The amber arrow shows velocity, scaled to fit the graph. Its direction is tangent to the path; its length changes with speed.'],
      series: ['Terms in the approximation', 'sin(x) ≈ Taylor polynomial', 'Exact sin(x)', 'Taylor approximation', 'Add terms to a Maclaurin polynomial for sin(x). The dashed amber polynomial approaches the solid curve. The trace checks the error at x = 3. More terms improve the approximation there; this does not make a finite polynomial equal to sin(x) everywhere.'],
      derivative: ['Position x', 'f(x) → f′(x)', 'Function f(x)', 'Tangent line', 'Move along f(x) = x³/3 − x. The amber tangent has slope f′(x) = x² − 1. The slope is negative between −1 and 1, zero at those endpoints, and positive outside that interval.'],
    };
    const [label, graphLabel, legend1, legend2, explanation] = labels[id];
    shell.querySelector('.viz-slider-label').textContent = label;
    shell.querySelector('.lab-graph-label').textContent = graphLabel;
    canvas.setAttribute('aria-label', `${graphLabel}. The calculation trace and numeric results describe the selected point.`);
    shell.querySelector('.lab-legend').innerHTML = `<span><i class="legend-curve"></i>${legend1}</span><span><i class="legend-tangent"></i>${legend2}</span>`;
    note.textContent = explanation;
    const prompts = {
      parametric: ['Predict the direction of the velocity arrow at the top of the ellipse, then check with the slider.', 'Use x′(t) and y′(t) to find when the particle moves left and downward.', 'Justify the exact times when speed is greatest using the derivative of speed squared.'],
      series: ['Compare degree 1 and degree 3 at x = 3. Read the change in the error.', 'Predict the sign of the first omitted term, then compare the approximation with sin(3).', 'Use the next omitted term to justify an error bound for the displayed approximation at x = 3.'],
      derivative: ['Locate a horizontal tangent, then check the derivative readout.', 'Predict the intervals where the function decreases using the derivative sign.', 'Use the first and second derivatives to classify the critical points and justify the classifications.'],
    };
    shell.querySelector('.lab-challenge').innerHTML = `<span class="lab-challenge-label">${level >= 80 ? 'JUSTIFY' : level >= 40 ? 'CONNECT' : 'PREDICT'}</span><span>${prompts[id][level >= 80 ? 2 : level >= 40 ? 1 : 0]}</span>`;
    draw();
  };
  for (const [id, label] of modes) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'lab-mode'; button.dataset.mode = id;
    button.textContent = label; button.addEventListener('click', () => choose(id));
    shell.querySelector('.lab-modes').appendChild(button);
  }
  choose(selected);
  range.addEventListener('input', draw);
  player = attachPlayback(shell.querySelector('.lab-control-area'), {
    range, update: draw, motion, duration: 18000, autoplay: true,
    loop: () => selected === 'parametric',
    reset: () => choose(selected),
    description: isBC || isPhysics
      ? 'Vector motion follows a repeating path; other modes stop after one sweep. Pause or move the slider at any point.'
      : 'Play runs one sweep, then stops. Pause or move the slider at any point.',
  });
  return () => { player.destroy(); shell.remove(); };
}
