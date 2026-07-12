import { useId, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'

const formularioVacio = {
  nombre: '',
  telefono: '',
  dni: '',
  cumpleanos: '',
  notas: '',
}

function formularioDesdeCliente(cliente) {
  return {
    nombre: cliente.nombre ?? '',
    telefono: cliente.telefono ?? '',
    dni: cliente.dni ?? '',
    cumpleanos: cliente.cumpleanos ?? '',
    notas: cliente.notas ?? '',
  }
}

function Etiqueta({ children, obligatorio, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs text-ink/60">
      {children}
      {obligatorio && <span className="text-red"> *</span>}
    </label>
  )
}

function validar(formulario) {
  if (!formulario.nombre.trim()) return 'El nombre completo es obligatorio.'
  return null
}

export default function ModalCliente({ cliente, onCerrar, onGuardado }) {
  const idBase = useId()
  const esEdicion = Boolean(cliente)

  const [formulario, setFormulario] = useState(() =>
    esEdicion ? formularioDesdeCliente(cliente) : formularioVacio,
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
      telefono: formulario.telefono.trim() || null,
      dni: formulario.dni.trim() || null,
      cumpleanos: formulario.cumpleanos || null,
      notas: formulario.notas.trim() || null,
    }

    const { error: errorGuardado } = esEdicion
      ? await supabase.from('clientes').update(datos).eq('id', cliente.id)
      : await supabase.from('clientes').insert(datos)

    setGuardando(false)

    if (errorGuardado) {
      setError('No se pudo guardar el cliente. Intenta de nuevo.')
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
          {esEdicion ? 'Editar cliente' : 'Nuevo cliente'}
        </h2>

        <div className="mt-4 space-y-3">
          <div>
            <Etiqueta obligatorio>Nombre completo</Etiqueta>
            <input
              type="text"
              value={formulario.nombre}
              onChange={(evento) => actualizarCampo('nombre', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-purple-300"
              autoFocus
            />
          </div>

          <div>
            <Etiqueta>Teléfono</Etiqueta>
            <input
              type="tel"
              value={formulario.telefono}
              onChange={(evento) => actualizarCampo('telefono', evento.target.value)}
              placeholder="Opcional"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
            />
          </div>

          <div>
            <Etiqueta>DNI</Etiqueta>
            <input
              type="text"
              value={formulario.dni}
              onChange={(evento) => actualizarCampo('dni', evento.target.value)}
              placeholder="Opcional"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
            />
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-cumpleanos`}>Fecha de cumpleaños</Etiqueta>
            <input
              id={`${idBase}-cumpleanos`}
              type="date"
              value={formulario.cumpleanos}
              onChange={(evento) => actualizarCampo('cumpleanos', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
            />
          </div>

          <div>
            <Etiqueta>Notas</Etiqueta>
            <textarea
              value={formulario.notas}
              onChange={(evento) => actualizarCampo('notas', evento.target.value)}
              placeholder="Opcional"
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
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
