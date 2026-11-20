// Registro de errores de la app en producción (auditoría global 2026-11-20, hallazgo 20.1).
// Destino: public.registrar_error_cliente() (migración 20261120000002), que agrupa repeticiones, aplica topes contra abuso y
// tacha datos personales en el servidor. Este módulo es la PRIMERA barrera: manda solo lo necesario, sin datos de la venta,
// del carrito ni del formulario.
//
// Reglas (todas para que reportar jamás empeore la experiencia):
//  · Nunca lanza ni espera: si el envío falla, se descarta en silencio (y no se reporta el fallo del reporte).
//  · Sin red no se envía (el POS trabaja offline a propósito; esos fallos son esperables y no llegarían).
//  · Máximo MAX_POR_CARGA envíos por carga de página, y cada error distinto una sola vez.
//  · En `npm run dev` no se envía nada salvo con VITE_REPORTAR_ERRORES_DEV=1 (así se prueba contra Supabase Local).
//  · Se ignora el ruido que no es de la app: extensiones del navegador, «Script error.» de otros orígenes,
//    «ResizeObserver loop…» y peticiones abortadas.
import { supabase } from './supabase.js'
import { esErrorDeCarga } from './moduloDiferido.js'
import { arbolRecordado } from '../config/paginasCliente.js'

const MAX_POR_CARGA = 10
const ACTIVO = !import.meta.env.DEV || import.meta.env.VITE_REPORTAR_ERRORES_DEV === '1'
const VERSION = import.meta.env.VITE_BUILD_ID || (import.meta.env.DEV ? 'dev' : null)

const vistos = new Set()
let enviados = 0

const RUIDO = [
  /^Script error\.?$/i, // error de un script de otro origen: el navegador oculta todo, no hay nada que diagnosticar
  /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/i, // inocuo, lo emite el navegador
]
const ORIGENES_AJENOS = /(chrome|moz|safari(-web)?)-extension:\/\//i

/** Convierte cualquier cosa lanzada (Error, error de Supabase {message, code}, texto…) en { mensaje, pila }. */
export function describirError(error) {
  if (error instanceof Error) return { mensaje: `${error.name && error.name !== 'Error' ? `${error.name}: ` : ''}${error.message}`, pila: error.stack ?? '' }
  if (error && typeof error === 'object') {
    const partes = [error.message, error.code && `(código ${error.code})`, error.details, error.hint].filter(Boolean)
    if (partes.length) return { mensaje: partes.join(' '), pila: '' }
    try {
      return { mensaje: JSON.stringify(error).slice(0, 500), pila: '' }
    } catch {
      return { mensaje: String(error), pila: '' }
    }
  }
  return { mensaje: String(error ?? '(sin mensaje)'), pila: '' }
}

/** ¿Vale la pena reportarlo? Exportada para poder probarla sin navegador. */
export function esRuido(error, mensaje, pila) {
  if (error?.name === 'AbortError') return true
  if (RUIDO.some((patron) => patron.test(mensaje))) return true
  return ORIGENES_AJENOS.test(pila)
}

/**
 * Reporta un error. `origen`: 'render' (lo atrapó un límite de React), 'global' (window.onerror), 'promesa'
 * (promesa rechazada sin catch), 'carga' (falló la descarga de una pantalla), 'csp' (aviso de la Content-Security-Policy)
 * o 'manual'. `componente`: pila de componentes.
 */
export function reportarError(error, { origen = 'manual', componente } = {}) {
  try {
    if (!ACTIVO || enviados >= MAX_POR_CARGA) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return

    const { mensaje, pila } = describirError(error)
    if (esRuido(error, mensaje, pila)) return
    const origenFinal = origen !== 'carga' && esErrorDeCarga(error) ? 'carga' : origen
    const clave = `${origenFinal}|${mensaje}`
    if (vistos.has(clave)) return
    vistos.add(clave)
    enviados += 1

    const pilaCompleta = [pila, componente && `--- componentes ---${componente}`].filter(Boolean).join('\n')
    supabase
      .rpc('registrar_error_cliente', {
        p_datos: {
          origen: origenFinal,
          mensaje: mensaje.slice(0, 500),
          pila: pilaCompleta.slice(0, 4000),
          ruta: window.location.pathname, // solo la ruta: ni ?consulta ni #fragmento (ahí pueden viajar tokens)
          version: VERSION,
          navegador: navigator.userAgent.slice(0, 300),
          arbol: arbolRecordado(),
        },
      })
      .then(
        () => {},
        () => {},
      )
  } catch {
    // Reportar nunca puede romper la app.
  }
}

let instalado = false

/** Escucha los errores que NO pasan por un límite de React: manejadores de eventos, timers y promesas sin catch. */
export function instalarReporteDeErrores() {
  if (instalado || typeof window === 'undefined') return
  instalado = true
  window.addEventListener('error', (evento) => {
    // Un <img>/<script> que no cargó también dispara 'error' (sin evento.error): eso no es un fallo de código.
    if (!evento.error && !evento.message) return
    reportarError(evento.error ?? evento.message, { origen: 'global' })
  })
  window.addEventListener('unhandledrejection', (evento) => {
    reportarError(evento.reason, { origen: 'promesa' })
  })
  // Avisos de la Content-Security-Policy (scripts/lib/csp.mjs). Mientras está en modo «solo aviso» (Report-Only) el navegador
  // no bloquea nada: esto es lo que dice qué se rompería al activarla. Sin endpoint report-uri: llega por la misma tabla.
  document.addEventListener('securitypolicyviolation', (evento) => {
    const modo = evento.disposition === 'report' ? 'aviso' : 'bloqueado'
    const violacion = new Error(`[${modo}] ${evento.effectiveDirective} → ${recursoBloqueado(evento.blockedURI)}`)
    violacion.name = 'CSP'
    // La «pila» es dónde ocurrió: así una extensión (chrome-extension://…) se reconoce como ruido.
    violacion.stack = `${evento.sourceFile || '(sin archivo)'}:${evento.lineNumber || 0}\n${(evento.sample || '').slice(0, 200)}`
    reportarError(violacion, { origen: 'csp' })
  })
}

/** Lo bloqueado, sin ?consulta ni #fragmento (pueden llevar claves o tokens): «inline», «eval» u origen + ruta. */
export function recursoBloqueado(uri) {
  if (!uri || !/^[a-z][a-z0-9+.-]*:/i.test(uri)) return uri || '(desconocido)'
  try {
    const u = new URL(uri)
    return u.protocol === 'data:' || u.protocol === 'blob:' ? u.protocol : `${u.origin}${u.pathname}`
  } catch {
    return uri.split(/[?#]/)[0]
  }
}

/** Opciones para createRoot (React 19): todo lo que atrapa un ErrorBoundary/LimiteCargaDiferida, o nadie atrapa. */
export const opcionesDeRaiz = {
  // Los límites ya escriben su propio console.error en componentDidCatch; aquí solo se reporta.
  onCaughtError: (error, info) => reportarError(error, { origen: 'render', componente: info?.componentStack }),
  onUncaughtError: (error, info) => {
    console.error('Error no capturado por ningún límite:', error)
    reportarError(error, { origen: 'render', componente: info?.componentStack })
  },
}
