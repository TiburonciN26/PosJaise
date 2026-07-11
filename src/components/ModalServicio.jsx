import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'

const OPCION_NUEVA_CATEGORIA = '__nueva__'

const formularioVacio = {
  nombre: '',
  categoriaSeleccionada: '',
  categoriaNueva: '',
  precio: '',
  duracionMin: '',
  activo: true,
}

function formularioDesdeServicio(servicio) {
  return {
    nombre: servicio.nombre ?? '',
    categoriaSeleccionada: servicio.categoria ?? '',
    categoriaNueva: '',
    precio: String(servicio.precio ?? ''),
    duracionMin: servicio.duracion_min != null ? String(servicio.duracion_min) : '',
    activo: servicio.activo ?? true,
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

  const categoriaFinal =
    formulario.categoriaSeleccionada === OPCION_NUEVA_CATEGORIA
      ? formulario.categoriaNueva.trim()
      : formulario.categoriaSeleccionada
  if (!categoriaFinal) return 'La categoría es obligatoria.'

  const precio = parseFloat(formulario.precio)
  if (Number.isNaN(precio) || precio <= 0) {
    return 'El precio debe ser un número mayor a 0.'
  }

  if (formulario.duracionMin.trim()) {
    const duracion = parseInt(formulario.duracionMin, 10)
    if (Number.isNaN(duracion) || duracion <= 0) {
      return 'La duración debe ser un número mayor a 0.'
    }
  }

  return null
}

export default function ModalServicio({ servicio, categoriasExistentes, onCerrar, onGuardado }) {
  const esEdicion = Boolean(servicio)

  const [formulario, setFormulario] = useState(() =>
    esEdicion ? formularioDesdeServicio(servicio) : formularioVacio,
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useCerrarConEscape(onCerrar)

  function actualizarCampo(campo, valor) {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }))
  }

  const opcionesCategoria =
    esEdicion && servicio.categoria && !categoriasExistentes.includes(servicio.categoria)
      ? [servicio.categoria, ...categoriasExistentes]
      : categoriasExistentes

  async function guardar(evento) {
    evento.preventDefault()

    const mensajeError = validar(formulario)
    if (mensajeError) {
      setError(mensajeError)
      return
    }

    const categoriaFinal =
      formulario.categoriaSeleccionada === OPCION_NUEVA_CATEGORIA
        ? formulario.categoriaNueva.trim()
        : formulario.categoriaSeleccionada

    setGuardando(true)
    setError(null)

    const datos = {
      nombre: formulario.nombre.trim(),
      categoria: categoriaFinal,
      precio: parseFloat(formulario.precio),
      duracion_min: formulario.duracionMin.trim() ? parseInt(formulario.duracionMin, 10) : null,
      activo: formulario.activo,
    }

    const { error: errorGuardado } = esEdicion
      ? await supabase.from('servicios').update(datos).eq('id', servicio.id)
      : await supabase.from('servicios').insert(datos)

    setGuardando(false)

    if (errorGuardado) {
      setError('No se pudo guardar el servicio. Intenta de nuevo.')
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
          {esEdicion ? 'Editar servicio' : 'Nuevo servicio'}
        </h2>

        <div className="mt-4 space-y-3">
          <div>
            <Etiqueta obligatorio>Nombre</Etiqueta>
            <input
              type="text"
              value={formulario.nombre}
              onChange={(evento) => actualizarCampo('nombre', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-amber"
              autoFocus
            />
          </div>

          <div>
            <Etiqueta obligatorio>Categoría</Etiqueta>
            <select
              value={formulario.categoriaSeleccionada}
              onChange={(evento) => actualizarCampo('categoriaSeleccionada', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-amber"
            >
              <option value="">Selecciona categoría</option>
              {opcionesCategoria.map((categoria) => (
                <option key={categoria} value={categoria}>
                  {categoria}
                </option>
              ))}
              <option value={OPCION_NUEVA_CATEGORIA}>+ Nueva categoría</option>
            </select>

            {formulario.categoriaSeleccionada === OPCION_NUEVA_CATEGORIA && (
              <input
                type="text"
                value={formulario.categoriaNueva}
                onChange={(evento) => actualizarCampo('categoriaNueva', evento.target.value)}
                placeholder="Nombre de la nueva categoría"
                autoFocus
                className="mt-2 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/40 focus:border-amber"
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiqueta obligatorio>Precio</Etiqueta>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={formulario.precio}
                onChange={(evento) => actualizarCampo('precio', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
              />
            </div>

            <div>
              <Etiqueta>Duración (min)</Etiqueta>
              <input
                type="number"
                inputMode="numeric"
                value={formulario.duracionMin}
                onChange={(evento) => actualizarCampo('duracionMin', evento.target.value)}
                placeholder="Opcional"
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/40 focus:border-amber"
              />
            </div>
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
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando}
            className="flex-1 rounded-lg bg-amber py-2 text-sm font-semibold text-bg disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  )
}
