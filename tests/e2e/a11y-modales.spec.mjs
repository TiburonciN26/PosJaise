import { test, expect } from './fixtures.mjs';
import { login, visibleButton, formWithTitle } from './helpers.mjs';

// QA-030 (variante de QA-017): retorno de foco del hook compartido useModalA11y
// en sus dos ciclos de vida.
//  - "se desmonta": el modal solo existe mientras está abierto (Nuevo producto).
//  - "página montada": la confirmación vive en una página que permanece montada
//    y el parámetro `activo` pasa a false (Eliminar en Inventario/Servicios).
// Se abre con teclado real (focus + Enter) y NUNCA se confirma una eliminación.

async function contieneFoco(dialog, page, veces = 8) {
  for (const tecla of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < veces; i++) {
      await page.keyboard.press(tecla);
      expect(await dialog.evaluate((x) => x.contains(document.activeElement)), `${tecla} #${i + 1} debe quedar dentro del diálogo`).toBeTruthy();
    }
  }
}

async function abrirConTeclado(page, disparador) {
  await disparador.focus();
  await expect(disparador).toBeFocused();
  await page.keyboard.press('Enter');
}

async function enfocadoYConectado(disparador) {
  return disparador.evaluate((x) => x.isConnected && document.activeElement === x);
}

const CONSUMIDORES_PAGINA_MONTADA = [
  {
    nombre: 'Inventario / Eliminar producto',
    ruta: '/inventario',
    buscador: 'Buscar producto...',
    termino: (data) => `${data.prefix} Producto`,
    filas: (data) => [data.productName, data.saleProductName],
  },
  {
    nombre: 'Servicios / Eliminar servicio',
    ruta: '/servicios',
    buscador: 'Buscar servicio...',
    termino: (data) => data.serviceName,
    filas: (data) => [data.serviceName],
  },
];

for (const consumidor of CONSUMIDORES_PAGINA_MONTADA) {
  test(`A11Y MODALES (página montada) ${consumidor.nombre}: Escape, Cancelar, reapertura, disparador y contención de foco (QA-030)`, async ({ page, data }, info) => {
    test.setTimeout(90_000);
    await login(page, 'ADMINISTRADOR', data);
    await page.goto(consumidor.ruta);
    await page.getByPlaceholder(consumidor.buscador).fill(consumidor.termino(data));
    const nombres = consumidor.filas(data);
    const disparadores = nombres.map((nombre) =>
      page.getByRole('row').filter({ has: page.getByText(nombre, { exact: true }) }).getByRole('button', { name: 'Eliminar', exact: true }),
    );
    for (const d of disparadores) await expect(d).toHaveCount(1);
    const dialog = page.getByRole('dialog');
    const observado = [];

    const primero = disparadores[0];
    // 1) Abrir con teclado, contención de foco, cerrar con Escape.
    await abrirConTeclado(page, primero);
    await expect(dialog).toHaveCount(1);
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await contieneFoco(dialog, page);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    observado.push({ paso: 'Escape', ok: await enfocadoYConectado(primero) });
    expect(observado.at(-1).ok, 'Escape debe devolver el foco al botón Eliminar que abrió el diálogo').toBeTruthy();

    // 2) Reapertura con el mismo botón y cierre con Cancelar.
    await abrirConTeclado(page, primero);
    await expect(dialog).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    observado.push({ paso: 'Cancelar', ok: await enfocadoYConectado(primero) });
    expect(observado.at(-1).ok, 'Cancelar debe devolver el foco al botón que abrió el diálogo').toBeTruthy();

    // 3) Otra fila: el foco vuelve a SU botón, no al de la apertura anterior.
    if (disparadores.length > 1) {
      const segundo = disparadores[1];
      await abrirConTeclado(page, segundo);
      await expect(dialog).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      observado.push({ paso: 'otra fila + Escape', ok: await enfocadoYConectado(segundo) });
      expect(observado.at(-1).ok, 'El foco debe volver al botón de la fila que abrió el diálogo').toBeTruthy();
      expect(await enfocadoYConectado(primero)).toBeFalsy();
    }

    // 4) Tercera apertura del primero (reaperturas repetidas) y cierre con Escape.
    await abrirConTeclado(page, primero);
    await expect(dialog).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    observado.push({ paso: 'tercera apertura + Escape', ok: await enfocadoYConectado(primero) });
    expect(observado.at(-1).ok, 'En la tercera apertura el foco debe seguir volviendo al disparador').toBeTruthy();

    await info.attach('retorno-foco', { body: Buffer.from(JSON.stringify({ consumidor: consumidor.nombre, observado, eliminacionesConfirmadas: 0 })), contentType: 'application/json' });
  });
}

test('A11Y MODALES (se desmonta) Nuevo producto: Escape, Cancelar, reapertura y contención de foco (QA-017/QA-030)', async ({ page, data }, info) => {
  test.setTimeout(90_000);
  await login(page, 'ADMINISTRADOR', data);
  await page.goto('/inventario');
  const disparador = visibleButton(page, 'Nuevo producto');
  const observado = [];

  await abrirConTeclado(page, disparador);
  let form = formWithTitle(page, 'Nuevo producto');
  await expect(form).toHaveAttribute('role', 'dialog');
  await contieneFoco(form, page, 12);
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
  observado.push({ paso: 'Escape', ok: await enfocadoYConectado(disparador) });
  expect(observado.at(-1).ok, 'Escape debe devolver el foco a Nuevo producto').toBeTruthy();

  await abrirConTeclado(page, disparador);
  form = formWithTitle(page, 'Nuevo producto');
  await expect(form).toHaveCount(1);
  await form.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(form).toHaveCount(0);
  observado.push({ paso: 'Cancelar', ok: await enfocadoYConectado(disparador) });
  expect(observado.at(-1).ok, 'Cancelar debe devolver el foco a Nuevo producto').toBeTruthy();

  await abrirConTeclado(page, disparador);
  await expect(formWithTitle(page, 'Nuevo producto')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(formWithTitle(page, 'Nuevo producto')).toHaveCount(0);
  observado.push({ paso: 'tercera apertura + Escape', ok: await enfocadoYConectado(disparador) });
  expect(observado.at(-1).ok).toBeTruthy();

  await info.attach('retorno-foco', { body: Buffer.from(JSON.stringify({ consumidor: 'Nuevo producto', observado })), contentType: 'application/json' });
});
