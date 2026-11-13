import { useEffect, useRef, useState } from 'react'
import { Ban, Banknote, Calculator, Minus, Pencil, Plus } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useCerrarConEscape } from '../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../hooks/useModalA11y.js'
import { formatearSoles } from '../lib/moneda.js'
import { useEstadoVista } from '../lib/estadoVista.js'
import { PERIODOS, TIPOS_MOVIMIENTO, claseColorSaldo, mensajeErrorCajaChica } from '../lib/cajaChica.js'
import TarjetaResumen from '../components/TarjetaResumen.jsx'
import EsqueletoLista from '../components/Esqueleto.jsx'
import EstadoVacio from '../components/EstadoVacio.jsx'
import BotonAccion from '../components/BotonAccion.jsx'
import BotonFlotanteAgregar from '../components/BotonFlotanteAgregar.jsx'
import ModalMovimientoCajaChica from '../components/ModalMovimientoCajaChica.jsx'

// Caja chica: fondo fijo en efectivo para gastos menores (migración 20261112000012_caja_chica).
//   · administradora, cajera y encargada registran SALIDAS (cada una crea sola su gasto variable del mes);
//   · solo la administradora repone, cuenta la caja, fija el fondo y ve «Gastado este mes»;
//   · anular: la administradora cualquier salida / reposición; quien hizo una salida, la suya del mismo día (el servidor
//     manda puede_anular ya calculado para quien mira).

const RESUMEN_VACIO = { saldo: 0, fondo: 0, gastadoMes: 0 }

function formatearFechaHoraCorta(fechaIso) {
  const fecha = new Date(fechaIso)
  const dia = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'numeric', timeZone: 'America/Lima' }).format(fecha)
  const hora = new Intl.DateTimeFormat('es-PE', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Lima',
  }).format(fecha)
  return `${dia} ${hora}`
}

function BotonBarra({ icono: Icono, texto, onClick, principal = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors ${
        principal
          ? 'bg-purple-300 font-semibold text-bg'
          : 'border border-border-strong text-ink hover:border-purple-300 hover:text-purple-300'
      }`}
    >
      <Icono className="h-4 w-4 shrink-0" />
      <span>{texto}</span>
    </button>
  )
}

function FilaMovimiento({ movimiento, onAnular }) {
  const anulado = movimiento.estado === 'ANULADO'
  const tipo = TIPOS_MOVIMIENTO[movimiento.tipo] ?? { texto: movimiento.tipo, clase: 'text-ink' }
  // El motivo de los conteos ya va en el texto del tipo («Faltante», «Conteo: cuadra»); solo se repite el de las salidas.
  const detalle = [
    movimiento.tipo === 'SALIDA' ? movimiento.motivo : null,
    movimiento.usuario_nombre || 'Usuario eliminado',
    movimiento.nota,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <li
      className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 ${
        anulado ? 'border border-red/30 bg-red/5' : 'border border-border bg-surface'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-sm">
          <span className={anulado ? 'text-ink/50 line-through' : tipo.clase}>
            {tipo.texto}
            {movimiento.tipo !== 'CONTEO' && ` ${formatearSoles(Number(movimiento.monto))}`}
          </span>
          <span className="text-[11px] text-ink/50">{formatearFechaHoraCorta(movimiento.fecha)}</span>
          {anulado && (
            <span className="rounded-full bg-red/15 px-1.5 py-0.5 text-[10px] font-medium text-red">
              Anulado{movimiento.anulado_por_nombre ? ` por ${movimiento.anulado_por_nombre}` : ''}
            </span>
          )}
        </div>
        <p className={`truncate text-xs ${anulado ? 'text-ink/40 line-through' : 'text-ink/60'}`}>{detalle}</p>
      </div>
      {movimiento.puede_anular && (
        <BotonAccion plano sinBorde icono={Ban} texto="Anular" color="rojo" onClick={() => onAnular(movimiento)} />
      )}
    </li>
  )
}

export default function CajaChica({ activo = true }) {
  const { rol } = useAuth()
  const { mostrarToast } = useToast()
  const esAdmin = rol === 'ADMINISTRADOR'

  const [resumen, setResumen] = useState(RESUMEN_VACIO)
  const [movimientos, setMovimientos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState(null)
  const [periodo, setPeriodo] = useEstadoVista('/caja-chica:periodo', 'MES')

  const [modal, setModal] = useState(null) // null | 'SALIDA' | 'REPOSICION' | 'CONTEO' | 'FONDO'
  const [aAnular, setAAnular] = useState(null)
  const [anulando, setAnulando] = useState(false)

  const primeraCargaHecha = useRef(false)
  const vigenteRef = useRef({ actual: true })
  const panelAnularRef = useRef(null)

  useCerrarConEscape(() => {
    if (!anulando) setAAnular(null)
  }, Boolean(aAnular))
  useModalA11y(panelAnularRef, Boolean(aAnular))

  async function cargar(vigente = { actual: true }, silencioso = false) {
    if (!silencioso) setCargando(true)
    const [resumenRes, movimientosRes] = await Promise.all([
      supabase.rpc('resumen_caja_chica'),
      supabase.rpc('movimientos_caja_chica', { p_periodo: periodo }),
    ])
    if (!vigente.actual) return

    if (resumenRes.error || movimientosRes.error) {
      setError('No se pudo cargar la caja chica.')
      setCargando(false)
      return
    }
    setError(null)
    const fila = resumenRes.data?.[0]
    setResumen(
      fila
        ? { saldo: Number(fila.saldo ?? 0), fondo: Number(fila.fondo ?? 0), gastadoMes: Number(fila.gastado_mes ?? 0) }
        : RESUMEN_VACIO,
    )
    setMovimientos(movimientosRes.data ?? [])
    setCargando(false)
  }

  function recargar() {
    cargar(vigenteRef.current, true)
  }

  useEffect(() => {
    if (!activo) return undefined
    const vigente = { actual: true }
    vigenteRef.current = vigente
    const silencioso = primeraCargaHecha.current
    primeraCargaHecha.current = true
    cargar(vigente, silencioso)
    return () => {
      vigente.actual = false
    }
  }, [activo, periodo])

  function alGuardar(tipo, valor) {
    setModal(null)
    if (tipo === 'SALIDA') mostrarToast(`Salida registrada. Quedan ${formatearSoles(valor)}.`, 'exito')
    else if (tipo === 'REPOSICION') mostrarToast(`Caja repuesta. Saldo: ${formatearSoles(valor)}.`, 'exito')
    else if (tipo === 'FONDO') mostrarToast(`Fondo de caja chica: ${formatearSoles(valor)}.`, 'exito')
    else if (valor === 0) mostrarToast('La caja cuadra.', 'exito')
    else if (valor < 0) mostrarToast(`Faltante de ${formatearSoles(-valor)} registrado (se anotó en Gastos).`, 'info')
    else mostrarToast(`Sobrante de ${formatearSoles(valor)} registrado.`, 'info')
    recargar()
  }

  async function confirmarAnular() {
    if (!aAnular) return
    setAnulando(true)
    const { error: errorRpc } = await supabase.rpc('anular_movimiento_caja_chica', { p_id: aAnular.id })
    setAnulando(false)
    setAAnular(null)
    if (errorRpc) {
      mostrarToast(mensajeErrorCajaChica(errorRpc, 'No se pudo anular el movimiento.'), 'error')
      return
    }
    mostrarToast('Movimiento anulado.', 'exito')
    recargar()
  }

  const sinFondo = resumen.fondo <= 0 && resumen.saldo <= 0

  return (
    <div
      className="animate-entrada-pestana px-(--separador-vertical) pb-24 pt-(--separador-horizontal) lg:mx-auto lg:w-full lg:max-w-(--ancho-pestana) lg:pb-6"
      style={{ '--color-foco': 'var(--color-purple-300)' }}
    >
      <div className={`grid gap-3 ${esAdmin ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <div className="rounded-lg border border-border bg-surface p-3 text-center">
          <p className="text-xs text-ink/60">Saldo en caja</p>
          <p className={`mt-1 font-mono text-2xl font-semibold ${claseColorSaldo(resumen.saldo, resumen.fondo)}`}>
            {formatearSoles(resumen.saldo)}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-ink/50">
            {resumen.fondo > 0 ? `de ${formatearSoles(resumen.fondo)}` : 'Fondo sin fijar'}
            {esAdmin && (
              <button
                type="button"
                onClick={() => setModal('FONDO')}
                className="ml-1.5 inline-flex items-center gap-0.5 align-middle text-purple-300 hover:text-purple-300/80"
                aria-label="Cambiar el fondo"
                title="Cambiar el fondo"
              >
                <Pencil className="h-3 w-3" />
              </button>
            )}
          </p>
        </div>
        {esAdmin && (
          <div className="grid">
            <TarjetaResumen
              etiqueta="Gastado este mes"
              valor={formatearSoles(resumen.gastadoMes)}
              claseValor="text-purple-300"
              padding="p-3"
            />
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <div className="hidden lg:flex">
          <BotonBarra icono={Minus} texto="Registrar salida" principal onClick={() => setModal('SALIDA')} />
        </div>
        {esAdmin && (
          <>
            <BotonBarra icono={Plus} texto="Reponer" onClick={() => setModal('REPOSICION')} />
            <BotonBarra icono={Calculator} texto="Contar caja" onClick={() => setModal('CONTEO')} />
          </>
        )}
      </div>

      <div className="mt-4 flex gap-1 rounded-lg border border-border bg-surface p-1" role="group" aria-label="Período">
        {PERIODOS.map((opcion) => (
          <button
            key={opcion.id}
            type="button"
            onClick={() => setPeriodo(opcion.id)}
            aria-pressed={periodo === opcion.id}
            className={`flex-1 rounded-md py-1.5 text-sm transition-colors ${
              periodo === opcion.id ? 'bg-purple-300/15 font-medium text-purple-300' : 'text-ink/70 hover:bg-surface-2'
            }`}
          >
            {opcion.label}
          </button>
        ))}
      </div>

      {error && <p className="mt-3 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-sm text-red">{error}</p>}

      {cargando ? (
        <EsqueletoLista columnas={3} />
      ) : movimientos.length === 0 ? (
        <EstadoVacio
          icono={Banknote}
          tema="purple-300"
          mensaje={
            sinFondo
              ? esAdmin
                ? 'Primero fija el fondo y repón la caja con el efectivo que dejas.'
                : 'La caja chica todavía no tiene dinero. Pídele a la administradora que la reponga.'
              : 'No hay movimientos en este período.'
          }
          accion={sinFondo && esAdmin ? { label: 'Fijar el fondo', onClick: () => setModal('FONDO') } : undefined}
        />
      ) : (
        <ul className="mt-3 space-y-2">
          {movimientos.map((movimiento) => (
            <FilaMovimiento key={movimiento.id} movimiento={movimiento} onAnular={setAAnular} />
          ))}
        </ul>
      )}

      <BotonFlotanteAgregar onClick={() => setModal('SALIDA')} color="morado" label="Registrar salida" />

      {modal && (
        <ModalMovimientoCajaChica
          tipo={modal}
          saldo={resumen.saldo}
          fondo={resumen.fondo}
          onCerrar={() => setModal(null)}
          onGuardado={(valor) => alGuardar(modal, valor)}
        />
      )}

      {aAnular && (
        <div className="fixed inset-x-0 bottom-0 top-[59px] sm:top-0 z-30 flex items-start justify-center sm:items-center bg-black/60 px-4 pb-4 pt-3 sm:pt-4">
          <div
            ref={panelAnularRef}
            className="w-full max-w-sm rounded-lg border border-border bg-surface px-(--separador-vertical-secundario) py-(--separador-horizontal-secundario)"
          >
            <h2 className="text-base font-semibold text-ink">
              ¿Anular {aAnular.tipo === 'SALIDA' ? 'la salida' : 'la reposición'} de {formatearSoles(Number(aAnular.monto))}?
            </h2>
            <p className="mt-1 text-sm text-ink/60">
              {aAnular.tipo === 'SALIDA'
                ? 'El dinero vuelve al saldo y su gasto queda cancelado en Gastos. Quedará tachado en el historial.'
                : 'Ese dinero sale del saldo. Quedará tachada en el historial.'}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setAAnular(null)}
                disabled={anulando}
                className="flex-1 rounded-lg border border-border-strong py-2 text-sm text-ink transition-colors hover:border-purple-300 hover:text-purple-300 disabled:opacity-40"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={confirmarAnular}
                disabled={anulando}
                className="flex-1 rounded-lg border border-red bg-transparent py-2 text-sm font-semibold text-red transition-colors hover:bg-red/10 disabled:opacity-40"
              >
                {anulando ? 'Anulando...' : 'Sí, anular'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
