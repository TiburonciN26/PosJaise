// Prueba del verificador de actualización PWA (Fase 2B): estados positivos y negativos, en local contra el
// Supabase de STAGING (cuentas QA ficticias de .env.staging.local). No publica nada fuera de la máquina.
// Uso: node scripts/probar-verificador-pwa.mjs [salida.json]
// Construye A y B (marcas exactas) desde el código ACTUAL, así que prueba también la protección de «Actualizar».
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { REF_PRODUCCION } from './lib/entornos-supabase.mjs'

const A = 'dist-preview-ens-a'
const B = 'dist-preview-ens-b'
const run = (args, opts = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', ...opts })
for (const [dir, id] of [[A, 'ensayo-a'], [B, 'ensayo-b']]) {
  const r = run(['scripts/build-preview-staging.mjs', `--out=${dir}`, `--build-id=${id}`])
  if (r.status !== 0) { console.error(r.stdout + r.stderr); process.exit(1) }
}
const tmp = mkdtempSync(join(tmpdir(), 'pwa-prueba-'))
const jsonDe = (f) => JSON.parse(readFileSync(f, 'utf8'))
const resultados = []
let puerto = 4190

function escenario(nombre, extra, esperar) {
  const salida = join(tmp, `${puerto}.json`)
  const r = run(['scripts/verificar-actualizacion-pwa.cjs', A, B, 'ensayo-a', 'ensayo-b', String(puerto++), salida, ...extra], { stdio: ['ignore', 'pipe', 'pipe'] })
  let j = null
  try { j = jsonDe(salida) } catch { /* sin salida */ }
  const ver = esperar({ exit: r.status, j })
  resultados.push({ escenario: nombre, ok: ver.ok, detalle: ver.detalle, exit: r.status, resultado: j?.resultado, publicacionEjecutada: j?.publicacionEjecutada ?? false, pasosFallidos: (j?.pasos ?? []).filter((p) => !p.ok).map((p) => p.n) })
  console.log(`${ver.ok ? 'OK   ' : 'FALLA'} ${nombre} — ${ver.detalle}`)
  return j
}
const paso = (j, texto) => (j?.pasos ?? []).find((p) => p.n.includes(texto))
const positivo = (estado) => escenario(`positivo · estado=${estado}`, [`--estado=${estado}`], ({ exit, j }) => ({
  ok: exit === 0 && j.resultado === 'OK' && j.publicacionEjecutada === true && (j.pasos ?? []).every((p) => p.ok),
  detalle: `exit=${exit} publicada=${j?.publicacionEjecutada} pasos=${j?.pasos?.length}`,
}))

const v = positivo('vacio')
console.log('   · vacio: «Actualizar» habilitado sin bloqueo →', paso(v, 'sin trabajo pendiente')?.ok)
const c = positivo('venta')
console.log('   · venta: botón deshabilitado →', paso(c, 'DESHABILITADO')?.ok, '| carrito no se perdió →', paso(c, 'carrito NO se perdió')?.ok, '| se habilita al vaciar →', paso(c, 'se habilita solo')?.ok)
const w = positivo('ventana')
const at = positivo('atras')
console.log('   · atras: bloqueado con el diálogo en página oculta →', paso(at, 'página OCULTA')?.ok, '| sigue bloqueado al volver →', paso(at, 'al volver a /ventas')?.ok, '| se habilita al cerrar →', paso(at, 'sin bloqueo permanente')?.ok)
const dd = positivo('dos-dialogos')
console.log('   · dos-dialogos: Esc solo cierra el visible →', paso(dd, 'Esc cierra solo el diálogo VISIBLE')?.ok, '| se habilita al cerrar el último →', paso(dd, 'sin bloqueo permanente')?.ok)
console.log('   · ventana: botón deshabilitado →', paso(w, 'DESHABILITADO')?.ok, '| se habilita al cerrar →', paso(w, 'se habilita solo')?.ok)

// Negativo: A con marca incorrecta → no continúa ni publica B
escenario('negativo · A con marca incorrecta (no se publica)', ['--estado=vacio', '--a-esperada=marca-que-no-es'], ({ exit, j }) => ({
  ok: exit !== 0 && j?.resultado === 'FALLA' && j.publicacionEjecutada === false && j.publicadoB === false && !paso(j, 'aparece el aviso') && !!paso(j, 'A: el documento tiene EXACTAMENTE la marca esperada') && paso(j, 'A: el documento')?.ok === false,
  detalle: `exit=${exit} publicada=${j?.publicacionEjecutada} sinPasoDeAviso=${!paso(j, 'aparece el aviso')}`,
}))

// Negativo: origen local NO permitido (falta --permitir-local) → falla antes del navegador/login
escenario('negativo · origen no permitido (preflight, sin login)', ['--estado=vacio', '--sin-permitir-local'], ({ exit, j }) => ({
  ok: exit !== 0 && j?.resultado === 'FALLA' && j.publicacionEjecutada === false && !(j.pasos ?? []).some((p) => p.n.startsWith('A:')) && /preflight/.test(j.motivo ?? ''),
  detalle: `exit=${exit} motivo=${j?.motivo?.slice(0, 60)}`,
}))

// Negativo: backend no aprobado en el archivo de entorno (URL del negocio) → falla antes del login
const envMalo = join(tmp, 'env-malo')
writeFileSync(envMalo, [
  `VITE_SUPABASE_URL=https://${REF_PRODUCCION}.supabase.co`,
  `VITE_SUPABASE_ANON_KEY=sb_publishable_${'A1b2C3d4E5f6G7h8I9j0K1l2'}`,
  'QA_ADMIN_EMAIL=qa-admin@staging.test', 'QA_ADMIN_PASSWORD=ficticia-no-se-usa',
].join('\n'))
escenario('negativo · backend no aprobado (negocio) en el entorno (preflight, sin login)', ['--estado=vacio', `--env-file=${envMalo}`], ({ exit, j }) => ({
  ok: exit !== 0 && j?.resultado === 'FALLA' && j.publicacionEjecutada === false && !(j.pasos ?? []).some((p) => p.n.startsWith('A:')) && (j.pasos ?? []).some((p) => !p.ok && /preflight: Supabase/.test(p.n)),
  detalle: `exit=${exit} publicada=${j?.publicacionEjecutada}`,
}))

rmSync(tmp, { recursive: true, force: true })
const fallos = resultados.filter((r) => !r.ok)
console.log(`\n${resultados.length} escenarios, ${fallos.length} fallos`)
if (process.argv[2]) writeFileSync(resolve(process.argv[2]), JSON.stringify({ fecha: new Date().toISOString(), total: resultados.length, fallos: fallos.length, resultados }, null, 2))
process.exit(fallos.length ? 1 : 0)
