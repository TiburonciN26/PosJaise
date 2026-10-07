// QA-078 — disponibilidad EFECTIVA de un cupón en la interfaz (lógica pura con dobles; sin base ni sesión). NO es evidencia de interfaz
// con sesión: ver docs/recompensas-fase2/QA-077-QA-078.md, «Pendiente con sesión».
//   node --test tests/e2e/cupones-vigencia-efectiva.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { estadoEfectivoCupon, interpretarCuponCaja } from '../../src/lib/cupones.js';

const AHORA = Date.parse('2026-10-07T12:00:00Z');
const base = { estado: 'DISPONIBLE', valor: '15', tipo_descuento: 'PORCENTAJE', clientes: { nombre: 'TEST F2' } };

describe('QA-078 · estadoEfectivoCupon', () => {
  test('vigente (fecha futura): disponible y utilizable', () => {
    assert.deepEqual(estadoEfectivoCupon({ ...base, vigente_hasta: '2026-10-08T05:00:00Z' }, AHORA), { estado: 'DISPONIBLE', utilizable: true });
  });
  test('vencido sin usar: VENCIDO y no utilizable; el límite exacto ya está vencido', () => {
    assert.deepEqual(estadoEfectivoCupon({ ...base, vigente_hasta: '2026-10-07T11:59:59Z' }, AHORA), { estado: 'VENCIDO', utilizable: false });
    assert.equal(estadoEfectivoCupon({ ...base, vigente_hasta: '2026-10-07T12:00:00Z' }, AHORA).utilizable, false);
    assert.equal(estadoEfectivoCupon({ ...base, vigente_hasta: '2026-10-07T12:00:01Z' }, AHORA).utilizable, true);
  });
  test('el `vencido` del servidor manda aunque la fecha parezca futura (reloj del equipo atrasado)', () => {
    assert.equal(estadoEfectivoCupon({ ...base, vigente_hasta: '2099-01-01T00:00:00Z', vencido: true }, AHORA).estado, 'VENCIDO');
  });
  test('sin vencimiento legítimo (null): NO se bloquea', () => {
    assert.deepEqual(estadoEfectivoCupon({ ...base, vigente_hasta: null }, AHORA), { estado: 'DISPONIBLE', utilizable: true });
    assert.equal(estadoEfectivoCupon({ ...base, vigente_hasta: null, vencido: false }, AHORA).utilizable, true);
  });
  test('campo NO consultado (undefined) es desconocido, no válido', () => {
    assert.deepEqual(estadoEfectivoCupon({ ...base }, AHORA), { estado: 'DESCONOCIDO', utilizable: false });
    // mis_cupones(): `vencido: false` calculado por el servidor equivale a vigente aunque no se pida la fecha.
    assert.equal(estadoEfectivoCupon({ ...base, vencido: false }, AHORA).utilizable, true);
  });
  test('fecha ilegible es desconocida, no válida', () => {
    assert.deepEqual(estadoEfectivoCupon({ ...base, vigente_hasta: 'no-es-fecha' }, AHORA), { estado: 'DESCONOCIDO', utilizable: false });
  });
  test('utilizados y anulados conservan su estado (aunque tengan fecha vencida o futura)', () => {
    for (const vigente_hasta of [null, '2020-01-01T00:00:00Z', '2099-01-01T00:00:00Z']) {
      assert.deepEqual(estadoEfectivoCupon({ ...base, estado: 'CANJEADO', vigente_hasta }, AHORA), { estado: 'CANJEADO', utilizable: false });
      assert.deepEqual(estadoEfectivoCupon({ ...base, estado: 'ANULADO', vigente_hasta }, AHORA), { estado: 'ANULADO', utilizable: false });
    }
  });
  test('estado ausente o raro: desconocido', () => {
    assert.equal(estadoEfectivoCupon({ vigente_hasta: null }, AHORA).utilizable, false);
    assert.equal(estadoEfectivoCupon(undefined, AHORA).utilizable, false);
    assert.equal(estadoEfectivoCupon({ estado: 'X', vigente_hasta: null }, AHORA).estado, 'DESCONOCIDO');
  });
});

describe('QA-078 · Caja: interpretarCuponCaja (dobles de la lectura de `cupones`)', () => {
  test('cupón vigente: vista previa con su descuento y sin error', () => {
    const r = interpretarCuponCaja({ data: { ...base, vigente_hasta: '2026-10-08T05:00:00Z' } }, AHORA);
    assert.deepEqual(r, { preview: { valor: 15, tipoDescuento: 'PORCENTAJE', clienteNombre: 'TEST F2' }, error: '' });
  });
  test('cupón vencido: SIN vista previa (no se anuncia 15 %, ni S/85 sobre S/100, ni se habilita el cobro) y mensaje claro con la fecha', () => {
    const r = interpretarCuponCaja({ data: { ...base, vigente_hasta: '2026-10-07T05:00:00Z' } }, AHORA);
    assert.equal(r.preview, null);
    assert.match(r.error, /^Este cupón venció el /);
  });
  test('sin vencimiento legítimo: se usa', () => {
    assert.ok(interpretarCuponCaja({ data: { ...base, vigente_hasta: null } }, AHORA).preview);
  });
  test('la lectura no trajo la vigencia: NO es válido', () => {
    const r = interpretarCuponCaja({ data: { ...base } }, AHORA);
    assert.equal(r.preview, null);
    assert.match(r.error, /vigencia/);
  });
  test('lectura fallida, código inexistente, usado y anulado: sin vista previa', () => {
    assert.equal(interpretarCuponCaja({ data: null, error: { message: 'x' } }, AHORA).preview, null);
    assert.equal(interpretarCuponCaja({ data: { ...base, vigente_hasta: null }, error: { message: 'x' } }, AHORA).preview, null, 'un error gana aunque haya datos');
    assert.equal(interpretarCuponCaja({ data: null }, AHORA).error, 'Código no encontrado');
    for (const estado of ['CANJEADO', 'ANULADO']) {
      const r = interpretarCuponCaja({ data: { ...base, estado, vigente_hasta: null } }, AHORA);
      assert.equal(r.preview, null);
      assert.equal(r.error, 'Ese cupón ya fue usado');
    }
  });
  test('nunca hay vista previa y error a la vez', () => {
    for (const vigente_hasta of [null, '2020-01-01T00:00:00Z', undefined, 'x']) {
      const r = interpretarCuponCaja({ data: { ...base, vigente_hasta } }, AHORA);
      assert.ok(Boolean(r.preview) !== Boolean(r.error));
    }
  });
});

// Consulta lenta, fallida y respuesta anterior que llega tarde: el patrón de Ventas.jsx (bandera de vigencia de la búsqueda + reinicio de la
// vista previa al cambiar el código) reproducido con dobles. Es la MISMA secuencia que el efecto; la interfaz real queda pendiente con sesión.
describe('QA-078 · Caja: lecturas lentas, fallidas y tardías (doble del efecto)', () => {
  function cajaDoble() {
    const estado = { preview: null, error: '', buscando: false };
    let generacion = 0;
    return {
      estado,
      cambiarCodigo(leer) {
        const mia = ++generacion; // el cleanup del efecto marca como no vigente la búsqueda anterior
        estado.preview = null; estado.error = ''; estado.buscando = true;
        return leer().then((resp) => {
          if (mia !== generacion) return; // respuesta anterior que llega tarde: se descarta
          estado.buscando = false;
          const { preview, error } = interpretarCuponCaja(resp, AHORA);
          estado.preview = preview;
          estado.error = error;
        });
      },
      puedeCobrar: () => Boolean(estado.preview) && !estado.buscando,
    };
  }
  const resp = (extra) => ({ data: { ...base, ...extra } });

  test('mientras la consulta está lenta no se puede cobrar con el cupón', async () => {
    const c = cajaDoble();
    let liberar;
    const lenta = c.cambiarCodigo(() => new Promise((r) => { liberar = () => r(resp({ vigente_hasta: null })); }));
    assert.equal(c.puedeCobrar(), false);
    liberar(); await lenta;
    assert.equal(c.puedeCobrar(), true);
  });
  test('una vista previa válida anterior NO sobrevive al cambiar a un código vencido', async () => {
    const c = cajaDoble();
    await c.cambiarCodigo(async () => resp({ vigente_hasta: null }));
    assert.equal(c.puedeCobrar(), true);
    const p = c.cambiarCodigo(async () => resp({ vigente_hasta: '2020-01-01T00:00:00Z' }));
    assert.equal(c.puedeCobrar(), false, 'se reinicia en cuanto cambia el código');
    await p;
    assert.equal(c.puedeCobrar(), false);
    assert.match(c.estado.error, /venció/);
  });
  test('la respuesta VIGENTE de un código anterior que llega tarde no pisa al código vencido actual', async () => {
    const c = cajaDoble();
    let liberarVieja;
    const vieja = c.cambiarCodigo(() => new Promise((r) => { liberarVieja = () => r(resp({ vigente_hasta: null })); }));
    await c.cambiarCodigo(async () => resp({ vigente_hasta: '2020-01-01T00:00:00Z' }));
    liberarVieja(); await vieja;
    assert.equal(c.estado.preview, null);
    assert.match(c.estado.error, /venció/);
  });
  test('una lectura fallida no se convierte en cupón válido', async () => {
    const c = cajaDoble();
    await c.cambiarCodigo(async () => ({ data: null, error: { message: 'red' } }));
    assert.equal(c.puedeCobrar(), false);
    assert.equal(c.estado.error, 'No se pudo verificar el cupón');
  });
});
