// Última lectura de los bloques que cargan al desplegar un producto (proveedores, historial de stock). CampoColapsable
// `diferido` desmonta el contenido al cerrar, así que reabrir lo volvía a pedir y el bloque aparecía vacío / «Cargando…» otra
// vez (se notaba en el celular). Con esto el bloque reaparece al instante con lo último que se leyó y se refresca en
// silencio por detrás. Solo vive en memoria de la sesión; no es fuente de verdad (siempre se vuelve a consultar).
const almacen = new Map()

export function leerCacheDesplegable(clave) {
  return almacen.get(clave)
}

export function guardarCacheDesplegable(clave, valor) {
  almacen.set(clave, valor)
}
