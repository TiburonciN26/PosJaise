import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Clock, Globe, Image, MapPin, PenLine, Phone, Star, User } from 'lucide-react'
import { useEntornoAnimacion } from '../../hooks/useEntornoAnimacion.js'
import { useRevelarEnPantalla } from '../../hooks/useRevelarEnPantalla.js'
import { IconoFacebook, IconoInstagram, IconoTikTok } from '../../components/IconosRedes.jsx'
import { supabase } from '../../lib/supabase.js'
import { resolverUrlGaleria, urlPublicaFoto } from '../../lib/imagenes.js'
import { formatearDias, formatearHora, numeroWhatsapp } from '../../lib/contactoNegocio.js'
import { nombrePublico } from '../../lib/resenas.js'
import ComparadorAntesDespues from '../../components/ComparadorAntesDespues.jsx'
import Estrellas from '../../components/Estrellas.jsx'
import PieClienteWeb from './PieClienteWeb.jsx'

const formatoFechaResena = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'America/Lima',
})

const BUCKET_FOTOS_EQUIPO = 'fotos-asistentes'

const SUBSECCIONES = [
  { id: 'equipo', label: 'Equipo' },
  { id: 'galeria', label: 'Galería' },
  { id: 'resenas', label: 'Reseñas' },
  { id: 'contacto', label: 'Contacto' },
]

const INTERVALO_CARRUSEL_MS = 4500

// Retrasos de entrada (ms) propuestos en docs/diseno-nosotros/README.md.
const ENTRADA = { titulo: 300, texto: 450, foto: 300, fichaBase: 500, fichaPaso: 80, tarjetas: 600 }

function urlFotoEquipo(ruta) {
  if (!ruta) return null
  return /^https?:\/\//.test(ruta) ? ruta : urlPublicaFoto(BUCKET_FOTOS_EQUIPO, ruta)
}

// Retrato con fotos apiladas que se cruzan cada 4,5 s (opacity 1,8 s +
// zoom leve 1,05 → 1). Solo opacity/transform. Con prefers-reduced-motion
// queda el fundido, sin zoom. El setInterval se limpia al desmontar y se
// reinicia al hacer clic en una barra.
function RetratoCarrusel({ fotos, reducirMovimiento }) {
  const [activa, setActiva] = useState(0)
  const [reinicio, setReinicio] = useState(0)
  const urls = fotos.map(urlFotoEquipo).filter(Boolean)
  const total = urls.length

  useEffect(() => {
    if (total < 2) return undefined
    const id = setInterval(() => setActiva((i) => (i + 1) % total), INTERVALO_CARRUSEL_MS)
    return () => clearInterval(id)
  }, [total, reinicio])

  function irA(indice) {
    setActiva(indice)
    setReinicio((n) => n + 1)
  }

  return (
    <div className="relative aspect-[5/4] w-full overflow-hidden bg-black md:aspect-auto md:h-[400px] md:w-[300px]">
      {total === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <User className="h-12 w-12 text-white/20" />
        </div>
      )}
      {urls.map((url, i) => {
        const visible = i === activa
        return (
          <img
            key={url}
            src={url}
            alt=""
            aria-hidden={!visible}
            loading={i === 0 ? 'eager' : 'lazy'}
            className="absolute inset-0 h-full w-full object-cover"
            style={{
              opacity: visible ? 1 : 0,
              transform: reducirMovimiento || visible ? 'none' : 'scale(1.05)',
              transition: reducirMovimiento
                ? 'opacity 1.8s ease-in-out'
                : 'opacity 1.8s ease-in-out, transform 7s ease-out',
            }}
          />
        )
      })}
      {total > 1 && (
        <div className="absolute bottom-3.5 left-4 right-4 z-10 flex gap-1.5">
          {urls.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => irA(i)}
              aria-label={`Ver foto ${i + 1}`}
              className="h-[3px] grow rounded-sm border-0 p-0"
              style={{
                background: i === activa ? '#ffffff' : 'rgba(255,255,255,0.3)',
                transition: 'background 1.2s ease',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FilaFicha({ etiqueta, children, animacion }) {
  return (
    <div className={`grid grid-cols-[96px_minmax(0,1fr)] items-baseline gap-3 md:grid-cols-[130px_minmax(0,1fr)] md:gap-4 ${animacion.className}`} style={animacion.style}>
      <span className="text-xs text-white/50">{etiqueta}</span>
      <span className="text-sm font-semibold leading-normal text-white">{children}</span>
    </div>
  )
}

// Lleva al perfil completo (biografía) de la persona.
function BotonConoceMas({ persona }) {
  const nombre = persona.nombres_completos.split(' ')[0]
  return (
    <Link
      to={`/nosotros/equipo/${persona.id}`}
      className="group/mas inline-flex w-fit items-center gap-2 text-[13px] font-semibold text-[var(--lw-gold)] transition-opacity hover:opacity-80"
    >
      Conoce más de {nombre}
      <ArrowRight className="h-4 w-4 transition-transform group-hover/mas:translate-x-0.5 motion-reduce:transition-none" />
    </Link>
  )
}

function TarjetaEquipo({ persona, indice, refTarjeta, animacion }) {
  const urlFoto = urlPublicaFoto(BUCKET_FOTOS_EQUIPO, persona.foto_url)

  return (
    <article
      ref={refTarjeta}
      className={`group liquid-glass flex flex-row overflow-hidden rounded-none sm:flex-col ${animacion.className}`}
      style={animacion.style}
    >
      <div className="relative min-h-[150px] w-28 shrink-0 overflow-hidden bg-black sm:aspect-[4/5] sm:min-h-0 sm:w-auto">
        <div className="absolute inset-0 flex items-center justify-center transition-transform duration-[600ms] ease-[cubic-bezier(.2,.7,.2,1)] group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100">
          {urlFoto ? (
            <img src={urlFoto} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <User className="h-12 w-12 text-white/20" />
          )}
        </div>
        <span className="absolute left-4 top-3.5 text-[11px] tracking-[0.2em] text-white/70">
          {String(indice + 1).padStart(2, '0')}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-1 px-5 pb-5 pt-4">
        <h3 className="text-lg font-semibold text-white">{persona.nombres_completos}</h3>
        {persona.especialidad && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--lw-gold)]">
            {persona.especialidad}
          </p>
        )}
        {persona.bio && <p className="mt-2 text-sm leading-relaxed text-white/60">{persona.bio}</p>}
        <div className="mt-3">
          <BotonConoceMas persona={persona} />
        </div>
      </div>
    </article>
  )
}

// Fuentes: equipo_para_web() (recorte security definer de "asistentes"
// activo + mostrar_en_web; incluye es_duena, redes y horario propios) y
// datos_contacto() (solo el teléfono del cierre con WhatsApp). Rediseño de
// docs/diseno-nosotros/: hero propio de Equipo (título + retrato de la
// dueña con carrusel + ficha), grilla de perfiles y cierre solo con
// WhatsApp (sin "Reservar cita"). Sin foto real todavía en ninguna
// asistente: el placeholder es un fondo negro con un ícono, no una imagen
// inventada.
function SeccionEquipo() {
  const [equipo, setEquipo] = useState([])
  const [contacto, setContacto] = useState(null)
  const [cargando, setCargando] = useState(true)
  const { reducirMovimiento } = useEntornoAnimacion()

  useEffect(() => {
    let vigente = true

    Promise.all([supabase.rpc('equipo_para_web'), supabase.rpc('datos_contacto')]).then(([equipoRes, contactoRes]) => {
      if (!vigente) return
      setEquipo(equipoRes.data ?? [])
      setContacto(contactoRes.data?.[0] ?? null)
      setCargando(false)
    })

    return () => {
      vigente = false
    }
  }, [])

  // Nosotros no está cacheada: cambiar de sub-sección y volver remonta y la
  // animación se repite (válido). Con reduced-motion no se aplica nada.
  const entra = (clase, retrasoMs) =>
    reducirMovimiento ? { className: '' } : { className: clase, style: { animationDelay: `${retrasoMs}ms` } }

  // Las tarjetas entran al aparecer en pantalla, una sola vez por clave
  // (docs/patrones/animacion-entrada.md): las ya visibles al cargar usan el
  // retraso "de página"; las de más abajo, solo el escalonado.
  // La fundadora (es_duena, la primera) va en el hero; la grilla es el resto.
  const duena = equipo.find((persona) => persona.es_duena) ?? null
  const resto = useMemo(() => equipo.filter((persona) => !persona.es_duena), [equipo])
  const claves = useMemo(() => resto.map((persona) => persona.id), [resto])
  const { contenedorRef, refFila, estadoFila } = useRevelarEnPantalla({
    activo: !reducirMovimiento && !cargando,
    claves,
    agotarEnMs: 4000,
  })
  // El hook observa contra el contenedor con scroll de la pestaña, que vive
  // en NosotrosCliente (padre): se lo enlazamos desde el nodo raíz.
  const enlazarContenedor = (nodo) => {
    contenedorRef.current = nodo?.closest('[data-scroll-nosotros]') ?? null
  }

  // Todo sale de la ficha de la fundadora (no del negocio): redes y horario propios.
  const redes = [
    { url: duena?.instagram_url, label: 'Instagram', Icono: IconoInstagram },
    { url: duena?.facebook_url, label: 'Facebook', Icono: IconoFacebook },
    { url: duena?.tiktok_url, label: 'TikTok', Icono: IconoTikTok },
  ].filter((red) => red.url)

  const filasFicha = [
    duena?.especialidad && { etiqueta: 'Especialidad', contenido: duena.especialidad },
    duena?.bio && { etiqueta: 'Sobre ella', contenido: <span className="font-normal text-white/80">{duena.bio}</span> },
    duena?.horario_web && { etiqueta: 'Horario', contenido: duena.horario_web },
    redes.length > 0 && {
      etiqueta: 'Síguenos',
      contenido: (
        <span className="flex flex-wrap gap-2">
          {redes.map(({ url, label, Icono }) => (
            <a
              key={label}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-[13px] font-normal text-white transition-colors hover:bg-white/10"
            >
              <Icono />
              {label}
            </a>
          ))}
        </span>
      ),
    },
  ].filter(Boolean)

  return (
    <div ref={enlazarContenedor}>
      <section className="pb-12 pt-2 md:pb-16">
        <h1
          className={`lw-titulo-heavitas text-4xl uppercase leading-none md:text-[72px] ${entra('in-left', ENTRADA.titulo).className}`}
          style={entra('in-left', ENTRADA.titulo).style}
        >
          Nuestro equipo
        </h1>
        <p
          className={`mt-5 max-w-[52ch] text-base leading-relaxed text-white/70 ${entra('in-left', ENTRADA.texto).className}`}
          style={entra('in-left', ENTRADA.texto).style}
        >
          Conoce al salón por dentro: quién te atiende, en qué se especializa cada profesional y cómo encontrar a la
          persona indicada para tu próxima cita.
        </p>

        {!cargando && duena && (
          <div className="mt-10 grid grid-cols-1 gap-7 md:mt-12 md:grid-cols-[300px_minmax(0,1fr)] md:gap-14">
            <div
              className={`flex flex-col gap-3 ${entra('in-photo', ENTRADA.foto).className}`}
              style={entra('in-photo', ENTRADA.foto).style}
            >
              <RetratoCarrusel fotos={duena.foto_url ? [duena.foto_url] : []} reducirMovimiento={reducirMovimiento} />
              <div className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold text-white">{duena.nombres_completos}</span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--lw-gold)]">
                  Fundadora
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-5 pt-1.5 md:gap-[22px]">
              {filasFicha.map((fila, i) => (
                <FilaFicha
                  key={fila.etiqueta}
                  etiqueta={fila.etiqueta}
                  animacion={entra('in-up', ENTRADA.fichaBase + i * ENTRADA.fichaPaso)}
                >
                  {fila.contenido}
                </FilaFicha>
              ))}
              <div className="md:mt-auto">
                <BotonConoceMas persona={duena} />
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="border-t border-[#1f1f22] pb-12 pt-10 md:pb-[72px]">
        {cargando ? (
          <p className="py-10 text-center font-mono text-sm text-white/50">Cargando...</p>
        ) : resto.length === 0 ? (
          <div className="liquid-glass flex flex-col items-center gap-2 rounded-none py-16 text-center">
            <User className="h-8 w-8 text-white/30" />
            <p className="text-sm text-white/50">Todavía no hay perfiles publicados.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-9 lg:grid-cols-3">
            {resto.map((persona, indice) => {
              const decision = reducirMovimiento ? null : estadoFila(persona.id)
              const pendiente = !reducirMovimiento && !decision
              const retraso = (indice % 6) * 80 + (decision?.modo === 'carga' ? ENTRADA.tarjetas : 0)
              const animacion =
                pendiente
                  ? { className: '', style: { opacity: 0 } }
                  : decision && !decision.agotada
                    ? entra('in-up', retraso)
                    : { className: '' }
              return (
                <TarjetaEquipo
                  key={persona.id}
                  persona={persona}
                  indice={indice}
                  refTarjeta={refFila(persona.id)}
                  animacion={animacion}
                />
              )
            })}
          </div>
        )}
      </section>

      {contacto?.telefono && (
        <section className="border-t border-[#1f1f22] pb-6 pt-12 md:pt-14">
          <div className="flex flex-col items-start gap-5 md:flex-row md:items-center md:justify-between md:gap-8">
            <div className="flex max-w-[46ch] flex-col gap-2.5">
              <h2 className="lw-titulo-heavitas text-[28px] uppercase leading-tight">¿Lista para tu cita?</h2>
              <p className="text-[15px] leading-relaxed text-white/70">
                Escríbenos y te ayudamos a elegir con quién atenderte.
              </p>
            </div>
            <a
              href={`https://wa.me/${numeroWhatsapp(contacto.telefono)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--lw-gold)] bg-transparent px-[22px] py-3 text-sm font-semibold text-[var(--lw-gold)]"
            >
              <Phone className="h-4 w-4" />
              Escríbenos por WhatsApp
            </a>
          </div>
        </section>
      )}
    </div>
  )
}

// Grilla de antes/después — fuente: galeria_para_web() (98_galeria_web.sql),
// solo lo que el admin marcó activo. Formato pedido por el usuario:
// slider arrastrable de comparación (ComparadorAntesDespues.jsx), no el
// círculo que revela con el cursor que ya usa el hero de Inicio — son dos
// mecanismos distintos a propósito, cada uno pensado para su contexto
// (un solo hero grande vs. una grilla de varias fotos chicas).
function SeccionGaleria() {
  const [fotos, setFotos] = useState([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vigente = true

    supabase.rpc('galeria_para_web').then(({ data }) => {
      if (!vigente) return
      setFotos(data ?? [])
      setCargando(false)
    })

    return () => {
      vigente = false
    }
  }, [])

  if (cargando) {
    return <p className="py-10 text-center font-mono text-sm text-white/50">Cargando...</p>
  }

  if (fotos.length === 0) {
    return <SeccionProximamente icono={Image} mensaje="Muy pronto: fotos de nuestros trabajos." />
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fotos.map((foto) => (
        <ComparadorAntesDespues
          key={foto.id}
          antes={resolverUrlGaleria(foto.antes_url)}
          despues={resolverUrlGaleria(foto.despues_url)}
          altAntes={`${foto.titulo ?? 'Trabajo del salón'} — antes`}
          altDespues={`${foto.titulo ?? 'Trabajo del salón'} — después`}
          titulo={foto.titulo}
          mostrarEtiquetas
        />
      ))}
    </div>
  )
}

// Muro público de testimonios — fuente: resenas_publicas() (86_resenas.sql),
// solo reseñas ya APROBADAS por el admin. Escribir/editar la propia
// reseña vive aparte, en "Tus reseñas" (menú del avatar, MisResenasCliente.jsx).
function SeccionResenas() {
  const [resenas, setResenas] = useState([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vigente = true

    supabase.rpc('resenas_publicas').then(({ data }) => {
      if (!vigente) return
      setResenas(data ?? [])
      setCargando(false)
    })

    return () => {
      vigente = false
    }
  }, [])

  if (cargando) {
    return <p className="py-10 text-center font-mono text-sm text-white/50">Cargando...</p>
  }

  return (
    <div>
      <Link
        to="/mis-resenas"
        className="liquid-glass mb-4 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/5"
      >
        <PenLine className="h-3.5 w-3.5" />
        Escribe tu reseña
      </Link>

      {resenas.length === 0 ? (
        <div className="liquid-glass flex flex-col items-center gap-2 rounded-none py-16 text-center">
          <Star className="h-8 w-8 text-white/30" />
          <p className="text-sm text-white/50">Todavía no hay reseñas publicadas.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {resenas.map((resena, indice) => (
            <motion.div
              key={resena.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: (indice % 6) * 0.08 }}
              className="liquid-glass rounded-none p-5"
            >
              <Estrellas calificacion={resena.calificacion} />
              {resena.comentario && (
                <p className="mt-3 text-sm leading-relaxed text-white/80">"{resena.comentario}"</p>
              )}
              <p className="mt-3 text-xs font-medium text-white/50">
                {nombrePublico(resena.nombre)} · {formatoFechaResena.format(new Date(resena.creado_en))}
              </p>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}

// Dirección/teléfono/redes: datos_contacto() (87_contacto_negocio.sql).
// Horario: horario_atencion() (74_horario_atencion.sql, ya existía desde
// la fase de Citas Web — se reusa tal cual, no se inventa otro). Ningún
// dato hardcodeado acá: si el admin no cargó dirección/teléfono/redes
// desde ContactoWeb.jsx (POS), esas líneas simplemente no aparecen.
function SeccionContacto() {
  const [contacto, setContacto] = useState(null)
  const [horario, setHorario] = useState(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vigente = true

    Promise.all([supabase.rpc('datos_contacto'), supabase.rpc('horario_atencion')]).then(
      ([contactoRes, horarioRes]) => {
        if (!vigente) return
        setContacto(contactoRes.data?.[0] ?? null)
        setHorario(horarioRes.data?.[0] ?? null)
        setCargando(false)
      },
    )

    return () => {
      vigente = false
    }
  }, [])

  if (cargando) {
    return <p className="py-10 text-center font-mono text-sm text-white/50">Cargando...</p>
  }

  const redes = [
    { url: contacto?.instagram_url, label: 'Instagram' },
    { url: contacto?.facebook_url, label: 'Facebook' },
    { url: contacto?.tiktok_url, label: 'TikTok' },
  ].filter((red) => red.url)

  const sinDatos = !contacto?.direccion && !contacto?.telefono && !horario && redes.length === 0

  if (sinDatos) {
    return <SeccionProximamente icono={MapPin} mensaje="Muy pronto: dirección, horario y contacto." />
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="liquid-glass rounded-none p-5">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${contacto?.abierto ? 'bg-green' : 'bg-red'}`} />
          <span className="text-sm font-medium text-white">
            {contacto?.abierto ? 'Abierto ahora' : 'Cerrado ahora'}
          </span>
        </div>

        {contacto?.direccion && (
          <div className="mt-4 flex items-start gap-2.5">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--lw-gold)]" />
            <p className="text-sm text-white/80">{contacto.direccion}</p>
          </div>
        )}

        {contacto?.direccion && (
          <div className="mt-4 h-52 overflow-hidden border border-white/10 bg-[#151517]">
            <iframe
              title="Ubicación en el mapa"
              src={`https://www.google.com/maps?q=${encodeURIComponent(contacto.direccion)}&output=embed`}
              className="h-full w-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        )}

        {horario && (
          <div className="mt-3 flex items-start gap-2.5">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--lw-gold)]" />
            <div className="text-sm text-white/80">
              <p>{formatearDias(horario.dias_atencion)}</p>
              <p className="text-white/60">
                {formatearHora(horario.bloque1_inicio)} - {formatearHora(horario.bloque1_fin)}
                {horario.bloque2_inicio && (
                  <>
                    {' '}
                    y {formatearHora(horario.bloque2_inicio)} - {formatearHora(horario.bloque2_fin)}
                  </>
                )}
              </p>
            </div>
          </div>
        )}

        {contacto?.telefono && (
          <a
            href={`https://wa.me/${numeroWhatsapp(contacto.telefono)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex items-center justify-center gap-2 rounded-full border border-[var(--lw-gold)] bg-transparent py-2.5 text-sm font-semibold text-[var(--lw-gold)]"
          >
            <Phone className="h-4 w-4" />
            Escríbenos por WhatsApp
          </a>
        )}
      </div>

      {redes.length > 0 && (
        <div className="flex justify-center gap-3">
          {redes.map((red) => (
            <a
              key={red.label}
              href={red.url}
              target="_blank"
              rel="noopener noreferrer"
              className="liquid-glass flex items-center gap-1.5 rounded-full px-4 py-2 text-sm text-white transition-colors hover:bg-white/5"
            >
              <Globe className="h-3.5 w-3.5" />
              {red.label}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function SeccionProximamente({ icono: Icono, mensaje }) {
  return (
    <div className="liquid-glass flex flex-col items-center gap-2 rounded-none py-16 text-center">
      <Icono className="h-8 w-8 text-white/30" />
      <p className="text-sm text-white/50">{mensaje}</p>
    </div>
  )
}

// Pestaña "Nosotros" (§7 implementacionesWed.md): agrupa el contenido de
// marca del salón (quién es, quién atiende, qué dicen sus clientas) bajo
// una sola pestaña de la barra principal, con su propia sub-navegación
// interna — decisión explícita del usuario para no ir sumando una
// pestaña nueva a la barra por cada página de este tipo (Equipo,
// Galería, Reseñas, Contacto...). Las 4 ya tienen contenido real —
// SeccionProximamente queda solo como el estado vacío de Galería
// mientras el admin no cargue ninguna foto (o si algún día se agrega
// una 5ta sección que todavía no tenga nada).
export default function NosotrosCliente() {
  const [seccionActiva, setSeccionActiva] = useState('equipo')
  const tabsRef = useRef([])

  function alTeclear(evento, indice) {
    const total = SUBSECCIONES.length
    let destino = null
    if (evento.key === 'ArrowRight') destino = (indice + 1) % total
    else if (evento.key === 'ArrowLeft') destino = (indice - 1 + total) % total
    else if (evento.key === 'Home') destino = 0
    else if (evento.key === 'End') destino = total - 1
    if (destino === null) return
    evento.preventDefault()
    setSeccionActiva(SUBSECCIONES[destino].id)
    tabsRef.current[destino]?.focus()
  }

  return (
    <div data-scroll-nosotros className="animate-entrada-pestana flex-1 overflow-y-auto py-4 md:py-8">
      <div className="mx-auto w-full max-w-[1400px] lw-gutter-detalle">
        {/* En Equipo el hero propio ya trae su texto de presentación. */}
        {seccionActiva !== 'equipo' && <p className="mb-5 text-sm text-white/60">Conoce al salón por dentro.</p>}

        {/* Mismo diseño que las subpestañas de Recompensas (píldoras con borde,
            activa en blanco) y el mismo patrón WAI-ARIA de teclado. */}
        <div role="tablist" aria-label="Secciones de Nosotros" className="mb-6 flex flex-wrap gap-2">
          {SUBSECCIONES.map((seccion, indice) => {
            const activa = seccionActiva === seccion.id
            return (
              <button
                key={seccion.id}
                ref={(el) => {
                  tabsRef.current[indice] = el
                }}
                type="button"
                role="tab"
                aria-selected={activa}
                tabIndex={activa ? 0 : -1}
                onClick={() => setSeccionActiva(seccion.id)}
                onKeyDown={(evento) => alTeclear(evento, indice)}
                className={`min-h-11 whitespace-nowrap rounded-full border px-[18px] text-sm font-semibold transition-colors ${
                  activa
                    ? 'border-white bg-white text-[#0b0b0c]'
                    : 'border-[#3a3a3f] bg-transparent text-white hover:border-[var(--lw-gold)]'
                }`}
              >
                {seccion.label}
              </button>
            )
          })}
        </div>

        {seccionActiva === 'equipo' && <SeccionEquipo />}
        {seccionActiva === 'galeria' && <SeccionGaleria />}
        {seccionActiva === 'resenas' && <SeccionResenas />}
        {seccionActiva === 'contacto' && <SeccionContacto />}
      </div>

      <PieClienteWeb />
    </div>
  )
}
