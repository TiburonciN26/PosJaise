import { useEffect, useMemo, useRef, useState } from 'react'
import { Heart, MessageCircle, Minus, Package, Plus, Search, ShoppingBag, X } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { useToast } from '../../context/ToastContext.jsx'
import { useCarritoCliente } from '../../context/CarritoClienteContext.jsx'
import { formatearSoles } from '../../lib/moneda.js'
import { urlPublicaFoto } from '../../lib/imagenes.js'
import PieClienteWeb from './PieClienteWeb.jsx'

const BUCKET_FOTOS = 'fotos-productos'
// Mismos grados que ServiciosCliente.jsx — misma tarjeta iridiscente,
// mismo "tacto" en toda la Web.
const TILT = 1
const SCALE = 1.07

// Catálogo de productos activos + favoritos personales — mismo patrón
// que ServiciosCliente.jsx (ver implementacionesWed.md §7), tarjeta
// "iridiscente" compartida (.iri-* en index.css). productos_select ya
// deja ver los activos a cualquier autenticado (84_productos_favoritos.sql)
// — acá solo se lee, nunca se escribe "productos" (eso sigue siendo del
// personal, ver ModalProducto.jsx/Inventario.jsx). favoritos_productos sí
// es propia: insert/delete de (cliente_web_id, producto_id).
//
// Diferencia con servicios: productos tiene stock. Decisión confirmada
// con el usuario: un producto sin stock sigue apareciendo (no se
// filtra), solo se marca con la etiqueta "Agotado" (.iri-agotado).
export default function ProductosCliente() {
  const { usuario } = useAuth()
  const { mostrarToast } = useToast()
  const { productosCarrito, agregarProducto, cambiarCantidadProducto } = useCarritoCliente()

  const [productos, setProductos] = useState([])
  const [favoritos, setFavoritos] = useState(() => new Set())
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [categoriaActiva, setCategoriaActiva] = useState('todos')
  const gridRef = useRef(null)

  useEffect(() => {
    let vigente = true

    async function cargar() {
      const [productosRes, favoritosRes] = await Promise.all([
        supabase
          .from('productos')
          .select('id, nombre, categoria, precio, stock_actual, foto_url')
          .eq('activo', true)
          .order('nombre'),
        supabase.from('favoritos_productos').select('producto_id'),
      ])

      if (!vigente) return
      setProductos(productosRes.data ?? [])
      setFavoritos(new Set((favoritosRes.data ?? []).map((fila) => fila.producto_id)))
      setCargando(false)
    }

    cargar()
    return () => {
      vigente = false
    }
  }, [])

  // Mismo truco que ServiciosCliente.jsx: --mx/--my/--iri-shift directo
  // por JS en el propio elemento, sin pasar por React state.
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return undefined

    function alMover(evento) {
      const card = evento.target.closest('.iri-card')
      if (!card) return
      const rect = card.getBoundingClientRect()
      const x = ((evento.clientX - rect.left) / rect.width) * 100
      const y = ((evento.clientY - rect.top) / rect.height) * 100
      card.classList.add('is-hover')
      card.style.setProperty('--mx', `${x}%`)
      card.style.setProperty('--my', `${y}%`)
      card.style.setProperty('--iri-shift', `${(x + y) * 0.15}`)
      const rx = ((50 - y) / 50) * TILT
      const ry = ((x - 50) / 50) * TILT
      card.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) scale(${SCALE})`
    }

    function alSalir(evento) {
      const card = evento.target.closest('.iri-card')
      if (!card || card.contains(evento.relatedTarget)) return
      card.classList.remove('is-hover')
      card.style.setProperty('--mx', '50%')
      card.style.setProperty('--my', '50%')
      card.style.transform = 'perspective(900px) rotateX(0) rotateY(0) scale(1)'
    }

    grid.addEventListener('mousemove', alMover)
    grid.addEventListener('mouseout', alSalir)
    return () => {
      grid.removeEventListener('mousemove', alMover)
      grid.removeEventListener('mouseout', alSalir)
    }
  }, [])

  async function alternarFavorito(productoId) {
    const esFavorito = favoritos.has(productoId)

    const { error } = esFavorito
      ? await supabase
          .from('favoritos_productos')
          .delete()
          .eq('cliente_web_id', usuario.id)
          .eq('producto_id', productoId)
      : await supabase
          .from('favoritos_productos')
          .insert({ cliente_web_id: usuario.id, producto_id: productoId })

    if (error) {
      mostrarToast('No se pudo actualizar tus favoritos.', 'error')
      return
    }

    setFavoritos((anterior) => {
      const siguiente = new Set(anterior)
      if (esFavorito) siguiente.delete(productoId)
      else siguiente.add(productoId)
      return siguiente
    })
  }

  async function alAgregar(productoId) {
    const exito = await agregarProducto(productoId)
    if (!exito) mostrarToast('No se pudo actualizar tu carrito.', 'error')
  }

  async function alCambiarCantidad(productoId, cantidad) {
    const exito = await cambiarCantidadProducto(productoId, cantidad)
    if (!exito) mostrarToast('No se pudo actualizar tu carrito.', 'error')
  }

  function compartir(producto) {
    const texto =
      `✨ Mira este producto:\n\n🛍 *${producto.nombre}*\n` +
      `💰 ${formatearSoles(producto.precio)}` +
      `\n\n¡Pregunta por él en tu próxima visita!`
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener,noreferrer')
  }

  const categorias = useMemo(
    () => ['todos', ...new Set(productos.map((p) => p.categoria).filter(Boolean))],
    [productos],
  )

  const filtrados = useMemo(() => {
    const termino = busqueda.trim().toLowerCase()
    return productos.filter(
      (p) =>
        (categoriaActiva === 'todos' || p.categoria === categoriaActiva) &&
        (!termino || p.nombre.toLowerCase().includes(termino)),
    )
  }, [productos, busqueda, categoriaActiva])

  if (cargando) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-mono text-sm text-white/50">Cargando...</p>
      </div>
    )
  }

  return (
    <div className="catalogo-iridiscente animate-entrada-pestana flex-1 overflow-y-auto p-4 md:p-8">
      <div className="liquid-glass flex items-center gap-2.5 rounded-2xl px-3.5 transition-colors focus-within:border-[var(--lw-gold)]">
        <Search className="h-4 w-4 shrink-0 text-white/50" />
        <input
          type="text"
          value={busqueda}
          onChange={(evento) => setBusqueda(evento.target.value)}
          placeholder="Buscar producto…"
          className="w-full bg-transparent py-3 text-sm text-white outline-none placeholder:text-white/40"
        />
        {busqueda && (
          <button
            type="button"
            onClick={() => setBusqueda('')}
            aria-label="Limpiar"
            className="shrink-0 text-lg leading-none text-white/50 transition-colors hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {categorias.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {categorias.map((categoria) => {
            const activa = categoriaActiva === categoria
            return (
              <button
                key={categoria}
                type="button"
                onClick={() => setCategoriaActiva(categoria)}
                className={`shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium capitalize transition-colors ${
                  activa
                    ? 'border-[var(--lw-gold)] bg-[var(--lw-gold)] text-black'
                    : 'border-white/15 text-white/70 hover:border-white/30 hover:text-white'
                }`}
              >
                {categoria}
              </button>
            )
          })}
        </div>
      )}

      {filtrados.length === 0 ? (
        <p className="mt-10 text-center text-sm text-white/50">Sin resultados.</p>
      ) : (
        <div
          ref={gridRef}
          className="mt-5 grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 sm:gap-x-4"
        >
          {filtrados.map((producto) => {
            const esFavorito = favoritos.has(producto.id)
            const agotado = producto.stock_actual <= 0
            const cantidadEnCarrito = productosCarrito.get(producto.id) ?? 0
            const urlFoto = urlPublicaFoto(BUCKET_FOTOS, producto.foto_url)

            return (
              <div key={producto.id} className="iri-wrap">
                <div className="iri-card" role="group" aria-label={producto.nombre}>
                  <div className="iri-img">
                    {urlFoto ? (
                      <>
                        <img src={urlFoto} alt="" className="iri-img-real" loading="lazy" />
                        <div className="iri-img-grad" />
                      </>
                    ) : (
                      <div className="iri-img-vacia">
                        <Package className="h-8 w-8" />
                      </div>
                    )}
                  </div>
                  <div className="iri-iridescent" />
                  <div className="iri-specular" />
                  <div className="iri-border" />
                  <div className="iri-glow" />

                  <button
                    type="button"
                    onClick={() => alternarFavorito(producto.id)}
                    aria-label={esFavorito ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                    aria-pressed={esFavorito}
                    className={`iri-heart${esFavorito ? ' on' : ''}`}
                  >
                    <Heart className="h-[18px] w-[18px]" strokeWidth={2} />
                  </button>

                  <button
                    type="button"
                    onClick={() => compartir(producto)}
                    aria-label="Compartir por WhatsApp"
                    className="iri-share"
                  >
                    <MessageCircle className="h-4 w-4" />
                  </button>

                  {agotado && <span className="iri-agotado">Agotado</span>}
                  <div className="iri-price">
                    <span className="iri-price-num">{formatearSoles(producto.precio)}</span>
                  </div>
                </div>

                <div className="iri-name">{producto.nombre}</div>

                {cantidadEnCarrito > 0 ? (
                  <div className="mt-2 flex w-full items-center justify-between rounded-full border border-[var(--lw-gold)] bg-[var(--lw-gold)]/10 px-1.5 py-1">
                    <button
                      type="button"
                      onClick={() => alCambiarCantidad(producto.id, cantidadEnCarrito - 1)}
                      aria-label="Quitar uno"
                      className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--lw-gold)]"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="text-xs font-semibold text-[var(--lw-gold)]">
                      {cantidadEnCarrito}
                    </span>
                    <button
                      type="button"
                      onClick={() => alCambiarCantidad(producto.id, cantidadEnCarrito + 1)}
                      aria-label="Agregar uno"
                      className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--lw-gold)]"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => alAgregar(producto.id)}
                    className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-full border border-white/15 px-2 py-1.5 text-xs font-medium text-white/70 transition-colors hover:border-white/30 hover:text-white"
                  >
                    <ShoppingBag className="h-3.5 w-3.5 shrink-0" />
                    Agregar
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <PieClienteWeb />
    </div>
  )
}
