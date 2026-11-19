import test from 'node:test';
import assert from 'node:assert/strict';
import {runMultiAgent} from '../scripts/multiagent.mjs';
import {validateClaimClusters,createEvidencePassages} from '../backend/synthesis.mjs';
import {prepareEvaluationCases,summarizeEvaluations} from '../backend/evaluation.mjs';
const quote='This synthetic full-text result reports improved accuracy on dataset D.';
const paper={id:'fixture:1',number:1,title:'Fixture study',abstract:'This abstract deliberately omits the full-text result.',source:'Fixture',year:2025,url:'https://example.org',doi:null,
 evidencePassages:[{id:'p1x1',paperId:'fixture:1',sourceNumber:1,text:quote,location:{kind:'section',section:'Results'}}],document:{mode:'full_text_xml',passageCount:1}};
const cluster={id:'c1',claim:quote,conditions:'Synthetic dataset D',relation:'atomic',evidence:[{passageId:'p1x1',stance:'supports',conditions:'Synthetic dataset D'}]};
const written={paragraphs:[{sentences:[{text:quote,claimIds:['c1']}]}]};
const payload={query:'fixture topic',source:'pubmed',years:'all',limit:4,length:'brief'};
const result=(agent,extra={})=>({agent,status:'complete',framework:'LangChain create_agent',model:'fixture-model',counts:{modelCalls:3,toolCalls:3},trace:[],...extra});
function dependencies({failFirst=false,alwaysFail=false,skipEvidence=false,failSearch=false}={}){
 const calls=[];let evaluations=0;
 return {calls,search:async()=>result('Searcher',{status:failSearch?'incomplete':'complete',papers:[paper],stopReason:'fixture'}),
  run:async(role,input)=>{
   calls.push(role);
   if(role==='reader')return result('Reader',{papers:[paper],clusters:[cluster],readPassageIds:['p1x1'],excluded:{}});
   if(role==='generator'){
    assert.equal(input.writingPlan[0].action,'action_atomic');
    if(evaluations)assert.ok(input.feedback.length);
    return result('Generator',{written});
   }
   assert.equal(role,'judge');evaluations++;
   const failed=alwaysFail||(failFirst&&evaluations===1);
   const statements=input.statements.map(s=>({...s,support:{rating:failed?'No support':'Fully supported',analysis:'Fixture',formatted:'Fixture'},
    relevance:skipEvidence?[]:s.snippets.map(e=>({paperId:e.paperId,sourceNumber:e.sourceNumber,evidenceId:e.id,passageId:e.passageId,snippet:e.text,rating:'Relevant',analysis:'Fixture',formatted:'Fixture'}))}));
   return result('Judge',{attempt:evaluations,decision:failed?'revise':'pass',evaluation:{status:'complete',model:'fixture-model',statements,counts:summarizeEvaluations(statements),rubrics:{support:'Fixture',relevance:'Fixture'}}});
  }};
}
test('parsed full-text evidence is accepted with exact source provenance',()=>{
 const claims=validateClaimClusters({clusters:[cluster]},[paper]);
 assert.equal(claims[0].evidence[0].quote,quote);
 assert.equal(claims[0].evidence[0].location.section,'Results');
 assert.equal(createEvidencePassages([paper])[0].id,'p1x1');
 const prepared=prepareEvaluationCases({query:'fixture',papers:[paper],claims,review:{paragraphs:[{sentences:[{text:quote,claimIds:['c1'],sourceNumbers:[1]}]}]}});
 assert.equal(prepared.supportCases.length,1);
 assert.equal(prepared.relevanceCases[0].snippet,quote);
});
test('four specialists exchange validated records and produce an evaluated review',async()=>{
 const d=dependencies();const output=await runMultiAgent(payload,'fixture-token',undefined,d);
 assert.equal(output.status,'complete');
 assert.deepEqual(d.calls,['reader','generator','judge']);
 assert.deepEqual(output.report.multiagent.roles,['Searcher','Reader','Generator','Judge']);
 assert.deepEqual(output.report.review.paragraphs[0].sentences[0].sourceNumbers,[1]);
 assert.equal(output.report.multiagent.verification,'not_connected');
 assert.equal(output.runs.length,4);
 assert.equal(output.report.checks.verification,'not_connected');
 const source=Object.values(output.report.reasoning.output.results[0].sources)[0];
 assert.equal(source.location.section,'Results');assert.equal(source.passage_id,'p1x1');
 assert.equal(source.source_scope,'full_text_xml');assert.match(source.score_meaning,/not a scientific-support confidence score/);
});
test('judge feedback triggers exactly one bounded revision',async()=>{
 const d=dependencies({failFirst:true});const output=await runMultiAgent({...payload,length:'detailed'},'fixture-token',undefined,d);
 assert.equal(output.status,'complete');
 assert.deepEqual(d.calls,['reader','generator','judge','generator','judge']);
 assert.equal(output.report.multiagent.attempts,2);
});
test('unresolved support failures remain a flagged draft, never a passed result',async()=>{
 const d=dependencies({alwaysFail:true});const output=await runMultiAgent({...payload,length:'detailed'},'fixture-token',undefined,d);
 assert.equal(output.status,'needs_revision');
 assert.equal(output.report.multiagent.qualityStatus,'needs_revision');
 assert.equal(d.calls.filter(x=>x==='generator').length,2);
});
test('incomplete Searcher blocks downstream work',async()=>{
 const d=dependencies({failSearch:true});const output=await runMultiAgent(payload,'fixture-token',undefined,d);
 assert.equal(output.status,'incomplete');assert.equal(output.report,undefined);assert.deepEqual(d.calls,[]);
});
test('Judge cannot pass by omitting relevance evaluations',async()=>{
 const output=await runMultiAgent(payload,'fixture-token',undefined,dependencies({skipEvidence:true}));
 assert.equal(output.status,'incomplete');assert.equal(output.report,undefined);
 assert.match(output.message,/skipped or changed/);
});

test('full-text comparison symbols are retained in exact quotations',()=>{
 const text='The result was significant at p < 0.05, while the comparison was p > 0.1.';
 const p={...paper,evidencePassages:[{...paper.evidencePassages[0],text}]};
 const claims=validateClaimClusters({clusters:[{...cluster,claim:text}]},[p]);
 assert.equal(claims[0].evidence[0].quote,text);
 const prepared=prepareEvaluationCases({query:'fixture',papers:[p],claims,review:{paragraphs:[{sentences:[{text,claimIds:['c1'],sourceNumbers:[1]}]}]}});
 assert.equal(prepared.relevanceCases[0].snippet,text);
});

function followupDependencies({noNew=false,failed=false,resumeAgain=false,omitGap=false,badRequest=false}={}){
 const base=dependencies(),events=[],queries=[];let reads=0,searches=0;
 const initial={...paper,doi:'10.fixture/original'};
 const request={query:'fixture functional outcome',missingEvidence:'Functional outcomes are not established in the selected evidence.',whyNeeded:'The user asks about function after editing.',checkedPassageIds:[badRequest?'unknown':'p1x1']};
 const metadata=(id,doi)=>({id,title:'Follow-up '+id,abstract:quote,source:'Fixture',year:2025,url:'https://example.org/'+id,doi});
 return {events,queries,search:async(input)=>{
  events.push('search');queries.push(input);searches++;
  if(searches===1)return result('Searcher',{papers:[initial]});
  assert.deepEqual(input.exclude_ids,['fixture:1']);assert.equal(input.source,payload.source);assert.equal(input.years,payload.years);
  if(failed)throw Error('Fixture retrieval failure');
  return result('Searcher',{papers:noNew?[]:[initial,metadata('duplicate-doi','10.fixture/original'),metadata('fixture:2','10.fixture/2'),metadata('fixture:3','10.fixture/3'),metadata('fixture:4','10.fixture/4')]});
 },run:async(role,input)=>{
  events.push(role);
  if(role!=='reader')return base.run(role,input);
  reads++;
  if(reads===1){assert.equal(input.followupBudget,1);return result('Reader',{status:'needs_search',papers:[initial],readPassageIds:['p1x1'],excluded:{},searchRequest:request,stopReason:'reader_requested_followup'});}
  assert.equal(input.followupBudget,0);assert.deepEqual(input.readerState.readPassageIds,['p1x1']);
  assert.equal(input.evidenceGaps[0].id,'g1');
  const parsed=input.papers.map((p,i)=>({...p,number:i+1,
   evidencePassages:[{...paper.evidencePassages[0],id:'p'+(i+1)+'x1',paperId:p.id,sourceNumber:i+1}],document:{mode:'full_text_xml',passageCount:1}}));
  assert.ok(parsed.length<=3); // Initial one plus at most two additional sources.
  const readIds=parsed.map(p=>p.evidencePassages[0].id);
  if(resumeAgain)return result('Reader',{status:'needs_search',papers:parsed,readPassageIds:readIds,excluded:{},searchRequest:request});
  return result('Reader',{papers:parsed,clusters:[cluster],readPassageIds:readIds,excluded:{},
   readingCoverage:parsed.map(p=>({paperId:p.id,readPassages:1,parsedPassages:1,scope:'full_text_xml'})),
   evidenceGaps:omitGap?[]:[{...input.evidenceGaps[0],status:noNew||failed?'unresolved':'resolved',
    explanation:noNew||failed?'No new usable sources were returned.':'New inspected evidence addresses the missing information.',evidencePassageIds:noNew||failed?[]:['p2x1']}]});
 }};
}
test('Reader can request one targeted Searcher follow-up and resume with stable source IDs',async()=>{
 const d=followupDependencies(),r=await runMultiAgent(payload,'fixture-token',undefined,d);
 assert.equal(r.status,'complete');
 assert.deepEqual(d.events,['search','reader','search','reader','generator','judge']);
 assert.equal(d.queries[1].query,'fixture functional outcome');
 assert.deepEqual(r.report.papers.map(p=>p.number),[1,2,3]);
 assert.deepEqual(r.report.reading.followup.newPaperIds,['fixture:2','fixture:3']);
 assert.equal(r.report.reading.evidenceGaps[0].status,'resolved');
 assert.equal(r.report.multiagent.evidenceStatus,'no_reported_gaps');
 assert.equal(r.runs.filter(x=>x.agent==='Reader').length,2);
 assert.ok(r.handoffs.some(h=>h.from==='Reader'&&h.to==='Searcher'));
});
test('empty follow-up returns a review explicitly marked with unresolved gaps',async()=>{
 const d=followupDependencies({noNew:true}),r=await runMultiAgent(payload,'fixture-token',undefined,d);
 assert.equal(r.status,'complete_with_gaps');
 assert.equal(r.report.reading.followup.status,'no_new_sources');
 assert.equal(r.report.reading.evidenceGaps[0].status,'unresolved');
 assert.equal(r.report.multiagent.qualityStatus,'passed_rubrics');
 assert.equal(r.report.multiagent.evidenceStatus,'gaps_remaining');
 assert.equal(d.queries.length,2);
});
test('failed follow-up remains visible and does not fabricate new evidence',async()=>{
 const r=await runMultiAgent(payload,'fixture-token',undefined,followupDependencies({failed:true}));
 assert.equal(r.status,'complete_with_gaps');
 assert.equal(r.report.reading.followup.status,'search_incomplete');
 assert.equal(r.report.papers.length,1);
 assert.equal(r.report.reading.evidenceGaps[0].status,'unresolved');
 assert.ok(r.runs.some(x=>x.agent==='Searcher'&&x.status==='error'));
});
test('Reader cannot trigger repeated follow-up searches beyond the coordinator budget',async()=>{
 const d=followupDependencies({resumeAgain:true}),r=await runMultiAgent(payload,'fixture-token',undefined,d);
 assert.equal(r.status,'incomplete');assert.equal(r.report,undefined);
 assert.equal(d.queries.length,2);
 assert.equal(r.reading.evidenceGaps[0].status,'unresolved');
});
test('requested evidence gaps cannot silently disappear after follow-up',async()=>{
 const r=await runMultiAgent(payload,'fixture-token',undefined,followupDependencies({omitGap:true}));
 assert.equal(r.status,'incomplete');assert.match(r.message,/omitted/);assert.equal(r.report,undefined);
});
test('uninspected gap references are rejected before invoking Searcher again',async()=>{
 const d=followupDependencies({badRequest:true}),r=await runMultiAgent(payload,'fixture-token',undefined,d);
 assert.equal(r.status,'incomplete');assert.equal(d.queries.length,1);assert.equal(r.report,undefined);
});

test('brief mode runs one Writer/Judge pass and keeps unresolved scores visible',async()=>{
 const d=dependencies({alwaysFail:true}),output=await runMultiAgent(payload,'fixture-token',undefined,d);
 assert.equal(output.status,'needs_revision');
 assert.deepEqual(d.calls,['reader','generator','judge']);
 assert.equal(output.report.multiagent.attempts,1);
 assert.equal(output.report.multiagent.maxRevisions,0);
 assert.equal(output.report.evaluation.counts.support.noSupport,1);
});
