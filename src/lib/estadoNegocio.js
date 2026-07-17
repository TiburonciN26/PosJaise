// Mismo texto literal que usan las funciones/triggers de Supabase
// (confirmar_venta, agregar_stock, calcular_comision_registro_servicio en
// 45_negocio_cerrado_bloquea_escrituras.sql) — si cambia acá, cambiar
// también allá, así el cliente puede detectar el rechazo por mensaje
// exacto en vez de un código de error genérico.
export const MENSAJE_NEGOCIO_CERRADO =
  'El negocio se encuentra cerrado. Espere a que el administrador inicie la jornada.'
