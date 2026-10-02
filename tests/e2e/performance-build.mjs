// Diagnostic production artifacts only; no app, .env or dependency edits.
import {assertLocalTest} from './local-safety.mjs';
import {execFileSync} from 'node:child_process';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
await assertLocalTest();
const moduleText=await (await fetch('http://localhost:5173/src/lib/supabase.js')).text();
const anon=moduleText.match(/"VITE_SUPABASE_ANON_KEY"\s*:\s*"([^"]+)"/)?.[1];
if(!anon)throw new Error('Local public anon unavailable; no build.');
const output='tests/e2e/results/performance/build';
const log=execFileSync(process.execPath,['node_modules/vite/bin/vite.js','build','--outDir',output,'--emptyOutDir','false'],{encoding:'utf8',env:{...process.env,VITE_SUPABASE_URL:'http://127.0.0.1:54321',VITE_SUPABASE_ANON_KEY:anon},maxBuffer:10*1024*1024});
await writeFile('tests/e2e/results/performance/build.log',log);
const files=[];async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+item.name;if(item.isDirectory())await walk(p);else{const b=await readFile(p);files.push({path:p.slice(output.length+1),bytes:b.length,gzipBytes:gzipSync(b).length});}}}await walk(output);
await writeFile('tests/e2e/results/performance/build-size.json',JSON.stringify({environment:'Production build using local public credentials in process, existing config unchanged',files},null,2));
console.log(log.slice(-3200));console.log('Diagnostic build saved under QA results.');
