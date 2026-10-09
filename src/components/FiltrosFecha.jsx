import { useEffect, useId, useRef, useState } from 'react'
import { ArrowBigDown } from 'lucide-react'
import { anioMesEnLima } from '../lib/fechas.js'

// La clienta no usa "Personalizado" (poner dos fechas le resulta complicado):
// se oculta, y "Este mes" pasa a ser un desplegable de meses (ver BotonMes).
// Poner en true para devolver el botón sin tocar nada más.
const MOSTRAR_PERSONALIZADO = false

const TODOS_LOS_FILTROS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mes' },
  { id: 'personalizado', label: 'Personalizado' },
]
const FILTROS = MOSTRAR_PERSONALIZADO
  ? TODOS_LOS_FILTROS
  : TODOS_LOS_FILTROS.filter((f) => f.id !== 'personalizado')

const MESES_ATRAS = 12
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const dos = (n) => String(n).padStart(2, '0')

// Un mes pasado se aplica como rango 'personalizado' (desde/hasta inclusivos),
// así las pantallas no necesitan saber que existe el selector de meses.
function rangoDeMes(anio, mes) {
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate()
  return { desde: `${anio}-${dos(mes + 1)}-01`, hasta: `${anio}-${dos(mes + 1)}-${dos(ultimo)}` }
}

function opcionesMeses() {
  const { anio, mes } = anioMesEnLima(new Date())
  return Array.from({ length: MESES_ATRAS + 1 }, (_, i) => {
    const d = new Date(Date.UTC(anio, mes - i, 1))
    const a = d.getUTCFullYear()
    const m = d.getUTCMonth()
    return { anio: a, mes: m, actual: i === 0, etiqueta: a === anio ? MESES[m] : `${MESES[m]} ${a}`, ...rangoDeMes(a, m) }
  })
}

const TEMA_CLASES = {
  amber: {
    activo: 'border border-amber bg-amber font-semibold text-bg',
    inactivo: 'border border-border text-ink/70 hover:text-amber',
    focusInput: 'focus:border-amber',
  },
  'purple-300': {
    activo: 'border border-purple-300 bg-purple-300 font-semibold text-bg',
    inactivo: 'border border-border text-ink/70 hover:text-purple-300',
    focusInput: 'focus:border-purple-300',
  },
}

const PADDING_BOTON = {
  compacta: 'sm:px-3 sm:text-sm',
  ancha: 'sm:px-4 sm:py-1.5 sm:text-sm',
}

// "Este mes" convertido en desplegable: mes actual + los últimos 12 meses.
function BotonMes({ filtro, onCambiarFiltro, personalizado, onCambiarPersonalizado, clases, padding }) {
  const [abierto, setAbierto] = useState(false)
  const raiz = useRef(null)
  const opciones = opcionesMeses()

  useEffect(() => {
    if (!abierto) return undefined
    const fuera = (e) => { if (raiz.current && !raiz.current.contains(e.target)) setAbierto(false) }
    const esc = (e) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('pointerdown', fuera)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', fuera)
      document.removeEventListener('keydown', esc)
    }
  }, [abierto])

  // Un 'personalizado' que coincide con un mes de la lista cuenta como ese mes.
  const pasado = filtro === 'personalizado'
    ? opciones.find((o) => !o.actual && o.desde === personalizado?.desde && o.hasta === personalizado?.hasta)
    : null
  const activo = filtro === 'mes' || Boolean(pasado)
  const etiqueta = pasado ? pasado.etiqueta : opciones[0].etiqueta

  function elegir(o) {
    setAbierto(false)
    if (o.actual) {
      onCambiarFiltro('mes')
    } else {
      onCambiarPersonalizado({ desde: o.desde, hasta: o.hasta })
      onCambiarFiltro('personalizado')
    }
  }

  return (
    <div ref={raiz} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        className={`flex w-full min-w-0 items-center justify-center gap-0.5 whitespace-nowrap rounded-full px-1 py-2 text-center text-xs transition-colors ${PADDING_BOTON[padding]} ${
          activo ? clases.activo : clases.inactivo
        }`}
      >
        <span className="truncate">{etiqueta}</span>
        <ArrowBigDown size={12} className={`shrink-0 transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>
      {abierto && (
        <ul
          role="listbox"
          className="absolute right-0 top-full z-30 mt-1 max-h-72 w-44 overflow-y-auto rounded-xl border border-border bg-surface-2 p-1 shadow-lg"
        >
          {opciones.map((o) => (
            <li key={o.etiqueta}>
              <button
                type="button"
                role="option"
                aria-selected={o.actual ? filtro === 'mes' : pasado === o}
                onClick={() => elegir(o)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-ink/10 ${
                  (o.actual ? filtro === 'mes' : pasado?.etiqueta === o.etiqueta) ? 'font-semibold text-ink' : 'text-ink/70'
                }`}
              >
                {o.etiqueta}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Fila de botones Hoy/Esta semana/Este mes/Personalizado. `sticky` envuelve
// la fila en el mismo contenedor pegajoso que usaban Dashboard/Estadísticas;
// las demás pantallas la insertan en su propio contenedor (ver Botones y
// CamposPersonalizado exportados aparte para esos casos a medida).
function Botones({ filtro, onCambiarFiltro, personalizado, onCambiarPersonalizado, tema = 'amber', padding = 'compacta', sticky = false, className = '' }) {
  const clases = TEMA_CLASES[tema]

  const grid = (
    <div className={`grid ${FILTROS.length === 4 ? 'grid-cols-4' : 'grid-cols-3'} gap-1 ${className}`}>
      {FILTROS.map((f) =>
        f.id === 'mes' && !MOSTRAR_PERSONALIZADO && onCambiarPersonalizado ? (
          <BotonMes
            key={f.id}
            filtro={filtro}
            onCambiarFiltro={onCambiarFiltro}
            personalizado={personalizado}
            onCambiarPersonalizado={onCambiarPersonalizado}
            clases={clases}
            padding={padding}
          />
        ) : (
        <button
          key={f.id}
          type="button"
          onClick={() => onCambiarFiltro(f.id)}
          className={`min-w-0 overflow-visible whitespace-nowrap rounded-full px-1 py-2 text-center text-xs transition-colors ${PADDING_BOTON[padding]} ${
            filtro === f.id ? clases.activo : clases.inactivo
          }`}
        >
          {f.label}
        </button>
        ),
      )}
    </div>
  )

  if (!sticky) return grid
  return <div className="sticky top-0 z-10 -mx-(--separador-vertical) bg-bg px-(--separador-vertical) pb-2 pt-(--separador-horizontal)">{grid}</div>
}

// Campos Desde/Hasta, solo visibles con filtro === 'personalizado'. Nunca
// quedan dentro del contenedor sticky en ninguna pantalla original — por eso
// se exportan aparte de Botones en vez de ir juntos en un solo contenedor.
function CamposPersonalizado({ filtro, personalizado, onCambiarPersonalizado, tema = 'amber', disenoFechas = 'linea' }) {
  // useId (no un string fijo) porque con el cache de pestañas puede haber
  // varias instancias de este componente montadas a la vez (ocultas, en
  // pestañas distintas) — un id fijo duplicaría el id en el DOM.
  const idBase = useId()
  const idDesde = `${idBase}-desde`
  const idHasta = `${idBase}-hasta`

  if (!MOSTRAR_PERSONALIZADO || filtro !== 'personalizado') return null
  const clases = TEMA_CLASES[tema]

  if (disenoFechas === 'apilado') {
    return (
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={idDesde} className="mb-1 block text-xs text-ink/60">
            Desde
          </label>
          <input
            id={idDesde}
            type="date"
            value={personalizado.desde}
            onChange={(evento) =>
              onCambiarPersonalizado((anterior) => ({ ...anterior, desde: evento.target.value }))
            }
            className={`rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none ${clases.focusInput}`}
          />
        </div>
        <div>
          <label htmlFor={idHasta} className="mb-1 block text-xs text-ink/60">
            Hasta
          </label>
          <input
            id={idHasta}
            type="date"
            value={personalizado.hasta}
            onChange={(evento) =>
              onCambiarPersonalizado((anterior) => ({ ...anterior, hasta: evento.target.value }))
            }
            className={`rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none ${clases.focusInput}`}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="mt-3 flex flex-nowrap items-center gap-1.5 overflow-x-auto">
      <label htmlFor={idDesde} className="shrink-0 text-xs text-ink/60">
        Desde
      </label>
      <input
        id={idDesde}
        type="date"
        value={personalizado.desde}
        onChange={(evento) =>
          onCambiarPersonalizado((anterior) => ({ ...anterior, desde: evento.target.value }))
        }
        className={`min-w-0 shrink rounded-lg border border-border bg-surface-2 px-2.5 py-2 font-mono text-sm text-ink outline-none ${clases.focusInput}`}
      />
      <label htmlFor={idHasta} className="shrink-0 text-xs text-ink/60">
        Hasta
      </label>
      <input
        id={idHasta}
        type="date"
        value={personalizado.hasta}
        onChange={(evento) =>
          onCambiarPersonalizado((anterior) => ({ ...anterior, hasta: evento.target.value }))
        }
        className={`min-w-0 shrink rounded-lg border border-border bg-surface-2 px-2.5 py-2 font-mono text-sm text-ink outline-none ${clases.focusInput}`}
      />
    </div>
  )
}

// Caso común: botones + campos personalizados como hermanos directos (ni el
// contenedor sticky de Botones ni CamposPersonalizado se anidan entre sí).
// Auditoria usa FiltrosFecha.Botones y FiltrosFecha.CamposPersonalizado por
// separado porque intercala su propio buscador dentro del mismo sticky.
export default function FiltrosFecha(props) {
  return (
    <>
      <Botones {...props} />
      <CamposPersonalizado {...props} />
    </>
  )
}

FiltrosFecha.Botones = Botones
FiltrosFecha.CamposPersonalizado = CamposPersonalizado
