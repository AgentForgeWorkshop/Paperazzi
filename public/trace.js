export const RELATIONS={
 convergence:{label:'Convergence',meaning:'Findings support the same conclusion.',instruction:'Combine the shared finding and cite its sources.',action:'action_convergence'},
 composition:{label:'Composition',meaning:'Findings provide complementary information.',instruction:'Connect the complementary findings while preserving their scope.',action:'action_composite'},
 interleaved:{label:'Interleaved',meaning:'Findings differ or conflict under the recorded study conditions.',instruction:'Keep the differences and conditions visible in the review.',action:'action_interleaved'},
 atomic:{label:'Atomic',meaning:'A finding stands alone or uses the reasoner’s fallback relation.',instruction:'Report a scoped finding with its source.',action:'action_atomic'},
 missing:{label:'Missing',meaning:'The cluster has no retained evidence.',instruction:'Keep the evidence gap explicit.',action:'action_missing'},
};

// Join the written statement to recorded claim/source IDs, not text similarity.
// A relation record describes writing decisions, never a support verdict.
export function buildStatementTrace(report,statement){
 const claims=new Map((report.claims||[]).map(c=>[c.id,c]));
 const decisions=new Map((report.reasoning?.output?.results||[]).map(r=>[r.cluster,r]));
 const papers=new Map((report.papers||[]).map(p=>[p.id,p]));
 const fallback=new Map((statement.relations||[]).map(r=>[r.claimId,r]));
 const ids=[...new Set(statement.claimIds?.length?statement.claimIds:[...fallback.keys()])];
 return ids.map(id=>{
  const claim=claims.get(id),decision=decisions.get(id),prior=fallback.get(id);
  const relation=decision?.relation||claim?.relation||prior?.relation;
  const info=RELATIONS[relation];
  return {claimId:id,claim:claim?.claim||prior?.claim||'Claim record unavailable.',
   conditions:claim?.conditions||prior?.conditions||'',relation,
   label:info?.label||relation||'Relation unavailable',meaning:info?.meaning||'',
   action:decision?.action||(relation&&info?.action)||prior?.action||null,
   instruction:info?.instruction||'No writing action was recorded.',
   selectedBy:decision?.selected_by||null,hasDecision:!!decision,record:decision||null,
   evidence:(claim?.evidence||[]).map(e=>{
    const paper=papers.get(e.paperId);
    const passage=paper?.evidencePassages?.find(p=>p.id===e.passageId);
    return {...e,title:paper?.title||e.paperId,sourceNumber:paper?.number??e.sourceNumber,
     scope:paper?.document?.mode||'abstract_only',location:e.location||passage?.location||{kind:'abstract'},
     quote:e.quote||passage?.text||''};
   })};
 });
}

export function recordedAgentRuns(report){
 return Array.isArray(report.multiagent?.runs)?report.multiagent.runs:[];
}
