import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../context/ThemeContext.jsx'

// Switch de tema con paleta propia y fija (no los tokens ámbar/verde del
// resto de la app): una píldora que muestra el nombre del tema en el
// hueco libre, y un thumb que se desliza LLEVANDO DENTRO el ícono del
// tema actual (sol en claro, luna en oscuro). El texto queda del lado
// opuesto al thumb. Se integra al ThemeContext ya existente
// (localStorage + preferencia del sistema).
const COLORES = {
  claro: { fondo: '#f6f1e8', thumb: '#ffffff', iconoThumb: '#000000', texto: '#2c2f38' },
  oscuro: { fondo: '#000000', thumb: '#ffffff', iconoThumb: '#000000', texto: '#f6f1e8' },
}

// Sin props usa el tema del POS; el portal cliente pasa el suyo (TemaWebContext).
// `anchoCompleto` estira la píldora al ancho del contenedor (menú POS).
export default function SwitchTema({
  tema: temaProp,
  alternarTema: alternarProp,
  anchoCompleto = false,
}) {
  const temaPos = useTheme()
  const tema = temaProp ?? temaPos.tema
  const alternarTema = alternarProp ?? temaPos.alternarTema
  const esOscuro = tema === 'oscuro'
  const colores = COLORES[tema]

  return (
    <button
      type="button"
      role="switch"
      aria-checked={esOscuro}
      aria-label={esOscuro ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      onClick={alternarTema}
      className={`relative inline-block h-8 shrink-0 cursor-pointer rounded-full shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)] transition-colors duration-300 ease-out ${
        anchoCompleto ? 'w-full' : 'w-[104px]'
      }`}
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
        className={`absolute top-1 flex h-6 w-6 items-center justify-center rounded-full shadow-[0_2px_5px_rgba(0,0,0,0.25)] transition-[left] duration-[350ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          esOscuro ? 'left-[calc(100%-1.75rem)]' : 'left-1'
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
