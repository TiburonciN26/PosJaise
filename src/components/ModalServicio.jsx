import { useEffect, useId, useRef, useState } from 'react'
import { Camera, ImagePlus, X } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import ModalCamara from './ModalCamara.jsx'
import Etiqueta from './Etiqueta.jsx'
import EditorListaJson from './EditorListaJson.jsx'
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
  descripcion: '',
  activo: true,
  enTendencia: false,
  aDomicilio: false,
  costoDomicilio: '',
  precioVariable: false,
  notaPrecio: '',
  duracionResultado: '',
  comboCon: '',
}

function formularioDesdeServicio(servicio) {
  return {
    nombre: servicio.nombre ?? '',
    categoriaSeleccionada: servicio.categoria ?? '',
    categoriaNueva: '',
    precio: String(servicio.precio ?? ''),
    duracionMin: servicio.duracion_min != null ? String(servicio.duracion_min) : '',
    descripcion: servicio.descripcion ?? '',
    activo: servicio.activo ?? true,
    enTendencia: servicio.en_tendencia ?? false,
    aDomicilio: servicio.a_domicilio ?? false,
    costoDomicilio: servicio.costo_domicilio != null ? String(servicio.costo_domicilio) : '',
    precioVariable: servicio.precio_variable ?? false,
    notaPrecio: servicio.nota_precio ?? '',
    duracionResultado: servicio.duracion_resultado ?? '',
    comboCon: servicio.combo_con ?? '',
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

  if (formulario.aDomicilio && formulario.costoDomicilio.trim()) {
    const costo = parseFloat(formulario.costoDomicilio)
    if (Number.isNaN(costo) || costo < 0) {
      return 'El costo a domicilio debe ser un número mayor o igual a 0.'
    }
  }

  return null
}

export default function ModalServicio({
  servicio,
  nombreInicial,
  categoriasExistentes,
  serviciosExistentes,
  onCerrar,
  onGuardado,
  onEditarEnWeb,
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

  // Galería de la Web (servicio_fotos, migración 110) — varias fotos con
  // etiqueta Resultado/Antes/Después, para el carrusel del Detalle del
  // servicio (docs/diseno-servicios/README.md). Mismo patrón "se procesa
  // al elegir, se sube recién al guardar" que la foto principal de
  // arriba: `esNueva: true` = todavía es un blob local; `id` real =
  // fila que ya existe en la tabla. `orden` no se guarda en el estado,
  // se deriva del índice en el array al guardar.
  const [fotosGaleria, setFotosGaleria] = useState([])
  const [idsGaleriaEliminados, setIdsGaleriaEliminados] = useState([])
  const [cargandoGaleria, setCargandoGaleria] = useState(esEdicion)
  const [procesandoGaleria, setProcesandoGaleria] = useState(false)
  const [errorGaleria, setErrorGaleria] = useState(null)

  // Contenido editorial del Detalle del servicio (migración 113: pasos,
  // especificaciones, herramientas, materiales, cuidados) — jsonb,
  // editado entero con EditorListaJson.jsx. Los cuidados llegan de la
  // base como array de strings; se guardan acá como [{ texto }] para
  // reusar el mismo editor de filas que el resto (se aplana de vuelta a
  // strings al guardar).
  const [pasos, setPasos] = useState(() => servicio?.pasos ?? [])
  const [especificaciones, setEspecificaciones] = useState(() => servicio?.especificaciones ?? [])
  const [herramientas, setHerramientas] = useState(() => servicio?.herramientas ?? [])
  const [materiales, setMateriales] = useState(() => servicio?.materiales ?? [])
  const [cuidadosAntes, setCuidadosAntes] = useState(() => (servicio?.cuidados_antes ?? []).map((texto) => ({ texto })))
  const [cuidadosDespues, setCuidadosDespues] = useState(() =>
    (servicio?.cuidados_despues ?? []).map((texto) => ({ texto })),
  )

  useCerrarConEscape(onCerrar)

  useEffect(() => {
    return () => {
      if (fotoNueva?.previewUrl) URL.revokeObjectURL(fotoNueva.previewUrl)
    }
  }, [fotoNueva])

  useEffect(() => {
    if (!esEdicion) return undefined
    let vigente = true

    supabase
      .from('servicio_fotos')
      .select('id, foto_url, etiqueta')
      .eq('servicio_id', servicio.id)
      .order('orden')
      .then(({ data }) => {
        if (!vigente) return
        setFotosGaleria(
          (data ?? []).map((fila) => ({
            id: fila.id,
            etiqueta: fila.etiqueta,
            fotoUrl: fila.foto_url,
            esNueva: false,
          })),
        )
        setCargandoGaleria(false)
      })

    return () => {
      vigente = false
    }
  }, [esEdicion, servicio?.id])

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

  async function agregarFotoGaleria(archivo) {
    if (!tipoDeImagenValido(archivo)) {
      setErrorGaleria('Formato no admitido. Usa JPG, PNG o WEBP.')
      return
    }

    setErrorGaleria(null)
    setProcesandoGaleria(true)
    try {
      const { blob, extension } = await procesarImagen(archivo, OPCIONES_FOTO_SERVICIO)
      setFotosGaleria((anterior) => [
        ...anterior,
        { id: null, etiqueta: 'Resultado', esNueva: true, blob, extension, previewUrl: URL.createObjectURL(blob) },
      ])
    } catch {
      setErrorGaleria('No se pudo procesar la imagen. Intenta con otra.')
    } finally {
      setProcesandoGaleria(false)
    }
  }

  function elegirFotoGaleria(evento) {
    const archivo = evento.target.files?.[0]
    evento.target.value = ''
    if (!archivo) return
    agregarFotoGaleria(archivo)
  }

  function quitarFotoGaleria(indice) {
    setFotosGaleria((anterior) => {
      const item = anterior[indice]
      if (item.esNueva) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      } else {
        setIdsGaleriaEliminados((ids) => [...ids, item.id])
      }
      return anterior.filter((_, i) => i !== indice)
    })
  }

  function cambiarEtiquetaGaleria(indice, etiqueta) {
    setFotosGaleria((anterior) => anterior.map((foto, i) => (i === indice ? { ...foto, etiqueta } : foto)))
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
      descripcion: formulario.descripcion.trim() ? formulario.descripcion.trim() : null,
      activo: formulario.activo,
      en_tendencia: formulario.enTendencia,
      a_domicilio: formulario.aDomicilio,
      costo_domicilio: formulario.aDomicilio && formulario.costoDomicilio.trim() ? parseFloat(formulario.costoDomicilio) : null,
      precio_variable: formulario.precioVariable,
      nota_precio: formulario.precioVariable && formulario.notaPrecio.trim() ? formulario.notaPrecio.trim() : null,
      duracion_resultado: formulario.duracionResultado.trim() ? formulario.duracionResultado.trim() : null,
      combo_con: formulario.comboCon || null,
      foto_url: fotoFinal,
      pasos: pasos
        .filter((paso) => paso.nombre?.trim())
        .map((paso) => ({
          nombre: paso.nombre.trim(),
          minutos: paso.minutos ? parseInt(paso.minutos, 10) || null : null,
          texto: paso.texto?.trim() ?? '',
        })),
      especificaciones: especificaciones
        .filter((spec) => spec.clave?.trim())
        .map((spec) => ({ clave: spec.clave.trim(), valor: spec.valor?.trim() ?? '' })),
      herramientas: herramientas
        .filter((item) => item.nombre?.trim())
        .map((item) => ({ nombre: item.nombre.trim(), descripcion: item.descripcion?.trim() ?? '' })),
      materiales: materiales
        .filter((item) => item.nombre?.trim())
        .map((item) => ({ nombre: item.nombre.trim(), descripcion: item.descripcion?.trim() ?? '' })),
      cuidados_antes: cuidadosAntes.map((item) => item.texto?.trim()).filter(Boolean),
      cuidados_despues: cuidadosDespues.map((item) => item.texto?.trim()).filter(Boolean),
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

    // Galería (servicio_fotos): se procesa DESPUÉS de que el servicio ya
    // tiene id real (necesario para uno nuevo). Si una foto puntual
    // falla no se bloquea el guardado del servicio, que ya quedó bien —
    // se puede reintentar reabriendo el modal.
    if (idsGaleriaEliminados.length > 0) {
      await supabase.from('servicio_fotos').delete().in('id', idsGaleriaEliminados)
    }
    for (let indice = 0; indice < fotosGaleria.length; indice += 1) {
      const item = fotosGaleria[indice]
      if (item.esNueva) {
        try {
          const ruta = `${crypto.randomUUID()}.${item.extension}`
          const rutaSubida = await subirFoto(BUCKET_FOTOS, ruta, item.blob)
          await supabase.from('servicio_fotos').insert({
            servicio_id: filaGuardada.id,
            foto_url: rutaSubida,
            etiqueta: item.etiqueta,
            orden: indice,
          })
        } catch {
          // ver comentario arriba
        }
      } else {
        await supabase.from('servicio_fotos').update({ etiqueta: item.etiqueta, orden: indice }).eq('id', item.id)
      }
    }

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
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={formulario.precioVariable}
                onChange={(evento) => actualizarCampo('precioVariable', evento.target.checked)}
                className="h-4 w-4 accent-amber"
              />
              El precio puede variar (ej. según largo de cabello)
            </label>
            {formulario.precioVariable && (
              <input
                type="search"
                autoComplete="new-password"
                value={formulario.notaPrecio}
                onChange={(evento) => actualizarCampo('notaPrecio', evento.target.value)}
                placeholder='Nota para la clienta, ej. "El precio final depende del largo y grosor del cabello"'
                className="mt-2 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-amber"
              />
            )}
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-duracion-resultado`}>El resultado dura</Etiqueta>
            <input
              id={`${idBase}-duracion-resultado`}
              type="search"
              autoComplete="new-password"
              value={formulario.duracionResultado}
              onChange={(evento) => actualizarCampo('duracionResultado', evento.target.value)}
              placeholder='Opcional, ej. "3-4 meses"'
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-amber"
            />
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-combo`}>Combo sugerido ("se suele reservar junto con")</Etiqueta>
            <select
              id={`${idBase}-combo`}
              value={formulario.comboCon}
              onChange={(evento) => actualizarCampo('comboCon', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-amber"
            >
              <option value="">
                Sin forzar — usar el más reservado junto (si hay historial)
              </option>
              {(serviciosExistentes ?? [])
                .filter((otro) => otro.id !== servicio?.id)
                .map((otro) => (
                  <option key={otro.id} value={otro.id}>
                    {otro.nombre}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-descripcion`}>Descripción</Etiqueta>
            <textarea
              id={`${idBase}-descripcion`}
              rows={3}
              value={formulario.descripcion}
              onChange={(evento) => actualizarCampo('descripcion', evento.target.value)}
              placeholder="Opcional — se muestra en el detalle del servicio en la Web"
              className="w-full resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-amber"
            />
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
            <Etiqueta>Galería (Resultado / Antes / Después)</Etiqueta>
            {cargandoGaleria ? (
              <p className="text-xs text-ink/50">Cargando galería...</p>
            ) : (
              <div className="space-y-2">
                {fotosGaleria.map((foto, indice) => (
                  <div key={foto.id ?? foto.previewUrl} className="flex items-center gap-2">
                    <img
                      src={foto.esNueva ? foto.previewUrl : urlPublicaFoto(BUCKET_FOTOS, foto.fotoUrl)}
                      alt=""
                      className="h-12 w-12 shrink-0 rounded-lg border border-border object-cover"
                    />
                    <select
                      value={foto.etiqueta}
                      onChange={(evento) => cambiarEtiquetaGaleria(indice, evento.target.value)}
                      className="flex-1 rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-xs text-ink outline-none focus:border-amber"
                    >
                      <option value="Resultado">Resultado</option>
                      <option value="Antes">Antes</option>
                      <option value="Después">Después</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => quitarFotoGaleria(indice)}
                      aria-label="Quitar foto de la galería"
                      className="shrink-0 p-1.5 text-ink/60 transition-colors hover:text-red"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-xs text-ink transition-colors hover:border-amber hover:text-amber">
                  <ImagePlus className="h-3.5 w-3.5" />
                  {procesandoGaleria ? 'Procesando...' : '+ Agregar foto'}
                  <input
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    onChange={elegirFotoGaleria}
                    disabled={procesandoGaleria}
                    className="hidden"
                  />
                </label>
              </div>
            )}
            {errorGaleria && <p className="mt-1 text-xs text-red">{errorGaleria}</p>}
          </div>

          <p className="border-t border-border pt-3 text-xs font-medium uppercase tracking-wide text-ink/50">
            Contenido del Detalle del servicio (Web)
          </p>

          <EditorListaJson
            etiqueta="Cómo es el servicio (pasos)"
            items={pasos}
            onCambiar={setPasos}
            vacio={{ nombre: '', minutos: '', texto: '' }}
            textoAgregar="+ Agregar paso"
            campos={[
              { clave: 'nombre', placeholder: 'Nombre del paso' },
              { clave: 'minutos', placeholder: 'Minutos', tipo: 'numero' },
              { clave: 'texto', placeholder: 'Explicación para la clienta', tipo: 'textarea' },
            ]}
          />

          <EditorListaJson
            etiqueta="Especificaciones técnicas"
            items={especificaciones}
            onCambiar={setEspecificaciones}
            vacio={{ clave: '', valor: '' }}
            textoAgregar="+ Agregar especificación"
            campos={[
              { clave: 'clave', placeholder: 'Ej. Técnica' },
              { clave: 'valor', placeholder: 'Ej. Mano alzada (freehand)' },
            ]}
          />

          <EditorListaJson
            etiqueta="Herramientas usadas"
            items={herramientas}
            onCambiar={setHerramientas}
            vacio={{ nombre: '', descripcion: '' }}
            textoAgregar="+ Agregar herramienta"
            campos={[
              { clave: 'nombre', placeholder: 'Nombre' },
              { clave: 'descripcion', placeholder: 'Descripción corta' },
            ]}
          />

          <EditorListaJson
            etiqueta="Materiales usados"
            items={materiales}
            onCambiar={setMateriales}
            vacio={{ nombre: '', descripcion: '' }}
            textoAgregar="+ Agregar material"
            campos={[
              { clave: 'nombre', placeholder: 'Nombre' },
              { clave: 'descripcion', placeholder: 'Marca / detalle' },
            ]}
          />

          <EditorListaJson
            etiqueta="Cuidados antes de la cita"
            items={cuidadosAntes}
            onCambiar={setCuidadosAntes}
            vacio={{ texto: '' }}
            textoAgregar="+ Agregar indicación"
            campos={[{ clave: 'texto', placeholder: 'Ej. Ven con el cabello seco' }]}
          />

          <EditorListaJson
            etiqueta="Cuidados después de la cita"
            items={cuidadosDespues}
            onCambiar={setCuidadosDespues}
            vacio={{ texto: '' }}
            textoAgregar="+ Agregar indicación"
            campos={[{ clave: 'texto', placeholder: 'Ej. Espera 48 horas antes de lavar' }]}
          />

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

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={formulario.enTendencia}
              onChange={(evento) => actualizarCampo('enTendencia', evento.target.checked)}
              className="h-4 w-4 accent-amber"
            />
            Destacar en "Tendencias y lo más pedido" (Web)
          </label>

          <div>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={formulario.aDomicilio}
                onChange={(evento) => actualizarCampo('aDomicilio', evento.target.checked)}
                className="h-4 w-4 accent-amber"
              />
              Se puede hacer a domicilio
            </label>
            {formulario.aDomicilio && (
              <input
                type="search"
                inputMode="decimal"
                autoComplete="new-password"
                value={formulario.costoDomicilio}
                onChange={(evento) => actualizarCampo('costoDomicilio', evento.target.value)}
                placeholder="Costo adicional — vacío o 0 = gratis"
                className="mt-2 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/60 focus:border-amber"
              />
            )}
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
            {error}
          </p>
        )}

        {onEditarEnWeb && (
          <button
            type="button"
            onClick={onEditarEnWeb}
            className="mt-4 w-full rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-red hover:text-red"
          >
            Editar en Web
          </button>
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
