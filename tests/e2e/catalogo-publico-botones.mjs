// QA-077 — comprobación CONJUNTA del estado de los botones «Obtener cupón» del catálogo público (sin sesión).
//
// Antes: un bucle con una aserción de Playwright por botón (643 botones ≈ 55 s de un límite de 60 s). Ahora: una sola lectura del DOM
// (`evaluateAll`) y una función pura que decide. Contra falsos positivos: el número de botones debe ser EXACTAMENTE el de premios de
// MONEDAS que devolvió la propia consulta pública (nunca cero, nunca una carga parcial), y ninguno puede estar habilitado.
export function evaluarBotones(estados, esperado) {
  if (!Number.isInteger(esperado) || esperado <= 0) {
    throw new Error(`Catálogo sin filas de MONEDAS (esperado=${esperado}): no se puede afirmar que «ningún botón está habilitado».`);
  }
  if (!Array.isArray(estados) || estados.length !== esperado) {
    throw new Error(`Carga incompleta: ${estados?.length ?? 0} botones en la página, pero la consulta pública devolvió ${esperado} premios de MONEDAS.`);
  }
  const habilitados = estados.filter((deshabilitado) => deshabilitado !== true).length;
  if (habilitados > 0) throw new Error(`${habilitados} de ${esperado} botones «Obtener cupón» están habilitados sin sesión.`);
  return { total: esperado, habilitados: 0, deshabilitados: esperado };
}

// `page` ya navegó a /recompensas?seccion=canje. `respuestaCatalogo` es la respuesta de catalogo_recompensas_publico de ESA carga.
export async function comprobarCanjeBloqueadoSinSesion(page, expect, respuestaCatalogo) {
  const filas = await respuestaCatalogo.json();
  const esperado = filas.filter((f) => f.origen === 'MONEDAS').length;
  const botones = page.getByRole('button', { name: 'Obtener cupón', exact: true });
  // Espera a que el DOM llegue a la cantidad exacta (no a «algo»): descarta lista vacía y carga parcial.
  await expect(botones).toHaveCount(esperado);
  const estados = await botones.evaluateAll((els) => els.map((el) => el.disabled));
  return evaluarBotones(estados, esperado);
}
