import { useEffect, useState } from 'react'
import { Pencil, Trash2, Plus, X, Mic } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useTextoEscritura } from '../hooks/useTextoEscritura.js'
import { useReconocimientoVoz } from '../hooks/useReconocimientoVoz.js'
import IconoBuscar from '../components/IconoBuscar.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import ModalProducto from '../components/ModalProducto.jsx'
import ModalAgregarStock from '../components/ModalAgregarStock.jsx'
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

function ordenarProductos(productos, orden) {
  const ordenados = [...productos]
  switch (orden) {
    case 'nombre-desc':
      return ordenados.sort((a, b) => b.nombre.localeCompare(a.nombre))
    case 'precio-asc':
      return ordenados.sort((a, b) => a.precio - b.precio)
    case 'precio-desc':
      return ordenados.sort((a, b) => b.precio - a.precio)
    case 'stock-asc':
      return ordenados.sort((a, b) => a.stock_actual - b.stock_actual)
    case 'stock-desc':
      return ordenados.sort((a, b) => b.stock_actual - a.stock_actual)
    default:
      return ordenados.sort((a, b) => a.nombre.localeCompare(b.nombre))
  }
}

function formatearSoles(monto) {
  return `S/ ${monto.toFixed(2)}`
}

function formatearNumero(monto) {
  return monto.toFixed(2)
}

function claseColorStock(producto) {
  if (producto.stock_actual <= 0) return 'text-red'
  if (producto.stock_actual <= producto.stock_minimo) return 'text-orange-400'
  return 'text-green'
}

export default function Inventario() {
  const { rol } = useAuth()
  const { mostrarToast } = useToast()
  const esAdmin = rol === 'ADMINISTRADOR'

  const [productos, setProductos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState('nombre-asc')
  const [filtroStock, setFiltroStock] = useState('todos') // 'todos' | 'bajo' | 'sin_stock'
  const [modalProducto, setModalProducto] = useState(null) // null | 'nuevo' | producto
  const [productoAEliminar, setProductoAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)
  const [productoParaAgregarStock, setProductoParaAgregarStock] = useState(null)

  useCerrarConEscape(() => setProductoAEliminar(null), Boolean(productoAEliminar))

  async function cargarProductos() {
    setCargando(true)
    const { data, error: errorConsulta } = await supabase
      .from('productos_vista')
      .select(
        'id, codigo_barras, nombre, categoria, precio, costo, stock_actual, stock_minimo, proveedor, activo',
      )
      .order('nombre')

    if (errorConsulta) {
      setError('No se pudo cargar el inventario.')
    } else {
      setError(null)
      setProductos(data ?? [])
    }
    setCargando(false)
  }

  useEffect(() => {
    cargarProductos()
  }, [])

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

  const filtrados = productos.filter((producto) => {
    if (busqueda.trim()) {
      const termino = busqueda.trim().toLowerCase()
      const coincide =
        producto.nombre.toLowerCase().includes(termino) ||
        (producto.codigo_barras ?? '').toLowerCase().includes(termino)
      if (!coincide) return false
    }

    if (filtroStock === 'bajo') {
      return producto.stock_actual > 0 && producto.stock_actual <= producto.stock_minimo
    }
    if (filtroStock === 'sin_stock') {
      return producto.stock_actual <= 0
    }
    return true
  })

  const filtradosOrdenados = ordenarProductos(filtrados, orden)

  const totalProductos = productos.length
  const bajoStockCount = productos.filter(
    (p) => p.stock_actual > 0 && p.stock_actual <= p.stock_minimo,
  ).length
  const sinStockCount = productos.filter((p) => p.stock_actual <= 0).length
  const valorTotal = productos.reduce((acc, p) => acc + p.precio * p.stock_actual, 0)
  const ganancias = productos.reduce(
    (acc, p) => acc + (p.precio - (p.costo ?? 0)) * p.stock_actual,
    0,
  )
  const capitalInvertido = productos.reduce((acc, p) => acc + (p.costo ?? 0) * p.stock_actual, 0)

  const categoriasExistentes = [...new Set(productos.map((p) => p.categoria).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  )

  const placeholderBuscador = useTextoEscritura('Buscar producto...')
  const { soportado: vozSoportada, escuchando, alternar: alternarVoz, onErrorRef: onErrorVozRef } =
    useReconocimientoVoz((texto) => setBusqueda(texto))
  onErrorVozRef.current = (codigoError) => {
    if (codigoError === 'not-allowed' || codigoError === 'audio-capture') {
      mostrarToast('No se pudo acceder al micrófono.', 'error')
    }
  }

  return (
    <div className="p-3 pb-6">
      {/* Buscador + Nuevo producto: fijos arriba al hacer scroll, siempre debajo del header */}
      <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 bg-bg px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40">
            <IconoBuscar />
          </span>
          <input
            type="text"
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
            onKeyDown={(evento) => {
              if (evento.key === 'Escape') setBusqueda('')
            }}
            placeholder={placeholderBuscador}
            className="w-full rounded-lg border border-border bg-surface-2 py-2.5 pl-10 pr-9 font-mono text-sm text-ink outline-none placeholder:text-xs placeholder:text-ink/40 focus:border-amber"
          />
          {busqueda && (
            <button
              type="button"
              onClick={() => setBusqueda('')}
              aria-label="Limpiar búsqueda"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 transition-colors hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {vozSoportada && (
          <button
            type="button"
            onClick={alternarVoz}
            aria-label={escuchando ? 'Detener búsqueda por voz' : 'Buscar por voz'}
            className={`flex shrink-0 items-center justify-center rounded-lg border p-2.5 transition-colors ${
              escuchando
                ? 'animate-pulse border-red bg-red/10 text-red'
                : 'border-dashed border-border-strong text-ink/70 hover:border-amber hover:text-amber'
            }`}
          >
            <Mic className="h-4 w-4" />
          </button>
        )}

        <SelectorOrden opciones={OPCIONES_ORDEN} valor={orden} onCambiar={setOrden} tema="amber" />

        {esAdmin && (
          <button
            type="button"
            onClick={() => setModalProducto('nuevo')}
            className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-amber px-3 py-2.5 text-sm font-semibold text-bg md:flex"
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
          <p className="text-xs text-ink/50">Productos</p>
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
              <p className="text-[10px] text-ink/40">Total</p>
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
              <p className="text-[10px] text-ink/40">Bajo</p>
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
              <p className="text-[10px] text-ink/40">Sin stock</p>
            </button>
          </div>
        </div>

        {esAdmin && (
          <>
            <TarjetaResumen
              etiqueta="Capital invertido"
              valor={formatearSoles(capitalInvertido)}
              claseValor="text-ink/40"
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
        <p className="mt-6 text-center font-mono text-sm text-ink/40">Cargando inventario...</p>
      ) : filtrados.length === 0 ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/40">
          No se encontraron productos.
        </p>
      ) : (
        <>
          {/* Tarjetas: solo móvil */}
          <div className="mt-4 grid grid-cols-1 gap-3 md:hidden">
            {filtradosOrdenados.map((producto) => (
              <div
                key={producto.id}
                className="rounded-lg border border-border bg-surface p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{producto.nombre}</p>
                    <div className="mt-0.5 flex items-center gap-2 overflow-visible">
                      <p className="shrink-0 whitespace-nowrap font-mono text-xs text-ink/40">
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
                    <div className="flex items-center gap-1">
                      <BotonAccion
                        icono={Plus}
                        texto="Agregar stock"
                        color="morado"
                        onClick={() => setProductoParaAgregarStock(producto)}
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
                  </div>
                </div>

                {!producto.activo && (
                  <span className="mt-1 inline-block rounded border border-border-strong px-1.5 py-0.5 text-[10px] text-ink/50">
                    Inactivo
                  </span>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-sm text-ink/70">
                  {esAdmin && (
                    <span>Costo <span className="text-ink/40">{formatearNumero(producto.costo ?? 0)}</span></span>
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
          <div className="mt-4 hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border font-mono text-[11px] uppercase tracking-wider text-ink/40">
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
                {filtradosOrdenados.map((producto) => (
                  <tr key={producto.id} className="bg-surface">
                    <td className="px-3 py-2.5">
                      <p className="text-ink">
                        {producto.nombre}
                        {!producto.activo && (
                          <span className="ml-2 rounded border border-border-strong px-1.5 py-0.5 text-[10px] text-ink/50">
                            Inactivo
                          </span>
                        )}
                      </p>
                      <p className="font-mono text-xs text-ink/40">
                        {producto.codigo_barras || 'Sin código'}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-ink/60">{producto.categoria || '—'}</td>
                    {esAdmin && (
                      <td className="px-3 py-2.5 text-right font-mono text-ink/40">
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
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-2">
                        <BotonAccion
                          icono={Plus}
                          texto="Agregar stock"
                          color="morado"
                          onClick={() => setProductoParaAgregarStock(producto)}
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
          onGuardado={() => {
            const esNuevo = modalProducto === 'nuevo'
            setModalProducto(null)
            mostrarToast(esNuevo ? 'Producto creado.' : 'Producto actualizado.', 'exito')
            cargarProductos()
          }}
        />
      )}

      {productoParaAgregarStock && (
        <ModalAgregarStock
          producto={productoParaAgregarStock}
          onCerrar={() => setProductoParaAgregarStock(null)}
          onGuardado={() => {
            setProductoParaAgregarStock(null)
            mostrarToast('Stock actualizado.', 'exito')
            cargarProductos()
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
