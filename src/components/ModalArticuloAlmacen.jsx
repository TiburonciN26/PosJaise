import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAvisoDescarte } from '../hooks/useAvisoDescarte.jsx'
import { listarCambios } from '../lib/cambiosFormulario.js'
import BotonCerrarModal from './BotonCerrarModal.jsx'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { formatearSoles, leerImporte } from '../lib/moneda.js'
import Etiqueta from './Etiqueta.jsx'
import {
  COSTO_MAXIMO_ALMACEN,
  STOCK_MINIMO_ALMACEN,
  calcularCostoTotal,
  mensajeErrorAlmacen,
  soloEnteros,
  soloImporte,
} from '../lib/almacen.js'

// Crear / editar un artículo del Almacén (solo administradora; guardar_articulo_almacen, migración 20261112000011).
// Al crear, el stock inicial se registra como el primer INGRESO: se pide el precio unitario y el total (stock × precio)
// se calcula solo. Al editar, el stock no se toca: solo cambia con ingresos y salidas, para que el historial cuadre.
// La categoría ya no se pide (pedido de la dueña): la columna sigue en la tabla y al editar se conserva la que tuviera.

const CLASE_INPUT =
  'w-full min-w-0 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300'

export default function ModalArticuloAlmacen({ articulo, onCerrar, onGuardado }) {
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const esEdicion = Boolean(articulo)

  const [nombre, setNombre] = useState(articulo?.nombre ?? '')
  const [unidad, setUnidad] = useState(articulo?.unidad ?? 'unidad')
  const [activo, setActivo] = useState(articulo?.activo ?? true)
  const [stockInicial, setStockInicial] = useState('')
  const [precioUnitario, setPrecioUnitario] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  const cantidadInicial = stockInicial.trim() === '' ? 0 : Number(stockInicial)
  const conStock = cantidadInicial > 0
  const totalCalculado = conStock ? calcularCostoTotal(cantidadInicial, leerImporte(precioUnitario)) : null

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
        if (totalCalculado == null) {
          setError('Ingresa el precio unitario (ej. 2.50; 0 si no costó nada).')
          return
        }
        if (totalCalculado > COSTO_MAXIMO_ALMACEN) {
          setError('El total es demasiado alto. Revisa el stock y el precio unitario.')
          return
        }
        costo = totalCalculado
      }
    }

    setGuardando(true)
    setError(null)
    const { error: errorRpc } = await supabase.rpc('guardar_articulo_almacen', {
      p_id: articulo?.id ?? null,
      p_nombre: nombre,
      p_categoria: articulo?.categoria ?? null,
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

  // X, «Cancelar» y Esc: con cambios sin guardar se pregunta antes de cerrar y se dice qué se perdería.
  const valoresFormulario = { nombre, unidad, activo, stockInicial, precioUnitario }
  const valoresBase = useRef(valoresFormulario)
  const cambios = listarCambios(valoresBase.current, valoresFormulario, {
    nombre: 'Nombre',
    unidad: 'Unidad',
    activo: 'Activo',
    stockInicial: 'Stock inicial',
    precioUnitario: 'Precio unitario',
  })
  const { intentarCerrar, aviso } = useAvisoDescarte({ cambios, onCerrar, bloqueado: guardando })

  const campoUnidad = (
    <div className="min-w-0">
      <Etiqueta htmlFor="articulo-unidad">Unidad</Etiqueta>
      <input
        id="articulo-unidad"
        type="text"
        value={unidad}
        maxLength={20}
        onChange={(evento) => setUnidad(evento.target.value)}
        placeholder="unidad"
        className={CLASE_INPUT}
      />
    </div>
  )

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        style={{ '--color-foco': 'var(--color-purple-300)' }}
        className="max-h-full w-full max-w-md overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">{esEdicion ? 'Editar artículo' : 'Nuevo artículo'}</h2>
          <BotonCerrarModal onClick={intentarCerrar} disabled={guardando} />
        </div>
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
              autoFocus
              className={CLASE_INPUT}
            />
          </div>

          {esEdicion ? (
            campoUnidad
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {campoUnidad}
              <div className="min-w-0">
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
            </div>
          )}
          <p className="-mt-1.5 text-xs text-ink/50">
            Unidad: cómo se cuenta el stock (botella, rollo, caja…). Se muestra junto al número, ej. «12 {unidad.trim() || 'unidad'}».
          </p>

          {!esEdicion && (
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <Etiqueta obligatorio={conStock} htmlFor="articulo-precio-unitario">
                  Precio unitario (S/)
                </Etiqueta>
                <input
                  id="articulo-precio-unitario"
                  type="search"
                  inputMode="decimal"
                  autoComplete="new-password"
                  value={precioUnitario}
                  onChange={(evento) => setPrecioUnitario(soloImporte(evento.target.value))}
                  disabled={!conStock}
                  className={`${CLASE_INPUT} font-mono disabled:opacity-40`}
                />
              </div>
              <div className="min-w-0">
                {/* Solo lectura: stock inicial × precio unitario. */}
                <Etiqueta htmlFor="articulo-costo-total">Total</Etiqueta>
                <output
                  id="articulo-costo-total"
                  htmlFor="articulo-stock-inicial articulo-precio-unitario"
                  aria-live="polite"
                  className={`flex w-full items-center rounded-lg border border-dashed border-border px-3 py-2 text-sm ${
                    totalCalculado != null ? 'font-mono text-purple-300' : 'text-ink/50'
                  }`}
                >
                  {totalCalculado != null ? formatearSoles(totalCalculado) : '—'}
                </output>
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
            onClick={intentarCerrar}
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
      {aviso}
    </div>
  )
}
