// Costeo detallado de Recompensas — capa PURA (sin navegador ni base de datos). Datos ficticios en memoria.
//
//   node --test tests/e2e/costeo-recompensas.test.mjs
//
// Replica las cuentas que hace la base (migración 20261124000002): totales hacia ARRIBA al centavo, categorías que entran al piso
// del cupón y comisión REAL de la asistente sobre el precio real (una promoción del salón no la reduce).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aCentavos, comisionAsistente, costoPorUso, cuponMaximoParejo, esCategoriaMaterial, filtrarArticulosAlmacen, lineaProductoVacia, lineaServicioVacia, lineasProductoAJson, lineasProductoDesdeFilas,
  lineasServicioAJson, lineasServicioDesdeFilas, redondearArriba, resultadoPorAsistente, resultadoProducto, totalesProducto,
  totalesServicio, validarLineasProducto, validarLineasServicio,
} from '../../src/lib/costeoRecompensas.js';

const linea = (categoria, descripcion, cantidad, costoUnitario, extra = {}) => ({
  // costoUnitario = lo que se compró; rinde 1 (se gasta entero) salvo que el caso diga otra cosa.
  // Los materiales salen del almacén: la línea de prueba ya viene vinculada (los «otros costos» no lo necesitan).
  ...lineaServicioVacia(categoria), descripcion, cantidad: String(cantidad), costoCompra: String(costoUnitario), rinde: '1',
  almacenArticuloId: esCategoriaMaterial(categoria) ? 'art-prueba' : '', ...extra,
});

test('redondearArriba: hacia arriba al centavo, sin ruido binario', () => {
  assert.equal(redondearArriba(0.999), 1);
  assert.equal(redondearArriba(0.1 + 0.2), 0.3); // 0.30000000000000004 no debe subir a 0.31
  assert.equal(redondearArriba(4.7), 4.7);
  assert.equal(redondearArriba(14.9985), 15);
  assert.equal(redondearArriba(0), 0);
});

test('totalesServicio: materiales, otros y local por categoría (el caso del ejemplo de la dueña)', () => {
  const t = totalesServicio([
    linea('INSUMO', 'Gel constructor', 0.05, 80), // 4,00
    linea('DESCARTABLE', 'Guantes', 2, 0.35), // 0,70
    linea('HERRAMIENTA', 'Desgaste de broca', 1, 0.3), // 0,30
    linea('TARJETA_POS', 'Comisión POS', 1, 1.5),
    linea('OTRO', 'Otro', 1, 0.25),
    linea('LOCAL', 'Uso del local 60 min', 60, 0.12), // 7,20 informativo
  ]);
  assert.deepEqual(t, { materiales: 5, otros: 1.75, local: 7.2 });
});

test('totalesServicio: sin líneas es todo 0 (decisión explícita, no «sin configurar»)', () => {
  assert.deepEqual(totalesServicio([]), { materiales: 0, otros: 0, local: 0 });
});

test('totalesProducto: transporte aparte; empaque, POS y otros suman a «otros»', () => {
  const t = totalesProducto([
    { ...lineaProductoVacia('TRANSPORTE'), descripcion: 'Flete', monto: '3' },
    { ...lineaProductoVacia('EMPAQUE'), descripcion: 'Bolsa de regalo', monto: '0.5' },
    { ...lineaProductoVacia('TARJETA_POS'), descripcion: 'Comisión', monto: '1.2' },
  ]);
  assert.deepEqual(t, { transporte: 3, otros: 1.7 });
});

test('comisión REAL: sobre el precio real del servicio; un cupón del salón no la reduce', () => {
  assert.equal(comisionAsistente(100, 40), 40);
  assert.equal(comisionAsistente(33.33, 45), 15); // 14,9985 → 15,00 (round, igual que el disparador de la base)
  const r = resultadoPorAsistente({ precio: 100, materiales: 10, otros: 5, porcentaje: 40 });
  assert.equal(r.comision, 40);
  assert.equal(r.costoDirecto, 55);
  assert.equal(r.margen, 45);
  assert.equal(r.cuponMaximo, 45); // el piso es 55: un cupón puede dar hasta 45 aunque la asistente cobre sus 40 completos
  const dueña = resultadoPorAsistente({ precio: 100, materiales: 10, otros: 5, porcentaje: 0 });
  assert.equal(dueña.cuponMaximo, 85);
});

test('resultadoPorAsistente: margen negativo y local informativo', () => {
  const r = resultadoPorAsistente({ precio: 10, materiales: 4, otros: 1, local: 2, porcentaje: 40 });
  assert.equal(r.comision, 4);
  assert.equal(r.costoDirecto, 9);
  assert.equal(r.margen, 1);
  assert.equal(r.margenConLocal, -1);
  assert.equal(r.cuponMaximo, 1);
  const peor = resultadoPorAsistente({ precio: 10, materiales: 8, otros: 0, porcentaje: 40 });
  assert.equal(peor.margen, -2);
  assert.equal(peor.cuponMaximo, 0); // nunca negativo
});

test('resultadoProducto: costo + transporte + otros por unidad', () => {
  const r = resultadoProducto({ precio: 50, costoCompra: 20, transporte: 3, otros: 2 });
  assert.equal(r.unitaria, 25);
  assert.equal(r.margenUnidad, 25);
  assert.equal(r.margenPct, 50);
  assert.equal(r.cuponMaximo, 25);
  assert.equal(resultadoProducto({ precio: 50, costoCompra: 20, transporte: 3, otros: 2, cantidad: 2 }).cuponMaximo, 50);
});

test('validarLineasServicio: descripción, cantidad y costo', () => {
  assert.equal(validarLineasServicio([]), null);
  assert.equal(validarLineasServicio([linea('INSUMO', 'Gel', 1, 0)]), null); // costo 0 explícito es válido
  assert.match(validarLineasServicio([linea('INSUMO', '  ', 1, 1)]), /Línea 1: escribe qué es/);
  assert.match(validarLineasServicio([linea('INSUMO', 'Gel', 0, 1)]), /cantidad/);
  assert.match(validarLineasServicio([linea('INSUMO', 'Gel', 1, '')]), /lo que costó/);
  assert.match(validarLineasServicio([linea('INSUMO', 'Gel', 1, -1)]), /lo que costó/);
  assert.match(validarLineasServicio([linea('INSUMO', 'Gel', 1, 10, { rinde: '0' })]), /rinde/);
  assert.equal(validarLineasServicio([linea('INSUMO', 'Gel', 1, 10, { rinde: '' })]), null); // vacío = 1 uso
  assert.match(validarLineasServicio([linea('INSUMO', 'x'.repeat(121), 1, 1)]), /demasiado larga/);
  assert.match(validarLineasServicio(Array.from({ length: 61 }, () => linea('INSUMO', 'a', 1, 1))), /Máximo 60/);
});

test('validarLineasServicio: un material debe venir del almacén; un «otro costo» no lo necesita', () => {
  assert.match(validarLineasServicio([linea('INSUMO', 'Gel', 1, 5, { almacenArticuloId: '' })]), /Línea 1: elige el material del almacén/);
  assert.match(validarLineasServicio([linea('DESCARTABLE', 'Guantes', 1, 5, { almacenArticuloId: '' })]), /almacén/);
  assert.match(validarLineasServicio([linea('HERRAMIENTA', 'Broca', 1, 5, { almacenArticuloId: '' })]), /almacén/);
  assert.equal(validarLineasServicio([linea('TARJETA_POS', 'Comisión POS', 1, 1.5)]), null);
  assert.equal(validarLineasServicio([linea('LOCAL', 'Uso del local', 1, 3)]), null);
  assert.equal(validarLineasServicio([linea('OTRO', 'Otro', 1, 1)]), null);
});

test('filtrarArticulosAlmacen: sin tildes ni mayúsculas, cada palabra debe aparecer, en cualquier orden', () => {
  const art = [
    { articulo_id: 'a', nombre: 'Alcohol 70° 1 L' },
    { articulo_id: 'b', nombre: 'Gel constructor transparente' },
    { articulo_id: 'c', nombre: 'Lima 100/180 (paquete)' },
    { articulo_id: 'd', nombre: 'Algodón en discos' },
  ];
  assert.equal(filtrarArticulosAlmacen(art, '').length, 4);
  assert.equal(filtrarArticulosAlmacen(art, '   ').length, 4);
  assert.deepEqual(filtrarArticulosAlmacen(art, 'ALCOHOL').map((a) => a.articulo_id), ['a']);
  assert.deepEqual(filtrarArticulosAlmacen(art, 'algodon').map((a) => a.articulo_id), ['d']); // sin tilde encuentra «Algodón»
  assert.deepEqual(filtrarArticulosAlmacen(art, 'algodón').map((a) => a.articulo_id), ['d']);
  assert.deepEqual(filtrarArticulosAlmacen(art, 'transparente gel').map((a) => a.articulo_id), ['b']); // otro orden
  assert.deepEqual(filtrarArticulosAlmacen(art, 'al').map((a) => a.articulo_id), ['a', 'd']);
  assert.deepEqual(filtrarArticulosAlmacen(art, 'zzz'), []);
});

test('cuponMaximoParejo: el tope depende del servicio (% más alto), no de quién atiende', () => {
  // Servicio de 100, materiales 10, otros 5, % más alto 55 → piso 70, tope 30
  assert.deepEqual(cuponMaximoParejo({ precio: 100, materiales: 10, otros: 5, porcentajeMax: 55 }), { comision: 55, piso: 70, cuponMaximo: 30 });
  // El mismo servicio visto con otra asistente (40 %) o con la dueña (0 %) NO cambia el tope: solo el % máximo lo decide.
  assert.equal(cuponMaximoParejo({ precio: 100, materiales: 10, otros: 5, porcentajeMax: 55 }).cuponMaximo, 30);
  // La comisión se redondea hacia arriba al centavo (como la base) y el tope nunca es negativo
  assert.equal(cuponMaximoParejo({ precio: 33.33, materiales: 0, otros: 0, porcentajeMax: 10 }).comision, 3.34);
  assert.equal(cuponMaximoParejo({ precio: 10, materiales: 10, otros: 0, porcentajeMax: 40 }).cuponMaximo, 0);
  // Sin asistentes con porcentaje: solo materiales y otros
  assert.equal(cuponMaximoParejo({ precio: 10, materiales: 0.1, otros: 0, porcentajeMax: 0 }).cuponMaximo, 9.9);
});

test('validarLineasProducto: descripción y monto', () => {
  assert.equal(validarLineasProducto([{ ...lineaProductoVacia(), descripcion: 'Flete', monto: '0' }]), null);
  assert.match(validarLineasProducto([{ ...lineaProductoVacia(), descripcion: '', monto: '1' }]), /escribe qué es/);
  assert.match(validarLineasProducto([{ ...lineaProductoVacia(), descripcion: 'Flete', monto: '' }]), /monto/);
});

test('ida y vuelta con la base: filas → líneas editables → JSON de guardado', () => {
  const filas = [
    // Línea guardada ANTES de «usos» (sin costo_compra): su costo_unitario es lo que se compró y rinde para 1 uso.
    { id: 'b', orden: 2, categoria: 'DESCARTABLE', descripcion: 'Guantes', almacen_articulo_id: null, cantidad: '2.0000', unidad: null, costo_unitario: '0.3500', costo_compra: null, rinde: null },
    { id: 'a', orden: 1, categoria: 'INSUMO', descripcion: 'Alcohol', almacen_articulo_id: 'art-1', cantidad: '1.0000', unidad: 'uso', costo_unitario: '0.1000', costo_compra: '10.0000', rinde: '100.0000' },
  ];
  const lineas = lineasServicioDesdeFilas(filas);
  assert.deepEqual(lineas.map((l) => l.descripcion), ['Alcohol', 'Guantes']); // ordenadas por `orden`
  assert.equal(lineas[0].costoCompra, '10');
  assert.equal(lineas[0].rinde, '100');
  assert.equal(lineas[1].costoCompra, '0.35'); // línea antigua: lo guardado como costo unitario pasa a ser lo comprado
  assert.equal(lineas[1].rinde, '1');
  assert.deepEqual(lineasServicioAJson(lineas)[0], {
    categoria: 'INSUMO', descripcion: 'Alcohol', almacen_articulo_id: 'art-1', cantidad: 1, unidad: 'uso', costo_compra: 10, rinde: 100,
  });
  assert.deepEqual(lineasServicioAJson(lineas)[1], {
    categoria: 'DESCARTABLE', descripcion: 'Guantes', almacen_articulo_id: null, cantidad: 2, unidad: null, costo_compra: 0.35, rinde: 1,
  });
  const prod = lineasProductoDesdeFilas([{ id: 'p', orden: 1, categoria: 'EMPAQUE', descripcion: ' Bolsa ', monto: '0.5000' }]);
  assert.deepEqual(lineasProductoAJson(prod), [{ categoria: 'EMPAQUE', descripcion: 'Bolsa', monto: 0.5 }]);
});

test('costoPorUso: el envase entre las veces que rinde; sin rendimiento no se inventa nada', () => {
  assert.equal(costoPorUso(80, 40), 2);
  assert.equal(costoPorUso(11, 3), 3.6667);
  assert.equal(costoPorUso(80, 0), null);
  assert.equal(costoPorUso(80, ''), null);
});

test('aCentavos: redondeo comercial a centavos', () => {
  assert.equal(aCentavos(14.9985), 15);
  assert.equal(aCentavos(1.005), 1.01);
});

// ---------------------------------------------------------------------------
// Rentabilidad: periodos y lectura honesta (src/lib/rentabilidadRecompensas.js)
// ---------------------------------------------------------------------------
import {
  MUESTRA_MINIMA_COHORTE, avisoCobertura, coberturaCostos, compararCohortes, hayDeudaDeMonedas, hoyLima, porcentaje, rangoUltimosDias,
} from '../../src/lib/rentabilidadRecompensas.js';
import { valoresDeCosteoProducto, valoresDeCosteoServicio } from '../../src/lib/costeoRecompensas.js';

test('valores iniciales del borrador: sin configurar → sin líneas; configurado → líneas y confirmación', () => {
  assert.deepEqual(valoresDeCosteoServicio(null), { lineas: [] });
  assert.deepEqual(valoresDeCosteoProducto(null), { lineas: [], confirmado: false });
  const v = valoresDeCosteoProducto({ costo_confirmado: true, lineas: [{ id: 'x', orden: 1, categoria: 'OTRO', descripcion: 'a', monto: '1.0000' }] });
  assert.equal(v.confirmado, true);
  assert.equal(v.lineas[0].monto, '1');
});

test('rangoUltimosDias: incluye hoy y cuenta en días de Lima (no del navegador)', () => {
  // 2026-11-25 03:00 UTC = 2026-11-24 22:00 en Lima (UTC-5): «hoy» en Lima sigue siendo el 24.
  const ahora = new Date('2026-11-25T03:00:00Z');
  assert.equal(hoyLima(ahora), '2026-11-24');
  assert.deepEqual(rangoUltimosDias(30, ahora), { desde: '2026-10-26', hasta: '2026-11-24' });
  assert.deepEqual(rangoUltimosDias(1, ahora), { desde: '2026-11-24', hasta: '2026-11-24' });
  assert.deepEqual(rangoUltimosDias(365, new Date('2026-03-01T12:00:00Z')), { desde: '2025-03-02', hasta: '2026-03-01' });
});

test('coberturaCostos y avisoCobertura: nunca se vende un margen parcial como completo', () => {
  assert.equal(coberturaCostos({ lineas: 0, lineas_con_costo: 0 }).nivel, 'sin-ventas');
  assert.equal(coberturaCostos({ lineas: 10, lineas_con_costo: 0 }).nivel, 'ninguna');
  assert.equal(coberturaCostos({ lineas: 10, lineas_con_costo: 6 }).nivel, 'parcial');
  assert.equal(coberturaCostos({ lineas: 10, lineas_con_costo: 7 }).nivel, 'buena');
  assert.match(avisoCobertura(coberturaCostos({ lineas: 10, lineas_con_costo: 6 })), /PARCIAL/);
  assert.match(avisoCobertura(coberturaCostos({ lineas: 10, lineas_con_costo: 0 })), /costea/);
  assert.match(avisoCobertura(coberturaCostos({ lineas: 10, lineas_con_costo: 10 })), /Todas las líneas/);
  assert.match(avisoCobertura(coberturaCostos({ lineas: 10, lineas_con_costo: 9 })), /1 línea\(s\) sin costo/);
  assert.equal(coberturaCostos(undefined).nivel, 'sin-ventas'); // sin datos no revienta
});

test('compararCohortes: solo hay comparación con muestra suficiente en AMBOS grupos', () => {
  const g = (grupo, clientas) => ({ grupo, clientas });
  assert.equal(compararCohortes([]).suficiente, false);
  assert.equal(compararCohortes([g('MIEMBRAS', 50)]).suficiente, false);
  assert.equal(compararCohortes([g('MIEMBRAS', MUESTRA_MINIMA_COHORTE - 1), g('RESTO', 80)]).suficiente, false);
  assert.equal(compararCohortes([g('MIEMBRAS', MUESTRA_MINIMA_COHORTE), g('RESTO', MUESTRA_MINIMA_COHORTE)]).suficiente, true);
});

test('porcentaje y deuda de monedas', () => {
  assert.equal(porcentaje(21.43), '21.4 %');
  assert.equal(porcentaje(null), '—');
  assert.equal(hayDeudaDeMonedas({ monedas_pendientes_total: 0 }), false);
  assert.equal(hayDeudaDeMonedas({ monedas_pendientes_total: 12.5 }), true);
  assert.equal(hayDeudaDeMonedas(undefined), false);
});

// ---------------------------------------------------------------------------
// Costo de compra y usos: el sistema calcula el costo por uso (no se escribe a mano)
// ---------------------------------------------------------------------------
import { costoPorUsoLinea, motivoSinMargen, subtotalLineaServicio } from '../../src/lib/costeoRecompensas.js';

test('costoPorUsoLinea: un frasco de S/ 10 que rinde 100 usos cuesta S/ 0,10 por uso', () => {
  assert.equal(costoPorUsoLinea(linea('INSUMO', 'Alcohol 70', 1, 10, { rinde: '100' })), 0.1);
  assert.equal(costoPorUsoLinea(linea('INSUMO', 'Lima', 1, 2, { rinde: '8' })), 0.25);
  assert.equal(costoPorUsoLinea(linea('INSUMO', 'Tres', 1, 11, { rinde: '3' })), 3.6667); // 4 decimales, como la base
  assert.equal(costoPorUsoLinea(linea('INSUMO', 'Entero', 1, 3, { rinde: '' })), 3); // vacío = 1 uso
  assert.equal(costoPorUsoLinea(linea('INSUMO', 'Mal', 1, 3, { rinde: '0' })), null);
  assert.equal(costoPorUsoLinea(linea('INSUMO', 'Sin costo', 1, '', { rinde: '10' })), 0);
});

test('subtotal y totales usan el costo por uso × los usos gastados (lo de la captura: S/ 10 de alcohol ya no cuenta entero)', () => {
  const alcohol = linea('INSUMO', 'Alcohol 70', 1, 10, { rinde: '100' });
  assert.equal(subtotalLineaServicio(alcohol), 0.1);
  assert.equal(subtotalLineaServicio({ ...alcohol, cantidad: '3' }), 0.3);
  const t = totalesServicio([alcohol, linea('DESCARTABLE', 'Lima', 1, 2, { rinde: '8' })]);
  assert.equal(t.materiales, 0.35);
  // Con la receta bien costeada el servicio de S/ 10 vuelve a tener margen: Angela al 40 % → comisión 4,00; costo 4,35; cupón máx. 5,65.
  const r = resultadoPorAsistente({ precio: 10, materiales: t.materiales, otros: 0, porcentaje: 40 });
  assert.equal(r.costoDirecto, 4.35);
  assert.equal(r.margen, 5.65);
  assert.equal(r.cuponMaximo, 5.65);
});

test('motivoSinMargen: explica por qué no hay cupón (el envase contado entero) y calla cuando sí hay margen', () => {
  const sin = motivoSinMargen({ precio: 10, costoDirecto: 14, margen: -4 });
  assert.match(sin, /supera el precio/);
  assert.match(sin, /cuántos usos rinde/);
  assert.match(motivoSinMargen({ precio: 10, costoDirecto: 10, margen: 0 }), /iguala el precio/);
  assert.equal(motivoSinMargen({ precio: 10, costoDirecto: 4.35, margen: 5.65 }), null);
});
