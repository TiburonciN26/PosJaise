import { useEffect, useMemo, useState } from 'react'
import { X, Lock, Unlock, ArrowBigDown, Mic } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import { useTextoEscritura } from '../hooks/useTextoEscritura.js'
import { useReconocimientoVoz } from '../hooks/useReconocimientoVoz.js'
import IconoBuscar from '../components/IconoBuscar.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'

const OPCIONES_ORDEN = [
  { id: 'nombre-asc', label: 'Nombre (A-Z)' },
  { id: 'nombre-desc', label: 'Nombre (Z-A)' },
  { id: 'asignados-asc', label: '% asignado (menor a mayor)' },
  { id: 'asignados-desc', label: '% asignado (mayor a menor)' },
]

function contarAsignados(servicioId, asistentesActivos, porcentajesMap) {
  return asistentesActivos.filter((a) => porcentajesMap.has(`${servicioId}_${a.id}`)).length
}

function ordenarServicios(servicios, orden, asistentesActivos, porcentajesMap) {
  const ordenados = [...servicios]
  switch (orden) {
    case 'nombre-desc':
      return ordenados.sort((a, b) => b.nombre.localeCompare(a.nombre))
    case 'asignados-asc':
      return ordenados.sort(
        (a, b) =>
          contarAsignados(a.id, asistentesActivos, porcentajesMap) -
          contarAsignados(b.id, asistentesActivos, porcentajesMap),
      )
    case 'asignados-desc':
      return ordenados.sort(
        (a, b) =>
          contarAsignados(b.id, asistentesActivos, porcentajesMap) -
          contarAsignados(a.id, asistentesActivos, porcentajesMap),
      )
    default:
      return ordenados.sort((a, b) => a.nombre.localeCompare(b.nombre))
  }
}

function coloresIndicador(asignados, total) {
  if (total === 0) return { pill: 'bg-surface-2 text-ink/40' }
  if (asignados === total) return { pill: 'bg-green/15 text-green' }
  if (asignados / total >= 0.5) return { pill: 'bg-purple-300/15 text-purple-300' }
  return { pill: 'bg-surface-2 text-ink/50' }
}

function CampoColapsable({ abierto, children }) {
  return (
    <div
      className={`grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
        abierto ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  )
}

function FilaAsistentePorcentaje({ servicioId, asistente, porcentajeActual, onGuardar }) {
  const [bloqueado, setBloqueado] = useState(true)
  const [valor, setValor] = useState(porcentajeActual != null ? String(porcentajeActual) : '')

  useEffect(() => {
    setValor(porcentajeActual != null ? String(porcentajeActual) : '')
    setBloqueado(true)
  }, [porcentajeActual])

  async function confirmarYBloquear() {
    setBloqueado(true)
    await onGuardar(asistente.id, valor)
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 p-2.5">
      <span className="min-w-0 flex-1 truncate text-sm text-ink">
        {asistente.nombres_completos}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex items-center gap-1">
          <input
            type="number"
            inputMode="numeric"
            min="0"
            max="100"
            value={valor}
            disabled={bloqueado}
            placeholder="—"
            onChange={(evento) => setValor(evento.target.value)}
            onBlur={() => {
              if (!bloqueado) confirmarYBloquear()
            }}
            onKeyDown={(evento) => {
              if (evento.key === 'Enter') evento.target.blur()
            }}
            className="w-14 rounded-lg border border-border bg-surface px-2 py-1 text-right font-mono text-sm text-ink outline-none focus:border-purple-300 disabled:text-ink/40"
          />
          <span className="text-xs text-ink/40">%</span>
        </div>
        <button
          type="button"
          onClick={() => (bloqueado ? setBloqueado(false) : confirmarYBloquear())}
          aria-label={bloqueado ? 'Desbloquear' : 'Bloquear y guardar'}
          className="p-1 text-ink/40 transition-colors hover:text-purple-300"
        >
          {bloqueado ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5 text-purple-300" />}
        </button>
      </div>
    </div>
  )
}

function TarjetaServicioPorcentaje({ servicio, asistentesActivos, porcentajesMap, onGuardar }) {
  const [abierto, setAbierto] = useState(false)

  const asignados = asistentesActivos.filter((a) =>
    porcentajesMap.has(`${servicio.id}_${a.id}`),
  ).length
  const total = asistentesActivos.length
  const colores = coloresIndicador(asignados, total)

  return (
    <div className="rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => setAbierto((valor) => !valor)}
        className="flex w-full items-center gap-2 p-3 text-left"
      >
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{servicio.nombre}</p>
        <span className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-xs font-medium ${colores.pill}`}>
          {asignados}/{total}
        </span>
        <ArrowBigDown
          className={`h-4 w-4 shrink-0 text-ink/40 transition-transform duration-300 ${
            abierto ? 'rotate-180' : ''
          }`}
        />
      </button>

      <CampoColapsable abierto={abierto}>
        <div className="space-y-2 border-t border-border p-3">
          {total === 0 ? (
            <p className="text-center text-sm text-ink/40">No hay asistentes activas.</p>
          ) : (
            asistentesActivos.map((asistente) => (
              <FilaAsistentePorcentaje
                key={asistente.id}
                servicioId={servicio.id}
                asistente={asistente}
                porcentajeActual={porcentajesMap.get(`${servicio.id}_${asistente.id}`) ?? null}
                onGuardar={(asistenteId, valor) => onGuardar(servicio.id, asistenteId, valor)}
              />
            ))
          )}
        </div>
      </CampoColapsable>
    </div>
  )
}

export default function Porcentajes() {
  const { mostrarToast } = useToast()

  const [servicios, setServicios] = useState([])
  const [asistentes, setAsistentes] = useState([])
  const [porcentajes, setPorcentajes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState('nombre-asc')

  async function cargarTodo() {
    setCargando(true)
    const [resServicios, resAsistentes, resPorcentajes] = await Promise.all([
      supabase.from('servicios').select('id, nombre').order('nombre'),
      supabase
        .from('asistentes')
        .select('id, nombres_completos')
        .eq('activo', true)
        .order('nombres_completos'),
      supabase.from('porcentajes').select('servicio_id, asistente_id, porcentaje'),
    ])

    if (resServicios.error || resAsistentes.error || resPorcentajes.error) {
      setError('No se pudo cargar la información de porcentajes.')
    } else {
      setError(null)
      setServicios(resServicios.data ?? [])
      setAsistentes(resAsistentes.data ?? [])
      setPorcentajes(resPorcentajes.data ?? [])
    }
    setCargando(false)
  }

  async function cargarPorcentajes() {
    const { data, error: errorConsulta } = await supabase
      .from('porcentajes')
      .select('servicio_id, asistente_id, porcentaje')

    if (!errorConsulta) setPorcentajes(data ?? [])
  }

  useEffect(() => {
    cargarTodo()
  }, [])

  const porcentajesMap = useMemo(() => {
    const mapa = new Map()
    porcentajes.forEach((p) => mapa.set(`${p.servicio_id}_${p.asistente_id}`, p.porcentaje))
    return mapa
  }, [porcentajes])

  async function guardarPorcentaje(servicioId, asistenteId, valorTexto) {
    const texto = valorTexto.trim()

    if (texto === '') {
      const { data: eliminados, error: errorEliminar } = await supabase
        .from('porcentajes')
        .delete()
        .eq('servicio_id', servicioId)
        .eq('asistente_id', asistenteId)
        .select('servicio_id')

      if (errorEliminar) {
        mostrarToast('No se pudo quitar la asignación.', 'error')
        return
      }
      if (eliminados.length > 0) {
        mostrarToast('Asignación quitada.', 'info')
        cargarPorcentajes()
      }
      return
    }

    const valor = parseFloat(texto)
    if (Number.isNaN(valor) || valor < 0 || valor > 100) {
      mostrarToast('El porcentaje debe estar entre 0 y 100.', 'error')
      cargarPorcentajes()
      return
    }

    const { error: errorGuardado } = await supabase
      .from('porcentajes')
      .upsert(
        { servicio_id: servicioId, asistente_id: asistenteId, porcentaje: valor },
        { onConflict: 'servicio_id,asistente_id' },
      )

    if (errorGuardado) {
      mostrarToast('No se pudo guardar el porcentaje.', 'error')
      return
    }

    mostrarToast('Porcentaje guardado.', 'exito')
    cargarPorcentajes()
  }

  const filtrados = busqueda.trim()
    ? servicios.filter((servicio) =>
        servicio.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()),
      )
    : servicios

  const filtradosOrdenados = ordenarServicios(filtrados, orden, asistentes, porcentajesMap)

  const placeholderBuscador = useTextoEscritura('Buscar servicio...')
  const { soportado: vozSoportada, escuchando, alternar: alternarVoz, onErrorRef: onErrorVozRef } =
    useReconocimientoVoz((texto) => setBusqueda(texto))
  onErrorVozRef.current = (codigoError) => {
    if (codigoError === 'not-allowed' || codigoError === 'audio-capture') {
      mostrarToast('No se pudo acceder al micrófono.', 'error')
    }
  }

  return (
    <div className="p-3 pb-6">
      {/* Buscador: fijo arriba al hacer scroll */}
      <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 bg-bg px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40">
            <IconoBuscar />
          </span>
          <input
            type="text"
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
            onKeyDown={(evento) => {
              if (evento.key === 'Escape') setBusqueda('')
            }}
            placeholder={placeholderBuscador}
            className="w-full rounded-lg border border-border bg-surface-2 py-2.5 pl-10 pr-9 font-mono text-sm text-ink outline-none placeholder:text-xs placeholder:text-ink/40 focus:border-purple-300"
          />
          {busqueda && (
            <button
              type="button"
              onClick={() => setBusqueda('')}
              aria-label="Limpiar búsqueda"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 transition-colors hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {vozSoportada && (
          <button
            type="button"
            onClick={alternarVoz}
            aria-label={escuchando ? 'Detener búsqueda por voz' : 'Buscar por voz'}
            className={`flex shrink-0 items-center justify-center rounded-lg border p-2.5 transition-colors ${
              escuchando
                ? 'animate-pulse border-red bg-red/10 text-red'
                : 'border-dashed border-border-strong text-ink/70 hover:border-purple-300 hover:text-purple-300'
            }`}
          >
            <Mic className="h-4 w-4" />
          </button>
        )}

        <SelectorOrden opciones={OPCIONES_ORDEN} valor={orden} onCambiar={setOrden} tema="purple-300" />
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/40">Cargando servicios...</p>
      ) : filtrados.length === 0 ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/40">
          No se encontraron servicios.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtradosOrdenados.map((servicio) => (
            <TarjetaServicioPorcentaje
              key={servicio.id}
              servicio={servicio}
              asistentesActivos={asistentes}
              porcentajesMap={porcentajesMap}
              onGuardar={guardarPorcentaje}
            />
          ))}
        </div>
      )}
    </div>
  )
}
