// Prueba (sin Docker ni base de datos) de que el aplicador de migraciones del ensayo se detiene si falla el registro de la
// versión o si ésta no queda registrada. Ejecutar: node --test tests/e2e/ensayo-aplicar-migraciones.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { aplicarEnOrden } from './ensayo-aplicar-migraciones-nucleo.mjs';

const archivos = ['20261002000001_a.sql', '20261002000002_b.sql', '20261002000003_c.sql'];
function montaje({ falla = {} } = {}) {
  const llamadas = []; const registradas = new Set();
  return {
    llamadas,
    acciones: {
      aplicar: async (f) => { llamadas.push(['aplicar', f]); return falla.aplicar === f ? { ok: false, error: 'boom' } : { ok: true }; },
      registrar: async (v) => {
        llamadas.push(['registrar', v]);
        if (falla.registrar === v) return { ok: false, error: 'permiso denegado' };
        if (falla.silencioso !== v) registradas.add(v);
        return { ok: true };
      },
      versionRegistrada: async (v) => registradas.has(v),
    },
  };
}

test('camino feliz: aplica, registra y verifica las tres', async () => {
  const m = montaje();
  const filas = await aplicarEnOrden(archivos, m.acciones);
  assert.equal(filas.length, 3);
  assert.ok(filas.every((f) => f.ok && f.paso === 'completa'));
});

test('si falla el INSERT en schema_migrations, se detiene y no toca la siguiente', async () => {
  const m = montaje({ falla: { registrar: '20261002000002' } });
  const filas = await aplicarEnOrden(archivos, m.acciones);
  assert.equal(filas.length, 2);
  assert.equal(filas[0].ok, true);
  assert.equal(filas[1].ok, false);
  assert.equal(filas[1].paso, 'registrar');
  assert.match(filas[1].error, /no se pudo registrar la versión 20261002000002/);
  assert.ok(!m.llamadas.some(([, x]) => x === '20261002000003_c.sql'), 'no debe aplicar la tercera');
});

test('si el INSERT «tiene éxito» pero la versión no queda registrada, se detiene', async () => {
  const m = montaje({ falla: { silencioso: '20261002000001' } });
  const filas = await aplicarEnOrden(archivos, m.acciones);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].ok, false);
  assert.equal(filas[0].paso, 'verificar');
  assert.match(filas[0].error, /no quedó registrada/);
});

test('si falla la migración, no intenta registrarla y se detiene', async () => {
  const m = montaje({ falla: { aplicar: '20261002000001_a.sql' } });
  const filas = await aplicarEnOrden(archivos, m.acciones);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].paso, 'aplicar');
  assert.ok(!m.llamadas.some(([k]) => k === 'registrar'));
});
