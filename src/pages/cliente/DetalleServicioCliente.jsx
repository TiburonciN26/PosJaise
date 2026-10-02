import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowUpRight,
  Award,
  Calendar,
  Check,
  Clock,
  CreditCard,
  Heart,
  MessageCircle,
  PenLine,
  Plus,
  ShieldCheck,
  Sparkles,
  Star,
  Truck,
  X,
} from 'lucide-react'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { useToast } from '../../context/ToastContext.jsx'
import { useCarritoCliente } from '../../context/CarritoClienteContext.jsx'
import { useEstadoNegocio } from '../../context/EstadoNegocioContext.jsx'
import { formatearSoles } from '../../lib/moneda.js'
import { urlPublicaFoto } from '../../lib/imagenes.js'
import { numeroWhatsapp } from '../../lib/contactoNegocio.js'
import { degradadoServicio, formatearDuracion } from '../../lib/serviciosVisual.js'
import TarjetaServicioCliente from '../../components/TarjetaServicioCliente.jsx'
import BarraTuCitaFlotante from '../../components/BarraTuCitaFlotante.jsx'
import PieClienteWeb from './PieClienteWeb.jsx'

const BUCKET_FOTOS = 'fotos-servicios'
// config_puntos.puntos_por_sol_gastado (88_puntos.sql) — se vuelve a
// pedir acá porque mis_puntos() no acepta un monto hipotético, solo
// calcula sobre historial real; este valor SÍ es el real de la tabla de
// configuración, no un supuesto (ver README, "regla de puntos por
// servicio" seguía pendiente de decidir — la fórmula ya existe, lo que
// falta es decidir si un servicio puntual puede valer distinto).
const PUNTOS_POR_SOL_DEFECTO = 0.05
// Colores de la barra de "Cómo es el servicio" — cíclicos si hay más
// pasos que colores (mismo criterio que la referencia del lienzo).
const COLORES_PASOS = ['#dbe7f7', '#a9c6ec', '#6f8fbd', '#3d5680']

// Detalle del servicio (docs/diseno-servicios/README.md) — pestaña nueva,
// se abre desde las tarjetas de Servicios (flecha ↗, "Ver detalles" del
// hero o el nombre/foto de la tarjeta). Las 10 migraciones del rediseño
// (107-116) ya están todas aplicadas: descripción, galería con etiqueta
// Resultado/Antes/Después, a domicilio, precio variable, cuánto dura el
// resultado, pasos del servicio, especificaciones/herramientas/
// materiales, cuidados antes/después, combo sugerido (manual o
// calculado, servicios_combo_sugerido()) y reseñas por servicio
// (resenas_servicio, con validación real de "ya se hizo este servicio"
// en guardar_mi_resena_servicio()). Cada bloque usa lo que el admin
// cargó desde ModalServicio.jsx y se oculta u ofrece contenido genérico
// en los servicios que todavía no lo tienen.
//
// Solo "cupos de la semana" sigue pendiente (README: se calcula con
// horario_atencion + citas, no es un stock guardado) — la celda de
// Disponibilidad muestra un texto genérico ("Consulta en Citas") en vez
// de inventar un número. // TODO backend
export default function DetalleServicioCliente() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { usuario } = useAuth()
  const { mostrarToast } = useToast()
  const { serviciosCarrito, agregarServicio, quitarServicio } = useCarritoCliente()
  const { adelantoMinimo, cancelacionPlazoHoras, cargando: cargandoNegocio } = useEstadoNegocio()

  const [servicio, setServicio] = useState(null)
  const [galeria, setGaleria] = useState([])
  const [combo, setCombo] = useState(null)
  const [relacionados, setRelacionados] = useState([])
  const [favorito, setFavorito] = useState(false)
  const [contacto, setContacto] = useState(null)
  const [puntosPorSol, setPuntosPorSol] = useState(PUNTOS_POR_SOL_DEFECTO)
  const [cargando, setCargando] = useState(true)
  const [noEncontrado, setNoEncontrado] = useState(false)
  const [fotoIdx, setFotoIdx] = useState(0)
  const [fotoTick, setFotoTick] = useState(0)

  // Reseñas por servicio (resenas_servicio, migración 116) — propias,
  // no las de resenas.jsx (general del salón, un cliente/de por vida).
  const [resumenResenas, setResumenResenas] = useState(null)
  const [resenasPublicas, setResenasPublicas] = useState([])
  const [miResena, setMiResena] = useState(null)
  const [mostrarFormResena, setMostrarFormResena] = useState(false)
  const [enviandoResena, setEnviandoResena] = useState(false)
  const [calificacionForm, setCalificacionForm] = useState(0)
  const [comentarioForm, setComentarioForm] = useState('')

  useEffect(() => {
    let vigente = true
    setCargando(true)
    setNoEncontrado(false)
    setFotoIdx(0)

    async function cargar() {
      const [servicioRes, galeriaRes, favoritoRes, configRes, contactoRes, resumenRes, publicasRes, miResenaRes] =
        await Promise.all([
          supabase
            .from('servicios')
            .select(
              'id, nombre, categoria, precio, duracion_min, foto_url, descripcion, a_domicilio, costo_domicilio, precio_variable, nota_precio, duracion_resultado, pasos, especificaciones, herramientas, materiales, cuidados_antes, cuidados_despues, combo_con',
            )
            .eq('id', id)
            .eq('activo', true)
            .maybeSingle(),
          supabase.from('servicio_fotos').select('id, foto_url, etiqueta').eq('servicio_id', id).order('orden'),
          supabase.from('favoritos_servicios').select('servicio_id').eq('servicio_id', id).maybeSingle(),
          supabase.from('config_puntos').select('puntos_por_sol_gastado').eq('id', 1).maybeSingle(),
          supabase.rpc('datos_contacto'),
          supabase.rpc('resenas_servicio_resumen', { p_servicio_id: id }),
          supabase.rpc('resenas_servicio_publicas', { p_servicio_id: id }),
          supabase.rpc('mi_resena_servicio', { p_servicio_id: id }),
        ])

      if (!vigente) return

      if (!servicioRes.data) {
        setNoEncontrado(true)
        setCargando(false)
        return
      }

      setServicio(servicioRes.data)
      setGaleria(galeriaRes.data ?? [])
      setResumenResenas(resumenRes.data?.[0] ?? null)
      setResenasPublicas((publicasRes.data ?? []).slice(0, 3))
      const propia = Array.isArray(miResenaRes.data) ? miResenaRes.data[0] : miResenaRes.data
      // QA-008: sin reseña propia la RPC devuelve una fila con todo nulo (truthy);
      // solo cuenta como reseña si trae id.
      setMiResena(propia?.id ? propia : null)
      setCalificacionForm(propia?.calificacion ?? 0)
      setComentarioForm(propia?.comentario ?? '')
      setFavorito(Boolean(favoritoRes.data))
      if (configRes.data) setPuntosPorSol(Number(configRes.data.puntos_por_sol_gastado))
      setContacto(contactoRes.data?.[0] ?? null)

      const { data: rel } = await supabase
        .from('servicios')
        .select('id, nombre, categoria, precio, duracion_min, foto_url')
        .eq('activo', true)
        .eq('categoria', servicioRes.data.categoria)
        .neq('id', id)
        .order('nombre')
        .limit(4)

      if (vigente) setRelacionados(rel ?? [])

      // Combo sugerido (migración 114): el override manual del admin
      // (combo_con) gana; si no lo puso, se calcula el servicio que más
      // veces se reservó junto a este (servicios_combo_sugerido()).
      let comboId = servicioRes.data.combo_con
      if (!comboId) {
        const { data: sugerido } = await supabase.rpc('servicios_combo_sugerido', { p_servicio_id: id })
        comboId = sugerido?.[0]?.servicio_id ?? null
      }
      if (comboId) {
        const { data: comboData } = await supabase
          .from('servicios')
          .select('id, nombre, precio, duracion_min, foto_url')
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

  // Galería (servicio_fotos, migración 110): si el servicio todavía no
  // tiene ninguna foto propia ahí, cae a la única foto de
  // servicios.foto_url — así los servicios viejos (editados antes de la
  // migración) siguen mostrando algo en vez de un carrusel vacío.
  const fotos = useMemo(() => {
    if (galeria.length > 0) return galeria
    if (servicio?.foto_url) return [{ id: 'principal', foto_url: servicio.foto_url, etiqueta: 'Resultado' }]
    return []
  }, [galeria, servicio])
  const fotoIdxSeguro = fotos.length ? fotoIdx % fotos.length : 0
  const fotoActual = fotos[fotoIdxSeguro]

  // Carrusel automático cada 5s, igual que el hero de Servicios —
  // fotoTick reinicia el timer al elegir una foto/miniatura a mano.
  useEffect(() => {
    if (fotos.length < 2) return undefined
    const idTimer = setInterval(() => setFotoIdx((indice) => (indice + 1) % fotos.length), 5000)
    return () => clearInterval(idTimer)
  }, [fotos.length, fotoTick])

  function irAFoto(indice) {
    setFotoIdx(indice)
    setFotoTick((valor) => valor + 1)
  }

  const enCita = servicio ? serviciosCarrito.has(servicio.id) : false
  const duracion = servicio ? formatearDuracion(servicio.duracion_min) : null
  const puntosEstimados = servicio ? Math.max(0, Math.round(Number(servicio.precio) * puntosPorSol)) : 0
  const whatsapp = contacto?.telefono ? numeroWhatsapp(contacto.telefono) : null

  async function alternarCita() {
    const exito = enCita ? await quitarServicio(servicio.id) : await agregarServicio(servicio.id)
    if (!exito) mostrarToast('No se pudo actualizar tu cita.', 'error')
  }

  async function reservarAhora() {
    if (!enCita) {
      const exito = await agregarServicio(servicio.id)
      if (!exito) {
        mostrarToast('No se pudo agregar a tu cita.', 'error')
        return
      }
    }
    navigate('/citas')
  }

  async function agregarCombo() {
    const idsAAgregar = [servicio.id, combo.id].filter((idServicio) => !serviciosCarrito.has(idServicio))
    const resultados = await Promise.all(idsAAgregar.map((idServicio) => agregarServicio(idServicio)))
    if (resultados.some((exito) => !exito)) {
      mostrarToast('No se pudo agregar el combo completo a tu cita.', 'error')
      return
    }
    mostrarToast('Agregados los dos a tu cita.', 'exito')
  }

  async function enviarResena(evento) {
    evento.preventDefault()
    if (calificacionForm < 1) {
      mostrarToast('Elige una calificación de 1 a 5 estrellas.', 'error')
      return
    }

    setEnviandoResena(true)
    const { data, error } = await supabase.rpc('guardar_mi_resena_servicio', {
      p_servicio_id: servicio.id,
      p_calificacion: calificacionForm,
      p_comentario: comentarioForm.trim() || null,
    })
    setEnviandoResena(false)

    if (error) {
      // El mensaje real (ej. "Solo pueden reseñar las clientas que ya se
      // hicieron este servicio") lo tira la propia función de la base —
      // se muestra tal cual, no uno genérico.
      mostrarToast(error.message, 'error')
      return
    }

    setMiResena(data)
    setMostrarFormResena(false)
    mostrarToast('¡Gracias! Tu reseña se publicará cuando el admin la revise.', 'exito')
  }

  async function alternarFavorito() {
    const { error } = favorito
      ? await supabase.from('favoritos_servicios').delete().eq('cliente_web_id', usuario.id).eq('servicio_id', servicio.id)
      : await supabase.from('favoritos_servicios').insert({ cliente_web_id: usuario.id, servicio_id: servicio.id })
    if (error) {
      mostrarToast('No se pudo actualizar tus favoritos.', 'error')
      return
    }
    setFavorito((valor) => !valor)
  }

  function compartir() {
    const texto =
      `✨ Mira este servicio:\n\n💅 *${servicio.nombre}*\n` +
      `💰 Desde ${formatearSoles(servicio.precio)}` +
      (duracion ? ` · ⏱ ${duracion}` : '') +
      `\n\n¡Reserva tu cita!`
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener,noreferrer')
  }

  if (cargando) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="font-mono text-sm text-white/50">Cargando...</p>
      </div>
    )
  }

  if (noEncontrado || !servicio) {
    return <Navigate to="/servicios" replace />
  }

  const totalPasosMin = (servicio.pasos ?? []).reduce((suma, paso) => suma + (Number(paso.minutos) || 0), 0)

  return (
    <div className="animate-entrada-pestana flex-1 overflow-y-auto pb-24 lg:pb-8">
      {/* Migas + volver */}
      <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-4 px-4 pt-6 sm:px-8">
        <nav aria-label="Ruta" className="flex min-w-0 items-center gap-2 truncate text-[11px] font-medium uppercase tracking-wider text-white/50">
          <Link to="/servicios" className="shrink-0 hover:text-white">
            Servicios
          </Link>
          <span className="shrink-0">/</span>
          <span className="shrink-0">{servicio.categoria ?? 'General'}</span>
          <span className="shrink-0">/</span>
          <span className="truncate text-white">{servicio.nombre}</span>
        </nav>
        <Link
          to="/servicios"
          className="hidden shrink-0 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--lw-gold)] hover:text-white sm:flex"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Volver a servicios
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
              <img src={urlPublicaFoto(BUCKET_FOTOS, fotoActual.foto_url)} alt={servicio.nombre} className="h-full w-full object-cover" />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center text-white/60"
                style={{ background: degradadoServicio(servicio) }}
              >
                <Sparkles className="h-10 w-10" />
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
                    className={`lw-barra-progreso ${
                      indice === fotoIdxSeguro ? 'activa' : indice < fotoIdxSeguro ? 'completa' : ''
                    }`}
                  >
                    <span />
                  </button>
                ))}
              </div>
            )}

            {fotoActual && (
              <div className="absolute inset-x-3 bottom-3 flex items-end justify-between text-[10px] font-semibold uppercase tracking-widest text-white">
                <span>{fotoActual.etiqueta}</span>
                {fotos.length > 1 && (
                  <span>
                    {fotoIdxSeguro + 1} / {fotos.length}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-white/60">
              {servicio.categoria ?? 'Servicio'}
            </span>
            <h1 className="lw-titulo-heavitas text-4xl uppercase leading-none sm:text-[52px]">{servicio.nombre}</h1>
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span className="text-[13px] text-white/60">desde</span>
              <span className="text-3xl font-bold text-white sm:text-4xl">{formatearSoles(servicio.precio)}</span>
              {servicio.precio_variable && (
                <span className="text-xs text-white/50">
                  {servicio.nota_precio || 'El precio final puede variar según el diagnóstico.'}
                </span>
              )}
            </div>
          </div>

          <p className="text-[15px] leading-relaxed text-[#d9d9dc]">
            {servicio.descripcion ||
              `Uno de nuestros servicios de ${servicio.categoria ?? 'salón'} más solicitados. Coordina el diagnóstico con tu estilista al momento de tu cita.`}
          </p>

          {/* Datos clave */}
          <div
            className={`grid grid-cols-1 divide-y divide-white/10 rounded-[10px] border border-white/10 bg-[#111113] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] ${
              servicio.duracion_resultado
                ? 'sm:grid-cols-2 sm:divide-x sm:divide-y lg:grid-cols-4 lg:divide-y-0'
                : 'sm:grid-cols-3 sm:divide-x sm:divide-y-0'
            }`}
          >
            <div className="flex flex-col gap-1.5 px-5 py-4">
              <span className="text-[11px] uppercase tracking-widest text-white/50">Duración</span>
              <span className="text-[17px] font-semibold text-white">{duracion ?? 'A confirmar'}</span>
            </div>
            <div className="flex flex-col gap-1.5 px-5 py-4">
              <span className="text-[11px] uppercase tracking-widest text-white/50">Disponibilidad</span>
              <span className="flex items-center gap-2 text-[17px] font-semibold text-white/80">
                <span className="h-2 w-2 rounded-full bg-[#3ecf6a]" />
                Consulta en Citas
              </span>
            </div>
            <div className="flex flex-col gap-1.5 px-5 py-4">
              <span className="text-[11px] uppercase tracking-widest text-white/50">A domicilio</span>
              {servicio.a_domicilio ? (
                <span className="flex items-center gap-2 text-[17px] font-semibold text-white">
                  <span className="h-2 w-2 rounded-full bg-[#3ecf6a]" />
                  {Number(servicio.costo_domicilio) > 0
                    ? `+ ${formatearSoles(servicio.costo_domicilio)}`
                    : 'Gratis a domicilio'}
                </span>
              ) : (
                <span className="flex items-center gap-2 text-[17px] font-semibold text-white/60">
                  <span className="h-2 w-2 rounded-full bg-[#5a5a60]" />
                  Solo en el local
                </span>
              )}
            </div>
            {servicio.duracion_resultado && (
              <div className="flex flex-col gap-1.5 px-5 py-4">
                <span className="text-[11px] uppercase tracking-widest text-white/50">El resultado dura</span>
                <span className="text-[17px] font-semibold text-white">{servicio.duracion_resultado}</span>
              </div>
            )}
          </div>

          {/* Acciones */}
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={alternarCita}
              className="flex items-center justify-between gap-3 rounded-full border px-6 py-2 pl-6 pr-2 text-[15px] font-semibold transition-colors"
              style={
                enCita
                  ? { borderColor: 'var(--lw-gold)', background: 'transparent', color: 'var(--lw-gold)' }
                  : { borderColor: 'var(--lw-gold)', background: 'var(--lw-gold)', color: '#0b0b0c' }
              }
            >
              {enCita ? 'Agregado a tu cita' : 'Agregar a mi cita'}
              <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-[#0b0b0c] text-[var(--lw-gold)]">
                {enCita ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              </span>
            </button>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={reservarAhora}
                className="flex flex-1 items-center justify-center gap-2 rounded-full border border-white/25 px-5 py-3.5 text-sm font-semibold text-white"
              >
                <Calendar className="h-4 w-4" /> Reservar ahora
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
            <span className="text-xs text-white/50">Puedes combinarlo con otros servicios en la misma cita. Eliges día y hora en Citas.</span>
          </div>

          {whatsapp && (
            <a
              href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hola, tengo una duda sobre "${servicio.nombre}".`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 border-y border-white/10 py-4 text-[13px] text-white"
            >
              <span className="flex items-center gap-2.5">
                <MessageCircle className="h-4 w-4" /> ¿Dudas sobre este servicio? Escríbenos por WhatsApp
              </span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          )}

          {/* Sellos: puntos · reseñas · fidelidad */}
          <div className="grid grid-cols-3 gap-4 py-2">
            <div className="flex flex-col items-center gap-2.5 text-center text-white">
              <Award className="h-8 w-8" strokeWidth={1.5} />
              <span className="text-[13.5px] font-semibold leading-tight">
                +{puntosEstimados} puntos
                <br />
                <span className="font-normal text-white/60">aprox. por esta visita</span>
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
                Suma sello
                <br />
                <span className="font-normal text-white/60">de fidelidad</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Adelanto y pago */}
      <section className="mx-auto mt-14 w-full max-w-[1200px] px-4 sm:px-8">
        <div className="grid grid-cols-1 divide-y divide-white/10 rounded-[10px] border border-white/10 bg-[#111113] shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] md:grid-cols-3 md:divide-x md:divide-y-0">
          <div className="flex gap-3.5 px-6 py-5">
            <CreditCard className="h-5 w-5 shrink-0 text-[var(--lw-gold)]" />
            <span className="flex flex-col gap-1">
              <span className="text-[13.5px] font-semibold text-white">Adelanto obligatorio para separar tu cita</span>
              <span className="text-[12.5px] leading-relaxed text-white/60">
                {/* QA-029: sin adelanto configurado (null) el sistema exige pagar el total
                    (reservar_cita_web usa coalesce(adelanto_minimo, precio_total) y el carrito
                    igual): se dice eso, sin inventar un monto ni mostrar un marcador. */}
                {cargandoNegocio
                  ? 'Cargando las condiciones de pago…'
                  : adelantoMinimo != null
                    ? `Deja el mínimo de ${formatearSoles(Number(adelantoMinimo))} o paga el total. Por Yape, Plin o transferencia; se descuenta del total.`
                    : 'Para separar tu cita se paga el total del servicio por adelantado (el negocio aún no define un adelanto menor). Por Yape, Plin o transferencia.'}
              </span>
            </span>
          </div>
          <div className="flex gap-3.5 px-6 py-5">
            <Clock className="h-5 w-5 shrink-0 text-[var(--lw-gold)]" />
            <span className="flex flex-col gap-1">
              <span className="text-[13.5px] font-semibold text-white">
                {cargandoNegocio
                  ? 'Cambios o cancelación'
                  : cancelacionPlazoHoras != null
                    ? `Cambios o cancelación hasta ${cancelacionPlazoHoras} h antes`
                    : 'Cambios o cancelación: consulta el plazo con el negocio'}
              </span>
              <span className="text-[12.5px] leading-relaxed text-white/60">
                {cancelacionPlazoHoras != null || cargandoNegocio
                  ? 'Después de ese plazo, el adelanto no se devuelve.'
                  : 'Pasado el plazo que te indique el negocio, el adelanto no se devuelve.'}
              </span>
            </span>
          </div>
          <div className="flex gap-3.5 px-6 py-5">
            <Truck className="h-5 w-5 shrink-0 text-[var(--lw-gold)]" />
            <span className="flex flex-col gap-1">
              <span className="text-[13.5px] font-semibold text-white">El saldo lo pagas en el local</span>
              <span className="text-[12.5px] leading-relaxed text-white/60">
                Efectivo, Yape, Plin, transferencia o tarjeta de crédito/débito (solo en el local).
              </span>
            </span>
          </div>
        </div>
      </section>

      {/* Cómo es el servicio */}
      {servicio.pasos?.length > 0 ? (
        <section className="mx-auto mt-16 w-full max-w-[1200px] px-4 sm:px-8">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="lw-titulo-heavitas text-2xl uppercase">Cómo es el servicio</h2>
            {totalPasosMin > 0 && (
              <span className="text-sm text-white/60">
                Total <b className="font-semibold text-white">{totalPasosMin} min</b>
              </span>
            )}
          </div>
          <div className="mt-7 flex h-2.5 gap-1">
            {servicio.pasos.map((paso, indice) => (
              <div
                key={indice}
                className="rounded-[3px]"
                style={{
                  width: totalPasosMin > 0 ? `${((paso.minutos || 0) / totalPasosMin) * 100}%` : `${100 / servicio.pasos.length}%`,
                  background: COLORES_PASOS[indice % COLORES_PASOS.length],
                }}
              />
            ))}
          </div>
          <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {servicio.pasos.map((paso, indice) => (
              <div key={indice} className="flex flex-col gap-2">
                <span className="flex items-center gap-2 text-[11px] tracking-widest text-white/60">
                  <span
                    className="h-2.5 w-2.5 rounded-[3px]"
                    style={{ background: COLORES_PASOS[indice % COLORES_PASOS.length] }}
                  />
                  PASO {indice + 1}
                  {paso.minutos ? ` · ${paso.minutos} min` : ''}
                </span>
                <span className="text-[15px] font-semibold text-white">{paso.nombre}</span>
                {paso.texto && <span className="text-[13px] leading-relaxed text-white/60">{paso.texto}</span>}
              </div>
            ))}
          </div>
        </section>
      ) : (
        duracion && (
          <section className="mx-auto mt-16 w-full max-w-[1200px] px-4 sm:px-8">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="lw-titulo-heavitas text-2xl uppercase">Cómo es el servicio</h2>
              <span className="text-sm text-white/60">
                Duración total <b className="font-semibold text-white">{duracion}</b>
              </span>
            </div>
            <div className="mt-6 h-2.5 w-full rounded-full" style={{ background: 'var(--lw-gold)' }} />
            <p className="mt-4 text-xs text-white/40">
              El detalle paso a paso de este servicio todavía no está cargado — muy pronto lo verás aquí.
            </p>
          </section>
        )
      )}

      {/* Cuidados antes y después */}
      {(servicio.cuidados_antes?.length > 0 || servicio.cuidados_despues?.length > 0) && (
        <section className="mx-auto mt-16 w-full max-w-[1200px] px-4 sm:px-8">
          <h2 className="lw-titulo-heavitas text-2xl uppercase">Cuidados antes y después</h2>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {servicio.cuidados_antes?.length > 0 && (
              <div className="rounded-[10px] border border-white/10 bg-[#111113] p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
                <span className="text-[15px] font-bold text-white">Antes de tu cita</span>
                <ul className="mt-3 list-none divide-y divide-white/10">
                  {servicio.cuidados_antes.map((texto, indice) => (
                    <li key={indice} className="flex gap-3 py-3 text-[13.5px] leading-relaxed text-[#d9d9dc]">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--lw-gold)]" />
                      <span>{texto}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {servicio.cuidados_despues?.length > 0 && (
              <div className="rounded-[10px] border border-white/10 bg-[#111113] p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
                <span className="text-[15px] font-bold text-white">Después de tu cita</span>
                <ul className="mt-3 list-none divide-y divide-white/10">
                  {servicio.cuidados_despues.map((texto, indice) => (
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

      {/* Especificaciones · Herramientas · Materiales */}
      {(servicio.especificaciones?.length > 0 || servicio.herramientas?.length > 0 || servicio.materiales?.length > 0) && (
        <section className="mx-auto mt-16 grid w-full max-w-[1200px] gap-4 px-4 sm:px-8 sm:grid-cols-3">
          {servicio.especificaciones?.length > 0 && (
            <div className="rounded-[10px] border border-white/10 bg-[#111113] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--lw-gold)]">
                Especificaciones técnicas
              </h3>
              <div className="mt-3 divide-y divide-white/10">
                {servicio.especificaciones.map((spec, indice) => (
                  <div key={indice} className="flex justify-between gap-4 py-2.5 text-[13px]">
                    <span className="text-white/60">{spec.clave}</span>
                    <span className="text-right font-medium text-white">{spec.valor}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {servicio.herramientas?.length > 0 && (
            <div className="rounded-[10px] border border-white/10 bg-[#111113] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--lw-gold)]">Herramientas usadas</h3>
              <div className="mt-3 divide-y divide-white/10">
                {servicio.herramientas.map((item, indice) => (
                  <div key={indice} className="flex flex-col gap-0.5 py-2.5 text-[13px]">
                    <span className="font-medium text-white">{item.nombre}</span>
                    {item.descripcion && <span className="text-xs text-white/50">{item.descripcion}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {servicio.materiales?.length > 0 && (
            <div className="rounded-[10px] border border-white/10 bg-[#111113] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--lw-gold)]">Materiales usados</h3>
              <div className="mt-3 divide-y divide-white/10">
                {servicio.materiales.map((item, indice) => (
                  <div key={indice} className="flex flex-col gap-0.5 py-2.5 text-[13px]">
                    <span className="font-medium text-white">{item.nombre}</span>
                    {item.descripcion && <span className="text-xs text-white/50">{item.descripcion}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Reseñas */}
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
                    <Star
                      key={i}
                      className="h-[18px] w-[18px]"
                      fill={i < Math.round(resumenResenas.promedio) ? 'currentColor' : 'none'}
                    />
                  ))}
                </div>
                <span className="text-[13px] text-white/60">
                  {resumenResenas.total} reseña{resumenResenas.total === 1 ? '' : 's'} de clientas que se hicieron
                  este servicio
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
                <p className="text-sm text-white/60">Aún no hay reseñas de este servicio.</p>
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
              <Link
                to="/nosotros"
                className="flex items-center gap-2 rounded-full border border-white/20 px-5 py-2.5 text-[13px] font-semibold text-white"
              >
                Reseñas del salón
              </Link>
            </div>
            {miResena?.estado === 'PENDIENTE' && (
              <span className="text-[11.5px] text-white/50">Tu reseña está en revisión antes de publicarse.</span>
            )}
            <span className="text-[11.5px] leading-relaxed text-white/40">
              Solo pueden reseñar las clientas que ya se hicieron este servicio.
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
                    <button
                      key={i}
                      type="button"
                      onClick={() => setCalificacionForm(i + 1)}
                      aria-label={`${i + 1} estrellas`}
                      className="text-[var(--lw-gold)]"
                    >
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
                <article
                  key={resena.id}
                  className="flex flex-col gap-3 rounded-[10px] border border-white/10 bg-[#111113] p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]"
                >
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
                    Clienta verificada
                  </span>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Se suele reservar junto con (combo sugerido) */}
      {combo && (
        <section className="mx-auto mt-16 w-full max-w-[1200px] px-4 sm:px-8">
          <h2 className="lw-titulo-heavitas text-2xl uppercase">Se suele reservar junto con</h2>
          <div className="mt-6 flex flex-col gap-6 rounded-[10px] border border-white/10 bg-[#111113] p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)] sm:flex-row sm:items-center sm:p-7">
            <div className="flex flex-1 flex-wrap items-center gap-4">
              <div className="flex items-center gap-3.5">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[10px] bg-[#151517]">
                  {urlPublicaFoto(BUCKET_FOTOS, servicio.foto_url) ? (
                    <img src={urlPublicaFoto(BUCKET_FOTOS, servicio.foto_url)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full" style={{ background: degradadoServicio(servicio) }} />
                  )}
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold text-white">{servicio.nombre}</span>
                  <span className="text-xs text-white/60">
                    {formatearSoles(servicio.precio)}
                    {formatearDuracion(servicio.duracion_min) && ` · ${formatearDuracion(servicio.duracion_min)}`}
                  </span>
                </div>
              </div>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 text-white/60">
                <Plus className="h-3.5 w-3.5" />
              </span>
              <Link to={`/servicios/${combo.id}`} className="flex items-center gap-3.5">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[10px] bg-[#151517]">
                  {urlPublicaFoto(BUCKET_FOTOS, combo.foto_url) ? (
                    <img src={urlPublicaFoto(BUCKET_FOTOS, combo.foto_url)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full" style={{ background: degradadoServicio(combo) }} />
                  )}
                </div>
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold text-white">{combo.nombre}</span>
                  <span className="text-xs text-white/60">
                    {formatearSoles(combo.precio)}
                    {formatearDuracion(combo.duracion_min) && ` · ${formatearDuracion(combo.duracion_min)}`}
                  </span>
                </div>
              </Link>
            </div>
            <div className="flex items-center gap-6 sm:border-l sm:border-white/10 sm:pl-7">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-white/60">
                  Total juntos
                  {formatearDuracion(Number(servicio.duracion_min || 0) + Number(combo.duracion_min || 0)) &&
                    ` · ${formatearDuracion(Number(servicio.duracion_min || 0) + Number(combo.duracion_min || 0))}`}
                </span>
                <span className="text-xl font-bold text-white">
                  {formatearSoles(Number(servicio.precio) + Number(combo.precio))}
                </span>
              </div>
              <button
                type="button"
                onClick={agregarCombo}
                className="flex shrink-0 items-center justify-between gap-3 rounded-full border px-5 py-1.5 pl-5 pr-1.5 text-sm font-semibold"
                style={
                  serviciosCarrito.has(servicio.id) && serviciosCarrito.has(combo.id)
                    ? { borderColor: 'var(--lw-gold)', background: 'transparent', color: 'var(--lw-gold)' }
                    : { borderColor: 'var(--lw-gold)', background: 'var(--lw-gold)', color: '#0b0b0c' }
                }
              >
                {serviciosCarrito.has(servicio.id) && serviciosCarrito.has(combo.id)
                  ? 'Agregados a tu cita'
                  : 'Agregar los dos a mi cita'}
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
              <span className="text-xs text-white/50">{servicio.categoria}</span>
            </div>
            <button
              type="button"
              onClick={() => navigate(`/servicios?categoria=${encodeURIComponent(servicio.categoria ?? '')}`)}
              className="flex shrink-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--lw-gold)]"
            >
              Ver todo <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-4 sm:gap-x-5 sm:gap-y-8">
            {relacionados.map((s) => (
              <TarjetaServicioCliente key={s.id} servicio={s} />
            ))}
          </div>
        </section>
      )}

      <PieClienteWeb />

      <BarraTuCitaFlotante servicios={[servicio, ...relacionados]} />
    </div>
  )
}
