import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../context/ThemeContext.jsx'

// Switch de tema con paleta propia y fija (no los tokens ámbar/verde del
// resto de la app): una píldora que muestra el nombre del tema en el
// hueco libre, y un thumb que se desliza LLEVANDO DENTRO el ícono del
// tema actual (sol en claro, luna en oscuro). El texto queda del lado
// opuesto al thumb. Se integra al ThemeContext ya existente
// (localStorage + preferencia del sistema).
const COLORES = {
  claro: { fondo: '#f6f1e8', thumb: '#2c2f38', iconoThumb: '#e8c36b', texto: '#2c2f38' },
  oscuro: { fondo: '#232833', thumb: '#f6f1e8', iconoThumb: '#3d4a63', texto: '#f6f1e8' },
}

export default function SwitchTema() {
  const { tema, alternarTema } = useTheme()
  const esOscuro = tema === 'oscuro'
  const colores = COLORES[tema]

  return (
    <button
      type="button"
      role="switch"
      aria-checked={esOscuro}
      aria-label={esOscuro ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      onClick={alternarTema}
      className="relative inline-block h-8 w-[104px] shrink-0 cursor-pointer rounded-full shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)] transition-colors duration-300 ease-out"
      style={{ backgroundColor: colores.fondo }}
    >
      <span
        className={`pointer-events-none absolute inset-y-0 flex items-center text-[11px] font-semibold uppercase tracking-wide transition-colors duration-300 ${
          esOscuro ? 'left-3.5' : 'right-3.5'
        }`}
        style={{ color: colores.texto }}
      >
        {esOscuro ? 'Oscuro' : 'Claro'}
      </span>

      <span
        className={`absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-full shadow-[0_2px_5px_rgba(0,0,0,0.25)] transition-transform duration-[350ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          esOscuro ? 'translate-x-[72px]' : 'translate-x-0'
        }`}
        style={{ backgroundColor: colores.thumb }}
      >
        {esOscuro ? (
          <Moon className="h-3.5 w-3.5" style={{ color: colores.iconoThumb }} />
        ) : (
          <Sun className="h-3.5 w-3.5" style={{ color: colores.iconoThumb }} />
        )}
      </span>
    </button>
  )
}
