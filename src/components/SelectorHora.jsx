// Selector de hora en formato de 12 horas con AM/PM explícito (hora · minutos · AM/PM). Reemplaza a <input type="time">,
// que según el navegador o el idioma del dispositivo se mostraba en formato de 24 horas sin decir si era mañana o tarde.
// Trabaja con el mismo valor de siempre, "HH:MM" en 24 h, que es lo que espera la base de datos.

const HORAS_12 = Array.from({ length: 12 }, (_, i) => i + 1)
const PASO_MINUTOS = 5
const MINUTOS = Array.from({ length: 60 / PASO_MINUTOS }, (_, i) => i * PASO_MINUTOS)

const dosDigitos = (n) => String(n).padStart(2, '0')

// Clases completas (Tailwind solo genera las que aparecen escritas tal cual en el código).
const ACENTOS = {
  amber: { foco: 'focus:border-amber', activo: 'bg-amber text-bg' },
  'azul-metal': { foco: 'focus:border-azul-metal', activo: 'bg-azul-metal text-bg' },
}

function componer(hora12, minutos, pm) {
  return `${dosDigitos((hora12 % 12) + (pm ? 12 : 0))}:${dosDigitos(minutos)}`
}

// `acento`: clase del color de foco/selección de la pestaña (p. ej. 'azul-metal', 'amber').
export default function SelectorHora({ id, valor, onCambiar, etiqueta, acento = 'amber' }) {
  const [h24, minutos] = (valor || '00:00').split(':').map(Number)
  const pm = h24 >= 12
  const hora12 = h24 % 12 === 0 ? 12 : h24 % 12
  // Un valor guardado fuera del paso de 5 min (p. ej. 20:31) se conserva como opción en vez de perderse.
  const opcionesMinutos = MINUTOS.includes(minutos) ? MINUTOS : [...MINUTOS, minutos].sort((a, b) => a - b)

  const colores = ACENTOS[acento] ?? ACENTOS.amber
  const claseSelect = `appearance-none rounded-lg border border-border bg-bg px-2 py-1.5 text-center font-mono text-sm text-ink outline-none ${colores.foco} disabled:cursor-not-allowed`
  const claseBoton = (activo) =>
    `px-2 py-1.5 font-mono text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
      activo ? colores.activo : 'text-ink/60 hover:text-ink'
    }`

  return (
    <span role="group" aria-label={etiqueta} className="inline-flex items-center gap-1">
      <select
        id={id}
        value={hora12}
        onChange={(e) => onCambiar(componer(Number(e.target.value), minutos, pm))}
        aria-label={`${etiqueta}: hora`}
        className={`${claseSelect} w-11`}
      >
        {HORAS_12.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="text-sm text-ink/60" aria-hidden="true">
        :
      </span>
      <select
        value={minutos}
        onChange={(e) => onCambiar(componer(hora12, Number(e.target.value), pm))}
        aria-label={`${etiqueta}: minutos`}
        className={`${claseSelect} w-12`}
      >
        {opcionesMinutos.map((m) => (
          <option key={m} value={m}>
            {dosDigitos(m)}
          </option>
        ))}
      </select>
      <span className="ml-0.5 inline-flex overflow-hidden rounded-lg border border-border">
        <button
          type="button"
          onClick={() => onCambiar(componer(hora12, minutos, false))}
          aria-pressed={!pm}
          aria-label={`${etiqueta}: a. m.`}
          className={claseBoton(!pm)}
        >
          AM
        </button>
        <button
          type="button"
          onClick={() => onCambiar(componer(hora12, minutos, true))}
          aria-pressed={pm}
          aria-label={`${etiqueta}: p. m.`}
          className={claseBoton(pm)}
        >
          PM
        </button>
      </span>
    </span>
  )
}
