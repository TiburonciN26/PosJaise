// Lógica PURA del «Detalle del período» del Dashboard (sin Supabase: se prueba con node --test, ver
// tests/e2e/detalle-dashboard.test.mjs). Las consultas viven en detalleDashboardDatos.js.
//
// Cada pestaña del detalle explica un monto del «Resumen del período»; el total del pie de la pestaña tiene que ser
// IGUAL a ese monto (lo garantiza la RPC detalle_dashboard, que usa los mismos filtros que resumen_dashboard).
import { sumarMontos } from './moneda.js'

export const PESTANAS_DETALLE = [
  { id: 'productos', etiqueta: 'Productos' },
  { id: 'servicios', etiqueta: 'Servicios' },
  { id: 'descuentos', etiqueta: 'Descuentos' },
  { id: 'comisiones', etiqueta: 'Comisiones' },
  { id: 'gastos', etiqueta: 'Gastos' },
  { id: 'envios', etiqueta: 'Envío' },
]

export const PESTANA_INICIAL_DETALLE = 'productos'

export function esPestanaDetalle(id) {
  return PESTANAS_DETALLE.some((pestana) => pestana.id === id)
}

// Columna que se suma para el total de cada pestaña (la RPC devuelve números; los null cuentan 0).
const COLUMNA_TOTAL = {
  productos: 'ingreso',
  servicios: 'precio',
  descuentos: 'descuento',
  comisiones: 'pago',
  gastos: 'monto',
  envios: 'envio',
}

export function totalDetalle(pestana, filas) {
  const columna = COLUMNA_TOTAL[pestana]
  if (!columna) return 0
  return sumarMontos(filas ?? [], (fila) => Number(fila[columna] ?? 0))
}

// Solo para productos: costo y ganancia del conjunto (para el pie y para cuadrar con «Gastos productos» y
// «Ganancia productos» del Resumen).
export function totalesProductos(filas) {
  const ingreso = totalDetalle('productos', filas)
  const costo = sumarMontos(filas ?? [], (fila) => Number(fila.costo ?? 0))
  const unidades = (filas ?? []).reduce((acumulado, fila) => acumulado + Number(fila.unidades ?? 0), 0)
  return { ingreso, costo, ganancia: sumarMontos([ingreso, -costo]), unidades }
}

// Búsqueda del detalle: sin mayúsculas ni tildes, y TODAS las palabras escritas deben aparecer (en cualquier orden) en alguno
// de los textos de la fila. Qué texto cuenta depende del rubro.
export function normalizarBusqueda(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

const CAMPOS_BUSQUEDA = {
  productos: ['nombre'],
  servicios: ['servicio', 'cliente', 'asistente', 'codigo'],
  descuentos: ['cliente', 'codigo', 'cupon'],
  comisiones: ['asistente', 'servicio', 'cliente'],
  gastos: ['nombre', 'tipo'],
  envios: ['cliente', 'codigo', 'tipo_entrega'],
}
const CAMPOS_VENTA_PRODUCTO = ['cliente', 'vendedor', 'codigo']

function coincide(textos, palabras) {
  const pajar = normalizarBusqueda(textos.filter(Boolean).join(' '))
  return palabras.every((palabra) => pajar.includes(palabra))
}

function textosDe(objeto, campos) {
  return campos.map((campo) => (campo === 'tipo' ? (objeto.tipo === 'FIJO' ? 'fijo' : 'variable') : objeto[campo]))
}

// Productos: si el NOMBRE coincide se conserva la fila completa; si solo coinciden algunas ventas (el cliente, quien vendió o el
// código), la fila se queda con ESAS ventas y sus cifras (unidades, ingreso, costo, ganancia) se recalculan sobre ellas, para
// que la fila no muestre el total de otras ventas que no se buscaron.
function filtrarProducto(fila, palabras) {
  if (coincide(textosDe(fila, CAMPOS_BUSQUEDA.productos), palabras)) return fila
  const ventas = (fila.ventas ?? []).filter((venta) =>
    coincide([fila.nombre, ...textosDe(venta, CAMPOS_VENTA_PRODUCTO)], palabras),
  )
  if (ventas.length === 0) return null
  const unidades = ventas.reduce((acumulado, venta) => acumulado + Number(venta.cantidad ?? 0), 0)
  const ingreso = sumarMontos(ventas, (venta) => Number(venta.subtotal ?? 0))
  const costoUnitario = Number(fila.unidades) > 0 ? Number(fila.costo ?? 0) / Number(fila.unidades) : 0
  const costo = sumarMontos([unidades * costoUnitario])
  return { ...fila, ventas, unidades, ingreso, costo, ganancia: sumarMontos([ingreso, -costo]) }
}

export function filtrarDetalle(pestana, filas, termino) {
  const palabras = normalizarBusqueda(termino).split(/\s+/).filter(Boolean)
  if (palabras.length === 0 || !filas) return filas
  if (pestana === 'productos') return filas.map((fila) => filtrarProducto(fila, palabras)).filter(Boolean)
  const campos = CAMPOS_BUSQUEDA[pestana] ?? []
  return filas.filter((fila) => coincide(textosDe(fila, campos), palabras))
}

// Paginación en el cliente (la RPC devuelve el período completo; son pocas filas por rubro).
export const TAM_PAGINA_DETALLE = 15

export function paginarDetalle(filas, pagina, tam = TAM_PAGINA_DETALLE) {
  const total = filas.length
  const totalPaginas = Math.max(1, Math.ceil(total / tam))
  const actual = Math.min(Math.max(1, pagina), totalPaginas)
  return { filas: filas.slice((actual - 1) * tam, actual * tam), pagina: actual, totalPaginas, total }
}

// «14 nov, 3:20 p. m.» en hora de Lima (como el resto del POS: la hora del servidor llega en UTC).
export function formatearFechaHoraLima(fechaIso) {
  if (!fechaIso) return ''
  const fecha = new Date(fechaIso)
  if (Number.isNaN(fecha.getTime())) return ''
  const dia = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', timeZone: 'America/Lima' }).format(fecha)
  const hora = new Intl.DateTimeFormat('es-PE', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Lima',
  }).format(fecha)
  return `${dia.replace('.', '')}, ${hora}`
}
