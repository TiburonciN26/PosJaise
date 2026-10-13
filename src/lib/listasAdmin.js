// Fase 5: lecturas paginadas de las listas administrativas (Pedidos Web, Promociones, Reseñas, Referidos y Fidelización).
// Cada una devuelve `{ data, count, error }` con el conteo EXACTO del servidor para el filtro vigente, un orden determinista
// (columna de fecha + id: las páginas ni repiten ni se saltan filas) y la búsqueda hecha en el servidor. Reciben el cliente de
// Supabase por parámetro para poder probarse fuera del navegador.
import { patronIlike, valorCitado } from './buscarClientes.js'

export const ESTADOS_PEDIDO = ['PENDIENTE', 'LISTO', 'ENTREGADO', 'CANCELADO']
export const ESTADOS_RESENA = ['PENDIENTE', 'APROBADA', 'RECHAZADA']
export const ORIGENES_REFERIDOS = ['REFERIDO_BIENVENIDA', 'REFERIDO_RECOMPENSA']

const ordenar = (consulta) => consulta.order('creado_en', { ascending: false }).order('id', { ascending: false })

// Pedidos Web. La lista NO trae los ítems (son el detalle: se piden al expandir cada pedido con `leerItemsPedido`).
const COLUMNAS_PEDIDO =
  'id, tipo_entrega, direccion_entrega, celular_entrega, costo_delivery, subtotal, descuento_cupon, total, estado, creado_en, ' +
  'metodo_pago, comprobante_url, cupon_codigo, tipo_comprobante, ruc, razon_social, pago_verificado, zonas_delivery(nombre)'

export function leerPedidos(supabase, { termino = '', estado = null, desde, hasta }) {
  const buscando = termino.trim() !== ''
  // `!inner` solo al buscar: exige que exista la clienta que coincide. Sin búsqueda se conserva el pedido aunque no tenga clienta.
  const cliente = buscando ? 'clientes!inner(nombre, telefono)' : 'clientes(nombre, telefono)'
  let consulta = supabase.from('pedidos_web').select(`${COLUMNAS_PEDIDO}, ${cliente}`, { count: 'exact' })
  if (estado) consulta = consulta.eq('estado', estado)
  if (buscando) consulta = consulta.ilike('clientes.nombre', patronIlike(termino))
  return ordenar(consulta).range(desde, hasta)
}

export async function leerItemsPedido(supabase, pedidoId) {
  const { data, error } = await supabase
    .from('pedidos_web_items')
    .select('id, nombre_producto, cantidad, precio_unitario, subtotal')
    .eq('pedido_id', pedidoId)
    .order('id')
  if (error) throw error
  return data ?? []
}

export function contarPedidosPorEstado(supabase) {
  return contarPorEstado(supabase, 'pedidos_web', ESTADOS_PEDIDO)
}

export function leerPromociones(supabase, { termino = '', desde, hasta }) {
  let consulta = supabase
    .from('promociones')
    .select('id, titulo, descripcion, tipo_descuento, valor, vigente_desde, vigente_hasta, activo', { count: 'exact' })
  if (termino.trim()) consulta = consulta.ilike('titulo', patronIlike(termino))
  return ordenar(consulta).range(desde, hasta)
}

// Reseñas: vista resenas_moderacion (unión de resenas, resenas_producto y resenas_servicio; migración 20261011000002).
export function leerResenas(supabase, { termino = '', estado = null, desde, hasta }) {
  let consulta = supabase
    .from('resenas_moderacion')
    .select('origen, id, calificacion, comentario, estado, creado_en, cliente_nombre, cliente_telefono, item_nombre', { count: 'exact' })
  if (estado) consulta = consulta.eq('estado', estado)
  if (termino.trim()) {
    const patron = valorCitado(patronIlike(termino))
    consulta = consulta.or(`cliente_nombre.ilike.${patron},item_nombre.ilike.${patron}`)
  }
  return ordenar(consulta).order('origen').range(desde, hasta)
}

export function contarResenasPorEstado(supabase) {
  return contarPorEstado(supabase, 'resenas_moderacion', ESTADOS_RESENA)
}

// Cupones de Referidos / Fidelización: vista cupones_gestion (cupón + nombre de la clienta; migración 20261011000002).
export function leerCupones(supabase, { origenes, estado = null, termino = '', desde, hasta }) {
  let consulta = supabase
    .from('cupones_gestion')
    .select('id, codigo, origen, valor, tipo_descuento, estado, creado_en, cliente_nombre', { count: 'exact' })
    .in('origen', origenes)
  if (estado) consulta = consulta.eq('estado', estado)
  if (termino.trim()) {
    // Búsqueda sin mayúsculas ni tildes (como antes de la Fase 5): el texto se normaliza igual que las columnas *_busqueda de la vista.
    const patron = valorCitado(patronIlike(normalizarBusqueda(termino)))
    consulta = consulta.or(`codigo_busqueda.ilike.${patron},cliente_busqueda.ilike.${patron}`)
  }
  return ordenar(consulta).range(desde, hasta)
}

// NFD + sin marcas diacríticas + minúsculas + sin espacios sobrantes (mismo criterio que usaban Referidos y Fidelización).
export const normalizarBusqueda = (texto) => (texto ?? '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

// Conteos GLOBALES (de toda la tabla, no de la página) para los contadores de estado. Una consulta de solo conteo por estado.
// Si alguna falla, el conjunto completo falla: un contador parcial no se presenta como total.
export async function contarPorEstado(supabase, tabla, estados, filtroBase = (c) => c) {
  const respuestas = await Promise.all(
    estados.map((estado) => filtroBase(supabase.from(tabla).select('id', { count: 'exact', head: true })).eq('estado', estado)),
  )
  const falla = respuestas.find((r) => r.error || !Number.isSafeInteger(r.count))
  if (falla) throw falla.error ?? new Error('Conteo no disponible.')
  return Object.fromEntries(estados.map((estado, i) => [estado, respuestas[i].count]))
}

export const contarCuponesPorEstado = (supabase, origenes) =>
  contarPorEstado(supabase, 'cupones_gestion', ['DISPONIBLE', 'CANJEADO', 'ANULADO'], (c) => c.in('origen', origenes))
