// Retorno efectivo de un premio (formulario de premios, pestaña Web → Recompensas). Capa PURA + el componente real renderizado con
// react-dom/server a través de Vite (sin base de datos, sin sesión, sin navegador).
//
//   node --test tests/e2e/retorno-premio.test.mjs
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import {
  costosPorNivel, lecturaRetorno, monedasPorSol, retornoMonedas, retornoSellos, valorDelPremio,
} from '../../src/lib/retornoPremio.js';

const TASA_SERV = { monedas: 5, soles: 20 }; // 0,25 monedas por S/
const TASA_PROD = { monedas: 5, soles: 40 }; // 0,125 monedas por S/

describe('retornoPremio: cuentas', () => {
  test('monedasPorSol con las tasas actuales', () => {
    assert.equal(monedasPorSol(TASA_SERV), 0.25);
    assert.equal(monedasPorSol(TASA_PROD), 0.125);
    assert.equal(monedasPorSol(null), null);
    assert.equal(monedasPorSol({ monedas: 5, soles: 0 }), null);
  });

  test('el ejemplo de la dueña: S/ 10 por 50 monedas = 5 % en servicios (gasta S/ 200) y 2,5 % en productos (gasta S/ 400)', () => {
    const [b] = retornoMonedas({ valorSoles: 10, costos: costosPorNivel({ costoBasico: 50 }), tasaServ: TASA_SERV, tasaProd: TASA_PROD });
    assert.equal(b.nivel, 'BASICO');
    assert.equal(b.gastoServicios, 200);
    assert.equal(b.retornoServicios, 5);
    assert.equal(b.gastoProductos, 400);
    assert.equal(b.retornoProductos, 2.5);
  });

  test('más barato en monedas = retorno mayor: 20 monedas → 12,5 %; 100 monedas → 2,5 %', () => {
    const f = (c) => retornoMonedas({ valorSoles: 10, costos: costosPorNivel({ costoBasico: c }), tasaServ: TASA_SERV, tasaProd: TASA_PROD })[0];
    assert.equal(f(20).retornoServicios, 12.5);
    assert.equal(f(20).gastoServicios, 80);
    assert.equal(f(100).retornoServicios, 2.5);
  });

  test('niveles: lo vacío hereda el del nivel inferior (igual que la base) y Premium/VIP pueden subir el retorno', () => {
    assert.deepEqual(costosPorNivel({ costoBasico: '100', costoPremium: '', costoVip: '' }).map((c) => c.costo), [100, 100, 100]);
    assert.deepEqual(costosPorNivel({ costoBasico: '100', costoPremium: '80', costoVip: '' }).map((c) => c.costo), [100, 80, 80]);
    assert.deepEqual(costosPorNivel({ costoBasico: '100', costoPremium: '', costoVip: '60' }).map((c) => c.costo), [100, 100, 60]);
    const filas = retornoMonedas({ valorSoles: 10, costos: costosPorNivel({ costoBasico: 100, costoPremium: 80, costoVip: 50 }), tasaServ: TASA_SERV, tasaProd: TASA_PROD });
    assert.deepEqual(filas.map((x) => x.retornoServicios), [2.5, 3.1, 5]);
  });

  test('sin costo no hay fila; costo 0 es un regalo (sin retorno); sin valor no se inventa nada', () => {
    assert.deepEqual(retornoMonedas({ valorSoles: 10, costos: costosPorNivel({ costoBasico: '' }), tasaServ: TASA_SERV, tasaProd: TASA_PROD }), []);
    const [b] = retornoMonedas({ valorSoles: 10, costos: costosPorNivel({ costoBasico: 0 }), tasaServ: TASA_SERV, tasaProd: TASA_PROD });
    assert.equal(b.retornoServicios, null);
    assert.equal(b.gastoServicios, 0);
    const [c] = retornoMonedas({ valorSoles: 0, costos: costosPorNivel({ costoBasico: 50 }), tasaServ: TASA_SERV, tasaProd: TASA_PROD });
    assert.equal(c.retornoServicios, null);
  });

  test('sellos: 5 visitas de S/ 40 = S/ 200; premio de S/ 10 → 5 %', () => {
    const r = retornoSellos({ valorSoles: 10, sellosPorPremio: 5, gastoPorVisita: '40' });
    assert.deepEqual(r, { visitas: 5, gasto: 200, retorno: 5 });
    assert.deepEqual(retornoSellos({ valorSoles: 10, sellosPorPremio: 5, gastoPorVisita: '' }), { visitas: 5, gasto: null, retorno: null });
  });

  test('valorDelPremio: monto, servicio (precio), porcentaje con tope o con compra de ejemplo', () => {
    assert.deepEqual(valorDelPremio({ tipo: 'MONTO', valor: '10' }), { soles: 10, nota: null });
    assert.equal(valorDelPremio({ tipo: 'MONTO', valor: '' }), null);
    assert.equal(valorDelPremio({ tipo: 'SERVICIO', servicioPrecio: null }), null);
    assert.equal(valorDelPremio({ tipo: 'SERVICIO', servicioPrecio: 60 }).soles, 60);
    // 20 % sin tope y sin ejemplo: depende de la compra → no se inventa
    assert.equal(valorDelPremio({ tipo: 'PORCENTAJE', valor: '20', tope: '' }), null);
    assert.equal(valorDelPremio({ tipo: 'PORCENTAJE', valor: '20', tope: '15' }).soles, 15); // máximo posible
    assert.equal(valorDelPremio({ tipo: 'PORCENTAJE', valor: '20', tope: '', compraEjemplo: '50' }).soles, 10);
    assert.equal(valorDelPremio({ tipo: 'PORCENTAJE', valor: '20', tope: '8', compraEjemplo: '50' }).soles, 8); // el tope manda
  });

  test('lecturaRetorno: bajo < 3 %, habitual 3–8 %, alto > 8 % (referencia, no norma)', () => {
    assert.equal(lecturaRetorno(2.5), 'bajo');
    assert.equal(lecturaRetorno(3), 'moderado');
    assert.equal(lecturaRetorno(8), 'moderado');
    assert.equal(lecturaRetorno(8.1), 'alto');
    assert.equal(lecturaRetorno(null), null);
  });
});

describe('RetornoEfectivo: lo que ve la administradora en el formulario', () => {
  let vite;
  let React;
  let renderToStaticMarkup;
  let RetornoEfectivo;
  before(async () => {
    vite = await createServer({
      configFile: 'vite.config.js', server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom', logLevel: 'error',
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    RetornoEfectivo = (await vite.ssrLoadModule('/src/pages/recompensas/RetornoEfectivo.jsx')).default;
    React = (await import('react')).default;
    ({ renderToStaticMarkup } = await import('react-dom/server'));
  });
  after(async () => { await vite?.close(); });

  const tasas = { serv: TASA_SERV, prod: TASA_PROD };
  const base = { origen: 'MONEDAS', tipo: 'MONTO', valor: '10', servicioId: '', tope: '', costoBasico: '50', costoPremium: '', costoVip: '' };
  const pintar = (f, sellos = 5) =>
    renderToStaticMarkup(React.createElement(RetornoEfectivo, { f, tasas, sellosPorPremio: sellos })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  test('premio de monedas: valor, retorno por nivel y las tasas actuales', () => {
    const t = pintar(base);
    assert.match(t, /Valor del premio: S\/ 10\.00/);
    assert.match(t, /Básico · 50 monedas/);
    assert.match(t, /Si gana en servicios: 5\.0 % · gasta S\/ 200\.00/);
    assert.match(t, /Si gana en productos: 2\.5 % · gasta S\/ 400\.00/);
    assert.match(t, /Premium · 50 monedas/); // hereda el costo del nivel inferior
    assert.match(t, /0\.25 monedas por S\/ en servicios y 0\.125 en productos/);
    assert.match(t, /rango habitual/);
  });

  test('retorno bajo y alto se avisan con su lectura', () => {
    assert.match(pintar({ ...base, costoBasico: '100' }), /Retorno bajo/);
    assert.match(pintar({ ...base, costoBasico: '20' }), /Retorno alto/);
  });

  test('sin datos suficientes no inventa cifras', () => {
    assert.match(pintar({ ...base, costoBasico: '' }), /Escribe el costo en monedas/);
    assert.match(pintar({ ...base, valor: '' }), /Escribe el valor del premio/);
    assert.match(pintar({ ...base, tipo: 'PORCENTAJE', valor: '20' }), /depende de la compra donde se use/);
    assert.match(pintar({ ...base, tipo: 'SERVICIO', servicioId: 'abc' }), /Elige el servicio|calcular cuánto vale/);
  });

  test('premio de sellos: pide el gasto por visita y lo explica en visitas', () => {
    const t = pintar({ ...base, origen: 'SELLOS', costoBasico: '' });
    assert.match(t, /Equivale a 5 visitas/);
    assert.match(t, /Gasto promedio por visita/);
    assert.match(t, /Escribe el gasto promedio por visita/);
  });
});
