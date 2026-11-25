// Costeo de Recompensas (pestaña Web) — los componentes REALES de los editores se pintan con react-dom/server a través de Vite
// (ssrLoadModule): sin base de datos, sin sesión y sin navegador. No sustituye la verificación visual; comprueba que lo que ve la
// administradora (receta, comisión real por asistente, margen, cupón máximo, avisos) sale con las cifras correctas.
//
//   node --test tests/e2e/costeo-ui-ssr.test.mjs
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let vite;
let React;
let renderToStaticMarkup;
let ToastProvider;
let FilaCosteoServicio;
let FilaCosteoProducto;
let Rentabilidad;

before(async () => {
  // Los componentes importan el cliente de Supabase (src/lib/supabase.js), que exige estas dos variables al cargarse. Este test no se
  // conecta a nada (solo pinta HTML), pero en la CI no hay .env: se les da un valor de relleno si faltan. Vite lee las VITE_* de process.env.
  process.env.VITE_SUPABASE_URL ||= 'http://127.0.0.1:54321';
  process.env.VITE_SUPABASE_ANON_KEY ||= 'clave-de-relleno-solo-para-el-test';
  vite = await createServer({
    configFile: 'vite.config.js',
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  FilaCosteoServicio = (await vite.ssrLoadModule('/src/pages/recompensas/CosteoServicio.jsx')).default;
  FilaCosteoProducto = (await vite.ssrLoadModule('/src/pages/recompensas/CosteoProducto.jsx')).default;
  Rentabilidad = (await vite.ssrLoadModule('/src/pages/recompensas/Rentabilidad.jsx')).default;
  ({ ToastProvider } = await vite.ssrLoadModule('/src/context/ToastContext.jsx'));
  React = (await import('react')).default;
  ({ renderToStaticMarkup } = await import('react-dom/server'));
});
after(async () => { await vite?.close(); });

const pintar = (elemento) => renderToStaticMarkup(React.createElement(ToastProvider, null, elemento));
const sinEtiquetas = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noop = () => {};

const servicio = { id: '11111111-2222-3333-4444-555555555555', nombre: 'Rubber gel', precio: '100', activo: true };
// Gel: S/ 80 el frasco que rinde 1600 usos (0,05 por uso)… para el ejemplo se usa 1 uso a S/ 4 (compra 80, rinde 20).
const lineas = [
  { id: 'a', orden: 1, categoria: 'INSUMO', descripcion: 'Gel constructor', almacen_articulo_id: null, cantidad: '1', unidad: 'uso', costo_unitario: '4.0000', costo_compra: '80.0000', rinde: '20.0000' },
  { id: 'b', orden: 2, categoria: 'OTRO', descripcion: 'Otro', almacen_articulo_id: null, cantidad: '1', unidad: null, costo_unitario: '5', costo_compra: null, rinde: null },
];
const asistentes = [{ nombre: 'Angela', porcentaje: 40 }, { nombre: 'Kelly', porcentaje: 55 }];
// Artículos del almacén (lo que devuelve almacen_costos_sugeridos): los materiales se eligen de aquí.
const almacen = [
  { articulo_id: 'art-gel', nombre: 'Gel constructor', unidad: 'frasco', costo_unitario: '80.0000' },
  { articulo_id: 'art-alcohol', nombre: 'Alcohol 70', unidad: 'frasco', costo_unitario: '10.0000' },
  { articulo_id: 'art-nuevo', nombre: 'Algodón en discos', unidad: 'bolsa', costo_unitario: null },
];
// Línea de material ya vinculada al almacén (así vienen las líneas guardadas desde que los materiales salen del almacén)
const material = (extra = {}) => ({ id: 'x', categoria: 'INSUMO', descripcion: 'Alcohol 70', almacenArticuloId: 'art-alcohol', cantidad: '1', unidad: 'frasco', costoCompra: '10', rinde: '1', ...extra });

function fila(extra = {}) {
  return pintar(React.createElement(FilaCosteoServicio, {
    servicio, prot: { servicio_id: servicio.id, lineas }, asistentes, sugeridos: almacen,
    valores: { lineas: lineas.map((l) => ({ id: l.id, categoria: l.categoria, descripcion: l.descripcion, almacenArticuloId: l.categoria === 'INSUMO' ? 'art-gel' : '', cantidad: String(Number(l.cantidad)), unidad: l.unidad ?? '', costoCompra: String(Number(l.costo_compra ?? l.costo_unitario)), rinde: l.rinde === null ? '1' : String(Number(l.rinde)) })) },
    abierto: true, destacado: false, onAlternar: noop, onCambiar: noop, onGuardado: noop, onLimpiarBorrador: noop, ...extra,
  }));
}

describe('Costeo de servicio: lo que ve la administradora', () => {
  test('receta, totales y comisión REAL por asistente (el cupón no baja su pago)', () => {
    const t = sinEtiquetas(fila());
    assert.match(t, /Receta de costos/);
    assert.match(t, /Costeado/);
    // Etiquetas VISIBLES en cada campo (antes eran solo placeholders y no se entendía qué era cada número)
    assert.match(t, /Lo que costó lo que compraste \(S\/\)/);
    assert.match(t, /Rinde para \(usos\)/);
    assert.match(t, /Usos gastados en este servicio/);
    assert.match(t, /Costo por uso \(estimado\): S\/ 4\.00/); // 80 ÷ 20, calculado por el sistema
    assert.match(t, /Esta línea suma: S\/ 4\.00/);
    assert.match(t, /Materiales S\/ 4\.00/); // 0,05 × 80
    assert.match(t, /Otros directos S\/ 5\.00/);
    // Los materiales salen del almacén; no hay botón de «agregar línea» suelta, sí uno aparte para costos que no son materiales
    assert.match(t, /Material del almacén/);
    assert.match(t, /Gel constructor/);
    assert.doesNotMatch(t, /Agregar línea/);
    assert.match(t, /Agregar otro costo \(no es material\)/);
    // El buscador del almacén es un solo cuadro (como el de Ventas), no una lista desplegable nativa
    assert.match(fila(), /role="combobox"[^>]*aria-label="Buscar material del almacén"/);
    assert.doesNotMatch(fila(), /<select[^>]*aria-label="Agregar material/);
    assert.doesNotMatch(t, /no está vinculado al almacén/);
    // Angela 40 %: comisión 40, costo directo 4 + 5 + 40 = 49, margen 51 (51 %)
    assert.match(t, /Angela · 40 %/);
    assert.match(t, /margen S\/ 51\.00 \(51 %\)/);
    assert.match(t, /comisión S\/ 40\.00 · costo directo S\/ 49\.00/);
    // El cupón máximo es UNO solo para el servicio (con el % más alto, Kelly 55 %): 100 − (4 + 5 + 55) = 36, igual para todas las clientas
    assert.match(t, /Cupón máximo para cualquier clienta: S\/ 36\.00/);
    assert.match(t, /mismo para todas, atienda quien atienda/);
    assert.doesNotMatch(t, /cupón máximo S\/ 51\.00/);
    // Kelly 55 %: comisión 55, costo 64, margen 36
    assert.match(t, /Kelly · 55 %/);
    assert.match(t, /margen S\/ 36\.00 \(36 %\)/);
    // La dueña no tiene pago en efectivo: costo 9, margen 91
    assert.match(t, /Administradora \(la dueña\)/);
    assert.match(t, /margen S\/ 91\.00 \(91 %\)/);
    assert.match(t, /no le baja la comisión/);
  });

  test('sin configurar: etiqueta honesta, sin botón de quitar; sin asistentes con % se avisa', () => {
    const t = sinEtiquetas(fila({ prot: null, asistentes: [], valores: { lineas: [] } }));
    assert.match(t, /Sin configurar/);
    assert.doesNotMatch(t, /Dejar sin configurar/);
    assert.match(t, /Ninguna asistente activa tiene porcentaje/);
    assert.match(t, /Sin líneas todavía/);
    assert.match(t, /no es cero/); // «sin configurar» no es cero: el respaldo del 50 %
  });

  test('un servicio cerrado muestra solo una fila (título, precio, estado) y no monta el detalle', () => {
    const t = sinEtiquetas(fila({ abierto: false }));
    assert.match(t, /Rubber gel/);
    assert.match(t, /Precio S\/ 100\.00/);
    assert.doesNotMatch(t, /Receta de costos/);
  });

  test('margen negativo se muestra (no se oculta) y el cupón máximo nunca es negativo', () => {
    const t = sinEtiquetas(fila({
      servicio: { ...servicio, precio: '10' },
      valores: { lineas: [material({ descripcion: 'Caro', costoCompra: '9' })] },
    }));
    assert.match(t, /Angela · 40 %/);
    assert.match(t, /margen S\/ -3\.00/); // 10 − 9 − 4
    assert.match(t, /Cupón máximo para cualquier clienta: S\/ 0\.00/);
    assert.match(t, /deja pérdida aun sin cupón/); // cada asistente con margen negativo se avisa
    // La captura de la dueña: el sistema explica POR QUÉ el cupón máximo es 0 y sugiere los usos del envase
    assert.match(t, /no queda margen y no admite cupones/);
    assert.match(t, /cuántos usos rinde/);
  });

  test('LA CAPTURA DE LA DUEÑA: alcohol de S/ 10 contado entero en un servicio de S/ 10 → cupón máximo 0, y el sistema lo explica', () => {
    const t = sinEtiquetas(fila({
      servicio: { ...servicio, precio: '10' },
      valores: { lineas: [material()] },
    }));
    assert.match(t, /Esta sola línea \(S\/ 10\.00\) iguala o supera el precio del servicio \(S\/ 10\.00\)/);
    assert.match(t, /Angela · 40 % margen S\/ -4\.00 \(-40 %\)/);
    assert.match(t, /Administradora \(la dueña\) · 0 % margen S\/ 0\.00 \(0 %\)/);
    // El tope es parejo y vale 0: con el % más alto (55 %) el costo directo (10 + 5,50) supera el precio
    assert.match(t, /Cupón máximo para cualquier clienta: S\/ 0\.00/);
    assert.match(t, /costo directo \(S\/ 15\.50\) supera el precio \(S\/ 10\.00\), así que no queda margen y no admite cupones/);
  });

  test('el mismo servicio con el alcohol costeado por uso (S/ 10 el frasco, 100 usos) ya tiene margen y admite cupón', () => {
    const t = sinEtiquetas(fila({
      servicio: { ...servicio, precio: '10' },
      valores: { lineas: [material({ rinde: '100' })] },
    }));
    assert.match(t, /Costo por uso \(estimado\): S\/ 0\.10/);
    assert.match(t, /Materiales S\/ 0\.10/);
    assert.match(t, /Administradora \(la dueña\) · 0 % margen S\/ 9\.90/);
    assert.match(t, /Angela · 40 % margen S\/ 5\.90/); // 10 − 0,10 − 4,00
    assert.match(t, /Cupón máximo para cualquier clienta: S\/ 4\.40/); // con el % más alto (55 %): 10 − 0,10 − 5,50
    assert.doesNotMatch(t, /no queda margen/);
  });

  test('una línea de material sin vincular al almacén (antigua) avisa y ofrece elegir el material; no se puede guardar así', () => {
    const t = sinEtiquetas(fila({ valores: { lineas: [material({ almacenArticuloId: '', descripcion: 'Alcohol suelto' })] } }));
    assert.match(t, /«Alcohol suelto» no está vinculado al almacén/);
    assert.match(t, /Elige el material del almacén para poder guardar, o quita esta línea/);
    assert.match(fila({ valores: { lineas: [material({ almacenArticuloId: '' })] } }), /id="ct-11111111-l0-vincular"[^>]*role="combobox"|role="combobox"[^>]*id="ct-11111111-l0-vincular"/); // trae su propio buscador
    assert.doesNotMatch(t, /Material del almacén Alcohol suelto/);
  });

  test('el buscador del almacén arranca cerrado (la lista aparece al escribir) y avisa si el almacén está vacío', () => {
    const html = fila();
    assert.match(html, /placeholder="Buscar material del almacén\.\.\."/);
    assert.match(html, /aria-expanded="false"/);
    assert.doesNotMatch(html, /role="listbox"/); // la lista se muestra al enfocar o escribir (interacción, no se ve en el render inicial)
    const vacio = sinEtiquetas(fila({ sugeridos: [], valores: { lineas: [] } }));
    assert.match(vacio, /El almacén todavía no tiene artículos activos/);
  });
});

describe('Costeo de producto', () => {
  const producto = { id: '99999999-2222-3333-4444-555555555555', nombre: 'Esmalte', precio: '50', costo: '20' };
  const prod = (extra = {}) => sinEtiquetas(pintar(React.createElement(FilaCosteoProducto, {
    producto, prot: { producto_id: producto.id, costo_confirmado: false, lineas: [] },
    valores: { lineas: [{ id: 'a', categoria: 'TRANSPORTE', descripcion: 'Flete', monto: '3' }, { id: 'b', categoria: 'EMPAQUE', descripcion: 'Bolsa', monto: '0.5' }], confirmado: false },
    abierto: true, destacado: false, onAlternar: noop, onCambiar: noop, onGuardado: noop, onLimpiarBorrador: noop, ...extra,
  })));

  test('costo + transporte + empaque por unidad, margen y cupón máximo', () => {
    const t = prod();
    assert.match(t, /Protegido/);
    assert.match(t, /Transporte S\/ 3\.00/);
    assert.match(t, /Otros por unidad S\/ 0\.50/);
    assert.match(t, /Costo por unidad: S\/ 23\.50 · margen por unidad S\/ 26\.50 \(53 %\)/);
    assert.match(t, /cupón máximo si fuera el único artículo \(1 unidad\): S\/ 26\.50/);
  });

  test('costo 0 sin confirmar es DESCONOCIDO: lo dice y ofrece confirmarlo', () => {
    const t = prod({ producto: { ...producto, costo: '0' }, prot: null, valores: { lineas: [], confirmado: false } });
    assert.match(t, /Costo por revisar/);
    assert.match(t, /Costo desconocido/);
    assert.match(t, /Confirmo que el costo de compra/);
  });
});

describe('Rentabilidad: estado inicial', () => {
  test('al pintarse en el servidor muestra el selector de periodo y «Cargando…» (no ceros inventados)', () => {
    const t = sinEtiquetas(pintar(React.createElement(Rentabilidad, { activo: true })));
    assert.match(t, /Últimos 90 días/);
    assert.match(t, /Cargando/);
    assert.doesNotMatch(t, /S\/ 0\.00/);
  });
});
