import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

// Pestaña de la barra del header (solo escritorio: en móvil las pestañas viven en el drawer y la pantalla trae su propio selector)
// que NO navega al pulsarla: palabra + flecha son un solo botón que abre la lista de subsecciones, y solo al elegir una se entra a
// `<ruta>?seccion=<clave>`. Mismo aspecto que las demás pestañas (texto + subrayado azul cuando es la ruta actual).
// Misma lista y animación que SelectorDesplegable (clase .recompensas-selector__lista), anclada bajo la pestaña.
// `secciones`: [{ clave, label }]; la primera es la que se considera activa cuando la URL no trae ?seccion.
export default function MenuSeccionesPestana({ ruta, label, secciones, etiqueta }) {
  const [abierto, setAbierto] = useState(false)
  const raiz = useRef(null)
  const boton = useRef(null)
  const id = useId()
  const navigate = useNavigate()
  const location = useLocation()

  const enPestana = location.pathname === ruta || location.pathname.startsWith(`${ruta}/`)
  const claveParam = new URLSearchParams(location.search).get('seccion')
  const claveActual = location.pathname === ruta ? (secciones.find((s) => s.clave === claveParam)?.clave ?? secciones[0].clave) : null

  // Cerrar al navegar a otra ruta o cambiar de subsección por otro medio.
  useEffect(() => {
    setAbierto(false)
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!abierto) return undefined
    const cerrarFuera = (evento) => {
      if (!raiz.current?.contains(evento.target)) setAbierto(false)
    }
    document.addEventListener('pointerdown', cerrarFuera)
    return () => document.removeEventListener('pointerdown', cerrarFuera)
  }, [abierto])

  return (
    <div
      ref={raiz}
      className="relative flex items-center"
      onKeyDown={(evento) => {
        if (evento.key === 'Escape' && abierto) {
          evento.preventDefault()
          setAbierto(false)
          boton.current?.focus()
        }
      }}
    >
      <button
        ref={boton}
        type="button"
        aria-expanded={abierto}
        aria-controls={id}
        aria-haspopup="true"
        aria-label={`${label}: ${etiqueta}`}
        onClick={() => setAbierto((valorAnterior) => !valorAnterior)}
        className="relative flex items-center gap-1 py-1"
      >
        <span
          className={`whitespace-nowrap text-[15px] font-semibold transition-colors ${
            enPestana || abierto ? 'lw-metal-azul-texto' : 'text-white/60 hover:text-white'
          }`}
        >
          {label}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 transition-transform duration-300 motion-reduce:transition-none ${abierto ? 'rotate-180' : ''} ${
            enPestana || abierto ? 'text-[#a9c6ec]' : 'text-white/60'
          }`}
        />
        <span
          aria-hidden="true"
          className={`absolute -bottom-1 left-0 h-[2px] w-full origin-left transition-transform duration-300 ease-out ${
            enPestana ? 'scale-x-100' : 'scale-x-0'
          }`}
          style={{ background: 'var(--lw-metal-azul)' }}
        />
      </button>
      <div
        id={id}
        role="group"
        aria-label={etiqueta}
        aria-hidden={!abierto}
        inert={!abierto}
        data-abierto={abierto}
        className="recompensas-selector__lista absolute left-0 top-full z-30 mt-3 w-48"
      >
        <div className="max-h-[60svh] space-y-[2px] overflow-y-auto bg-[var(--lw-card)] px-(--pading-horizontal-boton) py-(--pading-vertical-boton) shadow-lg">
          {secciones.map((seccion) => (
            <button
              key={seccion.clave}
              type="button"
              aria-pressed={claveActual === seccion.clave}
              onClick={() => {
                setAbierto(false)
                navigate(`${ruta}?seccion=${seccion.clave}`)
              }}
              className={`block w-full rounded-none border-0 px-(--pading-horizontal-boton) py-(--pading-vertical-boton) text-left text-sm leading-normal transition-colors hover:bg-[var(--lw-border)] ${
                claveActual === seccion.clave ? 'bg-[var(--lw-border)] font-semibold text-[var(--lw-gold)]' : 'bg-transparent text-[var(--lw-fg)]'
              }`}
            >
              {seccion.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
