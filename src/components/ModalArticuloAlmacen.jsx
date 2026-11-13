import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { leerImporte } from '../lib/moneda.js'
import Etiqueta from './Etiqueta.jsx'
import { STOCK_MINIMO_ALMACEN, mensajeErrorAlmacen, soloEnteros, soloImporte } from '../lib/almacen.js'

// Crear / editar un artículo del Almacén (solo administradora; guardar_articulo_almacen, migración 20261112000011).
// Al crear, el stock inicial se registra como el primer INGRESO con su costo. Al editar, el stock no se toca: solo
// cambia con ingresos y salidas, para que el historial siempre cuadre.

const CLASE_INPUT =
  'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300'

export default function ModalArticuloAlmacen({ articulo, categoriasExistentes = [], onCerrar, onGuardado }) {
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const esEdicion = Boolean(articulo)

  const [nombre, setNombre] = useState(articulo?.nombre ?? '')
  const [categoria, setCategoria] = useState(articulo?.categoria ?? '')
  const [unidad, setUnidad] = useState(articulo?.unidad ?? 'unidad')
  const [activo, setActivo] = useState(articulo?.activo ?? true)
  const [stockInicial, setStockInicial] = useState('')
  const [costoInicial, setCostoInicial] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  // Mientras guarda, Esc no cierra; el modal sigue en la pila para que tampoco cierre el de abajo.
  useCerrarConEscape(() => {
    if (!guardando) onCerrar()
  })

  async function guardar(evento) {
    evento.preventDefault()

    if (!nombre.trim()) {
      setError('El nombre es obligatorio.')
      return
    }

    let inicial = 0
    let costo = null
    if (!esEdicion && stockInicial.trim() !== '') {
      if (!/^\d+$/.test(stockInicial.trim())) {
        setError('El stock inicial debe ser un número entero (0 o más).')
        return
      }
      inicial = Number(stockInicial.trim())
      if (inicial > 0) {
        costo = leerImporte(costoInicial)
        if (Number.isNaN(costo)) {
          setError('Ingresa el costo total del stock inicial (ej. 15 o 15.50; 0 si no costó nada).')
          return
        }
      }
    }

    setGuardando(true)
    setError(null)
    const { error: errorRpc } = await supabase.rpc('guardar_articulo_almacen', {
      p_id: articulo?.id ?? null,
      p_nombre: nombre,
      p_categoria: categoria,
      p_unidad: unidad,
      // Ya no se pide: nuevo = 3; al editar se conserva el que tenga.
      p_stock_minimo: articulo?.stock_minimo ?? STOCK_MINIMO_ALMACEN,
      p_activo: activo,
      p_stock_inicial: inicial,
      p_costo_inicial: costo,
    })
    setGuardando(false)

    if (errorRpc) {
      setError(mensajeErrorAlmacen(errorRpc, 'No se pudo guardar el artículo. Intenta de nuevo.'))
      return
    }
    onGuardado()
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        style={{ '--color-foco': 'var(--color-purple-300)' }}
        className="max-h-full w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
      >
        <h2 className="text-base font-semibold text-ink">{esEdicion ? 'Editar artículo' : 'Nuevo artículo'}</h2>
        <p className="mt-1 text-sm text-ink/60">Cosas de uso interno del negocio que no se venden.</p>

        <div className="mt-4 space-y-3">
          <div>
            <Etiqueta obligatorio htmlFor="articulo-nombre">
              Nombre
            </Etiqueta>
            <input
              id="articulo-nombre"
              type="text"
              value={nombre}
              maxLength={80}
              onChange={(evento) => setNombre(evento.target.value)}
              placeholder="Ej: Agua San Luis 625 ml"
              autoFocus
              className={CLASE_INPUT}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiqueta htmlFor="articulo-categoria">Categoría</Etiqueta>
              <input
                id="articulo-categoria"
                type="text"
                list="almacen-categorias"
                value={categoria}
                maxLength={40}
                onChange={(evento) => setCategoria(evento.target.value)}
                placeholder="Ej: Bebidas"
                className={CLASE_INPUT}
              />
              <datalist id="almacen-categorias">
                {categoriasExistentes.map((opcion) => (
                  <option key={opcion} value={opcion} />
                ))}
              </datalist>
            </div>
            <div>
              <Etiqueta htmlFor="articulo-unidad">Unidad</Etiqueta>
              <input
                id="articulo-unidad"
                type="text"
                value={unidad}
                maxLength={20}
                onChange={(evento) => setUnidad(evento.target.value)}
                placeholder="Ej: botella, rollo, caja"
                className={CLASE_INPUT}
              />
            </div>
          </div>

          {!esEdicion && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Etiqueta htmlFor="articulo-stock-inicial">Stock inicial</Etiqueta>
                <input
                  id="articulo-stock-inicial"
                  type="search"
                  inputMode="numeric"
                  autoComplete="new-password"
                  value={stockInicial}
                  onChange={(evento) => setStockInicial(soloEnteros(evento.target.value))}
                  placeholder="0"
                  className={`${CLASE_INPUT} font-mono`}
                />
              </div>
              <div>
                <Etiqueta obligatorio={Number(stockInicial) > 0} htmlFor="articulo-costo-inicial">
                  Costo total (S/)
                </Etiqueta>
                <input
                  id="articulo-costo-inicial"
                  type="search"
                  inputMode="decimal"
                  autoComplete="new-password"
                  value={costoInicial}
                  onChange={(evento) => setCostoInicial(soloImporte(evento.target.value))}
                  disabled={!(Number(stockInicial) > 0)}
                  className={`${CLASE_INPUT} font-mono disabled:opacity-40`}
                />
              </div>
            </div>
          )}

          {esEdicion && (
            <div>
              <Etiqueta>Estado</Etiqueta>
              <div className="flex gap-2">
                {[
                  { valor: true, label: 'Activo' },
                  { valor: false, label: 'Inactivo' },
                ].map((opcion) => (
                  <button
                    key={opcion.label}
                    type="button"
                    onClick={() => setActivo(opcion.valor)}
                    aria-pressed={activo === opcion.valor}
                    className={`flex-1 rounded-lg border py-2 text-sm transition-colors ${
                      activo === opcion.valor
                        ? 'border-purple-300 bg-purple-300/10 text-purple-300'
                        : 'border-border text-ink/70 hover:border-border-strong'
                    }`}
                  >
                    {opcion.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-ink/50">El personal no ve los artículos inactivos.</p>
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
            {error}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCerrar}
            disabled={guardando}
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="flex-1 rounded-lg bg-purple-300 py-2 text-sm font-semibold text-bg disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Crear artículo'}
          </button>
        </div>
      </form>
    </div>
  )
}
