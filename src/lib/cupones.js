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
  PROMOCION: 'Cupón de promoción',
}

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

// `claseTarjeta`/`claseTexto`/`claseIcono` apuntan al acabado metálico
// de index.css (.cupon-metal + .cupon-n-<nivel>), el mismo de las
// tarjetas de puntos. Los niveles se renombraron: lo que era Bronce es
// ahora Plata, Plata pasó a Oro y Oro a Diamante (los umbrales no cambian).
//
// El nivel visual NO se calcula por costo en monedas ni por valor del
// descuento (QA-064): es el nivel de negocio del premio —`nivel_minimo`,
// el mismo que decide quién puede canjearlo y que el cupón emitido
// congela—, así catálogo, permiso y cupón siempre coinciden.
// BASICO = Plata, PREMIUM = Oro, VIP = Diamante; los cupones de
// promociones por fechas (origen PROMOCION) son «Especial», fuera de la
// escala. Cada clienta puede canjear su nivel y los inferiores.
const NIVELES_CUPON = {
  // Acabado metálico igual al de las tarjetas de puntos (.cupon-metal en
  // index.css, colores en .cupon-n-*): Plata es el más básico, luego Oro
  // y Diamante el de mayor valor. `chispas` solo en los de arriba.
  Diamante: {
    nombre: 'Diamante',
    claseTarjeta: 'cupon-tarjeta cupon-metal cupon-iri cupon-n-diamante',
    claseTexto: 'cupon-metal-texto',
    claseIcono: 'cupon-metal-icono',
    claseBoton: 'cupon-metal-boton',
    chispas: 'diamante',
  },
  Oro: {
    nombre: 'Oro',
    claseTarjeta: 'cupon-tarjeta cupon-metal cupon-n-oro',
    claseTexto: 'cupon-metal-texto',
    claseIcono: 'cupon-metal-icono',
    claseBoton: 'cupon-metal-boton',
  },
  Plata: {
    nombre: 'Plata',
    claseTarjeta: 'cupon-tarjeta cupon-metal cupon-n-plata',
    claseTexto: 'cupon-metal-texto',
    claseIcono: 'cupon-metal-icono',
    claseBoton: 'cupon-metal-boton',
  },
  // Cupones de bienvenida, referido y fidelización: acabado verde (diamante verde de
  // public/diseñosPropios), fuera de la escala Plata/Oro/Diamante.
  Verde: {
    nombre: 'Verde',
    claseTarjeta: 'cupon-tarjeta cupon-metal cupon-iri cupon-n-verde',
    claseTexto: 'cupon-metal-texto',
    claseIcono: 'cupon-metal-icono',
    claseBoton: 'cupon-metal-boton',
    chispas: 'verde',
  },
  // Categoría ESPECIAL, fuera de la escala Plata/Oro/Diamante: la reciben
  // los cupones de ofertas (origen PROMOCION) sin importar su valor — ver
  // nivelDeCupon(). Acabado rubí (la tarjeta "Rubí élite" de la referencia).
  Especial: {
    nombre: 'Especial',
    claseTarjeta: 'cupon-tarjeta cupon-metal cupon-iri cupon-n-rubi',
    claseTexto: 'cupon-metal-texto',
    claseIcono: 'cupon-metal-icono',
    claseBoton: 'cupon-metal-boton',
    chispas: 'roja',
  },
}

// Nombre visual de cada nivel de negocio (el mismo `nivel_minimo` del
// catálogo, del cupón emitido y del permiso de canje).
const ORIGENES_VERDES = new Set(['REFERIDO_BIENVENIDA', 'REFERIDO_RECOMPENSA', 'FIDELIZACION'])

export const NOMBRE_VISUAL_NIVEL = { BASICO: 'Plata', PREMIUM: 'Oro', VIP: 'Diamante' }

// Estilo visual del nivel de negocio `nivelMinimo` (BASICO | PREMIUM | VIP)
// — lo usan las filas de «Canjear» (Recompensas) y las tarjetas de cupón.
// Un valor desconocido o ausente cae en el nivel base: coincide con el
// permiso (BASICO = sin restricción de nivel).
export function estiloNivelDeNegocio(nivelMinimo) {
  return NIVELES_CUPON[NOMBRE_VISUAL_NIVEL[nivelMinimo] ?? 'Plata']
}

// Nivel de un cupón concreto: los de oferta (PROMOCION) son siempre
// «Especial»; el resto sigue el nivel mínimo congelado en el cupón.
export function nivelDeCupon(cupon) {
  if (cupon.origen === 'PROMOCION') return NIVELES_CUPON.Especial
  if (ORIGENES_VERDES.has(cupon.origen)) return NIVELES_CUPON.Verde
  return estiloNivelDeNegocio(cupon.nivel_minimo)
}

// QA-078: disponibilidad EFECTIVA de un cupón, que incluye su vencimiento. El backend ya rechaza un cupón vencido; esto evita que la
// interfaz lo presente como utilizable. `estado` solo dice DISPONIBLE/CANJEADO/ANULADO: un cupón DISPONIBLE con `vigente_hasta`
// pasado (o con `vencido = true` de mis_cupones(), calculado con la hora del servidor) está VENCIDO. No es un estado persistido.
//   · `vigente_hasta === null`  → sin vencimiento legítimo (cupones antiguos, bienvenida, etc.): se puede usar.
//   · `vigente_hasta === undefined` y sin `vencido` → el campo NO se consultó: estado DESCONOCIDO, nunca utilizable.
//   · fecha ilegible → DESCONOCIDO.
// Devuelve { estado: 'DISPONIBLE' | 'VENCIDO' | 'CANJEADO' | 'ANULADO' | 'DESCONOCIDO', utilizable }.
export function estadoEfectivoCupon(cupon, ahora = Date.now()) {
  const estado = cupon?.estado
  if (estado === 'CANJEADO' || estado === 'ANULADO') return { estado, utilizable: false }
  if (estado !== 'DISPONIBLE') return { estado: 'DESCONOCIDO', utilizable: false }
  if (cupon.vencido === true) return { estado: 'VENCIDO', utilizable: false }
  if (cupon.vigente_hasta === null) return { estado: 'DISPONIBLE', utilizable: true }
  if (cupon.vigente_hasta === undefined) {
    // mis_cupones() informa `vencido` (false = vigente según el servidor); sin ninguno de los dos campos no se sabe.
    return cupon.vencido === false ? { estado: 'DISPONIBLE', utilizable: true } : { estado: 'DESCONOCIDO', utilizable: false }
  }
  const limite = new Date(cupon.vigente_hasta).getTime()
  if (Number.isNaN(limite)) return { estado: 'DESCONOCIDO', utilizable: false }
  return limite <= ahora ? { estado: 'VENCIDO', utilizable: false } : { estado: 'DISPONIBLE', utilizable: true }
}

// QA-078 — Caja: interpreta la lectura de UN cupón por código (`select valor, tipo_descuento, estado, vigente_hasta, clientes!cliente_id(nombre)`)
// y decide si se puede anunciar un descuento. Devuelve { preview, error }: o hay vista previa utilizable o hay un mensaje, nunca ambos.
// Una lectura fallida o sin el campo de vigencia jamás produce vista previa (no se anuncia descuento ni se habilita el cobro). El
// servidor (confirmar_venta) sigue siendo la autoridad: esto solo evita cobrar a ciegas.
export function interpretarCuponCaja({ data, error }, ahora = Date.now()) {
  if (error) return { preview: null, error: 'No se pudo verificar el cupón' }
  if (!data) return { preview: null, error: 'Código no encontrado' }
  if (data.estado !== 'DISPONIBLE') return { preview: null, error: 'Ese cupón ya fue usado' }
  const efectivo = estadoEfectivoCupon(data, ahora)
  if (!efectivo.utilizable) {
    return {
      preview: null,
      error: efectivo.estado === 'VENCIDO'
        ? `Este cupón venció el ${formatearFechaCupon(data.vigente_hasta)}`
        : 'No se pudo comprobar la vigencia del cupón',
    }
  }
  return {
    preview: { valor: parseFloat(data.valor), tipoDescuento: data.tipo_descuento, clienteNombre: data.clientes?.nombre },
    error: '',
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
