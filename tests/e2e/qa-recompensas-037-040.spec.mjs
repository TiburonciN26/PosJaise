// Regresión de QA-037 a QA-040 (Recompensas, Fase 1). Solo Supabase Local TEST (la guarda de
// fixtures.mjs verifica rama testing y URL local antes de cada prueba). Las interrupciones de red son
// inyectadas por el navegador de pruebas (route.abort sobre UNA consulta real); nunca se fabrica una
// respuesta de éxito. No se escribe nada de negocio salvo reclamar el cupón de la promoción TEST por UI.
import { test, expect, knownIssue, expectKnownFailure } from './fixtures.mjs';
import { login, logout } from './helpers.mjs';

const TABS = ['Mi tarjeta', 'Canjear puntos', 'Mis sellos', 'Mis cupones', 'Movimientos', 'Cómo funciona'];
const CLAVES = ['tarjeta', 'canje', 'sellos', 'cupones', 'movimientos', 'como'];
const PERSONALES = ['tarjeta', 'sellos', 'cupones', 'movimientos'];
const RPC_PERSONALES = /\/rpc\/(mis_puntos|mis_cupones|mi_fidelizacion|mi_historial_fidelizacion|mi_perfil_cliente|generar_cupon_fidelizacion)/;

const tab = (page, nombre) => page.getByRole('tab', { name: nombre, exact: true });
const seccionDe = (page) => new URL(page.url()).searchParams.get('seccion');

async function irA(page, clave) {
  await page.goto(`/recompensas?seccion=${clave}`);
  await expect(tab(page, TABS[CLAVES.indexOf(clave)])).toHaveAttribute('aria-selected', 'true');
}

test('QA-037: catálogo y ayuda de Recompensas se exploran sin sesión; lo personal pide login sin consultar datos', async ({ page }, info) => {
  knownIssue(info, 'QA-037');
  const consultas = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin === 'http://127.0.0.1:54321') consultas.push(`${r.method()} ${u.pathname}`);
  });

  await page.goto('/recompensas?seccion=canje');
  expectKnownFailure('QA-037');
  await expect(page).toHaveURL(/\/recompensas\?seccion=canje$/);
  await expect(tab(page, 'Canjear puntos')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Cupón de S/5 en servicios seleccionados').first()).toBeVisible();
  await page.getByText('Cupón de S/5 en servicios seleccionados').first().click();
  const obtener = page.getByRole('button', { name: 'Obtener cupón', exact: true }).first();
  await expect(obtener).toBeVisible();
  await expect(obtener).toBeDisabled();
  await expect(page.getByText(/^Tienes .* disponibles$/)).toHaveCount(0);

  await tab(page, 'Cómo funciona').click();
  await expect(page).toHaveURL(/seccion=como$/);
  await expect(page.getByRole('heading', { name: 'Cómo funciona Club Jaise' })).toBeVisible();
  await page.goto('/recompensas?seccion=como');
  await expect(page).toHaveURL(/\/recompensas\?seccion=como$/);
  await expect(page.getByRole('heading', { name: 'Cómo funciona Club Jaise' })).toBeVisible();

  for (const clave of PERSONALES) {
    await page.goto(`/recompensas?seccion=${clave}`);
    await expect(page).toHaveURL(new RegExp(`/recompensas\\?seccion=${clave}$`));
    await expect(page.getByRole('heading', { name: 'Esta sección es solo para clientas con sesión' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Iniciar sesión', exact: true }).first()).toBeVisible();
  }
  // Sin sesión no se consulta ningún dato personal (ni siquiera para "intentar").
  expect(consultas.filter((c) => RPC_PERSONALES.test(c)), 'consultas personales sin sesión').toEqual([]);
  await info.attach('consultas-sin-sesion', { body: Buffer.from(JSON.stringify(consultas, null, 2)), contentType: 'application/json' });
});

test('QA-037: el resto del portal y el POS siguen protegidos sin sesión', async ({ page }, info) => {
  knownIssue(info, 'QA-037');
  for (const ruta of ['/inicio', '/ventas', '/mi-perfil', '/mis-puntos', '/fidelizacion', '/ofertas', '/citas']) {
    await page.goto(ruta);
    await expect(page, ruta).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  }
});

test('QA-037: tras cerrar sesión la vista pública no conserva datos personales', async ({ page, data }, info) => {
  knownIssue(info, 'QA-037');
  await login(page, 'CLIENTE', data);
  await irA(page, 'cupones');
  // Cerrar sesión desde /recompensas debe terminar en /login (como en cualquier otra pantalla).
  await logout(page);
  await page.goto('/recompensas?seccion=cupones');
  expectKnownFailure('QA-037');
  await expect(page.getByRole('heading', { name: 'Esta sección es solo para clientas con sesión' })).toBeVisible();
  await expect(page.getByText(data.clientName)).toHaveCount(0);
  await expect(page.getByText('Sesión iniciada como')).toHaveCount(0);
});

test('QA-039: una consulta fallida no se presenta como saldo cero ni como ausencia de cupones', async ({ page, data }, info) => {
  knownIssue(info, 'QA-039');
  await login(page, 'CLIENTE', data);

  // Precondición por UI: si la promoción TEST es la visible en Inicio, se reclama su cupón.
  await page.goto('/inicio');
  const reclamar = page.getByRole('button', { name: 'Reclamar cupón', exact: true });
  await page.waitForLoadState('networkidle');
  let codigo = null;
  if (await reclamar.isVisible().catch(() => false)) {
    const respuesta = page.waitForResponse((r) => r.url().includes('/rpc/reclamar_cupon_promocion'));
    await reclamar.click();
    const reclamado = await (await respuesta).json();
    codigo = reclamado?.[0]?.codigo ?? null;
  }

  async function interrumpir(rpc) {
    await page.route(`**/rpc/${rpc}`, (route) => route.abort('failed'));
  }
  async function restablecer(rpc) {
    await page.unroute(`**/rpc/${rpc}`);
  }

  // 1) Falla solo mis_cupones.
  await interrumpir('mis_cupones');
  await page.goto('/recompensas?seccion=cupones');
  await expect(tab(page, 'Mis cupones')).toHaveAttribute('aria-selected', 'true');
  expectKnownFailure('QA-039');
  await expect(page.getByRole('alert').filter({ hasText: /No pudimos cargar tus cupones/ })).toBeVisible();
  await expect(page.getByText('No tienes cupones en esta vista')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toBeVisible();
  // Lo demás de la sección que sí cargó sigue utilizable (ofertas) y las otras pestañas también.
  await expect(page.getByText('Ofertas del salón')).toBeVisible();
  await tab(page, 'Mis sellos').click();
  await expect(page.getByText(/de 5 visitas|¡Tarjeta completa!/).first()).toBeVisible();
  await tab(page, 'Mis cupones').click();
  await restablecer('mis_cupones');
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /No pudimos cargar tus cupones/ })).toHaveCount(0);
  if (codigo) await expect(page.getByText(codigo, { exact: true })).toBeVisible();
  else await expect(page.getByText('No tienes cupones en esta vista')).toBeVisible();

  // 2) Falla solo mis_puntos: ni "0 pts" ni tarjeta en cero; el catálogo sigue explorable.
  await interrumpir('mis_puntos');
  await page.goto('/recompensas?seccion=canje');
  await expect(page.getByText('Cupón de S/5 en servicios seleccionados').first()).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: /No pudimos cargar tu saldo de puntos/ })).toBeVisible();
  await expect(page.getByText(/^Tienes .* disponibles$/)).toHaveCount(0);
  await tab(page, 'Mi tarjeta').click();
  await expect(page.getByRole('alert').filter({ hasText: /No pudimos cargar tu saldo de puntos/ })).toBeVisible();
  await expect(page.getByText('PUNTOS DISPONIBLES', { exact: true })).toHaveCount(0);
  await restablecer('mis_puntos');
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(page.getByText('PUNTOS DISPONIBLES', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  // 3) Falla solo mi_fidelizacion: no se afirma "0 visitas"; falla solo el historial: la tarjeta sigue.
  await interrumpir('mi_fidelizacion');
  await page.goto('/recompensas?seccion=sellos');
  await expect(page.getByRole('alert').filter({ hasText: /No pudimos cargar tus sellos/ })).toBeVisible();
  await expect(page.getByText('Todavía no tienes visitas registradas.')).toHaveCount(0);
  await expect(page.getByText('Agenda tu primera cita para empezar a sumar sellos.')).toHaveCount(0);
  await restablecer('mi_fidelizacion');
  await interrumpir('mi_historial_fidelizacion');
  await page.goto('/recompensas?seccion=sellos');
  await expect(page.getByRole('alert').filter({ hasText: /No pudimos cargar el historial de visitas/ })).toBeVisible();
  await expect(page.getByText(/de 5 visitas|¡Tarjeta completa!/).first()).toBeVisible();
  await restablecer('mi_historial_fidelizacion');

  // 4) Falla solo promociones: los cupones siguen y las ofertas avisan.
  await page.route('**/rest/v1/promociones*', (route) => route.abort('failed'));
  await page.goto('/recompensas?seccion=cupones');
  await expect(page.getByRole('alert').filter({ hasText: /No pudimos cargar las ofertas del salón/ })).toBeVisible();
  await page.unroute('**/rest/v1/promociones*');
});

test('QA-038: subpestañas con patrón tablist/tab/tabpanel completo y navegación con flechas', async ({ page, data }, info) => {
  knownIssue(info, 'QA-038');
  await login(page, 'CLIENTE', data);
  await irA(page, 'tarjeta');
  expectKnownFailure('QA-038');

  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(6);
  // Un único punto de entrada para Tab (tabindex roving) y asociaciones ARIA.
  const tabindex = await tabs.evaluateAll((els) => els.map((e) => e.getAttribute('tabindex')));
  expect(tabindex.filter((v) => v === '0'), 'solo la pestaña activa pertenece al recorrido Tab').toHaveLength(1);
  expect(tabindex[0]).toBe('0');
  const ids = await tabs.evaluateAll((els) => els.map((e) => e.id));
  expect(ids.every(Boolean), 'cada tab con id').toBeTruthy();
  expect(new Set(ids).size).toBe(6);
  const panel = page.getByRole('tabpanel');
  await expect(panel).toHaveCount(1);
  const idActivo = await tab(page, 'Mi tarjeta').getAttribute('id');
  await expect(panel).toHaveAttribute('aria-labelledby', idActivo);
  await expect(tab(page, 'Mi tarjeta')).toHaveAttribute('aria-controls', await panel.getAttribute('id'));
  await expect(page.getByRole('tablist')).toHaveAttribute('aria-label', 'Secciones de Recompensas');

  // Flechas: mueven el foco y la selección, con envoltura circular y Home/End.
  await tab(page, 'Mi tarjeta').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'Canjear puntos')).toBeFocused();
  await expect(tab(page, 'Canjear puntos')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => seccionDe(page)).toBe('canje');
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', await tab(page, 'Canjear puntos').getAttribute('id'));
  await page.keyboard.press('ArrowLeft');
  await expect(tab(page, 'Mi tarjeta')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tab(page, 'Cómo funciona')).toBeFocused();
  await expect.poll(() => seccionDe(page)).toBe('como');
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'Mi tarjeta')).toBeFocused();
  await page.keyboard.press('End');
  await expect(tab(page, 'Cómo funciona')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tab(page, 'Mi tarjeta')).toBeFocused();
  // Esperar a que la selección (y el tabindex) se actualicen antes de seguir con Tab.
  await expect(tab(page, 'Mi tarjeta')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'Mi tarjeta')).toHaveAttribute('tabindex', '0');

  // Tab sale de la lista (no recorre las demás pestañas).
  await page.keyboard.press('Tab');
  const enOtraTab = await page.evaluate(() => document.activeElement?.getAttribute('role') === 'tab');
  expect(enOtraTab, 'Tab no debe caer en otra pestaña').toBeFalsy();

  // Clic, recarga y atrás/adelante siguen reflejándose en la URL.
  await tab(page, 'Mis cupones').click();
  await expect.poll(() => seccionDe(page)).toBe('cupones');
  await page.reload();
  await expect(tab(page, 'Mis cupones')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'Mis cupones')).toHaveAttribute('tabindex', '0');
  await page.goBack();
  await expect(tab(page, 'Mi tarjeta')).toHaveAttribute('aria-selected', 'true');
  await page.goForward();
  await expect(tab(page, 'Mis cupones')).toHaveAttribute('aria-selected', 'true');
});

test('QA-040: la condición del tope de la recompensa de sellos se lee completa a 320 px', async ({ page, data }, info) => {
  knownIssue(info, 'QA-040');
  await login(page, 'CLIENTE', data);
  await page.setViewportSize({ width: 320, height: 800 });
  await irA(page, 'sellos');
  const pildora = page.getByText('Recompensa de la nueva tarjeta: propuesta (20 %, máx. S/5)');
  await expect(pildora).toBeVisible();
  await page.waitForTimeout(800);
  expectKnownFailure('QA-040');
  const medida = await pildora.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width, scroll: el.scrollWidth, client: el.clientWidth, docWidth: document.documentElement.scrollWidth, viewport: window.innerWidth, ws: getComputedStyle(el).whiteSpace };
  });
  await info.attach('pildora-320', { body: Buffer.from(JSON.stringify(medida)), contentType: 'application/json' });
  expect(medida.left, 'dentro del viewport (izquierda)').toBeGreaterThanOrEqual(0);
  expect(medida.right, 'dentro del viewport (derecha)').toBeLessThanOrEqual(medida.viewport);
  expect(medida.scroll).toBeLessThanOrEqual(medida.client + 1);
  expect(medida.docWidth).toBeLessThanOrEqual(medida.viewport);
});

for (const ancho of [320, 390, 768, 1440]) {
  test(`QA-040: ninguna sección de Recompensas desborda horizontalmente a ${ancho} px`, async ({ page, data }, info) => {
    knownIssue(info, 'QA-040');
    await login(page, 'CLIENTE', data);
    await page.setViewportSize({ width: ancho, height: 900 });
    const resumen = [];
    for (const clave of CLAVES) {
      await irA(page, clave);
      await page.waitForTimeout(500);
      const m = await page.evaluate(() => {
        const vw = window.innerWidth;
        // Píldoras y textos propios de Recompensas que se salen del viewport.
        const fuera = [...document.querySelectorAll('main span, main p, main h1, main h2, main h3, main button')]
          .filter((el) => !el.closest('.tp-stage') && el.getClientRects().length)
          .map((el) => ({ t: el.textContent.trim().slice(0, 60), r: Math.round(el.getBoundingClientRect().right), l: Math.round(el.getBoundingClientRect().left) }))
          .filter((x) => x.r > vw + 1 || x.l < -1);
        return { doc: document.documentElement.scrollWidth, vw, fuera };
      });
      resumen.push({ clave, ...m });
    }
    await info.attach(`desborde-${ancho}`, { body: Buffer.from(JSON.stringify(resumen, null, 2)), contentType: 'application/json' });
    for (const r of resumen) {
      expect(r.doc, `${r.clave}: ancho del documento`).toBeLessThanOrEqual(r.vw);
      expect(r.fuera, `${r.clave}: elementos fuera del viewport`).toEqual([]);
    }
  });
}

// Los arreglos QA-037 a QA-040 no deben tocar efectos ni animaciones: la tarjeta de puntos (flotación y
// arrastre 3D), los cupones por nivel (brillo, glow, chispas) y las tarjetas de nivel siguen animándose.
test('Efectos y animaciones de Recompensas intactos (tarjeta de puntos, cupones y tarjetas de nivel)', async ({ page, data }) => {
  await login(page, 'CLIENTE', data);
  await irA(page, 'tarjeta');

  const transformA = await page.locator('.tp-card').evaluate((el) => el.style.transform);
  await page.waitForTimeout(600);
  const transformB = await page.locator('.tp-card').evaluate((el) => el.style.transform);
  expect(transformA, 'flotación idle de la tarjeta 3D').not.toBe(transformB);
  expect(transformA).toContain('rotateY');

  // Arrastrar gira la tarjeta en 3D.
  const caja = await page.locator('.tp-stage').boundingBox();
  await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
  await page.mouse.down();
  await page.mouse.move(caja.x + caja.width / 2 + 160, caja.y + caja.height / 2, { steps: 8 });
  await expect(page.locator('.tp-card')).toHaveClass(/tp-arrastrando/);
  await page.mouse.up();
  await expect(page.locator('.tp-card')).not.toHaveClass(/tp-arrastrando/);

  // Las tres tarjetas de nivel conservan capas metálicas y destello que se desplaza.
  await expect(page.locator('.tn-fondo')).toHaveCount(3);
  const sheen = page.locator('.tn-fondo .tp-sheen').first();
  const leftA = await sheen.evaluate((el) => el.style.left);
  await page.waitForTimeout(600);
  expect(await sheen.evaluate((el) => el.style.left), 'destello .tp-sheen en movimiento').not.toBe(leftA);
  await expect(page.locator('.tn-fondo .tp-glare')).toHaveCount(3);

  // Cupones por nivel en Canjear puntos: Oro (glow, chispas) y Plata (destello).
  await irA(page, 'canje');
  const oro = page.locator('.cupon-oro').first();
  await expect(oro).toBeVisible();
  expect(await oro.evaluate((el) => getComputedStyle(el).animationName)).toContain('cupon-glow');
  expect(await page.locator('.cupon-chispa').count(), 'chispas del nivel Oro').toBeGreaterThanOrEqual(3);
  expect(await page.locator('.cupon-texto-oro').first().evaluate((el) => getComputedStyle(el).animationName)).toContain('cupon-brillo-texto');
  expect(await page.locator('.cupon-plata').first().evaluate((el) => getComputedStyle(el, '::after').animationName)).toContain('cupon-sheen');
});
