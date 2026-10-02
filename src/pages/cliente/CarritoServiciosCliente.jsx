import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  Clock,
  CreditCard,
  Info,
  MessageCircle,
  Sparkles,
  Stamp,
  Trash2,
  User,
  Wallet,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase.js'
import { obtenerMiClienteId } from '../../lib/clienteWeb.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { useToast } from '../../context/ToastContext.jsx'
import { useCarritoCliente } from '../../context/CarritoClienteContext.jsx'
import { useEstadoNegocio } from '../../context/EstadoNegocioContext.jsx'
import { formatearSoles } from '../../lib/moneda.js'
import { procesarImagen, subirFoto, urlPublicaFoto } from '../../lib/imagenes.js'
import { formatearDias, formatearHora, numeroWhatsapp } from '../../lib/contactoNegocio.js'
import { degradadoServicio, formatearDuracion } from '../../lib/serviciosVisual.js'
import { aLima, formatearFechaISO, iniciarDia, sumarDias } from '../../lib/fechas.js'
import CampoSubirArchivo from '../../components/CampoSubirArchivo.jsx'
import Contador from '../../components/Contador.jsx'

const BUCKET_FOTOS_SERVICIOS = 'fotos-servicios'
const BUCKET_COMPROBANTES_CITAS = 'comprobantes-citas-web'
const BUCKET_QR_PAGOS = 'qr-pagos'
const DIAS_A_MOSTRAR = 14

const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function fechaCortaTexto(fecha) {
  const enLima = aLima(fecha)
  return `${DIAS_CORTOS[enLima.getUTCDay()]} ${enLima.getUTCDate()} ${MESES_CORTOS[enLima.getUTCMonth()]}`
}

const formatoHora = new Intl.DateTimeFormat('es-PE', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Lima',
})

// Íconos reales en public/icons/ — mismo criterio que CarritoCliente.jsx
// (Plin no tiene ícono propio todavía).
const METODOS_PAGO = [
  { id: 'YAPE', nombre: 'Yape', conQR: true, icono: 'icons/yape.svg' },
  { id: 'PLIN', nombre: 'Plin', conQR: true, icono: null },
  { id: 'TRANSFERENCIA', nombre: 'Transferencia', conQR: false, icono: 'icons/transferencia.svg' },
]

function FilaServicio({ servicio, onAlternar, onQuitar }) {
  return (
    <div className="relative flex gap-3 border-t border-[#1f1f22] py-4 sm:gap-4 sm:py-5">
      <div className="flex items-center">
        <input
          type="checkbox"
          className="h-[18px] w-[18px] shrink-0 accent-[var(--lw-gold)]"
          checked={servicio.marcado}
          onChange={onAlternar}
          aria-label={`Incluir ${servicio.nombre} en la reserva`}
        />
      </div>

      <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[5px] border border-[#1f1f22] bg-[#141416] text-[#4a4a4f] sm:h-[84px] sm:w-[84px]">
        {servicio.fotoUrl ? (
          <img src={servicio.fotoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-white/60"
            style={{ background: degradadoServicio(servicio) }}
          >
            <Sparkles className="h-6 w-6" />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-semibold text-white sm:text-[15px]">{servicio.nombre}</span>
        <span className="text-xs text-white/60 sm:text-[13px]">{servicio.categoria || 'Servicio'}</span>
        <span className="text-xs text-white/50">{formatearDuracion(servicio.duracionMin)}</span>
      </div>

      <div className="flex shrink-0 flex-col items-end justify-between">
        <span className="text-sm font-bold text-white sm:text-base">
          S/ <Contador valor={servicio.precio} decimales={2} tamano={14} />
        </span>
        <button
          type="button"
          onClick={onQuitar}
          aria-label={`Quitar ${servicio.nombre} del carrito`}
          className="flex h-10 w-10 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/5 hover:text-white"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// Barra fija inferior en móvil — portaleada a .landing-web, no a
// document.body: PortalCliente.jsx tiene overflow-hidden en su <main>,
// que recorta cualquier `fixed` de adentro aunque su containing block
// sea el viewport (mismo bug de CSS que BarraTuCitaFlotante.jsx ya
// resolvió con el mismo patrón).
function BarraConfirmarMovil({ monto, puntos, deshabilitado, enviando, onConfirmar }) {
  const contenido = (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center p-4 lg:hidden">
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-full border border-white/10 bg-[#141417]/95 py-1.5 pl-5 pr-1.5 shadow-2xl backdrop-blur-xl">
        <span className="min-w-0 flex-1 truncate text-sm text-white">
          <b className="font-semibold">{formatearSoles(monto)}</b>{' '}
          <span className="text-white/60">· +{puntos} pts</span>
        </span>
        <button
          type="button"
          onClick={onConfirmar}
          disabled={deshabilitado}
          className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-[#3ECF6A] px-5 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Check className="h-4 w-4" />
          {enviando ? 'Enviando...' : 'Confirmar'}
        </button>
      </div>
    </div>
  )

  const objetivo = typeof document !== 'undefined' ? document.querySelector('.landing-web') : null
  return objetivo ? createPortal(contenido, objetivo) : contenido
}

// Carrito de servicios — /citas/carrito (docs/diseno-carrito-servicios/
// README.md). Es una COPIA adaptada de CarritoCliente.jsx (el carrito de
// productos): mismo layout de 2 columnas, mismos bloques/clases (.lw-*),
// mismo flujo de pago con captura y el mismo botón verde final — lo que
// cambia es lo propio de un servicio: sin cantidad/stock/dirección/
// delivery/comprobante fiscal; con asistente, día y hora
// (horarios_disponibles_cita) y un adelanto en vez del total.
//
// Decisiones confirmadas con el usuario (AskUserQuestion) antes de
// tocar la base de datos:
// - "Agendar cita" (Citas) ahora abre esta página en vez del modal
//   ModalAgendarCitaCliente.jsx (borrado en este mismo cambio).
// - El adelanto es siempre obligatorio: `estado_negocio.adelanto_minimo`,
//   o el 100% del total si el negocio no configuró un mínimo — no hay
//   forma de elegir pagar menos ni de reservar sin adelanto.
// - Sin cupones todavía (agendar_cita_web no los entiende).
// - Sin "cualquier asistente disponible" — se elige uno específico,
//   igual que en Agendar/Reprogramar.
export default function CarritoServiciosCliente() {
  const { usuario } = useAuth()
  const { mostrarToast } = useToast()
  const { quitarServicio, vaciarServiciosReservados } = useCarritoCliente()
  const { cuentaTransferencia, pagos, adelantoMinimo, cancelacionPlazoHoras } = useEstadoNegocio()
  const navigate = useNavigate()

  const [cargando, setCargando] = useState(true)
  const [servicios, setServicios] = useState([])
  const [asistentes, setAsistentes] = useState([])
  const [horarioAtencion, setHorarioAtencion] = useState(null)
  const [contacto, setContacto] = useState(null)
  const [misPuntos, setMisPuntos] = useState(null)
  const [cfgPuntos, setCfgPuntos] = useState(null)

  const [asistenteId, setAsistenteId] = useState('')
  const [diaClave, setDiaClave] = useState('')
  const [horarios, setHorarios] = useState([])
  const [cargandoHorarios, setCargandoHorarios] = useState(false)
  const [horarioElegido, setHorarioElegido] = useState(null)
  const [yaTieneCitaEseDia, setYaTieneCitaEseDia] = useState(false)
  const [nota, setNota] = useState('')

  // A pedido del usuario: el pago obligatorio no siempre es un
  // "adelanto parcial" — una clienta puede querer dejar todo pagado de
  // una vez. agendar_cita_web ya acepta cualquier p_adelanto >= el
  // mínimo exigido (no hace falta tocar el backend), así que esto es
  // puramente una elección en pantalla entre dos montos válidos.
  const [tipoPago, setTipoPago] = useState('ADELANTO')
  const [metodoPago, setMetodoPago] = useState('YAPE')
  const [captura, setCaptura] = useState('')
  const [capturaPreview, setCapturaPreview] = useState('')
  const [capturaArchivo, setCapturaArchivo] = useState(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    let vigente = true

    async function cargar() {
      const [carritoRes, asistentesRes, horarioRes, contactoRes, puntosRes, cfgRes] = await Promise.all([
        supabase
          .from('carrito_servicios')
          .select('servicio_id, servicios(nombre, categoria, precio, duracion_min, foto_url, activo)'),
        supabase.rpc('asistentes_para_citas'),
        supabase.rpc('horario_atencion'),
        supabase.rpc('datos_contacto'),
        supabase.rpc('mis_puntos'),
        supabase.from('config_puntos').select('puntos_por_visita, puntos_por_sol_gastado').eq('id', 1).maybeSingle(),
      ])

      if (!vigente) return

      const cargados = (carritoRes.data ?? [])
        .filter((fila) => fila.servicios?.activo)
        .map((fila) => ({
          id: fila.servicio_id,
          nombre: fila.servicios.nombre,
          categoria: fila.servicios.categoria,
          precio: Number(fila.servicios.precio),
          duracionMin: fila.servicios.duracion_min ?? 30,
          fotoUrl: urlPublicaFoto(BUCKET_FOTOS_SERVICIOS, fila.servicios.foto_url),
          marcado: true,
        }))

      setServicios(cargados)
      setAsistentes(asistentesRes.data ?? [])
      setHorarioAtencion(horarioRes.data?.[0] ?? null)
      setContacto(contactoRes.data?.[0] ?? null)
      setMisPuntos(puntosRes.data?.[0] ?? null)
      setCfgPuntos(cfgRes.data ?? null)
      setCargando(false)
    }

    cargar()
    return () => {
      vigente = false
    }
  }, [])

  function alternarServicio(id) {
    setServicios((anterior) => anterior.map((s) => (s.id === id ? { ...s, marcado: !s.marcado } : s)))
  }

  async function quitarDelCarrito(servicio) {
    setServicios((anterior) => anterior.filter((s) => s.id !== servicio.id))
    await quitarServicio(servicio.id)
    mostrarToast(`${servicio.nombre} quitado del carrito`, 'info')
  }

  const serviciosMarcados = useMemo(() => servicios.filter((s) => s.marcado), [servicios])
  const duracionTotal = serviciosMarcados.reduce((suma, s) => suma + s.duracionMin, 0)
  const precioTotal = serviciosMarcados.reduce((suma, s) => suma + s.precio, 0)
  const duracionCarritoCompleto = servicios.reduce((suma, s) => suma + s.duracionMin, 0)

  // Próximos 14 días (empieza mañana — agendar "para ahora mismo" no
  // tiene sentido, igual que en ModalAgendarCitaCliente/Reprogramar),
  // deshabilitando los que el negocio no atiende.
  const proximosDias = useMemo(() => {
    const dias = []
    const hoy = iniciarDia(new Date())
    for (let i = 1; i <= DIAS_A_MOSTRAR; i += 1) {
      const fecha = sumarDias(hoy, i)
      const enLima = aLima(fecha)
      const diaSemana = enLima.getUTCDay() // 0 = domingo
      const isodow = diaSemana === 0 ? 7 : diaSemana
      const cerrado = horarioAtencion ? !(horarioAtencion.dias_atencion ?? []).includes(isodow) : false
      dias.push({
        clave: formatearFechaISO(fecha),
        corto: `${DIAS_CORTOS[diaSemana]} ${enLima.getUTCDate()}`,
        cerrado,
      })
    }
    return dias
  }, [horarioAtencion])

  // Elegir servicios, asistente o día limpia la hora elegida — se re-
  // dispara solo porque duracionTotal/asistenteId/diaClave cambian, sin
  // lógica extra.
  useEffect(() => {
    if (!asistenteId || !diaClave || duracionTotal === 0) {
      setHorarios([])
      setHorarioElegido(null)
      return undefined
    }

    let vigente = true
    setCargandoHorarios(true)
    setHorarioElegido(null)

    supabase
      .rpc('horarios_disponibles_cita', {
        p_asistente_id: asistenteId,
        p_fecha: diaClave,
        p_duracion_min: duracionTotal,
      })
      .then(({ data, error }) => {
        if (!vigente) return
        setHorarios(error ? [] : (data ?? []))
        setCargandoHorarios(false)
      })

    return () => {
      vigente = false
    }
  }, [asistenteId, diaClave, duracionTotal])

  const horariosPorTurno = useMemo(() => {
    const manana = []
    const tarde = []
    horarios.forEach((h) => {
      const hora = aLima(new Date(h.inicio)).getUTCHours()
      ;(hora < 12 ? manana : tarde).push(h)
    })
    return { manana, tarde }
  }, [horarios])

  // 1 sello por DÍA (mismo criterio que mi_fidelizacion()/mis_puntos()):
  // si la clienta ya tiene otra cita vigente/completada ese día, esta
  // reserva no suma un sello nuevo.
  useEffect(() => {
    if (!diaClave) {
      setYaTieneCitaEseDia(false)
      return undefined
    }
    let vigente = true
    const inicio = new Date(`${diaClave}T00:00:00-05:00`)
    const fin = sumarDias(inicio, 1)
    obtenerMiClienteId()
      .then((miId) =>
        miId
          ? supabase
              .from('citas')
              .select('id')
              .eq('cliente_id', miId)
              .gte('fecha_hora', inicio.toISOString())
              .lt('fecha_hora', fin.toISOString())
              .not('estado', 'in', '(CANCELADA,NO_ASISTIO)')
          : { data: [] },
      )
      .then(({ data }) => {
        if (!vigente) return
        setYaTieneCitaEseDia((data ?? []).length > 0)
      })
    return () => {
      vigente = false
    }
  }, [diaClave])

  function alSubirCaptura(archivo) {
    if (capturaPreview) URL.revokeObjectURL(capturaPreview)
    setCaptura(archivo.name)
    setCapturaPreview(URL.createObjectURL(archivo))
    setCapturaArchivo(archivo)
  }

  function quitarCaptura() {
    if (capturaPreview) URL.revokeObjectURL(capturaPreview)
    setCaptura('')
    setCapturaPreview('')
    setCapturaArchivo(null)
  }

  // adelantoMinimo (Contacto Web) es el mínimo EXIGIDO, no el único
  // monto válido: si es null, igual hay que pagar el 100% (no hay algo
  // "menor" que ofrecer), así que el selector solo tiene sentido cuando
  // de verdad hay un mínimo configurado y ese mínimo es menor al total
  // — si no, "adelanto" y "todo ahora" serían el mismo número.
  const adelantoMinimoMonto = adelantoMinimo != null ? Number(adelantoMinimo) : precioTotal
  const puedeElegirPagoTotal = adelantoMinimo != null && Number(adelantoMinimo) < precioTotal
  const montoAdelanto = puedeElegirPagoTotal && tipoPago === 'TOTAL' ? precioTotal : adelantoMinimoMonto
  const saldoEnLocal = Math.max(0, precioTotal - montoAdelanto)

  const puntosEstimados = cfgPuntos
    ? Math.floor(
        (yaTieneCitaEseDia ? 0 : Number(cfgPuntos.puntos_por_visita)) + precioTotal * Number(cfgPuntos.puntos_por_sol_gastado),
      )
    : 0

  const puntosActuales = misPuntos?.puntos ?? 0
  const nivelRaw = misPuntos?.nivel ?? 'BASICO'
  const umbralPremium = misPuntos?.umbral_premium ?? 10
  const umbralVip = misPuntos?.umbral_vip ?? 30
  let piso = 0
  let techo = umbralPremium
  if (nivelRaw === 'PREMIUM') {
    piso = umbralPremium
    techo = umbralVip
  } else if (nivelRaw === 'VIP') {
    piso = umbralVip
    techo = umbralVip
  }
  const progresoPct = techo > piso ? Math.min(100, Math.max(0, ((puntosActuales - piso) / (techo - piso)) * 100)) : 100
  const nivelTexto = nivelRaw === 'BASICO' ? 'Básico' : nivelRaw === 'PREMIUM' ? 'Premium' : 'VIP'

  function mensajeFaltante() {
    if (serviciosMarcados.length === 0) return 'Marca al menos un servicio.'
    if (!asistenteId) return 'Elige un asistente.'
    if (!diaClave) return 'Elige un día.'
    if (!horarioElegido) return 'Elige un horario.'
    if (!capturaArchivo) return 'Sube la captura de tu pago.'
    return null
  }

  const faltante = mensajeFaltante()
  const ctaDeshabilitado = Boolean(faltante)

  async function confirmar() {
    if (ctaDeshabilitado || enviando) return
    setEnviando(true)
    try {
      const { blob, extension } = await procesarImagen(capturaArchivo, { ladoMaximo: 1400, calidad: 0.9 })
      const ruta = `${usuario.id}/${crypto.randomUUID()}.${extension}`
      await subirFoto(BUCKET_COMPROBANTES_CITAS, ruta, blob)

      const idsReservados = serviciosMarcados.map((s) => s.id)

      const { error } = await supabase.rpc('agendar_cita_web', {
        p_asistente_id: asistenteId,
        p_fecha_hora: horarioElegido,
        p_servicio_ids: idsReservados,
        p_metodo_pago: metodoPago,
        p_comprobante_url: ruta,
        p_adelanto: montoAdelanto,
        p_nota: nota.trim() || null,
      })

      if (error) throw error

      mostrarToast('Cita reservada.', 'exito')
      await vaciarServiciosReservados(idsReservados)
      navigate('/citas')
    } catch (error) {
      mostrarToast(error.message || 'No se pudo confirmar la reserva.', 'error')
    } finally {
      setEnviando(false)
    }
  }

  const whatsapp = contacto?.telefono ? numeroWhatsapp(contacto.telefono) : null
  const horarioTexto = horarioAtencion
    ? `${formatearDias(horarioAtencion.dias_atencion)} ${formatearHora(horarioAtencion.bloque1_inicio)}-${formatearHora(horarioAtencion.bloque1_fin)}`
    : null
  const plazoCancelacion = cancelacionPlazoHoras ?? 3

  const metodoActual = METODOS_PAGO.find((m) => m.id === metodoPago)
  const datosMetodoActual =
    metodoPago === 'YAPE'
      ? { numero: pagos.yapeNumero, titular: pagos.yapeTitular, qrUrl: pagos.yapeQrUrl }
      : metodoPago === 'PLIN'
        ? { numero: pagos.plinNumero, titular: pagos.plinTitular, qrUrl: pagos.plinQrUrl }
        : { numero: cuentaTransferencia, titular: '', qrUrl: null }
  const instruccionPago = !datosMetodoActual.numero
    ? `El negocio todavía no configuró ${metodoActual.nombre} — escríbenos por WhatsApp antes de pagar.`
    : metodoPago === 'TRANSFERENCIA'
      ? `Transfiere el monto exacto (${formatearSoles(montoAdelanto)}) a: ${datosMetodoActual.numero}.`
      : `${metodoActual.nombre === 'Yape' ? 'Yapea' : 'Plinea'} el monto exacto (${formatearSoles(montoAdelanto)}) al ${datosMetodoActual.numero}${datosMetodoActual.titular ? ` — ${datosMetodoActual.titular}` : ''}.`

  if (cargando) {
    return (
      <div className="landing-web flex flex-1 items-center justify-center bg-[#0b0b0c]">
        <p className="font-mono text-sm text-white/50">Cargando...</p>
      </div>
    )
  }

  if (servicios.length === 0) {
    return (
      <div className="landing-web animate-entrada-pestana flex-1 overflow-y-auto bg-[#0b0b0c] p-4 md:p-8">
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 py-20 text-center">
          <Sparkles className="h-9 w-9 text-white/25" />
          <h1 className="lw-titulo-heavitas text-xl uppercase">Todavía no agregaste servicios</h1>
          <p className="text-sm text-white/60">Elige tus servicios favoritos y vuelve para reservar tu cita.</p>
          <Link to="/servicios" className="mt-2 rounded-full bg-[var(--lw-gold)] px-6 py-3 text-sm font-semibold text-black">
            Ver servicios
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="landing-web animate-entrada-pestana flex-1 overflow-y-auto bg-[#0b0b0c] p-4 pb-24 md:p-8 lg:pb-10 lg:p-10">
      <div className="mx-auto w-full max-w-[1400px]">
        <div className="mb-6 flex items-end justify-between gap-3 lg:mb-8">
          <h1 className="lw-titulo-heavitas text-[28px] uppercase">Carrito de servicios</h1>
          <span className="shrink-0 text-sm text-white/60">
            {servicios.length} {servicios.length === 1 ? 'servicio' : 'servicios'} · {duracionCarritoCompleto} min
          </span>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_500px] lg:items-start">
          {/* Columna izquierda */}
          <div className="flex flex-col gap-8">
            <section aria-labelledby="carrito-serv-titulo" className="lw-panel flex flex-col p-6">
              <div className="flex items-center justify-between gap-3 pb-1">
                <h2 id="carrito-serv-titulo" className="flex items-center gap-2.5 text-base font-semibold text-white">
                  <Sparkles className="h-[18px] w-[18px] text-[var(--lw-gold)]" />
                  Servicios
                </h2>
                <span className="hidden text-xs text-white/50 sm:inline">Marca los que quieres reservar ahora</span>
              </div>
              {servicios.map((servicio) => (
                <FilaServicio
                  key={servicio.id}
                  servicio={servicio}
                  onAlternar={() => alternarServicio(servicio.id)}
                  onQuitar={() => quitarDelCarrito(servicio)}
                />
              ))}
            </section>
            <Link to="/servicios" className="-mt-4 inline-flex w-fit items-center gap-2 text-sm text-white/60 hover:text-white">
              <ArrowRight className="h-4 w-4 rotate-180" />
              Agregar más servicios
            </Link>

            <section aria-labelledby="carrito-asis-titulo" className="lw-panel flex flex-col gap-3 p-6">
              <h2 id="carrito-asis-titulo" className="flex items-center gap-2.5 text-base font-semibold text-white">
                <User className="h-[18px] w-[18px] text-[var(--lw-gold)]" />
                Asistente
                <span className="text-red-500" aria-hidden="true">
                  *
                </span>
              </h2>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {asistentes.map((asistente) => (
                  <button
                    key={asistente.id}
                    type="button"
                    onClick={() => setAsistenteId(asistente.id)}
                    aria-pressed={asistenteId === asistente.id}
                    className={`flex min-h-[52px] items-center justify-center rounded-[10px] border px-3 py-2 text-center text-sm font-medium transition-colors ${
                      asistenteId === asistente.id
                        ? 'border-[var(--lw-gold)] bg-[var(--lw-gold)]/10 text-[var(--lw-gold)]'
                        : 'border-[#2e2e2e] text-white hover:border-[#4a4a4f]'
                    }`}
                  >
                    {asistente.nombres_completos}
                  </button>
                ))}
              </div>
            </section>

            <section aria-labelledby="carrito-fecha-titulo" className="lw-panel flex flex-col gap-4 p-6">
              <h2 id="carrito-fecha-titulo" className="flex items-center gap-2.5 text-base font-semibold text-white">
                <Clock className="h-[18px] w-[18px] text-[var(--lw-gold)]" />
                Día y hora
                <span className="text-red-500" aria-hidden="true">
                  *
                </span>
              </h2>

              <div>
                <span className="mb-1.5 block text-xs text-white/60">Día</span>
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" style={{ scrollbarWidth: 'none' }}>
                  {proximosDias.map((dia) => (
                    <button
                      key={dia.clave}
                      type="button"
                      onClick={() => setDiaClave(dia.clave)}
                      disabled={dia.cerrado}
                      aria-pressed={diaClave === dia.clave}
                      className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                        diaClave === dia.clave
                          ? 'border-[var(--lw-gold)] bg-[var(--lw-gold)] font-semibold text-black'
                          : dia.cerrado
                            ? 'cursor-not-allowed border-[#232326] text-white/20'
                            : 'border-[#2e2e2e] text-white hover:border-[#4a4a4f]'
                      }`}
                    >
                      {dia.corto}
                    </button>
                  ))}
                </div>
              </div>

              {diaClave && (
                <div>
                  <span className="mb-1.5 block text-xs text-white/60">Hora</span>
                  {!asistenteId || duracionTotal === 0 ? (
                    <p className="text-sm text-white/50">Elige servicios y asistente para ver horarios.</p>
                  ) : cargandoHorarios ? (
                    <p className="text-sm text-white/50">Buscando horarios...</p>
                  ) : horarios.length === 0 ? (
                    <p className="text-sm text-white/50">
                      No hay horarios libres este día con esta asistente. Prueba otro día u otra asistente.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {horariosPorTurno.manana.length > 0 && (
                        <div>
                          <span className="mb-1.5 block text-[11px] uppercase tracking-wider text-white/40">Mañana</span>
                          <div className="grid grid-cols-3 gap-2">
                            {horariosPorTurno.manana.map((h) => (
                              <button
                                key={h.inicio}
                                type="button"
                                onClick={() => setHorarioElegido(h.inicio)}
                                aria-pressed={horarioElegido === h.inicio}
                                className={`rounded-lg border px-2 py-2 font-mono text-xs transition-colors ${
                                  horarioElegido === h.inicio
                                    ? 'border-[var(--lw-gold)] bg-[var(--lw-gold)] font-semibold text-black'
                                    : 'border-[#2e2e2e] text-white hover:border-[#4a4a4f]'
                                }`}
                              >
                                {formatoHora.format(new Date(h.inicio))}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {horariosPorTurno.tarde.length > 0 && (
                        <div>
                          <span className="mb-1.5 block text-[11px] uppercase tracking-wider text-white/40">Tarde</span>
                          <div className="grid grid-cols-3 gap-2">
                            {horariosPorTurno.tarde.map((h) => (
                              <button
                                key={h.inicio}
                                type="button"
                                onClick={() => setHorarioElegido(h.inicio)}
                                aria-pressed={horarioElegido === h.inicio}
                                className={`rounded-lg border px-2 py-2 font-mono text-xs transition-colors ${
                                  horarioElegido === h.inicio
                                    ? 'border-[var(--lw-gold)] bg-[var(--lw-gold)] font-semibold text-black'
                                    : 'border-[#2e2e2e] text-white hover:border-[#4a4a4f]'
                                }`}
                              >
                                {formatoHora.format(new Date(h.inicio))}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>

            <section aria-labelledby="carrito-nota-titulo" className="lw-panel flex flex-col gap-2 p-6">
              <h2 id="carrito-nota-titulo" className="text-base font-semibold text-white">
                Nota para el salón
              </h2>
              <textarea
                value={nota}
                onChange={(evento) => setNota(evento.target.value)}
                placeholder="Algo que quieras avisar antes de tu cita (opcional)"
                rows={2}
                className="w-full resize-none rounded-[12px] border border-[#2e2e2e] bg-[#141416] px-3 py-2 text-sm text-white outline-none placeholder:text-white/40 focus:border-[var(--lw-gold)]"
              />
            </section>
          </div>

          {/* Columna derecha */}
          <div className="flex flex-col gap-6">
            <aside className="lw-panel flex flex-col gap-6 p-6 lg:p-7">
              <h2 className="text-lg font-semibold text-white">Resumen de tu reserva</h2>

              {horarioElegido ? (
                <div className="flex flex-col gap-1 border-b border-[#232326] pb-4 text-sm">
                  <span className="text-white/60">Cuándo</span>
                  <span className="font-medium text-white">
                    {fechaCortaTexto(new Date(horarioElegido))} · {formatoHora.format(new Date(horarioElegido))} –{' '}
                    {formatoHora.format(new Date(new Date(horarioElegido).getTime() + duracionTotal * 60000))}
                  </span>
                  {asistenteId && (
                    <span className="mt-1 text-white/60">
                      Con <span className="font-medium text-white">{asistentes.find((a) => a.id === asistenteId)?.nombres_completos}</span>
                    </span>
                  )}
                </div>
              ) : (
                <p className="border-b border-[#232326] pb-4 text-sm text-white/50">
                  Elige asistente, día y hora para ver el resumen de tu cita.
                </p>
              )}

              <div className="flex flex-col gap-2 text-sm">
                {serviciosMarcados.length === 0 ? (
                  <p className="text-white/50">Marca al menos un servicio.</p>
                ) : (
                  serviciosMarcados.map((s) => (
                    <div key={s.id} className="flex justify-between gap-3 text-white/80">
                      <span className="truncate">{s.nombre}</span>
                      <span className="shrink-0">{formatearSoles(s.precio)}</span>
                    </div>
                  ))
                )}
                <div className="mt-1 flex justify-between border-t border-[#232326] pt-2 text-white/80">
                  <span>Duración total</span>
                  <span>{duracionTotal} min</span>
                </div>
                <div className="flex items-baseline justify-between pt-1">
                  <span className="text-base font-semibold text-white">Total</span>
                  <span className="text-[26px] font-bold text-white">
                    S/ <Contador valor={precioTotal} decimales={2} tamano={26} />
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-[#232326] pt-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Sparkles className="h-4 w-4 text-[var(--lw-gold)]" />
                    Nivel {nivelTexto}
                  </span>
                  <span className="font-mono text-sm text-white/60">{puntosActuales} pts</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${progresoPct}%`, background: 'linear-gradient(90deg,#86a9d8,#d3e4f8)' }}
                  />
                </div>
                <p className="flex items-center gap-1.5 text-[13px] text-white/70">
                  <span className="font-semibold text-[var(--lw-gold)]">Ganarás +{puntosEstimados} pts</span>
                  {yaTieneCitaEseDia ? (
                    <span className="inline-flex items-center gap-1 text-white/45">
                      · <Stamp className="h-3 w-3" /> sello ya contado ese día
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      · <Stamp className="h-3 w-3 text-[var(--lw-gold)]" /> +1 sello
                    </span>
                  )}
                  {' '}con esta cita.
                </p>
              </div>

              <div className="flex flex-col gap-3 border-t border-[#232326] pt-4">
                {puedeElegirPagoTotal && (
                  <div className="flex flex-col gap-2">
                    <span className="text-xs uppercase tracking-wider text-white/60">¿Cuánto pagas ahora?</span>
                    <div className="flex gap-2.5">
                      <button
                        type="button"
                        onClick={() => setTipoPago('ADELANTO')}
                        aria-pressed={tipoPago === 'ADELANTO'}
                        className={`lw-seg ${tipoPago === 'ADELANTO' ? 'on' : ''}`}
                      >
                        Adelanto · {formatearSoles(adelantoMinimoMonto)}
                      </button>
                      <button
                        type="button"
                        onClick={() => setTipoPago('TOTAL')}
                        aria-pressed={tipoPago === 'TOTAL'}
                        className={`lw-seg ${tipoPago === 'TOTAL' ? 'on' : ''}`}
                      >
                        Todo ahora · {formatearSoles(precioTotal)}
                      </button>
                    </div>
                  </div>
                )}
                <div className="flex flex-col gap-1.5 text-sm">
                  <div className="flex justify-between text-white">
                    <span className="font-semibold">{montoAdelanto >= precioTotal ? 'Pagas ahora' : 'Adelanto ahora'}</span>
                    <span className="font-mono font-semibold">{formatearSoles(montoAdelanto)}</span>
                  </div>
                  <div className="flex justify-between text-white/60">
                    <span>Saldo en el local</span>
                    <span className="font-mono">{formatearSoles(saldoEnLocal)}</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={confirmar}
                disabled={ctaDeshabilitado || enviando}
                className="hidden h-14 items-center justify-center gap-2.5 rounded-[10px] bg-[#3ECF6A] text-[18px] font-semibold text-black transition-[filter] hover:brightness-[1.06] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:brightness-100 lg:flex"
              >
                <Check className="h-[18px] w-[18px]" />
                {enviando ? 'Enviando...' : 'Confirmar reserva'}
              </button>
              {faltante && <p className="hidden text-center text-xs text-white/50 lg:block">{faltante}</p>}

              <section aria-labelledby="carrito-pago-titulo" className="flex flex-col gap-4 border-t border-[#232326] pt-4">
                <h2 id="carrito-pago-titulo" className="flex items-center gap-2.5 text-base font-semibold text-white">
                  <CreditCard className="h-[18px] w-[18px] text-[var(--lw-gold)]" />
                  Método de pago del adelanto
                </h2>
                <div role="group" aria-label="Elige cómo pagar" className="grid grid-cols-3 gap-2.5">
                  {METODOS_PAGO.map((metodo) => (
                    <button
                      key={metodo.id}
                      type="button"
                      onClick={() => setMetodoPago(metodo.id)}
                      aria-pressed={metodoPago === metodo.id}
                      className={`lw-pago-opcion ${metodoPago === metodo.id ? 'on' : ''}`}
                    >
                      {metodo.icono ? (
                        <img src={`${import.meta.env.BASE_URL}${metodo.icono}`} alt="" className="h-5 w-5 shrink-0" aria-hidden="true" />
                      ) : (
                        <Wallet className="h-5 w-5 shrink-0" aria-hidden="true" />
                      )}
                      <span className="text-sm font-bold">{metodo.nombre}</span>
                    </button>
                  ))}
                </div>
                <div className="flex flex-col items-center gap-4 rounded-[10px] border border-[#232326] bg-[#0d0d0f] p-5 sm:flex-row">
                  {metodoActual.conQR &&
                    (datosMetodoActual.qrUrl ? (
                      <img
                        src={urlPublicaFoto(BUCKET_QR_PAGOS, datosMetodoActual.qrUrl)}
                        alt={`Código QR de ${metodoActual.nombre}`}
                        className="h-28 w-28 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <div
                        role="img"
                        aria-label={`Código QR de ${metodoActual.nombre} — todavía no disponible`}
                        className="flex h-28 w-28 shrink-0 items-center justify-center rounded-lg bg-[#f1f3f5] p-2 text-center text-[11px] font-medium text-[#0b0b0c]/60"
                      >
                        QR no disponible todavía
                      </div>
                    ))}
                  <div className="flex min-w-0 flex-1 flex-col gap-2 self-stretch">
                    <p className="text-[15px] font-semibold leading-snug text-white">{instruccionPago}</p>
                    <p className="text-[13px] text-white/60">Sube la captura de tu pago para confirmar la reserva.</p>
                    <CampoSubirArchivo
                      nombreArchivo={captura}
                      previewUrl={capturaPreview}
                      etiqueta="Subir captura"
                      etiquetaAdjunto="Captura adjunta"
                      onSeleccionar={alSubirCaptura}
                      onQuitar={quitarCaptura}
                    />
                  </div>
                </div>
                <p className="flex items-center gap-2 text-xs text-white/60">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  {saldoEnLocal > 0 ? 'El saldo se paga en el local el día de tu cita.' : 'Quedas con todo pagado — nada pendiente el día de tu cita.'}
                </p>
              </section>

              <p className="-mt-2 text-center text-xs leading-relaxed text-white/50">
                Revisamos tu comprobante y confirmamos tu cita.
              </p>
            </aside>

            <div className="flex flex-col gap-4">
              {whatsapp ? (
                <a
                  href={`https://wa.me/${whatsapp}?text=${encodeURIComponent('Hola, tengo una duda sobre mi reserva.')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lw-wa-ayuda rounded-[10px]"
                >
                  <MessageCircle className="h-[18px] w-[18px]" />
                  ¿Dudas con tu reserva? Escríbenos
                </a>
              ) : (
                <span className="flex min-h-[52px] items-center justify-center gap-2.5 rounded-[10px] border border-dashed border-white/15 text-sm text-white/40">
                  WhatsApp aún no configurado
                </span>
              )}
              <ul className="flex flex-col gap-2.5 pl-1 text-[13px] text-white/60">
                <li className="flex items-center gap-2.5">
                  <Clock className="h-4 w-4 shrink-0 text-white/50" />
                  Reprograma o cancela hasta {plazoCancelacion} horas antes.
                </li>
                {horarioTexto && (
                  <li className="flex items-center gap-2.5">
                    <Info className="h-4 w-4 shrink-0 text-white/50" />
                    Atendemos {horarioTexto}.
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>

      <BarraConfirmarMovil
        monto={montoAdelanto}
        puntos={puntosEstimados}
        deshabilitado={ctaDeshabilitado || enviando}
        enviando={enviando}
        onConfirmar={confirmar}
      />
    </div>
  )
}
