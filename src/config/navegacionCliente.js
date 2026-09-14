import { CalendarClock, Home, Scissors } from 'lucide-react'

// Pestañas de la barra del header (ver implementacionesWed.md). "Mi
// Perfil" NO va acá — se entra desde el menú del avatar
// (MenuUsuarioCliente), no desde esta barra; su ruta ('/mi-perfil') sigue
// existiendo en App.jsx, solo no tiene botón propio en la barra. El resto
// (Citas, Historial, Fidelización, Descuentos, Referidos) se suma acá a
// medida que se construyen, mismo patrón que "secciones" en navegacion.js.
export const seccionesCliente = [
  { path: '/inicio', label: 'Inicio', icono: Home },
  { path: '/servicios', label: 'Servicios', icono: Scissors },
  { path: '/citas', label: 'Citas', icono: CalendarClock },
]

// Título que muestra PortalCliente en la segunda fila del header (con
// flecha de volver) cuando la ruta actual NO es una de las pestañas de
// arriba — o sea, se llegó desde el menú del avatar (MenuUsuarioCliente),
// no desde la barra. Se suma una entrada acá por cada opción del menú que
// vaya ganando su propia pantalla (hoy solo "Tu perfil" la tiene).
export const titulosSubpaginasCliente = {
  '/mi-perfil': 'Mi Perfil',
  '/historial': 'Historial',
  '/fidelizacion': 'Fidelización',
  '/ofertas': 'Cupones y ofertas',
}
