// Reconocimiento ESTRICTO de URLs de medios propios (Fase 3, PF-01/PF-02). Módulo puro: sin Supabase ni
// import.meta, para probarlo en Node (scripts/verificar-urls-medios.mjs).
//
// Galería guarda la URL COMPLETA de cada foto, así que al cambiar de entrega (r2.dev ↔ Pages /medios) las
// filas antiguas siguen apuntando a la base anterior. Hay dos garantías distintas:
//   · LEER: `resolverUrlGaleria` devuelve cualquier URL http(s) tal cual (no depende de este módulo).
//   · ADMINISTRAR/BORRAR: solo se reconoce una URL si su origen, prefijo, destino, UUID y variante coinciden
//     con una base de la LISTA CERRADA de este build. Una URL ajena nunca produce un borrado, ni en R2 ni en Storage.

export const DESTINOS_R2 = ['fotos-productos', 'fotos-servicios', 'fotos-galeria']
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const LOCAL = new Set(['localhost', '127.0.0.1'])

// Base absoluta válida (https; http solo para localhost/127.0.0.1 en pruebas locales), sin credenciales,
// query ni hash, y sin barra final. Si no cumple → ''.
export function normalizarBase(valor) {
  if (typeof valor !== 'string' || !valor.trim()) return ''
  let u
  try { u = new URL(valor.trim()) } catch { return '' }
  const seguro = u.protocol === 'https:' || (u.protocol === 'http:' && LOCAL.has(u.hostname))
  if (!seguro || u.username || u.password || u.search || u.hash) return ''
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
}

// Lista cerrada de bases: la configurada + las aprobadas explícitamente (coma). Las inválidas se descartan.
export function basesReconocidas(publicUrl, extras = '') {
  const lista = [publicUrl, ...String(extras ?? '').split(',')].map(normalizarBase).filter(Boolean)
  return [...new Set(lista)]
}

// Desmonta una URL de medios propia → { destino, id, variante, base } o null.
export function partesDeUrlMedios(url, bases) {
  if (typeof url !== 'string' || !bases?.length) return null
  let u
  try { u = new URL(url) } catch { return null }
  if (u.search || u.hash || u.username || u.password || u.pathname.includes('%')) return null
  for (const base of bases) {
    const b = new URL(base)
    if (u.origin !== b.origin) continue
    const prefijo = `${b.pathname.replace(/\/+$/, '')}/`
    if (!u.pathname.startsWith(prefijo)) continue
    const resto = u.pathname.slice(prefijo.length).split('/')
    if (resto.length === 3 && DESTINOS_R2.includes(resto[0]) && RE_UUID.test(resto[1]) && /^(m|g)\.webp$/.test(resto[2])) {
      return { destino: resto[0], id: resto[1], variante: resto[2].slice(0, 1), base }
    }
  }
  return null
}

// "r2:<destino>/<id>" si la URL es de medios propios; si no, null.
export function referenciaDeUrl(url, bases) {
  const p = partesDeUrlMedios(url, bases)
  return p ? `r2:${p.destino}/${p.id}` : null
}

// Qué eliminar a partir de la URL completa que guarda la galería:
//  · "r2:..." si es una URL de medios propios (de CUALQUIER base aprobada);
//  · la ruta dentro del bucket SOLO si la URL cuelga del prefijo público de Supabase Storage de ESTE proyecto
//    (`prefijoStorage` = .../storage/v1/object/public/<bucket>/);
//  · null en cualquier otro caso (host ajeno, ruta relativa de /public, `..`, query...).
export function rutaDeUrlGaleriaPura({ url, bases, prefijoStorage }) {
  const referencia = referenciaDeUrl(url, bases)
  if (referencia) return referencia
  if (typeof url !== 'string' || !prefijoStorage || !url.startsWith(prefijoStorage)) return null
  const ruta = url.slice(prefijoStorage.length)
  if (!ruta || /[?#]/.test(ruta) || ruta.split('/').some((s) => s === '' || s === '.' || s === '..')) return null
  return ruta
}

// Rollback/transición acotado: reescribe la base de una URL de medios propios (p. ej. Pages → r2.dev).
// Devuelve la URL nueva o null si la URL no es de `deBase` o no es una URL de medios válida.
export function convertirBaseUrl(url, deBase, aBase) {
  const de = normalizarBase(deBase)
  const a = normalizarBase(aBase)
  const p = de && a ? partesDeUrlMedios(url, [de]) : null
  return p ? `${a}/${p.destino}/${p.id}/${p.variante}.webp` : null
}
