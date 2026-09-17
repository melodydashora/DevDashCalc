import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStudyPlanService, normalizeStudyPlan, starterStudyPlan, parseStudyPlanDraft, projectStudyPlans } from '../study-plans.js';
const course = { id: 'custom', name: 'Biology', subject: 'all' };
const input = () => starterStudyPlan({ course, goal: 'Explain diffusion using a diagram', minutes: 25 });
function fixture() {
  const data = new Map(); let time = 100000;
  const make = () => createStudyPlanService({ now: () => time, readEvents: async p => structuredClone(data.get(p) || []),
    appendEvents: async (p, events) => { const next = [...(data.get(p) || []), ...structuredClone(events)]; data.set(p, next); return structuredClone(next); } });
  return { data, make, advance: () => { time += 31 * 60000; } };
}
test('starter session minutes add up and chosen goal/course remain authoritative', () => {
  for (const minutes of [5, 6, 20, 65, 120]) {
    const plan = starterStudyPlan({ course, goal: 'My exact goal', minutes });
    assert.equal(plan.steps.reduce((s, v) => s + v.minutes, 0), minutes); assert.equal(plan.goal, 'My exact goal'); assert.deepEqual(plan.course, course);
  }
  for (const minutes of [0, 121, NaN]) assert.throws(() => starterStudyPlan({ course, goal: 'goal', minutes }));
});
test('draft schema rejects malformed plans, strips unsafe links and overrides model course/goal', () => {
  const value = input(); value.course = { id: 'foreign' }; value.goal = 'Changed'; value.steps[0].href = 'javascript:alert(1)'; value.steps[1].href = 'https://example.com'; value.steps[2].href = '#/library';
  const parsed = parseStudyPlanDraft(JSON.stringify(value), course, 'Actual goal', 25);
  assert.deepEqual(parsed.course, course); assert.equal(parsed.goal, 'Actual goal'); assert.equal(parsed.steps[0].href, undefined); assert.equal(parsed.steps[1].href, undefined); assert.equal(parsed.steps[2].href, '#/library');
  assert.throws(() => parseStudyPlanDraft('not json', course, 'goal', 25)); assert.throws(() => parseStudyPlanDraft(JSON.stringify(value), course, 'goal', 30));
  assert.throws(() => normalizeStudyPlan({ ...value, steps: [{ title: 'x', detail: 'x', minutes: 900 }] }, course));
});
test('service restarts restore saved plans while other workspaces cannot complete them', async () => {
  const f = fixture(), a = f.make(), id = randomUUID();
  await a.create('dev', input(), { course, requestId: id });
  assert.equal((await f.make().list('dev'))[0].id, id); assert.deepEqual(await a.list('esha'), []);
  await assert.rejects(a.complete('esha', id, { completedStepIds: [] }), { status: 404 }); await assert.rejects(a.list('../dev'));
});
test('duplicate save requests are idempotent and conflicts cannot rewrite prior work', async () => {
  const f = fixture(), a = f.make(), id = randomUUID();
  const results = await Promise.all(Array.from({ length: 6 }, () => a.create('dev', input(), { course, requestId: id })));
  assert.equal(f.data.get('dev').length, 1); assert.ok(results.every(p => p.id === id));
  await assert.rejects(a.create('dev', { ...input(), title: 'different' }, { course, requestId: id }), { status: 409 });
});
test('completion rejects stale versions, preserves other plans and awards no mastery', async () => {
  const f = fixture(), a = f.make();
  const first = await a.create('dev', input(), { course, requestId: randomUUID() });
  const second = await a.create('dev', input(), { course, requestId: randomUUID() });
  const update = { completedStepIds: ['step-1'], expectedUpdatedAt: first.updatedAt };
  const done = await a.complete('dev', first.id, update); assert.deepEqual(done.completedStepIds, ['step-1']);
  await assert.rejects(a.complete('dev', first.id, update), { status: 409 });
  await assert.rejects(a.complete('dev', first.id, { completedStepIds: ['foreign-step'] }), { status: 400 });
  assert.deepEqual((await a.list('dev')).find(p => p.id === second.id), second); assert.doesNotMatch(JSON.stringify(done), /mastery|score|passed/);
});
test('Astra attribution requires an unchanged unexpired owner-bound server draft', async () => {
  const f = fixture(), a = f.make(), draft = a.draft('dev', input(), { astra: true, model: 'configured-model' });
  const save = (profile, plan) => a.create(profile, plan, { course, requestId: randomUUID() });
  assert.equal((await save('dev', draft)).source, 'astra'); assert.equal((await save('esha', draft)).source, 'student');
  assert.equal((await save('dev', { ...draft, title: 'Student edit' })).source, 'student'); f.advance();
  assert.equal((await save('dev', draft)).source, 'student');
  const forged = await save('dev', { ...input(), source: 'astra', model: 'forged' }); assert.equal(forged.source, 'student'); assert.equal(forged.model, undefined);
});
test('revoked access and failed storage never report a successful save', async () => {
  const f = fixture(), a = f.make();
  await assert.rejects(a.create('dev', input(), { course, requestId: randomUUID(), assertCurrent: async () => { throw Error('revoked'); } }), /revoked/); assert.equal(f.data.size, 0);
  const broken = createStudyPlanService({ readEvents: async () => [], appendEvents: async () => { throw Error('database unavailable'); } });
  await assert.rejects(broken.create('dev', input(), { course, requestId: randomUUID() }), /database unavailable/); assert.throws(() => projectStudyPlans({ wrong: true }));
});
test('append-only event projection rejects stale cross-process completions and replacement creates', () => {
  const id = randomUUID(), plan = { ...input(), id, createdAt: '2026-09-17T01:00:00Z', updatedAt: '2026-09-17T01:00:00Z', completedStepIds: [] };
  const rows = projectStudyPlans([{ type: 'create', plan }, { type: 'create', plan: { ...plan, title: 'replace' } },
    { type: 'complete', planId: id, expectedUpdatedAt: plan.updatedAt, at: '2026-09-17T01:01:00Z', completedStepIds: ['step-1'] },
    { type: 'complete', planId: id, expectedUpdatedAt: plan.updatedAt, at: '2026-09-17T01:02:00Z', completedStepIds: ['step-2'] }]);
  assert.equal(rows.length, 1); assert.equal(rows[0].title, plan.title); assert.deepEqual(rows[0].completedStepIds, ['step-1']);
});

test('same-time cross-instance conflicting completions cannot both report success', async () => {
  const f = fixture(), first = f.make(), second = f.make();
  const plan = await first.create('dev', input(), { course, requestId: randomUUID() });
  const attempts = await Promise.allSettled([
    first.complete('dev', plan.id, { completedStepIds: ['step-1'], expectedUpdatedAt: plan.updatedAt }),
    second.complete('dev', plan.id, { completedStepIds: ['step-2'], expectedUpdatedAt: plan.updatedAt }),
  ]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(result => result.status === 'rejected').reason.status, 409);
  assert.deepEqual((await first.list('dev'))[0].completedStepIds, ['step-1']);
  const completions = f.data.get('dev').filter(event => event.type === 'complete');
  assert.equal(completions.length, 2);
  assert.equal(completions[0].at, completions[1].at, 'regression specifically exercises equal timestamps');
});
