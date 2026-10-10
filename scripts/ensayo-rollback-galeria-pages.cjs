// Ensayo del ROLLBACK de URLs de Galería (Pages /medios → r2.dev) sobre UNA fila ficticia de staging.
//   node scripts/ensayo-rollback-galeria-pages.cjs --build-id=<8 hex> --salida=<archivo.json> [--con-objetos]
//
// ESCRIBE en STAGING (requiere autorización específica, NO cubierta por las de las pruebas de caché/UI ni PWA):
//   · SIEMPRE: crea UNA fila propia en galeria_web (id generado ANTES, activo=false, título «QA rollback <id> (borrar)», orden 9999), cambia
//     SUS dos URLs de la base de Pages a la base r2.dev aprobada y la borra. Nunca toca otras filas (ni «Foto de prueba (Inicio)»).
//   · Con --con-objetos: además sube DOS grupos ficticios de fotos-galeria (antes y después, m y g = 4 PUT) por el Worker, para comprobar
//     que la foto sigue cargando tras el rollback; los borra al final. Sin --con-objetos las URLs apuntan a objetos que NO existen: se
//     prueba SOLO la conversión de las URLs en la fila y el reconocimiento del cliente (módulo puro), no la entrega de bytes.
// No retira la Function ni el binding, no cambia variables, no toca el negocio, producción, `main` ni GitHub Pages.
// El flujo vive en scripts/lib/ensayo-rollback.cjs (dependencias inyectadas; regresiones en memoria en
// scripts/verificar-ensayo-rollback-galeria.cjs). Aquí: preflight de marca y entrega ANTES de autenticar, login y dependencias reales.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { chromium } = require('playwright')
const G = require('./lib/guardas-interfaz-r2.cjs')
const { ejecutarEnsayo } = require('./lib/ensayo-rollback.cjs')
const { dependenciasReales } = require('./lib/ensayo-rollback-reales.cjs')

const raiz = path.resolve(__dirname, '..')
const argumento = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').slice(n.length + 3)
const BUILD_ID = argumento('build-id')
const CON_OBJETOS = process.argv.includes('--con-objetos')
const SALIDA = argumento('salida') ? path.resolve(argumento('salida')) : null
const ALIAS = G.ALIAS_APROBADO
const WORKER = G.WORKER_APROBADO
const PAGES = `${ALIAS}/medios`
const R2DEV = G.PUBLICO_APROBADO
const DESTINO = 'fotos-galeria'
const ID_EJECUCION = crypto.randomBytes(3).toString('hex')
const IDS = { idFila: crypto.randomUUID(), idAntes: crypto.randomUUID(), idDespues: crypto.randomUUID(), titulo: `QA rollback ${ID_EJECUCION} (borrar)` }

function leerEnv(ruta) {
  const salida = {}
  for (const linea of fs.readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) salida[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return salida
}
const env = leerEnv(path.join(raiz, '.env.staging.local'))
const SUPA = env.VITE_SUPABASE_URL
const aprobados = new Set([new URL(ALIAS).origin, `https://${G.REF_STAGING}.supabase.co`, WORKER, R2DEV])
const seguro = G.crearFetchSeguro(aprobados, (...a) => fetch(...a))
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

let tokenAdmin
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

;(async () => {
  let informe = { completa: false, estadoFinalConfirmado: false, error: null, casos: [] }
  try {
    if (!SALIDA) throw new Error('--salida=<archivo.json> es obligatorio (evidencia fuera del repo, p. ej. bajo .codex)')
    const U = await import(require('url').pathToFileURL(path.join(raiz, 'src/lib/urlsMedios.js')).href)
    // ---- preflight: marca + entrega `pages` efectiva, ANTES de autenticar o escribir ----
    const { clasificarClave } = await import('./lib/entornos-supabase.mjs')
    const pf = await G.preflight(
      { alias: ALIAS, buildId: BUILD_ID, entrega: 'pages', supabaseUrl: SUPA, claveAnon: env.VITE_SUPABASE_ANON_KEY, emails: [env.QA_ADMIN_EMAIL], clasificarClave },
      async (u) => (await seguro(u)).text())
    console.log(`OK    preflight: el alias sirve ${pf.buildId} con la entrega de medios «pages» efectiva (antes de autenticar)`)
    tokenAdmin = await sesion()

    informe = await ejecutarEnsayo({
      bases: { pages: PAGES, r2dev: R2DEV }, ids: IDS, destino: DESTINO, conObjetos: CON_OBJETOS, U, log: (l) => console.log(l), espera,
      prefijoStorage: `${SUPA}/storage/v1/object/public/${DESTINO}/`,
      ...dependenciasReales({ seguro, supa: SUPA, anon: env.VITE_SUPABASE_ANON_KEY, worker: WORKER, alias: ALIAS, destino: DESTINO, token: () => tokenAdmin, fabricarWebp }),
    })
  } catch (e) {
    informe.error = String(e.message ?? e)
    informe.casos.push({ nombre: 'la corrida terminó sin error', ok: false, detalle: { error: informe.error } })
    console.log(`ERROR: ${informe.error}`)
    informe.resumen = { casos: informe.casos.length, fallos: informe.casos.filter((c) => !c.ok).length }
  } finally {
    const salida = { fecha: new Date().toISOString(), buildId: BUILD_ID, alias: ALIAS, idEjecucion: ID_EJECUCION, titulo: IDS.titulo, idFila: IDS.idFila, conObjetos: CON_OBJETOS, ...informe }
    if (SALIDA) {
      fs.mkdirSync(path.dirname(SALIDA), { recursive: true })
      fs.writeFileSync(SALIDA, JSON.stringify(salida, null, 2))
    }
    console.log(`\n${informe.resumen?.casos ?? informe.casos.length} casos, ${informe.resumen?.fallos ?? 1} fallos; completa=${informe.completa}; estado final confirmado=${informe.estadoFinalConfirmado}${SALIDA ? ` → ${SALIDA}` : ''}`)
    process.exitCode = (informe.resumen?.fallos ?? 1) || !informe.completa ? 1 : 0
  }
})()
