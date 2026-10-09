// Indicador ✗ / ✓ de un campo de formulario. Cuando `estado` cambia entre
// 'error' y 'ok' la ✗ se transforma en ✓ (y al revés): son las MISMAS dos
// rayas con el mismo ángulo — solo cambian su posición, largo y color, y
// eso es lo que transiciona. Con `estado` null queda invisible (sin
// desmontarse, para que la transición no se corte).
//   <IndicadorValidez estado={completo ? 'ok' : incompleto ? 'error' : null} />
// El llamador lo posiciona (ej. "absolute right-2.5 top-1/2 -translate-y-1/2").
const RAYAS = {
  // [x, y, largo-relativo] de cada raya; las dos son perpendiculares (-45° y 45°) en ambos estados.
  error: [
    { x: 12, y: 12, escala: 1 },
    { x: 12, y: 12, escala: 1 },
  ],
  ok: [
    { x: 8, y: 14.5, escala: 0.4 },
    { x: 14, y: 12.5, escala: 0.81 },
  ],
}
const ANGULOS = [-45, 45]

export default function IndicadorValidez({ estado, className = '' }) {
  const rayas = RAYAS[estado ?? 'error']
  const color = estado === 'ok' ? 'text-green' : 'text-red'

  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={estado === 'ok' ? 'Válido' : estado === 'error' ? 'Incorrecto' : undefined}
      aria-hidden={estado ? undefined : true}
      className={`h-4 w-4 fill-none stroke-current transition-[color,opacity] duration-300 motion-reduce:transition-none ${color} ${estado ? 'opacity-100' : 'opacity-0'} ${className}`}
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      {rayas.map((raya, i) => (
        <line
          key={i}
          x1="0"
          y1="-7"
          x2="0"
          y2="7"
          className="transition-transform duration-300 ease-out motion-reduce:transition-none"
          style={{ transform: `translate(${raya.x}px, ${raya.y}px) rotate(${ANGULOS[i]}deg) scaleY(${raya.escala})` }}
        />
      ))}
    </svg>
  )
}
