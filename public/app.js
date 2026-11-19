import {buildStatementTrace,recordedAgentRuns} from './trace.js?v=relation-trace-1';
const $=id=>document.getElementById(id);
const icon=name=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('icon');svg.setAttribute('aria-hidden','true');const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#i-'+name);svg.append(use);return svg;};
function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function readStore(key){try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value:[];}catch{return [];}}
function writeStore(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{toast('Browser storage is full or unavailable.');return false;}}
let saved=readStore('agentreview.saved.v1').filter(r=>r&&typeof r.query==='string'&&Array.isArray(r.papers)&&Array.isArray(r.insights)),history=readStore('agentreview.history.v1').filter(x=>x&&typeof x.query==='string'),current=null,controller=null,toastTimer;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3200);}
function closeMenu(){$('sidebar').classList.remove('open');$('menu-button').setAttribute('aria-expanded','false');}
function showView(view){$('research-view').hidden=view!=='research';$('saved-view').hidden=view!=='saved';$('nav-research').classList.toggle('active',view==='research');$('nav-saved').classList.toggle('active',view==='saved');$('page-label').textContent=view==='saved'?'Saved summaries':current?'Research brief':'New research';if(view==='saved')renderSaved();closeMenu();}
function renderHistory(){const host=$('history');host.replaceChildren();if(!history.length){host.append(node('p','muted small','Your questions will appear here.'));return;}history.slice(0,8).forEach(item=>{const b=node('button','history-button');b.append(icon('clock'),node('span','',item.query));b.title=item.query;b.onclick=()=>{showView('research');$('query').value=item.query;updateQuery();$('query').focus();};host.append(b);});}
function saveHistory(query,source){history=[{query,source},...history.filter(x=>x.query!==query||x.source!==source)].slice(0,8);writeStore('agentreview.history.v1',history);renderHistory();}
const providers={arxiv:{name:'arXiv',hint:'Research preprints · peer-review status varies',url:'https://arxiv.org'},pubmed:{name:'PubMed',hint:'Biomedical & life sciences · NCBI',url:'https://pubmed.ncbi.nlm.nih.gov'},europepmc:{name:'Europe PMC',hint:'Biomedical & life sciences',url:'https://europepmc.org'},semantic:{name:'Semantic Scholar',hint:'Multidisciplinary · provider rate limits apply',url:'https://www.semanticscholar.org'}};
function updateQuery(){$('char-count').textContent=$('query').value.length+' / 500';const source=$('source').value,p=providers[source]||providers.arxiv;$('source-hint').textContent=p.hint;$('period-label').textContent=source==='arxiv'?'Submitted':'Published';$('provider-link').textContent='Literature from '+p.name+' ↗';$('provider-link').href=p.url;$('arxiv-credit').hidden=source!=='arxiv';}

function setBusy(busy){document.body.classList.toggle('busy',busy);$('submit').disabled=busy;$('cancel-search').hidden=!busy;$('loading').hidden=!busy;$('query').disabled=busy;for(const id of ['source','years','limit','detailed','run-mode'])$(id).disabled=busy;document.querySelectorAll('[data-query]').forEach(b=>b.disabled=busy);$('submit').replaceChildren(document.createTextNode(busy?'Searching…':'Explore literature'),icon('arrow'));}
function selectTab(name){for(const key of ['summary','sources','evidence','process']){const active=key===name;$('tab-'+key).classList.toggle('active',active);$('tab-'+key).setAttribute('aria-selected',String(active));$('tab-'+key).tabIndex=active?0:-1;$('panel-'+key).hidden=!active;}}
function safeUrl(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)?u.href:null;}catch{return null;}}
function externalLink(label,url,cls){const a=node('a',cls,label);const safe=safeUrl(url);if(safe){a.href=safe;a.target='_blank';a.rel='noopener noreferrer';}return a;}
function sourceJump(number){selectTab('sources');const card=$('paper-'+number);if(card){card.scrollIntoView({behavior:'smooth',block:'start'});card.classList.add('highlight');setTimeout(()=>card.classList.remove('highlight'),2000);}}
function renderReport(report){current=report;if(!report.multiagent)$('multiagent-results').hidden=true;$('searcher-results').hidden=true;$('hero').querySelector('h1').textContent='A clearer picture, connected.';document.body.classList.add('has-results');$('intro').hidden=true;$('results').hidden=false;$('error').hidden=true;$('evaluation-error').hidden=true;$('result-title').textContent=report.query;$('result-meta').textContent=report.database+' · '+report.scope+' · '+report.papers.length+' papers retrieved';$('source-count').textContent=report.papers.length;$('stat-papers').textContent=report.checks.sources;$('stat-abstracts').textContent=report.checks.withAbstract;$('stat-excerpts').textContent=report.insights.length;
 const integrated=report.mode==='synthesized'&&report.review?.paragraphs?.length;
 $('summary-kind').textContent=integrated?'CROSS-PAPER SYNTHESIS':'ABSTRACT EXCERPTS';
 $('summary-heading').textContent=integrated?'Integrated literature summary':'Available source excerpts';
 $('stat-unit-label').textContent=integrated?'Claim groups':'Linked excerpts';
 $('summary-disclosure').textContent=integrated?'Exact quotations and citation mappings were checked. Scientific support and study conditions still require verification against the complete papers.':'These are selected excerpts, not an integrated model synthesis. A workshop model connection is required to combine differently worded claims.';
 $('summary-context').textContent=integrated?'Shared claims are presented once with joint citations. Contradictory findings and study conditions remain distinct.':report.synthesis?.message||(report.papers.length?'Selected passages from available abstracts.':'No matching papers were found. Try fewer keywords or a wider date range.');
 if(report.reading?.note)$('summary-context').textContent+=' Reader scope: '+report.reading.note;
 const insights=$('insights');insights.replaceChildren();
 if(integrated){let statementIndex=0;const traceButton=node('button','outline-button summary-trace-link','Relations & trace');traceButton.type='button';traceButton.onclick=()=>openStatementTrace(0);insights.append(traceButton);for(const paragraph of report.review.paragraphs){const p=node('p','review-paragraph');for(const sentence of paragraph.sentences){const span=node('span','review-sentence',sentence.text+' ');p.append(span);for(const number of sentence.sourceNumbers){const cite=node('button','citation inline-citation','['+number+']');cite.title='View source '+number;cite.onclick=()=>sourceJump(number);p.append(cite);}const traceIndex=statementIndex++,trace=node('button','inline-trace-link','Trace');trace.type='button';trace.setAttribute('aria-label','Inspect relation and source trace for statement '+(traceIndex+1));trace.onclick=()=>openStatementTrace(traceIndex);p.append(trace,document.createTextNode(' '));}insights.append(p);}}
 else report.insights.forEach((insight,i)=>{const section=node('section','insight'),head=node('div','insight-head');head.append(node('span','','EXCERPT '+String(i+1).padStart(2,'0')));const cite=node('button','citation','['+insight.sourceNumber+']');cite.onclick=()=>sourceJump(insight.sourceNumber);head.append(cite);section.append(head,node('blockquote','',insight.text));insights.append(section);});
 const audit=$('reasoner-audit');audit.replaceChildren();audit.hidden=!report.reasoning;
 if(report.reasoning){audit.append(node('h3','','Claim integration and reasoning'),node('p','panel-intro',report.reasoning.implementation));for(const result of report.reasoning.output.results){const claim=report.claims.find(c=>c.id===result.cluster),row=node('div','reasoner-row');row.append(node('strong','',claim?.claim||String(result.cluster)),node('p','',result.relation+' / '+result.action+' · '+(claim?.sourceNumbers||[]).map(n=>'['+n+']').join(' ')));if(claim?.conditions)row.append(node('p','',claim.conditions));audit.append(row);}const details=node('details','reasoner-details');details.append(node('summary','','Inspect reasoner input and output'),node('pre','',JSON.stringify(report.reasoning,null,2)));audit.append(details);}

 const sources=$('sources-list');sources.replaceChildren();report.papers.forEach(p=>{const article=node('article','source-card');article.id='paper-'+p.number;if(p.document){const coverage=node('p','document-coverage',(p.document.mode==='abstract_only'?'ABSTRACT ONLY':'BOUNDED FULL TEXT')+' · '+(p.document.passageCount||0)+' parsed passages');article.append(coverage);}const top=node('div','source-card-top');top.append(node('span','source-number',String(p.number).padStart(2,'0')),node('span','',(p.year||'Year unavailable')+' · '+p.source));const title=node('h3');title.append(externalLink(p.title,p.url));const foot=node('div','source-footer'),link=externalLink('Open paper',p.url);link.append(icon('link'));foot.append(link);if(p.doi){const doi=externalLink('DOI', 'https://doi.org/'+encodeURIComponent(p.doi));doi.append(icon('link'));foot.append(doi);}article.append(top,title,node('p','authors',[p.authors,p.journal].filter(Boolean).join(' · ')),foot);if(p.abstract){const details=node('details');details.append(node('summary','','Read abstract'),node('p','',p.abstract));article.append(details);}else article.append(node('p','authors','Abstract unavailable from this provider.'));sources.append(article);});
 if(!report.papers.length)sources.append(node('p','panel-intro','No papers found. Refine your query above.'));
 const process=$('process-list');process.replaceChildren();report.steps.forEach(step=>{const li=node('li');li.append(node('strong','',step.name),node('p','',step.detail));process.append(li);});
 renderEvidence(report);updateSaveButton();selectTab('summary');showView('research');
}
function isSaved(){return current&&saved.some(r=>r.query===current.query&&r.createdAt===current.createdAt);}
function updateSaveButton(){$('save-result').replaceChildren(icon('save'),document.createTextNode(isSaved()?'Saved':'Save'));$('saved-count').textContent=saved.length;}
function toggleSave(){if(!current)return;const next=isSaved()?saved.filter(r=>r.createdAt!==current.createdAt||r.query!==current.query):[current,...saved].slice(0,12);if(writeStore('agentreview.saved.v1',next)){saved=next;updateSaveButton();toast(isSaved()?'Summary saved in this browser.':'Summary removed from saved briefs.');}}
function renderSaved(){const host=$('saved-list');host.replaceChildren();$('saved-count').textContent=saved.length;if(!saved.length){const empty=node('div','saved-empty');const button=node('button','primary-button','Start a new research brief');button.onclick=newResearch;empty.append(icon('save'),node('h2','','Your reading list starts here'),node('p','','Save a summary after searching to return to it later.'),button);host.append(empty);return;}saved.forEach((report,index)=>{const card=node('article','saved-card'),main=node('button','saved-card-main');main.append(node('h2','',report.query),node('p','',report.database+' · '+report.papers.length+' papers · '+new Date(report.createdAt).toLocaleDateString()));main.onclick=()=>{$('query').value=report.query;updateQuery();renderReport(report);window.scrollTo({top:0,behavior:'smooth'});};const remove=node('button','icon-button');remove.setAttribute('aria-label','Remove saved summary: '+report.query);remove.append(icon('close'));remove.onclick=()=>{const next=saved.filter((_,i)=>i!==index);if(writeStore('agentreview.saved.v1',next)){saved=next;renderSaved();updateSaveButton();toast('Removed from saved summaries.');}};card.append(main,remove);host.append(card);});}
function baseReportMarkdown(report){const integrated=report.mode==='synthesized'&&report.review;const prose=integrated?report.review.paragraphs.map(p=>p.sentences.map(s=>s.text+' '+s.sourceNumbers.map(n=>'['+n+']').join('')).join(' ')).join('\n\n'):(report.insights.length?report.insights.map(i=>'> '+i.text+' ['+i.sourceNumber+']').join('\n\n'):'No usable excerpts available.');return '# '+report.query+'\n\n'+report.database+' · '+report.scope+'\n\n## '+(integrated?'Integrated literature summary':'Abstract excerpts')+'\n\n'+prose+'\n\n## Limitations\n\n'+report.limitations.map(x=>'- '+x).join('\n')+'\n\n## Sources\n\n'+report.papers.map(p=>'['+p.number+'] '+p.title+'\n'+p.authors+' ('+(p.year||'n.d.')+'). '+p.url+(p.doi?'\nDOI: '+p.doi:'')).join('\n\n')+'\n';}


let evaluatingReport=null;
function reportStatements(report){
 if(!report.review?.paragraphs||!report.claims)return [];
 if(report.evaluation?.status==='complete')return report.evaluation.statements;
 const map=new Map(report.claims.map(c=>[c.id,c]));let index=0;
 return report.review.paragraphs.flatMap(p=>p.sentences.map(sentence=>{const linked=sentence.claimIds.map(id=>map.get(id)).filter(Boolean),seen=new Set(),snippets=[];for(const claim of linked)for(const e of claim.evidence){const key=e.paperId+'\n'+e.quote;if(!seen.has(key)){seen.add(key);snippets.push({...e,text:e.quote});}}return {id:'s'+(++index),text:sentence.text,claimIds:sentence.claimIds,sourceNumbers:sentence.sourceNumbers,relations:linked.map(c=>({claimId:c.id,claim:c.claim,conditions:c.conditions,relation:c.relation,action:({convergence:'action_convergence',composition:'action_composite',interleaved:'action_interleaved',atomic:'action_atomic',missing:'action_missing'})[c.relation]})),snippets};}));
}
function renderEvidence(report){
 const statements=reportStatements(report),evaluation=report.evaluation,button=$('evaluate-summary');button.disabled=!statements.length||!!evaluatingReport;button.textContent=evaluatingReport===report?'Evaluating…':evaluation?'Evaluation complete':'Evaluate summary';if(evaluation)button.disabled=true;
 $('evaluation-status').textContent=evaluatingReport===report?'Applying both prompts independently to the statements and cited snippets…':evaluation?'Judged by '+evaluation.model+'. Support uses the combined cited passages; relevance checks each passage separately.':'Support has not been evaluated. A relation such as convergence is not a support verdict.';
 const counts=$('evaluation-counts');counts.replaceChildren();counts.hidden=!evaluation;
 if(evaluation){const s=evaluation.counts.support,r=evaluation.counts.relevance;counts.append(node('span','',s.fullySupported+' / '+s.total+' fully supported'),node('span','',s.partiallySupported+' partially supported'),node('span','',s.noSupport+' no support'),node('span','',r.relevant+' / '+r.total+' relevant snippets'));}
 const host=$('evidence-tracker');host.replaceChildren();
 if(!statements.length)host.append(node('p','panel-intro','Generate an integrated summary to inspect its relations and evaluate citation support.'));
 for(const [index,statement]of statements.entries()){
  const row=node('article','evaluation-statement'),top=node('div','evaluation-row-top');row.id='evidence-statement-'+(index+1);top.append(node('strong','','Statement '+(index+1)));const badge=node('span','support-badge',statement.support?.rating||'Not evaluated');if(statement.support)badge.dataset.rating=statement.support.rating;top.append(badge);row.append(top,node('p','evaluation-statement-text',statement.text));
  const labels=node('div','relation-labels'),seen=new Set();for(const relation of buildStatementTrace(report,statement)){const label=relation.label+' / '+(relation.action||'Action unavailable');if(!seen.has(label)){seen.add(label);labels.append(node('span','relation-label',label));}}row.append(labels);row.append(renderStatementTrace(report,statement,index===0));
  const citations=node('div','evaluation-citations');citations.append(node('span','','Cited sources'));for(const number of statement.sourceNumbers||[]){const b=node('button','citation','['+number+']');b.onclick=()=>sourceJump(number);citations.append(b);}row.append(citations);
  if(statement.support)row.append(node('p','evaluation-analysis',statement.support.formatted));
  const relevance=node('section','citation-relevance');relevance.append(node('h4','','Citation relevance'),node('p','citation-relevance-intro','Each cited passage is rated separately. A supported statement can still contain an irrelevant citation.'));
  for(const snippet of statement.relevance||statement.snippets||[]){
   const item=node('article','citation-relevance-item'),head=node('div','citation-relevance-top');
   const source=node('button','citation','Source ['+snippet.sourceNumber+']');source.type='button';source.onclick=()=>sourceJump(snippet.sourceNumber);
   const rating=node('span','relevance-badge',snippet.rating||'Not evaluated');rating.dataset.rating=snippet.rating||'Not evaluated';
   const label=node('div','citation-relevance-label');label.append(source,node('span','',snippet.passageId||'Source excerpt'));head.append(label,rating);item.append(head);
   const details=node('details','evaluation-details');details.append(node('summary','','Read passage and rating explanation'));
   const original=(statement.snippets||[]).find(e=>e.paperId===snippet.paperId&&((e.passageId&&e.passageId===snippet.passageId)||e.text===(snippet.snippet||snippet.text)));
   if(original?.location){const loc=original.location;details.append(node('p','evidence-location',(loc.kind==='page'?'Page '+loc.page:loc.section||loc.kind)+(loc.elementId?' · '+loc.elementId:'')));}
   details.append(node('blockquote','',snippet.snippet||snippet.text||snippet.quote||'Quoted text unavailable.'),node('p','evaluation-analysis',snippet.formatted||'Relevance: Not evaluated'));item.append(details);relevance.append(item);
  }
  if(!(statement.relevance||statement.snippets||[]).length)relevance.append(node('p','panel-intro','No passage-level relevance results available.'));
  const conditions=(statement.relations||[]).filter(r=>r.conditions);if(conditions.length)relevance.append(node('p','trace-conditions','Study conditions: '+[...new Set(conditions.map(r=>r.conditions))].join(' / ')));row.append(relevance);host.append(row);
 }
 const runs=recordedAgentRuns(report);if(runs.length){const execution=node('details','evidence-execution-trace');execution.id='evidence-agent-execution';execution.append(node('summary','','Agent execution trace ('+runs.length+' runs)'),node('p','panel-intro','Recorded model/tool events and handoffs. Content previews may be shortened.'));const events=node('div');renderAgentRuns(events,runs);execution.append(events);const handoffs=node('ol','evidence-handoff-list');for(const h of report.multiagent.handoffs||[])handoffs.append(node('li','',h.from+' → '+h.to+': '+h.detail));if(handoffs.children.length)execution.append(node('h4','','Handoffs'),handoffs);host.append(execution);} $('evaluation-prompts').hidden=!evaluation;if(evaluation){$('support-prompt-text').textContent=evaluation.rubrics.support;$('relevance-prompt-text').textContent=evaluation.rubrics.relevance;}
}
$('evaluate-summary').onclick=async()=>{
 if(!current||evaluatingReport||current.evaluation)return;
 const target=current;evaluatingReport=target;$('evaluation-error').hidden=true;renderEvidence(target);
 try{const response=await fetch('/api/evaluate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({report:{query:target.query,papers:target.papers,claims:target.claims,review:target.review}})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Evaluation failed.');target.evaluation=result;
 const index=saved.findIndex(r=>r.createdAt===target.createdAt&&r.query===target.query);if(index>=0){saved[index]=target;writeStore('agentreview.saved.v1',saved);}toast('Support and relevance evaluation complete.');
 }catch(error){if(current===target){$('evaluation-error').textContent=error.message;$('evaluation-error').hidden=false;}else toast('Evaluation did not complete for the previous summary.');}
 finally{evaluatingReport=null;if(current)renderEvidence(current);}
};
function reportMarkdown(report){let text=baseReportMarkdown(report);if(!report.evaluation)return text;text+='\n## Relation and evidence evaluation\n\nModel: '+report.evaluation.model+'\n\n';for(const [index,s]of report.evaluation.statements.entries()){text+='### Statement '+(index+1)+'\n\n'+s.text+'\n\nRelations: '+s.relations.map(r=>r.relation+' / '+r.action).join(', ')+'\n\n'+s.support.formatted+'\n\n';for(const r of s.relevance)text+='Source ['+r.sourceNumber+']\n\n> '+r.snippet+'\n\n'+r.formatted+'\n\n';}return text;}

function newResearch(){if(controller)controller.abort();current=null;const heading=$('hero').querySelector('h1');heading.replaceChildren(document.createTextNode('A question in.'),node('br'),document.createTextNode('A clearer picture '),node('em','','out.'));document.body.classList.remove('has-results');$('results').hidden=true;$('searcher-results').hidden=true;$('multiagent-results').hidden=true;$('intro').hidden=false;$('error').hidden=true;$('query').value='';updateQuery();showView('research');$('query').focus();window.scrollTo({top:0,behavior:'smooth'});}
$('research-form').addEventListener('submit',async event=>{event.preventDefault();const query=$('query').value.trim();if(query.length<3){$('error').textContent='Enter at least 3 characters to start your search.';$('error').hidden=false;return;}if(controller)return;const source=$('source').value;const payload={query,source,years:$('years').value,limit:Number($('limit').value),length:$('detailed').checked?'detailed':'brief'};controller=new AbortController();const active=controller;let progressTimer;setBusy(true);$('error').hidden=true;$('results').hidden=true;$('intro').hidden=true;try{const isSearcher=$('run-mode').value==='searcher',isMulti=$('run-mode').value==='multiagent';if(isMulti){progressTimer=setInterval(async()=>{try{const p=await(await fetch('/api/multiagent-progress')).json();if(controller===active&&p.stage!=='idle')$('loading-description').textContent=(p.detail||p.stage+' is working'+(p.attempt>1?' on revision '+(p.attempt-1):''))+'. Each agent’s actions will appear in the execution record.';}catch{}},2500);}$('loading-description').textContent=isSearcher?'The Searcher is choosing queries and inspecting abstracts. You can inspect its actions when the run finishes.':'Searching papers, grouping shared claims, and writing one connected review.';if(isMulti)$('loading-description').textContent='Four specialists will search, read, write, and evaluate. This can take several minutes; you can cancel.';$('searcher-results').hidden=true;$('multiagent-results').hidden=true;const response=await fetch(isMulti?'/api/multiagent':isSearcher?'/api/searcher':'/api/research',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:active.signal});const data=await response.json();if(!response.ok)throw new Error(data.error||'Search could not complete. Please try again.');saveHistory(query,source);if(isMulti){renderMultiAgent(data);$('multiagent-results').scrollIntoView({behavior:'smooth',block:'start'});}else if(isSearcher){renderSearcher(data);$('searcher-results').scrollIntoView({behavior:'smooth',block:'start'});}else{renderReport(data);$('results').scrollIntoView({behavior:'smooth',block:'start'});}}catch(error){if(error.name!=='AbortError'){$('error').textContent=error.message;$('error').hidden=false;}else toast('Search cancelled.');if(current)$('results').hidden=false;else $('intro').hidden=false;}finally{clearInterval(progressTimer);if(controller===active){controller=null;setBusy(false);}}});
$('cancel-search').onclick=()=>controller?.abort();$('query').oninput=updateQuery;$('source').onchange=updateQuery;
$('query').addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter')$('research-form').requestSubmit();});
document.querySelectorAll('[data-query]').forEach(button=>button.onclick=()=>{$('query').value=button.dataset.query;updateQuery();$('query').focus();});
for(const name of ['summary','sources','evidence','process'])$('tab-'+name).onclick=()=>selectTab(name);
document.querySelector('.result-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const tabs=['summary','sources','evidence','process'];const index=tabs.findIndex(name=>$('tab-'+name).getAttribute('aria-selected')==='true');const next=tabs[(index+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length];selectTab(next);$('tab-'+next).focus();});
$('view-sources').onclick=()=>selectTab('sources');$('save-result').onclick=toggleSave;
$('copy-result').onclick=async()=>{if(!current)return;try{await navigator.clipboard.writeText(reportMarkdown(current));toast('Summary and references copied.');}catch{toast('Clipboard unavailable. Use Export to download your brief.');}};
$('export-result').onclick=()=>{if(!current)return;const url=URL.createObjectURL(new Blob([reportMarkdown(current)],{type:'text/markdown;charset=utf-8'}));const a=node('a');a.href=url;a.download='research-brief-'+new Date(current.createdAt).toISOString().slice(0,10)+'.md';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Research brief exported.');};
$('new-research').onclick=newResearch;$('nav-research').onclick=()=>showView('research');$('nav-saved').onclick=()=>showView('saved');$('how-button').onclick=()=>{$('how-dialog').showModal();closeMenu();};$('close-dialog').onclick=()=>$('how-dialog').close();$('how-dialog').addEventListener('click',e=>{if(e.target===$('how-dialog')){const b=$('how-dialog').getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)$('how-dialog').close();}});
$('menu-button').onclick=()=>{const open=$('sidebar').classList.toggle('open');$('menu-button').setAttribute('aria-expanded',String(open));};
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();if(e.key.toLowerCase()==='n'&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&!$('how-dialog').open){e.preventDefault();newResearch();}});
renderHistory();updateQuery();updateSaveButton();

fetch('/api/health').then(r=>r.json()).then(health=>{if(health.searcher?.model)$('searcher-guide-model').textContent=health.searcher.model;if(health.synthesisReady)$('loading-description').textContent='Searching papers, grouping shared claims, and writing one connected review. This may take about a minute.';}).catch(()=>{});

// Learning milestone 1: a separate result view, not an unverified summary.
let lastSearcherRun=null;
$('run-mode').onchange=()=>{const mode=$('run-mode').value,agent=mode==='searcher',multi=mode==='multiagent';$('searcher-guide').hidden=multi;$('searcher-guide').open=agent;$('multiagent-guide').hidden=!multi;$('mode-help').textContent=multi?'Four agents with source-linked evidence. Brief mode uses one scoring pass; detailed mode allows one revision. Up to four initial papers.':agent?'One LangChain agent chooses search queries, inspects abstracts, and selects sources. This mode does not write a summary.':'The existing Reader–Reasoner–Generator workflow.';$('detailed').closest('label').hidden=agent;if(multi)$('limit').value='4';for(const option of $('limit').options)option.disabled=multi&&option.value!=='4';};
function renderSearcher(run){
 lastSearcherRun=run;current=null;$('multiagent-results').hidden=true;if(run.model)$('searcher-guide-model').textContent=run.model;document.body.classList.add('has-results');$('results').hidden=true;$('intro').hidden=true;$('searcher-results').hidden=false;
 $('searcher-meta').textContent=(run.framework||'Searcher')+' · '+(run.model||'model unavailable')+' · '+run.status+' · '+(run.counts?.modelCalls||0)+' model calls · '+(run.counts?.searches||0)+' searches';
 $('searcher-scope').textContent=(run.scope||'Source discovery only.')+' Stop: '+(run.stopReason||run.error||'Unknown');
 $('searcher-note').textContent=run.note||'The agent did not complete a validated source selection.';
 const sources=$('searcher-sources');sources.replaceChildren();
 if(!run.papers?.length)sources.append(node('p','panel-intro','No sources selected. Inspect the trace for empty results, rejected actions, or execution limits.'));
 for(const p of run.papers||[]){const card=node('article','source-card');const h=node('h3');h.append(externalLink(p.title,p.url));const d=node('details');d.append(node('summary','','Inspect source abstract'),node('p','',p.abstract||'No abstract available.'));card.append(h,node('p','authors',p.id+' · '+(p.year||'Year unavailable')),d);sources.append(card);}
 const trace=$('searcher-trace');trace.replaceChildren();for(const e of run.trace||[]){const row=node('li');row.append(node('strong','',e.step+'. '+e.kind.replaceAll('_',' ')+(e.name?' · '+e.name:'')));const d=node('details');d.append(node('summary','','Inspect '+(e.kind==='model_input'?'context preview':e.kind==='model_output'?'model response':'event')),node('pre','',JSON.stringify(e,null,2)));row.append(d);trace.append(row);}
 $('searcher-config').textContent=JSON.stringify({instructions:run.instructions,tools:run.tools,limits:run.limits},null,2);
}
$('export-searcher').onclick=()=>{if(!lastSearcherRun)return;const url=URL.createObjectURL(new Blob([JSON.stringify(lastSearcherRun,null,2)],{type:'application/json'}));const a=node('a');a.href=url;a.download='paperazzi-searcher-trace.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

function renderMultiAgent(result){
 if(result.report)renderReport(result.report);else{current=null;$('results').hidden=true;$('intro').hidden=true;document.body.classList.add('has-results');}
 $('searcher-results').hidden=true;$('multiagent-results').hidden=false;
 const passed=result.status==='complete';
 $('multiagent-status').textContent=passed?'Run completed · both citation rubrics passed':result.status==='complete_with_gaps'?'Review completed with unresolved evidence gaps · inspect Reader findings below':result.status==='needs_revision'?(result.report?.multiagent?.maxRevisions===0?'Review scored · some statements or citations need revision':'Draft needs revision · the bounded revision round has ended'):result.message||'Run incomplete · no final summary released';
 $('multiagent-status').dataset.status=result.status;
 $('multiagent-disclosure').textContent=(result.report?.scope?result.report.scope+'. ':'')+'Support and relevance are LLM judgments. Independent scientific verification is not connected.';
 renderReaderEvidence(result.report?.reading||result.reading,result.report?.papers||[]);
 renderAgentRuns($('multiagent-runs'),result.runs);
 const handoffs=$('multiagent-handoffs');handoffs.replaceChildren();for(const h of result.handoffs||[])handoffs.append(node('li','',h.from+' → '+h.to+': '+h.detail));
}

const requestedMode=new URLSearchParams(window.location.search).get('mode');
if(['baseline','searcher','multiagent'].includes(requestedMode)){$('run-mode').value=requestedMode;$('run-mode').onchange();}

function renderReaderEvidence(reading,papers){
 const section=$('reader-evidence-review');section.hidden=!reading;if(!reading)return;
 const followup=reading.followup||{};
 $('reader-followup').textContent=followup.used?'Reader requested: “'+followup.query+'”. '+(followup.status==='new_sources'?(followup.newPaperIds||[]).length+' new source(s) returned.':followup.status==='search_incomplete'?'The follow-up search did not complete.':'No new usable sources returned.'):'No follow-up search was requested. Missing information can still be recorded below.';
 const coverage=$('reader-coverage');coverage.replaceChildren();const paperMap=new Map(papers.map(p=>[p.id,p]));
 for(const item of reading.coverage||[]){const p=paperMap.get(item.paperId);coverage.append(node('li','',(p?'['+p.number+'] '+p.title:item.paperId)+' · '+item.readPassages+' / '+item.parsedPassages+' parsed passages inspected · '+item.scope));}
 if(!coverage.children.length)coverage.append(node('li','','Reading did not complete; inspect the agent trace.'));
 const passages=new Map(papers.flatMap(p=>(p.evidencePassages||[]).map(x=>[x.id,{...x,paper:p}])));
 const host=$('reader-gap-list');host.replaceChildren();
 const gaps=reading.evidenceGaps||[];
 if(!gaps.length)host.append(node('p','panel-intro','The Reader reported no remaining evidence gaps. This is not a guarantee of exhaustive coverage.'));
 for(const gap of gaps){
  const card=node('article','reader-gap-card'),top=node('div','reader-gap-top');
  top.append(node('strong','',gap.missingEvidence||gap.id));const badge=node('span','reader-gap-badge',({resolved:'Addressed in reviewed evidence',partially_resolved:'Partly addressed',unresolved:'Unresolved'})[gap.status]||gap.status);badge.dataset.status=gap.status;top.append(badge);card.append(top);
  if(gap.whyNeeded)card.append(node('p','','Why it matters: '+gap.whyNeeded));
  if(gap.explanation)card.append(node('p','',gap.explanation));
  const ids=[...new Set([...(gap.checkedPassageIds||[]),...(gap.evidencePassageIds||[])])];
  if(ids.length){const d=node('details');d.append(node('summary','','Inspect passages checked for this gap'));
   for(const id of ids){const passage=passages.get(id);if(!passage){d.append(node('p','',id+' · See the Reader trace for the inspected source.'));continue;}const p=passage.paper,loc=passage.location||{},item=node('div','reader-gap-passage');const label=node('button','citation','Source ['+p.number+']');label.onclick=()=>sourceJump(p.number);item.append(label,node('span','', ' '+id+' · '+(loc.kind==='page'?'Page '+loc.page:loc.section||loc.kind||'Source text')),node('blockquote','',passage.text));d.append(item);}
   card.append(d);
  }
  card.append(node('p','reader-gap-assessor',gap.assessmentBy||'Reader-requested evidence gap; evaluation pending.'));host.append(card);
 }
}

function renderAgentRuns(host,runs){host.replaceChildren();
 for(const run of runs||[]){
  const d=node('details','multiagent-run');
  d.append(node('summary','',run.agent+(run.phase==='followup'?' · Reader-requested follow-up':run.phase==='after_followup'?' · resumed after search':run.attempt>1?' · revision '+(run.attempt-1):'')+' · '+(run.status==='needs_search'?'requested follow-up':run.status)+' · '+(run.counts?.modelCalls||0)+' model calls'+(run.durationSeconds?' · '+Math.round(run.durationSeconds)+'s':'')));
  d.append(node('p','',run.model+' · '+run.framework+' · Stop: '+run.stopReason));if(run.counts?.tokens)d.append(node('p','',run.counts.tokens.toLocaleString()+' cumulative observed tokens'+(run.limits?.finishingMode?' · finishing mode used':'')));if(['token_limit','local_token_budget'].includes(run.stopReason))d.append(node('p','','This is Paperazzi’s local cumulative token guard, not an OpenRouter credit or key error.'));
  if(run.note)d.append(node('p','',run.note));
  const list=node('ol','agent-event-list');
  for(const event of run.trace||[]){const row=node('li'),detail=node('details');detail.append(node('summary','',event.step+'. '+event.kind.replaceAll('_',' ')+(event.name?' · '+event.name:'')),node('pre','',JSON.stringify(event,null,2)));row.append(detail);list.append(row);}
  d.append(list);const config=node('details');config.append(node('summary','','Instructions and tools'),node('pre','',JSON.stringify({instructions:run.instructions,tools:run.tools},null,2)));d.append(config);host.append(d);
 }
}

function openStatementTrace(index){
 selectTab('evidence');const row=$('evidence-statement-'+(index+1));
 if(row){const trace=row.querySelector('.statement-trace');if(trace)trace.open=true;row.scrollIntoView({behavior:'smooth',block:'start'});}
}
function renderStatementTrace(report,statement,open){
 const groups=buildStatementTrace(report,statement),details=node('details','statement-trace');details.open=open;
 const count=new Set(groups.flatMap(g=>g.evidence.map(e=>e.paperId+'\n'+(e.passageId||e.quote)))).size;
 details.append(node('summary','','Trace: '+groups.length+(groups.length===1?' claim group, ':' claim groups, ')+count+(count===1?' evidence passage':' evidence passages')));
 details.append(node('p','trace-path','Source passages → Reader claim group → ReviewReasoner relation/action → Writer statement'));
 for(const group of groups){
  const card=node('section','claim-trace-group');card.append(node('h4','','Claim group '+group.claimId),node('p','trace-claim',group.claim));
  if(group.conditions)card.append(node('p','trace-conditions','Study conditions: '+group.conditions));
  card.append(node('p','trace-decision',group.label+': '+group.meaning),node('p','trace-instruction','Writing instruction: '+group.instruction));
  card.append(node('p','trace-method',group.hasDecision?'Recorded action: '+group.action+'. Selection: '+(({upstream_agent:'Reader-provided relation',structural_rules:'structural fallback rules',empty_cluster:'empty cluster'})[group.selectedBy]||group.selectedBy||'not recorded')+'.':'Reasoner decision record unavailable for this saved report.'));
  for(const evidence of group.evidence){
   const source=node('details','trace-source'),loc=evidence.location||{};
   const location=loc.kind==='page'?'Page '+loc.page:loc.section||loc.kind||'Source text';
   source.append(node('summary','','Source ['+evidence.sourceNumber+'] · '+(evidence.passageId||evidence.id||'Source excerpt')+' · '+location));
   const link=node('button','citation','Open source ['+evidence.sourceNumber+']');link.type='button';link.onclick=()=>sourceJump(evidence.sourceNumber);
   source.append(node('p','trace-source-title',evidence.title),link,node('p','trace-source-meta',evidence.scope+' · evidence stance: '+(evidence.stance||'Not recorded')));
   source.append(node('blockquote','',evidence.quote||'Quoted text unavailable.'));
   card.append(source);
  }
  if(!group.evidence.length)card.append(node('p','trace-method','Source evidence records unavailable.'));
  if(group.record){const raw=node('details','reasoner-details');raw.append(node('summary','','Inspect recorded relation decision'),node('pre','',JSON.stringify(group.record,null,2)));card.append(raw);}
  details.append(card);
 }
 details.append(node('p','trace-disclosure','This trace records sources and writing decisions. Support ratings come from the separate Judge rubrics. Executable Python verification is not connected.'));
 return details;
}
