import { useEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'

const ESCALA_MIN = 1
const ESCALA_MAX = 4
const PASO_BOTON = 1
const ESCALA_CLIC = 2.5
// Si el puntero se movió menos que esto entre pointerdown y pointerup, se
// trata como un clic/tap (alterna zoom) y no como un arrastre.
const UMBRAL_CLIC_PX = 6

function distanciaEntre(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// Sin límites, un pellizco/arrastre exagerado podría llevarse la foto muy
// lejos del centro y "perderla" fuera de la vista — se acota el traslado al
// margen que deja el zoom actual.
function limitarTraslado(traslado, escala, contenedor) {
  if (!contenedor || escala <= ESCALA_MIN) return { x: 0, y: 0 }
  const maxX = (contenedor.width * (escala - 1)) / 2
  const maxY = (contenedor.height * (escala - 1)) / 2
  return {
    x: Math.min(maxX, Math.max(-maxX, traslado.x)),
    y: Math.min(maxY, Math.max(-maxY, traslado.y)),
  }
}

// Visor de foto a pantalla completa con zoom: pellizco (pinch) y arrastre
// con los dedos en móvil/tablet, y en PC botones +/- o un clic (también
// Ctrl+rueda, gesto típico de pinch en trackpad). Todo con Pointer Events
// nativos (unifican mouse/táctil/lápiz) — sin librerías de gestos.
export default function ModalVisorFoto({ url, alt, onCerrar }) {
  // pointer:coarse = el puntero primario es el dedo (móvil/tablet), donde
  // el pellizco ya cubre el zoom y los botones +/- solo estorban. En PC
  // (puntero fino: mouse/trackpad) sí tienen sentido, junto con el clic.
  const [esTactil] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  )
  const [escala, setEscala] = useState(ESCALA_MIN)
  const [traslado, setTraslado] = useState({ x: 0, y: 0 })
  const contenedorRef = useRef(null)
  const punterosRef = useRef(new Map())
  const pinchRef = useRef(null) // { distanciaInicial, escalaInicial, traladoInicial }
  const arrastreRef = useRef(null) // { x, y, traladoInicial }
  const movimientoTotalRef = useRef(0)
  const escalaRef = useRef(ESCALA_MIN)
  const traladoRef = useRef({ x: 0, y: 0 })

  useCerrarConEscape(onCerrar)

  useEffect(() => {
    escalaRef.current = escala
  }, [escala])
  useEffect(() => {
    traladoRef.current = traslado
  }, [traslado])

  // Cambia el zoom manteniendo fijo en pantalla el punto "origen" (el click,
  // o el punto medio del pellizco) — si no se pasa origen (botones +/-), solo
  // recorta el traslado actual al nuevo margen permitido.
  function aplicarEscala(nuevaEscalaCruda, origen) {
    const rect = contenedorRef.current?.getBoundingClientRect()
    const nuevaEscala = Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, nuevaEscalaCruda))

    if (nuevaEscala === ESCALA_MIN) {
      setEscala(ESCALA_MIN)
      setTraslado({ x: 0, y: 0 })
      return
    }

    if (origen && rect) {
      const offsetX = origen.x - (rect.left + rect.width / 2)
      const offsetY = origen.y - (rect.top + rect.height / 2)
      const factor = nuevaEscala / escalaRef.current
      setTraslado(
        limitarTraslado(
          {
            x: traladoRef.current.x * factor + offsetX * (1 - factor),
            y: traladoRef.current.y * factor + offsetY * (1 - factor),
          },
          nuevaEscala,
          rect,
        ),
      )
    } else {
      setTraslado((anterior) => limitarTraslado(anterior, nuevaEscala, rect))
    }
    setEscala(nuevaEscala)
  }

  function manejarPinch(rect) {
    if (!pinchRef.current) return
    const [p1, p2] = Array.from(punterosRef.current.values())
    const distanciaActual = distanciaEntre(p1, p2)
    const factorDistancia = distanciaActual / pinchRef.current.distanciaInicial
    const nuevaEscala = Math.min(
      ESCALA_MAX,
      Math.max(ESCALA_MIN, pinchRef.current.escalaInicial * factorDistancia),
    )
    const medio = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
    const offsetX = medio.x - (rect.left + rect.width / 2)
    const offsetY = medio.y - (rect.top + rect.height / 2)
    const factor = nuevaEscala / pinchRef.current.escalaInicial

    setEscala(nuevaEscala)
    setTraslado(
      limitarTraslado(
        {
          x: pinchRef.current.traladoInicial.x * factor + offsetX * (1 - factor),
          y: pinchRef.current.traladoInicial.y * factor + offsetY * (1 - factor),
        },
        nuevaEscala,
        rect,
      ),
    )
  }

  function manejarPointerDown(evento) {
    contenedorRef.current?.setPointerCapture(evento.pointerId)
    punterosRef.current.set(evento.pointerId, { x: evento.clientX, y: evento.clientY })
    movimientoTotalRef.current = 0

    if (punterosRef.current.size === 2) {
      const [p1, p2] = Array.from(punterosRef.current.values())
      pinchRef.current = {
        distanciaInicial: distanciaEntre(p1, p2),
        escalaInicial: escalaRef.current,
        traladoInicial: traladoRef.current,
      }
      arrastreRef.current = null
    } else if (punterosRef.current.size === 1) {
      arrastreRef.current = { x: evento.clientX, y: evento.clientY, traladoInicial: traladoRef.current }
      pinchRef.current = null
    }
  }

  function manejarPointerMove(evento) {
    if (!punterosRef.current.has(evento.pointerId)) return
    const anterior = punterosRef.current.get(evento.pointerId)
    punterosRef.current.set(evento.pointerId, { x: evento.clientX, y: evento.clientY })
    movimientoTotalRef.current += Math.hypot(evento.clientX - anterior.x, evento.clientY - anterior.y)

    const rect = contenedorRef.current?.getBoundingClientRect()
    if (!rect) return

    if (punterosRef.current.size === 2 && pinchRef.current) {
      manejarPinch(rect)
      return
    }

    if (punterosRef.current.size === 1 && arrastreRef.current) {
      setTraslado(
        limitarTraslado(
          {
            x: arrastreRef.current.traladoInicial.x + (evento.clientX - arrastreRef.current.x),
            y: arrastreRef.current.traladoInicial.y + (evento.clientY - arrastreRef.current.y),
          },
          escalaRef.current,
          rect,
        ),
      )
    }
  }

  function soltarPuntero(evento) {
    punterosRef.current.delete(evento.pointerId)

    if (punterosRef.current.size === 1) {
      // Quedó un dedo tras soltar de un pellizco de dos: retoma el arrastre
      // desde ahí, sin saltos.
      const [punto] = Array.from(punterosRef.current.values())
      arrastreRef.current = { x: punto.x, y: punto.y, traladoInicial: traladoRef.current }
      pinchRef.current = null
      return
    }

    if (punterosRef.current.size === 0) {
      pinchRef.current = null
      arrastreRef.current = null
    }
  }

  function manejarPointerUp(evento) {
    const fueClic = punterosRef.current.size === 1 && movimientoTotalRef.current < UMBRAL_CLIC_PX
    soltarPuntero(evento)

    if (fueClic) {
      if (escalaRef.current > ESCALA_MIN) {
        aplicarEscala(ESCALA_MIN)
      } else {
        aplicarEscala(ESCALA_CLIC, { x: evento.clientX, y: evento.clientY })
      }
    }
  }

  function manejarWheel(evento) {
    // Ctrl+rueda es el gesto que Chrome/Firefox emiten para el pinch de
    // trackpad en PC — se ignora la rueda normal para no robarle el scroll
    // de la página a otro elemento si el visor quedara detrás de algo.
    if (!evento.ctrlKey) return
    evento.preventDefault()
    aplicarEscala(escalaRef.current - evento.deltaY * 0.01, { x: evento.clientX, y: evento.clientY })
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black/90">
      <div className="flex shrink-0 items-center justify-between gap-2 p-3">
        <button
          type="button"
          onClick={onCerrar}
          className="min-h-11 rounded-lg border border-border-strong bg-surface px-3 text-xs text-ink transition-colors hover:border-amber hover:text-amber"
        >
          Cerrar
        </button>

        {!esTactil && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => aplicarEscala(escala - PASO_BOTON)}
              disabled={escala <= ESCALA_MIN}
              title="Alejar"
              aria-label="Alejar"
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border-strong bg-surface text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => aplicarEscala(escala + PASO_BOTON)}
              disabled={escala >= ESCALA_MAX}
              title="Acercar"
              aria-label="Acercar"
              className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-border-strong bg-surface text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div
        ref={contenedorRef}
        onPointerDown={manejarPointerDown}
        onPointerMove={manejarPointerMove}
        onPointerUp={manejarPointerUp}
        onPointerCancel={soltarPuntero}
        onWheel={manejarWheel}
        className={`min-h-0 flex-1 touch-none overflow-hidden ${
          escala > ESCALA_MIN ? 'cursor-grab' : 'cursor-zoom-in'
        }`}
      >
        <img
          src={url}
          alt={alt}
          draggable={false}
          onDragStart={(evento) => evento.preventDefault()}
          className="h-full w-full select-none object-contain"
          style={{
            transform: `translate(${traslado.x}px, ${traslado.y}px) scale(${escala})`,
            transition: punterosRef.current.size === 0 ? 'transform 150ms ease-out' : 'none',
          }}
        />
      </div>
    </div>
  )
}
