import { test, expect, knownIssue } from './fixtures.mjs';
import { readFile } from 'node:fs/promises';
import { sufijoUnico, login, createService } from './helpers.mjs';
import { isolatedClient, qaContext, testImage } from './phase2-helpers.mjs';
import { supabaseURL } from './local-safety.mjs';

// Autorización ampliada (Supabase Local TEST, datos ficticios): clientes, deudas, mobiliario, citas, cupones y
// Storage, por rol (CAJERA, ASISTENTE, CLIENTE) y entre dos CLIENTE ficticias (A y B). Se comprueba la regla
// EXISTENTE (políticas RLS/grants/RPC leídas antes de escribir las aserciones; no se inventan reglas):
//  - clientes: lectura = todo el personal; alta/edición/baja = solo ADMIN y solo clientes sin cuenta web.
//  - deudas y mobiliario(+compras): solo ADMIN para todo.
//  - citas / cita_servicios: todo el personal las lee, crea y modifica; borrar la cita es solo ADMIN
//    (borrar líneas de cita es de todo el personal); el CLIENTE solo lee las suyas (escribe por RPC).
//  - cupones: lectura propia o de todo el personal; ninguna política de escritura.
//  - Storage: comprobantes-* privados (carpeta = uid del dueño, o ADMIN); fotos-* públicos de lectura;
//    escritura de fotos-clientes/usuarios solo en la propia carpeta; el resto de fotos y qr-pagos, solo ADMIN.
// Una respuesta 200 con cero filas es un bloqueo correcto de RLS: se verifica además que nada cambió.

function watchApiKey(page) {
  const box = { key: null };
  page.on('request', (r) => {
    const k = r.headers().apikey;
    if (k && r.url().startsWith(supabaseURL)) box.key = k;
  });
  return box;
}

async function http(page, box, { method = 'GET', path, body, sinToken = false, raw = null, headers = {} }) {
  return page.evaluate(async ({ method, path, body, key, base, sinToken, raw, headers }) => {
    const storageKey = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
    const sesion = storageKey ? JSON.parse(localStorage.getItem(storageKey)) : null;
    const h = { apikey: key, ...headers };
    if (!sinToken && sesion) h.Authorization = `Bearer ${sesion.access_token}`;
    let cuerpo;
    if (raw) { h['Content-Type'] = raw.tipo; cuerpo = Uint8Array.from(atob(raw.base64), (c) => c.charCodeAt(0)); }
    else if (body !== undefined) { h['Content-Type'] = 'application/json'; h.Prefer = 'return=representation'; cuerpo = JSON.stringify(body); }
    else h.Prefer = 'return=representation';
    const r = await fetch(base + path, { method, headers: h, body: cuerpo });
    const texto = await r.text();
    let json = null;
    try { json = JSON.parse(texto); } catch { /* no JSON */ }
    return { status: r.status, json, texto: texto.slice(0, 200), bytes: texto.length, userId: sesion?.user?.id ?? null };
  }, { method, path, body, key: box.key, base: supabaseURL, sinToken, raw, headers });
}
const rest = (p, b, method, path, body, o = {}) => http(p, b, { method, path: `/rest/v1/${path}`, body, ...o });
const sinEfecto = (r) => r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0);
const vacio = (r) => r.status === 200 && Array.isArray(r.json) && r.json.length === 0;

async function sesion(browser, data, rol, cuenta = data) {
  const ctx = await qaContext(browser);
  const page = await ctx.newPage();
  const box = watchApiKey(page);
  vigilar(page, `${rol}${rol === 'CLIENTE' ? ` ${cuenta.clientName?.slice(-8) ?? ''}` : ''}`);
  await login(page, rol, cuenta);
  return { ctx, page, box };
}

// Huella SHA-256 del contenido de un archivo descargado con la sesión indicada (no se guardan bytes, URLs firmadas ni tokens).
async function huella(page, box, ruta) {
  return page.evaluate(async ({ ruta, key, base }) => {
    const storageKey = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
    const token = JSON.parse(localStorage.getItem(storageKey)).access_token;
    const r = await fetch(`${base}/storage/v1/object/authenticated/${ruta}`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
    if (!r.ok) return { status: r.status };
    const buf = await r.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return { status: r.status, bytes: buf.byteLength, sha256: [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('') };
  }, { ruta, key: box.key, base: supabaseURL });
}

// Diagnósticos sanitizados por contexto: errores de consola (sin URLs completas) y solicitudes de red resumidas a
// método + ruta sin query + estado. No se guardan cabeceras, cuerpos, tokens ni URLs firmadas.
function limpiar(texto) {
  return String(texto).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]').replace(/([?&])(token|apikey)=[^&\s]+/gi, '$1$2=[oculto]').slice(0, 200);
}
function vigilar(page, etiqueta) {
  const d = { contexto: etiqueta, consola: [], red: {} };
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) d.consola.push(`${m.type()}: ${limpiar(m.text())}`); });
  page.on('pageerror', (e) => d.consola.push(`pageerror: ${limpiar(e.message)}`));
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (!r.url().startsWith(supabaseURL)) return;
    const clave = `${r.request().method()} ${u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id')} ${r.status()}`;
    d.red[clave] = (d.red[clave] ?? 0) + 1;
  });
  S.diag.push(d);
  return d;
}

const S = { diag: [] };

async function leerAdmin(path) {
  return (await rest(S.admin.page, S.admin.box, 'GET', path)).json;
}

async function pedidoConComprobante(browser, data, cuenta, producto) {
  const ctx = await qaContext(browser);
  try {
    const c = await ctx.newPage();
    await login(c, 'CLIENTE', cuenta);
    await c.goto(`/productos/${producto}`);
    await c.getByRole('button', { name: /^Agregar al carrito/ }).filter({ visible: true }).first().click();
    await c.goto('/carrito');
    await c.getByRole('button', { name: 'Recojo en tienda', exact: true }).click();
    await c.getByRole('button', { name: 'Elige el día', exact: true }).click();
    await c.getByRole('button', { name: String(Number(data.tomorrow.slice(-2))), exact: true }).filter({ visible: true }).first().click();
    await c.getByRole('button', { name: 'Elige la hora', exact: true }).click();
    await c.getByRole('button', { name: '11:00', exact: true }).click();
    await c.getByRole('button', { name: 'Yape', exact: true }).click();
    await c.locator('input[type="file"]').setInputFiles(await testImage(c));
    const enviada = c.waitForResponse((r) => r.url().includes('/rpc/confirmar_pedido_productos'));
    await c.getByRole('button', { name: /^Confirmar pedido \(/ }).click();
    expect((await enviada).ok(), 'pedido del portal').toBeTruthy();
  } finally { await ctx.close(); }
}

async function snapshotCliente(X) {
  const c = X.cliente; const w = X.web;
  return {
    direcciones: await leerAdmin(`direcciones_cliente?cliente_web_id=eq.${w}&select=id,etiqueta,direccion,predeterminada&order=id`),
    // Carrito y favoritos: solo la dueña los lee (ni ADMIN), así que se leen con su propia sesión.
    carrito: (await rest(X.s.page, X.s.box, 'GET', `carrito_productos?cliente_web_id=eq.${w}&select=producto_id,cantidad`)).json,
    // ADMIN no lee notificaciones ajenas (política: solo la dueña): se lee con la sesión de la propia clienta.
    notificaciones: (await rest(X.s.page, X.s.box, 'GET', `notificaciones?cliente_id=eq.${c}&select=id,titulo,mensaje,leida&order=id`)).json,
    pedidos: await leerAdmin(`pedidos_web?cliente_id=eq.${c}&select=id,estado,total,comprobante_url,pago_verificado&order=id`),
    citas: await leerAdmin(`citas?cliente_id=eq.${c}&select=id,estado,nota,fecha_hora&order=id`),
    lineas: await leerAdmin(`cita_servicios?cita_id=eq.${X.cita}&select=id,precio&order=id`),
    cupones: await leerAdmin(`cupones?cliente_id=eq.${c}&select=id,estado,valor,codigo&order=id`),
    clienteFila: await leerAdmin(`clientes?id=eq.${c}&select=nombre,telefono,notas`),
    carritoServicios: (await rest(X.s.page, X.s.box, 'GET', `carrito_servicios?cliente_web_id=eq.${w}&select=servicio_id`)).json,
    favoritos: [
      ...(await rest(X.s.page, X.s.box, 'GET', `favoritos_productos?cliente_web_id=eq.${w}&select=producto_id`)).json,
      ...(await rest(X.s.page, X.s.box, 'GET', `favoritos_servicios?cliente_web_id=eq.${w}&select=servicio_id`)).json,
    ],
    atenciones: await leerAdmin(`registro_servicios?cliente_id=eq.${c}&select=id,precio,estado,nota&order=id`),
    resenas: [
      ...(await leerAdmin(`resenas_producto?cliente_id=eq.${c}&select=id,estado,comentario&order=id`)),
      ...(await leerAdmin(`resenas_servicio?cliente_id=eq.${c}&select=id,estado,comentario&order=id`)),
      ...(await leerAdmin(`resenas?cliente_id=eq.${c}&select=id,estado,comentario&order=id`)),
    ],
  };
}

test.describe.serial('AUTORIZACIÓN AMPLIADA: clientes, deudas, mobiliario, citas, cupones y Storage', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(540_000);
    const data = JSON.parse(await readFile('tests/e2e/fixtures/runtime.json', 'utf8'));
    S.data = data;
    S.admin = await sesion(browser, data, 'ADMINISTRADOR');
    const { page, box } = S.admin;
    S.adminId = (await rest(page, box, 'GET', 'productos?select=id&limit=1')).userId;

    // Registros del negocio preparados por ADMINISTRADOR (con su sesión real, permitido por las políticas).
    const nombre = `${data.prefix} AUTZ`;
    const cli = await rest(page, box, 'POST', 'clientes', { nombre: `${nombre} cliente`, telefono: `7${String(Date.now()).slice(-8)}`, notas: 'TEST original' });
    expect(cli.status, 'alta de cliente por ADMIN').toBeLessThan(300);
    S.clienteStaff = cli.json[0].id;
    const deu = await rest(page, box, 'POST', 'deudas', { cliente_id: S.clienteStaff, concepto: `${nombre} deuda`, monto: 7, fecha: data.today, creado_por: S.adminId });
    expect(deu.status, JSON.stringify(deu.json)).toBeLessThan(300);
    S.deuda = deu.json[0].id;
    const mue = await rest(page, box, 'POST', 'mobiliario', { nombre: `${nombre} mueble`, creado_por: S.adminId });
    expect(mue.status, JSON.stringify(mue.json)).toBeLessThan(300);
    S.mueble = mue.json[0].id;

    // Producto y servicio propios (UI) para el pedido y la cita de las dos clientas.
    const sufijo = sufijoUnico();
    S.producto = { productName: `${nombre} Producto ${sufijo}`, barcode: `${data.barcode}-AUTZ-${sufijo}`, initialStock: 10 };
    await page.goto('/inventario');
    await page.getByRole('button', { name: 'Nuevo producto', exact: true }).filter({ visible: true }).first().click();
    const formP = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Nuevo producto', exact: true }) });
    await formP.getByLabel('Nombre', { exact: false }).fill(S.producto.productName);
    await formP.getByLabel('Código de barras', { exact: true }).fill(S.producto.barcode);
    await formP.getByLabel('Stock inicial', { exact: false }).fill('20');
    // QA-055: costo ficticio CONOCIDO (S/5): el producto se vende con el cupón de bienvenida de referido; con costo 0 sin confirmar el cupón se bloquea.
    await formP.getByLabel('Costo', { exact: false }).fill('5');
    await formP.getByLabel('Precio de venta', { exact: false }).fill('20');
    const guardadoP = page.waitForResponse((r) => r.url().includes('/rest/v1/productos?') && r.request().method() === 'POST');
    await formP.getByRole('button', { name: 'Guardar', exact: true }).click();
    const prodP = await (await guardadoP).json();
    S.producto.productId = prodP.id ?? prodP[0]?.id;
    await expect(formP).toHaveCount(0);
    S.servicio = { serviceName: `${nombre} Servicio` };
    await createService(page, S.servicio);

    for (const clave of ['A', 'B']) {
      const cuenta = await isolatedClient(browser, data, `AZ${clave}`);
      const X = { cuenta };
      X.s = await sesion(browser, data, 'CLIENTE', cuenta);
      X.web = (await rest(X.s.page, X.s.box, 'GET', 'productos?select=id&limit=1')).userId;
      X.cliente = (await leerAdmin(`clientes?telefono=eq.${cuenta.phone}&select=id`))[0].id;
      // Referido: B usa el código de A ANTES de su primera atención (regla existente).
      if (clave === 'B') {
        const codigo = (await rest(S.A.s.page, S.A.s.box, 'POST', 'rpc/mi_codigo_referido', {})).json;
        const ap = await rest(X.s.page, X.s.box, 'POST', 'rpc/aplicar_codigo_referido', { p_codigo: codigo });
        expect(ap.status, JSON.stringify(ap.json)).toBeLessThan(300);
      }
      // La propia clienta crea su dirección (política de INSERT propia).
      const dir = await rest(X.s.page, X.s.box, 'POST', 'direcciones_cliente', { cliente_web_id: X.web, etiqueta: `Casa ${clave}`, direccion: `TEST Calle ${clave} 100` });
      expect(dir.status, JSON.stringify(dir.json)).toBeLessThan(300);
      // Pedido con comprobante (Storage) creado por la interfaz; confirmarlo vacía el carrito, así que el carrito
      // (y favoritos) se REPUEBLAN después para que existan datos que proteger.
      await pedidoConComprobante(browser, data, cuenta, S.producto.productId);
      for (const [tabla, fila] of [
        ['carrito_productos', { cliente_web_id: X.web, producto_id: S.producto.productId, cantidad: 2 }],
        ['carrito_servicios', { cliente_web_id: X.web, servicio_id: S.servicio.serviceId }],
        ['favoritos_productos', { cliente_web_id: X.web, producto_id: S.producto.productId }],
        ['favoritos_servicios', { cliente_web_id: X.web, servicio_id: S.servicio.serviceId }],
      ]) {
        const r = await rest(X.s.page, X.s.box, 'POST', tabla, fila);
        expect(r.status, `${tabla} de ${clave}: ${JSON.stringify(r.json)}`).toBeLessThan(300);
      }
      // Atención registrada por ADMIN (misma política de INSERT del administrador).
      const aten = await rest(page, box, 'POST', 'registro_servicios', { usuario_id: S.adminId, servicio_id: S.servicio.serviceId, cliente_id: X.cliente, precio: 2, fecha: new Date().toISOString(), nota: `${nombre} atención ${clave}` });
      expect(aten.status, `atención de ${clave}: ${JSON.stringify(aten.json)}`).toBeLessThan(300);
      // Cita de la clienta preparada por ADMIN con el RPC del POS.
      const cita = await rest(page, box, 'POST', 'rpc/guardar_cita_pos', {
        p_cita_id: null, p_cliente_id: X.cliente, p_cliente_nombre_referencia: null, p_asistente_id: null,
        p_fecha_hora: new Date(Date.now() + 3 * 864e5).toISOString(), p_nota: `${nombre} cita ${clave}`, p_adelanto: null,
        p_servicios: [{ servicio_id: S.servicio.serviceId, duracion_min: 30, precio: 2 }],
      });
      expect(cita.status, JSON.stringify(cita.json)).toBeLessThan(300);
      X.cita = cita.json;
      S[clave] = X;
    }
    // Referido: B usa el código de A (cupón de bienvenida de B); ADMIN lo canjea en una venta (recompensa de A).
    const cupon = (await leerAdmin(`cupones?cliente_id=eq.${S.B.cliente}&origen=eq.REFERIDO_BIENVENIDA&select=codigo`))[0].codigo;
    const canje = await rest(page, box, 'POST', 'rpc/confirmar_venta', { p_metodo_pago: 'Yape', p_monto_recibido: null, p_items: [{ tipo: 'PRODUCTO', producto_id: S.producto.productId, cantidad: 1 }], p_codigo_cupon: cupon, p_cliente_id: S.B.cliente });
    expect(canje.status, JSON.stringify(canje.json)).toBeLessThan(300);
    // ADMIN verifica los pagos de los pedidos → notificaciones para ambas.
    for (const clave of ['A', 'B']) {
      const ped = (await leerAdmin(`pedidos_web?cliente_id=eq.${S[clave].cliente}&select=id`))[0].id;
      expect((await rest(page, box, 'POST', 'rpc/verificar_pago_pedido_web', { p_pedido_id: ped })).status).toBeLessThan(300);
    }
    // Reseñas: el pedido se entrega y la cita se completa (acciones de ADMIN); cada clienta reseña producto, servicio
    // y su experiencia general. Las de B se aprueban; las de A quedan PENDIENTES.
    for (const clave of ['A', 'B']) {
      const X = S[clave];
      const ped = (await leerAdmin(`pedidos_web?cliente_id=eq.${X.cliente}&select=id`))[0].id;
      expect((await rest(page, box, 'PATCH', `pedidos_web?id=eq.${ped}`, { estado: 'ENTREGADO' })).status).toBeLessThan(300);
      expect((await rest(page, box, 'PATCH', `citas?id=eq.${X.cita}`, { estado: 'COMPLETADA' })).status).toBeLessThan(300);
      const texto = `${nombre} reseña ${clave}`;
      const rp = await rest(X.s.page, X.s.box, 'POST', 'rpc/guardar_mi_resena_producto', { p_producto_id: S.producto.productId, p_calificacion: 5, p_comentario: `${texto} producto` });
      const rs = await rest(X.s.page, X.s.box, 'POST', 'rpc/guardar_mi_resena_servicio', { p_servicio_id: S.servicio.serviceId, p_calificacion: 4, p_comentario: `${texto} servicio` });
      const rg = await rest(X.s.page, X.s.box, 'POST', 'rpc/guardar_mi_resena', { p_calificacion: 5, p_comentario: `${texto} general` });
      expect(rp.status, JSON.stringify(rp.json)).toBeLessThan(300);
      expect(rs.status, JSON.stringify(rs.json)).toBeLessThan(300);
      expect(rg.status, JSON.stringify(rg.json)).toBeLessThan(300);
    }
    for (const tabla of ['resenas_producto', 'resenas_servicio', 'resenas']) {
      const ok = await rest(page, box, 'PATCH', `${tabla}?cliente_id=eq.${S.B.cliente}`, { estado: 'APROBADA' });
      expect(ok.status, `${tabla}: aprobar las de B`).toBeLessThan(300);
      expect(ok.json).toHaveLength(1);
    }
    // Compra de mobiliario (ADMIN).
    const compra = await rest(page, box, 'POST', 'mobiliario_compras', { mobiliario_id: S.mueble, cantidad: 1, precio_unitario: 5, precio_total: 5, fecha: data.today, proveedor_nombre: `${nombre} proveedor`, creado_por: S.adminId });
    expect(compra.status, JSON.stringify(compra.json)).toBeLessThan(300);
    S.compra = compra.json[0].id;
    // Base inicial de cada clienta y de los registros del negocio.
    S.base = { A: await snapshotCliente(S.A), B: await snapshotCliente(S.B) };
    for (const clave of ['A', 'B']) {
      expect(S.base[clave].notificaciones.length, `notificaciones de ${clave}`).toBeGreaterThan(0);
      expect(S.base[clave].cupones.length, `cupones de ${clave}`).toBeGreaterThan(0);
      expect(S.base[clave].pedidos[0].comprobante_url, `comprobante de ${clave}`).toBeTruthy();
      for (const campo of ['direcciones', 'carrito', 'carritoServicios', 'favoritos', 'atenciones', 'cupones', 'citas', 'lineas', 'notificaciones']) {
        expect(S.base[clave][campo].length, `precondición: ${campo} de ${clave} existe antes de atacar`).toBeGreaterThan(0);
      }
      expect(S.base[clave].resenas, `precondición: 3 reseñas de ${clave}`).toHaveLength(3);
      expect(S.base[clave].resenas.every((r) => r.estado === (clave === 'B' ? 'APROBADA' : 'PENDIENTE')), `estados de reseñas de ${clave}`).toBeTruthy();
    }
    S.negocioBase = async () => ({
      cliente: await leerAdmin(`clientes?id=eq.${S.clienteStaff}&select=nombre,telefono,notas`),
      deuda: await leerAdmin(`deudas?id=eq.${S.deuda}&select=concepto,monto,estado`),
      mueble: await leerAdmin(`mobiliario?id=eq.${S.mueble}&select=nombre,condicion,activo`),
      compra: await leerAdmin(`mobiliario_compras?id=eq.${S.compra}&select=cantidad,precio_total,proveedor_nombre`),
    });
    S.negocio = await S.negocioBase();
  });

  test.afterAll(async () => {
    for (const c of [S.admin, S.A?.s, S.B?.s]) await c?.ctx.close();
  });

  for (const rol of ['CAJERA', 'ASISTENTE', 'CLIENTE']) {
    test(`${rol}: clientes, deudas y mobiliario según la regla existente, sin cambios posteriores`, async ({ browser }) => {
      test.setTimeout(120_000);
      const s = rol === 'CLIENTE' ? await sesion(browser, S.data, 'CLIENTE', S.A.cuenta) : await sesion(browser, S.data, rol);
      try {
        const { page, box } = s;
        // Lectura
        const clientes = await rest(page, box, 'GET', `clientes?id=eq.${S.clienteStaff}&select=id,nombre`);
        if (rol === 'CLIENTE') expect(vacio(clientes), 'CLIENTE no lee la tabla clientes').toBeTruthy();
        else expect(clientes.json, `${rol} lee clientes (regla existente: todo el personal)`).toHaveLength(1);
        for (const tabla of ['deudas', 'mobiliario', 'mobiliario_compras']) {
          expect(vacio(await rest(page, box, 'GET', `${tabla}?select=id&limit=5`)), `${rol}: lectura de ${tabla}`).toBeTruthy();
        }
        // Creación
        expect((await rest(page, box, 'POST', 'clientes', { nombre: `${S.data.prefix} AUTZ intruso`, telefono: '700000001' })).status, `${rol}: alta de cliente`).toBeGreaterThanOrEqual(400);
        expect((await rest(page, box, 'POST', 'deudas', { cliente_id: S.clienteStaff, concepto: 'x', monto: 1, fecha: S.data.today, creado_por: S.adminId })).status, `${rol}: alta de deuda`).toBeGreaterThanOrEqual(400);
        expect((await rest(page, box, 'POST', 'mobiliario', { nombre: `${S.data.prefix} AUTZ mueble intruso`, creado_por: S.adminId })).status, `${rol}: alta de mueble`).toBeGreaterThanOrEqual(400);
        // Modificación y eliminación (cero filas o error = bloqueo)
        for (const [tabla, id, parche] of [['clientes', S.clienteStaff, { nombre: 'HACK' }], ['deudas', S.deuda, { monto: 999, estado: 'COBRADA' }], ['mobiliario', S.mueble, { nombre: 'HACK' }], ['mobiliario_compras', S.compra, { precio_total: 999, cantidad: 9 }]]) {
          expect(sinEfecto(await rest(page, box, 'PATCH', `${tabla}?id=eq.${id}`, parche)), `${rol}: PATCH ${tabla}`).toBeTruthy();
          expect(sinEfecto(await rest(page, box, 'DELETE', `${tabla}?id=eq.${id}`)), `${rol}: DELETE ${tabla}`).toBeTruthy();
        }
      } finally { await s.ctx.close(); }
      expect(await S.negocioBase(), 'ningún registro cambió ni se eliminó').toEqual(S.negocio);
    });
  }

  test('ADMINISTRADOR: edita clientes sin cuenta web y no puede editar ni borrar clientes con cuenta web', async () => {
    const { page, box } = S.admin;
    const ok = await rest(page, box, 'PATCH', `clientes?id=eq.${S.clienteStaff}`, { notas: 'TEST editado' });
    expect(ok.status).toBeLessThan(300);
    expect(ok.json).toHaveLength(1);
    const web = await rest(page, box, 'PATCH', `clientes?id=eq.${S.A.cliente}`, { nombre: 'HACK ADMIN' });
    expect(sinEfecto(web), 'regla existente: clientes con cuenta web no se editan').toBeTruthy();
    expect(sinEfecto(await rest(page, box, 'DELETE', `clientes?id=eq.${S.A.cliente}`))).toBeTruthy();
    expect((await snapshotCliente(S.A)).clienteFila).toEqual(S.base.A.clienteFila);
    S.negocio = await S.negocioBase(); // restaurar la base tras la edición autorizada
  });

  for (const [atacante, victima] of [['A', 'B'], ['B', 'A']]) {
    test(`CLIENTE ${atacante} no accede a registros ni archivos privados de CLIENTE ${victima}`, async ({ browser }) => {
      test.setTimeout(180_000);
      const X = S[atacante]; const V = S[victima];
      const { page, box } = X.s;
      // Lectura: cada consulta dirigida a los datos de la otra clienta devuelve 200 con cero filas.
      const lecturas = [
        `direcciones_cliente?cliente_web_id=eq.${V.web}&select=id`,
        `carrito_productos?cliente_web_id=eq.${V.web}&select=producto_id`,
        `notificaciones?cliente_id=eq.${V.cliente}&select=id`,
        `pedidos_web?cliente_id=eq.${V.cliente}&select=id`,
        `pedidos_web_items?pedido_id=in.(${S.base[victima].pedidos.map((p) => p.id).join(',')})&select=id`,
        `citas?cliente_id=eq.${V.cliente}&select=id`,
        `cita_servicios?cita_id=eq.${V.cita}&select=id`,
        `cupones?cliente_id=eq.${V.cliente}&select=id`,
        `registro_servicios?cliente_id=eq.${V.cliente}&select=id`,
        `clientes?id=eq.${V.cliente}&select=id,nombre`,
        `clientes_web?id=eq.${V.web}&select=id,email`,
        `favoritos_productos?cliente_web_id=eq.${V.web}&select=producto_id`,
        `favoritos_servicios?cliente_web_id=eq.${V.web}&select=servicio_id`,
        `carrito_servicios?cliente_web_id=eq.${V.web}&select=servicio_id`,
        `mobiliario_compras?select=id&limit=3`,
      ];
      for (const ruta of lecturas) expect(vacio(await rest(page, box, 'GET', ruta)), `${atacante}→${victima}: ${ruta}`).toBeTruthy();
      // Reseñas según la política existente: las APROBADAS son visibles para cualquier sesión; las PENDIENTES solo para
      // su dueña (y ADMIN). B tiene las suyas aprobadas; A, pendientes.
      for (const tabla of ['resenas_producto', 'resenas_servicio', 'resenas']) {
        const vistas = await rest(page, box, 'GET', `${tabla}?cliente_id=eq.${V.cliente}&select=id,estado`);
        if (victima === 'B') expect(vistas.json.map((r) => r.estado), `${tabla}: las aprobadas de B son públicas`).toEqual(['APROBADA']);
        else expect(vacio(vistas), `${tabla}: las pendientes de A no son visibles para B`).toBeTruthy();
      }
      // Las propias sí existen (control positivo: el bloqueo no es por falta de datos).
      expect((await rest(page, box, 'GET', `direcciones_cliente?cliente_web_id=eq.${X.web}&select=id`)).json.length).toBeGreaterThan(0);
      expect((await rest(page, box, 'GET', `cupones?cliente_id=eq.${X.cliente}&select=id`)).json.length).toBeGreaterThan(0);
      // Modificación y eliminación: 200 con cero filas o error; luego se comprueba que nada cambió.
      const ataques = [
        ['PATCH', `direcciones_cliente?cliente_web_id=eq.${V.web}`, { direccion: 'HACK' }],
        ['DELETE', `direcciones_cliente?cliente_web_id=eq.${V.web}`],
        ['PATCH', `carrito_productos?cliente_web_id=eq.${V.web}`, { cantidad: 99 }],
        ['DELETE', `carrito_productos?cliente_web_id=eq.${V.web}`],
        ['PATCH', `notificaciones?cliente_id=eq.${V.cliente}`, { leida: true, mensaje: 'HACK' }],
        ['PATCH', `pedidos_web?cliente_id=eq.${V.cliente}`, { estado: 'ENTREGADO' }],
        ['PATCH', `citas?cliente_id=eq.${V.cliente}`, { estado: 'COMPLETADA', nota: 'HACK' }],
        ['DELETE', `citas?cliente_id=eq.${V.cliente}`],
        ['DELETE', `cita_servicios?cita_id=eq.${V.cita}`],
        ['PATCH', `cupones?cliente_id=eq.${V.cliente}`, { estado: 'ANULADO', valor: 1 }],
        ['PATCH', `clientes?id=eq.${V.cliente}`, { nombre: 'HACK' }],
        ['DELETE', `carrito_servicios?cliente_web_id=eq.${V.web}`],
        ['DELETE', `favoritos_productos?cliente_web_id=eq.${V.web}`],
        ['DELETE', `favoritos_servicios?cliente_web_id=eq.${V.web}`],
        ['PATCH', `registro_servicios?cliente_id=eq.${V.cliente}`, { precio: 0, estado: 'CANCELADO' }],
        ['DELETE', `registro_servicios?cliente_id=eq.${V.cliente}`],
        ['PATCH', `resenas_producto?cliente_id=eq.${V.cliente}`, { estado: 'APROBADA', comentario: 'HACK' }],
        ['PATCH', `resenas_servicio?cliente_id=eq.${V.cliente}`, { estado: 'RECHAZADA', comentario: 'HACK' }],
        ['PATCH', `resenas?cliente_id=eq.${V.cliente}`, { estado: 'RECHAZADA', comentario: 'HACK' }],
        ['DELETE', `resenas_producto?cliente_id=eq.${V.cliente}`],
      ];
      for (const [metodo, ruta, cuerpo] of ataques) expect(sinEfecto(await rest(page, box, metodo, ruta, cuerpo)), `${atacante}→${victima}: ${metodo} ${ruta}`).toBeTruthy();
      // Tampoco puede escribir a nombre de la otra: inserción de dirección/carrito/cita con ids ajenos.
      expect((await rest(page, box, 'POST', 'direcciones_cliente', { cliente_web_id: V.web, etiqueta: 'HACK', direccion: 'HACK' })).status).toBeGreaterThanOrEqual(400);
      expect((await rest(page, box, 'POST', 'carrito_productos', { cliente_web_id: V.web, producto_id: S.producto.productId, cantidad: 5 })).status).toBeGreaterThanOrEqual(400);
      expect((await rest(page, box, 'POST', 'citas', { cliente_id: V.cliente, fecha_hora: new Date().toISOString() })).status).toBeGreaterThanOrEqual(400);

      // Storage: comprobante de la víctima (bucket privado).
      const archivo = S.base[victima].pedidos[0].comprobante_url;
      const bucket = 'comprobantes-pedidos-web';
      const huellaAntes = await huella(V.s.page, V.s.box, `${bucket}/${archivo}`);
      expect(huellaAntes.status, 'la dueña lee su comprobante antes').toBe(200);
      expect(huellaAntes.bytes).toBeGreaterThan(0);
      const propio = S.base[atacante].pedidos[0].comprobante_url;
      const descarga = (p, b, ruta) => http(p, b, { path: `/storage/v1/object/authenticated/${bucket}/${ruta}` });
      expect((await descarga(page, box, propio)).status, 'la dueña lee su propio comprobante').toBe(200);
      expect((await descarga(page, box, archivo)).status, `${atacante} no descarga el comprobante de ${victima}`).toBeGreaterThanOrEqual(400);
      // Controles positivos: las mismas peticiones, hechas por la dueña, sí funcionan (el rechazo no es un error de formato).
      const firmaPropia = await http(page, box, { method: 'POST', path: `/storage/v1/object/sign/${bucket}/${propio}`, body: { expiresIn: 60 } });
      expect(firmaPropia.status, 'control: la dueña obtiene URL firmada').toBe(200);
      const listaPropia = await http(page, box, { method: 'POST', path: `/storage/v1/object/list/${bucket}`, body: { prefix: `${X.web}/`, limit: 20 } });
      expect(listaPropia.json.length, 'control: la dueña lista su carpeta').toBeGreaterThan(0);
      const nombreFoto = `${X.web}/autz-${Date.now()}.txt`;
      const fotoPropia = await http(page, box, { method: 'POST', path: `/storage/v1/object/fotos-clientes/${nombreFoto}`, raw: { tipo: 'text/plain', base64: btoa('ok') } });
      expect(fotoPropia.status, 'control: escribe en su propia carpeta de fotos-clientes').toBeLessThan(300);
      expect((await http(page, box, { method: 'DELETE', path: `/storage/v1/object/fotos-clientes/${nombreFoto}` })).status).toBeLessThan(300);
      const firmada = await http(page, box, { method: 'POST', path: `/storage/v1/object/sign/${bucket}/${archivo}`, body: { expiresIn: 60 } });
      expect(firmada.status, 'tampoco obtiene una URL firmada').toBeGreaterThanOrEqual(400);
      const listado = await http(page, box, { method: 'POST', path: `/storage/v1/object/list/${bucket}`, body: { prefix: `${V.web}/`, limit: 20 } });
      expect(listado.status === 200 ? listado.json : [], 'listado vacío de la carpeta ajena').toEqual([]);
      const sube = await http(page, box, { method: 'POST', path: `/storage/v1/object/${bucket}/${V.web}/hack-${Date.now()}.txt`, raw: { tipo: 'text/plain', base64: btoa('hack') } });
      expect(sube.status, 'no sube a la carpeta ajena').toBeGreaterThanOrEqual(400);
      const borra = await http(page, box, { method: 'DELETE', path: `/storage/v1/object/${bucket}/${archivo}` });
      expect(borra.status >= 400 || (Array.isArray(borra.json) && borra.json.length === 0), 'no borra el archivo ajeno').toBeTruthy();
      const reemplaza = await http(page, box, { method: 'PUT', path: `/storage/v1/object/${bucket}/${archivo}`, raw: { tipo: 'text/plain', base64: btoa('hack') } });
      expect(reemplaza.status, 'no sobrescribe el archivo ajeno').toBeGreaterThanOrEqual(400);
      // fotos de perfil públicas: lectura abierta, escritura solo en la propia carpeta
      const fotoAjena = await http(page, box, { method: 'POST', path: `/storage/v1/object/fotos-clientes/${V.web}/hack-${Date.now()}.txt`, raw: { tipo: 'text/plain', base64: btoa('hack') } });
      expect(fotoAjena.status, 'no escribe en fotos-clientes ajena').toBeGreaterThanOrEqual(400);
      const fotoAdmin = await http(page, box, { method: 'POST', path: `/storage/v1/object/fotos-productos/hack-${Date.now()}.txt`, raw: { tipo: 'text/plain', base64: btoa('hack') } });
      expect(fotoAdmin.status, 'no escribe en un bucket solo de administración').toBeGreaterThanOrEqual(400);

      // Nada cambió, y la víctima sigue pudiendo leer su archivo.
      expect(await snapshotCliente(V)).toEqual(S.base[victima]);
      const huellaDespues = await huella(V.s.page, V.s.box, `${bucket}/${archivo}`);
      expect(huellaDespues, 'el contenido del archivo es idéntico (SHA-256) tras los intentos').toEqual(huellaAntes);
    });
  }

  test('Storage por rol: CAJERA y ASISTENTE no leen comprobantes ni escriben en buckets de administración; ADMIN lee comprobantes', async ({ browser }) => {
    test.setTimeout(150_000);
    const archivo = S.base.A.pedidos[0].comprobante_url;
    const bucket = 'comprobantes-pedidos-web';
    expect((await http(S.admin.page, S.admin.box, { path: `/storage/v1/object/authenticated/${bucket}/${archivo}` })).status, 'ADMIN lee comprobantes').toBe(200);
    for (const rol of ['CAJERA', 'ASISTENTE']) {
      const s = await sesion(browser, S.data, rol);
      try {
        expect((await http(s.page, s.box, { path: `/storage/v1/object/authenticated/${bucket}/${archivo}` })).status, `${rol}: comprobante (regla existente: solo dueña o ADMIN)`).toBeGreaterThanOrEqual(400);
        for (const b of ['fotos-productos', 'fotos-servicios', 'fotos-galeria', 'fotos-asistentes', 'qr-pagos']) {
          const r = await http(s.page, s.box, { method: 'POST', path: `/storage/v1/object/${b}/hack-${Date.now()}.txt`, raw: { tipo: 'text/plain', base64: btoa('hack') } });
          expect(r.status, `${rol}: escritura en ${b}`).toBeGreaterThanOrEqual(400);
        }
      } finally { await s.ctx.close(); }
    }
    // Control positivo: ADMIN sí escribe (y borra) en fotos-productos.
    const nombreAdmin = `autz-${Date.now()}.txt`;
    expect((await http(S.admin.page, S.admin.box, { method: 'POST', path: `/storage/v1/object/fotos-productos/${nombreAdmin}`, raw: { tipo: 'text/plain', base64: btoa('ok') } })).status, 'control: ADMIN escribe en fotos-productos').toBeLessThan(300);
    expect((await http(S.admin.page, S.admin.box, { method: 'DELETE', path: `/storage/v1/object/fotos-productos/${nombreAdmin}` })).status).toBeLessThan(300);
    // Sin sesión: ni comprobantes ni escritura.
    const anon = await http(S.admin.page, S.admin.box, { path: `/storage/v1/object/authenticated/${bucket}/${archivo}`, sinToken: true });
    expect(anon.status).toBeGreaterThanOrEqual(400);
    const anonSube = await http(S.admin.page, S.admin.box, { method: 'POST', path: `/storage/v1/object/fotos-productos/hack-${Date.now()}.txt`, raw: { tipo: 'text/plain', base64: btoa('hack') }, sinToken: true });
    expect(anonSube.status).toBeGreaterThanOrEqual(400);
    // El comprobante sigue intacto.
    expect((await http(S.A.s.page, S.A.s.box, { path: `/storage/v1/object/authenticated/${bucket}/${archivo}` })).status).toBe(200);
  });

  test('Citas por rol: personal lee y modifica (regla existente), borrar la cita es solo ADMIN; CLIENTE solo lee las suyas', async ({ browser }) => {
    test.setTimeout(150_000);
    const cita = S.A.cita;
    for (const rol of ['CAJERA', 'ASISTENTE']) {
      const s = await sesion(browser, S.data, rol);
      try {
        const lectura = await rest(s.page, s.box, 'GET', `citas?id=eq.${cita}&select=id,nota`);
        expect(lectura.json, `${rol} lee todas las citas`).toHaveLength(1);
        const edita = await rest(s.page, s.box, 'PATCH', `citas?id=eq.${cita}`, { nota: `${S.data.prefix} editada por ${rol}` });
        expect(edita.json, `${rol} modifica citas (regla existente)`).toHaveLength(1);
        expect(sinEfecto(await rest(s.page, s.box, 'DELETE', `citas?id=eq.${cita}`)), `${rol}: borrar cita (solo ADMIN)`).toBeTruthy();
      } finally { await s.ctx.close(); }
    }
    expect(await leerAdmin(`citas?id=eq.${cita}&select=id`), 'la cita sigue existiendo').toHaveLength(1);
    // CLIENTE: solo lectura propia; sin escritura directa (se hace por RPC).
    const { page, box } = S.A.s;
    expect((await rest(page, box, 'GET', `citas?id=eq.${cita}&select=id`)).json).toHaveLength(1);
    expect(sinEfecto(await rest(page, box, 'PATCH', `citas?id=eq.${cita}`, { estado: 'CANCELADA' }))).toBeTruthy();
    expect(sinEfecto(await rest(page, box, 'DELETE', `citas?id=eq.${cita}`))).toBeTruthy();
    expect(sinEfecto(await rest(page, box, 'PATCH', `cita_servicios?cita_id=eq.${cita}`, { precio: 0 }))).toBeTruthy();
    expect((await rest(page, box, 'POST', 'citas', { cliente_id: S.A.cliente, fecha_hora: new Date().toISOString() })).status).toBeGreaterThanOrEqual(400);
    const despues = await leerAdmin(`citas?id=eq.${cita}&select=estado`);
    expect(despues[0].estado, 'el estado de la cita no cambió').toBe(S.base.A.citas[0].estado);
    S.base.A = await snapshotCliente(S.A); // la nota quedó editada por el personal (acción autorizada)
  });

  test('Cupones: ningún rol los escribe directamente; lectura propia o de todo el personal', async ({ browser }) => {
    test.setTimeout(150_000);
    const cupon = S.base.B.cupones[0];
    for (const rol of ['CAJERA', 'ASISTENTE']) {
      const s = await sesion(browser, S.data, rol);
      try {
        expect((await rest(s.page, s.box, 'GET', `cupones?id=eq.${cupon.id}&select=id`)).json, `${rol} lee cupones (regla existente)`).toHaveLength(1);
        expect(sinEfecto(await rest(s.page, s.box, 'PATCH', `cupones?id=eq.${cupon.id}`, { estado: 'DISPONIBLE', valor: 999 })), `${rol}: PATCH cupones`).toBeTruthy();
        expect(sinEfecto(await rest(s.page, s.box, 'DELETE', `cupones?id=eq.${cupon.id}`)), `${rol}: DELETE cupones`).toBeTruthy();
        expect((await rest(s.page, s.box, 'POST', 'cupones', { cliente_id: S.A.cliente, codigo: 'HACK01', origen: 'PROMOCION', valor: 500 })).status, `${rol}: POST cupones`).toBeGreaterThanOrEqual(400);
      } finally { await s.ctx.close(); }
    }
    // La dueña no puede cambiar el estado ni el valor de su cupón, ni crear uno.
    const { page, box } = S.B.s;
    expect(sinEfecto(await rest(page, box, 'PATCH', `cupones?id=eq.${cupon.id}`, { estado: 'DISPONIBLE', valor: 999 }))).toBeTruthy();
    expect((await rest(page, box, 'POST', 'cupones', { cliente_id: S.B.cliente, codigo: 'HACK02', origen: 'PROMOCION', valor: 500 })).status).toBeGreaterThanOrEqual(400);
    expect(await leerAdmin(`cupones?cliente_id=eq.${S.B.cliente}&select=id,estado,valor,codigo&order=id`)).toEqual(S.base.B.cupones);
    expect(await leerAdmin(`cupones?codigo=in.(HACK01,HACK02)&select=id`)).toEqual([]);
  });

  test('Reseñas: las aprobadas son públicas y las pendientes solo de su dueña y ADMIN (productos, servicios y general)', async ({ browser }) => {
    test.setTimeout(150_000);
    // RPC públicas: solo APROBADAS (B), nunca las pendientes de A.
    const a = S.A.s;
    const pub = await rest(a.page, a.box, 'POST', 'rpc/resenas_producto_publicas', { p_producto_id: S.producto.productId });
    expect(pub.json.map((r) => r.comentario), 'lista pública de producto: solo la aprobada de B').toEqual([`${S.data.prefix} AUTZ reseña B producto`]);
    const pubS = await rest(a.page, a.box, 'POST', 'rpc/resenas_servicio_publicas', { p_servicio_id: S.servicio.serviceId });
    expect(pubS.json.map((r) => r.comentario)).toEqual([`${S.data.prefix} AUTZ reseña B servicio`]);
    const resumen = await rest(a.page, a.box, 'POST', 'rpc/resenas_producto_resumen', { p_producto_id: S.producto.productId });
    expect(Number(Array.isArray(resumen.json) ? resumen.json[0].total : resumen.json.total), 'el resumen cuenta solo las aprobadas').toBe(1);
    // ADMIN ve las dos; CAJERA/ASISTENTE solo las aprobadas (regla existente de la política).
    const todas = (await leerAdmin(`resenas_producto?producto_id=eq.${S.producto.productId}&select=estado&order=estado`)).map((r) => r.estado);
    expect(todas).toEqual(['APROBADA', 'PENDIENTE']);
    for (const rol of ['CAJERA', 'ASISTENTE']) {
      const s = await sesion(browser, S.data, rol);
      try {
        for (const tabla of ['resenas_producto', 'resenas_servicio', 'resenas']) {
          const filas = (await rest(s.page, s.box, 'GET', `${tabla}?select=estado&limit=500`)).json;
          expect(filas.every((r) => r.estado === 'APROBADA'), `${rol}: ${tabla} solo aprobadas`).toBeTruthy();
          expect(sinEfecto(await rest(s.page, s.box, 'PATCH', `${tabla}?cliente_id=eq.${S.A.cliente}`, { estado: 'APROBADA' })), `${rol}: aprobar reseñas`).toBeTruthy();
        }
      } finally { await s.ctx.close(); }
    }
    // Sin sesión: ninguna reseña.
    const anon = await rest(a.page, a.box, 'GET', 'resenas_producto?select=id&limit=5', undefined, { sinToken: true });
    expect(sinEfecto(anon)).toBeTruthy();
    expect(await leerAdmin(`resenas_producto?cliente_id=eq.${S.A.cliente}&select=estado`)).toEqual([{ estado: 'PENDIENTE' }]);
  });

  test('Cupones: ni ADMIN escribe directamente (sin políticas de escritura); solo las RPC cambian su estado', async () => {
    const { page, box } = S.admin;
    const cupon = S.base.B.cupones[0];
    const intentos = [
      await rest(page, box, 'PATCH', `cupones?id=eq.${cupon.id}`, { estado: 'ANULADO', valor: 1 }),
      await rest(page, box, 'DELETE', `cupones?id=eq.${cupon.id}`),
    ];
    for (const r of intentos) expect(sinEfecto(r), 'ADMIN: escritura directa de cupones').toBeTruthy();
    expect((await rest(page, box, 'POST', 'cupones', { cliente_id: S.B.cliente, codigo: 'HACK03', origen: 'PROMOCION', valor: 500 })).status, 'ADMIN: POST cupones').toBeGreaterThanOrEqual(400);
    expect(await leerAdmin(`cupones?cliente_id=eq.${S.B.cliente}&select=id,estado,valor,codigo&order=id`)).toEqual(S.base.B.cupones);
    expect(await leerAdmin('cupones?codigo=eq.HACK03&select=id')).toEqual([]);
  });

  test('Líneas de cita (cita_servicios): personal y ADMIN las gestionan (regla existente); CLIENTE y sin sesión no; sin cambios fuera de lo autorizado', async ({ browser }) => {
    test.setTimeout(180_000);
    const { page, box } = S.admin;
    // Cita propia de esta prueba (para no tocar las de A y B).
    const crea = await rest(page, box, 'POST', 'rpc/guardar_cita_pos', {
      p_cita_id: null, p_cliente_id: S.clienteStaff, p_cliente_nombre_referencia: null, p_asistente_id: null,
      p_fecha_hora: new Date(Date.now() + 5 * 864e5).toISOString(), p_nota: `${S.data.prefix} AUTZ líneas`, p_adelanto: null,
      p_servicios: [{ servicio_id: S.servicio.serviceId, duracion_min: 30, precio: 2 }],
    });
    expect(crea.status).toBeLessThan(300);
    const citaId = crea.json;
    const lineas = async () => leerAdmin(`cita_servicios?cita_id=eq.${citaId}&select=id,precio,duracion_min&order=id`);
    const base = await lineas();
    expect(base).toHaveLength(1);
    for (const rol of ['CAJERA', 'ASISTENTE']) {
      const s = await sesion(browser, S.data, rol);
      try {
        const alta = await rest(s.page, s.box, 'POST', 'cita_servicios', { cita_id: citaId, servicio_id: S.servicio.serviceId, duracion_min: 15, precio: 3 });
        expect(alta.status, `${rol}: alta de línea (regla existente: todo el personal)`).toBeLessThan(300);
        const edit = await rest(s.page, s.box, 'PATCH', `cita_servicios?id=eq.${alta.json[0].id}`, { precio: 4 });
        expect(edit.json, `${rol}: edita su línea`).toHaveLength(1);
        const baja = await rest(s.page, s.box, 'DELETE', `cita_servicios?id=eq.${alta.json[0].id}`);
        expect(baja.json, `${rol}: borra su línea`).toHaveLength(1);
        expect(await lineas(), 'la línea original no cambió').toEqual(base);
      } finally { await s.ctx.close(); }
    }
    // ADMIN también (control positivo).
    const altaA = await rest(page, box, 'POST', 'cita_servicios', { cita_id: citaId, servicio_id: S.servicio.serviceId, duracion_min: 10, precio: 1 });
    expect(altaA.status).toBeLessThan(300);
    expect((await rest(page, box, 'DELETE', `cita_servicios?id=eq.${altaA.json[0].id}`)).json).toHaveLength(1);
    // CLIENTE (dueña de otra cita) y sin sesión: ninguna escritura sobre estas líneas ni sobre las suyas.
    const c = S.A.s;
    expect((await rest(c.page, c.box, 'POST', 'cita_servicios', { cita_id: citaId, servicio_id: S.servicio.serviceId, duracion_min: 15, precio: 0 })).status).toBeGreaterThanOrEqual(400);
    expect((await rest(c.page, c.box, 'POST', 'cita_servicios', { cita_id: S.A.cita, servicio_id: S.servicio.serviceId, duracion_min: 15, precio: 0 })).status, 'ni siquiera en su propia cita').toBeGreaterThanOrEqual(400);
    for (const id of [citaId, S.A.cita]) {
      expect(sinEfecto(await rest(c.page, c.box, 'PATCH', `cita_servicios?cita_id=eq.${id}`, { precio: 0 }))).toBeTruthy();
      expect(sinEfecto(await rest(c.page, c.box, 'DELETE', `cita_servicios?cita_id=eq.${id}`))).toBeTruthy();
    }
    expect(sinEfecto(await rest(c.page, c.box, 'DELETE', `cita_servicios?cita_id=eq.${citaId}`, undefined, { sinToken: true }))).toBeTruthy();
    expect(await lineas()).toEqual(base);
    expect((await snapshotCliente(S.A)).lineas).toEqual(S.base.A.lineas);
  });

  test('Diagnósticos sanitizados por contexto: sin errores 5xx ni excepciones de página, y sin secretos en lo archivado', async ({}, info) => {
    const resumen = S.diag.map((d) => ({ contexto: d.contexto, consola: [...new Set(d.consola)].slice(0, 20), red: d.red }));
    const texto = JSON.stringify(resumen, null, 2);
    await info.attach('diagnosticos-sanitizados', { body: Buffer.from(texto), contentType: 'application/json' });
    expect(texto, 'no se archivan tokens').not.toMatch(/eyJ[\w-]{10,}\.[\w-]{10,}\./);
    expect(texto, 'no se archivan URLs firmadas').not.toMatch(/token=|\/object\/sign\/[^"]*\?/);
    expect(resumen.length, 'hay diagnósticos de varios contextos').toBeGreaterThan(5);
    for (const d of resumen) {
      expect(Object.keys(d.red).filter((k) => /\s5\d\d$/.test(k)), `${d.contexto}: respuestas 5xx`).toEqual([]);
      expect(d.consola.filter((m) => m.startsWith('pageerror')), `${d.contexto}: excepciones de página`).toEqual([]);
    }
  });
});
