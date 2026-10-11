// ENSAYO DE CARGA de la entrega /medios con B activa (plan V2 de Codex §5). NO ejecutado todavía: requiere revisión de Codex y autorización.
//   node scripts/ensayo-carga-medios.cjs --build-id=<8 hex> --salida=<carpeta>
//
// ESCRIBE en STAGING (autorización específica): dos grupos ficticios de fotos-galeria (A y B), 4 PUT por el Worker. Sin filas de BD.
//   · Grupo A recibe la carga (niveles 1/5/10, 3 muestras, tope 450 lecturas y 10 simultáneas; parada ante 429/5xx repetidos, bytes o ETag
//     distintos, estado inesperado o fallo de red; nunca sube la carga por su cuenta). Después se calientan m y g, se borra A y se evalúa la
//     RETIRADA con el mismo veredicto por POP que el verificador de caché (CB-01).
//   · Grupo B es CONTROL: tras borrar A debe seguir sirviéndose 200 (el borrado es selectivo). Luego se borra.
//   · Limpieza solo de los dos grupos propios y comprobación del inventario inicial. Sin auth repetida: un único login.
// Las latencias son del CLIENTE: CPU y cuota se leen aparte en el panel de Cloudflare (antes/después), sin atribuir los agregados de 24 h.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { chromium } = require('playwright')
const G = require('./lib/guardas-interfaz-r2.cjs')
const { ejecutarEnsayoCarga, crearLeerUrl } = require('./lib/ensayo-carga-flujo.cjs')

const raiz = path.resolve(__dirname, '..')
const argumento = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').slice(n.length + 3)
const BUILD_ID = argumento('build-id')
const SALIDA = argumento('salida') ? path.resolve(argumento('salida')) : null
const ALIAS = G.ALIAS_APROBADO
const WORKER = G.WORKER_APROBADO
const BASE = `${ALIAS}/medios`
const DESTINO = 'fotos-galeria'
const ID_EJECUCION = crypto.randomBytes(3).toString('hex')
const GRUPOS = { A: crypto.randomUUID(), B: crypto.randomUUID() }

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
const aprobados = new Set([new URL(ALIAS).origin, `https://${G.REF_STAGING}.supabase.co`, WORKER])
const seguro = G.crearFetchSeguro(aprobados, (...a) => fetch(...a))
const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const url = (grupo, v) => `${BASE}/${DESTINO}/${GRUPOS[grupo]}/${v}.webp`

let tokenAdmin
async function sesion() {
  const r = await seguro(`${SUPA}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: env.QA_ADMIN_EMAIL, password: env.QA_ADMIN_PASSWORD }) })
  if (!r.ok) throw new Error('login QA rechazado')
  return (await r.json()).access_token
}
const cab = () => ({ Authorization: `Bearer ${tokenAdmin}`, Origin: ALIAS })
const inventario = () => G.leerInventario([DESTINO], async (d) => {
  const r = await seguro(`${WORKER}/v1/inventario/${d}`, { headers: cab() })
  return { estado: r.status, cuerpo: await r.json().catch(() => null) }
})

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
    if (!SALIDA) throw new Error('--salida=<carpeta> es obligatorio (evidencia fuera del repo, p. ej. bajo .codex)')
    const { clasificarClave } = await import('./lib/entornos-supabase.mjs')
    const pf = await G.preflight(
      { alias: ALIAS, buildId: BUILD_ID, entrega: 'pages', supabaseUrl: SUPA, claveAnon: env.VITE_SUPABASE_ANON_KEY, emails: [env.QA_ADMIN_EMAIL, env.QA_CLIENTE_EMAIL], clasificarClave },
      async (u) => (await seguro(u)).text())
    console.log(`OK    preflight: el alias sirve ${pf.buildId} con la entrega «pages» efectiva (antes de autenticar)`)
    tokenAdmin = await sesion()
    informe = await ejecutarEnsayoCarga({
      ids: GRUPOS, destino: DESTINO, log: (l) => console.log(l),
      deps: {
        inventario, fabricarWebp, espera,
        subir: async (grupo, v, cuerpo) => (await seguro(`${WORKER}/v1/medios/${DESTINO}/${GRUPOS[grupo]}/${v}`, { method: 'PUT', headers: { ...cab(), 'Content-Type': 'image/webp' }, body: cuerpo })).status,
        borrarPrefijo: async (pre) => (await seguro(`${WORKER}/v1/medios/${pre.replace(/\/$/, '')}`, { method: 'DELETE', headers: cab() })).status,
        leerUrl: crearLeerUrl({ seguro, url }),
      },
    })
  } catch (e) {
    informe.error = String(e.message ?? e)
    informe.casos.push({ nombre: 'la corrida terminó sin error', ok: false, detalle: { error: informe.error } })
    console.log(`ERROR: ${informe.error}`)
    informe.resumen = { casos: informe.casos.length, fallos: informe.casos.filter((c) => !c.ok).length }
  } finally {
    const salida = { fecha: new Date().toISOString(), buildId: BUILD_ID, alias: ALIAS, idEjecucion: ID_EJECUCION, grupos: GRUPOS, nota: 'Latencias del cliente; no CPU ni cuota. Retirada acreditada solo en los POP observados.', ...informe }
    if (SALIDA) {
      fs.mkdirSync(SALIDA, { recursive: true })
      fs.writeFileSync(path.join(SALIDA, `carga-${ID_EJECUCION}.json`), JSON.stringify(salida, null, 2))
    }
    console.log(`
${informe.resumen?.casos ?? informe.casos.length} casos, ${informe.resumen?.fallos ?? 1} fallos; completa=${informe.completa}; estado final confirmado=${informe.estadoFinalConfirmado}`)
    process.exitCode = (informe.resumen?.fallos ?? 1) || !informe.completa ? 1 : 0
  }
})()
