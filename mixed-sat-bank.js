// Original, independently checkable starter practice. Not released SAT items.
export const SAT_TOPICS = Object.freeze([
  ['sat-linear','Algebra','Linear equations, rates and systems.','Math'],
  ['sat-advanced-math','Advanced Math','Quadratic, exponential and nonlinear relationships.','Math'],
  ['sat-data','Problem-Solving and Data Analysis','Ratios, descriptive statistics and probability.','Math'],
  ['sat-geometry','Geometry and Trigonometry','Right triangles, circles and similarity.','Math'],
  ['sat-reading-evidence','Information and Ideas','Support an inference using only the supplied passage.','Reading and Writing'],
  ['sat-reading-structure','Craft and Structure','Interpret a word or the role of a sentence in context.','Reading and Writing'],
  ['sat-writing-expression','Expression of Ideas','Select a transition or a sentence that meets a stated goal.','Reading and Writing'],
  ['sat-writing-conventions','Standard English Conventions','Use sentence boundaries, agreement and punctuation.','Reading and Writing'],
].map(([id,title,description,domainGroup],index)=>Object.freeze({id,title,label:title,description,domainGroup,
  subject:'sat',unit:index+1,unitNumber:null,unitLabel:domainGroup,courseScopes:['sat'],adaptiveDifficulty:true,
  scope:'Original starter practice; not an official SAT test, full domain coverage or score estimate.'})));

export const ALGEBRA_TOPICS = Object.freeze([
  ['algebra-linear','Linear equations and systems','Solve equations, infer a rate or intercept, and connect systems to contexts.'],
  ['algebra-quadratics','Quadratics and functions','Connect roots, coefficients, vertices and function values.'],
  ['algebra-exponents','Exponents and growth','Use exponent rules, inverse powers and exponential models.'],
  ['algebra-data','Algebra with data','Use means, weighted relationships and probability models.'],
].map(([id,title,description],index)=>Object.freeze({id,title,label:title,description,subject:'algebra',unit:index+1,
  unitNumber:null,unitLabel:'Algebra',domainGroup:'Algebra',courseScopes:['algebra'],scope:'Original practice with locally authored levels.'})));

const READING = {
  'sat-reading-evidence': [
    {passage:'A town planted two equal-sized gardens. Both received the same amount of water. After six weeks, the shaded garden had fewer flowers than the sunny garden. The gardeners did not record soil conditions.',
      ask:'Which conclusion is best supported?',choices:['The gardens differed in flower production, but the observation alone does not identify the cause.','Shade always prevents flowering.','The sunny garden received more water.','Soil conditions were identical.'],key:0,
      why:'The passage reports a difference but leaves soil conditions unmeasured. It does not isolate a cause.'},
    {passage:'A library extended its evening hours in May. Evening visits increased, while morning visits remained about the same. The report gives no information about visits before the extension in other years.',
      ask:'Which statement is directly supported?',choices:['The extension caused every new visit.','All patrons prefer evenings.','More evening visits were recorded after the hours changed.','Morning visits decreased sharply.'],key:2,
      why:'The reported observation concerns evening visits after the change; it does not establish all causes or all patron preferences.'},
    {passage:'A researcher predicted that a coating would slow rust. After ten days in the same salt solution, coated samples had less rust than uncoated samples. Only one coating thickness was tested.',
      ask:'Which finding would most directly support the prediction in this test?',choices:['The coated samples developed less rust under the tested conditions.','The coating is effective at every thickness.','Salt has no effect on uncoated metal.','The coated samples can never rust.'],key:0,
      why:'The comparison supports slower rust under the tested conditions, not universal claims about thickness or permanence.'},
    {passage:'An ecologist counted birds at dawn and again at noon at one pond. The dawn count was higher on each of five days. The counts did not identify individual birds.',
      ask:'Which inference is most reasonable?',choices:['More birds were observed at dawn than at noon on those days.','Every bird left permanently before noon.','The pond supports more birds than every nearby pond.','Exactly the same birds appeared in each count.'],key:0,
      why:'Repeated counts support the observed time-of-day pattern, but do not identify individuals or compare other ponds.'},
  ],
  'sat-reading-structure': [
    {passage:'The engineer called the first design economical: it used fewer parts while meeting the same safety requirements.',
      ask:'As used in the passage, what does economical most nearly mean?',choices:['Careless','Efficient in its use of resources','Related to a national government','Difficult to understand'],key:1,
      why:'Fewer parts with the same requirements explains efficient resource use.'},
    {passage:'Earlier accounts described the expedition as a failure. Recently recovered notebooks, however, show that the team mapped three previously undocumented valleys.',
      ask:'What is the main function of the second sentence?',choices:['It repeats the earlier judgment without change.','It explains how notebooks are manufactured.','It presents evidence that qualifies the earlier judgment.','It proves that every earlier account was intentionally false.'],key:2,
      why:'The notebooks supply a concrete achievement that complicates the earlier blanket description of failure.'},
    {passage:'The critic described the performance as restrained. The actors used small gestures and quiet voices even during the final confrontation.',
      ask:'As used here, restrained most nearly means which choice?',choices:['Physically trapped','Deliberately controlled','Poorly rehearsed','Completely silent'],key:1,
      why:'Small gestures and quiet voices indicate deliberate control, not silence or physical restraint.'},
    {passage:'Some seeds remain dormant through a dry season. This pause allows germination to occur when water is more available.',
      ask:'What does the second sentence do?',choices:['It supplies a reason the pause may be useful.','It denies that seeds need water.','It introduces a conflicting experiment.','It lists every condition needed for germination.'],key:0,
      why:'The sentence explains a benefit of waiting: germination coincides with more available water.'},
  ],
  'sat-writing-expression': [
    {passage:'The new bus route shortened the trip to the hospital. _____ it required passengers traveling to the airport to make an additional transfer.',
      ask:'Which transition most logically completes the text?',choices:['Similarly,','For example,','However,','Therefore,'],key:2,
      why:'The second sentence contrasts a disadvantage with the first sentence’s benefit.'},
    {passage:'A student has these notes: The museum opened in 1985. It houses 120 local photographs. Its current exhibit compares photographs of the same streets taken decades apart.',
      ask:'The student wants to emphasize the current exhibit’s method of showing change. Which sentence best meets that goal?',choices:['The museum opened in 1985.','By placing photographs of the same streets from different decades together, the exhibit highlights change over time.','The museum houses photographs.','There are 120 local photographs in the museum.'],key:1,
      why:'Only that sentence connects the exhibit’s comparison method to the goal of showing change.'},
    {passage:'The field team replaced a damaged sensor. _____ measurements could resume that afternoon.',
      ask:'Which transition most logically completes the text?',choices:['As a result,','Nevertheless,','In contrast,','For instance,'],key:0,
      why:'Replacing the sensor enabled measurements to resume, so the second statement is a result.'},
    {passage:'A student has these notes: Artist Lina Chen makes sculptures from discarded metal. The objects retain scratches from earlier use. Chen says these marks preserve traces of an object’s history.',
      ask:'Which sentence best explains why Chen keeps the scratches?',choices:['Lina Chen is an artist who makes sculptures.','Discarded metal can be used for art.','Chen preserves scratches because they retain evidence of the material’s earlier use.','Metal objects can have different shapes.'],key:2,
      why:'The sentence states both the choice to retain scratches and the reason given in the notes.'},
  ],
  'sat-writing-conventions': [
    {passage:'The collection of handwritten letters _____ stored in a climate-controlled room.',
      ask:'Which choice completes the text with standard English subject–verb agreement?',choices:['are','were','is','have been'],key:2,
      why:'The singular subject is collection. The prepositional phrase of handwritten letters does not change its number.'},
    {passage:'The rain stopped _____ the match began ten minutes later.',
      ask:'Which choice completes the text using a correct sentence boundary?',choices:[',',';','because,','although,'],key:1,
      why:'Each side is an independent clause. A semicolon joins the two without creating a comma splice.'},
    {passage:'The guide explained that the three _____ nests were hidden in the reeds.',
      ask:'The nests belong to three birds. Which choice uses the correct possessive form?',choices:['birds','bird’s','birds’','birds’s'],key:2,
      why:'For the regular plural birds, an apostrophe after the s marks plural possession.'},
    {passage:'The instruments, including the newly repaired microscope, _____ ready for use.',
      ask:'Which choice completes the text with standard English subject–verb agreement?',choices:['is','was','are','has been'],key:2,
      why:'The plural subject instruments requires are. The intervening phrase does not change the subject’s number.'},
  ],
};

// Level 2 and 3 use different authored passages, not difficulty relabels of
// the starter passages. Levels describe local practice, not SAT calibration.
const READING_EXTENSIONS = {
  'sat-reading-evidence': [
    [
      {passage:'Two greenhouse groups received equal total amounts of water. One group received water daily and the other weekly. Daily watering produced steadier soil moisture and more flowers. The researchers proposed that steadier moisture caused the flowering difference.',
        ask:'Which additional fact would most weaken that explanation of this comparison?',choices:['The weekly group received its water on Mondays.','The two groups were grown from different seed varieties that are known to produce different numbers of flowers.','Both groups were kept at the same temperature.','Soil moisture was measured throughout the study.'],key:1,
        why:'Different varieties with known flowering differences supply an alternative cause that the comparison did not control.'},
      {passage:'A wooden beam in a house retains the outermost growth ring of the tree from which it was cut. That ring dates to 1846. A tree cannot be used as a beam before it is cut, but timber can be stored for years before use.',
        ask:'Which conclusion about the installation of this beam follows from the information?',choices:['It was installed exactly in 1846.','It was installed before 1846.','It could not have been installed before 1846, but its installation may have occurred later.','Its installation date cannot have any relationship to the tree rings.'],key:2,
        why:'The dated outer ring sets an earliest possible year for this timber; possible storage prevents an exact installation date.'},
    ],
    [
      {passage:'A lichen grows slowly where a particular fungus is common. Those sites also contain more nitrogen, which independently can slow the lichen. Researchers want evidence that the fungus itself can reduce growth, apart from nitrogen.',
        ask:'Which finding would most directly support that claim?',choices:['Fungus-rich sites have more nitrogen than fungus-poor sites.','The fungus and the lichen occur in several regions.','Lichen growth differs between regions with different temperatures.','At a fixed nitrogen level, randomly assigned lichen samples exposed to the fungus grow less than otherwise identical unexposed samples.'],key:3,
        why:'Holding nitrogen fixed and randomly assigning exposure isolates fungal exposure more directly than the observational comparisons do.'},
      {passage:'An archive receives letters from two districts. In Year 1 it receives 80 northern letters and 20 southern letters; in Year 2 it receives 20 northern and 80 southern letters. Within each district, the share discussing rail travel is unchanged: 10 percent in the north and 50 percent in the south. Across all letters, that share increases.',
        ask:'Which explanation is best supported?',choices:['The changing proportions of letters from the two districts can explain the overall increase without an increase within either district.','Rail travel became a more common topic within both districts.','The northern share must have exceeded 50 percent in Year 2.','The archive received more total letters in Year 2.'],key:0,
        why:'Both years contain 100 letters, but Year 2 weights the district with the higher unchanged rail-topic share more heavily.'},
    ],
  ],
  'sat-reading-structure': [
    [
      {passage:'Mara pictured the station as she remembered it: doors swinging, porters calling, a clock scarcely audible over the crowd. When she arrived, her own footsteps were the only sound.',
        ask:'What is the main function of the final sentence?',choices:['It confirms that the station is as busy as Mara remembers.','It contrasts the quiet present with the bustling scene Mara expected.','It explains why the station clock stopped working.','It establishes that Mara has never visited the station before.'],key:1,
        why:'The earlier details describe remembered bustle; the final sentence replaces that expectation with present quiet.'},
      {passage:'The committee offered qualified support for the proposal: it endorsed the overall aim but withheld approval of the funding plan until cost estimates could be checked.',
        ask:'As used here, qualified most nearly means which choice?',choices:['Expressed only by professionally licensed people','Unconditional','Limited by reservations','Too vague to identify any position'],key:2,
        why:'Support for the aim combined with withheld funding approval is support limited by a specific reservation.'},
    ],
    [
      {passage:'Text 1: A historian argues that a national standard for weights quickly displaced local measurement customs. Text 2: Surviving shop ledgers use national units for totals but continue to label individual goods with local unit names for decades after the standard was introduced.',
        ask:'How would the author of Text 2 most likely respond to the claim in Text 1?',choices:['National standards were never introduced.','Shopkeepers used only local units in every entry.','Ledger totals are unrelated to measurement practices.','Adoption of the standard could coexist with the continued use of local conventions.'],key:3,
        why:'The ledgers show national totals and continued local labels together, qualifying the claim of quick displacement.'},
      {passage:'The sculptor described the design as plastic, not because it used a synthetic material—the finished work was bronze—but because its form remained open to revision until the final casting.',
        ask:'As used here, plastic most nearly means which choice?',choices:['Capable of being reshaped or changed','Made from a petroleum-based substance','Cheaply produced in large quantities','Fixed permanently at the first sketch'],key:0,
        why:'The sentence explicitly rejects the material sense and defines the intended sense through openness to revision.'},
    ],
  ],
  'sat-writing-expression': [
    [
      {passage:'The first telescope survey detected several bright objects but missed most faint ones. _____ a later survey used longer exposures and detected many faint objects in the same region.',
        ask:'Which transition best emphasizes the contrast in the surveys’ results?',choices:['For instance,','By contrast,','In other words,','Similarly,'],key:1,
        why:'The requested relationship is a contrast between missing and detecting faint objects; the other transitions do not state that relationship.'},
      {passage:'A student has these notes: Sensor A measures temperature once per minute. Sensor B measures temperature once per second. Both use the same measurement scale. The researcher needs to record brief temperature fluctuations.',
        ask:'Which sentence best uses the notes to explain why Sensor B is better suited to the researcher’s stated need?',choices:['Both sensors use the same temperature scale.','Sensor A measures temperature once per minute.','By measuring once per second rather than once per minute, Sensor B can record shorter changes in temperature.','Sensor B measures temperature, and Sensor A also measures temperature.'],key:2,
        why:'The sentence connects the difference in sampling frequency directly to the need to capture brief fluctuations.'},
    ],
    [
      {passage:'The new insulation substantially reduced heat entering the chamber from its surroundings. _____ the cooling system still had to run continuously because the instruments inside released a large amount of heat.',
        ask:'Which transition best expresses the relationship between the improvement and the continuing need?',choices:['Consequently,','For example,','Similarly,','Even so,'],key:3,
        why:'The second sentence describes a need that persists despite the improvement, so a concessive transition fits.'},
      {passage:'A student has these notes: A survey found that frequent park visitors reported lower stress. The survey did not assign people to visit parks. Exercise habits and work schedules were not measured. The researchers recommended a controlled follow-up study.',
        ask:'The student wants to explain the limitation that motivates the follow-up recommendation. Which sentence best meets that goal?',choices:['Because the survey did not assign park visits or measure several possible influences, it cannot by itself establish that park visits caused the lower reported stress.','The survey proves that every park visit lowers stress.','The researchers surveyed people about parks and stress.','Frequent park visitors reported lower stress, so a controlled study would be unnecessary.'],key:0,
        why:'The sentence explains why the observational association leaves alternative explanations unresolved and motivates a controlled study.'},
    ],
  ],
  'sat-writing-conventions': [
    [
      {passage:'To measure changes in river height accurately, _____.',
        ask:'Which completion makes the introductory modifier refer logically to the subject that follows it?',choices:['the calibration of each gauge was completed before installation','the researchers calibrated each gauge before installation','each gauge’s installation followed its calibration','accurate river records depended on calibrated gauges'],key:1,
        why:'The researchers are the people who intend to measure the changes. The other subjects are not the intended agents of the introductory action.'},
      {passage:'The model predicted a rapid decline in temperature _____ the measurements showed a gradual decline.',
        ask:'Which choice correctly joins the two independent clauses and punctuates the contrast word?',choices:[', however,',' however;','; however,','; however;'],key:2,
        why:'A semicolon can join these independent clauses, and a comma follows the conjunctive adverb however.'},
    ],
    [
      {passage:'Each of the proposals, including the two submitted by the regional offices, _____ a separate budget and a detailed timetable.',
        ask:'Which choice supplies a verb that agrees with the sentence’s grammatical subject?',choices:['have','are containing','were given','has'],key:3,
        why:'The grammatical subject Each is singular. Neither the plural objects in intervening phrases nor the compound object changes its number.'},
      {passage:'The laboratory has improved _____ imaging capacity by acquiring a new microscope; the researchers say _____ especially useful for examining thin samples.',
        ask:'Which choice completes the first blank with a possessive pronoun and the second with a contraction meaning it is?',choices:['its / it’s','it’s / its','its / its','it’s / it’s'],key:0,
        why:'Its is the possessive form; it’s is the contraction of it is. The requested grammatical roles determine the two forms.'},
    ],
  ],
};
export function createSatBuilders({numeric,math,wrong,step}) {
  const builders = {};
  const make = (id,p,prompt,answer,values,rule,solution,extra={}) => numeric(id,p,prompt,answer,
    values.map((v,i)=>wrong(v,['This changes the required operation.','This uses only part of the given relationship.','This does not satisfy all the givens.'][i],'sat-'+id+'-'+i)),
    [rule,'Write the relationship before substituting the given quantities.'],[step(rule),step(solution)],extra);
  builders['sat-linear']=(r,d,variant=0)=>{
    const a=r.int(2,7),x=r.int(2,9),b=r.int(3,12),c=a*x+b;
    if(d===1 && variant%2===0)return make('sat-algebra-equation',{a,x,b,c},'Solve '+math(a+'x+'+b+'='+c)+'.',x,[c-b,c/a,(c+b)/a],'Subtract the constant, then divide by the coefficient.','x=('+c+'-'+b+')/'+a+'='+x);
    if(d===1)return make('sat-algebra-context',{a,x,b,c},'A club charges a '+math(b)+' dollar setup fee and '+math(a)+' dollars per visit. A member paid '+math(c)+' dollars total. How many visits did the member make?',x,[c-b,c/a,(c+b)/a],'Separate the fixed fee from the per-visit cost.','The visit cost is '+(c-b)+' dollars; dividing by '+a+' gives '+x+' visits.');
    if(d===2){const x1=r.int(1,4),dx=r.int(2,5),y1=r.int(1,8),y2=y1+a*dx;return make(variant%2?'sat-algebra-rate-table':'sat-algebra-slope',{a,x1,dx,y1,y2},(variant%2?'A linear relationship has the table values ':'A line passes through ')+math('('+x1+','+y1+')')+' and '+math('('+(x1+dx)+','+y2+')')+'. What is its slope?',a,[a*dx,dx/(y2-y1),y2/(x1+dx)],'Slope is change in output divided by change in input.','The output changes by '+(a*dx)+' and the input by '+dx+'.',{representation:'coordinate-data',visual:{type:'linear-graph',points:[{x:x1,y:y1},{x:x1+dx,y:y2}],xLabel:'x',yLabel:'y'}});}
    const y=r.int(1,6),sum=x+y,total=a*x+(a+2)*y;
    return make(variant%2?'sat-algebra-system-context':'sat-algebra-system',{a,x,y,sum,total},
      variant%2?'There are '+sum+' tickets. Student tickets cost '+a+' dollars and adult tickets cost '+(a+2)+' dollars. Total sales are '+total+' dollars. How many adult tickets were sold?':
      'The system '+math('x+y='+sum)+' and '+math(a+'x+'+(a+2)+'y='+total)+' holds. What is '+math('y')+'?',y,[x,sum,(total-a)/2],'Use the total count equation to eliminate one variable.','Subtract '+a+' times the count equation: 2y='+(2*y)+', so y='+y+'.');
  };
  builders['sat-advanced-math']=(r,d,variant=0)=>{
    const a=r.int(2,5),b=r.int(6,9);
    if(d===1)return make(variant%2?'sat-quadratic-factor':'sat-quadratic-zero',{a,b},variant%2?'One factor of '+math('x^2-'+(a+b)+'x+'+a*b)+' is '+math('(x-'+a+')')+'. What number '+math('k')+' makes the other factor '+math('(x-k)')+'?':'The quadratic '+math('(x-'+a+')(x-'+b+')=0')+' has two solutions. What is the greater solution?',b,[a,a+b,a*b],'A product is zero when at least one factor is zero.','The factors give roots '+a+' and '+b+'.');
    if(d===2){const h=r.int(2,8),k=r.int(1,7);return make(variant%2?'sat-quadratic-minimum':'sat-quadratic-vertex',{h,k},variant%2?'What is the minimum value of '+math('(x-'+h+')^2+'+k)+'?':'The graph '+math('y=(x-'+h+')^2+'+k)+' has a vertex. What is the vertex’s y-coordinate?',k,[-k,h,h*h+k],'A square is nonnegative and is zero at the vertex.','At x='+h+', the square is zero and y='+k+'.');}
    const start=r.int(2,8),factor=r.int(2,4),t=r.int(2,3),answer=start*factor**t;
    return make(variant%2?'sat-exponential-growth':'sat-exponential-value',{start,factor,t},variant%2?'A culture starts with '+start+' units and multiplies by '+factor+' each hour. Under this model, how many units are present after '+t+' hours?':'For '+math('f(t)='+start+'('+factor+')^t')+', find '+math('f('+t+')')+'.',answer,[start*factor*t,start+factor*t,start*factor**(t-1)],'Repeated multiplication is modeled by an exponent.','Multiply the initial value by the growth factor raised to '+t+'.');
  };
  builders['sat-data']=(r,d,variant=0)=>{
    const a=r.int(2,8),gap=r.int(1,5),values=[a,a+gap,a+2*gap];
    if(d===1)return make(variant%2?'sat-data-total-from-mean':'sat-data-mean',{a,gap,values},
      variant%2?'Three measurements have mean '+(a+gap)+'. What is their total?':'What is the arithmetic mean of '+values.join(', ')+'?',
      variant%2?3*(a+gap):a+gap,variant%2?[a+gap,3*a,3*gap]:[3*(a+gap),a,a+2*gap],
      'The mean equals the sum divided by the number of values.','Use sum = count × mean.',{visual:variant%2?undefined:{type:'bar-data',values,labels:['A','B','C']}});
    if(d===2){const n=r.int(2,5),m=r.int(6,9),p=r.int(2,5),q=p+2;const answer=(n*p+m*q)/(n+m);return make(variant%2?'sat-data-mixture-mean':'sat-data-weighted-mean',{n,m,p,q},'A group of '+n+' values has mean '+p+'. Another group of '+m+' values has mean '+q+'. What is the mean of all '+(n+m)+' values?',answer,[(p+q)/2,n*p+m*q,(n*q+m*p)/(n+m)],'Combine the two sums, then divide by the combined count.','The combined sum is '+(n*p+m*q)+' and the combined count is '+(n+m)+'.');}
    const red=r.int(2,6),blue=r.int(7,12),answer=red/(red+blue);return make(variant%2?'sat-data-probability-complement':'sat-data-probability',{red,blue},
      variant%2?'A bag contains '+red+' red and '+blue+' blue counters. A counter is selected at random. What is the probability it is not blue?':'A bag contains '+red+' red and '+blue+' blue counters. A counter is selected at random. What is the probability it is red?',answer,[blue/(red+blue),red/blue,1/red],'Divide the favorable count by the total number of equally likely counters.','There are '+red+' favorable counters out of '+(red+blue)+'.');
  };
  builders['sat-geometry']=(r,d,variant=0)=>{
    const k=r.int(2,8);
    if(d===1)return make(variant%2?'sat-triangle-missing-leg':'sat-triangle-hypotenuse',{k},
      variant%2?'A right triangle has hypotenuse '+5*k+' and one leg '+3*k+'. What is the other leg?':'A right triangle has legs '+3*k+' and '+4*k+'. What is its hypotenuse?',
      variant%2?4*k:5*k,variant%2?[2*k,5*k,8*k]:[7*k,k,25*k*k],'The squares of the two legs sum to the square of the hypotenuse.','Use the Pythagorean relationship.',variant%2?{}:{visual:{type:'right-triangle',legs:[3*k,4*k]}});
    if(d===2)return make(variant%2?'sat-circle-radius':'sat-circle-area',{k},
      variant%2?'A circle has area '+math(k*k+'\\pi')+'. What is its radius?':'A circle has radius '+k+'. Its area is '+math('A\\pi')+'. What is '+math('A')+'?',
      variant%2?k:k*k,variant%2?[k*k,2*k,k/2]:[2*k,k,4*k*k],'A circle’s area is pi multiplied by the radius squared.','Use A = pi r squared and solve for the requested quantity.');
    const scale=r.int(2,5),side=r.int(2,9);return make(variant%2?'sat-similar-area':'sat-similar-side',{scale,side},
      variant%2?'Two similar figures have corresponding side lengths in the ratio '+scale+':1. What is the ratio of their areas?':'A triangle is enlarged by scale factor '+scale+'. A side originally measures '+side+'. What is the corresponding enlarged side length?',
      variant%2?scale*scale:scale*side,variant%2?[scale,2*scale,1/scale]:[scale+side,side/scale,scale*scale*side],
      variant%2?'Area scales by the square of the length scale factor.':'Corresponding lengths scale by the length scale factor.',
      variant%2?'Square the scale factor '+scale+'.':'Multiply '+side+' by '+scale+'.');
  };
  for(const [topic,starters] of Object.entries(READING))builders[topic]=(r,d,variant=0)=>{
    const items=d===1?starters:READING_EXTENSIONS[topic][d-2];
    const slot=variant%items.length,index=d===1?slot:4+2*(d-2)+slot,item=items[slot];
    return numeric(topic+'-level-'+d+'-passage-'+index,{passageIndex:index},item.passage+'</p><p>'+item.ask,String(item.key),
      item.choices.map((label,i)=>i===item.key?null:wrong(String(i),'This choice is not supported by the stated passage or requested editing goal. '+item.why,topic+'-reason-'+i,label)).filter(Boolean),
      ['Read the passage and the exact question together.','Compare every choice with the evidence or grammar relationship actually stated.'],
      [step('Identify the question’s evidence or editing target.'),step(item.why)],{answerLabel:item.choices[item.key],representation:'short-passage',difficultyBasis:'Locally authored passage level. Each level uses different passages; these levels are not official SAT difficulty calibration.'});
  };
  builders['algebra-linear']=(r,d,v=0)=>{
    if(v%2===0)return builders['sat-linear'](r,d,0);
    const a=r.int(2,6),b=r.int(1,7),x=r.int(2,8);
    if(d===1){const c=r.int(1,a-1),right=(a-c)*x+b;return make('algebra-both-sides',{a,b,c,x,right},'Solve '+math(a+'x+'+b+'='+c+'x+'+right)+'.',x,[right/(a-c),(right+b)/(a-c),right-b],'Collect variable terms on one side and constants on the other.','Subtract '+c+'x and '+b+' from both sides, then divide by '+(a-c)+'.');}
    if(d===2){const y=a*x+b;return make('algebra-intercept',{a,b,x,y},'The line '+math('y='+a+'x+b')+' passes through '+math('('+x+','+y+')')+'. What is '+math('b')+'?',b,[y+a*x,y/a,y-x],'Substitute the known point into the equation.','b = '+y+' - '+a+'('+x+') = '+b+'.');}
    const y=r.int(2,8),sum=x+y,difference=x-y;
    return make('algebra-system-sum-difference',{x,y,sum,difference},'If '+math('x+y='+sum)+' and '+math('x-y='+difference)+', what is '+math('x')+'?',x,[sum,difference,sum+difference],'Adding the equations eliminates y.','The sum gives 2x = '+(sum+difference)+', so x = '+x+'.');
  };
  builders['algebra-quadratics']=(r,d,v=0)=>{
    const a=r.int(2,5),b=r.int(6,9);
    if(d===1)return make(v%2?'algebra-root-sum':'algebra-root-product',{a,b},'The roots of '+math('(x-'+a+')(x-'+b+')=0')+' are '+math('r')+' and '+math('s')+'. What is '+math(v%2?'r+s':'rs')+'?',v%2?a+b:a*b,[v%2?a*b:a+b,b-a,-(v%2?a+b:a*b)],'Set each factor equal to zero to identify the roots.','The roots are '+a+' and '+b+'; '+(v%2?'add':'multiply')+' them.');
    if(d===2){const h=r.int(2,8),k=r.int(1,7);return make(v%2?'algebra-vertex-x':'algebra-vertex-y',{h,k},'The graph '+math('y=(x-'+h+')^2+'+k)+' has a vertex. What is its '+(v%2?'x':'y')+'-coordinate?',v%2?h:k,[-(v%2?h:k),h+k,h*h+k],'The square is smallest when x equals '+h+'.','The vertex is ('+h+', '+k+').');}
    const x=r.int(2,7);return make(v%2?'algebra-quadratic-value':'algebra-quadratic-linear-coefficient',{a,b,x},v%2?'For '+math('f(x)=(x+'+a+')(x+'+b+')')+', find '+math('f('+x+')')+'.':'Expand '+math('(x+'+a+')(x+'+b+')')+'. What is the coefficient of '+math('x')+'?',v%2?(x+a)*(x+b):a+b,v%2?[x*x+a*b,(x+a)*b,x+a+b]:[a*b,b-a,-a-b],'Multiply each term in the first factor by each term in the second.','The expansion is x squared + '+(a+b)+'x + '+a*b+'.');
  };
  builders['algebra-exponents']=(r,d,v=0)=>{
    const a=r.int(2,5),m=r.int(2,5),n=r.int(1,m-1);
    if(d===1)return make(v%2?'algebra-exponent-quotient':'algebra-exponent-product',{a,m,n},'For '+math('x\\ne 0')+', write '+math(v%2?'x^{'+m+'}/x^{'+n+'}':'x^{'+m+'}x^{'+n+'}')+' as '+math('x^k')+'. What is '+math('k')+'?',v%2?m-n:m+n,[m*n,v%2?m+n:m-n,m/n],'For equal bases, add exponents when multiplying and subtract when dividing.','The exponent is '+m+(v%2?' - ':' + ')+n+'.');
    if(d===2)return make(v%2?'algebra-negative-power':'algebra-power-of-power',{a,m,n},v%2?'Evaluate '+math(a+'^{-'+n+'}')+'.':'Write '+math('(x^{'+m+'})^{'+n+'}')+' as '+math('x^k')+'. What is '+math('k')+'?',v%2?a**(-n):m*n,v%2?[-(a**n),a**n,-a*n]:[m+n,m-n,m**n],'A negative exponent takes the reciprocal. A power of a power multiplies the exponents.','Apply the corresponding exponent rule.');
    const initial=r.int(2,7),factor=r.int(2,4),time=r.int(2,4),amount=initial*factor**time;
    return make(v%2?'algebra-growth-time':'algebra-growth-output',{initial,factor,time,amount},v%2?'The model '+math('P(t)='+initial+'('+factor+')^t')+' gives '+math('P(t)='+amount)+'. What is '+math('t')+'?':'For '+math('P(t)='+initial+'('+factor+')^t')+', find '+math('P('+time+')')+'.',v%2?time:amount,v%2?[time+1,time-1,amount/initial]:[initial*factor*time,initial+factor*time,initial*factor**(time-1)],'Divide by the initial value to isolate the exponential factor when solving for time.','The factor '+factor+' multiplied by itself '+time+' times is '+factor**time+'.');
  };
  builders['algebra-data']=(r,d,v=0)=>builders['sat-data'](r,d,v);
  return builders;
}
