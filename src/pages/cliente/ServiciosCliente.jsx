import { useEffect, useMemo, useRef, useState } from 'react'
import { Heart, MessageCircle, Scissors, Search, ShoppingBag, X } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { useToast } from '../../context/ToastContext.jsx'
import { useCarritoCliente } from '../../context/CarritoClienteContext.jsx'
import { formatearSoles } from '../../lib/moneda.js'
import { urlPublicaFoto } from '../../lib/imagenes.js'
import PieClienteWeb from './PieClienteWeb.jsx'

const BUCKET_FOTOS = 'fotos-servicios'
// Grados de inclinación 3D y escala en hover — mismos valores que la
// referencia (headerYServicios.html).
const TILT = 1
const SCALE = 1.07

// Catálogo de servicios activos + favoritos personales, con la tarjeta
// "iridiscente" replicada de headerYServicios.html (ver implementacionesWed.md,
// sección 2.7, y los estilos .iri-* en index.css). servicios_select ya deja
// ver los activos a cualquier autenticado (68_servicios_favoritos.sql) —
// acá solo se lee, nunca se escribe la tabla "servicios" (eso sigue siendo
// del personal, ver ModalServicio.jsx). favoritos_servicios sí es propia:
// insert/delete de la fila (cliente_web_id, servicio_id), nunca un update.
export default function ServiciosCliente() {
  const { usuario } = useAuth()
  const { mostrarToast } = useToast()
  const { serviciosCarrito, agregarServicio, quitarServicio } = useCarritoCliente()

  const [servicios, setServicios] = useState([])
  const [favoritos, setFavoritos] = useState(() => new Set())
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [categoriaActiva, setCategoriaActiva] = useState('todos')
  const gridRef = useRef(null)

  useEffect(() => {
    let vigente = true

    async function cargar() {
      const [serviciosRes, favoritosRes] = await Promise.all([
        supabase
          .from('servicios')
          .select('id, nombre, categoria, precio, duracion_min, foto_url')
          .eq('activo', true)
          .order('nombre'),
        supabase.from('favoritos_servicios').select('servicio_id'),
      ])

      if (!vigente) return
      setServicios(serviciosRes.data ?? [])
      setFavoritos(new Set((favoritosRes.data ?? []).map((fila) => fila.servicio_id)))
      setCargando(false)
    }

    cargar()
    return () => {
      vigente = false
    }
  }, [])

  // Inclinación 3D + brillo iridiscente siguiendo al cursor: se manipula
  // el DOM directo (mismo truco que la referencia) en vez de guardar
  // --mx/--my en React state, que re-renderizaría toda la grilla en cada
  // pixel que se mueve el mouse.
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

  async function alternarFavorito(servicioId) {
    const esFavorito = favoritos.has(servicioId)

    const { error } = esFavorito
      ? await supabase
          .from('favoritos_servicios')
          .delete()
          .eq('cliente_web_id', usuario.id)
          .eq('servicio_id', servicioId)
      : await supabase
          .from('favoritos_servicios')
          .insert({ cliente_web_id: usuario.id, servicio_id: servicioId })

    if (error) {
      mostrarToast('No se pudo actualizar tus favoritos.', 'error')
      return
    }

    setFavoritos((anterior) => {
      const siguiente = new Set(anterior)
      if (esFavorito) siguiente.delete(servicioId)
      else siguiente.add(servicioId)
      return siguiente
    })
  }

  async function alternarCarrito(servicioId) {
    const enCarrito = serviciosCarrito.has(servicioId)
    const exito = enCarrito ? await quitarServicio(servicioId) : await agregarServicio(servicioId)
    if (!exito) mostrarToast('No se pudo actualizar tu carrito.', 'error')
  }

  function compartir(servicio) {
    const texto =
      `✨ Mira este servicio:\n\n💅 *${servicio.nombre}*\n` +
      `💰 Desde ${formatearSoles(servicio.precio)}` +
      (servicio.duracion_min ? ` · ⏱ ${servicio.duracion_min} min` : '') +
      `\n\n¡Reserva tu cita!`
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener,noreferrer')
  }

  const categorias = useMemo(
    () => ['todos', ...new Set(servicios.map((s) => s.categoria).filter(Boolean))],
    [servicios],
  )

  const filtrados = useMemo(() => {
    const termino = busqueda.trim().toLowerCase()
    return servicios.filter(
      (s) =>
        (categoriaActiva === 'todos' || s.categoria === categoriaActiva) &&
        (!termino || s.nombre.toLowerCase().includes(termino)),
    )
  }, [servicios, busqueda, categoriaActiva])

  if (cargando) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-mono text-sm text-white/50">Cargando...</p>
      </div>
    )
  }

  return (
    <div className="catalogo-iridiscente animate-entrada-pestana flex-1 overflow-y-auto p-4 md:p-8">
      {/* Buscador (headerYServicios.html: .buscador) */}
      <div className="liquid-glass flex items-center gap-2.5 rounded-2xl px-3.5 transition-colors focus-within:border-[var(--lw-gold)]">
        <Search className="h-4 w-4 shrink-0 text-white/50" />
        <input
          type="text"
          value={busqueda}
          onChange={(evento) => setBusqueda(evento.target.value)}
          placeholder="Buscar servicio…"
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

      {/* Categorías (headerYServicios.html: .cats/.cat) */}
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

      {/* Grilla de tarjetas (headerYServicios.html: .grid/.iri-*) */}
      {filtrados.length === 0 ? (
        <p className="mt-10 text-center text-sm text-white/50">Sin resultados.</p>
      ) : (
        <div
          ref={gridRef}
          className="mt-5 grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 sm:gap-x-4"
        >
          {filtrados.map((servicio) => {
            const esFavorito = favoritos.has(servicio.id)
            const enCarrito = serviciosCarrito.has(servicio.id)
            const urlFoto = urlPublicaFoto(BUCKET_FOTOS, servicio.foto_url)

            return (
              <div key={servicio.id} className="iri-wrap">
                <div className="iri-card" role="group" aria-label={servicio.nombre}>
                  <div className="iri-img">
                    {urlFoto ? (
                      <>
                        <img src={urlFoto} alt="" className="iri-img-real" loading="lazy" />
                        <div className="iri-img-grad" />
                      </>
                    ) : (
                      <div className="iri-img-vacia">
                        <Scissors className="h-8 w-8" />
                      </div>
                    )}
                  </div>
                  <div className="iri-iridescent" />
                  <div className="iri-specular" />
                  <div className="iri-border" />
                  <div className="iri-glow" />

                  <button
                    type="button"
                    onClick={() => alternarFavorito(servicio.id)}
                    aria-label={esFavorito ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                    aria-pressed={esFavorito}
                    className={`iri-heart${esFavorito ? ' on' : ''}`}
                  >
                    <Heart className="h-[18px] w-[18px]" strokeWidth={2} />
                  </button>

                  <button
                    type="button"
                    onClick={() => compartir(servicio)}
                    aria-label="Compartir por WhatsApp"
                    className="iri-share"
                  >
                    <MessageCircle className="h-4 w-4" />
                  </button>

                  <div className="iri-price">
                    <span className="iri-price-from">desde</span>
                    <span className="iri-price-num">{formatearSoles(servicio.precio)}</span>
                  </div>
                </div>

                <div className="iri-name">{servicio.nombre}</div>
                {servicio.duracion_min && <div className="iri-meta">{servicio.duracion_min} min</div>}

                <button
                  type="button"
                  onClick={() => alternarCarrito(servicio.id)}
                  className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-full border px-2 py-1.5 text-xs font-medium transition-colors ${
                    enCarrito
                      ? 'border-[var(--lw-gold)] bg-[var(--lw-gold)]/10 text-[var(--lw-gold)]'
                      : 'border-white/15 text-white/70 hover:border-white/30 hover:text-white'
                  }`}
                >
                  <ShoppingBag className="h-3.5 w-3.5 shrink-0" />
                  {enCarrito ? 'En tu carrito' : 'Agregar'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      <PieClienteWeb />
    </div>
  )
}
