import { useLayoutEffect, useRef } from 'react'
import { usePaginaActiva } from '../context/PaginaActivaContext.jsx'

const SELECTOR_ENFOCABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

let contadorId = 0

// C3+A3 de la auditoría frontend: ningún modal tenía semántica de diálogo
// (role/aria-modal/aria-labelledby), trampa de foco (con Tab se "salía"
// hacia la página tapada), devolución de foco al cerrar, bloqueo de
// scroll del body, ni animación de entrada — 22 lugares distintos con el
// mismo hueco. En vez de editar el JSX/className de cada uno, este hook
// hace TODO vía DOM sobre panelRef en cuanto se monta: le alcanza con
// encontrar el h1/h2/h3 del panel para el label, y asume que el panel es
// hijo directo del overlay (fixed inset-0 bg-black/60 — el patrón que ya
// usan los 22) para animarlo también. Integración por modal: una ref, un
// `ref={panelRef}` en el panel, y una línea useModalA11y(panelRef).
// etiquetaFallback: para los pocos modales sin h1/h2/h3 visible (ej.
// ModalCamara) — sin esto quedarían como diálogo sin nombre accesible.
export function useModalA11y(panelRef, activoSolicitado = true, etiquetaFallback) {
  // Un diálogo de una pestaña cacheada y OCULTA no atrapa foco ni bloquea el scroll (QA-049); vuelve al ser visible.
  const paginaActiva = usePaginaActiva()
  const activo = activoSolicitado && paginaActiva
  const disparadorRef = useRef(null)
  const capturadoRef = useRef(false)

  // Disparador = quien tenía el foco al ACTIVARSE el modal. Se captura en el
  // render (antes del commit) porque un campo con autoFocus recibe el foco
  // durante el commit y, capturado en el efecto, el "disparador" sería ese
  // campo (QA-017). Cubre los dos ciclos de vida: modal que se monta ya abierto
  // (activo siempre true) y diálogo en una página que permanece montada y cuyo
  // `activo` cambia (QA-030). Aperturas repetidas: se vuelve a capturar en cada
  // activación, así la fila 5 no devuelve el foco al botón de la fila 2.
  if (activo && !capturadoRef.current) {
    disparadorRef.current = document.activeElement
    capturadoRef.current = true
  }

  // Reinicio al pasar a inactivo. Corre DESPUÉS de la limpieza del efecto de
  // abajo (React ejecuta todas las limpiezas de un commit antes de los
  // efectos), que es la que usa el disparador para devolver el foco: no puede
  // anularse en el render (QA-030). Tampoco en la propia limpieza: StrictMode
  // la corre y repite el efecto al montar.
  useLayoutEffect(() => {
    if (!activo) {
      capturadoRef.current = false
      disparadorRef.current = null
    }
  }, [activo])

  useLayoutEffect(() => {
    if (!activo) return undefined
    const panel = panelRef.current
    if (!panel) return undefined

    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-modal', 'true')
    const titulo = panel.querySelector('h1, h2, h3')
    if (titulo) {
      if (!titulo.id) titulo.id = `modal-titulo-${++contadorId}`
      panel.setAttribute('aria-labelledby', titulo.id)
    } else if (etiquetaFallback) {
      panel.setAttribute('aria-label', etiquetaFallback)
    }

    // Los paneles a pantalla completa (ModalCamara, ModalVisorFoto — el
    // panel ES el propio "fixed inset-0", no una card centrada con
    // overlay aparte) solo se desvanecen: escalarlos dejaría ver un
    // borde de la página de atrás por 180ms mientras el 4% de "hueco"
    // todavía no cubre el viewport entero.
    const esPantallaCompleta = panel.classList.contains('inset-0')
    panel.classList.add(esPantallaCompleta ? 'animate-entrada-overlay' : 'animate-entrada-modal')

    // Solo si el padre es de verdad el overlay (fixed inset-0 bg-black/60,
    // el patrón de siempre) — si el panel es él mismo el elemento a
    // pantalla completa, su padre es cualquier ancestro del árbol de
    // React y NO hay que animarlo.
    const overlay = panel.parentElement
    if (overlay?.classList.contains('fixed') && overlay?.classList.contains('inset-0')) {
      overlay.classList.add('animate-entrada-overlay')
    }

    const overflowPrevio = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Varios modales ya declaran su propio autoFocus en un campo puntual
    // (ej. el input de búsqueda, no el primer elemento del DOM) — React
    // lo aplica durante el commit, ANTES de que corra este efecto. Si ya
    // hay algo enfocado dentro del panel, se respeta tal cual; si no,
    // recién ahí se enfoca el primer elemento enfocable como respaldo.
    if (!panel.contains(document.activeElement)) {
      panel.querySelector(SELECTOR_ENFOCABLE)?.focus()
    }

    function alPresionarTab(evento) {
      if (evento.key !== 'Tab') return
      const enfocables = Array.from(panel.querySelectorAll(SELECTOR_ENFOCABLE)).filter(
        (el) => el.offsetParent !== null,
      )
      if (enfocables.length === 0) return
      const primero = enfocables[0]
      const ultimo = enfocables[enfocables.length - 1]

      if (evento.shiftKey && document.activeElement === primero) {
        evento.preventDefault()
        ultimo.focus()
      } else if (!evento.shiftKey && document.activeElement === ultimo) {
        evento.preventDefault()
        primero.focus()
      }
    }
    document.addEventListener('keydown', alPresionarTab)

    return () => {
      document.body.style.overflow = overflowPrevio
      document.removeEventListener('keydown', alPresionarTab)
      const disparador = disparadorRef.current
      if (disparador?.isConnected) disparador.focus()
    }
  }, [activo, panelRef])
}
