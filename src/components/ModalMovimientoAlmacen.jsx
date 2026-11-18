import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAvisoDescarte } from '../hooks/useAvisoDescarte.jsx'
import { listarCambios } from '../lib/cambiosFormulario.js'
import BotonCerrarModal from './BotonCerrarModal.jsx'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { formatearSoles, leerImporte } from '../lib/moneda.js'
import Etiqueta from './Etiqueta.jsx'
import { COSTO_MAXIMO_ALMACEN, calcularCostoTotal, mensajeErrorAlmacen, soloEnteros, soloImporte } from '../lib/almacen.js'

// Registrar un movimiento del Almacén (migración 20261112000011):
//   · SALIDA  → cualquier rol del personal anota lo que sacó (registrar_salida_almacen). No deja bajar de 0.
//   · INGRESO → solo la administradora. Anota el PRECIO UNITARIO y el total (cantidad × precio) se calcula solo; al
//     servidor va ese total, como siempre (registrar_ingreso_almacen).
// Quién y cuándo los pone el servidor (auth.uid() y now()), no el formulario.

const MAXIMO_CANTIDAD = 2147483647
const MENSAJE_CANTIDAD_INVALIDA = 'La cantidad debe ser un número entero mayor a 0 (sin decimales ni letras).'

export default function ModalMovimientoAlmacen({ articulo, tipo, onCerrar, onGuardado }) {
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const esIngreso = tipo === 'INGRESO'
  const [cantidad, setCantidad] = useState('')
  const [precioUnitario, setPrecioUnitario] = useState('')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  const cantidadEscrita = /^\d+$/.test(cantidad.trim()) ? Number(cantidad.trim()) : null
  const totalCalculado =
    esIngreso && cantidadEscrita > 0 ? calcularCostoTotal(cantidadEscrita, leerImporte(precioUnitario)) : null

  // Mientras guarda, Esc no cierra; el modal sigue en la pila para que tampoco cierre el de abajo.

  async function guardar(evento) {
    evento.preventDefault()

    const texto = cantidad.trim()
    const cantidadNumerica = /^\d+$/.test(texto) ? Number(texto) : Number.NaN
    if (!Number.isSafeInteger(cantidadNumerica) || cantidadNumerica <= 0 || cantidadNumerica > MAXIMO_CANTIDAD) {
      setError(MENSAJE_CANTIDAD_INVALIDA)
      return
    }
    if (!esIngreso && cantidadNumerica > articulo.stock_actual) {
      setError(`Solo quedan ${articulo.stock_actual} ${articulo.unidad} en el almacén.`)
      return
    }
    const costoNumerico = esIngreso ? calcularCostoTotal(cantidadNumerica, leerImporte(precioUnitario)) : null
    if (esIngreso && costoNumerico == null) {
      setError('Ingresa el precio unitario (ej. 2.50; 0 si no costó nada).')
      return
    }
    if (esIngreso && costoNumerico > COSTO_MAXIMO_ALMACEN) {
      setError('El total es demasiado alto. Revisa la cantidad y el precio unitario.')
      return
    }

    setGuardando(true)
    setError(null)
    const { data, error: errorRpc } = esIngreso
      ? await supabase.rpc('registrar_ingreso_almacen', {
          p_articulo_id: articulo.id,
          p_cantidad: cantidadNumerica,
          p_costo: costoNumerico,
          p_nota: nota,
        })
      : await supabase.rpc('registrar_salida_almacen', {
          p_articulo_id: articulo.id,
          p_cantidad: cantidadNumerica,
          p_nota: nota,
        })
    setGuardando(false)

    if (errorRpc) {
      setError(mensajeErrorAlmacen(errorRpc, 'No se pudo registrar el movimiento. Intenta de nuevo.'))
      return
    }
    onGuardado(data)
  }

  const colorFoco = esIngreso ? 'focus:border-green' : 'focus:border-purple-300'

  // X, «Cancelar» y Esc: con cambios sin guardar se pregunta antes de cerrar y se dice qué se perdería.
  const valoresFormulario = { cantidad, precioUnitario, nota }
  const valoresBase = useRef(valoresFormulario)
  const cambios = listarCambios(valoresBase.current, valoresFormulario, { cantidad: 'Cantidad', precioUnitario: 'Precio unitario', nota: 'Nota' })
  const { intentarCerrar, aviso } = useAvisoDescarte({ cambios, onCerrar, bloqueado: guardando })

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        className="max-h-full w-full max-w-sm overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">{esIngreso ? 'Ingreso al almacén' : 'Sacar del almacén'}</h2>
          <BotonCerrarModal onClick={intentarCerrar} disabled={guardando} />
        </div>
        <p className="mt-1 text-sm text-ink">{articulo.nombre}</p>
        <p className="font-mono text-xs text-ink/60">
          Stock actual: {articulo.stock_actual} {articulo.unidad}
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <Etiqueta obligatorio htmlFor="almacen-cantidad">
              {esIngreso ? 'Cantidad que entra' : 'Cantidad que se saca'}
            </Etiqueta>
            <input
              id="almacen-cantidad"
              type="search"
              inputMode="numeric"
              autoComplete="new-password"
              value={cantidad}
              onChange={(evento) => setCantidad(soloEnteros(evento.target.value))}
              autoFocus
              className={`w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none ${colorFoco}`}
            />
          </div>

          {esIngreso && (
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <Etiqueta obligatorio htmlFor="almacen-precio-unitario">
                  Precio unitario (S/)
                </Etiqueta>
                <input
                  id="almacen-precio-unitario"
                  type="search"
                  inputMode="decimal"
                  autoComplete="new-password"
                  value={precioUnitario}
                  onChange={(evento) => setPrecioUnitario(soloImporte(evento.target.value))}
                  className={`w-full min-w-0 rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/60 ${colorFoco}`}
                />
              </div>
              <div className="min-w-0">
                {/* Solo lectura: cantidad × precio unitario. */}
                <Etiqueta htmlFor="almacen-costo-total">Total</Etiqueta>
                <output
                  id="almacen-costo-total"
                  htmlFor="almacen-cantidad almacen-precio-unitario"
                  aria-live="polite"
                  className={`flex w-full items-center rounded-lg border border-dashed border-border px-3 py-2 text-sm ${
                    totalCalculado != null ? 'font-mono text-green' : 'text-ink/50'
                  }`}
                >
                  {totalCalculado != null ? formatearSoles(totalCalculado) : '—'}
                </output>
              </div>
            </div>
          )}

          <div>
            <Etiqueta htmlFor="almacen-nota">Nota</Etiqueta>
            <input
              id="almacen-nota"
              type="search"
              autoComplete="new-password"
              value={nota}
              maxLength={200}
              onChange={(evento) => setNota(evento.target.value)}
              placeholder={esIngreso ? 'Ej: Compra en el mercado' : 'Ej: Para el turno de la tarde'}
              className={`w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 ${colorFoco}`}
            />
          </div>
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
            className={`flex-1 rounded-lg py-2 text-sm font-semibold text-bg disabled:opacity-40 ${
              esIngreso ? 'bg-green' : 'bg-purple-300'
            }`}
          >
            {guardando ? 'Guardando...' : esIngreso ? 'Registrar ingreso' : 'Registrar salida'}
          </button>
        </div>
      </form>
      {aviso}
    </div>
  )
}
