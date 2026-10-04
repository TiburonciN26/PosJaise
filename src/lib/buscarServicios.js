// Catálogo de servicios en el SERVIDOR (QA-046). Antes Servicios, Nueva cita, Registrar atención, Deuda y
// Recompensas descargaban la tabla `servicios` sin paginar y filtraban en el navegador: el servidor corta
// cada respuesta en `max_rows` (1000), así que las fichas posteriores a esa posición (por nombre) eran
// invisibles. Aquí: búsqueda acotada para selectores, listado paginado para la pantalla de Servicios y
// lectura completa por bloques para las pantallas de configuración que necesitan todo el conjunto.
//
// Recibe el cliente de Supabase por parámetro para poder probarse fuera del navegador.
import { patronIlike } from './buscarClientes.js'
import { leerPaginado } from './leerPaginado.js'

export const LIMITE_SERVICIOS = 20
export const TAMANO_PAGINA_SERVICIOS = 50
export const COLUMNAS_SELECTOR_SERVICIO = 'id, nombre, precio, duracion_min, categoria'

// Orden de la pantalla Servicios → columnas del servidor. Desempate por nombre y id para que las páginas no
// repitan ni salten filas. Una duración vacía se ordenaba como 0 (primero en ascendente).
const ORDENES = {
  'nombre-asc': [['nombre', true]],
  'nombre-desc': [['nombre', false]],
  'precio-asc': [['precio', true], ['nombre', true]],
  'precio-desc': [['precio', false], ['nombre', true]],
  'duracion-asc': [['duracion_min', true, true], ['nombre', true]],
  'duracion-desc': [['duracion_min', false, false], ['nombre', true]],
}

function ordenar(consulta, orden) {
  let q = consulta
  for (const [columna, ascending, nullsFirst] of ORDENES[orden] ?? ORDENES['nombre-asc']) {
    q = nullsFirst === undefined ? q.order(columna, { ascending }) : q.order(columna, { ascending, nullsFirst })
  }
  return q.order('id')
}

// Sugerencias para selectores (Nueva cita, Registrar atención, Deuda, combo): las primeras `limite` por
// nombre que coinciden con el texto. Sin texto, las primeras `limite`.
export async function buscarServicios(
  supabase,
  termino,
  { limite = LIMITE_SERVICIOS, soloActivos = false, columnas = COLUMNAS_SELECTOR_SERVICIO, excluirId = null } = {},
) {
  let consulta = supabase.from('servicios').select(columnas).order('nombre').order('id').limit(limite)
  if (soloActivos) consulta = consulta.eq('activo', true)
  if (excluirId) consulta = consulta.neq('id', excluirId)
  if (termino.trim()) consulta = consulta.ilike('nombre', patronIlike(termino))
  const { data, error } = await consulta
  if (error) throw error
  return data ?? []
}

// Una ficha por ID (para conservar una selección que cae fuera de la página de resultados).
export async function servicioPorId(supabase, id, columnas = COLUMNAS_SELECTOR_SERVICIO) {
  const { data, error } = await supabase.from('servicios').select(columnas).eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

// Una página del listado de Servicios (búsqueda + orden resueltos por el servidor). `desde` es la posición.
export function consultaListadoServicios(supabase, { termino = '', orden = 'nombre-asc', columnas }) {
  let consulta = supabase.from('servicios').select(columnas)
  if (termino.trim()) consulta = consulta.ilike('nombre', patronIlike(termino))
  return ordenar(consulta, orden)
}

// Categorías distintas (para el selector de ModalServicio): lectura completa de una sola columna.
export async function categoriasDeServicios(supabase) {
  const filas = await leerPaginado(() =>
    supabase.from('servicios').select('id, categoria').not('categoria', 'is', null).order('id'),
  )
  return [...new Set(filas.map((f) => f.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

// Todo el catálogo (solo pantallas de configuración o del portal que lo muestran entero).
export function leerServicios(supabase, { columnas, soloActivos = false } = {}) {
  return leerPaginado(() => {
    let consulta = supabase.from('servicios').select(columnas ?? COLUMNAS_SELECTOR_SERVICIO)
    if (soloActivos) consulta = consulta.eq('activo', true)
    return consulta.order('nombre').order('id')
  })
}
