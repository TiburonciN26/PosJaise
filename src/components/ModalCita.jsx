import { useEffect, useId, useRef, useState } from 'react'
import { X, User, UserPlus, Scissors, UserRoundPlus, PlusCircle } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { aInputDatetimeLima, deInputDatetimeLima } from '../lib/fechas.js'
import { MENSAJE_NEGOCIO_CERRADO } from '../lib/estadoNegocio.js'
import Etiqueta from './Etiqueta.jsx'
import ModalCliente from './ModalCliente.jsx'
import ModalServicio from './ModalServicio.jsx'

// Umbrales del swipe-to-delete del carrito — mismos valores que el
// carrito de Ventas/Mi Panel, para que el gesto se sienta idéntico.
const UMBRAL_ARRASTRE_ELIMINAR = 90
const UMBRAL_ARRASTRE_INICIO = 8

function FilaLineaCita({ linea, esTactil, onCambiarPrecio, onCambiarDuracion, onQuitar }) {
  const [arrastreX, setArrastreX] = useState(0)
  const [arrastrando, setArrastrando] = useState(false)
  const inicioRef = useRef({ x: 0, iniciado: false, ignorar: false })

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
      onPointerDown={manejarPointerDown}
      onPointerMove={manejarPointerMove}
      onPointerUp={soltar}
      onPointerCancel={soltar}
      style={{
        transform: arrastreX ? `translateX(${arrastreX}px)` : undefined,
        backgroundColor: `color-mix(in srgb, var(--color-red) ${Math.round(progresoEliminar * 85)}%, transparent)`,
        transition: arrastrando ? 'none' : undefined,
      }}
      className="touch-pan-y px-3 py-2 transition-[transform_200ms_ease-in,background-color_150ms_ease-out]"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm text-ink">{linea.nombre}</p>
        {!esTactil && (
          <button
            type="button"
            onClick={onQuitar}
            aria-label="Quitar servicio"
            className="shrink-0 text-ink/30 transition-colors hover:text-red"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <span className="text-xs text-ink/50">S/</span>
          <input
            type="search"
            inputMode="decimal"
            autoComplete="new-password"
            value={linea.precio}
            onChange={(evento) => onCambiarPrecio(evento.target.value)}
            className="w-16 rounded-lg border border-border bg-surface px-1.5 py-1 text-right font-mono text-sm text-ink outline-none focus:border-purple-300"
          />
        </div>
        <div className="flex items-center gap-1">
          <input
            type="search"
            inputMode="numeric"
            autoComplete="new-password"
            value={linea.duracionMin}
            onChange={(evento) => onCambiarDuracion(evento.target.value)}
            className="w-12 rounded-lg border border-border bg-surface px-1.5 py-1 text-right font-mono text-sm text-ink outline-none focus:border-purple-300"
          />
          <span className="text-xs text-ink/50">min</span>
        </div>
      </div>
    </div>
  )
}

function formularioVacio(fechaSugerida) {
  return {
    clienteId: '',
    asistenteId: '',
    fechaHora: aInputDatetimeLima(fechaSugerida ?? new Date()),
    nota: '',
  }
}

function formularioDesdeCita(cita) {
  return {
    clienteId: cita.cliente_id ?? '',
    asistenteId: cita.asistente_id ?? '',
    fechaHora: aInputDatetimeLima(new Date(cita.fecha_hora)),
    nota: cita.nota ?? '',
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

  return null
}

export default function ModalCita({ cita, fechaSugerida, onCerrar, onGuardado }) {
  const idBase = useId()
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const { usuario } = useAuth()
  const esEdicion = Boolean(cita)

  const [servicios, setServicios] = useState([])
  const [clientes, setClientes] = useState([])
  const [asistentes, setAsistentes] = useState([])
  const [cargandoListas, setCargandoListas] = useState(true)

  const [formulario, setFormulario] = useState(() =>
    esEdicion ? formularioDesdeCita(cita) : formularioVacio(fechaSugerida),
  )
  const [lineas, setLineas] = useState(() => (esEdicion ? lineasDesdeCita(cita) : []))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)
  // Igual que el carrito de Ventas/Mi Panel: en táctil se elimina
  // deslizando la fila, en mouse/trackpad se conserva el botón ✕.
  const [esTactil] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  )

  // Buscadores de cliente/servicio — mismo patrón que el carrito de
  // atenciones de Mi Panel: precargan todo al enfocar, ícono que se
  // convierte en "✕" en cuanto hay texto, y blur manual al elegir para que
  // no se quede el borde de foco encendido con la lista ya cerrada.
  const [busquedaCliente, setBusquedaCliente] = useState(() =>
    esEdicion ? (cita.clientes?.nombre ?? cita.cliente_nombre_referencia ?? '') : '',
  )
  // Cliente "de referencia" (sin guardar en Clientes) — mutuamente
  // excluyente con formulario.clienteId: escribir de nuevo en el buscador
  // o elegir un cliente real limpia esto.
  const [clienteReferencia, setClienteReferencia] = useState(() =>
    esEdicion && !cita.cliente_id ? (cita.cliente_nombre_referencia ?? '') : '',
  )
  const [mostrarSugerenciasCliente, setMostrarSugerenciasCliente] = useState(false)
  const [busquedaServicio, setBusquedaServicio] = useState('')
  const [mostrarSugerenciasServicio, setMostrarSugerenciasServicio] = useState(false)
  const inputClienteRef = useRef(null)
  const inputServicioRef = useRef(null)

  const [modalClienteNuevoAbierto, setModalClienteNuevoAbierto] = useState(false)
  const [modalServicioNuevoAbierto, setModalServicioNuevoAbierto] = useState(false)

  useCerrarConEscape(onCerrar)

  useEffect(() => {
    async function cargarListas() {
      const [resServicios, resClientes, resAsistentes] = await Promise.all([
        supabase.from('servicios').select('id, nombre, precio, duracion_min, categoria').order('nombre'),
        supabase.from('clientes').select('id, nombre').order('nombre'),
        // RPC en vez de leer la tabla directo: ya excluye a quien esté
        // vinculado a una cuenta CAJERA (no atiende), cosa que un no-admin
        // no podría filtrar por su cuenta (la RLS de usuarios no le deja
        // ver el rol de otras cuentas).
        supabase.rpc('asistentes_para_citas'),
      ])
      setServicios(resServicios.data ?? [])
      setClientes(resClientes.data ?? [])
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
  }, [esEdicion, miFicha])

  const categoriasExistentes = [...new Set(servicios.map((s) => s.categoria).filter(Boolean))].sort()

  const sugerenciasCliente = clientes.filter((cliente) =>
    cliente.nombre.toLowerCase().includes(busquedaCliente.trim().toLowerCase()),
  )
  const sugerenciasServicio = servicios.filter((servicio) =>
    servicio.nombre.toLowerCase().includes(busquedaServicio.trim().toLowerCase()),
  )
  function actualizarCampo(campo, valor) {
    setFormulario((anterior) => ({ ...anterior, [campo]: valor }))
  }

  function seleccionarCliente(cliente) {
    actualizarCampo('clienteId', cliente.id)
    setClienteReferencia('')
    setBusquedaCliente(cliente.nombre)
    setMostrarSugerenciasCliente(false)
    inputClienteRef.current?.blur()
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
    setClientes((anterior) =>
      [...anterior, clienteCreado].sort((a, b) => a.nombre.localeCompare(b.nombre)),
    )
    seleccionarCliente(clienteCreado)
  }

  function agregarLineaServicio(servicioId) {
    const servicio = servicios.find((s) => s.id === servicioId)
    if (!servicio) return
    setLineas((anterior) => [
      ...anterior,
      {
        id: `${servicioId}-${Date.now()}`,
        servicioId,
        nombre: servicio.nombre,
        duracionMin: servicio.duracion_min ? String(servicio.duracion_min) : '30',
        precio: servicio.precio != null ? String(servicio.precio) : '',
      },
    ])
    setBusquedaServicio('')
    setMostrarSugerenciasServicio(false)
    inputServicioRef.current?.blur()
  }

  function manejarServicioCreado(servicioCreado) {
    setModalServicioNuevoAbierto(false)
    if (!servicioCreado) return
    setServicios((anterior) =>
      [...anterior, servicioCreado].sort((a, b) => a.nombre.localeCompare(b.nombre)),
    )
    agregarLineaServicio(servicioCreado.id)
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

    const datosCita = {
      cliente_id: formulario.clienteId || null,
      cliente_nombre_referencia: formulario.clienteId ? null : clienteReferencia.trim() || null,
      asistente_id: formulario.asistenteId || null,
      fecha_hora: deInputDatetimeLima(formulario.fechaHora).toISOString(),
      nota: formulario.nota.trim() || null,
    }

    let citaId = esEdicion ? cita.id : null

    if (esEdicion) {
      const { error: errorCita } = await supabase.from('citas').update(datosCita).eq('id', citaId)
      if (errorCita) {
        setGuardando(false)
        setError(
          errorCita.message === MENSAJE_NEGOCIO_CERRADO
            ? MENSAJE_NEGOCIO_CERRADO
            : 'No se pudo guardar la cita. Intenta de nuevo.',
        )
        return
      }
      // Se reemplazan todas las líneas — más simple que diffear cuáles
      // cambiaron, y una cita editada nunca tiene servicios ya completados
      // sueltos (si tuviera alguno completado, la cita entera ya estaría
      // en estado COMPLETADA y no pasaría por acá).
      const { error: errorBorrar } = await supabase
        .from('cita_servicios')
        .delete()
        .eq('cita_id', citaId)
      if (errorBorrar) {
        setGuardando(false)
        setError('No se pudo actualizar los servicios de la cita. Intenta de nuevo.')
        return
      }
    } else {
      const { data: citaCreada, error: errorCita } = await supabase
        .from('citas')
        .insert({ ...datosCita, creado_por: usuario.id })
        .select()
        .single()
      if (errorCita) {
        setGuardando(false)
        setError(
          errorCita.message === MENSAJE_NEGOCIO_CERRADO
            ? MENSAJE_NEGOCIO_CERRADO
            : 'No se pudo guardar la cita. Intenta de nuevo.',
        )
        return
      }
      citaId = citaCreada.id
    }

    const { error: errorLineas } = await supabase.from('cita_servicios').insert(
      lineas.map((linea) => ({
        cita_id: citaId,
        servicio_id: linea.servicioId,
        duracion_min: parseInt(linea.duracionMin, 10),
        precio: parseFloat(linea.precio),
      })),
    )

    setGuardando(false)

    if (errorLineas) {
      setError('No se pudieron guardar los servicios de la cita. Intenta de nuevo.')
      return
    }

    onGuardado()
  }

  // Antes solo el admin podía elegir/reasignar el selector completo de
  // asistentes; ahora cajera y asistente también pueden reasignar
  // cualquier cita, así que los 3 roles ven el mismo selector.
  const puedeElegirAsistente = true

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
        <h2 className="text-base font-semibold text-ink">
          {esEdicion ? 'Editar cita' : 'Nueva cita'}
        </h2>

        {cargandoListas ? (
          <p className="mt-4 text-center font-mono text-sm text-ink/60">Cargando...</p>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-cliente`}>Cliente</Etiqueta>
              <div className="relative">
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
                  onBlur={() => setTimeout(() => setMostrarSugerenciasCliente(false), 150)}
                  placeholder="Buscar cliente..."
                  className="w-full rounded-lg border border-border bg-surface-2 py-2 pl-3 pr-9 text-sm text-ink outline-none focus:border-purple-300"
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
                  <User className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
                )}

                {mostrarSugerenciasCliente && (sugerenciasCliente.length > 0 || busquedaCliente.trim()) && (
                  <div className="animate-entrada-dropdown absolute left-0 right-0 top-full z-10 mt-1 max-h-[80vh] overflow-y-auto rounded-lg border border-border bg-surface-2 shadow-lg">
                    {sugerenciasCliente.map((cliente) => (
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
                    {busquedaCliente.trim() && (
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
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

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
                          onClick={() => agregarLineaServicio(servicio.id)}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-3"
                        >
                          <span className="truncate">{servicio.nombre}</span>
                          {servicio.duracion_min && (
                            <span className="shrink-0 font-mono text-xs text-ink/60">
                              {servicio.duracion_min} min
                            </span>
                          )}
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

            <div className="rounded-lg border border-border">
              <div className="max-h-[220px] divide-y divide-border overflow-y-auto">
                {lineas.length === 0 ? (
                  <div className="flex items-center justify-center py-6">
                    <p className="text-sm text-ink/40">Sin servicios</p>
                  </div>
                ) : (
                  lineas.map((linea) => (
                    <FilaLineaCita
                      key={linea.id}
                      linea={linea}
                      esTactil={esTactil}
                      onCambiarPrecio={(precio) => actualizarPrecioLinea(linea.id, precio)}
                      onCambiarDuracion={(duracionMin) => actualizarDuracionLinea(linea.id, duracionMin)}
                      onQuitar={() => quitarLinea(linea.id)}
                    />
                  ))
                )}
              </div>
            </div>

            <div>
              <Etiqueta obligatorio={!puedeElegirAsistente} htmlFor={`${idBase}-asistente`}>
                Asistente
              </Etiqueta>
              {puedeElegirAsistente ? (
                <>
                  <select
                    id={`${idBase}-asistente`}
                    value={formulario.asistenteId}
                    onChange={(evento) => actualizarCampo('asistenteId', evento.target.value)}
                    className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-purple-300"
                  >
                    <option value="">Asistente pendiente</option>
                    {asistentes.map((asistente) => (
                      <option key={asistente.id} value={asistente.id}>
                        {asistente.nombres_completos}
                      </option>
                    ))}
                  </select>
                  {!formulario.asistenteId && (
                    <p className="mt-1 text-[11px] text-orange-400">
                      Sin asistente todavía no se puede completar la cita — comunícate con el
                      administrador para asignar una.
                    </p>
                  )}
                </>
              ) : (
                <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink/70">
                  {miFicha?.nombres_completos ?? 'Sin ficha de asistente vinculada'}
                </p>
              )}
            </div>

            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-fecha`}>Fecha y hora</Etiqueta>
              <input
                id={`${idBase}-fecha`}
                type="datetime-local"
                value={formulario.fechaHora}
                onChange={(evento) => actualizarCampo('fechaHora', evento.target.value)}
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
    </div>
  )
}
