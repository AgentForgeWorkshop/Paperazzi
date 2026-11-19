import './build.mjs';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {retrievePapers} from '../backend/research.mjs';
import {runSearcher,pythonPath} from './searcher-bridge.mjs';
import {runMultiAgent,evaluateAgentJob,activeProgress} from './multiagent.mjs';
const {default:worker}=await import('../dist/server/index.js');
const bridgeToken=randomUUID();let searcherBusy=false;
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
const server=http.createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://127.0.0.1:4173').pathname;
  if(path==='/api/multiagent-progress')return send(res,200,{...activeProgress});
  if(path==='/api/agent-evaluate'){
   if(req.method!=='POST'||req.headers['x-paperazzi-bridge']!==bridgeToken)return send(res,403,{error:'Internal evaluation endpoint.'});
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1024)return send(res,413,{error:'Request too large.'});}
   const body=JSON.parse(raw);return send(res,200,await evaluateAgentJob(body.jobId,process.env));
  }
  if(path==='/api/searcher'||path==='/api/agent-literature'||path==='/api/multiagent'){
   if(req.method!=='POST')return send(res,405,{error:'Use POST.'});
   if(req.headers.origin&&!['http://127.0.0.1:4173','http://localhost:4173'].includes(req.headers.origin))return send(res,403,{error:'Local requests only.'});
   if(path==='/api/agent-literature'&&req.headers['x-paperazzi-bridge']!==bridgeToken)return send(res,403,{error:'Internal retrieval endpoint.'});
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)return send(res,413,{error:'Request too large.'});}
   let body;try{body=JSON.parse(raw);}catch{return send(res,400,{error:'Send valid JSON.'});}
   if(typeof body?.query!=='string'||body.query.trim().length<3||body.query.length>500||!['pubmed','arxiv','europepmc','semantic'].includes(body.source)||!['all','5'].includes(body.years)||![4,8,12].includes(body.limit))return send(res,400,{error:'Invalid search settings.'});
   const payload={query:body.query.trim(),source:body.source,years:body.years,limit:body.limit};
   if(path==='/api/multiagent'){if(body.limit!==4)return send(res,400,{error:'The multi-agent pilot supports up to four selected papers. Choose 4 papers.'});payload.length=body.length==='detailed'?'detailed':'brief';}
   if(path==='/api/agent-literature'){try{return send(res,200,await retrievePapers(payload.query,payload));}catch(e){return send(res,502,{error:e.message||'Provider unavailable.'});}}
   if(!process.env.OPENROUTER_API_KEY)return send(res,503,{error:'The Searcher needs the workshop OpenRouter key. Start the local app with OPENROUTER_API_KEY configured.'});
   if(searcherBusy)return send(res,409,{error:'A Searcher run is already active. Please wait for it to finish.'});
   searcherBusy=true;const abort=new AbortController();const closed=()=>{if(!res.writableEnded)abort.abort();};res.once('close',closed);
   try{return send(res,200,await (path==='/api/multiagent'?runMultiAgent:runSearcher)(payload,bridgeToken,abort.signal));}finally{searcherBusy=false;res.removeListener('close',closed);}
  }
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const request=new Request('http://127.0.0.1:4173'+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
  const response=await worker.fetch(request,{OPENROUTER_API_KEY:process.env.OPENROUTER_API_KEY,OPENROUTER_MODEL:process.env.OPENROUTER_MODEL,OPENROUTER_JUDGE_MODEL:process.env.OPENROUTER_JUDGE_MODEL});
  if(path==='/api/health'){const health=await response.json();return send(res,200,{...health,searcher:{available:existsSync(pythonPath()),configured:!!process.env.OPENROUTER_API_KEY,model:process.env.OPENROUTER_SEARCHER_MODEL||process.env.OPENROUTER_MODEL||'openai/gpt-4.1-mini',framework:'LangChain create_agent'},multiagent:{available:existsSync(pythonPath()),roles:['Searcher','Reader','Generator','Judge'],paperLimit:4,verification:'not_connected'}});}
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){if(!res.headersSent&&!res.destroyed)send(res,500,{error:e.message?.startsWith('Searcher')||e.message?.startsWith('Install')?e.message:'Local server could not complete the request.'});}
});
server.listen(4173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4173'));
