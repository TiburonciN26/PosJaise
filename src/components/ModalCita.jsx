import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, User, UserPlus, Scissors, UserRoundPlus, PlusCircle, Check, Percent } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useAvisoDescarte } from '../hooks/useAvisoDescarte.jsx'
import { listarCambios } from '../lib/cambiosFormulario.js'
import BotonCerrarModal from './BotonCerrarModal.jsx'
import { useBusquedaClientes } from '../hooks/useBusquedaClientes.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { aInputDatetimeLima, deInputDatetimeLima } from '../lib/fechas.js'
import { MENSAJE_NEGOCIO_CERRADO } from '../lib/estadoNegocio.js'
import Etiqueta from './Etiqueta.jsx'
import { SIN_SUGERENCIAS } from '../lib/sinSugerencias.js'
import InputFechaHora from './InputFechaHora.jsx'
import AyudaCampo from './AyudaCampo.jsx'
import ModalCliente from './ModalCliente.jsx'
import ModalServicio from './ModalServicio.jsx'
import { categoriasDeServicios, LIMITE_SERVICIOS } from '../lib/buscarServicios.js'
import { useBusquedaServicios } from '../hooks/useBusquedaServicios.js'
import { useServiciosConComision } from '../hooks/useServiciosConComision.js'
import { useInasistenciasClienta } from '../hooks/useInasistenciasClienta.js'
import { useHorarioAtencionSemana } from '../hooks/useHorarioAtencionSemana.js'
import { textoInasistencias } from '../lib/inasistencias.js'
import { adelantoSuperaTotal, totalServiciosCita } from '../lib/adelantoCita.js'
import { formatearSoles } from '../lib/moneda.js'
import { avisoHorarioCita } from '../lib/avisoHorarioCita.js'
import { horaSugeridaCita } from '../lib/horaSugeridaCita.js'
import { citasQueChocan, textoChoques } from '../lib/choquesCita.js'
import { useCitasDeAsistenteEnElDia } from '../hooks/useCitasDeAsistenteEnElDia.js'
import SelectorDesplegable from './SelectorDesplegable.jsx'

// Asistente y Adelanto o abono: etiqueta a la izquierda y campo a la derecha, en una sola línea (7rem + hueco de 0.5rem
// = la sangría que usa el mensaje de ayuda para quedar alineado bajo el campo).
// Alto del carrito: mínimo = 1 servicio (la fila mide 66 px: nombre 20 + duración 34 + relleno 12). Sin máximo ni scroll: con más
// servicios se expande para mostrarlos completos (ver listaCarritoRef).
const ALTO_MIN_CARRITO = 66
const FILA_CAMPO = 'grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-2'
const SANGRIA_MENSAJE = 'pl-[7.5rem]'

// Umbrales del swipe-to-delete del carrito — mismos valores que el
// carrito de Ventas/Mis atenciones, para que el gesto se sienta idéntico.
const UMBRAL_ARRASTRE_ELIMINAR = 90
const UMBRAL_ARRASTRE_INICIO = 8

// Columnas del carrito (cabecera «Servicio / Precio» y filas): nombre, precio y, solo con mouse, el botón ✕. En táctil se quita
// deslizando la fila, así que no hay tercera columna.
// La columna del precio mide lo justo para «S/ + campo de 4rem» (5.5rem): antes eran 7.5rem y el vacío a la izquierda del «S/» le quitaba
// ancho al nombre del servicio.
const COLUMNAS_CARRITO = (esTactil) => (esTactil ? 'grid-cols-[1fr_5.5rem]' : 'grid-cols-[1fr_5.5rem_1.5rem]')

// sinComision: este servicio no tiene % para la asistente elegida (solo avisa; igual se puede agendar). resaltada: línea
// recién agregada — destello verde, igual que el carrito de Ventas/Registro de atención.
// onAsignarComision (solo la administradora): lleva a Comisiones con este servicio abierto para escribir el % de esta asistente.
function FilaLineaCita({ linea, esTactil, sinComision = false, resaltada = false, onAsignarComision, onCambiarPrecio, onCambiarDuracion, onQuitar }) {
  const [arrastreX, setArrastreX] = useState(0)
  const [arrastrando, setArrastrando] = useState(false)
  const inicioRef = useRef({ x: 0, iniciado: false, ignorar: false })
  const filaRef = useRef(null)

  // La lista del carrito tiene alto máximo y scroll: si la línea nueva cayó fuera de la vista, se trae para que se vea el destello.
  useEffect(() => {
    if (resaltada) filaRef.current?.scrollIntoView({ block: 'nearest' })
  }, [resaltada])

  function manejarPointerDown(evento) {
    if (!esTactil) return
    const ignorar = Boolean(evento.target.closest('button, input'))
    inicioRef.current = { x: evento.clientX, iniciado: false, ignorar }
    if (!ignorar) evento.currentTarget.setPointerCapture?.(evento.pointerId)
  }

  function manejarPointerMove(evento) {
    if (!esTactil || inicioRef.current.ignorar || evento.buttons === 0) return
    const deltaX = evento.clientX - inicioRef.current.x

    if (!inicioRef.current.iniciado) {
      if (Math.abs(deltaX) < UMBRAL_ARRASTRE_INICIO) return
      inicioRef.current.iniciado = true
      setArrastrando(true)
    }

    setArrastreX(Math.max(-140, Math.min(140, deltaX)))
  }

  function soltar(evento) {
    evento.currentTarget.releasePointerCapture?.(evento.pointerId)
    if (!inicioRef.current.iniciado) return
    inicioRef.current.iniciado = false
    setArrastrando(false)

    if (Math.abs(arrastreX) >= UMBRAL_ARRASTRE_ELIMINAR) {
      onQuitar()
    } else {
      setArrastreX(0)
    }
  }

  const progresoEliminar = Math.min(1, Math.abs(arrastreX) / UMBRAL_ARRASTRE_ELIMINAR)

  return (
    <div
      ref={filaRef}
      onPointerDown={manejarPointerDown}
      onPointerMove={manejarPointerMove}
      onPointerUp={soltar}
      onPointerCancel={soltar}
      style={{
        transform: arrastreX ? `translateX(${arrastreX}px)` : undefined,
        backgroundColor: `color-mix(in srgb, var(--color-red) ${Math.round(progresoEliminar * 85)}%, transparent)`,
        transition: arrastrando ? 'none' : undefined,
      }}
      className={`${COLUMNAS_CARRITO(esTactil)} touch-pan-y grid items-start gap-2 px-3 py-1.5 transition-[transform_200ms_ease-in,background-color_150ms_ease-out] ${resaltada ? 'animate-flash-verde' : ''}`}
    >
      <div className="min-w-0">
        <p className="truncate text-sm text-ink">{linea.nombre}</p>
        <div className="mt-1 flex items-center gap-1">
          <input
            type="search"
            inputMode="numeric"
            {...SIN_SUGERENCIAS}
            value={linea.duracionMin}
            onChange={(evento) => onCambiarDuracion(evento.target.value)}
            aria-label={`Duración de ${linea.nombre} en minutos`}
            className="w-12 rounded-lg border border-border bg-surface px-1.5 py-1 text-right font-mono text-sm text-ink outline-none focus:border-purple-300"
          />
          <span className="text-xs text-ink/50">min</span>
        </div>
        {sinComision && (
          <div className="mt-1 flex items-start gap-1.5 text-[11px] text-orange-400">
            <p className="min-w-0 flex-1">Sin comisión: este servicio no tiene % asignado para esta asistente.</p>
            {onAsignarComision && (
              <button
                type="button"
                onClick={onAsignarComision}
                aria-label="Asignar comisión en la pestaña Comisiones"
                title="Asignar comisión en Comisiones"
                className="shrink-0 rounded-md border border-orange-400/50 p-1 text-orange-400 transition-colors hover:bg-orange-400/10"
              >
                <Percent className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-1">
        <span className="text-xs text-ink/50">S/</span>
        <input
          type="search"
          inputMode="decimal"
          {...SIN_SUGERENCIAS}
          value={linea.precio}
          onChange={(evento) => onCambiarPrecio(evento.target.value)}
          aria-label={`Precio de ${linea.nombre}`}
          className="w-16 rounded-lg border border-border bg-surface px-1.5 py-1 text-right font-mono text-sm text-ink outline-none focus:border-purple-300"
        />
      </div>

      {!esTactil && (
        <button
          type="button"
          onClick={onQuitar}
          aria-label="Quitar servicio"
          className="mt-1.5 text-ink/30 transition-colors hover:text-red"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

function formularioVacio(fechaSugerida) {
  return {
    clienteId: '',
    asistenteId: '',
    fechaHora: aInputDatetimeLima(fechaSugerida ?? new Date()),
    nota: '',
    adelanto: '',
  }
}

function formularioDesdeCita(cita) {
  return {
    clienteId: cita.cliente_id ?? '',
    asistenteId: cita.asistente_id ?? '',
    fechaHora: aInputDatetimeLima(new Date(cita.fecha_hora)),
    nota: cita.nota ?? '',
    adelanto: cita.adelanto != null ? String(cita.adelanto) : '',
  }
}

// «Agendar otra igual» (desde una cita completada): misma clienta, asistente y servicios, y la misma hora 4 semanas después (el día de
// la semana no cambia). Sin nota ni adelanto: eran de la cita anterior. Todo se puede cambiar antes de guardar.
const MS_CUATRO_SEMANAS = 28 * 24 * 60 * 60 * 1000
function formularioDesdePlantilla(cita) {
  return {
    ...formularioDesdeCita(cita),
    fechaHora: aInputDatetimeLima(new Date(new Date(cita.fecha_hora).getTime() + MS_CUATRO_SEMANAS)),
    nota: '',
    adelanto: '',
  }
}

function lineasDesdeCita(cita) {
  return (cita.cita_servicios ?? []).map((cs) => ({
    id: cs.id,
    servicioId: cs.servicio_id,
    nombre: cs.servicios?.nombre ?? 'Servicio eliminado',
    duracionMin: String(cs.duracion_min ?? 30),
    precio: String(cs.precio ?? cs.servicios?.precio ?? ''),
  }))
}

// El asistente solo es obligatorio si quien agenda NO es admin (una
// asistente siempre agenda para sí misma). Un admin puede dejarlo sin
// asignar — por ejemplo cuando el servicio lo va a hacer ella misma.
function validar(formulario, lineas, puedeElegirAsistente, clienteReferencia) {
  if (!formulario.clienteId && !clienteReferencia.trim()) {
    return 'Selecciona un cliente o escribe un nombre de referencia.'
  }
  if (lineas.length === 0) return 'Agrega al menos un servicio.'
  if (!formulario.asistenteId && !puedeElegirAsistente) return 'Selecciona una asistente.'
  if (!formulario.fechaHora) return 'Selecciona una fecha y hora.'

  for (const linea of lineas) {
    const duracion = parseInt(linea.duracionMin, 10)
    if (Number.isNaN(duracion) || duracion <= 0) return 'Hay una duración inválida en los servicios.'
    const precio = parseFloat(linea.precio)
    if (Number.isNaN(precio) || precio < 0) return 'Hay un precio inválido en los servicios.'
  }

  if (formulario.adelanto.trim()) {
    const adelanto = parseFloat(formulario.adelanto)
    if (Number.isNaN(adelanto) || adelanto < 0) return 'El adelanto no es válido.'
    if (adelantoSuperaTotal(formulario.adelanto, totalServiciosCita(lineas))) {
      return 'El adelanto no puede ser mayor al total de los servicios.'
    }
  }

  return null
}

// `plantilla`: cita de la que se copian clienta, asistente y servicios para agendar una NUEVA cita (no es edición).
export default function ModalCita({ cita, plantilla = null, fechaSugerida, onCerrar, onGuardado }) {
  const idBase = useId()
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const { usuario } = useAuth()
  const navigate = useNavigate()
  // QA-001: la RLS de servicios solo deja insertar al ADMINISTRADOR; no se
  // ofrece una acción que el servidor va a rechazar.
  const puedeCrearServicio = usuario.rol === 'ADMINISTRADOR'
  // Igual con los clientes: la RLS de clientes solo deja INSERTAR a la ADMINISTRADORA (clientes_insert_admin). A asistente,
  // encargada y cajera no se les ofrece «Registrar como cliente nuevo» (fallaba al guardar); pueden elegir una clienta ya
  // registrada o usar un nombre de referencia sin guardar.
  const puedeCrearCliente = usuario.rol === 'ADMINISTRADOR'
  // Solo la administradora asigna comisiones: desde el aviso «Sin comisión» del carrito va a la pestaña Comisiones, que abre
  // ese servicio y destraba el campo del % de esta asistente. El modal sigue abierto (la pantalla de Citas queda montada y
  // oculta, con la cita a medias intacta); al volver, el aviso se apaga solo si el % ya se asignó.
  const puedeAsignarComision = usuario.rol === 'ADMINISTRADOR'
  const esEdicion = Boolean(cita)

  const [categoriasExistentes, setCategoriasExistentes] = useState([])
  const [asistentes, setAsistentes] = useState([])
  const [cargandoListas, setCargandoListas] = useState(true)

  const [formulario, setFormulario] = useState(() =>
    esEdicion
      ? formularioDesdeCita(cita)
      : plantilla
        ? formularioDesdePlantilla(plantilla)
        : formularioVacio(horaSugeridaCita(fechaSugerida ?? new Date(), null)),
  )
  const [lineas, setLineas] = useState(() =>
    esEdicion
      ? lineasDesdeCita(cita)
      : plantilla
        ? lineasDesdeCita(plantilla).map((linea) => ({ ...linea, id: `copia-${linea.id}` }))
        : [],
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  // Igual que el carrito de Ventas/Mis atenciones: en táctil se elimina
  // deslizando la fila, en mouse/trackpad se conserva el botón ✕.
  const [esTactil] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  )

  // Buscadores de cliente/servicio — mismo patrón que el carrito de
  // atenciones de Mis atenciones: precargan todo al enfocar, ícono que se
  // convierte en "✕" en cuanto hay texto, y blur manual al elegir para que
  // no se quede el borde de foco encendido con la lista ya cerrada.
  const base = cita ?? plantilla
  const [busquedaCliente, setBusquedaCliente] = useState(() =>
    base ? (base.clientes?.nombre ?? base.cliente_nombre_referencia ?? '') : '',
  )
  // Cliente "de referencia" (sin guardar en Clientes) — mutuamente
  // excluyente con formulario.clienteId: escribir de nuevo en el buscador
  // o elegir un cliente real limpia esto.
  const [clienteReferencia, setClienteReferencia] = useState(() =>
    base && !base.cliente_id ? (base.cliente_nombre_referencia ?? '') : '',
  )
  // Quien no puede registrar clientas y agenda con un nombre de referencia: se le recomienda pedir nombre completo y celular
  // y anotarlos en la Nota, para que la administradora cree la ficha (la cita muestra «Sin cliente» hasta entonces).
  const pideDatosClienta = !puedeCrearCliente && !formulario.clienteId && Boolean(clienteReferencia.trim())
  // Avisos que no bloquean el guardado: la clienta ya faltó a citas anteriores / la cita cae fuera del horario de atención.
  const inasistencias = useInasistenciasClienta(formulario.clienteId || null, esEdicion ? cita.id : null)
  const semanaAtencion = useHorarioAtencionSemana()
  const citasAsistenteDia = useCitasDeAsistenteEnElDia(
    formulario.asistenteId || null,
    formulario.fechaHora.split('T')[0],
    esEdicion ? cita.id : null,
  )
  const fechaElegidaRef = useRef(false)
  const [mostrarSugerenciasCliente, setMostrarSugerenciasCliente] = useState(false)
  const [busquedaServicio, setBusquedaServicio] = useState('')
  const [mostrarSugerenciasServicio, setMostrarSugerenciasServicio] = useState(false)
  const inputClienteRef = useRef(null)
  const inputServicioRef = useRef(null)

  // Alto objetivo del carrito = lo que mide la lista, con un mínimo de 1 servicio. Se mide con ResizeObserver: también
  // cambia sola si una fila crece (aviso «Sin comisión») o se quita una. Se mide ANTES de pintar, así abrir «Editar cita» con
  // 3 servicios ya aparece expandido, sin animación de entrada.
  const listaCarritoRef = useRef(null)
  const [altoCarrito, setAltoCarrito] = useState(ALTO_MIN_CARRITO)
  useLayoutEffect(() => {
    const lista = listaCarritoRef.current
    if (!lista) return undefined
    const medir = () => setAltoCarrito(Math.max(ALTO_MIN_CARRITO, lista.offsetHeight))
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(lista)
    return () => observador.disconnect()
  }, [cargandoListas])

  const [modalClienteNuevoAbierto, setModalClienteNuevoAbierto] = useState(false)
  const [modalServicioNuevoAbierto, setModalServicioNuevoAbierto] = useState(false)

  // Línea recién agregada: destello verde de 450 ms (mismo feedback que el carrito de Ventas).
  const [lineaFlash, setLineaFlash] = useState(null)
  useEffect(() => {
    if (!lineaFlash) return undefined
    const temporizador = setTimeout(() => setLineaFlash(null), 450)
    return () => clearTimeout(temporizador)
  }, [lineaFlash])

  // Servicios con % de comisión para la asistente elegida (null = nada que validar). Cualquier servicio se puede agendar,
  // pero se avisa desde ya de los que no tienen % para que la administradora lo resuelva antes de completar la cita.
  const serviciosConComision = useServiciosConComision(formulario.asistenteId)
  const sinComision = (servicioId) => serviciosConComision != null && !serviciosConComision.has(servicioId)

  useEffect(() => {
    async function cargarListas() {
      // Los clientes y los servicios NO se descargan: se buscan en el servidor al escribir (QA-043/QA-046).
      const [categorias, resAsistentes] = await Promise.all([
        categoriasDeServicios(supabase).catch(() => []),
        // RPC en vez de leer la tabla directo: ya excluye a quien esté
        // vinculado a una cuenta CAJERA (no atiende), cosa que un no-admin
        // no podría filtrar por su cuenta (la RLS de usuarios no le deja
        // ver el rol de otras cuentas).
        supabase.rpc('asistentes_para_citas'),
      ])
      setCategoriasExistentes(categorias)
      setAsistentes(resAsistentes.data ?? [])
      setCargandoListas(false)
    }
    cargarListas()
  }, [])

  // Cajera y asistente pueden agendarle una cita a cualquier profesional
  // (elegible desde el selector), pero si quien agenda tiene su propia
  // ficha se la proponemos de entrada — solo una precarga cómoda, no un
  // bloqueo: se puede cambiar antes de guardar.
  const miFicha = asistentes.find((a) => a.usuario_id === usuario.id) ?? null
  useEffect(() => {
    if (esEdicion || !miFicha) return
    setFormulario((anterior) =>
      anterior.asistenteId ? anterior : { ...anterior, asistenteId: miFicha.id },
    )
    // La precarga no es un cambio del usuario: no debe disparar el aviso de descartar.
    if (!valoresBase.current.asistenteId) valoresBase.current = { ...valoresBase.current, asistenteId: miFicha.id }
  }, [esEdicion, miFicha])

  const busquedaClientes = useBusquedaClientes({ termino: busquedaCliente, activo: mostrarSugerenciasCliente })
  const sugerenciasCliente = busquedaClientes.resultados
  // Hay una ficha idéntica al texto escrito: no se ofrece crear otra (QA-043).
  const hayCoincidenciaExacta = sugerenciasCliente.some(
    (c) => c.nombre.trim().toLowerCase() === busquedaCliente.trim().toLowerCase(),
  )
  const estadoClienteRef = useRef({ texto: '', clienteId: '', referencia: '', coincidencia: null })
  estadoClienteRef.current = {
    texto: busquedaCliente,
    clienteId: formulario.clienteId,
    referencia: clienteReferencia,
    coincidencia: sugerenciasCliente.find(
      (c) => c.nombre.trim().toLowerCase() === busquedaCliente.trim().toLowerCase(),
    ) ?? null,
  }
  const busquedaServicios = useBusquedaServicios({ termino: busquedaServicio, activo: mostrarSugerenciasServicio })
  const sugerenciasServicio = busquedaServicios.resultados
  // Una ficha idéntica al texto escrito: no se ofrece crear otra (QA-046).
  const hayServicioExacto = sugerenciasServicio.some(
    (s) => s.nombre.trim().toLowerCase() === busquedaServicio.trim().toLowerCase(),
  )
  function irAAsignarComision(linea) {
    navigate('/porcentajes', {
      state: {
        asignarPorcentaje: {
          servicioId: linea.servicioId,
          servicioNombre: linea.nombre,
          asistenteId: formulario.asistenteId,
          token: Date.now(),
        },
      },
    })
  }

  function actualizarCampo(campo, valor) {
    if (campo === 'fechaHora') fechaElegidaRef.current = true
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }))
  }

  // Cita nueva: la hora por defecto es la APERTURA del día elegido en el calendario. Al abrir el modal se propone 9:00 a. m. (o la
  // próxima media hora si hoy ya pasó la apertura) y, cuando llega el horario de atención, se corrige a la apertura real de ese
  // día, siempre que la persona no haya elegido ya una fecha. No cuenta como cambio del usuario (aviso de descartar).
  useEffect(() => {
    if (esEdicion || plantilla || !semanaAtencion || fechaElegidaRef.current) return
    const fechaHora = aInputDatetimeLima(horaSugeridaCita(fechaSugerida ?? new Date(), semanaAtencion))
    setFormulario((anterior) => (anterior.fechaHora === fechaHora ? anterior : { ...anterior, fechaHora }))
    valoresBase.current = { ...valoresBase.current, fechaHora }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semanaAtencion])

  function seleccionarCliente(cliente) {
    actualizarCampo('clienteId', cliente.id)
    setClienteReferencia('')
    setBusquedaCliente(cliente.nombre)
    setMostrarSugerenciasCliente(false)
    inputClienteRef.current?.blur()
  }

  // Al salir del campo con un nombre escrito que no se eligió de la lista (clic fuera, Tab…), se toma como cliente de referencia,
  // igual que «Usar "…" (referencia, sin guardar)». Antes quedaba el texto sin cliente asignado: no salía el aviso de «no
  // registrada» y «Agendar» seguía apagado sin explicación. Si el texto coincide con una clienta registrada, se elige esa.
  // Se lee de la ref (valores al momento de disparar), no del cierre del blur: en esos 150 ms se pudo elegir de la lista o limpiar.
  function confirmarClienteEscrito() {
    const { texto, clienteId, referencia, coincidencia } = estadoClienteRef.current
    const nombre = texto.trim()
    if (!nombre || clienteId || referencia.trim()) return
    if (coincidencia) {
      seleccionarCliente(coincidencia)
      return
    }
    actualizarCampo('clienteId', '')
    setClienteReferencia(nombre)
  }

  function usarClienteReferencia() {
    actualizarCampo('clienteId', '')
    setClienteReferencia(busquedaCliente.trim())
    setMostrarSugerenciasCliente(false)
    inputClienteRef.current?.blur()
  }

  function manejarClienteCreado(clienteCreado) {
    setModalClienteNuevoAbierto(false)
    if (!clienteCreado) return
    seleccionarCliente(clienteCreado)
  }

  function agregarLineaServicio(servicio) {
    if (!servicio) return
    const servicioId = servicio.id
    const idLinea = `${servicioId}-${Date.now()}`
    setLineaFlash(idLinea)
    // El servicio recién agregado va ARRIBA de la lista (el carrito se expande hacia abajo y lo nuevo queda a la vista).
    setLineas((anterior) => [
      {
        id: idLinea,
        servicioId,
        nombre: servicio.nombre,
        duracionMin: servicio.duracion_min ? String(servicio.duracion_min) : '30',
        precio: servicio.precio != null ? String(servicio.precio) : '',
      },
      ...anterior,
    ])
    setBusquedaServicio('')
    setMostrarSugerenciasServicio(false)
    inputServicioRef.current?.blur()
  }

  function manejarServicioCreado(servicioCreado) {
    setModalServicioNuevoAbierto(false)
    if (!servicioCreado) return
    if (servicioCreado.categoria) {
      setCategoriasExistentes((anterior) =>
        anterior.includes(servicioCreado.categoria) ? anterior : [...anterior, servicioCreado.categoria].sort(),
      )
    }
    agregarLineaServicio(servicioCreado)
  }

  function quitarLinea(id) {
    setLineas((anterior) => anterior.filter((linea) => linea.id !== id))
  }

  function actualizarDuracionLinea(id, duracionMin) {
    setLineas((anterior) =>
      anterior.map((linea) => (linea.id === id ? { ...linea, duracionMin } : linea)),
    )
  }

  function actualizarPrecioLinea(id, precio) {
    setLineas((anterior) =>
      anterior.map((linea) => (linea.id === id ? { ...linea, precio } : linea)),
    )
  }

  async function guardar(evento) {
    evento.preventDefault()

    const mensajeError = validar(formulario, lineas, puedeElegirAsistente, clienteReferencia)
    if (mensajeError) {
      setError(mensajeError)
      return
    }

    setGuardando(true)
    setError(null)

    // Un solo RPC atómico (guardar_cita_pos, 20261002000001_guardar_cita_pos.sql):
    // antes esto eran 2-3 llamadas HTTP separadas (UPDATE/INSERT citas, DELETE
    // + INSERT cita_servicios) — una recarga o corte de red entre el DELETE y
    // el INSERT podía dejar la cita persistida sin ningún servicio (QA-004).
    const { error: errorRpc } = await supabase.rpc('guardar_cita_pos', {
      p_cita_id: esEdicion ? cita.id : null,
      p_cliente_id: formulario.clienteId || null,
      p_cliente_nombre_referencia: formulario.clienteId ? null : clienteReferencia.trim() || null,
      p_asistente_id: formulario.asistenteId || null,
      p_fecha_hora: deInputDatetimeLima(formulario.fechaHora).toISOString(),
      p_nota: formulario.nota.trim() || null,
      p_adelanto: formulario.adelanto.trim() ? parseFloat(formulario.adelanto) : null,
      p_servicios: lineas.map((linea) => ({
        servicio_id: linea.servicioId,
        duracion_min: parseInt(linea.duracionMin, 10),
        precio: parseFloat(linea.precio),
      })),
    })

    setGuardando(false)

    if (errorRpc) {
      setError(
        errorRpc.message === MENSAJE_NEGOCIO_CERRADO
          ? MENSAJE_NEGOCIO_CERRADO
          : 'No se pudo guardar la cita. Intenta de nuevo.',
      )
      return
    }

    onGuardado()
  }

  // Colores de «llenado» (como «Registrar atención») y tope del adelanto: no puede pasar de la suma de los precios del carrito.
  const clienteLleno = Boolean(formulario.clienteId || clienteReferencia.trim())
  const totalServicios = totalServiciosCita(lineas)
  const adelantoLleno = formulario.adelanto.trim() !== ''
  const adelantoExcedido = adelantoSuperaTotal(formulario.adelanto, totalServicios)

  const duracionTotalMin = lineas.reduce((total, linea) => total + (parseInt(linea.duracionMin, 10) || 0), 0)
  const avisoHorario = avisoHorarioCita({ fechaHora: formulario.fechaHora, duracionTotalMin, semana: semanaAtencion })
  // Choque: la asistente elegida ya tiene otra cita pendiente que se cruza con esta hora y duración. Solo avisa (no bloquea).
  const avisoChoque = textoChoques(
    asistentes.find((a) => a.id === formulario.asistenteId)?.nombres_completos,
    citasQueChocan({ fechaHora: formulario.fechaHora, duracionTotalMin, citas: citasAsistenteDia }),
  )

  // Antes solo el admin podía elegir/reasignar el selector completo de
  // asistentes; ahora cajera y asistente también pueden reasignar
  // cualquier cita, así que los 3 roles ven el mismo selector.
  const puedeElegirAsistente = true

  // X, «Cancelar» y Esc: con cambios sin guardar se pregunta antes de cerrar y se dice qué se perdería.
  const valoresFormulario = {
    cliente: busquedaCliente,
    asistenteId: formulario.asistenteId,
    fechaHora: formulario.fechaHora,
    servicios: lineas,
    adelanto: formulario.adelanto,
    nota: formulario.nota,
  }
  const valoresBase = useRef(valoresFormulario)
  const cambios = listarCambios(
    valoresBase.current,
    valoresFormulario,
    { cliente: 'Cliente', asistenteId: 'Asistente', fechaHora: 'Fecha y hora', servicios: 'Servicios', adelanto: 'Adelanto', nota: 'Nota' },
    { sinValor: ['asistenteId'] },
  )
  const { intentarCerrar, aviso } = useAvisoDescarte({ cambios, onCerrar, bloqueado: guardando })

  return (
    <div
      className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4"
      style={{ '--color-foco': 'var(--color-purple-300)' }}
    >
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        className="max-h-full w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">
            {esEdicion ? 'Editar cita' : 'Nueva cita'}
          </h2>
          <BotonCerrarModal onClick={intentarCerrar} disabled={guardando} />
        </div>

        {cargandoListas ? (
          <p className="mt-4 text-center font-mono text-sm text-ink/60">Cargando...</p>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-cliente`}>Cliente</Etiqueta>
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <input
                    ref={inputClienteRef}
                    id={`${idBase}-cliente`}
                    type="search"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                    value={busquedaCliente}
                    onChange={(evento) => {
                      setBusquedaCliente(evento.target.value)
                      actualizarCampo('clienteId', '')
                      setClienteReferencia('')
                      setMostrarSugerenciasCliente(true)
                    }}
                    onFocus={() => setMostrarSugerenciasCliente(true)}
                    onBlur={() =>
                      setTimeout(() => {
                        setMostrarSugerenciasCliente(false)
                        confirmarClienteEscrito()
                      }, 150)
                    }
                    placeholder="Buscar cliente..."
                    // Cliente elegido (o nombre de referencia): borde, fondo y nombre en rosa, igual que «Registrar atención».
                    className={`w-full rounded-lg border py-2 pl-3 pr-9 text-sm outline-none transition-colors focus:border-purple-300 ${
                      clienteLleno ? 'border-purple-300 bg-purple-300/10 text-purple-300' : 'border-border bg-surface-2 text-ink'
                    }`}
                  />
                  {busquedaCliente ? (
                    <button
                      type="button"
                      onClick={() => {
                        setBusquedaCliente('')
                        actualizarCampo('clienteId', '')
                        setClienteReferencia('')
                      }}
                      aria-label="Limpiar búsqueda"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/60 transition-colors hover:text-ink"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : (
                    <User className={`pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 ${clienteLleno ? 'text-purple-300' : 'text-ink/40'}`} />
                  )}
  
                  {mostrarSugerenciasCliente && (
                    <div className="animate-entrada-dropdown absolute left-0 right-0 top-full z-10 mt-1 max-h-[80vh] overflow-y-auto rounded-lg border border-border bg-surface-2 shadow-lg">
                      {busquedaClientes.buscando && (
                        <p role="status" className="px-3 py-2 text-xs text-ink/60">
                          Buscando clientes…
                        </p>
                      )}
                      {busquedaClientes.error && (
                        <p role="alert" className="px-3 py-2 text-xs text-red">
                          No se pudo buscar clientes.{' '}
                          <button
                            type="button"
                            onMouseDown={(evento) => evento.preventDefault()}
                            onClick={busquedaClientes.reintentar}
                            className="underline"
                          >
                            Reintentar
                          </button>
                        </p>
                      )}
                      {busquedaClientes.listo && sugerenciasCliente.length === 0 && !busquedaCliente.trim() && (
                        <p className="px-3 py-2 text-xs text-ink/60">Escribe para buscar un cliente.</p>
                      )}
                      {busquedaClientes.listo && sugerenciasCliente.map((cliente) => (
                        <button
                          key={cliente.id}
                          type="button"
                          onMouseDown={(evento) => evento.preventDefault()}
                          onClick={() => seleccionarCliente(cliente)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-3"
                        >
                          <span className="truncate">{cliente.nombre}</span>
                        </button>
                      ))}
                      {busquedaClientes.listo && busquedaCliente.trim() && !hayCoincidenciaExacta && (
                        <>
                          <button
                            type="button"
                            onMouseDown={(evento) => evento.preventDefault()}
                            onClick={usarClienteReferencia}
                            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink/70 transition-colors hover:bg-surface-3 ${
                              sugerenciasCliente.length > 0 ? 'border-t border-border' : ''
                            }`}
                          >
                            <UserPlus className="h-4 w-4 shrink-0" />
                            <span className="truncate">
                              Usar "{busquedaCliente.trim()}" (referencia, sin guardar)
                            </span>
                          </button>
                          {puedeCrearCliente && (
                            <button
                              type="button"
                              onMouseDown={(evento) => evento.preventDefault()}
                              onClick={() => {
                                setMostrarSugerenciasCliente(false)
                                setModalClienteNuevoAbierto(true)
                              }}
                              className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-purple-300 transition-colors hover:bg-surface-3"
                            >
                              <UserRoundPlus className="h-4 w-4 shrink-0" />
                              <span className="truncate">
                                Registrar "{busquedaCliente.trim()}" como cliente nuevo
                              </span>
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {puedeCrearCliente && !formulario.clienteId && clienteReferencia.trim() && (
                <div className="mt-1 text-[11px] text-orange-400">
                  <p>
                    Cliente no registrado. Regístrala desde el campo Cliente.
                    {formulario.nota.trim() && ' Mira la Nota: quizá trae sus datos.'}
                  </p>
                  {formulario.nota.trim() && (
                    <p className="mt-0.5 line-clamp-2 text-ink/60">Nota: {formulario.nota.trim()}</p>
                  )}
                </div>
              )}
              {textoInasistencias(inasistencias, { conAdelanto: Number(formulario.adelanto) > 0 }) && (
                <p className="mt-1 text-[11px] text-orange-400">
                  {textoInasistencias(inasistencias, { conAdelanto: Number(formulario.adelanto) > 0 })}
                </p>
              )}
              {pideDatosClienta && (
                <p className="mt-1 text-[11px] text-orange-400">
                  «{clienteReferencia}» no está registrada y tú no puedes registrarla. Pídele su nombre completo y su celular
                  y anótalos en la Nota, para que la administradora la registre.
                </p>
              )}
            </div>

            <div>
              <Etiqueta htmlFor={`${idBase}-agregar-servicio`}>Agregar servicio</Etiqueta>
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <input
                    ref={inputServicioRef}
                    id={`${idBase}-agregar-servicio`}
                    type="search"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                    value={busquedaServicio}
                    onChange={(evento) => {
                      setBusquedaServicio(evento.target.value)
                      setMostrarSugerenciasServicio(true)
                    }}
                    onFocus={() => setMostrarSugerenciasServicio(true)}
                    onBlur={() => setTimeout(() => setMostrarSugerenciasServicio(false), 150)}
                    placeholder="Buscar servicio..."
                    // Con al menos un servicio agregado: borde y fondo celestes, igual que «Registrar atención».
                    className={`w-full rounded-lg border py-2 pl-3 pr-9 text-sm outline-none transition-colors focus:border-purple-300 ${
                      lineas.length > 0 ? 'border-blue bg-blue/10 text-blue' : 'border-border bg-surface-2 text-ink'
                    }`}
                  />
                  {busquedaServicio ? (
                    <button
                      type="button"
                      onClick={() => setBusquedaServicio('')}
                      aria-label="Limpiar búsqueda"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/60 transition-colors hover:text-ink"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : (
                    <Scissors className={`pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 ${lineas.length > 0 ? 'text-blue' : 'text-ink/40'}`} />
                  )}
  
                  {mostrarSugerenciasServicio &&
                    (sugerenciasServicio.length > 0 || busquedaServicio.trim() || busquedaServicios.error) && (
                      <div className="animate-entrada-dropdown absolute left-0 right-0 top-full z-10 mt-1 max-h-[80vh] overflow-y-auto rounded-lg border border-border bg-surface-2 shadow-lg">
                        {sugerenciasServicio.map((servicio) => (
                          <button
                            key={servicio.id}
                            type="button"
                            onMouseDown={(evento) => evento.preventDefault()}
                            onClick={() => agregarLineaServicio(servicio)}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-3"
                          >
                            <span className="truncate">{servicio.nombre}</span>
                            <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-ink/60">
                              {servicio.duracion_min && <span>{servicio.duracion_min} min</span>}
                              {servicio.precio != null && <span>{Number(servicio.precio).toFixed(2)}</span>}
                              {/* Check verde = este servicio ya tiene % de comisión para la asistente elegida. Sin check, se
                                  puede agregar igual: el carrito avisa que no tiene comisión. */}
                              {serviciosConComision?.has(servicio.id) && (
                                <Check
                                  className="h-3.5 w-3.5 text-green"
                                  strokeWidth={3}
                                  role="img"
                                  aria-label="Tiene porcentaje asignado"
                                />
                              )}
                            </span>
                          </button>
                        ))}
                        {sugerenciasServicio.length >= LIMITE_SERVICIOS && (
                          <p className="border-t border-border px-3 py-2 text-xs text-ink/60">
                            Se muestran los primeros {LIMITE_SERVICIOS}. Escribe para afinar la búsqueda.
                          </p>
                        )}
                        {busquedaServicios.buscando && (
                          <p className="px-3 py-2 text-sm text-ink/60">Buscando...</p>
                        )}
                        {busquedaServicios.error && (
                          <p className="px-3 py-2 text-sm text-red">
                            No se pudo buscar servicios.{' '}
                            <button
                              type="button"
                              onMouseDown={(evento) => evento.preventDefault()}
                              onClick={busquedaServicios.reintentar}
                              className="underline"
                            >
                              Reintentar
                            </button>
                          </p>
                        )}
                        {busquedaServicio.trim() && busquedaServicios.listo && !puedeCrearServicio && sugerenciasServicio.length === 0 && (
                          <p className="px-3 py-2 text-sm text-ink/60">No hay servicios que coincidan.</p>
                        )}
                        {busquedaServicio.trim() && busquedaServicios.listo && !hayServicioExacto && puedeCrearServicio && (
                          <button
                            type="button"
                            onMouseDown={(evento) => evento.preventDefault()}
                            onClick={() => {
                              setMostrarSugerenciasServicio(false)
                              setModalServicioNuevoAbierto(true)
                            }}
                            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-purple-300 transition-colors hover:bg-surface-3 ${
                              sugerenciasServicio.length > 0 ? 'border-t border-border' : ''
                            }`}
                          >
                            <PlusCircle className="h-4 w-4 shrink-0" />
                            <span className="truncate">
                              Crear servicio "{busquedaServicio.trim()}"
                            </span>
                          </button>
                        )}
                      </div>
                    )}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-bg">
              <div
                className={`${COLUMNAS_CARRITO(esTactil)} grid gap-2 border-b border-border px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-ink/60`}
              >
                <span>Servicio</span>
                <span className="text-right">Precio</span>
                {!esTactil && <span />}
              </div>
              {/* Alto animado: por defecto hay espacio para 1 servicio; con cada uno más se expande hacia abajo con suavidad
                  (sin scroll: todos se ven completos) y al quitarlo vuelve a cerrarse igual. */}
              <div
                style={{ height: altoCarrito }}
                className="overflow-hidden transition-[height] duration-300 ease-out motion-reduce:transition-none"
              >
                <div ref={listaCarritoRef} className="divide-y divide-border">
                  {lineas.length === 0 ? (
                    <div className="flex items-center justify-center" style={{ height: ALTO_MIN_CARRITO }}>
                      <p className="text-sm text-ink/40">Sin servicios</p>
                    </div>
                  ) : (
                    lineas.map((linea) => (
                      <FilaLineaCita
                        key={linea.id}
                        linea={linea}
                        esTactil={esTactil}
                        sinComision={sinComision(linea.servicioId)}
                        onAsignarComision={puedeAsignarComision ? () => irAAsignarComision(linea) : undefined}
                        resaltada={linea.id === lineaFlash}
                        onCambiarPrecio={(precio) => actualizarPrecioLinea(linea.id, precio)}
                        onCambiarDuracion={(duracionMin) => actualizarDuracionLinea(linea.id, duracionMin)}
                        onQuitar={() => quitarLinea(linea.id)}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>

            <div>
              <div className={FILA_CAMPO}>
                <Etiqueta obligatorio={!puedeElegirAsistente} htmlFor={`${idBase}-asistente`} className="block">
                  Asistente
                </Etiqueta>
                {puedeElegirAsistente ? (
                  <SelectorDesplegable
                    id={`${idBase}-asistente`}
                    valor={formulario.asistenteId}
                    onCambiar={(valor) => actualizarCampo('asistenteId', valor)}
                    opciones={[
                      { valor: '', label: 'Asistente pendiente' },
                      ...asistentes.map((asistente) => ({ valor: asistente.id, label: asistente.nombres_completos })),
                    ]}
                  />
                ) : (
                  <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink/70">
                    {miFicha?.nombres_completos ?? 'Sin ficha de asistente vinculada'}
                  </p>
                )}
              </div>
              {puedeElegirAsistente && !formulario.asistenteId && (
                <p className={`mt-1 text-[11px] text-orange-400 ${SANGRIA_MENSAJE}`}>
                  Sin asistente todavía no se puede completar la cita — comunícate con el
                  administrador para asignar una.
                </p>
              )}
            </div>

            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-fecha`}>Fecha y hora</Etiqueta>
              <InputFechaHora
                id={`${idBase}-fecha`}
                bloquearDiasPasados
                resaltado={Boolean(formulario.fechaHora)}
                value={formulario.fechaHora}
                onChange={(evento) => actualizarCampo('fechaHora', evento.target.value)}
              />
              {avisoHorario && <p className="mt-1 text-[11px] text-orange-400">{avisoHorario}</p>}
              {avisoChoque && <p className="mt-1 text-[11px] text-orange-400">{avisoChoque}</p>}
            </div>

            <div>
            <div className={FILA_CAMPO}>
              <div className="flex items-center gap-1">
                <Etiqueta htmlFor={`${idBase}-adelanto`} className="block">Adelanto o abono</Etiqueta>
                <AyudaCampo etiqueta="Ayuda sobre el adelanto">
                  Al cobrar la atención de esta cita en Ventas, el adelanto se descuenta solo (en soles); el precio del
                  servicio no cambia. No hace falta acordarse de él.
                </AyudaCampo>
              </div>
              {/* Con monto escrito: borde, fondo y texto en verde (rojo si pasa del total de los servicios). */}
              <div
                className={`flex items-center gap-1 rounded-lg border px-3 py-2 transition-colors ${
                  adelantoExcedido
                    ? 'border-red bg-red/10'
                    : adelantoLleno
                      ? 'border-green bg-green/10 focus-within:border-purple-300'
                      : 'border-border bg-surface-2 focus-within:border-purple-300'
                }`}
              >
                <span className={`text-sm ${adelantoExcedido ? 'text-red' : adelantoLleno ? 'text-green' : 'text-ink/50'}`}>S/</span>
                <input
                  id={`${idBase}-adelanto`}
                  type="search"
                  inputMode="decimal"
                  {...SIN_SUGERENCIAS}
                  value={formulario.adelanto}
                  onChange={(evento) => actualizarCampo('adelanto', evento.target.value)}
                  aria-invalid={adelantoExcedido}
                  placeholder="Opcional"
                  className={`w-full bg-transparent text-sm outline-none placeholder:text-ink/60 ${
                    adelantoExcedido ? 'text-red' : adelantoLleno ? 'text-green' : 'text-ink'
                  }`}
                />
              </div>
            </div>
            {/* Fuera de la grilla de 2 columnas (si no, se encajonaba bajo la etiqueta) y corto, para que entre en una línea
                también en el celular. */}
            {adelantoExcedido && (
              <p role="alert" className="mt-1 text-[11px] text-red">
                {lineas.length === 0
                  ? 'Primero agrega los servicios.'
                  : `El adelanto no puede superar ${formatearSoles(totalServicios)}.`}
              </p>
            )}
            </div>

            <div>
              <Etiqueta htmlFor={`${idBase}-nota`}>Nota</Etiqueta>
              <textarea
                id={`${idBase}-nota`}
                autoComplete="off"
                value={formulario.nota}
                onChange={(evento) => actualizarCampo('nota', evento.target.value)}
                placeholder={pideDatosClienta ? 'Nombre completo y celular de la clienta' : 'Opcional'}
                rows={3}
                className="w-full resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink/60 focus:border-purple-300"
              />
            </div>
          </div>
        )}

        {error && (
          <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
            {error}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={intentarCerrar}
            disabled={guardando}
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={
              guardando ||
              cargandoListas ||
              lineas.length === 0 ||
              (!formulario.clienteId && !clienteReferencia.trim())
            }
            className="flex-1 rounded-lg bg-purple-300 py-2 text-sm font-semibold text-bg disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Agendar'}
          </button>
        </div>
      </form>

      {modalClienteNuevoAbierto && (
        <ModalCliente
          nombreInicial={busquedaCliente.trim()}
          onCerrar={() => setModalClienteNuevoAbierto(false)}
          onGuardado={manejarClienteCreado}
        />
      )}

      {modalServicioNuevoAbierto && (
        <ModalServicio
          nombreInicial={busquedaServicio.trim()}
          categoriasExistentes={categoriasExistentes}
          onCerrar={() => setModalServicioNuevoAbierto(false)}
          onGuardado={manejarServicioCreado}
        />
      )}
      {aviso}
    </div>
  )
}
