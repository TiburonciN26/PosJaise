import {
  ShoppingCart,
  Package,
  History,
  Scissors,
  LayoutDashboard,
  UserCircle,
  BarChart3,
  ShieldCheck,
  Users,
  Percent,
  Wallet,
  UserCog,
  UserPlus,
  CalendarClock,
  Hammer,
  HandCoins,
  Ticket,
  Armchair,
  ShoppingBag,
  Star,
  MapPin,
  PiggyBank,
  Gift,
  Stamp,
  Image,
  Coins,
  LayoutGrid,
  BookOpen,
} from 'lucide-react'

// Roles de personal: ADMINISTRADOR (todo), CAJERA (vende/cobra), ASISTENTE (citas + su panel de pagos) y
// ENCARGADA (la unión de CAJERA + ASISTENTE, sin ser admin). El resto de pantallas decide por `esAdmin`, así que
// agregar un rol aquí basta para el menú; la seguridad real la pone la RLS (ver migración rol_encargada).
const ROLES_CAJA = ['ADMINISTRADOR', 'CAJERA', 'ENCARGADA']
const ROLES_PANEL = ['ADMINISTRADOR', 'ASISTENTE', 'ENCARGADA']
const ROLES_CITAS = ['ADMINISTRADOR', 'CAJERA', 'ASISTENTE', 'ENCARGADA']

export const secciones = [
  { path: '/ventas', label: 'Ventas', icono: ShoppingCart, roles: ROLES_CAJA },
  { path: '/inventario', label: 'Inventario', icono: Package, roles: ROLES_CAJA },
  { path: '/historial', label: 'Historial', icono: History, roles: ROLES_CAJA },
  { path: '/servicios', label: 'Servicios', icono: Scissors, roles: ROLES_CAJA },
  {
    path: '/dashboard',
    label: 'Dashboard',
    icono: LayoutDashboard,
    roles: ['ADMINISTRADOR'],
    tema: 'rosa',
  },
  {
    path: '/mi-panel',
    label: 'Mi Panel',
    icono: UserCircle,
    roles: ROLES_PANEL,
    tema: 'rosa',
  },
  {
    path: '/citas',
    label: 'Citas',
    icono: CalendarClock,
    roles: ROLES_CITAS,
    tema: 'rosa',
  },
  { path: '/estadisticas', label: 'Estadísticas', icono: BarChart3, roles: ['ADMINISTRADOR'], tema: 'rosa' },
  { path: '/auditoria', label: 'Auditoría', icono: ShieldCheck, roles: ['ADMINISTRADOR'], tema: 'rosa' },
  { path: '/clientes', label: 'Clientes', icono: Users, roles: ['ADMINISTRADOR'], tema: 'rosa' },
  {
    path: '/deudas',
    label: 'Deudas',
    icono: HandCoins,
    roles: ['ADMINISTRADOR'],
    tema: 'rosa',
    // Netamente ligada a Clientes: en el menú lateral (móvil) no aparece
    // como pestaña suelta, solo se revela al desplegar Clientes (ver
    // MenuLateral.jsx). En el nav de escritorio (Header.jsx) sí aparece
    // como una pestaña más — esa barra no tiene jerarquía de submenús.
    padre: '/clientes',
  },
  { path: '/porcentajes', label: 'Porcentajes', icono: Percent, roles: ['ADMINISTRADOR'], tema: 'rosa' },
  { path: '/gastos', label: 'Gastos', icono: Wallet, roles: ROLES_CAJA, tema: 'rosa' },
  { path: '/chanchito', label: 'Chanchito', icono: PiggyBank, roles: ['ADMINISTRADOR'], tema: 'rosa' },
  // Cuentas de acceso del POS (alta, bloqueo, roles). Las fichas del equipo (perfil público) viven en Web → Equipo.
  { path: '/personal', label: 'Personal', icono: UserPlus, roles: ['ADMINISTRADOR'], tema: 'rosa' },
  {
    path: '/mobiliario',
    label: 'Mobiliario',
    icono: Armchair,
    roles: ['ADMINISTRADOR'],
    tema: 'rosa',
  },
  {
    // Admin-only a propósito (antes también la veían Cajera/Asistente):
    // esta pestaña pasa a ser el panel administrativo de la pestaña Web
    // de clientes — Promociones es su primera sección real. En vez de
    // agregar una pestaña nueva del menú por cada sección (la lista
    // sería larguísima), cada una cuelga de "Web" como "padre" — mismo
    // patrón que Deudas cuelga de Clientes.
    path: '/web',
    label: 'Web',
    icono: Hammer,
    roles: ['ADMINISTRADOR'],
    tema: 'azul-metal',
    animado: true,
  },
  {
    path: '/promociones',
    label: 'Promociones',
    icono: Ticket,
    roles: ['ADMINISTRADOR'],
    tema: 'azul-metal',
    padre: '/web',
  },
  {
    path: '/pedidos-web',
    label: 'Pedidos Web',
    icono: ShoppingBag,
    roles: ['ADMINISTRADOR'],
    tema: 'azul-metal',
    padre: '/web',
  },
  {
    path: '/resenas-web',
    label: 'Reseñas',
    icono: Star,
    roles: ['ADMINISTRADOR'],
    tema: 'azul-metal',
    padre: '/web',
  },
  {
    path: '/contacto-web',
    label: 'Contacto Web',
    icono: MapPin,
    roles: ['ADMINISTRADOR'],
    tema: 'azul-metal',
    padre: '/web',
  },
  {
    path: '/puntos-web',
    label: 'Puntos Web',
    icono: PiggyBank,
    roles: ['ADMINISTRADOR'],
    tema: 'azul-metal',
    padre: '/web',
  },
  {
    path: '/referidos-web',
    label: 'Referidos Web',
    icono: Gift,
    roles: ['ADMINISTRADOR'],
    tema: 'azul-metal',
    padre: '/web',
  },
  {
    path: '/fidelizacion-web',
    label: 'Fidelización Web',
    icono: Stamp,
    roles: ['ADMINISTRADOR'],
    tema: 'azul-metal',
    padre: '/web',
  },
  {
    // Administración de Recompensas Fase 2 (catálogo, sellos, protección de
    // servicios, programa). Solo ADMINISTRADOR; el backend lo vuelve a exigir.
    path: '/recompensas-web',
    label: 'Recompensas Web',
    icono: Coins,
    roles: ['ADMINISTRADOR'],
    tema: 'azul-metal',
    padre: '/web',
  },
  {
    // Web → Catálogo → Productos / Servicios: contenido editorial y configuración Web de las MISMAS fichas del POS.
    // Solo ADMINISTRADOR (el acceso directo por URL de otro rol redirige, como el resto de secciones de Web).
    path: '/catalogo-web',
    label: 'Catálogo Web',
    icono: LayoutGrid,
    roles: ['ADMINISTRADOR'],
    tema: 'azul-metal',
    padre: '/web',
  },
  {
    // Hojas del Libro de Reclamaciones (obligatorio por ley); solo ADMINISTRADOR.
    path: '/libro-reclamaciones-web',
    label: 'Libro de Reclamaciones',
    icono: BookOpen,
    roles: ['ADMINISTRADOR'],
    tema: 'azul-metal',
    padre: '/web',
  },
  {
    path: '/galeria-web',
    label: 'Galería Web',
    icono: Image,
    roles: ['ADMINISTRADOR'],
    tema: 'azul-metal',
    padre: '/web',
  },
  {
    // Fichas del equipo (antes la pestaña «Asistentes»): perfil público de «Nuestro equipo» y la ficha que usan
    // comisiones y citas. Se crean solas al dar de alta a una asistente/encargada en Personal.
    path: '/equipo-web',
    label: 'Equipo',
    icono: UserCog,
    roles: ['ADMINISTRADOR'],
    tema: 'azul-metal',
    padre: '/web',
  },
  {
    path: '/login-web',
    label: 'Login Web',
    icono: Image,
    roles: ['ADMINISTRADOR'],
    tema: 'azul-metal',
    padre: '/web',
  },
]

// Ruta de aterrizaje por rol — antes App.jsx/PestanasCacheadas.jsx tenían
// "/ventas" fijo a mano en dos lugares. Bug real: Ventas es
// ADMINISTRADOR/CAJERA (ver arriba), así que una ASISTENTE (que no está
// en esa lista) caía en un fallback que la mandaba... de vuelta a
// "/ventas" — pantalla negra permanente, nunca llegaba a ver nada. Se
// usa el primer ítem de `secciones` (en su orden real) que el rol SÍ
// puede ver — para ASISTENTE, eso es "/mi-panel", tal como debía ser.
export function rutaInicialPara(rol) {
  return secciones.find((seccion) => seccion.roles.includes(rol))?.path ?? '/ventas'
}
