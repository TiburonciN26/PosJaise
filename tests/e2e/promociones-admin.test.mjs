// QA-061 — prueba del ARNÉS con dobles en memoria (sin navegador, sin base de datos): comprobación previa de la lista cerrada de
// qa-005-promociones-antiguas.mjs. Las filas son datos ficticios; no se lee ni se modifica QA.
//
//   node --test tests/e2e/promociones-admin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendientesDeLaLista } from './promociones-admin.mjs';

const OBJETIVO = [
  { id: 'id-a', titulo: 'TEST ficticia A' },
  { id: 'id-b', titulo: 'TEST ficticia B' },
];

test('todas presentes con su título: devuelve solo las que siguen activas', () => {
  const filas = [
    { id: 'id-a', titulo: 'TEST ficticia A', activo: true },
    { id: 'id-b', titulo: 'TEST ficticia B', activo: false },
  ];
  assert.deepEqual(pendientesDeLaLista(OBJETIVO, filas).map((f) => f.id), ['id-a']);
});

test('todas inactivas: nada pendiente (camino idempotente de --aplicar)', () => {
  const filas = OBJETIVO.map((o) => ({ ...o, activo: false }));
  assert.deepEqual(pendientesDeLaLista(OBJETIVO, filas), []);
});

test('registro ausente: aborta sin escribir', () => {
  assert.throws(() => pendientesDeLaLista(OBJETIVO, [{ id: 'id-a', titulo: 'TEST ficticia A', activo: true }]),
    /id-b no existe, está repetida o su título no coincide; se aborta sin escribir/);
});

test('registro repetido en lo leído: aborta sin escribir (no elige uno)', () => {
  const filas = [
    { id: 'id-a', titulo: 'TEST ficticia A', activo: true },
    { id: 'id-a', titulo: 'TEST ficticia A', activo: true },
    { id: 'id-b', titulo: 'TEST ficticia B', activo: true },
  ];
  assert.throws(() => pendientesDeLaLista(OBJETIVO, filas), /id-a no existe, está repetida/);
});

test('título distinto (aunque lo contenga): aborta sin escribir', () => {
  const filas = [
    { id: 'id-a', titulo: 'TEST ficticia A extendida', activo: true },
    { id: 'id-b', titulo: 'TEST ficticia B', activo: true },
  ];
  assert.throws(() => pendientesDeLaLista(OBJETIVO, filas), /id-a .*su título no coincide/);
});

test('filas ajenas a la lista no se devuelven aunque estén activas', () => {
  const filas = [
    ...OBJETIVO.map((o) => ({ ...o, activo: false })),
    { id: 'id-ajena', titulo: 'Otra activa', activo: true },
  ];
  assert.deepEqual(pendientesDeLaLista(OBJETIVO, filas), []);
});
