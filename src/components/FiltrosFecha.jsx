import { useId } from 'react'

const FILTROS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes', label: 'Este mes' },
  { id: 'personalizado', label: 'Personalizado' },
]

const TEMA_CLASES = {
  amber: {
    activo: 'bg-amber font-semibold text-bg',
    inactivo: 'border border-border-strong text-ink/70 hover:border-amber hover:text-amber',
    focusInput: 'focus:border-amber',
  },
  'purple-300': {
    activo: 'bg-purple-300 font-semibold text-bg',
    inactivo: 'border border-border-strong text-ink/70 hover:border-purple-300 hover:text-purple-300',
    focusInput: 'focus:border-purple-300',
  },
}

const PADDING_BOTON = {
  compacta: 'sm:px-3 sm:text-sm',
  ancha: 'sm:px-4 sm:py-1.5 sm:text-sm',
}

// Fila de botones Hoy/Esta semana/Este mes/Personalizado. `sticky` envuelve
// la fila en el mismo contenedor pegajoso que usaban Dashboard/Estadísticas;
// las demás pantallas la insertan en su propio contenedor (ver Botones y
// CamposPersonalizado exportados aparte para esos casos a medida).
function Botones({ filtro, onCambiarFiltro, tema = 'amber', padding = 'compacta', sticky = false, className = '' }) {
  const clases = TEMA_CLASES[tema]

  const grid = (
    <div className={`grid grid-cols-4 gap-1 ${className}`}>
      {FILTROS.map((f) => (
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
      ))}
    </div>
  )

  if (!sticky) return grid
  return <div className="sticky top-0 z-10 -mx-3 bg-bg px-3 py-2">{grid}</div>
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

  if (filtro !== 'personalizado') return null
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
