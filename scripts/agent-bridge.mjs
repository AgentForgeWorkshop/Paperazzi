import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {pythonPath} from './searcher-bridge.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export function runAgent(role,payload,token,signal){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(new Error('Agent run cancelled.'));
  if(!existsSync(pythonPath()))return reject(new Error('Install the agent dependencies in .venv first.'));
  const child=spawn(pythonPath(),['-m','agents.review_agents'],{cwd:root,env:{...process.env,PAPERAZZI_BRIDGE_TOKEN:token},stdio:['pipe','pipe','ignore']});
  let output='',settled=false;
  const finish=(err,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);child.kill();err?reject(err):resolve(result);};
  const cancel=()=>finish(new Error('Agent run cancelled.'));
  const timer=setTimeout(()=>finish(new Error(role+' reached its four-minute runtime limit.')),240000);
  signal?.addEventListener('abort',cancel,{once:true});
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>1500000)finish(new Error('Agent output exceeded its size limit.'));});
  child.on('error',()=>finish(new Error('Unable to start specialist agent.')));
  child.on('exit',code=>{if(settled)return;try{if(code!==0)throw new Error();finish(null,JSON.parse(output));}catch{finish(new Error('Specialist agent returned an invalid response.'));}});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({role,...payload}));
 });
}
