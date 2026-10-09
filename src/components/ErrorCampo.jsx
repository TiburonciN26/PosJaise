import { CircleAlert } from 'lucide-react'

// Mensaje de error en línea, debajo de un campo de formulario (ícono "!"
// en círculo + texto rojo). Siempre queda montado y `visible` lo muestra u
// oculta con una animación: la altura se abre/cierra suavemente (empuja
// hacia abajo lo que tiene debajo) y el texto baja/sube con un fundido.
// Montado siempre, para que también se anime al ocultarse:
//   <ErrorCampo visible={invalido && tocado}>Debe tener 9 dígitos.</ErrorCampo>
// `className` permite alinearlo con el input cuando la etiqueta va a su
// lado (ej. "pl-39").
export default function ErrorCampo({ visible, children, className = '' }) {
  return (
    <div
      aria-hidden={!visible}
      className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${visible ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
    >
      <div className="min-h-0 overflow-hidden">
        <p
          role={visible ? 'alert' : undefined}
          className={`flex items-center gap-1 pt-1 text-xs text-red transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none ${visible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'} ${className}`}
        >
          <CircleAlert className="h-3.5 w-3.5 shrink-0" />
          {children}
        </p>
      </div>
    </div>
  )
}
