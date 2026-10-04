// La guarda verificarLocalTest() distingue DOS fallos y aborta de forma segura en ambos:
//  * no se pudo consultar la BD (Docker/psql no disponible) → mensaje de verificación imposible;
//  * la BD respondió y hay cuentas que no son @test.local → mensaje de «no es el TEST local».
// No se debilita ninguna guarda: ambas ramas lanzan antes de escribir nada.
//   node --test tests/e2e/recompensas-fase2-guarda.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { interpretarVerificacion } from './recompensas-fase2-helpers.mjs';

test('Docker caído (consulta fallida) → aborta con mensaje de verificación imposible, no de cuentas', () => {
  assert.throws(
    () => interpretarVerificacion({ ok: false, out: '', err: 'spawn docker ENOENT' }),
    (e) => /No se pudo verificar la base local/.test(e.message) && !/no son @test\.local/.test(e.message),
  );
});

test('la BD responde con cuentas no ficticias → aborta con mensaje de «no es el TEST local»', () => {
  assert.throws(
    () => interpretarVerificacion({ ok: true, out: '3', err: '' }),
    (e) => /3 cuenta\(s\) que no son @test\.local/.test(e.message) && !/Docker/.test(e.message),
  );
});

test('respuesta inesperada → aborta', () => {
  for (const out of ['', 'error', '0 rows', '-1']) {
    assert.throws(() => interpretarVerificacion({ ok: true, out, err: '' }), /Respuesta inesperada/);
  }
});

test('solo «0» cuentas no ficticias deja continuar', () => {
  assert.doesNotThrow(() => interpretarVerificacion({ ok: true, out: '0', err: '' }));
});

test('proceso real sin Docker en el PATH: llega a la verificación y aborta con el mensaje de Docker', () => {
  // PATH solo con la carpeta de git: la guarda de rama pasa, pero `docker` no existe.
  const donde = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['git'], { encoding: 'utf8' });
  const gitDir = dirname(donde.stdout.split(String.fromCharCode(10))[0].trim());
  const r = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `
      import * as h from './tests/e2e/recompensas-fase2-helpers.mjs';
      try { await h.verificarLocalTest(); console.log('CONTINUO'); }
      catch (e) { console.log('ABORTA: ' + e.message); }
    `],
    { env: { ...process.env, PATH: gitDir }, encoding: 'utf8', timeout: 30000 },
  );
  const salida = `${r.stdout}${r.stderr}`;
  assert.doesNotMatch(salida, /CONTINUO/);
  assert.match(salida, /ABORTA: No se pudo verificar la base local/);
  assert.doesNotMatch(salida, /no son @test\.local/);
});
