// Lectura ACOTADA de los catálogos públicos del portal (Productos y Servicios) — Fase 4.
//
// Antes cada página descargaba TODO el catálogo (y el servidor lo cortaba en max_rows = 1000) y derivaba en el navegador las
// categorías, los conteos, el héroe, las cintas y las filas. Aquí cada pieza es una consulta pequeña y acotada:
//   · vitrina agrupada («Todos»): los METADATOS de las categorías (nombre y total de TODAS) vienen de *_categorias_publicas(); las
//     tarjetas, de *_vitrina_publica(), que devuelve las primeras N de cada categoría pero solo de una VENTANA de categorías
//     (GRUPOS_POR_VENTANA × POR_CATEGORIA = 40 tarjetas como máximo). Las ventanas siguientes se piden al paginar los grupos;
//     todas las categorías son alcanzables sin descargar nunca todas las tarjetas.
//   · héroe, ofertas y destacados: consultas con límite y criterio explícitos.
//   · listado plano (categoría o búsqueda): páginas de TAMANO_PAGINA_CATALOGO con range() y conteo exacto; búsqueda ilike en el
//     servidor sobre TODO el catálogo que permite RLS (también las filas posteriores a las primeras 1000).
// No toca `leerServicios` ni otros helpers de lectura completa: tienen consumidores administrativos con otro contrato.
//
// Recibe el cliente de Supabase por parámetro (como buscarServicios.js) para poder probarse fuera del navegador.
import { patronIlike } from './buscarClientes.js'

export const TAMANO_PAGINA_CATALOGO = 40
export const POR_CATEGORIA = 4 // tarjetas por fila de categoría en la vista agrupada
export const GRUPOS_POR_VENTANA = 10 // filas de categoría por ventana de «Todos»: 10 × 4 = 40 tarjetas
export const MAX_HERO_PRODUCTOS = 5
export const MAX_HERO_SERVICIOS = 3
export const MAX_CINTA = 12 // tarjetas por cinta de Ofertas / Destacados
export const DIAS_MAS_PEDIDOS = 30
const CANDIDATOS_MAS_PEDIDOS = 40 // cuántos del ranking se consideran para el héroe de Servicios (solo hacen falta 3)

export const COLUMNAS_PRODUCTO_TARJETA =
  'id, nombre, categoria, subcategoria, precio, precio_antes, stock_actual, foto_url, descripcion, destacado, nuevo, en_inicio'
export const COLUMNAS_SERVICIO_TARJETA = 'id, nombre, categoria, precio, duracion_min, foto_url, descripcion, en_tendencia'

// ---------- piezas puras (probables sin red) ----------

export function paginasTotales(total, tam = TAMANO_PAGINA_CATALOGO) {
  return Math.max(1, Math.ceil((Number(total) || 0) / tam))
}

// range() de PostgREST es inclusivo en ambos extremos.
export function rangoPagina(pagina, tam = TAMANO_PAGINA_CATALOGO) {
  const desde = (Math.max(1, pagina) - 1) * tam
  return [desde, desde + tam - 1]
}

// Filas de la función de vitrina (ya ordenadas por el servidor) → categorías en orden, conteo global de cada una y sus primeras N.
export function agruparVitrina(filas) {
  const porCategoria = new Map()
  const grupos = []
  for (const fila of filas ?? []) {
    const { total_categoria: total, ...tarjeta } = fila
    let grupo = porCategoria.get(fila.categoria)
    if (!grupo) {
      grupo = { categoria: fila.categoria, total: Number(total), primeros: [] }
      porCategoria.set(fila.categoria, grupo)
      grupos.push(grupo)
    }
    grupo.primeros.push(tarjeta)
  }
  return {
    grupos,
    categorias: grupos.map((g) => g.categoria),
    conteos: Object.fromEntries(grupos.map((g) => [g.categoria, g.total])),
  }
}

// Filas de *_categorias_publicas() → nombres en orden y total de CADA categoría (independiente de la ventana de tarjetas).
export function metadatosCategorias(filas) {
  const lista = filas ?? []
  return {
    categorias: lista.map((f) => f.categoria),
    conteos: Object.fromEntries(lista.map((f) => [f.categoria, Number(f.total)])),
  }
}

// Héroe de Servicios: 1) marcados «en tendencia», 2) los más pedidos (en el orden del ranking), 3) cualquiera con foto; sin repetir y
// hasta `max`. Solo entran servicios con foto (el héroe es una pieza visual). Misma prioridad que tenía la página.
export function componerHeroServicios({ tendencia = [], ranking = [], conRanking = [], relleno = [] }, max = MAX_HERO_SERVICIOS) {
  const elegidos = []
  const vistos = new Set()
  const agregar = (servicio, etiquetaHero) => {
    if (!servicio || vistos.has(servicio.id) || elegidos.length >= max) return
    vistos.add(servicio.id)
    elegidos.push({ ...servicio, etiquetaHero })
  }
  tendencia.forEach((s) => agregar(s, 'En tendencia'))
  const porId = new Map(conRanking.map((s) => [s.id, s]))
  ranking.map((id) => porId.get(id)).forEach((s) => agregar(s, 'Lo más pedido'))
  relleno.forEach((s) => agregar(s, 'Recomendado'))
  return elegidos
}

// ---------- consultas ----------

const conSenal = (consulta, signal) => (signal ? consulta.abortSignal(signal) : consulta)

async function ejecutar(consulta, signal) {
  const { data, error, count } = await conSenal(consulta, signal)
  if (error) throw error
  return { data: data ?? [], count }
}

// Una página del listado plano. Orden determinista (nombre, id): una página nunca repite ni salta filas sobre datos estables.
export async function leerPaginaCatalogo(supabase, { tabla, columnas, categoria = 'todos', termino = '', pagina = 1, tam = TAMANO_PAGINA_CATALOGO, signal }) {
  const [desde, hasta] = rangoPagina(pagina, tam)
  let consulta = supabase.from(tabla).select(columnas, { count: 'exact' }).eq('activo', true)
  if (categoria && categoria !== 'todos') consulta = consulta.eq('categoria', categoria)
  if (termino.trim()) consulta = consulta.ilike('nombre', patronIlike(termino))
  const { data, count } = await ejecutar(consulta.order('nombre').order('id').range(desde, hasta), signal)
  return { filas: data, total: count ?? data.length }
}

// Metadatos de categorías COMPLETOS. El servidor corta toda respuesta en max_rows (también la de una función que devuelve filas),
// así que se leen por tramos con range() y el conteo exacto de la función, en su orden estable. El conteo es OBLIGATORIO en cada
// tramo (entero, finito, ≥ 0) y debe coincidir con el del primero: la longitud de un tramo nunca acredita el tamaño de la colección.
// Si falta, es inválido, cambia entre tramos, o el total no se alcanza, se lanza un error: una lista parcial nunca se presenta
// como completa (la vitrina muestra el error con Reintentar).
export const TRAMO_CATEGORIAS = 500
export async function leerCategoriasCompletas(supabase, funcion, signal, tramo = TRAMO_CATEGORIAS) {
  const filas = []
  let total = null
  while (total === null || filas.length < total) {
    const { data, count } = await ejecutar(supabase.rpc(funcion, {}, { count: 'exact' }).range(filas.length, filas.length + tramo - 1), signal)
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Categorías: el servidor no devolvió un conteo exacto válido (${String(count)})`)
    if (total !== null && count !== total) throw new Error(`Categorías: el total cambió durante la lectura (${total} → ${count})`)
    total = count
    if (!data.length) break
    filas.push(...data)
  }
  if (filas.length !== total) throw new Error(`Categorías incompletas: ${filas.length} de ${total}`)
  return filas
}

const totalActivos = async (supabase, tabla, signal) =>
  (await ejecutar(supabase.from(tabla).select('id', { count: 'exact', head: true }).eq('activo', true), signal)).count ?? 0

// Una pieza opcional (héroe, cintas): si falla, la vista sigue sin ella en vez de bloquearse.
const opcional = (promesa, valorVacio) => promesa.catch((error) => (error?.name === 'AbortError' ? Promise.reject(error) : valorVacio))

export async function cargarVitrinaProductos(supabase, { signal } = {}) {
  const base = () => supabase.from('productos').select(COLUMNAS_PRODUCTO_TARJETA, { count: 'exact' }).eq('activo', true).gt('stock_actual', 0)
  const [categoriasRes, ventana, total, hero, ofertas, destacados] = await Promise.all([
    leerCategoriasCompletas(supabase, 'productos_categorias_publicas', signal),
    ejecutar(supabase.rpc('productos_vitrina_publica', { por_categoria: POR_CATEGORIA, grupo_desde: 0, grupos_max: GRUPOS_POR_VENTANA }), signal),
    totalActivos(supabase, 'productos', signal),
    opcional(ejecutar(base().eq('en_inicio', true).order('nombre').order('id').limit(MAX_HERO_PRODUCTOS), signal).then((r) => r.data), []),
    opcional(
      ejecutar(base().not('precio_antes', 'is', null).gt('precio_antes', 0).order('nombre').order('id').limit(MAX_CINTA), signal).then((r) => ({ filas: r.data, total: r.count ?? r.data.length })),
      { filas: [], total: 0 },
    ),
    opcional(
      ejecutar(base().eq('destacado', true).order('nombre').order('id').limit(MAX_CINTA), signal).then((r) => ({ filas: r.data, total: r.count ?? r.data.length })),
      { filas: [], total: 0 },
    ),
  ])
  return { ...metadatosCategorias(categoriasRes), grupos: agruparVitrina(ventana.data).grupos, total, hero, ofertas, destacados }
}

export async function cargarVitrinaServicios(supabase, { signal } = {}) {
  const activos = () => supabase.from('servicios').select(COLUMNAS_SERVICIO_TARJETA).eq('activo', true).not('foto_url', 'is', null).neq('foto_url', '')
  const [categoriasRes, ventana, total, precioDesde, heroPartes] = await Promise.all([
    leerCategoriasCompletas(supabase, 'servicios_categorias_publicas', signal),
    ejecutar(supabase.rpc('servicios_vitrina_publica', { por_categoria: POR_CATEGORIA, dias: DIAS_MAS_PEDIDOS, grupo_desde: 0, grupos_max: GRUPOS_POR_VENTANA }), signal),
    totalActivos(supabase, 'servicios', signal),
    opcional(
      ejecutar(supabase.from('servicios').select('precio').eq('activo', true).order('precio', { ascending: true }).limit(1), signal).then((r) => (r.data[0] ? Number(r.data[0].precio) : null)),
      null,
    ),
    opcional(cargarPartesHeroServicios(supabase, activos, signal), { tendencia: [], ranking: [], conRanking: [], relleno: [] }),
  ])
  return { ...metadatosCategorias(categoriasRes), grupos: agruparVitrina(ventana.data).grupos, total, precioDesde, hero: componerHeroServicios(heroPartes) }
}

async function cargarPartesHeroServicios(supabase, activos, signal) {
  const [tendencia, relleno, rankingFilas] = await Promise.all([
    ejecutar(activos().eq('en_tendencia', true).order('nombre').order('id').limit(MAX_HERO_SERVICIOS), signal).then((r) => r.data),
    ejecutar(activos().order('nombre').order('id').limit(MAX_HERO_SERVICIOS), signal).then((r) => r.data),
    ejecutar(supabase.rpc('servicios_mas_pedidos', { dias: DIAS_MAS_PEDIDOS }), signal).then((r) => r.data),
  ])
  const ranking = rankingFilas.slice(0, CANDIDATOS_MAS_PEDIDOS).map((f) => f.servicio_id)
  const conRanking = ranking.length ? (await ejecutar(activos().in('id', ranking).limit(CANDIDATOS_MAS_PEDIDOS), signal)).data : []
  return { tendencia, ranking, conRanking, relleno }
}

// Una ventana de grupos de «Todos» (pagina 1 = las primeras GRUPOS_POR_VENTANA categorías). Devuelve solo las filas de esas categorías.
export async function cargarVentanaGrupos(supabase, { tabla, pagina = 1, signal }) {
  const grupoDesde = (Math.max(1, pagina) - 1) * GRUPOS_POR_VENTANA
  const llamada =
    tabla === 'servicios'
      ? supabase.rpc('servicios_vitrina_publica', { por_categoria: POR_CATEGORIA, dias: DIAS_MAS_PEDIDOS, grupo_desde: grupoDesde, grupos_max: GRUPOS_POR_VENTANA })
      : supabase.rpc('productos_vitrina_publica', { por_categoria: POR_CATEGORIA, grupo_desde: grupoDesde, grupos_max: GRUPOS_POR_VENTANA })
  return agruparVitrina((await ejecutar(llamada, signal)).data).grupos
}

// Datos por id para piezas que necesitan unos pocos registros que quizá no estén en la página actual (barras flotantes del
// carrito / de la cita). Una sola consulta con `in`, acotada por el tamaño del carrito.
export async function leerPorIds(supabase, tabla, columnas, ids, { signal } = {}) {
  if (!ids.length) return []
  return (await ejecutar(supabase.from(tabla).select(columnas).in('id', ids), signal)).data
}
