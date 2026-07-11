import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'

const formularioVacio = {
  nombresCompletos: '',
  telefono: '',
  email: '',
  direccion: '',
  contactoEmergencia: '',
  cumpleanos: '',
  fechaIngreso: '',
  usuarioId: '',
  activo: true,
}

function formularioDesdeAsistente(asistente) {
  return {
    nombresCompletos: asistente.nombres_completos ?? '',
    telefono: asistente.telefono ?? '',
    email: asistente.email ?? '',
    direccion: asistente.direccion ?? '',
    contactoEmergencia: asistente.contacto_emergencia ?? '',
    cumpleanos: asistente.cumpleanos ?? '',
    fechaIngreso: asistente.fecha_ingreso ?? '',
    usuarioId: asistente.usuario_id ?? '',
    activo: asistente.activo ?? true,
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
  if (!formulario.nombresCompletos.trim()) return 'Los nombres completos son obligatorios.'
  return null
}

export default function ModalAsistente({ asistente, usuariosDisponibles, onCerrar, onGuardado }) {
  const esEdicion = Boolean(asistente)

  const [formulario, setFormulario] = useState(() =>
    esEdicion ? formularioDesdeAsistente(asistente) : formularioVacio,
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
      nombres_completos: formulario.nombresCompletos.trim(),
      telefono: formulario.telefono.trim() || null,
      email: formulario.email.trim() || null,
      direccion: formulario.direccion.trim() || null,
      contacto_emergencia: formulario.contactoEmergencia.trim() || null,
      cumpleanos: formulario.cumpleanos || null,
      fecha_ingreso: formulario.fechaIngreso || null,
      usuario_id: formulario.usuarioId || null,
      activo: formulario.activo,
    }

    const { error: errorGuardado } = esEdicion
      ? await supabase.from('asistentes').update(datos).eq('id', asistente.id)
      : await supabase.from('asistentes').insert(datos)

    setGuardando(false)

    if (errorGuardado) {
      setError('No se pudo guardar la asistente. Intenta de nuevo.')
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
          {esEdicion ? 'Editar asistente' : 'Nueva asistente'}
        </h2>

        <div className="mt-4 space-y-3">
          <div>
            <Etiqueta obligatorio>Nombres completos</Etiqueta>
            <input
              type="text"
              value={formulario.nombresCompletos}
              onChange={(evento) => actualizarCampo('nombresCompletos', evento.target.value)}
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
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/40 focus:border-purple-300"
            />
          </div>

          <div>
            <Etiqueta>Email</Etiqueta>
            <input
              type="email"
              value={formulario.email}
              onChange={(evento) => actualizarCampo('email', evento.target.value)}
              placeholder="Opcional"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40 focus:border-purple-300"
            />
          </div>

          <div>
            <Etiqueta>Dirección</Etiqueta>
            <input
              type="text"
              value={formulario.direccion}
              onChange={(evento) => actualizarCampo('direccion', evento.target.value)}
              placeholder="Opcional"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40 focus:border-purple-300"
            />
          </div>

          <div>
            <Etiqueta>Contacto de emergencia</Etiqueta>
            <input
              type="text"
              value={formulario.contactoEmergencia}
              onChange={(evento) => actualizarCampo('contactoEmergencia', evento.target.value)}
              placeholder="Opcional"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40 focus:border-purple-300"
            />
          </div>

          <div>
            <Etiqueta>Fecha de cumpleaños</Etiqueta>
            <input
              type="date"
              value={formulario.cumpleanos}
              onChange={(evento) => actualizarCampo('cumpleanos', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
            />
          </div>

          <div>
            <Etiqueta>Fecha de ingreso</Etiqueta>
            <input
              type="date"
              value={formulario.fechaIngreso}
              onChange={(evento) => actualizarCampo('fechaIngreso', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
            />
          </div>

          <div>
            <Etiqueta>Cuenta de acceso</Etiqueta>
            <select
              value={formulario.usuarioId}
              onChange={(evento) => actualizarCampo('usuarioId', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-purple-300"
            >
              <option value="">Sin vincular</option>
              {usuariosDisponibles.map((usuario) => (
                <option key={usuario.id} value={usuario.id}>
                  {usuario.nombre_completo}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-ink/40">
              Vincula esta profesional con su cuenta de login para que su % de comisión funcione
              en Mi Panel.
            </p>
          </div>

          <div>
            <Etiqueta>Estado</Etiqueta>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => actualizarCampo('activo', true)}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  formulario.activo
                    ? 'border-green bg-green/10 text-green'
                    : 'border-border text-ink/70 hover:border-border-strong'
                }`}
              >
                Activo
              </button>
              <button
                type="button"
                onClick={() => actualizarCampo('activo', false)}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  !formulario.activo
                    ? 'border-red bg-red/10 text-red'
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
