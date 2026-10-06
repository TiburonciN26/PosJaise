import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  Award,
  Check,
  CreditCard,
  Droplet,
  Heart,
  MessageCircle,
  Minus,
  Package,
  PenLine,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Truck,
  X,
} from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { useToast } from '../../context/ToastContext.jsx'
import { useCarritoCliente } from '../../context/CarritoClienteContext.jsx'
import { formatearSoles } from '../../lib/moneda.js'
import { obtenerCostoDeliveryDesde } from '../../lib/zonasDelivery.js'
import { urlPublicaFoto } from '../../lib/imagenes.js'
import { numeroWhatsapp } from '../../lib/contactoNegocio.js'
import { degradadoServicio } from '../../lib/serviciosVisual.js'
import TarjetaProductoCliente from '../../components/TarjetaProductoCliente.jsx'
import BarraTuCarritoFlotante from '../../components/BarraTuCarritoFlotante.jsx'
import PieClienteWeb from './PieClienteWeb.jsx'
import { useProgramaRecompensas } from '../../hooks/useProgramaRecompensas.js'
import { resumenEstimado } from '../../lib/programaRecompensas.js'

const BUCKET_FOTOS = 'fotos-productos'
// Mismo criterio que DetalleServicioCliente.jsx: con el programa ACTIVO, estimado en monedas con las reglas vigentes; con el programa
// APAGADO los productos no dan puntos (mis_puntos() solo cuenta servicios), así que no se promete una cifra.

function formatearFechaCorta(fechaIso) {
  if (!fechaIso) return null
  return new Date(`${fechaIso}T00:00:00`).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' })
}

// Detalle del producto (docs/diseno-productos/README.md) — mismo patrón
// que DetalleServicioCliente.jsx, con datos de producto. Las migraciones
// 117-124 (contenido editorial, galería, reseñas, combo) ya están
// aplicadas, así que las secciones que antes quedaban ocultas con
// // TODO backend ahora se muestran con datos reales cuando el admin
// las cargó desde ModalProducto.jsx, y se ocultan solas si están vacías
// (nunca con un placeholder inventado).
export default function DetalleProductoCliente() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { usuario } = useAuth()
  const { mostrarToast } = useToast()
  const { productosCarrito, agregarProducto } = useCarritoCliente()

  const [producto, setProducto] = useState(null)
  const [galeria, setGaleria] = useState([])
  const [combo, setCombo] = useState(null)
  const [relacionados, setRelacionados] = useState([])
  const [favorito, setFavorito] = useState(false)
  const [contacto, setContacto] = useState(null)
  const [costoEnvioDesde, setCostoEnvioDesde] = useState(null)
  const programa = useProgramaRecompensas(null)
  const [cargando, setCargando] = useState(true)
  const [noEncontrado, setNoEncontrado] = useState(false)
  const [fotoIdx, setFotoIdx] = useState(0)
  const [fotoTick, setFotoTick] = useState(0)

  const [cantidad, setCantidad] = useState(1)
  const [agregando, setAgregando] = useState(false)
  const [agregadoOk, setAgregadoOk] = useState(false)

  // Reseñas por producto (resenas_producto, migración 123) — propias, no
  // las de resenas.jsx (general del salón).
  const [resumenResenas, setResumenResenas] = useState(null)
  const [resenasPublicas, setResenasPublicas] = useState([])
  const [miResena, setMiResena] = useState(null)
  const [mostrarFormResena, setMostrarFormResena] = useState(false)
  const [enviandoResena, setEnviandoResena] = useState(false)
  const [calificacionForm, setCalificacionForm] = useState(0)
  const [comentarioForm, setComentarioForm] = useState('')

  useEffect(() => {
    obtenerCostoDeliveryDesde().then(setCostoEnvioDesde)
  }, [])

  useEffect(() => {
    let vigente = true
    setCargando(true)
    setNoEncontrado(false)
    setFotoIdx(0)

    async function cargar() {
      const [productoRes, galeriaRes, favoritoRes, contactoRes, resumenRes, publicasRes, miResenaRes] =
        await Promise.all([
          supabase
            .from('productos')
            .select(
              'id, nombre, categoria, subcategoria, precio, precio_antes, oferta_hasta, stock_actual, foto_url, ' +
                'descripcion, contenido, rinde, frecuencia, especificaciones, modo_uso, ideal_para, tips, ingredientes, ' +
                'libre_de, combo_con',
            )
            .eq('id', id)
            .eq('activo', true)
            .maybeSingle(),
          supabase.from('producto_fotos').select('id, foto_url, etiqueta').eq('producto_id', id).order('orden'),
          supabase.from('favoritos_productos').select('producto_id').eq('producto_id', id).maybeSingle(),
          supabase.rpc('datos_contacto'),
          supabase.rpc('resenas_producto_resumen', { p_producto_id: id }),
          supabase.rpc('resenas_producto_publicas', { p_producto_id: id }),
          supabase.rpc('mi_resena_producto', { p_producto_id: id }),
        ])

      if (!vigente) return

      if (!productoRes.data) {
        setNoEncontrado(true)
        setCargando(false)
        return
      }

      setProducto(productoRes.data)
      setGaleria(galeriaRes.data ?? [])
      setResumenResenas(resumenRes.data?.[0] ?? null)
      setResenasPublicas((publicasRes.data ?? []).slice(0, 3))
      const propia = Array.isArray(miResenaRes.data) ? miResenaRes.data[0] : miResenaRes.data
      // QA-008: sin reseña propia la RPC devuelve una fila con todo nulo (truthy);
      // solo cuenta como reseña si trae id.
      setMiResena(propia?.id ? propia : null)
      setCalificacionForm(propia?.id ? (propia.calificacion ?? 0) : 0)
      setComentarioForm(propia?.id ? (propia.comentario ?? '') : '')
      setFavorito(Boolean(favoritoRes.data))
      setContacto(contactoRes.data?.[0] ?? null)

      const { data: rel } = await supabase
        .from('productos')
        .select('id, nombre, categoria, subcategoria, precio, precio_antes, stock_actual, foto_url')
        .eq('activo', true)
        .eq('categoria', productoRes.data.categoria)
        .neq('id', id)
        .order('nombre')
        .limit(4)

      if (vigente) setRelacionados(rel ?? [])

      // Combo sugerido (migración 122): el override manual del admin
      // (combo_con) gana; si no lo puso, se calcula el producto que más
      // veces se compró junto a este (productos_combo_sugerido()).
      let comboId = productoRes.data.combo_con
      if (!comboId) {
        const { data: sugerido } = await supabase.rpc('productos_combo_sugerido', { p_producto_id: id })
        comboId = sugerido?.[0]?.producto_id ?? null
      }
      if (comboId) {
        const { data: comboData } = await supabase
          .from('productos')
          .select('id, nombre, precio, precio_antes, stock_actual, foto_url')
          .eq('id', comboId)
          .eq('activo', true)
          .maybeSingle()
        if (vigente) setCombo(comboData ?? null)
      } else if (vigente) {
        setCombo(null)
      }

      setCargando(false)
    }

    cargar()
    return () => {
      vigente = false
    }
  }, [id])

  // Galería (producto_fotos, migración 119): si el producto todavía no
  // tiene ninguna foto propia ahí, cae a la única foto de
  // productos.foto_url — igual que DetalleServicioCliente.jsx.
  const fotos = useMemo(() => {
    if (galeria.length > 0) return galeria
    if (producto?.foto_url) return [{ id: 'principal', foto_url: producto.foto_url, etiqueta: 'Frente' }]
    return []
  }, [galeria, producto])
  const fotoIdxSeguro = fotos.length ? fotoIdx % fotos.length : 0
  const fotoActual = fotos[fotoIdxSeguro]

  useEffect(() => {
    if (fotos.length < 2) return undefined
    const idTimer = setInterval(() => setFotoIdx((indice) => (indice + 1) % fotos.length), 5000)
    return () => clearInterval(idTimer)
  }, [fotos.length, fotoTick])

  function irAFoto(indice) {
    setFotoIdx(indice)
    setFotoTick((valor) => valor + 1)
  }

  const cantidadEnCarrito = producto ? productosCarrito.get(producto.id) ?? 0 : 0
  const agotado = producto ? producto.stock_actual <= 0 : false
  const disponibleParaAgregar = producto ? Math.max(0, producto.stock_actual - cantidadEnCarrito) : 0
  const sinMasParaAgregar = !agotado && disponibleParaAgregar <= 0

  useEffect(() => {
    setCantidad((anterior) => Math.min(anterior, Math.max(1, disponibleParaAgregar)))
  }, [disponibleParaAgregar])

  const descuento = producto?.precio_antes
    ? Math.round((1 - Number(producto.precio) / Number(producto.precio_antes)) * 100)
    : null
  const ahorro = producto?.precio_antes ? Number(producto.precio_antes) - Number(producto.precio) : null
  const whatsapp = contacto?.telefono ? numeroWhatsapp(contacto.telefono) : null
  const estimado = producto ? resumenEstimado({ programa, tipo: 'PRODUCTO', precio: Number(producto.precio) }) : null

  async function confirmarAgregar() {
    if (!producto || agotado || sinMasParaAgregar) return
    setAgregando(true)
    const agregado = await agregarProducto(producto.id, cantidad)
    setAgregando(false)

    if (agregado <= 0) {
      mostrarToast('No se pudo agregar — ya no hay stock disponible.', 'error')
      return
    }
    setCantidad(1)
    setAgregadoOk(true)
    setTimeout(() => setAgregadoOk(false), 2000)
    mostrarToast(
      agregado < cantidad
        ? `Solo se agregaron ${agregado} — es lo que quedaba disponible.`
        : agregado > 1
          ? `${agregado} agregados al carrito.`
          : 'Agregado al carrito.',
      'exito',
    )
  }

  async function comprarAhora() {
    if (!producto) return
    if (!agotado && !sinMasParaAgregar) {
      const agregado = await agregarProducto(producto.id, cantidad)
      if (agregado <= 0) {
        mostrarToast('No se pudo agregar — ya no hay stock disponible.', 'error')
        return
      }
      setCantidad(1)
    }
    navigate('/carrito')
  }

  async function agregarCombo() {
    const idsAAgregar = [producto.id, combo.id].filter((idProducto) => (productosCarrito.get(idProducto) ?? 0) <= 0)
    const resultados = await Promise.all(idsAAgregar.map((idProducto) => agregarProducto(idProducto, 1)))
    if (resultados.some((agregado) => agregado <= 0)) {
      mostrarToast('No se pudo agregar el combo completo — revisa el stock.', 'error')
      return
    }
    mostrarToast('Agregados los dos al carrito.', 'exito')
  }

  async function alternarFavorito() {
    const { error } = favorito
      ? await supabase.from('favoritos_productos').delete().eq('cliente_web_id', usuario.id).eq('producto_id', producto.id)
      : await supabase.from('favoritos_productos').insert({ cliente_web_id: usuario.id, producto_id: producto.id })
    if (error) {
      mostrarToast('No se pudo actualizar tus favoritos.', 'error')
      return
    }
    setFavorito((valor) => !valor)
  }

  function compartir() {
    const texto =
      `✨ Mira este producto:\n\n🛍 *${producto.nombre}*\n` +
      `💰 ${formatearSoles(producto.precio)}` +
      `\n\n¡Pregunta por él en tu próxima visita!`
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener,noreferrer')
  }

  async function enviarResena(evento) {
    evento.preventDefault()
    if (calificacionForm < 1) {
      mostrarToast('Elige una calificación de 1 a 5 estrellas.', 'error')
      return
    }

    setEnviandoResena(true)
    const { data, error } = await supabase.rpc('guardar_mi_resena_producto', {
      p_producto_id: producto.id,
      p_calificacion: calificacionForm,
      p_comentario: comentarioForm.trim() || null,
    })
    setEnviandoResena(false)

    if (error) {
      mostrarToast(error.message, 'error')
      return
    }

    setMiResena(data)
    setMostrarFormResena(false)
    mostrarToast('¡Gracias! Tu reseña se publicará cuando el admin la revise.', 'exito')
  }

  const addLabel = useMemo(() => {
    if (!producto) return ''
    if (agotado) return 'Agotado'
    if (agregadoOk) return 'Agregado al carrito ✓'
    if (sinMasParaAgregar) return 'Ya tienes todo el stock'
    return `Agregar al carrito · ${formatearSoles(Number(producto.precio) * cantidad)}`
  }, [producto, agotado, agregadoOk, sinMasParaAgregar, cantidad])
  const addDeshabilitado = agotado || sinMasParaAgregar || agregando

  if (cargando) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-mono text-sm text-white/50">Cargando...</p>
      </div>
    )
  }

  if (noEncontrado || !producto) {
    return <Navigate to="/productos" replace />
  }

  const ofertaHastaTexto = formatearFechaCorta(producto.oferta_hasta)

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto pb-28 lg:pb-8">
      {/* Migas + volver */}
      <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-4 px-4 pt-6 sm:px-8">
        <nav aria-label="Ruta" className="flex min-w-0 items-center gap-2 truncate text-[11px] font-medium uppercase tracking-wider text-white/50">
          <Link to="/productos" className="shrink-0 hover:text-white">
            Productos
          </Link>
          <span className="shrink-0">/</span>
          <span className="shrink-0">{producto.categoria ?? 'General'}</span>
          <span className="shrink-0">/</span>
          <span className="truncate text-white">{producto.nombre}</span>
        </nav>
        <Link
          to="/productos"
          className="hidden shrink-0 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--lw-gold)] hover:text-white sm:flex"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Volver a productos
        </Link>
      </div>

      {/* 1. Galería + información */}
      <section className="mx-auto grid w-full max-w-[1200px] gap-8 px-4 pt-6 sm:px-8 lg:grid-cols-[1fr_1fr] lg:items-start lg:gap-16">
        <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[84px_1fr] lg:items-start lg:gap-4">
          {fotos.length > 1 && (
            <div className="order-2 flex gap-2 overflow-x-auto lg:order-1 lg:flex-col lg:overflow-visible" style={{ scrollbarWidth: 'none' }}>
              {fotos.map((foto, indice) => (
                <button
                  key={foto.id}
                  type="button"
                  onClick={() => irAFoto(indice)}
                  aria-label={`Ver foto: ${foto.etiqueta}`}
                  aria-pressed={indice === fotoIdxSeguro}
                  className={`relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition-opacity lg:h-[104px] lg:w-[84px] ${
                    indice === fotoIdxSeguro ? 'border-white opacity-100' : 'border-transparent opacity-55'
                  }`}
                >
                  <img src={urlPublicaFoto(BUCKET_FOTOS, foto.foto_url)} alt="" className="h-full w-full object-cover" />
                  <span className="absolute inset-x-1 bottom-1 rounded bg-black/70 py-0.5 text-center text-[7.5px] font-bold uppercase tracking-wider text-white">
                    {foto.etiqueta}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="relative order-1 aspect-square overflow-hidden rounded-[10px] bg-[#050505] lg:order-2 lg:aspect-[4/5]">
            {fotoActual ? (
              <img src={urlPublicaFoto(BUCKET_FOTOS, fotoActual.foto_url)} alt={producto.nombre} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-white/60" style={{ background: degradadoServicio(producto) }}>
                <Package className="h-10 w-10" />
              </div>
            )}

            {fotos.length > 1 && (
              <div className="absolute inset-x-3 top-3 flex gap-1.5">
                {fotos.map((foto, indice) => (
                  <button
                    key={foto.id}
                    type="button"
                    onClick={() => irAFoto(indice)}
                    aria-label={`Ir a foto: ${foto.etiqueta}`}
                    className={`lw-barra-progreso ${indice === fotoIdxSeguro ? 'activa' : indice < fotoIdxSeguro ? 'completa' : ''}`}
                  >
                    <span />
                  </button>
                ))}
              </div>
            )}

            {descuento != null && (
              <span className="absolute left-4 top-9 inline-flex items-center gap-2 rounded-[5px] bg-black/80 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--lw-rose)]" />
                Oferta −{descuento}%
              </span>
            )}

            {fotoActual && fotos.length > 1 && (
              <div className="absolute inset-x-3 bottom-3 flex items-end justify-between text-[10px] font-semibold uppercase tracking-widest text-white">
                <span>{fotoActual.etiqueta}</span>
                <span>
                  {fotoIdxSeguro + 1} / {fotos.length}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-white/60">
              {[producto.categoria, producto.subcategoria].filter(Boolean).join(' · ') || 'Producto'}
            </span>
            <h1 className="lw-titulo-heavitas text-4xl uppercase leading-none sm:text-[52px]">{producto.nombre}</h1>
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span className="text-3xl font-bold text-white sm:text-4xl">{formatearSoles(producto.precio)}</span>
              {producto.precio_antes && <s className="text-base text-white/45">{formatearSoles(producto.precio_antes)}</s>}
              {ahorro != null && (
                <span className="inline-flex items-center gap-1.5 rounded-[5px] bg-[#18181b] px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider text-white">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--lw-rose)]" />
                  Ahorras {formatearSoles(ahorro)}
                </span>
              )}
            </div>
            {producto.precio_antes && (
              <span className="text-xs text-white/50">
                {ofertaHastaTexto ? `Precio de oferta hasta el ${ofertaHastaTexto}.` : 'Precio de oferta por tiempo limitado o hasta agotar stock.'}
              </span>
            )}
          </div>

          <p className="text-[15px] leading-relaxed text-[#d9d9dc]">
            {producto.descripcion ||
              `Uno de nuestros productos de ${producto.categoria ?? 'catálogo'} más pedidos. Pregunta por sus detalles y modo de uso en tu próxima visita.`}
          </p>

          {/* Presentaciones (producto_variantes, migración 120): la tabla
              ya existe, pero elegir una variante todavía no cambia el
              precio/stock/carrito de esta página — esa integración queda
              para una tarea aparte (ver supabase/sql/120_producto_variantes.sql). */}

          {/* Datos clave: Contenido/Rinde solo si el admin los cargó. */}
          <div
            className={`grid grid-cols-1 divide-y divide-white/10 rounded-[10px] border border-white/10 bg-[#111113] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] ${
              producto.contenido || producto.rinde ? 'sm:grid-cols-2 sm:divide-x sm:divide-y' : 'sm:grid-cols-2 sm:divide-x sm:divide-y-0'
            }`}
          >
            <div className="flex flex-col gap-1.5 px-5 py-4">
              <span className="text-[11px] uppercase tracking-widest text-white/50">Stock</span>
              <span className="flex items-center gap-2 text-[17px] font-semibold text-white">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: agotado ? '#5a5a60' : producto.stock_actual <= 5 ? '#e0a64a' : '#3ecf6a' }}
                />
                {agotado ? 'Agotado' : producto.stock_actual <= 5 ? `Últimas ${producto.stock_actual} unidades` : 'En stock'}
              </span>
            </div>
            <div className="flex flex-col gap-1.5 px-5 py-4">
              <span className="text-[11px] uppercase tracking-widest text-white/50">Entrega</span>
              <span className="flex flex-col gap-0.5 text-[15px] font-semibold text-white">
                Recojo gratis en el local
                {costoEnvioDesde != null && (
                  <span className="text-xs font-normal text-white/50">
                    o envío a domicilio desde {formatearSoles(costoEnvioDesde)}
                  </span>
                )}
              </span>
            </div>
            {producto.contenido && (
              <div className="flex flex-col gap-1.5 px-5 py-4">
                <span className="text-[11px] uppercase tracking-widest text-white/50">Contenido</span>
                <span className="text-[17px] font-semibold text-white">{producto.contenido}</span>
              </div>
            )}
            {producto.rinde && (
              <div className="flex flex-col gap-1.5 px-5 py-4">
                <span className="text-[11px] uppercase tracking-widest text-white/50">Rinde</span>
                <span className="text-[17px] font-semibold text-white">{producto.rinde}</span>
              </div>
            )}
          </div>

          {/* Cantidad + Agregar al carrito */}
          <div className="flex flex-col gap-3">
            <div className="flex items-stretch gap-2.5">
              <div className="flex shrink-0 items-center gap-1 rounded-full border border-white/25 px-1">
                <button
                  type="button"
                  onClick={() => setCantidad((c) => Math.max(1, c - 1))}
                  disabled={agotado || cantidad <= 1}
                  aria-label="Quitar uno"
                  className="flex h-11 w-11 items-center justify-center rounded-full text-white disabled:opacity-30"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span aria-live="polite" className="min-w-6 text-center text-base font-semibold text-white">
                  {cantidad}
                </span>
                <button
                  type="button"
                  onClick={() => setCantidad((c) => Math.min(disponibleParaAgregar, c + 1))}
                  disabled={agotado || cantidad >= disponibleParaAgregar}
                  aria-label="Agregar uno"
                  className="flex h-11 w-11 items-center justify-center rounded-full text-white disabled:opacity-30"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <button
                type="button"
                onClick={confirmarAgregar}
                disabled={addDeshabilitado}
                className="flex flex-1 items-center justify-between gap-3 rounded-full border px-6 py-2 pl-6 pr-2 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed"
                style={
                  agregadoOk
                    ? { borderColor: 'var(--lw-gold)', background: 'transparent', color: 'var(--lw-gold)' }
                    : addDeshabilitado
                      ? { borderColor: '#2e2e2e', background: '#18181b', color: '#6b6b70' }
                      : { borderColor: 'var(--lw-gold)', background: 'var(--lw-gold)', color: '#0b0b0c' }
                }
              >
                {addLabel}
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0b0b0c] text-[var(--lw-gold)]">
                  {agregadoOk ? <Check className="h-4 w-4" /> : <ShoppingBag className="h-4 w-4" />}
                </span>
              </button>
            </div>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={comprarAhora}
                disabled={agotado}
                className="flex flex-1 items-center justify-center gap-2 rounded-full border border-white/25 px-5 py-3.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                Comprar ahora
              </button>
              <button
                type="button"
                onClick={alternarFavorito}
                aria-pressed={favorito}
                aria-label={favorito ? 'Quitar de favoritos' : 'Guardar en favoritos'}
                className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-full border border-white/25 text-white"
              >
                <Heart className={`h-[18px] w-[18px] ${favorito ? 'fill-[#ff5c85] text-[#ff5c85]' : ''}`} />
              </button>
              <button
                type="button"
                onClick={compartir}
                aria-label="Compartir por WhatsApp"
                className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-full border border-white/25 text-white"
              >
                <MessageCircle className="h-[18px] w-[18px]" />
              </button>
            </div>
            <span className="text-xs text-white/50">
              {cantidadEnCarrito > 0
                ? `Ya tienes ${cantidadEnCarrito} en tu carrito${disponibleParaAgregar > 0 ? ` · quedan ${disponibleParaAgregar} para agregar` : ''}.`
                : 'Pagas al confirmar tu pedido en el carrito.'}
            </span>
          </div>

          {whatsapp && (
            <a
              href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hola, tengo una duda sobre "${producto.nombre}".`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 border-y border-white/10 py-4 text-[13px] text-white"
            >
              <span className="flex items-center gap-2.5">
                <MessageCircle className="h-4 w-4" /> ¿Dudas sobre este producto? Escríbenos por WhatsApp
              </span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          )}

          {/* Sellos: puntos · reseñas · "lo usamos en el salón" */}
          <div className="grid grid-cols-3 gap-4 py-2">
            <div className="flex flex-col items-center gap-2.5 text-center text-white">
              <Award className="h-8 w-8" strokeWidth={1.5} />
              <span className="text-[13.5px] font-semibold leading-tight">
                {estimado?.cifra}
                <br />
                <span className="font-normal text-white/60">{estimado?.detalle}</span>
              </span>
            </div>
            <a href="#resenas" className="flex flex-col items-center gap-2.5 text-center text-white">
              <Star className="h-8 w-8" strokeWidth={1.5} />
              <span className="text-[13.5px] font-semibold leading-tight">
                {resumenResenas?.total > 0
                  ? `${resumenResenas.promedio} · ${resumenResenas.total} reseña${resumenResenas.total === 1 ? '' : 's'}`
                  : 'Reseñas'}
                <br />
                <span className="font-semibold text-[var(--lw-gold)]">Ver reseñas →</span>
              </span>
            </a>
            <div className="flex flex-col items-center gap-2.5 text-center text-white">
              <ShieldCheck className="h-8 w-8" strokeWidth={1.5} />
              <span className="text-[13.5px] font-semibold leading-tight">
                Lo usamos
                <br />
                <span className="font-normal text-white/60">en el salón</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Pago · entrega · cambios */}
      <section className="mx-auto mt-14 w-full max-w-[1200px] px-4 sm:px-8">
        <div className="grid grid-cols-1 divide-y divide-white/10 rounded-[10px] border border-white/10 bg-[#111113] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] md:grid-cols-3 md:divide-x md:divide-y-0">
          <div className="flex gap-3.5 px-6 py-5">
            <CreditCard className="h-5 w-5 shrink-0 text-[var(--lw-gold)]" />
            <span className="flex flex-col gap-1">
              <span className="text-[13.5px] font-semibold text-white">Pagas al confirmar tu pedido</span>
              <span className="text-[12.5px] leading-relaxed text-white/60">
                Yape, Plin o transferencia; subes tu comprobante en el carrito. Puedes usar tus cupones.
              </span>
            </span>
          </div>
          <div className="flex gap-3.5 px-6 py-5">
            <Truck className="h-5 w-5 shrink-0 text-[var(--lw-gold)]" />
            <span className="flex flex-col gap-1">
              <span className="text-[13.5px] font-semibold text-white">Recojo gratis o envío a domicilio</span>
              <span className="text-[12.5px] leading-relaxed text-white/60">
                Te avisamos en Notificaciones cuando esté listo para recoger o en camino.
                {costoEnvioDesde != null && ` Envío desde ${formatearSoles(costoEnvioDesde)}, según tu zona.`}
              </span>
            </span>
          </div>
          <div className="flex gap-3.5 px-6 py-5">
            <Package className="h-5 w-5 shrink-0 text-[var(--lw-gold)]" />
            <span className="flex flex-col gap-1">
              <span className="text-[13.5px] font-semibold text-white">Cambios con el producto sellado</span>
              <span className="text-[12.5px] leading-relaxed text-white/60">Solo con el producto sellado y sin usar. Consulta el plazo con el negocio.</span>
            </span>
          </div>
        </div>
      </section>

      {/* 3. Cómo se usa */}
      {producto.modo_uso?.length > 0 && (
        <section className="mx-auto mt-16 w-full max-w-[1200px] px-4 sm:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="lw-titulo-heavitas text-2xl uppercase">Cómo se usa</h2>
            {producto.frecuencia && (
              <span className="text-sm text-white/60">
                Frecuencia <b className="font-semibold text-white">{producto.frecuencia}</b>
              </span>
            )}
          </div>
          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {producto.modo_uso.map((paso, indice) => (
              <div key={indice} className="flex gap-3.5">
                <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-white/15 bg-[#18181b] text-[13px] font-bold text-[var(--lw-gold)]">
                  {indice + 1}
                </span>
                <span className="flex flex-col gap-1.5">
                  <span className="text-[15px] font-semibold text-white">{paso.nombre}</span>
                  {paso.texto && <span className="text-[13px] leading-relaxed text-white/60">{paso.texto}</span>}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4. ¿Es para ti? */}
      {(producto.ideal_para?.length > 0 || producto.tips?.length > 0) && (
        <section className="mx-auto mt-16 w-full max-w-[1200px] px-4 sm:px-8">
          <h2 className="lw-titulo-heavitas text-2xl uppercase">¿Es para ti?</h2>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {producto.ideal_para?.length > 0 && (
              <div className="rounded-[10px] border border-white/10 bg-[#111113] p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
                <div className="mb-3.5 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-white/15 bg-[#18181b] text-white">
                    <Sparkles className="h-[18px] w-[18px]" />
                  </span>
                  <span className="text-[15px] font-bold text-white">Ideal para</span>
                </div>
                <ul className="list-none divide-y divide-white/10">
                  {producto.ideal_para.map((texto, indice) => (
                    <li key={indice} className="flex gap-3 py-3 text-[13.5px] leading-relaxed text-[#d9d9dc]">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--lw-gold)]" />
                      <span>{texto}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {producto.tips?.length > 0 && (
              <div className="rounded-[10px] border border-white/10 bg-[#111113] p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
                <div className="mb-3.5 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-white/15 bg-[#18181b] text-white">
                    <AlertCircle className="h-[18px] w-[18px]" />
                  </span>
                  <span className="text-[15px] font-bold text-white">Tips y precauciones</span>
                </div>
                <ul className="list-none divide-y divide-white/10">
                  {producto.tips.map((texto, indice) => (
                    <li key={indice} className="flex gap-3 py-3 text-[13.5px] leading-relaxed text-[#d9d9dc]">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--lw-gold)]" />
                      <span>{texto}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {/* 5. Especificaciones · Ingredientes clave · Libre de */}
      {(producto.especificaciones?.length > 0 || producto.ingredientes?.length > 0 || producto.libre_de?.length > 0) && (
        <section className="mx-auto mt-16 grid w-full max-w-[1200px] gap-4 px-4 sm:px-8 sm:grid-cols-3">
          {producto.especificaciones?.length > 0 && (
            <div className="rounded-[10px] border border-white/10 bg-[#111113] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--lw-gold)]">Especificaciones</h3>
              <div className="mt-3 divide-y divide-white/10">
                {producto.especificaciones.map((spec, indice) => (
                  <div key={indice} className="flex justify-between gap-4 py-2.5 text-[13px]">
                    <span className="text-white/60">{spec.clave}</span>
                    <span className="text-right font-medium text-white">{spec.valor}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {producto.ingredientes?.length > 0 && (
            <div className="rounded-[10px] border border-white/10 bg-[#111113] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--lw-gold)]">Ingredientes clave</h3>
              <div className="mt-3 divide-y divide-white/10">
                {producto.ingredientes.map((item, indice) => (
                  <div key={indice} className="flex items-center gap-3 py-2.5 text-[13px]">
                    <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-white/15 bg-[#18181b] text-[#d9d9dc]">
                      <Droplet className="h-3.5 w-3.5" />
                    </span>
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium text-white">{item.nombre}</span>
                      {item.texto && <span className="text-xs text-white/50">{item.texto}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {producto.libre_de?.length > 0 && (
            <div className="rounded-[10px] border border-white/10 bg-[#111113] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--lw-gold)]">Libre de</h3>
              <div className="mt-3 divide-y divide-white/10">
                {producto.libre_de.map((texto, indice) => (
                  <div key={indice} className="flex items-center gap-3 py-2.5 text-[13px]">
                    <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-white/15 bg-[#18181b] text-[#d9d9dc]">
                      <X className="h-4 w-4" />
                    </span>
                    <span className="font-medium text-white">{texto}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* 6. Reseñas */}
      <section id="resenas" className="mx-auto mt-16 w-full max-w-[1200px] border-t border-white/10 px-4 pt-12 sm:px-8">
        <h2 className="lw-titulo-heavitas text-2xl uppercase">Lo que dicen nuestras clientas</h2>
        <div className="mt-6 flex flex-col gap-8 lg:flex-row">
          <div className="flex w-full flex-col gap-3.5 lg:w-[280px] lg:shrink-0">
            {resumenResenas?.total > 0 ? (
              <>
                <div className="flex items-baseline gap-3">
                  <span className="text-[56px] font-bold leading-none text-white">{resumenResenas.promedio}</span>
                  <span className="text-[13px] text-white/60">de 5</span>
                </div>
                <div className="flex gap-0.5 text-[var(--lw-gold)]">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star key={i} className="h-[18px] w-[18px]" fill={i < Math.round(resumenResenas.promedio) ? 'currentColor' : 'none'} />
                  ))}
                </div>
                <span className="text-[13px] text-white/60">
                  {resumenResenas.total} reseña{resumenResenas.total === 1 ? '' : 's'} de clientas que compraron este producto
                </span>
                <div className="mt-1 flex flex-col gap-1.5">
                  {[
                    ['5', resumenResenas.cinco],
                    ['4', resumenResenas.cuatro],
                    ['3', resumenResenas.tres],
                    ['2', resumenResenas.dos],
                    ['1', resumenResenas.uno],
                  ].map(([estrella, cantidad]) => (
                    <div key={estrella} className="flex items-center gap-2.5 text-xs text-white/60">
                      <span className="w-2.5">{estrella}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                        <span
                          className="block h-full rounded-full bg-[var(--lw-gold)]"
                          style={{ width: `${resumenResenas.total ? (cantidad / resumenResenas.total) * 100 : 0}%` }}
                        />
                      </span>
                      <span className="w-4 text-right">{cantidad}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-start gap-2">
                <Star className="h-8 w-8 text-white/30" />
                <p className="text-sm text-white/60">Aún no hay reseñas de este producto.</p>
              </div>
            )}

            <div className="mt-1 flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => setMostrarFormResena((v) => !v)}
                className="flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-semibold text-black"
                style={{ background: 'var(--lw-gold)' }}
              >
                <PenLine className="h-3.5 w-3.5" />
                {miResena ? 'Editar tu reseña' : 'Escribir una reseña'}
              </button>
            </div>
            {miResena?.estado === 'PENDIENTE' && (
              <span className="text-[11.5px] text-white/50">Tu reseña está en revisión antes de publicarse.</span>
            )}
            <span className="text-[11.5px] leading-relaxed text-white/40">
              Solo pueden reseñar las clientas que ya compraron este producto.
            </span>

            {mostrarFormResena && (
              <form onSubmit={enviarResena} className="mt-2 flex flex-col gap-3 rounded-[10px] border border-white/10 bg-[#111113] p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-white/60">Tu calificación</span>
                  <button type="button" onClick={() => setMostrarFormResena(false)} aria-label="Cerrar" className="text-white/50 hover:text-white">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex gap-1">
                  {Array.from({ length: 5 }, (_, i) => (
                    <button key={i} type="button" onClick={() => setCalificacionForm(i + 1)} aria-label={`${i + 1} estrellas`} className="text-[var(--lw-gold)]">
                      <Star className="h-6 w-6" fill={i < calificacionForm ? 'currentColor' : 'none'} />
                    </button>
                  ))}
                </div>
                <textarea
                  rows={3}
                  value={comentarioForm}
                  onChange={(evento) => setComentarioForm(evento.target.value)}
                  placeholder="Cuéntanos cómo te fue (opcional)"
                  className="w-full resize-none rounded-lg border border-white/15 bg-[#0b0b0c] px-3 py-2 text-sm text-white outline-none placeholder:text-white/40 focus:border-[var(--lw-gold)]"
                />
                <button
                  type="submit"
                  disabled={enviandoResena}
                  className="self-start rounded-full px-5 py-2 text-sm font-semibold text-black disabled:opacity-50"
                  style={{ background: 'var(--lw-gold)' }}
                >
                  {enviandoResena ? 'Enviando...' : 'Enviar reseña'}
                </button>
              </form>
            )}
          </div>

          {resenasPublicas.length > 0 && (
            <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-3">
              {resenasPublicas.map((resena) => (
                <article key={resena.id} className="flex flex-col gap-3 rounded-[10px] border border-white/10 bg-[#111113] p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1d2633] font-bold text-[var(--lw-gold)]">
                      {resena.nombre?.[0]?.toUpperCase() ?? '?'}
                    </span>
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-white">{resena.nombre}</span>
                      <span className="text-[11.5px] text-white/50">
                        {new Date(resena.creado_en).toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-0.5 text-[var(--lw-gold)]">
                    {Array.from({ length: 5 }, (_, i) => (
                      <Star key={i} className="h-3 w-3" fill={i < resena.calificacion ? 'currentColor' : 'none'} />
                    ))}
                  </div>
                  {resena.comentario && <p className="text-[13px] leading-relaxed text-[#d9d9dc]">{resena.comentario}</p>}
                  <span className="mt-auto w-fit rounded-[5px] bg-white/10 px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-wider text-white/60">
                    Compra verificada
                  </span>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 7. Se suele comprar junto con (combo sugerido) */}
      {combo && (
        <section className="mx-auto mt-16 w-full max-w-[1200px] px-4 sm:px-8">
          <h2 className="lw-titulo-heavitas text-2xl uppercase">Se suele comprar junto con</h2>
          <div className="mt-6 flex flex-col gap-6 rounded-[10px] border border-white/10 bg-[#111113] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] sm:flex-row sm:items-center sm:p-7">
            <div className="flex flex-1 flex-wrap items-center gap-4">
              <div className="flex items-center gap-3.5">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[10px] bg-[#151517]">
                  {urlPublicaFoto(BUCKET_FOTOS, producto.foto_url) ? (
                    <img src={urlPublicaFoto(BUCKET_FOTOS, producto.foto_url)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full" style={{ background: degradadoServicio(producto) }} />
                  )}
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold text-white">{producto.nombre}</span>
                  <span className="text-xs text-white/60">{formatearSoles(producto.precio)}</span>
                </div>
              </div>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 text-white/60">
                <Plus className="h-3.5 w-3.5" />
              </span>
              <Link to={`/productos/${combo.id}`} className="flex items-center gap-3.5">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[10px] bg-[#151517]">
                  {urlPublicaFoto(BUCKET_FOTOS, combo.foto_url) ? (
                    <img src={urlPublicaFoto(BUCKET_FOTOS, combo.foto_url)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full" style={{ background: degradadoServicio(combo) }} />
                  )}
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold text-white">{combo.nombre}</span>
                  <span className="text-xs text-white/60">{formatearSoles(combo.precio)}</span>
                </div>
              </Link>
            </div>
            <div className="flex items-center gap-6 sm:border-l sm:border-white/10 sm:pl-7">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-white/60">Total juntos</span>
                <span className="text-xl font-bold text-white">{formatearSoles(Number(producto.precio) + Number(combo.precio))}</span>
              </div>
              <button
                type="button"
                onClick={agregarCombo}
                className="flex shrink-0 items-center justify-between gap-3 rounded-full border px-5 py-1.5 pl-5 pr-1.5 text-sm font-semibold"
                style={
                  cantidadEnCarrito > 0 && (productosCarrito.get(combo.id) ?? 0) > 0
                    ? { borderColor: 'var(--lw-gold)', background: 'transparent', color: 'var(--lw-gold)' }
                    : { borderColor: 'var(--lw-gold)', background: 'var(--lw-gold)', color: '#0b0b0c' }
                }
              >
                {cantidadEnCarrito > 0 && (productosCarrito.get(combo.id) ?? 0) > 0 ? 'Agregados al carrito' : 'Agregar los dos al carrito'}
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0b0b0c] text-[var(--lw-gold)]">
                  <Plus className="h-3.5 w-3.5" />
                </span>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* También te puede interesar */}
      {relacionados.length > 0 && (
        <section className="mx-auto mt-16 w-full max-w-[1200px] px-4 sm:px-8">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <h2 className="lw-titulo-heavitas text-lg uppercase sm:text-[22px]">También te puede interesar</h2>
              <span className="text-xs text-white/50">{producto.categoria}</span>
            </div>
            <button
              type="button"
              onClick={() => navigate(`/productos?categoria=${encodeURIComponent(producto.categoria ?? '')}`)}
              className="flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--lw-gold)]"
            >
              Ver todo <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-4 sm:gap-x-5 sm:gap-y-8">
            {relacionados.map((p) => (
              <TarjetaProductoCliente key={p.id} producto={p} />
            ))}
          </div>
        </section>
      )}

      <PieClienteWeb />

      {/* Barra inferior fija (solo móvil): precio + Agregar */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t border-white/10 bg-[#111113]/95 px-4 py-3 backdrop-blur-xl lg:hidden">
        <span className="flex flex-col leading-tight">
          <span className="text-lg font-bold text-white">{formatearSoles(producto.precio)}</span>
          {producto.precio_antes && <s className="text-xs text-white/45">{formatearSoles(producto.precio_antes)}</s>}
        </span>
        <button
          type="button"
          onClick={confirmarAgregar}
          disabled={addDeshabilitado}
          className="flex flex-1 items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed"
          style={
            agregadoOk
              ? { border: '1px solid var(--lw-gold)', background: 'transparent', color: 'var(--lw-gold)' }
              : addDeshabilitado
                ? { background: '#18181b', color: '#6b6b70' }
                : { background: 'var(--lw-gold)', color: '#0b0b0c' }
          }
        >
          {agregadoOk ? <Check className="h-4 w-4" /> : <ShoppingBag className="h-4 w-4" />}
          {addLabel}
        </button>
      </div>

      <BarraTuCarritoFlotante productos={[producto, combo, ...relacionados].filter(Boolean)} />
    </div>
  )
}
