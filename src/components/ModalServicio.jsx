import { useEffect, useId, useRef, useState } from 'react'
import { Camera, ImagePlus, X } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import ModalCamara from './ModalCamara.jsx'
import Etiqueta from './Etiqueta.jsx'
import {
  eliminarFoto,
  procesarImagen,
  subirFoto,
  tipoDeImagenValido,
  urlPublicaFoto,
} from '../lib/imagenes.js'

const BUCKET_FOTOS = 'fotos-servicios'
// Más grande que el de producto/perfil (600px): la tarjeta del catálogo
// Web las muestra grandes con efecto hover, y necesitan verse nítidas —
// ver implementacionesWed.md / decisión "900px, calidad 0.85".
const OPCIONES_FOTO_SERVICIO = { ladoMaximo: 900, calidad: 0.85 }
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

export default function ModalServicio({
  servicio,
  nombreInicial,
  categoriasExistentes,
  onCerrar,
  onGuardado,
}) {
  const idBase = useId()
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const esEdicion = Boolean(servicio)

  const [formulario, setFormulario] = useState(() =>
    esEdicion ? formularioDesdeServicio(servicio) : { ...formularioVacio, nombre: nombreInicial ?? '' },
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  // Mismo patrón que ModalProducto.jsx: la foto nueva se procesa al
  // elegirla pero se sube recién al guardar, para no dejar un archivo
  // huérfano en Storage si el usuario cancela el modal.
  const [fotoActual] = useState(servicio?.foto_url ?? null)
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
      const { blob, extension } = await procesarImagen(archivo, OPCIONES_FOTO_SERVICIO)
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

    // Si hay foto nueva, se sube primero: si el guardado en BD falla
    // después, se borra el archivo recién subido para no dejar huérfanos.
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
      nombre: formulario.nombre.trim(),
      categoria: categoriaFinal,
      precio: parseFloat(formulario.precio),
      duracion_min: formulario.duracionMin.trim() ? parseInt(formulario.duracionMin, 10) : null,
      activo: formulario.activo,
      foto_url: fotoFinal,
    }

    const { data: filaGuardada, error: errorGuardado } = esEdicion
      ? await supabase.from('servicios').update(datos).eq('id', servicio.id).select().single()
      : await supabase.from('servicios').insert(datos).select().single()

    setGuardando(false)

    if (errorGuardado) {
      if (rutaFotoSubida) eliminarFoto(BUCKET_FOTOS, rutaFotoSubida)
      setError('No se pudo guardar el servicio. Intenta de nuevo.')
      return
    }

    // Best-effort: si se reemplazó o quitó una foto que ya existía, se
    // borra la anterior recién ahora que la BD ya quedó consistente.
    if (fotoActual && fotoActual !== fotoFinal) eliminarFoto(BUCKET_FOTOS, fotoActual)

    onGuardado(filaGuardada)
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface p-5"
      >
        <h2 className="text-base font-semibold text-ink">
          {esEdicion ? 'Editar servicio' : 'Nuevo servicio'}
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
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-amber"
              autoFocus
            />
          </div>

          <div>
            <Etiqueta obligatorio htmlFor={`${idBase}-categoria`}>Categoría</Etiqueta>
            <select
              id={`${idBase}-categoria`}
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
                type="search"
                autoComplete="new-password"
                value={formulario.categoriaNueva}
                onChange={(evento) => actualizarCampo('categoriaNueva', evento.target.value)}
                placeholder="Nombre de la nueva categoría"
                autoFocus
                className="mt-2 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-amber"
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-precio`}>Precio</Etiqueta>
              <input
                id={`${idBase}-precio`}
                type="search"
                inputMode="decimal"
                autoComplete="new-password"
                value={formulario.precio}
                onChange={(evento) => actualizarCampo('precio', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
              />
            </div>

            <div>
              <Etiqueta htmlFor={`${idBase}-duracion`}>Duración (min)</Etiqueta>
              <input
                id={`${idBase}-duracion`}
                type="search"
                inputMode="numeric"
                autoComplete="new-password"
                value={formulario.duracionMin}
                onChange={(evento) => actualizarCampo('duracionMin', evento.target.value)}
                placeholder="Opcional"
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/60 focus:border-amber"
              />
            </div>
          </div>

          <div>
            <Etiqueta>Foto</Etiqueta>
            <div className="flex items-center gap-3">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-2">
                {previewFoto ? (
                  <img src={previewFoto} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImagePlus className="h-6 w-6 text-ink/40" />
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2">
                <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-xs text-ink transition-colors hover:border-amber hover:text-amber">
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
                  className="flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-xs text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
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

      {mostrarCamara && (
        <ModalCamara onCapturar={capturarDesdeCamara} onCerrar={() => setMostrarCamara(false)} />
      )}
    </div>
  )
}
