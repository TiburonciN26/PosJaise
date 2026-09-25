import { formatearSoles } from './moneda.js'

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
  FIDELIZACION: 'Cupón de fidelización',
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
//
// `tipoDescuento` (§7.58, cupones de Fidelización): un cupón de 20% y
// uno de S/20 no son comparables en la misma escala — 20% de una
// cuenta cara puede valer mucho más que S/20 fijos, y viceversa. Por
// pedido del usuario, un cupón PORCENTAJE usa su propia escala de
// umbrales (en puntos de %), no la de soles — mismos 3 escalones
// (Bronce/Plata/Oro), mismo espíritu, números distintos.
const UMBRALES_SOLES = { oro: 20, plata: 10 }
const UMBRALES_PORCENTAJE = { oro: 20, plata: 10 }

export function nivelCupon(valor, tipoDescuento = 'MONTO_FIJO') {
  const umbrales = tipoDescuento === 'PORCENTAJE' ? UMBRALES_PORCENTAJE : UMBRALES_SOLES

  if (valor >= umbrales.oro) {
    return {
      nombre: 'Oro',
      claseTarjeta: 'cupon-tarjeta cupon-oro',
      claseTexto: 'cupon-texto-oro',
      claseIcono: 'text-[var(--lw-gold)]',
    }
  }
  if (valor >= umbrales.plata) {
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

// Cómo se lee el valor de un cupón — nunca "formatearSoles" a secas,
// porque desde Fidelización valor=20 significa "20%", no "S/20"
// (mismo criterio que ya usaba OfertasCliente.jsx para promociones,
// ahora compartido acá para que TarjetaCupon lo use igual sin
// duplicar la función en dos archivos).
export function formatearValorCupon(cupon) {
  return cupon.tipo_descuento === 'PORCENTAJE'
    ? `${cupon.valor}% dcto.`
    : formatearSoles(cupon.valor)
}
