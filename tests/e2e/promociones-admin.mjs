// QA-061 — comprobación previa de la lista CERRADA contra lo leído de la base de datos (antes de iniciar sesión o escribir):
// cada objetivo debe existir por ID con su título exacto; si no, se aborta. Devuelve solo las que siguen activas.
export function pendientesDeLaLista(objetivo, filas) {
  for (const o of objetivo) {
    const coincidentes = filas.filter((x) => x.id === o.id);
    if (coincidentes.length !== 1 || coincidentes[0].titulo !== o.titulo) {
      throw new Error(`La promoción ${o.id} no existe, está repetida o su título no coincide; se aborta sin escribir.`);
    }
  }
  return filas.filter((f) => objetivo.some((o) => o.id === f.id) && f.activo);
}

// QA-061 — localizar UNA promoción en /promociones (ADMINISTRADOR) sin mirar la lista antes de que React la cargue.
//
// /promociones muestra un esqueleto (aria-hidden) mientras consulta y después, en el mismo render, uno de estos estados:
//   · la lista: un contenedor cuyas tarjetas tienen la fila desplegable de cada promoción ([role=button][aria-expanded]);
//   · «No hay promociones registradas.» (sin datos, o sin datos porque la consulta falló);
//   · «No se pudo cargar las promociones.» (la consulta falló; aparece junto al estado vacío).
// Se espera a la lista o al estado vacío (excluyentes: nunca coinciden los dos) y solo entonces se cuenta. Sin pausas fijas ni
// selección arbitraria: si la consulta falló, el título no está o está repetido, se lanza un error claro y no se toca nada.
export async function localizarPromocion(page, titulo, { timeout = 15_000 } = {}) {
  const pestana = page.locator('div.animate-entrada-pestana').filter({ has: page.getByPlaceholder('Buscar promoción...', { exact: true }) });
  const errorConsulta = pestana.getByText('No se pudo cargar las promociones.', { exact: true });
  const vacia = pestana.getByText('No hay promociones registradas.', { exact: true });
  const lista = pestana.locator(':scope > div').filter({ has: page.locator(':scope > div > [role="button"][aria-expanded]') });
  try {
    await vacia.or(lista).waitFor({ state: 'visible', timeout });
  } catch (error) {
    throw new Error(`/promociones no terminó de cargar (ni lista ni estado vacío): ${String(error?.message ?? error).split('\n')[0]}`);
  }
  if (await errorConsulta.isVisible()) {
    throw new Error('La consulta de /promociones falló («No se pudo cargar las promociones.»); se detiene sin escribir.');
  }
  // Relativo (sin ancla en la pestaña) para poder usarlo también dentro de `filter({ has })`, que busca dentro de cada tarjeta.
  const filaDelTitulo = page.locator('[role="button"][aria-expanded]').filter({ has: page.getByText(titulo, { exact: true }) });
  const fila = pestana.locator(filaDelTitulo);
  const n = await fila.count();
  if (n === 0) throw new Error(`«${titulo}» no aparece en /promociones; se detiene sin escribir.`);
  if (n > 1) throw new Error(`«${titulo}» aparece ${n} veces en /promociones (duplicada); se detiene sin escribir.`);
  // La tarjeta es el hijo de la lista que contiene esa fila (exactamente uno, porque la fila es única).
  return { fila, tarjeta: lista.locator(':scope > div').filter({ has: filaDelTitulo }) };
}
