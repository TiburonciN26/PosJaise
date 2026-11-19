import { useEffect, useRef, useState } from 'react'
import { Download, FileText, Filter, Settings, Upload } from 'lucide-react'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import SelectorOrden from './SelectorOrden.jsx'

// Solo celular (`sm:hidden`): reúne en una rueda lo que en PC son cuatro íconos sueltos de la barra del Historial — ordenar,
// filtrar por método de pago y las dos descargas (ventas y boletas/facturas para la contadora) más la importación de lo que ella devuelve. Las descargas son solo de la admin.
// Ordenar y filtrar usan los MISMOS selectores con ícono de la barra de PC (SelectorOrden), no <select> nativos: en el celular
// un <select> abre el selector de pantalla completa del sistema.
// El ícono de la rueda se pinta de ámbar mientras haya un filtro de método elegido, para que se note aun con el menú cerrado.
export default function MenuOpcionesHistorial({
  opcionesOrden,
  orden,
  onOrden,
  opcionesMetodo,
  metodo,
  onMetodo,
  claseIconoMetodo,
  esAdmin,
  onExportarVentas,
  exportandoVentas,
  onExportarComprobantes,
  exportandoComprobantes,
  onImportar,
  importando,
}) {
  const [abierto, setAbierto] = useState(false)
  const raiz = useRef(null)
  useCerrarConEscape(() => setAbierto(false), abierto, { trabajoPendiente: false })

  useEffect(() => {
    if (!abierto) return undefined
    function alPulsarFuera(evento) {
      if (raiz.current && !raiz.current.contains(evento.target)) setAbierto(false)
    }
    document.addEventListener('pointerdown', alPulsarFuera)
    return () => document.removeEventListener('pointerdown', alPulsarFuera)
  }, [abierto])

  const hayFiltro = metodo !== 'todos'

  function descargar(accion) {
    setAbierto(false)
    accion()
  }

  return (
    <div ref={raiz} className="relative shrink-0 sm:hidden">
      <button
        type="button"
        onClick={() => setAbierto((anterior) => !anterior)}
        aria-label="Opciones del historial: ordenar, filtrar y descargar"
        aria-expanded={abierto}
        aria-haspopup="dialog"
        className={`flex items-center justify-center rounded-lg border border-transparent bg-boton-icono p-2.5 transition-colors ${
          abierto || hayFiltro ? 'text-amber' : 'text-ink/70 hover:text-amber'
        }`}
      >
        <Settings className="h-4 w-4" />
      </button>

      {abierto && (
        <div
          role="dialog"
          aria-label="Opciones del historial"
          className="absolute right-0 top-full z-20 mt-1 w-60 rounded-lg border border-border bg-surface-2 px-3 py-2 shadow-lg"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink">Ordenar por</span>
            <SelectorOrden opciones={opcionesOrden} valor={orden} onCambiar={onOrden} tema="amber" sinBorde />
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink">Método de pago</span>
            <SelectorOrden
              opciones={opcionesMetodo}
              valor={metodo}
              onCambiar={onMetodo}
              tema="amber"
              sinBorde
              icono={Filter}
              seleccionado
              claseIcono={claseIconoMetodo}
              ariaLabel="Filtrar por método de pago"
            />
          </div>

          {esAdmin && (
            <div className="mt-1 space-y-1 border-t border-border pt-2">
              <button
                type="button"
                onClick={() => descargar(onExportarVentas)}
                disabled={exportandoVentas}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-3 hover:text-amber disabled:opacity-40"
              >
                <Download className="h-4 w-4 shrink-0" />
                Descargar ventas (CSV)
              </button>
              <button
                type="button"
                onClick={() => descargar(onExportarComprobantes)}
                disabled={exportandoComprobantes}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-3 hover:text-amber disabled:opacity-40"
              >
                <FileText className="h-4 w-4 shrink-0" />
                Descargar boletas y facturas
              </button>
              <button
                type="button"
                onClick={() => descargar(onImportar)}
                disabled={importando}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-3 hover:text-amber disabled:opacity-40"
              >
                <Upload className="h-4 w-4 shrink-0" />
                Importar números emitidos
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
