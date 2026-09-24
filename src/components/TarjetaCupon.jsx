import { useState } from 'react'
import { ArrowBigDown, Ticket } from 'lucide-react'
import { ETIQUETAS_ORIGEN_CUPON, formatearFechaCupon, nivelCupon } from '../lib/cupones.js'
import { formatearSoles } from '../lib/moneda.js'
import CampoColapsable from './CampoColapsable.jsx'

// Posiciones de las "chispas" del nivel Oro — mismo patrón que la
// referencia HTML que pasó el usuario, con menos elementos para no
// saturar una tarjeta angosta de lista (la referencia tenía 5, en un
// showcase de una sola tarjeta grande).
const CHISPAS_ORO = [
  { top: '-8px', left: '30px', size: 12 },
  { top: '10px', right: '-10px', size: 9, delay: '-0.9s' },
  { bottom: '-8px', right: '70px', size: 10, delay: '-1.8s' },
]

function Chispa({ estilo, size, delay }) {
  return (
    <svg
      className="cupon-chispa"
      style={{ ...estilo, width: size, height: size, animationDelay: delay }}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 0C13 8 16 11 24 12C16 13 13 16 12 24C11 16 8 13 0 12C8 11 11 8 12 0Z" />
    </svg>
  )
}

// Una tarjeta de cupón — usada tal cual por ReferidosCliente.jsx (junto
// a tu código de invitación) y OfertasCliente.jsx (junto a las ofertas
// generales del salón, ver §7.32): mismo componente, misma fuente de
// datos (mis_cupones()), así que un cupón se ve y se marca canjeado
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
export default function TarjetaCupon({ cupon, esNuevo = false }) {
  const [abierto, setAbierto] = useState(false)
  const nivel = nivelCupon(cupon.valor)
  const disponible = cupon.estado === 'DISPONIBLE'
  const esOro = nivel.nombre === 'Oro'

  return (
    // La etiqueta "Nuevo" y las chispas de Oro van FUERA del div con
    // overflow:hidden (abajo) — si estuvieran adentro, ese mismo
    // overflow (necesario para recortar el brillo/degradado a la forma
    // de la tarjeta) las cortaría, igual que en la referencia HTML
    // (ahí viven como hermanas de `.card`, no adentro).
    <div className={`relative ${disponible ? '' : 'opacity-50'}`}>
      {esNuevo && (
        <span className="cupon-etiqueta-nueva">
          <span>Nuevo</span>
        </span>
      )}

      {esOro &&
        CHISPAS_ORO.map((c, indice) => (
          <Chispa
            key={indice}
            estilo={{ position: 'absolute', top: c.top, left: c.left, right: c.right, bottom: c.bottom }}
            size={c.size}
            delay={c.delay}
          />
        ))}

      <div className={`${nivel.claseTarjeta} rounded-none ${nivel.nombre === 'Bronce' ? 'bg-[#0d0c0b]' : ''}`}>
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
            <p className={`font-semibold ${nivel.claseTexto}`}>{formatearSoles(cupon.valor)}</p>
            <p className="text-[11px] text-white/50">
              {disponible ? 'Muéstralo en caja' : cupon.estado === 'ANULADO' ? 'Anulado' : 'Ya canjeado'}
            </p>
          </div>
          <ArrowBigDown
            className={`h-3.5 w-3.5 shrink-0 text-white/40 transition-transform duration-300 ${
              abierto ? 'rotate-180' : ''
            }`}
          />
        </button>

        <CampoColapsable abierto={abierto}>
          <div className="relative flex items-center gap-4 border-t border-white/10 px-3 py-2 text-[11px] text-white/50">
            <span>Creado: {formatearFechaCupon(cupon.creado_en)}</span>
            {cupon.canjeado_en && <span>Canjeado: {formatearFechaCupon(cupon.canjeado_en)}</span>}
          </div>
        </CampoColapsable>
      </div>
    </div>
  )
}
