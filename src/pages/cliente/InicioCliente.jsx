import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, useInView } from 'framer-motion'
import { ArrowUpRight } from 'lucide-react'
import { usePerfilCliente } from '../../context/PerfilClienteContext.jsx'
import PieClienteWeb from './PieClienteWeb.jsx'

// Videos de referencia pegados tal cual por el negocio para armar esta
// primera versión de la landing (§6 implementacionesWed.md) — no son
// grabaciones del salón, el negocio los aprobó a sabiendas de eso.
// Reemplazar por material real del salón en cuanto exista.
const VIDEO_HERO =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260405_074625_a81f018a-956b-43fb-9aee-4d1508e30e6a.mp4'
const VIDEO_DESTACADO =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260402_054547_9875cfc5-155a-4229-8ec8-b7ba7125cbf8.mp4'
const VIDEO_FILOSOFIA =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260307_083826_e938b29f-a43a-41ec-a153-3d4730578ab8.mp4'
const VIDEO_SERVICIO_1 =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260314_131748_f2ca2a28-fed7-44c8-b9a9-bd9acdd5ec31.mp4'
const VIDEO_SERVICIO_2 =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260324_151826_c7218672-6e92-402c-9e45-f1e0f454bdc4.mp4'

const SERVICIOS_DESTACADOS = [
  {
    video: VIDEO_SERVICIO_1,
    etiqueta: 'Diagnóstico',
    titulo: 'Análisis personalizado',
    descripcion:
      'Antes de cualquier tratamiento conversamos sobre tu cabello, tu piel y lo que buscas — así cada servicio parte de lo que realmente necesitas.',
  },
  {
    video: VIDEO_SERVICIO_2,
    etiqueta: 'Estilo',
    titulo: 'Diseño y ejecución',
    descripcion:
      'De la idea al resultado final cuidamos cada detalle para que la experiencia se sienta impecable y el resultado se vea extraordinario.',
  },
]

// Anima el opacity de un elemento del DOM directamente (sin transición
// CSS ni estado de React) — igual que pide la referencia, para poder
// encadenar el fundido con eventos del propio <video> sin re-render.
function animarOpacidad(elemento, desde, hasta, duracionMs, alTerminar) {
  const inicio = performance.now()
  function paso(ahora) {
    const progreso = Math.min((ahora - inicio) / duracionMs, 1)
    elemento.style.opacity = String(desde + (hasta - desde) * progreso)
    if (progreso < 1) {
      requestAnimationFrame(paso)
    } else {
      alTerminar?.()
    }
  }
  requestAnimationFrame(paso)
}

// Loop del video de fondo del hero con crossfade a negro entre vueltas
// (en vez de loop nativo, que cortaría en seco): entra en fade-in al
// poder reproducirse, se apaga los últimos ~0.55s de cada vuelta, y
// vuelve a aparecer ya reiniciado.
function useVideoHeroConFundido(videoRef) {
  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined
    let desvaneciendo = false

    function alPoderReproducir() {
      desvaneciendo = false
      video.play().catch(() => {})
      animarOpacidad(video, 0, 1, 500)
    }
    function alActualizarTiempo() {
      if (desvaneciendo || !Number.isFinite(video.duration)) return
      if (video.duration - video.currentTime <= 0.55) {
        desvaneciendo = true
        animarOpacidad(video, Number(video.style.opacity) || 1, 0, 500)
      }
    }
    function alTerminar() {
      video.style.opacity = '0'
      setTimeout(() => {
        video.currentTime = 0
        desvaneciendo = false
        video.play().catch(() => {})
        animarOpacidad(video, 0, 1, 500)
      }, 100)
    }

    video.addEventListener('canplay', alPoderReproducir)
    video.addEventListener('timeupdate', alActualizarTiempo)
    video.addEventListener('ended', alTerminar)
    return () => {
      video.removeEventListener('canplay', alPoderReproducir)
      video.removeEventListener('timeupdate', alActualizarTiempo)
      video.removeEventListener('ended', alTerminar)
    }
  }, [videoRef])
}

function SeccionSobreNosotros() {
  const ref = useRef(null)
  const enVista = useInView(ref, { once: true, margin: '-100px' })

  return (
    <section className="relative overflow-hidden px-6 pb-10 pt-32 md:pb-14 md:pt-44">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.03)_0%,_transparent_70%)]" />
      <div ref={ref} className="relative mx-auto max-w-4xl">
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={enVista ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-sm uppercase tracking-widest text-white/40"
        >
          Sobre nosotros
        </motion.p>
        <motion.h2
          initial={{ opacity: 0, y: 40 }}
          animate={enVista ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.1 }}
          className="lw-serif-regular mt-4 text-4xl leading-[1.1] tracking-tight text-white md:text-6xl lg:text-7xl"
        >
          Cuidamos <span className="lw-serif text-white/60">cada detalle</span>
          <br className="hidden md:block" /> para que <span className="lw-serif text-white/60">tu belleza brille.</span>
        </motion.h2>
      </div>
    </section>
  )
}

function SeccionVideoDestacado() {
  const ref = useRef(null)
  const enVista = useInView(ref, { once: true, margin: '-100px' })

  return (
    <section className="px-6 pb-20 pt-6 md:pb-32 md:pt-10">
      <motion.div
        ref={ref}
        initial={{ opacity: 0, y: 60 }}
        animate={enVista ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.9 }}
        className="relative mx-auto aspect-video w-full max-w-6xl overflow-hidden rounded-3xl"
      >
        <video
          className="h-full w-full object-cover"
          src={VIDEO_DESTACADO}
          muted
          autoPlay
          loop
          playsInline
          preload="auto"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-4 p-6 md:flex-row md:items-end md:justify-between md:p-10">
          <div className="liquid-glass max-w-md rounded-none p-6 md:p-8">
            <p className="mb-3 text-xs uppercase tracking-widest text-white/50">Nuestro enfoque</p>
            <p className="text-sm leading-relaxed text-white md:text-base">
              Creemos en escuchar antes de proponer. Cada cita empieza con una pregunta sobre lo que
              quieres lograr, y cada tratamiento se diseña a tu medida.
            </p>
          </div>
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Link
              to="/servicios"
              className="liquid-glass inline-block rounded-full px-8 py-3 text-sm font-medium text-white"
            >
              Ver servicios
            </Link>
          </motion.div>
        </div>
      </motion.div>
    </section>
  )
}

function SeccionFilosofia() {
  const ref = useRef(null)
  const enVista = useInView(ref, { once: true, margin: '-100px' })

  return (
    <section ref={ref} className="overflow-hidden px-6 py-28 md:py-40">
      <div className="mx-auto max-w-6xl">
        <motion.h2
          initial={{ opacity: 0, y: 40 }}
          animate={enVista ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
          className="lw-serif-regular mb-16 text-5xl tracking-tight text-white md:mb-24 md:text-7xl lg:text-8xl"
        >
          Cuidado <span className="lw-serif text-white/40">x</span> Confianza
        </motion.h2>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-12">
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            animate={enVista ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.8 }}
            className="aspect-[4/3] overflow-hidden rounded-3xl"
          >
            <video
              className="h-full w-full object-cover"
              src={VIDEO_FILOSOFIA}
              muted
              autoPlay
              loop
              playsInline
              preload="auto"
            />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={enVista ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.8 }}
            className="flex flex-col justify-center gap-8"
          >
            <div>
              <p className="mb-4 text-xs uppercase tracking-widest text-white/40">Elige tu momento</p>
              <p className="text-base leading-relaxed text-white/70 md:text-lg">
                Cada visita empieza contigo: tu tiempo, tu estilo y lo que necesitas hoy. Trabajamos
                codo a codo con nuestras clientas para convertir una idea en un resultado que se nota
                y se siente.
              </p>
            </div>
            <div className="h-px w-full bg-white/10" />
            <div>
              <p className="mb-4 text-xs uppercase tracking-widest text-white/40">Vive el cambio</p>
              <p className="text-base leading-relaxed text-white/70 md:text-lg">
                Creemos que el mejor trabajo aparece cuando la técnica se encuentra con el cuidado.
                Por eso cada servicio se piensa para que salgas con más confianza que con la que
                llegaste.
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}

function SeccionServicios() {
  const ref = useRef(null)
  const enVista = useInView(ref, { once: true, margin: '-100px' })

  return (
    <section className="relative overflow-hidden px-6 py-28 md:py-40">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0.02)_0%,_transparent_60%)]" />
      <div ref={ref} className="relative mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={enVista ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7 }}
          className="mb-12 flex items-end justify-between md:mb-16"
        >
          <h2 className="lw-serif-regular text-3xl tracking-tight text-white md:text-5xl">Qué hacemos</h2>
          <span className="hidden text-sm text-white/40 md:inline">Nuestros servicios</span>
        </motion.div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
          {SERVICIOS_DESTACADOS.map((servicio, indice) => (
            <motion.div
              key={servicio.titulo}
              initial={{ opacity: 0, y: 50 }}
              animate={enVista ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.8, delay: indice * 0.15 }}
              className="liquid-glass group overflow-hidden rounded-none"
            >
              <div className="relative aspect-video overflow-hidden">
                <video
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                  src={servicio.video}
                  muted
                  autoPlay
                  loop
                  playsInline
                  preload="auto"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
              </div>
              <div className="p-6 md:p-8">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-xs uppercase tracking-widest text-white/40">{servicio.etiqueta}</span>
                  <span className="liquid-glass rounded-full p-2">
                    <ArrowUpRight className="h-4 w-4 text-white" />
                  </span>
                </div>
                <h3 className="mb-3 text-xl tracking-tight text-white md:text-2xl">{servicio.titulo}</h3>
                <p className="text-sm leading-relaxed text-white/50">{servicio.descripcion}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

// Landing de Inicio (§6 implementacionesWed.md): hero a pantalla completa
// con video de fondo (loop con crossfade manual, sin corte) + 4 secciones
// de scroll (Sobre nosotros, Video destacado, Filosofía, Servicios), todo
// bajo .landing-web/.liquid-glass (index.css). El header real (logo,
// hamburguesa, avatar) sigue siendo el de PortalCliente.jsx — este
// componente no repite un navbar propio, evita duplicar login/logout que
// ya existen ahí. Sin formulario de newsletter ni botones Sign Up/Login:
// esta pantalla la ve un cliente que ya inició sesión.
export default function InicioCliente() {
  const { perfil } = usePerfilCliente()
  const videoHeroRef = useRef(null)
  useVideoHeroConFundido(videoHeroRef)

  const primerNombre = perfil?.nombre?.trim().split(/\s+/)[0]

  return (
    <div className="landing-web flex-1 overflow-y-auto">
      <section className="relative flex min-h-[85svh] flex-col items-center justify-center overflow-hidden px-6 py-12 text-center">
        <video
          ref={videoHeroRef}
          className="absolute inset-0 h-full w-full object-cover object-bottom opacity-0"
          src={VIDEO_HERO}
          muted
          autoPlay
          playsInline
          preload="auto"
        />
        <div className="pointer-events-none absolute inset-0 bg-black/35" />

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="liquid-glass relative z-10 mb-6 flex items-center gap-2 rounded-lg px-3 py-2"
        >
          <span className="rounded-md bg-white px-2 py-0.5 text-xs font-medium text-black">Hola</span>
          <span className="text-sm font-medium text-white/70">
            {primerNombre ? `Qué bueno verte, ${primerNombre}` : 'Bienvenida de nuevo'}
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="lw-serif-regular relative z-10 text-5xl leading-tight tracking-tight text-white md:text-7xl lg:text-8xl"
        >
          Tu belleza,
          <br />
          <span className="lw-serif">nuestra pasión.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="relative z-10 mt-6 max-w-md px-4 text-sm leading-relaxed text-white"
        >
          Agenda tu próxima cita, sigue tu progreso y descubre tus beneficios exclusivos.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="relative z-10 mt-8"
        >
          <Link
            to="/citas"
            className="liquid-glass inline-block rounded-full px-8 py-3 text-sm font-medium text-white transition-colors hover:bg-white/5"
          >
            Agendar una cita
          </Link>
        </motion.div>
      </section>

      <SeccionSobreNosotros />
      <SeccionVideoDestacado />
      <SeccionFilosofia />
      <SeccionServicios />
      <PieClienteWeb />
    </div>
  )
}
