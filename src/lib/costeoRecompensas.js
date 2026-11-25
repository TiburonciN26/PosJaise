// Costeo detallado de servicios y productos (pestaña Web → Recompensas). Lógica PURA: sin React ni Supabase, para poder probarla sola.
//
// Reglas que replica de la base (migración 20261124000002_recompensas_costeo_detallado.sql):
//  · cada línea = cantidad × costo unitario; los totales se redondean hacia ARRIBA al centavo (conservador).
//  · SERVICIO: INSUMO + DESCARTABLE + HERRAMIENTA → «materiales» del piso del cupón; TARJETA_POS + OTRO → «otros» del piso;
//    LOCAL es informativo (no entra al piso, solo al margen real).
//  · La mano de obra NO se escribe: sale de la comisión REAL de la asistente (% de la tabla porcentajes sobre el precio de la
//    atención). Una promoción o cupón del salón NO reduce esa comisión.
//  · PRODUCTO (por unidad): TRANSPORTE → «transporte»; EMPAQUE + TARJETA_POS + OTRO → «otros». El costo de compra sale de Inventario.

export const MAX_LINEAS_SERVICIO = 60
export const MAX_LINEAS_PRODUCTO = 40

export const CATEGORIAS_SERVICIO = [
  { id: 'INSUMO', label: 'Insumo', piso: true, ayuda: 'Gel, esmalte, pigmento, cera… lo que se consume en este servicio.' },
  { id: 'DESCARTABLE', label: 'Descartable / higiene', piso: true, ayuda: 'Guantes, algodón, alcohol, limas, paños, bolsas.' },
  { id: 'HERRAMIENTA', label: 'Herramienta (desgaste)', piso: true, ayuda: 'Parte del costo de brocas, cabezales o equipos por cada uso.' },
  { id: 'TARJETA_POS', label: 'Comisión de tarjeta / POS', piso: true, ayuda: 'Lo que cobra el POS por un pago con tarjeta.' },
  { id: 'OTRO', label: 'Otro costo directo', piso: true, ayuda: 'Cualquier otro costo directo de este servicio.' },
  { id: 'LOCAL', label: 'Tiempo / uso del local', piso: false, ayuda: 'Informativo: no limita cupones, solo muestra el margen real.' },
]

export const CATEGORIAS_PRODUCTO = [
  { id: 'TRANSPORTE', label: 'Transporte de abastecimiento', ayuda: 'Lo que costó traer el producto (no es el envío a la clienta).' },
  { id: 'EMPAQUE', label: 'Empaque / bolsa de regalo', ayuda: 'Bolsa, caja, papel, cinta.' },
  { id: 'TARJETA_POS', label: 'Comisión de tarjeta / POS', ayuda: 'Lo que cobra el POS por un pago con tarjeta.' },
  { id: 'OTRO', label: 'Otro costo', ayuda: 'Cualquier otro costo por unidad.' },
]

const CATS_MATERIALES = ['INSUMO', 'DESCARTABLE', 'HERRAMIENTA']
const CATS_OTROS_SERVICIO = ['TARJETA_POS', 'OTRO']

// Los MATERIALES (insumo, descartable, herramienta) solo se eligen del almacén: no se escriben sueltos. Lo que no es un material
// (comisión de tarjeta/POS, otro costo directo, tiempo del local) no vive en el almacén y se escribe a mano.
export const esCategoriaMaterial = (categoria) => CATS_MATERIALES.includes(categoria)
export const CATEGORIAS_MATERIAL = CATEGORIAS_SERVICIO.filter((c) => esCategoriaMaterial(c.id))
export const CATEGORIAS_OTRO_COSTO = CATEGORIAS_SERVICIO.filter((c) => !esCategoriaMaterial(c.id))

const sinTildes = (t) => (t ?? '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()

// Artículos del almacén que coinciden con lo escrito (sin mayúsculas ni tildes; cada palabra debe aparecer, en cualquier orden).
export function filtrarArticulosAlmacen(articulos, texto) {
  const palabras = sinTildes(texto).split(/\s+/).filter(Boolean)
  if (palabras.length === 0) return articulos
  return articulos.filter((a) => {
    const nombre = sinTildes(a.nombre)
    return palabras.every((p) => nombre.includes(p))
  })
}

const num = (x) => {
  if (x === '' || x === null || x === undefined) return 0
  const n = Number(x)
  return Number.isFinite(n) ? n : 0
}

// ceil(x × 100) / 100 sin que el ruido binario (0,1 + 0,2) empuje un centavo de más.
export const redondearArriba = (x) => Math.ceil(Math.round(Number(x) * 100 * 1e6) / 1e6) / 100
// Redondeo comercial a centavos (la comisión de la asistente: round(precio × % / 100, 2)).
export const aCentavos = (x) => Math.round(Number(x) * 100 + 1e-9) / 100

// Cada línea guarda lo que se COMPRÓ (costoCompra) y para cuántos usos RINDE (rinde, 1 si se consume entero en un servicio). El costo
// por uso es costoCompra ÷ rinde y NO se escribe: lo calcula el sistema (la base hace la misma cuenta, redondeada a 4 decimales).
export const lineaServicioVacia = (categoria = 'INSUMO') => ({
  id: null, categoria, descripcion: '', almacenArticuloId: '', cantidad: '1', unidad: '', costoCompra: '', rinde: '1',
})
export const lineaProductoVacia = (categoria = 'TRANSPORTE') => ({ id: null, categoria, descripcion: '', monto: '' })

// Costo de UN uso: lo que se compró ÷ para cuántos usos rinde (vacío = 1). null si «rinde» no es válido.
export function costoPorUsoLinea(l) {
  const rinde = l.rinde === '' || l.rinde === undefined ? 1 : num(l.rinde)
  if (!(rinde > 0)) return null
  return Math.round((num(l.costoCompra) / rinde) * 10000) / 10000
}

// A 6 decimales como la columna `subtotal` de la base (sin ruido binario: 3 × 0,1 = 0,3).
export const subtotalLineaServicio = (l) => Math.round(num(l.cantidad) * (costoPorUsoLinea(l) ?? 0) * 1e6) / 1e6

export function totalesServicio(lineas) {
  const suma = (cats) =>
    lineas.filter((l) => cats.includes(l.categoria)).reduce((a, l) => a + subtotalLineaServicio(l), 0)
  return {
    materiales: redondearArriba(suma(CATS_MATERIALES)),
    otros: redondearArriba(suma(CATS_OTROS_SERVICIO)),
    local: redondearArriba(suma(['LOCAL'])),
  }
}

export function totalesProducto(lineas) {
  const transporte = lineas.filter((l) => l.categoria === 'TRANSPORTE').reduce((a, l) => a + num(l.monto), 0)
  const otros = lineas.filter((l) => l.categoria !== 'TRANSPORTE').reduce((a, l) => a + num(l.monto), 0)
  return { transporte: redondearArriba(transporte), otros: redondearArriba(otros) }
}

// Texto del primer problema (o null). Mismas reglas que valida la base (que además las exige).
export function validarLineasServicio(lineas) {
  if (lineas.length > MAX_LINEAS_SERVICIO) return `Máximo ${MAX_LINEAS_SERVICIO} líneas por servicio.`
  for (let i = 0; i < lineas.length; i += 1) {
    const l = lineas[i]
    const n = i + 1
    if (esCategoriaMaterial(l.categoria) && !l.almacenArticuloId) return `Línea ${n}: elige el material del almacén (los materiales no se escriben sueltos).`
    if (!l.descripcion.trim()) return `Línea ${n}: escribe qué es.`
    if (l.descripcion.trim().length > 120) return `Línea ${n}: la descripción es demasiado larga (máximo 120).`
    if (!(num(l.cantidad) > 0)) return `Línea ${n}: la cantidad debe ser mayor a 0.`
    if (l.costoCompra === '' || !(Number(l.costoCompra) >= 0)) return `Línea ${n}: indica lo que costó lo que compraste (puede ser 0).`
    if (l.rinde !== '' && !(Number(l.rinde) > 0)) return `Línea ${n}: «rinde para cuántos usos» debe ser mayor a 0.`
  }
  return null
}

export function validarLineasProducto(lineas) {
  if (lineas.length > MAX_LINEAS_PRODUCTO) return `Máximo ${MAX_LINEAS_PRODUCTO} líneas por producto.`
  for (let i = 0; i < lineas.length; i += 1) {
    const l = lineas[i]
    const n = i + 1
    if (!l.descripcion.trim()) return `Línea ${n}: escribe qué es.`
    if (l.descripcion.trim().length > 120) return `Línea ${n}: la descripción es demasiado larga (máximo 120).`
    if (l.monto === '' || !(Number(l.monto) >= 0)) return `Línea ${n}: indica el monto por unidad (puede ser 0).`
  }
  return null
}

// Forma que espera guardar_costeo_servicio / guardar_costeo_producto.
export const lineasServicioAJson = (lineas) =>
  lineas.map((l) => ({
    categoria: l.categoria,
    descripcion: l.descripcion.trim(),
    almacen_articulo_id: l.almacenArticuloId || null,
    cantidad: num(l.cantidad),
    unidad: l.unidad.trim() || null,
    costo_compra: num(l.costoCompra),
    rinde: l.rinde === '' ? null : num(l.rinde),
  }))
export const lineasProductoAJson = (lineas) =>
  lineas.map((l) => ({ categoria: l.categoria, descripcion: l.descripcion.trim(), monto: num(l.monto) }))

// Valores iniciales de un borrador a partir de lo guardado (`prot` trae las líneas de la base o es null si no está configurado).
export const valoresDeCosteoServicio = (prot) => ({ lineas: lineasServicioDesdeFilas(prot?.lineas ?? []) })
export const valoresDeCosteoProducto = (prot) => ({
  lineas: lineasProductoDesdeFilas(prot?.lineas ?? []),
  confirmado: Boolean(prot?.costo_confirmado),
})

// Filas de la base → líneas editables (textos, para los <input>).
export const lineasServicioDesdeFilas = (filas = []) =>
  [...filas]
    .sort((a, b) => a.orden - b.orden)
    .map((f) => ({
      id: f.id, categoria: f.categoria, descripcion: f.descripcion, almacenArticuloId: f.almacen_articulo_id ?? '',
      cantidad: String(Number(f.cantidad)), unidad: f.unidad ?? '',
      // Líneas guardadas antes de «usos» no tienen costo_compra: su costo_unitario es lo que se compró y rinde para 1 uso.
      costoCompra: String(Number(f.costo_compra ?? f.costo_unitario)),
      rinde: f.costo_compra === null || f.costo_compra === undefined ? '1' : String(Number(f.rinde)),
    }))
export const lineasProductoDesdeFilas = (filas = []) =>
  [...filas]
    .sort((a, b) => a.orden - b.orden)
    .map((f) => ({ id: f.id, categoria: f.categoria, descripcion: f.descripcion, monto: String(Number(f.monto)) }))

// Comisión real de una asistente sobre el PRECIO REAL del servicio (no cambia con descuentos del salón).
export const comisionAsistente = (precio, porcentaje) => aCentavos((Number(precio) * Number(porcentaje)) / 100)

// Costo directo = materiales + otros + comisión de la asistente. Piso del cupón = ese costo directo.
export function resultadoPorAsistente({ precio, materiales, otros, local = 0, porcentaje }) {
  const comision = comisionAsistente(precio, porcentaje)
  const costoDirecto = Number(materiales) + Number(otros) + comision
  const margen = aCentavos(Number(precio) - costoDirecto)
  return {
    comision,
    costoDirecto: aCentavos(costoDirecto),
    margen,
    margenPct: Number(precio) > 0 ? Math.round((margen / Number(precio)) * 1000) / 10 : 0,
    margenConLocal: aCentavos(margen - Number(local)),
    // Un cupón puede descontar hasta lo que sobra por encima del costo directo (si fuera el único artículo).
    cuponMaximo: aCentavos(Math.max(Number(precio) - costoDirecto, 0)),
  }
}

// Tope de cupón PAREJO de un servicio (migración 20261124000005): lo mismo para toda clienta, atienda quien atienda. El piso usa el
// % más alto entre las asistentes activas (como la base: precio × % / 100 hacia arriba al centavo).
export function cuponMaximoParejo({ precio, materiales, otros, porcentajeMax }) {
  const comision = redondearArriba((Number(precio) * Number(porcentajeMax)) / 100)
  const piso = Number(materiales) + Number(otros) + comision
  return { comision, piso: aCentavos(piso), cuponMaximo: aCentavos(Math.max(Number(precio) - piso, 0)) }
}

// Por qué un servicio no admite cupón (o pierde dinero). null si hay margen.
export function motivoSinMargen({ precio, costoDirecto, margen }) {
  if (!(Number(margen) <= 0)) return null
  const igual = Number(margen) === 0
  return (
    `Con esta receta el costo directo (S/ ${Number(costoDirecto).toFixed(2)}) ${igual ? 'iguala' : 'supera'} el precio (S/ ${Number(precio).toFixed(2)}), ` +
    'así que no queda margen y no admite cupones. Si un insumo es un envase que rinde varios servicios, escribe cuántos usos rinde (así se cobra solo lo que se gasta en un servicio).'
  )
}

export function resultadoProducto({ precio, costoCompra, transporte, otros, cantidad = 1 }) {
  const unitaria = Number(costoCompra) + Number(transporte) + Number(otros)
  const margenUnidad = aCentavos(Number(precio) - unitaria)
  return {
    unitaria: aCentavos(unitaria),
    margenUnidad,
    margenPct: Number(precio) > 0 ? Math.round((margenUnidad / Number(precio)) * 1000) / 10 : 0,
    cuponMaximo: aCentavos(Math.max(Number(precio) * cantidad - unitaria * cantidad, 0)),
  }
}

// Costo por unidad de consumo a partir de una compra: lo que costó el envase entre las veces que rinde.
export const costoPorUso = (costoCompra, rendimiento) =>
  num(rendimiento) > 0 ? Math.round((num(costoCompra) / num(rendimiento)) * 10000) / 10000 : null
