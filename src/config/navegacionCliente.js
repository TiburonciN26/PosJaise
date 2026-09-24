import { Building2, CalendarClock, Home, Package, Scissors } from 'lucide-react'

// Pestañas de la barra del header (ver implementacionesWed.md). "Mi
// Perfil" NO va acá — se entra desde el menú del avatar
// (MenuUsuarioCliente), no desde esta barra; su ruta ('/mi-perfil') sigue
// existiendo en App.jsx, solo no tiene botón propio en la barra.
// "Nosotros" agrupa TODO el contenido de marca del salón (Equipo,
// Galería, Reseñas, Contacto) bajo una sola pestaña con su propia
// sub-navegación interna (NosotrosCliente.jsx) — decisión explícita para
// no ir sumando una pestaña nueva a esta barra por cada página de ese
// tipo (ver §7 implementacionesWed.md).
export const seccionesCliente = [
  { path: '/inicio', label: 'Inicio', icono: Home },
  { path: '/servicios', label: 'Servicios', icono: Scissors },
  { path: '/productos', label: 'Productos', icono: Package },
  { path: '/citas', label: 'Citas', icono: CalendarClock },
  { path: '/nosotros', label: 'Nosotros', icono: Building2 },
]

// Título que usa la migaja de pan de PortalCliente (debajo del header)
// para cualquier ruta que NO sea una de las pestañas de arriba — se
// llegó desde el menú del avatar (MenuUsuarioCliente), desde el ícono de
// carrito/chanchito del header, o anidada bajo otra subpágina. Se suma
// una entrada acá por cada pantalla de este tipo.
//
// Rutas con "/" adentro (ej. 'mi-perfil/direcciones') arman una migaja de
// varios niveles sola: PortalCliente parte la ruta actual por segmentos y
// va buscando cada prefijo acá (o en seccionesCliente) — con esa entrada
// y la de '/mi-perfil' ya presentes, entrar a Direcciones pinta
// "Inicio | Mi Perfil | Direcciones", con "Mi Perfil" como link real.
// Direcciones vive anidada a propósito (antes era '/direcciones' suelta):
// son datos DEL cliente (se editan/consultan desde Mi Perfil, que además
// tiene su propio botón "Mis direcciones" a esta misma ruta), no una
// pantalla al mismo nivel que Mi Perfil.
export const titulosSubpaginasCliente = {
  '/mi-perfil': 'Mi Perfil',
  '/historial': 'Historial',
  '/fidelizacion': 'Fidelización',
  '/ofertas': 'Cupones y ofertas',
  '/carrito': 'Tu carrito',
  '/mis-resenas': 'Tus reseñas',
  '/mis-puntos': 'Mis puntos',
  '/mi-perfil/direcciones': 'Direcciones',
  '/mi-perfil/notificaciones': 'Notificaciones',
  '/mi-perfil/seguridad': 'Seguridad de la cuenta',
  '/mi-perfil/referidos': 'Referidos',
}
