// Question-adjacent models. Original examples are explicitly separate from
// the problem; exact diagrams accept a small, data-only set of given values.
// This module also runs in Node for public-descriptor validation and tests.
import { attachPlayback } from './study-lab.js';

const TAU = 2 * Math.PI;
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e6;
const label = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 60) : fallback;
const clamp = (value, min, max, fallback) => finite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const fmt = (value) => Number.isFinite(value) ? Number(value.toFixed(4)).toString() : 'undefined';

/** Return only supplied givens. Never copy answer keys, hidden generator
 * parameters, arbitrary expressions, URLs, HTML or computed unknowns. */
export function validateQuestionVisual(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.type === 'linear-graph') {
    if (!Array.isArray(raw.points) || raw.points.length < 2 || raw.points.length > 12
      || raw.points.some((p) => !p || !finite(p.x) || !finite(p.y))) return null;
    const points = raw.points.map(({ x, y }) => ({ x, y }));
    if (new Set(points.map((p) => `${p.x},${p.y}`)).size !== points.length) return null;
    const [a, b] = points;
    if (points.some((p) => Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) > 1e-8 * Math.max(1, Math.abs(p.x - a.x), Math.abs(p.y - a.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)) ** 2)) return null;
    return { type: raw.type, points, xLabel: label(raw.xLabel, 'x'), yLabel: label(raw.yLabel, 'y') };
  }
  if (raw.type === 'right-triangle') {
    if (!Array.isArray(raw.legs) || raw.legs.length !== 2 || raw.legs.some((n) => !finite(n) || n <= 0)) return null;
    return { type: raw.type, legs: [...raw.legs] };
  }
  if (raw.type === 'bar-data') {
    if (!Array.isArray(raw.values) || raw.values.length < 2 || raw.values.length > 12 || raw.values.some((n) => !finite(n) || n < 0)) return null;
    return { type: raw.type, values: [...raw.values], labels: raw.values.map((_, i) => label(raw.labels?.[i], `Item ${i + 1}`)) };
  }
  return null;
}

const MODELS = {
  limit: ['Approach a missing point', 'Move closer from each side of a hole in a graph.', [['h', 'Distance from x = 1', 0.01, 1, 0.01, 0.5]]],
  tangent: ['See a derivative as a slope', 'Move the point on y = x² and compare its tangent.', [['x', 'Point x', -2, 2, 0.02, 1]]],
  chain: ['Follow a composite function', 'The example connects x → x² → sin(x²) and the two rates.', [['x', 'Input x', -2, 2, 0.02, 1]]],
  curve: ['Connect a curve and its derivatives', 'Inspect y = x³ − 3x at a selected point.', [['x', 'Point x', -2, 2, 0.02, 0.5]]],
  accumulation: ['Build area with rectangles', 'Left-endpoint rectangles approximate the area under y = 1 + x²/4 on [0, 2].', [['n', 'Number of rectangles', 1, 20, 1, 4]]],
  field: ['Read a differential equation', 'The slopes follow y′ = y/2. The displayed solution starts at y(0) = 1.', [['x', 'Position x', 0, 3, 0.02, 1]]],
  vector: ['Inspect planar motion', 'Position and tangent velocity follow r(t) = [2 cos t, sin t].', [['t', 'Time t', 0, TAU, 0.02, 1]]],
  polar: ['Connect polar and Cartesian coordinates', 'Inspect the curve r = 2 cos θ. The segment connects the origin to the selected point.', [['t', 'Angle θ in radians', 0, Math.PI, 0.02, 0.6]]],
  series: ['Watch a geometric partial sum', 'Add terms of 1 + 1/2 + 1/4 + … and compare with its limit.', [['n', 'Number of terms', 1, 12, 1, 4]]],
  taylor: ['Compare a Taylor polynomial', 'Compare the sine function with its Maclaurin polynomial near zero.', [['n', 'Polynomial degree', 1, 9, 2, 3], ['x', 'Inspect x', -3, 3, 0.05, 1]]],
  revolution: ['Build a solid of revolution', 'Rotate y = 1 + x/2 about the x axis on [0, 2]. A highlighted disk shows the cross section.', [['x', 'Slice position x', 0, 2, 0.02, 1], ['angle', 'Camera rotation in degrees', -60, 60, 1, 25]]],
  motion: ['Connect time, position and velocity', 'A separate cart example starts at 1 m/s with acceleration 1 m/s².', [['t', 'Elapsed time in seconds', 0, 4, 0.02, 1]]],
  forces: ['Compare horizontal forces', 'A 2 kg block has a rightward applied force and a fixed 2 N leftward force.', [['force', 'Applied force in newtons', 0, 10, 0.1, 6]]],
  energy: ['Track conserved mechanical energy', 'A 2 kg object falls from 4 m without friction, using g = 10 m/s².', [['height', 'Height in metres', 0, 4, 0.02, 3]]],
  momentum: ['Compare momentum before and after', 'A 2 kg cart sticks to a 3 kg cart moving at −1 m/s. Change the first cart’s initial velocity.', [['velocity', 'First cart velocity in m/s', 0, 6, 0.05, 4]]],
  torque: ['See the perpendicular force component', 'A 4 N force acts at radius 2 m. Change its angle to the lever arm.', [['t', 'Force angle in radians', 0, Math.PI, 0.02, 1]]],
  angular: ['Conserve angular momentum', 'Angular momentum stays at 6 kg·m²/s while the moment of inertia changes.', [['inertia', 'Moment of inertia in kg·m²', 1, 5, 0.05, 2]]],
  spring: ['Inspect an oscillating spring', 'The example uses m = 1 kg, k = 3 N/m and amplitude 2 m.', [['t', 'Oscillation phase in radians', 0, TAU, 0.02, 1]]],
  fluids: ['Connect depth and pressure', 'Gauge pressure in water follows ρgh, using ρ = 1000 kg/m³ and g = 10 m/s².', [['depth', 'Depth in metres', 0, 4, 0.02, 1]]],
  linear: ['Inspect a linear relationship', 'This independent example graphs y = 2x + 1.', [['x', 'Input x', -3, 3, 0.05, 1]]],
  quadratic: ['Inspect a quadratic relationship', 'This independent example graphs y = (x − 1)² − 2.', [['x', 'Input x', -2, 4, 0.05, 1]]],
  data: ['Read a set of values', 'Inspect a small example data set before comparing its summary values.', [['index', 'Selected observation', 1, 5, 1, 1]]],
  triangle: ['Inspect a right triangle', 'This separate example has perpendicular legs of lengths 3 and 4.', [['angle', 'View rotation in degrees', -30, 30, 1, 0]]],
};

const TOPIC_MODELS = {
  'physics-kinematics': 'motion', 'physics-forces': 'forces', 'physics-energy': 'energy',
  'physics-momentum': 'momentum', 'physics-rotation': 'torque', 'physics-angular-momentum': 'angular',
  'physics-oscillations': 'spring', 'physics-fluids': 'fluids', 'bc-limits': 'limit',
  'bc-derivatives': 'tangent', 'bc-chain-rule': 'chain', 'bc-contextual-derivatives': 'tangent',
  'bc-derivative-analysis': 'curve', 'bc-integration': 'accumulation', 'bc-differential-equations': 'field',
  'bc-integral-applications': 'accumulation', 'bc-parametric': 'vector', 'bc-polar': 'polar',
  'bc-series': 'series', 'bc-taylor': 'taylor', 'sat-linear': 'linear', 'sat-advanced-math': 'quadratic',
  'sat-data': 'data', 'sat-geometry': 'triangle',
};
const REASONING = {
  'sat-reading-evidence': ['Find textual support', ['State the claim in your own words.', 'Locate the sentence or data that directly supports it.', 'Check whether each choice adds an unsupported assumption.']],
  'sat-reading-structure': ['Trace the passage structure', ['Identify what this sentence contributes.', 'Connect it to the sentence before and after it.', 'Check whether the choice describes its function in this passage.']],
  'sat-writing-expression': ['Check the intended connection', ['Identify the purpose of the sentence or notes.', 'Name the relationship: contrast, example, sequence or conclusion.', 'Read the revised sentence in context.']],
  'sat-writing-conventions': ['Check sentence boundaries', ['Locate the subject and complete verb.', 'Identify independent and dependent clauses.', 'Check punctuation and agreement against that structure.']],
};
const SKILL_MODELS = {
  'u2-derivative-limit-definition': 'tangent', 'u2-differentiability-continuity': 'tangent',
  'u2-basic-rules': 'tangent', 'u3-inverse-trig': 'tangent', 'u3-procedure-select': 'chain',
  'u3-higher-order': 'curve', 'u4-lhopital': 'limit', 'u5-graph-connections': 'curve',
  'u6-u-substitution': 'accumulation', 'u6-partial-fractions': 'accumulation',
  'u7-modeling-and-verifying': 'field', 'u7-particular-solutions': 'field', 'u7-exponential-models': 'field',
  'u10-error-bounds': 'taylor',
};
const own = (map, key) => Object.hasOwn(map, key) ? map[key] : undefined;

/** A descriptor is intentionally not a solver for the current problem. */
export function getQuestionModel(question = {}) {
  if (!question || typeof question !== 'object') return null;
  const given = validateQuestionVisual(question.visual);
  if (given) return { kind: given.type, mode: 'givens', title: 'Diagram of the supplied values', visual: given };
  const reasoning = own(REASONING, question.topicId);
  if (reasoning) return { kind: 'reasoning', mode: 'strategy', title: reasoning[0], steps: [...reasoning[1]] };
  let kind = own(TOPIC_MODELS, question.topicId);
  const skill = String(question.skillId || '').replace(/^mixed-/, '');
  if (!kind) kind = own(TOPIC_MODELS, skill) || own(SKILL_MODELS, skill);
  if (!kind && /^u\d+-/.test(skill)) {
    if (/volume|washer|disk|disc|cross-section/.test(skill)) kind = 'revolution';
    else if (/taylor|maclaurin|lagrange|polynomial-approx/.test(skill)) kind = 'taylor';
    else if (/series|converg|diverg|geometric|ratio|harmonic|alternat|p-series|comparison|power-series/.test(skill)) kind = 'series';
    else if (/polar/.test(skill)) kind = 'polar';
    else if (/vector|parametric/.test(skill)) kind = 'vector';
    else if (/slope-field|euler|differential|separab|growth|logistic/.test(skill)) kind = 'field';
    else if (/chain|composite/.test(skill)) kind = 'chain';
    else if (/riemann|trapezoid|accumulat|integr|area|average-value|arc-length/.test(skill)) kind = 'accumulation';
    else if (/velocity|accelerat|rectilinear|motion|speed/.test(skill)) kind = 'motion';
    else if (/extrem|concav|inflection|increas|decreas|optimi|sketch|candidate|mvt/.test(skill)) kind = 'curve';
    else if (/limit|asymptote|continu|squeeze|ivt/.test(skill)) kind = 'limit';
    else if (/derivative|differentiat|secant|tangent|linear|approx|rate|quotient|product|power-rule|implicit/.test(skill)) kind = 'tangent';
  }
  return kind ? { kind, mode: 'example', title: MODELS[kind][0], description: MODELS[kind][1] } : null;
}

const points = (f, min, max, count = 81) => Array.from({ length: count }, (_, i) => { const x = min + (max - min) * i / (count - 1); return [x, f(x)]; });
const fact = (n) => { let value = 1; for (let i = 2; i <= n; i++) value *= i; return value; };
const sinePolynomial = (x, degree) => { let value = 0; for (let n = 1; n <= degree; n += 2) value += (-1) ** ((n - 1) / 2) * x ** n / fact(n); return value; };

function controlsFor(descriptor) {
  if (descriptor.mode !== 'givens') return own(MODELS, descriptor.kind)?.[2] || [];
  const v = validateQuestionVisual(descriptor.visual);
  if (!v) return [];
  if (v.type === 'right-triangle') return [['angle', 'View rotation in degrees', -30, 30, 1, 0]];
  return [['index', 'Highlight supplied observation', 1, v.points?.length || v.values.length, 1, 1]];
}

/** Pure, bounded samples drive both the picture and its readable table. */
export function sampleQuestionModel(descriptor, input = {}) {
  if (!descriptor || typeof descriptor !== 'object') return null;
  const kind = descriptor.kind;
  const spec = own(MODELS, kind);
  const p = Object.fromEntries(controlsFor(descriptor).map(([key, , min, max, step, initial]) => {
    const value = clamp(input[key], min, max, initial);
    return [key, Math.max(min, Math.min(max, min + Math.round((value - min) / step) * step))];
  }));
  const scene = { bounds: [-3, 3, -3, 5], curves: [], lines: [], polygons: [], dots: [], labels: [], metrics: [], description: '', xLabel: 'x', yLabel: 'y' };
  const metric = (name, value, unit = '') => scene.metrics.push([name, typeof value === 'number' ? `${fmt(value)}${unit ? ` ${unit}` : ''}` : String(value)]);
  if (descriptor.mode === 'givens') {
    const v = validateQuestionVisual(descriptor.visual);
    if (!v) return null;
    if (v.type === 'linear-graph') {
      const ordered = [...v.points].sort((a, b) => a.x - b.x || a.y - b.y);
      const xs = ordered.map((q) => q.x), ys = ordered.map((q) => q.y);
      const padX = Math.max(1, Math.max(...xs) - Math.min(...xs)) * 0.2, padY = Math.max(1, Math.max(...ys) - Math.min(...ys)) * 0.2;
      scene.bounds = [Math.min(...xs) - padX, Math.max(...xs) + padX, Math.min(...ys) - padY, Math.max(...ys) + padY];
      scene.curves.push(ordered.map((q) => [q.x, q.y])); scene.dots = [[ordered[p.index - 1].x, ordered[p.index - 1].y]];
      scene.xLabel = v.xLabel; scene.yLabel = v.yLabel;
      ordered.forEach((q, i) => metric(`Given point ${i + 1}`, `(${fmt(q.x)}, ${fmt(q.y)})`));
      scene.description = `The marked point is supplied observation ${p.index}. The line joins the supplied points. The table lists those givens only; no unknown value is reported.`;
    } else if (v.type === 'bar-data') {
      const max = Math.max(1, ...v.values); scene.bounds = [0, v.values.length + 1, 0, max * 1.2];
      v.values.forEach((n, i) => { scene.polygons.push([[i + 0.65, 0], [i + 1.35, 0], [i + 1.35, n], [i + 0.65, n]]); metric(v.labels[i], n); });
      scene.dots.push([p.index, v.values[p.index - 1]]);
      scene.description = `The marked bar is ${v.labels[p.index - 1]}. Each bar shows one supplied value. Summary statistics are not calculated for this question.`;
      scene.xLabel = 'observation'; scene.yLabel = 'value';
    } else {
      const [a, b] = v.legs, scale = Math.max(a, b), angle = p.angle * Math.PI / 180;
      const rotate = ([x, y]) => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
      scene.bounds = [-scale * 0.65, scale * 1.2, -scale * 0.65, scale * 1.2]; scene.equalAspect = true;
      scene.polygons.push([[0, 0], [a, 0], [0, b]].map(rotate)); scene.lines.push([[a * 0.07, 0], [a * 0.07, b * 0.07], [0, b * 0.07]].map(rotate));
      metric('First given perpendicular leg', a); metric('Second given perpendicular leg', b); metric('Included angle', '90°');
      scene.description = 'The two labeled values are the perpendicular legs. The hypotenuse and other unknowns remain unlabeled.';
    }
    return scene;
  }
  if (!spec || descriptor.mode !== 'example') return null;
  if (kind === 'limit') {
    scene.bounds = [-1, 3, -0.5, 4.5]; scene.curves.push(points((x) => x + 1, -1, 3)); scene.dots = [[1, 2, 'open'], [1 - p.h, 2 - p.h], [1 + p.h, 2 + p.h]];
    metric('Left input', 1 - p.h); metric('Left output', 2 - p.h); metric('Right input', 1 + p.h); metric('Right output', 2 + p.h);
    scene.description = 'Both sides approach output 2, while the open point marks the undefined value at x = 1.';
  } else if (['tangent', 'chain', 'curve', 'linear', 'quadratic'].includes(kind)) {
    const f = kind === 'chain' ? (x) => Math.sin(x * x) : kind === 'curve' ? (x) => x ** 3 - 3 * x : kind === 'linear' ? (x) => 2 * x + 1 : kind === 'quadratic' ? (x) => (x - 1) ** 2 - 2 : (x) => x * x;
    const slope = kind === 'chain' ? 2 * p.x * Math.cos(p.x * p.x) : kind === 'curve' ? 3 * p.x * p.x - 3 : 2 * p.x;
    scene.bounds = kind === 'chain' ? [-2.2, 2.2, -2, 2] : kind === 'quadratic' ? [-2.5, 4.5, -3, 10] : [-3, 3, -7, 10];
    scene.curves.push(points(f, scene.bounds[0], scene.bounds[1])); scene.dots.push([p.x, f(p.x)]);
    metric('Selected x', p.x); metric('Function value', f(p.x));
    if (!['linear', 'quadratic'].includes(kind)) { scene.lines.push([[p.x - 0.8, f(p.x) - slope * 0.8], [p.x + 0.8, f(p.x) + slope * 0.8]]); metric('Derivative at x', slope); }
    if (kind === 'chain') { metric('Inner value x²', p.x ** 2); metric('Inner rate 2x', 2 * p.x); metric('Outer rate cos(x²)', Math.cos(p.x ** 2)); }
    if (kind === 'curve') metric('Second derivative', 6 * p.x);
    scene.description = kind === 'linear' ? 'Equal changes in x make equal changes in y.' : kind === 'quadratic' ? 'The lowest point of this example is (1, −2); the graph is symmetric about x = 1.' : 'The short contrasting line is the tangent at the selected point. Its slope agrees with the derivative in the table.';
  } else if (kind === 'accumulation') {
    scene.bounds = [-0.2, 2.2, -0.2, 2.5]; const dx = 2 / p.n; let sum = 0;
    scene.curves.push(points((x) => 1 + x * x / 4, 0, 2));
    for (let i = 0; i < p.n; i++) { const x = i * dx, y = 1 + x * x / 4; sum += y * dx; scene.polygons.push([[x, 0], [x + dx, 0], [x + dx, y], [x, y]]); }
    metric('Rectangles', p.n); metric('Width Δx', dx); metric('Left sum', sum); metric('Exact example area', 8 / 3); metric('Absolute error', 8 / 3 - sum);
    scene.description = 'This increasing function makes the left sum an underestimate. Narrower rectangles reduce the error.';
  } else if (kind === 'field') {
    scene.bounds = [-0.2, 3.2, -0.2, 5];
    for (let x = 0; x <= 3; x += 0.5) for (let y = 0; y <= 4.5; y += 0.5) { const length = 0.14 / Math.hypot(1, y / 2); scene.lines.push([[x - length, y - length * y / 2], [x + length, y + length * y / 2]]); }
    scene.curves.push(points((x) => Math.exp(x / 2), 0, 3)); scene.dots.push([p.x, Math.exp(p.x / 2)]);
    metric('x', p.x); metric('Solution y', Math.exp(p.x / 2)); metric('Slope y/2', Math.exp(p.x / 2) / 2);
    scene.description = 'Each short segment shows a permitted local slope. The curve follows those slopes through the initial value (0, 1).';
  } else if (kind === 'vector' || kind === 'polar') {
    scene.equalAspect = true;
    const position = (t) => kind === 'vector' ? [2 * Math.cos(t), Math.sin(t)] : [2 * Math.cos(t) ** 2, 2 * Math.cos(t) * Math.sin(t)];
    scene.bounds = [-2.5, 2.5, -2, 2]; scene.curves.push(Array.from({ length: 121 }, (_, i) => position(i * (kind === 'vector' ? TAU : Math.PI) / 120)));
    const [x, y] = position(p.t); scene.dots.push([x, y]); metric(kind === 'vector' ? 'Time t' : 'Angle θ', p.t); metric('x coordinate', x); metric('y coordinate', y);
    if (kind === 'vector') { const vx = -2 * Math.sin(p.t), vy = Math.cos(p.t); scene.lines.push([[x, y], [x + vx * 0.5, y + vy * 0.5]]); metric('Velocity x', vx); metric('Velocity y', vy); metric('Speed', Math.hypot(vx, vy)); }
    else { scene.lines.push([[0, 0], [x, y]]); metric('Signed radius r', 2 * Math.cos(p.t)); }
    scene.description = kind === 'vector' ? 'The contrasting segment is a scaled velocity vector tangent to the planar path.' : 'A negative radius places the point opposite the direction of θ. The curve remains a circle.';
  } else if (kind === 'series') {
    scene.bounds = [0, 13, 0, 2.3]; scene.xLabel = 'terms'; scene.yLabel = 'partial sum';
    scene.curves.push(Array.from({ length: 12 }, (_, i) => [i + 1, 2 * (1 - 0.5 ** (i + 1))])); scene.lines.push([[0, 2], [13, 2]]); scene.dots.push([p.n, 2 * (1 - 0.5 ** p.n)]);
    metric('Terms n', p.n); metric('Partial sum', 2 * (1 - 0.5 ** p.n)); metric('Infinite sum', 2); metric('Remaining tail', 2 * 0.5 ** p.n);
    scene.description = 'The partial sums increase toward 2. The remaining tail is positive for every finite number of terms.';
  } else if (kind === 'taylor') {
    scene.bounds = [-3.2, 3.2, -2.5, 2.5]; scene.curves.push(points(Math.sin, -3, 3), points((x) => sinePolynomial(x, p.n), -3, 3)); scene.dots.push([p.x, sinePolynomial(p.x, p.n)]);
    metric('Polynomial degree', p.n); metric('Selected x', p.x); metric('Polynomial value', sinePolynomial(p.x, p.n)); metric('sin(x)', Math.sin(p.x)); metric('Absolute error', Math.abs(sinePolynomial(p.x, p.n) - Math.sin(p.x)));
    scene.description = 'The first curve is sin(x); the contrasting curve is the polynomial. The table reports approximation error at the selected x.';
  } else if (kind === 'revolution') {
    scene.equalAspect = true;
    scene.bounds = [-3.5, 3.5, -3, 3]; scene.xLabel = '3D projection'; scene.yLabel = '';
    const a = p.angle * Math.PI / 180;
    const project = ([x, y, z]) => [(x - 1) * Math.cos(a) + z * Math.sin(a), y * 0.85 - (-(x - 1) * Math.sin(a) + z * Math.cos(a)) * 0.45];
    const ring = (x) => Array.from({ length: 41 }, (_, i) => { const t = i * TAU / 40, r = 1 + x / 2; return project([x, r * Math.cos(t), r * Math.sin(t)]); });
    for (let x = 0; x <= 2; x += 0.25) scene.lines.push(ring(x));
    for (let i = 0; i < 12; i++) { const t = i * TAU / 12; scene.lines.push([project([0, Math.cos(t), Math.sin(t)]), project([2, 2 * Math.cos(t), 2 * Math.sin(t)])]); }
    scene.polygons.push(ring(p.x)); scene.curves.push(ring(p.x)); scene.lines.push([project([-0.3, 0, 0]), project([2.4, 0, 0])]);
    metric('Slice position x', p.x); metric('Radius 1 + x/2', 1 + p.x / 2); metric('Slice area πr²', Math.PI * (1 + p.x / 2) ** 2); metric('Example volume 14π/3', 14 * Math.PI / 3);
    scene.description = 'The shaded disk is perpendicular to the axis of revolution. Camera rotation changes only the projection; slice area and volume do not change.';
  } else if (kind === 'motion') {
    scene.bounds = [0, 4.2, 0, 13]; scene.xLabel = 'time (s)'; scene.yLabel = 'position (m)'; scene.curves.push(points((t) => t + t * t / 2, 0, 4)); scene.dots.push([p.t, p.t + p.t * p.t / 2]);
    metric('Time', p.t, 's'); metric('Position', p.t + p.t ** 2 / 2, 'm'); metric('Velocity', 1 + p.t, 'm/s'); metric('Acceleration', 1, 'm/s²');
    scene.description = 'The slope of this position-time curve grows because the positive acceleration increases velocity.';
  } else if (kind === 'forces') {
    scene.bounds = [-3, 6, -2, 2]; scene.polygons.push([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]); scene.lines.push([[0, 0.3], [p.force / 2, 0.3]], [[0, -0.3], [-1, -0.3]]); scene.dots.push([p.force / 2, 0.3], [-1, -0.3]);
    metric('Applied force right', p.force, 'N'); metric('Opposing force left', 2, 'N'); metric('Net force right', p.force - 2, 'N'); metric('Acceleration right', (p.force - 2) / 2, 'm/s²');
    scene.description = 'Signed force and acceleration become negative when the leftward force is greater. Segment lengths use the same scale.';
  } else if (kind === 'energy') {
    scene.bounds = [0, 4, 0, 90]; const potential = 20 * p.height, kinetic = 80 - potential;
    scene.polygons.push([[0.5, 0], [1.3, 0], [1.3, potential], [0.5, potential]], [[2, 0], [2.8, 0], [2.8, kinetic], [2, kinetic]]); scene.labels.push(['Potential', 0.5, 85], ['Kinetic', 2, 85]); scene.xLabel = 'energy type'; scene.yLabel = 'joules';
    metric('Height', p.height, 'm'); metric('Potential energy', potential, 'J'); metric('Kinetic energy', kinetic, 'J'); metric('Total energy', potential + kinetic, 'J');
    scene.description = 'Potential and kinetic energy trade places while their sum stays at 80 J.';
  } else if (kind === 'momentum') {
    scene.bounds = [-3, 7, -2, 3]; const final = (2 * p.velocity - 3) / 5;
    scene.dots.push([0, 2], [5, 2], [2, 0]); scene.lines.push([[0, 2], [p.velocity * 0.5, 2]], [[5, 2], [4.5, 2]], [[2, 0], [2 + final * 0.5, 0]]); scene.labels.push(['Before', -2.5, 2], ['After', -2.5, 0]);
    metric('First momentum', 2 * p.velocity, 'kg·m/s'); metric('Second momentum', -3, 'kg·m/s'); metric('Final shared velocity', final, 'm/s'); metric('Final momentum', 5 * final, 'kg·m/s');
    scene.description = 'Before and after use the same positive direction. Add signed momenta; sticking does not imply conservation of kinetic energy.';
  } else if (kind === 'torque') {
    scene.bounds = [-1, 5, -1, 4]; scene.lines.push([[0, 0], [2, 0]], [[2, 0], [2 + 2 * Math.cos(p.t), 2 * Math.sin(p.t)]]); scene.dots.push([0, 0], [2, 0]);
    metric('Radius', 2, 'm'); metric('Force', 4, 'N'); metric('Angle', p.t, 'rad'); metric('Counterclockwise torque', 8 * Math.sin(p.t), 'N·m');
    scene.description = 'Only the component perpendicular to the lever arm produces torque. It is largest at a right angle.';
  } else if (kind === 'angular') {
    scene.equalAspect = true;
    scene.bounds = [-3, 3, -3, 3]; const r = Math.sqrt(p.inertia);
    scene.curves.push(Array.from({ length: 81 }, (_, i) => [r * Math.cos(i * TAU / 80), r * Math.sin(i * TAU / 80)])); scene.lines.push([[0, 0], [r, 0]]);
    metric('Moment of inertia', p.inertia, 'kg·m²'); metric('Angular speed', 6 / p.inertia, 'rad/s'); metric('Angular momentum', 6, 'kg·m²/s');
    scene.description = 'The radius is a schematic cue for moment of inertia. With no external torque, increasing inertia lowers angular speed.';
  } else if (kind === 'spring') {
    scene.bounds = [-3, 3, -2, 2]; const x = 2 * Math.cos(p.t), v = -2 * Math.sqrt(3) * Math.sin(p.t);
    scene.lines.push([[-2.8, -1], [-2.8, 1]]); scene.curves.push(Array.from({ length: 33 }, (_, i) => [-2.8 + (x + 2.8) * i / 32, i === 0 || i === 32 ? 0 : (i % 2 ? 0.25 : -0.25)])); scene.dots.push([x, 0]);
    metric('Displacement', x, 'm'); metric('Velocity', v, 'm/s'); metric('Spring energy', 1.5 * x * x, 'J'); metric('Kinetic energy', v * v / 2, 'J'); metric('Total energy', 6, 'J');
    scene.description = 'At maximum displacement the velocity is zero. Near equilibrium, spring energy has become kinetic energy.';
  } else if (kind === 'fluids') {
    scene.bounds = [-1, 3, -4.5, 1]; scene.polygons.push([[0, 0], [2, 0], [2, -4], [0, -4]]); scene.dots.push([1, -p.depth]); scene.lines.push([[0, -p.depth], [2, -p.depth]]);
    metric('Depth below surface', p.depth, 'm'); metric('Gauge pressure', 10000 * p.depth, 'Pa'); metric('Fluid density', 1000, 'kg/m³');
    scene.description = 'The marked depth is measured down from the surface. Gauge pressure excludes atmospheric pressure.';
  } else if (kind === 'data') {
    const values = [2, 4, 6, 4, 9]; scene.bounds = [0, 6, 0, 10]; scene.xLabel = 'observation'; scene.yLabel = 'value';
    values.forEach((n, i) => scene.polygons.push([[i + 0.65, 0], [i + 1.35, 0], [i + 1.35, n], [i + 0.65, n]])); scene.dots.push([p.index, values[p.index - 1]]);
    metric('Selected observation', p.index); metric('Selected value', values[p.index - 1]); metric('Example mean', 5); metric('Example median', 4);
    scene.description = 'The mean uses every value. The median is the middle value after sorting, not the middle bar in the original order.';
  } else if (kind === 'triangle') {
    scene.equalAspect = true;
    const a = p.angle * Math.PI / 180, rotate = ([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    scene.bounds = [-3, 5, -2, 6]; scene.polygons.push([[0, 0], [3, 0], [0, 4]].map(rotate));
    metric('First leg', 3); metric('Second leg', 4); metric('Example hypotenuse', 5); metric('Included angle', '90°');
    scene.description = 'Rotating the picture preserves the side lengths and right angle. These are example values, not a solution to the question.';
  }
  return scene;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function drawScene(canvas, scene) {
  const context = canvas.getContext('2d');
  if (!context) return false;
  const width = Math.max(220, Math.min(640, canvas.parentElement.clientWidth || 360)), height = 270;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const style = getComputedStyle(document.documentElement);
  const color = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  const ink = color('--text', '#edf4ff'), accent = color('--accent', '#8db7ff'), contrast = color('--notyet', '#efbd73'), grid = color('--border', '#43566f');
  context.fillStyle = color('--surface', '#111d30'); context.fillRect(0, 0, width, height);
  let [xmin, xmax, ymin, ymax] = scene.bounds;
  const pad = 32;
  if (scene.equalAspect) {
    const scale = Math.max((xmax - xmin) / (width - 2 * pad), (ymax - ymin) / (height - 2 * pad));
    const cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2;
    xmin = cx - scale * (width - 2 * pad) / 2; xmax = cx + scale * (width - 2 * pad) / 2;
    ymin = cy - scale * (height - 2 * pad) / 2; ymax = cy + scale * (height - 2 * pad) / 2;
  }
  const X = (x) => pad + (x - xmin) / (xmax - xmin) * (width - 2 * pad);
  const Y = (y) => height - pad - (y - ymin) / (ymax - ymin) * (height - 2 * pad);
  context.font = '11px system-ui, sans-serif'; context.fillStyle = ink; context.strokeStyle = grid; context.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const x = xmin + (xmax - xmin) * i / 4, y = ymin + (ymax - ymin) * i / 4;
    context.beginPath(); context.moveTo(X(x), pad); context.lineTo(X(x), height - pad); context.stroke();
    context.beginPath(); context.moveTo(pad, Y(y)); context.lineTo(width - pad, Y(y)); context.stroke();
    if (scene.xLabel !== '3D projection') { context.fillText(fmt(x), X(x) - 10, height - 14); context.fillText(fmt(y), 2, Y(y) + 3); }
  }
  context.fillText(scene.xLabel, width / 2 - 20, height - 1); context.fillText(scene.yLabel, pad + 2, 13);
  const path = (items, stroke, closed = false) => {
    context.beginPath(); let started = false;
    for (const [x, y] of items) { if (!Number.isFinite(x) || !Number.isFinite(y)) { started = false; continue; } if (started) context.lineTo(X(x), Y(y)); else { context.moveTo(X(x), Y(y)); started = true; } }
    if (closed) { context.closePath(); context.globalAlpha = 0.16; context.fillStyle = stroke; context.fill(); context.globalAlpha = 1; }
    context.strokeStyle = stroke; context.stroke();
  };
  context.save(); context.beginPath(); context.rect(pad, pad, width - 2 * pad, height - 2 * pad); context.clip();
  context.lineWidth = 1;
  scene.polygons.forEach((polygon) => path(polygon, accent, true));
  scene.lines.forEach((line) => path(line, contrast));
  context.lineWidth = 2; scene.curves.forEach((curve, i) => path(curve, i % 2 ? contrast : accent));
  for (const [x, y, open] of scene.dots) { context.beginPath(); context.arc(X(x), Y(y), 4.5, 0, TAU); context.fillStyle = open === 'open' ? color('--surface', '#111d30') : contrast; context.fill(); context.strokeStyle = ink; context.stroke(); }
  context.restore(); context.fillStyle = ink;
  scene.labels.forEach(([text, x, y]) => context.fillText(text, X(x), Y(y)));
  return true;
}

/** Mount one relevant model and return an idempotent cleanup function. */
export function mountQuestionModel(container, { question, motion } = {}) {
  const descriptor = getQuestionModel(question);
  if (!descriptor) return () => {};
  const root = element('section', 'question-model'); root.setAttribute('aria-label', descriptor.title);
  root.append(element('p', 'question-model-kind', descriptor.mode === 'example' ? 'Independent example' : descriptor.mode === 'givens' ? 'Question givens' : 'Reading and writing strategy'));
  root.append(element('h3', '', descriptor.title));
  root.append(element('p', 'question-model-intro', descriptor.mode === 'example' ? 'This uses separate example values. It illustrates the idea; it is not a diagram or solution of your exact question.' : descriptor.mode === 'givens' ? 'Only the supplied values are shown. Unknown quantities remain for you to determine.' : 'Use these steps with the actual passage or sentence. This guide does not select an answer.'));
  container.appendChild(root);
  const listeners = new AbortController(); let player, resize, disposed = false;
  const cleanup = () => { if (disposed) return; disposed = true; listeners.abort(); player?.destroy(); resize?.disconnect(); observer.disconnect(); root.remove(); };
  const observer = new MutationObserver(() => { if (!root.isConnected) cleanup(); });
  observer.observe(document.body, { childList: true, subtree: true });
  if (descriptor.kind === 'reasoning') {
    const list = element('ol', 'question-model-checklist');
    descriptor.steps.forEach((step) => { const item = element('li'); const wrap = element('label'); const input = element('input'); input.type = 'checkbox'; wrap.append(input, element('span', '', step)); item.append(wrap); list.append(item); });
    root.append(list); const reset = element('button', 'secondary', 'Reset checklist'); reset.type = 'button'; reset.addEventListener('click', () => root.querySelectorAll('input').forEach((input) => { input.checked = false; }), { signal: listeners.signal }); root.append(reset);
    return cleanup;
  }
  if (descriptor.description) root.append(element('p', 'question-model-formula', descriptor.description));
  const canvas = element('canvas'); canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${descriptor.title}. The description and table below provide the numerical information.`); root.append(canvas);
  const controls = element('div', 'question-model-controls'); root.append(controls);
  const note = element('p', 'question-model-description'); root.append(note);
  const table = element('table', 'question-model-values'); const caption = element('caption', '', descriptor.mode === 'givens' ? 'Supplied values' : 'Values in the independent example'); table.append(caption); const body = element('tbody'); table.append(body); root.append(table);
  const values = {}, sliders = [];
  for (const [key, title, min, max, step, initial] of controlsFor(descriptor)) {
    values[key] = initial;
    const wrap = element('label', 'question-model-slider'), input = element('input'), output = element('output'); input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = initial;
    wrap.append(element('span', '', title), input, output); controls.append(wrap); sliders.push({ key, input, output, initial });
  }
  const draw = () => {
    if (disposed) return;
    const scene = sampleQuestionModel(descriptor, values);
    if (!scene) return;
    for (const slider of sliders) { slider.output.textContent = fmt(Number(slider.input.value)); slider.input.setAttribute('aria-valuetext', `${slider.output.textContent} (${slider.input.parentElement.firstChild.textContent})`); }
    let drawn = false; try { drawn = drawScene(canvas, scene); } catch { drawn = false; }
    canvas.hidden = !drawn;
    note.textContent = `${!drawn ? 'The graph is unavailable; the controls and numerical table remain usable. ' : ''}${scene.description}`;
    body.replaceChildren();
    for (const [name, value] of scene.metrics) { const row = element('tr'), heading = element('th', '', name); heading.scope = 'row'; row.append(heading, element('td', '', value)); body.append(row); }
  };
  for (const { key, input } of sliders) input.addEventListener('input', () => { values[key] = Number(input.value); player?.pause(); draw(); }, { signal: listeners.signal });
  if (sliders.length) {
    const first = sliders[0];
    player = attachPlayback(controls, { range: first.input, motion, autoplay: false, duration: 16000,
      update: (value) => { values[first.key] = value; draw(); },
      reset: () => { for (const slider of sliders) { slider.input.value = slider.initial; values[slider.key] = slider.initial; } draw(); },
      description: descriptor.mode === 'givens' ? 'Play changes the view once. The supplied values stay fixed. Pause or inspect a value with the slider.' : 'Play changes the first example control once. Pause or use the sliders to inspect a value.',
    });
  } else {
    resize = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null; resize?.observe(root);
  }
  draw();
  return cleanup;
}
