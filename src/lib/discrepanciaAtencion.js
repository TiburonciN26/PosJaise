// Discrepancia de una atención de Mis atenciones (tabla registro_discrepancias, RPC marcar/retirar/confirmar_acuerdo_atencion).
// La abre la administradora sobre la atención de otra persona cuando algo no cuadra y se resuelve hablando: queda resuelta cuando
// LAS DOS partes confirman el acuerdo (la «manito»). Sin base de datos ni navegador: node --test tests/e2e/discrepancia-atencion.test.mjs

// Una atención puede acumular varias discrepancias con el tiempo (una resuelta o retirada y otra nueva). Interesa la ABIERTA o, si
// no hay, la última RESUELTA (queda como constancia «Acuerdo exitoso»). Las retiradas no se muestran.
export function discrepanciaDe(registro) {
  const lista = registro?.registro_discrepancias
  if (!Array.isArray(lista) || lista.length === 0) return null
  const abierta = lista.find((d) => !d.resuelta_en && !d.retirada_en)
  if (abierta) return { ...abierta, abierta: true }
  const resueltas = lista.filter((d) => d.resuelta_en).sort((a, b) => (a.resuelta_en < b.resuelta_en ? 1 : -1))
  return resueltas[0] ? { ...resueltas[0], abierta: false } : null
}

// Estado de la manito desde el lado de quien mira: `esDuena` = es quien anotó la atención (si no, es la administradora).
//   · estado: 'pendiente' (nadie confirmó) | 'parcial' (una parte confirmó) | 'resuelto' (las dos).
//   · yoConfirme / otroConfirmo: quién ya confirmó, para el texto y para deshabilitar el botón de quien ya lo pulsó.
export function estadoAcuerdo(discrepancia, esDuena) {
  if (!discrepancia) return { estado: 'ninguna', yoConfirme: false, otroConfirmo: false }
  const yoConfirme = Boolean(esDuena ? discrepancia.duena_acuerdo_en : discrepancia.admin_acuerdo_en)
  const otroConfirmo = Boolean(esDuena ? discrepancia.admin_acuerdo_en : discrepancia.duena_acuerdo_en)
  if (!discrepancia.abierta) return { estado: 'resuelto', yoConfirme: true, otroConfirmo: true }
  return { estado: yoConfirme || otroConfirmo ? 'parcial' : 'pendiente', yoConfirme, otroConfirmo }
}
