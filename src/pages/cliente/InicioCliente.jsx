import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, CalendarPlus, MapPin, MessageCircle, Ticket, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { leerServicios } from '../../lib/buscarServicios.js'
import { obtenerMiClienteId } from '../../lib/clienteWeb.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { useTemaWeb } from '../../context/TemaWebContext.jsx'
import { useToast } from '../../context/ToastContext.jsx'
import { usePerfilCliente } from '../../context/PerfilClienteContext.jsx'
import { useCarritoCliente } from '../../context/CarritoClienteContext.jsx'
import { useEntornoAnimacion } from '../../hooks/useEntornoAnimacion.js'
import { useRequerirSesion } from '../../hooks/useRequerirSesion.js'
import { useSecuenciaScroll } from '../../hooks/useSecuenciaScroll.js'
import { useProgramaRecompensas } from '../../hooks/useProgramaRecompensas.js'
import { formatearCantidad } from '../../lib/programaRecompensas.js'
import { formatearSoles } from '../../lib/moneda.js'
import { formatearDias, formatearHora, numeroWhatsapp } from '../../lib/contactoNegocio.js'
import { resolverUrlGaleria } from '../../lib/imagenes.js'
import { nombrePublico } from '../../lib/resenas.js'
import Estrellas from '../../components/Estrellas.jsx'
import TarjetaServicioCliente from '../../components/TarjetaServicioCliente.jsx'
import ShinyText from '../../components/ShinyText.jsx'
import PieClienteWeb from './PieClienteWeb.jsx'

// Fotos de referencia del hero antes/después (§7.36 implementacionesWed.md)
// — material de stock aprobado por el negocio para esta primera versión,
// no fotos reales de una clienta. Reemplazar en cuanto existan fotos
// reales del salón (mismo pendiente que la Galería de "Resultados reales").
const FOTO_DESPUES = `${import.meta.env.BASE_URL}inicio-web/hero-despues-referencia.jpg`
const FOTO_ANTES = `${import.meta.env.BASE_URL}inicio-web/hero-antes-referencia.jpg`
// Tema claro del portal: mismas tomas con fondo blanco.
const FOTO_DESPUES_CLARA = `${import.meta.env.BASE_URL}inicio-web/despues-claro.webp`
const FOTO_ANTES_CLARA = `${import.meta.env.BASE_URL}inicio-web/antes-claro.webp`
const RADIO_REVELADO = 340

// Revela la foto "antes" bajo el cursor sin re-renderizar React en cada
// movimiento: interpola posición y radio a mano y escribe el resultado
// directo en el style de la imagen "antes" (vía mask-image). Mecanismo
// interno conservado tal cual (docs/diseno-inicio/README.md: "se conserva
// el efecto antes/después que YA existe"), pero expuesto como CALLBACK
// REFS (useState, no useRef) — bug real encontrado en esta pantalla: con
// `useRef`, el objeto ref nunca cambia de identidad entre renders, así
// que un useEffect con `[contenedorRef, imagenAntesRef]` como dependencias
// corre UNA sola vez y no vuelve a dispararse. Como este componente
// muestra un "Cargando..." (otro árbol de JSX) mientras `cargando` es
// true, esa primera — y única — ejecución del efecto encontraba los refs
// en null (el hero real todavía no existía) y nunca reaccionaba cuando el
// hero se montaba de verdad: el mask nunca se aplicaba y la foto "antes"
// quedaba tapando a "después" para siempre, sin reaccionar al mouse. Con
// callback refs (funciones que React invoca cada vez que el nodo se
// monta/desmonta) guardadas en estado, el efecto sí vuelve a correr en
// cuanto el hero real aparece.
function useRevelarAntes() {
  const [contenedor, setContenedor] = useState(null)
  const [imagenAntes, setImagenAntes] = useState(null)

  useEffect(() => {
    if (!contenedor || !imagenAntes) return undefined

    const objetivo = { x: contenedor.clientWidth, y: contenedor.clientHeight / 2 }
    const suave = { x: objetivo.x, y: objetivo.y }
    let activo = 0
    let destino = 0
    let animId

    function moverA(clienteX, clienteY) {
      const rect = contenedor.getBoundingClientRect()
      objetivo.x = clienteX - rect.left
      objetivo.y = clienteY - rect.top
    }
    // Solo mouse/lápiz: en touch, un "pointerdown+move" es indistinguible
    // de la intención de hacer scroll — se ignora ahí (el hint de abajo
    // también se esconde en móvil, así que no se promete un gesto que no
    // existe).
    function esTactil(evento) {
      return evento.pointerType === 'touch'
    }
    function alMover(evento) {
      if (esTactil(evento)) return
      moverA(evento.clientX, evento.clientY)
      destino = 1
    }
    function alSoltar(evento) {
      if (esTactil(evento)) return
      destino = 0
    }

    function tick() {
      suave.x += (objetivo.x - suave.x) * 0.12
      suave.y += (objetivo.y - suave.y) * 0.12
      activo += (destino - activo) * 0.12
      const radio = Math.round(RADIO_REVELADO * activo)
      const x = suave.x.toFixed(1)
      const y = suave.y.toFixed(1)
      const mascara =
        radio < 2
          ? 'linear-gradient(transparent, transparent)'
          : `radial-gradient(circle ${radio}px at ${x}px ${y}px, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 40%, rgba(0,0,0,0.75) 60%, rgba(0,0,0,0.4) 75%, rgba(0,0,0,0.12) 88%, rgba(0,0,0,0) 100%)`
      imagenAntes.style.maskImage = mascara
      imagenAntes.style.webkitMaskImage = mascara
      animId = requestAnimationFrame(tick)
    }
    animId = requestAnimationFrame(tick)

    contenedor.addEventListener('pointermove', alMover)
    contenedor.addEventListener('pointerdown', alMover)
    contenedor.addEventListener('pointerup', alSoltar)
    contenedor.addEventListener('pointerleave', alSoltar)
    contenedor.addEventListener('pointercancel', alSoltar)
    return () => {
      cancelAnimationFrame(animId)
      contenedor.removeEventListener('pointermove', alMover)
      contenedor.removeEventListener('pointerdown', alMover)
      contenedor.removeEventListener('pointerup', alSoltar)
      contenedor.removeEventListener('pointerleave', alSoltar)
      contenedor.removeEventListener('pointercancel', alSoltar)
    }
  }, [contenedor, imagenAntes])

  return { contenedorHeroRef: setContenedor, imagenAntesRef: setImagenAntes }
}

// Acento de esquina arriba/abajo del bloque de título — pedido explícito
// del usuario en una sesión anterior (§7.39 implementacionesWed.md),
// conservado tal cual.
function EsquinaBracket({ voltear = false }) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      className="text-white h-[14px] w-[14px] shrink-0 max-[640px]:h-[6px] max-[640px]:w-[6px]"
    >
      <path d={voltear ? 'M0 0.5V11.5H11.5' : 'M0 11.5V0.5H11.5'} />
    </svg>
  )
}

const formatoFechaCitaLarga = new Intl.DateTimeFormat('es-PE', {
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  timeZone: 'America/Lima',
})
const formatoFechaCitaCorta = new Intl.DateTimeFormat('es-PE', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'America/Lima',
})
const formatoFechaResena = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'America/Lima',
})
const formatoHoraCita = new Intl.DateTimeFormat('es-PE', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Lima',
})

function formatearValorPromocion(promocion) {
  return promocion.tipo_descuento === 'PORCENTAJE' ? `${promocion.valor}%` : formatearSoles(promocion.valor)
}

function PuntosAvance({ puntos }) {
  return (
    <span aria-live="polite" className="inline-flex items-center gap-2.5 text-[11px] uppercase tracking-widest text-white/60">
      <span className="flex gap-1">
        {puntos.map((caido, i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full transition-colors"
            style={{ background: caido ? 'var(--lw-gold)' : '#2e2e33' }}
          />
        ))}
      </span>
      Sigue deslizando
    </span>
  )
}

// Rediseño de Inicio (docs/diseno-inicio/README.md): Hero (foto/efecto
// antes-después existente + copy nuevo) → tira personal → promoción
// activa → lo más pedido → resultados reales (animación por scroll,
// useSecuenciaScroll.js) → reseñas → sobre nosotros → visítanos → pie.
// Reemplaza por completo el hero full-bleed + las 4 secciones de
// video/filosofía anteriores (ver git blame) — ese material era stock
// genérico sin relación con el salón; el usuario pidió un solo bloque de
// marca corto en su lugar. Nada de lo mostrado se inventa: cada dato que
// puede faltar (reseñas, próxima cita, promoción, fotos de resultados,
// contacto) oculta su línea o su sección entera en vez de mostrar un
// placeholder falso.
// Posiciones de las chispas del cupón de promoción (mismo patrón que
// CHISPAS_ORO en EnvolturaCupon.jsx, un poco más repartidas por ser una
// tarjeta ancha).
const CHISPAS_PROMO = [
  { top: '-8px', left: '40px', size: 13 },
  { top: '-6px', right: '28%', size: 9, delay: '-1.4s' },
  { top: '12px', right: '-10px', size: 10, delay: '-0.9s' },
  { bottom: '-8px', right: '90px', size: 12, delay: '-1.8s' },
  { bottom: '-7px', left: '30%', size: 9, delay: '-2.4s' },
]

export default function InicioCliente() {
  const { mostrarToast } = useToast()
  const { perfil } = usePerfilCliente()
  const { serviciosCarrito } = useCarritoCliente()
  const { reducirMovimiento, esDesktop } = useEntornoAnimacion()
  const { tema } = useTemaWeb()
  const esClaro = tema === 'claro'

  const contenedorRef = useRef(null)
  const { contenedorHeroRef, imagenAntesRef } = useRevelarAntes()

  const [cargando, setCargando] = useState(true)
  const [topServicios, setTopServicios] = useState([])
  const [proximaCita, setProximaCita] = useState(null)
  const [puntosCliente, setPuntosCliente] = useState(null)
  const { session, usuario } = useAuth()
  const usuarioId = usuario?.id ?? null
  const requerirSesion = useRequerirSesion()
  // Con el programa activo mis_puntos().puntos es el saldo GASTABLE: aquí se muestra como monedas, con su propio nombre.
  const programa = useProgramaRecompensas(session?.user?.id ?? null)
  const saldoProg = programa.saldo.estado === 'ok' ? programa.saldo.datos : null
  const [promocion, setPromocion] = useState(null)
  const [cuponPromocion, setCuponPromocion] = useState(null)
  const [reclamando, setReclamando] = useState(false)
  const [resenas, setResenas] = useState([])
  // Tarjetas de "Lo que dicen nuestras clientas": reseñas con fecha y servicio.
  const [resenasTarjetas, setResenasTarjetas] = useState([])
  const [galeria, setGaleria] = useState([])
  const [contacto, setContacto] = useState(null)
  const [horario, setHorario] = useState(null)

  useEffect(() => {
    let vigente = true

    async function cargar() {
      const ahoraIso = new Date().toISOString()
      // Visitante: solo contenido público. Nada de lo personal (próxima cita, puntos,
      // cupones) se consulta sin sesión.
      const miId = usuarioId ? await obtenerMiClienteId() : null
      const [
        serviciosRes,
        masPedidoRes,
        proximaCitaRes,
        puntosRes,
        promocionesRes,
        cuponesRes,
        resenasRes,
        resenasInicioRes,
        galeriaRes,
        contactoRes,
        horarioRes,
      ] = await Promise.all([
        leerServicios(supabase, { columnas: 'id, nombre, categoria, precio, duracion_min, foto_url', soloActivos: true }).then(
          (data) => ({ data }),
          () => ({ data: [] }),
        ),
        supabase.rpc('servicios_mas_pedidos', { dias: 30 }),
        miId
          ? supabase
              .from('citas')
              .select('id, fecha_hora, cita_servicios(servicios(nombre))')
              .eq('cliente_id', miId)
              .gte('fecha_hora', ahoraIso)
              .in('estado', ['PENDIENTE', 'CONFIRMADA'])
              .order('fecha_hora')
              .limit(1)
          : Promise.resolve({ data: [] }),
        usuarioId ? supabase.rpc('mis_puntos') : Promise.resolve({ data: [] }),
        supabase
          .from('promociones')
          .select('id, titulo, descripcion, tipo_descuento, valor, vigente_hasta')
          .order('vigente_hasta', { ascending: true, nullsFirst: false }),
        usuarioId ? supabase.rpc('mis_cupones') : Promise.resolve({ data: [] }),
        supabase.rpc('resenas_publicas'),
        supabase.rpc('resenas_inicio'),
        supabase.rpc('galeria_para_web'),
        supabase.rpc('datos_contacto'),
        supabase.rpc('horario_atencion'),
      ])

      if (!vigente) return

      const servicios = serviciosRes.data ?? []
      const masPedidoIds = (masPedidoRes.data ?? []).map((fila) => fila.servicio_id)
      setTopServicios(
        masPedidoIds
          .map((id) => servicios.find((s) => s.id === id))
          .filter(Boolean)
          .slice(0, 4),
      )

      setProximaCita(proximaCitaRes.data?.[0] ?? null)
      setPuntosCliente(puntosRes.data?.[0] ?? null)

      const promocionActiva = promocionesRes.data?.[0] ?? null
      setPromocion(promocionActiva)
      if (promocionActiva) {
        // promocion_id todavía no existe en mis_cupones() hasta aplicar
        // 127_reclamar_cupon_promocion.sql — hasta entonces esto no
        // encuentra nada y el botón siempre parte en "Reclamar cupón".
        const cuponExistente = (cuponesRes.data ?? []).find((c) => c.promocion_id === promocionActiva.id)
        setCuponPromocion(cuponExistente ?? null)
      }

      setResenas(resenasRes.data ?? [])
      // Si resenas_inicio() aún no está aplicada en la base, se cae a las
      // reseñas generales (sin servicio) en vez de dejar la sección vacía.
      setResenasTarjetas(resenasInicioRes.error ? (resenasRes.data ?? []) : (resenasInicioRes.data ?? []))
      // El diseño aprobado son 3 parejas (tope acá), pero el negocio las
      // está cargando de a poco en Galería Web — se muestran las que ya
      // existan (mínimo 1) en vez de exigir las 3 completas.
      setGaleria((galeriaRes.data ?? []).slice(0, 3))
      setContacto(contactoRes.data?.[0] ?? null)
      setHorario(horarioRes.data?.[0] ?? null)
      setCargando(false)
    }

    cargar()
    return () => {
      vigente = false
    }
  }, [usuarioId])

  const ENTRADA_FIJA = esDesktop
    ? { foto: 200, eyebrow: 150, titulo: 300, subtitulo: 420, botones: 540, confianza: 680, tira: 850, promo: 950 }
    : { foto: 100, eyebrow: 350, titulo: 480, subtitulo: 560, botones: 650, confianza: 780, tira: 900, promo: 1000 }

  const { primeraFotoRef, filaRef, estadoFoto, claseSacudida, enCurso, puntos } = useSecuenciaScroll({
    activo: !cargando && galeria.length > 0,
    reducirMovimiento,
    totalFotos: galeria.length * 2,
  })

  // QA-023: las fotos de la galería (bajo el contenido inicial) se descargaban al
  // abrir Inicio aunque nadie bajara. loading="lazy" no basta: el umbral nativo
  // de Chrome (~1250 px o más) las traía igual (la galería queda a ~1000-1400 px).
  // Reciben su src cuando la galería se acerca a 300 px de la pantalla; los
  // contenedores tienen alto fijo y fondo, así que no hay salto de diseño.
  const [galeriaCerca, setGaleriaCerca] = useState(false)
  useEffect(() => {
    if (galeriaCerca || cargando || galeria.length === 0) return undefined
    const fila = filaRef.current
    if (!fila) return undefined
    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((entrada) => entrada.isIntersecting)) {
          setGaleriaCerca(true)
          observador.disconnect()
        }
      },
      { rootMargin: '300px 0px' },
    )
    observador.observe(fila)
    return () => observador.disconnect()
  }, [galeriaCerca, cargando, galeria.length, filaRef])

  async function reclamarCupon() {
    if (!promocion || reclamando) return
    if (!requerirSesion('reclamar este cupón')) return
    setReclamando(true)
    const { data, error } = await supabase.rpc('reclamar_cupon_promocion', { p_promocion_id: promocion.id })
    setReclamando(false)
    if (error) {
      mostrarToast(error.message || 'No se pudo reclamar el cupón. Intenta de nuevo.', 'error')
      return
    }
    setCuponPromocion(data?.[0] ?? null)
    mostrarToast('Cupón guardado en Mis cupones.', 'exito')
  }

  if (cargando) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-mono text-sm text-white/50">Cargando...</p>
      </div>
    )
  }

  const nombreCliente = perfil?.nombre ? perfil.nombre.trim().split(/\s+/)[0] : null
  const destinoReservar = serviciosCarrito.size > 0 ? '/citas/carrito' : '/servicios'

  const promedioResenas = resenas.length ? resenas.reduce((suma, r) => suma + r.calificacion, 0) / resenas.length : null
  const horarioTexto = horario
    ? `${formatearDias(horario.dias_atencion)} ${formatearHora(horario.bloque1_inicio)}-${formatearHora(horario.bloque1_fin)}${
        horario.bloque2_inicio ? ` · ${formatearHora(horario.bloque2_inicio)}-${formatearHora(horario.bloque2_fin)}` : ''
      }`
    : null

  const hayLineaConfianza = Boolean(horarioTexto)
  const whatsapp = contacto?.telefono ? numeroWhatsapp(contacto.telefono) : null
  const hayVisitanos = Boolean(contacto?.direccion || horarioTexto || contacto?.telefono)

  return (
    <div ref={contenedorRef} className="landing-web flex-1 overflow-y-auto">
      {/* 1. HERO — una sola pieza: la foto (con el efecto antes/después
          existente) es el FONDO COMPLETO de la sección, no una caja
          separada; el texto flota encima, sobre la franja negra que ya
          trae la propia foto del lado izquierdo (mismo mecanismo y
          fotos de siempre — solo se agregó etiqueta, subtítulo, botón
          "Ver servicios" y la línea de confianza al bloque de texto). */}
      <section
        ref={contenedorHeroRef}
        className={`${esClaro ? '' : 'lw-sobre-foto '}relative mx-auto flex aspect-[1680/944] w-full max-w-[1800px] cursor-crosshair flex-col lw-gutter ${esClaro ? 'bg-transparent' : 'bg-[#0b0b0c]'}`}
      >
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          <img
            src={esClaro ? FOTO_DESPUES_CLARA : FOTO_DESPUES}
            alt="Resultado después del servicio"
            className="absolute inset-0 h-full w-full object-cover object-[right_center]"
          />
          <img
            ref={imagenAntesRef}
            src={esClaro ? FOTO_ANTES_CLARA : FOTO_ANTES}
            alt=""
            aria-hidden="true"
            style={{ filter: 'grayscale(0.35) brightness(0.97)' }}
            className="absolute inset-0 h-full w-full object-cover object-[right_center]"
          />
        </div>

        <div className="relative z-10 mx-auto flex w-full max-w-[1700px] flex-1 flex-col justify-center gap-[clamp(10px,1.8vw,20px)] py-[clamp(16px,3vw,40px)]">
          <div className="flex flex-col items-start gap-[clamp(10px,1.8vw,20px)] md:max-w-3xl">
            <div
              className={`flex flex-col items-start gap-2 ${reducirMovimiento ? '' : 'in-left'}`}
              style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.titulo}ms` }}
            >
              <EsquinaBracket />
              <h1 className="lw-titulo-kunaroh text-[clamp(38px,6vw,90px)] leading-[1.03] text-white">
                <span className="block">Belleza</span>
                <span className="block">que</span>
                <span className="block">transforma</span>
              </h1>
              <EsquinaBracket voltear />
            </div>

            <div
              className={`flex flex-col gap-2.5 sm:flex-row sm:items-center ${reducirMovimiento ? '' : 'in-left'}`}
              style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.botones}ms` }}
            >
              <Link to="/citas" className="lw-cta-hero">
                <ShinyText text="Reserva tu cita" speed={3} delay={1.5} className="lw-cta-shiny" />
                <ArrowUpRight className="lw-cta-flecha h-4 w-4" />
              </Link>
              <Link
                to="/servicios"
                className="rounded-full border border-white/15 px-6 py-3.5 text-center text-sm text-[#e8e8ea] transition-colors hover:border-white hover:bg-white hover:text-black"
              >
                Ver servicios
              </Link>
            </div>

            {hayLineaConfianza && (
              <div
                className={`flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/10 pt-4 text-[13px] text-[#a6a6a6] ${
                  reducirMovimiento ? '' : 'in-left'
                }`}
                style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.confianza}ms` }}
              >
                {horarioTexto && <span>{horarioTexto}</span>}
              </div>
            )}
          </div>
        </div>

        <div className="lw-hint-cursor absolute bottom-8 right-8 z-10 hidden sm:flex">
          <svg width="40" height="40" viewBox="0 0 64 64" fill="none" stroke="#f5f5f4" strokeWidth="1.2" className="shrink-0" aria-hidden="true">
            <circle cx="32" cy="32" r="28" />
            <circle cx="32" cy="32" r="18" strokeDasharray="3 3" />
            <path d="M32 4v56" />
            <path d="M26 26l14 6-6 2-2 6z" fill="#8b8b3d" />
          </svg>
          <div>
            <div>Pasa el cursor.</div>
            <div>Mira su antes.</div>
          </div>
        </div>
      </section>

      {/* 2. TIRA PERSONAL — mismo ancho de columna (max-w-[1700px] con el
          mismo padding lateral) que el resto de secciones de la página;
          el padding de la propia <section> es el respiro INTERNO de la
          caja, no el margen contra el borde de pantalla. */}
      <div className="mx-auto mt-8 w-full max-w-[1700px] lw-gutter">
        <section
          className={`flex flex-col gap-4 rounded-[10px] border border-white/10 bg-[#111113] p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] sm:flex-row sm:items-center sm:gap-7 sm:p-[22px_28px] ${
            reducirMovimiento ? '' : 'in-up'
          }`}
          style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.tira}ms` }}
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#1b2230] text-[var(--lw-gold)]">
            <CalendarPlus className="h-5 w-5" />
          </span>
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-base font-semibold text-white">Hola{nombreCliente ? `, ${nombreCliente}` : ''}</span>
            {proximaCita ? (
              <span className="text-[13.5px] text-[#a6a6a6]">
                Tu próxima cita:{' '}
                <b className="font-semibold text-white">
                  {(esDesktop ? formatoFechaCitaLarga : formatoFechaCitaCorta).format(new Date(proximaCita.fecha_hora))} ·{' '}
                  {formatoHoraCita.format(new Date(proximaCita.fecha_hora))}
                </b>
                {(proximaCita.cita_servicios ?? []).length > 0 &&
                  ` · ${proximaCita.cita_servicios.map((cs) => cs.servicios?.nombre).filter(Boolean).join(', ')}`}
              </span>
            ) : (
              <span className="text-[13.5px] text-[#a6a6a6]">No tienes citas pendientes. ¿Agendamos la próxima?</span>
            )}
          </div>
          {programa.activo === false && puntosCliente && (
            <div className="flex items-center gap-1.5 border-white/10 sm:flex-col sm:items-end sm:gap-0.5 sm:border-l sm:px-6">
              <span className="text-xl font-bold text-white">{puntosCliente.puntos}</span>
              <span className="text-[11px] uppercase tracking-widest text-[#a6a6a6]">Mis puntos</span>
            </div>
          )}
          {programa.activo === true && saldoProg && (
            <div className="flex items-center gap-1.5 border-white/10 sm:flex-col sm:items-end sm:gap-0.5 sm:border-l sm:px-6">
              <span className="text-xl font-bold text-white">{formatearCantidad(saldoProg.monedas)}</span>
              <span className="text-[11px] uppercase tracking-widest text-[#a6a6a6]">Mis monedas</span>
            </div>
          )}
          {proximaCita ? (
            <Link
              to="/citas"
              className="shrink-0 rounded-full border border-white/15 px-[22px] py-3 text-center text-sm text-[#e8e8ea] transition-colors hover:border-white/30"
            >
              Ver mi cita
            </Link>
          ) : (
            <Link
              to={destinoReservar}
              className="shrink-0 rounded-full bg-[var(--lw-gold)] px-[22px] py-3 text-center text-sm font-semibold text-black"
            >
              Reservar
            </Link>
          )}
        </section>
      </div>

      {/* 2b. PROMOCIÓN ACTIVA — solo si hay una vigente (RLS de
          promociones ya filtra activo/vigente_desde/vigente_hasta). */}
      {promocion && (
        <div className="mx-auto mt-4 w-full max-w-[1700px] lw-gutter">
        {/* La entrada (in-up) va en este contenedor y NO en la <section>:
            .cupon-rojo define su propio `animation` infinito (glow) y, si
            compartiera elemento con .in-up, heredaba su iteration-count
            infinito → la entrada se repetía cada ~1 s (el parpadeo). Las
            chispas van fuera de la <section> (tiene overflow:hidden). */}
        <div
          className={`relative ${reducirMovimiento ? '' : 'in-up'}`}
          style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.promo}ms` }}
        >
        {!cuponPromocion && CHISPAS_PROMO.map((c, indice) => (
          <svg
            key={indice}
            className="cupon-chispa cupon-chispa-roja"
            style={{ position: 'absolute', top: c.top, left: c.left, right: c.right, bottom: c.bottom, width: c.size, height: c.size, animationDelay: c.delay }}
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 0C13 8 16 11 24 12C16 13 13 16 12 24C11 16 8 13 0 12C8 11 11 8 12 0Z" />
          </svg>
        ))}
        <section className={`cupon-tarjeta cupon-rojo grid rounded-[10px] lg:grid-cols-[220px_minmax(0,1fr)_auto] ${cuponPromocion ? 'cupon-rojo-canjeado' : ''}`}>
          <div className="flex items-center gap-4 border-b border-dashed border-[#ff2d3f]/40 bg-[#ff2d3f]/[0.07] px-5 py-4 lg:flex-col lg:justify-center lg:gap-1 lg:border-b-0 lg:border-r lg:py-6">
            <span
              className={`lw-titulo-heavitas cupon-texto-rojo whitespace-nowrap leading-none ${
                promocion.tipo_descuento === 'PORCENTAJE' ? 'text-[34px] lg:text-[44px]' : 'text-[26px] lg:text-[32px]'
              }`}
            >
              {formatearValorPromocion(promocion)}
            </span>
            <span className="text-[11px] uppercase tracking-[0.2em] text-[#a6a6a6]">de descuento</span>
          </div>

          <div className="flex flex-col justify-center gap-2 px-5 py-4 lg:px-8">
            <span className="inline-flex w-fit items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-[#a6a6a6]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--lw-rose)]" />
              Promoción activa
              {promocion.vigente_hasta && ` · hasta ${promocion.vigente_hasta}`}
            </span>
            <h2 className="lw-titulo-heavitas text-xl text-white lg:text-2xl">{promocion.titulo}</h2>
            {promocion.descripcion && <p className="text-sm leading-relaxed text-[#d9d9dc]">{promocion.descripcion}</p>}
          </div>

          <div className="flex flex-col justify-center gap-2.5 px-5 pb-5 lg:items-end lg:px-7 lg:pb-0">
            {cuponPromocion ? null : (
              <>
                <button
                  type="button"
                  onClick={reclamarCupon}
                  disabled={reclamando}
                  className="flex items-center justify-center gap-2.5 whitespace-nowrap rounded-full bg-[#ff2d3f] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_0_18px_-2px_rgba(255,45,63,0.6)] transition-[filter] hover:brightness-110 disabled:opacity-60"
                >
                  <Ticket className="h-[17px] w-[17px]" />
                  {reclamando ? 'Reclamando...' : 'Reclamar cupón'}
                </button>
                <span className="text-center text-xs text-[#a6a6a6] lg:text-right">Se guarda en Mis cupones</span>
              </>
            )}
          </div>

          {cuponPromocion && (
            <div
              role="status"
              className="absolute inset-0 z-10 flex items-center justify-center bg-black/65 backdrop-blur-[1px]"
            >
              <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-[#ff2d3f] bg-[#0b0b0c] px-5 py-2.5 text-sm font-semibold text-[#ff2d3f] shadow-[0_0_16px_-2px_rgba(255,45,63,0.55)]">
                <Ticket className="h-4 w-4" />
                Cupón canjeado
              </span>
            </div>
          )}
        </section>
        </div>
        </div>
      )}

      {/* 3. LO MÁS PEDIDO */}
      {topServicios.length > 0 && (
        <section className="mx-auto mt-24 w-full max-w-[1700px] lw-gutter">
          <div className="mb-7 flex items-end justify-between gap-3">
            <div className="flex flex-col gap-2.5">
              <h2 className="lw-titulo-heavitas text-2xl text-white sm:text-[40px]">Lo más pedido</h2>
            </div>
            <Link to="/servicios" className="shrink-0 text-sm text-[#e8e8ea] hover:text-white">
              Ver todos los servicios →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
            {topServicios.map((servicio) => (
              <TarjetaServicioCliente key={servicio.id} servicio={servicio} />
            ))}
          </div>
        </section>
      )}

      {/* 5. RESULTADOS REALES — animación por scroll, ver
          src/hooks/useSecuenciaScroll.js. Oculta si el negocio todavía no
          cargó ninguna pareja real en Galería Web; muestra hasta 3 (el
          diseño aprobado), pero no exige las 3 completas. Con menos de 2
          parejas (el hook lo decide con `totalFotos >= 4`), se muestran
          directas sin la secuencia de scroll fijado — con tan poco
          contenido esa animación se siente como una foto rota, no como
          un efecto. */}
      {galeria.length > 0 && (
        <section className="mx-auto mt-24 w-full max-w-[1700px] lw-gutter">
          <div className="mb-7 flex items-end justify-between gap-3">
            <div className="flex flex-col gap-2.5">
              <span className="text-[11px] uppercase tracking-[0.24em] text-[#a6a6a6]">Trabajos hechos en el salón</span>
              <h2 className="lw-titulo-heavitas text-2xl text-white sm:text-[40px]">Resultados reales</h2>
            </div>
            <div className="flex items-center gap-5">
              {enCurso && <PuntosAvance puntos={puntos} />}
              <Link to="/nosotros" className="shrink-0 text-sm text-[#e8e8ea] hover:text-white">
                Ver galería →
              </Link>
            </div>
          </div>
          <div
            ref={filaRef}
            className={`grid grid-cols-1 gap-4 lg:gap-5 ${
              { 1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2' }[galeria.length] ?? 'lg:grid-cols-3'
            } ${claseSacudida}`}
          >
            {galeria.map((item, indice) => (
              <div key={item.id} className="flex flex-col gap-3.5">
                <div className="grid h-[170px] grid-cols-2 gap-1 lg:h-[360px]">
                  <div
                    ref={indice === 0 ? primeraFotoRef : undefined}
                    className={`foto relative overflow-hidden rounded-l-[10px] bg-[#1c1c20] ${estadoFoto(indice * 2)}`}
                  >
                    <img
                      src={galeriaCerca ? resolverUrlGaleria(item.antes_url) : undefined}
                      alt={`${item.titulo ?? 'Trabajo del salón'} — antes`}
                      className="absolute inset-0 h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                    <span className="absolute left-2.5 top-2.5 rounded-[5px] bg-white/[0.08] px-[9px] py-1 text-[10px] uppercase tracking-wider text-[#e8e8ea]">
                      Antes
                    </span>
                  </div>
                  <div className={`foto relative overflow-hidden rounded-r-[10px] bg-[#222228] ${estadoFoto(indice * 2 + 1)}`}>
                    <img
                      src={galeriaCerca ? resolverUrlGaleria(item.despues_url) : undefined}
                      alt={`${item.titulo ?? 'Trabajo del salón'} — después`}
                      className="absolute inset-0 h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                    <span className="absolute left-2.5 top-2.5 rounded-[5px] bg-white/[0.08] px-[9px] py-1 text-[10px] uppercase tracking-wider text-[#e8e8ea]">
                      Después
                    </span>
                  </div>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  {item.titulo && <span className="text-[15px] font-semibold text-white">{item.titulo}</span>}
                  <Link to="/servicios" className="hidden text-[13px] text-[var(--lw-gold)] lg:inline">
                    Reservar este servicio
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 6. RESEÑAS — oculta con menos de 3 aprobadas. */}
      {resenas.length >= 3 && (
        <section className="mx-auto mt-24 w-full max-w-[1700px] lw-gutter">
          <div className="grid gap-8 lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className="flex flex-col gap-3.5">
              <h2 className="lw-titulo-heavitas text-[26px] leading-[1.1] text-white sm:text-[34px]">
                Lo que dicen nuestras clientas
              </h2>
              <div className="mt-3 flex items-baseline gap-3">
                <span className="text-[44px] font-bold leading-none text-white sm:text-[56px]">
                  {promedioResenas.toFixed(1)}
                </span>
                <div className="flex flex-col gap-1.5">
                  <Estrellas calificacion={Math.round(promedioResenas)} className="h-[15px] w-[15px]" />
                  <span className="text-[13px] text-[#a6a6a6]">
                    {resenas.length} reseñas de clientas que ya vinieron
                  </span>
                </div>
              </div>
              <Link to="/nosotros" className="mt-2.5 text-sm text-[#e8e8ea] hover:text-white">
                Ver todas las reseñas →
              </Link>
            </div>
            <div className="-mx-4 flex gap-3.5 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-5 sm:overflow-visible sm:px-0">
              {resenasTarjetas.slice(0, 3).map((resena) => (
                <figure
                  key={resena.id}
                  className="flex w-[280px] shrink-0 flex-col gap-4 rounded-[10px] border border-white/10 bg-[#111113] p-[26px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] sm:w-auto"
                >
                  <div className="flex items-center justify-between gap-3">
                    <Estrellas calificacion={resena.calificacion} className="h-[13px] w-[13px]" />
                    <span className="text-xs text-[#a6a6a6]">{formatoFechaResena.format(new Date(resena.creado_en))}</span>
                  </div>
                  {resena.servicio_nombre && (
                    <span className="-mt-2 w-fit rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-[#e8e8ea]">
                      {resena.servicio_nombre}
                    </span>
                  )}
                  <blockquote className="flex-1 text-[14.5px] leading-relaxed text-[#d9d9dc]">
                    {resena.comentario}
                  </blockquote>
                  <figcaption className="flex items-center gap-2.5 border-t border-white/10 pt-3.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1f1f22] text-xs font-semibold text-white">
                      {nombrePublico(resena.nombre).charAt(0)}
                    </span>
                    <span className="text-[13.5px] font-semibold text-white">{nombrePublico(resena.nombre)}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 7. SOBRE NOSOTROS — un solo bloque (reemplaza las 3 secciones de
          video/filosofía anteriores). */}
      <section className="mx-auto mt-24 grid w-full max-w-[1700px] items-center gap-10 lw-gutter lg:grid-cols-2 lg:gap-14">
        <div className="flex h-[260px] items-center justify-center overflow-hidden rounded-[10px] border border-white/10 bg-[#151517] text-white/25 lg:h-[480px]">
          <Users className="h-10 w-10" />
        </div>
        <div className="flex flex-col gap-4">
          <span className="text-[11px] uppercase tracking-[0.24em] text-[#a6a6a6]">Sobre nosotros</span>
          <h2 className="lw-titulo-heavitas text-[28px] leading-[1.1] text-white sm:text-[40px]">
            Cuidado y confianza en cada cita
          </h2>
          <p className="max-w-[52ch] text-[15.5px] leading-relaxed text-[#d9d9dc]">
            Creemos en escuchar antes de proponer. Cada cita empieza con una pregunta sobre lo que quieres lograr, y
            cada tratamiento se diseña a tu medida.
          </p>
          <div className="mt-1 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {[
              { n: '01', t: 'Te escuchamos', d: 'Diagnóstico antes de empezar.' },
              { n: '02', t: 'A tu medida', d: 'Diseño pensado para ti.' },
              { n: '03', t: 'Con detalle', d: 'Cuidamos el resultado final.' },
            ].map((paso) => (
              <div key={paso.n} className="flex flex-col gap-1.5 rounded-[10px] border border-white/10 bg-[#111113] p-[18px]">
                <span className="text-xs font-semibold text-[var(--lw-gold)]">{paso.n}</span>
                <span className="text-sm font-semibold text-white">{paso.t}</span>
                <span className="text-[12.5px] leading-relaxed text-[#a6a6a6]">{paso.d}</span>
              </div>
            ))}
          </div>
          <Link to="/nosotros" className="mt-1.5 text-sm text-[#e8e8ea] hover:text-white">
            Conoce al equipo →
          </Link>
        </div>
      </section>

      {/* 8. VISÍTANOS */}
      {hayVisitanos && (
        <section className="mx-auto mt-24 grid w-full max-w-[1700px] gap-5 lw-gutter lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="flex flex-col gap-5 rounded-[10px] border border-white/10 bg-[#111113] p-[26px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] sm:p-9">
            <h2 className="lw-titulo-heavitas text-[26px] text-white sm:text-[34px]">Visítanos</h2>
            <div className="flex flex-col gap-3.5 text-[14.5px] text-[#d9d9dc]">
              {contacto?.direccion && (
                <span className="flex items-start gap-3">
                  <MapPin className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[var(--lw-gold)]" />
                  {contacto.direccion}
                </span>
              )}
              {horario && (
                <span className="flex items-start gap-3">
                  <span className="mt-0.5 h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--lw-gold)]" />
                  <span>
                    {formatearDias(horario.dias_atencion)}
                    <br />
                    <span className="text-[#a6a6a6]">
                      {formatearHora(horario.bloque1_inicio)} – {formatearHora(horario.bloque1_fin)}
                      {horario.bloque2_inicio && (
                        <>
                          {' '}
                          · {formatearHora(horario.bloque2_inicio)} – {formatearHora(horario.bloque2_fin)}
                        </>
                      )}
                    </span>
                  </span>
                </span>
              )}
              {contacto?.telefono && (
                <span className="flex items-start gap-3">
                  <MessageCircle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[var(--lw-gold)]" />
                  {contacto.telefono}
                </span>
              )}
            </div>
            <div className="mt-auto flex flex-col gap-2.5 sm:flex-row">
              {whatsapp && (
                <a
                  href={`https://wa.me/${whatsapp}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2.5 rounded-full bg-[var(--lw-gold)] px-[22px] py-3.5 text-sm font-semibold text-black"
                >
                  <MessageCircle className="h-4 w-4" />
                  Escríbenos por WhatsApp
                </a>
              )}
              {contacto?.direccion && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contacto.direccion)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center rounded-full border border-white/15 px-[22px] py-3.5 text-sm text-[#e8e8ea] transition-colors hover:border-white/30"
                >
                  Cómo llegar
                </a>
              )}
            </div>
          </div>
          <div className="min-h-[220px] overflow-hidden rounded-[10px] border border-white/10 bg-[#151517] lg:min-h-[380px]">
            {contacto?.direccion ? (
              <iframe
                title="Ubicación en el mapa"
                src={`https://www.google.com/maps?q=${encodeURIComponent(contacto.direccion)}&output=embed`}
                className="h-full w-full border-0"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-white/25">
                <MapPin className="h-8 w-8" />
              </div>
            )}
          </div>
        </section>
      )}

      <PieClienteWeb />
    </div>
  )
}
