// Para elementos con onClick que no son <button> (una fila que se expande,
// por ejemplo): permite activarlos con Enter/Espacio igual que un botón
// nativo, para no dejarlos inalcanzables por teclado/lector de pantalla.
export function manejarActivacionTeclado(onActivar) {
  return (evento) => {
    if (evento.key === 'Enter' || evento.key === ' ') {
      evento.preventDefault()
      onActivar()
    }
  }
}
