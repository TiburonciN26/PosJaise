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
  CalendarClock,
  Hammer,
  HandCoins,
  Ticket,
  Armchair,
} from 'lucide-react'

export const secciones = [
  { path: '/ventas', label: 'Ventas', icono: ShoppingCart, roles: ['ADMINISTRADOR', 'CAJERA'] },
  { path: '/inventario', label: 'Inventario', icono: Package, roles: ['ADMINISTRADOR', 'CAJERA'] },
  { path: '/historial', label: 'Historial', icono: History, roles: ['ADMINISTRADOR', 'CAJERA'] },
  { path: '/servicios', label: 'Servicios', icono: Scissors, roles: ['ADMINISTRADOR', 'CAJERA'] },
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
    roles: ['ADMINISTRADOR', 'ASISTENTE'],
    tema: 'rosa',
  },
  {
    path: '/citas',
    label: 'Citas',
    icono: CalendarClock,
    roles: ['ADMINISTRADOR', 'CAJERA', 'ASISTENTE'],
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
  { path: '/gastos', label: 'Gastos', icono: Wallet, roles: ['ADMINISTRADOR', 'CAJERA'], tema: 'rosa' },
  { path: '/asistentes', label: 'Asistentes', icono: UserCog, roles: ['ADMINISTRADOR'], tema: 'rosa' },
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
    tema: 'rojo',
    animado: true,
  },
  {
    path: '/promociones',
    label: 'Promociones',
    icono: Ticket,
    roles: ['ADMINISTRADOR'],
    tema: 'rojo',
    padre: '/web',
  },
]
