import { useEffect, useRef, useState } from 'react'
import { Pencil, Trash2, Plus, CheckCheck, HandCoins, Filter, Coins, X } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { useDebounce } from '../hooks/useDebounce.js'
import { formatearSoles, redondear2, sumarMontos } from '../lib/moneda.js'
import BarraBusqueda from '../components/BarraBusqueda.jsx'
import SelectorOrden from '../components/SelectorOrden.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import ModalDeuda from '../components/ModalDeuda.jsx'
import ModalPagoDeuda from '../components/ModalPagoDeuda.jsx'
import { EsqueletoGrupos } from '../components/Esqueleto.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'

const OPCIONES_FILTRO = [
  { id: 'todas', label: 'Todas' },
  { id: 'pendientes', label: 'Pendientes' },
  { id: 'cobradas', label: 'Cobradas' },
]

function formatearFecha(fechaIso) {
  if (!fechaIso) return null
  const [anio, mes, dia] = fechaIso.split('-')
  return `${dia}/${mes}/${anio}`
}

// Columnas según el ancho (mismos cortes que sm/lg de Tailwind).
function useNumeroColumnas() {
  const calcular = () => (window.matchMedia('(min-width: 1024px)').matches ? 3 : window.matchMedia('(min-width: 640px)').matches ? 2 : 1)
  const [numero, setNumero] = useState(calcular)
  useEffect(() => {
    const consultas = ['(min-width: 640px)', '(min-width: 1024px)'].map((q) => window.matchMedia(q))
    const actualizar = () => setNumero(calcular())
    consultas.forEach((c) => c.addEventListener('change', actualizar))
    return () => consultas.forEach((c) => c.removeEventListener('change', actualizar))
  }, [])
  return numero
}

function pagadoDe(deuda) {
  return sumarMontos(deuda.deuda_pagos ?? [], (p) => p.monto)
}

function saldoDe(deuda) {
  return Math.max(0, redondear2(deuda.monto - pagadoDe(deuda)))
}

// Fecha del último pago (los pagos guardan 'YYYY-MM-DD', así que el orden alfabético sirve).
function fechaCobro(deuda) {
  const fechas = (deuda.deuda_pagos ?? []).map((p) => p.fecha).sort()
  return fechas[fechas.length - 1] ?? null
}

export default function Deudas({ activo = true }) {
  const { mostrarToast } = useToast()
  const numeroColumnas = useNumeroColumnas()

  const [deudas, setDeudas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const busquedaDebounced = useDebounce(busqueda, 300)
  const [filtroEstado, setFiltroEstado] = useState('todas')
  const [modalDeuda, setModalDeuda] = useState(null) // null | 'nuevo' | deuda
  const [deudaAEliminar, setDeudaAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)
  const [deudaAPagar, setDeudaAPagar] = useState(null)
  const [pagoAAnular, setPagoAAnular] = useState(null) // { deuda, pago }
  const [anulando, setAnulando] = useState(false)
  const primeraCargaHecha = useRef(false)
  const panelEliminarRef = useRef(null)

  const panelAnularRef = useRef(null)

  useCerrarConEscape(() => setDeudaAEliminar(null), Boolean(deudaAEliminar))
  useModalA11y(panelEliminarRef, Boolean(deudaAEliminar))
  useCerrarConEscape(() => setPagoAAnular(null), Boolean(pagoAAnular))
  useModalA11y(panelAnularRef, Boolean(pagoAAnular))

  async function cargarDeudas(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)

    let consulta = supabase
      .from('deudas')
      .select('id, cliente_id, concepto, monto, fecha, estado, nota, clientes!inner(nombre), deuda_pagos(id, monto, fecha, nota, creado_en)')
      .order('fecha', { ascending: false })
      .order('creado_en', { ascending: false })

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

  async function confirmarAnularPago() {
    if (!pagoAAnular) return
    setAnulando(true)
    const { error: errorAnular } = await supabase.rpc('anular_pago_deuda', {
      p_pago_id: pagoAAnular.pago.id,
    })
    setAnulando(false)
    setPagoAAnular(null)

    if (errorAnular) {
      mostrarToast('No se pudo anular el pago.', 'error')
      return
    }
    mostrarToast('Pago anulado.', 'exito')
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

  // Pendientes: lo que falta cobrar (saldo). Cobradas/Todas: monto original.
  // Tarjetas de alto distinto: se reparten por columnas (en orden, izquierda a derecha) para
  // que no queden huecos como pasaba con la grilla de filas de alto fijo.
  const columnas = Array.from({ length: numeroColumnas }, (_, c) => deudas.filter((_, i) => i % numeroColumnas === c))
  const totalVisible = sumarMontos(deudas, (d) => (filtroEstado === 'pendientes' ? saldoDe(d) : d.monto))

  return (
    <div
      className="animate-entrada-pestana px-(--separador-vertical) pb-6 pt-0 lg:mx-auto lg:w-full lg:max-w-(--ancho-pestana)"
      style={{ '--color-foco': 'var(--color-purple-300)' }}
    >
      {/* Buscador + filtro + Nueva deuda: fijos arriba al hacer scroll */}
      <div className="sticky top-0 z-10 -mx-(--separador-vertical) flex items-center gap-2 bg-bg px-(--separador-vertical) pb-2 pt-(--separador-horizontal)">
        <BarraBusqueda
          valor={busqueda}
          onCambiar={setBusqueda}
          placeholder="Buscar por cliente..."
          tema="purple-300"
          sinBorde
        />

        <SelectorOrden
          opciones={OPCIONES_FILTRO}
          valor={filtroEstado}
          onCambiar={setFiltroEstado}
          tema="purple-300"
          icono={Filter}
          ariaLabel="Filtrar"
          sinBorde
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
        <div className="mt-4 flex items-start gap-3">
          {columnas.map((columna, indice) => (
            <div key={indice} className="flex min-w-0 flex-1 flex-col gap-3">
          {columna.map((deuda) => {
            const cobrada = deuda.estado === 'COBRADA'
            const pagado = pagadoDe(deuda)
            const saldo = saldoDe(deuda)
            const pagos = [...(deuda.deuda_pagos ?? [])].sort((a, b) =>
              a.fecha === b.fecha ? a.creado_en.localeCompare(b.creado_en) : a.fecha.localeCompare(b.fecha),
            )

            return (
              <div
                key={deuda.id}
                className={`rounded-lg border bg-surface p-3 transition-opacity ${
                  cobrada ? 'border-border' : 'border-amber/30'
                }`}
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
                    {cobrada
                      ? `Cobrada${fechaCobro(deuda) ? ` · ${formatearFecha(fechaCobro(deuda))}` : ''}`
                      : pagado > 0
                        ? 'Pago parcial'
                        : 'Pendiente'}
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

                {pagos.length > 0 && (
                  <div className="mt-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs">
                    <p className="font-medium text-ink/70">Pagos</p>
                    <ul className="mt-1 space-y-0.5">
                      {pagos.map((pago) => (
                        <li key={pago.id} className="flex items-center justify-between gap-2 text-ink/70">
                          <span className="font-mono">{formatearFecha(pago.fecha)}</span>
                          <span className="flex items-center gap-1">
                            <span className="font-mono font-semibold text-green">{formatearSoles(pago.monto)}</span>
                            <button
                              type="button"
                              onClick={() => setPagoAAnular({ deuda, pago })}
                              title="Anular pago"
                              aria-label="Anular pago"
                              className="flex h-6 w-6 items-center justify-center rounded text-ink/40 transition-colors hover:text-red"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                    {!cobrada && (
                      <p className="mt-1 flex justify-between border-t border-border pt-1 text-ink/70">
                        <span>Debe</span>
                        <span className="font-mono font-semibold text-amber">{formatearSoles(saldo)}</span>
                      </p>
                    )}
                  </div>
                )}

                {deuda.nota && (
                  <p className="mt-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-ink/70">
                    {deuda.nota}
                  </p>
                )}

                <div className="mt-3 flex items-center justify-end gap-1.5">
                  {!cobrada && (
                    <>
                      <BotonAccion
                        icono={Coins}
                        texto="Pago parcial"
                        color="morado"
                        onClick={() => setDeudaAPagar(deuda)}
                      />
                      <BotonAccion
                        icono={CheckCheck}
                        texto="Cobrado"
                        color="verde"
                        onClick={() => setDeudaAPagar(deuda)}
                      />
                    </>
                  )}
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
          ))}
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

      {deudaAPagar && (
        <ModalPagoDeuda
          deuda={deudaAPagar}
          saldo={saldoDe(deudaAPagar)}
          onCerrar={() => setDeudaAPagar(null)}
          onGuardado={(quedoCobrada) => {
            setDeudaAPagar(null)
            mostrarToast(quedoCobrada ? 'Deuda cobrada.' : 'Pago registrado.', 'exito')
            cargarDeudas(undefined, true)
          }}
        />
      )}

      {pagoAAnular && (
        <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
          <div ref={panelAnularRef} className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
            <h2 className="text-base font-semibold text-ink">¿Anular este pago?</h2>
            <p className="mt-1 text-sm text-ink/60">
              Se quitará el pago de {formatearSoles(pagoAAnular.pago.monto)} del{' '}
              {formatearFecha(pagoAAnular.pago.fecha)} y el saldo de la deuda aumentará.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setPagoAAnular(null)}
                disabled={anulando}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarAnularPago}
                disabled={anulando}
                className="flex-1 rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10 disabled:opacity-40"
              >
                {anulando ? 'Anulando...' : 'Sí, anular'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deudaAEliminar && (
        <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
          <div ref={panelEliminarRef} className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
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
