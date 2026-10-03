import { test, expect, knownIssue } from './fixtures.mjs';
import { readFile } from 'node:fs/promises';
import { login, formWithTitle } from './helpers.mjs';
import { isolatedClient, qaContext } from './phase2-helpers.mjs';
import { supabaseURL } from './local-safety.mjs';

// Autorización de configuraciones, zonas de entrega, galería, auditoría, movimientos de stock, gastos recurrentes
// y columnas sensibles, por rol (CAJERA, ASISTENTE, CLIENTE y sin sesión). Supabase Local TEST, datos ficticios.
// Regla EXISTENTE leída de pg_policies / column_privileges antes de escribir las aserciones:
//  - config_puntos / config_fidelizacion / config_referidos: lectura de toda sesión; UPDATE solo ADMIN (sin INSERT/DELETE).
//  - zonas_delivery: lectura de las activas (ADMIN todas); escritura solo ADMIN.
//  - galeria_web: lectura solo de personal (el portal usa la RPC galeria_para_web); escritura solo ADMIN.
//  - auditoria: lectura solo ADMIN; ninguna política de escritura (la llenan triggers).
//  - gastos_recurrentes: solo ADMIN.
//  - movimientos_stock: lectura de personal; escritura directa eliminada por QA-035 (solo la RPC agregar_stock, ADMIN/CAJERA).
//  - productos.costo: sin SELECT de columna para authenticated; productos_vista lo devuelve solo a ADMIN.

function watchApiKey(page) {
  const box = { key: null };
  page.on('request', (r) => {
    const k = r.headers().apikey;
    if (k && r.url().startsWith(supabaseURL)) box.key = k;
  });
  return box;
}

async function rest(page, box, method, path, body, { sinToken = false, prefer = 'return=representation' } = {}) {
  return page.evaluate(async ({ method, path, body, key, base, sinToken, prefer }) => {
    const storageKey = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
    const sesion = storageKey ? JSON.parse(localStorage.getItem(storageKey)) : null;
    const headers = { apikey: key, 'Content-Type': 'application/json', Prefer: prefer };
    if (!sinToken && sesion) headers.Authorization = `Bearer ${sesion.access_token}`;
    const r = await fetch(`${base}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* cuerpo vacío */ }
    return { status: r.status, json, userId: sesion?.user?.id ?? null };
  }, { method, path, body, key: box.key, base: supabaseURL, sinToken, prefer });
}
const rpc = (p, b, nombre, args = {}, o) => rest(p, b, 'POST', `rpc/${nombre}`, args, o);
const sinEfecto = (r) => r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0);
const mensaje = (r) => JSON.stringify(r.json ?? '');

const S = { diag: [] };

function vigilar(page, etiqueta) {
  const d = { contexto: etiqueta, consola: [], red: {} };
  const limpiar = (t) => String(t).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]').slice(0, 200);
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) d.consola.push(`${m.type()}: ${limpiar(m.text())}`); });
  page.on('pageerror', (e) => d.consola.push(`pageerror: ${limpiar(e.message)}`));
  page.on('response', (r) => {
    if (!r.url().startsWith(supabaseURL)) return;
    const u = new URL(r.url());
    const clave = `${r.request().method()} ${u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id')} ${r.status()}`;
    d.red[clave] = (d.red[clave] ?? 0) + 1;
  });
  S.diag.push(d);
}

async function sesion(browser, data, rol, cuenta = data) {
  const ctx = await qaContext(browser);
  const page = await ctx.newPage();
  const box = watchApiKey(page);
  vigilar(page, rol);
  await login(page, rol, cuenta);
  return { ctx, page, box };
}

const leerAdmin = async (path) => (await rest(S.admin.page, S.admin.box, 'GET', path)).json;
const ROLES = ['CAJERA', 'ASISTENTE', 'CLIENTE'];

test.describe.serial('AUTORIZACIÓN: configuraciones, zonas, galería, auditoría, stock, gastos recurrentes y columnas sensibles', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    const data = JSON.parse(await readFile('tests/e2e/fixtures/runtime.json', 'utf8'));
    S.data = data;
    S.admin = await sesion(browser, data, 'ADMINISTRADOR');
    const { page, box } = S.admin;
    S.adminId = (await rest(page, box, 'GET', 'productos?select=id&limit=1')).userId;
    S.own = await isolatedClient(browser, data, 'CFG');
    const nombre = `${data.prefix} CFG`;
    // Registros preparados por ADMIN (precondiciones: existen antes de intentar acceder desde otro rol)
    const zonaA = await rest(page, box, 'POST', 'zonas_delivery', { nombre: `${nombre} zona activa`, costo: 3, activo: true });
    const zonaI = await rest(page, box, 'POST', 'zonas_delivery', { nombre: `${nombre} zona inactiva`, costo: 4, activo: false });
    const gal = await rest(page, box, 'POST', 'galeria_web', { titulo: `${nombre} galería`, antes_url: 'TEST/antes.png', despues_url: 'TEST/despues.png', activo: true });
    const rec = await rest(page, box, 'POST', 'gastos_recurrentes', { nombre: `${nombre} recurrente`, monto: 9, activo: true });
    // productos: costo sin SELECT de columna, así que el alta no devuelve la fila (return=minimal) y el id se lee de la vista.
    const prod = await rest(page, box, 'POST', 'productos', { nombre: `${nombre} Producto`, precio: 10, costo: 3, stock_actual: 10 }, { prefer: 'return=minimal' });
    for (const [r, n] of [[zonaA, 'zona activa'], [zonaI, 'zona inactiva'], [gal, 'galería'], [rec, 'gasto recurrente'], [prod, 'producto']]) expect(r.status, `${n}: ${JSON.stringify(r.json)}`).toBeLessThan(300);
    S.zonaA = zonaA.json[0].id; S.zonaI = zonaI.json[0].id; S.galeria = gal.json[0].id; S.recurrente = rec.json[0].id;
    S.producto = (await leerAdmin(`productos_vista?nombre=eq.${encodeURIComponent(`${nombre} Producto`)}&select=id`))[0].id;
    // Atención ACTIVA de ADMIN sin venta (visible para el POS como «disponible»; trae pago_asistente)
    const cli = await rest(page, box, 'POST', 'clientes', { nombre: `${nombre} cliente`, telefono: `6${String(Date.now()).slice(-8)}` });
    S.cliente = cli.json[0].id;
    const sv = await rest(page, box, 'POST', 'servicios', { nombre: `${nombre} servicio`, categoria: 'Cabello', precio: 6, duracion_min: 30 });
    expect(sv.status, JSON.stringify(sv.json)).toBeLessThan(300);
    S.servicio = sv.json[0].id;
    const at = await rest(page, box, 'POST', 'registro_servicios', { usuario_id: S.adminId, servicio_id: S.servicio, cliente_id: S.cliente, precio: 6, fecha: new Date().toISOString(), nota: `${nombre} atención` });
    expect(at.status, JSON.stringify(at.json)).toBeLessThan(300);
    S.atencion = at.json[0].id;
    expect(Number(at.json[0].pago_asistente), 'precondición: la atención de ADMIN trae comisión').toBe(6);
    // Línea base de configuraciones y auditoría
    S.cfg = {
      puntos: await leerAdmin('config_puntos?select=*'),
      fidelizacion: await leerAdmin('config_fidelizacion?select=*'),
      referidos: await leerAdmin('config_referidos?select=*'),
    };
    for (const k of Object.keys(S.cfg)) expect(S.cfg[k].length, `precondición: config ${k}`).toBe(1);
    S.auditoriaAntes = (await leerAdmin('auditoria?select=id&limit=1000')).length;
    expect(S.auditoriaAntes, 'precondición: la auditoría tiene filas').toBeGreaterThan(0);
  });

  test.afterAll(async () => { await S.admin?.ctx.close(); });

  test('Configuraciones: todo el mundo con sesión las lee; solo ADMIN las modifica; sin sesión no', async ({ browser }) => {
    test.setTimeout(150_000);
    const tablas = { puntos: 'config_puntos', fidelizacion: 'config_fidelizacion', referidos: 'config_referidos' };
    for (const rol of ROLES) {
      const s = await sesion(browser, S.data, rol, rol === 'CLIENTE' ? S.own : S.data);
      try {
        for (const [clave, tabla] of Object.entries(tablas)) {
          expect((await rest(s.page, s.box, 'GET', `${tabla}?select=*`)).json, `${rol}: lee ${tabla} (regla existente)`).toEqual(S.cfg[clave]);
          expect(sinEfecto(await rest(s.page, s.box, 'PATCH', `${tabla}?id=eq.1`, clave === 'puntos' ? { puntos_por_visita: 999 } : clave === 'fidelizacion' ? { porcentaje_recompensa: 99 } : { credito_referidor: 999 })), `${rol}: PATCH ${tabla}`).toBeTruthy();
          expect((await rest(s.page, s.box, 'POST', tabla, { id: 2 })).status, `${rol}: POST ${tabla}`).toBeGreaterThanOrEqual(400);
          expect(sinEfecto(await rest(s.page, s.box, 'DELETE', `${tabla}?id=eq.1`)), `${rol}: DELETE ${tabla}`).toBeTruthy();
        }
      } finally { await s.ctx.close(); }
    }
    for (const tabla of Object.values(tablas)) {
      expect(sinEfecto(await rest(S.admin.page, S.admin.box, 'GET', `${tabla}?select=*`, undefined, { sinToken: true })), `sin sesión: ${tabla}`).toBeTruthy();
      expect(sinEfecto(await rest(S.admin.page, S.admin.box, 'PATCH', `${tabla}?id=eq.1`, { id: 1 }, { sinToken: true }))).toBeTruthy();
    }
    expect({
      puntos: await leerAdmin('config_puntos?select=*'), fidelizacion: await leerAdmin('config_fidelizacion?select=*'), referidos: await leerAdmin('config_referidos?select=*'),
    }, 'ninguna configuración cambió').toEqual(S.cfg);
  });

  test('Zonas de entrega: no administradores solo ven las activas y no escriben; ADMIN ve todas', async ({ browser }) => {
    test.setTimeout(150_000);
    const todas = await leerAdmin(`zonas_delivery?id=in.(${S.zonaA},${S.zonaI})&select=id,nombre,costo,activo&order=id`);
    expect(todas, 'precondición: ADMIN ve la activa y la inactiva').toHaveLength(2);
    for (const rol of ROLES) {
      const s = await sesion(browser, S.data, rol, rol === 'CLIENTE' ? S.own : S.data);
      try {
        const vistas = (await rest(s.page, s.box, 'GET', `zonas_delivery?id=in.(${S.zonaA},${S.zonaI})&select=id`)).json;
        expect(vistas.map((z) => z.id), `${rol}: solo la zona activa`).toEqual([S.zonaA]);
        expect(sinEfecto(await rest(s.page, s.box, 'PATCH', `zonas_delivery?id=eq.${S.zonaA}`, { costo: 0, activo: false })), `${rol}: PATCH`).toBeTruthy();
        expect(sinEfecto(await rest(s.page, s.box, 'DELETE', `zonas_delivery?id=eq.${S.zonaA}`)), `${rol}: DELETE`).toBeTruthy();
        expect((await rest(s.page, s.box, 'POST', 'zonas_delivery', { nombre: `${S.data.prefix} CFG intruso`, costo: 0 })).status, `${rol}: POST`).toBeGreaterThanOrEqual(400);
      } finally { await s.ctx.close(); }
    }
    expect(await leerAdmin(`zonas_delivery?id=in.(${S.zonaA},${S.zonaI})&select=id,nombre,costo,activo&order=id`)).toEqual(todas);
  });

  test('Galería web: personal la lee, CLIENTE solo por la RPC pública; escritura solo ADMIN', async ({ browser }) => {
    test.setTimeout(150_000);
    const base = await leerAdmin(`galeria_web?id=eq.${S.galeria}&select=id,titulo,activo`);
    expect(base, 'precondición').toHaveLength(1);
    for (const rol of ROLES) {
      const s = await sesion(browser, S.data, rol, rol === 'CLIENTE' ? S.own : S.data);
      try {
        const directa = await rest(s.page, s.box, 'GET', `galeria_web?id=eq.${S.galeria}&select=id`);
        if (rol === 'CLIENTE') expect(directa.json, 'CLIENTE: sin lectura directa de la tabla').toEqual([]);
        else expect(directa.json, `${rol}: lectura de personal`).toHaveLength(1);
        const publica = await rpc(s.page, s.box, 'galeria_para_web');
        expect(publica.status, `${rol}: RPC pública de galería`).toBeLessThan(300);
        expect(sinEfecto(await rest(s.page, s.box, 'PATCH', `galeria_web?id=eq.${S.galeria}`, { titulo: 'HACK', activo: false })), `${rol}: PATCH`).toBeTruthy();
        expect(sinEfecto(await rest(s.page, s.box, 'DELETE', `galeria_web?id=eq.${S.galeria}`)), `${rol}: DELETE`).toBeTruthy();
        expect((await rest(s.page, s.box, 'POST', 'galeria_web', { titulo: 'x', antes_url: 'x', despues_url: 'x' })).status, `${rol}: POST`).toBeGreaterThanOrEqual(400);
      } finally { await s.ctx.close(); }
    }
    expect(await leerAdmin(`galeria_web?id=eq.${S.galeria}&select=id,titulo,activo`)).toEqual(base);
  });

  test('Auditoría: solo ADMIN lee; nadie la escribe (ni ADMIN); los triggers sí la llenan', async ({ browser }) => {
    test.setTimeout(150_000);
    for (const rol of ROLES) {
      const s = await sesion(browser, S.data, rol, rol === 'CLIENTE' ? S.own : S.data);
      try {
        expect((await rest(s.page, s.box, 'GET', 'auditoria?select=id&limit=5')).json, `${rol}: lectura`).toEqual([]);
        expect((await rest(s.page, s.box, 'POST', 'auditoria', { tabla: 'productos', descripcion: 'FORJADA' })).status, `${rol}: POST`).toBeGreaterThanOrEqual(400);
        expect(sinEfecto(await rest(s.page, s.box, 'PATCH', 'auditoria?id=gt.0', { descripcion: 'HACK' })), `${rol}: PATCH`).toBeTruthy();
        expect(sinEfecto(await rest(s.page, s.box, 'DELETE', 'auditoria?id=gt.0')), `${rol}: DELETE`).toBeTruthy();
      } finally { await s.ctx.close(); }
    }
    const { page, box } = S.admin;
    expect((await rest(page, box, 'POST', 'auditoria', { tabla: 'productos', descripcion: 'FORJADA ADMIN' })).status, 'ADMIN: POST').toBeGreaterThanOrEqual(400);
    expect(sinEfecto(await rest(page, box, 'PATCH', 'auditoria?id=gt.0', { descripcion: 'HACK' })), 'ADMIN: PATCH').toBeTruthy();
    expect(sinEfecto(await rest(page, box, 'DELETE', 'auditoria?id=gt.0')), 'ADMIN: DELETE').toBeTruthy();
    expect(sinEfecto(await rest(page, box, 'GET', 'auditoria?select=id&limit=5', undefined, { sinToken: true })), 'sin sesión').toBeTruthy();
    expect((await leerAdmin('auditoria?select=id&limit=1000')).length, 'ninguna fila se perdió').toBeGreaterThanOrEqual(S.auditoriaAntes);
    expect(await leerAdmin('auditoria?descripcion=in.(FORJADA,HACK,"FORJADA ADMIN")&select=id')).toEqual([]);
    // Control positivo: una edición real de ADMIN deja rastro por trigger.
    const rastro = async () => (await leerAdmin(`auditoria?tabla=eq.productos&registro_id=eq.${S.producto}&select=id,campo,valor_nuevo`)).length;
    const antes = await rastro();
    expect((await rest(page, box, 'PATCH', `productos?id=eq.${S.producto}`, { precio: 11 }, { prefer: 'return=minimal' })).status).toBeLessThan(300);
    expect(await rastro(), 'el trigger registró el cambio de precio').toBeGreaterThan(antes);
  });

  test('Gastos recurrentes: solo ADMIN (lectura y escritura)', async ({ browser }) => {
    test.setTimeout(150_000);
    const base = await leerAdmin(`gastos_recurrentes?id=eq.${S.recurrente}&select=nombre,monto,activo`);
    expect(base, 'precondición').toHaveLength(1);
    for (const rol of ROLES) {
      const s = await sesion(browser, S.data, rol, rol === 'CLIENTE' ? S.own : S.data);
      try {
        expect((await rest(s.page, s.box, 'GET', 'gastos_recurrentes?select=id&limit=5')).json, `${rol}: lectura`).toEqual([]);
        expect(sinEfecto(await rest(s.page, s.box, 'PATCH', `gastos_recurrentes?id=eq.${S.recurrente}`, { monto: 999 })), `${rol}: PATCH`).toBeTruthy();
        expect(sinEfecto(await rest(s.page, s.box, 'DELETE', `gastos_recurrentes?id=eq.${S.recurrente}`)), `${rol}: DELETE`).toBeTruthy();
        expect((await rest(s.page, s.box, 'POST', 'gastos_recurrentes', { nombre: 'x', monto: 1 })).status, `${rol}: POST`).toBeGreaterThanOrEqual(400);
      } finally { await s.ctx.close(); }
    }
    expect(await leerAdmin(`gastos_recurrentes?id=eq.${S.recurrente}&select=nombre,monto,activo`)).toEqual(base);
  });

  // QA-035 (regla aprobada): solo ADMINISTRADOR y CAJERA agregan stock; el historial solo lo escribe agregar_stock().
  const estadoStock = async () => ({
    stock: (await leerAdmin(`productos_vista?id=eq.${S.producto}&select=stock_actual`))[0].stock_actual,
    movimientos: await leerAdmin(`movimientos_stock?producto_id=eq.${S.producto}&select=*&order=fecha`),
  });
  const resumenRes = (r) => ({ status: r.status, codigo: r.json?.code ?? null, mensaje: r.json?.message ?? null, filas: Array.isArray(r.json) ? r.json.length : null });
  const resumenEstado = (e) => ({ stock: e.stock, movimientos: e.movimientos.length });

  test('QA-035: ASISTENTE, CLIENTE y sin sesión no agregan stock ni escriben el historial; stock e historial idénticos', async ({ browser }, info) => {
    test.setTimeout(180_000);
    knownIssue(info, 'QA-035');
    const antes = await estadoStock();
    expect(antes.movimientos, 'precondición: producto sin movimientos').toEqual([]);
    const evidencia = {};
    const ataques = async (etiqueta, p, b, uid, sinToken) => {
      const o = sinToken ? { sinToken: true } : undefined;
      evidencia[etiqueta] = {
        rpc: resumenRes(await rpc(p, b, 'agregar_stock', { p_producto_id: S.producto, p_cantidad: 100, p_nota: `${S.data.prefix} CFG ${etiqueta}` }, o)),
        post: resumenRes(await rest(p, b, 'POST', 'movimientos_stock', { producto_id: S.producto, cantidad_agregada: 999, stock_anterior: 0, stock_nuevo: 999, nota: `${S.data.prefix} CFG FORJADO ${etiqueta}`, usuario_id: uid }, o)),
        patch: resumenRes(await rest(p, b, 'PATCH', `movimientos_stock?producto_id=eq.${S.producto}`, { cantidad_agregada: 1 }, o)),
        delete: resumenRes(await rest(p, b, 'DELETE', `movimientos_stock?producto_id=eq.${S.producto}`, undefined, o)),
      };
    };
    for (const rol of ['ASISTENTE', 'CLIENTE']) {
      const s = await sesion(browser, S.data, rol, rol === 'CLIENTE' ? S.own : S.data);
      try {
        const uid = (await rest(s.page, s.box, 'GET', 'productos?select=id&limit=1')).userId;
        await ataques(rol, s.page, s.box, uid, false);
      } finally { await s.ctx.close(); }
    }
    await ataques('SIN_SESION', S.admin.page, S.admin.box, S.adminId, true);
    const despues = await estadoStock();
    // La evidencia se adjunta antes de cualquier aserción que pueda fallar.
    await info.attach('qa-035-roles-no-autorizados', { body: Buffer.from(JSON.stringify({ evidencia, antes: resumenEstado(antes), despues: resumenEstado(despues) }, null, 2)), contentType: 'application/json' });
    for (const [rol, r] of Object.entries(evidencia)) {
      expect(r.rpc.status, `${rol}: agregar_stock`).toBeGreaterThanOrEqual(400);
      expect(r.post.status, `${rol}: INSERT directo en movimientos_stock`).toBeGreaterThanOrEqual(400);
      expect(r.patch.status >= 400 || r.patch.filas === 0, `${rol}: PATCH movimientos_stock`).toBeTruthy();
      expect(r.delete.status >= 400 || r.delete.filas === 0, `${rol}: DELETE movimientos_stock`).toBeTruthy();
    }
    expect(evidencia.ASISTENTE.rpc.mensaje, 'ASISTENTE: mensaje de rol').toContain('Solo el administrador o la cajera');
    expect(despues, 'stock e historial exactamente iguales').toEqual(antes);
  });

  test('QA-035: ni CAJERA ni ADMIN insertan, modifican o borran movimientos directamente (solo la RPC los genera)', async ({ browser }, info) => {
    test.setTimeout(150_000);
    knownIssue(info, 'QA-035');
    const antes = await estadoStock();
    const evidencia = {};
    const ataques = async (etiqueta, p, b, uid) => {
      evidencia[etiqueta] = {
        post: resumenRes(await rest(p, b, 'POST', 'movimientos_stock', { producto_id: S.producto, cantidad_agregada: 999, stock_anterior: 0, stock_nuevo: 999, nota: `${S.data.prefix} CFG FORJADO ${etiqueta}`, usuario_id: uid })),
        postMin: resumenRes(await rest(p, b, 'POST', 'movimientos_stock', { producto_id: S.producto, cantidad_agregada: 1, stock_anterior: 0, stock_nuevo: 1, usuario_id: uid }, { prefer: 'return=minimal' })),
        patch: resumenRes(await rest(p, b, 'PATCH', `movimientos_stock?producto_id=eq.${S.producto}`, { cantidad_agregada: 1 })),
        delete: resumenRes(await rest(p, b, 'DELETE', `movimientos_stock?producto_id=eq.${S.producto}`)),
      };
    };
    const cj = await sesion(browser, S.data, 'CAJERA');
    try { await ataques('CAJERA', cj.page, cj.box, (await rest(cj.page, cj.box, 'GET', 'productos?select=id&limit=1')).userId); } finally { await cj.ctx.close(); }
    await ataques('ADMINISTRADOR', S.admin.page, S.admin.box, S.adminId);
    const despues = await estadoStock();
    await info.attach('qa-035-escritura-directa', { body: Buffer.from(JSON.stringify({ evidencia, antes: resumenEstado(antes), despues: resumenEstado(despues) }, null, 2)), contentType: 'application/json' });
    for (const [rol, r] of Object.entries(evidencia)) {
      expect(r.post.status, `${rol}: INSERT directo`).toBeGreaterThanOrEqual(400);
      expect(r.postMin.status, `${rol}: INSERT directo (minimal)`).toBeGreaterThanOrEqual(400);
      expect(r.patch.status >= 400 || r.patch.filas === 0, `${rol}: PATCH`).toBeTruthy();
      expect(r.delete.status >= 400 || r.delete.filas === 0, `${rol}: DELETE`).toBeTruthy();
    }
    expect(despues, 'stock e historial exactamente iguales').toEqual(antes);
  });

  test('QA-035: cantidades inválidas y producto inexistente no dejan escrituras parciales; negocio cerrado sigue bloqueando a CAJERA', async ({ browser }, info) => {
    test.setTimeout(180_000);
    knownIssue(info, 'QA-035');
    const antes = await estadoStock();
    const invalidas = { cero: 0, negativa: -3, nula: null, decimal: 1.5, texto: 'abc', desborde: 2147483647 };
    const evidencia = {};
    const inexistente = '00000000-0000-4000-8000-000000000035';
    const cj = await sesion(browser, S.data, 'CAJERA');
    const estado0 = (await leerAdmin('estado_negocio?id=eq.1&select=abierto'))[0].abierto;
    try {
      for (const [nombre, cantidad] of Object.entries(invalidas)) {
        evidencia[nombre] = resumenRes(await rpc(cj.page, cj.box, 'agregar_stock', { p_producto_id: S.producto, p_cantidad: cantidad, p_nota: 'x' }));
      }
      evidencia.inexistente = resumenRes(await rpc(cj.page, cj.box, 'agregar_stock', { p_producto_id: inexistente, p_cantidad: 1, p_nota: 'x' }));
      evidencia.adminDesborde = resumenRes(await rpc(S.admin.page, S.admin.box, 'agregar_stock', { p_producto_id: S.producto, p_cantidad: 2147483647, p_nota: 'x' }));
      // Regla de negocio cerrado: CAJERA bloqueada con el mensaje existente.
      try {
        expect((await rest(S.admin.page, S.admin.box, 'PATCH', 'estado_negocio?id=eq.1', { abierto: false })).status).toBeLessThan(300);
        evidencia.cerrado = resumenRes(await rpc(cj.page, cj.box, 'agregar_stock', { p_producto_id: S.producto, p_cantidad: 1, p_nota: 'x' }));
      } finally {
        await rest(S.admin.page, S.admin.box, 'PATCH', 'estado_negocio?id=eq.1', { abierto: estado0 });
      }
    } finally { await cj.ctx.close(); }
    const despues = await estadoStock();
    await info.attach('qa-035-cantidades-invalidas', { body: Buffer.from(JSON.stringify({ evidencia, antes: resumenEstado(antes), despues: resumenEstado(despues) }, null, 2)), contentType: 'application/json' });
    expect((await leerAdmin('estado_negocio?id=eq.1&select=abierto'))[0].abierto, 'estado del negocio restaurado').toBe(estado0);
    for (const [nombre, r] of Object.entries(evidencia)) expect(r.status, `rechazo: ${nombre}`).toBeGreaterThanOrEqual(400);
    expect(evidencia.cerrado.mensaje).toContain('El negocio se encuentra cerrado');
    expect(evidencia.inexistente.mensaje).toContain('El producto no existe');
    expect(despues, 'sin escrituras parciales: stock e historial exactamente iguales').toEqual(antes);
    expect(await leerAdmin(`movimientos_stock?producto_id=eq.${inexistente}&select=id`), 'nada para el producto inexistente').toEqual([]);
  });

  test('QA-035: CAJERA y ADMIN agregan stock desde Inventario (UI): cantidad correcta, un movimiento por agregado y persistencia tras recargar', async ({ browser }, info) => {
    test.setTimeout(240_000);
    knownIssue(info, 'QA-035');
    const nombre = `${S.data.prefix} CFG Producto`;
    const s0 = (await estadoStock()).stock;
    const registros = [];
    for (const [rol, cantidad] of [['CAJERA', 5], ['ADMINISTRADOR', 2]]) {
      const s = rol === 'CAJERA' ? await sesion(browser, S.data, 'CAJERA') : S.admin;
      try {
        const antesRol = await estadoStock();
        await s.page.goto('/inventario');
        await s.page.getByPlaceholder('Buscar producto...').fill(nombre);
        const fila = () => s.page.getByRole('row').filter({ hasText: nombre });
        await fila().getByRole('button', { name: 'Agregar stock', exact: true }).click();
        const form = formWithTitle(s.page, 'Agregar stock');
        for (const c of ['0', '-1', 'abc']) {
          await form.getByRole('searchbox').first().fill(c);
          await form.getByRole('button', { name: 'Agregar', exact: true }).click();
          await expect(form.getByText('La cantidad debe ser un número mayor a 0.', { exact: true }), `${rol}: la UI rechaza «${c}»`).toBeVisible();
        }
        expect(await estadoStock(), `${rol}: cantidades inválidas sin escrituras`).toEqual(antesRol);
        await form.getByRole('searchbox').first().fill(String(cantidad));
        await form.getByPlaceholder('Ej: Compra proveedor X').fill(`${S.data.prefix} CFG ${rol}`);
        await form.getByRole('button', { name: 'Agregar', exact: true }).click();
        await expect(form).toHaveCount(0);
        await s.page.reload();
        await s.page.getByPlaceholder('Buscar producto...').fill(nombre);
        await expect(fila().getByRole('cell').nth(rol === 'CAJERA' ? 3 : 5), `${rol}: stock persistido tras recargar`).toHaveText(String(antesRol.stock + cantidad));
        const despuesRol = await estadoStock();
        registros.push({ rol, antes: antesRol.stock, agregado: cantidad, despues: despuesRol.stock, movimientos: despuesRol.movimientos.length });
        expect(despuesRol.stock).toBe(antesRol.stock + cantidad);
        expect(despuesRol.movimientos.length, `${rol}: un único movimiento`).toBe(antesRol.movimientos.length + 1);
        const nuevo = despuesRol.movimientos.at(-1);
        expect([nuevo.cantidad_agregada, nuevo.stock_anterior, nuevo.stock_nuevo]).toEqual([cantidad, antesRol.stock, antesRol.stock + cantidad]);
        expect(nuevo.nota).toBe(`${S.data.prefix} CFG ${rol}`);
      } finally { if (rol === 'CAJERA') await s.ctx.close(); }
    }
    await info.attach('qa-035-agregados-autorizados', { body: Buffer.from(JSON.stringify(registros, null, 2)), contentType: 'application/json' });
    const fin = await estadoStock();
    expect(fin.stock).toBe(s0 + 7);
    expect(fin.movimientos.map((m) => m.cantidad_agregada)).toEqual([5, 2]);
    // Historial legible solo por ADMIN (RPC); CAJERA no.
    const cj2 = await sesion(browser, S.data, 'CAJERA');
    try {
      expect((await rpc(cj2.page, cj2.box, 'historial_stock_producto', { p_producto_id: S.producto })).status, 'CAJERA: historial (solo ADMIN)').toBeGreaterThanOrEqual(400);
    } finally { await cj2.ctx.close(); }
    expect((await rpc(S.admin.page, S.admin.box, 'historial_stock_producto', { p_producto_id: S.producto })).json).toHaveLength(2);
  });

  test('Columnas sensibles por rol: costo de productos solo para ADMIN; datos de fichas y comisiones según la regla existente', async ({ browser }) => {
    test.setTimeout(150_000);
    // ADMIN ve el costo (control positivo) en la vista y no en la tabla (sin SELECT de columna para authenticated).
    expect(Number((await leerAdmin(`productos_vista?id=eq.${S.producto}&select=costo`))[0].costo), 'ADMIN ve el costo').toBe(3);
    const costoTabla = await rest(S.admin.page, S.admin.box, 'GET', `productos?id=eq.${S.producto}&select=costo`);
    expect(costoTabla.status, 'ni ADMIN lee costo de la tabla (solo por la vista)').toBeGreaterThanOrEqual(400);
    for (const rol of ROLES) {
      const s = await sesion(browser, S.data, rol, rol === 'CLIENTE' ? S.own : S.data);
      try {
        const tabla = await rest(s.page, s.box, 'GET', `productos?id=eq.${S.producto}&select=costo`);
        expect(tabla.status, `${rol}: costo desde la tabla`).toBeGreaterThanOrEqual(400);
        const vista = await rest(s.page, s.box, 'GET', `productos_vista?id=eq.${S.producto}&select=precio,costo`);
        expect(vista.json?.[0]?.costo ?? null, `${rol}: costo en la vista`).toBeNull();
        expect(Number(vista.json?.[0]?.precio ?? 0), `${rol}: el precio sí es público`).toBeGreaterThan(0);
        // usuarios: solo la propia fila (CLIENTE ninguna)
        const usuarios = (await rest(s.page, s.box, 'GET', 'usuarios?select=id,email,rol&limit=50')).json;
        expect(usuarios.length, `${rol}: usuarios visibles`).toBe(rol === 'CLIENTE' ? 0 : 1);
        // sin sesión no hay costos
      } finally { await s.ctx.close(); }
    }
    const anon = await rest(S.admin.page, S.admin.box, 'GET', `productos_vista?id=eq.${S.producto}&select=precio,costo`, undefined, { sinToken: true });
    expect(anon.json?.[0]?.costo ?? null, 'sin sesión: costo nulo').toBeNull();

    // Reglas existentes que EXPONEN datos a roles bajos (se fijan como hoy; son decisiones, no defectos):
    // (a) toda ficha de asistente con sus datos personales es legible por todo el personal;
    // (b) las atenciones ACTIVAS sin venta (con pago_asistente y % aplicado) son legibles por todo el personal (el POS las vende).
    for (const rol of ['CAJERA', 'ASISTENTE']) {
      const s = await sesion(browser, S.data, rol);
      try {
        const fichas = (await rest(s.page, s.box, 'GET', 'asistentes?select=id,nombres_completos,email,telefono,direccion,contacto_emergencia,cumpleanos&limit=50')).json;
        expect(fichas.length, `${rol} lee fichas de asistentes`).toBeGreaterThan(0);
        const at = (await rest(s.page, s.box, 'GET', `registro_servicios?id=eq.${S.atencion}&select=id,precio,pago_asistente,porcentaje_aplicado`)).json;
        expect(at, `${rol} lee atenciones disponibles de otros`).toHaveLength(1);
        expect(Number(at[0].pago_asistente)).toBe(6);
      } finally { await s.ctx.close(); }
    }
    const c = await sesion(browser, S.data, 'CLIENTE', S.own);
    try {
      expect((await rest(c.page, c.box, 'GET', 'asistentes?select=id&limit=5')).json, 'CLIENTE: fichas por tabla').toEqual([]);
      expect((await rest(c.page, c.box, 'GET', `registro_servicios?id=eq.${S.atencion}&select=id`)).json, 'CLIENTE: atenciones ajenas').toEqual([]);
    } finally { await c.ctx.close(); }
  });

  test('Diagnósticos sanitizados por contexto: sin 5xx ni excepciones de página y sin secretos', async ({}, info) => {
    const resumen = S.diag.map((d) => ({ contexto: d.contexto, consola: [...new Set(d.consola)].slice(0, 20), red: d.red }));
    const texto = JSON.stringify(resumen, null, 2);
    await info.attach('diagnosticos-sanitizados', { body: Buffer.from(texto), contentType: 'application/json' });
    expect(texto).not.toMatch(/eyJ[\w-]{10,}\.[\w-]{10,}\./);
    expect(resumen.length).toBeGreaterThan(8);
    for (const d of resumen) {
      expect(Object.keys(d.red).filter((k) => /\s5\d\d$/.test(k)), `${d.contexto}: respuestas 5xx`).toEqual([]);
      expect(d.consola.filter((m) => m.startsWith('pageerror')), `${d.contexto}: excepciones de página`).toEqual([]);
    }
  });
});
