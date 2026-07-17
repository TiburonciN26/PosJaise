// Switch visual tipo iOS/Android (pastilla + perilla que se desliza) —
// puramente presentacional: no es un <button> propio, se apoya en que el
// botón que lo contiene ya maneja el clic/teclado (evitar <button> anidado
// dentro de otro <button>, inválido en HTML). Reutilizado por el tema
// claro/oscuro y por el estado del negocio en MenuUsuario.jsx, mismo
// componente para no duplicar el marcado/la animación en cada lugar.
export default function Interruptor({ activado, colorActivado = 'bg-amber', icono: Icono }) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ${
        activado ? colorActivado : 'bg-surface-3'
      }`}
    >
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform duration-200 ${
          activado ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      >
        {Icono && <Icono className="h-3 w-3 text-ink/70" />}
      </span>
    </span>
  )
}
