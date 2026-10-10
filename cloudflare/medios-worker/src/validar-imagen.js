// Validación del CONTENIDO de una imagen en el servidor (Fase 3).
//
// Solo se acepta WebP estático (lo que ya produce `procesarImagen` en el
// navegador). El tipo MIME que declare el cliente no decide nada.
//
// Se recorre TODA la estructura del contenedor RIFF/WebP según la
// especificación (https://developers.google.com/speed/webp/docs/riff_container):
//   - el tamaño RIFF coincide con los bytes recibidos (detecta subidas truncadas);
//   - cada chunk (cabecera de 8 bytes + carga + relleno a par) cabe dentro del
//     archivo y la suma de chunks cubre exactamente el archivo, sin sobrantes;
//   - formato simple: UN solo chunk VP8 o VP8L; formato extendido: VP8X primero,
//     y exactamente UN chunk de imagen (VP8 o VP8L), con ALPH solo junto a VP8;
//   - flags coherentes con los chunks (alfa, ICC, sin animación) y lienzo VP8X
//     igual a las dimensiones del bitstream;
//   - cabecera del bitstream válida (firma, versión, tamaño de la primera
//     partición VP8 dentro del chunk).
//
// COSTE: una sola pasada, O(n) en el número de chunks, que está acotado a MAX_CHUNKS (8);
// con salida temprana al primer chunk inválido o repetido. No hay bucles anidados sobre
// los chunks, de modo que un archivo malformado con miles de chunks falla en cuanto
// supera el límite en vez de generar trabajo creciente.
//
// LÍMITE EXPLÍCITO: NO se decodifican los datos de píxeles (un Worker no debe
// bloquearse con archivos ilimitados ni consumir CPU variable). Un archivo con
// estructura y cabeceras válidas pero datos entropy-codificados corruptos
// pasaría esta validación y no se vería en el navegador. Mitigación: solo
// puede subir un administrador autenticado, el tamaño está acotado y el
// cliente genera las imágenes con el codificador del propio navegador.

export const MIN_LADO = 16
export const MAX_LADO = 2000
const MAX_PIXELES = 2000 * 2000

const FLAG_ICC = 0x20
const FLAG_ALFA = 0x10
const FLAG_ANIMACION = 0x02
const MAX_CHUNKS = 8
const PERMITIDOS = new Set(['VP8X', 'ICCP', 'ALPH', 'VP8 ', 'VP8L', 'EXIF', 'XMP '])

const ascii = (b, desde, hasta) => String.fromCharCode(...b.subarray(desde, hasta))
const leer32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
const leer24 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)
const falla = (motivo) => ({ ok: false, motivo })

// Cabecera del bitstream lossy (chunk "VP8 "): devuelve { ancho, alto } o { motivo }.
function bitstreamVp8(b, inicio, tamano) {
  if (tamano < 10) return { motivo: 'vp8-corto' }
  const etiqueta = b[inicio] | (b[inicio + 1] << 8) | (b[inicio + 2] << 16)
  if (etiqueta & 0x01) return { motivo: 'vp8-no-es-keyframe' }
  if (((etiqueta >> 1) & 0x07) > 3) return { motivo: 'vp8-version-invalida' }
  if (!((etiqueta >> 4) & 0x01)) return { motivo: 'vp8-frame-oculto' }
  const primeraParticion = etiqueta >>> 5
  if (primeraParticion < 1 || primeraParticion > tamano - 10) return { motivo: 'vp8-particion-invalida' }
  if (b[inicio + 3] !== 0x9d || b[inicio + 4] !== 0x01 || b[inicio + 5] !== 0x2a) return { motivo: 'vp8-corrupto' }
  const ancho = (b[inicio + 6] | (b[inicio + 7] << 8)) & 0x3fff
  const alto = (b[inicio + 8] | (b[inicio + 9] << 8)) & 0x3fff
  return { ancho, alto }
}

// Cabecera del bitstream lossless (chunk "VP8L").
function bitstreamVp8l(b, inicio, tamano) {
  if (tamano < 6) return { motivo: 'vp8l-corto' }
  if (b[inicio] !== 0x2f) return { motivo: 'vp8l-corrupto' }
  if (b[inicio + 4] >> 5 !== 0) return { motivo: 'vp8l-version-invalida' }
  const ancho = 1 + (b[inicio + 1] | ((b[inicio + 2] & 0x3f) << 8))
  const alto = 1 + ((b[inicio + 2] >> 6) | (b[inicio + 3] << 2) | ((b[inicio + 4] & 0x0f) << 10))
  return { ancho, alto }
}

// Devuelve { ok: true, ancho, alto, codec, alfa } o { ok: false, motivo }.
export function inspeccionarWebp(bytes) {
  if (bytes.length < 20) return falla('demasiado-corto')
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 12) !== 'WEBP') return falla('no-es-webp')
  if (leer32(bytes, 4) + 8 !== bytes.length) return falla('tamano-no-coincide')

  // 1. UNA sola pasada sobre los chunks (coste lineal): cada uno debe caber completo (con
  // su relleno), ser de un tipo permitido y no repetirse. Se sale en cuanto algo falla, sin
  // recorrer el resto, y el número de chunks está acotado (un WebP legítimo del cliente tiene
  // como mucho VP8X + ICCP + ALPH + imagen + EXIF + XMP).
  const chunks = []
  const vistos = new Set()
  let posicion = 12
  while (posicion < bytes.length) {
    if (chunks.length >= MAX_CHUNKS) return falla('demasiados-chunks')
    if (posicion + 8 > bytes.length) return falla('chunk-truncado')
    const tipo = ascii(bytes, posicion, posicion + 4)
    if (!PERMITIDOS.has(tipo)) return falla('chunk-no-permitido') // ANIM, ANMF, desconocidos
    const tamano = leer32(bytes, posicion + 4)
    const inicio = posicion + 8
    const siguiente = inicio + tamano + (tamano & 1)
    if (siguiente > bytes.length) return falla('chunk-truncado')
    const grupo = tipo === 'VP8 ' || tipo === 'VP8L' ? 'IMAGEN' : tipo // VP8 y VP8L se excluyen entre sí
    if (vistos.has(grupo)) return falla(grupo === 'IMAGEN' ? 'varias-imagenes' : grupo === 'VP8X' ? 'vp8x-repetido' : 'chunk-repetido')
    vistos.add(grupo)
    chunks.push({ tipo, inicio, tamano })
    posicion = siguiente
  }
  if (chunks.length === 0) return falla('sin-chunks')

  // 2. Estructura simple o extendida.
  const imagen = chunks.find((c) => c.tipo === 'VP8 ' || c.tipo === 'VP8L')
  if (!imagen) return falla('sin-imagen')

  const esExtendido = chunks[0].tipo === 'VP8X'
  let lienzo = null
  let alfaDeclarada = false

  if (!esExtendido) {
    if (chunks.length !== 1) return falla('estructura-simple-invalida') // ALPH/ICCP exigen VP8X
  } else {
    const vp8x = chunks[0]
    if (vp8x.tamano !== 10) return falla('vp8x-tamano-invalido')
    if (vistos.has('VP8X') && chunks.indexOf(chunks.find((c) => c.tipo === 'VP8X')) !== 0) return falla('vp8x-fuera-de-orden')
    const flags = bytes[vp8x.inicio]
    if (flags & FLAG_ANIMACION) return falla('animado-no-permitido')
    lienzo = { ancho: 1 + leer24(bytes, vp8x.inicio + 4), alto: 1 + leer24(bytes, vp8x.inicio + 7) }
    alfaDeclarada = Boolean(flags & FLAG_ALFA)

    const indice = (tipo) => chunks.findIndex((c) => c.tipo === tipo)
    const indiceImagen = chunks.indexOf(imagen)
    const hayIccp = indice('ICCP') !== -1
    const hayAlph = indice('ALPH') !== -1
    if (hayIccp !== Boolean(flags & FLAG_ICC)) return falla('flag-icc-incoherente')
    if (hayIccp && indice('ICCP') > indiceImagen) return falla('orden-invalido')
    if (hayAlph) {
      if (imagen.tipo !== 'VP8 ') return falla('alph-solo-con-vp8')
      if (!alfaDeclarada) return falla('flag-alfa-incoherente')
      if (indice('ALPH') > indiceImagen) return falla('orden-invalido')
    }
    for (const tipo of ['EXIF', 'XMP ']) {
      if (indice(tipo) !== -1 && indice(tipo) < indiceImagen) return falla('orden-invalido')
    }
  }

  // 3. Cabecera del bitstream.
  const lectura = imagen.tipo === 'VP8L' ? bitstreamVp8l(bytes, imagen.inicio, imagen.tamano) : bitstreamVp8(bytes, imagen.inicio, imagen.tamano)
  if (lectura.motivo) return falla(lectura.motivo)
  const { ancho, alto } = lectura

  if (lienzo && (lienzo.ancho !== ancho || lienzo.alto !== alto)) return falla('dimensiones-incoherentes')

  // 4. Límites de dimensiones.
  if (ancho < MIN_LADO || alto < MIN_LADO) return falla('dimensiones-muy-pequenas')
  if (ancho > MAX_LADO || alto > MAX_LADO || ancho * alto > MAX_PIXELES) return falla('dimensiones-excesivas')

  return {
    ok: true,
    ancho,
    alto,
    codec: imagen.tipo.trim(),
    alfa: imagen.tipo === 'VP8 ' ? chunks.some((c) => c.tipo === 'ALPH') : alfaDeclarada,
  }
}
