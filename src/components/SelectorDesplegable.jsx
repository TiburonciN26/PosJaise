import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import IconoFlechaDesplegable from './IconoFlechaDesplegable.jsx'

const DURACION_CIERRE_MS = 320

// Selector estilizado para formularios (reemplaza al <select> nativo, que en el celular abre un panel a pantalla completa).
// Mismo lenguaje que el filtro de orden (SelectorOrden): botón con la opción elegida y una lista que se despliega justo debajo
// con la elegida resaltada. `opciones` = [{ valor, label, grupo? }]; si traen `grupo`, se muestra su título al empezar cada
// grupo (como un <optgroup>). El `valor` '' puede ser una opción más («Sin proveedor»).
//
// Alto: la lista crece lo más posible (casi todo el alto de la pantalla) para evitar el scroll propio; solo aparece si hay más
// opciones de las que caben. El panel de un modal recorta lo que sobresale, así que:
//   · si debajo no cabe y arriba sí, se abre hacia arriba;
//   · si no cabe en ningún lado, se abre hacia abajo y el contenedor con scroll se desplaza SUAVEMENTE para mostrarla;
//   · al cerrar, ese contenedor vuelve suavemente a donde estaba (antes saltaba de golpe porque la lista se plegaba y el
//     navegador recortaba el scroll). La lista se pliega recién cuando termina ese regreso.
export default function SelectorDesplegable({ id, valor, onCambiar, opciones, placeholder = 'Selecciona', ariaLabel }) {
  const [abierto, setAbierto] = useState(false)
  const [plegada, setPlegada] = useState(true) // sin alto: solo después de la animación de cierre
  const [haciaArriba, setHaciaArriba] = useState(false)
  const [alturaMax, setAlturaMax] = useState(480)
  const contenedorRef = useRef(null)
  const listaRef = useRef(null)
  const scrollRef = useRef(null) // { nodo, inicial }: contenedor con scroll y su posición antes de abrir
  const temporizadorRef = useRef(null)

  function cerrar() {
    setAbierto(false)
    // Regreso suave del scroll que se empujó al abrir; recién entonces se pliega la lista.
    const guardado = scrollRef.current
    if (guardado && guardado.nodo.scrollTop > guardado.inicial) {
      guardado.nodo.scrollTo({ top: guardado.inicial, behavior: 'smooth' })
    }
    scrollRef.current = null
    clearTimeout(temporizadorRef.current)
    temporizadorRef.current = setTimeout(() => setPlegada(true), DURACION_CIERRE_MS)
  }

  useCerrarConEscape(cerrar, abierto, { trabajoPendiente: false })
  useEffect(() => () => clearTimeout(temporizadorRef.current), [])

  // Tocar fuera del selector lo cierra.
  useEffect(() => {
    if (!abierto) return undefined
    function alPulsarFuera(evento) {
      if (!contenedorRef.current?.contains(evento.target)) cerrar()
    }
    document.addEventListener('pointerdown', alPulsarFuera)
    return () => document.removeEventListener('pointerdown', alPulsarFuera)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto])

  function abrir() {
    clearTimeout(temporizadorRef.current)
    const contenedor = contenedorRef.current
    const lista = listaRef.current
    let limiteAbajo = window.innerHeight
    let limiteArriba = 0
    let nodoScroll = null
    for (let nodo = contenedor.parentElement; nodo; nodo = nodo.parentElement) {
      const { overflowY } = getComputedStyle(nodo)
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden') {
        const recorte = nodo.getBoundingClientRect()
        limiteAbajo = Math.min(limiteAbajo, recorte.bottom)
        limiteArriba = Math.max(limiteArriba, recorte.top)
        nodoScroll = nodo
        break
      }
    }
    scrollRef.current = nodoScroll ? { nodo: nodoScroll, inicial: nodoScroll.scrollTop } : null

    // Tope: lo más alto posible, pero que la ventana quepa entera en lo que muestra el panel del modal (si fuera más alta que el
    // panel, parte quedaría recortada). El contenido real se mide con la lista ya sin plegar.
    const tope = Math.max(160, Math.min(window.innerHeight - 140, limiteAbajo - limiteArriba - 16))
    setPlegada(false)
    const alto = Math.min(lista.scrollHeight, tope)
    const caja = contenedor.getBoundingClientRect()
    const abajo = limiteAbajo - caja.bottom
    const arriba = caja.top - limiteArriba
    setAlturaMax(tope)
    setHaciaArriba(abajo < alto + 8 && arriba >= alto + 8)
    setAbierto(true)
  }

  // Si la lista abierta queda fuera de la vista, se desplaza el contenedor lo justo (suave) para verla completa.
  useEffect(() => {
    if (abierto) listaRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [abierto])

  const elegida = opciones.find((opcion) => opcion.valor === valor)

  return (
    <div ref={contenedorRef} className="relative">
      <button
        id={id}
        type="button"
        onClick={abierto ? cerrar : abrir}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-label={ariaLabel}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border bg-surface-2 px-3 py-2 text-left text-sm outline-none transition-colors ${
          abierto ? 'border-amber' : 'border-border'
        }`}
      >
        <span className={`min-w-0 break-words ${elegida && elegida.valor !== '' ? 'text-ink' : 'text-ink/60'}`}>
          {elegida ? elegida.label : placeholder}
        </span>
        <IconoFlechaDesplegable
          className={`h-3 w-3 shrink-0 text-ink/60 transition-transform duration-300 ${abierto ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Siempre montada para que el cierre también anime (clip-path); `invisible` evita foco y clics cerrada. Plegada (sin alto)
          solo tras el cierre, para no agrandar el scroll del modal. */}
      <div
        role="listbox"
        ref={listaRef}
        aria-hidden={!abierto}
        style={abierto ? { maxHeight: alturaMax } : undefined}
        className={`absolute left-0 right-0 z-20 overflow-y-auto overscroll-contain rounded-lg border bg-surface-2 shadow-lg transition-[clip-path,opacity,visibility,transform] duration-300 ease-out ${
          haciaArriba ? 'bottom-full mb-1' : 'top-full mt-1'
        } ${
          abierto
            ? 'visible translate-y-0 border-border opacity-100 [clip-path:inset(0_0_0_0)]'
            : `invisible opacity-0 ${haciaArriba ? 'translate-y-1 [clip-path:inset(100%_0_0_0)]' : '-translate-y-1 [clip-path:inset(0_0_100%_0)]'}`
        } ${plegada ? 'max-h-0 border-transparent' : ''}`}
      >
        {opciones.map((opcion, indice) => {
          const esElegida = opcion.valor === valor
          const empiezaGrupo = opcion.grupo && opcion.grupo !== opciones[indice - 1]?.grupo
          return (
            <div key={`${opcion.grupo ?? ''}:${opcion.valor}`}>
              {empiezaGrupo && (
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink/50">{opcion.grupo}</p>
              )}
              <button
                type="button"
                role="option"
                aria-selected={esElegida}
                tabIndex={abierto ? 0 : -1}
                onClick={() => {
                  onCambiar(opcion.valor)
                  cerrar()
                }}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  esElegida ? 'bg-amber/15 text-amber' : 'text-ink hover:bg-surface-3'
                }`}
              >
                <span className="min-w-0 break-words">{opcion.label}</span>
                {esElegida && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
