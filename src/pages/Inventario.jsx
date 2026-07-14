import { useEffect, useRef, useState } from 'react'
import { Pencil, Trash2, Plus } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useDebounce } from '../hooks/useDebounce.js'
import { formatearSoles } from '../lib/moneda.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import ModalProducto from '../components/ModalProducto.jsx'
import ModalAgregarStock from '../components/ModalAgregarStock.jsx'
import ModalDetalleProducto from '../components/ModalDetalleProducto.jsx'
import TarjetaResumen from '../components/TarjetaResumen.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'

const OPCIONES_ORDEN = [
  { id: 'nombre-asc', label: 'Nombre (A-Z)' },
  { id: 'nombre-desc', label: 'Nombre (Z-A)' },
  { id: 'precio-asc', label: 'Precio (menor a mayor)' },
  { id: 'precio-desc', label: 'Precio (mayor a menor)' },
  { id: 'stock-asc', label: 'Stock (menor a mayor)' },
  { id: 'stock-desc', label: 'Stock (mayor a menor)' },
]

const ORDEN_A_COLUMNA = {
  'nombre-asc': { columna: 'nombre', ascending: true },
  'nombre-desc': { columna: 'nombre', ascending: false },
  'precio-asc': { columna: 'precio', ascending: true },
  'precio-desc': { columna: 'precio', ascending: false },
  'stock-asc': { columna: 'stock_actual', ascending: true },
  'stock-desc': { columna: 'stock_actual', ascending: false },
}

const TAMANO_PAGINA = 50

const SELECT_PRODUCTOS =
  'id, codigo_barras, nombre, categoria, precio, costo, stock_actual, stock_minimo, proveedor, foto_url, activo'

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

  const { columna, ascending } = ORDEN_A_COLUMNA[orden] ?? ORDEN_A_COLUMNA['nombre-asc']
  return consulta.order(columna, { ascending })
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

  const [productos, setProductos] = useState([])
  const [resumen, setResumen] = useState(RESUMEN_VACIO)
  const [hayMas, setHayMas] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const busquedaDebounced = useDebounce(busqueda, 300)
  const [orden, setOrden] = useState('nombre-asc')
  const [filtroStock, setFiltroStock] = useState('todos') // 'todos' | 'bajo' | 'sin_stock'
  const [modalProducto, setModalProducto] = useState(null) // null | 'nuevo' | producto
  const [productoAEliminar, setProductoAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)
  const [productoParaAgregarStock, setProductoParaAgregarStock] = useState(null)
  const [productoDetalle, setProductoDetalle] = useState(null) // { producto, mostrarAcciones } | null
  const primeraCargaHecha = useRef(false)
  // M1 de la 4ª auditoría: mismo guard que la carga inicial, para que
  // cargarMasProductos descarte una respuesta que llega tarde de un
  // filtro/búsqueda que ya no está activo (ver Historial.jsx).
  const vigenteRef = useRef({ actual: true })

  useCerrarConEscape(() => setProductoAEliminar(null), Boolean(productoAEliminar))

  async function cargarProductos(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)
    const filtros = { busqueda: busquedaDebounced, orden, filtroStock }

    const [productosRes, resumenRes] = await Promise.all([
      construirConsultaProductos(filtros).range(0, TAMANO_PAGINA - 1),
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
    setHayMas((productosRes.data ?? []).length === TAMANO_PAGINA)

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

    if (data === 'ELIMINADO') {
      mostrarToast('Producto eliminado.', 'exito')
    } else {
      mostrarToast('Ese producto ya tiene ventas registradas — se desactivó en vez de eliminarse.', 'info')
    }
    cargarProductos()
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
    <div className="p-3 pb-6">
      {/* Buscador + Nuevo producto: fijos arriba al hacer scroll, siempre debajo del header */}
      <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 bg-bg px-3 py-2">
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder="Buscar producto..."
          tema="amber"
        />

        <SelectorOrden opciones={OPCIONES_ORDEN} valor={orden} onCambiar={setOrden} tema="amber" />

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
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div
          className={`rounded-lg border border-border bg-surface px-3 py-2 ${!esAdmin ? 'col-span-2 md:col-span-4' : ''}`}
        >
          <p className="text-xs text-ink/60">Productos</p>
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
              <p className="text-[10px] text-ink/60">Total</p>
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
              <p className="text-[10px] text-ink/60">Bajo</p>
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
              <p className="text-[10px] text-ink/60">Sin stock</p>
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
              claseValor="text-amber"
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
        <p className="mt-6 text-center font-mono text-sm text-ink/60">Cargando inventario...</p>
      ) : productos.length === 0 ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/60">
          No se encontraron productos.
        </p>
      ) : (
        <>
          {/* Tarjetas: solo móvil. Tocar la tarjeta abre el detalle (foto +
              historial de stock si es admin), donde ahora viven Editar/
              Eliminar. "Agregar stock" en cambio queda inline acá (lo usan
              seguido ambos roles) Y también dentro del modal. */}
          <div className="mt-4 grid grid-cols-1 gap-3 lg:hidden">
            {productos.map((producto) => (
              <div
                key={producto.id}
                onClick={() => setProductoDetalle({ producto, mostrarAcciones: true })}
                className="w-full touch-manipulation rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-amber/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{producto.nombre}</p>
                    <div className="mt-0.5 flex items-center gap-2 overflow-visible">
                      <p className="shrink-0 whitespace-nowrap font-mono text-xs text-ink/60">
                        {producto.codigo_barras || 'Sin código'}
                      </p>
                      {producto.categoria && (
                        <span className="shrink-0 whitespace-nowrap rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-ink/60">
                          {producto.categoria}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-xs text-ink/70">
                      Stock:{' '}
                      <span className={claseColorStock(producto)}>{producto.stock_actual}</span>
                    </span>
                    <div onClick={(evento) => evento.stopPropagation()}>
                      <BotonAccion
                        icono={Plus}
                        texto="Agregar stock"
                        color="morado"
                        onClick={() => setProductoParaAgregarStock({ producto, desdeDetalle: false })}
                      />
                    </div>
                  </div>
                </div>

                {!producto.activo && (
                  <span className="mt-1 inline-block rounded border border-border-strong px-1.5 py-0.5 text-[10px] text-ink/60">
                    Inactivo
                  </span>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-sm text-ink/70">
                  {esAdmin && (
                    <span>Costo <span className="text-ink/60">{formatearNumero(producto.costo ?? 0)}</span></span>
                  )}
                  <span>Venta <span className="text-amber">{formatearNumero(producto.precio)}</span></span>
                  {esAdmin && (
                    <span>Gananc. <span className="text-green">{formatearNumero(producto.precio - (producto.costo ?? 0))}</span></span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Tabla: tablet y desktop */}
          <div className="mt-4 hidden overflow-x-auto rounded-lg border border-border lg:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border font-mono text-[11px] uppercase tracking-wider text-ink/60">
                  <th className="px-3 py-2 font-normal">Producto</th>
                  <th className="px-3 py-2 font-normal">Categoría</th>
                  {esAdmin && <th className="px-3 py-2 text-right font-normal">Costo</th>}
                  <th className="px-3 py-2 text-right font-normal">Precio</th>
                  {esAdmin && <th className="px-3 py-2 text-right font-normal">Ganancia</th>}
                  <th className="px-3 py-2 text-right font-normal">Stock</th>
                  <th className="px-3 py-2 text-right font-normal">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {productos.map((producto) => (
                  <tr
                    key={producto.id}
                    onClick={() => setProductoDetalle({ producto, mostrarAcciones: false })}
                    className="cursor-pointer touch-manipulation bg-surface hover:bg-surface-2/60"
                  >
                    <td className="px-3 py-2.5">
                      <p className="text-ink">
                        {producto.nombre}
                        {!producto.activo && (
                          <span className="ml-2 rounded border border-border-strong px-1.5 py-0.5 text-[10px] text-ink/60">
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
                    <td className="px-3 py-2.5 text-right font-mono text-amber">
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
                          icono={Plus}
                          texto="Agregar stock"
                          color="morado"
                          onClick={() => setProductoParaAgregarStock({ producto, desdeDetalle: false })}
                        />
                        {esAdmin && (
                          <>
                            <BotonAccion
                              icono={Pencil}
                              texto="Editar"
                              color="celeste"
                              onClick={() => setModalProducto(producto)}
                            />
                            <BotonAccion
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
            cargarProductos()
          }}
        />
      )}

      {productoParaAgregarStock && (
        <ModalAgregarStock
          producto={productoParaAgregarStock.producto}
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
            cargarProductos()
          }}
        />
      )}

      {/* Si "Agregar stock" o "Editar" se abren desde el modal de detalle,
          ese modal no se cierra (ver onAgregarStock/onEditar abajo) — solo
          se oculta mientras el otro modal está encima, y reaparece solo al
          cerrarlo. Así, al cancelar o guardar, se vuelve al historial de
          stock (ya actualizado si hubo cambios) en vez de volver a la
          lista de productos. */}
      {productoDetalle && !productoParaAgregarStock && !modalProducto && (
        <ModalDetalleProducto
          producto={productoDetalle.producto}
          esAdmin={esAdmin}
          mostrarAcciones={productoDetalle.mostrarAcciones}
          onCerrar={() => setProductoDetalle(null)}
          onEditar={() => setModalProducto(productoDetalle.producto)}
          onEliminar={() => {
            setProductoAEliminar(productoDetalle.producto)
            setProductoDetalle(null)
          }}
          onAgregarStock={() => {
            setProductoParaAgregarStock({ producto: productoDetalle.producto, desdeDetalle: true })
          }}
        />
      )}

      {productoAEliminar && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
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
