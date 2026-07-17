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

const BUCKET_FOTOS = 'fotos-productos'
const STOCK_MINIMO_POR_DEFECTO = 3
const OPCION_NUEVA_CATEGORIA = '__nueva__'

const formularioVacio = {
  codigoBarras: '',
  nombre: '',
  categoriaSeleccionada: '',
  categoriaNueva: '',
  costo: '',
  precio: '',
  stockInicial: '',
  proveedor: '',
}

function formularioDesdeProducto(producto) {
  return {
    codigoBarras: producto.codigo_barras ?? '',
    nombre: producto.nombre ?? '',
    categoriaSeleccionada: producto.categoria ?? '',
    categoriaNueva: '',
    costo: String(producto.costo ?? ''),
    precio: String(producto.precio ?? ''),
    stockInicial: String(producto.stock_actual ?? ''),
    proveedor: producto.proveedor ?? '',
  }
}

function validar(formulario) {
  if (!formulario.nombre.trim()) return 'El nombre es obligatorio.'

  const costo = parseFloat(formulario.costo)
  if (Number.isNaN(costo) || costo < 0) {
    return 'El costo debe ser un número mayor o igual a 0.'
  }

  const precio = parseFloat(formulario.precio)
  if (Number.isNaN(precio) || precio <= 0) {
    return 'El precio de venta debe ser un número mayor a 0.'
  }

  const stockInicial = parseInt(formulario.stockInicial, 10)
  if (Number.isNaN(stockInicial) || stockInicial < 0) {
    return 'El stock inicial debe ser 0 o más.'
  }

  return null
}

export default function ModalProducto({ producto, categoriasExistentes, onCerrar, onGuardado }) {
  const idBase = useId()
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const esEdicion = Boolean(producto)

  const [formulario, setFormulario] = useState(() =>
    esEdicion ? formularioDesdeProducto(producto) : formularioVacio,
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  // fotoActual: ruta ya guardada en el producto (o null si nunca tuvo).
  // fotoNueva: foto recién elegida, ya redimensionada/convertida a WebP,
  // pendiente de subir recién al guardar (así si el usuario cancela el
  // modal no queda un archivo huérfano en Storage).
  const [fotoActual] = useState(producto?.foto_url ?? null)
  const [fotoNueva, setFotoNueva] = useState(null) // { blob, extension, previewUrl } | null
  const [fotoEliminada, setFotoEliminada] = useState(false)
  const [procesandoFoto, setProcesandoFoto] = useState(false)
  const [errorFoto, setErrorFoto] = useState(null)
  const [mostrarCamara, setMostrarCamara] = useState(false)

  useCerrarConEscape(onCerrar)

  // Libera el object URL de preview al reemplazar la foto o desmontar,
  // para no acumular memoria mientras el modal queda abierto.
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
      const { blob, extension } = await procesarImagen(archivo)
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

  const costoNumerico = parseFloat(formulario.costo) || 0
  const precioNumerico = parseFloat(formulario.precio) || 0
  const ganancia = precioNumerico - costoNumerico

  // La categoría actual del producto puede no estar en categoriasExistentes
  // si viene de otra fuente; la agregamos para que el <select> la muestre.
  const opcionesCategoria =
    esEdicion && producto.categoria && !categoriasExistentes.includes(producto.categoria)
      ? [producto.categoria, ...categoriasExistentes]
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
    // después, borramos el archivo recién subido para no dejar huérfanos.
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

    // Sin .select(): si pidiéramos de vuelta la fila afectada, Postgres
    // rechazaría la columna "costo" para el rol authenticated (ver 03_rls.sql).
    // La lista se refresca aparte, leyendo de productos_vista.
    const datos = {
      codigo_barras: formulario.codigoBarras.trim() || null,
      nombre: formulario.nombre.trim(),
      categoria: categoriaFinal || null,
      precio: precioNumerico,
      costo: costoNumerico,
      stock_actual: parseInt(formulario.stockInicial, 10),
      proveedor: formulario.proveedor.trim() || null,
      foto_url: fotoFinal,
    }

    const { error: errorGuardado } = esEdicion
      ? await supabase.from('productos').update(datos).eq('id', producto.id)
      : await supabase
          .from('productos')
          .insert({ ...datos, stock_minimo: STOCK_MINIMO_POR_DEFECTO })

    setGuardando(false)

    if (errorGuardado) {
      if (rutaFotoSubida) eliminarFoto(BUCKET_FOTOS, rutaFotoSubida)
      if (errorGuardado.code === '23505') {
        setError('Ya existe un producto con ese código de barras.')
      } else {
        setError('No se pudo guardar el producto. Intenta de nuevo.')
      }
      return
    }

    // Best-effort: si se reemplazó o quitó una foto que ya existía, se
    // borra la anterior recién ahora que la BD ya quedó consistente.
    if (fotoActual && fotoActual !== fotoFinal) eliminarFoto(BUCKET_FOTOS, fotoActual)

    // En edición, se manda de vuelta el producto ya actualizado — así, si
    // este modal se abrió desde el de historial de stock, ese modal (que
    // sigue montado, ver Inventario.jsx) puede refrescar sus datos sin
    // esperar a un refetch aparte.
    onGuardado(esEdicion ? { ...producto, ...datos } : null)
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <form
        ref={panelRef}
        onSubmit={guardar}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface p-5"
      >
        <h2 className="text-base font-semibold text-ink">
          {esEdicion ? 'Editar producto' : 'Nuevo producto'}
        </h2>

        <div className="mt-4 space-y-3">
          <div>
            <Etiqueta obligatorio htmlFor={`${idBase}-nombre`}>Nombre</Etiqueta>
            <input
              id={`${idBase}-nombre`}
              type="text"
              value={formulario.nombre}
              onChange={(evento) => actualizarCampo('nombre', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-amber"
              autoFocus
            />
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-codigo`}>Código de barras</Etiqueta>
            <input
              id={`${idBase}-codigo`}
              type="text"
              value={formulario.codigoBarras}
              onChange={(evento) => actualizarCampo('codigoBarras', evento.target.value)}
              placeholder="Opcional"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/60 focus:border-amber"
            />
          </div>

          {/* Categoría ocupa 2/3 y stock inicial 1/3: la categoría necesita
              espacio para nombres largos en el <select>, el stock solo
              muestra unos pocos dígitos. */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Etiqueta htmlFor={`${idBase}-categoria`}>Categoría</Etiqueta>
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
                  type="text"
                  value={formulario.categoriaNueva}
                  onChange={(evento) => actualizarCampo('categoriaNueva', evento.target.value)}
                  placeholder="Nombre de la nueva categoría"
                  autoFocus
                  className="mt-2 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-amber"
                />
              )}
            </div>

            <div className="col-span-1">
              <Etiqueta obligatorio htmlFor={`${idBase}-stock`}>
                {esEdicion ? 'Stock actual' : 'Stock inicial'}
              </Etiqueta>
              <input
                id={`${idBase}-stock`}
                type="number"
                inputMode="numeric"
                value={formulario.stockInicial}
                onChange={(evento) => actualizarCampo('stockInicial', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
              />
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <Etiqueta obligatorio htmlFor={`${idBase}-costo`}>Costo</Etiqueta>
              <input
                id={`${idBase}-costo`}
                type="number"
                inputMode="decimal"
                step="0.01"
                value={formulario.costo}
                onChange={(evento) => actualizarCampo('costo', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
              />
            </div>
            <div className="flex-1">
              <Etiqueta obligatorio htmlFor={`${idBase}-precio`}>Precio de venta</Etiqueta>
              <input
                id={`${idBase}-precio`}
                type="number"
                inputMode="decimal"
                step="0.01"
                value={formulario.precio}
                onChange={(evento) => actualizarCampo('precio', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
              />
            </div>
            <div className="shrink-0">
              <Etiqueta>Ganancia</Etiqueta>
              {/* Sin borde/fondo: es un cálculo derivado, no un campo
                  editable — no debe parecer un input. */}
              <div className="whitespace-nowrap px-1 py-2 font-mono text-sm text-green">
                S/ {ganancia.toFixed(2)}
              </div>
            </div>
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-proveedor`}>Proveedor</Etiqueta>
            <input
              id={`${idBase}-proveedor`}
              type="text"
              value={formulario.proveedor}
              onChange={(evento) => actualizarCampo('proveedor', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-amber"
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
            disabled={guardando || procesandoFoto}
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
