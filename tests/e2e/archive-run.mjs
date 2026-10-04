import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {sanearCarpetas} from './sanear-salidas.mjs';
// Antes de archivar: redactar cualquier valor de contraseña que Playwright haya dejado en sus salidas de texto.
console.log('Higiene de salidas:',await sanearCarpetas(['tests/e2e/artifacts','tests/e2e/results']));
const phase=process.argv[2],source=process.argv[3]??'tests/e2e/results/results.json';
if(!/^[a-z0-9-]+$/.test(phase??''))throw new Error('Use a simple QA phase identifier.');
const report=JSON.parse(await readFile(source,'utf8')),dir=`tests/e2e/results/phases/${phase}`;
await mkdir(dir,{recursive:true});await writeFile(`${dir}/report.json`,JSON.stringify(report,null,2));
const index=[];
function visit(suite){for(const spec of suite.specs??[])for(const t of spec.tests??[]){const r=t.results.at(-1);index.push({title:spec.title,expected:t.expectedStatus,obtained:r?.status,attachments:r?.attachments??[]});}for(const s of suite.suites??[])visit(s);}
for(const s of report.suites)visit(s);
for(let i=0;i<index.length;i++)for(const a of index[i].attachments){if(!a.body)continue;const suffix=({'image/png':'png','application/pdf':'pdf','text/plain':'txt'})[a.contentType]??'json';const path=`${dir}/${String(i+1).padStart(2,'0')}-${a.name.replace(/[^a-z0-9-]/gi,'-')}.${suffix}`;await writeFile(path,Buffer.from(a.body,'base64'));a.archivedPath=path;delete a.body;}
await writeFile(`${dir}/index.json`,JSON.stringify(index,null,2));console.log(`Archived ${index.length} cases in ${dir}`);
