import { useEffect, useId, useRef, useState } from 'react'
import { Camera, ImagePlus, X } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { leerImporte } from '../lib/moneda.js'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import ModalCamara from './ModalCamara.jsx'
import Etiqueta from './Etiqueta.jsx'
import EditorListaJson from './EditorListaJson.jsx'
import SelectorProductoBuscable from './SelectorProductoBuscable.jsx'
import { datosPosProducto, datosWebProducto } from '../lib/catalogoCampos.js'
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
  subcategoria: '',
  costo: '',
  precio: '',
  precioAntes: '',
  ofertaHasta: '',
  stockInicial: '',
  proveedor: '',
  descripcion: '',
  contenido: '',
  rinde: '',
  frecuencia: '',
  comboCon: '',
  destacado: false,
  nuevo: false,
  enInicio: false,
}

function formularioDesdeProducto(producto) {
  return {
    codigoBarras: producto.codigo_barras ?? '',
    nombre: producto.nombre ?? '',
    categoriaSeleccionada: producto.categoria ?? '',
    categoriaNueva: '',
    subcategoria: producto.subcategoria ?? '',
    costo: String(producto.costo ?? ''),
    precio: String(producto.precio ?? ''),
    precioAntes: producto.precio_antes != null ? String(producto.precio_antes) : '',
    ofertaHasta: producto.oferta_hasta ?? '',
    stockInicial: String(producto.stock_actual ?? ''),
    proveedor: producto.proveedor ?? '',
    descripcion: producto.descripcion ?? '',
    contenido: producto.contenido ?? '',
    rinde: producto.rinde ?? '',
    frecuencia: producto.frecuencia ?? '',
    comboCon: producto.combo_con ?? '',
    destacado: producto.destacado ?? false,
    nuevo: producto.nuevo ?? false,
    enInicio: producto.en_inicio ?? false,
  }
}

// QA-028: vacío o negativo conservan el mensaje de siempre; un texto que mezcla
// letras/símbolos o trae más de 2 decimales (antes se guardaba solo el prefijo
// numérico) recibe un aviso propio.
function mensajeImporte(texto, mensajeBase, nombre) {
  const limpio = texto.trim()
  if (limpio === '' || /^-\d*\.?\d+$/.test(limpio)) return mensajeBase
  return `${nombre} debe ser un importe completo: solo números y hasta 2 decimales, sin letras ni símbolos.`
}

function validar(formulario, modo) {
  if (modo === 'web') return validarWeb(formulario)
  if (!formulario.nombre.trim()) return 'El nombre es obligatorio.'

  const costo = leerImporte(formulario.costo)
  if (Number.isNaN(costo)) {
    return mensajeImporte(formulario.costo, 'El costo debe ser un número mayor o igual a 0.', 'El costo')
  }

  const precio = leerImporte(formulario.precio)
  if (Number.isNaN(precio)) {
    return mensajeImporte(formulario.precio, 'El precio de venta debe ser un número mayor a 0.', 'El precio de venta')
  }
  if (precio <= 0) return 'El precio de venta debe ser un número mayor a 0.'

  // parseInt a secas trunca en silencio ("5.7" -> 5, "5abc" -> 5) sin
  // avisar — QA-003: comparar contra Number() del mismo texto detecta
  // cualquier resto no entero que parseInt descartaría calladamente.
  const stockInicial = parseInt(formulario.stockInicial, 10)
  if (Number.isNaN(stockInicial) || stockInicial < 0) {
    return 'El stock inicial debe ser 0 o más.'
  }
  if (stockInicial !== Number(formulario.stockInicial)) {
    return 'El stock debe ser un número entero, sin decimales ni texto adicional.'
  }

  return null
}

// Modo web: solo se valida lo editorial. El precio REAL viene de la ficha (solo lectura aquí) y «precio antes» debe
// ser mayor que él. La fecha de oferta es informativa: no hay vencimiento automático en este lote.
function validarWeb(formulario) {
  const precio = leerImporte(formulario.precio)
  if (formulario.precioAntes.trim()) {
    const precioAntes = leerImporte(formulario.precioAntes)
    if (Number.isNaN(precioAntes)) {
      return mensajeImporte(formulario.precioAntes, 'El precio antes debe ser un número mayor a 0.', 'El precio antes')
    }
    if (precioAntes <= 0) return 'El precio antes debe ser un número mayor a 0.'
    if (precioAntes <= precio) {
      return 'El precio antes debe ser mayor al precio de venta actual.'
    }
  }

  return null
}

// Separación POS / Web: el MISMO registro se edita desde dos lugares y cada uno guarda SOLO sus columnas.
//  - modo 'pos' (Inventario): código, nombre, categoría, subcategoría, costo, precio REAL, stock y proveedor. Una ficha
//    nueva se crea solo con esto.
//  - modo 'web' (Web → Catálogo → Productos, solo ADMINISTRADOR): precio anterior y fecha de oferta, descripción,
//    contenido, rinde, frecuencia, foto, galería, combo, destacados y contenido editorial.
// El UPDATE de un modo no menciona las columnas del otro, así que no se pierde nada. El precio real es compartido.
export default function ModalProducto({ producto, categoriasExistentes = [], modo = 'pos', onCerrar, onGuardado, onEditarEnWeb }) {
  const esWeb = modo === 'web'
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

  // Galería de la Web (producto_fotos, migración 119) — varias fotos con
  // etiqueta Frente/Textura/En uso/Detrás, para el carrusel del Detalle
  // del producto. Mismo patrón "se procesa al elegir, se sube recién al
  // guardar" que la foto principal de arriba, y el mismo componente que
  // ya usa ModalServicio.jsx para servicio_fotos.
  const [fotosGaleria, setFotosGaleria] = useState([])
  const [idsGaleriaEliminados, setIdsGaleriaEliminados] = useState([])
  const [cargandoGaleria, setCargandoGaleria] = useState(esEdicion && esWeb)
  const [procesandoGaleria, setProcesandoGaleria] = useState(false)
  const [errorGaleria, setErrorGaleria] = useState(null)

  // Contenido editorial del Detalle del producto (migración 121:
  // especificaciones, modo de uso, ideal para, tips, ingredientes, libre
  // de) — jsonb, editado entero con EditorListaJson.jsx (mismo
  // componente que ModalServicio.jsx). Las listas de solo texto (ideal
  // para/tips/libre de) llegan de la base como array de strings; se
  // guardan acá como [{ texto }] para reusar el mismo editor de filas
  // que el resto, y se aplanan de vuelta a strings al guardar.
  const [especificaciones, setEspecificaciones] = useState(() => producto?.especificaciones ?? [])
  const [modoUso, setModoUso] = useState(() => producto?.modo_uso ?? [])
  const [idealPara, setIdealPara] = useState(() => (producto?.ideal_para ?? []).map((texto) => ({ texto })))
  const [tips, setTips] = useState(() => (producto?.tips ?? []).map((texto) => ({ texto })))
  const [ingredientes, setIngredientes] = useState(() => producto?.ingredientes ?? [])
  const [libreDe, setLibreDe] = useState(() => (producto?.libre_de ?? []).map((texto) => ({ texto })))

  useCerrarConEscape(onCerrar)

  // Libera el object URL de preview al reemplazar la foto o desmontar,
  // para no acumular memoria mientras el modal queda abierto.
  useEffect(() => {
    return () => {
      if (fotoNueva?.previewUrl) URL.revokeObjectURL(fotoNueva.previewUrl)
    }
  }, [fotoNueva])

  useEffect(() => {
    if (!esEdicion || !esWeb) return undefined
    let vigente = true

    supabase
      .from('producto_fotos')
      .select('id, foto_url, etiqueta')
      .eq('producto_id', producto.id)
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
  }, [esEdicion, esWeb, producto?.id])

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

  async function agregarFotoGaleria(archivo) {
    if (!tipoDeImagenValido(archivo)) {
      setErrorGaleria('Formato no admitido. Usa JPG, PNG o WEBP.')
      return
    }

    setErrorGaleria(null)
    setProcesandoGaleria(true)
    try {
      const { blob, extension } = await procesarImagen(archivo)
      setFotosGaleria((anterior) => [
        ...anterior,
        { id: null, etiqueta: 'Frente', esNueva: true, blob, extension, previewUrl: URL.createObjectURL(blob) },
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

  // Solo para la vista previa de Ganancia; guardar() valida antes con validar().
  const costoNumerico = leerImporte(formulario.costo) || 0
  const precioNumerico = leerImporte(formulario.precio) || 0
  const ganancia = precioNumerico - costoNumerico

  // La categoría actual del producto puede no estar en categoriasExistentes
  // si viene de otra fuente; la agregamos para que el <select> la muestre.
  const opcionesCategoria =
    esEdicion && producto.categoria && !categoriasExistentes.includes(producto.categoria)
      ? [producto.categoria, ...categoriasExistentes]
      : categoriasExistentes

  async function guardar(evento) {
    evento.preventDefault()

    const mensajeError = validar(formulario, modo)
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
    if (esWeb && fotoNueva) {
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
    // Cada modo guarda SOLO sus columnas (ver el comentario del componente).
    const datosPos = datosPosProducto({ formulario, categoriaFinal, precio: precioNumerico, costo: costoNumerico })
    const datosWeb = datosWebProducto({ formulario, fotoFinal, especificaciones, modoUso, idealPara, tips, ingredientes, libreDe })
    const datos = esWeb ? datosWeb : datosPos

    const { error: errorGuardado, data: filaGuardada } = esEdicion
      ? await supabase.from('productos').update(datos).eq('id', producto.id).select('id').single()
      : await supabase
          .from('productos')
          .insert({ ...datos, stock_minimo: STOCK_MINIMO_POR_DEFECTO })
          .select('id')
          .single()

    if (errorGuardado) {
      setGuardando(false)
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
    if (esWeb && fotoActual && fotoActual !== fotoFinal) eliminarFoto(BUCKET_FOTOS, fotoActual)

    // Galería (producto_fotos): se procesa DESPUÉS de que el producto ya
    // tiene id real (necesario para uno nuevo). Si una foto puntual falla
    // no se bloquea el guardado del producto, que ya quedó bien — se
    // puede reintentar reabriendo el modal.
    const productoId = esEdicion ? producto.id : filaGuardada.id
    if (esWeb && idsGaleriaEliminados.length > 0) {
      await supabase.from('producto_fotos').delete().in('id', idsGaleriaEliminados)
    }
    for (let indice = 0; esWeb && indice < fotosGaleria.length; indice += 1) {
      const item = fotosGaleria[indice]
      if (item.esNueva) {
        try {
          const ruta = `${crypto.randomUUID()}.${item.extension}`
          const rutaSubida = await subirFoto(BUCKET_FOTOS, ruta, item.blob)
          await supabase.from('producto_fotos').insert({
            producto_id: productoId,
            foto_url: rutaSubida,
            etiqueta: item.etiqueta,
            orden: indice,
          })
        } catch {
          // ver comentario arriba
        }
      } else {
        await supabase.from('producto_fotos').update({ etiqueta: item.etiqueta, orden: indice }).eq('id', item.id)
      }
    }

    setGuardando(false)

    // En edición, se manda de vuelta el producto ya actualizado — así, si
    // este modal se abrió desde el de historial de stock, ese modal (que
    // sigue montado, ver Inventario.jsx) puede refrescar sus datos sin
    // esperar a un refetch aparte.
    onGuardado(esEdicion ? { ...producto, ...datos } : null)
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
          {esWeb ? 'Contenido Web del producto' : esEdicion ? 'Editar producto' : 'Nuevo producto'}
        </h2>

        {esWeb && (
          <p className="mt-1 text-sm text-ink/70">
            {producto.nombre} · precio real {Number(producto.precio).toFixed(2)} (se cambia en Inventario)
          </p>
        )}

        <div className="mt-4 space-y-3">
          {!esWeb && (
          <>
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
            <Etiqueta htmlFor={`${idBase}-codigo`}>Código de barras</Etiqueta>
            <input
              id={`${idBase}-codigo`}
              type="search"
              autoComplete="new-password"
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

            <div className="col-span-1">
              <Etiqueta obligatorio htmlFor={`${idBase}-stock`}>
                {esEdicion ? 'Stock actual' : 'Stock inicial'}
              </Etiqueta>
              <input
                id={`${idBase}-stock`}
                type="search"
                inputMode="numeric"
                autoComplete="new-password"
                value={formulario.stockInicial}
                onChange={(evento) => actualizarCampo('stockInicial', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
              />
            </div>
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-subcategoria`}>Subcategoría</Etiqueta>
            <input
              id={`${idBase}-subcategoria`}
              type="search"
              autoComplete="new-password"
              value={formulario.subcategoria}
              onChange={(evento) => actualizarCampo('subcategoria', evento.target.value)}
              placeholder='Opcional, ej. "Shampoo" — etiqueta corta de la tarjeta en la Web'
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-amber"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <Etiqueta obligatorio htmlFor={`${idBase}-costo`}>Costo</Etiqueta>
              <input
                id={`${idBase}-costo`}
                type="search"
                inputMode="decimal"
                autoComplete="new-password"
                value={formulario.costo}
                onChange={(evento) => actualizarCampo('costo', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-amber"
              />
            </div>
            <div className="flex-1">
              <Etiqueta obligatorio htmlFor={`${idBase}-precio`}>Precio de venta</Etiqueta>
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
            <div className="shrink-0">
              <Etiqueta>Ganancia</Etiqueta>
              {/* Sin borde/fondo: es un cálculo derivado, no un campo
                  editable — no debe parecer un input. */}
              <div className="whitespace-nowrap px-1 py-2 font-mono text-sm text-green">
                S/ {ganancia.toFixed(2)}
              </div>
            </div>
          </div>

          </>
          )}

          {esWeb && (
          <>
          <div>
            <Etiqueta htmlFor={`${idBase}-precio-antes`}>Precio antes de la oferta</Etiqueta>
            {/* Aclaración pedida por el usuario: el campo de arriba
                ("Precio de venta") ya es el precio CON el descuento
                aplicado — el que de verdad se cobra. Este campo es solo la
                referencia más alta que se muestra tachada, así que va
                SIEMPRE por encima del precio de venta, nunca por debajo
                (ver validación más abajo). Para terminar una oferta: subir
                "Precio de venta" al monto normal y vaciar este campo. */}
            <p className="mb-1.5 text-xs text-ink/50">
              El monto normal, antes del descuento — tiene que ser mayor al "Precio de venta" de arriba, que es el que ya
              incluye la oferta.
            </p>
            <input
              id={`${idBase}-precio-antes`}
              type="search"
              inputMode="decimal"
              autoComplete="new-password"
              value={formulario.precioAntes}
              onChange={(evento) => actualizarCampo('precioAntes', evento.target.value)}
              placeholder="Déjalo vacío si no está en oferta"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink/40 focus:border-amber"
            />
            {formulario.precioAntes.trim() && (
              <div className="mt-2">
                <Etiqueta htmlFor={`${idBase}-oferta-hasta`}>Precio de oferta hasta</Etiqueta>
                <input
                  id={`${idBase}-oferta-hasta`}
                  type="date"
                  value={formulario.ofertaHasta}
                  onChange={(evento) => actualizarCampo('ofertaHasta', evento.target.value)}
                  className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-amber"
                />
              </div>
            )}
          </div>

          </>
          )}

          {!esWeb && (
          <div>
            <Etiqueta htmlFor={`${idBase}-proveedor`}>Proveedor</Etiqueta>
            <input
              id={`${idBase}-proveedor`}
              type="search"
              autoComplete="new-password"
              value={formulario.proveedor}
              onChange={(evento) => actualizarCampo('proveedor', evento.target.value)}
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-amber"
            />
          </div>

          )}

          {esWeb && (
          <>
          <div>
            <Etiqueta htmlFor={`${idBase}-combo`}>Combo sugerido ("se suele comprar junto con")</Etiqueta>
            <SelectorProductoBuscable
              id={`${idBase}-combo`}
              valor={formulario.comboCon}
              onCambiar={(productoId) => actualizarCampo('comboCon', productoId)}
              textoVacio="Sin forzar — usar el más comprado junto (si hay historial de pedidos web)"
              excluirId={producto?.id ?? null}
            />
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-descripcion`}>Descripción</Etiqueta>
            <textarea
              id={`${idBase}-descripcion`}
              rows={3}
              value={formulario.descripcion}
              onChange={(evento) => actualizarCampo('descripcion', evento.target.value)}
              placeholder="Opcional — se muestra en el detalle del producto en la Web"
              className="w-full resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-amber"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Etiqueta htmlFor={`${idBase}-contenido`}>Contenido</Etiqueta>
              <input
                id={`${idBase}-contenido`}
                type="search"
                autoComplete="new-password"
                value={formulario.contenido}
                onChange={(evento) => actualizarCampo('contenido', evento.target.value)}
                placeholder='Ej. "250 ml"'
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-amber"
              />
            </div>
            <div>
              <Etiqueta htmlFor={`${idBase}-rinde`}>Rinde</Etiqueta>
              <input
                id={`${idBase}-rinde`}
                type="search"
                autoComplete="new-password"
                value={formulario.rinde}
                onChange={(evento) => actualizarCampo('rinde', evento.target.value)}
                placeholder='Ej. "3 meses de uso"'
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-amber"
              />
            </div>
          </div>

          <div>
            <Etiqueta htmlFor={`${idBase}-frecuencia`}>Frecuencia de uso</Etiqueta>
            <input
              id={`${idBase}-frecuencia`}
              type="search"
              autoComplete="new-password"
              value={formulario.frecuencia}
              onChange={(evento) => actualizarCampo('frecuencia', evento.target.value)}
              placeholder='Opcional, ej. "1 vez por semana"'
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-amber"
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
            <Etiqueta>Galería (Frente / Textura / En uso / Detrás)</Etiqueta>
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
                      <option value="Frente">Frente</option>
                      <option value="Textura">Textura</option>
                      <option value="En uso">En uso</option>
                      <option value="Detrás">Detrás</option>
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
            Contenido del Detalle del producto (Web)
          </p>

          <EditorListaJson
            etiqueta="Cómo se usa (pasos)"
            items={modoUso}
            onCambiar={setModoUso}
            vacio={{ nombre: '', texto: '' }}
            textoAgregar="+ Agregar paso"
            campos={[
              { clave: 'nombre', placeholder: 'Nombre del paso, ej. "Aplica"' },
              { clave: 'texto', placeholder: 'Explicación para la clienta', tipo: 'textarea' },
            ]}
          />

          <EditorListaJson
            etiqueta="Ideal para"
            items={idealPara}
            onCambiar={setIdealPara}
            vacio={{ texto: '' }}
            textoAgregar="+ Agregar punto"
            campos={[{ clave: 'texto', placeholder: 'Ej. Cabello teñido, con mechas o decolorado' }]}
          />

          <EditorListaJson
            etiqueta="Tips y precauciones"
            items={tips}
            onCambiar={setTips}
            vacio={{ texto: '' }}
            textoAgregar="+ Agregar tip"
            campos={[{ clave: 'texto', placeholder: 'Ej. Úsala 1 vez por semana' }]}
          />

          <EditorListaJson
            etiqueta="Especificaciones (Marca, Tipo de cabello, Aroma, Vence, Registro sanitario...)"
            items={especificaciones}
            onCambiar={setEspecificaciones}
            vacio={{ clave: '', valor: '' }}
            textoAgregar="+ Agregar especificación"
            campos={[
              { clave: 'clave', placeholder: 'Ej. Marca' },
              { clave: 'valor', placeholder: 'Ej. Jaise Pro' },
            ]}
          />

          <EditorListaJson
            etiqueta="Ingredientes clave"
            items={ingredientes}
            onCambiar={setIngredientes}
            vacio={{ nombre: '', texto: '' }}
            textoAgregar="+ Agregar ingrediente"
            campos={[
              { clave: 'nombre', placeholder: 'Ej. Keratina hidrolizada' },
              { clave: 'texto', placeholder: 'Para qué sirve' },
            ]}
          />

          <EditorListaJson
            etiqueta="Libre de"
            items={libreDe}
            onCambiar={setLibreDe}
            vacio={{ texto: '' }}
            textoAgregar="+ Agregar"
            campos={[{ clave: 'texto', placeholder: 'Ej. Sulfatos' }]}
          />

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={formulario.destacado}
              onChange={(evento) => actualizarCampo('destacado', evento.target.checked)}
              className="h-4 w-4 accent-amber"
            />
            Destacar en la fila "Destacados" (Web)
          </label>

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={formulario.nuevo}
              onChange={(evento) => actualizarCampo('nuevo', evento.target.checked)}
              className="h-4 w-4 accent-amber"
            />
            Marcar como "Nuevo" (Web)
          </label>

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={formulario.enInicio}
              onChange={(evento) => actualizarCampo('enInicio', evento.target.checked)}
              className="h-4 w-4 accent-amber"
            />
            Mostrar en "Novedades y lo más vendido" (inicio de Productos, Web)
          </label>
          </>
          )}
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
            {error}
          </p>
        )}

        {!esWeb && onEditarEnWeb && (
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
