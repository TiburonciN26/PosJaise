import IconoFlechaDesplegable from './IconoFlechaDesplegable.jsx'

// Botón de la flechita que abre/cierra una tarjeta desplegable del POS (Inventario, Servicios, Proveedores, Mobiliario,
// Asistentes…). Mismo aspecto que «Agregar stock» (BotonAccion plano sinBorde): fondo --color-boton-icono, sin borde,
// 40×40 como mínimo táctil. Antes era solo el chevron suelto (`p-1.5`) y no se leía como botón.
export default function BotonFlechaDesplegable({ abierto, onClick, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={abierto ? 'Contraer' : 'Expandir'}
      aria-expanded={abierto}
      className={`flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg bg-boton-icono px-1.5 py-1 text-ink transition-colors hover:bg-surface-3 ${className}`}
    >
      <IconoFlechaDesplegable className={`h-3 w-3 transition-transform duration-300 ${abierto ? 'rotate-180' : ''}`} />
    </button>
  )
}
