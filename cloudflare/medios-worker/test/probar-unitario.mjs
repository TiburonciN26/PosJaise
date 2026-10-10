// Pruebas unitarias SIN red ni cuentas: validador de WebP, idempotencia/recuperación
// del Worker (R2 en memoria + Supabase simulado) y recolector de huérfanos.
// Chromium (playwright) solo se usa para fabricar WebP reales y comprobar que lo que
// se acepta decodifica y lo que se rechaza no decodifica.
//
//   node cloudflare/medios-worker/test/probar-unitario.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { inspeccionarWebp } from '../src/validar-imagen.js'
import worker from '../src/index.js'
import { clasificar, grupoDeReferencia, leerTodasLasFilas, parsearArgumentos, recolectar, validarRetencion } from '../../../scripts/lib/huerfanos-medios.mjs'

const aqui = dirname(fileURLToPath(import.meta.url))
const raiz = resolve(aqui, '../../..')
const casos = []
const caso = (nombre, ok, detalle = {}) => {
  casos.push({ nombre, ...detalle, ok: Boolean(ok) })
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${ok ? '' : ' ' + JSON.stringify(detalle)}`)
}

// ---------- fixtures reales de Chromium ----------
const { chromium } = createRequire(resolve(raiz, 'package.json'))('playwright')
const navegador = await chromium.launch()
const pagina = await navegador.newPage()
const crear = (ancho, alto, { alfa = false, calidad = 0.8 } = {}) =>
  pagina.evaluate(
    async ([a, h, conAlfa, q]) => {
      const c = document.createElement('canvas')
      c.width = a
      c.height = h
      const x = c.getContext('2d')
      if (!conAlfa) {
        x.fillStyle = '#ffffff' // totalmente opaca
        x.fillRect(0, 0, a, h)
      }
      x.fillStyle = '#b76e79'
      x.fillRect(a * 0.1, h * 0.1, a * 0.6, h * 0.6)
      x.fillStyle = 'rgba(30,30,30,0.5)'
      x.fillRect(a * 0.4, h * 0.4, a * 0.5, h * 0.5)
      const blob = await new Promise((ok) => c.toBlob(ok, 'image/webp', q))
      return Array.from(new Uint8Array(await blob.arrayBuffer()))
    },
    [ancho, alto, alfa, calidad],
  )
const decodifica = (bytes) =>
  pagina.evaluate(async (arr) => {
    try {
      const b = await createImageBitmap(new Blob([new Uint8Array(arr)], { type: 'image/webp' }))
      const r = [b.width, b.height]
      b.close()
      return r
    } catch {
      return null
    }
  }, Array.from(bytes))

const opaca = Uint8Array.from(await crear(320, 320))
const alfa = Uint8Array.from(await crear(320, 320, { alfa: true }))
const lossless = Uint8Array.from(await crear(320, 320, { calidad: 1 }))
const tipoChunk = (b) => String.fromCharCode(...b.subarray(12, 16))
console.log(`  (fixtures Chromium: opaca=${tipoChunk(opaca)} alfa=${tipoChunk(alfa)} lossless=${tipoChunk(lossless)})`)

// ---------- validador: aceptados que decodifican ----------
for (const [nombre, bytes] of [['opaca lossy', opaca], ['con alfa', alfa], ['lossless', lossless]]) {
  const r = inspeccionarWebp(bytes)
  const dec = await decodifica(bytes)
  caso(`validador acepta WebP real ${nombre} y Chromium lo decodifica`, r.ok && dec && dec[0] === 320, { codec: r.codec, alfa: r.alfa, chunkInicial: tipoChunk(bytes), decodificado: dec })
}
caso('el fixture con alfa usa el contenedor extendido (VP8X + ALPH)', tipoChunk(alfa) === 'VP8X' && inspeccionarWebp(alfa).alfa === true)

// ---------- validador: rechazados (fabricados) ----------
const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]
const texto = (s) => [...s].map((c) => c.charCodeAt(0))
const riff = (...chunks) => {
  const cuerpo = chunks.flat()
  return Uint8Array.from([...texto('RIFF'), ...u32(4 + cuerpo.length), ...texto('WEBP'), ...cuerpo])
}
const chunk = (tipo, datos) => [...texto(tipo), ...u32(datos.length), ...datos, ...(datos.length & 1 ? [0] : [])]
const vp8x = (flags, ancho, alto) => chunk('VP8X', [flags, 0, 0, 0, (ancho - 1) & 255, ((ancho - 1) >> 8) & 255, ((ancho - 1) >> 16) & 255, (alto - 1) & 255, ((alto - 1) >> 8) & 255, ((alto - 1) >> 16) & 255])
const copia = (b) => Uint8Array.from(b)
// Posición de la CARGA de un chunk por tipo (Chromium emite siempre VP8X + chunks).
const carga = (b, tipo) => {
  for (let i = 12; i + 8 <= b.length; ) {
    const t = String.fromCharCode(...b.subarray(i, i + 4))
    const n = new DataView(b.buffer, b.byteOffset).getUint32(i + 4, true)
    if (t === tipo) return i + 8
    i += 8 + n + (n & 1)
  }
  return -1
}
const cuerpoDe = (b, tipo) => b.subarray(carga(b, tipo), carga(b, tipo) + new DataView(b.buffer, b.byteOffset).getUint32(carga(b, tipo) - 4, true))

caso('los WebP reales de Chromium traen perfil ICC (flag + chunk ICCP) y se aceptan', carga(alfa, 'ICCP') > 0 && (alfa[carga(alfa, 'VP8X')] & 0x20) !== 0)
const soloVp8x30 = riff(vp8x(0, 128, 128)) // el caso de Codex: 30 bytes, sin píxeles
const rechazos = {
  'VP8X de 30 bytes sin chunk de imagen (caso F3-01)': [soloVp8x30, 'sin-imagen'],
  'archivo truncado a la mitad': [opaca.slice(0, opaca.length >> 1), 'tamano-no-coincide'],
  'tamaño RIFF mentiroso': [(() => { const b = copia(opaca); b[4] += 8; return b })(), 'tamano-no-coincide'],
  'chunk de imagen con longitud mayor al archivo': [(() => { const b = copia(opaca); b[16] = 255; b[17] = 255; return b })(), 'chunk-truncado'],
  'VP8X + ALPH sin chunk de imagen': [riff(vp8x(0x10, 320, 320), chunk('ALPH', [0, 1, 2, 3])), 'sin-imagen'],
  'dos chunks de imagen': [riff(chunk('VP8L', Array.from(cuerpoDe(lossless, 'VP8L'))), chunk('VP8L', [0x2f, 0, 0, 0, 0, 0])), 'varias-imagenes'],
  'chunk ALPH en archivo simple (sin VP8X)': [riff(chunk('ALPH', [0, 1]), chunk('VP8L', Array.from(cuerpoDe(lossless, 'VP8L')))), 'estructura-simple-invalida'],
  'chunk desconocido en contenedor extendido': [(() => { const b = copia(alfa); b.set(texto('ZZZZ'), alfa.findIndex((v, i) => i > 20 && String.fromCharCode(...alfa.subarray(i, i + 4)) === 'ALPH')); return b })(), 'chunk-no-permitido'],
  'flag de animación activado': [(() => { const b = copia(alfa); b[carga(b, 'VP8X')] |= 0x02; return b })(), 'animado-no-permitido'],
  'chunk ICCP presente pero flag ICC apagado': [(() => { const b = copia(alfa); b[carga(b, 'VP8X')] &= ~0x20; return b })(), 'flag-icc-incoherente'],
  'flag ICC encendido sin chunk ICCP': [(() => { const b = copia(riff(vp8x(0x20, 320, 320), chunk('VP8L', Array.from(cuerpoDe(lossless, 'VP8L'))))); return b })(), 'flag-icc-incoherente'],
  'lienzo VP8X distinto del bitstream': [(() => { const b = copia(alfa); b[carga(b, 'VP8X') + 4] = 0x7f; return b })(), 'dimensiones-incoherentes'],
  'VP8: primera partición mayor que el chunk': [(() => { const b = copia(opaca); const o = carga(b, 'VP8 '); b[o] = 0xf0; b[o + 1] = 0xff; b[o + 2] = 0xff; return b })(), 'vp8-particion-invalida'],
  'VP8: sin código de inicio': [(() => { const b = copia(opaca); b[carga(b, 'VP8 ') + 3] = 0; return b })(), 'vp8-corrupto'],
  'VP8L con firma inválida': [(() => { const b = copia(lossless); b[carga(b, 'VP8L')] = 0; return b })(), 'vp8l-corrupto'],
  'PNG con cabecera ajena': [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, ...new Array(60).fill(1)]), 'no-es-webp'],
}
for (const [nombre, [bytes, motivoEsperado]] of Object.entries(rechazos)) {
  const r = inspeccionarWebp(bytes)
  caso(`validador rechaza: ${nombre}`, !r.ok && r.motivo === motivoEsperado, { motivo: r.motivo, esperado: motivoEsperado })
}
// F3-09: payloads con miles de chunks repetidos (los de la reproducción de Codex)
for (const n of [1000, 4000, 8000]) {
  const malicioso = riff(vp8x(0, 128, 128), ...Array.from({ length: n }, () => chunk('EXIF', [])))
  const t0 = performance.now()
  const r = inspeccionarWebp(malicioso)
  const ms = performance.now() - t0
  caso(`F3-09 ${n} chunks EXIF (${malicioso.length} bytes): rechazado en cuanto aparece la repetición, sin trabajo creciente (${ms.toFixed(2)} ms)`, !r.ok && ['chunk-repetido', 'demasiados-chunks'].includes(r.motivo) && ms < 25, { motivo: r.motivo, ms })
}
const unRepetido = riff(vp8x(0x08, 128, 128), chunk('EXIF', [1, 2]), chunk('EXIF', [3, 4]))
caso('F3-09 un chunk de metadatos repetido se rechaza en la misma pasada (chunk-repetido)', inspeccionarWebp(unRepetido).motivo === 'chunk-repetido')

const decSinPixeles = await decodifica(soloVp8x30)
caso('el VP8X de 30 bytes tampoco lo decodifica Chromium (coincide con el rechazo)', decSinPixeles === null)

// ---------- Worker con R2 en memoria ----------
class R2Falso {
  constructor() { this.m = new Map() }
  async put(k, v, o) {
    if (o?.onlyIf?.etagDoesNotMatch === '*' && this.m.has(k)) return null
    this.m.set(k, { bytes: Uint8Array.from(v), customMetadata: o?.customMetadata ?? {}, subido: new Date() })
    return { key: k }
  }
  async get(k) {
    const o = this.m.get(k)
    return o ? { customMetadata: o.customMetadata, arrayBuffer: async () => o.bytes.buffer.slice(0), body: o.bytes } : null
  }
  async delete(ks) { for (const k of [].concat(ks)) this.m.delete(k) }
  async list({ prefix, cursor, limit = 1000 }) {
    const claves = [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort()
    const desde = cursor ? Number(cursor) : 0
    const trozo = claves.slice(desde, desde + limit)
    const truncated = desde + limit < claves.length
    return {
      objects: trozo.map((k) => ({ key: k, size: this.m.get(k).bytes.length, customMetadata: this.m.get(k).customMetadata, uploaded: this.m.get(k).subido })),
      truncated,
      cursor: truncated ? String(desde + limit) : undefined,
    }
  }
}
const sesiones = { tokenA: { id: 'usuario-a', admin: true }, tokenB: { id: 'usuario-b', admin: true }, tokenC: { id: 'cajera', admin: false } }
globalThis.fetch = async (url, init) => {
  const token = (init?.headers?.Authorization ?? '').replace('Bearer ', '')
  const s = sesiones[token]
  if (String(url).endsWith('/auth/v1/user')) return s ? Response.json({ id: s.id }) : new Response('{}', { status: 401 })
  if (String(url).endsWith('/rpc/es_admin')) return Response.json(Boolean(s?.admin))
  return new Response('?', { status: 500 })
}
const R2 = new R2Falso()
const env = { MEDIOS: R2, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', ORIGENES_PERMITIDOS: 'http://localhost:5173' }
const ORIGEN = 'http://localhost:5173'
const llamar = (metodo, ruta, token, cuerpo) =>
  worker.fetch(new Request(`https://w.test${ruta}`, { method: metodo, headers: { Authorization: `Bearer ${token}`, Origin: ORIGEN }, body: cuerpo }), env)
const id = crypto.randomUUID()
const ruta = `/v1/medios/fotos-productos/${id}/g`

let r = await llamar('PUT', ruta, 'tokenA', soloVp8x30)
caso('Worker: VP8X sin píxeles → 415 y NO se almacena nada (F3-01)', r.status === 415 && R2.m.size === 0, { estado: r.status, objetos: R2.m.size })
r = await llamar('PUT', ruta, 'tokenA', alfa)
caso('Worker: WebP con alfa válido → 201', r.status === 201, { estado: r.status })
r = await llamar('PUT', ruta, 'tokenA', alfa)
const j = await r.json()
caso('Worker: reintento idéntico del mismo usuario (respuesta perdida) → 200 reanudado, sin escribir de nuevo (F3-02)', r.status === 200 && j.reanudado === true && R2.m.size === 1, { estado: r.status, j })
r = await llamar('PUT', ruta, 'tokenA', opaca)
caso('Worker: mismo id con contenido DISTINTO → 409 y el original queda intacto', r.status === 409 && R2.m.get(`fotos-productos/${id}/g.webp`).bytes.length === alfa.length, { estado: r.status })
r = await llamar('PUT', ruta, 'tokenB', alfa)
caso('Worker: mismo contenido pero OTRO usuario → 409 (no se reclama un objeto ajeno)', r.status === 409, { estado: r.status })
r = await llamar('PUT', ruta, 'tokenC', alfa)
caso('Worker: cajera → 403', r.status === 403, { estado: r.status })

// inventario
for (let i = 0; i < 3; i += 1) await llamar('PUT', `/v1/medios/fotos-servicios/${crypto.randomUUID()}/m`, 'tokenA', opaca)
r = await llamar('GET', '/v1/inventario/fotos-servicios', 'tokenA')
const inv = await r.json()
caso('Worker: inventario admin lista claves con fecha y autor', r.status === 200 && inv.objetos.length === 3 && inv.objetos.every((o) => o.subidoEn && o.subidoPor === 'usuario-a'), { n: inv.objetos?.length })
r = await llamar('GET', '/v1/inventario/fotos-servicios', 'tokenC')
caso('Worker: inventario para no-admin → 403', r.status === 403)
r = await llamar('GET', '/v1/inventario/comprobantes-pedidos-web', 'tokenA')
caso('Worker: inventario de un destino privado → 400', r.status === 400)

// ---------- recolector ----------
const dia = 24 * 3600 * 1000
const ahora = Date.parse('2026-10-09T12:00:00Z')
const obj = (grupo, edadDias, extra = {}) => ['m', 'g'].map((v) => ({ clave: `${grupo}/${v}.webp`, bytes: 1000, subidoEn: edadDias === null ? null : new Date(ahora - edadDias * dia).toISOString(), ...extra }))
const ua = (n) => `00000000-0000-4000-8000-00000000000${n}`
const objetos = [
  ...obj(`fotos-productos/${ua(1)}`, 100), // viejo y referenciado
  ...obj(`fotos-productos/${ua(2)}`, 100), // viejo huérfano → candidato
  ...obj(`fotos-productos/${ua(3)}`, 2), // reciente huérfano → protegido
  ...obj(`fotos-servicios/${ua(4)}`, null), // sin fecha → protegido
  { clave: 'fotos-productos/otra-cosa.txt', bytes: 5, subidoEn: new Date(ahora - 999 * dia).toISOString() }, // ajeno al contrato
  ...obj(`fotos-galeria/${ua(5)}`, 30), // viejo huérfano → candidato
]
const refs = new Set([`fotos-productos/${ua(1)}`])
const c = clasificar({ objetos, referenciados: refs, ahora, retencionDias: 14 })
caso('recolector: clasifica referenciado / protegido-reciente / sin-fecha / candidato', c.referenciado.length === 1 && c['protegido-reciente'].length === 1 && c['sin-fecha'].length === 1 && c.candidato.length === 2, { totales: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.length])) })
caso('recolector: una clave ajena al contrato se ignora (nunca candidata)', ![...c.candidato, ...c.referenciado].some((g) => g.claves.some((k) => k.endsWith('.txt'))))
caso('recolector: referencias reconocidas (r2:, URL de galería) y rutas antiguas de Supabase no', grupoDeReferencia(`r2:fotos-productos/${ua(1)}`) === `fotos-productos/${ua(1)}` && grupoDeReferencia(`https://media.x.com/fotos-galeria/${ua(5)}/g.webp`) === `fotos-galeria/${ua(5)}` && grupoDeReferencia('abc.webp') === null && grupoDeReferencia(`https://x.supabase.co/storage/v1/object/public/fotos-galeria/${ua(5)}.webp`) === null && grupoDeReferencia(`fotos-productos/${ua(1)}.webp`) === null && grupoDeReferencia('https://x.supabase.co/storage/v1/object/public/fotos-galeria/abc.webp') === null)

const eliminadas = []
const fuentes = (refsFn = () => refs, puntual = (g) => refsFn().has(g)) => ({
  listarReferencias: async () => refsFn(),
  estaReferenciado: async (g) => puntual(g),
  listarObjetos: async () => objetos,
  eliminar: async (g) => { eliminadas.push(g) },
})
let informe = await recolectar({ fuentes: fuentes(), aplicar: false, retencionDias: 14, ahora })
caso('recolector: sin --aplicar informa y no borra nada', eliminadas.length === 0 && informe.candidatos.length === 2)
informe = await recolectar({ fuentes: fuentes(), aplicar: true, retencionDias: 14, ahora })
caso('recolector: --aplicar borra solo los 2 candidatos (no el referenciado, reciente ni sin fecha)', eliminadas.length === 2 && eliminadas.includes(`fotos-productos/${ua(2)}`) && eliminadas.includes(`fotos-galeria/${ua(5)}`), { eliminadas })
eliminadas.length = 0
// F3-05 (reproducción de Codex): dos candidatos de 30 días; tras borrar A alguien referencia B.
const dos = [...obj(`fotos-productos/${ua(7)}`, 30), ...obj(`fotos-productos/${ua(8)}`, 30)]
let referenciaB = false
const fuentesAB = {
  listarReferencias: async () => new Set(),
  listarObjetos: async () => dos,
  estaReferenciado: async (g) => g === `fotos-productos/${ua(8)}` && referenciaB,
  eliminar: async (g) => { eliminadas.push(g); if (g === `fotos-productos/${ua(7)}`) referenciaB = true }, // se «guarda» una referencia a B justo después de borrar A
}
informe = await recolectar({ fuentes: fuentesAB, aplicar: true, retencionDias: 14, ahora, permitirSinReferencias: true })
caso('F3-05 recolector: referencia a B guardada tras borrar A → B NO se borra (consulta puntual por candidato)', eliminadas.length === 1 && eliminadas[0] === `fotos-productos/${ua(7)}` && informe.omitidos.length === 1 && informe.omitidos[0].grupo === `fotos-productos/${ua(8)}`, { eliminadas, omitidos: informe.omitidos })
eliminadas.length = 0
informe = await recolectar({ fuentes: { ...fuentes(), estaReferenciado: async () => { throw new Error('timeout') } }, aplicar: true, retencionDias: 14, ahora })
caso('F3-05 recolector: duda al comprobar un candidato (la consulta lanza) → se aborta sin borrar más', eliminadas.length === 0 && /Duda al comprobar/.test(informe.abortado ?? ''), { abortado: informe.abortado })

// F3-05 (paginación): 2000 filas; tras la 1.ª página se borra la primera y se agrega otra al final.
const filasTabla = Array.from({ length: 2000 }, (_, i) => ({ id: String(i).padStart(5, '0') }))
let paginasLeidas = 0
const leerPagina = async (despuesDe, tamano) => {
  const orden = filasTabla.slice().sort((x, y) => (x.id < y.id ? -1 : 1))
  const trozo = orden.filter((f) => despuesDe === null || f.id > despuesDe).slice(0, tamano)
  paginasLeidas += 1
  if (paginasLeidas === 1) { filasTabla.shift(); filasTabla.push({ id: '99999' }) } // mutación entre páginas
  return trozo
}
const leidas = await leerTodasLasFilas(leerPagina, 1000)
const idsLeidos = new Set(leidas.map((f) => f.id))
caso('F3-05 paginación por llave: una fila viva durante la lectura NO se omite aunque se muta entre páginas (la fila 1001 aparece)', idsLeidos.has('01000') && idsLeidos.has('01999'), { total: leidas.length })
// control: la lectura por OFFSET del diseño anterior sí la omitía
const filasOffset = Array.from({ length: 2000 }, (_, i) => ({ id: String(i).padStart(5, '0') }))
const leerOffset = async () => {
  const pag1 = filasOffset.slice(0, 1000)
  filasOffset.shift(); filasOffset.push({ id: '99999' })
  const pag2 = filasOffset.slice(1000, 2000)
  return new Set([...pag1, ...pag2].map((f) => f.id))
}
caso('(control negativo) la paginación por offset del diseño anterior SÍ saltaba la fila 1001', !(await leerOffset()).has('01000'))

// F3-06 retención inválida y flags
eliminadas.length = 0
const invalidas = [Number.NaN, -1, 0, Infinity, '14', null, 0.5]
let todasRechazadas = true
for (const valor of invalidas) {
  let rechazo = false
  try { await recolectar({ fuentes: fuentes(), aplicar: true, retencionDias: valor, ahora }) } catch { rechazo = true }
  if (!rechazo) todasRechazadas = false
}
caso('F3-06 retención inválida (NaN, -1, 0, Infinity, texto, null, <1) → rechazada y NUNCA se invoca eliminar', todasRechazadas && eliminadas.length === 0, { eliminadas })
let rechazoClasificar = false
try { clasificar({ objetos, referenciados: refs, ahora, retencionDias: Number.NaN }) } catch { rechazoClasificar = true }
caso('F3-06 la función reutilizable clasificar también valida la retención', rechazoClasificar)
const unDia = [...obj(`fotos-productos/${ua(9)}`, 1)]
eliminadas.length = 0
await recolectar({ fuentes: { ...fuentes(), listarObjetos: async () => unDia }, aplicar: true, retencionDias: 14, ahora, permitirSinReferencias: true })
caso('F3-06 control: con 14 días una imagen de 1 día no se elimina', eliminadas.length === 0)
const rechaza = (argv) => { try { parsearArgumentos(argv); return false } catch { return true } }
caso('F3-06 CLI: --aplicar=false, --aplicar=1 y --aplicar= se rechazan (no activan el modo destructivo)', rechaza(['--aplicar=false']) && rechaza(['--aplicar=1']) && rechaza(['--aplicar=']))
caso('F3-06 CLI: retención NaN/negativa/vacía/cero/texto y opciones desconocidas se rechazan', ['--retencion-dias=abc', '--retencion-dias=-1', '--retencion-dias=', '--retencion-dias=0', '--retencion-dias', '--borrar', 'suelto'].every((a) => rechaza([a])))
const por_defecto = parsearArgumentos(['--api=http://x'])
const aplicando = parsearArgumentos(['--api=http://x', '--aplicar', '--retencion-dias=30'])
caso('F3-06 CLI: sin --aplicar solo informa (aplicar=false, 14 días); --aplicar válido activa y respeta la retención', por_defecto.aplicar === false && por_defecto.retencionDias === 14 && aplicando.aplicar === true && aplicando.retencionDias === 30)
caso('validarRetencion acepta 14 y 1', validarRetencion(14) === 14 && validarRetencion(1) === 1)

eliminadas.length = 0
let fallo = null
try {
  await recolectar({ fuentes: { ...fuentes(), listarReferencias: async () => { throw new Error('lectura incompleta de productos: 1000 de 3245') } }, aplicar: true, ahora })
} catch (e) { fallo = e.message }
caso('recolector: lectura de referencias incompleta → aborta sin borrar nada', fallo && eliminadas.length === 0, { fallo })
fallo = null
try { await recolectar({ fuentes: fuentes(() => new Set()), aplicar: true, ahora }) } catch (e) { fallo = e.message }
caso('recolector: cero referencias con objetos existentes → se niega a borrar', fallo && eliminadas.length === 0, { fallo })
informe = await recolectar({ fuentes: fuentes(), aplicar: true, retencionDias: 14, ahora, permitirSinReferencias: false })
eliminadas.length = 0
const fallaUno = { ...fuentes(), eliminar: async (g) => { if (g.includes(ua(2))) throw new Error('R2 caído'); eliminadas.push(g) } }
informe = await recolectar({ fuentes: fallaUno, aplicar: true, retencionDias: 14, ahora })
caso('recolector: un borrado que falla se informa y no detiene los demás', informe.errores.length === 1 && eliminadas.length === 1, { errores: informe.errores })

await navegador.close()
const fallos = casos.filter((x) => !x.ok)
const carpeta = resolve(raiz, 'docs/evidencia-rendimiento/fase-3')
mkdirSync(carpeta, { recursive: true })
writeFileSync(resolve(carpeta, 'pruebas-unitarias.json'), JSON.stringify({ fecha: new Date().toISOString(), entorno: 'sin red: R2 en memoria + Supabase simulado + Chromium para fixtures', total: casos.length, fallos: fallos.length, casos }, null, 2))
console.log(`\n${casos.length} casos, ${fallos.length} fallos`)
process.exit(fallos.length ? 1 : 0)
