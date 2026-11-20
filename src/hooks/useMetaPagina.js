// Título, descripción y canonical de cada página del portal (auditoría 2026-11-20, hallazgo 19.1).
//
// Por qué un hook y no <title>/<meta> de React 19: index.html ya trae <title> y <meta name="description"> (los necesitan
// los bots de WhatsApp/Facebook, que no ejecutan JS). Si además React renderiza un <title>, el documento queda con DOS y
// el navegador muestra el primero (el estático). Aquí se EDITAN los mismos elementos y, al desmontar, se restauran los
// valores originales, así una página sin hook nunca hereda el título de la anterior.
//
// Google sí ejecuta JS: con esto cada servicio/producto se indexa con su propio título y descripción.
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

export const MARCA = 'Jaise Beauty Academy'
const LARGO_DESCRIPCION = 160 // lo que muestran los buscadores; el resto se corta

function meta(selector, crear) {
  let el = document.head.querySelector(selector)
  if (!el && crear) {
    el = document.createElement(crear.tag)
    for (const [k, v] of Object.entries(crear.attrs)) el.setAttribute(k, v)
    document.head.appendChild(el)
  }
  return el
}

/** Recorta en el último espacio antes del límite y añade «…». Exportada para probarla. */
export function recortarDescripcion(texto, largo = LARGO_DESCRIPCION) {
  const limpio = String(texto ?? '').replace(/\s+/g, ' ').trim()
  if (limpio.length <= largo) return limpio
  const corte = limpio.lastIndexOf(' ', largo - 1)
  return `${limpio.slice(0, corte > largo * 0.6 ? corte : largo - 1).replace(/[\s,.;:]+$/, '')}…`
}

/**
 * @param {{ titulo?: string, descripcion?: string, indexable?: boolean }} opciones
 *   titulo: sin la marca (se agrega « | Jaise Beauty Academy»). Vacío = título de la marca sola.
 *   descripcion: texto plano; se recorta a ~160 caracteres. Vacío = se deja la de index.html.
 *   indexable: false añade <meta name="robots" content="noindex"> (páginas privadas o de error).
 * Se puede llamar con valores aún cargando (undefined): solo se aplica lo que llega.
 */
export function useMetaPagina({ titulo, descripcion, indexable = true } = {}) {
  const { pathname } = useLocation()

  useEffect(() => {
    const original = {
      titulo: document.title,
      descripcion: meta('meta[name="description"]')?.getAttribute('content'),
      ogTitulo: meta('meta[property="og:title"]')?.getAttribute('content'),
      ogDescripcion: meta('meta[property="og:description"]')?.getAttribute('content'),
      ogUrl: meta('meta[property="og:url"]')?.getAttribute('content'),
    }
    const tituloFinal = titulo ? `${titulo} | ${MARCA}` : original.titulo
    const descripcionFinal = descripcion ? recortarDescripcion(descripcion) : null
    const url = `${window.location.origin}${pathname}`

    document.title = tituloFinal
    meta('meta[property="og:title"]')?.setAttribute('content', tituloFinal)
    if (descripcionFinal) {
      meta('meta[name="description"]')?.setAttribute('content', descripcionFinal)
      meta('meta[property="og:description"]')?.setAttribute('content', descripcionFinal)
    }
    meta('meta[property="og:url"]')?.setAttribute('content', url)
    // Canonical sin ?consulta: /servicios?categoria=x y /servicios son la misma página para el buscador.
    const canonical = meta('link[rel="canonical"]', { tag: 'link', attrs: { rel: 'canonical' } })
    canonical.setAttribute('href', url)
    const robots = indexable ? null : meta('meta[name="robots"]', { tag: 'meta', attrs: { name: 'robots' } })
    robots?.setAttribute('content', 'noindex')

    return () => {
      document.title = original.titulo
      if (original.descripcion != null) meta('meta[name="description"]')?.setAttribute('content', original.descripcion)
      if (original.ogTitulo != null) meta('meta[property="og:title"]')?.setAttribute('content', original.ogTitulo)
      if (original.ogDescripcion != null) meta('meta[property="og:description"]')?.setAttribute('content', original.ogDescripcion)
      if (original.ogUrl != null) meta('meta[property="og:url"]')?.setAttribute('content', original.ogUrl)
      canonical.remove()
      robots?.remove()
    }
  }, [titulo, descripcion, indexable, pathname])
}
