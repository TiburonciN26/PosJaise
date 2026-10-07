


import { useState } from 'react'
import { ArrowBigDown, Ticket } from 'lucide-react'
import { ETIQUETAS_ORIGEN_CUPON, formatearFechaCupon, estadoEfectivoCupon, formatearValorCupon, nivelDeCupon } from '../lib/cupones.js'
import CampoColapsable from './CampoColapsable.jsx'
import EnvolturaCupon from './EnvolturaCupon.jsx'

// Una tarjeta de cupón — usada tal cual por ReferidosCliente.jsx (junto
// a tu código de invitación) y Recompensas › Mis cupones: mismo
// componente, misma fuente de datos (mis_cupones()), así que un cupón se ve y se marca canjeado
// exactamente igual sin importar desde qué pestaña se lo mire.
//
// Diseño por nivel (§7.35) — a pedido del usuario, tomado de una
// referencia HTML con 3 niveles (Bronce/Plata/Oro, mismos umbrales que
// ya usaba nivelCupon()): Bronce queda plano, Plata con reflejo/brillo
// sutil, Oro con glow pulsante + texto degradado animado + chispas —
// solo el estilo de la tarjeta en sí, sin la animación de flotar que
// tenía la referencia (ahí eran 3 tarjetas sueltas en una vitrina; acá
// van en una lista, y varias flotando a la vez se ve mal).
//
// La etiqueta "Nuevo" (`esNuevo`) la calcula la pantalla que lista los
// cupones (useCuponesNuevos.js) — se muestra una sola vez, la primera
// vez que el cliente ve ese cupón; si sale de la pestaña y vuelve, ya
// no aparece.
//
// Las fechas (creación y canje) NO van en la fila compacta a propósito
// — pedido del usuario, ya iba cargada de código/origen/valor/estado y
// sumar dos fechas más ahí la saturaba. En vez de eso, la tarjeta entera
// es un acordeón (mismo patrón que ya usa el resto del proyecto — ver
// PedidosWeb.jsx/Historial.jsx — con `CampoColapsable` y la flecha
// `ArrowBigDown` girando 180°, no un ChevronDown): se toca para revelar
// una fila chica con las fechas, en vez de mostrarlas siempre.
export default function TarjetaCupon({ cupon, esNuevo = false, onMostrarEnCaja }) {
  const [abierto, setAbierto] = useState(false)
  const nivel = nivelDeCupon(cupon)
  const efectivo = estadoEfectivoCupon(cupon)
  const disponible = efectivo.utilizable
  const etiquetaEstado = disponible
    ? 'Muéstralo en caja'
    : { VENCIDO: 'Vencido', ANULADO: 'Anulado', CANJEADO: 'Ya canjeado' }[efectivo.estado] ?? 'No disponible ahora'

  return (
    <EnvolturaCupon nivel={nivel} apagada={!disponible} esNuevo={esNuevo}>
      <button
        type="button"
        onClick={() => setAbierto((anterior) => !anterior)}
        aria-expanded={abierto}
        className="relative flex w-full items-center gap-3 p-3 text-left"
      >
        <Ticket className={`h-5 w-5 shrink-0 ${nivel.claseIcono}`} />
        <div className="min-w-0 flex-1">
          <p className={`font-mono text-base font-semibold tracking-widest ${nivel.claseTexto}`}>
            {cupon.codigo}
          </p>
          <p className="truncate text-xs text-white/50">
            {ETIQUETAS_ORIGEN_CUPON[cupon.origen] ?? cupon.origen} · {nivel.nombre}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`font-semibold ${nivel.claseTexto}`}>{formatearValorCupon(cupon)}</p>
          <p className="text-[11px] text-white/50">
            {etiquetaEstado}
          </p>
        </div>
        <ArrowBigDown
          className={`h-3.5 w-3.5 shrink-0 text-white/40 transition-transform duration-300 ${
            abierto ? 'rotate-180' : ''
          }`}
        />
      </button>

      <CampoColapsable abierto={abierto}>
        {/* Caja interior con margen y borde fino propio (no al ras de los
            bordes del cupón) — diseño de Recompensas. */}
        <div className="relative mx-2.5 mb-2.5 flex flex-col gap-2 border border-white/10 bg-black/25 p-3 text-[11px] text-white/50">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Creado: {formatearFechaCupon(cupon.creado_en)}</span>
            {cupon.canjeado_en && <span>Canjeado: {formatearFechaCupon(cupon.canjeado_en)}</span>}
            {efectivo.estado === 'VENCIDO' && cupon.vigente_hasta && <span>Venció: {formatearFechaCupon(cupon.vigente_hasta)}</span>}
          </div>
          {disponible && onMostrarEnCaja && (
            <button
              type="button"
              onClick={() => onMostrarEnCaja(cupon)}
              className={`flex w-fit items-center gap-1.5 rounded-lg border bg-transparent px-3 py-1.5 text-xs font-semibold transition-colors ${
                nivel.claseBoton ?? 'border-[var(--lw-gold)] text-[var(--lw-gold)] hover:bg-[var(--lw-gold)]/10'
              }`}
            >
              Mostrar en caja
            </button>
          )}
        </div>
      </CampoColapsable>
    </EnvolturaCupon>
  )
}
