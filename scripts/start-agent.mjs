// Optional local launcher: credentials stay in this process, never in a file.
if(!process.env.OPENROUTER_API_KEY){
 if(!process.stdin.isTTY)throw new Error('Set OPENROUTER_API_KEY or run this launcher in an interactive terminal.');
 process.stderr.write('Workshop OpenRouter key (hidden input): ');
 process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');
 const key=await new Promise((resolve,reject)=>{
  let value='';const done=()=>{process.stdin.removeListener('data',read);process.stdin.setRawMode(false);process.stdin.pause();process.stderr.write('\n');resolve(value.trim());};
  function read(chunk){for(const c of chunk){if(c==='\u0003')process.exit(130);if(c==='\r'||c==='\n'){done();return;}if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else value+=c;if(value.length>1024){done();return;}}}
  process.stdin.on('data',read);process.stdin.resume();
 });
 if(!key.startsWith('sk-or-')||key.length<30)throw new Error('An OpenRouter workshop key is required.');
 process.env.OPENROUTER_API_KEY=key;
}
await import('./dev.mjs');
