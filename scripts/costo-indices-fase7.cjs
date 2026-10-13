// Fase 7 · costo de los índices de la 002: tamaño y diferencia de tiempo de un lote de INSERT con y sin ellos (Supabase LOCAL).
//
// Diseño (corrige F7-02 de la revisión V1):
//  · UNA transacción con ROLLBACK; sin la guarda de transacción el script ABORTA (ON_ERROR_STOP en la línea de comandos).
//  · El estado de índices se FIJA antes de cada muestra (sin: DROP de los tres; con: CREATE de los tres) y se VALIDA con un DO que
//    lanza excepción si el número de índices idx_f7_* no es el esperado: si el supuesto sin/con no se cumple, la corrida falla.
//  · Orden CONTRABALANCEADO sin-con-con-sin-sin-con-con-sin (ABBA ABBA): la deriva por caché o fragmentación afecta a ambas condiciones
//    por igual. Cada muestra se deshace con ROLLBACK TO SAVEPOINT (se revierte también el DDL de índices de esa muestra).
//  · Además se mide la generación de las filas SIN insertarlas (SELECT del mismo lote) para saber qué parte del tiempo NO es escritura.
//  · Se registra la condición de cada muestra, el orden, las diferencias pareadas y la dispersión. El resultado es la diferencia del
//    LOTE TOTAL; no se afirma una cota del costo puro de mantener los índices.
//  · La siembra y el lote usan session_replication_role=replica (sin triggers ni FK): el sobrecosto de producción puede ser distinto.
//  · Al terminar se comprueba que el estado real de la base es el de antes (conteos, 3 índices presentes y sin marcas de prueba).
//
// Uso: node scripts/costo-indices-fase7.cjs --migracion=supabase/migrations/20261012000002_indices_listas_medidos.sql --salida=ruta.json
const { execFileSync } = require('node:child_process')
const { readFileSync, writeFileSync } = require('node:fs')
const { AMPLIADA, siembra } = require('./lib/volumen-fase7.cjs')

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d ?? ''}`).split('=').slice(1).join('=')
const MIG = arg('migracion'), SALIDA = arg('salida')
const ORDEN = ['sin', 'con', 'con', 'sin', 'sin', 'con', 'con', 'sin']
const NOMBRES = ['idx_f7_pedidos_web_creado', 'idx_f7_pedidos_web_items_pedido', 'idx_f7_cupones_origen_estado_creado']

const puertos = execFileSync('docker', ['ps', '--filter', 'name=^supabase_kong_WedJaiseReact$', '--format', '{{.Ports}}'], { encoding: 'utf8' })
if (!/:54321->8000\/tcp/.test(puertos)) throw new Error('54321 no es la pila WedJaiseReact')
const psql = (sql) =>
  execFileSync('docker', ['exec', '-i', 'supabase_db_WedJaiseReact', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], {
    input: sql, encoding: 'utf8', maxBuffer: 1 << 28,
  })
const sqlMigracion = readFileSync(MIG, 'utf8').replace(/^\s*(begin|commit)\s*;\s*$/gim, '')
const ESTADO = `select 'ESTADO|' || (select count(*) from clientes) || ',' || (select count(*) from pedidos_web) || ',' || (select count(*) from pedidos_web_items) || ',' || (select count(*) from cupones) || ',' || (select count(*) from auditoria) || '|idx=' || (select count(*) from pg_indexes where indexname like 'idx_f7_%') || '|marcas=' || (select count(*) from clientes where nombre like '% QA7 %') || ',' || (select count(*) from cupones where codigo like 'COSTO%' or codigo like 'QA7-%');`

// Mismas tres filas-fuente para insertar (con índices) o solo generar (sin escribir).
const filas = (k) => ({
  pedidos: `select (jsonb_populate_record(null::pedidos_web, to_jsonb(s) || jsonb_build_object('id', gen_random_uuid(), 'creado_en', now() + g * interval '1 second', 'pasarela_charge_id', null, 'venta_id', null, 'pago_verificado_por', null))).* from (select * from pedidos_web order by id limit 1) s, generate_series(1, 20000) g`,
  items: `select (jsonb_populate_record(null::pedidos_web_items, to_jsonb(s) || jsonb_build_object('id', gen_random_uuid(), 'pedido_id', p.id))).* from (select * from pedidos_web_items order by id limit 1) s, (select id from pedidos_web order by creado_en desc limit 20000) p`,
  cupones: `select (jsonb_populate_record(null::cupones, to_jsonb(s) || jsonb_build_object('id', gen_random_uuid(), 'codigo', 'COSTO${k}-' || g || substr(md5(g::text), 1, 5), 'promocion_id', null, 'referido_id', null, 'venta_id', null, 'catalogo_id', null))).* from (select * from cupones order by id limit 1) s, generate_series(1, 40000) g`,
})
// Las filas se materializan UNA vez en tablas temporales FUERA del cronometro; lo cronometrado es solo INSERT ... SELECT hacia las tablas reales.
const materializar = () => { const f = filas('M'); return `create temp table g_ped as ${f.pedidos};\ncreate temp table g_items as ${f.items};\ncreate temp table g_cup as ${f.cupones};` }
const loteInsertar = () => `insert into pedidos_web select * from g_ped;\ninsert into pedidos_web_items select * from g_items;\ninsert into cupones select * from g_cup;`
const loteGenerar = (k) => { const f = filas(k); return Object.values(f).map((x) => `select count(*) from (${x}) q;`).join('\n') }
const cronometrar = (etiqueta, cuerpo) => `select clock_timestamp() as t0 \\gset\n${cuerpo}\nselect 'MS|${etiqueta}|' || round(extract(epoch from clock_timestamp() - :'t0'::timestamptz) * 1000);\n`
const fijar = (cond) => cond === 'sin'
  ? NOMBRES.map((n) => `drop index if exists public.${n};`).join('\n')
  : sqlMigracion
const validar = (esperados) => `do $v$ begin if (select count(*) from pg_indexes where indexname like 'idx_f7_%') <> ${esperados} then raise exception 'Condicion de indices invalida: se esperaban ${esperados}'; end if; end $v$;`

// Los índices reales se quitan ANTES de sembrar (dentro de la transacción): sembrar con ellos presentes los infla de forma permanente
// aunque haya ROLLBACK (la extensión de páginas del índice no se deshace). Además fija y valida la condición de partida.
let g = `${ESTADO}\nbegin;\nset local session_replication_role = replica;\n${fijar('sin')}\n${validar(0)}\n${siembra(AMPLIADA)}\nset local session_replication_role = replica;\nanalyze;\n`
g += `select 'TAM_TABLAS|' || pg_relation_size('pedidos_web') || ',' || pg_relation_size('pedidos_web_items') || ',' || pg_relation_size('cupones');\n`
g += `select 'FILAS_BASE|' || (select count(*) from pedidos_web) || ',' || (select count(*) from pedidos_web_items) || ',' || (select count(*) from cupones);\n`
g += `${materializar()}\n`
for (let i = 0; i < 1; i++) g += `savepoint gen${i};\n${cronometrar(`generar|${i}`, loteGenerar(`G${i}`))}rollback to gen${i};\n`
ORDEN.forEach((cond, i) => {
  g += `savepoint m${i};\n${fijar(cond)}\n${validar(cond === 'sin' ? 0 : 3)}\n`
  if (cond === 'con') g += `select 'IDX|' || c.relname || '|' || pg_relation_size(c.oid) from pg_class c where c.relname like 'idx_f7_%' and c.relkind = 'i' order by 1;\n`
  g += `${cronometrar(`${cond}|${i}`, loteInsertar())}`
  g += `select 'COND|${i}|${cond}|' || (select count(*) from pg_indexes where indexname like 'idx_f7_%');\nrollback to m${i};\n`
})
g += `rollback;\n${ESTADO}\n`

const out = psql(g)
const estados = out.split('\n').filter((l) => l.startsWith('ESTADO|'))
const lineas = (p) => out.split('\n').filter((l) => l.startsWith(p))
const muestras = ORDEN.map((cond, i) => {
  const ms = Number(lineas(`MS|${cond}|${i}`)[0].split('|')[3])
  const nIdx = Number(lineas(`COND|${i}|`)[0].split('|')[3])
  return { orden: i + 1, condicion: cond, indices_presentes: nIdx, ms }
})
const generar = lineas('MS|generar|').map((l) => Number(l.split('|')[3]))
// Mediana habitual: con cardinalidad par es el promedio de los dos valores centrales (la versión anterior devolvía la mediana SUPERIOR).
const med = (a) => { const o = [...a].sort((x, y) => x - y); const m = o.length >> 1; return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2 }
const sin = muestras.filter((m) => m.condicion === 'sin').map((m) => m.ms)
const con = muestras.filter((m) => m.condicion === 'con').map((m) => m.ms)
// pares adyacentes del diseño ABBA: (0,1) (2,3) (4,5) (6,7)
const pares = [[0, 1], [3, 2], [4, 5], [7, 6]].map(([s, c]) => ({ sin_ms: muestras[s].ms, con_ms: muestras[c].ms, diferencia_ms: muestras[c].ms - muestras[s].ms, diferencia_pct: +(((muestras[c].ms - muestras[s].ms) / muestras[s].ms) * 100).toFixed(1) }))
const dif = pares.map((p) => p.diferencia_pct)
const mejor = (a) => Math.min(...a), peor = (a) => Math.max(...a)
const idx = lineas('IDX|').slice(0, 3).map((l) => { const [, n, b] = l.split('|'); return { indice: n, bytes: Number(b) } })
const r = {
  diseno: 'orden ABBA ABBA contrabalanceado; estado de índices fijado y validado antes de cada muestra; cada muestra deshecha con ROLLBACK TO SAVEPOINT',
  lote: '20.000 pedidos + 20.000 ítems + 40.000 cupones sobre volumen ampliado, filas pre-generadas en tablas temporales; se cronometra solo el INSERT (session_replication_role=replica: sin triggers ni FK)',
  muestras, generacion_de_filas_sin_insertar_ms_diseno_anterior: generar,
  resumen: { mediana_sin_ms: med(sin), mediana_con_ms: med(con), rango_sin_ms: [mejor(sin), peor(sin)], rango_con_ms: [mejor(con), peor(con)], diferencia_pareada_pct: dif, media_diferencia_pareada_pct: +(dif.reduce((a, b) => a + b, 0) / dif.length).toFixed(1), rango_diferencia_pareada_pct: [mejor(dif), peor(dif)] },
  pares, indices: idx, tablas_bytes: /TAM_TABLAS\|(.*)/.exec(out)[1], filas_base: /FILAS_BASE\|(.*)/.exec(out)[1],
  estado_antes: estados[0], estado_despues: estados[1], base_intacta: estados[0] === estados[1],
}
r.condiciones_validas = muestras.every((m) => m.indices_presentes === (m.condicion === 'sin' ? 0 : 3))
if (SALIDA) writeFileSync(SALIDA, JSON.stringify(r, null, 1))
console.log(JSON.stringify({ orden: muestras.map((m) => `${m.condicion}:${m.ms}`), generar, resumen: r.resumen, indices: idx, base_intacta: r.base_intacta, condiciones_validas: r.condiciones_validas, estado_antes: r.estado_antes }, null, 1))
if (!r.base_intacta || !r.condiciones_validas) process.exit(1)
