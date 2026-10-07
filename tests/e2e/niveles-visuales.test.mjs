// QA-064 — lógica pura (sin base de datos): el nivel visual de premios y cupones es el nivel de negocio (`nivel_minimo`),
// nunca el costo en monedas ni el valor del descuento.
//
//   node --test tests/e2e/niveles-visuales.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { estiloNivelDeNegocio, nivelDeCupon, NOMBRE_VISUAL_NIVEL } from '../../src/lib/cupones.js';
import { ORDEN_NIVEL } from '../../src/pages/cliente/recompensas/datos.js';
import { premioAItem } from '../../src/pages/cliente/recompensas/lib.js';

const premio = (nivel_minimo, costo, extra = {}) => ({
  id: `p-${nivel_minimo}-${costo}`, nombre: 'x', descripcion: null, origen: 'MONEDAS', tipo: 'MONTO', valor: 5, nivel_minimo,
  costo, costo_basico: costo, canjeable: true, motivo: null, cupo_restante: null, ...extra,
});

describe('QA-064 · nivel visual = nivel de negocio', () => {
  test('BASICO = Plata, PREMIUM = Oro, VIP = Diamante', () => {
    assert.deepEqual(NOMBRE_VISUAL_NIVEL, { BASICO: 'Plata', PREMIUM: 'Oro', VIP: 'Diamante' });
    assert.equal(estiloNivelDeNegocio('BASICO').nombre, 'Plata');
    assert.equal(estiloNivelDeNegocio('PREMIUM').nombre, 'Oro');
    assert.equal(estiloNivelDeNegocio('VIP').nombre, 'Diamante');
  });

  test('un cupón se pinta por su nivel_minimo congelado, no por su valor', () => {
    for (const valor of [1, 10, 20, 500]) {
      for (const tipo_descuento of ['MONTO_FIJO', 'PORCENTAJE']) {
        assert.equal(nivelDeCupon({ origen: 'RECOMPENSA_MONEDAS', nivel_minimo: 'BASICO', valor, tipo_descuento }).nombre, 'Plata');
        assert.equal(nivelDeCupon({ origen: 'RECOMPENSA_MONEDAS', nivel_minimo: 'PREMIUM', valor, tipo_descuento }).nombre, 'Oro');
        assert.equal(nivelDeCupon({ origen: 'RECOMPENSA_SELLOS', nivel_minimo: 'VIP', valor, tipo_descuento }).nombre, 'Diamante');
      }
    }
  });

  test('las promociones por fechas son «Especial» sea cual sea su valor o nivel', () => {
    for (const valor of [1, 20, 500]) {
      assert.equal(nivelDeCupon({ origen: 'PROMOCION', nivel_minimo: 'BASICO', valor, tipo_descuento: 'PORCENTAJE' }).nombre, 'Especial');
      assert.equal(nivelDeCupon({ origen: 'PROMOCION', nivel_minimo: 'VIP', valor, tipo_descuento: 'MONTO_FIJO' }).nombre, 'Especial');
    }
    assert.equal(nivelDeCupon({ origen: 'PROMOCION', nivel_minimo: 'BASICO', valor: 5 }).chispas, 'roja');
  });

  test('un cupón sin nivel (filas anteriores o lectura incompleta) cae en Plata: el mismo nivel que no restringe el canje', () => {
    assert.equal(nivelDeCupon({ origen: 'FIDELIZACION', valor: 20, tipo_descuento: 'PORCENTAJE' }).nombre, 'Plata');
    assert.equal(nivelDeCupon({ origen: 'REFERIDO_BIENVENIDA', nivel_minimo: 'XYZ', valor: 50 }).nombre, 'Plata');
  });

  test('el premio del catálogo conserva su nivel aunque cueste mucho o poco, o cambie el costo por nivel de la clienta', () => {
    const casos = [['BASICO', 5000], ['BASICO', 1], ['PREMIUM', 5000], ['PREMIUM', 1], ['VIP', 5000], ['VIP', 1]];
    for (const [nivel, costo] of casos) {
      const item = premioAItem(premio(nivel, costo));
      assert.equal(ORDEN_NIVEL[item.nivelMin], nivel, `${nivel} con costo ${costo}`);
      assert.equal(estiloNivelDeNegocio(ORDEN_NIVEL[item.nivelMin]).nombre, NOMBRE_VISUAL_NIVEL[nivel]);
    }
    // Catálogo público (solo costo_basico): mismo nivel.
    const publico = premioAItem({ ...premio('VIP', 0), costo_basico: 5, costo: undefined }, { publico: true });
    assert.equal(ORDEN_NIVEL[publico.nivelMin], 'VIP');
  });

  test('catálogo y cupón emitido coinciden: el cupón congela el nivel_minimo del premio y se pinta igual', () => {
    for (const nivel of ['BASICO', 'PREMIUM', 'VIP']) {
      const item = premioAItem(premio(nivel, 77));
      const cupon = { origen: 'RECOMPENSA_MONEDAS', nivel_minimo: nivel, valor: 5, tipo_descuento: 'MONTO_FIJO' };
      assert.equal(estiloNivelDeNegocio(ORDEN_NIVEL[item.nivelMin]).claseTarjeta, nivelDeCupon(cupon).claseTarjeta);
    }
  });
});

// QA-063 — las expectativas de qa-recompensas-fase2-portal.spec.mjs (diálogo de canje) citan fragmentos del texto aprobado; aquí se
// comprueba, sin sesión, que cada fragmento está en REGLA_PROTECCION (lo que el diálogo muestra) y que la frase antigua ya no existe.
import { REGLA_PROTECCION, REGLA_CUPONES } from '../../src/pages/cliente/recompensas/lib.js';

describe('QA-063 · texto de protección mostrado al canjear', () => {
  test('explica la regla global y el límite en servicios «sin mínimo configurado»', () => {
    for (const fragmento of [
      'Los cupones respetan un mínimo de cobro por compra',
      'el cupón se rechaza completo, no se consume y puedes usarlo en otra compra',
      'En servicios sin mínimo configurado, además, un cupón no descuenta más del 50 % del precio',
    ]) assert.ok(REGLA_PROTECCION.includes(fragmento), `falta «${fragmento}»`);
    assert.ok(!REGLA_PROTECCION.includes('sin protección configurada'));
    assert.ok(REGLA_CUPONES.includes('Solo puedes usar un cupón por compra'));
  });

  test('no revela costos, materiales ni porcentajes internos', () => {
    assert.doesNotMatch(REGLA_PROTECCION, /S\/\s*\d|materiales|asistente|costo de|\d\s*%.*asist/i);
  });
});
