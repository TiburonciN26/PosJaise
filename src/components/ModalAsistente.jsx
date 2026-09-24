import { useEffect, useId, useRef, useState } from 'react'
import { Camera, Globe, ImagePlus, X } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import Etiqueta from './Etiqueta.jsx'
import Interruptor from './Interruptor.jsx'
import ModalCamara from './ModalCamara.jsx'
import {
  eliminarFoto,
  procesarImagen,
  subirFoto,
  tipoDeImagenValido,
  urlPublicaFoto,
} from '../lib/imagenes.js'

const BUCKET_FOTOS = 'fotos-asistentes'

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
  especialidad: '',
  bio: '',
  mostrarEnWeb: false,
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
    especialidad: asistente.especialidad ?? '',
    bio: asistente.bio ?? '',
    mostrarEnWeb: asistente.mostrar_en_web ?? false,
  }
}

function validar(formulario) {
  if (!formulario.nombresCompletos.trim()) return 'Los nombres completos son obligatorios.'
  return null
}

export default function ModalAsistente({ asistente, usuariosDisponibles, onCerrar, onGuardado }) {
  const idBase = useId()
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const esEdicion = Boolean(asistente)

  const [formulario, setFormulario] = useState(() =>
    esEdicion ? formularioDesdeAsistente(asistente) : formularioVacio,
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  // Mismo patrón que ModalServicio.jsx: la foto nueva se procesa al
  // elegirla pero se sube recién al guardar, para no dejar un archivo
  // huérfano en Storage si el usuario cancela el modal.
  const [fotoActual] = useState(asistente?.foto_url ?? null)
  const [fotoNueva, setFotoNueva] = useState(null) // { blob, extension, previewUrl } | null
  const [fotoEliminada, setFotoEliminada] = useState(false)
  const [procesandoFoto, setProcesandoFoto] = useState(false)
  const [errorFoto, setErrorFoto] = useState(null)
  const [mostrarCamara, setMostrarCamara] = useState(false)

  useCerrarConEscape(onCerrar)

  useEffect(() => {
    return () => {
      if (fotoNueva?.previewUrl) URL.revokeObjectURL(fotoNueva.previewUrl)
    }
  }, [fotoNueva])

  async function procesarNuevaFoto(archivo) {
    if (!tipoDeImagenValido(archivo)) {
      setErrorFoto('Formato no admitido. Usa JPG, PNG o WEBP.')
      return
    }

    setErrorFoto(null)
    setProcesandoFoto(true)
    try {
      const { blob, extension } = await procesarImagen(archivo, { ladoMaximo: 900, calidad: 0.85 })
      if (fotoNueva?.previewUrl) URL.revokeObjectURL(fotoNueva.previewUrl)
      setFotoNueva({ blob, extension, previewUrl: URL.createObjectURL(blob) })
      setFotoEliminada(false)
    } catch {
      setErrorFoto('No se pudo procesar la imagen. Intenta con otra.')
    } finally {
      setProcesandoFoto(false)
    }
  }

  function elegirFoto(evento) {
    const archivo = evento.target.files?.[0]
    evento.target.value = ''
    if (!archivo) return
    procesarNuevaFoto(archivo)
  }

  function capturarDesdeCamara(blob) {
    setMostrarCamara(false)
    procesarNuevaFoto(blob)
  }

  function quitarFoto() {
    if (fotoNueva?.previewUrl) URL.revokeObjectURL(fotoNueva.previewUrl)
    setFotoNueva(null)
    setFotoEliminada(true)
  }

  const previewFoto = fotoNueva
    ? fotoNueva.previewUrl
    : !fotoEliminada && fotoActual
      ? urlPublicaFoto(BUCKET_FOTOS, fotoActual)
      : null

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

    let rutaFotoSubida = null
    if (fotoNueva) {
      try {
        const ruta = `${crypto.randomUUID()}.${fotoNueva.extension}`
        rutaFotoSubida = await subirFoto(BUCKET_FOTOS, ruta, fotoNueva.blob)
      } catch {
        setGuardando(false)
        setError('No se pudo subir la foto. Intenta de nuevo.')
        return
      }
    }

    const fotoFinal = fotoNueva ? rutaFotoSubida : fotoEliminada ? null : fotoActual

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
      especialidad: formulario.especialidad.trim() || null,
      bio: formulario.bio.trim() || null,
      mostrar_en_web: formulario.mostrarEnWeb,
      foto_url: fotoFinal,
    }

    const { error: errorGuardado } = esEdicion
      ? await supabase.from('asistentes').update(datos).eq('id', asistente.id)
      : await supabase.from('asistentes').insert(datos)

    setGuardando(false)

    if (errorGuardado) {
      if (rutaFotoSubida) eliminarFoto(BUCKET_FOTOS, rutaFotoSubida)
      setError('No se pudo guardar la asistente. Intenta de nuevo.')
      return
    }

    if (fotoActual && fotoActual !== fotoFinal) eliminarFoto(BUCKET_FOTOS, fotoActual)

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
          {esEdicion ? 'Editar asistente' : 'Nueva asistente'}
        </h2>

        <div className="mt-4 space-y-3">
          <div>
            <Etiqueta obligatorio htmlFor={`${idBase}-nombres`}>Nombres completos</Etiqueta>
            <input
              id={`${idBase}-nombres`}
              type="search"
              autoComplete="new-password"
              value={formulario.nombresCompletos}
              onChange={(evento) => actualizarCampo('nombresCompletos', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-purple-300"
              autoFocus
            />
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-telefono`}>Teléfono</Etiqueta>
            <input
              id={`${idBase}-telefono`}
              type="search"
              inputMode="tel"
              autoComplete="new-password"
              value={formulario.telefono}
              onChange={(evento) => actualizarCampo('telefono', evento.target.value)}
              placeholder="Opcional"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
            />
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-email`}>Email</Etiqueta>
            <input
              id={`${idBase}-email`}
              type="search"
              inputMode="email"
              autoComplete="new-password"
              value={formulario.email}
              onChange={(evento) => actualizarCampo('email', evento.target.value)}
              placeholder="Opcional"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
            />
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-direccion`}>Dirección</Etiqueta>
            <input
              id={`${idBase}-direccion`}
              type="search"
              autoComplete="new-password"
              value={formulario.direccion}
              onChange={(evento) => actualizarCampo('direccion', evento.target.value)}
              placeholder="Opcional"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
            />
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-emergencia`}>Contacto de emergencia</Etiqueta>
            <input
              id={`${idBase}-emergencia`}
              type="search"
              autoComplete="new-password"
              value={formulario.contactoEmergencia}
              onChange={(evento) => actualizarCampo('contactoEmergencia', evento.target.value)}
              placeholder="Opcional"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
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
            <Etiqueta htmlFor={`${idBase}-fecha-ingreso`}>Fecha de ingreso</Etiqueta>
            <input
              id={`${idBase}-fecha-ingreso`}
              type="date"
              value={formulario.fechaIngreso}
              onChange={(evento) => actualizarCampo('fechaIngreso', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
            />
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-cuenta`}>Cuenta de acceso</Etiqueta>
            <select
              id={`${idBase}-cuenta`}
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
            <p className="mt-1 text-xs text-ink/60">
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

          {/* A partir de acá: datos pensados para la pestaña "Equipo" del
              portal de clientes (83_equipo_web.sql), no para uso interno. */}
          <div className="border-t border-border pt-3">
            <Etiqueta htmlFor={`${idBase}-especialidad`}>Especialidad</Etiqueta>
            <input
              id={`${idBase}-especialidad`}
              type="search"
              autoComplete="new-password"
              value={formulario.especialidad}
              onChange={(evento) => actualizarCampo('especialidad', evento.target.value)}
              placeholder="Ej. Colorimetría, cortes, maquillaje..."
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
            />
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-bio`}>Bio corta (para la Web)</Etiqueta>
            <textarea
              id={`${idBase}-bio`}
              value={formulario.bio}
              onChange={(evento) => actualizarCampo('bio', evento.target.value)}
              placeholder="Opcional — un par de líneas sobre su experiencia"
              rows={3}
              className="w-full resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
            />
          </div>

          <div>
            <Etiqueta>Foto (para la Web)</Etiqueta>
            <div className="flex items-center gap-3">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-2">
                {previewFoto ? (
                  <img src={previewFoto} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImagePlus className="h-6 w-6 text-ink/40" />
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-xs text-ink transition-colors hover:border-purple-300 hover:text-purple-300">
                  <ImagePlus className="h-3.5 w-3.5" />
                  {procesandoFoto ? 'Procesando...' : previewFoto ? 'Cambiar foto' : 'Elegir foto'}
                  <input
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    onChange={elegirFoto}
                    disabled={procesandoFoto}
                    className="hidden"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setMostrarCamara(true)}
                  disabled={procesandoFoto}
                  className="flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-xs text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
                >
                  <Camera className="h-3.5 w-3.5" />
                  {procesandoFoto ? 'Procesando...' : 'Tomar foto'}
                </button>
                {previewFoto && (
                  <button
                    type="button"
                    onClick={quitarFoto}
                    className="flex w-fit items-center gap-1 text-xs text-ink/60 transition-colors hover:text-red"
                  >
                    <X className="h-3 w-3" />
                    Quitar foto
                  </button>
                )}
              </div>
            </div>
            {errorFoto && <p className="mt-1 text-xs text-red">{errorFoto}</p>}
          </div>

          <button
            type="button"
            onClick={() => actualizarCampo('mostrarEnWeb', !formulario.mostrarEnWeb)}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:border-purple-300"
          >
            <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
              <Globe className="h-4 w-4 shrink-0 text-ink/60" />
              Mostrar en la Web
            </span>
            <Interruptor activado={formulario.mostrarEnWeb} colorActivado="bg-purple-300" />
          </button>
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

      {mostrarCamara && (
        <ModalCamara onCapturar={capturarDesdeCamara} onCerrar={() => setMostrarCamara(false)} />
      )}
    </div>
  )
}
