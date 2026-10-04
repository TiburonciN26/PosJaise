import {test,expect} from './fixtures.mjs';
import {login,logout,createProduct,visibleButton,buscadorCaja} from './helpers.mjs';
import {qaContext} from './phase2-helpers.mjs';

async function prepare(page,p,data){await login(page,'CAJERA',data);await page.goto('/ventas');await (await buscadorCaja(page)).fill(p.productName);await page.getByRole('button',{name:new RegExp(p.productName)}).click();await visibleButton(page,'Yape').click();await expect(visibleButton(page,'Confirmar venta')).toBeEnabled();}
async function stock(page,name,n){await page.goto('/inventario');await page.getByPlaceholder('Buscar producto...').fill(name);await expect(page.getByRole('row').filter({hasText:name}).getByRole('cell').nth(3)).toHaveText(String(n));}
async function annul(page,sale){await page.goto('/historial');await page.getByPlaceholder('Buscar por código o cliente...').fill(sale.codigo);await page.getByText(sale.codigo.replace(/^VEN/,'V'),{exact:true}).filter({visible:true}).click();await visibleButton(page,'Anular venta').click();await visibleButton(page,'Sí, anular').click();await expect(page.getByText('Venta anulada. Se devolvió el stock.',{exact:true})).toBeVisible();}

test('AMPLIACIÓN CONCURRENCIA: dos cajas compiten por la última unidad TEST',async({page,browser,data},info)=>{
  test.setTimeout(90_000);await login(page,'ADMINISTRADOR',data);const p={productName:`${data.prefix} ULTIMA UNIDAD ${Date.now().toString(36)}`,barcode:`TEST-LAST-${Date.now()}`,initialStock:1};await createProduct(page,p);await logout(page);await prepare(page,p,data);
  const context=await qaContext(browser);try{const other=await context.newPage();await prepare(other,p,data);
    const held=[];let both;const ready=new Promise(r=>both=r);for(const tab of [page,other])await tab.route('**/rpc/confirmar_venta',route=>{held.push(route);if(held.length===2)both();});
    const responses=[page,other].map(tab=>tab.waitForResponse(r=>r.url().includes('/rpc/confirmar_venta')));await Promise.all([page,other].map(tab=>visibleButton(tab,'Confirmar venta').click()));await ready;await Promise.all(held.map(route=>route.continue()));
    const replies=await Promise.all(responses);const results=await Promise.all(replies.map(async r=>({status:r.status(),ok:r.ok(),body:await r.json()})));await info.attach('last-unit',{body:Buffer.from(JSON.stringify({product:p,results})),contentType:'application/json'});
    expect(results.filter(r=>r.ok)).toHaveLength(1);expect(results.filter(r=>!r.ok)).toHaveLength(1);expect(results.find(r=>!r.ok).body.message).toContain('Stock insuficiente');
    await page.reload();await stock(page,p.productName,0);await page.reload();await page.getByPlaceholder('Buscar producto...').fill(p.productName);await expect(page.getByRole('row').filter({hasText:p.productName}).getByRole('cell').nth(3)).toHaveText('0');
    const result=results.find(r=>r.ok).body;const sale=Array.isArray(result)?result[0]:result;await annul(page,sale);await stock(page,p.productName,1);
    await info.attach('last-unit-final',{body:Buffer.from(JSON.stringify({initial:1,successfulSales:1,after:0,afterAnnul:1,sale})),contentType:'application/json'});
  }finally{await context.close();}
});

test('AMPLIACIÓN DOBLE CLIC: confirmar venta crea una sola venta y resta una unidad',async({page,data},info)=>{
  await login(page,'ADMINISTRADOR',data);const p={productName:`${data.prefix} DOBLE CLICK ${Date.now().toString(36)}`,barcode:`TEST-DBL-${Date.now()}`,initialStock:2};await createProduct(page,p);await logout(page);await prepare(page,p,data);
  const requests=[];page.on('request',r=>{if(r.url().includes('/rpc/confirmar_venta'))requests.push(r.method());});const submitted=page.waitForResponse(r=>r.url().includes('/rpc/confirmar_venta'));await visibleButton(page,'Confirmar venta').dblclick();const response=await submitted;expect(response.ok()).toBeTruthy();const body=await response.json();const sale=Array.isArray(body)?body[0]:body;
  await page.reload();await stock(page,p.productName,1);expect(requests).toHaveLength(1);await annul(page,sale);await stock(page,p.productName,2);await info.attach('double-click-sale',{body:Buffer.from(JSON.stringify({requests,initial:2,after:1,final:2,sale})),contentType:'application/json'});
});
