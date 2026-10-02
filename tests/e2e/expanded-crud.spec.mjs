import { test, expect } from './fixtures.mjs';
import { login, formWithTitle, visibleButton, createProduct, createService } from './helpers.mjs';

function card(page,name,action='Editar') {
  return page.locator('div').filter({has:page.getByText(name,{exact:true})})
    .filter({has:page.getByRole('button',{name:action,exact:true})}).last();
}
async function saved(form,name='Guardar') {
  await form.getByRole('button',{name,exact:true}).click(); await expect(form).toHaveCount(0);
}
async function deleteConfirm(page) {
  await visibleButton(page,'Sí, eliminar').click();
  await expect(visibleButton(page,'Sí, eliminar')).toHaveCount(0);
}

test('CLIENTES: alta, teléfono duplicado rechazado, edición y eliminación persistentes', async ({page,data})=>{
  await login(page,'ADMINISTRADOR',data); await page.goto('/clientes');
  const name=`${data.prefix} CLIENTE CRUD`, renamed=`${name} EDITADO`,phone=`8${data.phone.slice(1)}`;
  await visibleButton(page,'Nuevo cliente').first().click(); let form=formWithTitle(page,'Nuevo cliente');
  await form.getByLabel('Nombre completo',{exact:false}).fill(name);
  await form.getByLabel('Teléfono',{exact:true}).fill(phone); await saved(form);
  await page.reload(); await page.getByPlaceholder('Buscar por nombre o teléfono...').fill(name);
  await expect(page.getByText(name,{exact:true}).filter({visible:true})).toBeVisible();
  await visibleButton(page,'Nuevo cliente').first().click(); form=formWithTitle(page,'Nuevo cliente');
  await form.getByLabel('Nombre completo',{exact:false}).fill(`${name} DUPLICADO`);
  await form.getByLabel('Teléfono',{exact:true}).fill(phone);
  await form.getByRole('button',{name:'Guardar',exact:true}).click();
  await expect(form.getByText('Ya existe un cliente con ese teléfono.',{exact:true})).toBeVisible();
  await form.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('button').filter({has:page.getByText(name,{exact:true})}).click();
  await card(page,name).getByRole('button',{name:'Editar',exact:true}).click();
  form=formWithTitle(page,'Editar cliente'); await form.getByLabel('Nombre completo',{exact:false}).fill(renamed);
  await saved(form,'Guardar cambios'); await page.reload();
  await page.getByPlaceholder('Buscar por nombre o teléfono...').fill(renamed);
  await page.getByRole('button').filter({has:page.getByText(renamed,{exact:true})}).click();
  await card(page,renamed).getByRole('button',{name:'Eliminar',exact:true}).click();
  await visibleButton(page,'Cancelar').click(); await expect(page.getByText(renamed,{exact:true}).filter({visible:true})).toBeVisible();
  await card(page,renamed).getByRole('button',{name:'Eliminar',exact:true}).click(); await deleteConfirm(page);
  await page.reload(); await page.getByPlaceholder('Buscar por nombre o teléfono...').fill(renamed);
  await expect(page.getByText(renamed,{exact:true})).toHaveCount(0);
});

test('DIRECCIONES: obligatorios, CRUD y una sola predeterminada tras recarga', async ({page,data})=>{
  await login(page,'CLIENTE',data); await page.goto('/mi-perfil/direcciones');
  await expect(page.getByText('Todavía no tienes direcciones guardadas.',{exact:true})).toBeVisible();
  const a=`TEST Casa ${data.runId}`,b=`TEST Trabajo ${data.runId}`;
  const form=()=>page.locator('form').filter({has:page.locator('#direccion-etiqueta')});
  await visibleButton(page,'Agregar').click();
  await form().getByRole('button',{name:'Guardar',exact:true}).click();
  await expect(form().getByText('Completa la etiqueta y la dirección.',{exact:true})).toBeVisible();
  await form().getByLabel('Etiqueta',{exact:false}).fill(a);
  await form().getByLabel('Dirección',{exact:false}).fill('TEST Calle ficticia 101');
  await form().getByRole('checkbox',{name:'Usar como predeterminada',exact:true}).check(); await saved(form());
  await visibleButton(page,'Agregar').click(); await form().getByLabel('Etiqueta',{exact:false}).fill(b);
  await form().getByLabel('Dirección',{exact:false}).fill('TEST Calle ficticia 202');
  await form().getByRole('checkbox',{name:'Usar como predeterminada',exact:true}).check(); await saved(form());
  await page.reload(); await expect(page.getByText('Predeterminada',{exact:true})).toHaveCount(1);
  const addressCard=(name)=>page.locator('div.liquid-glass').filter({has:page.getByText(name,{exact:true})});
  await expect(addressCard(b).getByText('Predeterminada',{exact:true})).toBeVisible();
  await addressCard(a).getByRole('button',{name:'Editar dirección',exact:true}).click();
  await form().getByLabel('Dirección',{exact:false}).fill('TEST Calle ficticia 303'); await saved(form());
  await page.reload(); await expect(addressCard(a).getByText('TEST Calle ficticia 303',{exact:true})).toBeVisible();
  await addressCard(a).getByRole('button',{name:'Usar como predeterminada',exact:true}).click();
  await page.reload(); await expect(page.getByText('Predeterminada',{exact:true})).toHaveCount(1);
  await expect(addressCard(a).getByText('Predeterminada',{exact:true})).toBeVisible();
  for(const name of [a,b]){await addressCard(name).getByRole('button',{name:'Eliminar dirección',exact:true}).click();await deleteConfirm(page);}
  await page.reload(); await expect(page.getByText('Todavía no tienes direcciones guardadas.',{exact:true})).toBeVisible();
});

test('PRODUCTOS: código duplicado, edición y eliminación sin ventas', async ({page,data})=>{
  await login(page,'ADMINISTRADOR',data);
  const unique=Date.now().toString(36);
  const p={productName:`${data.prefix} CRUD Producto ${unique}`,barcode:`TEST-${data.runId}-CRUD-${unique}`,initialStock:1};
  await createProduct(page,p); await page.reload();
  await page.getByPlaceholder('Buscar producto...').fill(p.productName);
  const row=()=>page.getByRole('row').filter({has:page.getByText(p.productName,{exact:true})});
  const stockColumn=await page.getByRole('columnheader').allTextContents();
  await expect(row().getByRole('cell').nth(stockColumn.findIndex(t=>t.trim()==='Stock'))).toHaveText('1');
  await visibleButton(page,'Nuevo producto').first().click(); let form=formWithTitle(page,'Nuevo producto');
  await form.getByLabel('Nombre',{exact:false}).fill(`${p.productName} DUPLICADO`);
  await form.getByLabel('Código de barras',{exact:true}).fill(p.barcode);
  await form.getByLabel('Stock inicial',{exact:false}).fill('1'); await form.getByLabel('Costo',{exact:false}).fill('0');
  await form.getByLabel('Precio de venta',{exact:false}).fill('1'); await form.getByRole('button',{name:'Guardar',exact:true}).click();
  await expect(form.getByText(/Ya existe.*código/)).toBeVisible(); await form.getByRole('button',{name:'Cancelar',exact:true}).click();
  await row().getByRole('button',{name:'Editar',exact:true}).click(); form=formWithTitle(page,'Editar producto');
  await form.getByLabel('Precio de venta',{exact:false}).fill('2'); await saved(form,'Guardar cambios');
  await page.reload(); await page.getByPlaceholder('Buscar producto...').fill(p.productName);
  await expect(row().getByRole('cell').nth(stockColumn.findIndex(t=>t.trim()==='Precio'))).toContainText('2.00');
  await row().getByRole('button',{name:'Eliminar',exact:true}).click(); await deleteConfirm(page);
  await page.reload(); await page.getByPlaceholder('Buscar producto...').fill(p.productName);
  await expect(row()).toHaveCount(0);
});

test('SERVICIOS: alta, edición y eliminación sin atenciones', async ({page,data})=>{
  await login(page,'ADMINISTRADOR',data); const s={serviceName:`${data.prefix} CRUD Servicio`}; await createService(page,s);
  await page.reload(); await page.getByPlaceholder('Buscar servicio...').fill(s.serviceName);
  const row=()=>page.getByRole('row').filter({has:page.getByText(s.serviceName,{exact:true})});
  await row().getByRole('button',{name:'Editar',exact:true}).click(); const form=formWithTitle(page,'Editar servicio');
  await form.getByLabel('Precio',{exact:false}).first().fill('3'); await saved(form,'Guardar cambios');
  await page.reload(); await page.getByPlaceholder('Buscar servicio...').fill(s.serviceName);
  await expect(row()).toContainText('3.00'); await row().getByRole('button',{name:'Eliminar',exact:true}).click(); await deleteConfirm(page);
  await page.reload(); await page.getByPlaceholder('Buscar servicio...').fill(s.serviceName); await expect(row()).toHaveCount(0);
});

test('ASISTENTES: ficha ficticia sin usuario, editar y eliminar', async ({page,data})=>{
  await login(page,'ADMINISTRADOR',data); await page.goto('/asistentes');const name=`${data.prefix} FICHA SIN LOGIN`;
  await visibleButton(page,'Nueva asistente').first().click(); let form=formWithTitle(page,'Nueva asistente');
  await form.getByLabel('Nombres completos',{exact:false}).fill(name); await saved(form);
  await page.reload(); await page.getByPlaceholder('Buscar por nombre...').fill(name);
  await page.getByRole('button').filter({has:page.getByText(name,{exact:true})}).click();
  await card(page,name).getByRole('button',{name:'Editar',exact:true}).click();form=formWithTitle(page,'Editar asistente');
  await form.getByLabel('Teléfono',{exact:true}).fill(data.phone); await saved(form,'Guardar cambios');
  await page.reload();await page.getByPlaceholder('Buscar por nombre...').fill(name);
  await page.getByRole('button').filter({has:page.getByText(name,{exact:true})}).click();
  await expect(card(page,name)).toContainText(data.phone);
  await card(page,name).getByRole('button',{name:'Eliminar',exact:true}).click();await deleteConfirm(page);
  await page.reload();await page.getByPlaceholder('Buscar por nombre...').fill(name);await expect(page.getByText(name,{exact:true})).toHaveCount(0);
});

test('MOBILIARIO: alta, editar condición y eliminar sin compras', async ({page,data})=>{
  await login(page,'ADMINISTRADOR',data);await page.goto('/mobiliario'); const name=`${data.prefix} MUEBLE`;
  await visibleButton(page,'Nuevo mueble').first().click();let form=formWithTitle(page,'Nuevo mueble');
  await form.getByLabel('Nombre',{exact:false}).fill(name);await saved(form); await page.reload();
  await page.getByRole('button').filter({has:page.getByText(name,{exact:true})}).click();
  await card(page,name).getByRole('button',{name:'Editar',exact:true}).click(); form=formWithTitle(page,'Editar mueble');
  await form.getByLabel('Condición actual',{exact:true}).selectOption('REGULAR');await saved(form,'Guardar cambios');
  await page.reload();await page.getByRole('button').filter({has:page.getByText(name,{exact:true})}).click();
  await expect(card(page,name)).toContainText('Regular');await card(page,name).getByRole('button',{name:'Eliminar',exact:true}).click();await deleteConfirm(page);
  await page.reload();await expect(page.getByText(name,{exact:true})).toHaveCount(0);
});

test('DEUDAS: alta mínima, editar, cobrar/reabrir y eliminar', async ({page,data})=>{
  await login(page,'ADMINISTRADOR',data); await page.goto('/deudas');const name=`${data.prefix} DEUDA ${Date.now().toString(36)}`;
  await visibleButton(page,'Nueva deuda').first().click();let form=formWithTitle(page,'Nueva deuda');
  await form.getByPlaceholder('Buscar cliente...').fill(data.clientName);await form.getByRole('button',{name:data.clientName,exact:true}).click();
  await form.getByPlaceholder('Buscar servicio o producto, o escribir uno...').fill(name);await form.getByLabel(/Monto/).fill('1');await saved(form);
  await page.reload();const own=()=>card(page,name); await expect(own()).toContainText('Pendiente');
  await own().getByRole('button',{name:'Editar',exact:true}).click();form=formWithTitle(page,'Editar deuda');
  await form.getByLabel(/Monto/).fill('2');await saved(form,'Guardar cambios');await page.reload();await expect(own()).toContainText('2.00');
  await own().getByRole('button',{name:'Cobrado',exact:true}).click();await expect(page.getByText('Marcada como cobrada.',{exact:true})).toBeVisible();await page.reload();
  await visibleButton(page,'Filtrar').click();await visibleButton(page,'Todas').click();await expect(own()).toContainText('Cobrada');
  await own().getByRole('button',{name:'Marcar pendiente',exact:true}).click();await expect(page.getByText('Marcada como pendiente.',{exact:true})).toBeVisible();await page.reload();await expect(own()).toContainText('Pendiente');
  await own().getByRole('button',{name:'Eliminar',exact:true}).click();await deleteConfirm(page);await page.reload();
  await expect(page.getByText(name,{exact:true})).toHaveCount(0);
});

test('GASTOS: CAJERA crea, edita y cancela; ADMIN elimina', async ({page,browser,data})=>{
  await page.setViewportSize({width:390,height:844});await login(page,'CAJERA',data);await page.goto('/gastos');const name=`${data.prefix} GASTO ${Date.now().toString(36)}`;
  await visibleButton(page,'Nuevo gasto variable').first().click();let form=formWithTitle(page,'Nuevo gasto variable');
  await form.getByLabel('Nombre',{exact:false}).fill(name);await form.getByLabel('Monto',{exact:false}).fill('1');await saved(form);
  await page.reload();const own=()=>page.getByText(name,{exact:true}).filter({visible:true}).locator('..').locator('..');
  async function reveal(p){ if(!await p.getByText(name,{exact:true}).filter({visible:true}).count()) await p.getByRole('button',{name:/\bVARIABLE\b/}).filter({visible:true}).first().click(); }
  await reveal(page); await expect(own().getByRole('button',{name:'Eliminar',exact:true})).toHaveCount(0);
  await own().getByRole('button',{name:'Editar',exact:true}).click();form=formWithTitle(page,'Editar gasto');await form.getByLabel('Monto',{exact:false}).fill('2');await saved(form,'Guardar cambios');
  await page.reload();await reveal(page);await expect(own()).toContainText('2.00');await own().getByRole('button',{name:'Cancelar',exact:true}).click();
  await visibleButton(page,'Sí, cancelar').click();await page.reload();await reveal(page);await expect(own()).toContainText('Cancelado');
  await expect(own().getByRole('button',{name:'Editar',exact:true})).toHaveCount(0);
  const context=await browser.newContext({baseURL:'http://localhost:5173',viewport:{width:390,height:844},timezoneId:'America/Lima'});
  const {localNetworkOnly}=await import('./local-safety.mjs');await localNetworkOnly(context);
  try{const admin=await context.newPage();await login(admin,'ADMINISTRADOR',data);await admin.goto('/gastos');await reveal(admin);
    await card(admin,name,'Eliminar').getByRole('button',{name:'Eliminar',exact:true}).click();await deleteConfirm(admin);await admin.reload();
    await expect(admin.getByText(name,{exact:true})).toHaveCount(0);
  }finally{await context.close();}
});

test('PROMOCIONES: 100% válido, edición a 1% e inactiva, eliminar',async({page,data})=>{
  await login(page,'ADMINISTRADOR',data);await page.goto('/promociones');const name=`${data.prefix} CRUD Promo`;
  await visibleButton(page,'Nueva promoción').first().click();let form=formWithTitle(page,'Nueva promoción');
  await form.getByLabel('Título',{exact:false}).fill(name);await form.getByLabel('Porcentaje',{exact:false}).fill('100');
  // Never publish this boundary fixture into the client promotion priority.
  await form.getByRole('button',{name:'Inactiva',exact:true}).click();await saved(form);await page.reload();
  await page.getByText(name,{exact:true}).filter({visible:true}).click();const own=()=>card(page,name);
  await own().getByRole('button',{name:'Editar',exact:true}).click();form=formWithTitle(page,'Editar promoción');
  await expect(form.getByLabel('Porcentaje',{exact:false})).toHaveValue('100');await form.getByLabel('Porcentaje',{exact:false}).fill('1');await saved(form,'Guardar cambios');
  await page.reload();await page.getByText(name,{exact:true}).filter({visible:true}).click();await own().getByRole('button',{name:'Editar',exact:true}).click();form=formWithTitle(page,'Editar promoción');
  await expect(form.getByLabel('Porcentaje',{exact:false})).toHaveValue('1');await form.getByRole('button',{name:'Cancelar',exact:true}).click();await own().getByRole('button',{name:'Eliminar',exact:true}).click();await deleteConfirm(page);
  await page.reload();await expect(page.getByText(name,{exact:true})).toHaveCount(0);
});
