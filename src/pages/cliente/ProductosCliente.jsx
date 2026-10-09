import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, HelpCircle, MapPin, MessageCircle, Package, ShoppingBag, Sparkles } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { obtenerContacto, obtenerHorario } from '../../lib/datosNegocioWeb.js'
import { useCarritoCliente } from '../../context/CarritoClienteContext.jsx'
import { useRequerirSesion } from '../../hooks/useRequerirSesion.js'
import { useToast } from '../../context/ToastContext.jsx'
import { formatearSoles } from '../../lib/moneda.js'
import { formatearDias, formatearHora, numeroWhatsapp } from '../../lib/contactoNegocio.js'
import { urlPublicaFoto } from '../../lib/imagenes.js'
import { degradadoServicio } from '../../lib/serviciosVisual.js'
import { useEntornoAnimacion } from '../../hooks/useEntornoAnimacion.js'
import { useRevelarEnPantalla } from '../../hooks/useRevelarEnPantalla.js'
import { useCintaContinua } from '../../hooks/useCintaContinua.js'
import TarjetaProductoCliente, { porcentajeDescuento } from '../../components/TarjetaProductoCliente.jsx'
import BarraTuCarritoFlotante from '../../components/BarraTuCarritoFlotante.jsx'
import BarraCatalogo from '../../components/BarraCatalogo.jsx'
import PieClienteWeb from './PieClienteWeb.jsx'

const BUCKET_FOTOS = 'fotos-productos'
const POR_FILA = 4
const MAX_HERO = 5
const INTERVALO_HERO_MS = 5000
// Cuántas tarjetas DISTINTAS mínimo debe tener una cinta antes de
// duplicarla — si hay pocas ofertas, la lista se repite para llenar el
// ancho (docs/diseno-productos/README.md, "Movimiento continuo").
const MIN_CINTA = 10

// Medidas de la cinta por medida de pantalla (README: "296×390 a 36px/s
// en escritorio; 200×264 a 28px/s en móvil"). Se resuelven una sola vez
// al montar vía useEntornoAnimacion — igual que los retrasos de la
// animación de entrada — porque el offset en px que lleva
// useCintaContinua tiene que calzar exacto con el tamaño realmente
// renderizado; no vale la pena el resize en vivo para esto.
const CINTA_MEDIDAS = {
  desktop: { ancho: 296, alto: 390, separacion: 24, velocidad: 36 },
  movil: { ancho: 200, alto: 264, separacion: 12, velocidad: 28 },
}

// Catálogo de productos del rediseño (docs/diseno-productos/README.md):
// inicio "Novedades y lo más vendido" con carrusel foto+texto (igual
// efecto que el hero de Servicios), dos cintas continuas (Ofertas /
// Destacados), filtros sticky + catálogo agrupado por categoría (idéntico
// a Servicios), "Cómo comprar", ayuda y la barra flotante "Tu carrito".
// Reemplaza la tarjeta iridiscente con inclinación 3D (`.iri-*`, que se
// queda en index.css sin tocar) por TarjetaProductoCliente.jsx, la misma
// tarjeta de Servicios con lo propio de un producto encima.
//
// `destacado`, `nuevo` y `en_inicio` (migración 117) se marcan a mano
// desde ModalProducto.jsx — decisión confirmada con el usuario. El
// inicio prioriza, por producto, la etiqueta: oferta (precio_antes) >
// "Nuevo" > "Destacado" > "Novedad" genérica. La descripción usa
// `productos.descripcion` (migración 118) si el admin ya la escribió, y
// solo cae al texto genérico por categoría en los que todavía no la
// tienen (mismo criterio que ServiciosCliente.jsx).
export default function ProductosCliente() {
  const { agregarProducto } = useCarritoCliente()
  const requerirSesion = useRequerirSesion()
  const { mostrarToast } = useToast()

  const [productos, setProductos] = useState([])
  const [contacto, setContacto] = useState(null)
  const [horario, setHorario] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [categoriaActiva, setCategoriaActiva] = useState('todos')
  const [heroIdx, setHeroIdx] = useState(0)
  const [heroTick, setHeroTick] = useState(0)

  // Animación de entrada — mismo patrón que ServiciosCliente.jsx (ver
  // docs/patrones/animacion-entrada.md), tabla de retrasos propia de
  // Productos (docs/diseno-productos/README.md, "Animación de entrada").
  const { reducirMovimiento, esDesktop } = useEntornoAnimacion()

  // QA-020: el calendario original (filas de categoría a 1500/1600 ms + 220 ms
  // por fila) mantenía transparentes tarjetas ya cargadas ~1,7 s en cada
  // entrada/regreso. Misma coreografía (hero, ofertas, destacados, filtros,
  // filas) y mismas animaciones, con los retrasos comprimidos para que lo útil
  // aparezca en ~0,5 s tras cargar.
  const ENTRADA_FIJA = esDesktop
    ? { eyebrow: 100, foto: 100, bloque: 150, botones: 250, catalogoLinea: 300, fraseOfertas: 350, filaOfertas: 400, filaDestacados: 450, filtros: 500 }
    : { eyebrow: 150, foto: 80, bloque: 200, botones: 280, catalogoLinea: 320, fraseOfertas: 360, filaOfertas: 400, filaDestacados: 450, filtros: 500 }
  const ENTRADA_FILA = { fila: esDesktop ? 500 : 520, paso: 100, carta: 60, entre: 50 }
  const cintaMedidas = esDesktop ? CINTA_MEDIDAS.desktop : CINTA_MEDIDAS.movil
  const cintaPasoPx = cintaMedidas.ancho + cintaMedidas.separacion

  useEffect(() => {
    let vigente = true

    async function cargar() {
      const productosRes = await supabase
        .from('productos')
        .select('id, nombre, categoria, subcategoria, precio, precio_antes, stock_actual, foto_url, descripcion, destacado, nuevo, en_inicio')
        .eq('activo', true)
        .order('nombre')

      if (!vigente) return
      setProductos(productosRes.data ?? [])
      setCargando(false)
    }

    cargar()
    return () => {
      vigente = false
    }
  }, [])

  // QA-022: contacto/horario son secundarios: no bloquean la lista.
  useEffect(() => {
    let vigente = true
    obtenerContacto().then((fila) => vigente && setContacto(fila))
    obtenerHorario().then((fila) => vigente && setHorario(fila))
    return () => {
      vigente = false
    }
  }, [])

  const conteosCategoria = useMemo(() => {
    const conteos = {}
    for (const item of productos) {
      if (item.categoria) conteos[item.categoria] = (conteos[item.categoria] ?? 0) + 1
    }
    return conteos
  }, [productos])

  const listaRef = useRef(null)
  function elegirCategoria(categoria) {
    setCategoriaActiva(categoria)
    // La barra quedó arriba del hero: al elegir, se baja al inicio de la lista.
    listaRef.current?.scrollIntoView({ block: 'start', behavior: reducirMovimiento ? 'auto' : 'smooth' })
  }

  const categorias = useMemo(
    () => ['todos', ...new Set(productos.map((p) => p.categoria).filter(Boolean))],
    [productos],
  )

  // Inicio: productos marcados a mano (productos.en_inicio) con stock.
  const heroProductos = useMemo(
    () => productos.filter((p) => p.en_inicio && p.stock_actual > 0).slice(0, MAX_HERO),
    [productos],
  )
  const heroIdxSeguro = heroProductos.length ? heroIdx % heroProductos.length : 0
  const heroActual = heroProductos[heroIdxSeguro]

  useEffect(() => {
    if (heroProductos.length < 2) return undefined
    const id = setInterval(() => {
      setHeroIdx((indice) => (indice + 1) % heroProductos.length)
    }, INTERVALO_HERO_MS)
    return () => clearInterval(id)
  }, [heroProductos.length, heroTick])

  function irAHero(indice) {
    setHeroIdx(indice)
    setHeroTick((valor) => valor + 1)
  }

  async function agregarDesdeHero() {
    if (!heroActual) return
    if (!requerirSesion('agregar productos al carrito')) return
    const agregado = await agregarProducto(heroActual.id, 1)
    mostrarToast(agregado > 0 ? 'Agregado al carrito.' : 'No se pudo agregar — ya no hay stock disponible.', agregado > 0 ? 'exito' : 'error')
  }

  const ofertas = useMemo(() => productos.filter((p) => p.precio_antes && p.stock_actual > 0), [productos])
  const destacados = useMemo(() => productos.filter((p) => p.destacado && p.stock_actual > 0), [productos])

  const terminoQ = busqueda.trim().toLowerCase()
  const agrupado = categoriaActiva === 'todos' && !terminoQ

  const listaFiltrada = useMemo(
    () =>
      productos.filter(
        (p) =>
          (categoriaActiva === 'todos' || p.categoria === categoriaActiva) &&
          (!terminoQ || p.nombre.toLowerCase().includes(terminoQ)),
      ),
    [productos, categoriaActiva, terminoQ],
  )

  const grupos = useMemo(() => {
    if (!agrupado) return []
    return categorias
      .slice(1)
      .map((categoria) => {
        const todos = productos.filter((p) => p.categoria === categoria)
        return { categoria, todos, primeros: todos.slice(0, POR_FILA) }
      })
      .filter((grupo) => grupo.todos.length > 0)
  }, [agrupado, categorias, productos])

  const clavesFilas = useMemo(() => grupos.map((grupo) => grupo.categoria), [grupos])
  const { contenedorRef, refFila, estadoFila } = useRevelarEnPantalla({
    activo: !reducirMovimiento && agrupado,
    claves: clavesFilas,
    agotarEnMs:
      ENTRADA_FILA.fila + (grupos.length + 1) * ENTRADA_FILA.paso + ENTRADA_FILA.carta + POR_FILA * ENTRADA_FILA.entre + 1500,
  })

  const plural = (n) => `${n} ${n === 1 ? 'producto' : 'productos'}`
  const whatsapp = contacto?.telefono ? numeroWhatsapp(contacto.telefono) : null
  const horarioTexto = horario
    ? `${formatearDias(horario.dias_atencion)} ${formatearHora(horario.bloque1_inicio)}-${formatearHora(horario.bloque1_fin)}`
    : null

  if (cargando) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-mono text-sm text-white/50">Cargando...</p>
      </div>
    )
  }

  return (
    <div ref={contenedorRef} className="animate-entrada-pestana flex-1 overflow-y-auto">
      {/* 0. BARRA DEL CATÁLOGO (fija) — arriba de todo, justo bajo el header. */}
      <BarraCatalogo
        categorias={categorias}
        conteos={conteosCategoria}
        categoriaActiva={categoriaActiva}
        onElegirCategoria={elegirCategoria}
        busqueda={busqueda}
        onBusqueda={setBusqueda}
        placeholder="Buscar producto…"
        etiquetaTotal={plural(agrupado ? productos.length : listaFiltrada.length)}
        className={reducirMovimiento ? '' : 'in-up'}
        style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.filtros}ms` }}
      />

      {/* 0. INICIO: "Novedades y lo más vendido" */}
      {heroActual && (
        <section className="mx-auto grid w-full max-w-[1400px] gap-8 lw-gutter pb-6 pt-6 lg:grid-cols-[1fr_1.12fr] lg:gap-16 lg:pt-10">
          <div className="order-2 flex flex-col justify-between gap-6 lg:order-1">
            <span
              className={`text-[11px] font-semibold uppercase tracking-widest text-white/60 ${reducirMovimiento ? '' : 'in-left'}`}
              style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.eyebrow}ms` }}
            >
              Novedades y lo más vendido
            </span>

            <div
              className={`grid ${reducirMovimiento ? '' : 'in-left'}`}
              style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.bloque}ms` }}
            >
              {heroProductos.map((p, i) => {
                const activo = i === heroIdxSeguro
                const saliente = heroProductos.length > 2 && i === (heroIdxSeguro - 1 + heroProductos.length) % heroProductos.length
                const y = activo ? 0 : saliente ? -16 : 16
                const blur = activo ? 0 : 8
                const dEtiqueta = activo ? 250 : 0
                const dTitulo = activo ? 350 : 0
                const dResto = activo ? 480 : 0
                const desc = p.descripcion || `Uno de nuestros productos de ${p.categoria ?? 'catálogo'} favoritos entre nuestras clientas.`
                const descuento = porcentajeDescuento(p)
                const etiquetaHero = descuento != null ? `En oferta −${descuento}%` : p.nuevo ? 'Nuevo' : p.destacado ? 'Destacado' : 'Novedad'

                const estiloEtiqueta = reducirMovimiento
                  ? { opacity: activo ? 1 : 0, transition: 'none' }
                  : {
                      opacity: activo ? 1 : 0,
                      transform: `translateY(${y}px)`,
                      transition: `opacity 0.6s ease ${dEtiqueta}ms, transform 0.6s ease ${dEtiqueta}ms`,
                    }
                const estiloTitulo = reducirMovimiento
                  ? { opacity: activo ? 1 : 0, filter: 'none', transform: 'none', transition: 'none' }
                  : {
                      opacity: activo ? 1 : 0,
                      filter: `blur(${blur}px)`,
                      transform: `translateY(${y}px)`,
                      transition: `opacity 0.7s ease ${dTitulo}ms, filter 0.7s ease ${dTitulo}ms, transform 0.8s cubic-bezier(0.2, 0.7, 0.2, 1) ${dTitulo}ms`,
                    }
                const estiloDescripcion = reducirMovimiento
                  ? { opacity: activo ? 1 : 0, transform: 'none', transition: 'none' }
                  : {
                      opacity: activo ? 1 : 0,
                      transform: `translateY(${y}px)`,
                      transition: `opacity 0.7s ease ${dResto}ms, transform 0.8s cubic-bezier(0.2, 0.7, 0.2, 1) ${dResto}ms`,
                    }
                const estiloPrecio = reducirMovimiento
                  ? { opacity: activo ? 1 : 0, transition: 'none' }
                  : { opacity: activo ? 1 : 0, transition: `opacity 0.7s ease ${dResto}ms` }

                return (
                  <div key={p.id} style={{ gridArea: '1 / 1' }} aria-hidden={!activo} className={`flex flex-col ${activo ? '' : 'pointer-events-none'}`}>
                    <span
                      style={estiloEtiqueta}
                      className="inline-flex w-fit items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-[#0b0b0c]"
                    >
                      <Sparkles className="h-[13px] w-[13px]" />
                      {etiquetaHero}
                    </span>
                    <h1 style={estiloTitulo} className="lw-titulo-heavitas mt-4 text-[34px] uppercase leading-[1.02] sm:text-[56px]">
                      {p.nombre}
                    </h1>
                    <p style={estiloDescripcion} className="mt-4 max-w-[44ch] text-sm leading-relaxed text-[#d9d9dc] sm:text-[15px]">
                      {desc}
                    </p>
                    <span style={estiloPrecio} className="mt-3.5 text-[13px] text-white/60">
                      <b className="text-[15px] font-semibold text-white">{formatearSoles(p.precio)}</b>
                      {p.precio_antes && <s className="ml-1.5">{formatearSoles(p.precio_antes)}</s>}
                      {p.categoria && ` · ${p.categoria}`}
                    </span>
                  </div>
                )
              })}
            </div>

            <div
              className={`flex flex-col gap-3 sm:flex-row sm:items-center ${reducirMovimiento ? '' : 'in-left'}`}
              style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.botones}ms` }}
            >
              <button
                type="button"
                onClick={agregarDesdeHero}
                className="flex items-center justify-between gap-3 rounded-full py-1.5 pl-6 pr-1.5 text-sm font-semibold text-black"
                style={{ background: 'var(--lw-gold)' }}
              >
                Agregar al carrito
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0b0b0c] text-[var(--lw-gold)]">
                  <ShoppingBag className="h-[15px] w-[15px]" />
                </span>
              </button>
              <Link
                to={`/productos/${heroActual.id}`}
                className="rounded-full border border-white/15 px-6 py-3.5 text-center text-sm text-[#e8e8ea] transition-colors hover:border-white/30"
              >
                Ver detalles
              </Link>
            </div>

            <div
              className={`flex flex-wrap items-baseline gap-2 text-xs text-white/50 ${reducirMovimiento ? '' : 'in-left'}`}
              style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.catalogoLinea}ms` }}
            >
              <span className="text-[11px] font-semibold uppercase tracking-widest text-[#e8e8ea]">Catálogo</span>
              <span>/</span>
              <span className="font-medium text-[#e8e8ea]">{plural(productos.length)}</span>
              <span>·</span>
              <span>Recojo en el local</span>
              <span>·</span>
              <span>Envío a domicilio</span>
            </div>
          </div>

          <div
            className={`order-1 flex flex-col gap-2.5 lg:order-2 ${reducirMovimiento ? '' : 'in-photo'}`}
            style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.foto}ms` }}
          >
            <div className="relative h-[300px] overflow-hidden rounded-[16px] bg-[#050505] sm:h-[420px]">
              {heroProductos.map((p, i) => {
                const urlFoto = urlPublicaFoto(BUCKET_FOTOS, p.foto_url)
                return (
                  <div key={p.id} className="absolute inset-0" style={{ opacity: i === heroIdxSeguro ? 1 : 0, transition: 'opacity 1.1s ease' }}>
                    {urlFoto ? (
                      <img
                        src={urlFoto}
                        alt={p.nombre}
                        className="h-full w-full object-cover"
                        style={{ transform: `scale(${i === heroIdxSeguro ? 1 : 1.06})`, transition: 'transform 6s ease-out' }}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-white/60" style={{ background: degradadoServicio(p) }}>
                        <Package className="h-10 w-10" />
                      </div>
                    )}
                  </div>
                )
              })}
              <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/60" />

              {heroProductos.length > 1 && (
                <div className="absolute inset-x-4 top-3.5 flex gap-1.5">
                  {heroProductos.map((p, i) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => irAHero(i)}
                      aria-label={`Ir a ${p.nombre}`}
                      className={`lw-barra-progreso ${i === heroIdxSeguro ? 'activa' : i < heroIdxSeguro ? 'completa' : ''}`}
                    >
                      <span />
                    </button>
                  ))}
                </div>
              )}

              <div className="absolute inset-x-4 bottom-4 flex items-end justify-between text-[11px] font-medium uppercase tracking-widest text-white">
                <span className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--lw-rose)]" />
                  {String(heroIdxSeguro + 1).padStart(2, '0')} / {String(heroProductos.length).padStart(2, '0')}
                </span>
                <span className="normal-case tracking-normal text-[#eeeeee]">
                  <b className="font-semibold">{formatearSoles(heroActual.precio)}</b>
                </span>
              </div>
            </div>

            {heroProductos.length > 1 && (
              <div className="grid grid-cols-3 gap-2.5">
                {[1, 2, 3].map((j) => {
                  const t = (heroIdxSeguro + j) % heroProductos.length
                  const p = heroProductos[t]
                  const urlFoto = urlPublicaFoto(BUCKET_FOTOS, p.foto_url)
                  return (
                    <button
                      key={j}
                      type="button"
                      onClick={() => irAHero(t)}
                      aria-label={`Ver ${p.nombre}`}
                      className="group relative h-[108px] overflow-hidden rounded-[14px] bg-[#151517] sm:h-[180px]"
                    >
                      {urlFoto ? (
                        <img src={urlFoto} alt="" className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06]" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-white/50" style={{ background: degradadoServicio(p) }}>
                          <Package className="h-6 w-6" />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* 1. OFERTAS Y DESTACADOS: dos cintas en movimiento continuo. */}
      {(ofertas.length > 0 || destacados.length > 0) && (
        <section className="flex flex-col gap-9 py-10">
          <p
            className={`mx-auto w-full max-w-[1700px] lw-gutter text-[15px] leading-relaxed text-[#d9d9dc] ${reducirMovimiento ? '' : 'in-left'}`}
            style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.fraseOfertas}ms` }}
          >
            Los mismos productos que usamos en el salón, para que tu resultado dure en casa.
          </p>
          {ofertas.length > 0 && (
            <FilaCintaProductos
              titulo="Ofertas"
              derecha
              etiqueta={(p) => `Oferta −${porcentajeDescuento(p)}%`}
              productos={ofertas}
              pasoPx={cintaPasoPx}
              medidas={cintaMedidas}
              velocidadPxS={cintaMedidas.velocidad}
              activo={!reducirMovimiento}
              claseEntrada={reducirMovimiento ? '' : 'in-left'}
              delayEntrada={ENTRADA_FIJA.filaOfertas}
            />
          )}
          {destacados.length > 0 && (
            <FilaCintaProductos
              titulo="Destacados"
              derecha={false}
              etiqueta={() => 'Destacado'}
              productos={destacados}
              pasoPx={cintaPasoPx}
              medidas={cintaMedidas}
              velocidadPxS={cintaMedidas.velocidad}
              activo={!reducirMovimiento}
              claseEntrada={reducirMovimiento ? '' : 'in-right'}
              delayEntrada={ENTRADA_FIJA.filaDestacados}
            />
          )}
        </section>
      )}

      <div ref={listaRef} className="mx-auto w-full max-w-[1700px] scroll-mt-16 lw-gutter">
        {/* 3a. "Todos": una fila por categoría */}
        {agrupado && (
          <div className="flex flex-col gap-10 pt-8">
            {grupos.map((grupo, gi) => {
              const decision = reducirMovimiento ? null : estadoFila(grupo.categoria)
              const pendiente = !reducirMovimiento && !decision
              const listo = Boolean(decision && !decision.agotada)
              const delayBase = decision?.modo === 'carga' ? ENTRADA_FILA.fila + gi * ENTRADA_FILA.paso : 0

              return (
                <section
                  key={grupo.categoria}
                  ref={refFila(grupo.categoria)}
                  className="flex flex-col gap-3.5"
                  style={pendiente ? { opacity: 0 } : undefined}
                >
                  <div
                    className={`flex items-baseline justify-between gap-3 ${listo ? 'in-left' : ''}`}
                    style={listo ? { animationDelay: `${delayBase}ms` } : undefined}
                  >
                    <div className="flex min-w-0 flex-wrap items-baseline gap-3">
                      <h2 className="lw-titulo-heavitas text-lg uppercase sm:text-[22px]">{grupo.categoria}</h2>
                      <span className="text-xs text-white/50">{plural(grupo.todos.length)}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCategoriaActiva(grupo.categoria)}
                      className="flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--lw-gold)]"
                    >
                      Ver todo ({grupo.todos.length}) <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="-mx-4 flex gap-3 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-5 sm:overflow-visible sm:px-0">
                    {grupo.primeros.map((p, k) => {
                      const claseTarjeta = listo ? (esDesktop ? (k < 2 ? 'in-left' : 'in-right') : 'in-right') : ''
                      const delayTarjeta = delayBase + ENTRADA_FILA.carta + k * ENTRADA_FILA.entre
                      return (
                        <div key={p.id} className={`w-[150px] shrink-0 sm:w-auto ${claseTarjeta}`} style={listo ? { animationDelay: `${delayTarjeta}ms` } : undefined}>
                          <TarjetaProductoCliente producto={p} />
                        </div>
                      )
                    })}
                    {grupo.todos.length > POR_FILA && (
                      <button
                        type="button"
                        onClick={() => setCategoriaActiva(grupo.categoria)}
                        className={`flex h-[150px] w-[120px] shrink-0 flex-col items-center justify-center gap-2.5 rounded-[10px] border border-dashed border-white/15 bg-[#111113] text-xs font-semibold text-white sm:hidden ${listo ? 'in-right' : ''}`}
                        style={listo ? { animationDelay: `${delayBase + ENTRADA_FILA.carta + POR_FILA * ENTRADA_FILA.entre}ms` } : undefined}
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black">
                          <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                        Ver los {grupo.todos.length}
                      </button>
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        )}

        {/* 3b. Una categoría o una búsqueda: grilla completa */}
        {!agrupado && (
          <div className="flex flex-col gap-4 pt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-3">
                <h2 className="lw-titulo-heavitas text-lg uppercase sm:text-[22px]">{terminoQ ? 'Resultados' : categoriaActiva}</h2>
                <span className="text-xs text-white/50">{plural(listaFiltrada.length)}</span>
              </div>
              {categoriaActiva !== 'todos' && (
                <button
                  type="button"
                  onClick={() => setCategoriaActiva('todos')}
                  className="flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--lw-gold)]"
                >
                  <ArrowRight className="h-3.5 w-3.5 rotate-180" /> Todas las categorías
                </button>
              )}
            </div>
            {listaFiltrada.length === 0 ? (
              <p className="py-10 text-center text-sm text-white/50">Sin resultados para "{busqueda}".</p>
            ) : (
              <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-4 sm:gap-x-5 sm:gap-y-8">
                {listaFiltrada.map((p) => (
                  <TarjetaProductoCliente key={p.id} producto={p} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* 4. CÓMO COMPRAR */}
        <section className="mt-16 border-t border-white/10 pt-10">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-white/60">Así de simple</span>
          <h2 className="lw-titulo-heavitas mt-2.5 text-2xl uppercase">Cómo comprar</h2>
          <div className="mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            {[
              { paso: 'Paso 1', titulo: 'Elige tus productos', texto: 'Toca un producto (o la flecha ↗) para ver sus detalles, elige la cantidad y agrégalo a tu carrito.' },
              { paso: 'Paso 2', titulo: 'Confirma tu pedido', texto: 'En el carrito aplica tu cupón, paga por Yape, Plin o transferencia y sube tu comprobante.' },
              { paso: 'Paso 3', titulo: 'Recoge o recibe', texto: 'Te avisamos en Notificaciones cuando tu pedido esté listo para recoger o en camino, según la entrega que elijas.' },
            ].map((item) => (
              <div key={item.paso} className="rounded-[10px] border border-white/10 bg-[#111113] p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
                <span className="text-[11px] tracking-widest text-[var(--lw-gold)]">{item.paso.toUpperCase()}</span>
                <h3 className="mt-2.5 text-[15px] font-semibold text-white">{item.titulo}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">{item.texto}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 5. AYUDA */}
        <section className="mt-16 border-t border-white/10 pt-14">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex max-w-[560px] flex-col gap-3.5">
              <h2 className="lw-titulo-heavitas text-3xl uppercase leading-[1.05] sm:text-[46px]">¿No encuentras tu producto?</h2>
              <p className="text-sm leading-relaxed text-white/60 sm:text-[15px]">
                Cuéntanos qué buscas y te recomendamos el producto ideal para tu tipo de cabello, uñas o piel.
              </p>
            </div>
            {horarioTexto && (
              <div className="flex flex-col gap-1 text-right">
                <span className="text-lg font-bold text-white sm:text-2xl">{horarioTexto}</span>
                <span className="text-xs text-white/50">horario de atención por WhatsApp y en el local</span>
              </div>
            )}
          </div>

          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-2.5 rounded-[14px] border border-white/10 bg-[#111113] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
              <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-white/15 bg-[#18181b] text-white">
                <MessageCircle className="h-[17px] w-[17px]" />
              </span>
              <h3 className="mt-2.5 text-[15px] font-bold text-white">Escríbenos por WhatsApp</h3>
              <p className="mb-1 text-[13px] leading-relaxed text-white/60">Te decimos si lo tenemos, cuándo llega o cuál te conviene más.</p>
              {whatsapp ? (
                <a
                  href={`https://wa.me/${whatsapp}?text=${encodeURIComponent('Hola, tengo una duda sobre sus productos.')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="self-start rounded-full border border-white/20 px-5 py-2.5 text-[13px] font-semibold text-white"
                >
                  Abrir WhatsApp
                </a>
              ) : (
                <span className="self-start rounded-full border border-dashed border-white/15 px-5 py-2.5 text-[13px] font-semibold text-white/40">
                  Aún no configurado
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2.5 rounded-[14px] border border-white/10 bg-[#111113] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
              <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-white/15 bg-[#18181b] text-white">
                <MapPin className="h-[17px] w-[17px]" />
              </span>
              <h3 className="mt-2.5 text-[15px] font-bold text-white">Contacto y ubicación</h3>
              <p className="mb-1 text-[13px] leading-relaxed text-white/60">
                {contacto?.direccion || contacto?.telefono ? [contacto?.direccion, contacto?.telefono].filter(Boolean).join(' · ') : 'Llámanos o visítanos. Te atendemos en el mismo horario.'}
              </p>
              <Link to="/nosotros" className="self-start rounded-full border border-white/20 px-5 py-2.5 text-[13px] font-semibold text-white">
                Ver contacto
              </Link>
            </div>
            <div className="flex flex-col gap-2.5 rounded-[14px] border border-white/10 bg-[#111113] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
              <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-white/15 bg-[#18181b] text-white">
                <HelpCircle className="h-[17px] w-[17px]" />
              </span>
              <h3 className="mt-2.5 text-[15px] font-bold text-white">Preguntas frecuentes</h3>
              <p className="mb-1 text-[13px] leading-relaxed text-white/60">Envíos, pagos, cambios y devoluciones: todo en un solo lugar.</p>
              <span className="self-start rounded-full border border-dashed border-white/15 px-5 py-2.5 text-[13px] font-semibold text-white/50">Muy pronto</span>
            </div>
          </div>
        </section>
      </div>

      <PieClienteWeb />

      <BarraTuCarritoFlotante productos={productos} />
    </div>
  )
}

// Una fila de la cinta continua (Ofertas/Destacados) — ver
// useCintaContinua.js para el mecanismo de desplazamiento. Encapsulada
// acá porque necesita su propio par de refs de hover/foco para pausar
// SOLO esta fila, sin afectar a la otra.
function FilaCintaProductos({ titulo, derecha, etiqueta, productos, pasoPx, medidas, velocidadPxS, activo, claseEntrada, delayEntrada }) {
  const n = productos.length
  const k = Math.max(1, Math.ceil(MIN_CINTA / n))
  const base = useMemo(() => Array.from({ length: k }, () => productos).flat(), [productos, k])
  const pista = useMemo(() => base.concat(base), [base])

  const { trackRef, dashRef, mover, pausar } = useCintaContinua({
    cantidadDistintos: n,
    pasoPx,
    velocidadPxS,
    derecha,
    activo,
  })

  function alEntrar(evento) {
    if (evento.target.closest('.cinta-tarjeta')) pausar(true)
  }
  function alSalir(evento) {
    const siguiente = evento.relatedTarget
    if (!siguiente || !siguiente.closest || !siguiente.closest('.cinta-tarjeta')) pausar(false)
  }

  return (
    <div className={`flex flex-col ${claseEntrada}`} style={claseEntrada ? { animationDelay: `${delayEntrada}ms` } : undefined}>
      <div className={`mx-auto flex w-full max-w-[1700px] items-baseline gap-3 lw-gutter ${derecha ? 'justify-start' : 'justify-end'}`}>
        <h2 className="lw-titulo-heavitas text-xl uppercase sm:text-[30px]">{titulo}</h2>
        <span className="text-xs text-white/50">{plural(n)}</span>
      </div>

      <div className="lw-cinta-mask my-6 overflow-hidden" onMouseOver={alEntrar} onMouseOut={alSalir} onFocus={alEntrar} onBlur={alSalir}>
        <div ref={trackRef} className="flex will-change-transform">
          {pista.map((p, indice) => {
            const urlFoto = urlPublicaFoto(BUCKET_FOTOS, p.foto_url)
            return (
              <Link
                key={`${p.id}-${indice}`}
                to={`/productos/${p.id}`}
                tabIndex={0}
                className="cinta-tarjeta group relative shrink-0 overflow-hidden rounded-[14px] bg-[#151517]"
                style={{ width: medidas.ancho, height: medidas.alto, marginRight: medidas.separacion }}
              >
                {urlFoto ? (
                  <img src={urlFoto} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06]" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-white/50" style={{ background: degradadoServicio(p) }}>
                    <Package className="h-8 w-8" />
                  </div>
                )}
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/80" />
                <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-300 group-hover:bg-black/30" />
                <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/80 px-2.5 py-1.5 text-[9.5px] font-bold uppercase tracking-wider text-white">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--lw-rose)]" />
                  {etiqueta(p)}
                </span>
                <div className="pointer-events-none absolute inset-x-3.5 bottom-3.5 flex flex-col gap-1">
                  <span className="text-[15px] font-bold leading-tight text-white">{p.nombre}</span>
                  <span className="text-[13px] font-semibold text-white">
                    {formatearSoles(p.precio)}
                    {p.precio_antes && <s className="ml-1.5 text-[12px] font-normal text-white/60">{formatearSoles(p.precio_antes)}</s>}
                  </span>
                </div>
                <span className="absolute left-1/2 top-1/2 z-[3] inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 whitespace-nowrap rounded-full bg-white/0 py-0 pl-0 pr-0 text-[13px] font-semibold text-[#0b0b0c] opacity-0 backdrop-blur transition-all duration-300 group-hover:bg-white/95 group-hover:py-2.5 group-hover:pl-4.5 group-hover:pr-1.5 group-hover:opacity-100">
                  Ver detalles
                  <span className="hidden h-[30px] w-[30px] items-center justify-center rounded-full bg-[#0b0b0c] text-white group-hover:flex">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </span>
              </Link>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-center gap-3.5">
        <button type="button" onClick={() => mover(-1)} aria-label={`Producto anterior en ${titulo}`} className="flex h-11 w-11 items-center justify-center text-white/50 transition-colors hover:text-white">
          <ArrowRight className="h-4 w-4 rotate-180" />
        </button>
        <div className="relative flex h-[3px] items-center gap-[5px]">
          {Array.from({ length: n }, (_, i) => (
            <span key={i} className="h-[2px] w-[18px] rounded-full bg-[#3a3a3f]" />
          ))}
          <span ref={dashRef} className="absolute left-0 top-0 h-[3px] w-[18px] rounded-full bg-white" />
        </div>
        <button type="button" onClick={() => mover(1)} aria-label={`Siguiente producto en ${titulo}`} className="flex h-11 w-11 items-center justify-center text-white/50 transition-colors hover:text-white">
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function plural(n) {
  return `${n} ${n === 1 ? 'producto' : 'productos'}`
}
