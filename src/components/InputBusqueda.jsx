import { useTextoEscritura } from '../hooks/useTextoEscritura.js'

// El placeholder animado hace un setState cada 45ms. Si viviera en el
// componente de la página (con listas grandes debajo), cada tick
// re-renderiza todo ese árbol para nada — acá se aísla en un input propio,
// así el tick solo re-renderiza este elemento chico. Además se pausa por
// completo cuando el campo ya tiene texto (el placeholder ni se ve).
export default function InputBusqueda({
  value,
  onChange,
  onKeyDown,
  onFocus,
  onBlur,
  textoPlaceholder,
  className,
  disabled,
  autoFocus,
  animar = true,
}) {
  const placeholderAnimado = useTextoEscritura(textoPlaceholder, 45, 5000, animar && !value)

  return (
    <input
      type="text"
      value={value}
      disabled={disabled}
      autoFocus={autoFocus}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      placeholder={animar ? placeholderAnimado : textoPlaceholder}
      className={className}
    />
  )
}
