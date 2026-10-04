import { test, expect } from './fixtures.mjs';
import { sufijoUnico, login, logout, visibleButton, formWithTitle, createProduct } from './helpers.mjs';
import { password } from './fixtures/accounts.mjs';

for(const [path,placeholder,message] of [
  ['/inventario','Buscar producto...','No se encontraron productos.'],
  ['/clientes','Buscar por nombre o teléfono...','No se encontraron clientes.'],
  ['/productos','Buscar producto…',null],['/servicios','Buscar servicio…',null],
]) test(`BÚSQUEDA: ${path}, sin resultados y recuperación`, async ({page,data})=>{
  const role=path==='/inventario'||path==='/clientes'?'ADMINISTRADOR':'CLIENTE';await login(page,role,data);await page.goto(path);
  await page.getByPlaceholder(placeholder).fill(`${data.prefix} IMPOSIBLE-ENCONTRAR`);
  await expect(message?page.getByText(message,{exact:true}):page.getByText(/Sin resultados para/)).toBeVisible();
  await page.getByPlaceholder(placeholder).fill('');
  await expect(message?page.getByText(message,{exact:true}):page.getByText(/Sin resultados para/)).toHaveCount(0);
});

test('PRODUCTOS: límites inválidos de costo, precio y stock', async ({page,data})=>{
  await login(page,'ADMINISTRADOR',data);await page.goto('/inventario');await visibleButton(page,'Nuevo producto').first().click();const form=formWithTitle(page,'Nuevo producto');
  await form.getByLabel('Nombre',{exact:false}).fill(`${data.prefix} NO-GUARDAR`);
  await form.getByLabel('Stock inicial',{exact:false}).fill('1');await form.getByLabel('Costo',{exact:false}).fill('-1');await form.getByLabel('Precio de venta',{exact:false}).fill('1');
  await form.getByRole('button',{name:'Guardar',exact:true}).click();await expect(form.getByText('El costo debe ser un número mayor o igual a 0.',{exact:true})).toBeVisible();
  await form.getByLabel('Costo',{exact:false}).fill('0');await form.getByLabel('Precio de venta',{exact:false}).fill('0');
  await form.getByRole('button',{name:'Guardar',exact:true}).click();await expect(form.getByText('El precio de venta debe ser un número mayor a 0.',{exact:true})).toBeVisible();
  await form.getByLabel('Precio de venta',{exact:false}).fill('1');await form.getByLabel('Stock inicial',{exact:false}).fill('-1');
  await form.getByRole('button',{name:'Guardar',exact:true}).click();await expect(form.getByText('El stock inicial debe ser 0 o más.',{exact:true})).toBeVisible();
  await form.getByRole('button',{name:'Cancelar',exact:true}).click();
});

test('SERVICIOS: categoría obligatoria, precio cero y duración negativa', async ({page,data})=>{
  await login(page,'ADMINISTRADOR',data);await page.goto('/servicios');await visibleButton(page,'Nuevo servicio').first().click();const form=formWithTitle(page,'Nuevo servicio');
  await form.getByLabel('Nombre',{exact:false}).fill(`${data.prefix} NO-GUARDAR`);
  await form.getByRole('button',{name:'Guardar',exact:true}).click();await expect(form.getByText('La categoría es obligatoria.',{exact:true})).toBeVisible();
  await form.getByLabel('Categoría',{exact:false}).selectOption({label:'Cabello'});await form.getByLabel('Precio',{exact:false}).first().fill('0');
  await form.getByRole('button',{name:'Guardar',exact:true}).click();await expect(form.getByText('El precio debe ser un número mayor a 0.',{exact:true})).toBeVisible();
  await form.getByLabel('Precio',{exact:false}).first().fill('1');await form.getByLabel('Duración (min)',{exact:true}).fill('-1');
  await form.getByRole('button',{name:'Guardar',exact:true}).click();await expect(form.getByText('La duración debe ser un número mayor a 0.',{exact:true})).toBeVisible();
  await form.getByRole('button',{name:'Cancelar',exact:true}).click();
});

test('PROMOCIONES: cero, más de 100% y fechas invertidas', async ({page,data})=>{
  await login(page,'ADMINISTRADOR',data);await page.goto('/promociones');await visibleButton(page,'Nueva promoción').first().click();const form=formWithTitle(page,'Nueva promoción');
  await form.getByLabel('Título',{exact:false}).fill(`${data.prefix} NO-GUARDAR`);
  for(const [value,msg] of [['0','El valor debe ser un número mayor a 0.'],['101','Un porcentaje no puede ser mayor a 100.']]){
    await form.getByLabel('Porcentaje',{exact:false}).fill(value);await form.getByRole('button',{name:'Guardar',exact:true}).click();await expect(form.getByText(msg,{exact:true})).toBeVisible();
  }
  await form.getByLabel('Porcentaje',{exact:false}).fill('1');await form.getByLabel('Vigente desde',{exact:true}).fill(data.tomorrow);await form.getByLabel('Vigente hasta',{exact:true}).fill(data.today);
  await form.getByRole('button',{name:'Guardar',exact:true}).click();await expect(form.getByText('La fecha de fin no puede ser antes que la de inicio.',{exact:true})).toBeVisible();
  await form.getByRole('button',{name:'Cancelar',exact:true}).click();
});

test('GASTOS: cero, negativo, texto y año menor a 2000', async ({page,data})=>{
  await login(page,'CAJERA',data);await page.goto('/gastos');await visibleButton(page,'Nuevo gasto var.').first().click();const form=formWithTitle(page,'Nuevo gasto variable');
  await form.getByLabel('Nombre',{exact:false}).fill(`${data.prefix} NO-GUARDAR`);
  for(const value of ['0','-1','abc']){await form.getByLabel('Monto',{exact:false}).fill(value);await form.getByRole('button',{name:'Guardar',exact:true}).click();await expect(form.getByText('El monto debe ser un número mayor a 0.',{exact:true})).toBeVisible();}
  await form.getByLabel('Monto',{exact:false}).fill('1');await form.getByLabel('Año',{exact:false}).fill('1999');await form.getByRole('button',{name:'Guardar',exact:true}).click();await expect(form.getByText('El año no es válido.',{exact:true})).toBeVisible();
  await form.getByRole('button',{name:'Cancelar',exact:true}).click();
});

test('STOCK: CAJERA rechaza 0/negativo y suma una unidad con persistencia', async ({page,data},info)=>{
  const sufijo=sufijoUnico();const replenishment={productName:`${data.prefix} REPOSICIÓN ${sufijo}`,barcode:`TEST-${data.runId}-REPOSICION-${sufijo}`,initialStock:0};
  await login(page,'ADMINISTRADOR',data);await createProduct(page,replenishment);await logout(page);
  await login(page,'CAJERA',data);await page.goto('/inventario');await page.getByPlaceholder('Buscar producto...').fill(replenishment.productName);
  const row=()=>page.getByRole('row').filter({hasText:replenishment.productName});await expect(row().getByRole('cell').nth(3)).toHaveText('0');
  await row().getByRole('button',{name:'Agregar stock',exact:true}).click();const form=formWithTitle(page,'Agregar stock');
  // Existing UI labels are not associated with inputs; scope observed searchboxes.
  for(const amount of ['0','-1','2.7','5abc']){await form.getByRole('searchbox').first().fill(amount);await form.getByRole('button',{name:'Agregar',exact:true}).click();await expect(form.getByText('La cantidad debe ser un número entero mayor a 0 (sin decimales ni letras).',{exact:true})).toBeVisible();}
  await form.getByRole('searchbox').first().fill('1');await form.getByPlaceholder('Ej: Compra proveedor X').fill(`${data.prefix} reposición`);
  await form.getByRole('button',{name:'Agregar',exact:true}).click();await expect(form).toHaveCount(0);await page.reload();await page.getByPlaceholder('Buscar producto...').fill(replenishment.productName);
  await expect(row().getByRole('cell').nth(3)).toHaveText('1');await info.attach('stock-agregado',{body:Buffer.from(JSON.stringify({productId:replenishment.productId,before:0,added:1,after:1})),contentType:'application/json'});
});

test('CARRITO: límites 1/stock, factura incompleta, recarga y quitar producto', async ({page,data})=>{
  await login(page,'CLIENTE',data);await page.goto(`/productos/${data.saleProductId}`);
  await page.getByRole('button',{name:/^Agregar al carrito/}).first().click();await page.goto('/carrito');
  const quantity=page.getByRole('group',{name:`Cantidad de ${data.saleProductName}`,exact:true});
  await expect(quantity.getByRole('button',{name:'Quitar uno',exact:true})).toBeDisabled();
  for(let i=1;i<10;i++){
    const changed=page.waitForResponse(r=>r.url().includes('/rest/v1/carrito_productos?')&&r.request().method()==='PATCH');
    await quantity.getByRole('button',{name:'Agregar uno',exact:true}).click();expect((await changed).ok()).toBeTruthy();
  }
  await expect(quantity.getByRole('button',{name:'Agregar uno',exact:true})).toBeDisabled();
  await page.reload();await expect(quantity.getByRole('button',{name:'Agregar uno',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Factura',exact:true}).click();
  await page.getByPlaceholder('20XXXXXXXXX').fill('123');await expect(page.getByRole('button',{name:/^Confirmar pedido/})).toBeDisabled();
  await page.getByRole('button',{name:`Quitar ${data.saleProductName} del carrito`,exact:true}).click();await page.reload();
  await expect(page.getByRole('group',{name:`Cantidad de ${data.saleProductName}`,exact:true})).toHaveCount(0);
});

test('CUENTA: contraseña corta/no coincidente y cambio UI con restauración', async ({page,data})=>{
  await login(page,'CLIENTE',data);await page.goto('/mi-perfil/seguridad');
  const newField=page.locator('#seguridad-nueva'),confirmField=page.locator('#seguridad-confirmar');
  await newField.fill('123');await confirmField.fill('123');await visibleButton(page,'Cambiar contraseña').click();
  await expect(page.getByText('La contraseña debe tener al menos 6 caracteres.',{exact:true})).toBeVisible();
  await newField.fill('TEST123456!');await confirmField.fill('DISTINTA');await visibleButton(page,'Cambiar contraseña').click();await expect(page.getByText('Las contraseñas no coinciden.',{exact:true})).toBeVisible();
  const temporary='TEST-CambioLocal123!';await newField.fill(temporary);await confirmField.fill(temporary);await visibleButton(page,'Cambiar contraseña').click();
  await expect(page.getByText('Contraseña actualizada.',{exact:true})).toBeVisible();await logout(page);
  await page.getByLabel('Correo',{exact:true}).fill(data.clientEmail);await page.getByLabel('Contraseña',{exact:true}).fill(temporary);await visibleButton(page,'Entrar').click();await expect(page).not.toHaveURL(/\/login$/);
  await page.goto('/mi-perfil/seguridad');await newField.fill(password);await confirmField.fill(password);await visibleButton(page,'Cambiar contraseña').click();await expect(page.getByText('Contraseña actualizada.',{exact:true})).toBeVisible();
  await logout(page);await login(page,'CLIENTE',data);
});
