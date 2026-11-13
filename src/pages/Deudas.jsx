import { useEffect, useRef, useState } from 'react'
import { Pencil, Trash2, Plus, CheckCheck, HandCoins, Filter, Coins, X, NotebookPen, Check, Ban } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useToast } from '../context/ToastContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
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
import { useEstadoVista } from '../lib/estadoVista.js'

const OPCIONES_FILTRO = [
  { id: 'todas', label: 'Todas' },
  { id: 'pendientes', label: 'Pendientes' },
  { id: 'cobradas', label: 'Cobradas' },
  { id: 'por_confirmar', label: 'Por confirmar' },
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

// Notas de cobro que la cajera/encargada dejó y la administradora aún no revisa (más antiguas primero).
function notasPendientesDe(deuda) {
  return (deuda.deuda_notas_cobro ?? [])
    .filter((n) => n.estado === 'PENDIENTE')
    .sort((a, b) => a.creado_en.localeCompare(b.creado_en))
}

// Fecha del último pago (los pagos guardan 'YYYY-MM-DD', así que el orden alfabético sirve).
function fechaCobro(deuda) {
  const fechas = (deuda.deuda_pagos ?? []).map((p) => p.fecha).sort()
  return fechas[fechas.length - 1] ?? null
}

export default function Deudas({ activo = true }) {
  const { mostrarToast } = useToast()
  // Cajera y Encargada solo consultan y dejan notas de cobro; crear/editar/eliminar/cobrar es de la admin
  // (la base lo impone igual: migración 20261112000001_deudas_notas_cobro).
  const { rol } = useAuth()
  const esAdmin = rol === 'ADMINISTRADOR'
  const numeroColumnas = useNumeroColumnas()

  const [deudas, setDeudas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [busqueda, setBusqueda] = useEstadoVista('/deudas:busqueda', '')
  const busquedaDebounced = useDebounce(busqueda, 300)
  const [filtroEstado, setFiltroEstado] = useEstadoVista('/deudas:filtroEstado', 'todas')
  const [modalDeuda, setModalDeuda] = useState(null) // null | 'nuevo' | deuda
  const [deudaAEliminar, setDeudaAEliminar] = useState(null)
  const [eliminando, setEliminando] = useState(false)
  const [deudaAPagar, setDeudaAPagar] = useState(null)
  const [deudaANotar, setDeudaANotar] = useState(null)
  const [notaAConfirmar, setNotaAConfirmar] = useState(null) // { deuda, nota }
  const [notaARechazar, setNotaARechazar] = useState(null) // { deuda, nota }
  const [rechazando, setRechazando] = useState(false)
  const [pagoAAnular, setPagoAAnular] = useState(null) // { deuda, pago }
  const [anulando, setAnulando] = useState(false)
  const primeraCargaHecha = useRef(false)
  const panelEliminarRef = useRef(null)

  const panelAnularRef = useRef(null)
  const panelRechazarRef = useRef(null)

  useCerrarConEscape(() => setDeudaAEliminar(null), Boolean(deudaAEliminar))
  useModalA11y(panelEliminarRef, Boolean(deudaAEliminar))
  useCerrarConEscape(() => setPagoAAnular(null), Boolean(pagoAAnular))
  useModalA11y(panelAnularRef, Boolean(pagoAAnular))
  useCerrarConEscape(() => setNotaARechazar(null), Boolean(notaARechazar))
  useModalA11y(panelRechazarRef, Boolean(notaARechazar))

  async function cargarDeudas(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)

    let consulta = supabase
      .from('deudas')
      .select('id, cliente_id, concepto, monto, fecha, estado, nota, clientes!inner(nombre), deuda_pagos(id, monto, fecha, nota, creado_en), deuda_notas_cobro(id, monto, fecha, nota, estado, creado_por_nombre, creado_en, pago_id)')
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
      const filas = data ?? []
      setDeudas(filtroEstado === 'por_confirmar' ? filas.filter((d) => notasPendientesDe(d).length > 0) : filas)
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

  async function confirmarRechazarNota() {
    if (!notaARechazar) return
    setRechazando(true)
    const { error: errorRechazar } = await supabase.rpc('rechazar_nota_cobro_deuda', {
      p_nota_id: notaARechazar.nota.id,
    })
    setRechazando(false)
    setNotaARechazar(null)

    if (errorRechazar) {
      mostrarToast(errorRechazar.code === 'P0001' ? errorRechazar.message : 'No se pudo rechazar la nota.', 'error')
      return
    }
    mostrarToast('Nota de cobro rechazada.', 'exito')
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
  const notasPorConfirmar = deudas.reduce((total, d) => total + notasPendientesDe(d).length, 0)

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

        {esAdmin && (
          <button
            type="button"
            onClick={() => setModalDeuda('nuevo')}
            className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-purple-300 px-3 py-2.5 text-sm font-semibold text-bg lg:flex"
          >
            <Plus className="h-4 w-4" />
            <span>Nueva deuda</span>
          </button>
        )}
      </div>

      <p className="mt-3 text-sm text-ink/60">
        {OPCIONES_FILTRO.find((o) => o.id === filtroEstado)?.label}:{' '}
        <span className="font-mono font-semibold text-purple-300">{deudas.length}</span>
        {' · '}
        <span className="font-mono font-semibold text-purple-300">{formatearSoles(totalVisible)}</span>
      </p>

      {notasPorConfirmar > 0 && filtroEstado !== 'por_confirmar' && (
        <button
          type="button"
          onClick={() => setFiltroEstado('por_confirmar')}
          className="mt-2 flex w-full items-center gap-2 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-left text-xs text-ink/80 transition-colors hover:border-amber"
        >
          <NotebookPen className="h-4 w-4 shrink-0 text-amber" />
          <span>
            {notasPorConfirmar === 1 ? 'Hay 1 nota de cobro' : `Hay ${notasPorConfirmar} notas de cobro`}{' '}
            {esAdmin ? 'por confirmar. Ver' : 'esperando a la administradora. Ver'}
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
      ) : deudas.length === 0 ? (
        <EstadoVacio
          icono={HandCoins}
          mensaje="No se encontraron deudas."
          accion={esAdmin ? { label: '+ Nueva deuda', onClick: () => setModalDeuda('nuevo') } : undefined}
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
            const notasPendientes = notasPendientesDe(deuda)
            // Quién cobró cada pago: si vino de una nota confirmada, quien la anotó (aunque la confirme la admin);
            // si no, lo registró la administradora directamente.
            const cobradoPor = new Map(
              (deuda.deuda_notas_cobro ?? [])
                .filter((n) => n.estado === 'CONFIRMADA' && n.pago_id)
                .map((n) => [n.pago_id, n.creado_por_nombre ?? 'Personal']),
            )
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
                          <span className="min-w-0 truncate">
                            <span className="font-mono">{formatearFecha(pago.fecha)}</span>
                            {' · '}
                            {cobradoPor.get(pago.id) ?? 'Admin'}
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="font-mono font-semibold text-green">{formatearSoles(pago.monto)}</span>
                            {esAdmin && (
                            <button
                              type="button"
                              onClick={() => setPagoAAnular({ deuda, pago })}
                              title="Anular pago"
                              aria-label="Anular pago"
                              className="flex h-6 w-6 items-center justify-center rounded text-ink/40 transition-colors hover:text-red"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                            )}
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

                {notasPendientes.length > 0 && (
                  <div className="mt-2 rounded-lg border border-amber/40 bg-amber/10 px-2.5 py-1.5 text-xs">
                    <p className="flex items-center gap-1.5 font-medium text-ink/80">
                      <NotebookPen className="h-3.5 w-3.5 text-amber" />
                      Notas de cobro por confirmar
                    </p>
                    <ul className="mt-1 space-y-1.5">
                      {notasPendientes.map((nota) => (
                        <li key={nota.id} className="text-ink/70">
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate">
                              <span className="font-mono">{formatearFecha(nota.fecha)}</span>
                              {' · '}
                              {nota.creado_por_nombre ?? 'Personal'}
                            </span>
                            <span className="flex shrink-0 items-center gap-1">
                              <span className="font-mono font-semibold text-amber">{formatearSoles(nota.monto)}</span>
                              {esAdmin && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setNotaAConfirmar({ deuda, nota })}
                                    title="Confirmar cobro"
                                    aria-label="Confirmar cobro"
                                    className="flex h-7 w-7 items-center justify-center rounded border border-border-strong text-green transition-colors hover:bg-green/10"
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setNotaARechazar({ deuda, nota })}
                                    title="Rechazar nota"
                                    aria-label="Rechazar nota"
                                    className="flex h-7 w-7 items-center justify-center rounded border border-border-strong text-red transition-colors hover:bg-red/10"
                                  >
                                    <Ban className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                            </span>
                          </div>
                          {nota.nota && <p className="mt-0.5 text-ink/60">«{nota.nota}»</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {deuda.nota && (
                  <p className="mt-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-ink/70">
                    {deuda.nota}
                  </p>
                )}

                <div className="mt-3 flex items-center justify-end gap-1.5">
                  {!esAdmin && !cobrada && (
                    <BotonAccion
                      icono={NotebookPen}
                      texto="Nota de cobro"
                      color="morado"
                      onClick={() => setDeudaANotar(deuda)}
                    />
                  )}
                  {esAdmin && !cobrada && (
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
                  {esAdmin && (
                    <>
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
                    </>
                  )}
                </div>
              </div>
            )
          })}
            </div>
          ))}
        </div>
      )}

      {esAdmin && <BotonFlotanteAgregar onClick={() => setModalDeuda('nuevo')} color="morado" label="Nueva deuda" />}

      {modalDeuda && (
        <ModalDeuda
          deuda={modalDeuda === 'nuevo' ? null : modalDeuda}
          onCerrar={() => setModalDeuda(null)}
          onGuardado={() => {
            const esNueva = modalDeuda === 'nuevo'
            setModalDeuda(null)
            mostrarToast(esNueva ? 'Deuda registrada.' : 'Deuda actualizada.', 'exito')
            cargarDeudas(undefined, true)
          }}
        />
      )}

      {deudaAPagar && (
        <ModalPagoDeuda
          deuda={deudaAPagar}
          saldo={saldoDe(deudaAPagar)}
          notasPendientes={notasPendientesDe(deudaAPagar)}
          onConfirmarNota={(nota) => {
            const deuda = deudaAPagar
            setDeudaAPagar(null)
            setNotaAConfirmar({ deuda, nota })
          }}
          onCerrar={() => setDeudaAPagar(null)}
          onGuardado={(quedoCobrada) => {
            setDeudaAPagar(null)
            mostrarToast(quedoCobrada ? 'Deuda cobrada.' : 'Pago registrado.', 'exito')
            cargarDeudas(undefined, true)
          }}
        />
      )}

      {deudaANotar && (
        <ModalPagoDeuda
          modo="nota"
          deuda={deudaANotar}
          saldo={saldoDe(deudaANotar)}
          onCerrar={() => setDeudaANotar(null)}
          onGuardado={() => {
            setDeudaANotar(null)
            mostrarToast('Nota de cobro enviada a la administradora.', 'exito')
            cargarDeudas(undefined, true)
          }}
        />
      )}

      {notaAConfirmar && (
        <ModalPagoDeuda
          modo="confirmar"
          deuda={notaAConfirmar.deuda}
          notaCobro={notaAConfirmar.nota}
          saldo={saldoDe(notaAConfirmar.deuda)}
          onCerrar={() => setNotaAConfirmar(null)}
          onGuardado={(quedoCobrada) => {
            setNotaAConfirmar(null)
            mostrarToast(quedoCobrada ? 'Cobro confirmado: deuda cobrada.' : 'Cobro confirmado.', 'exito')
            cargarDeudas(undefined, true)
          }}
        />
      )}

      {notaARechazar && (
        <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
          <div ref={panelRechazarRef} className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)">
            <h2 className="text-base font-semibold text-ink">¿Rechazar esta nota de cobro?</h2>
            <p className="mt-1 text-sm text-ink/60">
              La nota de {formatearSoles(notaARechazar.nota.monto)} de {notaARechazar.nota.creado_por_nombre ?? 'personal'} se
              descarta y la deuda de {notaARechazar.deuda.clientes.nombre} no cambia.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setNotaARechazar(null)}
                disabled={rechazando}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmarRechazarNota}
                disabled={rechazando}
                className="flex-1 rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10 disabled:opacity-40"
              >
                {rechazando ? 'Rechazando...' : 'Sí, rechazar'}
              </button>
            </div>
          </div>
        </div>
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
