import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateMixedQuestion,MIXED_TOPICS} from '../mixed-question-bank.js';
import {createMixedPracticeService,rewordPracticePrompt} from '../mixed-practice.js';
import {createMixedPracticeApi} from '../mixed-practice-api.js';
import {mixedPresetTopicIds,mixedSubjectLabel} from '../public/mixed-study.js';
import {unitsForSubject,unitForSubject,courseMatchesSubject} from '../public/courses.js';

const close=(a,b,context,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<=tolerance*Math.max(1,Math.abs(b)),`${context}: ${a} versus ${b}`);
const get=(topicId,difficulty,variantIndex,seed=0)=>generateMixedQuestion({topicId,difficulty,variantIndex,seed:'extension-'+seed});
const serviceFixture=(topicIds=['algebra-linear'],difficulty=1)=>{
  let seed=0;
  const service=createMixedPracticeService({topics:MIXED_TOPICS,generateQuestion:generateMixedQuestion,randomSeed:()=>`session-${++seed}`});
  const created=service.create('learner',{topicIds,difficulty});
  const first=service.next('learner',created.sessionId);
  const canonical=view=>service.tutorContext('learner',view.sessionId,view.question.id).question;
  const answer=(view,correct=true)=>service.answer('learner',view.sessionId,view.question.id,(canonical(view).answerIndex+(correct?0:1))%4);
  return {service,first,canonical,answer};
};

test('SAT contains four Math and four Reading/Writing starter domains; Algebra is independent of calculus',()=>{
  assert.equal(MIXED_TOPICS.filter(t=>t.subject==='sat'&&t.domainGroup==='Math').length,4);
  assert.equal(MIXED_TOPICS.filter(t=>t.subject==='sat'&&t.domainGroup==='Reading and Writing').length,4);
  assert.equal(MIXED_TOPICS.filter(t=>t.subject==='algebra').length,4);
  const manifest={units:[{id:'unit-01',number:1},{id:'unit-09',number:9,bcOnly:true}]};
  for(const subject of ['sat','algebra']){
    assert.deepEqual(unitsForSubject(manifest,subject),[]);
    assert.equal(unitForSubject(manifest.units[0],subject),null);
    assert.equal(courseMatchesSubject({name:'AP Calculus BC'},subject),false);
    assert.ok(mixedPresetTopicIds(MIXED_TOPICS,{initialSubject:subject}).every(id=>id.startsWith(subject+'-')));
  }
  assert.equal(courseMatchesSubject({name:'PSAT preparation'},'sat'),true);
  assert.equal(courseMatchesSubject({name:'Algebra II'},'algebra'),true);
  assert.equal(mixedSubjectLabel('sat'),'SAT practice');assert.equal(mixedSubjectLabel('algebra'),'Algebra');
  assert.deepEqual(mixedPresetTopicIds(MIXED_TOPICS,{initialTopicIds:['bc-limits','unknown','bc-limits']}),['bc-limits']);
  const ab=mixedPresetTopicIds(MIXED_TOPICS,{initialSubject:'calculus-ab'});
  assert.ok(ab.length>0);assert.ok(ab.every(id=>MIXED_TOPICS.find(t=>t.id===id).courseScopes.includes('calculus-ab')));
});

test('new SAT and Algebra numerical keys satisfy defining equations across every form and seeded parameters',()=>{
  const seen=new Set();
  for(const topic of MIXED_TOPICS.filter(t=>t.subject==='algebra'||t.subject==='sat'&&t.domainGroup==='Math'))for(const d of[1,2,3])for(const v of[0,1])for(let seed=0;seed<45;seed++){
    const q=get(topic.id,d,v,seed),p=q.parameters,a=q.numericAnswer,id=q.templateId;seen.add(id);
    assert.equal(q.choices.length,4);assert.equal(new Set(q.choices).size,4);assert.ok(q.choiceValues.every(Number.isFinite));
    assert.equal(q.choiceValues[q.answerIndex],a);
    switch(id){
      case 'sat-algebra-equation':case 'sat-algebra-context':close(p.a*a+p.b,p.c,id);break;
      case 'sat-algebra-slope':case 'sat-algebra-rate-table':close(a*p.dx,p.y2-p.y1,id);break;
      case 'sat-algebra-system':case 'sat-algebra-system-context':close(p.a*(p.sum-a)+(p.a+2)*a,p.total,id);break;
      case 'sat-quadratic-zero':case 'sat-quadratic-factor':close((a-p.a)*(a-p.b),0,id);assert.ok(a>=p.a);break;
      case 'sat-quadratic-minimum':case 'sat-quadratic-vertex':close(a,p.k,id);break;
      case 'sat-exponential-growth':case 'sat-exponential-value':close(a/p.start,Array(p.t).fill(p.factor).reduce((x,y)=>x*y,1),id);break;
      case 'sat-data-mean':close(a*p.values.length,p.values.reduce((x,y)=>x+y),id);break;
      case 'sat-data-total-from-mean':close(a/3,p.a+p.gap,id);break;
      case 'sat-data-mixture-mean':case 'sat-data-weighted-mean':close(a*(p.n+p.m),p.n*p.p+p.m*p.q,id);break;
      case 'sat-data-probability':case 'sat-data-probability-complement':close(a*(p.red+p.blue),p.red,id);break;
      case 'sat-triangle-missing-leg':close(a*a+(3*p.k)**2,(5*p.k)**2,id);assert.ok(a>0);break;
      case 'sat-triangle-hypotenuse':close(a*a,(3*p.k)**2+(4*p.k)**2,id);assert.ok(a>0);break;
      case 'sat-circle-radius':close(a*a,p.k*p.k,id);assert.ok(a>0);break;
      case 'sat-circle-area':close(a,p.k*p.k,id);break;
      case 'sat-similar-area':close(a,p.scale*p.scale,id);break;
      case 'sat-similar-side':close(a/p.side,p.scale,id);break;
      case 'algebra-both-sides':close(p.a*a+p.b,p.c*a+p.right,id);break;
      case 'algebra-intercept':close(p.a*p.x+a,p.y,id);break;
      case 'algebra-system-sum-difference':close(a-(p.sum-a),p.difference,id);break;
      case 'algebra-root-sum':close(a,p.a+p.b,id);break;
      case 'algebra-root-product':close(a,p.a*p.b,id);break;
      case 'algebra-vertex-x':close(2*(a-p.h),0,id);break;
      case 'algebra-vertex-y':close(a,p.k,id);break;
      case 'algebra-quadratic-value':close(a,p.x*p.x+(p.a+p.b)*p.x+p.a*p.b,id);break;
      case 'algebra-quadratic-linear-coefficient':close(9+a*3+p.a*p.b,(3+p.a)*(3+p.b),id);break;
      case 'algebra-exponent-product':close(2**a,2**p.m*2**p.n,id);break;
      case 'algebra-exponent-quotient':close(2**a,2**p.m/2**p.n,id);break;
      case 'algebra-negative-power':close(a*p.a**p.n,1,id);break;
      case 'algebra-power-of-power':close(2**a,(2**p.m)**p.n,id);break;
      case 'algebra-growth-time':close(p.initial*p.factor**a,p.amount,id);break;
      case 'algebra-growth-output':close(a/p.initial,p.factor**p.time,id);break;
      default:assert.fail('Unverified new form '+id);
    }
  }
  assert.ok(seen.size>=39);
});

test('alternate AP forms satisfy physical equations and numerical calculus, not renamed old questions',()=>{
  const forms=[['physics-kinematics',1],['physics-energy',2],['bc-chain-rule',1],['bc-integration',2],['bc-differential-equations',2],['bc-taylor',1]];
  for(const [topic,d]of forms)for(let seed=0;seed<50;seed++){
    const q=get(topic,d,1,seed),p=q.parameters,a=q.numericAnswer;
    assert.notEqual(q.variantId,get(topic,d,0,seed).variantId);
    switch(q.variantId){
      case 'p1-infer-acceleration':close(p.u+a*p.t,p.v,q.variantId);break;
      case 'p3-spring-compression':close(p.k*a*a/2,p.E,q.variantId);break;
      case 'c3-quadratic-inner':{const h=1e-5,f=x=>(p.a*x*x+p.b)**p.n;close(a,(f(p.c+h)-f(p.c-h))/(2*h),q.variantId);break;}
      case 'c6-logarithmic-parts':{const n=10000,h=(p.b-1)/n;let integral=0;for(let i=0;i<n;i++){const x=1+(i+.5)*h;integral+=x*Math.log(x)*h;}close(a,integral,q.variantId);break;}
      case 'c7-euler-decay':{let y=p.y0;for(let i=0;i<2;i++)y+=p.h*(-p.k*y);close(a,y,q.variantId);break;}
      case 'c10-cosine-coefficient':{let fact=1;for(let n=2;n<=p.n;n++)fact*=n;close(a*fact,p.a**p.n*Math.cos(p.n*Math.PI/2),q.variantId);break;}
      default:assert.fail(q.variantId);
    }
  }
});

test('all new forms and their worked solutions render using the vendored math renderer',()=>{
  const mod={exports:{}};new Function('module','exports',readFileSync(new URL('../public/vendor/katex/katex.min.js',import.meta.url),'utf8'))(mod,mod.exports);
  for(const t of MIXED_TOPICS)for(const d of[1,2,3])for(const v of[0,1,2,3]){
    const q=get(t.id,d,v,12);
    for(const text of[q.prompt,...q.choices,...q.hints,...q.solution.map(s=>s.text)])for(const m of text.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g))assert.doesNotThrow(()=>mod.exports.renderToString(m[1]||m[2],{throwOnError:true,strict:'ignore'}),q.variantId);
    for(const s of q.solution)if(s.math)assert.doesNotThrow(()=>mod.exports.renderToString(s.math,{throwOnError:true,strict:'ignore'}),q.variantId);
  }
});

test('wording reviews keep the exact mathematical question and cannot inflate difficulty or independent evidence',()=>{
  const {service,first,canonical,answer}=serviceFixture();const key=canonical(first);answer(first);
  const before=service.restore('learner',first.sessionId).summary;
  for(let i=0;i<3;i++){
    const review=service.next('learner',first.sessionId,{mode:'wording'}),q=canonical(review);
    assert.equal(review.question.reviewOnly,true);assert.notEqual(review.question.id,first.question.id);
    for(const field of['parameters','choices','answerIndex','numericAnswer','solution'])assert.deepEqual(q[field],key[field]);
    const result=answer(review,i!==1);
    assert.equal(result.summary.independentCorrect,before.independentCorrect);assert.equal(result.summary.byTopic[0].difficulty,before.byTopic[0].difficulty);assert.equal(result.summary.byTopic[0].cleanStreak,before.byTopic[0].cleanStreak);
    assert.equal(service.attemptEvidence('learner',first.sessionId,q.id).isReview,true);
  }
  assert.equal(service.restore('learner',first.sessionId).summary.reviewed,3);
  assert.equal(rewordPracticePrompt('<p>Find $f(x)=3x^2$.</p>').match(/\$[^$]+\$/)[0],'$f(x)=3x^2$');
  assert.throws(()=>service.next('learner',first.sessionId,{mode:'fake'}),{code:'INVALID_PRACTICE_MODE'});
});

test('wording reviews form grammatical instructions and preserve reading passages, quotations and equations',()=>{
  const passage='<p>The instructor wrote, “Find the value.” Which explanation she intended was unclear. The formula was $x^2+3x=4$.</p>';
  const prompt=passage+'<p>Which choice supplies a verb that agrees with the sentence’s grammatical subject?</p>';
  const changed=rewordPracticePrompt(prompt,1,{preservePassage:true});
  assert.ok(changed.includes(passage));
  assert.match(changed,/<p>Select the choice that supplies a verb that agrees with the sentence’s grammatical subject\.<\/p>/);
  assert.doesNotMatch(changed,/Select the choice supplies|subject\?/);
  const math='What is $\\text{Find the value of }x$?';
  assert.ok(rewordPracticePrompt(math).includes('$\\text{Find the value of }x$'));
  const quoted='The note says "Find x". What is $x$?';
  assert.ok(rewordPracticePrompt(quoted).includes('"Find x"'));
  assert.match(rewordPracticePrompt('Which transition most logically completes the text?',2),/Identify the transition that most logically completes the text\./);
});

test('adaptive selection continues fairly after wording review; a challenge changes parameters and supported forms',()=>{
  const {service,first,canonical,answer}=serviceFixture(['algebra-linear','physics-energy']);
  answer(first,false);const review=service.next('learner',first.sessionId,{mode:'wording'});answer(review);
  const follow=service.next('learner',first.sessionId);assert.equal(follow.question.topicId,first.question.topicId);answer(follow,false);
  const secondReview=service.next('learner',first.sessionId,{mode:'wording'});answer(secondReview);
  const rotated=service.next('learner',first.sessionId);assert.equal(rotated.question.topicId,'physics-energy');
  const separate=serviceFixture(['algebra-linear']);separate.answer(separate.first);
  const challenge=separate.service.next('learner',separate.first.sessionId,{mode:'challenge'});
  assert.notEqual(separate.canonical(challenge).variantId,separate.canonical(separate.first).variantId);
  assert.notDeepEqual(separate.canonical(challenge).parameters,separate.canonical(separate.first).parameters);
  assert.equal(challenge.question.practiceMode,'challenge');assert.equal(challenge.question.reviewOnly,false);
  assert.deepEqual(service.next('learner',first.sessionId,{mode:'challenge'}).question,rotated.question,'an unchecked current question is never skipped');
  assert.ok(canonical(first));
});

test('SAT reading levels use distinct authored passages; exhausted passages earn no new independent credit',()=>{
  const {service,first,canonical,answer}=serviceFixture(['sat-reading-evidence'],3);let view=first;const seen=new Set();
  const low=get('sat-reading-evidence',1,0),high=get('sat-reading-evidence',3,0);
  assert.notEqual(low.prompt,high.prompt);assert.notEqual(low.parameters.passageIndex,high.parameters.passageIndex);
  for(let i=0;i<7;i++){
    assert.equal(view.question.difficulty,3);assert.match(view.question.difficultyBasis,/not official SAT/);
    const p=canonical(view).parameters.passageIndex;
    if(i<2){assert.ok(!seen.has(p));assert.equal(view.question.reviewOnly,false);}
    else{assert.equal(view.question.reviewOnly,true);assert.match(view.selectionReason,/finite set/);}
    seen.add(p);const result=answer(view);assert.equal(result.summary.byTopic[0].difficulty,3);assert.equal(result.summary.independentCorrect,Math.min(i+1,2));
    view=service.next('learner',first.sessionId,{mode:'challenge'});
  }
});

test('anti-repeat detects unchanged visible questions even when unused private parameters change',()=>{
  let calls=0;
  const topics=[{id:'algebra-fixture',subject:'algebra'}];
  const service=createMixedPracticeService({topics,randomSeed:()=>String(++calls),generateQuestion:request=>({
    id:'source-'+calls,topicId:request.topicId,subject:'algebra',difficulty:1,templateId:'constant-form',variantId:'wording-'+calls,
    parameters:{unused: calls},type:'mc',prompt: calls<4?'<p>Find $x$ if $2x=6$.</p>':'<p>Find $x$ if $2x=8$.</p>',
    choices:['3','4'],answerIndex:calls<4?0:1,hints:[],solution:[],
  })});
  const created=service.create('learner',{topicIds:['algebra-fixture']}),first=service.next('learner',created.sessionId);
  service.answer('learner',created.sessionId,first.question.id,0);
  const next=service.next('learner',created.sessionId,{mode:'challenge'});
  assert.equal(calls,4);assert.match(next.question.prompt,/2x=8/);assert.equal(next.question.reviewOnly,false);
});

test('fixed reading content has 32 distinct passages and is never randomized by swapping words',()=>{
  const prompts=new Set();
  for(const topic of MIXED_TOPICS.filter(t=>t.domainGroup==='Reading and Writing'))for(const d of[1,2,3])for(let variant=0;variant<(d===1?4:2);variant++){
    const first=get(topic.id,d,variant,0),second=get(topic.id,d,variant,99);
    assert.equal(first.prompt,second.prompt);assert.equal(first.parameters.passageIndex,second.parameters.passageIndex);
    assert.equal(new Set(first.choices).size,4);assert.ok(first.choices.includes(second.choices[second.answerIndex]));prompts.add(first.prompt);
  }
  assert.equal(prompts.size,32);
  const base=get('physics-kinematics',1,0,20),alternate=get('physics-kinematics',1,1,20);
  assert.notEqual(base.id,alternate.id,'source ids must distinguish distinct forms even with the same seed');
});

test('public diagrams include only allowed givens; canonical completed evidence has no answers or hidden parameters',()=>{
  let serial=0;
  const service=createMixedPracticeService({topics:[{id:'safe',subject:'algebra'}],randomSeed:()=>String(++serial),generateQuestion:()=>({id:'source',topicId:'safe',subject:'algebra',difficulty:1,type:'mc',prompt:'Given points. Find slope.',choices:['1','2'],answerIndex:0,hints:[],solution:[],templateId:'safe-form',parameters:{key:1},visual:{type:'linear-graph',points:[{x:1,y:2,answer:999},{x:2,y:3}],answerIndex:0,solution:'hidden'},misconceptionTags:[null,'slope']})});
  const created=service.create('learner',{topicIds:['safe']}),view=service.next('learner',created.sessionId),q=view.question;
  assert.deepEqual(q.visual,{type:'linear-graph',points:[{x:1,y:2},{x:2,y:3}],xLabel:'x',yLabel:'y'});
  assert.equal(service.attemptEvidence('learner',view.sessionId,q.id),null);
  service.answer('learner',view.sessionId,q.id,1);const evidence=service.attemptEvidence('learner',view.sessionId,q.id);
  assert.equal(evidence.correct,false);assert.equal(evidence.misconceptionTag,'slope');assert.equal(evidence.assisted,false);assert.ok(Number.isFinite(Date.parse(evidence.at)));
  assert.doesNotMatch(JSON.stringify(evidence),/answerIndex|parameters|numericAnswer|choices|solution|prompt/);
  service.tutorReceived('learner',view.sessionId,q.id,true);assert.equal(service.attemptEvidence('learner',view.sessionId,q.id).assisted,true);
  assert.throws(()=>service.attemptEvidence('other',view.sessionId,q.id),{code:'SESSION_EXPIRED'});
});

test('history failures preserve grading; retry and late help persist canonical revisions without client claims',async()=>{
  const {service,first,canonical}=serviceFixture();let fail=true;const records=[];
  const handler=createMixedPracticeApi({service,isConfigured:()=>false,readBody:async req=>JSON.stringify(req.body),sendJson:(res,status,body)=>Object.assign(res,{status,body}),recordAttempt:async data=>{if(fail)throw new Error('disk');records.push(data);}});
  const call=async(path,body)=>{const res={};await handler({method:'POST',body},res,new URL('http://localhost/api/mixed/'+path+'?profile=learner'));return res;};
  const input={sessionId:first.sessionId,questionId:first.question.id,answerIndex:canonical(first).answerIndex,correct:false,assisted:true};
  const checked=await call('answer',input);assert.equal(checked.status,200);assert.equal(checked.body.correct,true);assert.equal(checked.body.assisted,false);assert.equal(checked.body.historySaved,false);assert.match(checked.body.historyNotice,/answer is checked/);
  fail=false;const retry=await call('answer',input);assert.equal(retry.body.historySaved,true);assert.equal(retry.body.summary.attempted,1);assert.equal(records.length,1);assert.equal(records[0].evidence.correct,true);assert.equal(records[0].evidence.assisted,false);
  await call('assisted',input);assert.equal(records.length,2);assert.equal(records[1].evidence.assisted,true);assert.equal(records[0].evidence.attemptId,records[1].evidence.attemptId);assert.equal(records[0].evidence.at,records[1].evidence.at);
});
