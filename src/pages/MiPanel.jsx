import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  NotebookPen,
  Percent,
  Pencil,
  Trash2,
  Ban,
  Plus,
  Users,
  CheckCircle2,
  AlertTriangle,
  User,
  UserRound,
  Clock,
  X,
  NotebookText,
  UserPlus,
  Eye,
  EyeOff,
  Handshake,
  MessageSquareWarning,
} from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { useDebounce } from '../hooks/useDebounce.js'
import { aLima, calcularRango, claveDiaLima, esHoyLima, formatearFechaISO } from '../lib/fechas.js'
import { formatearSoles, sumarMontos } from '../lib/moneda.js'
import { manejarActivacionTeclado } from '../lib/teclado.js'
import { discrepanciaDe, estadoAcuerdo } from '../lib/discrepanciaAtencion.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import FiltrosFecha from '../components/FiltrosFecha.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonAcuerdo from '../components/BotonAcuerdo.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import ModalRegistroAtencion from '../components/ModalRegistroAtencion.jsx'
import ModalBuscarCliente from '../components/ModalBuscarCliente.jsx'
import ModalCliente from '../components/ModalCliente.jsx'
import { EsqueletoGrupos } from '../components/Esqueleto.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'
import { useEstadoVista } from '../lib/estadoVista.js'
import IconoFlechaDesplegable from '../components/IconoFlechaDesplegable.jsx'
import TextoDeslizante from '../components/TextoDeslizante.jsx'

const OPCION_TODOS = 'todos'
const TAMANO_PAGINA = 50
const SELECT_REGISTROS =
  'id, usuario_id, servicio_id, cliente_id, precio, fecha, nota, estado, porcentaje_aplicado, pago_asistente, cliente_nombre_referencia, servicios(nombre), clientes(nombre), usuarios(nombre_completo), registro_discrepancias(id, creada_en, admin_acuerdo_en, duena_acuerdo_en, resuelta_en, retirada_en)'
const RESUMEN_VACIO = { cantidad: 0, total: 0 }

function formatearHora(fechaIso) {
  const fecha = new Date(fechaIso)
  return new Intl.DateTimeFormat('es-PE', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Lima',
  }).format(fecha)
}

function capitalizar(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

function formatearTituloDia(fecha) {
  const diaSemana = capitalizar(
    new Intl.DateTimeFormat('es-PE', { weekday: 'long', timeZone: 'America/Lima' }).format(fecha),
  )
  const dia = String(aLima(fecha).getUTCDate()).padStart(2, '0')
  const mes = capitalizar(
    new Intl.DateTimeFormat('es-PE', { month: 'short', timeZone: 'America/Lima' })
      .format(fecha)
      .replace('.', ''),
  )
  const anio = aLima(fecha).getUTCFullYear()
  return `${diaSemana} ${dia} ${mes} ${anio}`
}

function agruparPorDia(registros) {
  const grupos = new Map()
  for (const registro of registros) {
    // registro_servicios.fecha es `timestamp with time zone` (confirmado
    // en la base) — un instante real, no una columna `date` de solo
    // fecha (a diferencia de deudas.fecha/mobiliario_compras.fecha, que
    // sí lo son). new Date(registro.fecha) es lo correcto acá;
    // parsearFechaISOLima (pensada para strings "YYYY-MM-DD" sin hora)
    // se coló por error de un fix parecido en otra pantalla — al
    // partirla por guiones con hora y offset de por medio ("...T06:14:00
    // +00:00") el día quedaba `NaN`, y eso rompía formatearTituloDia()
    // con "RangeError: Invalid time value" apenas había algún registro
    // real (bug reportado por el usuario: página en blanco para
    // cualquier admin/asistente con atenciones propias).
    const fecha = new Date(registro.fecha)
    const clave = claveDiaLima(fecha)
    if (!grupos.has(clave)) grupos.set(clave, { clave, fecha, registros: [] })
    grupos.get(clave).registros.push(registro)
  }
  return Array.from(grupos.values())
}

// mostrarPrecio: true muestra el precio del servicio (ingreso del
// negocio), false muestra lo que le corresponde a la asistente por su %.
// Antes esto era directo esAdmin (el admin siempre veía precio) — pero
// viendo el perfil de UNA asistente puntual (paga por %), un admin
// necesita ver su pago real, no el precio del servicio que cobró el
// negocio (ver filtroEsAsistente).
function montoDeRegistro(registro, mostrarPrecio) {
  return mostrarPrecio ? registro.precio : (registro.pago_asistente ?? 0)
}

function nombreUsuarioDe(registro) {
  const usuarios = registro?.usuarios
  if (!usuarios) return null
  return Array.isArray(usuarios) ? (usuarios[0]?.nombre_completo ?? null) : (usuarios.nombre_completo ?? null)
}

// «Angela Yaya De la Cruz» → «Angela» (en móvil la fila solo muestra el primer nombre).
function primerNombre(nombreCompleto) {
  return (nombreCompleto ?? '').trim().split(/\s+/)[0]
}

// Dentro de un día, las atenciones se agrupan por clienta para no repetir su nombre en cada servicio. El orden es el
// de la lista (la clienta con la atención más reciente queda arriba) y se conserva el de sus servicios.
function agruparPorCliente(registros) {
  const grupos = new Map()
  for (const registro of registros) {
    // Sin ficha pero con nombre de referencia (cita completada sin clienta registrada): se agrupa por ese nombre y se rotula
    // «sin registrar» para que se vea que falta asignarla.
    const referencia = registro.cliente_id ? null : (registro.cliente_nombre_referencia ?? null)
    const clave = registro.cliente_id ?? (referencia ? `ref:${referencia}` : 'sin-cliente')
    if (!grupos.has(clave)) {
      grupos.set(clave, {
        clave,
        nombre: registro.clientes?.nombre ?? (referencia ? `${referencia} (sin registrar)` : 'Cliente eliminado'),
        registros: [],
      })
    }
    grupos.get(clave).registros.push(registro)
  }
  return Array.from(grupos.values())
}

function formatearDiaCorto(fechaIso) {
  return new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', timeZone: 'America/Lima' })
    .format(new Date(fechaIso))
    .replace('.', '')
}

// Estado de una atención que no es «activa», en el hueco del precio: en móvil solo un ícono de color (no cabe la
// etiqueta en una fila), desde sm la etiqueta completa.
function EstadoRegistro({ cancelado, pendiente, porcentajeNota }) {
  const { Icono, texto, claseTexto, claseFondo } = cancelado
    ? { Icono: Ban, texto: 'Cancelada', claseTexto: 'text-red', claseFondo: 'bg-red/15' }
    : pendiente && porcentajeNota != null
      ? { Icono: CheckCircle2, texto: 'Por confirmar', claseTexto: 'text-green', claseFondo: 'bg-green/15' }
      : { Icono: AlertTriangle, texto: 'Pendiente', claseTexto: 'text-orange-400', claseFondo: 'bg-orange-400/15' }
  return (
    <>
      <Icono role="img" aria-label={texto} className={`h-4 w-4 sm:hidden ${claseTexto}`} />
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium max-sm:hidden ${claseFondo} ${claseTexto}`}>
        {texto}
      </span>
    </>
  )
}

export default function MiPanel({ activo = true }) {
  const { usuario, rol } = useAuth()
  const esAdmin = rol === 'ADMINISTRADOR'
  const { mostrarToast } = useToast()
  const navigate = useNavigate()

  const [filtro, setFiltro] = useEstadoVista('/mi-panel:filtro', 'mes')
  const [personalizado, setPersonalizado] = useEstadoVista('/mi-panel:personalizado', () => {
    const hoyStr = formatearFechaISO(new Date())
    return { desde: hoyStr, hasta: hoyStr }
  })

  const [registros, setRegistros] = useState([])
  // Atenciones PENDIENTE_PORCENTAJE («notas» sin %), de cualquier fecha: alimentan el aviso de arriba y dicen, por
  // registro, si la administradora ya asignó el % (entonces la dueña puede confirmarla). Ver cargarPendientes().
  const [pendientes, setPendientes] = useState([])
  // Discrepancias ABIERTAS (de cualquier fecha) que alimentan el aviso celeste de arriba: la admin ve las de todo el personal;
  // cada persona, las de sus atenciones (la RLS ya lo limita). Cada una lleva {id, fecha, usuario_id} de su atención.
  const [discrepancias, setDiscrepancias] = useState([])
  const [acuerdoEnCurso, setAcuerdoEnCurso] = useState(null)
  const [resumen, setResumen] = useState(RESUMEN_VACIO)
  const [hayMas, setHayMas] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useEstadoVista('/mi-panel:busqueda', '')
  const busquedaDebounced = useDebounce(busqueda, 300)

  const [asistentesUsuarios, setAsistentesUsuarios] = useState([])
  const [usuarioFiltro, setUsuarioFiltro] = useState(OPCION_TODOS)
  // El admin ve su propio panel por defecto (no "Todos") — solo una vez,
  // apenas se conoce el usuario logeado; si después elige otra opción a
  // mano (otro asistente, o "Todos"), esto no se lo vuelve a pisar.
  const filtroUsuarioInicializado = useRef(false)
  useEffect(() => {
    if (usuario && !filtroUsuarioInicializado.current) {
      filtroUsuarioInicializado.current = true
      setUsuarioFiltro(usuario.id)
    }
  }, [usuario])

  const [modalRegistro, setModalRegistro] = useState(null) // null | 'nuevo' | registro
  const [registroAEliminar, setRegistroAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)
  const [registroACancelar, setRegistroACancelar] = useState(null)
  const [cancelando, setCancelando] = useState(false)
  const [confirmandoId, setConfirmandoId] = useState(null)
  // Atención (nota pendiente de clienta) a la que se está eligiendo clienta + el modal de «Registrar cliente nuevo» (solo admin).
  const [registroAAsignar, setRegistroAAsignar] = useState(null)
  const [nombreClienteNuevo, setNombreClienteNuevo] = useState('')
  const [modalClienteNuevoAbierto, setModalClienteNuevoAbierto] = useState(false)
  const [ocultarCancelados, setOcultarCancelados] = useState(true)
  const [diasAbiertos, setDiasAbiertos] = useState(() => new Set())
  const [registrosAbiertos, setRegistrosAbiertos] = useState(() => new Set())
  const primeraCargaHecha = useRef(false)
  // M1 de la 4ª auditoría: mismo guard que la carga inicial, para que
  // cargarMasRegistros descarte una respuesta que llega tarde de un
  // filtro/búsqueda que ya no está activo (ver Historial.jsx).
  const vigenteRef = useRef({ actual: true })

  useCerrarConEscape(() => setRegistroAEliminar(null), Boolean(registroAEliminar))
  useCerrarConEscape(() => setRegistroACancelar(null), Boolean(registroACancelar))

  const panelEliminarRef = useRef(null)
  const panelCancelarRef = useRef(null)
  useModalA11y(panelEliminarRef, Boolean(registroAEliminar))
  useModalA11y(panelCancelarRef, Boolean(registroACancelar))

  // Todo el personal (cualquier rol salvo CLIENTE), incluidas otras
  // administradoras: antes solo se pedían ASISTENTE/ENCARGADA/PERSONAL_APOYO
  // y una admin con atenciones (ej. la dueña) salía en «Todos» pero no se
  // podía elegir sola. La RLS de usuarios ya deja al admin leer a todos.
  // La propia cuenta va aparte con «(yo)», así que se excluye de la lista.
  useEffect(() => {
    if (!esAdmin || !usuario) return
    supabase
      .from('usuarios')
      .select('id, nombre_completo, rol')
      .neq('rol', 'CLIENTE')
      .neq('id', usuario.id)
      .order('nombre_completo')
      .then(({ data }) => setAsistentesUsuarios(data ?? []))
  }, [esAdmin, usuario])

  const opcionesFiltroUsuario = [
    { id: OPCION_TODOS, label: 'Todos' },
    ...(usuario ? [{ id: usuario.id, label: `${usuario.nombre_completo} (yo)` }] : []),
    ...asistentesUsuarios.map((a) => ({
      id: a.id,
      label: a.rol === 'ADMINISTRADOR' ? `${a.nombre_completo} (admin)` : a.nombre_completo,
    })),
  ]

  // Con búsqueda de texto activa, paginar rompería el resultado (la búsqueda
  // es sobre lo cargado en el cliente; podría "no encontrar" algo que existe
  // más adelante sin traerlo). Ahí se trae el período completo, ya acotado
  // por fecha; sin búsqueda, se pagina de verdad. Mismo criterio que Historial.
  const filtroActivo = Boolean(busquedaDebounced.trim())

  // A quién apunta el resumen del header: el admin puede filtrar por
  // asistente (o "Todos" = null); un no-admin siempre a sí mismo (aunque la
  // RLS ya lo limitaría, se pasa explícito).
  const usuarioIdResumen = esAdmin
    ? usuarioFiltro !== OPCION_TODOS
      ? usuarioFiltro
      : null
    : (usuario?.id ?? null)

  // El admin filtrando por SU PROPIO nombre o "Todos" sigue viendo el
  // precio del servicio (ingreso), como siempre — pero filtrando por una
  // asistente puntual (paga por %, no por precio) necesita ver lo que de
  // verdad le corresponde a ella, no el precio del servicio que cobró el
  // negocio. Otra administradora cuenta como la propia: sus atenciones se
  // guardan al 100% (trigger de comisión), así que se muestra el precio.
  const filtroEsAsistente =
    esAdmin &&
    usuarioFiltro !== OPCION_TODOS &&
    asistentesUsuarios.some((a) => a.id === usuarioFiltro && a.rol !== 'ADMINISTRADOR')

  function construirConsultaRegistros(desde, hasta) {
    let consulta = supabase
      .from('registro_servicios')
      .select(SELECT_REGISTROS)
      .gte('fecha', desde.toISOString())
      .lt('fecha', hasta.toISOString())
      .order('fecha', { ascending: false })

    if (esAdmin && usuarioFiltro !== OPCION_TODOS) {
      consulta = consulta.eq('usuario_id', usuarioFiltro)
    } else if (!esAdmin) {
      consulta = consulta.eq('usuario_id', usuario.id)
    }
    return consulta
  }

  // Notas pendientes de comisión SIN filtro de fecha (una nota de la semana pasada sigue esperando). La admin ve las de
  // todo el personal (aunque esté mirando su propio panel), porque es quien debe asignar el %; las demás, solo las suyas.
  // El trigger de comisión recién aplica el % al confirmar, así que «ya tiene %» se sabe mirando Porcentajes
  // (la RLS deja a cada una leer solo sus propios %).
  async function cargarPendientes(vigente = { actual: true }) {
    if (!usuario) return
    let consulta = supabase
      .from('registro_servicios')
      .select('id, usuario_id, servicio_id, fecha, cliente_id, cliente_nombre_referencia')
      .eq('estado', 'PENDIENTE_PORCENTAJE')
      .order('fecha')
    if (!esAdmin) consulta = consulta.eq('usuario_id', usuario.id)
    const { data, error: errorPendientes } = await consulta
    if (!vigente.actual) return
    if (errorPendientes || !data?.length) {
      setPendientes([])
      return
    }

    const { data: porcentajes } = await supabase
      .from('porcentajes')
      .select('servicio_id, porcentaje, asistentes!inner(usuario_id)')
      .in('servicio_id', [...new Set(data.map((r) => r.servicio_id))])
    if (!vigente.actual) return
    const porClave = new Map(
      (porcentajes ?? []).map((p) => [`${p.asistentes.usuario_id}|${p.servicio_id}`, Number(p.porcentaje)]),
    )
    setPendientes(
      data.map((r) => ({
        ...r,
        porcentaje: porClave.get(`${r.usuario_id}|${r.servicio_id}`) ?? null,
        // Falta registrar a la clienta (cita completada con solo un nombre de referencia). Las notas viejas sin clienta
        // porque la ficha se borró no llevan nombre de referencia y no cuentan.
        sinCliente: r.cliente_id == null && r.cliente_nombre_referencia != null,
      })),
    )
  }

  async function cargarDiscrepancias(vigente = { actual: true }) {
    if (!usuario) return
    const { data, error: errorDiscrepancias } = await supabase
      .from('registro_discrepancias')
      .select('registro_id, admin_acuerdo_en, duena_acuerdo_en, registro_servicios!inner(usuario_id, fecha)')
      .is('resuelta_en', null)
      .is('retirada_en', null)
    if (!vigente.actual) return
    if (errorDiscrepancias || !data?.length) {
      setDiscrepancias([])
      return
    }
    setDiscrepancias(
      data
        .map((d) => {
          const registro = Array.isArray(d.registro_servicios) ? d.registro_servicios[0] : d.registro_servicios
          if (!registro) return null
          // yoConfirme: ya pulsé la manito en esta discrepancia (soy la dueña de la atención o, si no, la administradora)
          // y falta la otra parte. Separa los avisos: celeste = me toca a mí, verde = espero a la otra persona.
          const { yoConfirme } = estadoAcuerdo({ ...d, abierta: true }, registro.usuario_id === usuario.id)
          return { id: d.registro_id, fecha: registro.fecha, usuario_id: registro.usuario_id, yoConfirme }
        })
        .filter(Boolean),
    )
  }

  async function cargarRegistros(vigente = { actual: true }, silencioso = false) {
    if (!usuario) return
    if (!silencioso) setCargando(true)
    cargarPendientes(vigente)
    cargarDiscrepancias(vigente)
    const { desde, hasta } = calcularRango(filtro, personalizado)
    // Una recarga silenciosa (tras guardar/eliminar) conserva las filas ya cargadas con «Cargar más» para que el scroll no salte.
    const cantidad = silencioso ? Math.min(Math.max(registros.length, TAMANO_PAGINA), 1000) : TAMANO_PAGINA

    let consultaLista = construirConsultaRegistros(desde, hasta)
    if (!filtroActivo) consultaLista = consultaLista.range(0, cantidad - 1)

    const [listaRes, resumenRes] = await Promise.all([
      consultaLista,
      supabase.rpc('resumen_mi_panel', {
        p_desde: desde.toISOString(),
        p_hasta: hasta.toISOString(),
        p_usuario_id: usuarioIdResumen,
      }),
    ])

    if (!vigente.actual) return

    if (listaRes.error) {
      setError('No se pudo cargar tus atenciones.')
      setRegistros([])
      setHayMas(false)
      setCargando(false)
      return
    }

    setError(null)
    setRegistros(listaRes.data ?? [])
    setHayMas(!filtroActivo && (listaRes.data ?? []).length === cantidad)

    const filaResumen = resumenRes.data?.[0]
    setResumen(
      filaResumen
        ? {
            cantidad: filaResumen.cantidad ?? 0,
            total:
              esAdmin && !filtroEsAsistente
                ? (filaResumen.total_precio ?? 0)
                : (filaResumen.total_pago_asistente ?? 0),
          }
        : RESUMEN_VACIO,
    )
    setCargando(false)
  }

  async function cargarMasRegistros() {
    if (cargandoMas || !hayMas || filtroActivo) return
    const vigente = vigenteRef.current
    setCargandoMas(true)
    const { desde, hasta } = calcularRango(filtro, personalizado)

    const { data, error: errorMas } = await construirConsultaRegistros(desde, hasta).range(
      registros.length,
      registros.length + TAMANO_PAGINA - 1,
    )

    setCargandoMas(false)
    if (!vigente.actual) return

    if (errorMas) {
      mostrarToast('No se pudieron cargar más atenciones.', 'error')
      return
    }

    setRegistros((anterior) => [...anterior, ...(data ?? [])])
    setHayMas((data ?? []).length === TAMANO_PAGINA)
  }

  // useEffectEvent: el efecto corre solo cuando cambian sus dependencias, pero llama a la versión más reciente
  // de cargarRegistros (lee los filtros actuales) sin volver a dispararse cada vez que esa función se recrea.
  const cargarDesdeEfecto = useEffectEvent((vigente, silencioso) => cargarRegistros(vigente, silencioso))
  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    vigenteRef.current = vigente
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarDesdeEfecto(vigente, silencioso)
    if (!silencioso) {
      setDiasAbiertos(new Set())
      setRegistrosAbiertos(new Set())
    }
    return () => {
      vigente.actual = false
    }
  }, [activo, usuario, filtro, personalizado.desde, personalizado.hasta, usuarioFiltro, filtroActivo])

  // Tiempo real: si otra persona cambia algo que me afecta (marca una discrepancia, confirma el acuerdo, registra o cancela una
  // atención, asigna clienta/%), esta pestaña se actualiza sola, sin refrescar. La RLS filtra los eventos: cada persona solo
  // recibe los de sus atenciones; la administradora, todos. Cada evento solo dispara una recarga silenciosa (igual que tras
  // guardar), agrupando ráfagas (un RPC puede tocar varias filas) y, al volver a la pestaña/app tras estar en segundo plano
  // (el celular suspende el socket y se pierden eventos), recarga una vez. Requiere que las tablas estén en la publicación
  // supabase_realtime (migración 20261123000001).
  const recargarPorCambio = useEffectEvent(() => cargarRegistros(vigenteRef.current, true))
  useEffect(() => {
    if (!activo || !usuario) return undefined
    let temporizador = null
    const programar = () => {
      clearTimeout(temporizador)
      temporizador = setTimeout(recargarPorCambio, 400)
    }
    const alVolver = () => {
      if (document.visibilityState === 'visible') programar()
    }
    const canal = supabase
      .channel(`mis-atenciones-${usuario.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registro_servicios' }, programar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registro_discrepancias' }, programar)
      .subscribe()
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      clearTimeout(temporizador)
      document.removeEventListener('visibilitychange', alVolver)
      supabase.removeChannel(canal)
    }
  }, [activo, usuario])

  function alternarDia(clave) {
    setDiasAbiertos((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(clave)) siguiente.delete(clave)
      else siguiente.add(clave)
      return siguiente
    })
  }

  function alternarRegistro(id) {
    setRegistrosAbiertos((anterior) => {
      const siguiente = new Set(anterior)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  async function confirmarEliminar() {
    if (!registroAEliminar) return

    setEliminando(true)
    const { error: errorEliminar } = await supabase
      .from('registro_servicios')
      .delete()
      .eq('id', registroAEliminar.id)
    setEliminando(false)
    setRegistroAEliminar(null)

    if (errorEliminar) {
      mostrarToast('No se pudo eliminar la atención.', 'error')
      return
    }

    mostrarToast('Atención eliminada.', 'exito')
    cargarRegistros(vigenteRef.current, true)
  }

  async function confirmarCancelar() {
    if (!registroACancelar) return

    setCancelando(true)
    const { error: errorCancelar } = await supabase
      .from('registro_servicios')
      .update({ estado: 'CANCELADO' })
      .eq('id', registroACancelar.id)
    setCancelando(false)
    setRegistroACancelar(null)

    if (errorCancelar) {
      mostrarToast('No se pudo cancelar la atención.', 'error')
      return
    }

    mostrarToast('Atención cancelada.', 'exito')
    cargarRegistros(vigenteRef.current, true)
  }

  // Asigna una clienta registrada a una nota pendiente (RPC asignar_cliente_atencion_pendiente: toda la cita de una vez).
  async function asignarClienta(registro, clienteElegido) {
    if (!clienteElegido?.id) return
    const { error: errorAsignar } = await supabase.rpc('asignar_cliente_atencion_pendiente', {
      p_registro_id: registro.id,
      p_cliente_id: clienteElegido.id,
    })
    setRegistroAAsignar(null)
    setModalClienteNuevoAbierto(false)
    if (errorAsignar) {
      mostrarToast(errorAsignar.message || 'No se pudo asignar la clienta.', 'error')
      return
    }
    mostrarToast(`Clienta asignada: ${clienteElegido.nombre}.`, 'exito')
    cargarRegistros(vigenteRef.current, true)
  }

  // Discrepancias: todo pasa por RPC (el servidor decide quién puede qué). Mientras una está en curso se bloquean las demás
  // acciones de esa atención para no mandar dos veces el mismo clic.
  async function ejecutarDiscrepancia(registro, nombreRpc, alExito) {
    if (acuerdoEnCurso) return
    setAcuerdoEnCurso(registro.id)
    const { data, error: errorRpc } = await supabase.rpc(nombreRpc, { p_registro_id: registro.id })
    setAcuerdoEnCurso(null)
    if (errorRpc) {
      mostrarToast(errorRpc.message || 'No se pudo completar la acción.', 'error')
      return
    }
    mostrarToast(alExito(data), 'exito')
    cargarRegistros(vigenteRef.current, true)
  }

  const marcarDiscrepancia = (registro) =>
    ejecutarDiscrepancia(
      registro,
      'marcar_discrepancia_atencion',
      () => `Discrepancia marcada: ${nombreUsuarioDe(registro) ?? 'la persona'} verá el aviso en su panel.`,
    )
  const retirarDiscrepancia = (registro) =>
    ejecutarDiscrepancia(registro, 'retirar_discrepancia_atencion', () => 'Discrepancia retirada.')
  const confirmarAcuerdo = (registro) =>
    ejecutarDiscrepancia(registro, 'confirmar_acuerdo_atencion', (estado) =>
      estado === 'RESUELTA' ? 'Acuerdo exitoso.' : 'Acuerdo enviado: falta que la otra parte lo confirme.',
    )

  async function confirmarPendiente(registro) {
    if (confirmandoId) return
    setConfirmandoId(registro.id)

    // RPC (migración 20261112000003): solo la dueña de la nota, de cualquier día — la RLS de update solo le deja
    // tocar atenciones de HOY y el % puede asignarse días después.
    const { error: errorConfirmar } = await supabase.rpc('confirmar_atencion_pendiente', {
      p_registro_id: registro.id,
    })

    setConfirmandoId(null)

    if (errorConfirmar) {
      // El mensaje del trigger (si todavía no hay % asignado) ya viene
      // redactado para mostrarlo tal cual — mismo texto que usa Citas.
      mostrarToast(errorConfirmar.message || 'No se pudo confirmar la atención.', 'error')
      return
    }

    mostrarToast('Atención confirmada — ya cuenta en tus totales.', 'exito')
    cargarRegistros(vigenteRef.current, true)
  }

  // El aviso queda «abierto» mientras todas sus atenciones (y su día) estén desplegadas. Se deduce de lo que está
  // abierto en vez de guardarlo aparte, así no queda desfasado si la usuaria cierra a mano alguno de esos días.
  function avisoAbierto(lista) {
    return (
      lista.length > 0 &&
      lista.every((p) => registrosAbiertos.has(p.id) && diasAbiertos.has(claveDiaLima(new Date(p.fecha))))
    )
  }

  // «Ver» del aviso: deja a la vista esas atenciones (amplía el período si alguna es anterior, en la admin cambia el
  // filtro de persona si hace falta) y abre su día y su detalle. Si ya estaban todas abiertas, el mismo botón
  // («Ocultar») cierra esas atenciones y sus días, sin tocar los filtros.
  function verPendientes(lista) {
    if (lista.length === 0) return
    if (avisoAbierto(lista)) {
      const dias = new Set(lista.map((p) => claveDiaLima(new Date(p.fecha))))
      const ids = new Set(lista.map((p) => p.id))
      setDiasAbiertos((anterior) => new Set([...anterior].filter((clave) => !dias.has(clave))))
      setRegistrosAbiertos((anterior) => new Set([...anterior].filter((id) => !ids.has(id))))
      return
    }
    const fechas = lista.map((p) => new Date(p.fecha))
    const { desde, hasta } = calcularRango(filtro, personalizado)
    if (!fechas.every((f) => f >= desde && f < hasta)) {
      // Si todas son del mismo mes se elige ese mes (el selector de FiltrosFecha lo reconoce y lo marca); si abarcan
      // varios meses, un rango desde la más antigua hasta hoy.
      const meses = new Set(fechas.map((f) => formatearFechaISO(f).slice(0, 7)))
      const mesActual = formatearFechaISO(new Date()).slice(0, 7)
      if (meses.size === 1 && meses.has(mesActual)) {
        setFiltro('mes')
      } else if (meses.size === 1) {
        const [anio, mes] = [...meses][0].split('-').map(Number)
        const ultimo = String(new Date(Date.UTC(anio, mes, 0)).getUTCDate()).padStart(2, '0')
        const mm = String(mes).padStart(2, '0')
        setPersonalizado({ desde: `${anio}-${mm}-01`, hasta: `${anio}-${mm}-${ultimo}` })
        setFiltro('personalizado')
      } else {
        const masAntigua = new Date(Math.min(...fechas.map((f) => f.getTime())))
        setPersonalizado({ desde: formatearFechaISO(masAntigua), hasta: formatearFechaISO(new Date()) })
        setFiltro('personalizado')
      }
    }
    if (esAdmin) {
      const duenas = new Set(lista.map((p) => p.usuario_id))
      const unica = duenas.size === 1 ? [...duenas][0] : null
      if (usuarioFiltro !== OPCION_TODOS && usuarioFiltro !== unica) setUsuarioFiltro(unica ?? OPCION_TODOS)
    }
    setBusqueda('')
    setDiasAbiertos((anterior) => new Set([...anterior, ...fechas.map(claveDiaLima)]))
    setRegistrosAbiertos((anterior) => new Set([...anterior, ...lista.map((p) => p.id)]))
  }

  // Derivados de `pendientes` memorizados: abrir/cerrar un día re-renderiza la pestaña entera y no hace falta
  // recalcularlos en cada clic (solo cambian al recargar).
  const { porcentajeDePendiente, sinClienteDePendiente, pendientesListas, pendientesEsperando, pendientesSinCliente, sinAsignarPorDia } = useMemo(() => {
    const esperando = pendientes.filter((p) => p.porcentaje == null)
    // Atenciones sin % por día (clave Lima). Sale de `pendientes`, no de la lista cargada: la lista puede estar
    // filtrada por persona (la admin entra viendo su propio panel y las notas son de las asistentes) o paginada, y el
    // punto rosa debe verse igual, coherente con el aviso.
    const porDia = new Map()
    for (const p of esperando) {
      const clave = claveDiaLima(new Date(p.fecha))
      if (!porDia.has(clave)) porDia.set(clave, [])
      porDia.get(clave).push(p)
    }
    return {
      porcentajeDePendiente: new Map(pendientes.map((p) => [p.id, p.porcentaje])),
      sinClienteDePendiente: new Map(pendientes.map((p) => [p.id, p.sinCliente])),
      // «Lista para confirmar» = ya tiene % Y clienta registrada.
      pendientesListas: pendientes.filter((p) => p.porcentaje != null && !p.sinCliente),
      pendientesEsperando: esperando,
      pendientesSinCliente: pendientes.filter((p) => p.sinCliente),
      sinAsignarPorDia: porDia,
    }
  }, [pendientes])
  const avisoListasAbierto = avisoAbierto(pendientesListas)
  const avisoEsperandoAbierto = avisoAbierto(pendientesEsperando)
  const avisoSinClienteAbierto = avisoAbierto(pendientesSinCliente)
  // Discrepancias abiertas separadas por a quién le toca: «por responder» (yo aún no confirmé el acuerdo) y «esperando» (ya lo
  // confirmé y falta la otra persona).
  const discrepanciasPorResponder = useMemo(() => discrepancias.filter((d) => !d.yoConfirme), [discrepancias])
  const discrepanciasEsperando = useMemo(() => discrepancias.filter((d) => d.yoConfirme), [discrepancias])
  const avisoDiscrepanciasAbierto = avisoAbierto(discrepanciasPorResponder)
  const avisoDiscrepanciasEsperandoAbierto = avisoAbierto(discrepanciasEsperando)
  const cuantas = (n) => (n === 1 ? '1 atención' : `${n} atenciones`)

  const registrosFiltrados = busqueda.trim()
    ? registros.filter((r) => {
        const texto = busqueda.trim().toLowerCase()
        return (
          (r.servicios?.nombre ?? '').toLowerCase().includes(texto) ||
          (r.clientes?.nombre ?? '').toLowerCase().includes(texto)
        )
      })
    : registros

  const registrosVisibles = ocultarCancelados
    ? registrosFiltrados.filter((r) => r.estado !== 'CANCELADO')
    : registrosFiltrados

  const grupos = agruparPorDia(registrosVisibles)

  return (
    <div
      className="animate-entrada-pestana px-(--separador-vertical) pb-6 pt-0 lg:mx-auto lg:w-full lg:max-w-(--ancho-pestana)"
      style={{ '--color-foco': 'var(--color-purple-300)' }}
    >
      {/* Buscador: fijo arriba al hacer scroll, siempre debajo del header */}
      <div className="sticky top-0 z-10 -mx-(--separador-vertical) flex items-center gap-2 bg-bg px-(--separador-vertical) pb-(--separador-horizontal) pt-(--separador-horizontal)">
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder="Buscar por servicio o cliente..."
          tema="purple-300"
          sinBorde
        />

        {esAdmin && (
          <SelectorOrden
            opciones={opcionesFiltroUsuario}
            valor={usuarioFiltro}
            onCambiar={setUsuarioFiltro}
            tema="purple-300"
            icono={Users}
            ariaLabel="Filtrar por asistente"
            sinBorde
          />
        )}

        {/* Solo PC: «Registrar atención» a la derecha del filtro de personal (sin filtro, al final de la barra). En móvil lo
            reemplaza el botón flotante. */}
        <button
          type="button"
          onClick={() => setModalRegistro('nuevo')}
          className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-purple-300 px-3 py-2 text-sm font-semibold text-bg lg:flex"
        >
          <Plus className="h-4 w-4" />
          <span>Registrar atención</span>
        </button>
      </div>

      {/* Filtros de fecha */}
      <FiltrosFecha.Botones
        filtro={filtro}
        onCambiarFiltro={setFiltro}
        personalizado={personalizado}
        onCambiarPersonalizado={setPersonalizado}
        tema="purple-300"
      />

      {/* Resumen del período */}
      <div className="mt-3 flex items-center justify-between gap-2 text-sm">
        {/* Resumen del período: viene del RPC resumen_mi_panel, no del array
            cargado — así sigue exacto aunque la lista de abajo esté paginada.
            Atenciones a la izquierda (a la altura de "N servicios" de cada
            día) y Total a la derecha (a la altura del monto de cada día). */}
        <span className="flex items-center gap-1.5 text-ink/60">
          Atenciones: <span className="font-mono font-semibold text-ink">{resumen.cantidad}</span>
          <button
            type="button"
            onClick={() => setOcultarCancelados((anterior) => !anterior)}
            aria-label={ocultarCancelados ? 'Mostrar canceladas' : 'Ocultar canceladas'}
            title={ocultarCancelados ? 'Mostrar canceladas' : 'Ocultar canceladas'}
            className={`inline-flex items-center gap-1.5 p-1 transition-colors lg:ml-2 ${
              ocultarCancelados ? 'text-red' : 'text-ink/40 hover:text-purple-300'
            }`}
          >
            {ocultarCancelados ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {/* Solo PC: el texto dice lo que hará el clic. */}
            <span className="text-xs max-lg:hidden">{ocultarCancelados ? 'Ver anuladas' : 'Ocultar anuladas'}</span>
          </button>
        </span>

        <span className="pr-[35px] text-ink/60">
          {filtroEsAsistente ? 'Pago asistente' : 'Total'}:{' '}
          <span className="font-mono font-semibold text-green">{formatearSoles(resumen.total)}</span>
        </span>
      </div>

      <FiltrosFecha.CamposPersonalizado
        filtro={filtro}
        personalizado={personalizado}
        onCambiarPersonalizado={setPersonalizado}
        tema="purple-300"
      />

      {/* Avisos de notas pendientes de comisión (mismo estilo que el aviso de notas de cobro en Deudas). */}
      {pendientesListas.length > 0 && (
        <button
          type="button"
          onClick={() => verPendientes(pendientesListas)}
          className="mt-2 flex w-full items-center gap-2 rounded-lg border border-green/40 bg-green/10 px-3 py-2 text-left text-xs text-ink/80 transition-colors hover:border-green"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green" />
          <span>
            {esAdmin
              ? `${cuantas(pendientesListas.length)} ya ${pendientesListas.length === 1 ? 'tiene' : 'tienen'} su clienta y su %: falta que quien la anotó la confirme. ${avisoListasAbierto ? 'Ocultar' : 'Ver'}`
              : `${pendientesListas.length === 1 ? 'Tienes 1 atención lista' : `Tienes ${pendientesListas.length} atenciones listas`} para confirmar (ya ${pendientesListas.length === 1 ? 'tiene' : 'tienen'} su clienta y su %). ${avisoListasAbierto ? 'Ocultar' : 'Ver'}`}
          </span>
        </button>
      )}
      {pendientesEsperando.length > 0 && (
        <button
          type="button"
          onClick={() => verPendientes(pendientesEsperando)}
          className="mt-2 flex w-full items-center gap-2 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-left text-xs text-ink/80 transition-colors hover:border-amber"
        >
          <NotebookPen className="h-4 w-4 shrink-0 text-amber" />
          <span>
            {esAdmin
              ? `${cuantas(pendientesEsperando.length)} sin % asignado. Asígnalo en Comisiones para que la puedan confirmar. ${avisoEsperandoAbierto ? 'Ocultar' : 'Ver'}`
              : `${cuantas(pendientesEsperando.length)} pendiente${pendientesEsperando.length === 1 ? '' : 's'} de comisión: esperando que el administrador asigne tu porcentaje. ${avisoEsperandoAbierto ? 'Ocultar' : 'Ver'}`}
          </span>
        </button>
      )}

      {pendientesSinCliente.length > 0 && (
        <button
          type="button"
          onClick={() => verPendientes(pendientesSinCliente)}
          className="mt-2 flex w-full items-center gap-2 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-left text-xs text-ink/80 transition-colors hover:border-amber"
        >
          <UserPlus className="h-4 w-4 shrink-0 text-amber" />
          <span>
            {esAdmin
              ? `${cuantas(pendientesSinCliente.length)} sin clienta registrada. Regístrala en Clientes y asígnala a la atención. ${avisoSinClienteAbierto ? 'Ocultar' : 'Ver'}`
              : `${cuantas(pendientesSinCliente.length)} pendiente${pendientesSinCliente.length === 1 ? '' : 's'} de clienta: esperando que la administradora la registre. ${avisoSinClienteAbierto ? 'Ocultar' : 'Ver'}`}
          </span>
        </button>
      )}

      {/* Discrepancias abiertas: celeste tenue (no es un riesgo, solo algo por aclarar entre la administradora y quien atendió). */}
      {discrepanciasPorResponder.length > 0 && (
        <button
          type="button"
          onClick={() => verPendientes(discrepanciasPorResponder)}
          className="mt-2 flex w-full items-center gap-2 rounded-lg border border-blue/30 bg-blue/10 px-3 py-2 text-left text-xs text-ink/80 transition-colors hover:border-blue"
        >
          <Handshake className="h-4 w-4 shrink-0 text-blue" />
          <span>
            {esAdmin
              ? `${cuantas(discrepanciasPorResponder.length)} en discrepancia: conversen ${discrepanciasPorResponder.length === 1 ? 'la atención' : 'las atenciones'} con el personal y confirmen el acuerdo. ${avisoDiscrepanciasAbierto ? 'Ocultar' : 'Ver'}`
              : `${discrepanciasPorResponder.length === 1 ? 'Hay 1 atención que necesita' : `Hay ${discrepanciasPorResponder.length} atenciones que necesitan`} ser conversada${discrepanciasPorResponder.length === 1 ? '' : 's'} con el administrador. ${avisoDiscrepanciasAbierto ? 'Ocultar' : 'Ver'}`}
          </span>
        </button>
      )}
      {/* Ya confirmé el acuerdo y falta la otra persona: verde (de mi parte está listo), con la referencia a quién falta. */}
      {discrepanciasEsperando.length > 0 && (
        <button
          type="button"
          onClick={() => verPendientes(discrepanciasEsperando)}
          className="mt-2 flex w-full items-center gap-2 rounded-lg border border-green/40 bg-green/10 px-3 py-2 text-left text-xs text-ink/80 transition-colors hover:border-green"
        >
          <Handshake className="h-4 w-4 shrink-0 text-green" />
          <span>
            {`${cuantas(discrepanciasEsperando.length)} con tu acuerdo enviado: esperando que ${
              esAdmin
                ? discrepanciasEsperando.length === 1 ? 'la otra persona lo confirme' : 'el personal lo confirme'
                : 'el administrador lo confirme'
            }. ${avisoDiscrepanciasEsperandoAbierto ? 'Ocultar' : 'Ver'}`}
          </span>
        </button>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <EsqueletoGrupos />
      ) : registrosFiltrados.length === 0 ? (
        <EstadoVacio
          icono={NotebookText}
          mensaje={
            busqueda.trim()
              ? 'No se encontraron atenciones.'
              : 'No hay atenciones registradas en este período.'
          }
          accion={{ label: '+ Nueva atención', onClick: () => setModalRegistro('nuevo') }}
          tema="purple-300"
        />
      ) : (
        <div className="mt-4 space-y-3">
          {grupos.map((grupo) => {
            const abierto = diasAbiertos.has(grupo.clave)
            const registrosActivosDia = grupo.registros.filter((r) => r.estado === 'ACTIVO')
            const totalDia = sumarMontos(registrosActivosDia, (r) =>
              montoDeRegistro(r, esAdmin && !filtroEsAsistente),
            )
            // Punto rosa en la esquina: el día tiene alguna atención sin % asignado, para ubicarla sin abrir todos.
            const sinAsignarDelDia = sinAsignarPorDia.get(grupo.clave) ?? []
            const sinAsignarDia = sinAsignarDelDia.length > 0
            // Las que no están en la lista de este día (otra persona con el filtro actual, o en una página aún no
            // cargada): se avisa dentro del día con un «Ver» que las trae, igual que el aviso de arriba.
            const idsDelDia = sinAsignarDia ? new Set(grupo.registros.map((r) => r.id)) : null
            const sinAsignarOcultas = sinAsignarDelDia.filter((p) => !idsDelDia?.has(p.id))

            return (
              <div
                key={grupo.clave}
                className={`relative border border-border bg-surface transition-colors duration-300 ${
                  abierto ? 'rounded-none border-l-2 border-l-purple-300 bg-purple-300/5' : 'rounded-lg'
                }`}
              >
                {sinAsignarDia && (
                  <span
                    aria-hidden="true"
                    title="Tiene atenciones sin % asignado"
                    className="pointer-events-none absolute -left-1 -top-1 z-[1] h-2.5 w-2.5 rounded-full bg-purple-300 ring-2 ring-bg"
                  />
                )}
                <button
                  type="button"
                  onClick={() => alternarDia(grupo.clave)}
                  aria-label={sinAsignarDia ? `${formatearTituloDia(grupo.fecha)}: tiene atenciones sin % asignado` : undefined}
                  className="flex w-full items-center gap-2 px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario) text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      {/* Abierto: toda la cabecera se pinta rosa (día, fecha, servicios, monto y flecha). */}
                      <p
                        className={`text-sm font-medium transition-colors duration-300 ${
                          abierto ? 'text-purple-300' : 'text-ink'
                        }`}
                      >
                        {formatearTituloDia(grupo.fecha)}
                      </p>
                      <span
                        className={`text-xs transition-colors duration-300 ${
                          abierto ? 'text-purple-300' : 'text-ink/60'
                        }`}
                      >
                        {registrosActivosDia.length} servicio
                        {registrosActivosDia.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-sm text-purple-300">
                    {formatearSoles(totalDia)}
                  </span>
                  <IconoFlechaDesplegable
                    className={`h-3 w-3 shrink-0 transition-[transform,color] duration-300 ${
                      abierto ? 'rotate-180 text-purple-300' : 'text-ink/60'
                    }`}
                  />
                </button>

                {/* diferido: los registros de un día cerrado no se montan. Sin esto, cada clic re-renderizaba todas
                    las atenciones de todos los días con su detalle (cientos de filas) y abrir/cerrar se sentía lento.
                    No hay borradores dentro (solo lectura y botones), así que desmontarlos no pierde nada. */}
                <CampoColapsable abierto={abierto} diferido>
                  {/* Padding lateral mínimo (px-1) y el resto lo pone cada fila (var − 4px): así el texto de cada atención
                      queda a la misma distancia del borde que el de la cabecera del día. */}
                  <div className="space-y-1 border-t border-border px-1 py-1.5 sm:space-y-2 sm:py-3">
                    {sinAsignarOcultas.length > 0 && (
                      <button
                        type="button"
                        onClick={() => verPendientes(sinAsignarOcultas)}
                        className="flex w-full items-center gap-2 rounded-lg border border-purple-300/40 bg-purple-300/10 px-2.5 py-1.5 text-left text-xs text-ink/80 transition-colors hover:border-purple-300"
                      >
                        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-purple-300" />
                        <span>
                          {cuantas(sinAsignarOcultas.length)} sin % asignado este día no{' '}
                          {sinAsignarOcultas.length === 1 ? 'aparece' : 'aparecen'} con el filtro actual. Ver
                        </span>
                      </button>
                    )}
                    {agruparPorCliente(grupo.registros).map((clienteGrupo) => (
                      <div key={clienteGrupo.clave} className="overflow-hidden rounded-lg bg-surface-2">
                        {/* Cabecera de la clienta: su nombre una sola vez (la fecha ya está en la cabecera del día);
                            debajo, un renglón por servicio. */}
                        <div className="flex items-center gap-1.5 px-[calc(var(--separador-vertical-secundario)-0.25rem)] pt-2 sm:pt-2.5">
                          <User aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ink/60" />
                          <p className="min-w-0 truncate text-sm font-semibold text-ink">{clienteGrupo.nombre}</p>
                        </div>
                        <div className="divide-y divide-border/60">
                    {clienteGrupo.registros.map((registro) => {
                      const tieneComision =
                        registro.porcentaje_aplicado != null && registro.pago_asistente != null
                      const cancelado = registro.estado === 'CANCELADO'
                      const pendiente = registro.estado === 'PENDIENTE_PORCENTAJE'
                      // B4 de la 3ª auditoría: la RLS de registro_servicios_update
                      // solo deja a un no-admin cancelar atenciones de HOY (mismo
                      // criterio que es_hoy() en el servidor) — antes el botón
                      // aparecía igual en días pasados y el intento fallaba con
                      // un toast de error confuso.
                      const esHoy = esHoyLima(new Date(registro.fecha))
                      // Nota pendiente (sin %): es de quien la anotó. La admin solo la ve y asigna el % en
                      // Porcentajes; confirmarla o cancelarla es de la dueña (RLS + RPC, migración 20261112000003).
                      const esPropio = registro.usuario_id === usuario?.id
                      const porcentajeNota = pendiente ? (porcentajeDePendiente.get(registro.id) ?? null) : null
                      // Cita completada con la clienta solo como nombre: la dueña o la administradora la asignan a una clienta registrada.
                      const faltaClienta = pendiente && (sinClienteDePendiente.get(registro.id) ?? false)
                      const puedeAsignarClienta = faltaClienta && (esPropio || esAdmin)
                      const puedeConfirmar = pendiente && esPropio && porcentajeNota != null && !faltaClienta
                      // La administradora ya NO edita, cancela ni elimina las atenciones de otras personas (lo impide también la
                      // base, migración 20261122000001): solo las suyas. Si algo no cuadra en una ajena abre una discrepancia
                      // y se resuelve hablando. La dueña sigue cancelando la suya (hoy; la admin, cualquier día).
                      const puedeEditar = !cancelado && !pendiente && esAdmin && esPropio
                      const puedeCancelar = !cancelado && esPropio && (pendiente ? esHoy : esAdmin || esHoy)
                      const puedeEliminar = !pendiente && esAdmin && esPropio
                      const puedeAsignarPorcentaje = pendiente && !esPropio && esAdmin && porcentajeNota == null
                      const nombreDuena = nombreUsuarioDe(registro) ?? 'quien la anotó'
                      const discrepancia = discrepanciaDe(registro)
                      const discrepanciaAbierta = discrepancia?.abierta ?? false
                      const puedeMarcarDiscrepancia = esAdmin && !esPropio && !cancelado && !discrepanciaAbierta
                      // Quién ya confirmó el acuerdo: yo (según mi lado: la dueña o la administradora) y/o la otra parte.
                      const { estado: estadoManito, yoConfirme: miAcuerdo, otroConfirmo: otroAcuerdo } = estadoAcuerdo(discrepancia, esPropio)
                      // Solo la administradora ve quién atendió (el resto solo ve sus propias atenciones).
                      const atendio = esAdmin ? nombreUsuarioDe(registro) : null
                      const registroAbierto = registrosAbiertos.has(registro.id)

                      // Acciones de la atención (editar, anular, eliminar, discrepancia…). En móvil van abajo y centradas; en PC (lg) van
                      // a la derecha de la fila de «Atendió» y el cálculo. Se pinta dos veces (una por tamaño) y CSS oculta una.
                      const hayAcciones =
                        puedeConfirmar || puedeEditar || puedeCancelar || puedeEliminar || puedeAsignarPorcentaje || puedeAsignarClienta || puedeMarcarDiscrepancia
                      const botonesAcciones = (clases) => (
                        <div className={clases}>
                                  {puedeConfirmar && (
                                    <BotonAccion
                      sinBorde
                      fondo
                                      icono={CheckCircle2}
                                      texto="Confirmar"
                                      color="verde"
                                      onClick={() => confirmarPendiente(registro)}
                                    />
                                  )}
                                  {puedeAsignarClienta && (
                                    <BotonAccion
                      sinBorde
                      fondo
                                      icono={UserPlus}
                                      texto="Asignar clienta"
                                      color="celeste"
                                      onClick={() => setRegistroAAsignar(registro)}
                                    />
                                  )}
                                  {puedeAsignarPorcentaje && (
                                    <BotonAccion
                      sinBorde
                      fondo
                                      icono={Percent}
                                      texto="Asignar %"
                                      color="morado"
                                      onClick={() => navigate('/porcentajes')}
                                    />
                                  )}
                                  {puedeMarcarDiscrepancia && (
                                    <BotonAccion
                      sinBorde
                      fondo
                                      icono={MessageSquareWarning}
                                      texto="Marcar discrepancia (hay que conversarla)"
                                      etiquetaPc="Iniciar discrepancia"
                                      color="celeste"
                                      onClick={() => marcarDiscrepancia(registro)}
                                    />
                                  )}
                                  {puedeEditar && (
                                    <BotonAccion
                      sinBorde
                      fondo
                                      icono={Pencil}
                                      texto="Editar"
                                      color="celeste"
                                      onClick={() => setModalRegistro(registro)}
                                    />
                                  )}
                                  {puedeCancelar && (
                                    <BotonAccion
                      sinBorde
                      fondo
                                      icono={Ban}
                                      texto="Cancelar"
                                      color="rojo"
                                      onClick={() => setRegistroACancelar(registro)}
                                    />
                                  )}
                                  {puedeEliminar && (
                                    <BotonAccion
                      sinBorde
                      fondo
                                      icono={Trash2}
                                      texto="Eliminar"
                                      color="rojo"
                                      onClick={() => setRegistroAEliminar(registro)}
                                    />
                                  )}
                        </div>
                      )
                      const filaAtendio = esAdmin && (atendio || (!cancelado && !pendiente && !tieneComision))
                      const mostrarCalculo = esAdmin && !cancelado && !pendiente && tieneComision

                      return (
                        <div
                          key={registro.id}
                          className={cancelado ? 'bg-red/5' : discrepanciaAbierta ? 'bg-blue/5' : pendiente ? 'bg-orange-400/5' : undefined}
                        >
                          <div
                            onClick={() => alternarRegistro(registro.id)}
                            onKeyDown={manejarActivacionTeclado(() => alternarRegistro(registro.id))}
                            role="button"
                            tabIndex={0}
                            aria-expanded={registroAbierto}
                            aria-label={registroAbierto ? 'Contraer' : 'Expandir'}
                            className="cursor-pointer px-[calc(var(--separador-vertical-secundario)-0.25rem)] py-1 sm:py-1.5"
                          >
                            {/* Una sola línea por servicio: quién atendió · servicio · hora · precio (y la flecha). La
                                columna de quién atendió solo aparece cuando el panel mezcla personas (administradora);
                                en móvil lleva solo el primer nombre. Servicio y nombre se deslizan en bucle si no caben. */}
                            <div
                              className={`grid items-center gap-x-1 sm:gap-x-2 ${
                                atendio
                                  ? 'grid-cols-[3.75rem_minmax(0,1fr)_auto_minmax(2.5rem,auto)_0.75rem] sm:grid-cols-[10.5rem_minmax(0,1fr)_6.25rem_6rem_0.75rem]'
                                  : 'grid-cols-[minmax(0,1fr)_auto_minmax(2.5rem,auto)_0.75rem] sm:grid-cols-[minmax(0,1fr)_6.25rem_6rem_0.75rem]'
                              }`}
                            >
                              {atendio && (
                                // En PC (sm+) un ícono de persona antecede al nombre de quien realizó el servicio; en móvil
                                // la columna sigue siendo solo el primer nombre.
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <UserRound aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-purple-300 max-sm:hidden" />
                                  <TextoDeslizante texto={atendio} className="min-w-0 flex-1 text-xs text-purple-300">
                                    <span className="sm:hidden">{primerNombre(atendio)}</span>
                                    <span className="max-sm:hidden">{atendio}</span>
                                  </TextoDeslizante>
                                </div>
                              )}
                              <TextoDeslizante
                                texto={registro.servicios?.nombre ?? 'Servicio eliminado'}
                                className={`text-sm font-medium ${
                                  cancelado ? 'text-red line-through' : pendiente ? 'text-orange-400' : 'text-ink'
                                }`}
                              />
                              <span className="flex items-center gap-1 whitespace-nowrap text-xs text-ink/60">
                                <Clock aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-ink/40 max-sm:hidden" />
                                {formatearHora(registro.fecha)}
                              </span>
                              <div className="flex items-center justify-end">
                                {cancelado || pendiente ? (
                                  <EstadoRegistro cancelado={cancelado} pendiente={pendiente} porcentajeNota={faltaClienta ? null : porcentajeNota} />
                                ) : (
                                  <span className="font-mono text-sm text-green">
                                    {/* En móvil se omite «S/» (el agrupador del día sí lo conserva). */}
                                    <span className="max-sm:hidden">S/ </span>
                                    {montoDeRegistro(registro, esAdmin && !filtroEsAsistente).toFixed(2)}
                                  </span>
                                )}
                              </div>
                              <IconoFlechaDesplegable
                                className={`h-3 w-3 text-ink/60 transition-transform duration-300 ${
                                  registroAbierto ? 'rotate-180' : ''
                                }`}
                              />
                            </div>
                          </div>

                          <CampoColapsable abierto={registroAbierto} diferido>
                            <div className="space-y-2 border-t border-border/60 px-[calc(var(--separador-vertical-secundario)-0.25rem)] pb-2.5 pt-2">
                              {/* Quién atendió (nombre completo) y, a la derecha, el aviso si aún no tiene % (el % aplicado va en el cálculo).
                                  En PC (lg) la misma fila lleva además el cálculo y, al extremo derecho, las acciones. */}
                              {(filaAtendio || hayAcciones) && (
                                <div className={`items-start justify-between gap-2 lg:flex lg:items-center ${filaAtendio ? 'flex' : 'max-lg:hidden'}`}>
                                  <div className="flex min-w-0 flex-1 items-start justify-between gap-2 lg:items-center lg:justify-start lg:gap-4">
                                    <p className="min-w-0 text-xs text-ink/60">{atendio ? `Atendió: ${atendio}` : ''}</p>
                                    {mostrarCalculo && (
                                      <p className="hidden font-mono text-xs text-ink/70 lg:block">
                                        {formatearSoles(registro.precio)} ×{' '}
                                        <span className="text-yellow-300">{registro.porcentaje_aplicado}%</span> ={' '}
                                        <span className="font-semibold text-green">{formatearSoles(registro.pago_asistente)}</span>
                                      </p>
                                    )}
                                    {esAdmin && !cancelado && !pendiente && !tieneComision && (
                                      <span className="flex shrink-0 items-center gap-1 text-xs text-orange-400">
                                        <AlertTriangle className="h-3.5 w-3.5" />
                                        Sin % asignado
                                      </span>
                                    )}
                                  </div>
                                  {hayAcciones && botonesAcciones('hidden shrink-0 items-center gap-1.5 lg:flex')}
                                </div>
                              )}
                              {faltaClienta && (
                                <div className="flex items-center gap-1.5 rounded-lg bg-orange-400/10 px-2.5 py-1.5 text-xs text-orange-400">
                                  <UserPlus className="h-3.5 w-3.5 shrink-0" />
                                  {`«${registro.cliente_nombre_referencia}» aún no está registrada como clienta. ${
                                    esAdmin
                                      ? 'Regístrala en Clientes y asígnala aquí'
                                      : 'Pide a la administradora que la registre, o asígnala si ya existe'
                                  }; hasta entonces no cuenta en los totales ni sale en Ventas.`}
                                </div>
                              )}
                              {pendiente && !faltaClienta &&
                                (porcentajeNota != null ? (
                                  <div className="flex items-center gap-1.5 rounded-lg bg-green/10 px-2.5 py-1.5 text-xs text-green">
                                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                    {esPropio
                                      ? `Lista para confirmar: ya tiene su clienta y tu porcentaje (${porcentajeNota}%).`
                                      : `Clienta y % asignados (${porcentajeNota}%). Falta que ${nombreDuena} la confirme.`}
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5 rounded-lg bg-orange-400/10 px-2.5 py-1.5 text-xs text-orange-400">
                                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                    {esPropio
                                      ? 'Pendiente de comisión — no cuenta en tus totales hasta que el administrador asigne tu % y la confirmes.'
                                      : `Sin % asignado. Asígnalo en Comisiones; después ${nombreDuena} la confirma.`}
                                  </div>
                                ))}

                              {!esAdmin && !cancelado && !pendiente && !tieneComision && (
                                <p className="text-xs text-orange-400">Sin comisión asignada</p>
                              )}

                              {/* Discrepancia: la abre la administradora; se cierra cuando las dos partes confirman con la manito. No
                                  bloquea nada (celeste tenue: es algo por aclarar, no un riesgo). Resuelta, queda como constancia en verde. */}
                              {discrepancia?.abierta && (
                                <div className="rounded-lg border border-blue/30 bg-blue/10 px-2.5 py-2 text-xs">
                                  <div className="flex items-center gap-2">
                                    <div className="min-w-0 flex-1 space-y-1">
                                      <p className="flex items-start gap-1.5 text-blue">
                                        <MessageSquareWarning className="mt-px h-3.5 w-3.5 shrink-0" />
                                        <span>
                                          {esPropio
                                            ? 'Hay una atención que necesita ser conversada con el administrador.'
                                            : `Atención en discrepancia: conversen con ${nombreDuena} y, al llegar a un acuerdo, confirmen con la manito.`}
                                        </span>
                                      </p>
                                      <p className={miAcuerdo ? 'text-green' : 'text-ink/70'}>
                                        {miAcuerdo
                                          ? `Acuerdo enviado. Esperando ${esPropio ? 'al administrador' : `a ${nombreDuena}`}.`
                                          : `${otroAcuerdo ? `${esPropio ? 'El administrador' : nombreDuena} ya confirmó. ` : ''}Llegaron a un acuerdo, confirmar.`}
                                      </p>
                                    </div>
                                    <BotonAcuerdo
                                      conTextoPc
                                      estado={estadoManito}
                                      yaConfirme={miAcuerdo}
                                      ocupado={acuerdoEnCurso === registro.id}
                                      onClick={() => confirmarAcuerdo(registro)}
                                    />
                                  </div>
                                  {esAdmin && !esPropio && (
                                    <button
                                      type="button"
                                      onClick={() => retirarDiscrepancia(registro)}
                                      disabled={acuerdoEnCurso === registro.id}
                                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-ink/50 underline-offset-2 transition-colors hover:text-red hover:underline disabled:opacity-40"
                                    >
                                      {/* Solo PC: una X roja pequeña a la izquierda del texto. */}
                                      <X aria-hidden="true" className="h-3 w-3 shrink-0 text-red max-lg:hidden" />
                                      Retirar discrepancia
                                    </button>
                                  )}
                                </div>
                              )}
                              {discrepancia && !discrepancia.abierta && (
                                <div className="flex items-center gap-1.5 rounded-lg bg-green/10 px-2.5 py-1.5 text-xs text-green">
                                  <BotonAcuerdo estado="resuelto" />
                                  <span>Acuerdo exitoso · {formatearDiaCorto(discrepancia.resuelta_en)}</span>
                                </div>
                              )}

                              {/* Cómo se calculó el pago (solo la administradora): precio del servicio × % = pago. */}
                              {mostrarCalculo && (
                                <p className="font-mono text-xs text-ink/70 lg:hidden">
                                  {formatearSoles(registro.precio)} ×{' '}
                                  <span className="text-yellow-300">{registro.porcentaje_aplicado}%</span> ={' '}
                                  <span className="font-semibold text-green">{formatearSoles(registro.pago_asistente)}</span>
                                </p>
                              )}

                              {/* Cancelada: solo Eliminar (admin) sigue disponible —
                                  Editar/Cancelar no aplican a una atención ya cancelada. */}
                              {hayAcciones && botonesAcciones('flex flex-wrap items-center justify-center gap-1.5 lg:hidden')}

                              {registro.nota && (
                                <p className="text-xs text-ink/60">{registro.nota}</p>
                              )}
                            </div>
                          </CampoColapsable>
                        </div>
                      )
                    })}
                        </div>
                      </div>
                    ))}
                  </div>
                </CampoColapsable>
              </div>
            )
          })}

          {hayMas && (
            <button
              type="button"
              onClick={cargarMasRegistros}
              disabled={cargandoMas}
              className="w-full rounded-lg border border-border-strong py-2.5 text-sm text-ink/70 transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
            >
              {cargandoMas ? 'Cargando...' : 'Cargar más'}
            </button>
          )}
        </div>
      )}

      <BotonFlotanteAgregar
        onClick={() => setModalRegistro('nuevo')}
        color="morado"
        label="Registrar atención"
      />

      {modalRegistro && (
        <ModalRegistroAtencion
          registro={modalRegistro === 'nuevo' ? null : modalRegistro}
          onCerrar={() => setModalRegistro(null)}
          onGuardado={() => {
            const esNuevo = modalRegistro === 'nuevo'
            setModalRegistro(null)
            mostrarToast(esNuevo ? 'Atención registrada.' : 'Atención actualizada.', 'exito')
            cargarRegistros(vigenteRef.current, true)
          }}
        />
      )}

      {registroAAsignar && !modalClienteNuevoAbierto && (
        <ModalBuscarCliente
          ventaRapida={false}
          onSeleccionar={(clienteElegido) => asignarClienta(registroAAsignar, clienteElegido)}
          onRegistrarNuevo={
            esAdmin
              ? (nombre) => {
                  setNombreClienteNuevo(nombre)
                  setModalClienteNuevoAbierto(true)
                }
              : undefined
          }
          onCerrar={() => setRegistroAAsignar(null)}
        />
      )}

      {registroAAsignar && modalClienteNuevoAbierto && (
        <ModalCliente
          nombreInicial={nombreClienteNuevo || registroAAsignar.cliente_nombre_referencia || ''}
          onCerrar={() => setModalClienteNuevoAbierto(false)}
          onGuardado={(clienteCreado) => {
            if (clienteCreado) asignarClienta(registroAAsignar, clienteCreado)
            else setModalClienteNuevoAbierto(false)
          }}
        />
      )}

      {registroAEliminar && (
        <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
          <div ref={panelEliminarRef} className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
            <h2 className="text-base font-semibold text-ink">¿Eliminar esta atención?</h2>
            <p className="mt-1 text-sm text-ink/60">Esta acción no se puede deshacer.</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setRegistroAEliminar(null)}
                disabled={eliminando}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarEliminar}
                disabled={eliminando}
                className="flex-1 rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10 disabled:opacity-40"
              >
                {eliminando ? 'Eliminando...' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {registroACancelar && (
        <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
          <div ref={panelCancelarRef} className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
            <h2 className="text-base font-semibold text-ink">¿Cancelar esta atención?</h2>
            <p className="mt-1 text-sm text-ink/60">
              Quedará marcada como cancelada y no contará en tus totales del período.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setRegistroACancelar(null)}
                disabled={cancelando}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={confirmarCancelar}
                disabled={cancelando}
                className="flex-1 rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10 disabled:opacity-40"
              >
                {cancelando ? 'Cancelando...' : 'Sí, cancelar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
