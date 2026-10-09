// Posiciones de las "chispas" del nivel Oro — mismo patrón que la
// referencia HTML que pasó el usuario, con menos elementos para no
// saturar una tarjeta angosta de lista (la referencia tenía 5, en un
// showcase de una sola tarjeta grande).
const CHISPAS_ORO = [
  { top: '-8px', left: '30px', size: 12 },
  { top: '10px', right: '-10px', size: 9, delay: '-0.9s' },
  { bottom: '-8px', right: '70px', size: 10, delay: '-1.8s' },
]

function Chispa({ estilo, size, delay, variante }) {
  return (
    <svg
      className={`cupon-chispa ${variante === 'roja' ? 'cupon-chispa-roja' : ''} ${variante === 'diamante' ? 'cupon-chispa-diamante' : ''} ${variante === 'verde' ? 'cupon-chispa-verde' : ''}`}
      style={{ ...estilo, width: size, height: size, animationDelay: delay }}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 0C13 8 16 11 24 12C16 13 13 16 12 24C11 16 8 13 0 12C8 11 11 8 12 0Z" />
    </svg>
  )
}

// Envoltura visual de una tarjeta de cupón por nivel (Plata/Oro/Diamante + Especial,
// §7.35): la tarjeta con su acabado (`nivel.claseTarjeta`, ver
// lib/cupones.js), la etiqueta "Nuevo" y las chispas de Oro. Se extrajo
// de TarjetaCupon para que las filas de "Canjear puntos" (Recompensas)
// usen EXACTAMENTE el mismo acabado y las mismas animaciones con otro
// contenido, sin duplicar clases.
//
// La etiqueta "Nuevo" y las chispas de Oro van FUERA del div con
// overflow:hidden (el de `.cupon-tarjeta`) — si estuvieran adentro, ese
// overflow (necesario para recortar el brillo/degradado a la forma de
// la tarjeta) las cortaría, igual que en la referencia HTML (ahí viven
// como hermanas de `.card`, no adentro).
export default function EnvolturaCupon({ nivel, apagada = false, esNuevo = false, children }) {

  return (
    <div className={`relative ${apagada ? 'opacity-50' : ''}`}>
      {esNuevo && (
        <span className="cupon-etiqueta-nueva">
          <span>Nuevo</span>
        </span>
      )}

      {nivel.chispas &&
        CHISPAS_ORO.map((c, indice) => (
          <Chispa
            key={indice}
            estilo={{ position: 'absolute', top: c.top, left: c.left, right: c.right, bottom: c.bottom }}
            size={c.size}
            delay={c.delay}
            variante={nivel.chispas}
          />
        ))}

      <div className={`${nivel.claseTarjeta} rounded-none`}>
        {children}
      </div>
    </div>
  )
}
