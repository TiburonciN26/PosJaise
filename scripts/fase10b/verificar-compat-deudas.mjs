// Fase 10B · verificación del mecanismo de compatibilidad de deudas YA INSTALADO (migración 20261013000001), en Local o staging.
//   node scripts/fase10b/verificar-compat-deudas.mjs --entorno=local --cuentas=<json QA con admin> [--salida=<archivo.json>]
//   node scripts/fase10b/verificar-compat-deudas.mjs --entorno=staging [--salida=<archivo.json>]
// Ejecuta los casos S1–S9 del ensayo (.codex/propuesta-f10a-05/ensayo-compat-deudas.sql, bloque «DESPUÉS») como la
// administradora QA (rol authenticated con sus claims: RLS y GRANT reales), con deudas «TEST QA F10A-05», TODO dentro de una
// transacción que termina en ROLLBACK: no queda ninguna fila. No instala ni modifica funciones o triggers (solo comprueba que
// existen). Antes y después lee conteos y firma de deudas/pagos para demostrar que el entorno queda idéntico.
// Producción: no admitida (la verificación allí es de solo lectura; ver el informe de 10B).
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const ENTORNO = arg('entorno')
if (!['local', 'staging'].includes(ENTORNO)) { console.error('uso: --entorno=local|staging'); process.exit(2) }

// psql del entorno: Local por docker; staging con scripts/fase10b/psql-staging.mjs (valida el ref y oculta la conexión).
function psql(sql, { escritura = false } = {}) {
  if (ENTORNO === 'local') {
    const r = spawnSync('docker', ['exec', '-i', 'supabase_db_WedJaiseReact', 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: escritura ? sql : `begin read only;\n${sql}\n;rollback;`, encoding: 'utf8' })
    return { codigo: r.status, salida: `${r.stdout}${r.stderr}` }
  }
  const r = spawnSync(process.execPath, [join(RAIZ, 'scripts/fase10b/psql-staging.mjs'), `--sql=${sql}`, ...(escritura ? ['--escritura'] : [])], { encoding: 'utf8', cwd: RAIZ })
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` }
}
const filas = (t) => t.split('\n').map((l) => l.trim()).filter((l) => l && !/^(version|count|id|BEGIN|ROLLBACK)$/.test(l))

// Administradora QA y una clienta existente (solo como referencia de las deudas de prueba).
let adminEmail
if (ENTORNO === 'local') adminEmail = JSON.parse(readFileSync(arg('cuentas'), 'utf8')).admin.email
else adminEmail = readFileSync(join(RAIZ, '.env.staging.local'), 'utf8').split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith('QA_ADMIN_EMAIL='))?.slice(15).trim()
if (!/^[^'\s]+@[^'\s]+$/.test(adminEmail ?? '')) { console.error('falta el correo de la administradora QA'); process.exit(2) }
const ids = filas(psql(`select u.id from auth.users u join public.usuarios x on x.id = u.id where u.email = '${adminEmail}' and x.rol = 'ADMINISTRADOR';`).salida).filter((l) => /^[0-9a-f-]{36}$/.test(l))
const clientes = filas(psql('select id from public.clientes order by id limit 1;').salida).filter((l) => /^[0-9a-f-]{36}$/.test(l))
if (ids.length !== 1) { console.error('no se encontró una única administradora QA con ese correo'); process.exit(2) }
// Sin clientas (staging tiene datos mínimos): se crea una «TEST QA F10A-05 cliente» DENTRO de la transacción revertida.
const clienteSql = clientes.length === 1 ? `'${clientes[0]}'` : "(select id from public.clientes where nombre = 'TEST QA F10A-05 cliente')"
const crearCliente = clientes.length === 1 ? '' : "insert into public.clientes (nombre) values ('TEST QA F10A-05 cliente');"

const FOTO = `select (select count(*) from public.deudas) || '|' || (select count(*) from public.deuda_pagos) || '|' || (select coalesce(sum(monto),0) from public.deuda_pagos)
  || '|' || (select md5(coalesce(string_agg(id::text || estado || monto::text || coalesce(cobrado_en::text,''), ',' order by id), '')) from public.deudas)
  || '|' || (select count(*) from pg_trigger where tgrelid = 'public.deudas'::regclass and not tgisinternal and tgname in ('deudas_compat_antes','deudas_compat_despues'))
  || '|' || (select count(*) from public.deudas d left join (select deuda_id, sum(monto) p from public.deuda_pagos group by deuda_id) q on q.deuda_id = d.id
             where (d.estado = 'COBRADA' and coalesce(q.p,0) < d.monto) or (d.estado = 'PENDIENTE' and coalesce(q.p,0) > 0 and coalesce(q.p,0) >= d.monto));`
const foto = () => {
  const l = filas(psql(FOTO).salida).find((x) => /^\d+\|\d+\|/.test(x))
  const [deudas, pagos, suma, firma, triggers, incoherentes] = (l ?? '').split('|')
  return { deudas: Number(deudas), deudaPagos: Number(pagos), sumaPagos: Number(suma), firmaDeudas: firma, triggersCompat: Number(triggers), incoherentes: Number(incoherentes) }
}

const antes = foto()
if (antes.triggersCompat !== 2) { console.error(`el mecanismo no está instalado en ${ENTORNO} (triggers de compatibilidad: ${antes.triggersCompat})`); process.exit(1) }

// Casos: cabecera de funciones auxiliares y bloque «DESPUÉS» del ensayo revisado por Codex (sin instalación ni relleno).
const ensayo = readFileSync(join(RAIZ, '.codex/propuesta-f10a-05/ensayo-compat-deudas.sql'), 'utf8').replace(/\r\n/g, '\n')
const aux = ensayo.slice(ensayo.indexOf('create function pg_temp.como_admin()'), ensayo.indexOf('-- ======================= ANTES'))
const despues = ensayo.slice(ensayo.indexOf('-- ======================= DESPUÉS'), ensayo.indexOf('-- ======================= Relleno'))
const sql = `begin;
${crearCliente}
select set_config('ensayo.admin', '${ids[0]}', true), set_config('ensayo.cliente', ${clienteSql}::text, true);
${aux}
${despues}
rollback;`
if (/\bcommit\b/i.test(sql)) { console.error('el SQL contiene COMMIT: abortado'); process.exit(2) }
const r = psql(sql, { escritura: true })
const resultados = [...r.salida.matchAll(/RESULTADO\|([^|]*)\|(ok|FALLA)\|([^\n]*)/g)].map((m) => ({ caso: m[1], ok: m[2] === 'ok', detalle: m[3].trim() }))
const errores = r.salida.split('\n').filter((l) => /^(psql:|ERROR)/.test(l))
const despuesFoto = foto()
const intacto = JSON.stringify(antes) === JSON.stringify(despuesFoto)
const ESPERADOS = 19 // S1a–S1d, S2a–S2c, S3, S4a–S4b, S5a–S5c, S6, S7a–S7c, S8, S9
for (const x of resultados) console.log(`${x.ok ? 'OK   ' : 'FALLA'} ${x.caso}${x.detalle ? ` — ${x.detalle}` : ''}`)
for (const e of errores) console.log(`ERROR ${e}`)
console.log(`${intacto ? 'OK   ' : 'FALLA'} ${ENTORNO} intacto tras el ROLLBACK: ${JSON.stringify(despuesFoto)}`)
const ok = r.codigo === 0 && !errores.length && intacto && resultados.length === ESPERADOS && resultados.every((x) => x.ok) && antes.incoherentes === 0
if (arg('salida')) writeFileSync(arg('salida'), JSON.stringify({ fecha: new Date().toISOString(), entorno: ENTORNO, transaccion: 'ROLLBACK', antes, despues: despuesFoto, intacto, codigoPsql: r.codigo, errores, resultados, ok }, null, 1))
console.log(`\n${resultados.filter((x) => x.ok).length + (intacto ? 1 : 0)}/${ESPERADOS + 1} correctos · incoherentes antes: ${antes.incoherentes}`)
process.exitCode = ok ? 0 : 1
