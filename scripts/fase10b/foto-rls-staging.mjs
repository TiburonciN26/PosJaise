// Fase 10B · fotografía de LECTURA por rol en staging (solo lectura), para comparar antes/después de migraciones de RLS.
//   node scripts/fase10b/foto-rls-staging.mjs --salida=<archivo.json> [--comparar=<foto anterior.json>]
// Para anon y para cada cuenta QA de .env.staging.local (admin, cajera, clienta) cuenta las filas que ese rol ve en cada tabla y
// vista de `public` (o el error: «permission denied» = sin GRANT). Todo en transacciones READ ONLY con los claims del usuario
// (rol authenticated o anon), exactamente como evalúa PostgREST. No imprime la conexión, contraseñas ni correos.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const psql = (sql) => {
  const r = spawnSync(process.execPath, [join(RAIZ, 'scripts/fase10b/psql-staging.mjs'), `--sql=${sql}`], { encoding: 'utf8', cwd: RAIZ, maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`psql: ${String(r.stderr).slice(0, 300)}`)
  return r.stdout
}
const env = Object.fromEntries(readFileSync(join(RAIZ, '.env.staging.local'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const correos = { admin: env.QA_ADMIN_EMAIL, cajera: env.QA_CAJERA_EMAIL, clienta: env.QA_CLIENTE_EMAIL }
const ids = {}
for (const [k, c] of Object.entries(correos)) {
  if (!/^[^'\s]+@[^'\s]+$/.test(c ?? '')) throw new Error(`falta el correo QA de ${k}`)
  const id = psql(`select id from auth.users where email = '${c}';`).split('\n').map((l) => l.trim()).find((l) => /^[0-9a-f-]{36}$/.test(l))
  if (!id) throw new Error(`la cuenta QA ${k} no existe en staging`)
  ids[k] = id
}
const tablas = psql("select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','v','m') order by 1;")
  .split('\n').map((l) => l.trim()).filter((l) => /^[a-z_][a-z0-9_]*$/.test(l) && l !== 'relname')

// Un bloque DO por rol: cuenta cada relación capturando el error, y emite «FILA|rol|tabla|n o ERR:código».
const bloque = (rol, id) => `
begin read only;
select set_config('role', '${id ? 'authenticated' : 'anon'}', true), set_config('request.jwt.claims', '${JSON.stringify(id ? { sub: id, role: 'authenticated' } : { role: 'anon' })}', true);
do $$
declare t text; n bigint;
begin
  foreach t in array array[${tablas.map((t) => `'${t}'`).join(',')}] loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      raise notice 'FILA|${rol}|%|%', t, n;
    exception when others then
      raise notice 'FILA|${rol}|%|ERR:%', t, sqlstate;
    end;
  end loop;
end $$;
rollback;`
const foto = {}
for (const [rol, id] of [['anon', null], ...Object.entries(ids)]) {
  const r = spawnSync(process.execPath, [join(RAIZ, 'scripts/fase10b/psql-staging.mjs'), `--sql=${bloque(rol, id)}`, '--escritura'], { encoding: 'utf8', cwd: RAIZ, maxBuffer: 64 * 1024 * 1024 })
  foto[rol] = {}
  for (const m of `${r.stdout}${r.stderr}`.matchAll(/FILA\|([^|]+)\|([^|]+)\|(\S+)/g)) foto[rol][m[2]] = /^\d+$/.test(m[3]) ? Number(m[3]) : m[3]
}
const salida = { fecha: new Date().toISOString(), entorno: 'staging', tablas: tablas.length, roles: Object.keys(foto), foto }
let diferencias = null
if (arg('comparar')) {
  const previa = JSON.parse(readFileSync(arg('comparar'), 'utf8')).foto
  diferencias = []
  for (const rol of Object.keys(foto)) for (const t of new Set([...Object.keys(previa[rol] ?? {}), ...Object.keys(foto[rol])])) {
    const a = previa[rol]?.[t], b = foto[rol][t]
    if (a === undefined) diferencias.push({ rol, tabla: t, antes: 'no existía', despues: b })
    else if (b === undefined) diferencias.push({ rol, tabla: t, antes: a, despues: 'ya no existe' })
    else if (a !== b) diferencias.push({ rol, tabla: t, antes: a, despues: b })
  }
  salida.comparadaCon = arg('comparar'); salida.diferencias = diferencias
}
if (arg('salida')) writeFileSync(arg('salida'), JSON.stringify(salida, null, 1))
console.log(`${tablas.length} relaciones × ${Object.keys(foto).length} roles`)
for (const rol of Object.keys(foto)) console.log(`${rol.padEnd(8)} ${Object.values(foto[rol]).filter((v) => typeof v === 'number').length} legibles · ${Object.values(foto[rol]).filter((v) => typeof v !== 'number').length} con error`)
if (diferencias) { console.log(`${diferencias.length} diferencias`); for (const d of diferencias) console.log(`  ${d.rol} ${d.tabla}: ${d.antes} → ${d.despues}`) }
