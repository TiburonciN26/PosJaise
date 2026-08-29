import { useEffect, useId, useRef, useState } from 'react'
import { X, User, Scissors } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { aInputDatetimeLima, deInputDatetimeLima } from '../lib/fechas.js'
import { MENSAJE_NEGOCIO_CERRADO } from '../lib/estadoNegocio.js'
import Etiqueta from './Etiqueta.jsx'

function formularioVacio(fechaSugerida) {
  return {
    clienteId: '',
    servicioId: '',
    asistenteId: '',
    fechaHora: aInputDatetimeLima(fechaSugerida ?? new Date()),
    duracionMin: '30',
    nota: '',
  }
}

function formularioDesdeCita(cita) {
  return {
    clienteId: cita.cliente_id ?? '',
    servicioId: cita.servicio_id ?? '',
    asistenteId: cita.asistente_id ?? '',
    fechaHora: aInputDatetimeLima(new Date(cita.fecha_hora)),
    duracionMin: String(cita.duracion_min ?? 30),
    nota: cita.nota ?? '',
  }
}

// El asistente solo es obligatorio si quien agenda NO es admin (una
// asistente siempre agenda para sí misma). Un admin puede dejarlo sin
// asignar — por ejemplo cuando el servicio lo va a hacer ella misma.
function validar(formulario, puedeElegirAsistente) {
  if (!formulario.clienteId) return 'Selecciona un cliente.'
  if (!formulario.servicioId) return 'Selecciona un servicio.'
  if (!formulario.asistenteId && !puedeElegirAsistente) return 'Selecciona una asistente.'
  if (!formulario.fechaHora) return 'Selecciona una fecha y hora.'

  const duracion = parseInt(formulario.duracionMin, 10)
  if (Number.isNaN(duracion) || duracion <= 0) return 'La duración debe ser mayor a 0.'

  return null
}

export default function ModalCita({ cita, fechaSugerida, onCerrar, onGuardado }) {
  const idBase = useId()
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  const { usuario, rol } = useAuth()
  const esEdicion = Boolean(cita)

  const [servicios, setServicios] = useState([])
  const [clientes, setClientes] = useState([])
  const [asistentes, setAsistentes] = useState([])
  const [cargandoListas, setCargandoListas] = useState(true)

  const [formulario, setFormulario] = useState(() =>
    esEdicion ? formularioDesdeCita(cita) : formularioVacio(fechaSugerida),
  )
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState(null)

  // Buscadores de cliente/servicio — mismo patrón que el carrito de
  // atenciones de Mi Panel: precargan todo al enfocar, ícono que se
  // convierte en "✕" en cuanto hay texto, y blur manual al elegir para que
  // no se quede el borde de foco encendido con la lista ya cerrada.
  const [busquedaCliente, setBusquedaCliente] = useState(() =>
    esEdicion ? (cita.clientes?.nombre ?? '') : '',
  )
  const [mostrarSugerenciasCliente, setMostrarSugerenciasCliente] = useState(false)
  const [busquedaServicio, setBusquedaServicio] = useState(() =>
    esEdicion ? (cita.servicios?.nombre ?? '') : '',
  )
  const [mostrarSugerenciasServicio, setMostrarSugerenciasServicio] = useState(false)
  const inputClienteRef = useRef(null)
  const inputServicioRef = useRef(null)

  useCerrarConEscape(onCerrar)

  useEffect(() => {
    async function cargarListas() {
      const [resServicios, resClientes, resAsistentes] = await Promise.all([
        supabase.from('servicios').select('id, nombre, duracion_min').order('nombre'),
        supabase.from('clientes').select('id, nombre').order('nombre'),
        supabase
          .from('asistentes')
          .select('id, nombres_completos, usuario_id')
          .eq('activo', true)
          .order('nombres_completos'),
      ])
      setServicios(resServicios.data ?? [])
      setClientes(resClientes.data ?? [])
      setAsistentes(resAsistentes.data ?? [])
      setCargandoListas(false)
    }
    cargarListas()
  }, [])

  // Una asistente solo agenda para sí misma — su propia ficha se fija en
  // cuanto la lista carga, sin mostrarle un selector con nombres ajenos
  // (la RLS de citas la rechazaría igual, pero acá evitamos el intento).
  const miFicha = asistentes.find((a) => a.usuario_id === usuario.id) ?? null
  useEffect(() => {
    if (rol !== 'ASISTENTE' || esEdicion || !miFicha) return
    setFormulario((anterior) =>
      anterior.asistenteId ? anterior : { ...anterior, asistenteId: miFicha.id },
    )
  }, [rol, esEdicion, miFicha])

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
    setBusquedaCliente(cliente.nombre)
    setMostrarSugerenciasCliente(false)
    inputClienteRef.current?.blur()
  }

  function seleccionarServicio(servicioId) {
    const servicio = servicios.find((s) => s.id === servicioId)
    setFormulario((anterior) => ({
      ...anterior,
      servicioId,
      duracionMin: servicio?.duracion_min ? String(servicio.duracion_min) : anterior.duracionMin,
    }))
    setBusquedaServicio(servicio?.nombre ?? '')
    setMostrarSugerenciasServicio(false)
    inputServicioRef.current?.blur()
  }

  async function guardar(evento) {
    evento.preventDefault()

    const mensajeError = validar(formulario, puedeElegirAsistente)
    if (mensajeError) {
      setError(mensajeError)
      return
    }

    setGuardando(true)
    setError(null)

    const datos = {
      cliente_id: formulario.clienteId,
      servicio_id: formulario.servicioId,
      asistente_id: formulario.asistenteId || null,
      fecha_hora: deInputDatetimeLima(formulario.fechaHora).toISOString(),
      duracion_min: parseInt(formulario.duracionMin, 10),
      nota: formulario.nota.trim() || null,
    }

    const { error: errorGuardado } = esEdicion
      ? await supabase.from('citas').update(datos).eq('id', cita.id)
      : await supabase.from('citas').insert({ ...datos, creado_por: usuario.id })

    setGuardando(false)

    if (errorGuardado) {
      setError(
        errorGuardado.message === MENSAJE_NEGOCIO_CERRADO
          ? MENSAJE_NEGOCIO_CERRADO
          : 'No se pudo guardar la cita. Intenta de nuevo.',
      )
      return
    }

    onGuardado()
  }

  const puedeElegirAsistente = rol === 'ADMINISTRADOR'

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
                    }}
                    aria-label="Limpiar búsqueda"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/60 transition-colors hover:text-ink"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : (
                  <User className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
                )}

                {mostrarSugerenciasCliente && sugerenciasCliente.length > 0 && (
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
                  </div>
                )}
              </div>
            </div>

            <div>
              <Etiqueta obligatorio htmlFor={`${idBase}-servicio`}>Servicio</Etiqueta>
              <div className="relative">
                <input
                  ref={inputServicioRef}
                  id={`${idBase}-servicio`}
                  type="search"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  value={busquedaServicio}
                  onChange={(evento) => {
                    setBusquedaServicio(evento.target.value)
                    actualizarCampo('servicioId', '')
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
                    onClick={() => {
                      setBusquedaServicio('')
                      actualizarCampo('servicioId', '')
                    }}
                    aria-label="Limpiar búsqueda"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink/60 transition-colors hover:text-ink"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : (
                  <Scissors className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
                )}

                {mostrarSugerenciasServicio && sugerenciasServicio.length > 0 && (
                  <div className="animate-entrada-dropdown absolute left-0 right-0 top-full z-10 mt-1 max-h-[80vh] overflow-y-auto rounded-lg border border-border bg-surface-2 shadow-lg">
                    {sugerenciasServicio.map((servicio) => (
                      <button
                        key={servicio.id}
                        type="button"
                        onMouseDown={(evento) => evento.preventDefault()}
                        onClick={() => seleccionarServicio(servicio.id)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-3"
                      >
                        <span className="truncate">{servicio.nombre}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <Etiqueta obligatorio={!puedeElegirAsistente} htmlFor={`${idBase}-asistente`}>
                Asistente
              </Etiqueta>
              {puedeElegirAsistente ? (
                <select
                  id={`${idBase}-asistente`}
                  value={formulario.asistenteId}
                  onChange={(evento) => actualizarCampo('asistenteId', evento.target.value)}
                  className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-purple-300"
                >
                  <option value="">{usuario.nombre_completo}</option>
                  {asistentes.map((asistente) => (
                    <option key={asistente.id} value={asistente.id}>
                      {asistente.nombres_completos}
                    </option>
                  ))}
                </select>
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
              <Etiqueta obligatorio htmlFor={`${idBase}-duracion`}>Duración (minutos)</Etiqueta>
              <input
                id={`${idBase}-duracion`}
                type="search"
                inputMode="numeric"
                autoComplete="new-password"
                value={formulario.duracionMin}
                onChange={(evento) => actualizarCampo('duracionMin', evento.target.value)}
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
            disabled={guardando || cargandoListas || (!puedeElegirAsistente && !miFicha)}
            className="flex-1 rounded-lg bg-purple-300 py-2 text-sm font-semibold text-bg disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Agendar'}
          </button>
        </div>
      </form>
    </div>
  )
}
