// Fase 7 · medición de las consultas reales de las Fases 4 y 5 bajo los roles que las ejecutan (Supabase LOCAL).
//
// TODO ocurre dentro de UNA transacción que termina en ROLLBACK: la siembra de volumen, los índices candidatos y la migración
// bajo prueba desaparecen al final y la base local queda como estaba (el script lo comprueba contando filas antes y después).
// Cada consulta reproduce la forma que genera PostgREST (capturada de pg_stat_statements): página con LIMIT/OFFSET + `count(*)`
// exacto del filtro completo, ejecutada con `set local role` y los claims JWT del rol, de modo que RLS actúa igual que en la app.
//
// Uso:
//   node scripts/medir-fase7.cjs --escala=actual|ampliada [--migracion=ruta.sql] [--salida=ruta.json] [--reps=5] [--solo=Q01,Q02]
// Sin --migracion solo mide el «antes». Con --migracion mide «antes», aplica el archivo (sin su begin/commit) y mide «después».
const { execFileSync } = require('node:child_process')
const { readFileSync, writeFileSync } = require('node:fs')

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d ?? ''}`).split('=').slice(1).join('=')
const ESCALA = arg('escala', 'actual')
const MIGRACIONES = arg('migracion', '').split(',').filter(Boolean) // varias: cada una se aplica encima de la anterior y se mide por separado
const MIGRACION = MIGRACIONES.join(',')
const SALIDA = arg('salida', '')
const REPS = Number(arg('reps', '5'))
const SOLO = arg('solo', '').split(',').filter(Boolean)

// ---- la pila debe ser la de WedJaiseReact (no la de ensayo) ----
const puertos = execFileSync('docker', ['ps', '--filter', 'name=^supabase_kong_WedJaiseReact$', '--format', '{{.Ports}}'], { encoding: 'utf8' })
if (!/:54321->8000\/tcp/.test(puertos)) throw new Error('54321 no es la pila WedJaiseReact: no se mide')

const psql = (sql) =>
  execFileSync('docker', ['exec', '-i', 'supabase_db_WedJaiseReact', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], {
    input: sql, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024,
  })

const { AMPLIADA, siembra } = require('./lib/volumen-fase7.cjs')
const { pedidosLista, envolver, lineaBase } = require('./lib/consultas-fase7.cjs')

// ---- escenarios: [id, descripción, roles, fuente (página), cuenta (count(*) del filtro completo, o null)] ----
const ESCENARIOS = [
  // ---------- Fase 5 · administración ----------
  { id: 'Q01', d: 'Pedidos Web · primera página (sin filtro)', roles: ['admin', 'cajera'], ...pedidosLista() },
  { id: 'Q02', d: 'Pedidos Web · estado PENDIENTE', roles: ['admin'], ...pedidosLista({ estado: 'PENDIENTE' }) },
  { id: 'Q03', d: 'Pedidos Web · búsqueda de clienta (término más frecuente) + estado ENTREGADO', roles: ['admin'], ...pedidosLista({ estado: 'ENTREGADO', termino: ":'termino_q03'" }) },
  { id: 'Q04', d: 'Pedidos Web · conteo exacto por estado (head)', roles: ['admin'], fuente: `select p.id from public.pedidos_web p where p.estado = 'LISTO' limit 1 offset 0`, cuenta: `select 1 from public.pedidos_web p where p.estado = 'LISTO'` },
  { id: 'Q05', d: 'Pedidos Web · ítems de un pedido', roles: ['admin'], fuente: `select i.id, i.nombre_producto, i.cantidad, i.precio_unitario, i.subtotal from public.pedidos_web_items i where i.pedido_id = :'pedido_x' order by i.id limit 100 offset 0`, cuenta: `select 1 from public.pedidos_web_items i where i.pedido_id = :'pedido_x'` },
  { id: 'Q06', d: 'Promociones · primera página', roles: ['admin'], fuente: `select id, titulo, descripcion, tipo_descuento, valor, vigente_desde, vigente_hasta, activo from public.promociones order by creado_en desc, id desc limit 40 offset 0`, cuenta: `select 1 from public.promociones` },
  { id: 'Q07', d: 'Promociones · búsqueda por título', roles: ['admin'], fuente: `select id, titulo, activo from public.promociones where titulo ilike '%verano%' order by creado_en desc, id desc limit 40 offset 0`, cuenta: `select 1 from public.promociones where titulo ilike '%verano%'` },
  { id: 'Q08', d: 'Reseñas · primera página (vista de 3 tablas)', roles: ['admin'], fuente: `select origen, id, calificacion, comentario, estado, creado_en, cliente_nombre, cliente_telefono, item_nombre from public.resenas_moderacion order by creado_en desc, id desc, origen limit 40 offset 0`, cuenta: `select 1 from public.resenas_moderacion` },
  { id: 'Q09', d: 'Reseñas · estado PENDIENTE', roles: ['admin'], fuente: `select origen, id, calificacion, comentario, estado, creado_en, cliente_nombre, cliente_telefono, item_nombre from public.resenas_moderacion where estado = 'PENDIENTE' order by creado_en desc, id desc, origen limit 40 offset 0`, cuenta: `select 1 from public.resenas_moderacion where estado = 'PENDIENTE'` },
  { id: 'Q10', d: 'Reseñas · búsqueda (clienta o ítem)', roles: ['admin'], fuente: `select origen, id, estado, creado_en, cliente_nombre, item_nombre from public.resenas_moderacion where (cliente_nombre ilike '%ana%' or item_nombre ilike '%ana%') order by creado_en desc, id desc, origen limit 40 offset 0`, cuenta: `select 1 from public.resenas_moderacion where (cliente_nombre ilike '%ana%' or item_nombre ilike '%ana%')` },
  { id: 'Q11', d: 'Reseñas · conteo por estado (head)', roles: ['admin'], fuente: `select id from public.resenas_moderacion where estado = 'APROBADA' limit 1 offset 0`, cuenta: `select 1 from public.resenas_moderacion where estado = 'APROBADA'` },
  { id: 'Q12', d: 'Cupones Referidos · primera página', roles: ['admin'], fuente: `select id, codigo, origen, valor, tipo_descuento, estado, creado_en, cliente_nombre from public.cupones_gestion where origen = any (array['REFERIDO_BIENVENIDA','REFERIDO_RECOMPENSA']) order by creado_en desc, id desc limit 40 offset 0`, cuenta: `select 1 from public.cupones_gestion where origen = any (array['REFERIDO_BIENVENIDA','REFERIDO_RECOMPENSA'])` },
  { id: 'Q13', d: 'Cupones Fidelización · estado DISPONIBLE', roles: ['admin'], fuente: `select id, codigo, origen, valor, tipo_descuento, estado, creado_en, cliente_nombre from public.cupones_gestion where origen = any (array['FIDELIZACION']) and estado = 'DISPONIBLE' order by creado_en desc, id desc limit 40 offset 0`, cuenta: `select 1 from public.cupones_gestion where origen = any (array['FIDELIZACION']) and estado = 'DISPONIBLE'` },
  { id: 'Q14', d: 'Cupones · búsqueda código o clienta', roles: ['admin'], fuente: `select id, codigo, origen, estado, creado_en, cliente_nombre from public.cupones_gestion where (codigo_busqueda ilike '%ana%' or cliente_busqueda ilike '%ana%') and origen = any (array['REFERIDO_BIENVENIDA','REFERIDO_RECOMPENSA']) order by creado_en desc, id desc limit 40 offset 0`, cuenta: `select 1 from public.cupones_gestion where (codigo_busqueda ilike '%ana%' or cliente_busqueda ilike '%ana%') and origen = any (array['REFERIDO_BIENVENIDA','REFERIDO_RECOMPENSA'])` },
  { id: 'Q15', d: 'Cupones · conteo por estado (head)', roles: ['admin'], fuente: `select id from public.cupones_gestion where origen = any (array['FIDELIZACION']) and estado = 'CANJEADO' limit 1 offset 0`, cuenta: `select 1 from public.cupones_gestion where origen = any (array['FIDELIZACION']) and estado = 'CANJEADO'` },
  // ---------- Fase 4 · catálogos públicos ----------
  { id: 'Q16', d: 'Productos · búsqueda ilike + orden nombre,id', roles: ['anon', 'cliente'], fuente: `select id, nombre, categoria, precio from public.productos where activo = true and nombre ilike '%shampoo%' order by nombre, id limit 40 offset 0`, cuenta: `select 1 from public.productos where activo = true and nombre ilike '%shampoo%'` },
  { id: 'Q17', d: 'Productos · listado por categoría', roles: ['anon', 'cliente'], fuente: `select id, nombre, categoria, precio from public.productos where activo = true and categoria = :'cat_prod' order by nombre, id limit 40 offset 0`, cuenta: `select 1 from public.productos where activo = true and categoria = :'cat_prod'` },
  { id: 'Q18', d: 'Servicios · listado por categoría', roles: ['anon', 'cliente'], fuente: `select id, nombre, categoria, precio from public.servicios where activo = true and categoria = :'cat_serv' order by nombre, id limit 40 offset 0`, cuenta: `select 1 from public.servicios where activo = true and categoria = :'cat_serv'` },
  { id: 'Q19', d: 'Productos · hero (en_inicio, stock>0)', roles: ['anon'], fuente: `select id, nombre, precio from public.productos where activo = true and stock_actual > 0 and en_inicio = true order by nombre, id limit 8`, cuenta: null },
  { id: 'Q20', d: 'Productos · cinta de ofertas', roles: ['anon'], fuente: `select id, nombre, precio from public.productos where activo = true and stock_actual > 0 and precio_antes is not null and precio_antes > 0 order by nombre, id limit 12`, cuenta: `select 1 from public.productos where activo = true and stock_actual > 0 and precio_antes is not null and precio_antes > 0` },
  { id: 'Q21', d: 'Productos · cinta de destacados', roles: ['anon'], fuente: `select id, nombre, precio from public.productos where activo = true and stock_actual > 0 and destacado = true order by nombre, id limit 12`, cuenta: `select 1 from public.productos where activo = true and stock_actual > 0 and destacado = true` },
  { id: 'Q22', d: 'productos_categorias_publicas()', roles: ['anon', 'cliente'], fuente: `select * from public.productos_categorias_publicas() limit 1000`, cuenta: `select 1 from public.productos_categorias_publicas()` },
  { id: 'Q23', d: 'productos_vitrina_publica(4,0,10)', roles: ['anon', 'cliente'], fuente: `select * from public.productos_vitrina_publica(4, 0, 10)`, cuenta: null },
  { id: 'Q24', d: 'servicios_categorias_publicas()', roles: ['anon', 'cliente'], fuente: `select * from public.servicios_categorias_publicas() limit 1000`, cuenta: `select 1 from public.servicios_categorias_publicas()` },
  { id: 'Q25', d: 'servicios_vitrina_publica(4,30,0,10)', roles: ['anon', 'cliente'], fuente: `select * from public.servicios_vitrina_publica(4, 30, 0, 10)`, cuenta: null },
  // ---------- RLS de la clienta sobre las mismas tablas (Fases 4/5 las exponen a su rol) ----------
  { id: 'Q26', d: 'Clienta · sus pedidos (RLS cliente_id = mi_cliente_id())', roles: ['cliente'], fuente: `select id, estado, total, creado_en from public.pedidos_web order by creado_en desc, id desc limit 40 offset 0`, cuenta: `select 1 from public.pedidos_web` },
  { id: 'Q27', d: 'Clienta · ítems de sus pedidos (RLS con EXISTS)', roles: ['cliente'], fuente: `select id, pedido_id, nombre_producto from public.pedidos_web_items order by id limit 100 offset 0`, cuenta: `select 1 from public.pedidos_web_items` },
  { id: 'Q28', d: 'Clienta · reseñas visibles (aprobadas + propias)', roles: ['cliente'], fuente: `select origen, id, estado, creado_en from public.resenas_moderacion order by creado_en desc, id desc, origen limit 40 offset 0`, cuenta: `select 1 from public.resenas_moderacion` },
  { id: 'Q29', d: 'Clienta · sus cupones (RLS cliente_id = mi_cliente_id())', roles: ['cliente'], fuente: `select id, codigo, estado from public.cupones_gestion order by creado_en desc, id desc limit 40 offset 0`, cuenta: `select 1 from public.cupones_gestion` },
]

const CLAIMS = {
  admin: `json_build_object('sub', :'admin_id', 'role', 'authenticated')`,
  cajera: `json_build_object('sub', :'cajera_id', 'role', 'authenticated')`,
  asistente: `json_build_object('sub', :'asistente_id', 'role', 'authenticated')`,
  cliente: `json_build_object('sub', :'cliente_uid', 'role', 'authenticated')`,
  anon: `json_build_object('role', 'anon')`,
}
const ROL_PG = (r) => (r === 'anon' ? 'anon' : 'authenticated')

function bloqueMedicion(fase) {
  let s = ''
  for (const esc of ESCENARIOS) {
    if (SOLO.length && !SOLO.includes(esc.id)) continue
    for (const rol of esc.roles) {
      const q = envolver(esc)
      for (let i = 0; i <= REPS; i++) {
        s += `\\echo @@@${fase}|${esc.id}|${rol}|${i}\nreset role;\nselect 'LLAMADAS|' || coalesce(sum(calls), 0) from pg_stat_xact_user_functions where funcname in ('es_admin','rol_actual','mi_cliente_id');\n`
        s += `set local role ${ROL_PG(rol)};\nselect set_config('request.jwt.claims', ${CLAIMS[rol]}::text, true);\n`
        s += `explain (analyze, timing off, buffers, summary, format json) ${q};\n`
        s += `reset role;\nselect 'LLAMADAS|' || coalesce(sum(calls), 0) from pg_stat_xact_user_functions where funcname in ('es_admin','rol_actual','mi_cliente_id');\n`
      }
    }
  }
  return s
}

const quitarTransaccion = (sql) => sql.replace(/^\s*begin\s*;\s*$/gim, '').replace(/^\s*commit\s*;\s*$/gim, '')

const CONTEOS = `select 'FILAS|' || (select count(*) from clientes) || ',' || (select count(*) from pedidos_web) || ',' || (select count(*) from cupones) || ',' || (select count(*) from productos) || ',' || (select count(*) from pg_indexes where schemaname='public');`

let guion = `\\set ON_ERROR_STOP on
${CONTEOS}
begin;
set local track_functions = 'all';
set local statement_timeout = '600s';
`
// La línea base va ANTES de sembrar: con los índices reales presentes, la siembra los infla de forma permanente aunque haga ROLLBACK.
guion += lineaBase(arg('rollback', '.codex/evidencia-fase7/rollback-fase7.sql'))
if (ESCALA === 'ampliada') guion += siembra(AMPLIADA)
guion += '' // «antes» = sin la Fase 7, aunque Local ya la tenga aplicada
guion += `
select id as admin_id from usuarios where rol = 'ADMINISTRADOR' and activo order by id limit 1 \\gset
select id as cajera_id from usuarios where rol = 'CAJERA' and activo order by id limit 1 \\gset
select id as asistente_id from usuarios where rol = 'ASISTENTE' and activo order by id limit 1 \\gset
-- clienta con más pedidos propios (rol cliente); un pedido y categorías representativas
select cw.id as cliente_uid from clientes c join clientes_web cw on cw.id = c.cliente_web_id order by (select count(*) from pedidos_web p where p.cliente_id = c.id) desc, c.id limit 1 \\gset
select id as pedido_x from pedidos_web where cliente_id is not null order by creado_en desc limit 1 \\gset
select coalesce((select split_part(c.nombre, ' ', 1) from clientes c join pedidos_web p on p.cliente_id = c.id group by 1 order by count(*) desc, 1 limit 1), 'maria') as termino_q03 \\gset
select 'TERMINO_Q03|' || :'termino_q03' || '|' || (select count(*) from pedidos_web p where p.estado = 'ENTREGADO' and exists (select 1 from clientes c where c.nombre ilike '%' || :'termino_q03' || '%' and c.id = p.cliente_id));
select categoria as cat_prod from productos where activo and categoria is not null group by 1 order by count(*) desc, 1 limit 1 \\gset
select categoria as cat_serv from servicios where activo and categoria is not null group by 1 order by count(*) desc, 1 limit 1 \\gset
select 'VOLUMEN|' || (select count(*) from pedidos_web) || ',' || (select count(*) from pedidos_web_items) || ',' || (select count(*) from cupones) || ',' || (select count(*) from resenas) || ',' || (select count(*) from resenas_producto) || ',' || (select count(*) from resenas_servicio) || ',' || (select count(*) from promociones) || ',' || (select count(*) from productos) || ',' || (select count(*) from servicios) || ',' || (select count(*) from clientes);
select 'PEDIDOS_CLIENTA|' || (select count(*) from pedidos_web p join clientes c on c.id = p.cliente_id where c.cliente_web_id = :'cliente_uid');
${bloqueMedicion('antes')}
`
for (const [k, ruta] of MIGRACIONES.entries()) {
  guion += `\\echo @@@MIGRACION|${k + 1}\n${quitarTransaccion(readFileSync(ruta, 'utf8'))}\nanalyze;\n`
  guion += `select 'INDICES|' || indexrelid::regclass || '|' || pg_relation_size(indexrelid) from pg_index where indexrelid in (select indexrelid from pg_index i join pg_class c on c.oid = i.indrelid where c.relnamespace = 'public'::regnamespace and indexrelid::regclass::text like 'idx_f7_%');\n`
  guion += bloqueMedicion(`despues${k + 1}`)
}
guion += `rollback;\n${CONTEOS}\n`

const t0 = Date.now()
const salida = psql(guion)
const trozos = salida.split('@@@')
const resultados = []
const meta = {}
for (const linea of trozos[0].split('\n')) {
  if (linea.startsWith('FILAS|')) (meta.filas_antes ??= linea.slice(6))
  if (linea.startsWith('VOLUMEN|')) meta.volumen = linea.slice(8)
  if (linea.startsWith('PEDIDOS_CLIENTA|')) meta.pedidos_clienta = Number(linea.slice(16))
}
// Cada trozo: "<fase>|<id>|<rol>|<rep>\n" + [LLAMADAS|n]? + JSON del plan + LLAMADAS|n
for (const trozo of trozos.slice(1)) {
  const nl = trozo.indexOf('\n')
  const cab = trozo.slice(0, nl).trim()
  const cuerpo = trozo.slice(nl + 1)
  if (cab.startsWith('LINEA_BASE')) {
    meta.linea_base = cab.split('|')[1]
    for (const l of cuerpo.split('\n')) {
      if (l.startsWith('TERMINO_Q03|')) meta.termino_q03 = l.slice(12)
      if (l.startsWith('VOLUMEN|')) meta.volumen = l.slice(8)
      if (l.startsWith('PEDIDOS_CLIENTA|')) meta.pedidos_clienta = Number(l.slice(16))
    }
    continue
  }
  if (cab.startsWith('MIGRACION')) {
    for (const l of cuerpo.split('\n')) if (l.startsWith('INDICES|')) (meta.indices ??= []).push(l.slice(8))
    continue
  }
  const [fase, id, rol, rep] = cab.split('|')
  const ini = cuerpo.indexOf('[')
  const fin = cuerpo.lastIndexOf(']')
  const plan = JSON.parse(cuerpo.slice(ini, fin + 1))[0]
  const ll = [...cuerpo.matchAll(/LLAMADAS\|(\d+)/g)].map((m) => Number(m[1]))
  resultados.push({ fase, id, rol, rep: Number(rep), plan, llamadasHelpers: ll.length >= 2 ? ll[1] - ll[0] : null })
}
meta.filas_despues = (/FILAS\|(.*)\s*$/.exec(salida.slice(salida.lastIndexOf('FILAS|'))) ?? [])[1]
meta.filas_antes = (/FILAS\|(.*)/.exec(salida) ?? [])[1]

// ---- resumen: mediana de repeticiones (se descarta la 0, de calentamiento) ----
const mediana = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
function nodos(p, acc = []) { acc.push(p); for (const h of p.Plans ?? []) nodos(h, acc); return acc }
const resumen = {}
for (const r of resultados) {
  const clave = `${r.id}|${r.rol}`
  ;((resumen[clave] ??= { id: r.id, rol: r.rol, fases: {} }).fases[r.fase] ??= []).push(r)
}
const filas = []
for (const v of Object.values(resumen)) {
  const f = (lista) => {
    const med = lista.filter((x) => x.rep > 0)
    if (!med.length) return null
    const ult = med[med.length - 1].plan
    const ns = nodos(ult.Plan)
    const tiempo = mediana(med.map((x) => x.plan['Execution Time']))
    const plani = mediana(med.map((x) => x.plan['Planning Time']))
    const buf = ult.Plan['Shared Hit Blocks'] + ult.Plan['Shared Read Blocks']
    const sec = [...new Set(ns.filter((n) => /Seq Scan/.test(n['Node Type'])).map((n) => n['Relation Name']))]
    const idx = [...new Set(ns.filter((n) => /Index/.test(n['Node Type'])).map((n) => n['Index Name']))]
    const llam = mediana(med.map((x) => x.llamadasHelpers ?? 0))
    return { ms: +tiempo.toFixed(2), helpers: llam, planificacion_ms: +plani.toFixed(2), buffers: buf, seq: sec, idx, filas: ult.Plan['Actual Rows'] }
  }
  const e = ESCENARIOS.find((x) => x.id === v.id)
  filas.push({ id: v.id, d: e.d, rol: v.rol, ...Object.fromEntries(Object.entries(v.fases).map(([k, l]) => [k, f(l)])) })
}
const informe = { escala: ESCALA, reps: REPS, migracion: MIGRACION || null, duracion_s: Math.round((Date.now() - t0) / 1000), meta, filas }
if (SALIDA) writeFileSync(SALIDA, JSON.stringify(informe, null, 1))
console.log(`escala=${ESCALA} volumen(pedidos,items,cupones,res,res_p,res_s,promos,prod,serv,cli)=${meta.volumen}  filas antes/después de la prueba: ${meta.filas_antes} → ${meta.filas_despues}`)
for (const x of filas) {
  const fases = Object.keys(x).filter((k) => k === 'antes' || k.startsWith('despues'))
  const tramo = fases.map((k) => `${String(x[k]?.ms).padStart(9)} ms h${x[k]?.helpers}`).join(' → ')
  const ult = x[fases[fases.length - 1]]
  console.log(`${x.id} ${x.rol.padEnd(9)} ${tramo}  seq[${x.antes?.seq.join(',')}]` + (fases.length > 1 ? ` → seq[${ult?.seq.join(',')}]` : '') + `  ${x.d}`)
}
