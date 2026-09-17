import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getQuestionModel, sampleQuestionModel, validateQuestionVisual } from '../public/question-models.js';

const model = (kind) => ({ kind, mode: 'example' });
const metrics = (scene) => Object.fromEntries(scene.metrics.map(([key, value]) => [key, parseFloat(value)]));
const near = (a, b, tolerance = 0.0002) => assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`);

test('public visual validation projects givens and never copies hidden generator fields', () => {
  const source = { type: 'linear-graph', points: [{ x: 0, y: 1, answer: 17 }, { x: 2, y: 5 }], answerIndex: 2,
    numericAnswer: 17, parameters: { hiddenFlightTime: 8 }, expression: 'fetch(secret)', xLabel: 'time', yLabel: 'distance' };
  const visible = validateQuestionVisual(source);
  assert.deepEqual(visible, { type: 'linear-graph', points: [{ x: 0, y: 1 }, { x: 2, y: 5 }], xLabel: 'time', yLabel: 'distance' });
  visible.points[0].x = 99; assert.equal(source.points[0].x, 0);
  assert.equal(validateQuestionVisual({ type: 'function', expression: 'x*x' }), null);
  for (const points of [[{ x: 0, y: 1 }], [{ x: NaN, y: 1 }, { x: 2, y: 3 }], [{ x: 1, y: 2 }, { x: 1, y: 2 }], [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 5 }]]) {
    assert.equal(validateQuestionVisual({ type: 'linear-graph', points }), null);
  }
  assert.equal(validateQuestionVisual({ type: 'right-triangle', legs: [3, 0] }), null);
  assert.equal(validateQuestionVisual({ type: 'bar-data', values: [3, Infinity] }), null);
});

test('exact diagrams report only givens, even when inspection changes', () => {
  const triangle = getQuestionModel({ visual: { type: 'right-triangle', legs: [3, 4], hypotenuse: 5 } });
  assert.equal(triangle.mode, 'givens');
  const first = sampleQuestionModel(triangle, { angle: 0 }), rotated = sampleQuestionModel(triangle, { angle: 30 });
  assert.deepEqual(first.metrics, rotated.metrics); assert.notDeepEqual(first.polygons, rotated.polygons);
  assert.doesNotMatch(JSON.stringify(first.metrics), /hypotenuse|area|\b5\b/);
  const data = getQuestionModel({ visual: { type: 'bar-data', values: [2, 4, 9] } });
  assert.doesNotMatch(JSON.stringify(sampleQuestionModel(data).metrics), /mean|median|average/);
  assert.equal(sampleQuestionModel({ mode: 'givens', kind: 'linear-graph', visual: {} }), null);
});

test('models distinguish independent examples from supplied problem data', () => {
  const question = { topicId: 'physics-kinematics', numericAnswer: 999, parameters: { u: 900, t: 800 }, prompt: 'secret content' };
  const descriptor = getQuestionModel(question);
  assert.equal(descriptor.mode, 'example'); assert.equal(descriptor.kind, 'motion');
  assert.doesNotMatch(JSON.stringify(descriptor), /999|900|800|secret content/);
  assert.deepEqual(sampleQuestionModel(descriptor), sampleQuestionModel(getQuestionModel({ topicId: question.topicId })));
  assert.equal(getQuestionModel({ subject: 'history', prompt: 'a decorative helix' }), null);
  for (const topicId of ['__proto__', 'constructor', 'toString']) assert.equal(getQuestionModel({ topicId }), null);
  assert.equal(sampleQuestionModel({ kind: 'constructor', mode: 'example' }), null);
  assert.equal(getQuestionModel({ skillId: 'u8-volumes-washers' }).kind, 'revolution');
  assert.equal(getQuestionModel({ topicId: 'sat-geometry' }).kind, 'triangle');
  assert.equal(getQuestionModel({ topicId: 'sat-reading-evidence' }).kind, 'reasoning');
});

test('all supported numerical models produce bounded finite graph geometry at hostile inputs', () => {
  const kinds = ['limit', 'tangent', 'chain', 'curve', 'accumulation', 'field', 'vector', 'polar', 'series', 'taylor', 'revolution', 'motion', 'forces', 'energy', 'momentum', 'torque', 'angular', 'spring', 'fluids', 'linear', 'quadratic', 'data', 'triangle'];
  for (const kind of kinds) for (const input of [{}, { x: Infinity, t: NaN, n: -900, h: 0, angle: 1e20, index: 7 }, { x: -900, t: 900, n: 1e6, force: -90, depth: 99 }]) {
    const scene = sampleQuestionModel(model(kind), input);
    assert.ok(scene.metrics.length > 0, kind); assert.ok(scene.description, kind);
    assert.ok(scene.bounds.every(Number.isFinite), kind);
    for (const shape of [...scene.curves, ...scene.lines, ...scene.polygons]) for (const point of shape) assert.ok(point.every(Number.isFinite), kind);
    for (const dot of scene.dots) assert.ok(dot.slice(0, 2).every(Number.isFinite), kind);
  }
});

test('derivative models agree with finite differences and chain rule', () => {
  const x = 0.7, h = 1e-5;
  near(metrics(sampleQuestionModel(model('tangent'), { x }))['Derivative at x'], ((x + h) ** 2 - (x - h) ** 2) / (2 * h));
  const m = metrics(sampleQuestionModel(model('chain'), { x }));
  near(m['Derivative at x'], (Math.sin((x + h) ** 2) - Math.sin((x - h) ** 2)) / (2 * h));
});

test('refining a left Riemann sum reduces error against the analytic integral', () => {
  const coarse = metrics(sampleQuestionModel(model('accumulation'), { n: 2 }));
  const fine = metrics(sampleQuestionModel(model('accumulation'), { n: 20 }));
  near(fine['Exact example area'], 2 + 8 / 12);
  assert.ok(fine['Absolute error'] < coarse['Absolute error']);
  assert.ok(fine['Left sum'] < 8 / 3);
});

test('3D revolution uses correct cross sections and preserves mathematics under camera rotation', () => {
  const a = sampleQuestionModel(model('revolution'), { x: 1, angle: -30 });
  const b = sampleQuestionModel(model('revolution'), { x: 1, angle: 40 });
  assert.deepEqual(a.metrics, b.metrics); assert.notDeepEqual(a.curves, b.curves);
  const m = metrics(a); near(m['Slice area πr²'], Math.PI * 2.25); near(m['Example volume 14π/3'], Math.PI * (2 + 2 + 2 / 3));
});

test('energy, momentum and angular momentum conserve their stated quantities', () => {
  for (const height of [0, 1.2, 4]) { const m = metrics(sampleQuestionModel(model('energy'), { height })); near(m['Potential energy'] + m['Kinetic energy'], 80); }
  for (const t of [0, 1.3, 3.14]) { const m = metrics(sampleQuestionModel(model('spring'), { t })); near(m['Spring energy'] + m['Kinetic energy'], 6); }
  for (const velocity of [0, 2, 6]) { const m = metrics(sampleQuestionModel(model('momentum'), { velocity })); near(m['First momentum'] + m['Second momentum'], m['Final momentum']); }
  for (const inertia of [1, 3, 5]) { const m = metrics(sampleQuestionModel(model('angular'), { inertia })); near(m['Moment of inertia'] * m['Angular speed'], 6); }
});

test('vector speed comes from both components and geometric tails shrink', () => {
  const m = metrics(sampleQuestionModel(model('vector'), { t: 0 })); near(m.Speed, Math.hypot(m['Velocity x'], m['Velocity y']));
  const early = metrics(sampleQuestionModel(model('series'), { n: 2 })), later = metrics(sampleQuestionModel(model('series'), { n: 8 }));
  assert.ok(later['Remaining tail'] < early['Remaining tail']); near(later['Partial sum'] + later['Remaining tail'], 2);
});
