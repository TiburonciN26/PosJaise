import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {expect} from 'playwright/test';
import {assertLocalTest,localNetworkOnly} from './local-safety.mjs';
import {login,formWithTitle,visibleButton} from './helpers.mjs';
await assertLocalTest();
const data=JSON.parse(await readFile('tests/e2e/fixtures/runtime.json','utf8'));
const own=JSON.parse(await readFile('tests/e2e/results/performance/writes.json','utf8'));
const report={environment:'Local TEST; own unused fictitious records only',operations:[],records:[],errors:[]};
const browser=await chromium.launch({headless:true});const ctx=await browser.newContext({baseURL:'http://localhost:5173',viewport:{width:1440,height:900},serviceWorkers:'block'});await localNetworkOnly(ctx);const page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(e.message));
async function timed(name,predicate,action,feedback){await assertLocalTest();const start=performance.now();const pending=page.waitForResponse(predicate);await action();const r=await pending;await r.finished();expect(r.ok()).toBeTruthy();const responseMs=performance.now()-start;await feedback();const op={name,status:r.status(),responseMs,feedbackMs:performance.now()-start};report.operations.push(op);console.log(JSON.stringify(op));}
try{
  await login(page,'ADMINISTRADOR',data);
  for(const item of [{type:'producto',table:'productos',path:'/inventario',record:own.products[2],price:'2',label:'Precio de venta'},{type:'servicio',table:'servicios',path:'/servicios',record:own.services[2],price:'3',label:'Precio'}]){
    const {record,type,table,path,price,label}=item;
    if(!record.name.startsWith(own.prefix))throw new Error('Not own TEST record');
    await page.goto(path);await page.getByPlaceholder(`Buscar ${type}...`).fill(record.name);
    const row=()=>page.getByRole('row').filter({hasText:record.name});await row().getByRole('button',{name:'Editar',exact:true}).click();
    const form=formWithTitle(page,`Editar ${type}`);await form.getByLabel(label,{exact:false}).first().fill(price);
    await timed(`Editar ${type}`,r=>r.url().includes(`/rest/v1/${table}?`)&&r.request().method()==='PATCH',()=>form.getByRole('button',{name:'Guardar cambios',exact:true}).click(),()=>expect(form).toHaveCount(0));
    await page.reload();await page.getByPlaceholder(`Buscar ${type}...`).fill(record.name);await expect(row()).toContainText(`${price}.00`);
    await row().getByRole('button',{name:'Eliminar',exact:true}).click();
    await timed(`Eliminar ${type} sin movimientos`,r=>r.url().includes(`/rpc/eliminar_${type}`),()=>visibleButton(page,'Sí, eliminar').click(),()=>expect(visibleButton(page,'Sí, eliminar')).toHaveCount(0));
    await page.reload();await page.getByPlaceholder(`Buscar ${type}...`).fill(record.name);await expect(row()).toHaveCount(0);report.records.push({...record,type,editedPrice:price,persistedBeforeDelete:true,deletedAfterReload:true});
  }
}finally{await browser.close();await writeFile('tests/e2e/results/performance/updates.json',JSON.stringify(report,null,2));}
