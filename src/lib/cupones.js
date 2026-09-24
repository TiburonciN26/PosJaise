// Compartido entre ReferidosCliente.jsx y OfertasCliente.jsx: un cupón es
// un cupón sin importar de dónde salió (hoy solo Referidos genera, pero
// `origen` ya está pensado para sumar más formas de obtención sin tocar
// la pantalla que los lista — ver implementacionesWed.md §7.32). Ambas
// pantallas leen la MISMA tabla `cupones` (vía mis_cupones()), así que
// el estado (disponible/canjeado/anulado) siempre es el mismo en las dos
// — no hay nada que sincronizar a mano.
export const ETIQUETAS_ORIGEN_CUPON = {
  REFERIDO_BIENVENIDA: 'Cupón de bienvenida',
  REFERIDO_RECOMPENSA: 'Cupón por referir',
}

// "Peso"/color del cupón según su valor — mismo espíritu que los niveles
// de la tarjeta de puntos (§7.15): a más valor, un tratamiento más
// "premium". Se calcula del valor real, no del origen, así que sigue
// funcionando si el negocio cambia los montos desde un panel admin.
const formatoFechaCupon = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'America/Lima',
})

export function formatearFechaCupon(fechaIso) {
  if (!fechaIso) return null
  return formatoFechaCupon.format(new Date(fechaIso))
}

// `claseTarjeta`/`claseTexto`/`claseIcono` reemplazan las clases sueltas
// que había antes (borde/fondo con Tailwind) — Plata y Oro ahora llevan
// gradiente + brillo animado que Tailwind solo no puede armar, así que
// esas dos viven en index.css (.cupon-plata/.cupon-oro/.cupon-texto-oro,
// ver §7.35 en implementacionesWed.md) — Bronce se queda con Tailwind
// puro (color plano, sin efectos) porque no lo necesita.
export function nivelCupon(valor) {
  if (valor >= 20) {
    return {
      nombre: 'Oro',
      claseTarjeta: 'cupon-tarjeta cupon-oro',
      claseTexto: 'cupon-texto-oro',
      claseIcono: 'text-[var(--lw-gold)]',
    }
  }
  if (valor >= 10) {
    return {
      nombre: 'Plata',
      claseTarjeta: 'cupon-tarjeta cupon-plata',
      claseTexto: 'text-[#e3e6ea]',
      claseIcono: 'text-[#cfd4da]',
    }
  }
  return {
    nombre: 'Bronce',
    claseTarjeta: 'cupon-tarjeta border border-[#c8935a]/50 bg-[#c8935a]/10',
    claseTexto: 'text-[#c8935a]',
    claseIcono: 'text-[#c8935a]',
  }
}
