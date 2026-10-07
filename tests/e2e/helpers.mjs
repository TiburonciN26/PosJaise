import { expect } from 'playwright/test';
import { accounts, password } from './fixtures/accounts.mjs';

export async function login(page, role, data) {
  await page.goto('/login');
  await page.getByLabel('Correo', { exact: true }).fill(role === 'CLIENTE' ? data.clientEmail : accounts[role]);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await page.getByRole('button', { name: /Menú de (usuario|cuenta)/ }).waitFor();
}

export async function logout(page) {
  await page.getByRole('button', { name: /Menú de (usuario|cuenta)/ }).click();
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await page.getByRole('button', { name: 'Sí, cerrar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
}

export const formWithTitle = (page, title) => page.locator('form').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
export const visibleText = (page, text) => page.getByText(text, { exact: true }).filter({ visible: true });
export const visibleButton = (page, text) => page.getByRole('button', { name: text, exact: true }).filter({ visible: true });

// QA-079: en Citas el buscador está siempre desplegado en escritorio (lg+) y el botón
// «Buscar citas» (lg:hidden) solo existe en móvil/tablet, donde hay que abrirlo antes de
// escribir. Se pulsa solo si está visible y se devuelve el campo, exigiendo que sea único.
export async function abrirBuscadorCitas(page) {
  const boton = visibleButton(page, 'Buscar citas');
  if (await boton.count()) await boton.click();
  const campo = page.getByPlaceholder('Buscar por cliente o servicio...').filter({ visible: true });
  await expect(campo).toHaveCount(1);
  return campo;
}

// QA-082: Porcentajes reparte las tarjetas en columnas flex independientes
// (contenedor flex items-start > columna flex-col > tarjeta > cabecera-botón), ya no en una
// grilla. Devuelve la cabecera de cada tarjeta de la lista VISIBLE (hay pestañas cacheadas).
export const tarjetasPorcentaje = (page) => page.locator('div.flex.items-start.gap-3:visible > div.flex-col > div.rounded-lg > button');

// QA-080: importe monetario de una fila de «Resumen del período» / cascada del Dashboard.
// Cada fila es [etiqueta][separador punteado vacío][importe]; el importe es el único span
// con texto. Una lectura vacía o no numérica falla en vez de convertirse en 0.
export async function importeFilaDashboard(page, etiqueta) {
  const fila = page.getByText(etiqueta, { exact: true }).first().locator('xpath=..');
  const importe = fila.locator('span.font-mono').filter({ hasText: /\d/ });
  await expect(importe, `importe único de «${etiqueta}»`).toHaveCount(1);
  const texto = (await importe.innerText()).trim();
  const valor = Number(texto.replace(/[^\d.]/g, ''));
  if (!texto || !Number.isFinite(valor)) throw new Error(`Lectura monetaria inválida en «${etiqueta}»: «${texto}»`);
  return valor;
}

export async function createProduct(page, data) {
  await page.goto('/inventario');
  await visibleButton(page, 'Nuevo producto').click();
  const form = formWithTitle(page, 'Nuevo producto');
  await form.getByLabel('Nombre', { exact: false }).fill(data.productName);
  await form.getByLabel('Código de barras', { exact: true }).fill(data.barcode);
  await form.getByLabel('Stock inicial', { exact: false }).fill(String(data.initialStock ?? 10));
  await form.getByLabel('Costo', { exact: false }).fill('0');
  await form.getByLabel('Precio de venta', { exact: false }).fill('1');
  const saved = page.waitForResponse(r => r.url().includes('/rest/v1/productos?') && r.request().method() === 'POST');
  await form.getByRole('button', { name: 'Guardar', exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBeTruthy();
  const row = await response.json();
  data.productId = row.id ?? row[0]?.id;
  expect(data.productId).toBeTruthy();
  await expect(form).toHaveCount(0);
}

// Sufijo único por llamada (proceso + azar): los códigos de barras son UNIQUE y los nombres se buscan por
// subcadena, así que ningún caso reutiliza el fixture de otra corrida ni se apoya en first() para elegir.
export const sufijoUnico = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// Buscador de productos de Caja (/ventas). Su placeholder es animado (useTextoEscritura) y puede estar a medias o
// pausado, así que NO sirve como identidad. Ancla estable: el único input de búsqueda del bloque que contiene el
// botón de escaneo con cámara. Se comprueba que sea único y visible ANTES de actuar (sin first()).
export async function buscadorCaja(page) {
  const campo = page
    .locator('div.relative.flex.items-center')
    .filter({ has: page.getByRole('button', { name: 'Escanear código de barras con la cámara', exact: true }) })
    .locator('input[type="search"]');
  await expect(campo, 'el buscador de Caja es único y visible').toHaveCount(1);
  await expect(campo).toBeVisible();
  return campo;
}

// Buscador de las pantallas con lista (barra pegajosa superior) de la página VISIBLE. Su placeholder es animado
// (useTextoEscritura: se escribe letra a letra y se pausa) y con la página ocupada puede no estar completo, así que NO sirve
// como identidad. Ancla estable: el único input de búsqueda dentro de la barra `sticky top-0` visible. Se comprueba que es
// único y visible antes de actuar (sin first()).
export async function buscadorSticky(page) {
  const campo = page.locator('div.sticky.top-0:visible').locator('input[type="search"]');
  await expect(campo, 'el buscador de la página visible es único').toHaveCount(1);
  await expect(campo).toBeVisible();
  return campo;
}

export const campoNombreServicio = (form) => form.locator('input[id$="-nombre"]');

export async function createService(page, data) {
  await page.goto('/servicios');
  await visibleButton(page, 'Nuevo servicio').click();
  const form = formWithTitle(page, 'Nuevo servicio');
  // El formulario de servicio tiene también «Buscar servicio por nombre» (combo): el campo Nombre se acota por su
  // identificador semántico (id terminado en -nombre), sin first() y sin tocar la aplicación.
  await campoNombreServicio(form).fill(data.serviceName);
  await form.getByLabel('Categoría', { exact: false }).selectOption({ label: 'Cabello' });
  await form.getByLabel('Precio', { exact: false }).first().fill('2');
  await form.getByLabel('Duración (min)', { exact: true }).fill('30');
  const saved = page.waitForResponse(r => r.url().includes('/rest/v1/servicios?') && r.request().method() === 'POST');
  await form.getByRole('button', { name: 'Guardar', exact: true }).click();
  const response = await saved;
  expect(response.ok()).toBeTruthy();
  const row = await response.json();
  data.serviceId = row.id ?? row[0]?.id;
  expect(data.serviceId).toBeTruthy();
  await expect(form).toHaveCount(0);
}

export async function createAttention(page, data, hour) {
  await page.goto('/mi-panel');
  await visibleButton(page, 'Registrar atención').click();
  const form = formWithTitle(page, 'Registrar atención');
  await form.getByPlaceholder('Buscar cliente...').fill(data.clientName);
  await form.getByRole('button', { name: data.clientName, exact: true }).click();
  await form.getByPlaceholder('Buscar servicio...').fill(data.serviceName);
  // La sugerencia real termina en el precio («<nombre> 2.00»); «Crear servicio "<nombre>"» no. Sin first().
  const escapado = data.serviceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await form.getByRole('button', { name: new RegExp(`^${escapado} \\d+(\\.\\d+)?$`) }).click();
  await form.getByLabel('Fecha y hora', { exact: false }).fill(`${data.today}T${hour}`);
  await form.getByLabel('Nota', { exact: true }).fill(`${data.prefix} atención ${hour}`);
  await form.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(form).toHaveCount(0);
}
