"""Real LangChain loop, scripted decisions, fixture literature. No API calls."""
import unittest
from typing import Any
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from agents.searcher import SearchRequest, run_searcher, redact, build_model
from unittest.mock import patch


class ScriptedModel(BaseChatModel):
    responses: list[Any]
    index: int = 0

    @property
    def _llm_type(self):
        return 'scripted-test-model'

    def bind_tools(self, tools, **kwargs):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        value = self.responses[min(self.index, len(self.responses)-1)]
        self.index += 1
        if isinstance(value, str):
            message = AIMessage(content=value)
        else:
            name, args = value
            message = AIMessage(content='', tool_calls=[{'name':name,'args':args,'id':f'call-{self.index}'}])
        return ChatResult(generations=[ChatGeneration(message=message)])


PAPER = {'id':'fixture:1','title':'Fixture paper','abstract':'A synthetic abstract for testing source selection only.',
         'url':'https://example.org/fixture','source':'Fixture','year':2025}


class SearcherTests(unittest.TestCase):
    def test_model_timeout_and_sdk_retries_are_explicit(self):
        with patch.dict('os.environ', {'OPENROUTER_API_KEY':'test-placeholder'}):
            model = build_model()
        self.assertEqual(model.request_timeout,45000)
        self.assertEqual(model.client.sdk_configuration.retry_config.strategy,'none')

    def run_fixture(self, responses, retrieve=None):
        return run_searcher(SearchRequest(query='fixture topic'), model=ScriptedModel(responses=responses),
                            retrieve=retrieve or (lambda q,r:{'database':'Fixture','papers':[PAPER]}))

    def test_real_harness_searches_inspects_and_finishes(self):
        r=self.run_fixture([('search_literature',{'query':'fixture topic'}),
            ('inspect_sources',{'paper_ids':['fixture:1']}),
            ('finish_search',{'paper_ids':['fixture:1'],'note':'Selected the inspected fixture.'})])
        self.assertEqual(r['status'],'complete')
        self.assertEqual(r['papers'],[PAPER])
        self.assertEqual(r['counts']['modelCalls'],3)
        self.assertEqual([e['name'] for e in r['trace'] if e['kind']=='tool_call'],
                         ['search_literature','inspect_sources','finish_search'])

    def test_model_can_refine_after_empty_results(self):
        queries=[]
        def retrieve(q,r):
            queries.append(q)
            return {'database':'Fixture','papers':[] if len(queries)==1 else [PAPER]}
        r=self.run_fixture([('search_literature',{'query':'very narrow fixture'}),
            ('search_literature',{'query':'broader fixture'}),('inspect_sources',{'paper_ids':['fixture:1']}),
            ('finish_search',{'paper_ids':['fixture:1'],'note':'Broadened after no results.'})],retrieve)
        self.assertEqual(r['status'],'complete')
        self.assertEqual(queries,['very narrow fixture','broader fixture'])

    def test_uninspected_or_invented_sources_cannot_finish(self):
        for pid in ['fixture:1','fabricated:2']:
            with self.subTest(pid=pid):
                r=self.run_fixture([('search_literature',{'query':'fixture topic'}),
                    ('finish_search',{'paper_ids':[pid],'note':'Invalid selection.'})])
                self.assertNotEqual(r['status'],'complete')
                self.assertEqual(r['papers'],[])

    def test_plain_model_answer_is_not_completed_search(self):
        r=self.run_fixture(['Here are some invented papers.'])
        self.assertEqual(r['status'],'incomplete')
        self.assertEqual(r['papers'],[])

    def test_unknown_id_feedback_enables_correction(self):
        r=self.run_fixture([('search_literature',{'query':'fixture topic'}),
            ('inspect_sources',{'paper_ids':['1']}),
            ('inspect_sources',{'paper_ids':['fixture:1']}),
            ('finish_search',{'paper_ids':['fixture:1'],'note':'Corrected the full source ID.'})])
        self.assertEqual(r['status'],'complete')
        errors=[e for e in r['trace'] if e['kind']=='tool_result' and 'availableIds' in e['result']]
        self.assertEqual(len(errors),1)
        self.assertIn('fixture:1',errors[0]['result'])

    def test_repeated_search_is_bounded(self):
        calls=[]
        r=self.run_fixture([('search_literature',{'query':'fixture topic'})],
                           lambda q,r:(calls.append(q) or {'papers':[]}))
        self.assertEqual(len(calls),3)
        self.assertEqual(r['counts']['modelCalls'],5)
        self.assertEqual(r['status'],'incomplete')
        self.assertEqual(r['stopReason'],'model_call_limit')

    def test_empty_evidence_is_explicit_and_credentials_redacted(self):
        r=self.run_fixture([('search_literature',{'query':'fixture topic'}),
            ('finish_search',{'paper_ids':[],'note':'No usable evidence.'})],lambda q,r:{'papers':[]})
        self.assertEqual(r['papers'],[])
        self.assertEqual(r['note'],'No usable evidence.')
        self.assertEqual(redact('key sk-test-not-a-real-key'), 'key [redacted]')


if __name__=='__main__':
    unittest.main()
