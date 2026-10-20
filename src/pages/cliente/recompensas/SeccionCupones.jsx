import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import TarjetaCupon from '../../../components/TarjetaCupon.jsx'
import { useCuponesNuevos } from '../../../hooks/useCuponesNuevos.js'
import { useCerrarConEscape } from '../../../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../../../hooks/useModalA11y.js'
import { ETIQUETAS_ORIGEN_CUPON, estadoEfectivoCupon, formatearValorCupon } from '../../../lib/cupones.js'
import { formatearSoles } from '../../../lib/moneda.js'
import { AvisoError, Filtro, Pildora } from './ui.jsx'
import { REGLA_CUPONES, REGLA_PROTECCION, fechaLima } from './lib.js'

const SIN_CUPONES = []

const FILTROS = [
  { clave: 'todos', label: 'Todos' },
  { clave: 'DISPONIBLE', label: 'Disponibles' },
  { clave: 'VENCIDO', label: 'Vencidos' },
  { clave: 'CANJEADO', label: 'Utilizados' },
  { clave: 'ANULADO', label: 'Anulados' },
]

// "Muéstralo en caja": el código en grande para que la cajera lo lea.
// Va por portal dentro de .landing-web (ahí viven las variables --lw-*
// y el <main> del portal tiene overflow-hidden, ver CLAUDE.md).
function ModalCaja({ cupon, onCerrar }) {
  const panelRef = useRef(null)
  useModalA11y(panelRef)
  useCerrarConEscape(onCerrar)

  const contenido = (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/70 px-4 pb-6 pt-24">
      <div
        ref={panelRef}
        className="lw-bar flex w-full max-w-[440px] flex-col gap-4 rounded-lg border border-white/10 p-7 text-center"
      >
        <span className="text-[11px] sm:text-xs uppercase tracking-[0.2em] text-white/50">Muéstralo en caja</span>
        <h2 className="sm:text-xl text-xl font-semibold leading-snug text-white">{formatearValorCupon(cupon)}</h2>
        <div className="break-all rounded-lg border border-dashed border-[var(--lw-gold)] px-3 py-4 font-mono text-3xl font-bold tracking-[0.12em] text-white">
          {cupon.codigo}
        </div>
        <span className="text-[13px] sm:text-sm text-white/60">
          {ETIQUETAS_ORIGEN_CUPON[cupon.origen] ?? cupon.origen}
        </span>
        <button
          type="button"
          onClick={onCerrar}
          className="min-h-11 rounded-full bg-white px-6 text-sm font-semibold text-[#0b0b0c] transition-colors hover:bg-[var(--lw-gold)]"
        >
          Cerrar
        </button>
      </div>
    </div>
  )

  const objetivo = document.querySelector('.landing-web')
  return objetivo ? createPortal(contenido, objetivo) : contenido
}

// Mis cupones — las mismas tarjetas de siempre (TarjetaCupon, con sus
// efectos por nivel) en 2 columnas de máx. 440 px, datos reales de
// mis_cupones(). Los estados que el backend todavía no tiene (vencido)
// no se muestran. Las «Ofertas del salón» ya no se listan aquí.
// Condiciones congeladas con las que se emitió el cupón (Fase 2): vigencia, alcance,
// mínimo, tope y nivel. Los cupones anteriores no traen esos datos y no muestran nada.
function CondicionesCupon({ cupon }) {
  const partes = []
  if (cupon.nombre_premio) partes.push(cupon.nombre_premio)
  if (cupon.tipo_descuento === 'SERVICIO') partes.push(`Servicio: ${cupon.servicio_nombre ?? 'seleccionado'}`)
  else if (cupon.alcance === 'SERVICIOS') partes.push('Solo servicios')
  else if (cupon.alcance === 'PRODUCTOS') partes.push('Solo productos')
  if (cupon.minimo_compra) partes.push(`Compra mínima ${formatearSoles(cupon.minimo_compra)}`)
  if (cupon.tope) partes.push(`Descuento máximo ${formatearSoles(cupon.tope)}`)
  if (cupon.nivel_minimo && cupon.nivel_minimo !== 'BASICO') partes.push(`Desde ${cupon.nivel_minimo === 'VIP' ? 'VIP' : 'Premium'}`)
  const vigencia = cupon.vigente_hasta
    ? `${cupon.vencido ? 'Venció' : 'Vence'} el ${fechaLima(cupon.vigente_hasta)}`
    : cupon.nombre_premio
      ? 'Sin vencimiento'
      : null
  if (vigencia) partes.push(vigencia)
  if (partes.length === 0) return null
  return <p className="px-1 pt-1 text-[11px] sm:text-xs leading-snug text-white/50">{partes.join(' · ')}</p>
}

export default function SeccionCupones({ cupones: recursoCupones, onReintentarCupones, programaActivo = false }) {
  const [filtro, setFiltro] = useState('todos')
  const [enCaja, setEnCaja] = useState(null)
  // QA-039: la consulta distingue cargando / error / vacío.
  const cuponesOk = recursoCupones.estado === 'ok'
  const cupones = cuponesOk ? recursoCupones.datos : SIN_CUPONES
  const cuponesNuevos = useCuponesNuevos(cupones)

  const visibles = useMemo(
    () => {
      if (filtro === 'todos') return cupones
      // QA-078: la misma disponibilidad efectiva que muestra la tarjeta (incluye el vencimiento).
      if (filtro === 'VENCIDO') return cupones.filter((c) => estadoEfectivoCupon(c).estado === 'VENCIDO')
      if (filtro === 'DISPONIBLE') return cupones.filter((c) => estadoEfectivoCupon(c).utilizable)
      return cupones.filter((c) => c.estado === filtro)
    },
    [cupones, filtro],
  )

  return (
    <section className="flex flex-col gap-5">
      {recursoCupones.estado === 'error' && (
        <AvisoError
          titulo="No pudimos cargar tus cupones"
          texto="Esto no significa que no tengas cupones: solo no pudimos leerlos ahora. No se modificó ningún cupón."
          onReintentar={onReintentarCupones}
        />
      )}

      {recursoCupones.estado === 'cargando' && (
        <div aria-busy="true" aria-label="Cargando tus cupones" className="grid justify-center gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),440px))]">
          <div className="h-16 animate-pulse bg-white/5" />
          <div className="h-16 animate-pulse bg-white/5" />
        </div>
      )}

      {cuponesOk && (
        <>
          <div className="flex flex-wrap gap-2">
            {FILTROS.map((f) => (
              <Filtro key={f.clave} activo={filtro === f.clave} onClick={() => setFiltro(f.clave)}>
                {f.label}
              </Filtro>
            ))}
          </div>

          {visibles.length === 0 ? (
            <div className="liquid-glass rounded-none p-8 text-center text-sm leading-relaxed text-white/50">
              No tienes cupones en esta vista. Obtén uno completando tu tarjeta de sellos.
            </div>
          ) : (
            <div className="grid items-start justify-center gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),440px))]">
              {visibles.map((cupon) => (
                <div key={cupon.id} className="min-w-0">
                  <TarjetaCupon
                    cupon={cupon}
                    esNuevo={cuponesNuevos.has(cupon.id)}
                    onMostrarEnCaja={setEnCaja}
                  />
                  <CondicionesCupon cupon={cupon} />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {programaActivo ? (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-1 border border-white/10 px-5 py-4 text-[13px] sm:text-sm leading-relaxed text-white/60">
          <span>{REGLA_CUPONES}</span>
          <span>{REGLA_PROTECCION}</span>
          <span>Cada cupón conserva las condiciones y la vigencia con las que se emitió; algunos no vencen.</span>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-x-3 gap-y-2 border border-white/10 px-5 py-4 text-[13px] sm:text-sm leading-relaxed text-white/60">
          <Pildora>Propuesta pendiente</Pildora>
          Los cupones nuevos vencerían a los 60 días de emitidos. Los cupones anteriores mantienen su vigencia original.
        </div>
      )}

      {enCaja && <ModalCaja cupon={enCaja} onCerrar={() => setEnCaja(null)} />}
    </section>
  )
}
