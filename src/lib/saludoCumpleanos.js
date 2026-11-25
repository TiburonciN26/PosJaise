// Mensaje de WhatsApp para una clienta que cumple años (botón de la tarjeta de cumpleaños de Citas). Módulo puro, con test en
// tests/e2e/saludo-cumpleanos.test.mjs. DECISIÓN DEL NEGOCIO (2026-11-24): es SOLO un saludo. No ofrece descuento, cupón, promoción ni
// nada que venda: el cumpleaños se saluda sin tratar de venderle. Si alguna vez se quiere ofrecer algo, es una decisión aparte.

// Primer nombre (lo que va después de «Feliz cumpleaños,»). Sin nombre usable devuelve ''.
export function primerNombre(nombreCompleto) {
  return String(nombreCompleto ?? '').trim().split(/\s+/)[0] ?? ''
}

export function mensajeCumpleanos(nombreCompleto) {
  const nombre = primerNombre(nombreCompleto)
  const saludo = nombre ? `¡Feliz cumpleaños, ${nombre}! 🎉` : '¡Feliz cumpleaños! 🎉'
  return `${saludo} De parte de todo el equipo de Jaise Beauty Academy te deseamos un día muy especial. ¡Un abrazo grande!`
}
