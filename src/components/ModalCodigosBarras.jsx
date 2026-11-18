import { useEffect, useMemo, useRef, useState } from 'react'
import { Barcode, Download } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { aCSV, descargarArchivo } from '../lib/csv.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import BarraBusqueda from './BarraBusqueda.jsx'
import BotonCerrarModal from './BotonCerrarModal.jsx'
import EstadoVacio from './EstadoVacio.jsx'

const TAMANO_LOTE = 1000 // el servidor corta cada respuesta en 1000 filas (max_rows): se pide por lotes hasta traer todo
const FILAS_VISIBLES = 100

// Hoja de códigos de barras: TODOS los productos con su código (nombre + código, nada más), para exportar a CSV o
// consultar. La etiqueta de un producto se imprime desde su registro desplegado en Inventario. Los códigos viven en `productos.codigo_barras`; no hay una
// tabla aparte que mantener sincronizada.
export default function ModalCodigosBarras({ onCerrar }) {
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  useCerrarConEscape(onCerrar)

  const [productos, setProductos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [visibles, setVisibles] = useState(FILAS_VISIBLES)

  useEffect(() => {
    let vigente = true
    async function cargar() {
      const todos = []
      for (let desde = 0; ; desde += TAMANO_LOTE) {
        const { data, error: errorLote } = await supabase
          .from('productos_vista')
          .select('id, nombre, codigo_barras')
          .order('nombre', { ascending: true })
          .order('id', { ascending: true })
          .range(desde, desde + TAMANO_LOTE - 1)
        if (!vigente) return
        if (errorLote) {
          setError('No se pudieron cargar los códigos.')
          setCargando(false)
          return
        }
        todos.push(...(data ?? []))
        if ((data ?? []).length < TAMANO_LOTE) break
      }
      setProductos(todos)
      setCargando(false)
    }
    cargar()
    return () => {
      vigente = false
    }
  }, [])

  const filtrados = useMemo(() => {
    const termino = busqueda.trim().toLowerCase()
    if (!termino) return productos
    return productos.filter(
      (p) => p.nombre.toLowerCase().includes(termino) || (p.codigo_barras ?? '').toLowerCase().includes(termino),
    )
  }, [productos, busqueda])

  const conCodigo = productos.filter((p) => p.codigo_barras).length

  function exportar() {
    descargarArchivo(
      'codigos-de-barras.csv',
      aCSV(
        filtrados.map((p) => ({ producto: p.nombre, codigo: p.codigo_barras ?? '' })),
        ['producto', 'codigo'],
      ),
    )
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <div
        ref={panelRef}
        className="flex max-h-full w-full max-w-2xl flex-col rounded-lg border border-border bg-surface sm:max-h-[85dvh]"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">Códigos de barras</h2>
            {!cargando && !error && (
              <p className="text-xs text-ink/60">
                {productos.length} productos · {conCodigo} con código
              </p>
            )}
          </div>
          <BotonCerrarModal onClick={onCerrar} />
        </div>

        <div className="flex items-center gap-2 border-b border-border px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
          <BarraBusqueda
            valor={busqueda}
            onCambiar={(valor) => {
              setBusqueda(valor)
              setVisibles(FILAS_VISIBLES)
            }}
            placeholder="Buscar producto o código..."
            tema="amber"
            sinBorde
            sinVoz
          />
          <button
            type="button"
            onClick={exportar}
            disabled={cargando || filtrados.length === 0}
            aria-label="Exportar a CSV"
            title={busqueda.trim() ? 'Exportar los resultados a CSV' : 'Exportar todos a CSV'}
            className="flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-boton-icono p-2.5 text-ink/70 transition-colors hover:text-amber disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {cargando ? (
            <p role="status" className="p-6 text-center font-mono text-sm text-ink/60">Cargando...</p>
          ) : error ? (
            <p role="alert" className="p-6 text-center text-sm text-red">{error}</p>
          ) : filtrados.length === 0 ? (
            <EstadoVacio icono={Barcode} mensaje="No se encontraron productos." />
          ) : (
            <div role="table" aria-label="Códigos de barras de los productos">
              {/* Estilo tabla: Producto (si no cabe, se corta con «…») | Código (siempre completo). */}
              <div
                role="row"
                className="sticky top-0 z-10 grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-center gap-3 border-b border-border bg-surface px-3 py-2 font-mono text-xs uppercase tracking-wider text-ink/60"
              >
                <span role="columnheader">Producto</span>
                <span role="columnheader">Código</span>
              </div>
              <div className="divide-y divide-border">
                {filtrados.slice(0, visibles).map((producto) => (
                  <div
                    key={producto.id}
                    role="row"
                    className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-center gap-3 px-3 py-1.5"
                  >
                    <span role="cell" className="truncate text-sm text-ink" title={producto.nombre}>
                      {producto.nombre}
                    </span>
                    <span role="cell" className="break-all font-mono text-xs text-ink/70">
                      {producto.codigo_barras || <span className="text-ink/40">Sin código</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!cargando && !error && filtrados.length > visibles && (
            <button
              type="button"
              onClick={() => setVisibles((n) => n + FILAS_VISIBLES)}
              className="m-3 w-[calc(100%-1.5rem)] rounded-lg border border-border-strong py-2 text-sm text-ink/70 transition-colors hover:border-amber hover:text-amber"
            >
              Mostrar más ({filtrados.length - visibles} restantes)
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
