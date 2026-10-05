// Pruebas de la guarda de la vía de ensayo. Las de validación pura no tocan Docker; las dos últimas SÍ consultan Docker
// (solo lectura) y comprueban que QA no lleva la marca y que un destino de QA se rechaza antes de ejecutar nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  motivosDeRechazo, origenPermitido, verificarDestinoEnsayo, ejecutarEnsayo, CONTENEDOR, PUERTO_DB, PROYECTO,
} from './ensayo-destino.mjs';

const bueno = { contenedor: CONTENEDOR, base: 'transicion', etiquetaProyecto: PROYECTO, puertoPublicado: PUERTO_DB, marca: PROYECTO };

test('acepta únicamente el destino completo y correcto del ensayo', () => {
  assert.deepEqual(motivosDeRechazo(bueno), []);
});

test('rechaza el contenedor, el puerto y la etiqueta de QA', () => {
  assert.ok(motivosDeRechazo({ ...bueno, contenedor: 'supabase_db_WedJaiseReact' }).length >= 2);
  assert.ok(motivosDeRechazo({ ...bueno, puertoPublicado: 54322 }).some((x) => x.includes('QA')));
  assert.ok(motivosDeRechazo({ ...bueno, etiquetaProyecto: 'WedJaiseReact' }).length >= 1);
});

test('rechaza una base sin marca o fuera de la lista cerrada', () => {
  assert.ok(motivosDeRechazo({ ...bueno, marca: null }).some((x) => x.includes('marca')));
  assert.ok(motivosDeRechazo({ ...bueno, base: 'produccion' }).length >= 1);
  assert.ok(motivosDeRechazo({ ...bueno, base: 'otra' }).length >= 1);
});

test('orígenes de red: solo los del ensayo; los de QA se bloquean', () => {
  assert.equal(origenPermitido('http://127.0.0.1:56321'), true);
  assert.equal(origenPermitido('http://localhost:5273'), true);
  assert.equal(origenPermitido('http://127.0.0.1:54321'), false);
  assert.equal(origenPermitido('http://localhost:5173'), false);
  assert.equal(origenPermitido('https://proyecto-remoto.supabase.co'), false);
});

test('Docker: la instancia desechable pasa la guarda y QA NO tiene la marca', () => {
  verificarDestinoEnsayo('transicion');
  const enQA = execFileSync('docker', ['exec', 'supabase_db_WedJaiseReact', 'psql', '-U', 'postgres', '-At', '-c',
    `select to_regclass('ensayo_marker.destino') is null`], { encoding: 'utf8' }).trim();
  assert.equal(enQA, 't');
});

test('una base no permitida se rechaza SIN ejecutar SQL', async () => {
  await assert.rejects(() => ejecutarEnsayo('qa_simulada', 'create table x();'), /RECHAZADO/);
});
