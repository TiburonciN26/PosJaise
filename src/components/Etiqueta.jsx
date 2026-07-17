// Etiqueta de campo de formulario, compartida por todos los modales (antes
// cada modal definía una copia local idéntica). A6 de la auditoría frontend
// (WCAG 1.3.1): pasar htmlFor + id en el control asociado — sin eso, un
// lector de pantalla anuncia el input sin nombre y tocar la etiqueta no
// enfoca el campo. Para etiquetas de grupos que no son un control único
// (botones Activo/Inactivo, la foto, un valor calculado) se omite htmlFor.
export default function Etiqueta({ children, obligatorio, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs text-ink/60">
      {children}
      {obligatorio && <span className="text-red"> *</span>}
    </label>
  )
}
