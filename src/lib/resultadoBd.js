// Interpretación de resultados de Supabase cuando hay que decidir si es SEGURO borrar un
// archivo (Fase 3, F3-07).
//
// Un error de TRANSPORTE («Failed to fetch», cortes, 502/503/504, timeouts) NO prueba que la
// escritura se haya revertido: la transacción pudo confirmarse y haberse perdido solo la
// respuesta. Borrar entonces la imagen dejaría una fila apuntando a un archivo inexistente.
// Por eso se distingue:
//   - rechazo CONFIRMADO: el servidor respondió con un 4xx (o un 500 con código de PostgreSQL),
//     o sea la sentencia falló y se revirtió → es seguro limpiar lo que esa operación subió;
//   - resultado INCIERTO: cualquier otro error → se CONSERVA el archivo, se reconcilia leyendo
//     la fila y, si sigue sin poder afirmarse, la operación queda pendiente y se reintenta con
//     la misma identidad (mismo id de fila y misma referencia), sin duplicar.
import { supabase } from './supabase.js'

// `resultado` es lo que devuelve supabase-js: { data, error, status }.
export function esRechazoConfirmado(resultado) {
  if (!resultado?.error) return false
  const estado = resultado.status
  return (estado >= 400 && estado < 500) || (estado === 500 && Boolean(resultado.error.code))
}

export function esResultadoIncierto(resultado) {
  return Boolean(resultado?.error) && !esRechazoConfirmado(resultado)
}

// Estado de una fila tras una operación incierta. CUATRO resultados, nunca un booleano:
//   'coincide'    → existe y tiene exactamente los valores pedidos;
//   'difiere'     → existe, pero algún campo es distinto (`fila` trae los valores reales);
//   'ausente'     → se LEYÓ con éxito y no existe;
//   'desconocido' → no se pudo leer.
// Solo 'ausente' prueba que la operación no quedó guardada. 'difiere' prueba lo contrario
// (la fila EXISTE y puede estar usando archivos): un desacuerdo en un campo no autoriza a borrar
// ningún archivo que esa fila referencie, y no se decide por «coincidencia total del par»
// sino POR REFERENCIA. Un 4xx (incluido 23505) de un reintento tampoco prueba nada sobre un
// intento anterior de resultado incierto.
export async function estadoFila(tabla, id, campos = {}) {
  const lectura = await supabase.from(tabla).select(['id', ...Object.keys(campos)].join(',')).eq('id', id)
  if (lectura.error) return { estado: 'desconocido', fila: null }
  const fila = (lectura.data ?? [])[0]
  if (!fila) return { estado: 'ausente', fila: null }
  const coincide = Object.entries(campos).every(([clave, valor]) => fila[clave] === valor)
  return { estado: coincide ? 'coincide' : 'difiere', fila }
}
