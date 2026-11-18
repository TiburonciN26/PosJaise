import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAvisoDescarte } from '../hooks/useAvisoDescarte.jsx'
import { listarCambios } from '../lib/cambiosFormulario.js'
import BotonCerrarModal from './BotonCerrarModal.jsx'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { MENSAJE_NEGOCIO_CERRADO } from '../lib/estadoNegocio.js'
import { useProveedores } from '../hooks/useProveedores.js'

// Mismo tope que el entero de la base (int4): más allá, agregar_stock fallaría por desborde.
const MAXIMO_CANTIDAD = 2147483647
const MENSAJE_PROVEEDOR_INACTIVO = 'Ese proveedor no existe o está inactivo'
const MENSAJE_CANTIDAD_INVALIDA = 'La cantidad debe ser un número entero mayor a 0 (sin decimales ni letras).'

// Proveedor del ingreso: primero los del producto (el principal por defecto) y luego cualquier otro activo. Elegir uno que
// no estaba vinculado lo vincula al producto (lo hace agregar_stock). Los proveedores nuevos se crean en la pestaña
// Proveedores o desde el producto. `esAdmin`: solo la administradora puede leer TODOS los vínculos del producto; para
// los demás roles «De este producto» es solo el principal (productos_vista.proveedor_id).
export default function ModalAgregarStock({ producto, esAdmin = false, onCerrar, onGuardado }) {
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const [cantidad, setCantidad] = useState('')
  const [nota, setNota] = useState('')
  const { lista: nombres } = useProveedores({ soloNombres: true })
  const [proveedorId, setProveedorId] = useState(producto.proveedor_id ?? '')
  const [vinculadosIds, setVinculadosIds] = useState(producto.proveedor_id ? [producto.proveedor_id] : [])

  useEffect(() => {
    if (!esAdmin) return undefined
    let vigente = true
    supabase
      .from('producto_proveedores')
      .select('proveedor_id, principal')
      .eq('producto_id', producto.id)
      .then(({ data }) => {
        if (!vigente || !data) return
        setVinculadosIds([...data].sort((a, b) => Number(b.principal) - Number(a.principal)).map((v) => v.proveedor_id))
      })
    return () => {
      vigente = false
    }
  }, [esAdmin, producto.id])

  const activos = nombres.filter((p) => p.activo)
  const delProducto = vinculadosIds.map((id) => activos.find((p) => p.id === id)).filter(Boolean)
  const otros = activos.filter((p) => !vinculadosIds.includes(p.id))
  // Un principal inactivo (o una lista aún sin cargar) no puede quedar elegido: el servidor lo rechazaría.
  const proveedorElegido = activos.some((p) => p.id === proveedorId) ? proveedorId : ''
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  async function guardar(evento) {
    evento.preventDefault()

    // Se valida la cadena completa: parseInt('2.7') o parseInt('5abc') devolvían 2 y 5 y se guardaba
    // en silencio solo el prefijo entero (QA-036). Solo dígitos, entero positivo y dentro del rango de int4.
    const texto = cantidad.trim()
    const cantidadNumerica = /^\d+$/.test(texto) ? Number(texto) : NaN
    if (!Number.isSafeInteger(cantidadNumerica) || cantidadNumerica <= 0 || cantidadNumerica > MAXIMO_CANTIDAD) {
      setError(MENSAJE_CANTIDAD_INVALIDA)
      return
    }

    setGuardando(true)
    setError(null)

    const { data, error: errorRpc } = await supabase.rpc('agregar_stock', {
      p_producto_id: producto.id,
      p_cantidad: cantidadNumerica,
      p_nota: nota,
      p_proveedor_id: proveedorElegido || null,
    })

    setGuardando(false)

    if (errorRpc) {
      setError(
        errorRpc.message === MENSAJE_NEGOCIO_CERRADO || errorRpc.message === MENSAJE_PROVEEDOR_INACTIVO
          ? errorRpc.message
          : 'No se pudo agregar el stock. Intenta de nuevo.',
      )
      return
    }

    onGuardado(data?.[0]?.stock_nuevo)
  }

  // X, «Cancelar» y Esc: con cambios sin guardar se pregunta antes de cerrar y se dice qué se perdería.
  const valoresFormulario = { cantidad, nota, proveedorId }
  const valoresBase = useRef(valoresFormulario)
  const cambios = listarCambios(valoresBase.current, valoresFormulario, { cantidad: 'Cantidad', nota: 'Nota', proveedorId: 'Proveedor' }, {
    sinValor: ['proveedorId'],
  })
  const { intentarCerrar, aviso } = useAvisoDescarte({ cambios, onCerrar, bloqueado: guardando })

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        className="max-h-full w-full max-w-sm overflow-y-auto rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">Agregar stock</h2>
          <BotonCerrarModal onClick={intentarCerrar} disabled={guardando} />
        </div>
        <p className="mt-1 text-sm text-ink">{producto.nombre}</p>
        <p className="font-mono text-xs text-ink/60">Stock actual: {producto.stock_actual}</p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs text-ink/60">
              Cantidad a agregar<span className="text-red"> *</span>
            </label>
            <input
              type="search"
              inputMode="numeric"
              autoComplete="new-password"
              value={cantidad}
              onChange={(evento) => setCantidad(evento.target.value)}
              autoFocus
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-ink/60">Proveedor</label>
            <select
              value={proveedorElegido}
              onChange={(evento) => setProveedorId(evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-amber"
            >
              <option value="">Sin proveedor</option>
              {delProducto.length > 0 && (
                <optgroup label="De este producto">
                  {delProducto.map((p, indice) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                      {indice === 0 && p.id === producto.proveedor_id ? ' (principal)' : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {otros.length > 0 && (
                <optgroup label="Otros proveedores">
                  {otros.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {proveedorElegido && !vinculadosIds.includes(proveedorElegido) && (
              <p className="mt-1 text-[11px] text-ink/50">Quedará vinculado a este producto como otro de sus proveedores.</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs text-ink/60">Nota</label>
            <input
              type="search"
              autoComplete="new-password"
              value={nota}
              onChange={(evento) => setNota(evento.target.value)}
              placeholder="Ej: Compra proveedor X"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-amber"
            />
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
            {error}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={intentarCerrar}
            disabled={guardando}
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="flex-1 rounded-lg bg-amber py-2 text-sm font-semibold text-bg disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : 'Agregar'}
          </button>
        </div>
      </form>
      {aviso}
    </div>
  )
}
