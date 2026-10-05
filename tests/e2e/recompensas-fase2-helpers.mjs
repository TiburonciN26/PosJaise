// Arnés de pruebas SQL de Recompensas Fase 2 (solo Supabase Local TEST).
// Ejecuta SQL dentro del contenedor de la BD local con psql. No usa claves,
// contraseñas ni tokens: las identidades se simulan con request.jwt.claims.
// Los datos creados son ficticios, llevan el prefijo "TEST F2" y se conservan
// (política del README de la suite); no hay limpieza masiva.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const CONTENEDOR = 'supabase_db_WedJaiseReact';

// Cuentas QA ficticias que ya existen en el Local (roles reales del esquema).
export const ADMIN = 'f73eb105-8427-47e1-be5a-7078250df55c';
export const CAJERA = 'b6e3a07a-c785-41c1-8c30-2b0ec7de5978';
export const ASISTENTE = '6fdc4f66-68ee-4429-924a-879318416f3b';

export const runId = Date.now().toString(36);

function ejecutar(sql) {
  return new Promise(resolve => {
    const p = spawn('docker', ['exec', '-i', CONTENEDOR, 'psql', '-U', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-At', '-q'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => resolve({ ok: false, out: '', err: String(e && e.message ? e.message : e) }));
    p.on('close', code => resolve({ ok: code === 0, out: out.trim(), err: err.trim() }));
    p.stdin.end(sql);
  });
}

const primeraLinea = (t) => String(t || '').split(String.fromCharCode(10))[0].trim() || 'sin mensaje';

// Verificación positiva de que la BD es el TEST local: solo cuentas @test.local
// y la URL de la app servida por Vite es 127.0.0.1:54321.
export async function verificarLocalTest() {
  const rama = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
  if (rama !== 'testing') throw new Error('Se requiere la rama testing; no se ejecuta nada.');
  const r = await fetch('http://localhost:5173/src/lib/supabase.js', { redirect: 'error' });
  const texto = await r.text();
  const url = texto.match(/"VITE_SUPABASE_URL"\s*:\s*"([^"]+)"/)?.[1];
  if (url !== 'http://127.0.0.1:54321') throw new Error('La app no apunta a Supabase Local; se aborta.');
  // Dos fallos DISTINTOS, ambos abortan sin escribir nada:
  //  1) No se pudo consultar la BD (Docker/psql caído, contenedor ausente): la verificación no es posible.
  //  2) La consulta respondió y hay cuentas no @test.local: la BD NO es el TEST local.
  const e = await ejecutar(`select count(*) from auth.users where email not like '%@test.local';`);
  interpretarVerificacion(e);
}

// Interpreta el resultado del conteo de cuentas no ficticias. Los dos fallos son distintos y ambos abortan.
export function interpretarVerificacion(e) {
  if (!e.ok) {
    throw new Error(
      `No se pudo verificar la base local (Docker/psql no disponible o contenedor ${CONTENEDOR} ausente); se aborta sin escribir. Detalle: ${primeraLinea(e.err)}`,
    );
  }
  if (!/^\d+$/.test(e.out)) {
    throw new Error(`Respuesta inesperada al verificar la base local («${e.out.slice(0, 40)}»); se aborta sin escribir.`);
  }
  if (e.out !== '0') {
    throw new Error(`La base contiene ${e.out} cuenta(s) que no son @test.local: no es el TEST local; se aborta sin escribir.`);
  }
}

export function como(uid, { rol = false } = {}) {
  const claims = JSON.stringify({ sub: uid, role: 'authenticated' });
  return `select set_config('request.jwt.claims', $c$${claims}$c$, false) \\g /dev/null\n` +
    (rol ? 'set role authenticated;\n' : '');
}

// Ejecuta una sentencia SQL como un usuario. Devuelve {ok, out, err}.
export async function paso(uid, sql, opciones) {
  return ejecutar(como(uid, opciones) + sql);
}
export async function admin(sql) { return ejecutar(sql); }

// Limpieza de un aporte artificial de la apertura creado por UNA prueba. Solo toca la fila identificada por su clienta y su
// atención (uuid validados: nada de filtros amplios), comprueba que el DELETE funcionó y que no queda residuo, y conserva TODAS
// las causas: si la prueba falla y la limpieza también, el error final lleva ambas (AggregateError, con ambos mensajes).
// `ejecutor` es el que ejecuta SQL (por defecto `admin`); se inyecta en las pruebas en memoria.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function limpiarAporteAtencion({ clienteId, atencionId }, ejecutor = admin) {
  if (!UUID.test(String(clienteId)) || !UUID.test(String(atencionId))) {
    throw new Error(`Limpieza del aporte rechazada: identificadores no válidos (clienta «${clienteId}», atención «${atencionId}»).`);
  }
  const filtro = `cliente_id = '${clienteId}' and registro_servicio_id = '${atencionId}'`;
  const d = await ejecutor(`delete from public.recompensas_apertura_aportes where ${filtro};`);
  if (!d || d.ok !== true) throw new Error(`Falló el DELETE de limpieza del aporte: ${primeraLinea(d && d.err)}`);
  const v = await ejecutor(`select count(*) from public.recompensas_apertura_aportes where ${filtro};`);
  if (!v || v.ok !== true) throw new Error(`No se pudo verificar la limpieza del aporte: ${primeraLinea(v && v.err)}`);
  if (v.out !== '0') throw new Error(`Quedó ${v.out === '' ? 'un resultado vacío' : `${v.out} aporte(s) residual(es)`} de la clienta ${clienteId} y la atención ${atencionId} tras la limpieza.`);
}

// Ejecuta `cuerpo` y SIEMPRE limpia el aporte propio después. Relanza el error de la prueba, el de la limpieza o ambos.
export async function conAporteLimpiado(ids, cuerpo, ejecutor = admin) {
  let fallo = null;
  try { await cuerpo(); } catch (e) { fallo = e; }
  let falloLimpieza = null;
  try { await limpiarAporteAtencion(ids, ejecutor); } catch (e) { falloLimpieza = e; }
  if (fallo && falloLimpieza) {
    throw new AggregateError([fallo, falloLimpieza],
      `Fallaron la prueba Y la limpieza del aporte. Prueba: ${fallo.message} | Limpieza: ${falloLimpieza.message}`);
  }
  if (fallo) throw fallo;
  if (falloLimpieza) throw falloLimpieza;
}

export async function json(sql) {
  const r = await ejecutar(sql);
  if (!r.ok) throw new Error(r.err);
  const linea = r.out.split('\n').filter(Boolean).pop();
  return linea ? JSON.parse(linea) : null;
}

export const q = s => `$q$${s}$q$`;

// --------------------------- Fixtures ---------------------------------
export async function nuevaClienta({ vinculada = true } = {}) {
  const uid = randomUUID();
  const clienteId = randomUUID();
  const tag = `${runId}-${uid.slice(0, 6)}`;
  let sql = '';
  if (vinculada) {
    sql += `insert into auth.users (id, email) values ('${uid}', 'f2-${tag}@test.local');
            insert into public.clientes_web (id, email) values ('${uid}', 'f2-${tag}@test.local');`;
  }
  sql += `insert into public.clientes (id, nombre, cliente_web_id)
          values ('${clienteId}', 'TEST F2 ${tag}', ${vinculada ? `'${uid}'` : 'null'});`;
  const r = await ejecutar(sql);
  if (!r.ok) throw new Error(r.err);
  return { uid, clienteId };
}

// Nombre único por fixture: dentro de un mismo proceso (contador) y entre procesos (sufijo aleatorio).
// Nunca se resuelve una ambigüedad con first(): cada ficha creada tiene un nombre que ninguna otra tiene.
let contadorFixtures = 0;
export function nombreUnico(prefijo) {
  contadorFixtures += 1;
  // Separadores fijos: ningún nombre es prefijo de otro (los selectores buscan por subcadena).
  return `${prefijo} ${runId}-${contadorFixtures}-${Math.random().toString(36).padEnd(5, '0').slice(2, 5)}`;
}

// `extra`: { duracion_min } cuando el caso necesita minutos en la línea de la cita (por omisión queda sin
// duración, como antes); { activo: false } etc. pasan tal cual a las columnas indicadas.
export async function nuevoServicio(precio, proteccion, extra = {}) {
  const id = randomUUID();
  const nombre = nombreUnico('TEST F2 serv');
  const duracion = extra.duracion_min == null ? 'null' : Number(extra.duracion_min);
  let sql = `insert into public.servicios (id, nombre, precio, duracion_min) values ('${id}', '${nombre}', ${precio}, ${duracion});`;
  if (proteccion) {
    // `asistentePct` = porcentaje protegido (nuevo); `asistente` = importe fijo antiguo (S/). Sin ninguno, queda como antes.
    sql += `insert into public.servicios_proteccion (servicio_id, materiales, asistente, otros, asistente_pct)
            values ('${id}', ${proteccion.materiales ?? 0}, ${proteccion.asistente ?? 0}, ${proteccion.otros ?? 0},
                    ${proteccion.asistentePct ?? 'null'});`;
  }
  const r = await ejecutar(sql);
  if (!r.ok) throw new Error(r.err);
  return id;
}

// Costo de compra del fixture: `extra.costo` o, por omisión, S1 (10 % del precio si el precio es menor a S10, para que la
// protección de productos baratos no iguale su precio). Con la protección económica, un costo 0 sin confirmar es DESCONOCIDO
// y bloquea cupones; por eso, si el costo resultante es 0, se confirma explícitamente (productos_proteccion.costo_confirmado).
// `extra.transporte` / `extra.otros` / `extra.confirmado` configuran el resto de la protección del producto.
export async function nuevoProducto(precio, stock = 10, extra = {}) {
  const id = randomUUID();
  const nombre = nombreUnico('TEST F2 prod');
  const codigo = extra.codigo_barras ? `'${extra.codigo_barras}'` : 'null';
  const costo = extra.costo ?? Math.min(1, Math.round(Number(precio) * 10) / 100);
  let sql = `insert into public.productos (id, nombre, precio, costo, stock_actual, codigo_barras)
    values ('${id}', '${nombre}', ${precio}, ${costo}, ${stock}, ${codigo});`;
  if (extra.transporte != null || extra.otros != null || extra.confirmado || Number(costo) === 0) {
    sql += `insert into public.productos_proteccion (producto_id, transporte, otros, costo_confirmado)
      values ('${id}', ${extra.transporte ?? 0}, ${extra.otros ?? 0}, ${extra.confirmado ?? Number(costo) === 0});`;
  }
  const r = await ejecutar(sql);
  if (!r.ok) throw new Error(r.err);
  return id;
}

// La atención se atribuye al ADMINISTRADOR (dueño: 100 %): no hace falta configurar
// porcentajes ni se toca ninguna regla de comisión.
export async function nuevaAtencion(clienteId, servicioId, precio, fecha = 'now()') {
  const id = randomUUID();
  const r = await ejecutar(`insert into public.registro_servicios
    (id, usuario_id, servicio_id, cliente_id, precio, fecha, estado)
    values ('${id}', '${ADMIN}', '${servicioId}', '${clienteId}', ${precio}, ${fecha}, 'ACTIVO');`);
  if (!r.ok) throw new Error(r.err);
  return id;
}

export async function nuevoCupon(clienteId, c = {}) {
  const id = randomUUID();
  const codigo = ('F2' + id.replace(/-/g, '').slice(0, 6)).toUpperCase();
  const r = await ejecutar(`insert into public.cupones
    (id, cliente_id, codigo, origen, valor, tipo_descuento, alcance, minimo_compra, tope,
     nivel_minimo, servicio_id, vigente_hasta)
    values ('${id}', '${clienteId}', '${codigo}', 'PROMOCION', ${c.valor ?? 10},
            '${c.tipo ?? 'MONTO_FIJO'}', '${c.alcance ?? 'TODO'}',
            ${c.minimo ?? 'null'}, ${c.tope ?? 'null'}, '${c.nivel ?? 'BASICO'}',
            ${c.servicioId ? `'${c.servicioId}'` : 'null'},
            ${c.vigenteHasta ? `'${c.vigenteHasta}'` : 'null'});`);
  if (!r.ok) throw new Error(r.err);
  return { id, codigo };
}

export async function nuevoPremio(p = {}) {
  const id = randomUUID();
  const r = await ejecutar(`insert into public.recompensas_catalogo
    (id, nombre, activo, origen, tipo, valor, servicio_id, alcance, nivel_minimo,
     costo_basico, costo_premium, costo_vip, cupo_global, limite_por_clienta,
     reclamo_desde, reclamo_hasta, cupon_vigencia_dias, cupon_vence_el)
    values ('${id}', 'TEST F2 premio ${runId}', ${p.activo ?? true}, '${p.origen ?? 'MONEDAS'}',
      '${p.tipo ?? 'MONTO'}', ${p.valor ?? 5}, ${p.servicioId ? `'${p.servicioId}'` : 'null'},
      '${p.alcance ?? 'TODO'}', '${p.nivelMinimo ?? 'BASICO'}',
      ${p.costoBasico === undefined ? ((p.origen ?? 'MONEDAS') === 'SELLOS' ? 'null' : 25) : (p.costoBasico ?? 'null')},
      ${p.costoPremium ?? 'null'}, ${p.costoVip ?? 'null'}, ${p.cupo ?? 'null'}, ${p.limiteCliente ?? 'null'},
      ${p.reclamoDesde ? `'${p.reclamoDesde}'` : 'null'}, ${p.reclamoHasta ? `'${p.reclamoHasta}'` : 'null'},
      ${p.vigenciaDias ?? 'null'}, ${p.venceEl ? `'${p.venceEl}'` : 'null'});`);
  if (!r.ok) throw new Error(r.err);
  return id;
}

// Movimientos de fixture (equivalente a un saldo previo ya acreditado).
export async function darMonedas(clienteId, monedas, clasificacion = monedas) {
  const r = await ejecutar(`insert into public.recompensas_movimientos
    (cliente_id, tipo, monedas, clasificacion, clave)
    values ('${clienteId}', 'AJUSTE', ${monedas}, ${clasificacion}, 'fixture:${randomUUID()}');`);
  if (!r.ok) throw new Error(r.err);
}
export async function darSellos(clienteId, n) {
  const r = await ejecutar(`insert into public.recompensas_sellos_movs
    (cliente_id, tipo, delta, clave) values ('${clienteId}', 'APERTURA', ${n}, 'fixture:${randomUUID()}');`);
  if (!r.ok) throw new Error(r.err);
}

// --------------------------- Operaciones -------------------------------
export function itemsJson(items) { return JSON.stringify(items); }

export async function vender({ uid = CAJERA, clienteId = null, items, cupon = null, pct = 0, monto = 0, delivery = 0 }) {
  const r = await paso(uid, `select row_to_json(t) from public.confirmar_venta('Yape', null,
      $j$${itemsJson(items)}$j$::jsonb, ${clienteId ? `'${clienteId}'::uuid` : 'null'},
      ${pct}, ${monto}, null, ${cupon ? `'${cupon}'` : 'null'}, ${delivery}) t;`);
  if (!r.ok) return { ok: false, err: r.err };
  return { ok: true, venta: JSON.parse(r.out.split('\n').filter(Boolean).pop()) };
}
export const anular = (ventaId, uid = ADMIN) => paso(uid, `select public.anular_venta('${ventaId}');`);

export const itemServicio = registroId => ({ tipo: 'SERVICIO', registro_servicio_id: registroId, cantidad: 1 });
export const itemProducto = (productoId, cantidad = 1) => ({ tipo: 'PRODUCTO', producto_id: productoId, cantidad });

export const saldos = clienteId =>
  json(`select row_to_json(s) from public.recompensas_saldos('${clienteId}') s;`);
export const estadoCupon = id =>
  json(`select row_to_json(c) from (select estado, venta_id, vigente_hasta from public.cupones where id='${id}') c;`);
export const stock = id => json(`select to_json(stock_actual) from public.productos where id='${id}';`);
export const num = x => Number(x);

export async function configActual() {
  return json(`select row_to_json(c) from public.recompensas_config c where id=1;`);
}
export async function activar(activo) {
  const r = await paso(ADMIN, `select public.recompensas_establecer_activo(${activo});`);
  if (!r.ok) throw new Error(r.err);
}
export async function restaurarConfig(c) {
  const r = await admin(`update public.recompensas_config set activo=${c.activo}, corte=${c.corte ? `'${c.corte}'` : 'null'},
    tasa_serv_monedas=${c.tasa_serv_monedas}, tasa_serv_soles=${c.tasa_serv_soles},
    tasa_prod_monedas=${c.tasa_prod_monedas}, tasa_prod_soles=${c.tasa_prod_soles},
    umbral_premium=${c.umbral_premium}, umbral_vip=${c.umbral_vip} where id=1;`);
  if (!r.ok) throw new Error(r.err);
}

// --------------------------- Pedido web (carrito de la clienta) ---------------------------
// Las llamadas SQL simulan la identidad con request.jwt.claims (capa SQL, NO E2E con sesión real).
export async function ponerEnCarrito(uid, productoId, cantidad) {
  const r = await ejecutar(`insert into public.carrito_productos (cliente_web_id, producto_id, cantidad)
    values ('${uid}', '${productoId}', ${cantidad})
    on conflict (cliente_web_id, producto_id) do update set cantidad = excluded.cantidad;`);
  if (!r.ok) throw new Error(r.err);
}
export async function diaEntregaValido() {
  return json(`select to_json(d::text) from (select ((now() at time zone 'America/Lima')::date + g) d from generate_series(1,7) g
    where (select dias_atencion from public.estado_negocio where id=1) @> array[extract(isodow from ((now() at time zone 'America/Lima')::date + g))::int]
    order by g limit 1) x;`);
}
export async function vistaPreviaCupon(uid, codigo, productoIds, cantidades = null) {
  const r = await paso(uid, `select row_to_json(t) from public.vista_previa_cupon_pedido(${codigo ? `'${codigo}'` : 'null'}, array[${productoIds.map(i => `'${i}'`).join(',')}]::uuid[], ${cantidades ? `$j$${JSON.stringify(cantidades)}$j$::jsonb` : 'null'}) t;`, { rol: true });
  if (!r.ok) return { ok: false, err: r.err };
  return { ok: true, fila: JSON.parse(r.out.split('\n').filter(Boolean).pop()) };
}
// `cantidades` ([{producto_id, cantidad}]) y `total` son lo que la clienta confirmó (QA-057); omitidos = sin comprobación.
export async function crearPedido(uid, productoIds, codigo, { entrega = 'RECOJO_TIENDA', cantidades = null, total = null } = {}) {
  const dia = await diaEntregaValido();
  const r = await paso(uid, `select public.confirmar_pedido_productos(array[${productoIds.map(i => `'${i}'`).join(',')}]::uuid[], '${entrega}',
    '${dia}', '10:00', 'YAPE', 'ficticio/comprobante.jpg', null, null, null, ${codigo ? `'${codigo}'` : 'null'}, 'BOLETA', null, null,
    ${cantidades ? `$j$${JSON.stringify(cantidades)}$j$::jsonb` : 'null'}, ${total == null ? 'null' : total});`, { rol: true });
  if (!r.ok) return { ok: false, err: r.err };
  return { ok: true, pedidoId: r.out.split('\n').filter(Boolean).pop() };
}
export const verificarPagoPedido = (pedidoId, uid = ADMIN) =>
  paso(uid, `select public.verificar_pago_pedido_web('${pedidoId}');`, { rol: true });
