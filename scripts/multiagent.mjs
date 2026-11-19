import {randomUUID} from 'node:crypto';
import {runSearcher} from './searcher-bridge.mjs';
import {runAgent} from './agent-bridge.mjs';
import {makeReport} from '../backend/research.mjs';
import {validateClaimClusters,reasonAboutClaims,validateWrittenReview} from '../backend/synthesis.mjs';
import {prepareEvaluationCases,evaluateSummary} from '../backend/evaluation.mjs';

// Coordinator is ordinary bounded orchestration code, not a fifth LLM agent.
const jobs=new Map();
export const activeProgress={stage:'idle',attempt:0,detail:''};
export async function evaluateAgentJob(jobId,env){
 const job=jobs.get(jobId);
 if(!job)throw new Error('Unknown or expired review job.');
 return evaluateSummary(job.report,env);
}
export async function runMultiAgent(payload,token,signal,deps={}){
 const search=deps.search||runSearcher,run=deps.run||runAgent;
 const runs=[],handoffs=[],jobId=randomUUID();let report=null,reading=null;
 const progress=(stage,attempt=1,detail='')=>{activeProgress.stage=stage;activeProgress.attempt=attempt;activeProgress.detail=detail;};
 const add=(result,from,to,detail)=>{runs.push(result);if(result.status!=='complete')throw new Error(from+' did not complete: '+result.stopReason);handoffs.push({from,to,detail});};
 try{
  progress('Searcher');
  const found=await search({query:payload.query,source:payload.source,years:payload.years,limit:4},token,signal);
  add(found,'Searcher','Reader','Selected source records with provider IDs and abstracts.');
  if(!found.papers?.length)return {status:'no_evidence',runs,handoffs,message:'No usable papers were selected. No summary was generated.'};
  const selected=found.papers.map((p,i)=>({...p,number:i+1}));
  progress('Reader');
  let read=await run('reader',{query:payload.query,papers:selected,length:payload.length,followupBudget:1},token,signal);
  read.attempt=1;
  let followup={used:false,maxSearches:1,maxNewPapers:2},requestedGaps=[];
  if(read.status==='needs_search'){
   runs.push(read);
   const request=read.searchRequest,seen=new Set(read.readPassageIds||[]);
   const knownIds=new Set(selected.map(p=>p.id));
   if(!request||typeof request.query!=='string'||request.query.trim().length<3||request.query.length>500||
      typeof request.missingEvidence!=='string'||!request.missingEvidence.trim()||request.missingEvidence.length>1000||
      typeof request.whyNeeded!=='string'||!request.whyNeeded.trim()||request.whyNeeded.length>1000||
      !Array.isArray(request.checkedPassageIds)||!request.checkedPassageIds.length||
      request.checkedPassageIds.some(id=>!seen.has(id))||
      !Array.isArray(read.papers)||read.papers.length!==selected.length||new Set(read.papers.map(p=>p.id)).size!==selected.length||read.papers.some(p=>!knownIds.has(p.id)))throw new Error('Reader returned an invalid evidence-gap handoff.');
   const gap={id:'g1',...request,status:'pending'};
   requestedGaps=[gap];
   reading={note:read.note,evidenceGaps:[{...gap,status:'unresolved',explanation:'Follow-up reading has not completed.',evidencePassageIds:[]}],followup:{used:false},coverage:[]};
   handoffs.push({from:'Reader',to:'Searcher',gapId:gap.id,query:request.query,
    detail:'Missing evidence: '+request.missingEvidence+' Why needed: '+request.whyNeeded});
   progress('Searcher',2,'Targeted follow-up requested by Reader');
   let extra;
   try{extra=await search({query:request.query.trim(),source:payload.source,years:payload.years,limit:4,exclude_ids:[...knownIds]},token,signal);}
   catch(e){if(signal?.aborted)throw e;extra={agent:'Searcher',status:'error',stopReason:'Follow-up search could not complete.',trace:[],counts:{modelCalls:0,toolCalls:0}};}
   extra.phase='followup';extra.attempt=2;runs.push(extra);
   if(signal?.aborted)throw new Error('Agent run cancelled.');
   const ids=new Set(knownIds),dois=new Set(selected.map(p=>p.doi?.trim().toLowerCase()).filter(Boolean)),added=[];
   if(extra.status==='complete')for(const paper of extra.papers||[]){
    const doi=paper.doi?.trim().toLowerCase();
    if(!paper.id||ids.has(paper.id)||(doi&&dois.has(doi)))continue;
    ids.add(paper.id);if(doi)dois.add(doi);
    added.push({...paper,number:selected.length+added.length+1});if(added.length===2)break;
   }
   followup={used:true,maxSearches:1,maxNewPapers:2,query:request.query,
    status:extra.status!=='complete'?'search_incomplete':added.length?'new_sources':'no_new_sources',
    newPaperIds:added.map(p=>p.id)};
   reading.followup=followup;
   handoffs.push({from:'Searcher',to:'Reader',gapId:gap.id,detail:added.length?
    'Returned '+added.length+' new source(s). Reader must inspect them and reassess the gap.':
    'No new usable sources returned. Reader must retain any unresolved evidence gap.'});
   progress('Reader',2,'Reading follow-up sources and reassessing the evidence gap');
   read=await run('reader',{query:payload.query,papers:[...read.papers,...added],length:payload.length,followupBudget:0,
    readerState:{readPassageIds:read.readPassageIds,excluded:read.excluded},
    evidenceGaps:requestedGaps,followupResult:followup},token,signal);
   read.attempt=2;read.phase='after_followup';
  }
  add(read,'Reader','ReviewReasoner','Claim groups with exact passage IDs, locations, source scope, and explicit evidence-gap outcomes.');
  const evidenceGaps=read.evidenceGaps||[];
  const allReadIds=new Set(read.readPassageIds||[]);
  for(const gap of evidenceGaps){
   if(!gap||typeof gap.id!=='string'||!['resolved','partially_resolved','unresolved'].includes(gap.status)||
      !Array.isArray(gap.evidencePassageIds)||gap.evidencePassageIds.some(id=>!allReadIds.has(id))||
      (gap.status!=='unresolved'&&!gap.evidencePassageIds.length))throw new Error('Reader gap outcomes have missing or unread evidence.');
  }
  if(new Set(evidenceGaps.map(g=>g.id)).size!==evidenceGaps.length||requestedGaps.some(g=>!evidenceGaps.some(a=>a.id===g.id)))throw new Error('Reader omitted a requested evidence gap.');
  reading={note:read.note,excluded:read.excluded,readPassageIds:read.readPassageIds,
    coverage:read.readingCoverage||[],evidenceGaps,followup};
  const claims=validateClaimClusters({clusters:read.clusters},read.papers);
  if(!claims.length)return {status:'no_evidence',runs,handoffs,reading,message:'The Reader found no usable claims. No summary was generated.'};
  const reasoning=reasonAboutClaims(claims,read.papers);
  handoffs.push({from:'ReviewReasoner',to:'Generator',detail:'One relation and writing action per claim group. Ordinary code, not an agent or verification verdict.'});
  const full=read.papers.filter(p=>p.document?.mode.startsWith('full_text')).length;
  const scope=full+' full-text source(s), '+(read.papers.length-full)+' abstract-only source(s); bounded text extraction';
  const retrieval={papers:read.papers,database:({pubmed:'PubMed',arxiv:'arXiv',europepmc:'Europe PMC',semantic:'Semantic Scholar'})[payload.source],scope};
  const base=makeReport(retrieval,payload.query,payload);
  let previousDraft=null,feedback=null,judged;
  const maxAttempts=payload.length==='detailed'?2:1;
  for(let attempt=1;attempt<=maxAttempts;attempt++){
   if(signal?.aborted)throw new Error('Agent run cancelled.');
   progress('Generator',attempt);
   const written=await run('generator',{query:payload.query,length:payload.length,claims,
    writingPlan:reasoning.output.results.map(x=>({cluster:x.cluster,relation:x.relation,action:x.action})),previousDraft,feedback,evidenceGaps},token,signal);
   written.attempt=attempt;add(written,'Generator','Judge','Draft sentences mapped to prepared claim IDs.');
   const review=validateWrittenReview(written.written,claims);
   report={...base,reading,mode:'synthesized',provider:'OpenRouter',model:written.model,synthesis:{status:'complete'},claims,reasoning,review,
    insights:claims.map(c=>({text:c.claim,paperId:c.evidence[0].paperId,sourceNumber:c.sourceNumbers[0],sourceNumbers:c.sourceNumbers})),
    checks:{...base.checks,mergedClaims:claims.filter(c=>c.sourceNumbers.length>1).length,citedInsights:claims.length,citedSentences:review.paragraphs.reduce((n,p)=>n+p.sentences.length,0)},
    limitations:['Full text is used where retrievable; other sources are explicitly abstract-only. Parsing is bounded and does not reconstruct all tables, figures, or supplements.',
      'Relations guide writing. The two LLM rubrics assess citation support and relevance, not scientific validity.','The independent executable verification layer is not connected.']};
   jobs.set(jobId,{report});
   progress('Judge',attempt);
   judged=await run('judge',{jobId,query:payload.query,statements:prepareEvaluationCases(report).statements},token,signal);
   judged.attempt=attempt;add(judged,'Judge',judged.decision==='pass'?'Output':'Generator',judged.decision==='pass'?'Both supplied citation rubrics passed. Scientific verification remains pending.':'Specific rubric findings returned for revision.');
   // Validate the evaluation again at the coordinator boundary; never trust a free-text pass.
   const expected=prepareEvaluationCases(report).statements;
   if(judged.evaluation?.status!=='complete'||!Array.isArray(judged.evaluation.statements)||
      judged.evaluation.statements.length!==expected.length||expected.some(s=>!judged.evaluation.statements.some(x=>x.id===s.id&&x.text===s.text)))throw new Error('Judge evaluation does not match the draft.');
   for(const expectedStatement of expected){
    const actual=judged.evaluation.statements.find(x=>x.id===expectedStatement.id);
    if(!['Fully supported','Partially supported','No support'].includes(actual.support?.rating)||
       !Array.isArray(actual.relevance)||actual.relevance.length!==expectedStatement.snippets.length||
       expectedStatement.snippets.some(e=>!actual.relevance.some(x=>x.paperId===e.paperId&&x.snippet===e.text&&['Relevant','Irrelevant'].includes(x.rating))))throw new Error('Judge skipped or changed cited evidence.');
   }
   report.evaluation=judged.evaluation;
   const issues=judged.evaluation.statements.filter(s=>s.support.rating!=='Fully supported'||s.relevance.some(x=>x.rating!=='Relevant'));
   if(!issues.length)break;
   feedback=issues.map(s=>({text:s.text,support:s.support,relevance:s.relevance}));previousDraft=review;
  }
  const qualityStatus=report.evaluation.statements.every(s=>s.support.rating==='Fully supported'&&s.relevance.every(x=>x.rating==='Relevant'))?'passed_rubrics':'needs_revision';
  const evidenceStatus=evidenceGaps.some(g=>g.status!=='resolved')?'gaps_remaining':'no_reported_gaps';
  report.multiagent={evidenceStatus,roles:['Searcher','Reader','Generator','Judge'],qualityStatus,attempts:judged.attempt,maxRevisions:maxAttempts-1,verification:'not_connected',framework:'LangChain create_agent',runs,handoffs};
  report.steps=[{name:'Searcher agent',detail:'Selected '+report.papers.length+' sources using a model/tool loop.'},
   {name:'Document parser',detail:scope+'. XML retains section/element locations; PDFs retain page numbers. No OCR or full table reconstruction.'},
   {name:'Reader agent',detail:'Read '+read.readPassageIds.length+' passages; extracted '+claims.length+' claim groups. Exclusions: '+Object.keys(read.excluded||{}).length+'. Follow-up searches: '+Number(followup.used)+'. Unresolved/partial gaps: '+evidenceGaps.filter(g=>g.status!=='resolved').length+'.'},
   {name:'ReviewReasoner tool',detail:'Separate deterministic relation/action code. Provisional semantic relations come from the Reader.'},
   {name:'Generator agent',detail:'Inspected claim evidence and submitted a citation-validated draft.'},
   {name:'Judge agent',detail:'Inspected all statements and ran separate support/relevance prompt evaluations. '+qualityStatus+'.'},
   {name:'Verification layer',detail:'Independent executable verification is not connected.'}];
  return {status:qualityStatus!=='passed_rubrics'?'needs_revision':evidenceStatus==='gaps_remaining'?'complete_with_gaps':'complete',report,runs,handoffs};
 }catch(e){return {status:signal?.aborted?'cancelled':'incomplete',runs,handoffs,reading,message:e.message||'The multi-agent run did not complete. No final summary was released.'};}
 finally{jobs.delete(jobId);progress('idle',0);}
}
