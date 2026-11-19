import {readFile,mkdir,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),assets={};
for(const [path,file,type] of [['/','index.html','text/html; charset=utf-8'],['/styles.css','styles.css','text/css; charset=utf-8'],['/app.js','app.js','text/javascript; charset=utf-8'],['/trace.js','trace.js','text/javascript; charset=utf-8'],['/favicon.svg','favicon.svg','image/svg+xml']])assets[path]={body:await readFile(new URL('public/'+file,root),'utf8'),type};
await mkdir(new URL('dist/server/',root),{recursive:true});await mkdir(new URL('dist/.openai/',root),{recursive:true});
const modules=[];
for(const file of ['backend/review_reasoner.mjs','backend/research.mjs','backend/synthesis.mjs','backend/evaluation.mjs','backend/worker.mjs'])modules.push((await readFile(new URL(file,root),'utf8')).replace(/^import [^\n]+;\n/gm,'').replace(/^export (?!default)/gm,''));
await writeFile(new URL('dist/server/index.js',root),'const ASSETS='+JSON.stringify(assets)+';\n'+modules.join('\n'));
await writeFile(new URL('dist/.openai/hosting.json',root),await readFile(new URL('.openai/hosting.json',root)));
console.log('Built AgentReview: web interface and literature-search API.');
