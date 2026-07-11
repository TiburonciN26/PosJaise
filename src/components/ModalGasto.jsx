import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'

export const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
]

function formularioVacio(mesInicial, anioInicial) {
  const hoy = new Date()
  return {
    nombre: '',
    tipo: 'VARIABLE',
    monto: '',
    mes: String(mesInicial ?? hoy.getMonth() + 1),
    anio: String(anioInicial ?? hoy.getFullYear()),
  }
}

function formularioDesdeGasto(gasto) {
  return {
    nombre: gasto.nombre ?? '',
    tipo: gasto.tipo ?? 'VARIABLE',
    monto: String(gasto.monto ?? ''),
    mes: String(gasto.mes ?? ''),
    anio: String(gasto.anio ?? ''),
  }
}

function Etiqueta({ children, obligatorio }) {
  return (
    <label className="mb-1 block text-xs text-ink/50">
      {children}
      {obligatorio && <span className="text-red"> *</span>}
    </label>
  )
}

function validar(formulario) {
  if (!formulario.nombre.trim()) return 'El nombre es obligatorio.'

  const monto = parseFloat(formulario.monto)
  if (Number.isNaN(monto) || monto <= 0) return 'El monto debe ser un número mayor a 0.'

  const mes = parseInt(formulario.mes, 10)
  if (Number.isNaN(mes) || mes < 1 || mes > 12) return 'Selecciona un mes válido.'

  const anio = parseInt(formulario.anio, 10)
  if (Number.isNaN(anio) || anio < 2000) return 'El año no es válido.'

  return null
}

export default function ModalGasto({ gasto, mesInicial, anioInicial, onCerrar, onGuardado }) {
  const esEdicion = Boolean(gasto)
  const periodoBloqueado = esEdicion && gasto.tipo === 'FIJO'

  const [formulario, setFormulario] = useState(() =>
    esEdicion ? formularioDesdeGasto(gasto) : formularioVacio(mesInicial, anioInicial),
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useCerrarConEscape(onCerrar)

  function actualizarCampo(campo, valor) {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }))
  }

  async function guardar(evento) {
    evento.preventDefault()

    const mensajeError = validar(formulario)
    if (mensajeError) {
      setError(mensajeError)
      return
    }

    setGuardando(true)
    setError(null)

    const datos = {
      nombre: formulario.nombre.trim(),
      tipo: formulario.tipo,
      monto: parseFloat(formulario.monto),
      mes: parseInt(formulario.mes, 10),
      anio: parseInt(formulario.anio, 10),
    }

    const { error: errorGuardado } = esEdicion
      ? await supabase.from('gastos').update(datos).eq('id', gasto.id)
      : await supabase.from('gastos').insert(datos)

    setGuardando(false)

    if (errorGuardado) {
      setError(
        errorGuardado.code === '23505'
          ? 'Ya existe un gasto fijo con ese nombre en este período.'
          : 'No se pudo guardar el gasto. Intenta de nuevo.',
      )
      return
    }

    onGuardado()
  }

  return (
    <div
      onClick={onCerrar}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
    >
      <form
        onSubmit={guardar}
        onClick={(evento) => evento.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface p-5"
      >
        <h2 className="text-base font-semibold text-ink">
          {esEdicion ? 'Editar gasto' : 'Nuevo gasto variable'}
        </h2>

        <div className="mt-4 space-y-3">
          <div>
            <Etiqueta obligatorio>Nombre</Etiqueta>
            <input
              type="text"
              value={formulario.nombre}
              onChange={(evento) => actualizarCampo('nombre', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-purple-300"
              autoFocus
            />
          </div>

          {esEdicion ? (
            <div>
              <Etiqueta>Tipo</Etiqueta>
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                  formulario.tipo === 'FIJO'
                    ? 'border border-blue/40 bg-blue/15 text-blue'
                    : 'border border-purple-300/40 bg-purple-300/15 text-purple-300'
                }`}
              >
                {formulario.tipo === 'FIJO' ? 'Fijo' : 'Variable'}
              </span>
              {formulario.tipo === 'FIJO' && (
                <p className="mt-1 text-xs text-ink/60">
                  Los gastos fijos se generan desde las plantillas; aquí solo puedes editar el
                  nombre y el monto. El período queda fijo.
                </p>
              )}
            </div>
          ) : (
            <p className="rounded-lg border border-purple-300/40 bg-purple-300/10 px-3 py-2 text-xs text-purple-300">
              Este gasto se registrará como Variable. Los gastos fijos se crean desde
              "Plantillas de gastos fijos".
            </p>
          )}

          <div>
            <Etiqueta obligatorio>Monto</Etiqueta>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={formulario.monto}
              onChange={(evento) => actualizarCampo('monto', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiqueta obligatorio>Mes</Etiqueta>
              <select
                value={formulario.mes}
                onChange={(evento) => actualizarCampo('mes', evento.target.value)}
                disabled={periodoBloqueado}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-purple-300 disabled:cursor-not-allowed disabled:text-ink/50"
              >
                {MESES.map((nombreMes, indice) => (
                  <option key={nombreMes} value={indice + 1}>
                    {nombreMes}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Etiqueta obligatorio>Año</Etiqueta>
              <input
                type="number"
                inputMode="numeric"
                value={formulario.anio}
                onChange={(evento) => actualizarCampo('anio', evento.target.value)}
                disabled={periodoBloqueado}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300 disabled:cursor-not-allowed disabled:text-ink/50"
              />
            </div>
          </div>
          {periodoBloqueado && (
            <p className="text-xs text-ink/60">
              El período no se puede modificar en un gasto fijo generado.
            </p>
          )}
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
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
            {guardando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  )
}
