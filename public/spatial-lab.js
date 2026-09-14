// Native WebGL, no packages or GPU configuration changes. Canvas2D is the
// fallback. Only explicit playback or camera interaction redraws this lab.
import { attachPlayback } from './study-lab.js';

const END = 4 * Math.PI;
const toWorld = ([x, y, z]) => [x, z - Math.PI, y];
const add = (a, b, scale = 1) => a.map((value, i) => value + scale * b[i]);

export function helixSample(t) {
  const position = [2 * Math.cos(t), 2 * Math.sin(t), t / 2];
  const velocity = [-2 * Math.sin(t), 2 * Math.cos(t), 0.5];
  return { position, velocity, speed: Math.hypot(...velocity), distance: Math.sqrt(17) * t / 2 };
}

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++) out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
    }
  }
  return out;
}

function cameraMatrix(width, height, azimuth, elevation) {
  const a = azimuth * Math.PI / 180, e = elevation * Math.PI / 180;
  const f = 1 / Math.tan(Math.PI / 8), near = 0.1, far = 60;
  const projection = [f / (width / height), 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
  const translate = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -12, 1];
  const rotateY = [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1];
  const rotateX = [1, 0, 0, 0, 0, Math.cos(e), Math.sin(e), 0, 0, -Math.sin(e), Math.cos(e), 0, 0, 0, 0, 1];
  return multiply(projection, multiply(translate, multiply(rotateX, rotateY)));
}

function rgb(hex) {
  const value = hex.trim().replace('#', '');
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value;
  return [0, 2, 4].map((start) => parseInt(full.slice(start, start + 2), 16) / 255);
}

function colors() {
  const style = getComputedStyle(document.documentElement);
  const get = (name, fallback) => rgb(style.getPropertyValue(name).trim() || fallback);
  return {
    surface: get('--surface', '#111d30'), grid: get('--border', '#2c405b'),
    path: get('--accent', '#8db7ff'), tangent: get('--notyet', '#efbd73'),
    axisY: get('--good', '#6de0bd'), text: get('--muted', '#a4b5cc'),
  };
}

function sceneAt(t, palette) {
  const curve = Array.from({ length: 321 }, (_, i) => helixSample(i * END / 320).position);
  const trace = curve.filter((_, i) => i * END / 320 < t);
  const sample = helixSample(t);
  trace.push(sample.position);
  const grid = [];
  for (let i = -3; i <= 3; i++) grid.push([[i, -3, 0], [i, 3, 0]], [[-3, i, 0], [3, i, 0]]);
  const tip = add(sample.position, sample.velocity, 0.7);
  const vhat = sample.velocity.map((value) => value / sample.speed);
  const side = [sample.velocity[1] / 2, -sample.velocity[0] / 2, 0];
  const back = add(tip, vhat, -0.32);
  return {
    lines: [
      { segments: grid, color: palette.grid },
      { segments: [[[-3, 0, 0], [3, 0, 0]]], color: palette.path },
      { segments: [[[0, -3, 0], [0, 3, 0]]], color: palette.axisY },
      { segments: [[[0, 0, 0], [0, 0, 7]]], color: palette.text },
      { segments: [[sample.position, tip], [tip, add(back, side, 0.15)], [tip, add(back, side, -0.15)]], color: palette.tangent },
    ],
    paths: [{ points: curve, color: palette.text }, { points: trace, color: palette.path }],
    point: sample.position,
  };
}

function webglRenderer(canvas) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: true, powerPreference: 'low-power' });
  if (!gl) return null;
  const vertexSource = `attribute vec3 a_position;
    uniform mat4 u_matrix;
    void main() { gl_Position = u_matrix * vec4(a_position, 1.0); gl_PointSize = 10.0; }`;
  const fragmentSource = `precision mediump float;
    uniform vec3 u_color;
    uniform bool u_point;
    void main() {
      if (u_point && distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;
      gl_FragColor = vec4(u_color, 1.0);
    }`;
  const shaders = [], buffer = gl.createBuffer(), program = gl.createProgram();
  const destroy = () => {
    if (buffer) gl.deleteBuffer(buffer);
    for (const shader of shaders) gl.deleteShader(shader);
    if (program) gl.deleteProgram(program);
  };
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Shader unavailable');
      shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Shader compilation unavailable');
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) || !buffer) throw new Error('WebGL resources unavailable');
    const position = gl.getAttribLocation(program, 'a_position');
    const matrix = gl.getUniformLocation(program, 'u_matrix');
    const color = gl.getUniformLocation(program, 'u_color');
    const point = gl.getUniformLocation(program, 'u_point');
    return {
      destroy,
      draw(scene, transform, palette) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(...palette.surface, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
        gl.useProgram(program); gl.uniformMatrix4fv(matrix, false, transform);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);
        const plot = (points, mode, tint) => {
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points.flatMap(toWorld)), gl.DYNAMIC_DRAW);
          gl.uniform3fv(color, tint); gl.uniform1i(point, mode === gl.POINTS ? 1 : 0);
          gl.drawArrays(mode, 0, points.length);
        };
        for (const line of scene.lines) plot(line.segments.flat(), gl.LINES, line.color);
        for (const path of scene.paths) plot(path.points, gl.LINE_STRIP, path.color);
        plot([scene.point], gl.POINTS, palette.tangent);
      },
    };
  } catch {
    destroy();
    return null;
  }
}

function canvasRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const cssColor = (values) => `rgb(${values.map((v) => Math.round(v * 255)).join(',')})`;
  return {
    destroy() {},
    draw(scene, matrix, palette) {
      const project = (point) => {
        const p = [...toWorld(point), 1];
        const result = [0, 1, 2, 3].map((row) => p.reduce((sum, value, column) => sum + value * matrix[column * 4 + row], 0));
        return [(result[0] / result[3] + 1) * canvas.width / 2, (1 - result[1] / result[3]) * canvas.height / 2];
      };
      ctx.fillStyle = cssColor(palette.surface); ctx.fillRect(0, 0, canvas.width, canvas.height);
      const plot = (points, tint) => {
        if (!points.length) return;
        ctx.beginPath(); ctx.strokeStyle = cssColor(tint); ctx.lineWidth = 1.5;
        points.forEach((point, i) => { const p = project(point); if (i === 0) ctx.moveTo(...p); else ctx.lineTo(...p); });
        ctx.stroke();
      };
      for (const line of scene.lines) for (const pair of line.segments) plot(pair, line.color);
      for (const path of scene.paths) plot(path.points, path.color);
      const p = project(scene.point); ctx.beginPath(); ctx.arc(...p, 5, 0, 2 * Math.PI);
      ctx.fillStyle = cssColor(palette.tangent); ctx.fill();
    },
  };
}

/** An optional 3D extension; the planar AP curriculum does not require it. */
export function mountSpatialLab(container, { motion, mastery = 0 } = {}) {
  const root = document.createElement('section'); root.className = 'spatial-lab';
  root.innerHTML = `<div class="spatial-heading"><div>
    <p class="lab-eyebrow">STUDENTS4AI / SPATIAL EXPLORER</p>
    <h3>3D Vector Lab · Explore beyond the exam</h3>
    <p class="viz-note">AP Calculus BC studies planar parametric motion. This optional 3D extension adds a height coordinate to connect the same derivative ideas.</p>
  </div><span class="tag spatial-renderer"></span></div>
  <p class="spatial-equation"><code>r(t) = [2 cos(t), 2 sin(t), t / 2]</code><span>0 ≤ t ≤ 4π</span></p>
  <div class="spatial-graph"><canvas role="img" aria-label="A three-dimensional helix with its moving position and tangent velocity vector. Use the camera and time sliders to inspect it."></canvas></div>
  <div class="spatial-axis-key"><span class="spatial-axis-x">x axis</span><span class="spatial-axis-y">y axis</span><span class="spatial-axis-z">z axis / height</span><span class="spatial-axis-v">velocity</span></div>
  <p class="spatial-interaction-note">Drag the graph to orbit. The camera sliders provide the same control with a keyboard. Height z is vertical.</p>
  <div class="spatial-controls">
    <label class="viz-slider"><span class="viz-slider-label">Time t</span><input class="spatial-time" type="range" min="0" max="12.566370614359172" step="0.01" value="1.5"><output class="viz-slider-out"></output></label>
    <div class="spatial-camera">
      <label class="viz-slider"><span class="viz-slider-label">Camera rotation</span><input class="spatial-azimuth" type="range" min="-180" max="180" step="1" value="35"><output class="viz-slider-out">35°</output></label>
      <label class="viz-slider"><span class="viz-slider-label">Camera elevation</span><input class="spatial-elevation" type="range" min="-65" max="65" step="1" value="25"><output class="viz-slider-out">25°</output></label>
    </div>
  </div>
  <div class="spatial-metrics" aria-label="Values at the selected time"></div>
  <p class="spatial-explanation">The amber arrow is velocity r′(t) = [−2 sin(t), 2 cos(t), 1/2], scaled to fit the picture. Its direction changes while its length stays constant. Speed is √17 / 2, approximately 2.0616 units per unit of t.</p>
  <p class="spatial-challenge"></p>`;
  container.appendChild(root);
  const graph = root.querySelector('.spatial-graph');
  const status = root.querySelector('.spatial-renderer');
  const time = root.querySelector('.spatial-time');
  const azimuth = root.querySelector('.spatial-azimuth');
  const elevation = root.querySelector('.spatial-elevation');
  let canvas = graph.querySelector('canvas'), renderer, disposed = false, player;
  let pointer = null;
  const listeners = new AbortController();
  const signal = listeners.signal;
  const replaceCanvas = () => {
    const replacement = canvas.cloneNode(false); canvas.replaceWith(replacement); canvas = replacement;
  };
  const fallback = () => {
    renderer?.destroy(); replaceCanvas(); renderer = canvasRenderer(canvas);
    status.textContent = renderer ? '2D projection' : 'Numeric view';
    if (!renderer) {
      canvas.hidden = true;
      root.querySelector('.spatial-interaction-note').textContent = 'Drawing is unavailable in this browser. The controls and numeric results below still describe the helix.';
    } else root.querySelector('.spatial-interaction-note').textContent = 'WebGL is unavailable, so this is a 2D projection of the same 3D coordinates. Drag or use the camera sliders to orbit. Height z is vertical.';
  };
  try { renderer = webglRenderer(canvas); } catch { renderer = null; }
  if (!renderer) fallback();
  else {
    status.textContent = 'Native WebGL';
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault(); player?.pause(); fallback(); draw();
    }, { signal });
  }
  const tuple = (values) => `[${values.map((value) => (Math.abs(value) < 0.00005 ? 0 : value).toFixed(3)).join(', ')}]`;
  const draw = () => {
    if (disposed) return;
    const t = Number(time.value), sample = helixSample(t);
    for (const input of [time, azimuth, elevation]) {
      const text = input === time ? `${t.toFixed(2)} rad` : `${input.value}°`;
      input.parentElement.querySelector('output').textContent = text;
      input.setAttribute('aria-valuetext', text);
    }
    const width = Math.max(220, graph.clientWidth), height = width < 480 ? 310 : 350;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(900000 / (width * height)));
    const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
    canvas.style.height = `${height}px`;
    const palette = colors();
    renderer?.draw(sceneAt(t, palette), cameraMatrix(pixelWidth, pixelHeight, Number(azimuth.value), Number(elevation.value)), palette);
    root.querySelector('.spatial-metrics').innerHTML = `<div><span>position r(t)</span><strong>${tuple(sample.position)}</strong></div><div><span>velocity r′(t)</span><strong>${tuple(sample.velocity)}</strong></div><div><span>distance from t = 0</span><strong>${sample.distance.toFixed(3)}</strong></div>`;
  };
  root.querySelector('.spatial-challenge').textContent = mastery >= 60
    ? 'Extend the idea: derive the constant speed from the three velocity components, then integrate speed to obtain distance travelled.'
    : 'Inspect the motion: compare t = 0 and t near 2π. The x and y coordinates repeat, while the height increases.';
  for (const input of [time, azimuth, elevation]) input.addEventListener('input', () => { player?.pause(); draw(); }, { signal });
  graph.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    player?.pause();
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, azimuth: Number(azimuth.value), elevation: Number(elevation.value) };
    graph.setPointerCapture(event.pointerId);
  }, { signal });
  graph.addEventListener('pointermove', (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const angle = pointer.azimuth + (event.clientX - pointer.x) * 0.5;
    azimuth.value = String(((angle + 180) % 360 + 360) % 360 - 180);
    elevation.value = String(Math.max(-65, Math.min(65, pointer.elevation + (event.clientY - pointer.y) * 0.4)));
    draw();
  }, { signal });
  const release = () => { pointer = null; };
  graph.addEventListener('pointerup', release, { signal });
  graph.addEventListener('pointercancel', release, { signal });
  graph.addEventListener('lostpointercapture', release, { signal });
  player = attachPlayback(root.querySelector('.spatial-controls'), {
    range: time, motion, duration: 20000, update: draw,
    reset: () => { time.value = '1.5'; azimuth.value = '35'; elevation.value = '25'; draw(); },
    description: 'Play follows the helix once, then stops. Camera movement changes the view, not the mathematics.',
  });
  const observer = new MutationObserver(() => { if (!root.isConnected) cleanup(); });
  observer.observe(document.body, { childList: true, subtree: true });
  const cleanup = () => {
    if (disposed) return;
    disposed = true; pointer = null; listeners.abort(); observer.disconnect();
    player.destroy(); renderer?.destroy(); root.remove();
  };
  return cleanup;
}
