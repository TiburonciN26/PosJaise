import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {sanearCarpetas,sanearJSONTexto,sanearAdjuntoBase64,sanearTexto} from './sanear-salidas.mjs';
// QA-048: la higiene va ANTES y DESPUÉS de decodificar los anexos base64. (1) Se redacta el reporte entero (incluidos los
// anexos de texto en base64) antes de escribir report.json; (2) cada anexo de texto se redacta al decodificarlo; (3) al
// final se sanea toda la carpeta archivada. Las capturas PNG/PDF no se pueden redactar y requieren revisión manual.
console.log('Higiene de salidas:',await sanearCarpetas(['tests/e2e/artifacts','tests/e2e/results']));
const phase=process.argv[2],source=process.argv[3]??'tests/e2e/results/results.json';
if(!/^[a-z0-9-]+$/.test(phase??''))throw new Error('Use a simple QA phase identifier.');
const report=JSON.parse(sanearJSONTexto(await readFile(source,'utf8'))),dir=`tests/e2e/results/phases/${phase}`;
await mkdir(dir,{recursive:true});await writeFile(`${dir}/report.json`,JSON.stringify(report,null,2));
const index=[];
function visit(suite){for(const spec of suite.specs??[])for(const t of spec.tests??[]){const r=t.results.at(-1);index.push({title:spec.title,expected:t.expectedStatus,obtained:r?.status,attachments:r?.attachments??[]});}for(const s of suite.suites??[])visit(s);}
for(const s of report.suites)visit(s);
for(let i=0;i<index.length;i++)for(const a of index[i].attachments){if(!a.body)continue;const suffix=({'image/png':'png','application/pdf':'pdf','text/plain':'txt'})[a.contentType]??'json';const path=`${dir}/${String(i+1).padStart(2,'0')}-${a.name.replace(/[^a-z0-9-]/gi,'-')}.${suffix}`;await writeFile(path,Buffer.from(sanearAdjuntoBase64(a.contentType,a.body),'base64'));a.archivedPath=path;delete a.body;}
await writeFile(`${dir}/index.json`,sanearJSONTexto(JSON.stringify(index,null,2)));
console.log('Higiene de lo archivado:',await sanearCarpetas([dir]));console.log(`Archived ${index.length} cases in ${dir}`);
