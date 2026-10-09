// Pruebas FICTICIAS de las salvaguardas de backend/clave de los dos entrypoints de build (Fase 2B, B1/B2).
// No usa claves reales ni red: los JWT llevan firma falsa (se prueba la clasificación, no la autenticidad) y se
// ejecuta con --solo-validar (las validaciones corren ANTES de iniciar Vite). Verifica además que el mensaje
// de error nunca contenga la clave y que Vite no llegue a iniciarse. Uso: node scripts/probar-salvaguardas-entornos.mjs [salida.json]
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { REF_PRODUCCION as P, REF_STAGING as S } from './lib/entornos-supabase.mjs'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (payload) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.firmaFicticia_AAAAAAAAAAAAAAAA`
const anon = (ref) => jwt({ iss: 'supabase', ref, role: 'anon' })
const publishable = 'sb_publishable_' + 'A1b2C3d4E5f6G7h8I9j0K1l2'
const secreta = 'sb_secret_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8'
const urlDe = (ref) => `https://${ref}.supabase.co`
const ROTO = `${b64({ alg: 'HS256' })}.%%%no-base64%%%.firma`
const TERCERO = 'abcdefghijklmnopqrst'
const base = { CF_PAGES: '1', CF_PAGES_BRANCH: 'testing', RAMA_PRODUCCION: 'main', VITE_SUPABASE_URL: urlDe(S), VITE_SUPABASE_ANON_KEY: anon(S) }
const prod = { CF_PAGES_BRANCH: 'main', VITE_SUPABASE_URL: urlDe(P), VITE_SUPABASE_ANON_KEY: anon(P) }

const CF = 'scripts/build-cloudflare.mjs'
const PV = 'scripts/build-preview-staging.mjs'
// [nombre, entrypoint, env extra, debe aceptar]
const casos = [
  ['cf preview → staging + anon JWT', CF, {}, true],
  ['cf preview → staging + publishable', CF, { VITE_SUPABASE_ANON_KEY: publishable }, true],
  ['cf producción → negocio + anon JWT', CF, prod, true],
  ['cf producción → negocio + publishable', CF, { ...prod, VITE_SUPABASE_ANON_KEY: publishable }, true],
  ['cf rama de producción configurada distinta de main (cloudflare-produccion) → negocio', CF, { ...prod, CF_PAGES_BRANCH: 'cloudflare-produccion', RAMA_PRODUCCION: 'cloudflare-produccion' }, true],
  ['cf main es PREVIEW si la producción es otra rama → staging', CF, { CF_PAGES_BRANCH: 'main', RAMA_PRODUCCION: 'cloudflare-produccion' }, true],
  ['cf main es PREVIEW si la producción es otra rama → negocio rechazado', CF, { ...prod, RAMA_PRODUCCION: 'cloudflare-produccion' }, false],
  ['cf sb_secret_', CF, { VITE_SUPABASE_ANON_KEY: secreta }, false],
  ['cf JWT service_role', CF, { VITE_SUPABASE_ANON_KEY: jwt({ ref: S, role: 'service_role' }) }, false],
  ['cf JWT authenticated', CF, { VITE_SUPABASE_ANON_KEY: jwt({ ref: S, role: 'authenticated' }) }, false],
  ['cf JWT sin role', CF, { VITE_SUPABASE_ANON_KEY: jwt({ ref: S }) }, false],
  ['cf JWT role no string', CF, { VITE_SUPABASE_ANON_KEY: jwt({ ref: S, role: ['anon'] }) }, false],
  ['cf JWT roto', CF, { VITE_SUPABASE_ANON_KEY: ROTO }, false],
  ['cf cadena arbitraria "x"', CF, { VITE_SUPABASE_ANON_KEY: 'x' }, false],
  ['cf cadena larga arbitraria', CF, { VITE_SUPABASE_ANON_KEY: 'k'.repeat(80) }, false],
  ['cf clave vacía', CF, { VITE_SUPABASE_ANON_KEY: '' }, false],
  ['cf clave ausente', CF, { VITE_SUPABASE_ANON_KEY: undefined }, false],
  ['cf publishable con formato inválido', CF, { VITE_SUPABASE_ANON_KEY: 'sb_publishable_corta' }, false],
  ['cf ref del JWT discordante (anon del negocio en staging)', CF, { VITE_SUPABASE_ANON_KEY: anon(P) }, false],
  ['cf ref del JWT discordante (anon de staging en producción)', CF, { ...prod, VITE_SUPABASE_ANON_KEY: anon(S) }, false],
  ['cf preview → backend del negocio', CF, { VITE_SUPABASE_URL: urlDe(P), VITE_SUPABASE_ANON_KEY: anon(P) }, false],
  ['cf producción → staging', CF, { CF_PAGES_BRANCH: 'main' }, false],
  ['cf tercer host Supabase', CF, { VITE_SUPABASE_URL: urlDe(TERCERO), VITE_SUPABASE_ANON_KEY: anon(TERCERO) }, false],
  ['cf host no Supabase', CF, { VITE_SUPABASE_URL: 'https://ejemplo.com' }, false],
  ['cf URL local', CF, { VITE_SUPABASE_URL: 'http://127.0.0.1:54321' }, false],
  ['cf URL http', CF, { VITE_SUPABASE_URL: `http://${S}.supabase.co` }, false],
  ['cf URL con ruta', CF, { VITE_SUPABASE_URL: urlDe(S) + '/rest/v1' }, false],
  ['cf URL con credenciales', CF, { VITE_SUPABASE_URL: `https://u:p@${S}.supabase.co` }, false],
  ['cf URL vacía', CF, { VITE_SUPABASE_URL: '' }, false],
  ['cf rama ausente', CF, { CF_PAGES_BRANCH: '' }, false],
  ['cf RAMA_PRODUCCION ausente', CF, { RAMA_PRODUCCION: '' }, false],
  ['preview-staging: staging + anon JWT', PV, {}, true],
  ['preview-staging: staging + publishable', PV, { VITE_SUPABASE_ANON_KEY: publishable }, true],
  ['preview-staging: sb_secret_', PV, { VITE_SUPABASE_ANON_KEY: secreta }, false],
  ['preview-staging: JWT service_role', PV, { VITE_SUPABASE_ANON_KEY: jwt({ ref: S, role: 'service_role' }) }, false],
  ['preview-staging: JWT authenticated', PV, { VITE_SUPABASE_ANON_KEY: jwt({ ref: S, role: 'authenticated' }) }, false],
  ['preview-staging: JWT roto', PV, { VITE_SUPABASE_ANON_KEY: ROTO }, false],
  ['preview-staging: cadena arbitraria larga', PV, { VITE_SUPABASE_ANON_KEY: 'k'.repeat(80) }, false],
  ['preview-staging: cadena "x"', PV, { VITE_SUPABASE_ANON_KEY: 'x' }, false],
  ['preview-staging: ref discordante', PV, { VITE_SUPABASE_ANON_KEY: anon(P) }, false],
  ['preview-staging: URL del negocio', PV, { VITE_SUPABASE_URL: urlDe(P), VITE_SUPABASE_ANON_KEY: anon(P) }, false],
  ['preview-staging: tercer host', PV, { VITE_SUPABASE_URL: urlDe(TERCERO), VITE_SUPABASE_ANON_KEY: anon(TERCERO) }, false],
  ['preview-staging: URL local', PV, { VITE_SUPABASE_URL: 'http://127.0.0.1:54321' }, false],
]

const resultados = []
for (const [nombre, entry, extra, debeAceptar] of casos) {
  const baseEnv = entry === CF ? base : { VITE_SUPABASE_URL: urlDe(S), VITE_SUPABASE_ANON_KEY: anon(S) }
  const env = { ...process.env, ...baseEnv, ...extra }
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k]
  const r = spawnSync(process.execPath, [entry, '--solo-validar'], { env, encoding: 'utf8', cwd: process.cwd() })
  const salida = `${r.stdout}${r.stderr}`
  const clave = env.VITE_SUPABASE_ANON_KEY
  const filtra = !!clave && clave.length > 12 && salida.includes(clave)
  const inicioVite = /vite v\d|building for production|transforming/i.test(salida)
  const acepta = r.status === 0
  resultados.push({
    caso: nombre,
    esperado: debeAceptar ? 'acepta' : 'rechaza',
    obtenido: acepta ? 'acepta' : 'rechaza',
    ok: acepta === debeAceptar && !filtra && !inicioVite,
    filtraClave: filtra,
    inicioVite,
    mensaje: acepta ? undefined : salida.trim().split('\n').pop().slice(0, 170),
  })
}
const fallos = resultados.filter((r) => !r.ok)
for (const r of resultados) console.log(`${r.ok ? 'OK   ' : 'FALLA'} ${r.caso} → ${r.obtenido}${r.mensaje ? ' · ' + r.mensaje : ''}`)
console.log(`\n${resultados.length} casos, ${fallos.length} fallos`)
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ fecha: new Date().toISOString(), total: resultados.length, fallos: fallos.length, resultados }, null, 2))
process.exit(fallos.length ? 1 : 0)
