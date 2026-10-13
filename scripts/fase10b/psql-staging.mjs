// Fase 10B · consulta SQL contra STAGING con el psql del contenedor de Supabase Local, sin imprimir la conexión.
//   node scripts/fase10b/psql-staging.mjs --sql="select 1"        (solo lectura: envuelto en BEGIN READ ONLY … ROLLBACK)
//   node scripts/fase10b/psql-staging.mjs --archivo=<x.sql> --escritura   (escritura explícita: el archivo gestiona su transacción)
// Salvaguardas: exige el ref de staging en STAGING_DB_URL (.env.staging.local, fuera de git), rechaza producción y local, y
// nunca escribe la URL en consola ni en archivos. La URL se pasa por variable de entorno (PGURL), no por argumentos.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REF_STAGING = 'tqkdtojnhgykmcbvwdmz'
const REF_PRODUCCION = 'cmkelllerzjqjbsqsylc'
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const falla = (m) => { console.error(`psql-staging: ${m}`); process.exit(2) }
const f = resolve('.env.staging.local')
if (!existsSync(f)) falla('falta .env.staging.local')
const url = readFileSync(f, 'utf8').split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith('STAGING_DB_URL='))?.slice('STAGING_DB_URL='.length).trim()
if (!url) falla('falta STAGING_DB_URL')
if (url.includes(REF_PRODUCCION) || /127\.0\.0\.1|localhost/.test(url)) falla('la conexión es producción o local: abortado')
if (!url.includes(REF_STAGING)) falla(`la conexión no es la de staging ${REF_STAGING}`)

const escritura = process.argv.includes('--escritura')
let sql = arg('sql') ?? (arg('archivo') ? readFileSync(arg('archivo'), 'utf8') : null)
if (!sql) falla('uso: --sql="…" | --archivo=<x.sql> [--escritura]')
if (!escritura) sql = `begin read only;\n${sql}\n;rollback;`
const r = spawnSync('docker', ['exec', '-i', '-e', 'PGURL', 'supabase_db_WedJaiseReact', 'sh', '-c', 'psql "$PGURL" -v ON_ERROR_STOP=1 -X -q -A -F "|" -P footer=off'], {
  input: sql, encoding: 'utf8', env: { ...process.env, PGURL: url }, maxBuffer: 64 * 1024 * 1024,
})
const limpiar = (t) => String(t ?? '').split(url).join('<staging-url>')
process.stdout.write(limpiar(r.stdout))
process.stderr.write(limpiar(r.stderr))
process.exitCode = r.status ?? 1
