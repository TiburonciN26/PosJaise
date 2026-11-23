import {
  ShoppingCart,
  Package,
  History,
  Scissors,
  LayoutDashboard,
  NotebookText,
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
  Warehouse,
  Banknote,
  Truck,
  CircleHelp,
} from 'lucide-react'

// Roles de personal: ADMINISTRADOR (todo), CAJERA (vende/cobra), ASISTENTE (citas + su panel de pagos),
// ENCARGADA (la unión de CAJERA + ASISTENTE, sin ser admin) y PERSONAL_APOYO (chicas que vienen solo cuando hay mucho
// tráfico: ÚNICAMENTE Mis atenciones, para anotar lo que atendieron). El resto de pantallas decide por `esAdmin`, así que
// agregar un rol aquí basta para el menú; la seguridad real la pone la RLS (migraciones rol_encargada y
// rol_personal_apoyo).
const ROLES_CAJA = ['ADMINISTRADOR', 'CAJERA', 'ENCARGADA']
const ROLES_PANEL = ['ADMINISTRADOR', 'ASISTENTE', 'ENCARGADA', 'PERSONAL_APOYO']
const ROLES_CITAS = ['ADMINISTRADOR', 'CAJERA', 'ASISTENTE', 'ENCARGADA']
// Almacén (cosas internas que no se venden): todo el personal anota lo que saca; solo la admin crea artículos e ingresos
// (migración 20261112000011_almacen).
const ROLES_ALMACEN = ['ADMINISTRADOR', 'CAJERA', 'ASISTENTE', 'ENCARGADA', 'PERSONAL_APOYO']

// Orden del menú lateral: el original, con los movimientos pedidos el 20/11/2026 (implementacionesWed.md §95).
// Las hijas (`padre`) van justo después de su madre: si el rol no ve a la
// madre, la hija aparece suelta en ese lugar. El orden ya NO decide a qué pestaña entra cada rol (INICIO_POR_ROL, abajo).
export const secciones = [
  { path: '/ventas', label: 'Ventas', icono: ShoppingCart, roles: ROLES_CAJA },
  { path: '/historial', label: 'Historial', icono: History, roles: ROLES_CAJA },
  { path: '/inventario', label: 'Inventario', icono: Package, roles: ROLES_CAJA },
  // Registro de proveedores (20261112000014): solo la administradora; en el menú lateral se revela al desplegar Inventario.
  { path: '/proveedores', label: 'Proveedores', icono: Truck, roles: ['ADMINISTRADOR'], padre: '/inventario' },
  { path: '/servicios', label: 'Servicios', icono: Scissors, roles: ROLES_CAJA },
  { path: '/clientes', label: 'Clientes', icono: Users, roles: ['ADMINISTRADOR'], tema: 'rosa' },
  {
    path: '/deudas',
    label: 'Deudas',
    icono: HandCoins,
    // Cajera y Encargada solo CONSULTAN y dejan notas de cobro que confirma la admin
    // (migración 20261112000001_deudas_notas_cobro).
    roles: ROLES_CAJA,
    tema: 'rosa',
    // Netamente ligada a Clientes: en el menú lateral no aparece como pestaña suelta, solo se revela al desplegar
    // Clientes (ver MenuLateral.jsx). La cajera, que no ve Clientes, la ve suelta.
    padre: '/clientes',
  },
  { path: '/citas', label: 'Citas', icono: CalendarClock, roles: ROLES_CITAS, tema: 'rosa' },
  { path: '/mi-panel', label: 'Mis atenciones', icono: NotebookText, roles: ROLES_PANEL, tema: 'rosa' },
  { path: '/dashboard', label: 'Dashboard', icono: LayoutDashboard, roles: ['ADMINISTRADOR'], tema: 'rosa' },
  {
    path: '/estadisticas',
    label: 'Estadísticas',
    icono: BarChart3,
    roles: ['ADMINISTRADOR'],
    tema: 'rosa',
    padre: '/dashboard',
  },
  { path: '/gastos', label: 'Gastos', icono: Wallet, roles: ROLES_CAJA, tema: 'rosa' },
  // Fondo fijo en efectivo para gastos menores (20261112000012): los mismos roles que manejan Gastos / Ventas.
  { path: '/caja-chica', label: 'Caja chica', icono: Banknote, roles: ROLES_CAJA, tema: 'rosa' },
  { path: '/almacen', label: 'Almacén', icono: Warehouse, roles: ROLES_ALMACEN, tema: 'rosa' },
  {
    path: '/mobiliario',
    label: 'Mobiliario',
    icono: Armchair,
    roles: ['ADMINISTRADOR'],
    tema: 'rosa',
    padre: '/almacen',
  },
  { path: '/chanchito', label: 'Chanchito', icono: PiggyBank, roles: ['ADMINISTRADOR'], tema: 'rosa' },
  { path: '/auditoria', label: 'Auditoría', icono: ShieldCheck, roles: ['ADMINISTRADOR'], tema: 'rosa' },
  // Cuentas de acceso del POS (alta, bloqueo, roles). Las fichas del equipo (perfil público) viven en Web → Equipo.
  { path: '/personal', label: 'Personal', icono: UserPlus, roles: ['ADMINISTRADOR'], tema: 'rosa' },
  // El % de comisión de cada asistente por servicio (la ruta sigue siendo /porcentajes). Cuelga de Personal.
  {
    path: '/porcentajes',
    label: 'Comisiones',
    icono: Percent,
    roles: ['ADMINISTRADOR'],
    tema: 'rosa',
    padre: '/personal',
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

  // Al final: preguntas frecuentes (boleta, factura, contadora, IGV) para quien cobra. Mismos roles que Ventas.
  { path: '/ayuda', label: 'Ayuda', icono: CircleHelp, roles: ROLES_CAJA },
]

// Pestaña a la que entra cada rol al iniciar sesión. Antes salía de "la primera sección visible" y eso ataba el orden
// del menú (la asistente debía ver Mis atenciones antes que Citas). Bug histórico que esto sigue evitando: una ASISTENTE no
// ve Ventas, y un "/ventas" fijo la dejaba en pantalla negra para siempre.
const INICIO_POR_ROL = {
  ADMINISTRADOR: '/ventas',
  CAJERA: '/ventas',
  ENCARGADA: '/ventas',
  ASISTENTE: '/mi-panel',
  PERSONAL_APOYO: '/mi-panel',
}

export function rutaInicialPara(rol) {
  const fija = INICIO_POR_ROL[rol]
  if (fija && secciones.some((seccion) => seccion.path === fija && seccion.roles.includes(rol))) return fija
  return secciones.find((seccion) => seccion.roles.includes(rol))?.path ?? '/ventas'
}
