import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStatementTrace,recordedAgentRuns} from '../public/trace.js';

const report={papers:[{id:'pA',number:2,title:'Study A',document:{mode:'full_text_pdf'},evidencePassages:[{id:'A:7',text:'Exact source text.',location:{kind:'page',page:3}}]}],claims:[{id:'c1',claim:'A scoped finding.',relation:'convergence',conditions:'Dataset D',evidence:[{id:'e1',paperId:'pA',sourceNumber:2,passageId:'A:7',quote:'Exact source text.',stance:'contradicts'}]}],reasoning:{output:{results:[{cluster:'c1',relation:'interleaved',action:'action_interleaved',selected_by:'upstream_agent',documents:['e1']}]}}};

test('statement trace uses stable claim IDs and the actual final reasoner decision',()=>{
 const [trace]=buildStatementTrace(report,{claimIds:['c1','c1'],relations:[]});
 assert.equal(trace.claimId,'c1');assert.equal(trace.relation,'interleaved');
 assert.equal(trace.action,'action_interleaved');assert.equal(trace.selectedBy,'upstream_agent');
 assert.equal(trace.claim,'A scoped finding.');assert.equal(trace.conditions,'Dataset D');
 assert.equal(trace.evidence[0].passageId,'A:7');assert.deepEqual(trace.evidence[0].location,{kind:'page',page:3});
 assert.equal(trace.evidence[0].quote,'Exact source text.');assert.equal(trace.evidence[0].sourceNumber,2);
 assert.equal(trace.evidence[0].stance,'contradicts');assert.equal(trace.evidence[0].scope,'full_text_pdf');
 assert.equal(buildStatementTrace(report,{claimIds:['c1','c1']}).length,1);
 assert.equal('support' in trace,false);
});
test('saved reports without reasoner records retain evidence without inventing a decision trace',()=>{
 const [trace]=buildStatementTrace({...report,reasoning:null},{relations:[{claimId:'c1',relation:'convergence'}]});
 assert.equal(trace.relation,'convergence');assert.equal(trace.hasDecision,false);assert.equal(trace.selectedBy,null);
 assert.equal(trace.record,null);assert.equal(trace.evidence.length,1);
});
test('missing claim IDs remain explicit and cannot inherit a neighboring claim evidence',()=>{
 const [trace]=buildStatementTrace(report,{claimIds:['missing'],relations:[]});
 assert.equal(trace.claimId,'missing');assert.equal(trace.label,'Relation unavailable');
 assert.equal(trace.action,null);assert.deepEqual(trace.evidence,[]);
});
test('agent runs are scoped to the selected report, including older reports without events',()=>{
 const runs=[{agent:'Reader',trace:[{kind:'tool_result',name:'read_passages'}]}];
 assert.equal(recordedAgentRuns({multiagent:{runs}}),runs);
 assert.deepEqual(recordedAgentRuns(report),[]);
 assert.deepEqual(recordedAgentRuns({multiagent:{runs:{}}}),[]);
});
