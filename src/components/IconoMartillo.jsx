import { Hammer } from 'lucide-react'

// Chispas del golpe: cada una con su propio destino (--dx/--dy, consumidos
// por @keyframes chispa-martillo en index.css) para salir disparadas en
// abanico desde la cabeza del martillo, no todas en la misma dirección.
const CHISPAS = [
  { dx: '7px', dy: '-4px', retraso: '0ms' },
  { dx: '8px', dy: '2px', retraso: '30ms' },
  { dx: '4px', dy: '6px', retraso: '15ms' },
  { dx: '2px', dy: '-7px', retraso: '45ms' },
]

// Ícono animado de la pestaña "Web... Próximamente": martilla en bucle con
// chispas en cada golpe. Sin colores propios (hereda currentColor, igual
// que cualquier ícono de lucide-react del menú) y sin animar nada mientras
// `animando` es false — quien lo usa decide cuándo (ver MenuLateral.jsx:
// solo con el menú abierto en móvil, para no seguir martillando de fondo
// con el cajón cerrado fuera de pantalla).
export default function IconoMartillo({ animando = false, className = 'h-4 w-4' }) {
  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      <Hammer
        className={`h-full w-full origin-[22%_85%] ${animando ? 'animate-martillar' : ''}`}
      />
      {animando &&
        CHISPAS.map((chispa, indice) => (
          <span
            key={indice}
            aria-hidden="true"
            className="animate-chispa-martillo pointer-events-none absolute top-[8%] left-[58%] h-[3px] w-[3px] rounded-full bg-current"
            style={{ '--dx': chispa.dx, '--dy': chispa.dy, animationDelay: chispa.retraso }}
          />
        ))}
    </span>
  )
}
