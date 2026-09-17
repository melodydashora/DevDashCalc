// Original procedural practice. Pure input -> output; no network, model,
// learner data, clock, or writes. Keep keys/parameters on the server.
import { createHash } from 'node:crypto';
import { SAT_TOPICS, ALGEBRA_TOPICS, createSatBuilders } from './mixed-sat-bank.js';
import { alternateApQuestion } from './mixed-ap-variants.js';

export const MIXED_BANK_VERSION = 2;
export const MIXED_BANK_SCOPE = Object.freeze({
  description: 'Original practice across Algebra, AP Physics 1, Calculus BC, and a SAT Math and Reading/Writing starter library. Not released exam items, full exam coverage or a score estimate.',
  sources: ['https://apstudents.collegeboard.org/courses/ap-physics-1-algebra-based', 'https://apstudents.collegeboard.org/courses/ap-calculus-bc'],
  limits: 'Finite parameter families can repeat. No AP Physics 2/C curriculum, laboratory assessment, or generated free-response grading.',
});
const topicRows = [
  ['physics-kinematics','physics',1,'Kinematics','Constant acceleration, velocity data and projectile motion.'],
  ['physics-forces','physics',2,'Forces and translational dynamics','Net force, friction and circular motion.'],
  ['physics-energy','physics',3,'Work, energy and power','Work, spring energy and energy with friction.'],
  ['physics-momentum','physics',4,'Linear momentum','Impulse, inelastic collisions and energy loss.'],
  ['physics-rotation','physics',5,'Torque and rotational dynamics','Torque, angular acceleration and a rotating pulley.'],
  ['physics-angular-momentum','physics',6,'Rotational energy and angular momentum','Rotational energy, angular momentum and rolling.'],
  ['physics-oscillations','physics',7,'Oscillations','Spring motion, period scaling and energy during oscillation.'],
  ['physics-fluids','physics',8,'Fluids','Pressure, buoyancy, continuity and Bernoulli reasoning.'],
  ['bc-limits','calculus-bc',1,'Limits and continuity','Continuous functions, removable limits and continuity parameters.'],
  ['bc-derivatives','calculus-bc',2,'Derivative definitions and rules','Power rule, tabular product rule and difference quotients.'],
  ['bc-chain-rule','calculus-bc',3,'Composite and implicit derivatives','Chain rule, implicit slopes and second derivatives.'],
  ['bc-contextual-derivatives','calculus-bc',4,'Rates and linearization','Linear approximation and geometric related rates.'],
  ['bc-derivative-analysis','calculus-bc',5,'Derivative analysis and optimization','Derivative signs, inflection points and optimization.'],
  ['bc-integration','calculus-bc',6,'Integration techniques','Definite integrals, integration by parts and improper integrals.'],
  ['bc-differential-equations','calculus-bc',7,'Differential equations','Growth rates, Euler steps and logistic acceleration.'],
  ['bc-integral-applications','calculus-bc',8,'Integral applications','Average value, disk volume and arc length.'],
  ['bc-parametric','calculus-bc',9,'Parametric and vector motion','Parametric slope, vector speed and second derivatives.'],
  ['bc-polar','calculus-bc',9,'Polar coordinates and area','Coordinates, sector area and polar tangent slope.'],
  ['bc-series','calculus-bc',10,'Series and convergence','Geometric sums, endpoint convergence and alternating error.'],
  ['bc-taylor','calculus-bc',10,'Taylor polynomials and error','Series coefficients, tabular Taylor approximation and remainder bounds.'],
];
export const MIXED_TOPICS = Object.freeze([...topicRows.map(([id,subject,unit,title,description]) => Object.freeze({
  id, subject, unit, unitNumber:unit, title, label:title, unitLabel:'Unit ' + unit, description,
  domainGroup:subject === 'physics' ? 'AP Physics 1' : 'AP Calculus BC',
  courseScopes:subject === 'physics' ? ['physics'] : unit <= 5 ? ['calculus-bc','calculus-ab'] : ['calculus-bc'],
})), ...SAT_TOPICS, ...ALGEBRA_TOPICS]);
const TOPICS = new Map(MIXED_TOPICS.map(topic => [topic.id, topic]));
const factorial = n => { let product = 1; for (let k = 2; k <= n; k++) product *= k; return product; };
const numberText = value => {
  const rounded = Number(value.toPrecision(8));
  const str = String(Object.is(rounded, -0) ? 0 : rounded);
  const match = /^(.+)e([+-]?\d+)$/.exec(str);
  return match ? match[1] + '\\times 10^{' + Number(match[2]) + '}' : str;
};
const math = value => '$' + (typeof value === 'number' ? numberText(value) : value) + '$';
const fraction = (n,d) => '\\frac{' + (typeof n==='number'?numberText(n):n) + '}{' + (typeof d==='number'?numberText(d):d) + '}';
const step = (text, expression) => expression ? { text, math:expression } : { text };
const wrong = (value, reason, tag, label) => ({ value, reason, tag, label });
function randomFor(seed) {
  let state = createHash('sha256').update(seed).digest().readUInt32LE(0);
  return { int(min,max) {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state; t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return min + Math.floor(((t ^ t >>> 14) >>> 0) / 4294967296 * (max - min + 1));
  } };
}
function numeric(templateId, parameters, prompt, answer, distractors, hints, solution, extra = {}) {
  return { templateId, parameters, prompt, answer, distractors, hints, solution, ...extra };
}
const BUILDERS = {
  'physics-kinematics': (r,d) => {
    const u=r.int(2,9), a=r.int(2,6), t=r.int(3,7);
    if(d===1) return numeric('p1-velocity',{u,a,t},
      'A cart has initial velocity ' + math(u) + ' m/s and constant acceleration ' + math(a) + ' m/s² in the same direction. What is its velocity after ' + math(t) + ' s?',u+a*t,
      [wrong(a*t,'This includes the velocity change but omits the initial velocity.','initial-velocity'),wrong(u+a,'This treats the elapsed time as one second.','elapsed-time'),wrong(u-a*t,'This subtracts the velocity change even though acceleration is in the positive direction.','acceleration-sign')],
      ['For constant acceleration, velocity changes by acceleration multiplied by elapsed time.','Add that change to the initial velocity.'],
      [step('Use the constant-acceleration velocity equation.','v=u+at'),step('Substitute the given quantities.','v='+u+'+'+a+'('+t+')='+numberText(u+a*t)+'\\ \\mathrm{m/s}')]);
    if(d===2) return numeric('p1-velocity-area',{u,a,t},
      'A velocity sensor records ' + math(u) + ' m/s at ' + math('t=0') + ' and ' + math(u+a*t) + ' m/s at ' + math('t='+t) + ' s. The velocity-time graph is a straight line between these points. What is the displacement in that interval?',u*t+a*t*t/2,
      [wrong((u+a*t)*t,'This uses the final velocity for the entire interval.','final-versus-average'),wrong(a*t*t/2,'This omits the rectangular area from the initial velocity.','initial-velocity'),wrong(a*t,'This is the velocity change, not the area under the velocity graph.','slope-versus-area')],
      ['Displacement is the signed area under the velocity-time graph.','For a straight velocity segment, use the average of its endpoint velocities.'],
      [step('Average the initial and final velocities.','v_{\\mathrm{avg}}='+fraction(2*u+a*t,2)),step('Multiply by the interval length.','\\Delta x=v_{\\mathrm{avg}}\\Delta t='+numberText(u*t+a*t*t/2)+'\\ \\mathrm m')],{representation:'graph-described'});
    const vx=r.int(3,12), fall=r.int(3,7), height=5*fall*fall;
    return numeric('p1-projectile',{vx,fall,height},
      'A ball leaves a horizontal platform at ' + math(vx) + ' m/s from a height of ' + math(height) + ' m. Ignore air resistance and use ' + math('g=10\\ \\mathrm{m/s^2}') + '. How far horizontally does it travel before reaching the ground?',vx*fall,
      [wrong(2*vx*fall,'This doubles the free-fall time as if the ball first rose to its launch height.','flight-time'),wrong(vx*fall*fall,'This multiplies horizontal speed by time squared rather than time.','horizontal-motion'),wrong(vx*fall/2,'This halves the horizontal displacement even though horizontal speed is constant.','unneeded-half')],
      ['Solve the vertical motion for flight time first.','The initial vertical velocity is zero; horizontal velocity remains constant.'],
      [step('Use the vertical drop to find time.','t=\\sqrt{2h/g}=\\sqrt{'+2*height+'/10}='+fall+'\\ \\mathrm s'),step('Use constant horizontal velocity.','\\Delta x=v_x t='+vx+'('+fall+')='+vx*fall+'\\ \\mathrm m')]);
  },
  'physics-forces': (r,d) => {
    const m=r.int(2,8), a=r.int(2,6), f=r.int(2,7);
    if(d===1) return numeric('p2-net-force',{m,a,f},
      'A '+math(m)+' kg cart experiences '+math(m*a+f)+' N to the right and '+math(f)+' N to the left. With right positive, what is its acceleration?',a,
      [wrong((m*a+2*f)/m,'This adds the magnitudes of opposing forces.','force-direction'),wrong(m*a,'This is the net force, before division by mass.','force-versus-acceleration'),wrong(-a,'This reverses the specified positive direction.','sign-convention')],
      ['Add forces with their signs before using Newton’s second law.','The net force equals mass multiplied by acceleration.'],
      [step('Calculate the signed net force.','F_{\\mathrm{net}}='+ (m*a+f)+'-'+f+'='+m*a+'\\ \\mathrm N'),step('Divide by mass.','a=F_{\\mathrm{net}}/m='+a+'\\ \\mathrm{m/s^2}')]);
    if(d===2) { const mu=r.int(1,4)/10, applied=m*(a+10*mu);
      return numeric('p2-friction',{m,a,mu,applied},
        'A '+math(m)+' kg block slides right on a horizontal surface. A horizontal force of '+math(applied)+' N acts right, and '+math('\\mu_k='+mu)+'. Use '+math('g=10\\ \\mathrm{m/s^2}')+'. What is its acceleration, taking right as positive?',a,
        [wrong(applied/m,'This ignores kinetic friction.','friction'),wrong((applied+mu*m*10)/m,'This adds friction in the direction of motion.','friction-direction'),wrong(-a,'This reverses the direction of the net force.','net-direction')],
        ['On this horizontal surface, the normal force balances the weight.','Subtract kinetic friction from the applied force before dividing by mass.'],
        [step('Find the normal force and kinetic friction.','N=mg,\\qquad f_k=\\mu_k mg='+numberText(mu*m*10)+'\\ \\mathrm N'),step('Use the net horizontal force.','a='+fraction(applied-mu*m*10,m)+'='+a+'\\ \\mathrm{m/s^2}')]);
    }
    const speed=r.int(3,9), radius=r.int(2,6), answer=m*speed*speed/radius;
    return numeric('p2-circular',{m,speed,radius},
      'A '+math(m)+' kg object moves at constant speed '+math(speed)+' m/s around a horizontal circle of radius '+math(radius)+' m. What is the magnitude of the net horizontal force?',answer,
      [wrong(m*speed/radius,'This uses speed rather than speed squared in centripetal acceleration.','speed-squared'),wrong(m*speed*speed*radius,'This multiplies by radius rather than dividing.','radius-reciprocal'),wrong(0,'Constant speed does not make velocity constant because its direction changes.','speed-versus-velocity')],
      ['Uniform circular motion still has acceleration because velocity changes direction.','Use the inward acceleration magnitude and Newton’s second law.'],
      [step('Determine centripetal acceleration.','a_c=v^2/r'),step('Multiply by mass.','F_{\\mathrm{net}}=mv^2/r='+numberText(answer)+'\\ \\mathrm N')]);
  },
  'physics-energy': (r,d) => {
    const f=r.int(3,12), distance=r.int(2,8);
    if(d===1) return numeric('p3-work',{f,distance},
      'A constant force of '+math(f)+' N acts parallel to a displacement of '+math(distance)+' m. How much work does this force do?',f*distance,
      [wrong(f/distance,'This divides force by displacement instead of multiplying.','work-product'),wrong(0,'A force parallel to displacement does nonzero work.','force-angle'),wrong(2*f*distance,'This inserts a factor of two that is not in the work formula.','unneeded-two')],
      ['Work depends on the component of force along the displacement.','Here the angle between force and displacement is zero.'],
      [step('Use the work definition.','W=Fd\\cos 0'),step('Evaluate.','W='+f+'('+distance+')='+f*distance+'\\ \\mathrm J')]);
    if(d===2) { const k=100*r.int(1,5), x=r.int(1,4)/10, answer=k*x*x/2;
      return numeric('p3-spring-energy',{k,x},
        'An ideal spring with spring constant '+math(k)+' N/m is compressed '+math(x)+' m from equilibrium. What elastic potential energy is stored?',answer,
        [wrong(k*x/2,'This uses displacement to the first power rather than squared.','spring-square'),wrong(k*x*x,'This omits the one-half factor.','spring-half'),wrong(-answer,'Spring potential energy relative to equilibrium is nonnegative for either compression or extension.','energy-sign')],
        ['The spring force changes as it compresses.','Spring energy is one-half the spring constant times displacement squared.'],
        [step('Use elastic potential energy.','U_s=\\tfrac12 kx^2'),step('Substitute.','U_s=\\tfrac12('+k+')('+x+')^2='+numberText(answer)+'\\ \\mathrm J')]);
    }
    const m=r.int(2,6), h=r.int(5,10), length=r.int(2,5), friction=m*r.int(1,3), answer=20*h-2*friction*length/m;
    return numeric('p3-energy-friction',{m,h,length,friction},
      'A '+math(m)+' kg cart starts from rest at height '+math(h)+' m above the end of a track. Friction does negative work only along a '+math(length)+' m segment, with constant magnitude '+math(friction)+' N. Use '+math('g=10\\ \\mathrm{m/s^2}')+'. What is '+math('v^2')+' at the track’s end, in m²/s²?',answer,
      [wrong(20*h,'This ignores energy transferred by friction.','friction-work'),wrong(20*h+2*friction*length/m,'This adds dissipated energy to the final kinetic energy.','work-sign'),wrong(answer/2,'This omits the factor of two when solving kinetic energy for speed squared.','kinetic-half')],
      ['Use an energy balance between the initial gravitational energy and the final kinetic energy.','Friction removes an amount equal to its magnitude times the segment length.'],
      [step('Write the energy balance.','\\tfrac12 mv^2=mgh-fL'),step('Solve for speed squared.','v^2=2gh-2fL/m='+numberText(answer)+'\\ \\mathrm{m^2/s^2}')]);
  },
  'physics-momentum': (r,d) => {
    const f=r.int(3,15), dt=r.int(2,6);
    if(d===1) return numeric('p4-impulse',{f,dt},
      'A constant net force of '+math(f)+' N acts in the positive direction for '+math(dt)+' s. What is the change in the object’s momentum?',f*dt,
      [wrong(f/dt,'This divides by the time interval instead of taking force times time.','impulse-time'),wrong(f,'This treats force itself as the momentum change.','force-versus-impulse'),wrong(-f*dt,'This reverses the given force direction.','impulse-sign')],
      ['Impulse is the area under the net-force-versus-time graph.','For constant force, that area is a rectangle.'],
      [step('Use the impulse-momentum theorem.','\\Delta p=F_{\\mathrm{net}}\\Delta t'),step('Evaluate.','\\Delta p='+f+'('+dt+')='+f*dt+'\\ \\mathrm{kg\\,m/s}')]);
    const m1=r.int(2,7),m2=r.int(1,5),u=r.int(3,9),v=-r.int(1,4), total=m1+m2, momentum=m1*u+m2*v, vf=momentum/total;
    if(d===2) return numeric('p4-sticking-collision',{m1,m2,u,v},
      'On a frictionless line, a '+math(m1)+' kg cart at '+math(u)+' m/s collides with a '+math(m2)+' kg cart at '+math(v)+' m/s. They stick together. What is their final signed velocity?',vf,
      [wrong(m1*u/total,'This omits the second cart’s initial momentum.','second-momentum'),wrong((m1*u-m2*v)/total,'This treats the initially negative velocity as positive.','momentum-sign'),wrong(momentum,'This gives total momentum without dividing by the combined mass.','combined-mass')],
      ['The total momentum is conserved during the collision.','After sticking, both masses share one velocity. Keep the sign of each initial velocity.'],
      [step('Conserve signed momentum.','m_1u+m_2v=(m_1+m_2)v_f'),step('Solve for the shared velocity.','v_f='+fraction(momentum,total)+'\\ \\mathrm{m/s}')]);
    const before=(m1*u*u+m2*v*v)/2, after=total*vf*vf/2, loss=before-after;
    return numeric('p4-collision-loss',{m1,m2,u,v},
      'Two carts of masses '+math(m1)+' kg and '+math(m2)+' kg move at '+math(u)+' m/s and '+math(v)+' m/s on a frictionless line. They collide and stick. How much translational kinetic energy is lost?',loss,
      [wrong(before,'This assumes all initial kinetic energy disappears, ignoring the final motion.','final-energy'),wrong(-loss,'This reverses the sign of the energy lost.','loss-sign'),wrong(2*loss,'This omits the one-half in both kinetic-energy terms.','kinetic-half')],
      ['First use momentum conservation to find their common final velocity.','Energy lost is initial kinetic energy minus final kinetic energy; kinetic energy is not conserved in a sticking collision.'],
      [step('Find the final velocity from momentum.','v_f='+fraction(momentum,total)),step('Subtract final kinetic energy from initial kinetic energy.','K_i-K_f=\\tfrac12m_1u^2+\\tfrac12m_2v^2-\\tfrac12(m_1+m_2)v_f^2='+numberText(loss)+'\\ \\mathrm J')]);
  },
  'physics-rotation': (r,d) => {
    const force=r.int(3,12), radius=r.int(2,6);
    if(d===1) return numeric('p5-torque',{force,radius},
      'A '+math(force)+' N force acts perpendicular to a lever arm of length '+math(radius)+' m. What is the magnitude of its torque about the pivot?',force*radius,
      [wrong(force/radius,'This divides by the lever arm instead of multiplying.','lever-arm'),wrong(0,'Perpendicular force has the largest moment arm, not zero.','torque-angle'),wrong(2*force*radius,'This inserts an extra factor of two.','unneeded-two')],
      ['Torque depends on the perpendicular lever arm.','The sine of the angle between lever arm and force is one here.'],
      [step('Use the torque magnitude.','\\tau=rF\\sin(\\pi/2)'),step('Evaluate.','\\tau='+radius+'('+force+')='+force*radius+'\\ \\mathrm{N\\,m}')]);
    if(d===2) { const inertia=r.int(2,7), reverse=r.int(1,5), net=force*radius-reverse, alpha=net/inertia;
      return numeric('p5-angular-acceleration',{force,radius,inertia,reverse},
        'A wheel has rotational inertia '+math(inertia)+' kg·m². A tangential force of '+math(force)+' N at radius '+math(radius)+' m acts counterclockwise. A separate '+math(reverse)+' N·m torque acts clockwise. With counterclockwise positive, what is the angular acceleration?',alpha,
        [wrong((force*radius+reverse)/inertia,'This adds the opposing torque instead of subtracting it.','torque-sign'),wrong(net,'This stops at net torque without dividing by rotational inertia.','rotational-inertia'),wrong(-alpha,'This reverses the positive rotation convention.','rotation-sign')],
        ['Find the signed sum of torques about the axle.','Rotational Newton’s second law is net torque equals rotational inertia times angular acceleration.'],
        [step('Add the torques with their signs.','\\tau_{\\mathrm{net}}='+force+'('+radius+')-'+reverse+'='+net),step('Divide by rotational inertia.','\\alpha=\\tau_{\\mathrm{net}}/I='+numberText(alpha)+'\\ \\mathrm{rad/s^2}')]);
    }
    const m=r.int(2,6), k=r.int(2,5), inertia=k*m*radius*radius, answer=10/(1+k);
    return numeric('p5-pulley',{m,radius,inertia},
      'A '+math(m)+' kg hanging mass unwinds a light string from a fixed pulley of radius '+math(radius)+' m and rotational inertia '+math(inertia)+' kg·m². The string does not slip; axle friction is negligible. Use '+math('g=10\\ \\mathrm{m/s^2}')+'. What is the mass’s downward acceleration?',answer,
      [wrong(10,'This treats the mass as free-falling and ignores the pulley’s rotation.','pulley-inertia'),wrong(10/(1+k*radius*radius),'This adds rotational inertia directly to mass without converting it by radius squared.','radius-squared'),wrong(10/k,'This accounts for the pulley but omits the hanging mass from the effective inertia.','translational-inertia')],
      ['Write a force equation for the hanging mass and a torque equation for the pulley.','Use the no-slip condition to relate angular and linear acceleration, then eliminate tension.'],
      [step('Use both equations and the no-slip condition.','mg-T=ma,\\quad Tr=I\\alpha,\\quad \\alpha=a/r'),step('Eliminate tension and solve.','a='+fraction(m*10,m+inertia/(radius*radius))+'='+numberText(answer)+'\\ \\mathrm{m/s^2}')]);
  },
  'physics-angular-momentum': (r,d) => {
    const inertia=r.int(2,8), omega=r.int(3,8);
    if(d===1) return numeric('p6-rotational-energy',{inertia,omega},
      'A rigid rotor with rotational inertia '+math(inertia)+' kg·m² rotates at '+math(omega)+' rad/s. What is its rotational kinetic energy?',inertia*omega*omega/2,
      [wrong(inertia*omega*omega,'This omits the one-half factor.','rotational-half'),wrong(inertia*omega/2,'This does not square the angular speed.','angular-speed-square'),wrong(inertia*omega,'This is the expression for angular momentum, not kinetic energy.','energy-versus-momentum')],
      ['Rotational kinetic energy has the same form as translational kinetic energy with rotational variables.','Use rotational inertia and angular speed squared.'],
      [step('Apply the rotational energy formula.','K_{\\mathrm{rot}}=\\tfrac12 I\\omega^2'),step('Substitute.','K_{\\mathrm{rot}}=\\tfrac12('+inertia+')('+omega+')^2='+inertia*omega*omega/2+'\\ \\mathrm J')]);
    if(d===2) {const factor=r.int(2,5);
      return numeric('p6-angular-conservation',{inertia,omega,factor},
        'With negligible external torque, a rotating system changes its rotational inertia from '+math(inertia)+' to '+math(inertia*factor)+' kg·m². Its initial angular speed is '+math(omega)+' rad/s. What is its final angular speed?',omega/factor,
        [wrong(omega*factor,'This increases angular speed with rotational inertia instead of conserving their product.','angular-inertia-inverse'),wrong(omega,'This holds angular speed constant despite the inertia change.','angular-momentum'),wrong(omega/(factor*factor),'This divides by the inertia ratio twice.','ratio-square')],
        ['Angular momentum stays constant when external torque is negligible.','Set the initial product of inertia and angular speed equal to the final product.'],
        [step('Conserve angular momentum.','I_i\\omega_i=I_f\\omega_f'),step('Solve.','\\omega_f='+fraction(omega,factor)+'\\ \\mathrm{rad/s}')]);
    }
    const h=r.int(2,9), beta=r.int(0,1)===0?0.5:0.4, answer=20*h/(1+beta);
    return numeric('p6-rolling-energy',{h,beta},
      'A rigid object rolls without slipping from rest down a height of '+math(h)+' m. Its rotational inertia is '+math('I='+beta+'mR^2')+'. There is no dissipative energy loss. Use '+math('g=10\\ \\mathrm{m/s^2}')+'. What is the final center-of-mass '+math('v^2')+' in m²/s²?',answer,
      [wrong(20*h,'This allocates all gravitational energy to translation and ignores rotation.','rolling-energy'),wrong(10*h/(1+beta),'This omits the factor of two when solving for speed squared.','kinetic-half'),wrong(20*h/beta,'This includes rotational energy but omits translational kinetic energy.','translation-plus-rotation')],
      ['Gravitational energy becomes both translational and rotational kinetic energy.','Use the no-slip relation between speed and angular speed.'],
      [step('Include both kinetic energies.','mgh=\\tfrac12 mv^2+\\tfrac12 I(v/R)^2'),step('Insert the inertia expression and solve.','v^2='+fraction(20*h,1+beta)+'='+numberText(answer)+'\\ \\mathrm{m^2/s^2}')]);
  },
  'physics-oscillations': (r,d) => {
    const m=r.int(2,7), k=r.int(3,12)*m;
    if(d===1) return numeric('p7-frequency',{m,k},
      'A mass '+math(m)+' kg oscillates on an ideal spring of constant '+math(k)+' N/m on a frictionless horizontal surface. What is its angular frequency squared, '+math('\\omega^2')+', in s⁻²?',k/m,
      [wrong(k*m,'This multiplies by mass instead of dividing.','spring-mass'),wrong(m/k,'This inverts the spring-to-mass ratio.','frequency-inverse'),wrong(2*k/m,'This inserts an extra factor of two.','frequency-two')],
      ['For ideal spring motion, the restoring force is proportional to negative displacement.','Compare the acceleration equation with the simple-harmonic form.'],
      [step('Combine the spring force and Newton’s second law.','a=-(k/m)x=-\\omega^2x'),step('Identify angular frequency squared.','\\omega^2=k/m='+k/m+'\\ \\mathrm{s^{-2}}')]);
    if(d===2) {const a=r.int(2,6), b=r.int(2,5);
      return numeric('p7-period-ratio',{a,b},
        'An ideal mass-spring oscillator is changed so its mass is multiplied by '+math(a*a)+' and its spring constant by '+math(b*b)+'. What is '+math('T_{\\mathrm{new}}/T_{\\mathrm{old}}')+'?',a/b,
        [wrong(a*a/(b*b),'This uses the mass-to-stiffness ratio without its square root.','period-square-root'),wrong(b/a,'This reverses the effect of mass and spring constant on period.','period-inverse'),wrong(a/(b*b),'This takes the square root of only the mass factor.','both-square-roots')],
        ['The period is proportional to the square root of mass divided by spring constant.','Take the ratio of the two periods before substituting the scale factors.'],
        [step('Form the ratio.','T_{\\mathrm{new}}/T_{\\mathrm{old}}=\\sqrt{'+fraction(a*a,b*b)+'}'),step('Simplify.','T_{\\mathrm{new}}/T_{\\mathrm{old}}='+fraction(a,b))]);
    }
    const n=r.int(1,5), amplitude=5*n/100, x=3*n/100, omega=r.int(2,7), stiffness=m*omega*omega, answer=omega*omega*(amplitude*amplitude-x*x);
    return numeric('p7-energy-position',{m,stiffness,amplitude,x},
      'A '+math(m)+' kg mass on an ideal spring of constant '+math(stiffness)+' N/m oscillates without friction with amplitude '+math(amplitude)+' m. What is its speed squared when its displacement from equilibrium is '+math(x)+' m?',answer,
      [wrong(omega*omega*amplitude*amplitude,'This gives the maximum speed squared at equilibrium.','position-energy'),wrong(omega*omega*x*x,'This uses the local spring energy as kinetic energy.','spring-versus-kinetic'),wrong(-answer,'This subtracts total energy from spring energy, reversing the kinetic energy sign.','energy-difference')],
      ['Total mechanical energy equals the spring energy at maximum displacement.','Subtract the spring energy at the given position to find kinetic energy.'],
      [step('Conserve mechanical energy.','\\tfrac12 kA^2=\\tfrac12 kx^2+\\tfrac12 mv^2'),step('Solve for speed squared.','v^2=(k/m)(A^2-x^2)='+numberText(answer)+'\\ \\mathrm{m^2/s^2}')]);
  },
  'physics-fluids': (r,d) => {
    if(d===1) { const rho=100*r.int(7,13), h=r.int(2,8), answer=rho*10*h;
      return numeric('p8-pressure',{rho,h},
        'A liquid of density '+math(rho)+' kg/m³ is at rest. At depth '+math(h)+' m below its surface, what is the gauge pressure? Use '+math('g=10\\ \\mathrm{m/s^2}')+'.',answer,
        [wrong(rho*h,'This omits gravitational acceleration.','hydrostatic-gravity'),wrong(rho*10/h,'This divides by depth instead of multiplying.','hydrostatic-depth'),wrong(answer+100000,'This adds atmospheric pressure even though gauge pressure was requested.','gauge-versus-absolute')],
        ['Gauge pressure is the increase relative to pressure at the surface.','For a stationary constant-density liquid, that increase is density times gravity times depth.'],
        [step('Use the hydrostatic pressure difference.','P_{\\mathrm{gauge}}=\\rho gh'),step('Substitute.','P_{\\mathrm{gauge}}='+rho+'(10)('+h+')='+answer+'\\ \\mathrm{Pa}')]);
    }
    if(d===2) {const objectDensity=20*r.int(5,45), fluidDensity=1000, answer=objectDensity/fluidDensity;
      return numeric('p8-floating-fraction',{objectDensity,fluidDensity},
        'A uniform object with density '+math(objectDensity)+' kg/m³ floats at rest in a liquid of density '+math(fluidDensity)+' kg/m³. What fraction of the object’s total volume is submerged?',answer,
        [wrong(fluidDensity/objectDensity,'This inverts the density ratio, predicting more than the whole object is submerged.','buoyancy-density-ratio'),wrong(1-answer,'This is the fraction above the surface rather than below it.','submerged-versus-exposed'),wrong(objectDensity/(objectDensity+fluidDensity),'This divides by the sum of densities instead of the liquid density.','buoyant-volume')],
        ['At equilibrium, buoyant force equals weight.','The displaced-liquid volume is only the submerged part of the object.'],
        [step('Balance weight and buoyant force.','\\rho_{\\mathrm{object}}Vg=\\rho_{\\mathrm{liquid}}V_{\\mathrm{sub}}g'),step('Divide to find the submerged fraction.','V_{\\mathrm{sub}}/V='+fraction(objectDensity,fluidDensity)+'='+numberText(answer))]);
    }
    const rho=100*r.int(7,12), speed=r.int(2,6), ratio=r.int(2,5), v2=ratio*speed, answer=rho*(v2*v2-speed*speed)/2;
    return numeric('p8-bernoulli',{rho,speed,ratio},
      'An ideal incompressible liquid of density '+math(rho)+' kg/m³ flows steadily through a horizontal pipe. Section 1 has '+math(ratio)+' times the area of section 2, and its speed is '+math(speed)+' m/s. What is '+math('P_1-P_2')+'?',answer,
      [wrong(rho*v2*v2/2,'This omits the kinetic term for section 1.','both-bernoulli-terms'),wrong(2*answer,'This omits the one-half in the kinetic pressure terms.','bernoulli-half'),wrong(-answer,'This assigns lower pressure to the slower wide section.','bernoulli-sign')],
      ['Use continuity to find the speed in the narrower section.','At equal heights, compare pressure plus one-half density times speed squared.'],
      [step('Apply continuity.','A_1v_1=A_2v_2\\quad\\Rightarrow\\quad v_2='+ratio+'('+speed+')='+v2),step('Apply Bernoulli’s equation.','P_1-P_2=\\tfrac12\\rho(v_2^2-v_1^2)='+numberText(answer)+'\\ \\mathrm{Pa}')]);
  },
};

Object.assign(BUILDERS, {
  'bc-limits': (r,d) => {
    const a=r.int(2,7), b=r.int(3,12), c=r.int(3,30);
    if(d===1) return numeric('c1-continuous-limit',{a,b,c},
      'Evaluate '+math('\\displaystyle\\lim_{x\\to '+c+'}('+a+'x^2+'+b+')')+'.',a*c*c+b,
      [wrong(a*c+b,'This substitutes into a linear expression instead of squaring the input.','input-square'),wrong(a*c*c,'This omits the constant term.','constant-term'),wrong(a*c*c-b,'This changes the sign of the constant term.','constant-sign')],
      ['A polynomial is continuous at every real input.','For a continuous function, the limit equals its value at the approached input.'],
      [step('Use continuity to substitute the approached input.','\\lim_{x\\to '+c+'}('+a+'x^2+'+b+')='+a+'('+c+')^2+'+b),step('Evaluate the expression.',String(a*c*c+b))]);
    if(d===2) return numeric('c1-removable-limit',{c},
      'Evaluate '+math('\\displaystyle\\lim_{x\\to '+c+'}\\frac{x^2-'+c*c+'}{x-'+c+'}')+'.',2*c,
      [wrong(c,'This keeps only one of the two terms after factoring.','factor-cancellation'),wrong(c*c,'This gives the original squared input instead of the reduced limit.','substitution-before-reduction'),wrong(0,'A zero numerator with a zero denominator is indeterminate, not automatically zero.','zero-over-zero')],
      ['Direct substitution produces an indeterminate form.','Factor the difference of squares and cancel only for inputs different from the approached value.'],
      [step('Factor and cancel away from the approached point.','\\frac{(x-'+c+')(x+'+c+')}{x-'+c+'}=x+'+c),step('Evaluate the continuous reduced expression.','\\lim_{x\\to '+c+'}(x+'+c+')='+2*c)]);
    const t=r.int(2,7), right=r.int(1,8), answer=(a*t+b-right)/t;
    return numeric('c1-continuity-parameter',{a,b,t,right},
      'Define '+math('f(x)=\\begin{cases}'+a+'x+'+b+',&x<'+t+'\\\\kx+'+right+',&x\\ge '+t+'\\end{cases}')+'. Which value of '+math('k')+' makes '+math('f')+' continuous at '+math('x='+t)+'?',answer,
      [wrong(a*t+b,'This gives the shared function value, not the coefficient k.','value-versus-parameter'),wrong((a*t+b+right)/t,'This adds the right branch’s constant when isolating k.','isolate-sign'),wrong((a*t-b+right)/t,'This reverses the constant difference needed to match the two branches.','branch-order')],
      ['For continuity, the left-hand limit must equal the right-branch value at the meeting point.','Set the two linear expressions equal there, then solve for the coefficient.'],
      [step('Match the two sides at the meeting point.',''+a+'('+t+')+'+b+'=k('+t+')+'+right),step('Solve for the parameter.','k='+fraction(a*t+b-right,t)+'='+numberText(answer))]);
  },
  'bc-derivatives': (r,d) => {
    const a=r.int(2,7), n=r.int(2,4), c=r.int(2,5);
    if(d===1) return numeric('c2-power-rule',{a,n,c},
      'If '+math('f(x)='+a+'x^{'+n+'}')+', what is '+math("f'("+c+")")+'?',a*n*c**(n-1),
      [wrong(a*c**(n-1),'This lowers the exponent but omits the original exponent multiplier.','power-multiplier'),wrong(a*n*c**n,'This multiplies by the original exponent without lowering it.','power-decrement'),wrong(a*c**n,'This evaluates the original function rather than its derivative.','function-versus-derivative')],
      ['The power rule both multiplies by the old exponent and lowers that exponent by one.','Differentiate before substituting the requested input.'],
      [step('Apply the power rule.',"f'(x)="+a*n+'x^{'+(n-1)+'}'),step('Evaluate the derivative.',"f'("+c+")="+a*n+'('+c+')^{'+(n-1)+'}='+a*n*c**(n-1))]);
    if(d===2) {const f=r.int(2,8), g=r.int(2,7), fp=r.int(2,6), gp=-r.int(1,5), answer=fp*g+f*gp;
      return numeric('c2-product-table',{f,g,fp,gp},
        'At '+math('x='+c)+', the table gives function and derivative values.</p><table><thead><tr><th>Quantity</th><th>Value</th></tr></thead><tbody><tr><td>'+math('f')+'</td><td>'+f+'</td></tr><tr><td>'+math('g')+'</td><td>'+g+'</td></tr><tr><td>'+math("f'")+'</td><td>'+fp+'</td></tr><tr><td>'+math("g'")+'</td><td>'+gp+'</td></tr></tbody></table><p>What is '+math('\\left.\\frac{d}{dx}[f(x)g(x)]\\right|_{x='+c+'}')+'?',answer,
        [wrong(fp*gp,'This multiplies the derivatives instead of applying the product rule.','product-rule'),wrong(fp*g-f*gp,'This uses subtraction rather than addition in the product rule.','product-sign'),wrong(f*g,'This evaluates the product itself rather than its derivative.','product-value')],
        ['The derivative of a product has two terms.','In each term, differentiate one factor and leave the other factor unchanged.'],
        [step('Apply the product rule.',"(fg)'=f'g+fg'"),step('Use the table values.',String(fp)+'('+g+')+'+f+'('+gp+')='+answer)],{representation:'table'});
    }
    const b=r.int(2,8), answer=3*a*c*c+b;
    return numeric('c2-difference-quotient',{a,b,c},
      'Evaluate '+math('\\displaystyle\\lim_{h\\to0}\\frac{'+a+'('+c+'+h)^3+'+b+'('+c+'+h)-('+a*c**3+'+'+b*c+')}{h}')+'.',answer,
      [wrong(b,'This keeps only the derivative of the linear term.','cubic-contribution'),wrong(3*a*c*c,'This omits the derivative of the linear term.','linear-contribution'),wrong(a*c**3+b*c,'This gives the function value at the input, not the limit of its difference quotient.','derivative-definition')],
      ['Recognize a derivative definition in the form of an increment quotient.','Identify the original function and the input at which its derivative is requested.'],
      [step('Identify the derivative represented by the limit.','f(x)='+a+'x^3+'+b+'x,\\qquad \\text{limit}=f\\prime('+c+')'),step('Differentiate and evaluate.','f\\prime(x)='+3*a+'x^2+'+b+',\\qquad f\\prime('+c+')='+answer)]);
  },
  'bc-chain-rule': (r,d) => {
    const a=r.int(2,6), b=r.int(2,7), c=r.int(1,4), n=r.int(2,4);
    if(d===1) {const inner=a*c+b, answer=n*a*inner**(n-1);
      return numeric('c3-chain-factor',{a,b,c,n},
        'Let '+math('f(x)=('+a+'x+'+b+')^{'+n+'}')+'. Find '+math("f'("+c+")")+'.',answer,
        [wrong(n*inner**(n-1),'This omits the derivative of the inner linear function.','chain-factor'),wrong(a*inner**(n-1),'This includes the inner derivative but omits the outer exponent multiplier.','outer-multiplier'),wrong(n*a*inner**n,'This does not lower the outer exponent after differentiation.','outer-power')],
        ['Differentiate the outer power while keeping the inner expression intact.','Multiply by the derivative of the inner linear expression.'],
        [step('Apply both parts of the chain rule.',"f'(x)="+n+'('+a+'x+'+b+')^{'+(n-1)+'}('+a+')'),step('Substitute the requested input.',"f'("+c+")="+numberText(answer))]);
    }
    if(d===2) return numeric('c3-implicit-slope',{a,b},
      'The point '+math('('+a+','+b+')')+' lies on '+math('x^2+y^2='+ (a*a+b*b))+'. What is '+math('dy/dx')+' there?',-a/b,
      [wrong(a/b,'This loses the negative sign when moving the x term to the other side.','implicit-sign'),wrong(-b/a,'This solves for dx/dy instead of dy/dx.','implicit-reciprocal'),wrong(-a,'This omits the factor y multiplying dy/dx.','implicit-chain-factor')],
      ['Differentiate both sides with respect to x, treating y as a function of x.','The derivative of y squared includes a factor of dy/dx.'],
      [step('Differentiate implicitly.','2x+2y\\,y\\prime=0'),step('Solve and substitute.','y\\prime=-x/y=-'+fraction(a,b))]);
    const yp=-(2*a+b)/(a+2*b), denom=a+2*b, answer=-(2+2*yp+2*yp*yp)/denom;
    return numeric('c3-implicit-second',{a,b},
      'A differentiable curve satisfies '+math('x^2+xy+y^2='+ (a*a+a*b+b*b))+'. Find '+math('d^2y/dx^2')+' at '+math('('+a+','+b+')')+'.',answer,
      [wrong(-(2+2*yp)/denom,'This omits the squared first-derivative term produced by differentiating y times y prime.','implicit-second-square'),wrong(-(2+2*yp*yp)/denom,'This omits the two first-derivative terms from differentiating the mixed product.','implicit-product'),wrong(-2/denom,'This treats every occurrence of y as constant during the second differentiation.','implicit-second-chain')],
      ['First find the implicit first derivative at the point.','Differentiate the first-derivative equation again, using the product rule on terms containing y prime.'],
      [step('Differentiate once and solve for the first derivative.','(2x+y)+(x+2y)y\\prime=0,\\quad y\\prime=-'+fraction(2*a+b,a+2*b)),step('Differentiate that equation again.','2+2y\\prime+2(y\\prime)^2+(x+2y)y\\prime\\prime=0'),step('Substitute and solve for the second derivative.','y\\prime\\prime='+numberText(answer))]);
  },
  'bc-contextual-derivatives': (r,d) => {
    if(d===1) {const c=r.int(2,9), value=r.int(5,20), slope=r.int(2,7), h=r.int(1,4)/10, answer=value+slope*h;
      return numeric('c4-linearization',{c,value,slope,h},
        'A differentiable function satisfies '+math('f('+c+')='+value)+' and '+math("f'("+c+")="+slope)+'. What does its tangent-line approximation predict for '+math('f('+numberText(c+h)+')')+'?',answer,
        [wrong(value+h,'This treats the derivative as one instead of the given slope.','linearization-slope'),wrong(slope*h,'This estimates only the change and omits the starting value.','linearization-base'),wrong(value-slope*h,'This subtracts the predicted change for a positive input increment.','linearization-sign')],
        ['A tangent-line estimate is the starting function value plus slope times input change.','Use the difference between the requested input and the known input.'],
        [step('Write the linear approximation.','f(c+h)\\approx f(c)+f\\prime(c)h'),step('Substitute.','f('+numberText(c+h)+')\\approx '+value+'+'+slope+'('+h+')='+numberText(answer))]);
    }
    if(d===2) {const radius=r.int(2,7), k=r.int(2,12), answer=k/(radius*radius);
      return numeric('c4-sphere-rate',{radius,k},
        'A sphere’s volume is increasing at '+math(4*k+'\\pi')+' cm³/s. When its radius is '+math(radius)+' cm, how fast is the radius increasing? Use '+math('V=\\tfrac43\\pi r^3')+'.',answer,
        [wrong(k/radius,'This divides by radius rather than radius squared after differentiating volume.','sphere-power'),wrong(k/(4*radius*radius),'This retains an extra factor of four after canceling the given volume rate.','sphere-coefficient'),wrong(k*radius*radius,'This multiplies by radius squared instead of dividing to isolate the radius rate.','isolate-rate')],
        ['Differentiate the volume equation with respect to time before substituting the radius.','The radius depends on time, so use the chain rule.'],
        [step('Differentiate volume with respect to time.','dV/dt=4\\pi r^2\\,dr/dt'),step('Solve for the radius rate.','dr/dt='+fraction(k,radius*radius)+'\\ \\mathrm{cm/s}')]);
    }
    const h=r.int(2,6), ratio=r.int(2,4), height=3*h, radius=height/ratio, k=r.int(2,10), answer=k*ratio*ratio/(h*h);
    return numeric('c4-cone-rate',{h,ratio,height,radius,k},
      'Water enters an upright conical tank at '+math(k+'\\pi')+' cm³/s. The tank is '+math(height)+' cm high with top radius '+math(radius)+' cm. When the water is '+math(h)+' cm deep, how fast is the water level rising? The vertex is at the bottom.',answer,
      [wrong(k/(h*h),'This treats the water surface radius as equal to its depth.','cone-similarity'),wrong(answer/3,'This retains the one-third after differentiating the cubic volume expression.','cone-derivative'),wrong(k*ratio*ratio/h,'This uses depth to the first power instead of squared in the differentiated volume.','cone-power')],
      ['Use similar triangles to express the water-surface radius in terms of water depth.','Substitute that relationship into the cone volume before differentiating with respect to time.'],
      [step('Use the tank’s fixed ratio to express radius through depth.','r=h/'+ratio+',\\qquad V=\\frac{\\pi h^3}{'+3*ratio*ratio+'}'),step('Differentiate and solve for the depth rate.','dV/dt=\\frac{\\pi h^2}{'+ratio*ratio+'}\\,dh/dt,\\qquad dh/dt='+numberText(answer)+'\\ \\mathrm{cm/s}')]);
  },
  'bc-derivative-analysis': (r,d) => {
    const left=r.int(2,6), right=left+r.int(2,7), a=r.int(2,6);
    if(d===1) return numeric('c5-decreasing-interval',{left,right,a},
      'A differentiable function satisfies '+math("f'(x)="+a+'(x-'+left+')(x-'+right+')')+' for all real x. On which interval is '+math('f')+' decreasing?',
      'between',
      [wrong('outside','The derivative is positive outside the two roots, so those are increasing intervals.','derivative-sign',math('(-\\infty,'+left+')\\cup('+right+',\\infty)')),wrong('all','The derivative changes sign at the roots; it is not negative everywhere.','sign-chart','All real numbers'),wrong('none','Between the roots, the two linear factors have opposite signs.','opposite-factor-signs','No interval')],
      ['A function decreases where its first derivative is negative.','Check the signs of the two factors on each side of their roots.'],
      [step('Identify the sign of the derivative on the three intervals.','f\\prime(x)>0\\text{ for }x<'+left+'\\text{ or }x>'+right+';\\quad f\\prime(x)<0\\text{ for }'+left+'<x<'+right),step('Report the interval of decrease.','('+left+','+right+')')],
      {answerLabel:math('('+left+','+right+')')});
    if(d===2) return numeric('c5-inflection-points',{left,right,a},
      'A twice-differentiable function has '+math("f''(x)="+a+'(x-'+left+')(x-'+right+')')+' for all real x. What is the sum of the x-coordinates of its inflection points?',left+right,
      [wrong(left*right,'This multiplies the roots rather than adding their x-coordinates.','root-sum'),wrong(right-left,'This gives the distance between the roots rather than their sum.','sum-versus-distance'),wrong(left,'This keeps only the first root even though the second derivative changes sign at both.','all-inflections')],
      ['An inflection point requires a change in concavity.','Check the sign of the second derivative on both sides of each simple root.'],
      [step('Both roots are simple, so the second derivative changes sign at each.','x='+left+'\\quad\\text{and}\\quad x='+right),step('Add their x-coordinates.',left+'+'+right+'='+ (left+right))]);
    const side=r.int(3,40), perimeter=4*side;
    return numeric('c5-area-optimization',{side,perimeter},
      'A rectangle has fixed perimeter '+math(perimeter)+' m and positive side lengths. What length should one side have to maximize the area?',side,
      [wrong(2*side,'This assigns the entire sum of two adjacent sides to one side, leaving zero for the other.','perimeter-constraint'),wrong(side/2,'This divides the perimeter among eight side-length units instead of four.','constraint-factor'),wrong(4*side,'This treats the full perimeter as one side length.','perimeter-versus-side')],
      ['Use the perimeter to express one side in terms of the other.','Differentiate the resulting area function and check that the critical point gives a maximum.'],
      [step('Express area using the perimeter constraint.','A(x)=x('+2*side+'-x)'),step('Find and classify the critical point.','A\\prime(x)='+2*side+'-2x=0\\Rightarrow x='+side+',\\qquad A\\prime\\prime(x)=-2<0')]);
  },
  'bc-integration': (r,d) => {
    if(d===1) {const a=r.int(2,8), n=r.int(2,4), b=r.int(2,5), answer=a*b**(n+1)/(n+1);
      return numeric('c6-power-integral',{a,n,b},
        'Evaluate '+math('\\displaystyle\\int_0^{'+b+'}'+a+'x^{'+n+'}\\,dx')+'.',answer,
        [wrong(a*b**n,'This evaluates the integrand at the upper bound rather than an antiderivative.','integrand-versus-integral'),wrong(a*b**(n+1),'This raises the exponent but does not divide by the new exponent.','integration-divisor'),wrong(a*b**(n+1)/n,'This divides by the old exponent rather than the new one.','integration-new-power')],
        ['Find an antiderivative using the power rule for integration.','Evaluate that antiderivative at both bounds and subtract.'],
        [step('Integrate the power.','\\int '+a+'x^{'+n+'}\\,dx=\\frac{'+a+'x^{'+(n+1)+'}}{'+(n+1)+'}+C'),step('Apply the bounds.','\\int_0^{'+b+'}'+a+'x^{'+n+'}\\,dx='+numberText(answer))]);
    }
    if(d===2) {const a=r.int(2,16), exp=Math.exp(a), answer=((a-1)*exp+1)/(a*a);
      return numeric('c6-integration-parts',{a},
        'Which expression equals '+math('\\displaystyle\\int_0^1 xe^{'+a+'x}\\,dx')+'?',answer,
        [wrong(exp/a,'This keeps only the boundary product and omits the remaining integral.','parts-remainder',math(fraction('e^{'+a+'}',a))),
          wrong(((a-1)*exp-1)/(a*a),'This reverses the sign of the lower-bound contribution.','parts-boundary',math(fraction((a-1)+'e^{'+a+'}-1',a*a))),
          wrong((exp-1)/(a*a),'This gives the magnitude of the subtracted exponential integral and omits the boundary product.','parts-product',math(fraction('e^{'+a+'}-1',a*a)))],
        ['Use integration by parts with the polynomial as u.','Integrate the exponential carefully, then evaluate the full antiderivative at both endpoints.'],
        [step('Choose the integration-by-parts terms.','u=x,\\quad dv=e^{'+a+'x}dx,\\quad du=dx,\\quad v=e^{'+a+'x}/'+a),
          step('Integrate and apply both bounds.','\\left[\\frac{xe^{'+a+'x}}{'+a+'}-\\frac{e^{'+a+'x}}{'+a*a+'}\\right]_0^1=\\frac{'+(a-1)+'e^{'+a+'}+1}{'+a*a+'}')],
        {answerLabel:math(fraction((a-1)+'e^{'+a+'}+1',a*a))});
    }
    const b=r.int(2,6), p=r.int(2,4), c=r.int(2,12), answer=c/((p-1)*b**(p-1));
    return numeric('c6-improper-integral',{b,p,c},
      'Evaluate the convergent improper integral '+math('\\displaystyle\\int_'+b+'^\\infty\\frac{'+c+'}{x^{'+p+'}}\\,dx')+'.',answer,
      [wrong(c/((p+1)*b**(p+1)),'This increases the magnitude of the negative exponent instead of raising the exponent by one.','negative-power-integral'),wrong(c/(p*b**p),'This divides by p while leaving the power of the endpoint unchanged.','power-antiderivative'),wrong(-answer,'This reverses the upper-minus-lower evaluation.','improper-boundary-sign')],
      ['Replace infinity with a variable upper bound before integrating.','The exponent in the antiderivative is negative, so its value tends to zero at the infinite endpoint.'],
      [step('Write the limit of finite integrals.','\\lim_{R\\to\\infty}\\left[-\\frac{'+c+'}{'+(p-1)+'x^{'+(p-1)+'}}\\right]_'+b+'^R'),
        step('Evaluate the endpoint limit.','0+\\frac{'+c+'}{'+(p-1)+'('+b+')^{'+(p-1)+'}}='+numberText(answer))]);
  },
});

Object.assign(BUILDERS, {
  'bc-differential-equations': (r,d) => {
    if(d===1) {const a=r.int(2,12), k=r.int(2,7);
      return numeric('c7-growth-initial-rate',{a,k},
        'A solution of '+math('dy/dt='+k+'y')+' satisfies '+math('y(0)='+a)+'. What is '+math("y'(0)")+'?',a*k,
        [wrong(a,'This gives the initial amount rather than its rate of change.','amount-versus-rate'),wrong(k,'This gives the proportionality constant rather than the initial derivative.','growth-rate-factor'),wrong(a/k,'This divides by the proportionality constant instead of multiplying.','growth-ratio')],
        ['The differential equation already states the derivative in terms of the current value.','Substitute the initial condition directly into the equation.'],
        [step('Use the differential equation at the initial time.','y\\prime(0)='+k+'y(0)'),step('Substitute the initial value.','y\\prime(0)='+k+'('+a+')='+a*k)]);
    }
    if(d===2) {const a=r.int(2,8), h=r.int(1,2)/4, first=a+h*a, answer=first+h*(h+first), exact=(a+1)*Math.exp(2*h)-2*h-1;
      return numeric('c7-euler-two-steps',{a,h},
        'Use Euler’s method with two steps of size '+math(h)+' to estimate '+math('y('+2*h+')')+' for '+math('y\\prime=x+y')+' with '+math('y(0)='+a)+'.',answer,
        [wrong(a+2*h*a,'This reuses the original slope for both steps.','euler-update'),wrong(a*(1+h)**2,'This updates y but omits the x contribution in the second slope.','euler-x-update'),wrong(exact,'This uses the exact differential-equation solution instead of the requested Euler estimate.','numerical-versus-exact')],
        ['At each step, compute the slope at the current point, then update both coordinates.','The second step must use the new x and the newly estimated y.'],
        [step('Take the first Euler step.','y_1='+a+'+'+h+'(0+'+a+')='+numberText(first)),step('Recompute the slope and take the second step.','y_2='+numberText(first)+'+'+h+'('+h+'+'+numberText(first)+')='+numberText(answer))]);
    }
    const rate=r.int(1,4)/10, capacity=40*r.int(2,10), population=capacity/4, answer=3*rate*rate*capacity/32;
    return numeric('c7-logistic-second',{rate,capacity,population},
      'A population follows '+math('P\\prime='+rate+'P(1-P/'+capacity+')')+'. Find '+math('P\\prime\\prime')+' at an instant when '+math('P='+population)+'.',answer,
      [wrong(3*rate*capacity/16,'This computes the first derivative rather than the second derivative.','logistic-order'),wrong(3*rate*rate*capacity/16,'This omits the factor one minus twice the population fraction.','logistic-chain'),wrong(-answer,'Below half the carrying capacity, the logistic growth rate is increasing rather than decreasing.','logistic-concavity')],
      ['Differentiate the population equation with respect to time.','Every occurrence of P depends on time, so the second derivative contains a factor of P prime.'],
      [step('Differentiate the logistic equation.','P\\prime\\prime='+rate+'P\\prime(1-2P/'+capacity+')'),step('Evaluate the first derivative and then the second.','P\\prime='+numberText(3*rate*capacity/16)+',\\qquad P\\prime\\prime='+numberText(answer))]);
  },
  'bc-integral-applications': (r,d) => {
    const a=r.int(2,7), b=r.int(3,6);
    if(d===1) return numeric('c8-average-value',{a,b},
      'What is the average value of '+math('f(x)='+a+'x')+' on '+math('[0,'+b+']')+'?',a*b/2,
      [wrong(a*b*b/2,'This gives the definite integral without dividing by interval length.','average-interval'),wrong(a*b,'This evaluates the function at the upper endpoint instead of averaging.','average-endpoint'),wrong(a/2,'This omits the interval’s scale when evaluating the average.','average-scale')],
      ['Average function value is the definite integral divided by the interval length.','The interval length is the upper endpoint minus the lower endpoint.'],
      [step('Set up average value.','f_{\\mathrm{avg}}=\\frac1{'+b+'}\\int_0^{'+b+'}'+a+'x\\,dx'),step('Evaluate.','f_{\\mathrm{avg}}=\\frac1{'+b+'}\\left[\\frac{'+a+'x^2}{2}\\right]_0^{'+b+'}='+numberText(a*b/2))]);
    if(d===2) return numeric('c8-disk-volume',{a,b},
      'The region under '+math('y='+a+'x')+' and above the x-axis for '+math('0\\le x\\le '+b)+' rotates about the x-axis. Its volume is '+math('V')+'. What is '+math('V/\\pi')+'?',a*a*b**3/3,
      [wrong(a*b*b/2,'This finds the unrotated planar area rather than squared disk radii.','area-versus-volume'),wrong(a*a*b**3,'This omits division by three in the integral of x squared.','volume-antiderivative'),wrong(a*b**3/3,'This squares x but omits squaring the radius coefficient.','disk-square')],
      ['Each perpendicular cross-section is a disk whose radius is the function value.','Integrate pi times the radius squared over the interval.'],
      [step('Set up the disk integral.','V=\\pi\\int_0^{'+b+'}('+a+'x)^2\\,dx'),step('Integrate and divide by pi.','V/\\pi='+a*a+'\\left[x^3/3\\right]_0^{'+b+'}='+numberText(a*a*b**3/3))]);
    const s=r.int(2,35), endpoint=s*s-1, answer=2*(s**3-1)/3;
    return numeric('c8-arc-length',{s,endpoint},
      'Find the arc length of '+math('y=\\tfrac23x^{3/2}')+' from '+math('x=0')+' to '+math('x='+endpoint)+'.',answer,
      [wrong(2*s**3/3,'This omits the lower-bound contribution in the arc-length antiderivative.','arc-lower-bound'),wrong(2*endpoint**1.5/3,'This gives the vertical change rather than arc length.','arc-versus-height'),wrong(2*(s-1)/3,'This omits the third power after the substitution at the endpoints.','arc-antiderivative')],
      ['Arc length for y as a function of x integrates the square root of one plus the derivative squared.','Differentiate first; this curve makes the expression inside that square root linear.'],
      [step('Find the derivative and arc-length integral.','y\\prime=\\sqrt{x},\\qquad L=\\int_0^{'+endpoint+'}\\sqrt{1+x}\\,dx'),step('Integrate and apply the bounds.','L=\\left[\\tfrac23(1+x)^{3/2}\\right]_0^{'+endpoint+'}=\\tfrac23('+s+'^3-1)='+numberText(answer))]);
  },
  'bc-parametric': (r,d) => {
    const a=r.int(2,6), b=r.int(2,7), t=r.int(2,5);
    if(d===1) return numeric('c9-parametric-slope',{a,b,t},
      'A curve is given by '+math('x='+a+'t')+' and '+math('y='+b+'t^2')+'. Find '+math('dy/dx')+' at '+math('t='+t)+'.',2*b*t/a,
      [wrong(2*b*t,'This gives dy/dt without dividing by dx/dt.','parameter-denominator'),wrong(b*t/a,'This omits the factor two in the derivative of y.','parameter-power'),wrong(a/(2*b*t),'This computes dx/dy rather than dy/dx.','parameter-reciprocal')],
      ['Differentiate both coordinates with respect to the parameter.','The slope in the xy-plane is their derivative ratio, provided dx/dt is nonzero.'],
      [step('Form the parametric slope.','dy/dx=(dy/dt)/(dx/dt)='+fraction(2*b+'t',a)),step('Substitute the parameter value.','dy/dx='+fraction(2*b*t,a))]);
    if(d===2) {const answer=Math.sqrt(4*t*t+9*b*b*t**4);
      return numeric('c9-vector-speed',{b,t},
        'A particle’s position is '+math('\\mathbf r(t)=\\langle t^2,'+b+'t^3\\rangle')+', where coordinates are in meters and time in seconds. What is its speed at '+math('t='+t)+' s?',answer,
        [wrong(2*t+3*b*t*t,'This adds velocity components rather than taking their Euclidean magnitude.','vector-magnitude'),wrong(Math.sqrt(t**4+b*b*t**6),'This gives distance from the origin rather than speed.','position-versus-velocity'),wrong(4*t*t+9*b*b*t**4,'This stops at speed squared and omits the square root.','speed-square-root')],
        ['Differentiate the position components to obtain velocity.','Speed is the magnitude of that velocity vector.'],
        [step('Differentiate position.','\\mathbf v(t)=\\langle 2t,'+3*b+'t^2\\rangle'),step('Take the magnitude at the requested time.','\\lVert\\mathbf v('+t+')\\rVert=\\sqrt{'+4*t*t+'+'+9*b*b*t**4+'}='+numberText(answer)+'\\ \\mathrm{m/s}')]);
    }
    const answer=3*b/(4*a*a*t);
    return numeric('c9-parametric-second',{a,b,t},
      'A curve has '+math('x='+a+'t^2')+' and '+math('y='+b+'t^3')+'. Find '+math('d^2y/dx^2')+' at '+math('t='+t)+'.',answer,
      [wrong(3*b/(2*a),'This differentiates the slope with respect to t but does not divide by dx/dt again.','second-parameter-denominator'),wrong(3*b/(4*a*t),'This loses one factor of the x-coordinate coefficient.','second-coefficient-square'),wrong(-answer,'Both the slope’s parameter derivative and dx/dt are positive here.','second-parameter-sign')],
      ['Find dy/dx as a function of the parameter first.','To differentiate that slope with respect to x, differentiate it with respect to t and divide by dx/dt.'],
      [step('Compute the first derivative.','dy/dx='+fraction(3*b+'t',2*a)),step('Convert the slope’s parameter derivative into an x derivative.','d^2y/dx^2='+fraction(3*b,4*a*a+'t')+'='+numberText(answer))]);
  },
  'bc-polar': (r,d) => {
    const k=r.int(2,35);
    if(d===1) return numeric('c9-polar-coordinate',{k},
      'A point has polar coordinates '+math('(r,\\theta)=('+2*k+',\\pi/3)')+'. What is its Cartesian x-coordinate?',k,
      [wrong(2*k,'This treats the polar radius as the x-coordinate without projecting it.','polar-projection'),wrong(Math.sqrt(3)*k,'This is the y-coordinate obtained with sine instead of cosine.','polar-sine-cosine'),wrong(-k,'The angle is in the first quadrant, so its x-coordinate is positive.','polar-quadrant')],
      ['Cartesian coordinates are projections of the radius.','Use cosine for the horizontal coordinate.'],
      [step('Convert the horizontal coordinate.','x=r\\cos\\theta'),step('Substitute the known cosine.','x='+2*k+'\\cos(\\pi/3)='+k)]);
    if(d===2) {const n=r.int(2,7), answer=k*k/(2*n);
      return numeric('c9-polar-area',{k,n},
        'The polar region has '+math('0\\le\\theta\\le\\pi/'+n)+' and '+math('0\\le r\\le '+k)+'. Its area is '+math('A')+'. What is '+math('A/\\pi')+'?',answer,
        [wrong(k*k/n,'This omits the one-half in the polar area formula.','polar-area-half'),wrong(k/(2*n),'This uses radius rather than radius squared.','polar-radius-square'),wrong(k*k/2,'This integrates over an angle of pi rather than the stated angle.','polar-angle-range')],
        ['Polar area integrates one-half radius squared with respect to angle.','The radius is constant over the stated angle interval.'],
        [step('Set up the area integral.','A=\\tfrac12\\int_0^{\\pi/'+n+'}'+k+'^2\\,d\\theta'),step('Evaluate and divide by pi.','A/\\pi='+fraction(k*k,2*n))]);
    }
    const a=r.int(2,8), b=r.int(1,6), answer=b/a;
    return numeric('c9-polar-slope',{a,b},
      'A polar curve is '+math('r='+a+'+'+b+'\\cos\\theta')+'. Find its Cartesian tangent slope '+math('dy/dx')+' at '+math('\\theta=\\pi/2')+'.',answer,
      [wrong(-b/a,'This includes only one of the two negative signs in the derivative ratio.','polar-slope-sign'),wrong(-a/b,'This reverses the ratio and retains the wrong sign.','polar-derivative-ratio'),wrong(0,'The cosine is zero at this angle, but its derivative is not zero.','polar-function-versus-derivative')],
      ['Write x and y as functions of the angle using polar conversion.','Differentiate each with the product rule, then take dy/dtheta divided by dx/dtheta.'],
      [step('Differentiate the Cartesian coordinates.','x\\prime=r\\prime\\cos\\theta-r\\sin\\theta,\\quad y\\prime=r\\prime\\sin\\theta+r\\cos\\theta'),step('Evaluate the radius and its derivative at the angle.','r='+a+',\\quad r\\prime=-'+b+',\\quad x\\prime=-'+a+',\\quad y\\prime=-'+b),step('Take the ratio.','dy/dx='+fraction(b,a))]);
  },
  'bc-series': (r,d) => {
    if(d===1) {const a=r.int(2,9), k=r.int(3,8), answer=a*k/(k-1);
      return numeric('c10-geometric-sum',{a,k},
        'Find the sum '+math('\\displaystyle\\sum_{n=0}^\\infty '+a+'\\left(\\frac1{'+k+'}\\right)^n')+'.',answer,
        [wrong(a/(k-1),'This starts at n=1 instead of including the n=0 term.','geometric-start'),wrong(a*k/(k+1),'This uses a negative common ratio rather than the stated positive ratio.','geometric-ratio-sign'),wrong(a*k,'This divides the first term by the ratio rather than by one minus the ratio.','geometric-denominator')],
        ['The magnitude of the common ratio is less than one.','Use the first included term divided by one minus the common ratio.'],
        [step('Identify the first term and common ratio.','a_0='+a+',\\quad r=1/'+k),step('Sum the infinite geometric series.','S='+fraction(a,'1-1/'+k)+'='+fraction(a*k,k-1))]);
    }
    if(d===2) {const center=r.int(1,7), radius=r.int(2,7), lower=center-radius, upper=center+radius;
      return numeric('c10-convergence-interval',{center,radius},
        'What is the interval of convergence of '+math('\\displaystyle\\sum_{n=1}^\\infty\\frac{(x-'+center+')^n}{n\\,'+radius+'^n}')+'?','left-included',
        [wrong('open','The negative endpoint produces an alternating harmonic series, which does converge.','negative-endpoint',math('('+lower+','+upper+')')),
          wrong('closed','The positive endpoint produces the divergent harmonic series.','positive-endpoint',math('['+lower+','+upper+']')),
          wrong('right-included','This reverses the two endpoint conclusions.','endpoint-sign',math('('+lower+','+upper+']'))],
        ['First find the radius using the ratio test.','Test the two endpoints separately; the ratio test does not decide them.'],
        [step('The ratio test gives the open interval.','|x-'+center+'|<'+radius),step('Test the endpoints.','x='+lower+':\\ \\sum (-1)^n/n\\text{ converges};\\quad x='+upper+':\\ \\sum 1/n\\text{ diverges}'),step('Combine the endpoint results.','['+lower+','+upper+')')],
        {answerLabel:math('['+lower+','+upper+')')});
    }
    const p=r.int(2,4), n=r.int(3,10), answer=1/(n+1)**p;
    return numeric('c10-alternating-bound',{p,n},
      'The first '+math(n)+' terms are used to approximate '+math('\\displaystyle\\sum_{j=1}^\\infty\\frac{(-1)^{j+1}}{j^{'+p+'}}')+'. Which is the standard alternating-series upper bound for the absolute error?',answer,
      [wrong(1/n**p,'This uses the last included term rather than the first omitted term.','alternating-next-term'),wrong(1/(n+1),'This ignores the given exponent in the term size.','alternating-power'),wrong(1/(n+1)**(p+1),'This increases the exponent when no such change is justified by the error theorem.','alternating-exponent')],
      ['The positive term sizes decrease to zero, so the alternating-series error theorem applies.','The bound uses the magnitude of the first term not included in the approximation.'],
      [step('Identify the first omitted index.','j='+n+'+1='+ (n+1)),step('Use its term magnitude.','|R_'+n+'|\\le '+fraction(1,(n+1)+'^{'+p+'}')+'='+numberText(answer))]);
  },
  'bc-taylor': (r,d) => {
    if(d===1) {const a=r.int(2,6), n=r.int(2,5), answer=a**n/factorial(n);
      return numeric('c10-exponential-coefficient',{a,n},
        'What is the coefficient of '+math('x^{'+n+'}')+' in the Maclaurin series for '+math('e^{'+a+'x}')+'?',answer,
        [wrong(a**n,'This omits the factorial in the exponential series coefficient.','taylor-factorial'),wrong(a/factorial(n),'This does not raise the inner coefficient to the power of the term.','taylor-chain-power'),wrong(a**n/factorial(n-1),'This uses the previous factorial rather than the requested term’s factorial.','taylor-factorial-index')],
        ['Start from the Maclaurin series for the exponential function.','Replace its argument by the given multiple of x, then collect the requested power.'],
        [step('Use the exponential series.','e^{'+a+'x}=\\sum_{j=0}^{\\infty}\\frac{('+a+'x)^j}{j!}'),step('Read the requested coefficient.',fraction(a+'^{'+n+'}',n+'!')+'='+numberText(answer))]);
    }
    if(d===2) {const c=r.int(1,7), v0=r.int(2,9), v1=r.int(2,7), v2=r.int(2,8), v3=r.int(2,9), h=r.int(1,4)/10, answer=v0+v1*h+v2*h*h/2+v3*h**3/6;
      return numeric('c10-taylor-table',{c,v0,v1,v2,v3,h},
        'At '+math('x='+c)+', '+math('f='+v0)+', '+math("f'="+v1)+', '+math("f''="+v2)+', and '+math("f'''="+v3)+'. What is the value of the degree-three Taylor polynomial centered at '+math(c)+' when evaluated at '+math(numberText(c+h))+'?',answer,
        [wrong(v0+v1*h+v2*h*h+v3*h**3,'This omits the factorial divisors on the quadratic and cubic terms.','taylor-factorials'),wrong(v0+v1*h+v2*h*h/2,'This stops at degree two and omits the cubic contribution.','taylor-degree'),wrong(v0+v1*h+v2*h*h/2+v3*h**3/3,'This divides the cubic term by three rather than three factorial.','cubic-factorial')],
        ['Use powers of the displacement from the center, not powers of the full evaluation input.','Divide each derivative coefficient by the factorial of its order.'],
        [step('Write the cubic Taylor expression.','P_3(c+h)=f(c)+f\\prime(c)h+\\frac{f\\prime\\prime(c)}{2}h^2+\\frac{f\\prime\\prime\\prime(c)}{6}h^3'),step('Substitute the derivative values and displacement.','P_3('+numberText(c+h)+')='+numberText(answer))],{representation:'derivative-data'});
    }
    const n=r.int(2,5), M=r.int(2,10), h=r.int(1,5)/10, answer=M*h**(n+1)/factorial(n+1);
    return numeric('c10-lagrange-bound',{n,M,h},
      'A function has '+math('|f^{('+(n+1)+')}(x)|\\le '+M)+' throughout '+math('[0,'+h+']')+'. Its degree-'+n+' Maclaurin polynomial is used at '+math('x='+h)+'. Which is the Lagrange upper bound for the absolute error?',answer,
      [wrong(M*h**n/factorial(n),'This uses the polynomial degree rather than the first omitted derivative order.','remainder-order'),wrong(M*h**(n+1)/factorial(n),'This raises the power but leaves the factorial at the previous order.','remainder-factorial'),wrong(M*h**(n+1),'This omits the factorial divisor altogether.','remainder-divisor')],
      ['The remainder bound uses the derivative one order beyond the polynomial degree.','Raise the distance from the center to that same next order and divide by its factorial.'],
      [step('Use the Lagrange remainder bound.','|R_n(x)|\\le \\frac{M|x|^{n+1}}{(n+1)!}'),step('Insert the derivative bound, displacement and order.','|R_'+n+'('+h+')|\\le '+fraction(M+'('+h+')^{'+(n+1)+'}',(n+1)+'!')+'='+numberText(answer))]);
  },
});

const ANSWER_UNITS = {
  'p1-velocity':'m/s','p1-velocity-area':'m','p1-projectile':'m',
  'p2-net-force':'m/s^2','p2-friction':'m/s^2','p2-circular':'N',
  'p3-work':'J','p3-spring-energy':'J','p3-energy-friction':'m^2/s^2',
  'p4-impulse':'kg\\,m/s','p4-sticking-collision':'m/s','p4-collision-loss':'J',
  'p5-torque':'N\\,m','p5-angular-acceleration':'rad/s^2','p5-pulley':'m/s^2',
  'p6-rotational-energy':'J','p6-angular-conservation':'rad/s','p6-rolling-energy':'m^2/s^2',
  'p7-frequency':'s^{-2}','p7-energy-position':'m^2/s^2','p8-pressure':'Pa','p8-bernoulli':'Pa',
  'c4-sphere-rate':'cm/s','c4-cone-rate':'cm/s','c9-vector-speed':'m/s',
};

Object.assign(BUILDERS,createSatBuilders({numeric,math,wrong,step,fraction,numberText}));
const helpers={numeric,math,wrong,step,numberText};
export function generateMixedQuestion({ topicId, difficulty=1, seed, templateId=null, focusTag=null, variantIndex=null, avoidVariantId=null } = {}) {
  const topic=TOPICS.get(topicId), builder=BUILDERS[topicId];
  if (!topic || !builder) throw new TypeError('Unknown generated-practice topic.');
  if (!Number.isInteger(difficulty) || difficulty<1 || difficulty>3) throw new TypeError('Difficulty must be 1, 2 or 3.');
  if ((typeof seed!=='string' && typeof seed!=='number') || !/^[a-zA-Z0-9_-]{1,128}$/.test(String(seed))) throw new TypeError('A bounded seed is required.');
  if (templateId!==null && (typeof templateId!=='string' || templateId.length>80)) throw new TypeError('Invalid template reference.');
  if (variantIndex!==null && ![0,1,2,3].includes(variantIndex)) throw new TypeError('Invalid variant index.');
  if (avoidVariantId!==null && (typeof avoidVariantId!=='string' || avoidVariantId.length>100)) throw new TypeError('Invalid variant reference.');
  if (focusTag!==null && (typeof focusTag!=='string' || focusTag.length>80)) throw new TypeError('Invalid misconception reference.');
  let level=topic.adaptiveDifficulty === false ? 1 : difficulty, chosenVariant=variantIndex;
  if (templateId || focusTag) {
    let matched=false;
    for(let candidate=1;candidate<=3 && !matched;candidate++) for(let v=0;v<4;v++) {
      const sample=(v%2 ? alternateApQuestion(topicId,randomFor(String(seed)+'-focus'),candidate,helpers):null)||builder(randomFor(String(seed)+'-focus'),candidate,v);
      if(templateId ? sample.templateId===templateId : sample.distractors.some(item=>item.tag===focusTag)) {level=candidate;chosenVariant=v;matched=true;break;}
    }
    if(!matched) throw new TypeError('The follow-up reference does not belong to this topic.');
  }
  const rng=randomFor(topicId+'-'+level+'-'+seed);
  for(let attempt=0;attempt<150;attempt++) {
    const variant=chosenVariant===null?rng.int(0,3):chosenVariant;
    const value=(variant%2?alternateApQuestion(topicId,rng,level,helpers):null)||builder(rng,level,variant);
    const variantId=value.variantId||value.templateId;
    if(avoidVariantId && variantId===avoidVariantId && attempt<100) continue;
    const options=[{value:value.answer,label:value.answerLabel,correct:true,reason:null,tag:null},...value.distractors.map(item=>({...item,correct:false}))];
    if(options.length!==4 || options.some(item=>typeof item.value==='number'&&!Number.isFinite(item.value))) continue;
    const unit=({'p1-infer-acceleration':'m/s^2','p3-spring-compression':'m'})[variantId]||ANSWER_UNITS[value.templateId];
    const labels=options.map(item=>item.label||math((typeof item.value==='number'?numberText(item.value):item.value)+(unit?'\\ \\mathrm{'+unit+'}':'')));
    if(new Set(labels).size!==4 || options.some((item,i)=>options.some((other,j)=>j<i && typeof item.value==='number' && typeof other.value==='number' && Math.abs(item.value-other.value)<=1e-8*Math.max(1,Math.abs(item.value),Math.abs(other.value))))) continue;
    options.forEach((item,index)=>{item.label=labels[index];});
    for(let index=3;index>0;index--) {const swap=rng.int(0,index);[options[index],options[swap]]=[options[swap],options[index]];}
    const digest=createHash('sha256').update(topicId+'|'+value.templateId+'|'+variantId+'|'+seed+'|'+attempt).digest('hex').slice(0,18);
    return {id:'mix-v'+MIXED_BANK_VERSION+'-'+topicId+'-'+digest,skillId:'mixed-'+topicId,topicId,topicTitle:topic.title,
      subject:topic.subject,unit:topic.unit,unitLabel:topic.unitLabel,difficulty:level,requestedDifficulty:difficulty,
      templateId:value.templateId,variantId,focusedTemplate:Boolean(templateId||focusTag),generatorVersion:MIXED_BANK_VERSION,source:'procedural',
      type:'mc',prompt:'<p>'+value.prompt+'</p>'+(typeof value.answer==='number'?'<p>Select the closest value. Decimal choices are rounded to eight significant digits.</p>':''),choices:options.map(item=>item.label),answerIndex:options.findIndex(item=>item.correct),
      misconceptions:options.map(item=>item.reason),misconceptionTags:options.map(item=>item.tag),
      hints:value.hints,solution:value.solution,representation:value.representation||'symbolic-context',calculatorPolicy:'allowed',
      parameters:value.parameters,numericAnswer:typeof value.answer==='number'?value.answer:null,visual:value.visual||null,difficultyBasis:value.difficultyBasis||'Locally authored practice levels; not official exam difficulty calibration.',
      choiceValues:options.map(item=>item.value),rounding:'Decimal choices use eight significant digits.',
    };
  }
  throw new Error('Could not produce four distinct choices for this topic.');
}
