import { Gift, Percent, ShoppingBag, Sparkles, Ticket, Crown } from 'lucide-react'

// Secciones internas de Recompensas (estado en la URL: ?seccion=...).
export const SECCIONES = [
  { clave: 'tarjeta', label: 'Mi tarjeta', personal: true },
  { clave: 'canje', label: 'Canjear puntos', personal: false },
  { clave: 'sellos', label: 'Mis sellos', personal: true },
  { clave: 'cupones', label: 'Mis cupones', personal: true },
  { clave: 'movimientos', label: 'Movimientos', personal: true },
  { clave: 'como', label: 'Cómo funciona', personal: false },
]

export const NOMBRES_NIVEL = { BASICO: 'Básico', PREMIUM: 'Premium', VIP: 'VIP' }
export const ORDEN_NIVEL = ['BASICO', 'PREMIUM', 'VIP']

// Beneficios por nivel — PROPUESTA del diseño (docs/diseno-recompensas):
// no hay beneficios reales por nivel en el backend todavía, solo el
// nivel en sí (mis_puntos()). Los umbrales sí son los reales.
export const BENEFICIOS_NIVEL = [
  {
    clave: 'BASICO',
    nombre: 'Básico',
    descripcion: 'Para empezar: el catálogo principal de recompensas y el programa de sellos.',
    beneficios: ['Acceso al catálogo principal de recompensas', 'Programa de sellos'],
  },
  {
    clave: 'PREMIUM',
    nombre: 'Premium',
    descripcion: 'Más recompensas: acceso a premios exclusivos para tu nivel.',
    beneficios: ['Todo lo de Básico', 'Acceso a determinadas recompensas exclusivas'],
  },
  {
    clave: 'VIP',
    nombre: 'VIP',
    descripcion: 'Lo mejor del club: premios especiales y precios en puntos preferenciales.',
    beneficios: [
      'Todo lo de Premium',
      'Acceso a recompensas especiales',
      'Precios en puntos preferenciales para premios seleccionados',
    ],
  },
]

// Catálogo de recompensas — DATOS FICTICIOS (Fase 1, solo frontend): no
// existe catálogo ni RPC de canje en el backend. La del cupón de S/5 es
// la única acordada con el negocio (README de docs/diseno-recompensas);
// las demás son ejemplos editables con importes pendientes de aprobación.
// `estado` fija el caso que se muestra: 'acordada' | 'ejemplo' | 'prox'
// (próximamente) | 'agotada' | 'vencida'.
export const CATEGORIAS = [
  { clave: 'todas', label: 'Todas' },
  { clave: 'fijo', label: 'Descuento fijo' },
  { clave: 'porc', label: 'Porcentaje' },
  { clave: 'prod', label: 'Productos' },
  { clave: 'regalo', label: 'Regalos' },
  { clave: 'servicio', label: 'Servicios' },
  { clave: 'exclusivo', label: 'Exclusivas' },
]

export const RECOMPENSAS = [
  {
    id: 'r1',
    cat: 'fijo',
    estado: 'acordada',
    icono: Ticket,
    nombre: 'Cupón de S/5 en servicios seleccionados',
    desc: 'Un descuento fijo para tu próximo servicio.',
    precio: 50,
    beneficio: 'S/5 de descuento en una compra posterior',
    aplica: 'Solo servicios seleccionados (lista por definir)',
    minimo: 'S/60 en servicios elegibles',
    nivelMin: 0,
    stock: null,
    vigencia: '60 días desde la emisión (propuesta pendiente)',
    comb: '1 cupón por compra · no acumulable con otras promociones',
  },
  {
    id: 'r2',
    cat: 'porc',
    estado: 'ejemplo',
    icono: Percent,
    nombre: 'Cupón del 10 % con tope',
    desc: 'Descuento porcentual con el máximo visible desde el inicio.',
    precio: 120,
    beneficio: '10 % de descuento, hasta S/15',
    aplica: 'Servicios seleccionados (lista por definir)',
    minimo: 'S/100 en servicios elegibles',
    nivelMin: 0,
    stock: null,
    vigencia: '60 días desde la emisión (propuesta)',
    comb: '1 cupón por compra · no acumulable',
  },
  {
    id: 'r3',
    cat: 'prod',
    estado: 'ejemplo',
    icono: ShoppingBag,
    nombre: 'S/10 en productos seleccionados',
    desc: 'Descuento en cuidado capilar de una lista elegida.',
    precio: 100,
    beneficio: 'S/10 de descuento en una compra posterior',
    aplica: 'Productos seleccionados (lista por definir)',
    minimo: 'S/80 en productos elegibles',
    nivelMin: 0,
    stock: 12,
    vigencia: '60 días desde la emisión (propuesta)',
    comb: '1 cupón por compra · no acumulable',
  },
  {
    id: 'r4',
    cat: 'regalo',
    estado: 'prox',
    icono: Gift,
    nombre: 'Mini mascarilla de regalo',
    desc: 'Un producto de regalo con tu próxima compra de productos.',
    precio: 80,
    beneficio: 'Un producto de regalo en tu pedido',
    aplica: 'Pedidos de productos',
    minimo: 'Por definir',
    nivelMin: 0,
    stock: null,
    vigencia: 'Por definir',
    comb: 'Por definir',
  },
  {
    id: 'r5',
    cat: 'servicio',
    estado: 'ejemplo',
    icono: Sparkles,
    nombre: 'Complemento hidratante en tu servicio',
    desc: 'Un complemento sumado a un servicio elegible.',
    precio: 200,
    beneficio: 'Un complemento hidratante incluido',
    aplica: 'Servicios seleccionados (lista por definir)',
    minimo: 'S/120 en servicios elegibles',
    nivelMin: 1,
    stock: null,
    vigencia: '60 días desde la emisión (propuesta)',
    comb: '1 por compra · no acumulable',
  },
  {
    id: 'r6',
    cat: 'exclusivo',
    estado: 'ejemplo',
    icono: Crown,
    nombre: 'Tratamiento con precio preferencial VIP',
    desc: 'Un premio especial con precio en puntos preferencial para clientas VIP.',
    precio: 250,
    beneficio: 'Tratamiento seleccionado canjeable en puntos',
    aplica: 'Un tratamiento seleccionado (por definir)',
    minimo: 'Por definir',
    nivelMin: 2,
    stock: 5,
    vigencia: '90 días desde la emisión (ejemplo)',
    comb: '1 por compra · no acumulable',
  },
  {
    id: 'r7',
    cat: 'regalo',
    estado: 'agotada',
    icono: Gift,
    nombre: 'Kit de regalo de temporada',
    desc: 'Edición limitada de productos de regalo.',
    precio: 90,
    beneficio: 'Un kit de regalo',
    aplica: 'Entrega en tienda',
    minimo: 'Sin mínimo',
    nivelMin: 0,
    stock: 0,
    vigencia: 'Hasta agotar stock',
    comb: '1 por clienta',
  },
  {
    id: 'r8',
    cat: 'fijo',
    estado: 'vencida',
    icono: Ticket,
    nombre: 'Cupón aniversario de S/8',
    desc: 'Campaña de aniversario ya finalizada.',
    precio: 60,
    beneficio: 'S/8 de descuento',
    aplica: 'Servicios seleccionados',
    minimo: 'S/70 en servicios elegibles',
    nivelMin: 0,
    stock: null,
    vigencia: 'Campaña finalizada',
    comb: '1 cupón por compra',
  },
]

// Nivel de color (Bronce/Plata/Oro) de una fila de "Canjear puntos",
// según su precio en puntos — mismo criterio de "a más valor, más
// premium" que nivelCupon() usa con el valor de un cupón.
export function nivelColorRecompensa(precio) {
  if (precio >= 200) return 'Oro'
  if (precio >= 100) return 'Plata'
  return 'Bronce'
}
