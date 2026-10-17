import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, MapPin, MessageCircle, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { COLUMNAS_SERVICIO_TARJETA } from '../../lib/catalogoPublico.js'
import { obtenerContacto, obtenerHorario } from '../../lib/datosNegocioWeb.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { useTemaWeb } from '../../context/TemaWebContext.jsx'
import { useToast } from '../../context/ToastContext.jsx'
import { useEntornoAnimacion } from '../../hooks/useEntornoAnimacion.js'
import { useLectura } from '../../hooks/useLectura.js'
import { useRequerirSesion } from '../../hooks/useRequerirSesion.js'
import { useSecuenciaScroll } from '../../hooks/useSecuenciaScroll.js'
import { formatearDias, formatearHora, numeroWhatsapp } from '../../lib/contactoNegocio.js'
import { resolverUrlGaleria } from '../../lib/imagenes.js'
import { nombrePublico } from '../../lib/resenas.js'
import Estrellas from '../../components/Estrellas.jsx'
import TarjetaServicioCliente from '../../components/TarjetaServicioCliente.jsx'
import MapaDiferido from '../../components/MapaDiferido.jsx'
import ShinyText from '../../components/ShinyText.jsx'
import CuponPromocionInicio from '../../components/CuponPromocionInicio.jsx'
import PieClienteWeb from './PieClienteWeb.jsx'

// Cuatro WebP entregados por el usuario (3024×1698), sin recomprimir ni
// generar variantes. Cada tema usa directamente su par antes/después.
// Después conserva prioridad alta; antes es la capa del efecto del cursor.
const FOTO_DESPUES = `${import.meta.env.BASE_URL}inicio-web/hero-despues-oscuro.webp`
const FOTO_ANTES = `${import.meta.env.BASE_URL}inicio-web/hero-antes-oscuro.webp`
const FOTO_DESPUES_CLARA = `${import.meta.env.BASE_URL}inicio-web/hero-despues-claro.webp`
const FOTO_ANTES_CLARA = `${import.meta.env.BASE_URL}inicio-web/hero-antes-claro.webp`
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
    let animId = 0

    // Fase 6: el bucle SOLO corre mientras la máscara se mueve. Cuando el radio ya llegó a su destino (revelada o escondida) y el
    // punto suave alcanzó al cursor, se detiene (sin rAF pendiente); un movimiento del puntero lo vuelve a despertar.
    function despertar() {
      if (!animId && !document.hidden) animId = requestAnimationFrame(tick)
    }
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
      despertar()
    }
    function alSoltar(evento) {
      if (esTactil(evento)) return
      destino = 0
      despertar()
    }

    function tick() {
      animId = 0
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
      const enReposo =
        Math.abs(destino - activo) < 0.003 && Math.abs(objetivo.x - suave.x) < 0.3 && Math.abs(objetivo.y - suave.y) < 0.3
      if (enReposo) {
        // Último cuadro exacto y el bucle se duerme.
        activo = destino
        suave.x = objetivo.x
        suave.y = objetivo.y
        return
      }
      animId = requestAnimationFrame(tick)
    }
    const alVisibilidad = () => {
      if (document.hidden) {
        if (animId) cancelAnimationFrame(animId)
        animId = 0
      } else {
        despertar()
      }
    }
    // Primer cuadro: deja la máscara en su estado inicial (escondida) y, al estar en reposo, el bucle no sigue.
    animId = requestAnimationFrame(tick)

    contenedor.addEventListener('pointermove', alMover)
    contenedor.addEventListener('pointerdown', alMover)
    contenedor.addEventListener('pointerup', alSoltar)
    contenedor.addEventListener('pointerleave', alSoltar)
    contenedor.addEventListener('pointercancel', alSoltar)
    document.addEventListener('visibilitychange', alVisibilidad)
    return () => {
      if (animId) cancelAnimationFrame(animId)
      contenedor.removeEventListener('pointermove', alMover)
      contenedor.removeEventListener('pointerdown', alMover)
      contenedor.removeEventListener('pointerup', alSoltar)
      contenedor.removeEventListener('pointerleave', alSoltar)
      contenedor.removeEventListener('pointercancel', alSoltar)
      document.removeEventListener('visibilitychange', alVisibilidad)
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

const formatoFechaResena = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'America/Lima',
})

function PuntosAvance({ puntos }) {
  return (
    <span role="status" aria-label={`${puntos.filter(Boolean).length} de ${puntos.length} fotos mostradas`} className="inline-flex items-center">
      <span className="flex gap-1">
        {puntos.map((caido, i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full transition-colors"
            style={{ background: caido ? 'var(--lw-gold)' : '#2e2e33' }}
          />
        ))}
      </span>
    </span>
  )
}

// Rediseño de Inicio (docs/diseno-inicio/README.md): Hero (foto/efecto
// antes-después existente + copy nuevo) → promoción
// activa → lo más pedido → resultados reales (animación por scroll,
// useSecuenciaScroll.js) → reseñas → sobre nosotros → visítanos → pie.
// Reemplaza por completo el hero full-bleed + las 4 secciones de
// video/filosofía anteriores (ver git blame) — ese material era stock
// genérico sin relación con el salón; el usuario pidió un solo bloque de
// marca corto en su lugar. Nada de lo mostrado se inventa: cada dato que
// puede faltar (reseñas, próxima cita, promoción, fotos de resultados,
// contacto) oculta su línea o su sección entera en vez de mostrar un
// placeholder falso.
// Fase 5: Inicio pide SOLO lo que muestra, cada cosa por su cuenta (useLectura): ya no se descarga el catálogo completo de servicios
// para escoger cuatro, ni todas las reseñas y la galería para mostrar tres. Límites de diseño explícitos:
const DESTACADOS_INICIO = 4 // «Lo más pedido»
const CANDIDATOS_DESTACADOS = 12 // del ranking se consideran los primeros; basta para saltar los inactivos
const GALERIA_INICIO = 3 // parejas antes/después
const TARJETAS_RESENAS_INICIO = 3 // tarjetas de reseñas

async function leerTopServicios() {
  const { data: ranking, error } = await supabase.rpc('servicios_mas_pedidos', { dias: 30 }).limit(CANDIDATOS_DESTACADOS)
  if (error) throw error
  const ids = (ranking ?? []).map((fila) => fila.servicio_id)
  if (ids.length === 0) return []
  const { data, error: errorServicios } = await supabase.from('servicios').select(COLUMNAS_SERVICIO_TARJETA).in('id', ids).eq('activo', true)
  if (errorServicios) throw errorServicios
  const porId = new Map((data ?? []).map((servicio) => [servicio.id, servicio]))
  return ids.map((id) => porId.get(id)).filter(Boolean).slice(0, DESTACADOS_INICIO)
}

// La promoción vigente es una sola (la que vence primero; RLS ya filtra activa y en fecha). Si la clienta ya la reclamó se
// averigua con un filtro por esa promoción (no se baja toda su lista de cupones).
async function leerPromocionActiva(usuarioId) {
  const { data, error } = await supabase
    .from('promociones')
    .select('id, titulo, descripcion, tipo_descuento, valor, vigente_hasta')
    .order('vigente_hasta', { ascending: true, nullsFirst: false })
    .limit(1)
  if (error) throw error
  const promo = data?.[0] ?? null
  if (!promo || !usuarioId) return { promo, cupon: null }
  // promocion_id solo existe en mis_cupones() desde 127_reclamar_cupon_promocion.sql: sin ese esquema la consulta falla y
  // el botón parte en «Reclamar cupón», como antes.
  const { data: cupones } = await supabase.rpc('mis_cupones').eq('promocion_id', promo.id).limit(1)
  return { promo, cupon: cupones?.[0] ?? null }
}

// Reseñas: el total y el promedio salen de las calificaciones (una columna entera por reseña aprobada, con conteo exacto del
// servidor; el servidor entrega como máximo max_rows = 1000, las más recientes) y las tarjetas son solo las 3 últimas con su
// servicio. Si resenas_inicio() aún no existe en la base, se cae a las reseñas generales (sin servicio).
async function leerResumenResenas() {
  const [generales, tarjetas] = await Promise.all([
    supabase.rpc('resenas_publicas', {}, { count: 'exact' }).select('calificacion'),
    supabase.rpc('resenas_inicio').limit(TARJETAS_RESENAS_INICIO),
  ])
  if (generales.error) throw generales.error
  let filasTarjetas = tarjetas.data ?? []
  if (tarjetas.error) {
    const respaldo = await supabase.rpc('resenas_publicas').limit(TARJETAS_RESENAS_INICIO)
    filasTarjetas = respaldo.data ?? []
  }
  const calificaciones = (generales.data ?? []).map((fila) => fila.calificacion)
  // Sin conteo exacto del servidor el total NO se presenta como exacto: se marca como «al menos» lo recibido.
  const exacto = Number.isSafeInteger(generales.count)
  return { total: exacto ? generales.count : calificaciones.length, exacto, calificaciones, tarjetas: filasTarjetas }
}

async function leerGaleriaInicio() {
  const { data, error } = await supabase.rpc('galeria_para_web').limit(GALERIA_INICIO)
  if (error) throw error
  return data ?? []
}

export default function InicioCliente() {
  const { mostrarToast } = useToast()
  const { reducirMovimiento, esDesktop } = useEntornoAnimacion()
  const { tema } = useTemaWeb()
  const esClaro = tema === 'claro'

  const contenedorRef = useRef(null)
  const { contenedorHeroRef, imagenAntesRef } = useRevelarAntes()

  const { usuario } = useAuth()
  const usuarioId = usuario?.id ?? null
  const requerirSesion = useRequerirSesion()
  const [reclamando, setReclamando] = useState(false)
  // Cupón que la clienta acaba de reclamar en esta pantalla (atado a su cuenta: no sobrevive a un cambio de usuario).
  const [reclamado, setReclamado] = useState({ dueno: null, cupon: null })

  // Fase 5: lecturas independientes. El hero se pinta de inmediato; cada sección aparece cuando llega lo suyo y una
  // dependencia lenta o caída solo oculta su propia sección. Visitante: nada personal se consulta.
  const topRes = useLectura(leerTopServicios)
  const promoRes = useLectura(() => leerPromocionActiva(usuarioId), usuarioId)
  const resenasRes = useLectura(leerResumenResenas)
  const galeriaRes = useLectura(leerGaleriaInicio)
  // Contacto y horario: lecturas COMPARTIDAS con el pie de página y las demás pantallas (caché de vida corta, sin duplicados).
  const contactoRes = useLectura(obtenerContacto)
  const horarioRes = useLectura(obtenerHorario)

  const topServicios = topRes.datos ?? []
  const promocion = promoRes.datos?.promo ?? null
  const cuponPromocion = (reclamado.dueno === usuarioId ? reclamado.cupon : null) ?? promoRes.datos?.cupon ?? null
  const calificaciones = resenasRes.datos?.calificaciones ?? []
  const totalResenas = resenasRes.datos?.total ?? 0
  const totalExacto = resenasRes.datos?.exacto ?? true
  // El servidor entrega como máximo max_rows calificaciones: con más reseñas aprobadas el promedio es el de las más recientes.
  const promedioParcial = calificaciones.length < totalResenas
  const resenasTarjetas = resenasRes.datos?.tarjetas ?? []
  const galeria = galeriaRes.datos ?? []
  const galeriaLista = galeriaRes.estado === 'ok'
  const contacto = contactoRes.datos
  const horario = horarioRes.datos

  const ENTRADA_FIJA = esDesktop
    ? { foto: 200, eyebrow: 150, titulo: 300, subtitulo: 420, botones: 540, promo: 950 }
    : { foto: 100, eyebrow: 350, titulo: 480, subtitulo: 560, botones: 650, promo: 1000 }

  const { primeraFotoRef, filaRef, estadoFoto, claseSacudida, enCurso, puntos } = useSecuenciaScroll({
    activo: galeriaLista && galeria.length > 0,
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
    if (galeriaCerca || !galeriaLista || galeria.length === 0) return undefined
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
  }, [galeriaCerca, galeriaLista, galeria.length, filaRef])

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
    setReclamado({ dueno: usuarioId, cupon: data?.[0] ?? null })
    mostrarToast('Cupón guardado en Mis cupones.', 'exito')
  }

  const promedioResenas = calificaciones.length ? calificaciones.reduce((suma, c) => suma + c, 0) / calificaciones.length : null
  const whatsapp = contacto?.telefono ? numeroWhatsapp(contacto.telefono) : null
  const hayVisitanos = Boolean(contacto?.direccion || horario || contacto?.telefono)

  return (
    <div ref={contenedorRef} className="landing-web flex-1 overflow-y-auto">
      {/* 1. HERO — una sola pieza: la foto (con el efecto antes/después
          existente) es el FONDO COMPLETO de la sección, no una caja
          separada; el texto flota encima, sobre la franja negra que ya
          trae la propia foto del lado izquierdo (mismo mecanismo y
          fotos de siempre, con el botón "Ver servicios"). */}
      <section
        ref={contenedorHeroRef}
        className={`${esClaro ? '' : 'lw-sobre-foto '}relative mx-auto flex aspect-[1680/944] w-full max-w-[1800px] cursor-crosshair flex-col lw-gutter ${esClaro ? 'bg-transparent' : 'bg-[#0b0b0c]'}`}
      >
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          <img
            src={esClaro ? FOTO_DESPUES_CLARA : FOTO_DESPUES}
            width={3024}
            height={1698}
            fetchPriority="high"
            decoding="async"
            alt="Resultado después del servicio"
            className="absolute inset-0 h-full w-full object-cover object-[right_center]"
          />
          <img
            ref={imagenAntesRef}
            src={esClaro ? FOTO_ANTES_CLARA : FOTO_ANTES}
            width={3024}
            height={1698}
            fetchPriority="low"
            decoding="async"
            alt=""
            aria-hidden="true"
            style={{ filter: 'grayscale(0.35) brightness(0.97)' }}
            className="absolute inset-0 h-full w-full object-cover object-[right_center]"
          />
        </div>

        <div className="relative z-10 mx-auto flex w-full max-w-[1700px] flex-1 flex-col justify-center gap-[clamp(10px,1.8vw,20px)] py-[clamp(16px,3vw,40px)]">
          {/* En celular (< sm) los botones salen del flujo (absolute, al pie
              del hero, en fila y centrados), así el
              título queda solo en la columna y centrado verticalmente
              respecto de la foto completa, no del espacio sobre los botones. */}
          <div className="flex flex-col items-start gap-[clamp(10px,1.8vw,20px)] md:max-w-3xl">
            <div
              className={`flex flex-col items-start gap-2 ${reducirMovimiento ? '' : 'in-left'}`}
              style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.titulo}ms` }}
            >
              <EsquinaBracket />
              <h1 className="inicio-hero-titulo lw-titulo-kunaroh text-[clamp(38px,6vw,90px)] leading-[1.03] text-white max-sm:text-[clamp(20px,6vw,26px)]">
                <span className="block">Belleza</span>
                <span className="block">que</span>
                <span className="block">transforma</span>
              </h1>
              <EsquinaBracket voltear />
            </div>

            <div
              className={`flex flex-row items-center gap-2.5 max-sm:absolute max-sm:inset-x-0 max-sm:bottom-3 max-sm:justify-start ${reducirMovimiento ? '' : 'in-left'}`}
              style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.botones}ms` }}
            >
              {/* OCULTO a pedido (display:none inline, porque .lw-cta-hero define su propio display): se conserva para poder volver a mostrarlo — quitar el style. */}
              <Link to="/citas" className="lw-cta-hero" style={{ display: 'none' }}>
                <ShinyText text="Reserva tu cita" speed={3} delay={1.5} className="lw-cta-shiny" />
                <ArrowUpRight className="lw-cta-flecha h-4 w-4" />
              </Link>
              {/* Mismo acabado que "Reserva tu cita" (pedido del usuario). */}
              <Link to="/servicios" className="lw-cta-hero">
                <ShinyText text="Ver servicios" speed={3} delay={1.5} className="lw-cta-shiny" />
                <ArrowUpRight className="lw-cta-flecha h-4 w-4" />
              </Link>
            </div>

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

      {/* 2. PROMOCIÓN ACTIVA — la misma campaña y reclamación, con el recibo aprobado. */}
      {promocion && (
        <div className="mx-auto mt-4 max-sm:mt-(--separador-horizontal) w-full max-w-[1700px] lw-gutter lw-gutter-sep">
          <div
            className={`relative ${reducirMovimiento ? '' : 'in-up'}`}
            style={reducirMovimiento ? undefined : { animationDelay: `${ENTRADA_FIJA.promo}ms` }}
          >
            <CuponPromocionInicio
              key={`${usuarioId ?? 'visitante'}:${promocion.id}`}
              promocion={promocion}
              reclamado={Boolean(cuponPromocion)}
              reclamando={reclamando}
              onReclamar={reclamarCupon}
            />
          </div>
        </div>
      )}

      {/* 3. LO MÁS PEDIDO */}
      {topServicios.length > 0 && (
        <section className="mx-auto mt-24 max-sm:mt-(--separador-horizontal) w-full max-w-[1700px] lw-gutter lw-gutter-sep">
          <div className="mb-7 flex items-end justify-between gap-3">
            <div className="flex flex-col gap-2.5">
              <h2 className="lw-titulo-heavitas text-2xl max-sm:text-[0.75rem] text-white sm:text-[40px]">Lo más pedido</h2>
            </div>
            <Link to="/servicios" className="shrink-0 text-sm text-[#e8e8ea] hover:text-white">
              Ver todos los servicios →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
            {topServicios.map((servicio) => (
              <TarjetaServicioCliente key={servicio.id} servicio={servicio} mostrarCategoria={false} precioPrimero />
            ))}
          </div>
        </section>
      )}

      {/* 5. RESULTADOS REALES — scroll de inicio y continuación automática, ver
          src/hooks/useSecuenciaScroll.js. Oculta si el negocio todavía no
          cargó ninguna pareja real en Galería Web; muestra hasta 3 (el
          diseño aprobado), pero no exige las 3 completas. Con una o dos
          parejas se muestran directas. La secuencia requiere tres parejas:
          al llegar la primera al centro, las demás caen solas sin fijar el scroll. */}
      {galeria.length > 0 && (
        <section className="mx-auto mt-24 max-sm:mt-(--separador-horizontal) w-full max-w-[1700px] lw-gutter lw-gutter-sep">
          <div className="mb-7 flex items-end justify-between gap-3">
            <div className="flex flex-col gap-2.5">
              <span className="text-[11px] uppercase tracking-[0.24em] text-[#a6a6a6]">Trabajos hechos en el salón</span>
              <h2 className="lw-titulo-heavitas text-2xl max-sm:text-[0.75rem] text-white sm:text-[40px]">Resultados reales</h2>
            </div>
            <div className="flex items-center gap-5">
              {enCurso && <div className="hidden sm:block"><PuntosAvance puntos={puntos} /></div>}
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
      {totalResenas >= 3 && promedioResenas !== null && (
        <section className="mx-auto mt-24 max-sm:mt-(--separador-horizontal) w-full max-w-[1700px] lw-gutter lw-gutter-sep">
          <div className="grid gap-8 lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className="flex flex-col gap-3.5">
              <h2 className="lw-titulo-heavitas text-[26px] max-sm:text-[0.75rem] leading-[1.1] text-white sm:text-[34px]">
                Lo que dicen nuestras clientas
              </h2>
              <div className="mt-3 flex items-start gap-3">
                <span className="text-[44px] font-bold leading-none text-white sm:text-[56px]">
                  {promedioResenas.toFixed(1)}
                </span>
                <div className="flex flex-col gap-1.5">
                  <Estrellas calificacion={Math.round(promedioResenas)} className="h-[15px] w-[15px]" />
                  <span className="text-[13px] text-[#a6a6a6]">
                    {totalExacto ? totalResenas : `Al menos ${totalResenas}`} reseñas de clientas que ya vinieron{promedioParcial ? ` (promedio de las ${calificaciones.length} más recientes)` : ''}
                  </span>
                </div>
              </div>
              <Link to="/nosotros" className="mt-2.5 text-sm text-[#e8e8ea] hover:text-white">
                Ver todas las reseñas →
              </Link>
            </div>
            <div className="inicio-resenas-carrusel min-w-0 overflow-x-auto" role="region" aria-label="Reseñas de clientas" tabIndex={0}>
              <div className="inicio-resenas-cinta flex w-max">
                {[0, 1].map(copia => (
                  <div key={copia} className="inicio-resenas-grupo flex gap-5 pr-5" aria-hidden={copia === 1 ? true : undefined} inert={copia === 1}>
              {resenasTarjetas.slice(0, 3).map((resena) => (
                <figure
                  key={resena.id}
                  className="flex w-[280px] shrink-0 flex-col gap-4 rounded-[10px] border border-white/10 bg-[#111113] p-[26px] max-sm:px-(--separador-vertical-secundario) max-sm:py-(--separador-horizontal-secundario) shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] sm:w-[320px]"
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
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 7. SOBRE NOSOTROS — un solo bloque (reemplaza las 3 secciones de
          video/filosofía anteriores). */}
      <section className="mx-auto mt-24 max-sm:mt-(--separador-horizontal) grid w-full max-w-[1700px] items-center gap-10 lw-gutter lw-gutter-sep lg:grid-cols-2 lg:gap-14">
        <div className="flex h-[260px] items-center justify-center overflow-hidden rounded-[10px] border border-white/10 bg-[#151517] text-white/25 lg:h-[480px]">
          <Users className="h-10 w-10" />
        </div>
        <div className="flex flex-col gap-4">
          <span className="text-[11px] uppercase tracking-[0.24em] text-[#a6a6a6]">Sobre nosotros</span>
          <h2 className="lw-titulo-heavitas text-[28px] max-sm:text-[0.75rem] leading-[1.1] text-white sm:text-[40px]">
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
              <div key={paso.n} className="flex flex-col gap-1.5 rounded-[10px] border border-white/10 bg-[#111113] p-[18px] max-sm:px-(--separador-vertical-secundario) max-sm:py-(--separador-horizontal-secundario)">
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
        <section className="mx-auto mt-24 max-sm:mt-(--separador-horizontal) grid w-full max-w-[1700px] gap-5 lw-gutter lw-gutter-sep lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="flex flex-col gap-5 rounded-[10px] border border-white/10 bg-[#111113] p-[26px] max-sm:px-(--separador-vertical-secundario) max-sm:py-(--separador-horizontal-secundario) shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] sm:p-9">
            <h2 className="lw-titulo-heavitas text-[26px] max-sm:text-[0.75rem] text-white sm:text-[34px]">Visítanos</h2>
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
                  className="flex items-center justify-center gap-2.5 rounded-full bg-[var(--lw-gold)] px-[22px] py-3.5 max-sm:px-(--pading-horizontal-boton) max-sm:py-(--pading-verical-boton) text-sm font-semibold text-black"
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
                  className="flex items-center justify-center rounded-full border border-white/15 px-[22px] py-3.5 max-sm:px-(--pading-horizontal-boton) max-sm:py-(--pading-verical-boton) text-sm text-[#e8e8ea] transition-colors hover:border-white/30"
                >
                  Cómo llegar
                </a>
              )}
            </div>
          </div>
          <div className="min-h-[220px] overflow-hidden rounded-[10px] border border-white/10 bg-[#151517] lg:min-h-[380px]">
            <MapaDiferido direccion={contacto?.direccion} />
          </div>
        </section>
      )}

      <PieClienteWeb />
    </div>
  )
}
