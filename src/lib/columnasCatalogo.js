// Columnas de las fichas de catálogo que leen las pantallas POS (Inventario, Servicios) y el panel Web
// (Web → Catálogo). Un solo lugar para que ambas interfaces editen exactamente los mismos registros.
export const SELECT_PRODUCTOS =
  'id, codigo_barras, nombre, categoria, subcategoria, precio, precio_antes, oferta_hasta, costo, stock_actual, stock_minimo, ' +
  'proveedor, foto_url, activo, descripcion, contenido, rinde, frecuencia, combo_con, destacado, nuevo, en_inicio, ' +
  'especificaciones, modo_uso, ideal_para, tips, ingredientes, libre_de'

export const SELECT_SERVICIOS =
  'id, nombre, categoria, precio, duracion_min, activo, foto_url, descripcion, en_tendencia, a_domicilio, costo_domicilio, precio_variable, nota_precio, duracion_resultado, pasos, especificaciones, herramientas, materiales, cuidados_antes, cuidados_despues, combo_con'
