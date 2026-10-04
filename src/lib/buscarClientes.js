// Búsqueda de clientes en el SERVIDOR (QA-043). Antes los modales descargaban toda la tabla
// `clientes` sin paginar y filtraban en el navegador: el servidor corta cada respuesta en
// `max_rows` (1000), así que las clientas posteriores a esa posición eran invisibles y el modal
// ofrecía crearlas de nuevo. Aquí se pide solo lo que coincide, con un límite pequeño.
//
// Recibe el cliente de Supabase por parámetro para poder probarse fuera del navegador.
export const LIMITE_SUGERENCIAS = 20

// `%`, `_` y `\` son comodines/escape de LIKE: se escapan para que el texto del usuario sea literal.
export function patronIlike(termino) {
  return `%${termino.trim().replace(/[\\%_]/g, '\\$&')}%`
}

// Valor entre comillas dentro de un filtro `or=(...)` de PostgREST: las comas, paréntesis y puntos del
// texto no deben interpretarse como sintaxis. Dentro de comillas solo `\` y `"` necesitan escape.
export function valorCitado(valor) {
  return `"${valor.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

// `conTelefono`: Caja busca por nombre O teléfono (columna extra `telefono` en el resultado).
export async function buscarClientes(
  supabase,
  termino,
  { limite = LIMITE_SUGERENCIAS, conTelefono = false } = {},
) {
  let consulta = supabase
    .from('clientes')
    .select(conTelefono ? 'id, nombre, telefono' : 'id, nombre')
    .order('nombre')
    .order('id')
    .limit(limite)
  if (termino.trim()) {
    const patron = patronIlike(termino)
    consulta = conTelefono
      ? consulta.or(`nombre.ilike.${valorCitado(patron)},telefono.ilike.${valorCitado(patron)}`)
      : consulta.ilike('nombre', patron)
  }
  const { data, error } = await consulta
  if (error) throw error
  return data ?? []
}
