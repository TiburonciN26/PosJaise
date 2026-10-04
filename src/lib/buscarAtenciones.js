// Atenciones pendientes de cobro (Caja → «+ Agregar servicio» → «Atención a cobrar») — QA-044.
//
// Antes `Ventas.jsx` descargaba TODAS las atenciones pendientes sin paginar y el modal las filtraba en el
// navegador: el servidor corta cada respuesta en `max_rows` (1000), así que las posteriores a esa posición
// eran invisibles ni siquiera con el buscador. Aquí la búsqueda y el conteo se hacen en el SERVIDOR, con
// orden determinista (fecha, id) y un límite pequeño. No cambia qué es «pendiente» (estado ACTIVO y sin
// venta) ni la identificación por ID; el doble cobro lo sigue impidiendo `confirmar_venta`.
//
// Recibe el cliente de Supabase por parámetro para poder probarse fuera del navegador.
import { patronIlike } from './buscarClientes.js'

export const LIMITE_ATENCIONES = 30

const CAMPOS = 'id, servicio_id, cliente_id, precio, fecha'

function pendientes(supabase, select, excluirIds) {
  let consulta = supabase.from('registro_servicios').select(select).eq('estado', 'ACTIVO').is('venta_id', null)
  if (excluirIds.length > 0) consulta = consulta.not('id', 'in', `(${excluirIds.join(',')})`)
  return consulta
}

const porFechaEId = (a, b) => {
  const d = new Date(a.fecha) - new Date(b.fecha)
  return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// Devuelve { filas, truncado }. `truncado` = hay más coincidencias que el límite (la interfaz lo avisa
// para que nunca parezca que la lista está completa cuando no lo está).
export async function buscarAtenciones(supabase, termino, { excluirIds = [], limite = LIMITE_ATENCIONES } = {}) {
  const texto = termino.trim()

  if (!texto) {
    const { data, error } = await pendientes(supabase, `${CAMPOS}, servicios(nombre), clientes(nombre)`, excluirIds)
      .order('fecha')
      .order('id')
      .limit(limite + 1)
    if (error) throw error
    return { filas: (data ?? []).slice(0, limite), truncado: (data ?? []).length > limite }
  }

  // Coincide por nombre del servicio O de la clienta: dos consultas acotadas y se unen. Como cada una trae
  // sus primeras `limite + 1` por (fecha, id), las primeras `limite` de la unión están contenidas en ellas.
  const patron = patronIlike(texto)
  const [porServicio, porCliente] = await Promise.all([
    pendientes(supabase, `${CAMPOS}, servicios!inner(nombre), clientes(nombre)`, excluirIds)
      .ilike('servicios.nombre', patron)
      .order('fecha')
      .order('id')
      .limit(limite + 1),
    pendientes(supabase, `${CAMPOS}, servicios(nombre), clientes!inner(nombre)`, excluirIds)
      .ilike('clientes.nombre', patron)
      .order('fecha')
      .order('id')
      .limit(limite + 1),
  ])
  if (porServicio.error) throw porServicio.error
  if (porCliente.error) throw porCliente.error

  const unicas = new Map()
  for (const fila of [...(porServicio.data ?? []), ...(porCliente.data ?? [])]) unicas.set(fila.id, fila)
  const todas = [...unicas.values()].sort(porFechaEId)
  return { filas: todas.slice(0, limite), truncado: todas.length > limite }
}

// Cuántas pendientes hay fuera del carrito (para el avisito del botón). Solo un conteo: no descarga filas.
export async function contarAtenciones(supabase, { excluirIds = [] } = {}) {
  let consulta = supabase
    .from('registro_servicios')
    .select('id', { count: 'exact', head: true })
    .eq('estado', 'ACTIVO')
    .is('venta_id', null)
  if (excluirIds.length > 0) consulta = consulta.not('id', 'in', `(${excluirIds.join(',')})`)
  const { count, error } = await consulta
  if (error) throw error
  return count ?? 0
}
