// Separación POS / Web de Servicios y Productos: qué columnas escribe cada interfaz. Las dos editan el MISMO registro y
// cada una guarda SOLO su lista, así que guardar en una no toca (ni pierde) lo de la otra. Las listas y los constructores
// viven aquí para poder probarlos sin la interfaz (tests/e2e/catalogo-pos-web.test.mjs).
import { leerImporte } from './moneda.js'

export const COLUMNAS_POS_SERVICIO = ['nombre', 'categoria', 'precio', 'duracion_min', 'activo']
export const COLUMNAS_WEB_SERVICIO = [
  'descripcion', 'en_tendencia', 'a_domicilio', 'costo_domicilio', 'precio_variable', 'nota_precio', 'duracion_resultado',
  'combo_con', 'foto_url', 'pasos', 'especificaciones', 'herramientas', 'materiales', 'cuidados_antes', 'cuidados_despues',
]
export const COLUMNAS_POS_PRODUCTO = ['codigo_barras', 'nombre', 'categoria', 'subcategoria', 'precio', 'costo', 'stock_actual', 'proveedor']
export const COLUMNAS_WEB_PRODUCTO = [
  'precio_antes', 'oferta_hasta', 'foto_url', 'descripcion', 'contenido', 'rinde', 'frecuencia', 'combo_con', 'destacado', 'nuevo',
  'en_inicio', 'especificaciones', 'modo_uso', 'ideal_para', 'tips', 'ingredientes', 'libre_de',
]

const texto = (v) => (v?.trim() ? v.trim() : null)

export function datosPosServicio({ formulario, categoriaFinal }) {
  return {
    nombre: formulario.nombre.trim(),
    categoria: categoriaFinal,
    precio: parseFloat(formulario.precio),
    duracion_min: formulario.duracionMin.trim() ? parseInt(formulario.duracionMin, 10) : null,
    activo: formulario.activo,
  }
}

export function datosWebServicio({ formulario, fotoFinal, pasos, especificaciones, herramientas, materiales, cuidadosAntes, cuidadosDespues }) {
  return {
    descripcion: texto(formulario.descripcion),
    en_tendencia: formulario.enTendencia,
    a_domicilio: formulario.aDomicilio,
    costo_domicilio: formulario.aDomicilio && formulario.costoDomicilio.trim() ? parseFloat(formulario.costoDomicilio) : null,
    precio_variable: formulario.precioVariable,
    nota_precio: formulario.precioVariable ? texto(formulario.notaPrecio) : null,
    duracion_resultado: texto(formulario.duracionResultado),
    combo_con: formulario.comboCon || null,
    foto_url: fotoFinal,
    pasos: pasos
      .filter((paso) => paso.nombre?.trim())
      .map((paso) => ({
        nombre: paso.nombre.trim(),
        minutos: paso.minutos ? parseInt(paso.minutos, 10) || null : null,
        texto: paso.texto?.trim() ?? '',
      })),
    especificaciones: especificaciones
      .filter((spec) => spec.clave?.trim())
      .map((spec) => ({ clave: spec.clave.trim(), valor: spec.valor?.trim() ?? '' })),
    herramientas: herramientas
      .filter((item) => item.nombre?.trim())
      .map((item) => ({ nombre: item.nombre.trim(), descripcion: item.descripcion?.trim() ?? '' })),
    materiales: materiales
      .filter((item) => item.nombre?.trim())
      .map((item) => ({ nombre: item.nombre.trim(), descripcion: item.descripcion?.trim() ?? '' })),
    cuidados_antes: cuidadosAntes.map((item) => item.texto?.trim()).filter(Boolean),
    cuidados_despues: cuidadosDespues.map((item) => item.texto?.trim()).filter(Boolean),
  }
}

export function datosPosProducto({ formulario, categoriaFinal, precio, costo }) {
  return {
    codigo_barras: formulario.codigoBarras.trim() || null,
    nombre: formulario.nombre.trim(),
    categoria: categoriaFinal || null,
    subcategoria: formulario.subcategoria.trim() || null,
    precio,
    costo,
    stock_actual: parseInt(formulario.stockInicial, 10),
    proveedor: formulario.proveedor.trim() || null,
  }
}

export function datosWebProducto({ formulario, fotoFinal, especificaciones, modoUso, idealPara, tips, ingredientes, libreDe }) {
  return {
    precio_antes: formulario.precioAntes.trim() ? leerImporte(formulario.precioAntes) : null,
    oferta_hasta: formulario.ofertaHasta || null,
    foto_url: fotoFinal,
    descripcion: formulario.descripcion.trim() || null,
    contenido: formulario.contenido.trim() || null,
    rinde: formulario.rinde.trim() || null,
    frecuencia: formulario.frecuencia.trim() || null,
    combo_con: formulario.comboCon || null,
    destacado: formulario.destacado,
    nuevo: formulario.nuevo,
    en_inicio: formulario.enInicio,
    especificaciones: especificaciones
      .filter((spec) => spec.clave?.trim())
      .map((spec) => ({ clave: spec.clave.trim(), valor: spec.valor?.trim() ?? '' })),
    modo_uso: modoUso
      .filter((paso) => paso.nombre?.trim())
      .map((paso) => ({ nombre: paso.nombre.trim(), texto: paso.texto?.trim() ?? '' })),
    ideal_para: idealPara.map((item) => item.texto?.trim()).filter(Boolean),
    tips: tips.map((item) => item.texto?.trim()).filter(Boolean),
    ingredientes: ingredientes
      .filter((item) => item.nombre?.trim())
      .map((item) => ({ nombre: item.nombre.trim(), texto: item.texto?.trim() ?? '' })),
    libre_de: libreDe.map((item) => item.texto?.trim()).filter(Boolean),
  }
}
