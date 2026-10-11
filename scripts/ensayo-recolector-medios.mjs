// ENSAYO REAL (staging) del recolector de huérfanos con borrado SELECTIVO sobre UUID propios. NO ejecutado todavía: requiere revisión de
// Codex y una autorización específica de escrituras/borrados.
//   node scripts/ensayo-recolector-medios.mjs --build-id=<8 hex> --salida=<carpeta>
//
// ESCRIBE en STAGING: 2 grupos ficticios de fotos-galeria (4 PUT), UNA fila ficticia de galeria_web (activo=false) que referencia solo el
// grupo «protegido», y borra por el recolector SOLO el grupo huérfano propio usando un reloj simulado (+15 días) que existe únicamente
// aquí. Las fuentes del recolector están ACOTADAS a esos dos grupos: nunca ve ni toca objetos o filas ajenas. No modifica el recolector
// habitual ni su retención de 14 días, no lo programa, no toca el negocio, producción, main ni GitHub Pages.
// Limpieza: la fila propia por id (relectura) y solo después los objetos propios; estado final = inventario y filas iniciales.
import { createRequire } from 'node:module'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { crearFuentes } from './medios-huerfanos.mjs'
import { ejecutarEnsayoRecolector } from './lib/ensayo-recolector.mjs'
import { clasificarClave } from './lib/entornos-supabase.mjs'

const require = createRequire(import.meta.url)
const G = require('./lib/guardas-interfaz-r2.cjs')
const { dependenciasReales } = require('./lib/ensayo-rollback-reales.cjs')

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').slice(n.length + 3)
const BUILD_ID = arg('build-id')
const SALIDA = arg('salida') ? resolve(arg('salida')) : null
const ALIAS = G.ALIAS_APROBADO
const WORKER = G.WORKER_APROBADO
const DESTINO = 'fotos-galeria'
const ID_EJECUCION = randomBytes(3).toString('hex')
const IDS = { protegido: randomUUID(), huerfano: randomUUID(), fila: randomUUID(), titulo: `QA recolector ${ID_EJECUCION} (borrar)` }

function leerEnv(ruta) {
  const salida = {}
  for (const linea of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) salida[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return salida
}
const env = leerEnv(join(raiz, '.env.staging.local'))
const SUPA = env.VITE_SUPABASE_URL
const aprobados = new Set([new URL(ALIAS).origin, `https://${G.REF_STAGING}.supabase.co`, WORKER])
const seguro = G.crearFetchSeguro(aprobados, (...a) => fetch(...a))

let token
async function sesion() {
  const r = await seguro(`${SUPA}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: env.QA_ADMIN_EMAIL, password: env.QA_ADMIN_PASSWORD }) })
  if (!r.ok) throw new Error('login QA rechazado')
  return (await r.json()).access_token
}
async function fabricarWebp(lado) {
  const nav = await chromium.launch()
  try {
    const pagina = await nav.newPage()
    const b64 = await pagina.evaluate(async (l) => {
      const c = document.createElement('canvas'); c.width = l; c.height = l
      const g = c.getContext('2d'); const grad = g.createLinearGradient(0, 0, l, l)
      grad.addColorStop(0, '#d4af37'); grad.addColorStop(1, '#8b2252'); g.fillStyle = grad; g.fillRect(0, 0, l, l)
      const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.8))
      const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''
      for (const b of buf) s += String.fromCharCode(b)
      return btoa(s)
    }, lado)
    return Buffer.from(b64, 'base64')
  } finally { await nav.close() }
}

let informe = { completa: false, estadoFinalConfirmado: false, error: null, casos: [] }
try {
  if (!SALIDA) throw new Error('--salida=<carpeta> es obligatorio (evidencia fuera del repo, p. ej. bajo .codex)')
  const pf = await G.preflight(
    { alias: ALIAS, buildId: BUILD_ID, entrega: 'pages', supabaseUrl: SUPA, claveAnon: env.VITE_SUPABASE_ANON_KEY, emails: [env.QA_ADMIN_EMAIL], clasificarClave },
    async (u) => (await seguro(u)).text())
  console.log(`OK    preflight: el alias sirve ${pf.buildId} con la entrega «pages» efectiva (antes de autenticar)`)
  token = await sesion()
  const reales = dependenciasReales({ seguro, supa: SUPA, anon: env.VITE_SUPABASE_ANON_KEY, worker: WORKER, alias: ALIAS, destino: DESTINO, token: () => token, fabricarWebp })
  const fuentes = await crearFuentes({ api: WORKER, supabaseUrl: SUPA, anonKey: env.VITE_SUPABASE_ANON_KEY, email: env.QA_ADMIN_EMAIL, password: env.QA_ADMIN_PASSWORD })
  informe = await ejecutarEnsayoRecolector({
    ids: IDS, destino: DESTINO, bases: { pages: `${ALIAS}/medios` }, log: (l) => console.log(l),
    deps: {
      fuentes, ahora: () => Date.now(), fabricarWebp,
      inventario: reales.leerInventario, leerFilas: reales.leerFilas, insertarFila: reales.insertarFila, borrarFila: reales.borrarFila,
      subir: reales.subir, borrarPrefijo: reales.borrarGrupo,
    },
  })
} catch (e) {
  informe.error = String(e.message ?? e)
  informe.casos.push({ nombre: 'la corrida terminó sin error', ok: false, detalle: { error: informe.error } })
  console.log(`ERROR: ${informe.error}`)
  informe.resumen = { casos: informe.casos.length, fallos: informe.casos.filter((c) => !c.ok).length }
} finally {
  const salida = { fecha: new Date().toISOString(), buildId: BUILD_ID, alias: ALIAS, idEjecucion: ID_EJECUCION, ids: IDS, nota: 'Reloj simulado SOLO en este harness: no verifica el envejecimiento real en Cloudflare.', ...informe }
  if (SALIDA) {
    mkdirSync(SALIDA, { recursive: true })
    writeFileSync(join(SALIDA, `recolector-${ID_EJECUCION}.json`), JSON.stringify(salida, null, 2))
  }
  console.log(`\n${informe.resumen?.casos ?? informe.casos.length} casos, ${informe.resumen?.fallos ?? 1} fallos; completa=${informe.completa}; estado final confirmado=${informe.estadoFinalConfirmado}`)
  process.exit((informe.resumen?.fallos ?? 1) || !informe.completa ? 1 : 0) // supabase-js mantiene un temporizador de sesión
}
