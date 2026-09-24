import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, useInView } from 'framer-motion'
import { Clock, Globe, Image, MapPin, PenLine, Phone, Star, User, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { urlPublicaFoto } from '../../lib/imagenes.js'
import { formatearDias, formatearHora, numeroWhatsapp } from '../../lib/contactoNegocio.js'
import PieClienteWeb from './PieClienteWeb.jsx'

const formatoFechaResena = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'America/Lima',
})

// "María López" → "María L." — el nombre completo real solo lo ve el
// admin (panel de moderación); en el muro público alcanza con esto.
function nombrePublico(nombre) {
  const partes = (nombre ?? '').trim().split(/\s+/)
  if (partes.length < 2) return partes[0] ?? 'Clienta'
  return `${partes[0]} ${partes[1][0].toUpperCase()}.`
}

function Estrellas({ calificacion, className = 'h-4 w-4' }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className={`${className} ${
            i < calificacion ? 'fill-[var(--lw-gold)] text-[var(--lw-gold)]' : 'text-white/20'
          }`}
        />
      ))}
    </div>
  )
}

const BUCKET_FOTOS_EQUIPO = 'fotos-asistentes'

const SUBSECCIONES = [
  { id: 'equipo', label: 'Equipo', icono: Users },
  { id: 'galeria', label: 'Galería', icono: Image },
  { id: 'resenas', label: 'Reseñas', icono: Star },
  { id: 'contacto', label: 'Contacto', icono: MapPin },
]

function TarjetaEquipo({ persona, indice }) {
  const ref = useRef(null)
  const enVista = useInView(ref, { once: true, margin: '-60px' })
  const urlFoto = urlPublicaFoto(BUCKET_FOTOS_EQUIPO, persona.foto_url)

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={enVista ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay: (indice % 6) * 0.08 }}
      className="liquid-glass overflow-hidden rounded-none"
    >
      <div className="flex aspect-square items-center justify-center bg-black">
        {urlFoto ? (
          <img src={urlFoto} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <User className="h-12 w-12 text-white/20" />
        )}
      </div>
      <div className="p-4">
        <p className="text-base font-semibold text-white">{persona.nombres_completos}</p>
        {persona.especialidad && (
          <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-[var(--lw-gold)]">
            {persona.especialidad}
          </p>
        )}
        {persona.bio && <p className="mt-2 text-sm leading-relaxed text-white/60">{persona.bio}</p>}
      </div>
    </motion.div>
  )
}

// Fuente: equipo_para_web() (83_equipo_web.sql), un recorte security
// definer de "asistentes" con solo lo que el admin marcó activo +
// mostrar_en_web = true. Sin foto real todavía en ninguna asistente: el
// placeholder es un fondo negro con un ícono, no una imagen inventada —
// el admin las va a ir cargando desde Asistentes.jsx (POS).
function SeccionEquipo() {
  const [equipo, setEquipo] = useState([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vigente = true

    supabase.rpc('equipo_para_web').then(({ data }) => {
      if (!vigente) return
      setEquipo(data ?? [])
      setCargando(false)
    })

    return () => {
      vigente = false
    }
  }, [])

  if (cargando) {
    return <p className="py-10 text-center font-mono text-sm text-white/50">Cargando...</p>
  }

  if (equipo.length === 0) {
    return (
      <div className="liquid-glass flex flex-col items-center gap-2 rounded-none py-12 text-center">
        <User className="h-8 w-8 text-white/30" />
        <p className="text-sm text-white/50">Todavía no hay perfiles publicados.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {equipo.map((persona, indice) => (
        <TarjetaEquipo key={persona.id} persona={persona} indice={indice} />
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
            className="mt-4 flex items-center justify-center gap-2 rounded-full bg-[var(--lw-gold)] py-2.5 text-sm font-semibold text-black"
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
// Galería, Reseñas, Contacto...). Solo "Equipo" tiene contenido real
// hoy; el resto son placeholders "Próximamente" hasta que se construyan.
export default function NosotrosCliente() {
  const [seccionActiva, setSeccionActiva] = useState('equipo')

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mx-auto w-full max-w-5xl">
        <p className="mb-5 text-sm text-white/60">Conoce al salón por dentro.</p>

        <div className="liquid-glass mb-6 flex w-fit items-center gap-1 rounded-full p-1.5">
          {SUBSECCIONES.map((seccion) => {
            const activa = seccionActiva === seccion.id
            return (
              <button
                key={seccion.id}
                type="button"
                onClick={() => setSeccionActiva(seccion.id)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors sm:px-4 sm:py-2 ${
                  activa ? 'bg-[var(--lw-gold)] text-black' : 'text-white/60 hover:text-white'
                }`}
              >
                <seccion.icono className="h-4 w-4 shrink-0" />
                {seccion.label}
              </button>
            )
          })}
        </div>

        {seccionActiva === 'equipo' && <SeccionEquipo />}
        {seccionActiva === 'galeria' && (
          <SeccionProximamente icono={Image} mensaje="Muy pronto: fotos de nuestros trabajos." />
        )}
        {seccionActiva === 'resenas' && <SeccionResenas />}
        {seccionActiva === 'contacto' && <SeccionContacto />}
      </div>

      <PieClienteWeb />
    </div>
  )
}
