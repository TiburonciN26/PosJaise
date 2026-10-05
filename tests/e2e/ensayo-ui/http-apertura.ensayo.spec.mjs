// Pruebas HTTP con SESIONES REALES (GoTrue → PostgREST → la base «postgres» del ensayo, donde se ejecutó la apertura).
// Seriales y consumen el estado preparado por ensayo-preparar-http.mjs (ventas, canje y vinculación cambian saldos): para
// repetirlas hay que volver a preparar. Verdad de referencia: SQL directo en la misma base.
import { test, expect } from 'playwright/test';
import { R, verificarEntorno, sesion, rpc, tabla, mensaje, sql, sqlJson, huellaLibros } from './ayuda.mjs';

const S = {}; // sesiones
const n = (x) => Number(x);
const ok = (r) => [200, 204].includes(r.status); // las RPC que devuelven void responden 204
const saldoSql = (cid) => sqlJson(`select row_to_json(s) from public.recompensas_saldos('${cid}') s`);
const saldoHttp = async (request, k) => { const r = await rpc(request, S[k].token, 'mi_saldo_recompensas'); expect(r.status).toBe(200); return r.cuerpo[0]; };
const movsDe = (cid, venta) => sqlJson(`select coalesce(json_agg(json_build_object('tipo', tipo, 'monedas', monedas)), '[]') from public.recompensas_movimientos where cliente_id='${cid}' and venta_id='${venta}'`);

test.beforeAll(async ({ request }) => {
  await verificarEntorno(request);
  S.admin = await sesion(request, R.cuentas.ADMINISTRADOR);
  S.cajera = await sesion(request, R.cuentas.CAJERA);
  S.asistente = await sesion(request, R.cuentas.ASISTENTE);
  for (const k of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) S[k] = await sesion(request, R.clientas[k].email);
});

test('saldos, clasificación, nivel y sellos por HTTP coinciden con la base: sellos > 20 y negativos incluidos', async ({ request }) => {
  const h1 = await saldoHttp(request, 'h1');
  expect({ monedas: n(h1.monedas), clasif: n(h1.clasificacion), nivel: h1.nivel, sellos: h1.sellos }).toEqual({ monedas: 250, clasif: 250, nivel: 'VIP', sellos: 25 });
  expect(h1.sellos_max).toBe(20); // los 25 sellos heredados se conservan íntegros aunque el tope sea 20
  const h2 = await saldoHttp(request, 'h2');
  expect({ monedas: n(h2.monedas), nivel: h2.nivel, sellos: h2.sellos }).toEqual({ monedas: 30, nivel: 'BASICO', sellos: -7 });
  expect(n((await saldoHttp(request, 'h3')).monedas)).toBe(15);
  expect(n((await saldoHttp(request, 'h5')).monedas)).toBe(60);
  for (const k of ['h1', 'h2', 'h3', 'h5']) {
    const sqlS = await saldoSql(R.clientas[k].id); const web = await saldoHttp(request, k);
    expect({ m: n(web.monedas), c: n(web.clasificacion), v: web.nivel, s: web.sellos }, k).toEqual({ m: n(sqlS.monedas), c: n(sqlS.clasificacion), v: sqlS.nivel, s: sqlS.sellos });
  }
  // Lo que ve la clienta con sellos negativos: sin sellos «actuales» negativos ni premios disponibles.
  const f2 = await rpc(request, S.h2.token, 'mi_fidelizacion');
  expect(f2.status).toBe(200);
  expect(f2.cuerpo[0].sellos_actuales).toBeGreaterThanOrEqual(0);
  expect(f2.cuerpo[0].recompensas_disponibles).toBe(0);
  const f1 = await rpc(request, S.h1.token, 'mi_fidelizacion');
  expect(f1.cuerpo[0].recompensas_disponibles).toBeGreaterThanOrEqual(5); // floor(25/5)
  // Movimientos y sellos propios: la apertura figura en cada libro.
  const m1 = await rpc(request, S.h1.token, 'mis_movimientos_recompensas');
  expect(m1.status).toBe(200);
  expect(JSON.stringify(m1.cuerpo)).toContain('APERTURA');
  const s2 = await rpc(request, S.h2.token, 'mis_sellos_recompensas');
  expect(s2.status).toBe(200);
  expect(JSON.stringify(s2.cuerpo)).toContain('-7');
  // Una clienta con cuenta pero SIN ficha vinculada (en espera) no tiene saldo gastable.
  const h4 = await rpc(request, S.h4.token, 'mi_saldo_recompensas');
  expect(h4.status).toBe(200);
  expect(h4.cuerpo.length === 0 || n(h4.cuerpo[0].monedas) === 0, 'sin ficha vinculada no hay saldo gastable').toBe(true);
});

test('restricciones de apertura y reversión por rol: CLIENTE, ASISTENTE, CAJERA, ADMIN y sin sesión', async ({ request }) => {
  const antes = await huellaLibros();
  const corte = '2026-10-05T04:32:53Z';
  const intentos = {
    ejecutar: ['recompensas_ejecutar_apertura', { p_corte: corte, p_ejecutar: false, p_activar: false }],
    reversible: ['recompensas_apertura_reversible', {}],
    revertir: ['recompensas_revertir_apertura', { p_cliente_id: R.clientas.h1.id }],
  };
  const sinPermiso = (r) => [401, 403].includes(r.status) || /permission denied/i.test(mensaje(r));
  // CLIENTE (cuatro cuentas distintas), ASISTENTE y CAJERA: ninguna de las tres funciones se ejecuta.
  for (const [rol, tok] of [['CLIENTE h1', S.h1.token], ['CLIENTE h2', S.h2.token], ['CLIENTE sin ficha h4', S.h4.token], ['ASISTENTE', S.asistente.token], ['CAJERA', S.cajera.token]]) {
    for (const [nombre, [fn, args]] of Object.entries(intentos)) {
      const r = await rpc(request, tok, fn, args);
      expect(r.status, `${rol} → ${nombre}`).not.toBe(200);
      expect(mensaje(r), `${rol} → ${nombre}`).toMatch(/Solo el administrador/);
    }
  }
  // Sin sesión (solo la clave anónima): rechazadas por permisos antes de ejecutar.
  for (const [nombre, [fn, args]] of Object.entries(intentos)) {
    const r = await rpc(request, null, fn, args);
    expect(sinPermiso(r), `anon → ${nombre}: ${r.status} ${mensaje(r)}`).toBe(true);
  }
  // Funciones internas: ni siquiera el ADMINISTRADOR las alcanza por HTTP.
  const internas = [['recompensas_habilitar_apertura', { p_cliente_id: R.clientas.h4.id }], ['_recompensas_apertura_calculo', { p_corte: corte }],
    ['_recompensas_apertura_escribir', { p_cliente_id: R.clientas.h4.id, p_corte: corte, p_puntos: 1, p_sellos: 1, p_detalle: {} }]];
  for (const tok of [S.admin.token, S.h1.token, S.cajera.token]) {
    for (const [fn, args] of internas) {
      const r = await rpc(request, tok, fn, args);
      expect(sinPermiso(r), `${fn}: ${r.status} ${mensaje(r)}`).toBe(true);
    }
  }
  // ADMINISTRADOR: lo consulta, pero con el programa ACTIVO ni revierte ni vuelve a ejecutar.
  const lista = await rpc(request, S.admin.token, 'recompensas_apertura_reversible');
  expect(lista.status).toBe(200);
  expect(lista.cuerpo.length, 'PostgREST corta a max_rows = 1000; el total real está en SQL').toBe(1000);
  const total = await sqlJson(`select to_json(count(*)) from public.recompensas_movimientos where tipo = 'APERTURA'`);
  expect(total).toBeGreaterThan(2000);
  const rev = await rpc(request, S.admin.token, 'recompensas_revertir_apertura', { p_cliente_id: R.clientas.h2.id });
  expect(rev.status).not.toBe(200);
  expect(mensaje(rev)).toMatch(/Recompensas está activo/);
  const ej = await rpc(request, S.admin.token, 'recompensas_ejecutar_apertura', { p_corte: corte, p_ejecutar: true, p_activar: false });
  expect(ej.status).not.toBe(200);
  expect(mensaje(ej)).toMatch(/ya está activo/);
  // Tablas: RLS y GRANT. El CLIENTE no lee las tablas de apertura de nadie; nadie escribe los libros por REST.
  for (const t of ['recompensas_apertura_aportes', 'recompensas_apertura_espera']) {
    const c = await tabla(request, S.h1.token, `${t}?select=cliente_id&limit=5`);
    expect(c.status === 200 ? c.cuerpo : [], `CLIENTE lee ${t}`).toEqual([]);
    const a = await tabla(request, S.admin.token, `${t}?select=cliente_id&limit=5`);
    expect(a.status).toBe(200);
    expect(a.cuerpo.length).toBeGreaterThan(0);
  }
  const ajenos = await tabla(request, S.h1.token, `recompensas_movimientos?select=id&cliente_id=eq.${R.clientas.h2.id}`);
  expect(ajenos.status === 200 ? ajenos.cuerpo : []).toEqual([]);
  for (const [rol, tok] of [['CLIENTE', S.h1.token], ['CAJERA', S.cajera.token], ['ADMIN', S.admin.token]]) {
    for (const t of ['recompensas_movimientos', 'recompensas_sellos_movs', 'recompensas_apertura_aportes', 'recompensas_apertura_espera']) {
      const ins = await tabla(request, tok, t, { metodo: 'POST', data: { cliente_id: R.clientas.h1.id, tipo: 'AJUSTE', monedas: 999, clasificacion: 999, clave: `ens-http-${rol}-${t}` } });
      expect(ins.status, `${rol} INSERT ${t}`).toBeGreaterThanOrEqual(400);
      const upd = await tabla(request, tok, `${t}?cliente_id=eq.${R.clientas.h1.id}`, { metodo: 'PATCH', data: { monedas: 999 } });
      const del = await tabla(request, tok, `${t}?cliente_id=eq.${R.clientas.h1.id}`, { metodo: 'DELETE' });
      expect(upd.status === 204 || upd.status === 200 ? (Array.isArray(upd.cuerpo) ? upd.cuerpo : []) : [], `${rol} PATCH ${t}`).toEqual([]);
      expect(del.status === 204 || del.status === 200 ? (Array.isArray(del.cuerpo) ? del.cuerpo : []) : [], `${rol} DELETE ${t}`).toEqual([]);
    }
  }
  for (const [rol, tok] of [['CLIENTE', S.h1.token], ['ADMIN', S.admin.token]]) {
    const r = await tabla(request, tok, 'recompensas_config?id=eq.1', { metodo: 'PATCH', data: { activo: false, corte: null } });
    expect(r.status === 200 || r.status === 204 ? (Array.isArray(r.cuerpo) ? r.cuerpo : []) : [], `${rol} no modifica activo/corte`).toEqual([]);
  }
  // Nada cambió con todos los intentos rechazados.
  expect(await huellaLibros()).toEqual(antes);
});

test('canje → cupón → venta con cupón → anulación: el saldo vuelve y la apertura queda intacta', async ({ request }) => {
  const cid = R.clientas.h5.id; const clave = `ens-http-${R.nonce}`;
  const inicio = await saldoSql(cid); expect(n(inicio.monedas)).toBe(60);
  const c1 = await rpc(request, S.h5.token, 'canjear_recompensa', { p_catalogo_id: R.premio, p_clave: clave });
  expect(c1.status, mensaje(c1)).toBe(200);
  const tras = await saldoSql(cid); expect(n(tras.monedas)).toBe(35);
  const c2 = await rpc(request, S.h5.token, 'canjear_recompensa', { p_catalogo_id: R.premio, p_clave: clave }); // reintento: respuesta perdida
  expect(c2.status).toBe(200);
  expect(n((await saldoSql(cid)).monedas), 'el reintento idempotente no cobra otra vez').toBe(35);
  const cup = await sqlJson(`select row_to_json(c) from (select id, codigo, estado from public.cupones where cliente_id='${cid}' order by creado_en desc limit 1) c`);
  expect(cup.estado).toBe('DISPONIBLE');
  const mis = await rpc(request, S.h5.token, 'mis_cupones');
  expect(mis.status).toBe(200);
  expect(JSON.stringify(mis.cuerpo)).toContain(cup.codigo);
  // Venta con el cupón (CAJERA, sesión real).
  const v = await rpc(request, S.cajera.token, 'confirmar_venta', {
    p_metodo_pago: 'Yape', p_monto_recibido: null, p_items: [{ tipo: 'PRODUCTO', producto_id: R.producto, cantidad: 1 }],
    p_cliente_id: cid, p_descuento_pct: 0, p_descuento_monto: 0, p_monto_pos_tarjeta: null, p_codigo_cupon: cup.codigo, p_costo_delivery: 0,
  });
  expect(v.status, mensaje(v)).toBe(200);
  const venta = v.cuerpo[0].venta_id;
  expect((await sqlJson(`select to_json(estado) from public.cupones where id='${cup.id}'`))).toBe('CANJEADO');
  const credito = n((await saldoSql(cid)).monedas) - 35;
  expect(credito, 'la venta acredita monedas por lo pagado').toBeGreaterThan(0);
  expect((await movsDe(cid, venta)).map((m) => m.tipo)).toContain('VENTA');
  // Anulación (ADMIN): se devuelve el cupón y se revierte solo lo acreditado, una vez.
  const a1 = await rpc(request, S.admin.token, 'anular_venta', { p_venta_id: venta });
  expect(ok(a1), mensaje(a1)).toBe(true);
  expect(n((await saldoSql(cid)).monedas)).toBe(35);
  expect((await sqlJson(`select to_json(estado) from public.cupones where id='${cup.id}'`))).toBe('DISPONIBLE');
  const a2 = await rpc(request, S.admin.token, 'anular_venta', { p_venta_id: venta });
  expect(n((await saldoSql(cid)).monedas), 'anular de nuevo no revierte otra vez').toBe(35);
  expect(await sqlJson(`select to_json(count(*)) from public.recompensas_movimientos where venta_id='${venta}' and tipo='VENTA_REVERSION'`)).toBe(1);
  // Los movimientos de apertura no se tocaron.
  expect(await sqlJson(`select to_json(sum(monedas)) from public.recompensas_movimientos where cliente_id='${cid}' and tipo='APERTURA'`)).toBe(60);
  expect(ok(a2) || a2.status >= 400).toBe(true);
});

test('atención pendiente de cobro: el servicio anterior a la apertura no acredita otra vez; el producto sí', async ({ request }) => {
  const cid = R.clientas.h3.id;
  expect(n((await saldoSql(cid)).monedas)).toBe(15);
  const v = await rpc(request, S.cajera.token, 'confirmar_venta', {
    p_metodo_pago: 'Yape', p_monto_recibido: null,
    p_items: [{ tipo: 'SERVICIO', registro_servicio_id: R.clientas.h3.atencion, cantidad: 1 }, { tipo: 'PRODUCTO', producto_id: R.producto, cantidad: 1 }],
    p_cliente_id: cid, p_descuento_pct: 0, p_descuento_monto: 0, p_monto_pos_tarjeta: null, p_codigo_cupon: null, p_costo_delivery: 0,
  });
  expect(v.status, mensaje(v)).toBe(200);
  const venta = v.cuerpo[0].venta_id;
  expect(n((await saldoSql(cid)).monedas) - 15, 'solo el producto (80 / 40 × 5)').toBe(10);
  const det = await sqlJson(`select json_agg(json_build_object('t', tipo, 'ap', incluida_en_apertura) order by linea) from public.recompensas_venta_detalle where venta_id='${venta}'`);
  expect(det).toEqual([{ t: 'SERVICIO', ap: true }, { t: 'PRODUCTO', ap: false }]);
  expect(ok(await rpc(request, S.admin.token, 'anular_venta', { p_venta_id: venta }))).toBe(true);
  expect(n((await saldoSql(cid)).monedas), 'la anulación deja la apertura completa').toBe(15);
});

test('anular una venta histórica (anterior a la apertura) no descuenta apertura ni crea movimientos', async ({ request }) => {
  const cid = R.clientas.h6.id; const antes = await saldoSql(cid);
  const a = await rpc(request, S.admin.token, 'anular_venta', { p_venta_id: R.clientas.h6.venta });
  expect(ok(a), mensaje(a)).toBe(true);
  expect(await saldoSql(cid)).toEqual(antes);
  expect(await sqlJson(`select to_json(count(*)) from public.recompensas_movimientos where venta_id='${R.clientas.h6.venta}'`)).toBe(0);
});

test('vinculación posterior (decisión A) por la función real: una sola apertura, aunque se reintente o intente otra cuenta', async ({ request }) => {
  const h = R.clientas.h4;
  const antes = await sqlJson(`select to_json(count(*)) from public.recompensas_movimientos where cliente_id='${h.id}' and tipo='APERTURA'`);
  expect(antes).toBe(0);
  const enEspera = await sqlJson(`select row_to_json(e) from public.recompensas_apertura_espera e where cliente_id='${h.id}'`);
  expect({ estado: enEspera.estado, monedas: n(enEspera.monedas), sellos: enEspera.sellos }).toEqual({ estado: 'EN_ESPERA', monedas: 40, sellos: 3 });
  const l = await rpc(request, S.h4.token, 'vincular_o_crear_cliente_web', { p_nombre: `TEST ENS en-espera ${R.nonce}`, p_telefono: h.telefono, p_confirmar_vinculo: true });
  expect(l.status, mensaje(l)).toBe(200);
  expect(l.cuerpo[0].vinculado_existente).toBe(true);
  const s = await saldoHttp(request, 'h4');
  expect({ monedas: n(s.monedas), sellos: s.sellos }).toEqual({ monedas: 40, sellos: 3 });
  const r2 = await rpc(request, S.h4.token, 'vincular_o_crear_cliente_web', { p_nombre: `TEST ENS en-espera ${R.nonce}`, p_telefono: h.telefono, p_confirmar_vinculo: true });
  expect(r2.status).toBe(200);
  expect(n((await saldoHttp(request, 'h4')).monedas)).toBe(40);
  // Otra cuenta distinta intenta quedarse con la misma ficha: rechazada.
  const otra = await rpc(request, S.h2.token, 'vincular_o_crear_cliente_web', { p_nombre: 'Intruso', p_telefono: h.telefono, p_confirmar_vinculo: true });
  expect(otra.status).not.toBe(200);
  expect(mensaje(otra)).toMatch(/teléfono ya está en uso/);
  const filas = await sqlJson(`select json_build_object('aperturas', (select count(*) from public.recompensas_movimientos where cliente_id='${h.id}' and tipo='APERTURA'),
    'estado', (select estado from public.recompensas_apertura_espera where cliente_id='${h.id}'))`);
  expect(filas).toEqual({ aperturas: 1, estado: 'HABILITADA' });
});

test('aislamiento: cada CLIENTE solo ve sus propios movimientos, sellos y cupones', async ({ request }) => {
  for (const [a, b] of [['h1', 'h2'], ['h2', 'h1']]) {
    const ajenos = await tabla(request, S[a].token, `recompensas_sellos_movs?select=id&cliente_id=eq.${R.clientas[b].id}`);
    expect(ajenos.status === 200 ? ajenos.cuerpo : []).toEqual([]);
    const cup = await tabla(request, S[a].token, `cupones?select=id&cliente_id=eq.${R.clientas[b].id}`);
    expect(cup.status === 200 ? cup.cuerpo : []).toEqual([]);
  }
  const propios = await rpc(request, S.h1.token, 'mis_movimientos_recompensas');
  const ids = new Set(JSON.stringify(propios.cuerpo).match(/[0-9a-f]{8}-[0-9a-f-]{27}/g) ?? []);
  expect(ids.has(R.clientas.h2.id)).toBe(false);
  void sql;
});
