// Fase 10A · V2 (F10A-05 de Codex): ensayo LOCAL de la propuesta de compatibilidad de deudas, sin dejar rastro.
//   node scripts/fase10a/ensayar-compat-deudas.mjs --cuentas=<json QA con admin> [--salida=<archivo.json>]
// Ejecuta .codex/propuesta-f10a-05/ensayo-compat-deudas.sql con el borrador compat-deudas-borrador.sql insertado, en UNA
// transacción de Supabase Local que termina en ROLLBACK. Se niega si el texto contiene COMMIT o si el contenedor no es el de
// Local. Comprueba por lectura que deudas, deuda_pagos, triggers y funciones quedan exactamente como estaban.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
if (!arg('cuentas')) { console.error('uso: --cuentas=<json QA con admin> [--salida=<archivo>]'); process.exit(2) }
const admin = JSON.parse(readFileSync(arg('cuentas'), 'utf8')).admin
if (!/^qa-[a-z0-9-]+@test\.local$/.test(admin?.email ?? '') || !/^[0-9a-f-]{36}$/.test(admin?.id ?? '')) { console.error('la cuenta admin no es una QA ficticia con id'); process.exit(2) }
const puertos = execFileSync('docker', ['ps', '--filter', 'name=^supabase_kong_WedJaiseReact$', '--format', '{{.Ports}}'], { encoding: 'utf8' })
if (!/:54321->8000/.test(puertos)) { console.error('Supabase Local no verificado'); process.exit(2) }

const DIR = join(RAIZ, '.codex/propuesta-f10a-05')
const borrador = readFileSync(join(DIR, 'compat-deudas-borrador.sql'), 'utf8')
const ensayo = readFileSync(join(DIR, 'ensayo-compat-deudas.sql'), 'utf8')
const marcador = ensayo.split('\n').find((l) => l.startsWith('-- @@BORRADOR@@'))
if (!marcador) { console.error('falta el marcador del borrador en el ensayo'); process.exit(2) }
const sql = ensayo.replace(marcador, () => borrador) // función: el SQL lleva `$$`, que un reemplazo de texto interpretaría
const sinComentarios = sql.replace(/--.*$/gm, '')
if (/\bcommit\b/i.test(sinComentarios) || !/^\s*rollback;\s*$/m.test(sinComentarios.trim().split('\n').at(-1))) { console.error('el ensayo debe terminar en ROLLBACK y no contener COMMIT'); process.exit(2) }

const psql = (entrada, extra = []) => execFileSync('docker', ['exec', '-i', 'supabase_db_WedJaiseReact', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', ...extra], { input: entrada, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
const FOTO = `begin read only;
select json_build_object(
  'deudas', (select count(*) from deudas), 'deudaPagos', (select count(*) from deuda_pagos),
  'sumaPagos', (select coalesce(sum(monto), 0) from deuda_pagos),
  'firmaDeudas', (select md5(coalesce(string_agg(id::text || estado || monto || coalesce(cobrado_en::text, ''), ',' order by id), '')) from deudas),
  'triggersDeudas', (select count(*) from pg_trigger where tgrelid = 'public.deudas'::regclass and not tgisinternal),
  'funcionesCompat', (select count(*) from pg_proc where proname like 'deudas_compat%'),
  'deudasPrueba', (select count(*) from deudas where concepto like 'TEST QA F10A-05%'));
rollback;`
const foto = () => JSON.parse(psql(FOTO).split('\n').find((l) => l.startsWith('{')))
const clienteId = psql("begin read only; select id from clientes order by id limit 1; rollback;").split('\n').find((l) => /^[0-9a-f-]{36}$/.test(l))
if (!clienteId) { console.error('no hay clientes en Local'); process.exit(2) }

const antes = foto()
let salida = '', codigo = 0
try {
  // Los NOTICE de psql salen por stderr: se capturan con 2>&1 dentro del contenedor.
  salida = execFileSync('docker', ['exec', '-i', 'supabase_db_WedJaiseReact', 'sh', '-c', `psql -U postgres -d postgres -At -v admin_id=${admin.id} -v cliente_id=${clienteId} 2>&1`], { input: sql, encoding: 'utf8' })
} catch (e) { codigo = e.status ?? 1; salida = String(e.stdout ?? '') + String(e.stderr ?? '') }
const despues = foto()
const resultados = [...salida.matchAll(/RESULTADO\|([^|]*)\|(ok|FALLA)\|([^\n]*)/g)].map((m) => ({ caso: m[1], ok: m[2] === 'ok', detalle: m[3].trim() }))
const errores = salida.split('\n').filter((l) => /^(psql:|ERROR)/.test(l))
const intacto = JSON.stringify(antes) === JSON.stringify(despues)
for (const r of resultados) console.log(`${r.ok ? 'OK   ' : 'FALLA'} ${r.caso}${r.detalle ? ` — ${r.detalle}` : ''}`)
for (const e of errores) console.log(`ERROR ${e}`)
console.log(`${intacto ? 'OK   ' : 'FALLA'} Local intacto tras el ROLLBACK (deudas, pagos, firma, triggers y funciones): ${JSON.stringify(despues)}`)
const esperados = 21
const ok = codigo === 0 && !errores.length && intacto && resultados.length === esperados && resultados.every((r) => r.ok)
if (arg('salida')) writeFileSync(arg('salida'), JSON.stringify({ fecha: new Date().toISOString(), transaccion: 'ROLLBACK', antes, despues, intacto, codigoPsql: codigo, errores, resultados }, null, 1))
console.log(`\n${resultados.filter((r) => r.ok).length + (intacto ? 1 : 0)}/${esperados + 1} correctos`)
process.exit(ok ? 0 : 1)
