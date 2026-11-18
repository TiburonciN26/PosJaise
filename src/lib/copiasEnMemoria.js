// Copias en memoria de las lecturas del portal de clientas: vitrinas de Productos / Servicios (useCatalogoPublico), páginas de
// detalle (DetalleServicioCliente / DetalleProductoCliente) y secciones públicas de Inicio (useLectura con `copia`).
//
// Por qué: las rutas del portal NO quedan montadas (ver CLAUDE.md, «Two completely separate app trees»): ir de /servicios al
// detalle y volver desmonta y vuelve a montar la página, y sin esto cada regreso repetía todas sus lecturas y mostraba
// «Cargando...» otra vez. Con la copia, la página pinta al instante lo último que vio y vuelve a pedir los datos en segundo
// plano: si algo cambió, se actualiza sola.
//
// Límites deliberados:
//   · solo memoria (se pierde al recargar la página): nada de precios o stock viejos entre sesiones;
//   · vida corta (VIDA_MS): pasado ese tiempo la copia no se usa y la página carga como siempre;
//   · la copia nunca sustituye a la lectura: SIEMPRE se revalida al montar. Agregar al carrito, reservar y pagar siguen
//     validando contra el servidor, así que un stock que cambió en esos segundos no se puede «comprar de la copia»;
//   · la clave incluye la cuenta cuando el dato es personal (favorito, mi reseña): nunca se muestra la copia de otra cuenta;
//   · quien modifica algo que está dentro de una copia (guardar una reseña, marcar favorito) la descarta con olvidarCopia().
//   · cerrar sesión recarga la página (useSalir): ahí se pierden todas, nada personal queda en un equipo compartido.
export const VIDA_MS = 5 * 60 * 1000

// Clave de la copia de «Mis citas» (CitasCliente). Vive aquí porque también la necesita quien crea una cita desde otra
// pantalla (CarritoServiciosCliente) para descartarla: al llegar a Citas se lee del servidor, sin pintar la lista vieja.
export const claveCitas = (cuentaId) => `citas\u0000${cuentaId}`
const MAX_ENTRADAS = 40 // vitrinas + los detalles visitados en la sesión; la menos usada sale primero

const almacen = new Map() // clave → { datos, en }

/** Devuelve la copia vigente o null. `undefined`/null como clave = sin copia (el llamador no la activó). */
export function leerCopia(clave, ahora = Date.now()) {
  if (!clave) return null
  const entrada = almacen.get(clave)
  if (!entrada) return null
  if (ahora - entrada.en > VIDA_MS) {
    almacen.delete(clave)
    return null
  }
  return entrada.datos
}

export function guardarCopia(clave, datos, ahora = Date.now()) {
  if (!clave || datos == null) return
  almacen.delete(clave) // se reinserta al final: el Map conserva el orden de uso
  almacen.set(clave, { datos, en: ahora })
  while (almacen.size > MAX_ENTRADAS) almacen.delete(almacen.keys().next().value)
}

export function olvidarCopia(clave) {
  if (clave) almacen.delete(clave)
}

export function vaciarCopias() {
  almacen.clear()
}

/** ¿Lo recién leído es idéntico a lo que ya se muestra? (para no volver a renderizar la página por nada) */
export function mismaCopia(a, b) {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}
