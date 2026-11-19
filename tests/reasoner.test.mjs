import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {runReasoning} from '../backend/review_reasoner.mjs';
const doc=(id,cluster,features,score=.95)=>({id,score,cluster,features,metadata:{paper_id:id}});
const cases=[
 {documents:[]},
 {documents:[doc('a','x',[['result','improved']])]},
 {documents:[doc('a','x',[['result','improved']]),doc('b','x',[['result','improved']])]},
 {documents:[doc('a','x',[['result','improved']]),doc('b','x',[['result','worse']])]},
 {documents:[doc('a','x',[['method','A'],['dataset','B']])]},
 {documents:[doc('a','x',[]),doc('b','y',[['result',1]],.1)],expected_clusters:['z']},
 {documents:[doc('a','x',[['result','improved']]),doc('b','x',[['result','improved']])],cluster_relations:{x:'interleaved'}},
 {documents:[doc('a','x',[['result',{a:[1,2],b:3}]]),doc('b','x',[['result',{b:3,a:[1,2]}]])]},
 {documents:[doc('a','x',[['result',true]]),doc('b','x',[['result',1]])]},
];
test('hosted translation matches original Python for empty, merged, conflicting and filtered clusters',()=>{const modulePath=new URL('../backend/review_reasoner.py',import.meta.url).pathname;const script="import sys,json,importlib.util\nspec=importlib.util.spec_from_file_location('rr',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\npayloads=json.load(sys.stdin)\nprint(json.dumps([m.run_reasoning(p) for p in payloads]))";const expected=JSON.parse(execFileSync('python3',['-c',script,modulePath],{input:JSON.stringify(cases),encoding:'utf8'}));assert.deepEqual(cases.map(p=>runReasoning(p)),expected);});
test('reasoner rejects invalid scores and conflicting missing assignments',()=>{assert.throws(()=>runReasoning({documents:[doc('a','x',[['result',1]],true)]}),/score/);assert.throws(()=>runReasoning({documents:[doc('a','x',[['result',1]])],cluster_relations:{x:'missing'}}),/cannot be missing/);});
