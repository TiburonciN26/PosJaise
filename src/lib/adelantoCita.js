// Adelanto de una cita que se resta al cobrar su atención en Ventas. Módulo PURO (sin React ni Supabase) para probarlo con
// node --test (tests/e2e/adelanto-cita.test.mjs). OJO: el adelanto NO es un descuento (migración 20261121000007): va en su propia
// línea del ticket y no pasa por el campo de descuento. El servidor (confirmar_venta) vuelve a validar todo y es el que manda;
// esto es lo que ve la cajera antes de cobrar.
//
// `adelantos` llega de la RPC adelantos_pendientes_de_atenciones(): [{ cita_id, pendiente, registro_ids }], una fila por cita
// con adelanto aún sin aplicar y que tiene atenciones en el carrito.
import { redondear2 } from './moneda.js'

// Nueva/Editar cita (ModalCita): suma de los precios escritos en el carrito de servicios. Un precio vacío o inválido cuenta 0
// (el guardado ya rechaza precios inválidos por su cuenta).
export function totalServiciosCita(lineas) {
  return redondear2((lineas ?? []).reduce((suma, linea) => suma + (parseFloat(linea.precio) || 0), 0))
}

// El adelanto escrito (texto) es mayor que el total de los servicios. Un adelanto vacío o no numérico NO cuenta como excedido
// (de eso se ocupa la validación de formato); sin servicios el total es 0, así que cualquier adelanto positivo excede.
export function adelantoSuperaTotal(adelantoTexto, totalServicios) {
  const adelanto = parseFloat(adelantoTexto)
  return Number.isFinite(adelanto) && adelanto > 0 && redondear2(adelanto) > redondear2(totalServicios)
}

// Modal «Atención a cobrar»: las atenciones de la lista que vienen de la MISMA cita con adelanto pendiente (2 o más) se
// presentan como un BLOQUE: se ven juntas y al elegir una bajan todas al carrito. Así el adelanto (que es de la cita completa,
// no de un servicio) se descuenta una sola vez, en el mismo cobro. `adelantos` es la respuesta de la RPC
// adelantos_pendientes_de_atenciones (solo trae adelantos aún sin aplicar). Devuelve [{ atenciones, adelanto }] en el orden de
// aparición; `adelanto` es el monto a mostrar (nunca más que el precio de esas atenciones) o null si no hay adelanto.
export function agruparAtencionesPorCita(atenciones, adelantos) {
  const filas = (adelantos ?? []).filter((fila) => Number(fila.pendiente) > 0)
  const montoPara = (miembros, fila) => {
    const precio = miembros.reduce((suma, atencion) => suma + (Number(atencion.precio) || 0), 0)
    const monto = redondear2(Math.min(Number(fila.pendiente) || 0, precio))
    return monto > 0 ? monto : null
  }
  const salida = []
  const colocadas = new Set()
  for (const atencion of atenciones) {
    if (colocadas.has(atencion.id)) continue
    const fila = filas.find((candidata) => (candidata.registro_ids ?? []).includes(atencion.id))
    if (!fila) {
      salida.push({ atenciones: [atencion], adelanto: null })
      continue
    }
    const miembros = atenciones.filter((otra) => fila.registro_ids.includes(otra.id))
    miembros.forEach((miembro) => colocadas.add(miembro.id))
    salida.push({ atenciones: miembros, adelanto: montoPara(miembros, fila) })
  }
  return salida
}

// Cuánto adelanto restar del ticket: por cada cita, lo pendiente pero nunca más que el precio de SUS atenciones que están
// en este carrito (no se descuenta de un servicio que no se está cobrando todavía).
export function calcularAdelantoSugerido(carrito, adelantos) {
  let total = 0
  for (const adelanto of adelantos ?? []) {
    const ids = new Set(adelanto.registro_ids ?? [])
    const precioEnCarrito = carrito
      .filter((item) => item.tipo === 'SERVICIO' && ids.has(item.registroServicioId))
      .reduce((suma, item) => suma + item.precioUnitario * item.cantidad, 0)
    total += Math.min(Number(adelanto.pendiente) || 0, precioEnCarrito)
  }
  return redondear2(total)
}
