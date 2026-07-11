import { useState } from 'react'
import { Pencil, Trash2, Plus } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import BotonAccion from './BotonAccion.jsx'

function formatearSoles(monto) {
  return `S/ ${monto.toFixed(2)}`
}

export default function ModalPlantillasGasto({ plantillas, onCerrar, onCambio }) {
  const [modo, setModo] = useState('lista') // 'lista' | 'form' | 'eliminar'
  const [plantillaActual, setPlantillaActual] = useState(null)
  const [nombreCampo, setNombreCampo] = useState('')
  const [montoCampo, setMontoCampo] = useState('')
  const [activoCampo, setActivoCampo] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useCerrarConEscape(() => {
    if (modo !== 'lista') volver()
    else onCerrar()
  })

  function volver() {
    setModo('lista')
    setPlantillaActual(null)
    setError(null)
  }

  function abrirNueva() {
    setPlantillaActual(null)
    setNombreCampo('')
    setMontoCampo('')
    setActivoCampo(true)
    setError(null)
    setModo('form')
  }

  function abrirEditar(plantilla) {
    setPlantillaActual(plantilla)
    setNombreCampo(plantilla.nombre)
    setMontoCampo(String(plantilla.monto))
    setActivoCampo(plantilla.activo)
    setError(null)
    setModo('form')
  }

  function abrirEliminar(plantilla) {
    setPlantillaActual(plantilla)
    setModo('eliminar')
  }

  async function guardarPlantilla(evento) {
    evento.preventDefault()

    if (!nombreCampo.trim()) {
      setError('El nombre es obligatorio.')
      return
    }
    const monto = parseFloat(montoCampo)
    if (Number.isNaN(monto) || monto <= 0) {
      setError('El monto debe ser un número mayor a 0.')
      return
    }

    setGuardando(true)
    setError(null)

    const datos = { nombre: nombreCampo.trim(), monto, activo: activoCampo }

    const { error: errorGuardado } = plantillaActual
      ? await supabase.from('gastos_recurrentes').update(datos).eq('id', plantillaActual.id)
      : await supabase.from('gastos_recurrentes').insert(datos)

    setGuardando(false)

    if (errorGuardado) {
      setError(
        errorGuardado.code === '23505'
          ? 'Ya existe una plantilla con ese nombre.'
          : 'No se pudo guardar. Intenta de nuevo.',
      )
      return
    }

    onCambio()
    volver()
  }

  async function confirmarEliminar() {
    setGuardando(true)
    const { error: errorEliminar } = await supabase
      .from('gastos_recurrentes')
      .delete()
      .eq('id', plantillaActual.id)
    setGuardando(false)

    if (errorEliminar) {
      setError('No se pudo eliminar la plantilla.')
      return
    }

    onCambio()
    volver()
  }

  return (
    <div
      onClick={onCerrar}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
    >
      <div
        onClick={(evento) => evento.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface p-5"
      >
        {modo === 'lista' && (
          <>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-ink">Plantillas de gastos fijos</h2>
              <button
                type="button"
                onClick={abrirNueva}
                className="flex shrink-0 items-center gap-1.5 rounded-lg bg-purple-300 px-3 py-1.5 text-sm font-semibold text-bg"
              >
                <Plus className="h-4 w-4" />
                <span>Nueva</span>
              </button>
            </div>

            {plantillas.length === 0 ? (
              <p className="mt-6 text-center font-mono text-sm text-ink/40">
                No hay plantillas registradas.
              </p>
            ) : (
              <div className="mt-4 space-y-2">
                {plantillas.map((plantilla) => (
                  <div
                    key={plantilla.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{plantilla.nombre}</p>
                      <div className="mt-1 flex items-center gap-2 font-mono text-sm">
                        <span className="text-purple-300">{formatearSoles(plantilla.monto)}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            plantilla.activo ? 'bg-green/15 text-green' : 'bg-surface text-ink/40'
                          }`}
                        >
                          {plantilla.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <BotonAccion
                        icono={Pencil}
                        texto="Editar"
                        color="celeste"
                        onClick={() => abrirEditar(plantilla)}
                      />
                      <BotonAccion
                        icono={Trash2}
                        texto="Eliminar"
                        color="rojo"
                        onClick={() => abrirEliminar(plantilla)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={onCerrar}
              className="mt-4 w-full rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300"
            >
              Cerrar
            </button>
          </>
        )}

        {modo === 'form' && (
          <form onSubmit={guardarPlantilla}>
            <h2 className="text-base font-semibold text-ink">
              {plantillaActual ? 'Editar plantilla' : 'Nueva plantilla'}
            </h2>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-ink/50">
                  Nombre
                  <span className="text-red"> *</span>
                </label>
                <input
                  type="text"
                  value={nombreCampo}
                  onChange={(evento) => setNombreCampo(evento.target.value)}
                  className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-purple-300"
                  autoFocus
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-ink/50">
                  Monto
                  <span className="text-red"> *</span>
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={montoCampo}
                  onChange={(evento) => setMontoCampo(evento.target.value)}
                  className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-ink/50">Estado</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setActivoCampo(true)}
                    className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                      activoCampo
                        ? 'border-green bg-green/10 text-green'
                        : 'border-border text-ink/70 hover:border-border-strong'
                    }`}
                  >
                    Activo
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivoCampo(false)}
                    className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                      !activoCampo
                        ? 'border-ink/40 bg-surface-2 text-ink'
                        : 'border-border text-ink/70 hover:border-border-strong'
                    }`}
                  >
                    Inactivo
                  </button>
                </div>
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
                onClick={volver}
                disabled={guardando}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
              >
                Volver
              </button>
              <button
                type="submit"
                disabled={guardando}
                className="flex-1 rounded-lg bg-purple-300 py-2 text-sm font-semibold text-bg disabled:opacity-40"
              >
                {guardando ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        )}

        {modo === 'eliminar' && (
          <>
            <h2 className="text-base font-semibold text-ink">
              ¿Eliminar "{plantillaActual.nombre}"?
            </h2>
            <p className="mt-1 text-sm text-ink/60">
              Esto no elimina los gastos ya generados, solo la plantilla.
            </p>

            {error && (
              <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
                {error}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={volver}
                disabled={guardando}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={confirmarEliminar}
                disabled={guardando}
                className="flex-1 rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10 disabled:opacity-40"
              >
                {guardando ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
