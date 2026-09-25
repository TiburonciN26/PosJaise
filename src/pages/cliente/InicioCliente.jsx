import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, useInView } from 'framer-motion'
import { ArrowUpRight } from 'lucide-react'
import PieClienteWeb from './PieClienteWeb.jsx'

// Fotos de referencia del nuevo hero "antes/después" (§7.36
// implementacionesWed.md) — igual que los videos de más abajo, son
// material de stock que el negocio aprobó para armar esta primera
// versión, no fotos reales de una clienta. Reemplazar en cuanto existan
// fotos reales del salón (mismo pendiente que la Galería de Nosotros).
const FOTO_DESPUES = `${import.meta.env.BASE_URL}inicio-web/hero-despues-referencia.jpg`
const FOTO_ANTES = `${import.meta.env.BASE_URL}inicio-web/hero-antes-referencia.jpg`

// Radio máximo (en px) del círculo que revela la foto "antes" al pasar
// el cursor — mismo valor que la referencia del usuario.
const RADIO_REVELADO = 340

// Revela la foto "antes" bajo el cursor sin re-renderizar React en cada
// movimiento: interpola posición y radio a mano y escribe el resultado
// directo en el style de la imagen "antes" (vía mask-image), en vez de
// guardarlo en estado. Sin etiqueta "ANTES" flotante (§7.39
// implementacionesWed.md, a pedido del usuario) — el hint de abajo
// ("Pasa el cursor. Mira su antes.") ya explica el gesto, la etiqueta
// quedaba redundante.
function useRevelarAntes(contenedorRef, imagenAntesRef) {
  useEffect(() => {
    const contenedor = contenedorRef.current
    const imagenAntes = imagenAntesRef.current
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
    // de la intención de hacer scroll — se ignora ahí para no interferir
    // con el scroll normal de la página (el hint de abajo también se
    // esconde en móvil, así que no se promete un gesto que no existe).
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
  }, [contenedorRef, imagenAntesRef])
}

// Acento de esquina arriba/abajo del bloque de título — se había sacado
// en §7.38 siguiendo al pie de la letra un checklist que pedía
// replicar el HTML original 1:1, pero el usuario lo pidió de vuelta
// (§7.39 implementacionesWed.md): es una diferencia a propósito
// respecto a la referencia pura, igual que la migaja de pan.
// Tamaño por className (h-/w-), no por atributos width/height del SVG:
// un atributo width="14" es fijo siempre, no admite variantes de
// Tailwind como max-[640px]: — con clases sí se puede achicar solo en
// celular sin afectar el resto de vistas (pedido del usuario).
function EsquinaBracket({ voltear = false }) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="#f5f5f4"
      strokeWidth="1.5"
      aria-hidden="true"
      className="h-[14px] w-[14px] shrink-0 max-[640px]:h-[6px] max-[640px]:w-[6px]"
    >
      <path d={voltear ? 'M0 0.5V11.5H11.5' : 'M0 11.5V0.5H11.5'} />
    </svg>
  )
}

// Videos de referencia pegados tal cual por el negocio para armar esta
// primera versión de la landing (§6 implementacionesWed.md) — no son
// grabaciones del salón, el negocio los aprobó a sabiendas de eso.
// Reemplazar por material real del salón en cuanto exista.
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
  const contenedorHeroRef = useRef(null)
  const imagenAntesRef = useRef(null)
  useRevelarAntes(contenedorHeroRef, imagenAntesRef)

  return (
    <div className="landing-web flex-1 overflow-y-auto">
      {/* Tope de ancho en pantallas muy anchas (27"+, ver
          implementacionesWed.md §7.38): la referencia no define un
          max-width (fue pensada como mockup fijo), pero sin uno acá la
          foto/el título se estiran y se ven distorsionados en un
          monitor grande de verdad. mx-auto centra la sección capada;
          .landing-web ya pinta #000 detrás (arriba en este archivo), así
          que lo que sobra a los costados se ve negro solo, sin agregar
          otro color.
          aspect-[1680/944] (§7.39-7.40): min-h-[85svh] por sí solo fija
          la altura SOLO por el alto de la ventana, sin relación con el
          ancho — a medida que el ancho crecía (hasta el tope de arriba)
          con la altura fija, la caja se iba haciendo cada vez más
          apaisada, y object-cover tenía que recortar más arriba/abajo
          de la foto para llenarla: se veía como si "la chica creciera"
          (más zoom sobre la cara según el ancho). §7.39 probó
          aspect-[1.9] (una mejora, pero 1.9 sigue siendo más ancho que
          la foto real → seguía recortando un poco verticalmente, bug
          reportado de nuevo con captura). 1680/944 es el tamaño real en
          px de hero-despues-referencia.jpg/hero-antes-referencia.jpg
          (≈1.78, o sea 16:9) — con la caja exactamente en la relación
          de aspecto nativa de la foto, object-cover ya no tiene que
          recortar arriba/abajo en ningún ancho hasta el tope de 1800px:
          todo el recorte que hace falta es horizontal, desde la
          izquierda (fondo negro vacío en la foto), nunca sobre la cara.
          Sin min-h (§7.49, antes min-h-[85svh] md:min-h-0 de §7.47): el
          usuario pidió que el celular tenga el MISMO formato que
          desktop (misma relación de aspecto de la foto, sin un piso de
          alto aparte que la desvíe) — así que ya no hay ningún piso,
          en ningún ancho: aspect-[1680/944] manda siempre, celular
          incluido. Ver el aviso en implementacionesWed.md §7.49 sobre
          lo que esto implica en celulares muy angostos (el contenido
          — título + botón — puede necesitar más alto del que la sola
          relación de aspecto da a ese ancho; el navegador no recorta
          contenido visible, así que ahí la sección puede terminar más
          alta que el aspect-ratio puro, no es un bug nuevo, es cómo
          se resuelve ese choque).
          px-8 (§7.46): antes este padding vivía en la columna de
          contenido de 1400px de abajo, con valores distintos por
          breakpoint para calzar con el padding real del <header> + el
          ancho del botón de hamburguesa (§7.45) — el usuario lo
          simplificó a un valor fijo de 32px acá en la sección de
          1800px en vez de eso. Sigue sin afectar a la foto de fondo
          (absolute inset-0 más abajo: el padding de un elemento no
          reduce el área de sus hijos posicionados en absoluto). */}
      <section
        ref={contenedorHeroRef}
        className="relative mx-auto flex aspect-[1680/944] w-full max-w-[1800px] flex-col bg-[#0b0b0c] px-8"
      >
        {/* Sin degradado oscuro sobre la foto (§7.39): la referencia no
            tiene overlay — las dos fotos ya traen fondo negro puro del
            lado izquierdo (donde va el texto), así que un overlay extra
            acá solo apagaba el color real de la foto ("se ve pálida",
            reportado por el usuario) sin aportar nada que las fotos no
            dieran solas. */}
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          <img
            src={FOTO_DESPUES}
            alt="Clienta después de su transformación en el salón"
            className="absolute inset-0 h-full w-full object-cover object-[right_center]"
          />
          <img
            ref={imagenAntesRef}
            src={FOTO_ANTES}
            alt="La misma clienta antes de su transformación"
            style={{ filter: 'grayscale(0.35) brightness(0.97)' }}
            className="absolute inset-0 h-full w-full object-cover object-[right_center]"
          />
        </div>

        {/* Columna de contenido (§7.44-7.45): la <section> de arriba sigue
            creciendo libre hasta 1800px (así la FOTO llena ese ancho
            completo) — lo que se acota acá es el contenido de encima
            (título, botón, hint), en su propio `mx-auto max-w-[1400px]`
            independiente, centrado DENTRO de la sección de 1800px. Centrar
            una caja de 1400px adentro de otra de 1800px que a su vez está
            centrada en la pantalla da el mismo borde izquierdo, en
            cualquier ancho de ventana, que centrar esos mismos 1400px
            directo en la pantalla — que es exactamente lo que hace la fila
            del header (`max-w-[1400px]` en PortalCliente.jsx). Por eso el
            título/botón quedan siempre alineados bajo el logo/nav sin
            importar cuánto se estire la ventana, mientras la foto de atrás
            sigue teniendo sus 1800px enteros para respirar (bug reportado
            con captura: antes el texto colgaba del ancho de la sección de
            1800px, no del de 1400px del header).
            `pl-*`/`pr-*` en vez de `px-*` simétrico (§7.45): esto SOLO
            alinea los dos contenedores de 1400px entre sí — adentro, el
            logo arranca pegado al borde de su fila (padding 0, ver
            PortalCliente.jsx), mientras que acá el título tenía su propio
            padding extra (antes `px-6 sm:px-10 md:px-16`), así que
            quedaba corrido a la derecha del logo (bug reportado con
            captura + inspector). `pr-*` copia tal cual el padding propio
            del <header> (`px-4 sm:px-6 md:px-8`) — ahí no hay nada raro
            del lado derecho. `pl-*` tiene que sumarle ADEMÁS el ancho
            real que ocupa el botón de hamburguesa + su gap en el header
            cuando está visible (`-ml-2 h-11 w-11` = 36px netos, + `gap-3`
            = 12px → 48px), porque ese botón corre el logo hacia la
            derecha en pantallas angostas y desaparece recién en `lg`
            (1024px, `lg:hidden` en PortalCliente.jsx) — por eso el salto
            hacia ABAJO en `lg:pl-8` (sin los 48px extra) en vez de seguir
            creciendo. Si el padding del <header> o el ancho/gap de la
            hamburguesa cambian alguna vez, estos valores hay que
            recalcularlos a mano — no hay forma de derivarlos solos sin
            tocar el <header>, que el usuario pidió explícitamente no
            tocar acá.
            §7.46: el usuario simplificó esto — el padding horizontal ya
            no vive acá (esta columna queda sin `pl-*`/`pr-*` propio,
            pegada a sus propios bordes de 1400px), se movió como
            `px-8` fijo (32px, sin variar por breakpoint) a la
            `<section>` de 1800px de arriba. Ver el comentario de esa
            `<section>` para el resultado final. */}
        {/* Todo el bloque de acá adentro escala fluido con clamp() en vez
            de saltar entre breakpoints (§7.50, a pedido del usuario —
            "mismo formato en miniatura" en celular, no un layout roto):
            el gap entre título/botón y el tamaño de letra del título
            comparten la idea de "un piso chico para celular, un techo
            grande para desktop, y una pendiente en vw en el medio sin
            saltos" — mismo mecanismo que ya tenía el título desde §7.44
            (clamp(40px,5.2vw,74px)), extendido a todo lo demás porque
            §7.49 sacó min-h-[85svh] de la <section> y a partir de ahí,
            en celular, esos paddings/gap FIJOS no entraban en una
            sección ahora mucho más baja (proporción de la foto, ~210px
            a 375px de ancho) — el título se veía enorme y el layout se
            rompía (bug reportado con captura). El piso del título bajó
            de 40px a 24px (era "muy grande en móvil", reportado).
            pt simétrico con pb (§7.51, antes pt-[clamp(28px,8vw,112px)]
            max-[640px]:pt-28, mucho más grande que pb): ese pt extra
            compensaba el header flotante/transparente de §7.37, que ya
            no existe — el header ahora es opaco y el wrapper de
            PortalCliente.jsx vuelve a reservarle su alto SIEMPRE (mismo
            cambio, ver el comentario ahí). Dejar el pt grande acá
            hubiera sumado ESE espacio dos veces y corrido el título
            hacia abajo, ya no centrado de verdad dentro de la sección. */}
        <div className="relative z-10 mx-auto flex w-full max-w-[1700px] flex-1 flex-col justify-center py-[clamp(16px,3vw,40px)]">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="flex flex-col items-start gap-[clamp(12px,3vw,28px)] max-[640px]:gap-[8px] md:max-w-xl"
          >
            {/* Sin overflow-hidden en la <section> (arriba): con
                line-height 1.05 las colas/floreos de Kunaroh en la "R" de
                TRANSFORMA quedaban cortadas por el borde de la sección
                (bug reportado por el usuario con captura) — el layer de
                fondo ya se clippea solo (overflow-hidden propio, arriba),
                así que sacarlo de acá no afecta a las fotos. */}
            <EsquinaBracket />
            <h1 className="lw-titulo-kunaroh text-[clamp(10px,4vw,50px)] text-white">
              <span className="block">Belleza</span>
              <span className="block">que</span>
              <span className="block">Transforma</span>
            </h1>
            <EsquinaBracket voltear />
            <Link to="/citas" className="lw-cta-hero mt-2">
              <span className="lw-metal-azul-texto">Reserva tu cita</span>
              <ArrowUpRight className="lw-cta-flecha h-4 w-4" />
            </Link>
          </motion.div>
        </div>

        {/* El hint ("Pasa el cursor...") salió de la columna centrada de
            arriba (§7.48): estando adentro, como hermano del bloque de
            título en un flex-col con justify-center, empujaba el cálculo
            del centrado (el título ya no quedaba centrado solo, sino
            junto con el hint, corriéndolo hacia arriba). Ahora es
            position:absolute clavado en la esquina inferior derecha de
            la FOTO (relativo a la <section> de 1800px, no a la columna
            de 1400px) — ya no participa del layout en flujo de nada, así
            que no interfiere con el centrado del título. */}
        <div className="lw-hint-cursor absolute bottom-8 right-8 z-10 hidden sm:flex">
          <svg width="46" height="46" viewBox="0 0 64 64" fill="none" stroke="#f5f5f4" strokeWidth="1.2" className="shrink-0" aria-hidden="true">
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

      <SeccionSobreNosotros />
      <SeccionVideoDestacado />
      <SeccionFilosofia />
      <SeccionServicios />
      <PieClienteWeb />
    </div>
  )
}
