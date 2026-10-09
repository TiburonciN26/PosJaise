// Aplica supabase/migrations/ al Supabase de STAGING con la CLI local.
// Uso: node scripts/aplicar-migraciones-staging.mjs [--dry-run]
// (El seed ficticio supabase/seed.sql, 1,5 KB, se carga aparte con execute_sql.)
// El secreto STAGING_DB_URL vive solo en `.env.staging.local` (ignorado por git); nunca por chat.
// Salvaguardas: exige el ref de staging, rechaza producción y local.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REF_STAGING = 'tqkdtojnhgykmcbvwdmz'
const REF_PRODUCCION = 'cmkelllerzjqjbsqsylc'
const f = resolve('.env.staging.local')
const falla = (m) => { console.error('aplicar-migraciones-staging: ' + m); process.exit(1) }
if (!existsSync(f)) falla('falta .env.staging.local')
const linea = readFileSync(f, 'utf8').split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith('STAGING_DB_URL='))
if (!linea) falla('falta STAGING_DB_URL en .env.staging.local (ver comentario del archivo)')
const dbUrl = linea.slice('STAGING_DB_URL='.length).trim()
if (dbUrl.includes(REF_PRODUCCION) || /127\.0\.0\.1|localhost/.test(dbUrl)) falla('esa conexión es producción o local: abortado')
if (!dbUrl.includes(REF_STAGING)) falla('la conexión no corresponde al proyecto de staging ' + REF_STAGING)
const cli = resolve('node_modules/@supabase/cli-windows-x64/bin/supabase.exe')
const args = ['db', 'push', '--db-url', dbUrl, ...(process.argv.includes('--dry-run') ? ['--dry-run'] : [])]
const r = spawnSync(cli, args, { stdio: 'inherit' })
if (r.status !== 0) process.exit(r.status ?? 1)
process.exit(r.status ?? 0)
