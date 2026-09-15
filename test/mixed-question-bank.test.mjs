import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateMixedQuestion, MIXED_TOPICS, MIXED_BANK_VERSION } from '../mixed-question-bank.js';

const samples=(seedCount=1)=>MIXED_TOPICS.flatMap(topic=>[1,2,3].flatMap(difficulty=>Array.from({length:seedCount},(_,seed)=>
  generateMixedQuestion({topicId:topic.id,difficulty,seed:'quality-'+seed}))));
const close=(actual,expected,label,tolerance=1e-7)=>assert.ok(Math.abs(actual-expected)<=tolerance*Math.max(1,Math.abs(expected)),label+': '+actual+' versus '+expected);
const fact=n=>n<2?1:n*fact(n-1);
const derivative=(f,x)=>{const h=1e-4;return (f(x+h)-f(x-h))/(2*h);};
const simpson=(f,a,b,segments=800)=>{let sum=f(a)+f(b);for(let j=1;j<segments;j++)sum+=(j%2?4:2)*f(a+(b-a)*j/segments);return sum*(b-a)/(3*segments);};

test('topic catalog covers each Physics 1 and Calculus BC unit with separate BC extensions',()=>{
  assert.equal(MIXED_TOPICS.length,20);
  assert.equal(new Set(MIXED_TOPICS.map(t=>t.id)).size,20);
  assert.deepEqual([...new Set(MIXED_TOPICS.filter(t=>t.subject==='physics').map(t=>t.unit))],[1,2,3,4,5,6,7,8]);
  assert.deepEqual([...new Set(MIXED_TOPICS.filter(t=>t.subject==='calculus-bc').map(t=>t.unit))],[1,2,3,4,5,6,7,8,9,10]);
  for(const id of ['bc-parametric','bc-polar','bc-series','bc-taylor'])assert.ok(MIXED_TOPICS.some(t=>t.id===id));
});

test('all 60 families generate finite distinct choices and complete feedback across 6000 seeded variants',()=>{
  const families=new Map();
  for(const q of samples(100)) {
    assert.equal(q.generatorVersion,MIXED_BANK_VERSION);
    assert.match(q.id,/^mix-v1-[a-z0-9-]+$/); assert.ok(q.id.length<=100);
    assert.equal(q.type,'mc'); assert.equal(q.choices.length,4);
    assert.equal(new Set(q.choices).size,4,q.templateId+' visible choices');
    assert.equal(q.misconceptions.length,4); assert.equal(q.misconceptionTags.length,4);
    assert.ok(Number.isInteger(q.answerIndex)&&q.answerIndex>=0&&q.answerIndex<4);
    assert.equal(q.misconceptions[q.answerIndex],null); assert.equal(q.misconceptionTags[q.answerIndex],null);
    assert.equal(q.choiceValues[q.answerIndex],q.numericAnswer===null?q.choiceValues[q.answerIndex]:q.numericAnswer);
    assert.ok(q.hints.length>=2 && q.hints.every(h=>typeof h==='string'&&h.length>15));
    assert.ok(q.solution.length>=2 && q.solution.every(s=>typeof s.text==='string'));
    for(let index=0;index<4;index++) {
      if(typeof q.choiceValues[index]==='number')assert.ok(Number.isFinite(q.choiceValues[index]));
      if(index!==q.answerIndex) {
        assert.ok(typeof q.misconceptions[index]==='string'&&q.misconceptions[index].length>25);
        assert.doesNotMatch(q.misconceptions[index],/you forgot|you failed|you should have/i);
        assert.match(q.misconceptionTags[index],/^[a-z0-9-]+$/);
      }
    }
    const variants=families.get(q.templateId)||new Set(); variants.add(q.prompt);families.set(q.templateId,variants);
  }
  assert.equal(families.size,60);
  for(const [family,variants]of families)assert.ok(variants.size>=10,family+' has too few fresh visible parameter variants: '+variants.size);
});

test('generation is deterministic and a focused retry stays on the same misconception family',()=>{
  const first=generateMixedQuestion({topicId:'bc-chain-rule',difficulty:1,seed:'deterministic'});
  assert.deepEqual(generateMixedQuestion({topicId:'bc-chain-rule',difficulty:1,seed:'deterministic'}),first);
  const focused=generateMixedQuestion({topicId:'bc-chain-rule',difficulty:3,seed:'new-attempt',templateId:first.templateId,focusTag:'chain-factor'});
  assert.equal(focused.templateId,'c3-chain-factor');assert.equal(focused.difficulty,1);assert.equal(focused.requestedDifficulty,3);
  assert.equal(focused.focusedTemplate,true);assert.notEqual(focused.id,first.id);
  const byTag=generateMixedQuestion({topicId:'bc-chain-rule',difficulty:3,seed:'tag-attempt',focusTag:'chain-factor'});
  assert.equal(byTag.templateId,'c3-chain-factor');
  for(const args of [{topicId:'unknown',difficulty:1,seed:'a'},{topicId:'bc-limits',difficulty:4,seed:'a'},{topicId:'bc-limits',seed:'../x'},
    {topicId:'bc-limits',seed:'a',templateId:'p1-velocity'},{topicId:'bc-limits',seed:'a',focusTag:'unknown'}])assert.throws(()=>generateMixedQuestion(args));
});

test('physics answers obey independent conservation and defining equations across all families',()=>{
  for(const q of samples(20).filter(q=>q.subject==='physics')) {
    const p=q.parameters,v=q.numericAnswer,label=q.templateId;
    switch(label) {
      case 'p1-velocity':close((v-p.u)/p.t,p.a,label);break;
      case 'p1-velocity-area':close(v/p.t,(2*p.u+p.a*p.t)/2,label);break;
      case 'p1-projectile':close(5*(v/p.vx)**2,p.height,label);break;
      case 'p2-net-force':close(p.m*v,p.m*p.a,label);break;
      case 'p2-friction':close(p.applied-p.m*v,p.mu*p.m*10,label);break;
      case 'p2-circular':close(v*p.radius/p.m,p.speed**2,label);break;
      case 'p3-work':close(v/p.distance,p.f,label);break;
      case 'p3-spring-energy':close(v,simpson(x=>p.k*x,0,p.x),label);break;
      case 'p3-energy-friction':close(p.m*v/2+p.friction*p.length,p.m*10*p.h,label);break;
      case 'p4-impulse':close(v/p.dt,p.f,label);break;
      case 'p4-sticking-collision':close((p.m1+p.m2)*v,p.m1*p.u+p.m2*p.v,label);break;
      case 'p4-collision-loss': {
        const vf=(p.m1*p.u+p.m2*p.v)/(p.m1+p.m2);
        close(v+(p.m1+p.m2)*vf*vf/2,(p.m1*p.u*p.u+p.m2*p.v*p.v)/2,label);assert.ok(v>=0);break;
      }
      case 'p5-torque':close(v/p.radius,p.force,label);break;
      case 'p5-angular-acceleration':close(p.inertia*v+p.reverse,p.force*p.radius,label);break;
      case 'p5-pulley': {
        const tension=p.inertia*v/(p.radius*p.radius);close(p.m*10-tension,p.m*v,label);break;
      }
      case 'p6-rotational-energy':close(v,simpson(w=>p.inertia*w,0,p.omega),label);break;
      case 'p6-angular-conservation':close(p.inertia*p.factor*v,p.inertia*p.omega,label);break;
      case 'p6-rolling-energy':close((1+p.beta)*v/2,10*p.h,label);break;
      case 'p7-frequency':close(p.m*v,p.k,label);break;
      case 'p7-period-ratio':close(v*v,p.a*p.a/(p.b*p.b),label);break;
      case 'p7-energy-position':close(p.m*v+p.stiffness*p.x*p.x,p.stiffness*p.amplitude*p.amplitude,label);break;
      case 'p8-pressure':close(v/p.h,p.rho*10,label);break;
      case 'p8-floating-fraction':close(p.fluidDensity*v,p.objectDensity,label);assert.ok(v>0&&v<1);break;
      case 'p8-bernoulli':close(v+p.rho*p.speed*p.speed/2,p.rho*(p.ratio*p.speed)**2/2,label);break;
      default:assert.fail('Unverified Physics family '+label);
    }
    if(!['p7-period-ratio','p8-floating-fraction'].includes(label))assert.ok(q.choices.every(c=>c.includes('\\mathrm{')),label+' units');
  }
});

test('calculus keys satisfy numerical derivatives, integrals and independent mathematical conditions',()=>{
  for(const q of samples(12).filter(q=>q.subject==='calculus-bc')) {
    const p=q.parameters,v=q.numericAnswer,label=q.templateId;
    switch(label) {
      case 'c1-continuous-limit':close(v,(p.a*(p.c+1e-5)**2+p.b+p.a*(p.c-1e-5)**2+p.b)/2,label);break;
      case 'c1-removable-limit':close(v,((p.c+1e-5)**2-p.c*p.c)/1e-5,label,1e-5);break;
      case 'c1-continuity-parameter':close(v*p.t+p.right,p.a*p.t+p.b,label);break;
      case 'c2-power-rule':close(v,derivative(x=>p.a*x**p.n,p.c),label);break;
      case 'c2-product-table':close(v,derivative(x=>(p.f+p.fp*x)*(p.g+p.gp*x),0),label);break;
      case 'c2-difference-quotient':close(v,derivative(x=>p.a*x**3+p.b*x,p.c),label);break;
      case 'c3-chain-factor':close(v,derivative(x=>(p.a*x+p.b)**p.n,p.c),label);break;
      case 'c3-implicit-slope':close(2*p.a+2*p.b*v,0,label);break;
      case 'c3-implicit-second': {
        const yp=-(2*p.a+p.b)/(p.a+2*p.b);
        close(2+2*yp+2*yp*yp+(p.a+2*p.b)*v,0,label);break;
      }
      case 'c4-linearization':close((v-p.value)/p.h,p.slope,label);break;
      case 'c4-sphere-rate':close(derivative(x=>4*Math.PI*x**3/3,p.radius)*v,4*p.k*Math.PI,label);break;
      case 'c4-cone-rate':close(derivative(x=>Math.PI*(p.radius/p.height)**2*x**3/3,p.h)*v,p.k*Math.PI,label);break;
      case 'c5-decreasing-interval': {
        const fprime=x=>p.a*(x-p.left)*(x-p.right);
        assert.ok(fprime(p.left-1)>0&&fprime((p.left+p.right)/2)<0&&fprime(p.right+1)>0);
        assert.equal(q.choiceValues[q.answerIndex],'between');break;
      }
      case 'c5-inflection-points':close(v,p.left+p.right,label);assert.ok(p.left<p.right);break;
      case 'c5-area-optimization': {
        const area=x=>x*(p.perimeter/2-x);
        assert.ok(area(v)>area(v-.1)&&area(v)>area(v+.1));close(derivative(area,v),0,label);break;
      }
      case 'c6-power-integral':close(v,simpson(x=>p.a*x**p.n,0,p.b),label);break;
      case 'c6-integration-parts':close(v,simpson(x=>x*Math.exp(p.a*x),0,1,1600),label);break;
      case 'c6-improper-integral': {
        // t=1/x transforms the infinite interval to a finite polynomial integral.
        close(v,simpson(t=>p.c*t**(p.p-2),0,1/p.b),label);break;
      }
      case 'c7-growth-initial-rate':close(v/p.a,p.k,label);break;
      case 'c7-euler-two-steps': {
        let x=0,y=p.a;for(let j=0;j<2;j++){y+=p.h*(x+y);x+=p.h;}close(v,y,label);break;
      }
      case 'c7-logistic-second': {
        const growth=P=>p.rate*P*(1-P/p.capacity);
        close(v,derivative(growth,p.population)*growth(p.population),label);break;
      }
      case 'c8-average-value':close(v,simpson(x=>p.a*x,0,p.b)/p.b,label);break;
      case 'c8-disk-volume':close(v,simpson(x=>(p.a*x)**2,0,p.b),label);break;
      case 'c8-arc-length':close(v,simpson(x=>Math.sqrt(1+x),0,p.endpoint,4000),label,2e-6);break;
      case 'c9-parametric-slope':close(v,derivative(t=>p.b*t*t,p.t)/derivative(t=>p.a*t,p.t),label);break;
      case 'c9-vector-speed':close(v,Math.hypot(derivative(t=>t*t,p.t),derivative(t=>p.b*t**3,p.t)),label);break;
      case 'c9-parametric-second': {
        const slope=t=>derivative(s=>p.b*s**3,t)/derivative(s=>p.a*s*s,t);
        close(v,derivative(slope,p.t)/derivative(t=>p.a*t*t,p.t),label,2e-5);break;
      }
      case 'c9-polar-coordinate':close(v,2*p.k*Math.cos(Math.PI/3),label);break;
      case 'c9-polar-area':close(v,simpson(()=>p.k*p.k/2,0,Math.PI/p.n)/Math.PI,label);break;
      case 'c9-polar-slope': {
        const radius=t=>p.a+p.b*Math.cos(t);
        close(v,derivative(t=>radius(t)*Math.sin(t),Math.PI/2)/derivative(t=>radius(t)*Math.cos(t),Math.PI/2),label);break;
      }
      case 'c10-geometric-sum':close(v,Array.from({length:100},(_,n)=>p.a/(p.k**n)).reduce((a,b)=>a+b,0),label);break;
      case 'c10-convergence-interval':assert.equal(q.choiceValues[q.answerIndex],'left-included');assert.ok(p.radius>0);break;
      case 'c10-alternating-bound':close(v*(p.n+1)**p.p,1,label);break;
      case 'c10-exponential-coefficient':close(v*fact(p.n),p.a**p.n,label);break;
      case 'c10-taylor-table':close(v,[p.v0,p.v1,p.v2,p.v3].reduce((sum,derivative,n)=>sum+derivative*p.h**n/fact(n),0),label);break;
      case 'c10-lagrange-bound':close(v*fact(p.n+1),p.M*p.h**(p.n+1),label);break;
      default:assert.fail('Unverified Calculus family '+label);
    }
  }
});

test('every family renders with vendored KaTeX across parameter variants without unsafe markup',()=>{
  const mod={exports:{}};
  new Function('module','exports',readFileSync(new URL('../public/vendor/katex/katex.min.js',import.meta.url),'utf8'))(mod,mod.exports);
  const render=(tex,label)=>assert.doesNotThrow(()=>mod.exports.renderToString(tex,{throwOnError:true,strict:'ignore'}),label+': '+tex);
  for(const q of samples(4)) {
    const texts=[q.prompt,...q.choices,...q.hints,...q.misconceptions.filter(Boolean),...q.solution.map(s=>s.text)];
    for(const text of texts) {
      assert.doesNotMatch(text,/<script|<iframe|<img|onerror=|onclick=/i);
      assert.equal((text.match(/\$/g)||[]).length%2,0,q.templateId+' delimiters');
      for(const match of text.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g))render(match[1]||match[2],q.templateId);
    }
    for(const s of q.solution)if(s.math)render(s.math,q.templateId);
  }
});
