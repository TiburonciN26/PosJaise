// QA-053 — pruebas EN MEMORIA de la limpieza del aporte del test histórico (conAporteLimpiado / limpiarAporteAtencion).
// No tocan ninguna base: el ejecutor SQL es un doble que guarda filas (clienta, atención) y interpreta solo los dos SQL que emite
// el helper (DELETE y SELECT count con el filtro por clienta y atención). Así se comprueba también que el filtro es el propio.
//
//   node --test tests/e2e/recompensas-fase2-limpieza.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { conAporteLimpiado, limpiarAporteAtencion } from './recompensas-fase2-helpers.mjs';

const C1 = '11111111-1111-4111-8111-111111111111';
const A1 = '22222222-2222-4222-8222-222222222222';
const C2 = '33333333-3333-4333-8333-333333333333'; // aporte ajeno
const A2 = '44444444-4444-4444-8444-444444444444';
const propio = { clienteId: C1, atencionId: A1 };

const par = (sql) => ({ c: sql.match(/cliente_id = '([^']+)'/)?.[1], a: sql.match(/registro_servicio_id = '([^']+)'/)?.[1] });

// Doble del ejecutor. opciones: deleteFalla (devuelve ok:false y NO borra), noBorra (ok:true pero no borra: deja residuo),
// verificarFalla (el SELECT devuelve ok:false).
function doble(filas, { deleteFalla = false, noBorra = false, verificarFalla = false } = {}) {
  const llamadas = [];
  const ejecutor = async (sql) => {
    llamadas.push(sql);
    const { c, a } = par(sql);
    if (/^\s*delete\b/i.test(sql)) {
      if (deleteFalla) return { ok: false, out: '', err: 'ERROR: simulado\nlinea 2' };
      if (!noBorra) for (let i = filas.length - 1; i >= 0; i--) if (filas[i].c === c && filas[i].a === a) filas.splice(i, 1);
      return { ok: true, out: '', err: '' };
    }
    if (/^\s*select count/i.test(sql)) {
      if (verificarFalla) return { ok: false, out: '', err: 'ERROR: sin conexión' };
      return { ok: true, out: String(filas.filter((f) => f.c === c && f.a === a).length), err: '' };
    }
    throw new Error('SQL inesperado en el doble: ' + sql);
  };
  return { ejecutor, llamadas };
}
const filasIniciales = () => [{ c: C1, a: A1 }, { c: C2, a: A2 }];

describe('QA-053 · limpieza del aporte del test histórico (dobles en memoria)', () => {
  test('caso exitoso: elimina su aporte, verifica que no queda y no toca el ajeno', async () => {
    const filas = filasIniciales();
    const { ejecutor, llamadas } = doble(filas);
    let corrio = false;
    await conAporteLimpiado(propio, async () => { corrio = true; }, ejecutor);
    assert.ok(corrio);
    assert.deepEqual(filas, [{ c: C2, a: A2 }]);
    assert.equal(llamadas.length, 2, 'un DELETE y una verificación');
    assert.match(llamadas[0], /delete from public\.recompensas_apertura_aportes where cliente_id = '1{8}-1{4}-4111-8111-1{12}' and registro_servicio_id = '2{8}-2{4}-4222-8222-2{12}';/);
  });

  test('una aserción falla: igualmente limpia y se conserva el error ORIGINAL (el mismo objeto)', async () => {
    const filas = filasIniciales();
    const { ejecutor } = doble(filas);
    const original = new assert.AssertionError({ message: 'esperado 5, obtenido 4' });
    await assert.rejects(
      conAporteLimpiado(propio, async () => { throw original; }, ejecutor),
      (e) => e === original,
    );
    assert.deepEqual(filas, [{ c: C2, a: A2 }], 'limpió pese al fallo');
  });

  test('el DELETE devuelve ok:false: la prueba falla claramente (aunque el cuerpo haya pasado)', async () => {
    const { ejecutor } = doble(filasIniciales(), { deleteFalla: true });
    await assert.rejects(
      conAporteLimpiado(propio, async () => {}, ejecutor),
      /Falló el DELETE de limpieza del aporte: ERROR: simulado/,
    );
  });

  test('la verificación encuentra un aporte residual: la prueba falla', async () => {
    const filas = filasIniciales();
    const { ejecutor } = doble(filas, { noBorra: true });
    await assert.rejects(
      conAporteLimpiado(propio, async () => {}, ejecutor),
      /Quedó 1 aporte\(s\) residual\(es\) de la clienta 1{8}-1{4}-4111-8111-1{12} y la atención/,
    );
  });

  test('la verificación no puede ejecutarse (ok:false): también falla, no se da por limpio', async () => {
    const { ejecutor } = doble(filasIniciales(), { verificarFalla: true });
    await assert.rejects(conAporteLimpiado(propio, async () => {}, ejecutor), /No se pudo verificar la limpieza del aporte: ERROR: sin conexión/);
  });

  test('fallan la prueba Y la limpieza: se informan ambas causas', async () => {
    const { ejecutor } = doble(filasIniciales(), { deleteFalla: true });
    const original = new Error('esperado 5, obtenido 4');
    await assert.rejects(
      conAporteLimpiado(propio, async () => { throw original; }, ejecutor),
      (e) => {
        assert.ok(e instanceof AggregateError);
        assert.equal(e.errors.length, 2);
        assert.equal(e.errors[0], original);
        assert.match(e.errors[1].message, /Falló el DELETE de limpieza/);
        assert.match(e.message, /esperado 5, obtenido 4/);
        assert.match(e.message, /Falló el DELETE de limpieza/);
        return true;
      },
    );
  });

  test('un aporte ajeno queda intacto (también cuando la limpieza falla o deja residuo)', async () => {
    for (const opciones of [{}, { deleteFalla: true }, { noBorra: true }]) {
      const filas = filasIniciales();
      const { ejecutor } = doble(filas, opciones);
      await conAporteLimpiado(propio, async () => {}, ejecutor).catch(() => {});
      assert.ok(filas.some((f) => f.c === C2 && f.a === A2), 'el aporte ajeno sigue: ' + JSON.stringify(opciones));
    }
  });

  test('identificadores no válidos se rechazan ANTES de ejecutar SQL (sin filtros amplios ni inyección)', async () => {
    const filas = filasIniciales();
    const { ejecutor, llamadas } = doble(filas);
    for (const malo of [{ clienteId: "x' or '1'='1", atencionId: A1 }, { clienteId: C1, atencionId: undefined }, { clienteId: '', atencionId: A1 }]) {
      await assert.rejects(limpiarAporteAtencion(malo, ejecutor), /identificadores no válidos/);
    }
    assert.equal(llamadas.length, 0);
    assert.equal(filas.length, 2);
  });
});
