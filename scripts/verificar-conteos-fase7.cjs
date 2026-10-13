// Fase 7 · regresión F7-01: el CONTEO del SQL que mide Pedidos Web debe describir el MISMO conjunto de pedidos que su página y que la app.
//
// Parte A (transacción con ROLLBACK, sobre Supabase LOCAL 54321): ejemplo mínimo con pedidos de nombres coincidentes y no coincidentes
//   (entregado de «Zzqf7 Maria», entregado de «Zzqf7 Ana», listo de «Zzqf7 Maria») y comprobación de que, para cada combinación de
//   estado × término, `total_result_set` del SQL medido == filas que devuelve su propia página sin límite.
// Parte B (solo lectura, datos reales de la réplica): lo mismo, y además el conteo EXACTO que devuelve `leerPedidos` de la app
//   (src/lib/listasAdmin.js, PostgREST con sesión de administración) debe ser igual al del SQL medido.
// Control negativo: el conteo ANTIGUO del medidor (solo `estado`, sin el filtro de clienta) debe DISCREPAR en el ejemplo mínimo.
//
// Uso: node scripts/verificar-conteos-fase7.cjs --cuentas=ruta/cuentas.json [--salida=ruta.json]
const { execFileSync } = require('node:child_process')
const { readFileSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const { pedidosLista, envolver } = require('./lib/consultas-fase7.cjs')

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d ?? ''}`).split('=').slice(1).join('=')
const CUENTAS = arg('cuentas'), SALIDA = arg('salida')
const API = 'http://127.0.0.1:54321'
const puertos = execFileSync('docker', ['ps', '--filter', 'name=^supabase_kong_WedJaiseReact$', '--format', '{{.Ports}}'], { encoding: 'utf8' })
if (!/:54321->8000\/tcp/.test(puertos)) throw new Error('54321 no es la pila WedJaiseReact')
const psql = (sql) =>
  execFileSync('docker', ['exec', '-i', 'supabase_db_WedJaiseReact', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-F', '\t'], { input: sql, encoding: 'utf8', maxBuffer: 1 << 26 })

const COMO_ADMIN = `select id as admin_id from usuarios where rol = 'ADMINISTRADOR' and activo order by id limit 1 \\gset
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, true);`
const lit = (t) => `'${t.replace(/'/g, "''")}'`
const ESTADOS = [null, 'ENTREGADO', 'LISTO', 'PENDIENTE']

// total_result_set y filas de la página SIN límite, para (estado, término) bajo administración. Dos sentencias → dos líneas «clave|valor».
function consultas(estado, termino, etiqueta) {
  const base = pedidosLista({ estado, termino: termino === null ? null : lit(termino) })
  const sinLimite = pedidosLista({ estado, termino: termino === null ? null : lit(termino), limite: 1000000 })
  return `select 'CONTEO|${etiqueta}|' || (select total_result_set from (${envolver(base)}) x);
select 'PAGINA|${etiqueta}|' || (select count(*) from (${sinLimite.fuente}) y);`
}
const resultados = (out) => {
  const m = {}
  for (const l of out.split('\n')) {
    const [t, e, v] = l.split('|')
    if (t === 'CONTEO' || t === 'PAGINA') (m[e] ??= {})[t] = Number(v)
  }
  return m
}
const fallos = []
const informe = { parteA: {}, parteB: {}, control_negativo: {}, fallos }

// ---------- Parte A: ejemplo mínimo con nombres coincidentes y no coincidentes ----------
const siembraMinima = `
set local session_replication_role = replica;
create temp table f7_cli as select (jsonb_populate_record(null::clientes, to_jsonb(c) || jsonb_build_object('id', gen_random_uuid(), 'nombre', n, 'telefono', null, 'cliente_web_id', null, 'codigo_referido', 'F7' || md5(n)))).* from (select * from clientes order by id limit 1) c, (values ('Zzqf7 Maria'), ('Zzqf7 Ana')) v(n);
insert into clientes select * from f7_cli;
insert into pedidos_web select (jsonb_populate_record(null::pedidos_web, to_jsonb(p) || jsonb_build_object('id', gen_random_uuid(), 'cliente_id', (select id from f7_cli where nombre = v.n), 'estado', v.e, 'pasarela_charge_id', null, 'venta_id', null, 'pago_verificado_por', null))).*
  from (select * from pedidos_web order by id limit 1) p, (values ('Zzqf7 Maria', 'ENTREGADO'), ('Zzqf7 Ana', 'ENTREGADO'), ('Zzqf7 Maria', 'LISTO')) v(n, e);
set local session_replication_role = origin;`
const combosA = []
for (const e of ESTADOS) for (const t of [null, 'zzqf7', 'zzqf7 maria', 'maria', 'ana', 'noexistexyz']) combosA.push([e, t])
const etiqueta = (e, t) => `${e ?? 'todos'}/${t ?? '-'}`
let sqlA = `begin;\n${siembraMinima}\n${COMO_ADMIN}\n`
for (const [e, t] of combosA) sqlA += consultas(e, t, etiqueta(e, t)) + '\n'
// conteo ANTIGUO del medidor (solo estado) para el control negativo
sqlA += `select 'ANTIGUO|ENTREGADO/zzqf7 maria|' || (select count(*) from public.pedidos_web p where p.estado = 'ENTREGADO' and p.cliente_id in (select id from clientes where nombre like 'Zzqf7%'));\n`
sqlA += `reset role;\nrollback;\nselect 'FILAS|' || (select count(*) from pedidos_web) || ',' || (select count(*) from clientes);\n`
const filasAntes = psql(`select 'FILAS|' || (select count(*) from pedidos_web) || ',' || (select count(*) from clientes);`).trim()
const outA = psql(sqlA)
const mA = resultados(outA)
for (const [e, t] of combosA) {
  const k = etiqueta(e, t)
  const r = mA[k]
  informe.parteA[k] = r
  if (!r || r.CONTEO !== r.PAGINA) fallos.push(`A ${k}: conteo ${r?.CONTEO} ≠ filas de la página ${r?.PAGINA}`)
}
// valores esperados del ejemplo mínimo (tres pedidos sembrados, solo los de «Zzqf7»)
for (const [k, v] of Object.entries({ 'ENTREGADO/zzqf7 maria': 1, 'LISTO/zzqf7 maria': 1, 'ENTREGADO/noexistexyz': 0 })) {
  if (mA[k]?.CONTEO !== v) fallos.push(`A ${k}: se esperaba ${v}, el SQL medido da ${mA[k]?.CONTEO}`)
}
// «zzqf7» coincide con las dos clientas sembradas: ENTREGADO → 2 pedidos sembrados (más los reales cuyo nombre contenga zzqf7: ninguno)
if (mA['ENTREGADO/zzqf7']?.CONTEO !== 2) fallos.push(`A ENTREGADO/zzqf7: se esperaba 2, el SQL medido da ${mA['ENTREGADO/zzqf7']?.CONTEO}`)
const antiguo = Number((/ANTIGUO\|[^|]*\|(\d+)/.exec(outA) ?? [])[1])
informe.control_negativo = { conteo_antiguo_del_medidor: antiguo, conteo_correcto: mA['ENTREGADO/zzqf7 maria']?.CONTEO, discrepa: antiguo !== mA['ENTREGADO/zzqf7 maria']?.CONTEO }
if (!informe.control_negativo.discrepa) fallos.push('control negativo: el conteo antiguo no discrepa; el ejemplo mínimo no discrimina')
const filasDespuesA = psql(`select 'FILAS|' || (select count(*) from pedidos_web) || ',' || (select count(*) from clientes);`).trim()
if (filasAntes !== filasDespuesA) fallos.push(`la base cambió tras la parte A: ${filasAntes} → ${filasDespuesA}`)

// ---------- Parte B: datos reales + conteo de la app (leerPedidos) ----------
async function parteB() {
  const { createClient } = await import('@supabase/supabase-js')
  const { leerPedidos } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'lib', 'listasAdmin.js')))
  const env = execFileSync('npx', ['--no-install', 'supabase', 'status', '-o', 'env'], { cwd: path.join(__dirname, '..'), encoding: 'utf8', shell: true })
  const anon = /ANON_KEY="?([^"\r\n]+)"?/.exec(env)[1]
  const cuentas = JSON.parse(readFileSync(CUENTAS, 'utf8'))
  const supabase = createClient(API, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await supabase.auth.signInWithPassword({ email: cuentas.admin.email, password: cuentas.admin.password })
  if (error) throw error
  const nombres = psql(`select split_part(c.nombre, ' ', 1) from clientes c join pedidos_web p on p.cliente_id = c.id group by 1 order by count(*) desc, 1 limit 4;`).trim().split('\n').filter(Boolean)
  const terminos = [null, ...nombres, 'noexistexyz']
  let sqlB = 'begin read only;\n' + COMO_ADMIN + '\n'
  const combosB = []
  for (const e of ESTADOS) for (const t of terminos) { combosB.push([e, t]); sqlB += consultas(e, t, etiqueta(e, t)) + '\n' }
  sqlB += 'rollback;\n'
  const mB = resultados(psql(sqlB))
  for (const [e, t] of combosB) {
    const k = etiqueta(e, t)
    const app = await leerPedidos(supabase, { termino: t ?? '', estado: e, desde: 0, hasta: 39 })
    if (app.error) throw app.error
    informe.parteB[k] = { ...mB[k], app: app.count }
    if (mB[k].CONTEO !== mB[k].PAGINA) fallos.push(`B ${k}: conteo SQL ${mB[k].CONTEO} ≠ filas de su página ${mB[k].PAGINA}`)
    if (mB[k].CONTEO !== app.count) fallos.push(`B ${k}: conteo SQL ${mB[k].CONTEO} ≠ conteo de la app ${app.count}`)
  }
}
const { pathToFileURL } = require('node:url')
parteB().then(() => {
  informe.veredicto = fallos.length ? 'FALLA' : 'CORRECTO'
  if (SALIDA) writeFileSync(SALIDA, JSON.stringify(informe, null, 1))
  console.log(`A: ${combosA.length} combinaciones (ejemplo mínimo)   B: ${Object.keys(informe.parteB).length} combinaciones (datos reales, SQL vs página vs app)`)
  console.log(`control negativo: conteo antiguo del medidor=${informe.control_negativo.conteo_antiguo_del_medidor}, correcto=${informe.control_negativo.conteo_correcto}, discrepa=${informe.control_negativo.discrepa}`)
  console.log(`base sin cambios tras A: ${filasAntes === filasDespuesA} (${filasAntes})`)
  console.log(`VEREDICTO: ${informe.veredicto}${fallos.length ? '\n  - ' + fallos.join('\n  - ') : ''}`)
  process.exit(fallos.length ? 1 : 0)
}).catch((e) => { console.error(e); process.exit(2) })
