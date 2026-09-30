// React Bits — ShinyText (versión JS + CSS, portada tal cual a este
// proyecto: https://reactbits.dev/text-animations/shiny-text). Es un
// <div> con un degradado en movimiento recortado a la forma del texto
// (background-clip: text) + background-size 200% y una animación que
// corre background-position de 100% a -100% — la banda clara del
// degradado, al desplazarse, se lee como un brillo recorriendo el
// texto. El estilo (`.shiny-text`) vive en src/index.css junto al
// resto del CSS a medida del proyecto, no en un .css por componente
// (mismo criterio que ya usa todo lo demás acá).
//
// Gris/blanco por defecto — el look real de React Bits, sin tocar.
// Para el botón "Reserva tu cita" del hero de Inicio se usa con
// className="lw-cta-shiny" (ver index.css), que reemplaza el color por
// el degradado --lw-metal-azul ya existente en vez de inventar uno
// nuevo — el componente en sí no sabe nada de eso, es 100% genérico.
// `delay` (§7.61): no está en el ShinyText original de React Bits —
// se agregó porque hacía falta para el botón de Inicio (pedido del
// usuario). Mismo mecanismo que `speed`: nada más que animation-delay
// por inline style, no cambia el resto del componente.
export default function ShinyText({ text, disabled = false, speed = 5, delay = 0, className = '' }) {
  return (
    <div
      className={`shiny-text ${disabled ? 'disabled' : ''} ${className}`}
      style={{ animationDuration: `${speed}s`, animationDelay: `${delay}s` }}
    >
      {text}
    </div>
  )
}
