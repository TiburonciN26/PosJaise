import { useEffect, useRef, useState } from 'react'
import { Pencil, Trash2, Plus, CheckCheck, RotateCcw, HandCoins, Filter } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { useDebounce } from '../hooks/useDebounce.js'
import { formatearSoles, sumarMontos } from '../lib/moneda.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import ModalDeuda from '../components/ModalDeuda.jsx'
import { EsqueletoGrupos } from '../components/Esqueleto.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'

const OPCIONES_FILTRO = [
  { id: 'pendientes', label: 'Pendientes' },
  { id: 'cobradas', label: 'Cobradas' },
  { id: 'todas', label: 'Todas' },
]

function formatearFecha(fechaIso) {
  if (!fechaIso) return null
  const [anio, mes, dia] = fechaIso.split('-')
  return `${dia}/${mes}/${anio}`
}

export default function Deudas({ activo = true }) {
  const { mostrarToast } = useToast()

  const [deudas, setDeudas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const busquedaDebounced = useDebounce(busqueda, 300)
  const [filtroEstado, setFiltroEstado] = useState('pendientes')
  const [modalDeuda, setModalDeuda] = useState(null) // null | 'nuevo' | deuda
  const [deudaAEliminar, setDeudaAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)
  const [idsActualizando, setIdsActualizando] = useState(() => new Set())
  const primeraCargaHecha = useRef(false)
  const panelEliminarRef = useRef(null)

  useCerrarConEscape(() => setDeudaAEliminar(null), Boolean(deudaAEliminar))
  useModalA11y(panelEliminarRef, Boolean(deudaAEliminar))

  async function cargarDeudas(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)

    let consulta = supabase
      .from('deudas')
      .select('id, cliente_id, concepto, monto, fecha, estado, nota, clientes!inner(nombre)')
      .order('fecha', { ascending: true })

    if (filtroEstado === 'pendientes') consulta = consulta.eq('estado', 'PENDIENTE')
    if (filtroEstado === 'cobradas') consulta = consulta.eq('estado', 'COBRADA')
    if (busquedaDebounced.trim()) {
      consulta = consulta.ilike('clientes.nombre', `%${busquedaDebounced.trim()}%`)
    }

    const { data, error: errorConsulta } = await consulta

    if (!vigente.actual) return

    if (errorConsulta) {
      setError('No se pudieron cargar las deudas.')
    } else {
      setError(null)
      setDeudas(data ?? [])
    }
    setCargando(false)
  }

  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargarDeudas(vigente, silencioso)
    return () => {
      vigente.actual = false
    }
  }, [activo, busquedaDebounced, filtroEstado])

  async function alternarCobrada(deuda) {
    if (idsActualizando.has(deuda.id)) return
    const nuevoEstado = deuda.estado === 'PENDIENTE' ? 'COBRADA' : 'PENDIENTE'
    setIdsActualizando((anterior) => new Set(anterior).add(deuda.id))

    const { error: errorActualizar } = await supabase
      .from('deudas')
      .update({
        estado: nuevoEstado,
        cobrado_en: nuevoEstado === 'COBRADA' ? new Date().toISOString() : null,
      })
      .eq('id', deuda.id)

    setIdsActualizando((anterior) => {
      const siguiente = new Set(anterior)
      siguiente.delete(deuda.id)
      return siguiente
    })

    if (errorActualizar) {
      mostrarToast('No se pudo actualizar la deuda.', 'error')
      return
    }

    mostrarToast(nuevoEstado === 'COBRADA' ? 'Marcada como cobrada.' : 'Marcada como pendiente.', 'exito')
    // Si el filtro activo ya no incluye este estado, la fila desaparece de
    // la lista sola con un refetch en silencio (en vez de parchear el
    // array local, que la dejaría visible en un filtro donde ya no aplica).
    cargarDeudas(undefined, true)
  }

  async function confirmarEliminar() {
    if (!deudaAEliminar) return

    setEliminando(true)
    const { error: errorEliminar } = await supabase
      .from('deudas')
      .delete()
      .eq('id', deudaAEliminar.id)
    setEliminando(false)
    setDeudaAEliminar(null)

    if (errorEliminar) {
      mostrarToast('No se pudo eliminar la deuda.', 'error')
      return
    }

    mostrarToast('Deuda eliminada.', 'exito')
    setDeudas((anteriores) => anteriores.filter((d) => d.id !== deudaAEliminar.id))
  }

  const totalVisible = sumarMontos(deudas, (d) => d.monto)

  return (
    <div
      className="animate-entrada-pestana p-3 pb-6"
      style={{ '--color-foco': 'var(--color-purple-300)' }}
    >
      {/* Buscador + filtro + Nueva deuda: fijos arriba al hacer scroll */}
      <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 bg-bg px-3 py-2">
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder="Buscar por cliente..."
          tema="purple-300"
        />

        <SelectorOrden
          opciones={OPCIONES_FILTRO}
          valor={filtroEstado}
          onCambiar={setFiltroEstado}
          tema="purple-300"
          icono={Filter}
          ariaLabel="Filtrar"
        />

        <button
          type="button"
          onClick={() => setModalDeuda('nuevo')}
          className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-purple-300 px-3 py-2.5 text-sm font-semibold text-bg lg:flex"
        >
          <Plus className="h-4 w-4" />
          <span>Nueva deuda</span>
        </button>
      </div>

      <p className="mt-3 text-sm text-ink/60">
        {OPCIONES_FILTRO.find((o) => o.id === filtroEstado)?.label}:{' '}
        <span className="font-mono font-semibold text-purple-300">{deudas.length}</span>
        {' · '}
        <span className="font-mono font-semibold text-purple-300">{formatearSoles(totalVisible)}</span>
      </p>

      {error && (
        <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">
          {error}
        </p>
      )}

      {cargando ? (
        <EsqueletoGrupos />
      ) : deudas.length === 0 ? (
        <EstadoVacio
          icono={HandCoins}
          mensaje="No se encontraron deudas."
          accion={{ label: '+ Nueva deuda', onClick: () => setModalDeuda('nuevo') }}
          tema="purple-300"
        />
      ) : (
        <div className="mt-4 grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {deudas.map((deuda) => {
            const cobrada = deuda.estado === 'COBRADA'
            const actualizando = idsActualizando.has(deuda.id)

            return (
              <div
                key={deuda.id}
                className={`rounded-lg border bg-surface p-3 transition-opacity ${
                  cobrada ? 'border-border' : 'border-amber/30'
                } ${actualizando ? 'pointer-events-none opacity-50' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{deuda.clientes.nombre}</p>
                    <p className="mt-0.5 truncate text-xs text-ink/60">{deuda.concepto}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                      cobrada ? 'border-green/50 bg-green/15 text-green' : 'border-amber/50 bg-amber/15 text-amber'
                    }`}
                  >
                    {cobrada ? 'Cobrada' : 'Pendiente'}
                  </span>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-ink/60">
                    Debe desde {formatearFecha(deuda.fecha)}
                  </span>
                  <span className="font-mono text-sm font-semibold text-purple-300">
                    {formatearSoles(deuda.monto)}
                  </span>
                </div>

                {deuda.nota && (
                  <p className="mt-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-ink/70">
                    {deuda.nota}
                  </p>
                )}

                <div className="mt-3 flex items-center justify-end gap-1.5">
                  <BotonAccion
                    icono={cobrada ? RotateCcw : CheckCheck}
                    texto={cobrada ? 'Marcar pendiente' : 'Cobrado'}
                    color="verde"
                    onClick={() => alternarCobrada(deuda)}
                  />
                  <BotonAccion
                    icono={Pencil}
                    texto="Editar"
                    color="celeste"
                    onClick={() => setModalDeuda(deuda)}
                  />
                  <BotonAccion
                    icono={Trash2}
                    texto="Eliminar"
                    color="rojo"
                    onClick={() => setDeudaAEliminar(deuda)}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      <BotonFlotanteAgregar onClick={() => setModalDeuda('nuevo')} color="morado" label="Nueva deuda" />

      {modalDeuda && (
        <ModalDeuda
          deuda={modalDeuda === 'nuevo' ? null : modalDeuda}
          onCerrar={() => setModalDeuda(null)}
          onGuardado={() => {
            const esNueva = modalDeuda === 'nuevo'
            setModalDeuda(null)
            mostrarToast(esNueva ? 'Deuda registrada.' : 'Deuda actualizada.', 'exito')
            cargarDeudas()
          }}
        />
      )}

      {deudaAEliminar && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div ref={panelEliminarRef} className="w-full max-w-sm rounded-lg border border-border bg-surface p-5">
            <h2 className="text-base font-semibold text-ink">¿Eliminar esta deuda?</h2>
            <p className="mt-1 text-sm text-ink/60">Esta acción no se puede deshacer.</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setDeudaAEliminar(null)}
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
    </div>
  )
}
