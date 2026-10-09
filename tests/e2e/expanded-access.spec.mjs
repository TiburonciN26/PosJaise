import { test, expect, knownIssue, expectKnownFailure } from './fixtures.mjs';
import { login, logout, formWithTitle, visibleButton } from './helpers.mjs';
import { staffRoutes, clientRoutes, requiredForms } from './coverage-inventory.mjs';

for (const role of ['ADMINISTRADOR','CAJERA','ASISTENTE','CLIENTE']) {
  test(`MATRIZ: ${role}, todas las rutas internas y vuelta sin sesión`, async ({page,data},info)=>{
    test.setTimeout(120_000);
    await login(page,role,data);
    const checks=[];
    for (const [path,roles] of staffRoutes) {
      // Shared URLs resolve to a distinct CLIENTE component, not staff layout.
      const allowed=role==='CLIENTE'?clientRoutes.includes(path):roles.includes(role);
      const target=allowed?path:role==='CLIENTE'?'/inicio':role==='ASISTENTE'?'/mi-panel':'/ventas';
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${target}$`));
      await expect(page.getByRole('button',{name:/Menú de (usuario|cuenta)/})).toBeVisible();
      checks.push({path,allowed,observed:new URL(page.url()).pathname});
    }
    if(role==='CLIENTE') for(const path of clientRoutes){
      await page.goto(path); await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole('button',{name:'Menú de cuenta',exact:true})).toBeVisible();
      await expect(page.getByText('Cargando...', {exact:true})).toHaveCount(0);
      await expect(page.getByText(/Algo salió mal|Ocurrió un error inesperado/)).toHaveCount(0);
      checks.push({path,allowed:true,observed:new URL(page.url()).pathname});
    }
    await info.attach('route-matrix',{body:Buffer.from(JSON.stringify({role,checks})),contentType:'application/json'});
    await logout(page); await page.goto(role==='CLIENTE'?'/mi-perfil':'/citas');
    await expect(page).toHaveURL(/\/login$/);
  });
}

for (const [path,button,title,message] of requiredForms) {
  test(`VALIDACIÓN: ${path}, obligatorios vacíos y cancelar sin guardar`, async ({page,data})=>{
    await login(page,'ADMINISTRADOR',data); await page.goto(path);
    await visibleButton(page,button).first().click(); const form=formWithTitle(page,title);
    await form.getByRole('button',{name:'Guardar',exact:true}).click();
    await expect(form.getByText(message,{exact:true})).toBeVisible();
    await expect(form).toBeVisible();
    await form.getByRole('button',{name:'Cancelar',exact:true}).click();
    await expect(form).toHaveCount(0);
  });
}

test('PERMISOS: CAJERA no ve administración de producto/servicio', async ({page,data})=>{
  await login(page,'CAJERA',data);
  for(const [path,label] of [['/inventario','Nuevo producto'],['/servicios','Nuevo servicio']]){
    await page.goto(path); await expect(page.getByRole('button',{name:label,exact:true}).filter({visible:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Editar',exact:true}).filter({visible:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Eliminar',exact:true}).filter({visible:true})).toHaveCount(0);
  }
});

for(const role of ['ASISTENTE','CAJERA']) test(`QA-001: ${role} no debe ofrecer Crear servicio en citas`, async ({page,data},info)=>{
  knownIssue(info,'QA-001'); await login(page,role,data); await page.goto('/citas');
  await visibleButton(page,'Nueva cita').first().click(); const form=formWithTitle(page,'Nueva cita');
  await form.getByPlaceholder('Buscar servicio...').fill(`${data.prefix} SIN-SERVICIO`);
  // Let loaded search finish; no backend permission is inferred from this button.
  await expect(form.getByText('Cargando...', {exact:true})).toHaveCount(0);
  expectKnownFailure('QA-001');
  await expect(form.getByRole('button',{name:/Crear servicio/})).toHaveCount(0);
});

test('PERMISOS: backend rechaza crear servicio desde cita ASISTENTE',async({page,data},info)=>{
  await login(page,'ASISTENTE',data);await page.goto('/citas');await visibleButton(page,'Nueva cita').first().click();
  const name=`${data.prefix} SERVICIO PROHIBIDO`,cita=formWithTitle(page,'Nueva cita');
  await cita.getByPlaceholder('Buscar servicio...').fill(name);
  const create=cita.getByRole('button',{name:/Crear servicio/});
  if(!await create.count()){test.skip(true,'Crear servicio está oculto; el intento por UI no es posible.');return;}
  await create.click();const form=formWithTitle(page,'Nuevo servicio');
  await form.getByLabel('Categoría',{exact:false}).selectOption({label:'Cabello'});await form.getByLabel('Precio',{exact:false}).first().fill('1');
  const submitted=page.waitForResponse(r=>r.url().includes('/rest/v1/servicios?')&&r.request().method()==='POST');
  await form.getByRole('button',{name:'Guardar',exact:true}).click();const response=await submitted;
  await info.attach('permission-denial',{body:Buffer.from(JSON.stringify({role:'ASISTENTE',name,status:response.status(),body:await response.json()})),contentType:'application/json'});
  expect(response.status()).toBe(403);await expect(form.getByText('No se pudo guardar el servicio. Intenta de nuevo.',{exact:true})).toBeVisible();
});
