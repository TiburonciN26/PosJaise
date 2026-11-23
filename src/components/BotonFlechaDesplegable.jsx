import IconoFlechaDesplegable from './IconoFlechaDesplegable.jsx'

// Botón de la flechita que abre/cierra una tarjeta desplegable del POS (Inventario, Servicios, Proveedores, Mobiliario,
// Asistentes…). Mismo aspecto que «Agregar stock» (BotonAccion plano sinBorde): fondo --color-boton-icono, sin borde,
// 38×38 (igual que los botones de la barra del buscador). Antes era solo el chevron suelto (`p-1.5`) y no se leía como botón.
// `plano`: versión compacta para listas separadas por rayitas (Historial, detalle del Dashboard): solo la flechita, sin fondo, 32×32.
// `color`: clase de color del texto/ícono (por defecto `text-ink`); algunas pantallas pintan la flecha del tema al abrir.
export default function BotonFlechaDesplegable({ abierto, onClick, className = '', plano = false, color = 'text-ink' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={abierto ? 'Contraer' : 'Expandir'}
      aria-expanded={abierto}
      className={`flex shrink-0 items-center justify-center rounded-lg ${color} transition-colors duration-300 hover:bg-surface-3 ${
        plano ? 'min-h-8 min-w-8' : 'min-h-9.5 min-w-9.5 bg-boton-icono px-1.5 py-1'
      } ${className}`}
    >
      <IconoFlechaDesplegable className={`h-3 w-3 transition-transform duration-300 ${abierto ? 'rotate-180' : ''}`} />
    </button>
  )
}
