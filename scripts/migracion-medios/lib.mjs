// Fase 9 · Migración de medios existentes (Supabase Storage → R2). Funciones PURAS: sin red, sin Supabase, sin disco.
// Se prueban en Node con scripts/migracion-medios/probar-lib.mjs.
//
// Principios (ver .codex/DISENO-MIGRACION-MEDIOS-FASE9.md):
//   · Solo se copian medios PÚBLICOS DE CATÁLOGO (productos, servicios, galería): los únicos destinos que acepta el Worker.
//   · Perfiles (usuarios, clientes, asistentes), QR de pagos y mobiliario quedan FUERA de alcance (requieren decisión explícita).
//   · Los buckets PRIVADOS (comprobantes) se excluyen siempre y cualquier intento de incluirlos aborta.
//   · Nada se borra: ni el original en Supabase ni la copia en R2. La herramienta no tiene operaciones de borrado.
//   · El checksum confiable es el SHA-256 de los bytes descargados, no el ETag (que en multipart no es un hash del contenido).
import { createHash } from 'node:crypto'

export const DESTINOS_R2 = ['fotos-productos', 'fotos-servicios', 'fotos-galeria']

// Clasificación de privacidad por bucket (inventario de supabase/migrations: 042, 046, 063, 069, 083, 098, 100, 126 y qr-pagos).
export const PRIVACIDAD = {
  'fotos-productos': 'publico-catalogo',
  'fotos-servicios': 'publico-catalogo',
  'fotos-galeria': 'publico-catalogo',
  'fotos-usuarios': 'publico-personal',
  'fotos-clientes': 'publico-personal',
  'fotos-asistentes': 'publico-personal',
  'qr-pagos': 'publico-negocio',
  'comprobantes-pedidos-web': 'privado',
  'comprobantes-citas-web': 'privado',
}
export const BUCKETS_PRIVADOS = Object.keys(PRIVACIDAD).filter((b) => PRIVACIDAD[b] === 'privado')

// Columnas con referencias a medios. `forma`: 'ruta' (ruta dentro del bucket o "r2:…"), 'url' (URL completa ya resuelta,
// o ruta relativa a /public del build: así guarda la galería) o 'directa' (lo que el usuario pegó; se muestra tal cual).
export const COLUMNAS = [
  { tabla: 'productos', columna: 'foto_url', bucket: 'fotos-productos', forma: 'ruta' },
  { tabla: 'producto_fotos', columna: 'foto_url', bucket: 'fotos-productos', forma: 'ruta' },
  { tabla: 'servicios', columna: 'foto_url', bucket: 'fotos-servicios', forma: 'ruta' },
  { tabla: 'servicio_fotos', columna: 'foto_url', bucket: 'fotos-servicios', forma: 'ruta' },
  { tabla: 'galeria_web', columna: 'antes_url', bucket: 'fotos-galeria', forma: 'url' },
  { tabla: 'galeria_web', columna: 'despues_url', bucket: 'fotos-galeria', forma: 'url' },
  { tabla: 'usuarios', columna: 'foto_url', bucket: 'fotos-usuarios', forma: 'ruta' },
  { tabla: 'clientes', columna: 'foto_url', bucket: 'fotos-clientes', forma: 'ruta' },
  { tabla: 'asistentes', columna: 'foto_url', bucket: 'fotos-asistentes', forma: 'ruta' },
  { tabla: 'estado_negocio', columna: 'yape_qr_url', bucket: 'qr-pagos', forma: 'ruta' },
  { tabla: 'estado_negocio', columna: 'plin_qr_url', bucket: 'qr-pagos', forma: 'ruta' },
  { tabla: 'mobiliario', columna: 'foto_url', bucket: null, forma: 'directa' },
  { tabla: 'pedidos_web', columna: 'comprobante_url', bucket: 'comprobantes-pedidos-web', forma: 'ruta' },
  { tabla: 'citas', columna: 'comprobante_url', bucket: 'comprobantes-citas-web', forma: 'ruta' },
]

export const MIME_MIGRABLES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Variantes R2 (contrato de la Fase 3: r2:<destino>/<id> → <destino>/<id>/{m,g}.webp). Topes del Worker: m ≤ 400 px y
// 96 KiB; g ≤ 1600 px y 512 KiB. La migración usa 320 px para m (igual que la app) y 1400 px para g (el mayor tope que usa
// la app al subir: galería); nunca amplía.
export const VARIANTES = {
  m: { lado: 320, ladoMaxWorker: 400, bytesMax: 96 * 1024 },
  g: { lado: 1400, ladoMaxWorker: 1600, bytesMax: 512 * 1024 },
}
export const CALIDADES = [80, 70, 60] // escalones si una variante supera el tope de bytes

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

// UUID v5 (RFC 9562 §5.5) determinista: la misma fuente (ambiente, bucket, ruta, contenido) produce siempre el mismo id,
// así una ejecución reanudada o repetida no crea copias duplicadas; el Worker responde 200 «reanudado» a la misma persona con
// los mismos bytes, y la herramienta reconoce como propia una copia existente con el mismo SHA-256.
export const ESPACIO_UUID = '5c2d1f0e-7a1b-4c3d-9e8f-0a1b2c3d4e5f'
export function uuidV5(nombre, espacio = ESPACIO_UUID) {
  const ns = Buffer.from(espacio.replace(/-/g, ''), 'hex')
  const h = createHash('sha1').update(Buffer.concat([ns, Buffer.from(nombre, 'utf8')])).digest()
  h[6] = (h[6] & 0x0f) | 0x50
  h[8] = (h[8] & 0x3f) | 0x80
  const x = h.subarray(0, 16).toString('hex')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`
}
export const idDeFuente = ({ ambiente, bucket, ruta, sha }) => uuidV5(`${ambiente}|${bucket}|${ruta}|${sha}`)

// Ruta segura dentro de un bucket: sin vacíos, «.», «..», barras invertidas, query, hash ni caracteres de control.
export function rutaSegura(ruta) {
  if (typeof ruta !== 'string' || !ruta || ruta.length > 1024) return false
  if (/[?#\\]/.test(ruta) || [...ruta].some((c) => c.charCodeAt(0) < 0x20) || ruta.startsWith('/')) return false
  return ruta.split('/').every((s) => s !== '' && s !== '.' && s !== '..')
}

const prefijoPublico = (supabaseUrl, bucket) => `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${bucket}/`
export const urlPublicaSupabase = (supabaseUrl, bucket, ruta) => prefijoPublico(supabaseUrl, bucket) + ruta.split('/').map(encodeURIComponent).join('/')

// Identidad canónica de una base (Supabase, Worker o lectura de medios): esquema + host (sin puerto por defecto) + ruta sin
// barras finales. Incluye la ruta para distinguir bases detrás de un proxy con prefijo. Rechaza credenciales, query y hash.
export function normalizarBase(url) {
  let u
  try { u = new URL(String(url ?? '')) } catch { throw new Error(`URL inválida: ${url}`) }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`${u.origin}: solo http/https`)
  if (u.username || u.password || u.search || u.hash) throw new Error(`${u.host}: la base no puede llevar credenciales, query ni hash`)
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`
}

// Un endpoint de Storage dentro de una URL: /storage/v1/object/<public|sign|authenticated>/<bucket>/<resto>.
const RE_STORAGE = /\/storage\/v1\/object\/(public|sign|authenticated)\/([^/]+)\/(.*)$/

// Clasifica UN valor de una columna. ctx: { supabaseUrl, basesMedios: [..], existeAssetBuild(ruta) }.
// Devuelve { formato, bucket, ruta?, detalle?, privacidad? }. Formatos:
//   vacia · r2 · r2-url (URL completa de medios propios) · supabase-ruta · supabase-url (este proyecto) ·
//   supabase-url-firmada (endpoint sign/authenticated de este proyecto) · supabase-url-ajena (Storage de OTRO proyecto,
//   p. ej. una fila copiada de producción) · asset-build (ruta relativa de /public, solo galería) · externa · invalida
// En las URL de Storage manda el bucket REAL de la URL, no el que declara la columna: una URL de galería que apunte a un
// bucket privado, a un endpoint firmado/autenticado o a un bucket desconocido se clasifica `privacidad: 'privado'` (F9-05).
export function clasificarValor(columna, valor, ctx) {
  if (valor === null || valor === undefined || valor === '') return { formato: 'vacia', bucket: columna.bucket }
  if (typeof valor !== 'string') return { formato: 'invalida', bucket: columna.bucket, detalle: 'no es texto' }
  if (valor.startsWith('r2:')) {
    const [destino, id, ...resto] = valor.slice(3).split('/')
    const ok = DESTINOS_R2.includes(destino) && RE_UUID.test(id ?? '') && resto.length === 0
    return { formato: ok ? 'r2' : 'invalida', bucket: columna.bucket, detalle: ok ? undefined : 'referencia r2 mal formada' }
  }
  if (/^https?:\/\//i.test(valor)) {
    let u
    try { u = new URL(valor) } catch { return { formato: 'invalida', bucket: columna.bucket, privacidad: 'privado', detalle: 'URL ilegible' } }
    const supa = (ctx.supabaseUrl ?? '').replace(/\/+$/, '')
    for (const bucket of Object.keys(PRIVACIDAD)) {
      const pref = supa ? prefijoPublico(supa, bucket) : null
      if (pref && valor.startsWith(pref)) {
        let ruta
        try { ruta = decodeURIComponent(valor.slice(pref.length)) } catch { return { formato: 'invalida', bucket, detalle: 'codificación inválida' } }
        return rutaSegura(ruta) ? { formato: 'supabase-url', bucket, ruta } : { formato: 'invalida', bucket, detalle: 'ruta insegura' }
      }
    }
    const st = u.pathname.match(RE_STORAGE)
    if (st) {
      let bucket
      try { bucket = decodeURIComponent(st[2]) } catch { bucket = null }
      const propio = Boolean(supa) && valor.startsWith(`${supa}/storage/v1/object/`)
      const sensible = st[1] !== 'public' || !bucket || !(bucket in PRIVACIDAD) || PRIVACIDAD[bucket] === 'privado'
      const formato = propio ? (st[1] === 'public' ? 'invalida' : 'supabase-url-firmada') : 'supabase-url-ajena'
      return { formato, bucket: bucket in PRIVACIDAD ? bucket : null, ...(sensible ? { privacidad: 'privado' } : {}), detalle: propio && st[1] === 'public' ? 'bucket desconocido' : undefined }
    }
    for (const base of ctx.basesMedios ?? []) {
      if (valor.startsWith(`${base.replace(/\/+$/, '')}/`)) return { formato: 'r2-url', bucket: columna.bucket }
    }
    return { formato: 'externa', bucket: columna.bucket }
  }
  if (columna.forma === 'directa') return { formato: 'externa', bucket: null, detalle: 'valor directo no URL' }
  if (columna.forma === 'url') {
    // La galería guarda rutas relativas para las fotos de referencia de /public (inicio-web/…): son del build, no de Storage.
    const ruta = valor.replace(/^\//, '')
    return { formato: 'asset-build', bucket: null, ruta, detalle: ctx.existeAssetBuild?.(ruta) === false ? 'no existe en public/' : undefined }
  }
  return rutaSegura(valor) ? { formato: 'supabase-ruta', bucket: columna.bucket, ruta: valor } : { formato: 'invalida', bucket: columna.bucket, detalle: 'ruta insegura' }
}

// Decide si una referencia (ya clasificada y cruzada con el objeto de Storage) entra en la migración, y por qué no.
export function decidirAlcance(clasif, objeto) {
  const privacidad = clasif.privacidad ?? (clasif.bucket ? (PRIVACIDAD[clasif.bucket] ?? 'desconocida') : 'sin-bucket')
  const base = { privacidad }
  if (privacidad === 'privado') return { ...base, migrar: false, motivo: 'privado: excluido siempre' }
  if (clasif.formato === 'vacia') return { ...base, migrar: false, motivo: 'vacía' }
  if (clasif.formato === 'r2' || clasif.formato === 'r2-url') return { ...base, migrar: false, motivo: 'ya en R2' }
  if (clasif.formato === 'asset-build') return { ...base, migrar: false, motivo: clasif.detalle ? 'rota: recurso del build inexistente' : 'recurso del build (public/)' }
  if (clasif.formato === 'externa') return { ...base, migrar: false, motivo: 'URL externa o valor directo' }
  if (clasif.formato === 'supabase-url-ajena') return { ...base, migrar: false, motivo: 'Storage de otro proyecto (revisión manual)' }
  if (clasif.formato === 'invalida') return { ...base, migrar: false, motivo: `inválida: ${clasif.detalle}` }
  if (privacidad === 'publico-personal') return { ...base, migrar: false, motivo: 'perfil personal: fuera de alcance (requiere decisión)' }
  if (privacidad !== 'publico-catalogo') return { ...base, migrar: false, motivo: `fuera de alcance (${privacidad})` }
  if (!objeto) return { ...base, migrar: false, motivo: 'rota: el objeto no existe en Storage' }
  if (!MIME_MIGRABLES.has(objeto.mime)) return { ...base, migrar: false, motivo: `tipo no migrable (${objeto.mime ?? 'desconocido'})` }
  return { ...base, migrar: true, motivo: 'migrable' }
}

// Valor NUEVO de la columna tras migrar: misma forma que guarda la app al subir a R2 (ver ModalGaleriaWeb / subirFoto).
export function valorNuevo(columna, destino, id, publicUrl) {
  if (columna.forma === 'ruta') return `r2:${destino}/${id}`
  if (columna.forma === 'url') {
    if (!publicUrl) throw new Error('La galería guarda URL completa: falta la base pública de medios (--publica)')
    return `${publicUrl.replace(/\/+$/, '')}/${destino}/${id}/g.webp`
  }
  throw new Error(`Columna ${columna.tabla}.${columna.columna} no admite migración`)
}

// Valor que puede aparecer en un informe: exacto si se migra (es el «original» del UPDATE condicional y nunca lleva query),
// nulo si es privado o sensible y, en el resto de URL, sin credenciales, query ni hash (pueden llevar tokens). F9-05.
export function valorParaInforme(valor, alcance) {
  if (alcance.privacidad === 'privado') return null
  if (alcance.migrar || typeof valor !== 'string' || !/^https?:\/\//i.test(valor)) return valor
  try {
    const u = new URL(valor)
    if (!u.search && !u.hash && !u.username && !u.password) return valor
    u.search = ''; u.hash = ''; u.username = ''; u.password = ''
    return `${u.href}?<omitido>`
  } catch { return null }
}

// Permisos de destino POR FUNCIÓN (F9-06): Supabase, Worker de escritura y base de lectura de medios son hosts distintos en
// la arquitectura real; cada uno exige su propia opción con el host exacto. No hay comodines ni un permiso «remoto» general.
export const ROLES_DESTINO = { supabase: 'permitir-supabase', worker: 'permitir-worker', lectura: 'permitir-lectura' }

// Guarda de ambiente: lo local (loopback) se permite; un remoto exige https y --permitir-<rol>=<host exacto>; el Supabase de
// producción exige además --permitir-produccion (con cualquier rol). Devuelve null si se permite o el motivo del rechazo.
export function rechazoDeAmbiente({ url, rol = 'supabase', permitido, permitirProduccion, refProduccion }) {
  let u
  try { u = new URL(url) } catch { return `URL inválida: ${url}` }
  if (['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname)) return null
  if (u.protocol !== 'https:') return `${u.origin}: un destino remoto debe ser https`
  const opcion = ROLES_DESTINO[rol]
  if (!opcion) return `rol de destino desconocido: ${rol}`
  if (permitido !== u.host) return `${u.host} es remoto: exige --${opcion}=${u.host} (y autorización explícita del usuario)`
  if (refProduccion && u.hostname === `${refProduccion}.supabase.co` && !permitirProduccion) return 'Supabase de PRODUCCIÓN: exige además --permitir-produccion'
  return null
}

// Vínculo manifiesto ↔ ambiente (F9-02). Antes de autenticar, copiar, escribir o verificar: el manifiesto debe ser de la
// versión actual y de EXACTAMENTE el Supabase seleccionado; si ya fija Worker o base de lectura, también deben coincidir.
// Devuelve la lista de motivos (vacía si corresponde).
export function rechazoDeVinculo(m, { supabase, api, lectura } = {}) {
  const motivos = []
  if (m.version !== VERSION_MANIFIESTO) motivos.push(`manifiesto versión ${m.version ?? '¿?'}: esta herramienta exige la ${VERSION_MANIFIESTO} (vuelva a planificar)`)
  if (supabase !== undefined && m.ambiente !== supabase) motivos.push(`el manifiesto es de ${m.ambiente}, no de ${supabase}`)
  if (api !== undefined && m.api && m.api !== api) motivos.push(`el manifiesto ya se copió por el Worker ${m.api}, no por ${api}`)
  if (lectura !== undefined) {
    if (m.lectura && m.lectura !== lectura) motivos.push(`el manifiesto se verificó en la base de lectura ${m.lectura}, no en ${lectura}`)
    if (m.publica && normalizarBase(m.publica) !== lectura) motivos.push(`la base de lectura ${lectura} no es la base pública ${m.publica} que guardan las referencias de galería`)
  }
  // Cada original se lee (y se comprueba al verificar) en EL Supabase del manifiesto: nunca en un host que traiga el archivo.
  for (const e of m.entradas ?? []) {
    if (e.origen?.url !== urlPublicaSupabase(m.ambiente ?? '', e.origen?.bucket ?? '', e.origen?.ruta ?? '')) { motivos.push(`${e.id}: la URL del original no es la de ${m.ambiente}`); break }
  }
  return motivos
}
export const VERSION_MANIFIESTO = 2

// Argumentos estrictos (mismo criterio que scripts/lib/huerfanos-medios.mjs): flags sin valor, números validados, opciones
// desconocidas o repetidas rechazadas, todo antes de tocar la red.
export function parsearArgumentos(argv, { flags = [], textos = [], numeros = {} } = {}) {
  const [comando, ...resto] = argv
  if (!comando || comando.startsWith('--')) throw new Error('Falta el subcomando')
  const r = { comando }
  for (const crudo of resto) {
    if (!crudo.startsWith('--')) throw new Error(`Argumento no reconocido: ${crudo}`)
    const igual = crudo.indexOf('=')
    const nombre = crudo.slice(2, igual === -1 ? undefined : igual)
    const valor = igual === -1 ? null : crudo.slice(igual + 1)
    if (Object.hasOwn(r, nombre)) throw new Error(`--${nombre} repetida: cada opción se indica una sola vez`)
    if (flags.includes(nombre)) {
      if (valor !== null) throw new Error(`--${nombre} no admite valor (recibió «${valor}»)`)
      r[nombre] = true
    } else if (nombre in numeros) {
      const [min, max] = numeros[nombre]
      if (valor === null || !/^\d+$/.test(valor) || Number(valor) < min || Number(valor) > max) throw new Error(`--${nombre} debe ser un entero entre ${min} y ${max}`)
      r[nombre] = Number(valor)
    } else if (textos.includes(nombre)) {
      if (!valor) throw new Error(`--${nombre} requiere un valor`)
      r[nombre] = valor
    } else {
      throw new Error(`Opción desconocida: --${nombre}`)
    }
  }
  return r
}

// Estados del manifiesto. Entrada (un objeto de origen): planificada → copiada → verificada | error.
// Referencia: pendiente → actualizada | conflicto ; actualizada → revertida | conflicto-reversion.
// Además, una referencia puede tener una `operacion` ABIERTA (F9-03): la intención se guarda ANTES del UPDATE y se cierra al
// conocer el resultado. «en-curso» = la ejecución se interrumpió sin saberlo; «incierta» = el cambio pudo confirmarse o
// seguir en vuelo. Lleva su plazo (`vence`): solo se cierra al leerla aplicada o cuando la barrera del servidor, vencido el
// plazo, certifica su desenlace (F9-03b). Una lectura del valor anterior nunca basta para cerrarla.
export const ESTADOS_ENTRADA = ['planificada', 'copiada', 'verificada', 'error']
export const ESTADOS_REFERENCIA = ['pendiente', 'actualizada', 'conflicto', 'revertida', 'conflicto-reversion']
export const ESTADOS_OPERACION = ['en-curso', 'incierta']

export function resumenManifiesto(m) {
  const r = { entradas: m.entradas.length, porEstado: {}, referencias: 0, refsPorEstado: {}, operacionesAbiertas: 0, bytesOrigen: 0, bytesVariantes: 0 }
  for (const e of m.entradas) {
    r.porEstado[e.estado] = (r.porEstado[e.estado] ?? 0) + 1
    r.bytesOrigen += e.origen.bytes ?? 0
    r.bytesVariantes += (e.variantes?.m?.bytes ?? 0) + (e.variantes?.g?.bytes ?? 0)
    for (const ref of e.referencias) {
      r.referencias += 1; r.refsPorEstado[ref.estado] = (r.refsPorEstado[ref.estado] ?? 0) + 1
      if (ref.operacion) r.operacionesAbiertas += 1
    }
  }
  return r
}

// Invariantes que TODO manifiesto debe cumplir antes de copiar o escribir (se comprueban en cada comando de escritura).
export function validarManifiesto(m) {
  const errores = []
  const ids = new Set()
  for (const e of m.entradas) {
    if (!DESTINOS_R2.includes(e.destino)) errores.push(`${e.origen.bucket}/${e.origen.ruta}: destino ${e.destino} no permitido`)
    if (PRIVACIDAD[e.origen.bucket] !== 'publico-catalogo') errores.push(`${e.origen.bucket}/${e.origen.ruta}: bucket ${e.origen.bucket} no es público de catálogo`)
    if (!RE_UUID.test(e.id)) errores.push(`${e.origen.ruta}: id inválido`)
    if (ids.has(e.id)) errores.push(`${e.id}: id duplicado`)
    ids.add(e.id)
    if (!/^[0-9a-f]{64}$/.test(e.origen.sha256 ?? '')) errores.push(`${e.origen.ruta}: sin SHA-256 de origen`)
    if (!ESTADOS_ENTRADA.includes(e.estado)) errores.push(`${e.id}: estado ${e.estado}`)
    for (const ref of e.referencias) {
      if (!COLUMNAS.some((c) => c.tabla === ref.tabla && c.columna === ref.columna && c.bucket === e.origen.bucket)) errores.push(`${ref.tabla}.${ref.columna}: columna no corresponde al bucket`)
      if (!ESTADOS_REFERENCIA.includes(ref.estado)) errores.push(`${ref.tabla}/${ref.fila}: estado ${ref.estado}`)
      const op = ref.operacion
      if (op !== undefined) {
        const esperado = op?.modo === 'actualizar' ? [ref.original, ref.nuevo] : op?.modo === 'revertir' ? [ref.nuevo, ref.original] : null
        if (!esperado || !ESTADOS_OPERACION.includes(op.estado) || op.de !== esperado[0] || op.a !== esperado[1]) errores.push(`${ref.tabla}/${ref.fila}: operación abierta mal formada`)
        // `vence` (V2.1): plazo del cambio en el servidor; si falta (operación V2), la operación no puede cerrarse sola.
        if (op?.vence !== undefined && Number.isNaN(Date.parse(op.vence))) errores.push(`${ref.tabla}/${ref.fila}: plazo de la operación inválido`)
      }
    }
  }
  return errores
}
