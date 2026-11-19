// Shared school guidance is static content, separate from learner records.
import { unitsForSubject } from './courses.js';
import { guideMeta, guideSources, guideDeadlines, guideChecklist, filterGuideTopics } from './reedy-guide-data.js';

const categories = { all: 'All topics', career: 'Career Plan', enrollment: 'Enrollment', costs: 'Costs & payment', learning: 'Learning pathways', support: 'Support' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const formatDate = value => new Date(value + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${{
  search:'m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  book:'M3 4h5a4 4 0 0 1 4 4v13a4 4 0 0 0-4-2H3V4Zm18 0h-5a4 4 0 0 0-4 4v13a4 4 0 0 1 4-2h5V4Z',
  calendar:'M3 6h18v15H3V6ZM7 3v6M17 3v6M3 11h18',
  check:'M9 4H4v17h16V4h-5M9 2h6v5H9V2ZM8 13l3 3 5-6',
  leaf:'M4 20C3 8 9 3 21 3c0 12-5 18-17 17Zm0 0L15 9'
}[name] || ''}"/></svg>`;

export function mountReedyGuide(host, { manifest, initialSubject = 'calculus-ab', onStudyUnit, onOpenTool, preview = false } = {}) {
  let section = 'guidance', audience = 'all', category = 'all', query = '', cycle = 'fall-2027';
  let subject = initialSubject === 'calculus-bc' ? 'calculus-bc' : 'calculus-ab';
  let disposed = false;
  const checked = new Set();
  const sourceById = new Map(guideSources.map(source => [source.id, source]));
  host.classList.add('reedy-guide');

  function sources(ids) {
    const entries = (ids || []).map(id => sourceById.get(id)).filter(Boolean);
    return `<details class="rg-sources"><summary>Sources and scope</summary>${entries.map(s => `<div><strong>${esc(s.title)}</strong><span>${esc(s.kind)} · ${esc(s.date)}</span><p>${esc(s.scope)}</p>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Open official source<span class="rg-sr"> (opens a new tab)</span></a>` : '<span class="rg-source-note">School bulletin supplied for this guide; no public copy linked.</span>'}</div>`).join('')}</details>`;
  }
  function topicCard(t) {
    return `<details class="rg-topic" data-topic-id="${esc(t.id)}"><summary><span class="rg-topic-icon">${icon(t.category === 'career' ? 'check' : t.category === 'learning' ? 'book' : 'leaf')}</span><span><span class="rg-category">${esc(categories[t.category])}</span><strong>${esc(t.title)}</strong><span class="rg-summary">${esc(t.summary)}</span></span><span class="rg-plus" aria-hidden="true">+</span></summary><div class="rg-topic-body"><ol>${t.steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol><div class="rg-needed"><h3>Have this information ready</h3><ul>${t.needed.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div>${sources(t.sourceIds)}</div></details>`;
  }
  function guidanceResults() {
    const results = filterGuideTopics({ query, audience, category });
    return { count: results.length, html: results.length ? results.map(topicCard).join('') : '<div class="rg-empty"><h3>No matching guidance yet</h3><p>Try a shorter phrase or another category. Missing information remains a question for the school.</p><button class="rg-button secondary" type="button" data-rg-clear>Clear filters</button></div>' };
  }
  function updateResults() {
    const results = guidanceResults();
    host.querySelector('[data-rg-results]').innerHTML = results.html;
    host.querySelector('[data-rg-count]').textContent = `${results.count} topic${results.count === 1 ? '' : 's'}`;
  }
  function audienceControls() {
    return `<div class="rg-audiences" role="group" aria-label="Student enrollment experience">${[['all','Everyone'],['new','New to dual credit'],['returning','Returning students']].map(([value,label])=>`<button type="button" class="${audience===value?'selected':''}" data-rg-audience="${value}" aria-pressed="${audience===value}">${label}</button>`).join('')}</div>`;
  }
  function guidance() {
    const result=guidanceResults();
    return `<div class="rg-content-grid"><section aria-label="Search school guidance"><div class="rg-section-head"><div><span class="rg-kicker">A GOOD PLACE TO START</span><h2>Find the guidance you need.</h2></div><span class="rg-count" data-rg-count aria-live="polite">${result.count} topics</span></div><div class="rg-search"><label class="rg-sr" for="rg-search">Search Reedy guidance</label>${icon('search')}<input id="rg-search" type="search" placeholder="Try “Career Plan”, “permission”, or “payment”" value="${esc(query)}" autocomplete="off"></div><div class="rg-filters">${audienceControls()}<label class="rg-sr" for="rg-category">Topic category</label><select id="rg-category">${Object.entries(categories).map(([value,label])=>`<option value="${value}" ${category===value?'selected':''}>${label}</option>`).join('')}</select></div><div class="rg-results" data-rg-results>${result.html}</div></section><aside class="rg-aside"><section class="rg-deadline-card"><span class="rg-kicker">FALL 2027 PLANNING</span><div class="rg-large-date"><strong>18</strong><span>DECEMBER<br>2026</span></div><h2>Career Plan closes</h2><p>Review the 2027–28 plan in HAC before <strong>5 p.m. Central</strong>. Entries become next year’s course requests.</p><button type="button" class="rg-button secondary" data-rg-section="dates">View all dates</button><p class="rg-small">From the November 3 Reedy bulletin. Confirm any later updates with school.</p></section><section class="rg-mini-card"><span class="rg-mini-icon">${icon('check')}</span><h3>Know what to bring.</h3><p>A short review checklist for your next family or counselor conversation.</p><button type="button" class="rg-link-button" data-rg-section="checklist">Open the checklist</button></section><section class="rg-mini-card"><span class="rg-mini-icon purple">${icon('book')}</span><h3>Keep learning in reach.</h3><p>Explore DevCalc’s actual AB and BC unit library alongside the planning guide.</p><button type="button" class="rg-link-button" data-rg-section="learning">Explore learning</button></section></aside></div>`;
  }
  function dates() {
    const rows=guideDeadlines.filter(d=>d.cycle===cycle && (audience==='all'||d.audience==='all'||d.audience===audience));
    return `<div class="rg-section-head"><div><span class="rg-kicker">ONE TIMELINE, CLEAR CONTEXT</span><h2>Dates for the right school term.</h2><p>School deadlines and general college dates are kept separate. Student-specific completion must still be verified.</p></div></div><div class="rg-filters"><label for="rg-cycle">Planning cycle</label><select id="rg-cycle">${[['fall-2027','Fall 2027 enrollment'],['spring-2027','Spring 2027 billing'],['college-2027','College academic calendar']].map(([value,label])=>`<option value="${value}" ${cycle===value?'selected':''}>${label}</option>`).join('')}</select>${audienceControls()}</div>${cycle==='spring-2027'?'<div class="rg-note amber">The Spring payment notice is an earlier, separate enrollment cycle. Verify actual registration, charges and waivers in the student account before acting.</div>':''}${cycle==='college-2027'?'<div class="rg-note amber">These are general College dates. Check the actual registered section and session length before relying on them.</div>':''}<div class="rg-timeline">${rows.map(d=>`<article class="rg-date-row"><div class="rg-date-label">${esc(formatDate(d.date))}${d.endDate?`<span>through ${esc(formatDate(d.endDate))}</span>`:''}${d.time?`<strong>${esc(d.time)}</strong>`:''}</div><div><span class="rg-category">${d.audience==='new'?'New students':d.audience==='returning'?'Returning students':'Check applicability'}</span><h3>${esc(d.title)}</h3><p>${esc(d.detail)}</p>${sources(d.sourceIds)}</div></article>`).join('')}</div><p class="rg-note">Dates are a snapshot reviewed ${esc(formatDate(guideMeta.reviewedAt))}. This guide does not monitor school updates automatically.</p>`;
  }
  function learning() {
    const available=Array.isArray(manifest?.units);
    const units=available?unitsForSubject(manifest,subject):[];
    return `<div class="rg-learning-banner"><div><span class="rg-kicker">BUILT FROM YOUR DEVCALC PROJECT</span><h2>Connect planning with learning.</h2><p>Explore the existing curriculum before opening a unit. Independent study stays separate from school course requests and Canvas assignments.</p></div><span class="rg-learning-symbol" aria-hidden="true">∫</span></div><div class="rg-section-head"><div><h2>Explore the course library</h2><p>${available?`${units.length} units in this view. AB uses DevCalc’s existing content filters.`:'The curriculum catalog is unavailable. School guidance is still available.'}</p></div><div class="rg-audiences" role="group" aria-label="Calculus course view">${[['calculus-ab','AP Calculus AB'],['calculus-bc','AP Calculus BC']].map(([value,label])=>`<button type="button" data-rg-subject="${value}" class="${subject===value?'selected':''}" aria-pressed="${subject===value}">${label}</button>`).join('')}</div></div><div class="rg-unit-grid">${units.map(u=>`<article class="rg-unit"><span class="rg-category">${u.bcOnly?'BC extension':'AB + BC foundation'}</span><h3>${esc(u.title)}</h3><p>${esc(u.blurb)}</p><button type="button" class="rg-link-button" data-rg-unit="${esc(u.id)}">${preview?'Preview unit outline':'Open unit in DevCalc'}</button></article>`).join('')}</div><div class="rg-section-head rg-spaced"><div><h2>Your next learning step</h2><p>${preview?'The private preview shows shared guidance and real course outlines. Account-based tools remain in the full DevCalc app.':'These tools use your existing learning workspace. Opening the guide does not change your saved progress.'}</p></div></div><div class="rg-tool-grid">${[
      ['#/plans','Study plans','Choose a class or topic and build a plan you can review before saving.'],
      ['#/library','Practice & models','Use DevCalc’s lessons, original practice and interactive learning tools.'],
      ['#/focus','A focused study session','Choose a manageable goal and pace. The session does not submit schoolwork.'],
      ['#/canvas','Your Canvas coursework','Use your own existing connection in the full app. School data stays in your workspace.']
    ].map(([route,title,text])=>`<article class="rg-mini-card"><h3>${title}</h3><p>${text}</p><button type="button" class="rg-button secondary" data-rg-tool="${route}" ${preview?'disabled':''}>${preview?'In the full DevCalc app':'Open '+title.toLowerCase()}</button></article>`).join('')}</div>`;
  }
  function checklist() {
    return `<div class="rg-section-head"><div><span class="rg-kicker">FOR THE NEXT CONVERSATION</span><h2>Career Plan review checklist</h2><p>Review these items with the student. Marks are temporary in this view and do not update school or college records.</p></div><span class="rg-count" data-rg-progress>${checked.size} / ${guideChecklist.length} reviewed</span></div><div class="rg-checklist">${guideChecklist.map(c=>`<label class="rg-check"><input type="checkbox" data-rg-check="${esc(c.id)}" ${checked.has(c.id)?'checked':''}><span><strong>${esc(c.title)}</strong><span>${esc(c.needed)}</span></span></label>`).join('')}</div><div class="rg-note">Bring the exact course code, term, credit mapping, prerequisite evidence, student preference and backup choice. Separate a proposed course from family approval, counselor approval and confirmed registration.</div>`;
  }
  function sourceLibrary() {
    return `<div class="rg-section-head"><div><span class="rg-kicker">FOLLOW THE ORIGINAL GUIDANCE</span><h2>Sources, dates and limitations</h2><p>The school bulletins establish the Fall 2027 process. Official College pages add context. No student record is part of this shared guide.</p></div></div><div class="rg-source-grid">${guideSources.map(s=>`<article class="rg-mini-card"><span class="rg-category">${esc(s.kind)}</span><h3>${esc(s.title)}</h3><p class="rg-source-date">${esc(s.date)}</p><p>${esc(s.scope)}</p>${s.url?`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Open official source</a>`:'<p class="rg-small">School-wide bulletin supplied for the guide. A public copy was not linked; verify changes in current school communications.</p>'}</article>`).join('')}<article class="rg-mini-card"><span class="rg-category">Learning content</span><h3>DevCalc’s existing course library</h3><p>Unit titles, descriptions and AB/BC filtering come from the DevDashCalc project. This is curriculum content, does not establish enrollment or transferable credit.</p><a href="https://github.com/melodydashora/DevDashCalc" target="_blank" rel="noopener noreferrer">View the project</a></article></div>`;
  }
  const sections={guidance,dates,learning,checklist,sources:sourceLibrary};
  function render() {
    if(disposed)return;
    host.innerHTML=`<section class="rg-hero"><div><p class="rg-kicker">REEDY HIGH SCHOOL · COLLIN COLLEGE · DEVCALC</p><h1>A clearer path<br>from planning to learning.</h1><p>School guidance, next steps and learning tools.<br>Find what matters in one place.</p><div class="rg-hero-tags"><span>General family guide</span><span>Fall 2027</span></div></div><div class="rg-hero-art" aria-hidden="true"><svg viewBox="0 0 220 200" fill="none"><path d="M33 160V78a32 32 0 0 1 32-32h55a42 42 0 0 1 42 42v36a28 28 0 0 1-28 28H80" stroke="currentColor" stroke-width="2"/><path d="M70 187V98a23 23 0 0 1 23-23h88M120 23v35" stroke="currentColor" stroke-width="2"/><circle cx="33" cy="160" r="8" fill="#d8ebcc"/><circle cx="181" cy="75" r="8" fill="#c6b9e1"/><rect x="92" y="97" width="48" height="48" rx="12" fill="#f4faf5"/><path d="m103 120 9 8 17-19" stroke="#225c47" stroke-width="2"/><circle cx="113" cy="106" r="84" stroke="currentColor" opacity=".12"/></svg></div></section><div class="rg-context"><span>Independent guide · Not an official Reedy service</span><span>Reviewed ${esc(formatDate(guideMeta.reviewedAt))}</span></div><nav class="rg-tabs" aria-label="Reedy guide sections">${[['guidance','Find guidance'],['dates','Dates & deadlines'],['learning','Explore DevCalc'],['checklist','Review checklist'],['sources','Sources']].map(([value,label])=>`<button type="button" data-rg-section="${value}" class="${section===value?'active':''}" aria-current="${section===value?'page':'false'}">${label}</button>`).join('')}</nav><div class="rg-panel">${sections[section]()}</div><footer class="rg-footer"><strong>Keep the student’s choices open.</strong><p>This guide does not establish that anyone has selected dual-credit courses. No applications, course changes, signatures, payments or school messages are submitted here.</p></footer>`;
  }
  function click(event) {
    const button=event.target.closest('button');if(!button||!host.contains(button))return;
    if(button.dataset.rgSection && Object.hasOwn(sections,button.dataset.rgSection)){section=button.dataset.rgSection;render();host.querySelector(`[data-rg-section="${section}"]`)?.focus();}
    if(button.dataset.rgAudience){audience=['new','returning'].includes(button.dataset.rgAudience)?button.dataset.rgAudience:'all';render();host.querySelector(`[data-rg-audience="${audience}"]`)?.focus();}
    if(button.hasAttribute('data-rg-clear')){query='';category='all';audience='all';render();host.querySelector('#rg-search')?.focus();}
    if(button.dataset.rgSubject){subject=button.dataset.rgSubject==='calculus-bc'?'calculus-bc':'calculus-ab';render();host.querySelector(`[data-rg-subject="${subject}"]`)?.focus();}
    if(button.dataset.rgUnit && Array.isArray(manifest?.units)){
      const selected=unitsForSubject(manifest,subject).find(u=>u.id===button.dataset.rgUnit);
      if(selected)onStudyUnit?.({unitId:selected.id,subjectId:subject});
    }
    if(button.dataset.rgTool && !preview && ['#/plans','#/library','#/focus','#/canvas'].includes(button.dataset.rgTool))onOpenTool?.(button.dataset.rgTool);
  }
  function input(event){if(event.target.id==='rg-search'){query=event.target.value.slice(0,250);updateResults();}}
  function change(event){
    if(event.target.id==='rg-category'){category=Object.hasOwn(categories,event.target.value)?event.target.value:'all';updateResults();}
    if(event.target.id==='rg-cycle'){cycle=['fall-2027','spring-2027','college-2027'].includes(event.target.value)?event.target.value:'fall-2027';render();host.querySelector('#rg-cycle')?.focus();}
    if(event.target.dataset.rgCheck && guideChecklist.some(c=>c.id===event.target.dataset.rgCheck)){if(event.target.checked)checked.add(event.target.dataset.rgCheck);else checked.delete(event.target.dataset.rgCheck);host.querySelector('[data-rg-progress]').textContent=`${checked.size} / ${guideChecklist.length} reviewed`;}
  }
  host.addEventListener('click',click);host.addEventListener('input',input);host.addEventListener('change',change);render();
  return()=>{disposed=true;host.removeEventListener('click',click);host.removeEventListener('input',input);host.removeEventListener('change',change);host.replaceChildren();host.classList.remove('reedy-guide');};
}
