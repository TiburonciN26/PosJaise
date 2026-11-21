import { Fragment, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pencil, Trash2, Plus, Package, Barcode } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { useDebounce } from '../hooks/useDebounce.js'
import { useMediaQuery } from '../hooks/useMediaQuery.js'
import { useEncabezadoTablaPegado } from '../hooks/useEncabezadoTablaPegado.js'
import { formatearSoles } from '../lib/moneda.js'
import { eliminarFoto, procesarImagen, subirFoto, tipoDeImagenValido, urlPublicaFoto } from '../lib/imagenes.js'
import { manejarActivacionTeclado } from '../lib/teclado.js'
import { imprimirEtiqueta } from '../lib/codigoBarras.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import ModalProducto from '../components/ModalProducto.jsx'
import { SELECT_PRODUCTOS } from '../lib/columnasCatalogo.js'
import ModalAgregarStock from '../components/ModalAgregarStock.jsx'
import ModalVisorFoto from '../components/ModalVisorFoto.jsx'
import ModalCodigosBarras from '../components/ModalCodigosBarras.jsx'
import DetalleDesplegableProducto from '../components/DetalleDesplegableProducto.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'
import EsqueletoLista from '../components/Esqueleto.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import { useEstadoVista } from '../lib/estadoVista.js'
import BotonFlechaDesplegable from '../components/BotonFlechaDesplegable.jsx'
import IconoFlechaDesplegable from '../components/IconoFlechaDesplegable.jsx'

// «Últimos agregados»: lo más reciente primero, sea una ficha nueva o una existente a la que se le sumó stock
// (`ultimo_ingreso` de productos_vista, migración 20261112000013). Es el orden por defecto.
const ORDEN_POR_DEFECTO = 'reciente'

const OPCIONES_ORDEN = [
  { id: 'reciente', label: 'Últimos agregados' },
  { id: 'nombre-asc', label: 'Nombre (A-Z)' },
  { id: 'nombre-desc', label: 'Nombre (Z-A)' },
  { id: 'precio-asc', label: 'Venta (menor a mayor)' },
  { id: 'precio-desc', label: 'Venta (mayor a menor)' },
  { id: 'costo-asc', label: 'Costo (menor a mayor)', soloAdmin: true },
  { id: 'costo-desc', label: 'Costo (mayor a menor)', soloAdmin: true },
  { id: 'stock-asc', label: 'Stock (menor a mayor)' },
  { id: 'stock-desc', label: 'Stock (mayor a menor)' },
]

const ORDEN_A_COLUMNA = {
  // Las fichas antiguas sin movimientos de stock no tienen fecha (null): van al final, no al principio.
  reciente: { columna: 'ultimo_ingreso', ascending: false, nullsFirst: false },
  'nombre-asc': { columna: 'nombre', ascending: true },
  'nombre-desc': { columna: 'nombre', ascending: false },
  'costo-asc': { columna: 'costo', ascending: true },
  'costo-desc': { columna: 'costo', ascending: false },
  'precio-asc': { columna: 'precio', ascending: true },
  'precio-desc': { columna: 'precio', ascending: false },
  'stock-asc': { columna: 'stock_actual', ascending: true },
  'stock-desc': { columna: 'stock_actual', ascending: false },
}

const TAMANO_PAGINA = 50
const BUCKET_FOTOS = 'fotos-productos'

const RESUMEN_VACIO = {
  total: 0,
  bajoStock: 0,
  sinStock: 0,
  inactivos: 0,
  valorTotal: 0,
  ganancias: 0,
  capitalInvertido: 0,
  categorias: [],
}

// Quita caracteres que rompen la sintaxis del filtro .or() de PostgREST
// (coma separa condiciones, paréntesis agrupa) si aparecen en lo que
// escribe el usuario.
function terminoSeguro(texto) {
  return texto.replace(/[%,()]/g, '')
}

function construirConsultaProductos({ busqueda, orden, filtroStock }) {
  let consulta = supabase.from('productos_vista').select(SELECT_PRODUCTOS)

  const termino = terminoSeguro(busqueda.trim())
  if (termino) {
    consulta = consulta.or(`nombre.ilike.%${termino}%,codigo_barras.ilike.%${termino}%`)
  }

  if (filtroStock === 'bajo') consulta = consulta.eq('stock_bajo', true)
  if (filtroStock === 'sin_stock') consulta = consulta.eq('sin_stock', true)
  if (filtroStock === 'inactivo') consulta = consulta.eq('activo', false)

  const { columna, ascending, nullsFirst } = ORDEN_A_COLUMNA[orden] ?? ORDEN_A_COLUMNA[ORDEN_POR_DEFECTO]
  // Desempate por nombre y luego id: sin él, filas con la misma fecha (o varias sin fecha) pueden repetirse o saltarse
  // entre páginas de «Cargar más».
  const ordenada = consulta.order(columna, nullsFirst === undefined ? { ascending } : { ascending, nullsFirst })
  return (columna === 'nombre' ? ordenada : ordenada.order('nombre', { ascending: true })).order('id', { ascending: true })
}

function formatearNumero(monto) {
  return monto.toFixed(2)
}

// Cápsula roja «Inactivo» (PC y móvil).
function EtiquetaInactivo() {
  return (
    <span className="ml-2 shrink-0 rounded border border-red/40 bg-red/10 px-1.5 py-0.5 text-[11px] font-medium text-red">
      Inactivo
    </span>
  )
}

function claseColorStock(producto) {
  if (producto.stock_actual <= 0) return 'text-red'
  if (producto.stock_actual <= producto.stock_minimo) return 'text-orange-400'
  return 'text-green'
}

export default function Inventario({ activo = true }) {
  const { rol } = useAuth()
  const { mostrarToast } = useToast()
  const esAdmin = rol === 'ADMINISTRADOR'
  const navigate = useNavigate()

  const [productos, setProductos] = useState([])
  const [resumen, setResumen] = useState(RESUMEN_VACIO)
  const [hayMas, setHayMas] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useEstadoVista('/inventario:busqueda', '')
  const busquedaDebounced = useDebounce(busqueda, 300)
  const [orden, setOrden] = useEstadoVista('/inventario:orden', ORDEN_POR_DEFECTO)
  const [filtroStock, setFiltroStock] = useEstadoVista('/inventario:filtroStock', 'todos') // 'todos' | 'bajo' | 'sin_stock' | 'inactivo'
  const [modalProducto, setModalProducto] = useState(null) // null | 'nuevo' | producto
  const [productoAEliminar, setProductoAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)
  const [productoParaAgregarStock, setProductoParaAgregarStock] = useState(null)
  const [abiertos, setAbiertos] = useState(() => new Set()) // productos desplegados (tarjeta móvil o fila de la tabla)
  const esEscritorio = useMediaQuery('(min-width: 1024px)') // monta tarjetas O tabla, no las dos
  const [subiendoFotoId, setSubiendoFotoId] = useState(null) // producto cuya foto se está subiendo desde el lápiz
  const [fotoVisor, setFotoVisor] = useState(null) // { url, alt } | null
  const [mostrarCodigos, setMostrarCodigos] = useState(false)
  const [totalesAbiertos, setTotalesAbiertos] = useEstadoVista('/inventario:totalesAbiertos', false) // totales en soles (admin)
  // Sube al guardar un producto, agregar stock o editar/eliminar un proveedor desde un desplegable: remonta los bloques de
  // proveedores e historial de las tarjetas abiertas para que muestren lo nuevo.
  const [versionProveedores, setVersionProveedores] = useState(0)
  const primeraCargaHecha = useRef(false)
  // M1 de la 4ª auditoría: mismo guard que la carga inicial, para que
  // cargarMasProductos descarte una respuesta que llega tarde de un
  // filtro/búsqueda que ya no está activo (ver Historial.jsx).
  const vigenteRef = useRef({ actual: true })
  const panelEliminarRef = useRef(null)
  const { barraRef, encabezadoRef, claseTh, estiloTh } = useEncabezadoTablaPegado([productos, cargando])

  useCerrarConEscape(() => setProductoAEliminar(null), Boolean(productoAEliminar))
  useModalA11y(panelEliminarRef, Boolean(productoAEliminar))

  async function cargarProductos(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)
    const filtros = { busqueda: busquedaDebounced, orden, filtroStock }
    // Una recarga silenciosa (tras guardar/eliminar) conserva las filas ya cargadas con «Cargar más»: si se recortara a la
    // primera página, la lista encogería y el scroll saltaría.
    const hasta = silencioso ? Math.min(Math.max(productos.length, TAMANO_PAGINA), 1000) : TAMANO_PAGINA

    const [productosRes, resumenRes, inactivosRes] = await Promise.all([
      construirConsultaProductos(filtros).range(0, hasta - 1),
      supabase.rpc('resumen_inventario'),
      // resumen_inventario no cuenta los inactivos: conteo aparte (solo el número, sin traer filas).
      supabase.from('productos_vista').select('id', { count: 'exact', head: true }).eq('activo', false),
    ])

    if (!vigente.actual) return

    if (productosRes.error) {
      setError('No se pudo cargar el inventario.')
      setProductos([])
      setCargando(false)
      return
    }

    setError(null)
    setProductos(productosRes.data ?? [])
    setHayMas((productosRes.data ?? []).length === hasta)

    const filaResumen = resumenRes.data?.[0]
    setResumen(
      filaResumen
        ? {
            total: filaResumen.total ?? 0,
            bajoStock: filaResumen.bajo_stock ?? 0,
            sinStock: filaResumen.sin_stock ?? 0,
            inactivos: inactivosRes.count ?? 0,
            valorTotal: filaResumen.valor_total ?? 0,
            ganancias: filaResumen.ganancias ?? 0,
            capitalInvertido: filaResumen.capital_invertido ?? 0,
            categorias: filaResumen.categorias ?? [],
          }
        : RESUMEN_VACIO,
    )

    setCargando(false)
  }

  async function cargarMasProductos() {
    if (cargandoMas || !hayMas) return
    const vigente = vigenteRef.current
    setCargandoMas(true)
    const filtros = { busqueda: busquedaDebounced, orden, filtroStock }

    const { data, error: errorMas } = await construirConsultaProductos(filtros).range(
      productos.length,
      productos.length + TAMANO_PAGINA - 1,
    )

    setCargandoMas(false)
    if (!vigente.actual) return

    if (errorMas) {
      mostrarToast('No se pudieron cargar más productos.', 'error')
      return
    }

    setProductos((anterior) => [...anterior, ...(data ?? [])])
    setHayMas((data ?? []).length === TAMANO_PAGINA)
  }

  // useEffectEvent: el efecto corre solo cuando cambian sus dependencias, pero llama a la versión más reciente
  // de cargarProductos (lee los filtros actuales) sin volver a dispararse cada vez que esa función se recrea.
  const cargarDesdeEfecto = useEffectEvent((vigente, silencioso) => cargarProductos(vigente, silencioso))
  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    vigenteRef.current = vigente
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarDesdeEfecto(vigente, silencioso)
    return () => {
      vigente.actual = false
    }
  }, [activo, busquedaDebounced, orden, filtroStock])

  // Cambiar la foto desde el desplegable (lápiz). Escribe productos.foto_url, la MISMA columna que edita Web → Catálogo, y
  // borra el archivo anterior solo después de que la base quedó actualizada (patrón de lib/imagenes.js).
  async function cambiarFotoProducto(producto, archivo) {
    if (!tipoDeImagenValido(archivo)) {
      mostrarToast('Formato no admitido. Usa JPG, PNG o WEBP.', 'error')
      return
    }
    setSubiendoFotoId(producto.id)
    let rutaNueva = null
    try {
      const { blob, extension } = await procesarImagen(archivo)
      rutaNueva = await subirFoto(BUCKET_FOTOS, `${crypto.randomUUID()}.${extension}`, blob)
      const { error: errorFoto } = await supabase.from('productos').update({ foto_url: rutaNueva }).eq('id', producto.id)
      if (errorFoto) throw errorFoto
      if (producto.foto_url && producto.foto_url !== rutaNueva) eliminarFoto(BUCKET_FOTOS, producto.foto_url)
      mostrarToast('Foto actualizada. También se ve en Web → Catálogo.', 'exito')
      cargarProductos(vigenteRef.current, true)
    } catch {
      if (rutaNueva) eliminarFoto(BUCKET_FOTOS, rutaNueva)
      mostrarToast('No se pudo cambiar la foto. Intenta de nuevo.', 'error')
    } finally {
      setSubiendoFotoId(null)
    }
  }

  function imprimirEtiquetaProducto(producto) {
    if (!imprimirEtiqueta({ nombre: producto.nombre, codigo: producto.codigo_barras })) {
      mostrarToast('Ese código tiene caracteres que no se pueden imprimir como código de barras (tildes, ñ o símbolos).', 'error')
    }
  }

  // Un proveedor se editó/eliminó desde el desplegable: remonta proveedores/historial y refresca la lista.
  function alCambiarProveedor() {
    setVersionProveedores((n) => n + 1)
    cargarProductos(vigenteRef.current, true)
  }

  function alternarAbierto(id) {
    setAbiertos((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  async function confirmarEliminar() {
    if (!productoAEliminar) return

    setEliminando(true)
    const { data, error: errorEliminar } = await supabase.rpc('eliminar_producto', {
      p_id: productoAEliminar.id,
    })
    setEliminando(false)
    setProductoAEliminar(null)

    if (errorEliminar) {
      mostrarToast('No se pudo eliminar el producto.', 'error')
      return
    }

    setAbiertos((anterior) => {
      const siguiente = new Set(anterior)
      siguiente.delete(productoAEliminar.id)
      return siguiente
    })

    if (data === 'ELIMINADO') {
      mostrarToast('Producto eliminado.', 'exito')
    } else {
      mostrarToast('Ese producto ya tiene ventas registradas — se desactivó en vez de eliminarse.', 'info')
    }
    cargarProductos(vigenteRef.current, true)
  }

  // Búsqueda, orden y filtro de stock ya vienen resueltos por el servidor
  // (construirConsultaProductos) — productos ya es la página a mostrar.
  const totalProductos = resumen.total
  const bajoStockCount = resumen.bajoStock
  const sinStockCount = resumen.sinStock
  const inactivosCount = resumen.inactivos
  const valorTotal = resumen.valorTotal
  const ganancias = resumen.ganancias
  const capitalInvertido = resumen.capitalInvertido
  const categoriasExistentes = resumen.categorias


  return (
    <div className="animate-entrada-pestana px-(--separador-vertical) pb-6 pt-0 lg:mx-auto lg:w-full lg:max-w-(--ancho-pestana)">
      {/* Buscador + Nuevo producto: fijos arriba al hacer scroll, siempre debajo del header */}
      <div ref={barraRef} className="sticky top-0 z-10 -mx-(--separador-vertical) flex items-center gap-2 bg-bg px-(--separador-vertical) pb-2 pt-(--separador-horizontal)">
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder="Buscar producto..."
          tema="amber"
          sinBorde
        />

        <SelectorOrden
          opciones={OPCIONES_ORDEN.filter((opcion) => esAdmin || !opcion.soloAdmin)}
          valor={orden}
          onCambiar={setOrden}
          tema="amber"
          sinBorde
          seleccionado
        />

        {/* Hoja de códigos de barras (nombre + código de TODOS los productos; exportar / imprimir etiqueta). */}
        <button
          type="button"
          onClick={() => setMostrarCodigos(true)}
          aria-label="Códigos de barras"
          title="Códigos de barras"
          className="flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-boton-icono p-2.5 text-ink/70 transition-colors hover:text-amber"
        >
          <Barcode className="h-4 w-4" />
        </button>

        {esAdmin && (
          <button
            type="button"
            onClick={() => setModalProducto('nuevo')}
            className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-amber px-3 py-2.5 text-sm font-semibold text-bg lg:flex"
          >
            <Plus className="h-4 w-4" />
            <span>Nuevo producto</span>
          </button>
        )}
      </div>

      {/* Estadísticas: una sola fila de contadores (que además filtran la lista) + «Totales», que despliega los montos en
          soles (solo admin). Sin tarjeta ni borde: una tarjeta con borde sobre --color-surface se leía como un producto más.
          El filtro activo usa surface-3 (en oscuro surface-2 == surface y no se veía), igual en PC y móvil. */}
      <div className="mt-1">
        <div className="flex items-center gap-2">
          <div className="grid min-w-0 flex-1 grid-cols-4 gap-1.5 text-center">
            {[
              { filtro: 'todos', etiqueta: 'Total', valor: totalProductos, clase: 'text-ink' },
              { filtro: 'bajo', etiqueta: 'Bajo', valor: bajoStockCount, clase: 'text-orange-400' },
              { filtro: 'sin_stock', etiqueta: 'Sin stock', valor: sinStockCount, clase: 'text-red' },
              { filtro: 'inactivo', etiqueta: 'Inactivo', valor: inactivosCount, clase: 'text-ink/70' },
            ].map(({ filtro, etiqueta, valor, clase }) => (
              <button
                key={filtro}
                type="button"
                onClick={() => setFiltroStock(filtro)}
                aria-pressed={filtroStock === filtro}
                className={`flex flex-col items-center justify-center rounded-lg px-1 py-1.5 transition-colors sm:flex-row sm:items-baseline sm:gap-1.5 sm:py-2 ${
                  filtroStock === filtro ? 'bg-surface-3' : 'bg-boton-icono hover:bg-surface-3/60'
                }`}
              >
                <span className={`font-mono text-base font-semibold ${clase}`}>{valor}</span>
                <span className="max-w-full truncate text-[11px] leading-tight text-ink/60">{etiqueta}</span>
              </button>
            ))}
          </div>

          {esAdmin && (
            <button
              type="button"
              onClick={() => setTotalesAbiertos((abierto) => !abierto)}
              aria-expanded={totalesAbiertos}
              aria-controls="inventario-totales"
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs text-ink transition-colors hover:bg-surface-3 ${
                totalesAbiertos ? 'bg-surface-3' : 'bg-boton-icono'
              }`}
            >
              <span>Totales</span>
              <IconoFlechaDesplegable
                className={`h-3 w-3 transition-transform duration-300 ${totalesAbiertos ? 'rotate-180' : ''}`}
              />
            </button>
          )}
        </div>

        {esAdmin && (
          // grid-rows 0fr ↔ 1fr: se desliza al abrir y cerrar; cerrado queda fuera del Tab y del lector (inert).
          <div
            id="inventario-totales"
            className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out motion-reduce:transition-none ${
              totalesAbiertos ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
            }`}
            aria-hidden={!totalesAbiertos}
            inert={!totalesAbiertos}
          >
            <div className="min-h-0 overflow-hidden">
              {/* Submenú: fondo más hundido que la página (--color-submenu), sin borde, filas etiqueta · monto. */}
              <dl className="mt-2 grid grid-cols-1 gap-x-6 rounded-lg bg-submenu px-3 py-1.5 md:grid-cols-3">
                {[
                  { etiqueta: 'Capital invertido', valor: capitalInvertido, clase: 'text-ink/70' },
                  { etiqueta: 'Valor total', valor: valorTotal, clase: 'text-ink' },
                  { etiqueta: 'Ganancias', valor: ganancias, clase: 'text-green' },
                ].map(({ etiqueta, valor, clase }) => (
                  <div key={etiqueta} className="flex items-center justify-between gap-2 py-1.5">
                    <dt className="text-xs text-ink/60">{etiqueta}</dt>
                    <dd className={`font-mono text-sm font-semibold ${clase}`}>{formatearSoles(valor)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <EsqueletoLista columnas={6} />
      ) : productos.length === 0 ? (
        <EstadoVacio
          icono={Package}
          mensaje="No se encontraron productos."
          accion={esAdmin ? { label: '+ Nuevo producto', onClick: () => setModalProducto('nuevo') } : undefined}
        />
      ) : (
        <>
          {/* Un solo desplegable por producto, sin modal: tarjetas en móvil y fila de la tabla en escritorio (se monta solo
              una de las dos vistas para no duplicar el detalle ni sus consultas). Sin desplegar se ve lo esencial; al
              desplegar: foto, código, categoría, costo/ganancia (admin), proveedores, historial de stock (admin) y, en
              móvil, Editar/Eliminar (admin). Al abrirse, el nombre se pinta de ámbar (se apaga al cerrar), como en Almacén. */}
          {!esEscritorio && (
            <div className="mt-3 grid grid-cols-1 gap-2.5">
              {productos.map((producto) => {
                const abierto = abiertos.has(producto.id)
                const urlFoto = urlPublicaFoto(BUCKET_FOTOS, producto.foto_url)
                return (
                  <div key={producto.id} className="rounded-lg border border-border bg-surface transition-colors hover:border-amber/40">
                    <div className="flex items-center gap-2 p-2">
                      <div
                        onClick={() => alternarAbierto(producto.id)}
                        onKeyDown={manejarActivacionTeclado(() => alternarAbierto(producto.id))}
                        role="button"
                        tabIndex={0}
                        aria-expanded={abierto}
                        className="min-w-0 flex-1 cursor-pointer touch-manipulation"
                      >
                        <p className={`flex min-w-0 items-center text-sm font-medium transition-colors duration-300 ${abierto ? 'text-amber' : 'text-ink'}`}>
                          <span className="truncate">{producto.nombre}</span>
                          {!producto.activo && <EtiquetaInactivo />}
                        </p>
                        <div className="mt-0.5 flex items-center gap-3 font-mono text-xs text-ink/70">
                          <span>
                            Venta <span className="text-amber">{formatearNumero(producto.precio)}</span>
                          </span>
                          <span>
                            Stock: <span className={claseColorStock(producto)}>{producto.stock_actual}</span>
                          </span>
                        </div>
                      </div>

                      <BotonAccion
                        plano
                        sinBorde
                        icono={Plus}
                        texto="Agregar stock"
                        color="morado"
                        onClick={() => setProductoParaAgregarStock({ producto })}
                      />
                      <BotonFlechaDesplegable abierto={abierto} onClick={() => alternarAbierto(producto.id)} />
                    </div>

                    <CampoColapsable abierto={abierto} diferido>
                      <div className="border-t border-border p-3">
                        <DetalleDesplegableProducto
                          producto={producto}
                          esAdmin={esAdmin}
                          urlFoto={urlFoto}
                          versionProveedores={versionProveedores}
                          onVerFoto={(url, alt) => setFotoVisor({ url, alt })}
                          onImprimir={imprimirEtiquetaProducto}
                          onCambioProveedor={alCambiarProveedor}
                          onEditar={setModalProducto}
                          onEliminar={setProductoAEliminar}
                          onCambiarFoto={cambiarFotoProducto}
                          subiendoFoto={subiendoFotoId === producto.id}
                        />
                      </div>
                    </CampoColapsable>
                  </div>
                )
              })}
            </div>
          )}

          {/* Tabla: tablet y desktop. Tocar la fila (o su flecha) despliega el detalle debajo, igual que en Almacén. Los
              botones de acción frenan el clic solo sobre sí mismos. */}
          {esEscritorio && (
            <div className="mt-4 overflow-x-clip border-y border-border">
              <table className="w-full text-left text-sm">
                <thead ref={encabezadoRef}>
                  <tr className="font-mono text-xs uppercase tracking-wider text-ink/60">
                    <th style={estiloTh} className={`${claseTh} px-3 py-2 font-semibold`}>Producto</th>
                    <th style={estiloTh} className={`${claseTh} px-3 py-2 font-semibold`}>Categoría</th>
                    {esAdmin && <th style={estiloTh} className={`${claseTh} px-3 py-2 text-right font-semibold`}>Costo</th>}
                    <th style={estiloTh} className={`${claseTh} px-3 py-2 text-right font-semibold`}>Precio</th>
                    {esAdmin && <th style={estiloTh} className={`${claseTh} px-3 py-2 text-right font-semibold`}>Ganancia</th>}
                    <th style={estiloTh} className={`${claseTh} px-3 py-2 text-right font-semibold`}>Stock</th>
                    <th style={estiloTh} className={`${claseTh} px-3 py-2 text-right font-semibold`}>Acciones</th>
                    <th style={estiloTh} className={`${claseTh} w-14 px-3 py-2 font-semibold`}>
                      <span className="sr-only">Detalle</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {productos.map((producto, indice) => {
                    const abierto = abiertos.has(producto.id)
                    const ultimo = indice === productos.length - 1
                    const urlFoto = urlPublicaFoto(BUCKET_FOTOS, producto.foto_url)
                    return (
                      <Fragment key={producto.id}>
                        <tr
                          onClick={() => alternarAbierto(producto.id)}
                          onKeyDown={manejarActivacionTeclado(() => alternarAbierto(producto.id))}
                          role="button"
                          tabIndex={0}
                          aria-expanded={abierto}
                          className={`cursor-pointer touch-manipulation bg-tabla hover:bg-surface-2/60 ${
                            ultimo && !abierto ? 'border-b-0' : ''
                          }`}
                        >
                          <td className="px-3 py-2.5">
                            <p className={`transition-colors duration-300 ${abierto ? 'text-amber' : 'text-ink'}`}>
                              {producto.nombre}
                              {!producto.activo && <EtiquetaInactivo />}
                            </p>
                            <p className="font-mono text-xs text-ink/60">{producto.codigo_barras || 'Sin código'}</p>
                          </td>
                          <td className="px-3 py-2.5 text-ink/60">{producto.categoria || '—'}</td>
                          {esAdmin && (
                            <td className="px-3 py-2.5 text-right font-mono text-ink/60">
                              {formatearSoles(producto.costo ?? 0)}
                            </td>
                          )}
                          <td className="px-3 py-2.5 text-right font-mono text-ink">{formatearSoles(producto.precio)}</td>
                          {esAdmin && (
                            <td className="px-3 py-2.5 text-right font-mono text-green">
                              {formatearSoles(producto.precio - (producto.costo ?? 0))}
                            </td>
                          )}
                          <td className={`px-3 py-2.5 text-right font-mono ${claseColorStock(producto)}`}>
                            {producto.stock_actual}
                          </td>
                          <td className="px-3 py-2.5" onClick={(evento) => evento.stopPropagation()}>
                            <div className="flex justify-end gap-2">
                              <BotonAccion
                                plano
                                sinBorde
                                icono={Plus}
                                texto="Agregar stock"
                                color="morado"
                                onClick={() => setProductoParaAgregarStock({ producto })}
                              />
                              {esAdmin && (
                                <>
                                  <BotonAccion
                                    plano
                                    sinBorde
                                    icono={Pencil}
                                    texto="Editar"
                                    color="celeste"
                                    onClick={() => setModalProducto(producto)}
                                  />
                                  <BotonAccion
                                    plano
                                    sinBorde
                                    icono={Trash2}
                                    texto="Eliminar"
                                    color="rojo"
                                    onClick={() => setProductoAEliminar(producto)}
                                  />
                                </>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex justify-end">
                              <BotonFlechaDesplegable
                                abierto={abierto}
                                onClick={(evento) => {
                                  evento.stopPropagation()
                                  alternarAbierto(producto.id)
                                }}
                              />
                            </div>
                          </td>
                        </tr>
                        {/* Fila del desplegable: cerrada no lleva borde, para que no se vea una línea doble entre productos. */}
                        <tr className={abierto ? '' : 'border-b-0'}>
                          <td colSpan={esAdmin ? 8 : 6} className="p-0">
                            <CampoColapsable abierto={abierto} diferido>
                              <div className="bg-bg px-8 pb-8 pt-4">
                                <DetalleDesplegableProducto
                                  producto={producto}
                                  esAdmin={esAdmin}
                                  urlFoto={urlFoto}
                                  versionProveedores={versionProveedores}
                                  onVerFoto={(url, alt) => setFotoVisor({ url, alt })}
                                  onImprimir={imprimirEtiquetaProducto}
                                  onCambioProveedor={alCambiarProveedor}
                                  onEditar={setModalProducto}
                                  onEliminar={setProductoAEliminar}
                                  onCambiarFoto={cambiarFotoProducto}
                                  subiendoFoto={subiendoFotoId === producto.id}
                                />
                              </div>
                            </CampoColapsable>
                          </td>
                        </tr>
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {hayMas && (
            <button
              type="button"
              onClick={cargarMasProductos}
              disabled={cargandoMas}
              className="mt-4 w-full rounded-lg border border-border-strong py-2.5 text-sm text-ink/70 transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
            >
              {cargandoMas ? 'Cargando...' : 'Cargar más'}
            </button>
          )}
        </>
      )}

      {esAdmin && (
        <BotonFlotanteAgregar
          onClick={() => setModalProducto('nuevo')}
          label="Nuevo producto"
        />
      )}

      {modalProducto && (
        <ModalProducto
          producto={modalProducto === 'nuevo' ? null : modalProducto}
          categoriasExistentes={categoriasExistentes}
          // «Editar en Web» (solo ADMINISTRADOR, ficha existente): abre el MISMO producto, por ID, en Web → Catálogo →
          // Productos. Esta pestaña sigue montada: el modal y sus cambios pendientes siguen ahí al volver.
          onEditarEnWeb={
            esAdmin && modalProducto !== 'nuevo'
              ? () => navigate(`/catalogo-web?tab=productos&id=${modalProducto.id}&desde=/inventario`)
              : undefined
          }
          // La protección económica (transporte, otros importes, confirmación del costo) vive en Recompensas Web.
          onProteccion={
            esAdmin && modalProducto !== 'nuevo'
              ? () => navigate(`/recompensas-web?tab=proteccion-productos&producto=${modalProducto.id}&desde=/inventario`)
              : undefined
          }
          onCerrar={() => setModalProducto(null)}
          onGuardado={() => {
            const esNuevo = modalProducto === 'nuevo'
            setModalProducto(null)
            mostrarToast(esNuevo ? 'Producto creado.' : 'Producto actualizado.', 'exito')
            cargarProductos(vigenteRef.current, true)
            setVersionProveedores((n) => n + 1)
          }}
        />
      )}

      {productoParaAgregarStock && (
        <ModalAgregarStock
          producto={productoParaAgregarStock.producto}
          esAdmin={esAdmin}
          onCerrar={() => setProductoParaAgregarStock(null)}
          onGuardado={() => {
            setProductoParaAgregarStock(null)
            mostrarToast('Stock actualizado.', 'exito')
            cargarProductos(vigenteRef.current, true)
            setVersionProveedores((n) => n + 1) // el ingreso pudo vincular otro proveedor al producto
          }}
        />
      )}

      {mostrarCodigos && <ModalCodigosBarras onCerrar={() => setMostrarCodigos(false)} />}

      {fotoVisor && (
        <ModalVisorFoto url={fotoVisor.url} alt={fotoVisor.alt} onCerrar={() => setFotoVisor(null)} />
      )}

      {productoAEliminar && (
        <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
          <div ref={panelEliminarRef} className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
            <h2 className="text-base font-semibold text-ink">
              ¿Eliminar "{productoAEliminar.nombre}"?
            </h2>
            <p className="mt-1 text-sm text-ink/60">
              Si ya tiene ventas registradas, en vez de eliminarse se desactivará para no
              romper el historial.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setProductoAEliminar(null)}
                disabled={eliminando}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-amber hover:text-amber disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarEliminar}
                disabled={eliminando}
                className="flex-1 rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10 disabled:opacity-40"
              >
                {eliminando ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
