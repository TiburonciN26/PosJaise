// Coherencia de Recompensas en el portal — capa PURA (sin navegador, sin base de datos): reglas vigentes, estimados, avance por
// clasificación y estados de carga. Todo con datos ficticios en memoria.
//
//   node --test tests/e2e/programa-recompensas.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  avanceNivel, estimarMonedas, normalizarReglas, reglaSellos, resumenEstimado, tarjetaDeSellos, textoMonedasEstimadas, textoTasa,
} from '../../src/lib/programaRecompensas.js';

const FILA = {
  activo: true, tasa_serv_monedas: '5.0000', tasa_serv_soles: '20.0000', tasa_prod_monedas: '5.0000', tasa_prod_soles: '40.0000',
  umbral_premium: '50.0000', umbral_vip: '150.0000', sellos_max: 20, sellos_por_premio: 5,
};
const activo = (fila = FILA) => ({ estado: 'ok', activo: true, reglas: normalizarReglas(fila) });
const apagado = { estado: 'ok', activo: false, reglas: null };
const cargando = { estado: 'cargando', activo: null, reglas: null };
const error = { estado: 'error', activo: null, reglas: null };

test('normalizarReglas: programa activo con cifras válidas', () => {
  const r = normalizarReglas(FILA);
  assert.deepEqual(r, {
    activo: true, tasaServ: { monedas: 5, soles: 20 }, tasaProd: { monedas: 5, soles: 40 }, umbralPremium: 50, umbralVip: 150, sellosMax: 20, sellosPorPremio: 5,
  });
});

test('normalizarReglas: programa apagado → sin reglas que anunciar (aunque la fila trajera cifras)', () => {
  assert.deepEqual(normalizarReglas({ ...FILA, activo: false }), { activo: false });
  assert.deepEqual(normalizarReglas({ activo: false, tasa_serv_monedas: null }), { activo: false });
});

test('normalizarReglas: datos ausentes o inutilizables → null, nunca una tasa por omisión', () => {
  for (const mala of [undefined, null, {}, { activo: 'si' }, { ...FILA, tasa_serv_monedas: null }, { ...FILA, tasa_prod_soles: '0' },
    { ...FILA, tasa_serv_soles: 'abc' }, { ...FILA, umbral_vip: '40' }, { ...FILA, umbral_premium: null }, { ...FILA, sellos_max: 0 },
    { ...FILA, sellos_por_premio: 2.5 }, { ...FILA, sellos_por_premio: null }]) {
    assert.equal(normalizarReglas(mala), null, JSON.stringify(mala));
  }
});

test('estimarMonedas con 5/20 y 5/40: servicio S/100 → 25; producto S/80 → 10; mixto suma', () => {
  const r = normalizarReglas(FILA);
  assert.equal(estimarMonedas(r, { servicios: 100 }), 25);
  assert.equal(estimarMonedas(r, { productos: 80 }), 10);
  assert.equal(estimarMonedas(r, { servicios: 100, productos: 80 }), 35);
});

test('estimarMonedas sigue la configuración: tasas distintas de 5/20 y 5/40 (3/25 y 2/16)', () => {
  const r = normalizarReglas({ ...FILA, tasa_serv_monedas: '3', tasa_serv_soles: '25', tasa_prod_monedas: '2', tasa_prod_soles: '16' });
  assert.equal(estimarMonedas(r, { servicios: 100 }), 12);
  assert.equal(estimarMonedas(r, { productos: 80 }), 10);
});

test('estimarMonedas: programa apagado o importes inválidos', () => {
  assert.equal(estimarMonedas(normalizarReglas({ ...FILA, activo: false }), { servicios: 100 }), null);
  assert.equal(estimarMonedas(null, { servicios: 100 }), null);
  const r = normalizarReglas(FILA);
  assert.equal(estimarMonedas(r, { servicios: -50, productos: Number.NaN }), 0);
});

test('textoMonedasEstimadas: singular, decimales y cifras pequeñas', () => {
  assert.equal(textoMonedasEstimadas(25), '≈ 25 monedas');
  assert.equal(textoMonedasEstimadas(1), '≈ 1 moneda');
  assert.equal(textoMonedasEstimadas(2.5), '≈ 2.5 monedas');
  assert.equal(textoMonedasEstimadas(0.004), '≈ menos de 0.01 monedas');
  assert.equal(textoMonedasEstimadas(Number.NaN), null);
  assert.equal(textoMonedasEstimadas(-1), null);
});

test('textoTasa sale de la configuración (no de un texto fijo)', () => {
  assert.equal(textoTasa({ monedas: 5, soles: 20 }), '5 monedas por cada S/ 20');
  assert.equal(textoTasa({ monedas: 1, soles: 12.5 }), '1 moneda por cada S/ 12.5');
  assert.equal(textoTasa({ monedas: 3, soles: 25 }), '3 monedas por cada S/ 25');
});

test('avanceNivel: gastar monedas no cambia el avance (depende solo de la clasificación)', () => {
  const base = { umbralPremium: 50, umbralVip: 150 };
  // Clasificación 40, BASICO: 80 % hacia Premium y faltan 10, tenga 40 o 10 monedas.
  const a = avanceNivel({ nivel: 'BASICO', clasificacion: 40, ...base });
  assert.deepEqual(a, { pct: 80, faltan: 10, siguiente: 'Premium' });
  // Premium con 60: (60−50)/(150−50) = 10 %, faltan 90 para VIP.
  assert.deepEqual(avanceNivel({ nivel: 'PREMIUM', clasificacion: 60, ...base }), { pct: 10, faltan: 90, siguiente: 'VIP' });
  assert.deepEqual(avanceNivel({ nivel: 'VIP', clasificacion: 200, ...base }), { pct: 100, faltan: 0, siguiente: null });
});

test('avanceNivel: umbrales configurados distintos y valores límite', () => {
  const r = { umbralPremium: 30, umbralVip: 90 };
  assert.deepEqual(avanceNivel({ nivel: 'BASICO', clasificacion: 0, ...r }), { pct: 0, faltan: 30, siguiente: 'Premium' });
  assert.deepEqual(avanceNivel({ nivel: 'BASICO', clasificacion: 29.2, ...r }), { pct: (29.2 / 30) * 100, faltan: 1, siguiente: 'Premium' });
  // Clasificación negativa nunca sale del rango de la barra.
  assert.equal(avanceNivel({ nivel: 'BASICO', clasificacion: -5, ...r }).pct, 0);
});

test('tarjetaDeSellos: llena, parcial y negativa', () => {
  assert.deepEqual(tarjetaDeSellos(3, 5), { enTarjeta: 3, completa: false, faltan: 2, negativo: false, porRecuperar: 0 });
  assert.deepEqual(tarjetaDeSellos(5, 5), { enTarjeta: 0, completa: true, faltan: 5, negativo: false, porRecuperar: 0 });
  assert.deepEqual(tarjetaDeSellos(0, 5), { enTarjeta: 0, completa: false, faltan: 5, negativo: false, porRecuperar: 0 });
  const n = tarjetaDeSellos(-7, 5);
  assert.equal(n.negativo, true);
  assert.equal(n.porRecuperar, 7);
  assert.equal(n.faltan, null);
});

test('reglaSellos usa las cifras vigentes', () => {
  assert.match(reglaSellos({ sellosMax: 20, sellosPorPremio: 5 }), /hasta 20 sellos y cada premio cuesta 5\./);
  assert.match(reglaSellos({ sellosMax: 12, sellosPorPremio: 4 }), /hasta 12 sellos y cada premio cuesta 4\./);
  assert.match(reglaSellos({ sellosMax: 12, sellosPorPremio: 4 }), /Los productos solos no dan sello/);
});

// ---------------------------------------------------------------------------------------------------------------------------
test('resumenEstimado · programa activo, SERVICIO S/100: «≈ 25 monedas» marcado como estimado + sello condicionado', () => {
  const r = resumenEstimado({ programa: activo(), tipo: 'SERVICIO', precio: 100, legacy: { puntosPorSol: 0.05 } });
  assert.equal(r.estado, 'activo');
  assert.equal(r.cifra, '≈ 25 monedas');
  assert.match(r.detalle, /estimado/);
  assert.match(r.detalle, /al confirmarse la compra/);
  assert.equal(r.sello.cifra, 'Puede dar 1 sello');
  assert.match(r.sello.detalle, /venta confirmada/);
  assert.doesNotMatch(JSON.stringify(r), /puntos|\+5|aprox\. por esta visita/);
});

test('resumenEstimado · programa activo, PRODUCTO S/80: usa la tasa de productos y no promete sello', () => {
  const r = resumenEstimado({ programa: activo(), tipo: 'PRODUCTO', precio: 80, legacy: { puntosPorSol: 0.05 } });
  assert.equal(r.cifra, '≈ 10 monedas');
  assert.equal(r.sello.cifra, 'Sin sello');
  assert.match(r.sello.detalle, /productos solos no dan sello/);
});

test('resumenEstimado · tasas configuradas distintas cambian el estimado', () => {
  const p = activo({ ...FILA, tasa_serv_monedas: '3', tasa_serv_soles: '25', tasa_prod_monedas: '2', tasa_prod_soles: '16' });
  assert.equal(resumenEstimado({ programa: p, tipo: 'SERVICIO', precio: 100 }).cifra, '≈ 12 monedas');
  assert.equal(resumenEstimado({ programa: p, tipo: 'PRODUCTO', precio: 80 }).cifra, '≈ 10 monedas');
});

test('resumenEstimado · programa apagado: se conserva lo heredado y no aparecen monedas', () => {
  const s = resumenEstimado({ programa: apagado, tipo: 'SERVICIO', precio: 100, legacy: { puntosPorSol: 0.05 } });
  assert.equal(s.estado, 'heredado');
  assert.equal(s.cifra, '+5 puntos');
  assert.equal(s.detalle, 'aprox. por esta visita');
  assert.equal(s.sello.cifra, 'Suma sello');
  assert.doesNotMatch(JSON.stringify(s), /monedas/);
  // Producto: en el programa heredado los productos NO dan puntos (mis_puntos solo cuenta servicios): no se promete una cifra.
  const p = resumenEstimado({ programa: apagado, tipo: 'PRODUCTO', precio: 80, legacy: { puntosPorSol: 0.05 } });
  assert.doesNotMatch(p.cifra, /\+\d/);
  assert.match(p.detalle, /productos aún no dan puntos/);
});

test('resumenEstimado · heredado sin la fórmula de puntos (lectura fallida): no inventa una cifra', () => {
  for (const legacy of [undefined, {}, { puntosPorSol: null }, { puntosPorSol: Number.NaN }]) {
    const s = resumenEstimado({ programa: apagado, tipo: 'SERVICIO', precio: 100, legacy });
    assert.equal(s.cifra, 'Suma puntos');
    assert.doesNotMatch(s.cifra, /\d/);
  }
});

test('resumenEstimado · configuración lenta o fallida: ni cifra ni tasa inventada', () => {
  const lenta = resumenEstimado({ programa: cargando, tipo: 'SERVICIO', precio: 100, legacy: { puntosPorSol: 0.05 } });
  assert.equal(lenta.estado, 'cargando');
  assert.doesNotMatch(JSON.stringify(lenta), /\d/);
  const fallida = resumenEstimado({ programa: error, tipo: 'SERVICIO', precio: 100, legacy: { puntosPorSol: 0.05 } });
  assert.equal(fallida.estado, 'error');
  assert.doesNotMatch(JSON.stringify(fallida), /\d/);
  assert.match(fallida.detalle, /no disponibles ahora/);
});
