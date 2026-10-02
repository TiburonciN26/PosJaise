import {test,expect,knownIssue,expectKnownFailure} from './fixtures.mjs';
import {login,visibleButton,formWithTitle} from './helpers.mjs';
import {testImage} from './phase2-helpers.mjs';
import {ensureAnnulledSale} from './sale-fixture.mjs';
import {readFile} from 'node:fs/promises';

test('AMPLIACIÓN GALERÍA: validar archivos, crear, editar y eliminar par TEST',async({page,data},info)=>{
  await login(page,'ADMINISTRADOR',data);await page.goto('/galeria-web');await visibleButton(page,'Agregar foto').click();let form=formWithTitle(page,'Nueva foto de galería');
  await form.getByRole('button',{name:'Guardar',exact:true}).click();await expect(form.getByText('Elige la foto de "antes".',{exact:true})).toBeVisible();
  const files=form.locator('input[type=file]');await files.nth(0).setInputFiles({name:'TEST-invalid.txt',mimeType:'text/plain',buffer:Buffer.from('TEST QA')});
  await expect(form.getByText('Formato no admitido. Usa JPG, PNG o WEBP.',{exact:true})).toBeVisible();
  await files.nth(0).setInputFiles(await testImage(page,'TEST-antes.png'));await files.nth(1).setInputFiles(await testImage(page,'TEST-despues.png'));
  await expect(form.getByText('Procesando...', {exact:true})).toHaveCount(0);
  const name=`${data.prefix} GALERIA ${Date.now().toString(36)}`;await form.getByLabel('Título',{exact:true}).fill(name);
  const inserted=page.waitForResponse(r=>r.url().includes('/rest/v1/galeria_web')&&r.request().method()==='POST');
  await form.getByRole('button',{name:'Guardar',exact:true}).click();expect((await inserted).ok()).toBeTruthy();await expect(form).toHaveCount(0);await page.reload();
  const row=()=>page.getByText(name,{exact:true}).locator('../..');await expect(row()).toBeVisible();await expect.poll(()=>row().locator('img').evaluateAll(xs=>xs.every(x=>x.complete&&x.naturalWidth>0))).toBeTruthy();
  const names=await row().getByRole('button').evaluateAll(xs=>xs.map(x=>x.getAttribute('aria-label')||x.textContent.trim()));
  await info.attach('gallery-created',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  await info.attach('gallery-controls',{body:Buffer.from(JSON.stringify({name,names})),contentType:'application/json'});
  await row().getByRole('button').nth(0).click();form=formWithTitle(page,'Editar foto de galería');await form.getByLabel('Orden',{exact:true}).fill('2');await form.getByRole('button',{name:'Visible en la Web',exact:true}).click();
  await form.getByRole('button',{name:'Guardar cambios',exact:true}).click();await expect(form).toHaveCount(0);await page.reload();await expect(row().getByText('Oculta',{exact:true})).toBeVisible();
  await row().getByRole('button').nth(1).click();await page.getByRole('dialog',{name:'¿Eliminar esta foto?',exact:true}).getByRole('button',{name:'Cancelar',exact:true}).click();await expect(row()).toBeVisible();
  await row().getByRole('button').nth(1).click();await page.getByRole('dialog',{name:'¿Eliminar esta foto?',exact:true}).getByRole('button',{name:'Sí, eliminar',exact:true}).click();await expect(page.getByText('Foto eliminada.',{exact:true})).toBeVisible();await page.reload();await expect(page.getByText(name,{exact:true})).toHaveCount(0);
});

test('AMPLIACIÓN A11Y: modal producto, Tab/Shift+Tab, Escape y retorno de foco',async({page,data},info)=>{
  knownIssue(info,'QA-017');
  await login(page,'ADMINISTRADOR',data);await page.goto('/inventario');const trigger=visibleButton(page,'Nuevo producto');await trigger.click();const form=formWithTitle(page,'Nuevo producto');
  await expect(form).toHaveAttribute('role','dialog');await expect(form).toHaveAttribute('aria-modal','true');
  for(let i=0;i<25;i++){await page.keyboard.press(i%5===0?'Shift+Tab':'Tab');expect(await form.evaluate(x=>x.contains(document.activeElement))).toBeTruthy();}
  await page.keyboard.press('Escape');await expect(form).toHaveCount(0);
  const focused=await trigger.evaluate(x=>document.activeElement===x);
  await info.attach('focus-return',{body:Buffer.from(JSON.stringify({focused,active:await page.evaluate(()=>({tag:document.activeElement.tagName,text:document.activeElement.textContent?.slice(0,80)}))})),contentType:'application/json'});
  expectKnownFailure('QA-017');expect(focused,'Al cerrar con Escape debe volver el foco al botón que abrió el modal').toBeTruthy();
});

test('AMPLIACIÓN CSV: exportar historial y comprobar venta TEST anulada',async({page,browser,data},info)=>{
  test.setTimeout(120_000);const {sale,productName}=await ensureAnnulledSale(browser,data);
  await login(page,'ADMINISTRADOR',data);await page.goto('/historial');await expect(page.getByRole('button',{name:'Exportar CSV del período',exact:true})).toBeVisible();const download=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar CSV del período',exact:true}).click();const file=await download;
  expect(file.suggestedFilename()).toMatch(/^ventas_.*\.csv$/);const text=await readFile(await file.path(),'utf8');expect(text.charCodeAt(0)).toBe(0xfeff);
  const own=text.split('\n').find(line=>line.startsWith(sale.codigo+','));expect(own).toBeTruthy();expect(own).toContain('ANULADA');expect(own).toContain(productName);
  await info.attach('csv-own-row',{body:Buffer.from(JSON.stringify({filename:file.suggestedFilename(),ownRow:own,header:text.split('\n')[0]})),contentType:'application/json'});
});

test('AMPLIACIÓN TICKET: reimpresión muestra anulación e importes en contenido imprimible',async({page,browser,data},info)=>{
  test.setTimeout(120_000);const {sale,code,productName}=await ensureAnnulledSale(browser,data);
  await login(page,'CAJERA',data);await page.goto('/historial');await page.getByPlaceholder('Buscar por código o cliente...').fill(sale.codigo);await page.getByText(code,{exact:true}).filter({visible:true}).click();await expect(page.getByText(productName,{exact:true}).filter({visible:true})).toBeVisible();
  await visibleButton(page,'Reimprimir ticket').click();const ticket=page.locator('#ticket-impresion');await expect(ticket).toHaveCount(1);const text=await ticket.textContent();expect(text).toContain(sale.codigo);expect(text).toContain('VENTA ANULADA');expect(text).toContain(productName);expect(text).toContain('3 x S/ 1.00');expect(text).toContain('S/ 3.00');
  await page.emulateMedia({media:'print'});await expect(ticket).toBeVisible();await expect(page.locator('#root')).toBeHidden();
  const pdf=await page.pdf({path:`tests/e2e/results/fixtures/${data.runId}-ticket.pdf`,width:'58mm',height:'200mm',printBackground:true,margin:{top:0,right:0,bottom:0,left:0}});expect(pdf.length).toBeGreaterThan(1000);
  await info.attach('ticket-pdf',{body:pdf,contentType:'application/pdf'});
  await info.attach('ticket-content',{body:Buffer.from(JSON.stringify({text,pdfGeneratedByChromium:true,systemDialogNotValidated:true})),contentType:'application/json'});await page.emulateMedia({media:'screen'});await page.reload();await expect(page.getByPlaceholder('Buscar por código o cliente...')).toBeVisible();
});

test('AMPLIACIÓN CSV PERMISOS: CAJERA no ve exportación administrativa',async({page,data})=>{
  await login(page,'CAJERA',data);await page.goto('/historial');await expect(page.getByPlaceholder('Buscar por código o cliente...')).toBeVisible();await expect(page.getByRole('button',{name:'Exportar CSV del período',exact:true})).toHaveCount(0);
});

test('AMPLIACIÓN A11Y GALERÍA: acciones deben tener nombres accesibles',async({page,data},info)=>{
  knownIssue(info,'QA-016');await login(page,'ADMINISTRADOR',data);await page.goto('/galeria-web');await visibleButton(page,'Agregar foto').click();const form=formWithTitle(page,'Nueva foto de galería');const name=`${data.prefix} A11Y GALERIA ${Date.now().toString(36)}`;await form.getByLabel('Título',{exact:true}).fill(name);await form.locator('input[type=file]').nth(0).setInputFiles(await testImage(page));await form.locator('input[type=file]').nth(1).setInputFiles(await testImage(page));await expect(form.getByText('Procesando...', {exact:true})).toHaveCount(0);await form.getByRole('button',{name:'Guardar',exact:true}).click();await expect(form).toHaveCount(0);await page.reload();const row=page.getByText(name,{exact:true}).locator('../..');await expect(row).toBeVisible();const count=await row.getByRole('button',{name:/Editar|Eliminar/}).count();await info.attach('gallery-aria',{body:Buffer.from(await row.ariaSnapshot()),contentType:'text/plain'});await info.attach('gallery-created',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});await row.getByRole('button').nth(1).click();await visibleButton(page,'Sí, eliminar').click();await expect(page.getByText('Foto eliminada.',{exact:true})).toBeVisible();expectKnownFailure('QA-016');expect(count,'Los dos botones deben anunciar sus acciones').toBe(2);
});
