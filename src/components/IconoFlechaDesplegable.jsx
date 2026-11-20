// Flecha de TODOS los desplegables y acordeones del POS y del portal (20/11/2026, reemplaza a ArrowBigDown de lucide):
// el chevron relleno de public/icons/nuevaFlecha.svg, en línea para que tome el color del texto (currentColor) y siga
// al tema y al hover, cosa que un <img> no hace. Tamaño estándar 12×12 (`h-3 w-3`). El giro al abrir se hace con
// `rotate-180` + transition-transform, como antes.
export default function IconoFlechaDesplegable({ className = 'h-3 w-3', ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 284.929 284.929"
      fill="currentColor"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M282.082,76.511l-14.274-14.273c-1.902-1.906-4.093-2.856-6.57-2.856c-2.471,0-4.661,0.95-6.563,2.856L142.466,174.441L30.262,62.241c-1.903-1.906-4.093-2.856-6.567-2.856c-2.475,0-4.665,0.95-6.567,2.856L2.856,76.515C0.95,78.417,0,80.607,0,83.082c0,2.473,0.953,4.663,2.856,6.565l133.043,133.046c1.902,1.903,4.093,2.854,6.567,2.854s4.661-0.951,6.562-2.854L282.082,89.647c1.902-1.903,2.847-4.093,2.847-6.565C284.929,80.607,283.984,78.417,282.082,76.511z" />
    </svg>
  )
}
