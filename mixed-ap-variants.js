// Additional solved mathematical forms; shared keys stay server-owned.
export function alternateApQuestion(topicId,r,d,{numeric,math,wrong,step,numberText}) {
 const make=(templateId,variantId,p,prompt,answer,bad,rule,formula)=>numeric(templateId,p,prompt,answer,bad,
  [rule,'Keep the requested unknown separate from the given quantities.'],[step(rule),step('Substitute the given quantities.',formula)],{variantId});
 if(topicId==='physics-kinematics'&&d===1){
  const u=r.int(2,9),a=r.int(2,6),t=r.int(3,7),v=u+a*t;
  return make('p1-velocity','p1-infer-acceleration',{u,a,t,v},'A cart changes velocity from '+math(u)+' m/s to '+math(v)+' m/s in '+math(t)+' s at constant acceleration. What is its acceleration?',a,
   [wrong(v/t,'This divides final velocity by time without subtracting initial velocity.','initial-velocity'),wrong(v-u,'This finds velocity change without dividing by time.','elapsed-time'),wrong(-a,'This reverses the direction of the velocity change.','acceleration-sign')],
   'Acceleration is velocity change divided by elapsed time.','a=(v-u)/t=('+v+'-'+u+')/'+t+'='+a+'\\ \\mathrm{m/s^2}');
 }
 if(topicId==='physics-energy'&&d===2){
  const k=r.int(2,8)*100,x=r.int(2,7)/10,E=k*x*x/2;
  return make('p3-spring-energy','p3-spring-compression',{k,x,E},'An ideal spring with spring constant '+math(k)+' N/m stores '+math(E)+' J of elastic energy. What is the positive compression distance?',x,
   [wrong(x*x,'This gives the square of the compression without taking the square root.','spring-square-root'),wrong(x/Math.sqrt(2),'This omits the factor two when solving the energy equation.','spring-half'),wrong(2*x,'This doubles the compression after the square root.','spring-scale')],
   'Solve the spring-energy equation for the positive distance.','x=\\sqrt{2E/k}='+numberText(x)+'\\ \\mathrm m');
 }
 if(topicId==='bc-chain-rule'&&d===1){
  const a=r.int(2,5),b=r.int(1,5),c=r.int(1,3),n=r.int(2,3),inner=a*c*c+b,answer=n*inner**(n-1)*2*a*c;
  return make('c3-chain-factor','c3-quadratic-inner',{a,b,c,n},'Let '+math('f(x)=('+a+'x^2+'+b+')^{'+n+'}')+'. Find '+math("f'("+c+")")+'.',answer,
   [wrong(n*inner**(n-1),'This omits the derivative of the quadratic inner function.','chain-factor'),wrong(n*inner**(n-1)*a,'This treats the inner quadratic as a linear expression.','inner-power'),wrong(n*inner**n*2*a*c,'This does not lower the outer power.','outer-power')],
   'Differentiate the outer power and multiply by the derivative of the inner quadratic.',"f'(x)="+n+'('+a+'x^2+'+b+')^{'+(n-1)+'}('+2*a+'x),\\quad f\\prime('+c+')='+numberText(answer));
 }
 if(topicId==='bc-integration'&&d===2){
  const b=r.int(2,8),answer=b*b*Math.log(b)/2-b*b/4+1/4;
  return make('c6-integration-parts','c6-logarithmic-parts',{b},'Evaluate '+math('\\displaystyle\\int_1^{'+b+'}x\\ln(x)\\,dx')+'.',answer,
   [wrong(b*b*Math.log(b)/2,'This uses uv at the upper bound without the remaining integral or lower bound.','parts-remainder'),wrong(answer-1/4,'This omits the lower-end contribution.','lower-bound'),wrong(b*Math.log(b)-b+1,'This integrates ln(x) without the multiplying factor x.','integrand-factor')],
   'For integration by parts, take u = ln(x) and dv = x dx.','\\int x\\ln x\\,dx=\\frac{x^2\\ln x}{2}-\\frac{x^2}{4}+C;\\quad I='+numberText(answer));
 }
 if(topicId==='bc-differential-equations'&&d===2){
  const y0=r.int(3,9),k=r.int(1,4),h=r.int(1,2)/10,y1=y0*(1-k*h),answer=y1*(1-k*h);
  return make('c7-euler-two-steps','c7-euler-decay',{y0,k,h},'Use Euler’s method with two steps of size '+math(h)+' to approximate '+math('y('+numberText(2*h)+')')+' for '+math("y'=-"+k+'y')+' and '+math('y(0)='+y0)+'.',answer,
   [wrong(y0*(1+k*h)**2,'This uses growth rather than the given negative rate.','rate-sign'),wrong(y1,'This performs only one Euler step.','euler-step-count'),wrong(y0*(1-2*k*h),'This reuses the initial slope for both steps.','euler-update')],
   'At each step, compute the slope from the current approximate y value.','y_1='+numberText(y1)+',\\quad y_2=y_1+h(-'+k+'y_1)='+numberText(answer));
 }
 if(topicId==='bc-taylor'&&d===1){
  const a=r.int(2,5),n=2*r.int(1,3);let fact=1;for(let i=2;i<=n;i++)fact*=i;
  const sign=(-1)**(n/2),answer=sign*a**n/fact;
  return make('c10-exponential-coefficient','c10-cosine-coefficient',{a,n},'What is the coefficient of '+math('x^{'+n+'}')+' in the Maclaurin series for '+math('\\cos('+a+'x)')+'?',answer,
   [wrong(-answer,'This uses the opposite sign in the alternating cosine series.','series-sign'),wrong(sign*a**n,'This omits the factorial divisor.','taylor-factorial'),wrong(sign*a/fact,'This does not raise the inner coefficient to the requested power.','taylor-chain-power')],
   'Cosine has even powers with alternating signs, and each coefficient includes its factorial divisor.','\\cos(ax)=\\sum_{j=0}^{\\infty}\\frac{(-1)^j(ax)^{2j}}{(2j)!};\\quad c_'+n+'='+numberText(answer));
 }
 return null;
}
