// Lectura COMPLETA de una consulta que el servidor corta en `max_rows` (1000): se pide por bloques con
// `.range()` hasta que un bloque llega incompleto. Úsese solo donde la pantalla necesita de verdad todo el
// conjunto (listas de configuración, categorías); para buscadores y selectores se busca en el servidor.
// `construir()` debe devolver una consulta NUEVA con orden DETERMINISTA (la columna de orden + `id`), o los
// bloques podrían repetir o saltarse filas. Lanza el error de la primera petición que falle: un fallo
// parcial nunca se presenta como catálogo completo.
export const TAMANO_BLOQUE = 1000

export async function leerPaginado(construir, { tamano = TAMANO_BLOQUE, maxBloques = 100 } = {}) {
  const filas = []
  for (let bloque = 0; bloque < maxBloques; bloque += 1) {
    const { data, error } = await construir().range(bloque * tamano, bloque * tamano + tamano - 1)
    if (error) throw error
    filas.push(...(data ?? []))
    if ((data ?? []).length < tamano) return filas
  }
  throw new Error('El catálogo es demasiado grande para leerlo completo.')
}
