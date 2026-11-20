// Content-Security-Policy de la app (auditoría global 2026-11-20, hallazgo 7.1).
//
// Se GENERA al compilar (scripts/build-cloudflare.mjs y build-preview-staging.mjs), no se escribe a mano en
// cloudflare/_headers, por dos motivos:
//  1. Los orígenes de Supabase y de medios (R2) dependen del entorno (VITE_SUPABASE_URL, VITE_MEDIOS_*): preview y
//     producción usan backends distintos.
//  2. index.html tiene scripts inline (tema sin parpadeo, precarga del hero); se permiten por su hash SHA-256, que se
//     calcula del index.html YA COMPILADO. Si alguien edita esos scripts, el hash se actualiza solo.
//
// FASE ACTUAL: se publica como Content-Security-Policy-REPORT-ONLY. El navegador no bloquea nada; solo avisa, y
// src/lib/reportarError.js manda cada aviso a la tabla errores_cliente (origen 'csp'). Cuando pase un tiempo sin avisos
// legítimos, se cambia `MODO` a 'bloquear' (una línea) y pasa a ser obligatoria.
// La protección anti-iframe (frame-ancestors 'none' + X-Frame-Options) YA es obligatoria: está fija en _headers.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const MODO = 'aviso' // 'aviso' → Content-Security-Policy-Report-Only · 'bloquear' → Content-Security-Policy
export const NOMBRE_CABECERA = MODO === 'bloquear' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only'

// Culqi Checkout (lib/culqi.js): script de js.culqi.com, y su formulario/3DS en iframes y llamadas a *.culqi.com.
const CULQI = 'https://*.culqi.com'
// Mapa de Contacto/Inicio (components/MapaDiferido.jsx): iframe de Google Maps embebido.
const MAPAS = ['https://www.google.com', 'https://maps.google.com']

/** Origen (protocolo + host + puerto) de una URL absoluta http(s); null si es relativa, vacía o inválida. */
export function origenDe(url) {
  if (!url || typeof url !== 'string' || url.startsWith('/')) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null
  } catch {
    return null
  }
}

/** Hashes 'sha256-…' de cada <script> inline (sin src) de un HTML. */
export function hashesDeScriptsInline(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    // El parser HTML convierte CRLF y CR sueltos en LF ANTES de que el navegador calcule el hash del script. index.html se
    // edita en Windows (CRLF): sin normalizar, el hash no coincidiría y la CSP bloquearía el tema y la precarga del hero.
    .map((m) => m[1].replace(/\r\n?/g, '\n'))
    .filter((codigo) => codigo.trim())
    .map((codigo) => `'sha256-${createHash('sha256').update(codigo, 'utf8').digest('base64')}'`)
}

const unicos = (lista) => [...new Set(lista.filter(Boolean))]

/** Construye la política a partir del entorno del build y los hashes de index.html. Función pura. */
export function construirCsp(env = {}, hashes = []) {
  const supabase = origenDe(env.VITE_SUPABASE_URL)
  const supabaseWs = supabase && supabase.replace(/^http/, 'ws') // Realtime: https → wss, http (local) → ws
  const mediosApi = origenDe(env.VITE_MEDIOS_API_URL)
  const mediosPublicos = unicos([
    origenDe(env.VITE_MEDIOS_PUBLIC_URL),
    ...String(env.VITE_MEDIOS_BASES_RECONOCIDAS ?? '').split(',').map((b) => origenDe(b.trim())),
  ])

  const directivas = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", ...hashes, 'https://js.culqi.com', CULQI]],
    // 'unsafe-inline' en estilos: React usa style={{…}} (atributos style) en muchos componentes. Es de bajo riesgo.
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', supabase, ...mediosPublicos]],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', ["'self'", supabase, supabaseWs, mediosApi, ...mediosPublicos, CULQI]],
    ['media-src', ["'self'", 'blob:']],
    ['frame-src', [...MAPAS, CULQI]],
    ['worker-src', ["'self'"]],
    ['manifest-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ]
  return directivas.map(([nombre, valores]) => `${nombre} ${unicos(valores).join(' ')}`).join('; ')
}

/**
 * Lee <salida>/index.html, construye la política y la agrega al bloque `/*` de <salida>/_headers.
 * Devuelve la política escrita. Falla si _headers no tiene el bloque `/*` o si la línea supera el límite de Cloudflare.
 */
export function agregarCspAHeaders(salida, env) {
  const html = readFileSync(join(salida, 'index.html'), 'utf8')
  const politica = construirCsp(env, hashesDeScriptsInline(html))
  const linea = `  ${NOMBRE_CABECERA}: ${politica}`
  // Cloudflare Pages: cada línea de _headers admite hasta 2000 caracteres.
  if (linea.length > 2000) throw new Error(`CSP demasiado larga para _headers (${linea.length} > 2000)`)
  const ruta = join(salida, '_headers')
  const headers = readFileSync(ruta, 'utf8')
  // El archivo puede venir con CRLF (Windows) o LF: la línea nueva usa el mismo final de línea.
  const eol = headers.includes('\r\n') ? '\r\n' : '\n'
  const bloqueRaiz = /^\/\*[ \t]*(?=\r?$)/m
  if (!bloqueRaiz.test(headers)) throw new Error('_headers no tiene el bloque /* donde agregar la CSP')
  if (headers.includes('Content-Security-Policy-Report-Only:') || /^[ \t]+Content-Security-Policy:(?![ \t]*frame-ancestors 'none'[ \t]*\r?$)/m.test(headers)) {
    throw new Error('_headers ya trae una CSP de contenido: debe generarse solo aquí (scripts/lib/csp.mjs)')
  }
  writeFileSync(ruta, headers.replace(bloqueRaiz, (m) => `${m}${eol}${linea}`))
  return politica
}
