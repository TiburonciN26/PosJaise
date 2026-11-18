// Códigos de barras de productos: generación de códigos internos y etiqueta imprimible. Sin dependencias: EAN-13 / EAN-8 /
// UPC-A (un UPC-A es un EAN-13 con un 0 delante) y, para cualquier otro texto (códigos antiguos o manuales), Code 128,
// se dibujan como SVG con las tablas estándar.

// Etiqueta de la Niimbot M110 (rollo 40 x 30 mm). Si cambia el rollo, es lo único que hay que tocar.
export const ETIQUETA_ANCHO_MM = 40
export const ETIQUETA_ALTO_MM = 30

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
// R es el complemento de L; G es R leído al revés (así se evita teclear tablas a mano y equivocarse).
const R = L.map((patron) => [...patron].map((bit) => (bit === '1' ? '0' : '1')).join(''))
const G = R.map((patron) => [...patron].reverse().join(''))
// Paridad de los 6 dígitos de la izquierda según el primer dígito del EAN-13.
const PARIDAD = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

// Dígito de control EAN/UPC: se pesan los dígitos de derecha a izquierda 3,1,3,1… (el primero desde la derecha es el que
// va a ser seguido por el dígito de control, así que pesa 3).
export function digitoControl(cuerpo) {
  let suma = 0
  const digitos = [...cuerpo].reverse()
  digitos.forEach((d, i) => {
    suma += Number(d) * (i % 2 === 0 ? 3 : 1)
  })
  return String((10 - (suma % 10)) % 10)
}

// Código interno nuevo: 13 dígitos del 0 al 9. Empieza con 2 (prefijos 20-29 = «uso interno de la tienda» en EAN, así no
// choca con un código de fabricante) + 11 dígitos al azar + dígito de control, para que cualquier lector lo acepte.
export function generarCodigoInterno() {
  const azar = new Uint32Array(11)
  crypto.getRandomValues(azar)
  const cuerpo = `2${[...azar].map((n) => n % 10).join('')}`
  return cuerpo + digitoControl(cuerpo)
}

// Genera un código interno que no exista ya en el catálogo (consulta a productos_vista). Si tras varios intentos sigue
// chocando (prácticamente imposible: 1 entre 10^11) o la consulta falla, devuelve igualmente el último: guardar ya
// rechaza un duplicado con un mensaje claro (índice único de codigo_barras).
export async function generarCodigoUnico(supabase) {
  let codigo = generarCodigoInterno()
  for (let intento = 0; intento < 5; intento++) {
    const { data, error } = await supabase.from('productos_vista').select('id').eq('codigo_barras', codigo).limit(1)
    if (error || (data ?? []).length === 0) return codigo
    codigo = generarCodigoInterno()
  }
  return codigo
}

// Code 128 (juego B: ASCII imprimible 32-126). Cada valor 0-105 son 6 anchos alternos barra/espacio (11 módulos) y el
// final (106) son 7 (13 módulos). Start B = 104; dígito de control = (104 + Σ valor × posición) mod 103.
const CODE128 = (
  '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 ' +
  '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 ' +
  '232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 ' +
  '313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 ' +
  '111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
  '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 ' +
  '114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112'
).split(' ')
const START_B = 104
const STOP = 106
export const TABLA_CODE128 = CODE128 // expuesta solo para poder validarla en pruebas

function modulosCode128(texto) {
  const valores = [START_B, ...[...texto].map((c) => c.charCodeAt(0) - 32)]
  const control = valores.reduce((suma, valor, i) => suma + valor * (i === 0 ? 1 : i), 0) % 103
  valores.push(control, STOP)
  return valores
    .map((valor) =>
      [...CODE128[valor]].map((ancho, i) => (i % 2 === 0 ? '1' : '0').repeat(Number(ancho))).join(''),
    )
    .join('')
}

// Devuelve cómo imprimir el texto como código de barras, o null si no se puede:
//  - { tipo: 'EAN13' | 'EAN8', digitos } si son solo dígitos con largo EAN-13 / EAN-8 / UPC-A y dígito de control válido;
//  - { tipo: 'CODE128', digitos: texto } para cualquier otro texto de ASCII imprimible (códigos manuales o antiguos);
//  - null si está vacío o trae caracteres que Code 128 (juego B) no admite.
export function codigoImprimible(texto) {
  const limpio = String(texto ?? '').trim()
  if (!limpio) return null
  if (/^\d+$/.test(limpio)) {
    let digitos = limpio
    if (digitos.length === 12) digitos = `0${digitos}` // UPC-A
    if ((digitos.length === 13 || digitos.length === 8) && digitoControl(digitos.slice(0, -1)) === digitos.slice(-1)) {
      return { tipo: digitos.length === 13 ? 'EAN13' : 'EAN8', digitos }
    }
  }
  if (/^[ -~]+$/.test(limpio)) return { tipo: 'CODE128', digitos: limpio }
  return null
}

function modulos({ tipo, digitos }) {
  if (tipo === 'CODE128') return modulosCode128(digitos)
  if (tipo === 'EAN8') {
    const izquierda = [...digitos.slice(0, 4)].map((d) => L[d]).join('')
    const derecha = [...digitos.slice(4)].map((d) => R[d]).join('')
    return `101${izquierda}01010${derecha}101`
  }
  const paridad = PARIDAD[digitos[0]]
  const izquierda = [...digitos.slice(1, 7)].map((d, i) => (paridad[i] === 'L' ? L[d] : G[d])).join('')
  const derecha = [...digitos.slice(7)].map((d) => R[d]).join('')
  return `101${izquierda}01010${derecha}101`
}

// SVG del código (barras + número debajo). `imprimible` viene de codigoImprimible().
export function svgCodigoBarras(imprimible) {
  const bits = modulos(imprimible)
  const margen = 10 // zona en blanco a cada lado, en módulos (mínimo 7-10 para que el lector lea bien)
  const alto = 60
  const ancho = bits.length + margen * 2
  let rutas = ''
  for (let i = 0; i < bits.length; ) {
    if (bits[i] === '1') {
      let j = i
      while (j < bits.length && bits[j] === '1') j++
      rutas += `M${i + margen} 0h${j - i}v${alto}h-${j - i}z`
      i = j
    } else {
      i++
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${alto + 14}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges">` +
    `<path d="${rutas}" fill="#000"/>` +
    `<text x="${ancho / 2}" y="${alto + 11}" text-anchor="middle" font-family="monospace" font-size="10" letter-spacing="${imprimible.tipo === 'CODE128' ? 0 : 1.5}" fill="#000">${escaparHtml(imprimible.digitos)}</text>` +
    `</svg>`
  )
}

function escaparHtml(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

// Abre el diálogo de impresión del navegador con UNA etiqueta del tamaño exacto del rollo (sin márgenes). Hay que elegir
// la M110 como impresora (instalada en el equipo). Devuelve false si el código no es imprimible.
export function imprimirEtiqueta({ nombre, codigo }) {
  const imprimible = codigoImprimible(codigo)
  if (!imprimible) return false

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Etiqueta</title><style>
@page { size: ${ETIQUETA_ANCHO_MM}mm ${ETIQUETA_ALTO_MM}mm; margin: 0 }
html, body { margin: 0; padding: 0; background: #fff }
body { width: ${ETIQUETA_ANCHO_MM}mm; height: ${ETIQUETA_ALTO_MM}mm; display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: Arial, sans-serif; color: #000; overflow: hidden }
.nombre { box-sizing: border-box; width: 100%; padding: 0 1.5mm; margin-bottom: 1mm; text-align: center; font-size: 8pt; font-weight: 700; line-height: 1.1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden }
svg { width: ${ETIQUETA_ANCHO_MM - 4}mm; height: ${ETIQUETA_ALTO_MM - 12}mm }
</style></head><body><div class="nombre">${escaparHtml(nombre)}</div>${svgCodigoBarras(imprimible)}</body></html>`

  const marco = document.createElement('iframe')
  marco.setAttribute('aria-hidden', 'true')
  marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  marco.onload = () => {
    marco.contentWindow.focus()
    marco.contentWindow.print()
    setTimeout(() => marco.remove(), 60000)
  }
  marco.srcdoc = html
  document.body.appendChild(marco)
  return true
}
