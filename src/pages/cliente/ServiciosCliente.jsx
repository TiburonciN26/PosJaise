import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, CalendarPlus, HelpCircle, MapPin, MessageCircle, Search, X } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { obtenerContacto, obtenerHorario } from '../../lib/datosNegocioWeb.js'
import { useCarritoCliente } from '../../context/CarritoClienteContext.jsx'
import { formatearSoles } from '../../lib/moneda.js'
import { formatearDias, formatearHora, numeroWhatsapp } from '../../lib/contactoNegocio.js'
import { urlPublicaFoto } from '../../lib/imagenes.js'
import { formatearDuracion } from '../../lib/serviciosVisual.js'
import { useEntornoAnimacion } from '../../hooks/useEntornoAnimacion.js'
import { useRevelarEnPantalla } from '../../hooks/useRevelarEnPantalla.js'
import TarjetaServicioCliente from '../../components/TarjetaServicioCliente.jsx'
import BarraTuCitaFlotante from '../../components/BarraTuCitaFlotante.jsx'
import PieClienteWeb from './PieClienteWeb.jsx'

const BUCKET_FOTOS = 'fotos-servicios'
const POR_FILA = 4
// Cuántos servicios entran en el carrusel del hero.
const MAX_HERO = 3
const INTERVALO_HERO_MS = 5000

// Catálogo de servicios del rediseño (docs/diseno-servicios/README.md):
// hero con carrusel de foto+texto, filtros sticky, catálogo agrupado por
// categoría (o grilla plana al elegir una / buscar), "Cómo reservar",
// ayuda y la barra flotante "Tu cita". Reemplaza por completo la tarjeta
// iridiscente con inclinación 3D (ver git blame de este archivo) — esa
// técnica y las clases .iri-* de index.css siguen usándose en
// ProductosCliente.jsx, no se tocaron.
//
// El hero prioriza, en orden: 1) servicios marcados a mano
// `en_tendencia` (ModalServicio.jsx, migración 108) → etiqueta "En
// tendencia"; 2) los más reservados en los últimos 30 días, calculados
// sin columna nueva vía la función `servicios_mas_pedidos()` (migración
// 109, cuenta cita_servicios excluyendo CANCELADA) → "Lo más pedido"; 3)
// si con eso no se llega a MAX_HERO, cualquier otro servicio con foto,
// sin más criterio (la tabla no tiene created_at, así que no se puede
// fingir "más recientes") → "Recomendado". `servicios.id` es uuid, no
// un entero secuencial — ver el hash real en lib/serviciosVisual.js.
//
// "descripción" propia (migración 107, editable en ModalServicio.jsx):
// el hero la usa si el admin ya la escribió, y solo cae al texto
// genérico por categoría en servicios que todavía no la tienen.
export default function ServiciosCliente() {
  const { serviciosCarrito, agregarServicio } = useCarritoCliente()
  const [searchParams] = useSearchParams()

  const [servicios, setServicios] = useState([])
  const [masPedidoIds, setMasPedidoIds] = useState([])
  const [contacto, setContacto] = useState(null)
  const [horario, setHorario] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [categoriaActiva, setCategoriaActiva] = useState(() => searchParams.get('categoria') ?? 'todos')
  const [heroIdx, setHeroIdx] = useState(0)
  const [heroTick, setHeroTick] = useState(0)
  // Animación de entrada (docs/diseno-servicios/README.md, "Animación de
  // entrada" — patrón estándar de la Web de clientes, ver
  // docs/patrones/animacion-entrada.md): los retrasos de la tabla son
  // distintos en escritorio y móvil; se resuelven una sola vez al
  // montar con el mismo breakpoint (lg, 1024px) que ya usa esta pestaña
  // para el hero. `useRevelarEnPantalla` lleva el historial de qué filas
  // de categoría ya se animaron (una vez por categoría, para toda la
  // vida de esta instancia) — así cambiar de categoría y volver a
  // "Todos" no repite nada.
  const { reducirMovimiento, esDesktop } = useEntornoAnimacion()

  // Retrasos exactos de Main.dc.html/Movil.dc.html.
  // QA-020: retrasos comprimidos (antes filas a 1000/1050 ms + 220 ms por fila,
  // que mantenían transparentes tarjetas ya cargadas ~1,2 s); misma coreografía.
  const ENTRADA_FIJA = esDesktop
    ? { eyebrow: 100, foto: 100, bloque: 150, botones: 250, catalogoLinea: 300, filtros: 350 }
    : { eyebrow: 150, foto: 80, bloque: 200, botones: 280, catalogoLinea: 320, filtros: 380 }
  const ENTRADA_FILA = { fila: esDesktop ? 400 : 420, paso: 100, carta: 60, entre: 50 }

  useEffect(() => {
    let vigente = true

    async function cargar() {
      const [serviciosRes, masPedidoRes] = await Promise.all([
        supabase
          .from('servicios')
          .select('id, nombre, categoria, precio, duracion_min, foto_url, descripcion, en_tendencia')
          .eq('activo', true)
          .order('nombre'),
        supabase.rpc('servicios_mas_pedidos', { dias: 30 }),
      ])

      if (!vigente) return
      setServicios(serviciosRes.data ?? [])
      setMasPedidoIds((masPedidoRes.data ?? []).map((fila) => fila.servicio_id))
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

  const categorias = useMemo(
    () => ['todos', ...new Set(servicios.map((s) => s.categoria).filter(Boolean))],
    [servicios],
  )

  const heroServicios = useMemo(() => {
    const conFoto = servicios.filter((s) => s.foto_url)
    const elegidos = []
    const vistos = new Set()

    function agregar(servicio, etiquetaHero) {
      if (!servicio || vistos.has(servicio.id) || elegidos.length >= MAX_HERO) return
      vistos.add(servicio.id)
      elegidos.push({ ...servicio, etiquetaHero })
    }

    conFoto.filter((s) => s.en_tendencia).forEach((s) => agregar(s, 'En tendencia'))
    masPedidoIds
      .map((id) => conFoto.find((s) => s.id === id))
      .forEach((s) => agregar(s, 'Lo más pedido'))
    conFoto.forEach((s) => agregar(s, 'Recomendado'))

    return elegidos
  }, [servicios, masPedidoIds])
  const heroIdxSeguro = heroServicios.length ? heroIdx % heroServicios.length : 0
  const heroActual = heroServicios[heroIdxSeguro]

  // Carrusel automático cada 5s — heroTick fuerza reiniciar el timer al
  // elegir una foto a mano (barra o miniatura), igual que el lienzo
  // aprobado (arm()).
  useEffect(() => {
    if (heroServicios.length < 2) return undefined
    const id = setInterval(() => {
      setHeroIdx((indice) => (indice + 1) % heroServicios.length)
    }, INTERVALO_HERO_MS)
    return () => clearInterval(id)
  }, [heroServicios.length, heroTick])

  function irAHero(indice) {
    setHeroIdx(indice)
    setHeroTick((valor) => valor + 1)
  }

  async function reservarHero() {
    if (!heroActual) return
    const yaEsta = serviciosCarrito.has(heroActual.id)
    if (!yaEsta) await agregarServicio(heroActual.id)
  }

  const terminoQ = busqueda.trim().toLowerCase()
  const agrupado = categoriaActiva === 'todos' && !terminoQ

  const listaFiltrada = useMemo(
    () =>
      servicios.filter(
        (s) =>
          (categoriaActiva === 'todos' || s.categoria === categoriaActiva) &&
          (!terminoQ || s.nombre.toLowerCase().includes(terminoQ)),
      ),
    [servicios, categoriaActiva, terminoQ],
  )

  // Orden dentro de cada fila de categoría: el README dejaba pendiente
  // elegir entre un campo manual (servicios.orden) o "los más pedidos
  // primero" — se optó por la segunda sin sumar una columna nueva,
  // reutilizando el mismo ranking de servicios_mas_pedidos() que ya
  // trajo el hero (masPedidoIds); el resto se ordena alfabético.
  const grupos = useMemo(() => {
    if (!agrupado) return []
    const rango = new Map(masPedidoIds.map((id, indice) => [id, indice]))
    return categorias
      .slice(1)
      .map((categoria) => {
        const todos = [...servicios.filter((s) => s.categoria === categoria)].sort((a, b) => {
          const rangoA = rango.has(a.id) ? rango.get(a.id) : Infinity
          const rangoB = rango.has(b.id) ? rango.get(b.id) : Infinity
          return rangoA !== rangoB ? rangoA - rangoB : a.nombre.localeCompare(b.nombre)
        })
        return { categoria, todos, primeros: todos.slice(0, POR_FILA) }
      })
      .filter((grupo) => grupo.todos.length > 0)
  }, [agrupado, categorias, servicios, masPedidoIds])

  // Clasifica cada fila de categoría UNA sola vez en la vida de esta
  // instancia (hook genérico, ver docs/patrones/animacion-entrada.md):
  // las que ya se ven en el primer pantallazo al entrar a "Todos" usan
  // los retrasos de carga (1000/1050 + gi·220, aplicados abajo con `gi`
  // de este mismo `grupos.map`); las que quedan más abajo se animan
  // recién cuando entran en pantalla, con los retrasos contados desde
  // ahí (encabezado 0ms, tarjetas 120 + k·90ms) — docs/diseno-servicios/
  // README.md, "Reglas para la app". Categorías ya clasificadas se
  // saltan siempre: por eso cambiar de categoría y volver a "Todos" no
  // repite nada, aunque la fila se vuelva a montar.
  const clavesFilas = useMemo(() => grupos.map((grupo) => grupo.categoria), [grupos])
  const { contenedorRef, refFila, estadoFila } = useRevelarEnPantalla({
    activo: !reducirMovimiento && agrupado,
    claves: clavesFilas,
    agotarEnMs:
      ENTRADA_FILA.fila + (grupos.length + 1) * ENTRADA_FILA.paso + ENTRADA_FILA.carta + POR_FILA * ENTRADA_FILA.entre + 1500,
  })

  const plural = (n) => `${n} ${n === 1 ? 'servicio' : 'servicios'}`
  const precioDesde = servicios.length ? Math.min(...servicios.map((s) => Number(s.precio))) : null
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
      {/* 1. HERO "Tendencias y lo más pedido" */}
      {heroActual && (
        <section className="mx-auto grid w-full max-w-[1400px] gap-8 px-4 pb-6 pt-6 sm:px-8 lg:grid-cols-[1fr_1.05fr] lg:gap-16 lg:pt-10">
          <div className="order-2 flex flex-col justify-between gap-6 lg:order-1">
            <span
              className={`text-[11px] font-semibold uppercase tracking-widest text-white/60 ${reducirMovimiento ? '' : 'in-left'}`}
              style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.eyebrow}ms` }}
            >
              Tendencias y lo más pedido
            </span>
            {/* Todos los heroServicios se apilan en la misma celda (grid-area
                1/1): la altura la da el texto más largo de cualquiera, así
                los botones de abajo nunca saltan al cambiar de foto. Solo el
                activo es visible; los demás quedan con opacity 0 esperando
                su turno (abajo, +16px) o recién habiendo salido (arriba,
                -16px) — ver docs/diseno-servicios/Main.dc.html, heroTxt. */}
            <div
              className={`grid ${reducirMovimiento ? '' : 'in-left'}`}
              style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.bloque}ms` }}
            >
              {heroServicios.map((s, i) => {
                const activo = i === heroIdxSeguro
                const saliente =
                  heroServicios.length > 2 && i === (heroIdxSeguro - 1 + heroServicios.length) % heroServicios.length
                const y = activo ? 0 : saliente ? -16 : 16
                const blur = activo ? 0 : 8
                // El retraso solo va en el bloque que ENTRA (activo): así el
                // que sale se desvanece de inmediato (0ms) y el nuevo recién
                // arranca etiqueta → título → descripción/precio.
                const dEtiqueta = activo ? 250 : 0
                const dTitulo = activo ? 350 : 0
                const dResto = activo ? 480 : 0
                const desc =
                  s.descripcion || `Uno de nuestros servicios de ${s.categoria ?? 'salón'} favoritos entre nuestras clientas.`
                const duracionTexto = formatearDuracion(s.duracion_min)

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
                  <div
                    key={s.id}
                    style={{ gridArea: '1 / 1' }}
                    aria-hidden={!activo}
                    className={`flex flex-col ${activo ? '' : 'pointer-events-none'}`}
                  >
                    <span
                      style={estiloEtiqueta}
                      className="inline-flex w-fit items-center gap-2 rounded-full bg-[#18181b] px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-widest text-[#e8e8ea]"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--lw-rose)]" />
                      {s.etiquetaHero}
                    </span>
                    {/* Mismo tag SIEMPRE (h1), sin importar `activo`: si el tag
                        cambia entre h1/p, React desmonta y remonta el nodo al
                        cambiar de bloque activo, y el navegador ya no tiene un
                        elemento continuo al que animarle la transición (salta
                        de golpe en vez de desenfocarse). El texto real de la
                        página sigue siendo uno solo (el del bloque activo,
                        únicamente sin aria-hidden). */}
                    <h1
                      style={estiloTitulo}
                      className="lw-titulo-heavitas mt-4 text-[34px] uppercase leading-[1.02] sm:text-[56px]"
                    >
                      {s.nombre}
                    </h1>
                    <p style={estiloDescripcion} className="mt-4 max-w-[44ch] text-sm leading-relaxed text-[#d9d9dc] sm:text-[15px]">
                      {desc}
                    </p>
                    <span style={estiloPrecio} className="mt-3.5 text-[13px] text-white/60">
                      desde <b className="font-semibold text-white">{formatearSoles(s.precio)}</b>
                      {duracionTexto && ` · ${duracionTexto}`}
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
                onClick={reservarHero}
                className="flex items-center justify-between gap-3 rounded-full py-1.5 pl-6 pr-1.5 text-sm font-semibold text-black"
                style={{ background: 'var(--lw-gold)' }}
              >
                Reservar cita
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0b0b0c] text-[var(--lw-gold)]">
                  <CalendarPlus className="h-[15px] w-[15px]" />
                </span>
              </button>
              <Link
                to={`/servicios/${heroActual.id}`}
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
              <span className="font-medium text-[#e8e8ea]">{plural(servicios.length)}</span>
              {precioDesde != null && (
                <>
                  <span>·</span>
                  <span>desde {formatearSoles(precioDesde)}</span>
                </>
              )}
              {horarioTexto && (
                <>
                  <span>·</span>
                  <span>{horarioTexto}</span>
                </>
              )}
            </div>
          </div>

          <div
            className={`order-1 relative h-[300px] overflow-hidden rounded-[18px] bg-[#050505] sm:h-[420px] lg:order-2 lg:h-[600px] lg:rounded-[22px] ${reducirMovimiento ? '' : 'in-photo'}`}
            style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.foto}ms` }}
          >
            {heroServicios.map((s, i) => (
              <div key={s.id} className="absolute inset-0" style={{ opacity: i === heroIdxSeguro ? 1 : 0, transition: 'opacity 1.1s ease' }}>
                <img
                  src={urlPublicaFoto(BUCKET_FOTOS, s.foto_url)}
                  alt={s.nombre}
                  className="h-full w-full object-cover"
                  style={{
                    transform: `scale(${i === heroIdxSeguro ? 1 : 1.06})`,
                    transition: 'transform 6s ease-out',
                  }}
                />
              </div>
            ))}
            <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/70" />

            {heroServicios.length > 1 && (
              <div className="absolute inset-x-4 top-3.5 flex gap-1.5">
                {heroServicios.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => irAHero(i)}
                    aria-label={`Ir a ${s.nombre}`}
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
                {String(heroIdxSeguro + 1).padStart(2, '0')} / {String(heroServicios.length).padStart(2, '0')}
              </span>
              <span className="normal-case tracking-normal text-[#eeeeee]">
                desde <b className="font-semibold">{formatearSoles(heroActual.precio)}</b>
                {formatearDuracion(heroActual.duracion_min) && ` · ${formatearDuracion(heroActual.duracion_min)}`}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* 2. FILTROS (sticky) — la franja (fondo/borde) va a todo el ancho,
          pero su contenido se centra a 1700px, igual que el header. */}
      <div
        id="catalogo"
        className={`sticky top-0 z-10 border-y border-white/10 bg-[#0b0b0c]/90 px-4 py-3 backdrop-blur sm:px-8 ${reducirMovimiento ? '' : 'in-up'}`}
        style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.filtros}ms` }}
      >
        <div className="mx-auto flex w-full max-w-[1700px] flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            {categorias.map((categoria) => {
              const activa = categoriaActiva === categoria
              return (
                <button
                  key={categoria}
                  type="button"
                  onClick={() => setCategoriaActiva(categoria)}
                  className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                    activa ? 'bg-white text-black' : 'bg-[#18181b] text-[#d6d6da] hover:text-white'
                  }`}
                >
                  {categoria === 'todos' ? 'Todos' : categoria}
                </button>
              )
            })}
          </div>
          <label className="flex h-[38px] w-full items-center gap-2 rounded-full bg-[#18181b] px-3.5 text-white/50 sm:w-[230px]">
            <Search className="h-[15px] w-[15px] shrink-0" />
            <input
              type="text"
              value={busqueda}
              onChange={(evento) => setBusqueda(evento.target.value)}
              placeholder="Buscar servicio…"
              aria-label="Buscar servicio"
              className="w-full min-w-0 bg-transparent text-[13px] text-white outline-none placeholder:text-white/40"
            />
            {busqueda && (
              <button type="button" onClick={() => setBusqueda('')} aria-label="Limpiar" className="shrink-0 hover:text-white">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>
          <span className="hidden shrink-0 text-[11px] uppercase tracking-wider text-white/50 sm:inline">
            {plural(agrupado ? servicios.length : listaFiltrada.length)}
          </span>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1700px] px-4 sm:px-8">
        {/* 3a. "Todos": una fila por categoría */}
        {agrupado && (
          <div className="flex flex-col gap-10 pt-8">
            {grupos.map((grupo, gi) => {
              // Clasificación de esta fila (ver el efecto de arriba): sin
              // decisión todavía = pendiente (oculta, sin parpadeo);
              // decidida y no agotada = jugando su animación por primera
              // vez; agotada = ya se animó antes (categoría revisitada
              // tras cambiar de categoría y volver a "Todos") — se
              // renderiza estática, sin clases ni retrasos.
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
                    {grupo.primeros.map((s, k) => {
                      const claseTarjeta = listo ? (esDesktop ? (k < 2 ? 'in-left' : 'in-right') : 'in-right') : ''
                      const delayTarjeta = delayBase + ENTRADA_FILA.carta + k * ENTRADA_FILA.entre
                      return (
                        <div
                          key={s.id}
                          className={`w-[150px] shrink-0 sm:w-auto ${claseTarjeta}`}
                          style={listo ? { animationDelay: `${delayTarjeta}ms` } : undefined}
                        >
                          <TarjetaServicioCliente servicio={s} />
                        </div>
                      )
                    })}
                    {grupo.todos.length > POR_FILA && (
                      <button
                        type="button"
                        onClick={() => setCategoriaActiva(grupo.categoria)}
                        className={`flex h-[150px] w-[120px] shrink-0 flex-col items-center justify-center gap-2.5 rounded-[10px] border border-dashed border-white/15 bg-[#111113] text-xs font-semibold text-white sm:hidden ${listo ? 'in-right' : ''}`}
                        style={
                          listo
                            ? { animationDelay: `${delayBase + ENTRADA_FILA.carta + POR_FILA * ENTRADA_FILA.entre}ms` }
                            : undefined
                        }
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
                <h2 className="lw-titulo-heavitas text-lg uppercase sm:text-[22px]">
                  {terminoQ ? 'Resultados' : categoriaActiva}
                </h2>
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
                {listaFiltrada.map((s) => (
                  <TarjetaServicioCliente key={s.id} servicio={s} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* 4. CÓMO RESERVAR */}
        <section className="mt-16 border-t border-white/10 pt-10">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-white/60">Así de simple</span>
          <h2 className="lw-titulo-heavitas mt-2.5 text-2xl uppercase">Cómo reservar</h2>
          <div className="mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            {[
              {
                paso: 'Paso 1',
                titulo: 'Elige tus servicios',
                texto: 'Toca un servicio (o la flecha ↗) para ver todos sus detalles y agrégalo a tu cita. Puedes combinar varios.',
              },
              {
                paso: 'Paso 2',
                titulo: 'Escoge día y hora',
                texto: 'En Citas ves los horarios libres según la duración total de lo que elegiste.',
              },
              {
                paso: 'Paso 3',
                titulo: 'Confirma y listo',
                texto: 'Te llega la confirmación en Notificaciones y sumas puntos de fidelidad con cada visita.',
              },
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
              <h2 className="lw-titulo-heavitas text-3xl uppercase leading-[1.05] sm:text-[46px]">¿No encuentras tu servicio?</h2>
              <p className="text-sm leading-relaxed text-white/60 sm:text-[15px]">
                ¿En qué podemos ayudarte hoy? Cuéntanos qué buscas y te orientamos con el servicio ideal, o resolvemos tus
                dudas sobre reservas y pagos.
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
              <p className="mb-1 text-[13px] leading-relaxed text-white/60">
                Te recomendamos el servicio según tu cabello, piel o la ocasión, y te ayudamos a reservar.
              </p>
              {whatsapp ? (
                <a
                  href={`https://wa.me/${whatsapp}?text=${encodeURIComponent('Hola, tengo una duda sobre sus servicios.')}`}
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
                {contacto?.direccion || contacto?.telefono
                  ? [contacto?.direccion, contacto?.telefono].filter(Boolean).join(' · ')
                  : 'Llámanos o visítanos. Te atendemos en el mismo horario.'}
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
              <p className="mb-1 text-[13px] leading-relaxed text-white/60">
                Reservas, pagos, cambios y cancelaciones: todo en un solo lugar.
              </p>
              <span className="self-start rounded-full border border-dashed border-white/15 px-5 py-2.5 text-[13px] font-semibold text-white/50">
                Muy pronto
              </span>
            </div>
          </div>
        </section>
      </div>

      <PieClienteWeb />

      <BarraTuCitaFlotante servicios={servicios} />
    </div>
  )
}
