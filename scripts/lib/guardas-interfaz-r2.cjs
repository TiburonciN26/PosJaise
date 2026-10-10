// Salvaguardas de scripts/verificar-interfaz-r2-preview.cjs, separadas para poder probarlas SIN red ni navegador
// (scripts/verificar-guardas-interfaz-r2.cjs). Fase 3 · revisión IP-R1 / IP-R2 de Codex.
//
// IP-R1: validar destinos y artefacto ANTES de autenticar o escribir; bloquear tráfico a destinos no aprobados en TODOS
//        los contextos del navegador y en las peticiones del propio script.
// IP-R2: comprobar el estado inicial, limitar la limpieza a lo que ESTA ejecución creó y comparar claves, no cardinalidades.

const REF_STAGING = 'tqkdtojnhgykmcbvwdmz'
const REF_NEGOCIO = 'cmkelllerzjqjbsqsylc'
const ALIAS_APROBADO = 'https://feat-cloudflare-pages.pos-jaise.pages.dev'
const WORKER_APROBADO = 'https://pos-jaise-medios-staging.jdeostuas2.workers.dev'
const PUBLICO_APROBADO = 'https://pub-b248edba3e19402382b557a35b33c674.r2.dev'
const DOMINIO_CUENTAS_QA = '@staging.test'
const TITULO_BASE = 'QA R2 UI'

/** Origen exacto (esquema + host + puerto) de una URL, o null si no es una URL absoluta válida. */
function origenDe(valor) {
  try { return new URL(valor).origin } catch { return null }
}

/** true solo si `valor` es EXACTAMENTE el origen aprobado: sin ruta, sin query, sin fragmento, sin credenciales. */
function esOrigenExacto(valor, aprobado) {
  let u
  try { u = new URL(valor) } catch { return false }
  return u.protocol === 'https:' && u.origin === aprobado && (u.pathname === '/' || u.pathname === '') && !u.search && !u.hash && !u.username && !u.password
}

/**
 * Valida TODO lo que se puede validar sin red. Lanza Error con el motivo (sin valores secretos) ante cualquier discrepancia.
 * @param {{alias:string, buildId:string, supabaseUrl:string, claveAnon:string, emails:string[], clasificarClave:Function}} p
 */
function validarConfiguracion(p) {
  if (!/^[0-9a-f]{8}$/.test(p.buildId ?? '')) throw new Error('--build-id=<8 hex> es obligatorio (marca esperada del artefacto)')
  if (!esOrigenExacto(p.alias, ALIAS_APROBADO)) throw new Error('el alias no es el origen aprobado de Pages Preview')
  if (!esOrigenExacto(p.supabaseUrl, `https://${REF_STAGING}.supabase.co`)) throw new Error('VITE_SUPABASE_URL no es EXACTAMENTE el Supabase de staging')
  const c = p.clasificarClave(p.claveAnon, REF_STAGING)
  if (!c?.ok) throw new Error(`la clave pública no es válida: ${c?.motivo ?? 'desconocida'}`)
  for (const e of p.emails) {
    if (typeof e !== 'string' || !e.toLowerCase().endsWith(DOMINIO_CUENTAS_QA)) throw new Error(`cuenta fuera de las QA ficticias (${DOMINIO_CUENTAS_QA})`)
  }
}

/**
 * Orden fijo: configuración → artefacto del alias → (solo entonces) el llamador puede autenticar.
 * `pedirHtml(url)` es la ÚNICA petición que sale aquí; nunca se llama a Supabase ni al Worker.
 */
async function preflight(p, pedirHtml) {
  validarConfiguracion(p)
  const html = await pedirHtml(`${p.alias}/`)
  const marca = (String(html).match(/name="build-id" content="([^"]*)"/) ?? [])[1]
  if (marca !== p.buildId) throw new Error(`el artefacto del alias (${marca ?? 'sin marca'}) no es el esperado (${p.buildId}); no se autentica ni se escribe nada`)
  return { buildId: marca }
}

/** Clasifica un destino de red: 'permitido' | 'prohibido'. Lista cerrada por origen; lo desconocido de las familias sensibles se prohíbe. */
function clasificarDestino(url, aprobados) {
  let u
  try { u = new URL(url) } catch { return 'permitido' } // data:, blob:, about: no salen de la máquina
  if (['data:', 'blob:', 'about:'].includes(u.protocol)) return 'permitido'
  const h = u.hostname
  if (aprobados.has(u.origin)) return 'permitido'
  if (h.endsWith('supabase.co') || h.endsWith('supabase.in')) return 'prohibido' // cualquier otro Supabase (negocio incluido)
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.local')) return 'prohibido' // Supabase local y servidores del equipo
  if (/culqi/i.test(h)) return 'prohibido' // pasarelas
  if (h.endsWith('workers.dev') || h.endsWith('r2.dev') || h.endsWith('pages.dev') || h.endsWith('r2.cloudflarestorage.com')) return 'prohibido' // otro Worker/bucket/Preview
  if (u.href.includes(REF_NEGOCIO)) return 'prohibido'
  return 'permitido' // fuentes, analítica de terceros sin credenciales: no llevan datos de la prueba
}

/** Instala el bloqueo en un contexto de Playwright (admin, cliente o cualquier otro). Registra y ABORTA lo prohibido. */
function instalarBloqueo(contexto, etiqueta, aprobados, bloqueadas) {
  return contexto.route('**/*', (route) => {
    const url = route.request().url()
    if (clasificarDestino(url, aprobados) === 'prohibido') {
      bloqueadas.push(`${etiqueta}: ${route.request().method()} ${new URL(url).origin}`)
      return route.abort('blockedbyclient')
    }
    return route.continue()
  })
}

/** fetch del propio script: LISTA CERRADA de orígenes (el navegador, en cambio, solo prohíbe familias sensibles y deja pasar p. ej. fuentes): lanza ANTES de enviar nada y no sigue redirecciones. */
function crearFetchSeguro(aprobados, fetchReal) {
  return (url, opciones) => {
    if (!aprobados.has(origenDe(url))) throw new Error(`destino no aprobado para el script: ${origenDe(url)}`)
    // `redirect: 'error'` va DESPUÉS del spread: el llamador no puede anularlo. Una redirección (307/308 conservan método, cabeceras y cuerpo)
    // enviaría credenciales a un origen que la lista cerrada no validó; se rechaza en vez de seguirla.
    return fetchReal(url, { ...opciones, redirect: 'error' })
  }
}

/** Marca única por ejecución: la fila de Galería de ESTA corrida se identifica por su id, no por un título compartido. */
function tituloDeEjecucion(idEjecucion) {
  return `${TITULO_BASE} ${idEjecucion} (borrar)`
}

/** Inventario ESTRICTO: una lectura fallida o malformada es un error, nunca «lista vacía». Devuelve Set de claves completas. */
async function leerInventario(destinos, pedir) {
  const claves = new Set()
  for (const d of destinos) {
    const r = await pedir(d)
    if (!r || r.estado !== 200 || !Array.isArray(r.cuerpo?.objetos)) throw new Error(`inventario ilegible para ${d} (estado ${r?.estado ?? 'sin respuesta'})`)
    // El Worker lista hasta 500 objetos por llamada y devuelve `cursor`: este lector no pagina, así que NO declara un snapshot completo.
    if (r.cuerpo.cursor) throw new Error(`inventario paginado en ${d} (cursor presente): el snapshot no sería completo`)
    for (const o of r.cuerpo.objetos) {
      if (typeof o?.clave !== 'string' || o.clave === '') throw new Error(`inventario con una clave inválida en ${d}`)
      claves.add(o.clave)
    }
  }
  return claves
}

const grupoDeClave = (clave) => clave.split('/').slice(0, 2).join('/')
const gruposDe = (claves) => new Set([...claves].map(grupoDeClave))

/** Diferencia exacta de conjuntos (no solo tamaños): qué claves aparecieron y cuáles desaparecieron. */
function diferenciaInventario(base, actual) {
  return { nuevas: [...actual].filter((c) => !base.has(c)).sort(), faltantes: [...base].filter((c) => !actual.has(c)).sort() }
}

/** Precondición de los fixtures: sin foto principal ni galería. Devuelve la lista de motivos (vacía = seguro). */
function precondicionFixtures({ producto, servicio, galeriaProducto, galeriaServicio }) {
  const motivos = []
  if (!producto) motivos.push('producto no encontrado')
  else if (producto.foto_url !== null) motivos.push('el producto ya tiene foto principal')
  if (!servicio) motivos.push('servicio no encontrado')
  else if (servicio.foto_url !== null) motivos.push('el servicio ya tiene foto principal')
  if (!Array.isArray(galeriaProducto) || galeriaProducto.length) motivos.push('el producto ya tiene fotos de galería (o no se pudo leer)')
  if (!Array.isArray(galeriaServicio) || galeriaServicio.length) motivos.push('el servicio ya tiene fotos de galería (o no se pudo leer)')
  return motivos
}

/** Igualdad profunda de snapshots JSON (orden de claves irrelevante). */
function iguales(a, b) {
  return JSON.stringify(ordenar(a)) === JSON.stringify(ordenar(b))
}
function ordenar(v) {
  if (Array.isArray(v)) return v.map(ordenar)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar(v[k])]))
  return v
}

/**
 * Qué filas de galería_web puede borrar la limpieza de emergencia: SOLO la creada por esta ejecución (por id exacto)
 * y solo si todavía existe. Nunca por título; nunca ante lecturas fallidas (filas === null).
 */
function planLimpiezaGaleria(filas, idPropio) {
  if (!Array.isArray(filas) || !idPropio) return []
  return filas.filter((f) => f.id === idPropio).map((f) => f.id)
}

/** Grupos de objetos (destino/uuid) que referencia la fila PROPIA de galería_web en el dominio público aprobado; nada más. */
function gruposPropiosDeFila(fila, publico = PUBLICO_APROBADO) {
  if (!fila) return []
  return [fila.antes_url, fila.despues_url]
    .filter((u) => typeof u === 'string' && u.startsWith(`${publico}/`))
    .map((u) => u.slice(publico.length + 1).split('/').slice(0, 2).join('/'))
    .filter((g) => /^fotos-galeria\/[0-9a-f-]{36}$/.test(g))
}

/**
 * Limpieza de emergencia de la fila PROPIA con el orden seguro: primero la fila, CONFIRMADA por relectura (un DELETE de PostgREST
 * responde 2xx aunque RLS no borre nada, y una respuesta perdida puede haber confirmado o no); solo si ya no existe se borran los
 * objetos que referenciaba. Ante rechazo o incertidumbre se CONSERVAN los objetos (ninguna fila queda apuntando a archivos borrados).
 * Los contadores reflejan solo resultados confirmados.
 */
async function limpiarFilaPropia({ fila, borrarFila, releerFila, borrarGrupo, publico = PUBLICO_APROBADO }) {
  const r = { filaEliminada: false, objetosEliminados: 0, pendientes: [], motivo: null }
  if (!fila) return { ...r, motivo: 'sin fila propia' }
  try { await borrarFila(fila.id) } catch { /* resultado incierto: se reconcilia leyendo */ }
  let filas = null
  try { filas = await releerFila() } catch { filas = null }
  if (!Array.isArray(filas)) return { ...r, motivo: 'estado de la fila desconocido: se conservan sus objetos', pendientes: [`galeria_web:${fila.id}`] }
  if (filas.some((x) => x.id === fila.id)) return { ...r, motivo: 'la fila sigue existiendo (DELETE rechazado o sin efecto): se conservan sus objetos', pendientes: [`galeria_web:${fila.id}`] }
  r.filaEliminada = true
  for (const grupo of gruposPropiosDeFila(fila, publico)) {
    let ok = false
    try { ok = (await borrarGrupo(grupo)) === 200 } catch { ok = false }
    if (ok) r.objetosEliminados++
    else r.pendientes.push(`objeto:${grupo}`)
  }
  return r
}

module.exports = {
  limpiarFilaPropia,
  gruposPropiosDeFila,
  REF_STAGING, REF_NEGOCIO, ALIAS_APROBADO, WORKER_APROBADO, PUBLICO_APROBADO, DOMINIO_CUENTAS_QA,
  origenDe, esOrigenExacto, validarConfiguracion, preflight, clasificarDestino, instalarBloqueo, crearFetchSeguro,
  tituloDeEjecucion, leerInventario, gruposDe, grupoDeClave, diferenciaInventario, precondicionFixtures, iguales, planLimpiezaGaleria,
}
