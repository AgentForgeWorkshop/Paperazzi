import unittest
import httpx
from unittest.mock import patch
from test_searcher import ScriptedModel, PAPER
from agents.documents import parse_jats, retrieve_document
from agents.review_agents import run_reader, run_generator, run_judge

QUOTE='Method M improved accuracy on dataset D in this synthetic test.'
PASSAGE={'id':'p1x1','paperId':'fixture:1','sourceNumber':1,'text':QUOTE,'location':{'kind':'section','section':'Results','elementId':'r1'}}
DOC={**PAPER,'number':1,'evidencePassages':[PASSAGE], 'document':{'mode':'full_text_xml','passageCount':1}}
CLUSTER={'id':'c1','claim':QUOTE,'conditions':'Synthetic dataset D','relation':'atomic',
         'evidence':[{'passageId':'p1x1','stance':'supports','conditions':'Synthetic dataset D'}]}
CLAIM={**CLUSTER,'sourceNumbers':[1],'evidence':[{'id':'e1','paperId':'fixture:1','quote':QUOTE,'sourceNumber':1,'location':PASSAGE['location']}]}
DRAFT=[{'sentences':[{'text':QUOTE,'claimIds':['c1']}]}]
STATEMENT={'id':'s1','text':QUOTE,'snippets':[{'paperId':'fixture:1','text':QUOTE}]}
EVAL={'status':'complete','counts':{'support':{'total':1},'relevance':{'total':1}},'statements':[
 {'id':'s1','text':QUOTE,'support':{'rating':'Fully supported','analysis':'Fixture'},
  'relevance':[{'rating':'Relevant','paperId':'fixture:1','snippet':QUOTE}]}]}

class SpecialistTests(unittest.TestCase):
 def test_reader_chooses_sections_and_returns_exact_evidence(self):
  model=ScriptedModel(responses=[('open_papers',{'paper_ids':['fixture:1']}),
   ('read_passages',{'paper_id':'fixture:1','section':'Methods'}),
   ('read_passages',{'paper_id':'fixture:1','section':'Results'}),
   ('finish_reading',{'clusters':[CLUSTER],'note':'Read results after no methods matches.'})])
  result=run_reader({'query':'fixture topic','papers':[PAPER]},model,lambda p:DOC)
  self.assertEqual(result['status'],'complete')
  self.assertEqual(result['readPassageIds'],['p1x1'])
  self.assertEqual(result['papers'][0]['document']['mode'],'full_text_xml')
  self.assertEqual(result['counts']['modelCalls'],4)

 def test_reader_cannot_cite_unread_passages(self):
  unread={**CLUSTER,'evidence':[{**CLUSTER['evidence'][0],'passageId':'p1x2'}]}
  doc={**DOC,'evidencePassages':[PASSAGE,{**PASSAGE,'id':'p1x2','text':'Another synthetic passage not returned in the opening preview.'}]}
  result=run_reader({'query':'fixture topic','papers':[PAPER]},ScriptedModel(responses=[
   ('open_papers',{'paper_ids':['fixture:1']}),
   ('finish_reading',{'clusters':[unread],'note':'Not read.'})]),lambda p:doc)
  self.assertEqual(result['status'],'incomplete')
  self.assertNotIn('clusters',result)

 def test_reader_cannot_invent_passage_ids(self):
  bad={**CLUSTER,'evidence':[{**CLUSTER['evidence'][0],'passageId':'invented'}]}
  result=run_reader({'query':'fixture topic','papers':[PAPER]},ScriptedModel(responses=[
   ('open_papers',{'paper_ids':['fixture:1']}),('read_passages',{'paper_id':'fixture:1'}),
   ('finish_reading',{'clusters':[bad],'note':'Invalid reference.'})]),lambda p:DOC)
  self.assertEqual(result['status'],'incomplete')

 def test_generator_can_correct_a_rejected_draft(self):
  invalid=[{'sentences':[{'text':QUOTE,'claimIds':['invented']}]}]
  result=run_generator({'query':'fixture','claims':[CLAIM],'writingPlan':[]},
   ScriptedModel(responses=[('inspect_claims',{'claim_ids':['c1']}),
    ('submit_draft',{'paragraphs':invalid}),('submit_draft',{'paragraphs':DRAFT}),
    ('finish_writing',{'note':'Corrected the citation.'})]))
  self.assertEqual(result['status'],'complete')
  self.assertEqual(result['written']['paragraphs'],DRAFT)
  self.assertEqual(result['counts']['modelCalls'],4)

 def test_generator_cannot_finish_without_submitting(self):
  result=run_generator({'query':'fixture','claims':[CLAIM],'writingPlan':[]},
   ScriptedModel(responses=[('finish_writing',{'note':'No draft.'})]))
  self.assertEqual(result['status'],'incomplete')

 def test_judge_inspects_and_uses_both_rubrics(self):
  result=run_judge({'query':'fixture','statements':[STATEMENT]},
   ScriptedModel(responses=[('inspect_evidence',{'statement_ids':['s1']}),('run_rubrics',{}),
    ('finish_judging',{'note':'Checked all evidence.'})]),lambda p:EVAL)
  self.assertEqual(result['status'],'complete')
  self.assertEqual(result['decision'],'pass')
  self.assertEqual([e['name'] for e in result['trace'] if e['kind']=='tool_call'],
                   ['inspect_evidence','run_rubrics','finish_judging'])

 def test_judge_cannot_finish_without_inspection_and_ratings(self):
  result=run_judge({'query':'fixture','statements':[STATEMENT]},
   ScriptedModel(responses=[('finish_judging',{'note':'Invented pass.'})]),lambda p:EVAL)
  self.assertEqual(result['status'],'incomplete')
  self.assertNotIn('decision',result)

 def test_judge_must_report_failed_ratings_as_revision(self):
  failed={**EVAL,'statements':[{**EVAL['statements'][0],'support':{'rating':'No support','analysis':'Fixture failure'}}]}
  result=run_judge({'query':'fixture','statements':[STATEMENT]},ScriptedModel(responses=[
   ('inspect_evidence',{'statement_ids':['s1']}),('run_rubrics',{}),
   ('finish_judging',{'note':'Try to pass this.'})]),lambda p:failed)
  self.assertEqual(result['decision'],'revise')

 def test_pubmed_maps_to_pmc_and_retrieves_full_text(self):
  xml=b'<article><body><sec><title>Results</title><p id="r1">This fixture result has enough text to extract and cite.</p></sec></body></article>'
  def respond(request):
   if request.url.path.endswith('elink.fcgi'):
    self.assertEqual(request.url.params['id'],'123')
    return httpx.Response(200,json={'linksets':[{'linksetdbs':[{'dbto':'pmc','links':['456']}]}]})
   self.assertTrue(request.url.path.endswith('efetch.fcgi'))
   self.assertEqual(request.url.params['db'],'pmc')
   self.assertEqual(request.url.params['id'],'456')
   return httpx.Response(200,content=xml)
  client=httpx.Client(transport=httpx.MockTransport(respond))
  with patch('agents.documents.httpx.Client',return_value=client):
   doc=retrieve_document({**PAPER,'id':'pubmed:123','number':1})
  self.assertEqual(doc['document']['mode'],'full_text_xml')
  self.assertEqual(doc['evidencePassages'][0]['location']['section'],'Results')

 def test_parser_preserves_section_and_element_locations(self):
  xml=b'<article><body><sec><title>Results</title><p id="r1">Method M improved accuracy on dataset D.</p></sec></body></article>'
  items=parse_jats({**PAPER,'number':1},xml)
  self.assertEqual(items[0]['location']['section'],'Results')
  self.assertEqual(items[0]['location']['elementId'],'r1')

 def test_parser_rejects_entities_and_labels_fallback(self):
  with self.assertRaises(ValueError):parse_jats(DOC,b'<!ENTITY exploit SYSTEM "file:///secret"><article/>')
  doc=retrieve_document({**PAPER,'id':'unsupported','number':1})
  self.assertEqual(doc['document']['mode'],'abstract_only')
  self.assertEqual(doc['evidencePassages'][0]['location']['kind'],'abstract')

if __name__=='__main__':unittest.main()
