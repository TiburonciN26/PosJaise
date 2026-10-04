// Catálogo de productos de Caja en el SERVIDOR (QA-047). Antes `Ventas.jsx` descargaba `productos_vista`
// activos sin paginar y buscaba por nombre y por código de barras sobre esa copia: el servidor corta cada
// respuesta en `max_rows` (1000), así que los productos posteriores a esa posición (por nombre) eran
// invisibles al buscador Y al escáner, y el stock del carrito se leía de la misma copia truncada. Ahora:
// búsqueda por nombre acotada, código de barras por consulta EXACTA y stock del carrito por ID.
//
// Recibe el cliente de Supabase por parámetro para poder probarse fuera del navegador.
import { patronIlike } from './buscarClientes.js'

export const LIMITE_PRODUCTOS_VENTA = 20
const COLUMNAS = 'id, codigo_barras, nombre, categoria, precio, stock_actual'

// Primeros `limite` productos ACTIVOS cuyo nombre coincide (orden por nombre e id).
export async function buscarProductosVenta(supabase, termino, { limite = LIMITE_PRODUCTOS_VENTA } = {}) {
  const texto = termino.trim()
  if (!texto) return []
  const { data, error } = await supabase
    .from('productos_vista')
    .select(COLUMNAS)
    .eq('activo', true)
    .ilike('nombre', patronIlike(texto))
    .order('nombre')
    .order('id')
    .limit(limite)
  if (error) throw error
  return data ?? []
}

// Resolución EXACTA de un código de barras. Devuelve { producto, ambiguo }: si hubiera dos productos activos
// con el mismo código no se elige uno al azar (`ambiguo`), igual que el `find` anterior no lo garantizaba.
export async function productoPorCodigo(supabase, codigo) {
  const texto = codigo.trim()
  if (!texto) return { producto: null, ambiguo: false }
  const { data, error } = await supabase
    .from('productos_vista')
    .select(COLUMNAS)
    .eq('activo', true)
    .eq('codigo_barras', texto)
    .order('id')
    .limit(2)
  if (error) throw error
  const filas = data ?? []
  return { producto: filas.length === 1 ? filas[0] : null, ambiguo: filas.length > 1 }
}

// Precio y stock ACTUALES de los productos del carrito, por ID (no dependen de ninguna copia truncada).
export async function productosPorIds(supabase, ids) {
  if (ids.length === 0) return []
  const { data, error } = await supabase.from('productos_vista').select(COLUMNAS).in('id', ids)
  if (error) throw error
  return data ?? []
}

// Combo sugerido de la ficha Web de un producto (QA-047 / separación POS-Web): mismas reglas que Caja (solo activos,
// acotado, orden determinista) pero también devuelve la ficha elegida por ID para conservar la selección guardada.
export async function buscarProductosCombo(supabase, termino, { limite = LIMITE_PRODUCTOS_VENTA, excluirId = null } = {}) {
  let consulta = supabase.from('productos_vista').select('id, nombre').eq('activo', true).order('nombre').order('id').limit(limite)
  if (excluirId) consulta = consulta.neq('id', excluirId)
  if (termino.trim()) consulta = consulta.ilike('nombre', patronIlike(termino))
  const { data, error } = await consulta
  if (error) throw error
  return data ?? []
}

export async function productoNombrePorId(supabase, id) {
  const { data, error } = await supabase.from('productos_vista').select('id, nombre').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}
