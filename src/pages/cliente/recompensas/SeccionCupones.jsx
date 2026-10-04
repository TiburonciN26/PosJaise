import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import TarjetaCupon from '../../../components/TarjetaCupon.jsx'
import { useCuponesNuevos } from '../../../hooks/useCuponesNuevos.js'
import { useCerrarConEscape } from '../../../hooks/useCerrarConEscape.js'
import { useModalA11y } from '../../../hooks/useModalA11y.js'
import { ETIQUETAS_ORIGEN_CUPON, formatearValorCupon } from '../../../lib/cupones.js'
import { formatearSoles } from '../../../lib/moneda.js'
import { AvisoError, Encabezado, Filtro, Pildora } from './ui.jsx'
import { REGLA_CUPONES, REGLA_SERVICIOS, fechaLima } from './lib.js'

const SIN_CUPONES = []

const FILTROS = [
  { clave: 'todos', label: 'Todos' },
  { clave: 'DISPONIBLE', label: 'Disponibles' },
  { clave: 'VENCIDO', label: 'Vencidos' },
  { clave: 'CANJEADO', label: 'Utilizados' },
  { clave: 'ANULADO', label: 'Anulados' },
]

function formatearValorOferta(promocion) {
  return promocion.tipo_descuento === 'PORCENTAJE'
    ? `${promocion.valor}% dcto.`
    : `${formatearSoles(promocion.valor)} dcto.`
}

function formatearFechaOferta(fechaIso) {
  if (!fechaIso) return null
  const [anio, mes, dia] = fechaIso.split('-')
  return `${dia}/${mes}/${anio}`
}

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
        <span className="text-[11px] uppercase tracking-[0.2em] text-white/50">Muéstralo en caja</span>
        <h2 className="text-xl font-semibold leading-snug text-white">{formatearValorCupon(cupon)}</h2>
        <div className="break-all rounded-lg border border-dashed border-[var(--lw-gold)] px-3 py-4 font-mono text-3xl font-bold tracking-[0.12em] text-white">
          {cupon.codigo}
        </div>
        <span className="text-[13px] text-white/60">
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
// efectos por nivel) en 2 columnas de máx. 420 px, datos reales de
// mis_cupones(). Los estados que el backend todavía no tiene (vencido)
// no se muestran. Al final, las "Ofertas del salón" (tabla promociones)
// que antes vivían en "Cupones y ofertas".
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
  return <p className="px-1 pt-1 text-[11px] leading-snug text-white/50">{partes.join(' · ')}</p>
}

export default function SeccionCupones({ cupones: recursoCupones, promociones: recursoPromociones, onReintentarCupones, onReintentarPromociones, programaActivo = false }) {
  const [filtro, setFiltro] = useState('todos')
  const [enCaja, setEnCaja] = useState(null)
  // QA-039: cupones y ofertas son recursos independientes — cada uno
  // distingue cargando / error / vacío, y uno fallido no oculta al otro.
  const cuponesOk = recursoCupones.estado === 'ok'
  const cupones = cuponesOk ? recursoCupones.datos : SIN_CUPONES
  const cuponesNuevos = useCuponesNuevos(cupones)

  const visibles = useMemo(
    () => {
      if (filtro === 'todos') return cupones
      if (filtro === 'VENCIDO') return cupones.filter((c) => c.vencido)
      if (filtro === 'DISPONIBLE') return cupones.filter((c) => c.estado === 'DISPONIBLE' && !c.vencido)
      return cupones.filter((c) => c.estado === filtro)
    },
    [cupones, filtro],
  )

  return (
    <section className="flex flex-col gap-5">
      <Encabezado
        titulo="Mis cupones"
        texto="Aquí están todos tus cupones: por sellos, referidos y promociones. Muéstralos en caja al pagar."
      />

      {recursoCupones.estado === 'error' && (
        <AvisoError
          titulo="No pudimos cargar tus cupones"
          texto="Esto no significa que no tengas cupones: solo no pudimos leerlos ahora. No se modificó ningún cupón."
          onReintentar={onReintentarCupones}
        />
      )}

      {recursoCupones.estado === 'cargando' && (
        <div aria-busy="true" aria-label="Cargando tus cupones" className="grid justify-center gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),420px))]">
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
            <div className="grid items-start justify-center gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),420px))]">
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

      <div className="mx-auto mt-2 flex w-full max-w-2xl flex-col gap-2">
        <p className="text-sm font-medium text-white">Ofertas del salón</p>
        <span className="text-xs leading-relaxed text-white/50">
          Ofertas generales para todas las clientas: no llevan código ni se canjean con puntos.
        </span>
        {recursoPromociones.estado === 'error' && (
          <AvisoError
            titulo="No pudimos cargar las ofertas del salón"
            texto="Las ofertas no cambiaron; solo no pudimos leerlas ahora."
            onReintentar={onReintentarPromociones}
          />
        )}
        {recursoPromociones.estado === 'cargando' && <div className="h-16 animate-pulse bg-white/5" aria-busy="true" />}
        {recursoPromociones.estado === 'ok' && recursoPromociones.datos.length === 0 && (
          <div className="liquid-glass rounded-none p-4 text-sm text-white/50">
            No hay ofertas activas por ahora.
          </div>
        )}
        {recursoPromociones.estado === 'ok' &&
          recursoPromociones.datos.map((promocion) => (
            <div key={promocion.id} className="liquid-glass rounded-none p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-white">{promocion.titulo}</p>
                <span className="shrink-0 rounded-full bg-[var(--lw-gold)] px-2 py-0.5 text-[11px] font-semibold text-black">
                  {formatearValorOferta(promocion)}
                </span>
              </div>
              {promocion.descripcion && <p className="mt-1 text-sm text-white/70">{promocion.descripcion}</p>}
              {promocion.vigente_hasta && (
                <p className="mt-1.5 text-xs text-white/50">
                  Válido hasta el {formatearFechaOferta(promocion.vigente_hasta)}
                </p>
              )}
            </div>
          ))}
      </div>

      {programaActivo ? (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-1 border border-white/10 px-5 py-4 text-[13px] leading-relaxed text-white/60">
          <span>{REGLA_CUPONES}</span>
          <span>{REGLA_SERVICIOS}</span>
          <span>Cada cupón conserva las condiciones y la vigencia con las que se emitió; algunos no vencen.</span>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-x-3 gap-y-2 border border-white/10 px-5 py-4 text-[13px] leading-relaxed text-white/60">
          <Pildora>Propuesta pendiente</Pildora>
          Los cupones nuevos vencerían a los 60 días de emitidos. Los cupones anteriores mantienen su vigencia original.
        </div>
      )}

      {enCaja && <ModalCaja cupon={enCaja} onCerrar={() => setEnCaja(null)} />}
    </section>
  )
}
