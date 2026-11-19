import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export const pythonPath=()=>process.env.PAPERAZZI_PYTHON||root+'.venv/bin/python';
export function runSearcher(payload,token,signal){
 return new Promise((resolve,reject)=>{
  if(!existsSync(pythonPath()))return reject(new Error('Install the Searcher dependencies in .venv first. See README.'));
  const child=spawn(pythonPath(),['-m','agents.searcher'],{cwd:root,env:{...process.env,PAPERAZZI_BRIDGE_TOKEN:token},stdio:['pipe','pipe','ignore']});
  let output='',settled=false;
  const finish=(err,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);child.kill();err?reject(err):resolve(result);};
  const cancel=()=>finish(new Error('Searcher run cancelled.'));
  const timer=setTimeout(()=>finish(new Error('Searcher reached the three-minute runtime limit.')),180000);
  signal?.addEventListener('abort',cancel,{once:true});
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>1500000)finish(new Error('Searcher trace exceeded the output limit.'));});
  child.on('error',()=>finish(new Error('Unable to start the Python Searcher.')));
  child.on('exit',code=>{if(settled)return;try{if(code!==0)throw new Error();finish(null,JSON.parse(output));}catch{finish(new Error('Searcher returned an invalid response. Check its dependencies.'));}});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(payload));
 });
}
