import { useEffect, useId, useRef, useState } from 'react'
import { X, User, Scissors, UserRoundPlus, PlusCircle } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { aInputDatetimeLima, deInputDatetimeLima } from '../lib/fechas.js'
import { MENSAJE_NEGOCIO_CERRADO } from '../lib/estadoNegocio.js'
import Etiqueta from './Etiqueta.jsx'
import ModalCliente from './ModalCliente.jsx'
import ModalServicio from './ModalServicio.jsx'

// Umbrales del swipe-to-delete del carrito de servicios — mismos valores que
// el carrito de Ventas (FilaTicket), para que el gesto se sienta idéntico.
const UMBRAL_ARRASTRE_ELIMINAR = 90
const UMBRAL_ARRASTRE_INICIO = 8

function FilaLineaServicio({
  linea,
  nombre,
  porcentaje,
  esTactil,
  permitirQuitar = true,
  estricto = false,
  onCambiarPrecio,
  onQuitar,
}) {
  const [arrastreX, setArrastreX] = useState(0)
  const [arrastrando, setArrastrando] = useState(false)
  const inicioRef = useRef({ x: 0, iniciado: false, ignorar: false })
  const puedeArrastrar = esTactil && permitirQuitar

  function manejarPointerDown(evento) {
    if (!puedeArrastrar) return
    const ignorar = Boolean(evento.target.closest('button, input'))
    inicioRef.current = { x: evento.clientX, iniciado: false, ignorar }
    if (!ignorar) evento.currentTarget.setPointerCapture?.(evento.pointerId)
  }

  function manejarPointerMove(evento) {
    if (!puedeArrastrar || inicioRef.current.ignorar || evento.buttons === 0) return
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
  const precioLineaNumero = parseFloat(linea.precio)
  const pagoLinea =
    porcentaje != null && !Number.isNaN(precioLineaNumero)
      ? (precioLineaNumero * porcentaje) / 100
      : null

  return (
    <div
      onPointerDown={manejarPointerDown}
      onPointerMove={manejarPointerMove}
      onPointerUp={soltar}
      onPointerCancel={soltar}
      style={{
        transform: arrastreX ? `translateX(${arrastreX}px)` : undefined,
        backgroundColor: `color-mix(in srgb, var(--color-red) ${Math.round(progresoEliminar * 85)}%, transparent)`,
        transition: arrastrando ? 'none' : undefined,
      }}
      className={`${permitirQuitar && !esTactil ? 'grid-cols-[1fr_6.5rem_1.5rem]' : 'grid-cols-[1fr_6.5rem]'} touch-pan-y grid items-center gap-2 px-3 py-2 transition-[transform_200ms_ease-in,background-color_150ms_ease-out]`}
    >
      <div className="min-w-0">
        <p className="truncate text-sm text-ink">{nombre}</p>
        {porcentaje == null ? (
          <p className={`text-[11px] ${estricto ? 'text-red' : 'text-orange-400'}`}>
            {estricto
              ? 'Sin % asignado — no se puede completar. Comunícate con el administrador.'
              : 'Sin % asignado'}
          </p>
        ) : (
          !Number.isNaN(precioLineaNumero) && (
            <p className="font-mono text-[11px] text-ink/50">
              {precioLineaNumero} × {porcentaje}% = {pagoLinea.toFixed(2)}
            </p>
          )
        )}
      </div>

      <input
        type="search"
        inputMode="decimal"
        autoComplete="new-password"
        value={linea.precio}
        onChange={(evento) => onCambiarPrecio(evento.target.value)}
        className="w-[8ch] justify-self-end rounded-lg border border-border bg-surface px-2 py-1 text-right font-mono text-sm text-ink outline-none focus:border-purple-300"
      />

      {!esTactil && permitirQuitar && (
        <button
          type="button"
          onClick={onQuitar}
          aria-label="Quitar servicio"
          className="text-ink/30 transition-colors hover:text-red"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

function formularioVacio() {
  return {
    servicioId: '',
    clienteId: '',
    precio: '',
    fecha: aInputDatetimeLima(new Date()),
    nota: '',
  }
}

function formularioDesdeRegistro(registro) {
  return {
    servicioId: registro.servicio_id ?? '',
    clienteId: registro.cliente_id ?? '',
    precio: String(registro.precio ?? ''),
    fecha: aInputDatetimeLima(new Date(registro.fecha)),
    nota: registro.nota ?? '',
  }
}

function validar(formulario) {
  if (!formulario.servicioId) return 'Selecciona un servicio.'
  if (!formulario.clienteId) return 'Selecciona un cliente.'

  const precio = parseFloat(formulario.precio)
  if (Number.isNaN(precio) || precio < 0) return 'El precio debe ser un número válido.'

  if (!formulario.fecha) return 'Selecciona una fecha y hora.'

  return null
}

export default function ModalRegistroAtencion({
  registro,
  citaId = null,
  serviciosCita = [],
  valoresIniciales,
  onCerrar,
  onGuardado,
}) {
  const idBase = useId()
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const { usuario } = useAuth()
  const esEdicion = Boolean(registro)
  const esCompletarCita = !esEdicion && Boolean(citaId)
  // El carrito de varios servicios aplica tanto al registro nuevo "de cero"
  // (botón/FAB "Registrar atención" en Mi Panel, líneas agregables a mano)
  // como a completar una cita (líneas fijas, las que trae la cita) — editar
  // una atención ya guardada es el único caso que sigue siendo un registro
  // individual con el formulario simple.
  const esMultiple = !esEdicion && !esCompletarCita
  const usaCarrito = esMultiple || esCompletarCita

  // El % de comisión depende de quién es DUEÑO del registro (a nombre de
  // quién queda guardado), no de quién lo está editando. Antes, un admin
  // editando la atención de una asistente pisaba su comisión real con 100%
  // porque el cálculo miraba el rol de quien editaba en vez del dueño.
  const idDueno = esEdicion ? registro.usuario_id : usuario.id

  const [servicios, setServicios] = useState([])
  const [clientes, setClientes] = useState([])
  const [cargandoListas, setCargandoListas] = useState(true)
  // Igual que el carrito de Ventas: en táctil se elimina deslizando la fila,
  // en mouse/trackpad se conserva el botón ✕.
  const [esTactil] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  )

  const [asistenteIdDueno, setAsistenteIdDueno] = useState(null)
  const [esAdminDueno, setEsAdminDueno] = useState(false)
  const [cargandoAsistenteDueno, setCargandoAsistenteDueno] = useState(true)
  const [porcentajeActual, setPorcentajeActual] = useState(null)

  const [formulario, setFormulario] = useState(() =>
    esEdicion ? formularioDesdeRegistro(registro) : formularioVacio(),
  )

  // Estado propio del modo carrito (esMultiple/esCompletarCita): un cliente
  // y una fecha para toda la tanda, y una lista de líneas (servicio +
  // precio) — igual que el carrito de Ventas, pero para atenciones. Al
  // completar una cita, las líneas vienen fijas de serviciosCita (no se
  // agregan/quitan) y cliente/fecha/nota se precargan de valoresIniciales.
  const [clienteIdMultiple, setClienteIdMultiple] = useState(() => valoresIniciales?.clienteId ?? '')
  const [fechaMultiple, setFechaMultiple] = useState(
    () => valoresIniciales?.fecha ?? aInputDatetimeLima(new Date()),
  )
  const [notaMultiple, setNotaMultiple] = useState(() => valoresIniciales?.nota ?? '')
  const [lineas, setLineas] = useState(() =>
    esCompletarCita
      ? serviciosCita.map((s) => ({
          id: s.citaServicioId,
          citaServicioId: s.citaServicioId,
          servicioId: s.servicioId,
          nombre: s.nombre,
          precio: String(s.precioSugerido ?? ''),
        }))
      : [],
  )
  const [mapaPorcentajes, setMapaPorcentajes] = useState({})
  const [busquedaServicio, setBusquedaServicio] = useState('')
  const [mostrarSugerenciasServicio, setMostrarSugerenciasServicio] = useState(false)
  const [busquedaCliente, setBusquedaCliente] = useState(() => valoresIniciales?.clienteNombre ?? '')
  const [mostrarSugerenciasCliente, setMostrarSugerenciasCliente] = useState(false)
  const inputServicioRef = useRef(null)
  const inputClienteRef = useRef(null)
  const [modalClienteNuevoAbierto, setModalClienteNuevoAbierto] = useState(false)
  const [modalServicioNuevoAbierto, setModalServicioNuevoAbierto] = useState(false)

  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  useCerrarConEscape(onCerrar)

  useEffect(() => {
    async function cargarListas() {
      const [resServicios, resClientes] = await Promise.all([
        supabase.from('servicios').select('id, nombre, precio, categoria').order('nombre'),
        supabase.from('clientes').select('id, nombre').order('nombre'),
      ])
      setServicios(resServicios.data ?? [])
      setClientes(resClientes.data ?? [])
      setCargandoListas(false)
    }
    cargarListas()
  }, [])

  // Ficha de asistente y rol del DUEÑO del registro (no de quien edita). Un
  // ADMINISTRADOR se queda siempre con el 100% — ya sea que tenga ficha
  // vinculada (p. ej. para que le puedan asignar/completar citas a su
  // nombre) o no — nunca es una comisión que el negocio le "paga" a
  // alguien más. Si el dueño no es admin y tampoco tiene ficha (no
  // debería pasar hoy, pero por las dudas), también se asume 100%.
  useEffect(() => {
    let vigente = true
    async function cargarAsistenteDueno() {
      setCargandoAsistenteDueno(true)
      const [resFicha, resUsuario] = await Promise.all([
        supabase.from('asistentes').select('id').eq('usuario_id', idDueno).maybeSingle(),
        supabase.from('usuarios').select('rol').eq('id', idDueno).maybeSingle(),
      ])
      if (vigente) {
        setAsistenteIdDueno(resFicha.data?.id ?? null)
        setEsAdminDueno(resUsuario.data?.rol === 'ADMINISTRADOR')
        setCargandoAsistenteDueno(false)
      }
    }
    cargarAsistenteDueno()
    return () => {
      vigente = false
    }
  }, [idDueno])

  useEffect(() => {
    async function cargarPorcentaje() {
      if (!formulario.servicioId || cargandoAsistenteDueno) {
        setPorcentajeActual(null)
        return
      }
      if (esAdminDueno || !asistenteIdDueno) {
        setPorcentajeActual(100)
        return
      }
      const { data } = await supabase
        .from('porcentajes')
        .select('porcentaje')
        .eq('servicio_id', formulario.servicioId)
        .eq('asistente_id', asistenteIdDueno)
        .maybeSingle()
      setPorcentajeActual(data?.porcentaje ?? null)
    }
    cargarPorcentaje()
  }, [formulario.servicioId, asistenteIdDueno, esAdminDueno, cargandoAsistenteDueno])

  // Modo carrito: en vez de pedir el % servicio por servicio (como arriba),
  // se trae de una sola vez toda la tabla de porcentajes del dueño — así
  // agregar una línea nueva no dispara otra ida al servidor.
  useEffect(() => {
    if (!usaCarrito || cargandoAsistenteDueno) return
    if (!asistenteIdDueno) {
      setMapaPorcentajes({})
      return
    }
    let vigente = true
    supabase
      .from('porcentajes')
      .select('servicio_id, porcentaje')
      .eq('asistente_id', asistenteIdDueno)
      .then(({ data }) => {
        if (!vigente) return
        const mapa = {}
        for (const fila of data ?? []) mapa[fila.servicio_id] = fila.porcentaje
        setMapaPorcentajes(mapa)
      })
    return () => {
      vigente = false
    }
  }, [usaCarrito, asistenteIdDueno, cargandoAsistenteDueno])

  function porcentajeParaServicio(servicioId) {
    if (esAdminDueno || !asistenteIdDueno) return 100
    return mapaPorcentajes[servicioId] ?? null
  }

  // Antes solo bloqueaba completar una cita; ahora también bloquea
  // registrar una atención nueva desde cero (esMultiple) — el servidor ya
  // no deja guardar ACTIVO sin comisión resuelta (73_registro_pendiente_
  // porcentaje.sql). Para esMultiple, el formulario ofrece un botón
  // aparte para anotarlo igual como pendiente (ver guardarMultiple).
  const hayLineaSinComision =
    usaCarrito &&
    !cargandoAsistenteDueno &&
    Boolean(asistenteIdDueno) &&
    lineas.some((linea) => porcentajeParaServicio(linea.servicioId) == null)

  // Con el buscador vacío, includes('') es siempre true — así al enfocar el
  // campo (antes de escribir nada) ya se ven todos los servicios/clientes
  // precargados.
  const sugerenciasServicio = servicios.filter((servicio) =>
    servicio.nombre.toLowerCase().includes(busquedaServicio.trim().toLowerCase()),
  )
  const sugerenciasCliente = clientes.filter((cliente) =>
    cliente.nombre.toLowerCase().includes(busquedaCliente.trim().toLowerCase()),
  )

  const precioNumero = parseFloat(formulario.precio)
  const pagoCalculado =
    porcentajeActual != null && !Number.isNaN(precioNumero)
      ? (precioNumero * porcentajeActual) / 100
      : null

  function actualizarCampo(campo, valor) {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }))
  }

  function seleccionarServicio(servicioId) {
    const servicio = servicios.find((s) => s.id === servicioId)
    setFormulario((anterior) => ({
      ...anterior,
      servicioId,
      precio: servicio ? String(servicio.precio) : anterior.precio,
    }))
  }

  function agregarLinea(servicioId) {
    if (!servicioId) return
    const servicio = servicios.find((s) => s.id === servicioId)
    setLineas((anterior) => [
      ...anterior,
      {
        id: `${servicioId}-${Date.now()}`,
        servicioId,
        nombre: servicio?.nombre ?? '',
        precio: servicio ? String(servicio.precio) : '',
      },
    ])
    setBusquedaServicio('')
    setMostrarSugerenciasServicio(false)
    // El onMouseDown de la sugerencia bloquea el blur nativo (para que el
    // click se registre antes de que la lista se cierre) — sin este blur
    // manual, el campo quedaba con el foco (y su borde de :focus-visible)
    // encendido después de elegir, aunque la lista ya hubiera desaparecido.
    inputServicioRef.current?.blur()
  }

  function seleccionarClienteMultiple(cliente) {
    setClienteIdMultiple(cliente.id)
    setBusquedaCliente(cliente.nombre)
    setMostrarSugerenciasCliente(false)
    inputClienteRef.current?.blur()
  }

  function manejarClienteCreado(clienteCreado) {
    setModalClienteNuevoAbierto(false)
    if (!clienteCreado) return
    setClientes((anterior) =>
      [...anterior, clienteCreado].sort((a, b) => a.nombre.localeCompare(b.nombre)),
    )
    seleccionarClienteMultiple(clienteCreado)
  }

  function manejarServicioCreado(servicioCreado) {
    setModalServicioNuevoAbierto(false)
    if (!servicioCreado) return
    setServicios((anterior) =>
      [...anterior, servicioCreado].sort((a, b) => a.nombre.localeCompare(b.nombre)),
    )
    agregarLinea(servicioCreado.id)
  }

  function quitarLinea(id) {
    setLineas((anterior) => anterior.filter((linea) => linea.id !== id))
  }

  function actualizarPrecioLinea(id, precio) {
    setLineas((anterior) =>
      anterior.map((linea) => (linea.id === id ? { ...linea, precio } : linea)),
    )
  }

  // Solo queda para editar un registro ya guardado — completar cita y
  // registro nuevo pasan por guardarMultiple (usaCarrito).
  async function guardar(evento) {
    evento.preventDefault()

    const mensajeError = validar(formulario)
    if (mensajeError) {
      setError(mensajeError)
      return
    }

    setGuardando(true)
    setError(null)

    const precio = parseFloat(formulario.precio)
    const fechaIso = deInputDatetimeLima(formulario.fecha).toISOString()

    const datos = {
      servicio_id: formulario.servicioId,
      cliente_id: formulario.clienteId,
      precio,
      fecha: fechaIso,
      nota: formulario.nota.trim() || null,
      porcentaje_aplicado: porcentajeActual,
      pago_asistente: porcentajeActual != null ? (precio * porcentajeActual) / 100 : null,
    }

    const { error: errorGuardado } = await supabase
      .from('registro_servicios')
      .update(datos)
      .eq('id', registro.id)

    setGuardando(false)

    if (errorGuardado) {
      setError(
        errorGuardado.message === MENSAJE_NEGOCIO_CERRADO
          ? MENSAJE_NEGOCIO_CERRADO
          : 'No se pudo guardar la atención. Intenta de nuevo.',
      )
      return
    }

    onGuardado()
  }

  async function guardarMultiple(evento, opciones = {}) {
    evento.preventDefault()
    const comoNota = opciones.comoNota === true

    if (!clienteIdMultiple) {
      setError('Selecciona un cliente.')
      return
    }
    if (lineas.length === 0) {
      setError('Agrega al menos un servicio.')
      return
    }
    if (!fechaMultiple) {
      setError('Selecciona una fecha y hora.')
      return
    }
    for (const linea of lineas) {
      const precioLinea = parseFloat(linea.precio)
      if (Number.isNaN(precioLinea) || precioLinea < 0) {
        setError('Hay un precio inválido en la lista de servicios.')
        return
      }
    }
    if (hayLineaSinComision && !comoNota) {
      setError(
        esCompletarCita
          ? 'Asigna un % de comisión para cada servicio antes de completar la cita.'
          : 'Asigna un % de comisión para cada servicio, o guárdalo como nota pendiente.',
      )
      return
    }

    setGuardando(true)
    setError(null)

    const fechaIso = deInputDatetimeLima(fechaMultiple).toISOString()

    if (esCompletarCita) {
      const { error: errorRpc } = await supabase.rpc('completar_cita', {
        p_cita_id: citaId,
        p_items: lineas.map((linea) => ({
          cita_servicio_id: linea.citaServicioId,
          precio: parseFloat(linea.precio),
        })),
        p_cliente_id: clienteIdMultiple,
        p_fecha: fechaIso,
        p_nota: notaMultiple.trim() || null,
      })

      setGuardando(false)

      if (errorRpc) {
        setError(
          errorRpc.message === MENSAJE_NEGOCIO_CERRADO
            ? MENSAJE_NEGOCIO_CERRADO
            : errorRpc.message || 'No se pudo completar la cita. Intenta de nuevo.',
        )
        return
      }

      onGuardado()
      return
    }

    const filas = lineas.map((linea) => {
      const precioLinea = parseFloat(linea.precio)
      const porcentaje = porcentajeParaServicio(linea.servicioId)
      return {
        usuario_id: usuario.id,
        servicio_id: linea.servicioId,
        cliente_id: clienteIdMultiple,
        precio: precioLinea,
        fecha: fechaIso,
        nota: notaMultiple.trim() || null,
        porcentaje_aplicado: porcentaje,
        pago_asistente: porcentaje != null ? (precioLinea * porcentaje) / 100 : null,
        // Sin % resuelto, queda como nota pendiente (no cuenta en ningún
        // total hasta que se le asigne un % y se confirme desde Mi Panel)
        // — el resto de las líneas del mismo carrito se registran oficial
        // si ya tienen su % resuelto, sin que una arrastre a la otra.
        ...(porcentaje == null ? { estado: 'PENDIENTE_PORCENTAJE' } : {}),
      }
    })

    const { error: errorGuardado } = await supabase.from('registro_servicios').insert(filas)

    setGuardando(false)

    if (errorGuardado) {
      setError(
        errorGuardado.message === MENSAJE_NEGOCIO_CERRADO
          ? MENSAJE_NEGOCIO_CERRADO
          : 'No se pudo guardar. Intenta de nuevo.',
      )
      return
    }

    onGuardado()
  }

  if (usaCarrito) {
    const categoriasExistentes = [...new Set(servicios.map((s) => s.categoria).filter(Boolean))].sort()

    return (
      <>
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
          style={{ '--color-foco': 'var(--color-purple-300)' }}
        >
        <form
          autoComplete="off"
          ref={panelRef}
          onSubmit={guardarMultiple}
          className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface p-5"
        >
          <h2 className="text-base font-semibold text-ink">
            {esCompletarCita
              ? 'Completar cita'
              : lineas.length > 1
                ? 'Registrar atenciones'
                : 'Registrar atención'}
          </h2>

          {cargandoListas ? (
            <p className="mt-4 text-center font-mono text-sm text-ink/60">Cargando...</p>
          ) : (
            <div className="mt-4 space-y-3">
              <div>
                <Etiqueta obligatorio htmlFor={`${idBase}-cliente-multi`}>Cliente</Etiqueta>
                <div className="relative">
                  <input
                    ref={inputClienteRef}
                    id={`${idBase}-cliente-multi`}
                    type="search"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                    value={busquedaCliente}
                    onChange={(evento) => {
                      setBusquedaCliente(evento.target.value)
                      setClienteIdMultiple('')
                      setMostrarSugerenciasCliente(true)
                    }}
                    onFocus={() => setMostrarSugerenciasCliente(true)}
                    onBlur={() => setTimeout(() => setMostrarSugerenciasCliente(false), 150)}
                    placeholder="Buscar cliente..."
                    className="w-full rounded-lg border border-border bg-surface-2 py-2 pl-3 pr-9 text-sm text-ink outline-none focus:border-purple-300"
                  />
                  {busquedaCliente ? (
                    <button
                      type="button"
                      onClick={() => setBusquedaCliente('')}
                      aria-label="Limpiar búsqueda"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/60 transition-colors hover:text-ink"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  ) : (
                    <User className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
                  )}

                  {mostrarSugerenciasCliente && (sugerenciasCliente.length > 0 || busquedaCliente.trim()) && (
                    <div className="animate-entrada-dropdown absolute left-0 right-0 top-full z-10 mt-1 max-h-[80vh] overflow-y-auto rounded-lg border border-border bg-surface-2 shadow-lg">
                      {sugerenciasCliente.map((cliente) => (
                        <button
                          key={cliente.id}
                          type="button"
                          onMouseDown={(evento) => evento.preventDefault()}
                          onClick={() => seleccionarClienteMultiple(cliente)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-3"
                        >
                          <span className="truncate">{cliente.nombre}</span>
                        </button>
                      ))}
                      {busquedaCliente.trim() && (
                        <button
                          type="button"
                          onMouseDown={(evento) => evento.preventDefault()}
                          onClick={() => {
                            setMostrarSugerenciasCliente(false)
                            setModalClienteNuevoAbierto(true)
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-purple-300 transition-colors hover:bg-surface-3 ${
                            sugerenciasCliente.length > 0 ? 'border-t border-border' : ''
                          }`}
                        >
                          <UserRoundPlus className="h-4 w-4 shrink-0" />
                          <span className="truncate">
                            Registrar "{busquedaCliente.trim()}" como cliente nuevo
                          </span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {!esCompletarCita && (
              <div>
                <Etiqueta htmlFor={`${idBase}-agregar-servicio`}>Agregar servicio</Etiqueta>
                <div className="relative">
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
                    className="w-full rounded-lg border border-border bg-surface-2 py-2 pl-3 pr-9 text-sm text-ink outline-none focus:border-purple-300"
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
                    <Scissors className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
                  )}

                  {mostrarSugerenciasServicio &&
                    (sugerenciasServicio.length > 0 || busquedaServicio.trim()) && (
                      <div className="animate-entrada-dropdown absolute left-0 right-0 top-full z-10 mt-1 max-h-[80vh] overflow-y-auto rounded-lg border border-border bg-surface-2 shadow-lg">
                        {sugerenciasServicio.map((servicio) => (
                          <button
                            key={servicio.id}
                            type="button"
                            onMouseDown={(evento) => evento.preventDefault()}
                            onClick={() => agregarLinea(servicio.id)}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-3"
                          >
                            <span className="truncate">{servicio.nombre}</span>
                            <span className="shrink-0 font-mono text-xs text-ink/60">
                              {servicio.precio.toFixed(2)}
                            </span>
                          </button>
                        ))}
                        {busquedaServicio.trim() && (
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
              )}

              <div className="rounded-lg border border-border">
                <div
                  className={`${esTactil || esCompletarCita ? 'grid-cols-[1fr_6.5rem]' : 'grid-cols-[1fr_6.5rem_1.5rem]'} grid gap-2 border-b border-border px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-ink/60`}
                >
                  <span>Servicio</span>
                  <span className="text-right">Precio</span>
                  {!esTactil && !esCompletarCita && <span />}
                </div>

                <div className="h-[140px] divide-y divide-border overflow-y-auto">
                  {lineas.length === 0 ? (
                    <div className="flex h-full items-center justify-center">
                      <p className="text-sm text-ink/40">Sin servicios</p>
                    </div>
                  ) : (
                    lineas.map((linea) => (
                      <FilaLineaServicio
                        key={linea.id}
                        linea={linea}
                        nombre={linea.nombre}
                        porcentaje={porcentajeParaServicio(linea.servicioId)}
                        esTactil={esTactil}
                        permitirQuitar={!esCompletarCita}
                        estricto
                        onCambiarPrecio={(precio) => actualizarPrecioLinea(linea.id, precio)}
                        onQuitar={() => quitarLinea(linea.id)}
                      />
                    ))
                  )}
                </div>
              </div>

              <div>
                <Etiqueta obligatorio htmlFor={`${idBase}-fecha-multi`}>Fecha y hora</Etiqueta>
                <input
                  id={`${idBase}-fecha-multi`}
                  type="datetime-local"
                  value={fechaMultiple}
                  onChange={(evento) => setFechaMultiple(evento.target.value)}
                  className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
                />
              </div>

              <div>
                <Etiqueta htmlFor={`${idBase}-nota-multi`}>Nota</Etiqueta>
                <textarea
                  id={`${idBase}-nota-multi`}
                  autoComplete="off"
                  value={notaMultiple}
                  onChange={(evento) => setNotaMultiple(evento.target.value)}
                  placeholder="Opcional — aplica a toda la tanda"
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
              onClick={onCerrar}
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
                cargandoAsistenteDueno ||
                lineas.length === 0 ||
                hayLineaSinComision
              }
              className="flex-1 rounded-lg bg-purple-300 py-2 text-sm font-semibold text-bg disabled:opacity-40"
            >
              {guardando
                ? 'Guardando...'
                : esCompletarCita
                  ? 'Confirmar y completar'
                  : `Guardar${lineas.length > 1 ? ` (${lineas.length})` : ''}`}
            </button>
          </div>

          {/* Solo para registro nuevo (no completar cita, que no admite
              esta salida): sin % en alguna línea, se puede anotar igual
              — no cuenta en los totales hasta que se confirme desde Mi
              Panel con el % ya asignado. */}
          {esMultiple && hayLineaSinComision && (
            <button
              type="button"
              onClick={(evento) => guardarMultiple(evento, { comoNota: true })}
              disabled={guardando || cargandoListas || cargandoAsistenteDueno || lineas.length === 0}
              className="mt-2 w-full rounded-lg border border-orange-400/50 py-2 text-sm font-medium text-orange-400 transition-colors hover:bg-orange-400/10 disabled:opacity-40"
            >
              Anotar como pendiente (sin comisión por ahora)
            </button>
          )}
        </form>
      </div>

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
      </>
    )
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4"
      style={{ '--color-foco': 'var(--color-purple-300)' }}
    >
      <form
        autoComplete="off"
        ref={panelRef}
        onSubmit={guardar}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface p-5"
      >
        <h2 className="text-base font-semibold text-ink">Editar atención</h2>

        {cargandoListas ? (
          <p className="mt-4 text-center font-mono text-sm text-ink/60">Cargando...</p>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-servicio`}>Servicio</Etiqueta>
              <select
                id={`${idBase}-servicio`}
                value={formulario.servicioId}
                onChange={(evento) => seleccionarServicio(evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-purple-300"
              >
                <option value="">Selecciona un servicio</option>
                {servicios.map((servicio) => (
                  <option key={servicio.id} value={servicio.id}>
                    {servicio.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-cliente`}>Cliente</Etiqueta>
              <select
                id={`${idBase}-cliente`}
                value={formulario.clienteId}
                onChange={(evento) => actualizarCampo('clienteId', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-purple-300"
              >
                <option value="">Selecciona un cliente</option>
                {clientes.map((cliente) => (
                  <option key={cliente.id} value={cliente.id}>
                    {cliente.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-precio`}>Precio</Etiqueta>
              <input
                id={`${idBase}-precio`}
                type="search"
                inputMode="decimal"
                autoComplete="new-password"
                value={formulario.precio}
                onChange={(evento) => actualizarCampo('precio', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
              />
              {formulario.servicioId &&
                (porcentajeActual == null ? (
                  <p className="mt-1.5 text-xs text-orange-400">
                    Sin porcentaje asignado para este servicio — se guardará sin comisión.
                  </p>
                ) : (
                  !Number.isNaN(precioNumero) && (
                    <p className="mt-1.5 font-mono text-xs text-ink/60">
                      {precioNumero} × {porcentajeActual}% = {pagoCalculado.toFixed(2)}
                    </p>
                  )
                ))}
            </div>

            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-fecha`}>Fecha y hora</Etiqueta>
              <input
                id={`${idBase}-fecha`}
                type="datetime-local"
                value={formulario.fecha}
                onChange={(evento) => actualizarCampo('fecha', evento.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-ink outline-none focus:border-purple-300"
              />
            </div>

            <div>
              <Etiqueta htmlFor={`${idBase}-nota`}>Nota</Etiqueta>
              <textarea
                id={`${idBase}-nota`}
                autoComplete="off"
                value={formulario.nota}
                onChange={(evento) => actualizarCampo('nota', evento.target.value)}
                placeholder="Opcional"
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
            onClick={onCerrar}
            disabled={guardando}
            className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={guardando || cargandoListas || cargandoAsistenteDueno}
            className="flex-1 rounded-lg bg-purple-300 py-2 text-sm font-semibold text-bg disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  )
}
