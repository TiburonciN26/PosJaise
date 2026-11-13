import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { leerImporte } from '../lib/moneda.js'
import Etiqueta from './Etiqueta.jsx'
import { mensajeErrorAlmacen, soloEnteros, soloImporte } from '../lib/almacen.js'

// Registrar un movimiento del Almacén (migración 20261112000011):
//   · SALIDA  → cualquier rol del personal anota lo que sacó (registrar_salida_almacen). No deja bajar de 0.
//   · INGRESO → solo la administradora, con el costo total de lo que entró (registrar_ingreso_almacen).
// Quién y cuándo los pone el servidor (auth.uid() y now()), no el formulario.

const MAXIMO_CANTIDAD = 2147483647
const MENSAJE_CANTIDAD_INVALIDA = 'La cantidad debe ser un número entero mayor a 0 (sin decimales ni letras).'

export default function ModalMovimientoAlmacen({ articulo, tipo, onCerrar, onGuardado }) {
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const esIngreso = tipo === 'INGRESO'
  const [cantidad, setCantidad] = useState('')
  const [costo, setCosto] = useState('')
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  // Mientras guarda, Esc no cierra; el modal sigue en la pila para que tampoco cierre el de abajo.
  useCerrarConEscape(() => {
    if (!guardando) onCerrar()
  })

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
    const costoNumerico = esIngreso ? leerImporte(costo) : null
    if (esIngreso && Number.isNaN(costoNumerico)) {
      setError('El costo total debe ser un monto válido (ej. 15 o 15.50; 0 si no costó nada).')
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

  return (
    <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        className="max-h-full w-full max-w-sm overflow-y-auto rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
      >
        <h2 className="text-base font-semibold text-ink">{esIngreso ? 'Ingreso al almacén' : 'Sacar del almacén'}</h2>
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
            <div>
              <Etiqueta obligatorio htmlFor="almacen-costo">
                Costo total (S/)
              </Etiqueta>
              <input
                id="almacen-costo"
                type="search"
                inputMode="decimal"
                autoComplete="new-password"
                value={costo}
                onChange={(evento) => setCosto(soloImporte(evento.target.value))}
                className={`w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/60 ${colorFoco}`}
              />
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
            onClick={onCerrar}
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
    </div>
  )
}
