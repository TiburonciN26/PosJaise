// Fuente única de las condiciones legales de la web de clientas (Términos y
// condiciones, Política de cambios y devoluciones, Privacidad). Culqi exige
// tenerlas visibles para afiliar la pasarela (ver guias/terminosYCondiciones.md).
//
// IMPORTANTE: los números de abajo son las reglas COMERCIALES del negocio y
// aparecen tal cual en las tres páginas. Son valores iniciales razonables, no
// una decisión tomada: confírmalos o cámbialos aquí (un solo lugar) y súbele
// la VERSION_LEGAL cada vez que cambie el sentido de algún texto.
export const VERSION_LEGAL = '2026-10-08'
export const FECHA_LEGAL = '8 de octubre de 2026'

export const RUTAS_LEGALES = {
  terminos: '/terminos-y-condiciones',
  cambios: '/politica-de-cambios-y-devoluciones',
  privacidad: '/politica-de-privacidad',
  reclamos: '/libro-de-reclamaciones',
}

export const REGLAS = {
  // Productos
  plazoDevolucionProductosDias: 7, // días calendario desde que la clienta recibe el producto
  // Citas
  horasCancelarSinCosto: 24, // anticipación mínima para cancelar/reprogramar sin perder el adelanto
  minutosTolerancia: 15, // tolerancia de llegada a la cita
  plazoReclamoServicioDias: 7, // días para avisar si no quedó conforme con un servicio
  // Reembolsos
  diasProcesarReembolso: 7, // días hábiles para que el negocio procese un reembolso aprobado
}
