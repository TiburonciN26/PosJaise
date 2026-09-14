import { useId, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import Etiqueta from './Etiqueta.jsx'

export const OPCIONES_CONDICION = [
  { id: 'BUENO', label: 'Bueno' },
  { id: 'REGULAR', label: 'Regular' },
  { id: 'NECESITA_REPARACION', label: 'Necesita reparación' },
  { id: 'DE_BAJA', label: 'De baja' },
]

function formularioVacio() {
  return {
    nombre: '',
    categoria: '',
    marca: '',
    modelo: '',
    material: '',
    color: '',
    altoCm: '',
    anchoCm: '',
    profundidadCm: '',
    pesoKg: '',
    fotoUrl: '',
    ubicacion: '',
    condicion: 'BUENO',
    notas: '',
  }
}

function formularioDesdeMobiliario(mueble) {
  return {
    nombre: mueble.nombre ?? '',
    categoria: mueble.categoria ?? '',
    marca: mueble.marca ?? '',
    modelo: mueble.modelo ?? '',
    material: mueble.material ?? '',
    color: mueble.color ?? '',
    altoCm: mueble.alto_cm != null ? String(mueble.alto_cm) : '',
    anchoCm: mueble.ancho_cm != null ? String(mueble.ancho_cm) : '',
    profundidadCm: mueble.profundidad_cm != null ? String(mueble.profundidad_cm) : '',
    pesoKg: mueble.peso_kg != null ? String(mueble.peso_kg) : '',
    fotoUrl: mueble.foto_url ?? '',
    ubicacion: mueble.ubicacion ?? '',
    condicion: mueble.condicion ?? 'BUENO',
    notas: mueble.notas ?? '',
  }
}

function numeroOpcional(texto) {
  const limpio = texto.trim()
  if (!limpio) return null
  const numero = parseFloat(limpio)
  return Number.isNaN(numero) ? null : numero
}

function validar(formulario) {
  if (!formulario.nombre.trim()) return 'El nombre es obligatorio.'
  return null
}

export default function ModalMobiliario({ mueble, onCerrar, onGuardado }) {
  const idBase = useId()
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const { usuario } = useAuth()
  const esEdicion = Boolean(mueble)

  const [formulario, setFormulario] = useState(() =>
    esEdicion ? formularioDesdeMobiliario(mueble) : formularioVacio(),
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
      categoria: formulario.categoria.trim() || null,
      marca: formulario.marca.trim() || null,
      modelo: formulario.modelo.trim() || null,
      material: formulario.material.trim() || null,
      color: formulario.color.trim() || null,
      alto_cm: numeroOpcional(formulario.altoCm),
      ancho_cm: numeroOpcional(formulario.anchoCm),
      profundidad_cm: numeroOpcional(formulario.profundidadCm),
      peso_kg: numeroOpcional(formulario.pesoKg),
      foto_url: formulario.fotoUrl.trim() || null,
      ubicacion: formulario.ubicacion.trim() || null,
      condicion: formulario.condicion,
      notas: formulario.notas.trim() || null,
    }

    const { error: errorGuardado } = esEdicion
      ? await supabase.from('mobiliario').update(datos).eq('id', mueble.id)
      : await supabase.from('mobiliario').insert({ ...datos, creado_por: usuario.id })

    setGuardando(false)

    if (errorGuardado) {
      setError('No se pudo guardar el mueble. Intenta de nuevo.')
      return
    }

    onGuardado()
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        style={{ '--color-foco': 'var(--color-purple-300)' }}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface p-5"
      >
        <h2 className="text-base font-semibold text-ink">
          {esEdicion ? 'Editar mueble' : 'Nuevo mueble'}
        </h2>

        <div className="mt-4 space-y-3">
          <div>
            <Etiqueta obligatorio htmlFor={`${idBase}-nombre`}>Nombre</Etiqueta>
            <input
              id={`${idBase}-nombre`}
              type="search"
              autoComplete="new-password"
              value={formulario.nombre}
              onChange={(evento) => actualizarCampo('nombre', evento.target.value)}
              placeholder="Ej. Silla de espera reclinable"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
              autoFocus
            />
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-categoria`}>Categoría</Etiqueta>
            <input
              id={`${idBase}-categoria`}
              type="search"
              autoComplete="new-password"
              value={formulario.categoria}
              onChange={(evento) => actualizarCampo('categoria', evento.target.value)}
              placeholder="Ej. Mobiliario de espera"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiqueta htmlFor={`${idBase}-marca`}>Marca</Etiqueta>
              <input
                id={`${idBase}-marca`}
                type="search"
                autoComplete="new-password"
                value={formulario.marca}
                onChange={(evento) => actualizarCampo('marca', evento.target.value)}
                placeholder="Opcional"
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
              />
            </div>
            <div>
              <Etiqueta htmlFor={`${idBase}-modelo`}>Modelo</Etiqueta>
              <input
                id={`${idBase}-modelo`}
                type="search"
                autoComplete="new-password"
                value={formulario.modelo}
                onChange={(evento) => actualizarCampo('modelo', evento.target.value)}
                placeholder="Opcional"
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiqueta htmlFor={`${idBase}-material`}>Material</Etiqueta>
              <input
                id={`${idBase}-material`}
                type="search"
                autoComplete="new-password"
                value={formulario.material}
                onChange={(evento) => actualizarCampo('material', evento.target.value)}
                placeholder="Opcional"
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
              />
            </div>
            <div>
              <Etiqueta htmlFor={`${idBase}-color`}>Color</Etiqueta>
              <input
                id={`${idBase}-color`}
                type="search"
                autoComplete="new-password"
                value={formulario.color}
                onChange={(evento) => actualizarCampo('color', evento.target.value)}
                placeholder="Opcional"
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
              />
            </div>
          </div>

          <div>
            <Etiqueta>Dimensiones (cm) y peso (kg)</Etiqueta>
            <div className="grid grid-cols-4 gap-2">
              <input
                type="search"
                inputMode="decimal"
                autoComplete="new-password"
                value={formulario.altoCm}
                onChange={(evento) => actualizarCampo('altoCm', evento.target.value)}
                placeholder="Alto"
                className="w-full rounded-lg border border-border bg-surface-2 px-2 py-2 text-center font-mono text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
              />
              <input
                type="search"
                inputMode="decimal"
                autoComplete="new-password"
                value={formulario.anchoCm}
                onChange={(evento) => actualizarCampo('anchoCm', evento.target.value)}
                placeholder="Ancho"
                className="w-full rounded-lg border border-border bg-surface-2 px-2 py-2 text-center font-mono text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
              />
              <input
                type="search"
                inputMode="decimal"
                autoComplete="new-password"
                value={formulario.profundidadCm}
                onChange={(evento) => actualizarCampo('profundidadCm', evento.target.value)}
                placeholder="Fondo"
                className="w-full rounded-lg border border-border bg-surface-2 px-2 py-2 text-center font-mono text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
              />
              <input
                type="search"
                inputMode="decimal"
                autoComplete="new-password"
                value={formulario.pesoKg}
                onChange={(evento) => actualizarCampo('pesoKg', evento.target.value)}
                placeholder="Peso"
                className="w-full rounded-lg border border-border bg-surface-2 px-2 py-2 text-center font-mono text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
              />
            </div>
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-foto`}>Foto (link)</Etiqueta>
            <input
              id={`${idBase}-foto`}
              type="search"
              autoComplete="new-password"
              value={formulario.fotoUrl}
              onChange={(evento) => actualizarCampo('fotoUrl', evento.target.value)}
              placeholder="Opcional — pegar un link de imagen"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
            />
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-ubicacion`}>Ubicación actual</Etiqueta>
            <input
              id={`${idBase}-ubicacion`}
              type="search"
              autoComplete="new-password"
              value={formulario.ubicacion}
              onChange={(evento) => actualizarCampo('ubicacion', evento.target.value)}
              placeholder="Ej. Recepción, Sala 2..."
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
            />
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-condicion`}>Condición actual</Etiqueta>
            <select
              id={`${idBase}-condicion`}
              value={formulario.condicion}
              onChange={(evento) => actualizarCampo('condicion', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-purple-300"
            >
              {OPCIONES_CONDICION.map((opcion) => (
                <option key={opcion.id} value={opcion.id}>
                  {opcion.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-notas`}>Notas</Etiqueta>
            <textarea
              id={`${idBase}-notas`}
              autoComplete="off"
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
