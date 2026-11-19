"""Reader decisions and resume semantics exercised through the actual LangChain loop."""
import unittest
from test_searcher import ScriptedModel, PAPER
from test_review_agents import DOC, PASSAGE, CLUSTER, QUOTE
from agents.review_agents import run_reader
from agents.searcher import SearchRequest, run_searcher

REQUEST={'query':'fixture functional outcome','missing_evidence':'Functional outcomes after editing are not described.',
         'why_needed':'The question asks about function, not just editing.', 'checked_passage_ids':['p1x1']}
GAP={'id':'g1','query':REQUEST['query'],'missingEvidence':REQUEST['missing_evidence'],
     'whyNeeded':REQUEST['why_needed'],'checkedPassageIds':['p1x1'],'status':'pending'}
PAPER2={**PAPER,'id':'fixture:2','number':2,'title':'Second fixture'}
PASSAGE2={**PASSAGE,'id':'p2x1','paperId':'fixture:2','sourceNumber':2,
          'text':'The synthetic follow-up study measured functional outcomes after editing.'}
DOC2={**PAPER2,'evidencePassages':[PASSAGE2],'document':{'mode':'full_text_xml','passageCount':1}}
CLUSTER2={**CLUSTER,'id':'c2','claim':PASSAGE2['text'],'evidence':[{'passageId':'p2x1','stance':'supports','conditions':'Synthetic follow-up'}]}

class ReaderGapTests(unittest.TestCase):
 def test_reader_requests_a_grounded_search_and_suspends(self):
  result=run_reader({'query':'fixture','papers':[PAPER],'followupBudget':1},
   ScriptedModel(responses=[('open_papers',{'paper_ids':['fixture:1']}),
    ('read_passages',{'paper_id':'fixture:1'}),('request_followup_search',REQUEST)]),lambda p:DOC)
  self.assertEqual(result['status'],'needs_search')
  self.assertEqual(result['stopReason'],'reader_requested_followup')
  self.assertEqual(result['searchRequest']['query'],REQUEST['query'])
  self.assertEqual(result['readPassageIds'],['p1x1'])
  self.assertNotIn('clusters',result)

 def test_unread_gap_evidence_is_rejected_and_model_can_recover(self):
  bad={**REQUEST,'checked_passage_ids':['invented']}
  result=run_reader({'query':'fixture','papers':[PAPER],'followupBudget':1},
   ScriptedModel(responses=[('open_papers',{'paper_ids':['fixture:1']}),
    ('read_passages',{'paper_id':'fixture:1'}),('request_followup_search',bad),
    ('request_followup_search',REQUEST)]),lambda p:DOC)
  self.assertEqual(result['status'],'needs_search')
  self.assertTrue(any('actually inspected' in str(e.get('result')) for e in result['trace']))

 def test_resume_keeps_original_ids_and_requires_new_sources_to_be_read(self):
  fetched=[]
  def retrieve(p):fetched.append(p['id']);return DOC2
  assessment={'gap_id':'g1','status':'resolved','explanation':'The new inspected passage directly reports the missing outcome.',
              'evidence_passage_ids':['p2x1']}
  result=run_reader({'query':'fixture','papers':[DOC,PAPER2],
   'readerState':{'readPassageIds':['p1x1'],'excluded':{}},'evidenceGaps':[GAP],
   'followupBudget':0,'followupResult':{'status':'new_sources','newPaperIds':['fixture:2']}},
   ScriptedModel(responses=[('open_papers',{'paper_ids':['fixture:2']}),
    ('read_passages',{'paper_id':'fixture:2'}),
    ('finish_reading',{'clusters':[CLUSTER,CLUSTER2],'note':'Reassessed with a new source.',
                      'gap_assessments':[assessment]})]),retrieve)
  self.assertEqual(result['status'],'complete')
  self.assertEqual(fetched,['fixture:2'])
  self.assertEqual(result['readPassageIds'],['p1x1','p2x1'])
  self.assertEqual(result['evidenceGaps'][0]['status'],'resolved')
  self.assertEqual(result['papers'][0]['evidencePassages'][0]['id'],'p1x1')

 def test_budget_exhaustion_preserves_unresolved_gap(self):
  unresolved={'gap_id':'g1','status':'unresolved','explanation':'No additional usable evidence was returned.',
              'evidence_passage_ids':[]}
  result=run_reader({'query':'fixture','papers':[DOC],
   'readerState':{'readPassageIds':['p1x1']},'evidenceGaps':[GAP],'followupBudget':0,
   'followupResult':{'status':'no_new_sources','newPaperIds':[]}},ScriptedModel(responses=[
    ('request_followup_search',REQUEST),('finish_reading',{'clusters':[CLUSTER],'note':'Gap remains.',
     'gap_assessments':[unresolved]})]),lambda p:self.fail('Existing parsed papers should not be retrieved again.'))
  self.assertEqual(result['status'],'complete')
  self.assertEqual(result['evidenceGaps'][0]['status'],'unresolved')
  self.assertNotIn('searchRequest',result)
  self.assertTrue(any('budget exhausted' in str(e.get('result')) for e in result['trace']))

 def test_gap_cannot_resolve_from_old_or_missing_evidence(self):
  wrong={'gap_id':'g1','status':'resolved','explanation':'Attempt to resolve without new evidence.',
         'evidence_passage_ids':['p1x1']}
  unresolved={**wrong,'status':'unresolved','evidence_passage_ids':[]}
  result=run_reader({'query':'fixture','papers':[DOC],
   'readerState':{'readPassageIds':['p1x1']},'evidenceGaps':[GAP],'followupBudget':0},
   ScriptedModel(responses=[('finish_reading',{'clusters':[CLUSTER],'note':'Invalid resolution.',
     'gap_assessments':[wrong]}),('finish_reading',{'clusters':[CLUSTER],'note':'Gap remains.',
     'gap_assessments':[unresolved]})]))
  self.assertEqual(result['status'],'complete')
  self.assertEqual(result['evidenceGaps'][0]['status'],'unresolved')
  self.assertTrue(any('newly inspected evidence' in str(e.get('result')) for e in result['trace']))

 def test_requested_gap_cannot_disappear_from_final_output(self):
  result=run_reader({'query':'fixture','papers':[DOC],
   'readerState':{'readPassageIds':['p1x1']},'evidenceGaps':[GAP],'followupBudget':0},
   ScriptedModel(responses=[('finish_reading',{'clusters':[CLUSTER],'note':'Omit the gap.'})]))
  self.assertEqual(result['status'],'incomplete')
  self.assertNotIn('evidenceGaps',result)

 def test_reader_recovers_from_invalid_offset_using_section_feedback(self):
  result=run_reader({'query':'fixture','papers':[PAPER]},ScriptedModel(responses=[
   ('open_papers',{'paper_ids':['fixture:1']}),
   ('read_passages',{'paper_id':'fixture:1','section':'Results','start':20}),
   ('read_passages',{'paper_id':'fixture:1','section':'Results','start':0}),
   ('finish_reading',{'clusters':[CLUSTER],'note':'Corrected the offset.'})]),lambda p:DOC)
  self.assertEqual(result['status'],'complete')
  self.assertEqual(result['readPassageIds'],['p1x1'])
  self.assertTrue(any('validStartRange' in str(e.get('result')) for e in result['trace']))
  self.assertTrue(any('runBudget' in str(e.get('result')) for e in result['trace']))

 def test_pdf_page_labels_match_the_requested_page(self):
  p1={**PASSAGE,'location':{'kind':'page','page':1}}
  p10={**PASSAGE,'id':'p1x2','location':{'kind':'page','page':10}}
  doc={**DOC,'evidencePassages':[p1,p10]}
  result=run_reader({'query':'fixture','papers':[PAPER]},ScriptedModel(responses=[
   ('open_papers',{'paper_ids':['fixture:1']}),
   ('read_passages',{'paper_id':'fixture:1','section':'Page 1'}),
   ('finish_reading',{'clusters':[CLUSTER],'note':'Read just the requested page.'})]),lambda p:doc)
  self.assertEqual(result['status'],'complete')
  self.assertEqual(result['readPassageIds'],['p1x1'])

 def test_repeated_windows_omit_text_unless_explicitly_reread(self):
  import json
  result=run_reader({'query':'fixture','papers':[PAPER]},ScriptedModel(responses=[
   ('open_papers',{'paper_ids':['fixture:1']}),
   ('read_passages',{'paper_id':'fixture:1'}),
   ('read_passages',{'paper_id':'fixture:1','reread':True}),
   ('finish_reading',{'clusters':[CLUSTER],'note':'Used explicit rereading.'})]),lambda p:DOC)
  self.assertEqual(result['status'],'complete')
  reads=[json.loads(e['result']) for e in result['trace'] if e['kind']=='tool_result' and e['name']=='read_passages']
  self.assertEqual(reads[0]['passages'],[])
  self.assertEqual(reads[0]['alreadyReadPassageIds'],['p1x1'])
  self.assertEqual(reads[1]['passages'][0]['text'],QUOTE)

 def test_reader_harness_requires_tool_actions(self):
  class CaptureModel(ScriptedModel):
   choices: list = []
   def bind_tools(self,tools,**kwargs):
    self.choices.append(kwargs.get('tool_choice'))
    return self
  model=CaptureModel(responses=[('open_papers',{'paper_ids':['fixture:1']}),
   ('finish_reading',{'clusters':[CLUSTER],'note':'Structured extraction complete.'})])
  result=run_reader({'query':'fixture','papers':[PAPER]},model,lambda p:DOC)
  self.assertEqual(result['status'],'complete')
  self.assertTrue(model.choices)
  self.assertTrue(all(choice=='required' for choice in model.choices))

 def test_searcher_excludes_previously_reviewed_ids(self):
  result=run_searcher(SearchRequest(query='fixture',exclude_ids=['fixture:1']),
   model=ScriptedModel(responses=[('search_literature',{'query':'fixture topic'}),
    ('inspect_sources',{'paper_ids':['fixture:1']}),
    ('finish_search',{'paper_ids':[],'note':'No new sources found.'})]),
   retrieve=lambda q,r:{'papers':[PAPER]})
  self.assertEqual(result['status'],'complete')
  self.assertEqual(result['papers'],[])
  self.assertEqual(result['retrievedCount'],0)

if __name__=='__main__':unittest.main()


class ReaderBudgetTests(unittest.TestCase):
 def test_passage_windows_keep_quotes_intact_and_return_the_actual_next_offset(self):
  import json
  passages=[{**PASSAGE,'id':f'p1x{i+1}','text':('Synthetic evidence '+str(i)+' ')*80} for i in range(10)]
  doc={**DOC,'evidencePassages':passages}
  claim={**CLUSTER,'evidence':[{'passageId':'p1x1','stance':'supports','conditions':'Fixture'}]}
  result=run_reader({'query':'fixture','papers':[PAPER]},ScriptedModel(responses=[
   ('open_papers',{'paper_ids':['fixture:1']}),
   ('read_passages',{'paper_id':'fixture:1','start':0}),
   ('read_passages',{'paper_id':'fixture:1','start':3}),
   ('finish_reading',{'clusters':[claim],'note':'Bounded reading completed.'})]),lambda p:doc)
  reads=[json.loads(e['result']) for e in result['trace'] if e['kind']=='tool_result' and e['name']=='read_passages']
  self.assertEqual(result['status'],'complete')
  self.assertEqual(reads[0]['nextStart'],3)
  self.assertEqual(reads[1]['nextStart'],6)
  for window in reads:
   self.assertLessEqual(window['returnedCharacters'],6000)
   self.assertLessEqual(len(window['passages']),4)
   for p in window['passages']:
    self.assertEqual(p['text'],next(original['text'] for original in passages if original['id']==p['id']))

 def test_cumulative_usage_switches_reader_to_finishing_before_the_hard_guard(self):
  class UsageModel(ScriptedModel):
   offered_tools: list = []
   def bind_tools(self,tools,**kwargs):
    self.offered_tools.append([t.name if hasattr(t,'name') else t.get('name') for t in tools])
    return self
   def _generate(self,*args,**kwargs):
    result=super()._generate(*args,**kwargs)
    result.generations[0].message.usage_metadata={'input_tokens':19900,'output_tokens':100,'total_tokens':20000}
    return result
  model=UsageModel(responses=[('open_papers',{'paper_ids':['fixture:1']}),
   ('read_passages',{'paper_id':'fixture:1'}),
   ('finish_reading',{'clusters':[CLUSTER],'note':'Finished from inspected evidence.'})])
  result=run_reader({'query':'fixture','papers':[PAPER]},model,lambda p:DOC)
  self.assertEqual(result['status'],'complete')
  self.assertEqual(result['counts']['tokens'],60000)
  self.assertEqual(model.offered_tools[-1],['finish_reading'])
  self.assertTrue(result['limits']['finishingMode'])
  self.assertTrue(any(e['kind']=='budget_notice' for e in result['trace']))

 def test_hard_guard_is_explicitly_a_local_cumulative_budget(self):
  class HugeUsage(ScriptedModel):
   def _generate(self,*args,**kwargs):
    result=super()._generate(*args,**kwargs)
    result.generations[0].message.usage_metadata={'input_tokens':79900,'output_tokens':100,'total_tokens':80000}
    return result
  result=run_reader({'query':'fixture','papers':[PAPER]},HugeUsage(responses=[
   ('open_papers',{'paper_ids':['fixture:1']}),('finish_reading',{'clusters':[CLUSTER],'note':'Too late.'})]),lambda p:DOC)
  self.assertEqual(result['status'],'incomplete')
  self.assertEqual(result['stopReason'],'local_token_budget')
  self.assertEqual(result['limits']['observedTokens'],75000)
