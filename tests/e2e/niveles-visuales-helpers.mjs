// QA-062/QA-064 — comprobaciones de interfaz del diseño de cupones por nivel (Plata / Oro / Diamante + Especial), compartidas por la
// suite Playwright (qa-recompensas-037-040.spec.mjs) y por el verificador sin sesión (qa-062-niveles-visuales-publico.mjs).
//
// Las anclas son las clases del diseño vigente (index.css): `.cupon-n-plata|oro|diamante|rubi` sobre `.cupon-metal`, el destello
// `cupon-sheen` en `::after`, la iridiscencia `.cupon-iri` (Diamante y Especial) y las chispas `.cupon-chispa` (solo Diamante y Especial).
// Las clases antiguas (`.cupon-oro`, `.cupon-plata`, `.cupon-texto-oro` y la animación `cupon-glow`) ya no existen en las tarjetas por
// nivel: el diseño aprobado las reemplazó por el acabado metálico. No se usa `first()` para elegir «cualquiera»: cada fila se identifica
// por el nombre del premio de ejemplo cuyo nivel de negocio se conoce (datos.js: r1 Todos los niveles, r5 Desde Premium, r6 Desde VIP).
export const FILAS_EJEMPLO = [
  { nombre: 'Cupón de S/5 en servicios seleccionados', nivel: 'plata', etiqueta: 'Plata', requisito: 'Todos los niveles' },
  { nombre: 'Complemento hidratante en tu servicio', nivel: 'oro', etiqueta: 'Oro', requisito: 'Desde Premium' },
  { nombre: 'Tratamiento con precio preferencial VIP', nivel: 'diamante', etiqueta: 'Diamante', requisito: 'Desde VIP' },
];

const tarjetaDe = (page, nombre) => page.locator('.cupon-metal').filter({ hasText: nombre });

export async function comprobarNivelYEfectosEnCanje(page, expect) {
  await page.goto('/recompensas?seccion=canje');
  await expect(page.getByRole('tab', { name: /^Canjear (puntos|monedas)$/ })).toHaveAttribute('aria-selected', 'true');

  for (const fila of FILAS_EJEMPLO) {
    const tarjeta = tarjetaDe(page, fila.nombre);
    await expect(tarjeta, `fila «${fila.nombre}»`).toHaveCount(1);
    await expect(tarjeta).toBeVisible();
    // QA-064: el color es el nivel de negocio de la fila (el mismo que dice «Nivel» y el que da permiso), no su costo.
    await expect(tarjeta).toHaveClass(new RegExp(`\\bcupon-n-${fila.nivel}\\b`));
    await expect(tarjeta).toContainText(fila.etiqueta);
    await tarjeta.getByRole('button').first().click();
    await expect(tarjeta.locator('dt', { hasText: 'Nivel' }).locator('xpath=following-sibling::dd[1]')).toHaveText(fila.requisito);

    // Efectos: destello que cruza la tarjeta (::after → cupon-sheen) y resplandor metálico.
    expect(await tarjeta.evaluate((el) => getComputedStyle(el, '::after').animationName), `destello de ${fila.etiqueta}`).toContain('cupon-sheen');
    expect(await tarjeta.evaluate((el) => getComputedStyle(el).boxShadow), `resplandor de ${fila.etiqueta}`).not.toBe('none');
    expect(await tarjeta.locator('.cupon-metal-texto').first().evaluate((el) => getComputedStyle(el).textShadow), `tinta metálica de ${fila.etiqueta}`).not.toBe('none');
    await tarjeta.getByRole('button').first().click(); // vuelve a cerrar
  }

  // Iridiscencia solo en Diamante (capa de degradado adicional sobre el metal); Plata y Oro no la llevan.
  await expect(tarjetaDe(page, FILAS_EJEMPLO[2].nombre)).toHaveClass(/\bcupon-iri\b/);
  await expect(tarjetaDe(page, FILAS_EJEMPLO[0].nombre)).not.toHaveClass(/\bcupon-iri\b/);
  await expect(tarjetaDe(page, FILAS_EJEMPLO[1].nombre)).not.toHaveClass(/\bcupon-iri\b/);
  const capas = (fila) => tarjetaDe(page, fila.nombre).evaluate((el) => getComputedStyle(el).backgroundImage.match(/linear-gradient/g)?.length ?? 0);
  expect(await capas(FILAS_EJEMPLO[2]), 'Diamante superpone la capa iridiscente').toBeGreaterThan(await capas(FILAS_EJEMPLO[0]));

  // Chispas titilantes: solo en Diamante (y Especial); cada fila con chispas tiene al menos 3, y Plata/Oro ninguna.
  const envoltura = (fila) => tarjetaDe(page, fila.nombre).locator('xpath=..');
  const chispasDiamante = envoltura(FILAS_EJEMPLO[2]).locator('.cupon-chispa.cupon-chispa-diamante');
  expect(await chispasDiamante.count(), 'chispas del nivel Diamante').toBeGreaterThanOrEqual(3);
  expect(await chispasDiamante.first().evaluate((el) => getComputedStyle(el).animationName)).toContain('cupon-titilar');
  await expect(envoltura(FILAS_EJEMPLO[0]).locator('.cupon-chispa')).toHaveCount(0);
  await expect(envoltura(FILAS_EJEMPLO[1]).locator('.cupon-chispa')).toHaveCount(0);
}

// Sin desbordes horizontales y con las tarjetas dentro del viewport (móvil 390 y escritorio 1280).
export async function comprobarResponsiveCanje(page, expect, ancho) {
  await page.setViewportSize({ width: ancho, height: 900 });
  await page.goto('/recompensas?seccion=canje');
  await expect(tarjetaDe(page, FILAS_EJEMPLO[0].nombre)).toBeVisible();
  const medidas = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, ventana: window.innerWidth }));
  expect(medidas.scroll, `sin desborde horizontal a ${ancho}px`).toBeLessThanOrEqual(medidas.ventana);
  for (const fila of FILAS_EJEMPLO) {
    const caja = await tarjetaDe(page, fila.nombre).boundingBox();
    expect(caja.x, `${fila.etiqueta} dentro del viewport (izq.)`).toBeGreaterThanOrEqual(0);
    expect(caja.x + caja.width, `${fila.etiqueta} dentro del viewport (der.)`).toBeLessThanOrEqual(ancho + 0.5);
  }
}
