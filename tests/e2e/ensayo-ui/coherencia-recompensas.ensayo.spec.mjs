// Coherencia de Recompensas en TODAS las pantallas del portal (Citas, detalle de servicio y de producto, carrito de servicios, Inicio y
// Recompensas), con sesiones REALES en la instancia desechable «JaiseEnsayo». Solo se observa la interfaz y se actúa por las vías
// normales (inicio de sesión, RPC con la sesión de la clienta o de la cajera). No se comprueba ni altera ningún estilo, efecto o
// animación; las comprobaciones de «efectos» solo verifican que los elementos de la tarjeta siguen ahí y que nada se desborda.
//
// Preparación: ENSAYO_PASSWORD (ficticia, solo del proceso) + `node tests/e2e/ensayo-preparar-coherencia.mjs`. El gasto de monedas
// consume el saldo de la escena «gasto»: para repetir la especificación hay que preparar de nuevo. La especificación cambia la
// configuración del ensayo (programa, tasas, umbrales, sellos) y SIEMPRE la restaura al terminar, aunque un caso falle.
import { readFileSync } from 'node:fs';
import { test, expect } from 'playwright/test';
import { verificarEntorno, soloRedDelEnsayo, loginUI, sesion, rpc, mensaje, sql, sqlJson, supabaseURL } from './ayuda.mjs';

const C = JSON.parse(readFileSync(new URL('../fixtures/ensayo-coherencia-runtime.json', import.meta.url), 'utf8'));
const O = C.configOriginal;
const g = C.clientas.gasto; const prem = C.clientas.premium; const nueva = C.clientas.nueva; const neg = C.clientas.negativa;

async function configurar(c) {
  const set = Object.entries(c).map(([k, v]) => `${k} = ${v}`).join(', ');
  await sql(`update public.recompensas_config set ${set}, actualizado_en = now() where id = 1`);
}
async function restaurarConfig() {
  await sql(`update public.recompensas_config set activo = ${O.activo}, corte = ${O.corte ? `'${O.corte}'::timestamptz` : 'null'},
    tasa_serv_monedas = ${O.tasa_serv_monedas}, tasa_serv_soles = ${O.tasa_serv_soles}, tasa_prod_monedas = ${O.tasa_prod_monedas},
    tasa_prod_soles = ${O.tasa_prod_soles}, umbral_premium = ${O.umbral_premium}, umbral_vip = ${O.umbral_vip},
    sellos_max = ${O.sellos_max}, sellos_por_premio = ${O.sellos_por_premio}, actualizado_en = '${O.actualizado_en}'::timestamptz where id = 1`);
}
const ENCENDIDO = { activo: true };
const APAGADO = { activo: false };

// Catálogo de sellos limpio SOLO en el ensayo: queda activo únicamente el premio propio de esta preparación (los demás se apagan y se
// vuelven a encender al terminar, aunque un caso falle). Los ids se guardan en memoria.
let sellosApagados = [];
test.beforeAll(async ({ request }) => {
  await verificarEntorno(request);
  await restaurarConfig();
  await sql(`update public.recompensas_catalogo set activo = true where id in ('${C.premios.monedas.id}', '${C.premios.sellos.id}')`);
  sellosApagados = await sqlJson(`with d as (update public.recompensas_catalogo set activo = false
    where origen = 'SELLOS' and activo and id <> '${C.premios.sellos.id}' returning id) select coalesce(json_agg(id), '[]'::json) from d`);
});
test.afterAll(async () => {
  await restaurarConfig();
  const ids = sellosApagados.map((i) => `'${i}'`).join(',');
  if (ids) await sql(`update public.recompensas_catalogo set activo = true where id in (${ids})`);
  await sql(`update public.recompensas_catalogo set activo = false where id in ('${C.premios.monedas.id}', '${C.premios.sellos.id}')`);
});
test.beforeEach(async ({ context }) => { await soloRedDelEnsayo(context); });
test.afterEach(async () => { await restaurarConfig(); });

const bloqueSaldo = (page) => page.getByRole('region', { name: 'Tu saldo y nivel' });
const sinBasura = async (page) => expect(await page.locator('main').innerText()).not.toMatch(/NaN|undefined|\[object|Infinity/);
async function saldoSql(id) {
  return sqlJson(`select to_json(s) from public.recompensas_saldos('${id}') s`);
}

// ---------------------------------------------------------------------------------------------------------------------------
test.describe('Programa ACTIVO · monedas y clasificación separadas', () => {
  test('Citas: gastar monedas NO reduce la barra, el «faltan» ni el nivel (clasificación 40, monedas 40 → 10)', async ({ request, page }) => {
    await configurar(ENCENDIDO);
    expect(await saldoSql(g.id)).toMatchObject({ monedas: 40, clasificacion: 40, nivel: 'BASICO', sellos: 3 });
    await loginUI(page, g.email);
    await page.goto('/citas');
    const antes = bloqueSaldo(page);
    await expect(antes.getByRole('heading', { name: 'Monedas', exact: true })).toBeVisible();
    await expect(antes).toContainText('40');
    await expect(antes).toContainText('monedas disponibles');
    await expect(antes).toContainText('Nivel Básico');
    const barra = antes.getByRole('progressbar', { name: 'Progreso de clasificación' });
    await expect(barra).toHaveAttribute('aria-valuenow', '80');
    await expect(antes).toContainText('10 puntos de clasificación para Premium');
    await expect(antes).toContainText('Gastar monedas no baja tu nivel');
    // Sellos: tarjeta vigente (3 de 5) y sin un porcentaje fijo prometido.
    await expect(antes).toContainText('3 de 5 · faltan 2 para tu próximo premio');
    await expect(antes).not.toContainText(/20 ?%/);
    await expect(antes).not.toContainText(/\bpts\b/); // nada de «pts» mezclado: son monedas y puntos de clasificación

    // Gasto REAL con la sesión de la clienta (canje de un premio de 30 monedas).
    const s = await sesion(request, g.email);
    const c = await rpc(request, s.token, 'canjear_recompensa', { p_catalogo_id: C.premios.monedas.id, p_clave: `coh-gasto-${C.nonce}` });
    expect(c.status, mensaje(c)).toBe(200);
    expect(await saldoSql(g.id)).toMatchObject({ monedas: 10, clasificacion: 40, nivel: 'BASICO' });

    await page.goto('/citas');
    const despues = bloqueSaldo(page);
    await expect(despues).toContainText('monedas disponibles');
    await expect(despues.locator('span.font-mono')).toHaveText('10');
    await expect(despues.getByRole('progressbar', { name: 'Progreso de clasificación' })).toHaveAttribute('aria-valuenow', '80'); // igual que antes
    await expect(despues).toContainText('10 puntos de clasificación para Premium');
    await expect(despues).toContainText('Nivel Básico');
    await sinBasura(page);

    // Recompensas → Mi tarjeta: monedas y clasificación separadas, misma clasificación.
    await page.goto('/recompensas?seccion=tarjeta');
    const panel = page.getByRole('tabpanel');
    await expect(panel).toContainText('MONEDAS DISPONIBLES');
    await expect(panel).toContainText('FALTAN 10 PTS · PREMIUM');
    await expect(panel).toContainText('40 de 150 puntos de clasificación hacia VIP');
    await expect(panel).toContainText('Saldo de monedas: 10');
    await expect(panel.locator('.tp-puntos')).toContainText('MONEDAS'); // la unidad de la tarjeta ya no dice «PTS»
    await expect(panel.locator('.tp-puntos')).not.toContainText('PTS');
    await expect(page.getByRole('tab', { name: 'Canjear monedas' })).toBeVisible();
  });

  test('Citas · Premium (clasificación 60): barra por clasificación dentro del nivel y «faltan» para VIP', async ({ page }) => {
    await configurar(ENCENDIDO);
    await loginUI(page, prem.email);
    await page.goto('/citas');
    const b = bloqueSaldo(page);
    await expect(b).toContainText('Nivel Premium');
    await expect(b).toContainText('monedas disponibles');
    await expect(b.getByRole('progressbar', { name: 'Progreso de clasificación' })).toHaveAttribute('aria-valuenow', '10'); // (60−50)/(150−50)
    await expect(b).toContainText('90 puntos de clasificación para VIP');
  });

  test('Citas · saldo negativo de monedas: se muestra tal cual y la clasificación sigue marcando el avance', async ({ page }) => {
    await configurar(ENCENDIDO);
    await loginUI(page, neg.email);
    await page.goto('/citas');
    const b = bloqueSaldo(page);
    await expect(b.locator('span.font-mono')).toHaveText('-12');
    await expect(b.getByRole('progressbar', { name: 'Progreso de clasificación' })).toHaveAttribute('aria-valuenow', '40'); // 20/50
    await sinBasura(page);
  });

  test('Inicio: «Mis monedas» con el saldo gastable (no «Mis puntos»)', async ({ page }) => {
    await configurar(ENCENDIDO);
    await loginUI(page, prem.email);
    await page.goto('/inicio');
    await expect(page.getByText('Mis monedas', { exact: true })).toBeVisible();
    await expect(page.getByText('Mis puntos', { exact: true })).toHaveCount(0);
  });

  test('Detalle de servicio y de producto: estimado en monedas con las tasas vigentes (5/20 y 5/40) y sin la fórmula antigua', async ({ page }) => {
    await configurar(ENCENDIDO);
    await loginUI(page, nueva.email);
    await page.goto(`/servicios/${C.servicio.id}`);
    await expect(page.getByText(/≈ 25 monedas/)).toBeVisible(); // S/100 × 5 / 20
    await expect(page.getByText('estimado, se acredita al confirmarse la compra')).toBeVisible();
    await expect(page.getByText('Puede dar 1 sello')).toBeVisible();
    await expect(page.getByText(/si tu venta confirmada incluye servicios \(máx\. 1 por día\)/)).toBeVisible();
    await expect(page.getByText('aprox. por esta visita')).toHaveCount(0);
    await expect(page.getByText(/\+\d+ puntos/)).toHaveCount(0);
    await page.goto(`/productos/${C.producto.id}`);
    await expect(page.getByText(/≈ 10 monedas/)).toBeVisible(); // S/80 × 5 / 40
    await expect(page.getByText(/\+\d+ puntos/)).toHaveCount(0);
  });

  test('Las tasas configuradas distintas (servicios 3/25, productos 3/16) se reflejan sin tocar el código', async ({ page }) => {
    await configurar({ ...ENCENDIDO, tasa_serv_monedas: 3, tasa_serv_soles: 25, tasa_prod_monedas: 3, tasa_prod_soles: 16 });
    await loginUI(page, nueva.email);
    await page.goto(`/servicios/${C.servicio.id}`);
    await expect(page.getByText(/≈ 12 monedas/)).toBeVisible(); // 100 × 3 / 25
    await page.goto(`/productos/${C.producto.id}`);
    await expect(page.getByText(/≈ 15 monedas/)).toBeVisible(); // 80 × 3 / 16
    await page.goto('/recompensas?seccion=como');
    const panel = page.getByRole('tabpanel');
    await expect(panel).toContainText('3 monedas por cada S/ 25');
    await expect(panel).toContainText('3 monedas por cada S/ 16');
    await expect(panel).not.toContainText('5 monedas por cada S/ 20');
  });

  test('Cómo funciona (con sesión): tasas, umbrales y sellos salen de la configuración; sin la atribución antigua de sellos', async ({ page }) => {
    await configurar({ ...ENCENDIDO, umbral_premium: 30, umbral_vip: 90, sellos_max: 12, sellos_por_premio: 4 });
    await loginUI(page, nueva.email);
    await page.goto('/recompensas?seccion=como');
    const panel = page.getByRole('tabpanel');
    await expect(panel.getByRole('heading', { name: 'Cómo funciona Club Jaise' })).toBeVisible();
    await expect(panel).toContainText('5 monedas por cada S/ 20');
    await expect(panel).toContainText('5 monedas por cada S/ 40');
    await expect(panel).toContainText('Premium desde 30 y VIP desde 90 puntos de clasificación');
    await expect(panel).toContainText('hasta 12 sellos y cada premio cuesta 4.');
    await expect(panel).toContainText('Se acredita cuando la venta queda confirmada');
    await expect(panel).toContainText('reservar o completar una atención por sí solos no suman');
    await expect(panel).toContainText('Un sello por día de Perú cuando una venta confirmada incluye servicios, venga o no de una cita web');
    await expect(panel).toContainText('Los productos solos no dan sello');
    await expect(panel).toContainText('Gastar monedas no baja tu nivel');
    await expect(panel).toContainText('no podrás canjear hasta compensarlo');
    await expect(panel).toContainText('El canje es definitivo');
    await expect(panel).toContainText('Solo puedes usar un cupón por compra');
    await expect(panel).toContainText('el cupón se rechaza completo, no se consume y puedes usarlo en otra compra');
    // Lo que NO debe aparecer: la atribución antigua, tasas «propuestas» y datos internos de protección.
    await expect(panel).not.toContainText('visitas reservadas en la web');
    await expect(panel).not.toContainText('Tasas propuestas');
    await expect(panel).not.toContainText(/hasta el 50 % del precio\. En los servicios con protección/);
    await expect(panel).not.toContainText(/costo|transporte|comisi[oó]n|asistente|material/i);
    await expect(page.getByRole('tab', { name: 'Canjear monedas' })).toBeVisible();
  });

  test('Mis sellos y Citas: el beneficio sale del catálogo administrado (25 %, máx. S/ 8), nunca un 20 % fijo', async ({ page }) => {
    await configurar(ENCENDIDO);
    await loginUI(page, g.email);
    await page.goto('/recompensas?seccion=sellos');
    const panel = page.getByRole('tabpanel');
    await expect(panel).toContainText(C.premios.sellos.nombre);
    await expect(panel).toContainText('25% de descuento (máximo S/ 8.00)');
    await page.goto('/citas');
    const todo = await page.locator('main').innerText();
    expect(todo).not.toMatch(/20 ?%/);
    expect(todo).not.toContain('para tu 20');
    await expect(page.getByText('Los premios y sus beneficios son los del catálogo vigente')).toBeVisible();
    await expect(page.getByText('Próximamente', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Muy pronto:')).toHaveCount(0);
  });

  test('Citas · explicación activa: monedas, clasificación y sellos con las cifras vigentes; no suman reserva ni atención por sí solas', async ({ page }) => {
    await configurar(ENCENDIDO);
    await loginUI(page, nueva.email);
    await page.goto('/citas');
    const sec = page.getByRole('region', { name: 'Cómo ganas monedas y sellos' });
    await expect(sec).toContainText('5 monedas por cada S/ 20 en servicios');
    await expect(sec).toContainText('5 monedas por cada S/ 40 en productos');
    await expect(sec).toContainText('desde 50 pts');
    await expect(sec).toContainText('desde 150 pts');
    await expect(sec).toContainText('1 sello por día de Perú');
    await expect(sec).toContainText('Al juntar 5 sellos canjeas un premio');
    await expect(sec).toContainText('Guardas hasta 20 sellos');
    await expect(sec).toContainText('Completar la atención no suma por sí sola');
    await expect(sec).toContainText('Venta confirmada');
    await expect(sec).not.toContainText('se suman tus puntos y tu sello');
    await expect(sec).not.toContainText(/costo|transporte|comisi[oó]n|asistente/i);
  });

  test('Reserva y atención SIN cobro no acreditan; la venta confirmada sí (monedas y sello) — y la pantalla lo refleja', async ({ request, page }) => {
    await configurar(ENCENDIDO);
    const cajera = await sesion(request, C.cuentas.CAJERA);
    // Reserva (cita PENDIENTE de mañana) y atención registrada SIN venta.
    const citaId = await sqlJson(`with c as (
        insert into public.citas (cliente_id, creado_por, fecha_hora, estado)
        values ('${nueva.id}', '${C.adminId}', date_trunc('day', now() at time zone 'America/Lima' + interval '1 day') + interval '15 hours' + interval '5 hours', 'PENDIENTE') returning id),
      cs as (insert into public.cita_servicios (cita_id, servicio_id, precio, duracion_min)
        select id, '${C.servicio.id}', 100, 60 from c) select to_json(id) from c`);
    const atencionId = await sqlJson(`with a as (
        insert into public.registro_servicios (usuario_id, servicio_id, cliente_id, precio, fecha, estado)
        values ('${C.adminId}', '${C.servicio.id}', '${nueva.id}', 100, now(), 'ACTIVO') returning id) select to_json(id) from a`);
    expect(await saldoSql(nueva.id)).toMatchObject({ monedas: 0, clasificacion: 0, sellos: 0 });

    await loginUI(page, nueva.email);
    await page.goto('/citas');
    let b = bloqueSaldo(page);
    await expect(b.locator('span.font-mono')).toHaveText('0');
    // La reserva muestra un ESTIMADO (no una acreditación) y un sello que «puede» sumarse.
    await expect(page.getByText('Estimado ≈ 25 monedas').first()).toBeVisible();
    await expect(page.getByText('Puede sumar 1 sello').first()).toBeVisible();
    await expect(page.getByText(/^\+\d+ pts$/)).toHaveCount(0);

    // Completar la cita (atención hecha) tampoco acredita.
    await sql(`update public.citas set estado = 'COMPLETADA' where id = '${citaId}'`);
    expect(await saldoSql(nueva.id)).toMatchObject({ monedas: 0, sellos: 0 });
    await page.goto('/citas');
    b = bloqueSaldo(page);
    await expect(b.locator('span.font-mono')).toHaveText('0');
    await expect(page.getByText(/Estimado ≈/)).toHaveCount(0); // la cita completada ya no promete un estimado

    // Venta confirmada con la sesión de la cajera: ahora sí.
    const v = await rpc(request, cajera.token, 'confirmar_venta', {
      p_metodo_pago: 'Yape', p_monto_recibido: null, p_items: [{ tipo: 'SERVICIO', registro_servicio_id: atencionId, cantidad: 1 }],
      p_cliente_id: nueva.id, p_descuento_pct: 0, p_descuento_monto: 0, p_monto_pos_tarjeta: null, p_codigo_cupon: null, p_costo_delivery: 0,
    });
    expect(v.status, mensaje(v)).toBe(200);
    expect(await saldoSql(nueva.id)).toMatchObject({ monedas: 25, clasificacion: 25, sellos: 1 });
    await page.goto('/citas');
    b = bloqueSaldo(page);
    await expect(b.locator('span.font-mono')).toHaveText('25');
    await expect(b).toContainText('1 de 5 · faltan 4 para tu próximo premio');
    await expect(b.getByRole('progressbar', { name: 'Progreso de clasificación' })).toHaveAttribute('aria-valuenow', '50'); // 25/50
    await sinBasura(page);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
test.describe('Programa APAGADO · se conserva lo heredado y no se anuncia el programa nuevo', () => {
  test('Detalle de servicio: fórmula heredada (+5 puntos); detalle de producto: sin promesa de puntos; sin la palabra «monedas»', async ({ page }) => {
    await configurar(APAGADO);
    await loginUI(page, nueva.email);
    await page.goto(`/servicios/${C.servicio.id}`);
    await expect(page.getByText(/\+5 puntos/)).toBeVisible(); // S/100 × 0,05 (config_puntos)
    await expect(page.getByText('aprox. por esta visita')).toBeVisible();
    await expect(page.getByText(/Suma sello/)).toBeVisible();
    await expect(page.locator('main')).not.toContainText('monedas');
    await page.goto(`/productos/${C.producto.id}`);
    await expect(page.getByText(/Suma con tus servicios/)).toBeVisible();
    await expect(page.getByText('las compras de productos aún no dan puntos')).toBeVisible();
    await expect(page.getByText(/\+\d+ puntos/)).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('monedas');
  });

  test('Citas e Inicio heredados: «Puntos», «Mis puntos», sin monedas, sin «Próximamente» ni un 20 % fijo', async ({ page }) => {
    await configurar(APAGADO);
    await loginUI(page, g.email);
    await page.goto('/citas');
    const b = bloqueSaldo(page);
    await expect(b.getByRole('heading', { name: 'Puntos', exact: true })).toBeVisible();
    await expect(b).not.toContainText('monedas');
    await expect(b.getByRole('progressbar', { name: 'Progreso de nivel' })).toBeVisible();
    const sec = page.getByRole('region', { name: 'Cómo ganas puntos y sellos' });
    await expect(sec).toContainText('por cada día que te atiendes');
    await expect(sec).toContainText('que pagas en servicios');
    await expect(sec).toContainText('Completada');
    await expect(sec).toContainText('El canje de recompensas por cupones se activará próximamente');
    await expect(sec).not.toContainText('Muy pronto');
    await expect(sec).not.toContainText(/20 ?%/);
    await expect(page.getByText('para tu 20%')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('monedas');
    await page.goto('/inicio');
    await expect(page.getByText('Mis puntos', { exact: true })).toBeVisible();
    await expect(page.getByText('Mis monedas', { exact: true })).toHaveCount(0);
    await page.goto('/recompensas?seccion=tarjeta');
    await expect(page.getByRole('tab', { name: 'Canjear puntos' })).toBeVisible();
  });

  test('Cómo funciona con el programa apagado: aviso claro, sin tasas ni umbrales del programa nuevo', async ({ page }) => {
    await configurar(APAGADO);
    await loginUI(page, nueva.email);
    await page.goto('/recompensas?seccion=como');
    const panel = page.getByRole('tabpanel');
    await expect(panel).toContainText('todavía no está activo');
    await expect(panel).toContainText('siguen rigiendo tus puntos y sellos actuales');
    await expect(panel).not.toContainText(/monedas por cada S\//);
    await expect(panel).not.toContainText('Tasas propuestas');
    await expect(panel).not.toContainText('visitas reservadas en la web');
    await expect(panel).not.toContainText(/Premium desde|VIP desde/);
  });
});

test.describe('Programa APAGADO · tarjeta de sellos heredada', () => {
  test('el porcentaje del cupón sale de config_fidelizacion (30 %, no un 20 % fijo) y, si no se lee, no se promete una cifra', async ({ page }) => {
    await configurar(APAGADO);
    const original = await sqlJson(`select to_json(porcentaje_recompensa) from public.config_fidelizacion where id = 1`);
    try {
      await sql(`update public.config_fidelizacion set porcentaje_recompensa = 30 where id = 1`);
      await loginUI(page, g.email);
      await page.goto('/recompensas?seccion=sellos');
      const panel = page.getByRole('tabpanel');
      await expect(panel).toContainText('ganas 30% de descuento en tu próximo servicio');
      await expect(panel).not.toContainText('20% de descuento');
      await expect(panel).toContainText('hayas reservado en la web o no');
      await expect(panel).not.toContainText('Una cita que reservaste en la web genera un sello');
      // Lectura fallida: sin cifra inventada.
      await page.route('**/rest/v1/config_fidelizacion*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"fallo simulado"}' }));
      await page.goto('/recompensas?seccion=sellos');
      await expect(page.getByRole('tabpanel')).toContainText('ganas un cupón de descuento en tu próximo servicio');
      await expect(page.getByRole('tabpanel')).not.toContainText(/\d+% de descuento/);
    } finally {
      await sql(`update public.config_fidelizacion set porcentaje_recompensa = ${original} where id = 1`);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
test.describe('Configuración lenta o fallida: nunca una tasa, saldo o beneficio inventado', () => {
  test('Lenta: «Cómo funciona» y el detalle de servicio no muestran cifras hasta que llegan las reglas', async ({ page }) => {
    await configurar(ENCENDIDO);
    let soltar;
    const retenida = new Promise((r) => { soltar = r; });
    await page.route('**/rpc/recompensas_reglas_publicas', async (route) => { await retenida; await route.continue(); });
    await loginUI(page, nueva.email);
    await page.goto('/recompensas?seccion=como');
    const panel = page.getByRole('tabpanel');
    await expect(panel.getByRole('heading', { name: 'Cómo funciona Club Jaise' })).toBeVisible();
    await expect(panel.getByLabel('Cargando tus datos')).toBeVisible();
    await expect(panel).not.toContainText(/monedas por cada S\//);
    await page.goto(`/servicios/${C.servicio.id}`);
    await expect(page.getByText(/Calculando…/)).toBeVisible();
    await expect(page.getByText(/≈ \d/)).toHaveCount(0);
    await expect(page.getByText(/\+\d+ puntos/)).toHaveCount(0);
    soltar();
    await expect(page.getByText(/≈ 25 monedas/)).toBeVisible();
    await expect(page.getByText(/Calculando…/)).toHaveCount(0);
  });

  test('Fallida: aviso con reintento, ninguna cifra de reemplazo, y al reintentar aparece lo real', async ({ page }) => {
    await configurar(ENCENDIDO);
    let fallar = true;
    await page.route('**/rpc/recompensas_reglas_publicas', async (route) => {
      if (fallar) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'fallo simulado' }) });
      return route.continue();
    });
    await loginUI(page, nueva.email);
    await page.goto('/recompensas?seccion=como');
    const panel = page.getByRole('tabpanel');
    await expect(panel.getByRole('alert')).toContainText('No pudimos cargar las reglas del programa');
    await expect(panel).not.toContainText(/monedas por cada S\//);
    await expect(panel).not.toContainText(/desde \d/);
    // Detalle de servicio: ni «+N puntos» ni «≈ N monedas».
    await page.goto(`/servicios/${C.servicio.id}`);
    await expect(page.getByText('no disponibles ahora')).toBeVisible();
    await expect(page.getByText(/≈ \d/)).toHaveCount(0);
    await expect(page.getByText(/\+\d+ puntos/)).toHaveCount(0);
    // Citas: el bloque de saldo no muestra un saldo que no se leyó y la explicación avisa.
    await page.goto('/citas');
    await expect(bloqueSaldo(page).getByRole('alert')).toContainText('No pudimos cargar tu saldo ahora');
    await expect(bloqueSaldo(page)).not.toContainText('monedas disponibles');
    await expect(page.getByRole('region', { name: /Cómo ganas/ }).getByRole('alert')).toContainText('No pudimos cargar las reglas del programa');
    // Reintentar con el servidor ya sano.
    fallar = false;
    await bloqueSaldo(page).getByRole('button', { name: 'Reintentar' }).click();
    await expect(bloqueSaldo(page)).toContainText('monedas disponibles');
    await expect(page.getByRole('region', { name: 'Cómo ganas monedas y sellos' })).toContainText('5 monedas por cada S/ 20 en servicios');
  });

  test('Saldo propio fallido con el programa activo: sin saldo inventado en Citas; reintento recupera', async ({ page }) => {
    await configurar(ENCENDIDO);
    let fallar = true;
    await page.route('**/rpc/mi_saldo_recompensas', async (route) => {
      if (fallar) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'fallo simulado' }) });
      return route.continue();
    });
    await loginUI(page, g.email);
    await page.goto('/citas');
    await expect(bloqueSaldo(page).getByRole('alert')).toContainText('No pudimos cargar tu saldo ahora');
    await expect(bloqueSaldo(page)).not.toContainText(/\b40\b/);
    fallar = false;
    await bloqueSaldo(page).getByRole('button', { name: 'Reintentar' }).click();
    await expect(bloqueSaldo(page).locator('span.font-mono')).toHaveText(/^(40|10)$/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
test.describe('Acceso público sin datos personales', () => {
  test('Sin sesión: «Cómo funciona» usa solo la lectura pública mínima de reglas y no pide nada personal', async ({ browser }) => {
    await configurar({ ...ENCENDIDO, tasa_serv_monedas: 3, tasa_serv_soles: 25 });
    const ctx = await browser.newContext({ baseURL: 'http://localhost:5273', timezoneId: 'America/Lima', locale: 'es-PE', viewport: { width: 1280, height: 900 } });
    await soloRedDelEnsayo(ctx);
    const page = await ctx.newPage();
    const rpcs = [];
    let cuerpoReglas = null;
    page.on('response', async (r) => {
      const m = r.url().match(/\/rest\/v1\/rpc\/([a-z_]+)/);
      if (!m) return;
      rpcs.push(m[1]);
      if (m[1] === 'recompensas_reglas_publicas') cuerpoReglas = await r.json();
    });
    await page.goto('/recompensas?seccion=como');
    const panel = page.getByRole('tabpanel');
    await expect(panel).toContainText('3 monedas por cada S/ 25');
    expect(cuerpoReglas).toHaveLength(1);
    // Solo lo mínimo: ni costos, ni protección, ni corte, ni saldos de nadie.
    expect(Object.keys(cuerpoReglas[0]).sort()).toEqual(['activo', 'sellos_max', 'sellos_por_premio', 'tasa_prod_monedas', 'tasa_prod_soles', 'tasa_serv_monedas', 'tasa_serv_soles', 'umbral_premium', 'umbral_vip']);
    expect(rpcs.filter((n) => /^(mis_|mi_)/.test(n)), `RPC personales pedidas sin sesión: ${rpcs.join(', ')}`).toEqual([]);
    await expect(panel).not.toContainText(/costo|transporte|comisi[oó]n|asistente|material/i);
    await ctx.close();
  });

  test('Sin sesión y programa apagado: la lectura pública no adelanta ninguna cifra', async ({ request, browser }) => {
    await configurar(APAGADO);
    const lectura = await request.post(`${supabaseURL}/rest/v1/rpc/recompensas_reglas_publicas`, { headers: { apikey: (await import('../ensayo-destino.mjs')).clavesDelEnsayo().anon, 'Content-Type': 'application/json' }, data: {} });
    expect(lectura.status()).toBe(200);
    const filas = await lectura.json();
    expect(filas).toEqual([{ activo: false, tasa_serv_monedas: null, tasa_serv_soles: null, tasa_prod_monedas: null, tasa_prod_soles: null, umbral_premium: null, umbral_vip: null, sellos_max: null, sellos_por_premio: null }]);
    const ctx = await browser.newContext({ baseURL: 'http://localhost:5273', timezoneId: 'America/Lima', locale: 'es-PE' });
    await soloRedDelEnsayo(ctx);
    const page = await ctx.newPage();
    await page.goto('/recompensas?seccion=como');
    const panel = page.getByRole('tabpanel');
    await expect(panel).toContainText('todavía no está activo');
    await expect(panel).not.toContainText(/monedas por cada S\//);
    await ctx.close();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
test.describe('Responsive y conservación de efectos', () => {
  for (const [nombre, ancho, alto] of [['móvil 390', 390, 844], ['escritorio 1280', 1280, 900]]) {
    test(`${nombre}: sin desbordes en Citas, Mi tarjeta y Cómo funciona; la tarjeta conserva sus capas y la unidad cabe`, async ({ page }, info) => {
      await configurar(ENCENDIDO);
      await page.setViewportSize({ width: ancho, height: alto });
      await loginUI(page, prem.email);
      for (const ruta of ['/citas', '/recompensas?seccion=tarjeta', '/recompensas?seccion=como', '/recompensas?seccion=canje']) {
        await page.goto(ruta);
        await page.waitForTimeout(1200); // las animaciones de entrada terminan antes de medir
        const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(desborde, `desborde horizontal en ${ruta}`).toBeLessThanOrEqual(1);
        await info.attach(`${nombre}${ruta.replace(/[^a-z]+/g, '_')}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      }
      await page.goto('/recompensas?seccion=tarjeta');
      await expect(page.locator('.tp-puntos')).toBeVisible();
      // Las capas de la tarjeta (diseño, brillo y destello) siguen presentes.
      for (const clase of ['.tp-cara', '.tp-glare', '.tp-sheen', '.tp-barra', '.tp-puntos']) {
        expect(await page.locator(clase).count(), `falta ${clase}`).toBeGreaterThan(0);
      }
      const dentro = await page.evaluate(() => {
        const lienzo = document.querySelector('.tp-puntos')?.closest('[class*="tp-"]');
        const num = document.querySelector('.tp-puntos'); if (!num) return null;
        const u = num.querySelector('span').getBoundingClientRect();
        const cara = num.closest('.tp-cara').getBoundingClientRect();
        return { unidadDentro: u.right <= cara.right + 1 && u.left >= cara.left - 1, lienzo: Boolean(lienzo) };
      });
      expect(dentro?.unidadDentro, 'la unidad MONEDAS cabe dentro de la tarjeta').toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------------------
test.describe('Carrito de servicios', () => {
  test('Activo: monedas y avance por clasificación; el estimado se llama estimado y reservar no suma por sí solo', async ({ page }) => {
    await configurar(ENCENDIDO);
    await loginUI(page, prem.email);
    // El servicio entra por la interfaz (detalle → «Agregar a mi cita»), luego se abre el carrito de servicios.
    await page.goto(`/servicios/${C.servicio.id}`);
    await page.getByRole('button', { name: /Agregar a mi cita/ }).first().click();
    await page.goto('/citas/carrito');
    await expect(page.getByText('Nivel Premium')).toBeVisible();
    await expect(page.getByText(/60 monedas/).first()).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Progreso de clasificación' })).toHaveAttribute('aria-valuenow', '10');
    await expect(page.getByText('Estimado ≈ 25 monedas').first()).toBeVisible();
    await expect(page.getByText(/Reservar no suma por\s+sí solo/)).toBeVisible();
    await expect(page.getByText(/Ganarás \+\d+ pts/)).toHaveCount(0);
  });

  test('Apagado: se conserva «Ganarás +N pts» heredado', async ({ page }) => {
    await configurar(APAGADO);
    await loginUI(page, prem.email);
    await page.goto('/citas/carrito');
    await expect(page.getByText(/Ganarás \+\d+ pts/)).toBeVisible();
    await expect(page.getByText(/monedas/)).toHaveCount(0);
  });
});
