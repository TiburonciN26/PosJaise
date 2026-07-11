import { useEffect, useMemo, useRef, useState } from 'react'
import { Lock, Unlock, ArrowBigDown } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import CampoColapsable from '../components/CampoColapsable.jsx'

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
  if (total === 0) return { pill: 'bg-surface-2 text-ink/60' }
  if (asignados === total) return { pill: 'bg-green/15 text-green' }
  if (asignados / total >= 0.5) return { pill: 'bg-purple-300/15 text-purple-300' }
  return { pill: 'bg-surface-2 text-ink/50' }
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
            className="w-14 rounded-lg border border-border bg-surface px-2 py-1 text-right font-mono text-sm text-ink outline-none focus:border-purple-300 disabled:text-ink/60"
          />
          <span className="text-xs text-ink/60">%</span>
        </div>
        <button
          type="button"
          onClick={() => (bloqueado ? setBloqueado(false) : confirmarYBloquear())}
          aria-label={bloqueado ? 'Desbloquear' : 'Bloquear y guardar'}
          className="p-1 text-ink/60 transition-colors hover:text-purple-300"
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
          className={`h-4 w-4 shrink-0 text-ink/60 transition-transform duration-300 ${
            abierto ? 'rotate-180' : ''
          }`}
        />
      </button>

      <CampoColapsable abierto={abierto}>
        <div className="space-y-2 border-t border-border p-3">
          {total === 0 ? (
            <p className="text-center text-sm text-ink/60">No hay asistentes activas.</p>
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

export default function Porcentajes({ activo = true }) {
  const { mostrarToast } = useToast()

  const [servicios, setServicios] = useState([])
  const [asistentes, setAsistentes] = useState([])
  const [porcentajes, setPorcentajes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState('nombre-asc')
  const primeraCargaHecha = useRef(false)

  async function cargarTodo(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)
    const [resServicios, resAsistentes, resPorcentajes] = await Promise.all([
      supabase.from('servicios').select('id, nombre').order('nombre'),
      supabase
        .from('asistentes')
        .select('id, nombres_completos')
        .eq('activo', true)
        .order('nombres_completos'),
      supabase.from('porcentajes').select('servicio_id, asistente_id, porcentaje'),
    ])

    if (!vigente.actual) return

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
    if (!activo) return undefined
    const vigente = { actual: true }
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarTodo(vigente, silencioso)
    return () => {
      vigente.actual = false
    }
  }, [activo])

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

  return (
    <div className="p-3 pb-6">
      {/* Buscador: fijo arriba al hacer scroll */}
      <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 bg-bg px-3 py-2">
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder="Buscar servicio..."
          tema="purple-300"
        />

        <SelectorOrden opciones={OPCIONES_ORDEN} valor={orden} onCambiar={setOrden} tema="purple-300" />
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/60">Cargando servicios...</p>
      ) : filtrados.length === 0 ? (
        <p className="mt-6 text-center font-mono text-sm text-ink/60">
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
