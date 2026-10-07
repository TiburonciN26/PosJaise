// QA-077 — prueba aislada (sin base ni navegador) de la decisión sobre los botones del catálogo público: debe FALLAR si uno solo
// queda habilitado, si la lista está vacía o si la carga es parcial.
//   node --test tests/e2e/catalogo-publico-botones.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluarBotones } from './catalogo-publico-botones.mjs';

const todosBloqueados = (n) => Array.from({ length: n }, () => true);

describe('QA-077 · evaluarBotones', () => {
  test('643 botones, todos deshabilitados: pasa', () => {
    assert.deepEqual(evaluarBotones(todosBloqueados(643), 643), { total: 643, habilitados: 0, deshabilitados: 643 });
  });
  test('un botón habilitado entre 643 (en cualquier posición): falla', () => {
    for (const i of [0, 321, 642]) {
      const estados = todosBloqueados(643);
      estados[i] = false;
      assert.throws(() => evaluarBotones(estados, 643), /1 de 643 botones .* habilitados/, `posición ${i}`);
    }
  });
  test('varios habilitados: los cuenta', () => {
    const estados = todosBloqueados(10);
    estados[1] = estados[2] = false;
    assert.throws(() => evaluarBotones(estados, 10), /2 de 10/);
  });
  test('lista vacía no es éxito (falso positivo)', () => {
    assert.throws(() => evaluarBotones([], 0), /sin filas de MONEDAS/);
    assert.throws(() => evaluarBotones([], 5), /Carga incompleta/);
  });
  test('carga parcial no es éxito', () => {
    assert.throws(() => evaluarBotones(todosBloqueados(100), 643), /100 botones .* 643/);
  });
  test('más botones de los esperados (filas de SELLOS mezcladas) tampoco pasa', () => {
    assert.throws(() => evaluarBotones(todosBloqueados(739), 643), /Carga incompleta/);
  });
  test('un valor que no es booleano verdadero cuenta como habilitado', () => {
    assert.throws(() => evaluarBotones([true, undefined, true], 3), /1 de 3/);
  });
});
