import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pencil, Trash2, Plus, Package, ImageOff, ZoomIn, Barcode, Printer } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { useDebounce } from '../hooks/useDebounce.js'
import { useEncabezadoTablaPegado } from '../hooks/useEncabezadoTablaPegado.js'
import { formatearSoles } from '../lib/moneda.js'
import { urlPublicaFoto } from '../lib/imagenes.js'
import { manejarActivacionTeclado } from '../lib/teclado.js'
import { imprimirEtiqueta } from '../lib/codigoBarras.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import ModalProducto from '../components/ModalProducto.jsx'
import { SELECT_PRODUCTOS } from '../lib/columnasCatalogo.js'
import ModalAgregarStock from '../components/ModalAgregarStock.jsx'
import ModalDetalleProducto from '../components/ModalDetalleProducto.jsx'
import ModalVisorFoto from '../components/ModalVisorFoto.jsx'
import ModalCodigosBarras from '../components/ModalCodigosBarras.jsx'
import HistorialStockProducto from '../components/HistorialStockProducto.jsx'
import ProveedoresDelProducto from '../components/ProveedoresDelProducto.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'
import TarjetaResumen from '../components/TarjetaResumen.jsx'
import EsqueletoLista from '../components/Esqueleto.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import { useEstadoVista } from '../lib/estadoVista.js'
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

const RESUMEN_VACIO = {
  total: 0,
  bajoStock: 0,
  sinStock: 0,
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

  const { columna, ascending, nullsFirst } = ORDEN_A_COLUMNA[orden] ?? ORDEN_A_COLUMNA[ORDEN_POR_DEFECTO]
  // Desempate por nombre y luego id: sin él, filas con la misma fecha (o varias sin fecha) pueden repetirse o saltarse
  // entre páginas de «Cargar más».
  const ordenada = consulta.order(columna, nullsFirst === undefined ? { ascending } : { ascending, nullsFirst })
  return (columna === 'nombre' ? ordenada : ordenada.order('nombre', { ascending: true })).order('id', { ascending: true })
}

function formatearNumero(monto) {
  return monto.toFixed(2)
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
  const [filtroStock, setFiltroStock] = useEstadoVista('/inventario:filtroStock', 'todos') // 'todos' | 'bajo' | 'sin_stock'
  const [modalProducto, setModalProducto] = useState(null) // null | 'nuevo' | producto
  const [productoAEliminar, setProductoAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)
  const [productoParaAgregarStock, setProductoParaAgregarStock] = useState(null)
  const [productoDetalle, setProductoDetalle] = useState(null) // { producto, mostrarAcciones } | null (solo escritorio)
  const [abiertos, setAbiertos] = useState(() => new Set()) // tarjetas móviles desplegadas
  const [fotoVisor, setFotoVisor] = useState(null) // { url, alt } | null
  const [mostrarCodigos, setMostrarCodigos] = useState(false)
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

    const [productosRes, resumenRes] = await Promise.all([
      construirConsultaProductos(filtros).range(0, hasta - 1),
      supabase.rpc('resumen_inventario'),
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

  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    vigenteRef.current = vigente
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarProductos(vigente, silencioso)
    return () => {
      vigente.actual = false
    }
  }, [activo, busquedaDebounced, orden, filtroStock])

  function imprimirEtiquetaProducto(producto) {
    if (!imprimirEtiqueta({ nombre: producto.nombre, codigo: producto.codigo_barras })) {
      mostrarToast('Ese código tiene caracteres que no se pueden imprimir como código de barras (tildes, ñ o símbolos).', 'error')
    }
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

    setProductoDetalle(null)
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

      {/* Estadísticas */}
      <div className="mt-1 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div
          className={`rounded-lg border border-border bg-surface px-3 py-2 ${!esAdmin ? 'col-span-2 md:col-span-4' : ''}`}
        >
          <p className="text-xs text-ink/60 lg:text-center">Productos</p>
          <div className="mt-1 grid grid-cols-3 gap-2 text-center">
            <button
              type="button"
              onClick={() => setFiltroStock('todos')}
              className={`rounded-lg py-1 transition-colors ${
                filtroStock === 'todos' ? 'bg-surface-2' : 'hover:bg-surface-2/50'
              }`}
            >
              <p className="font-mono text-lg font-semibold text-ink sm:text-xl">
                {totalProductos}
              </p>
              <p className="text-[11px] text-ink/60">Total</p>
            </button>
            <button
              type="button"
              onClick={() => setFiltroStock('bajo')}
              className={`rounded-lg py-1 transition-colors ${
                filtroStock === 'bajo' ? 'bg-surface-2' : 'hover:bg-surface-2/50'
              }`}
            >
              <p className="font-mono text-lg font-semibold text-orange-400 sm:text-xl">
                {bajoStockCount}
              </p>
              <p className="text-[11px] text-ink/60">Bajo</p>
            </button>
            <button
              type="button"
              onClick={() => setFiltroStock('sin_stock')}
              className={`rounded-lg py-1 transition-colors ${
                filtroStock === 'sin_stock' ? 'bg-surface-2' : 'hover:bg-surface-2/50'
              }`}
            >
              <p className="font-mono text-lg font-semibold text-red sm:text-xl">
                {sinStockCount}
              </p>
              <p className="text-[11px] text-ink/60">Sin stock</p>
            </button>
          </div>
        </div>

        {esAdmin && (
          <>
            <TarjetaResumen
              etiqueta="Capital invertido"
              valor={formatearSoles(capitalInvertido)}
              claseValor="text-ink/60"
              padding="px-2.5 py-2"
            />
            <TarjetaResumen
              etiqueta="Valor total"
              valor={formatearSoles(valorTotal)}
              claseValor="text-ink"
            />
            <TarjetaResumen
              etiqueta="Ganancias"
              valor={formatearSoles(ganancias)}
              claseValor="text-green"
            />
          </>
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
          {/* Tarjetas desplegables: solo móvil. Sin desplegar se ve lo esencial (nombre, stock, precio de venta y
              «Agregar stock», que ambos roles usan seguido). Al desplegar: foto, código, categoría, costo/ganancia
              (admin), historial de stock (admin) y Editar/Eliminar (admin) — lo que antes mostraba el modal de
              detalle, que ahora solo se abre desde la tabla de escritorio. */}
          <div className="mt-3 grid grid-cols-1 gap-2.5 lg:hidden">
            {productos.map((producto) => {
              const abierto = abiertos.has(producto.id)
              const urlFoto = urlPublicaFoto('fotos-productos', producto.foto_url)
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
                      <p className="truncate text-sm font-medium text-ink">
                        {producto.nombre}
                        {!producto.activo && (
                          <span className="ml-2 rounded border border-border-strong px-1.5 py-0.5 text-[11px] font-normal text-ink/60">
                            Inactivo
                          </span>
                        )}
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
                      onClick={() => setProductoParaAgregarStock({ producto, desdeDetalle: false })}
                    />
                    <button
                      type="button"
                      onClick={() => alternarAbierto(producto.id)}
                      aria-label={abierto ? 'Contraer' : 'Expandir'}
                      className="shrink-0 p-1.5"
                    >
                      <IconoFlechaDesplegable
                        className={`h-3 w-3 text-ink/60 transition-transform duration-300 ${abierto ? 'rotate-180' : ''}`}
                      />
                    </button>
                  </div>

                  <CampoColapsable abierto={abierto} diferido>
                    <div className="border-t border-border p-3">
                      {urlFoto ? (
                        <button
                          type="button"
                          onClick={() => setFotoVisor({ url: urlFoto, alt: producto.nombre })}
                          className="relative block h-40 w-full rounded-lg"
                        >
                          <div className="foto-borde-luz h-full w-full rounded-lg">
                            <div className="h-full w-full overflow-hidden rounded-[6px] bg-surface-2">
                              <img src={urlFoto} alt={producto.nombre} className="h-full w-full object-cover" />
                            </div>
                          </div>
                          <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/60 p-1.5 text-white">
                            <ZoomIn className="h-3.5 w-3.5" />
                          </span>
                        </button>
                      ) : (
                        <div className="flex h-40 w-full items-center justify-center overflow-hidden rounded-lg border border-border bg-surface-2">
                          <ImageOff className="h-8 w-8 text-ink/40" />
                        </div>
                      )}

                      {/* [impresora] [ícono] código ........ categoría (extremo derecho) */}
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-1.5">
                          {producto.codigo_barras && (
                            <BotonAccion
                              plano
                              sinBorde
                              icono={Printer}
                              texto="Imprimir etiqueta"
                              color="celeste"
                              onClick={() => imprimirEtiquetaProducto(producto)}
                            />
                          )}
                          <Barcode className="h-4 w-4 shrink-0 text-ink/60" aria-hidden="true" />
                          <span className="break-all font-mono text-xs text-ink/60">
                            {producto.codigo_barras || 'Sin código'}
                          </span>
                        </div>
                        {producto.categoria && (
                          <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink/60">
                            {producto.categoria}
                          </span>
                        )}
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-sm text-ink/70">
                        {esAdmin && (
                          <span>Costo <span className="text-ink/60">{formatearNumero(producto.costo ?? 0)}</span></span>
                        )}
                        <span>Venta <span className="text-amber">{formatearNumero(producto.precio)}</span></span>
                        {esAdmin && (
                          <span>Gananc. <span className="text-green">{formatearNumero(producto.precio - (producto.costo ?? 0))}</span></span>
                        )}
                      </div>

                      <ProveedoresDelProducto
                        key={`prov-${producto.id}-${versionProveedores}`}
                        producto={producto}
                        esAdmin={esAdmin}
                        onCambio={() => {
                          setVersionProveedores((n) => n + 1)
                          cargarProductos(vigenteRef.current, true)
                        }}
                      />

                      <HistorialStockProducto
                        key={`${producto.id}-${producto.stock_actual}-${versionProveedores}`}
                        productoId={producto.id}
                        esAdmin={esAdmin}
                        proveedorHabitualId={producto.proveedor_id}
                        onProveedorCambio={() => {
                          setVersionProveedores((n) => n + 1)
                          cargarProductos(vigenteRef.current, true)
                        }}
                      />

                      {esAdmin && (
                        <div className="mt-3 flex justify-start gap-2">
                          <BotonAccion icono={Pencil} texto="Editar" color="celeste" onClick={() => setModalProducto(producto)} />
                          <BotonAccion icono={Trash2} texto="Eliminar" color="rojo" onClick={() => setProductoAEliminar(producto)} />
                        </div>
                      )}
                    </div>
                  </CampoColapsable>
                </div>
              )
            })}
          </div>

          {/* Tabla: tablet y desktop */}
          <div className="mt-4 hidden overflow-x-clip border-y border-border lg:block">
            <table className="w-full text-left text-sm">
              <thead ref={encabezadoRef}>
                <tr className="font-mono text-xs uppercase tracking-wider text-ink/60">
                  <th style={estiloTh} className={`${claseTh} px-3 py-2 font-normal`}>Producto</th>
                  <th style={estiloTh} className={`${claseTh} px-3 py-2 font-normal`}>Categoría</th>
                  {esAdmin && <th style={estiloTh} className={`${claseTh} px-3 py-2 text-right font-normal`}>Costo</th>}
                  <th style={estiloTh} className={`${claseTh} px-3 py-2 text-right font-normal`}>Precio</th>
                  {esAdmin && <th style={estiloTh} className={`${claseTh} px-3 py-2 text-right font-normal`}>Ganancia</th>}
                  <th style={estiloTh} className={`${claseTh} px-3 py-2 text-right font-normal`}>Stock</th>
                  <th style={estiloTh} className={`${claseTh} px-3 py-2 text-right font-normal`}>Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {productos.map((producto) => (
                  <tr
                    key={producto.id}
                    onClick={() => setProductoDetalle({ producto, mostrarAcciones: false })}
                    className="cursor-pointer touch-manipulation bg-tabla hover:bg-surface-2/60"
                  >
                    <td className="px-3 py-2.5">
                      <p className="text-ink">
                        {producto.nombre}
                        {!producto.activo && (
                          <span className="ml-2 rounded border border-border-strong px-1.5 py-0.5 text-[11px] text-ink/60">
                            Inactivo
                          </span>
                        )}
                      </p>
                      <p className="font-mono text-xs text-ink/60">
                        {producto.codigo_barras || 'Sin código'}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-ink/60">{producto.categoria || '—'}</td>
                    {esAdmin && (
                      <td className="px-3 py-2.5 text-right font-mono text-ink/60">
                        {formatearSoles(producto.costo ?? 0)}
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-right font-mono text-ink">
                      {formatearSoles(producto.precio)}
                    </td>
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
                          onClick={() => setProductoParaAgregarStock({ producto, desdeDetalle: false })}
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
          onGuardado={(productoActualizado) => {
            const esNuevo = modalProducto === 'nuevo'
            setModalProducto(null)
            mostrarToast(esNuevo ? 'Producto creado.' : 'Producto actualizado.', 'exito')
            // Si se editó desde el modal de detalle, ese modal sigue abierto
            // (nunca se cerró, ver más abajo) — se le pasan los datos ya
            // actualizados para que no muestre la foto/precio/nombre viejos.
            if (productoActualizado) {
              setProductoDetalle((anterior) =>
                anterior ? { ...anterior, producto: productoActualizado } : anterior,
              )
            }
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
          onGuardado={(stockNuevo) => {
            const { desdeDetalle } = productoParaAgregarStock
            setProductoParaAgregarStock(null)
            mostrarToast('Stock actualizado.', 'exito')
            // Si se agregó desde el modal de detalle, ese modal sigue abierto
            // (nunca se cerró, ver más abajo) — le actualizamos el stock a
            // mano para que se vea el número nuevo mientras su historial se
            // refresca solo al remontar (useEffect por producto.id).
            if (desdeDetalle && stockNuevo != null) {
              setProductoDetalle((anterior) =>
                anterior
                  ? { ...anterior, producto: { ...anterior.producto, stock_actual: stockNuevo } }
                  : anterior,
              )
            }
            cargarProductos(vigenteRef.current, true)
            setVersionProveedores((n) => n + 1) // el ingreso pudo vincular otro proveedor al producto
          }}
        />
      )}

      {/* Si "Agregar stock", "Editar" o "Eliminar" se abren desde el modal
          de detalle, ese modal no se cierra (ver los handlers abajo) —
          solo se oculta mientras el otro modal está encima, y reaparece
          solo al cerrarlo. Así, al cancelar o guardar, se vuelve al
          historial de stock (ya actualizado si hubo cambios) en vez de
          volver a la lista de productos. */}
      {productoDetalle && !productoParaAgregarStock && !modalProducto && !productoAEliminar && (
        <ModalDetalleProducto
          producto={productoDetalle.producto}
          esAdmin={esAdmin}
          mostrarAcciones={productoDetalle.mostrarAcciones}
          onCerrar={() => setProductoDetalle(null)}
          onEditar={() => setModalProducto(productoDetalle.producto)}
          onEliminar={() => setProductoAEliminar(productoDetalle.producto)}
          onAgregarStock={() => {
            setProductoParaAgregarStock({ producto: productoDetalle.producto, desdeDetalle: true })
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
