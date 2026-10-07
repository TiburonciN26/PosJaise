// QA-064 — la tarjeta de cupón REAL (TarjetaCupon.jsx, la de Mis cupones, Referidos y Carrito) se pinta con el nivel de negocio del cupón.
// Se renderiza con react-dom/server a través de Vite (ssrLoadModule): componente real, sin base de datos, sin sesión y sin navegador.
// No sustituye la verificación visual ni la E2E con sesión; comprueba el nivel que cada tipo de cupón recibe en la interfaz.
//
//   node --test tests/e2e/tarjetas-cupon-niveles.test.mjs
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let vite;
let TarjetaCupon;
let React;
let renderToStaticMarkup;

before(async () => {
  vite = await createServer({
    configFile: 'vite.config.js',
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  TarjetaCupon = (await vite.ssrLoadModule('/src/components/TarjetaCupon.jsx')).default;
  React = (await import('react')).default;
  ({ renderToStaticMarkup } = await import('react-dom/server'));
});
after(async () => { await vite?.close(); });

const cupon = (extra) => ({
  codigo: 'TEST01', origen: 'RECOMPENSA_MONEDAS', nivel_minimo: 'BASICO', valor: 5, tipo_descuento: 'MONTO_FIJO',
  estado: 'DISPONIBLE', creado_en: '2026-10-01T12:00:00Z', ...extra,
});
const nivelesEn = (c) => renderToStaticMarkup(React.createElement(TarjetaCupon, { cupon: c })).match(/cupon-n-(plata|oro|diamante|rubi)\b/g);

describe('QA-064 · la tarjeta de cupón usa el nivel de negocio, no el valor del descuento', () => {
  const ESPERADO = { BASICO: 'cupon-n-plata', PREMIUM: 'cupon-n-oro', VIP: 'cupon-n-diamante' };

  test('premios por monedas y por sellos: BASICO→Plata, PREMIUM→Oro, VIP→Diamante, con cualquier valor o tipo de descuento', () => {
    for (const origen of ['RECOMPENSA_MONEDAS', 'RECOMPENSA_SELLOS']) {
      for (const [nivel, clase] of Object.entries(ESPERADO)) {
        for (const [valor, tipo_descuento] of [[1, 'MONTO_FIJO'], [25, 'MONTO_FIJO'], [500, 'MONTO_FIJO'], [5, 'PORCENTAJE'], [50, 'PORCENTAJE'], [30, 'SERVICIO']]) {
          assert.deepEqual(nivelesEn(cupon({ origen, nivel_minimo: nivel, valor, tipo_descuento })), [clase], `${origen} ${nivel} ${valor} ${tipo_descuento}`);
        }
      }
    }
  });

  test('el cupón de una promoción por fechas es Especial (rubí), con cualquier valor, y no depende del nivel', () => {
    for (const valor of [1, 20, 500]) {
      for (const nivel of Object.keys(ESPERADO)) {
        assert.deepEqual(nivelesEn(cupon({ origen: 'PROMOCION', nivel_minimo: nivel, valor })), ['cupon-n-rubi']);
      }
    }
  });

  test('bienvenida, referido y fidelización: sin nivel propio (BASICO) se ven Plata aunque su valor sea alto', () => {
    for (const origen of ['REFERIDO_BIENVENIDA', 'REFERIDO_RECOMPENSA', 'FIDELIZACION']) {
      assert.deepEqual(nivelesEn(cupon({ origen, valor: 50, tipo_descuento: 'PORCENTAJE' })), ['cupon-n-plata'], origen);
      assert.deepEqual(nivelesEn(cupon({ origen, valor: 100 })), ['cupon-n-plata'], origen);
    }
  });

  test('un cupón vencido o ya canjeado conserva su nivel (solo se atenúa)', () => {
    const html = renderToStaticMarkup(React.createElement(TarjetaCupon, { cupon: cupon({ nivel_minimo: 'VIP', estado: 'CANJEADO' }) }));
    assert.match(html, /cupon-n-diamante/);
    assert.match(html, /opacity-50/);
  });

  test('el rótulo de la tarjeta dice el mismo nivel que su color', () => {
    for (const [nivel, nombre] of [['BASICO', 'Plata'], ['PREMIUM', 'Oro'], ['VIP', 'Diamante']]) {
      assert.match(renderToStaticMarkup(React.createElement(TarjetaCupon, { cupon: cupon({ nivel_minimo: nivel }) })), new RegExp(`· ${nombre}<`));
    }
  });
});
