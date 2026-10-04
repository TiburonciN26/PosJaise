// QA-048: pruebas del saneador de salidas y del archivado. Solo marcadores FICTICIOS; no usa la contraseña real, ni la
// base de datos, ni la aplicación. No imprime secretos (los mensajes de aserción no incluyen el marcador).
//   node --test tests/e2e/sanear-salidas.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { sanearTexto, sanearJSONTexto, sanearAdjuntoBase64, sanearCarpetas, MARCA } from './sanear-salidas.mjs';

const FICTICIO = 'Marcador-Ficticio-Z9q7';
const OTRO = 'Otro-Ficticio-K4w2';
const contiene = (texto, valor) => texto.includes(valor);

const INLINE = `- generic [ref=e1]:\n  - textbox "Contraseña" [ref=e5]: ${FICTICIO}\n  - button "Entrar"\n`;
const MULTILINEA = `- generic [ref=e1]:\n  - textbox "Contraseña" [ref=e5]:\n    - /placeholder: ••••\n    - text: ${FICTICIO}\n  - textbox "Correo" [ref=e4]: ana@test.local\n  - button "Entrar"\n`;

for (const [nombre, snapshot] of [['en línea', INLINE], ['en varias líneas', MULTILINEA]]) {
  test(`contraseña ${nombre}: se redacta SIN variable de entorno`, () => {
    const r = sanearTexto(snapshot, '');
    assert.equal(contiene(r, FICTICIO), false, 'el marcador sigue visible');
    assert.ok(contiene(r, MARCA));
    assert.ok(contiene(r, 'button "Entrar"'), 'el resto del snapshot se conserva');
  });
  test(`contraseña ${nombre}: se redacta CON variable de entorno`, () => {
    const r = sanearTexto(snapshot, FICTICIO);
    assert.equal(contiene(r, FICTICIO), false);
    assert.ok(contiene(r, MARCA));
  });
}

test('el correo y los demás campos NO se redactan (solo el campo contraseña)', () => {
  const r = sanearTexto(MULTILINEA, '');
  assert.ok(contiene(r, 'ana@test.local'));
  assert.ok(contiene(r, '••••'));
});

test('con variable, también se redacta el secreto fuera de un snapshot (texto libre, forma JSON y forma URL)', () => {
  const secreto = 'Pa"ss Ficticio&9';
  const texto = `intento con ${secreto} y ${JSON.stringify(secreto).slice(1, -1)} y ${encodeURIComponent(secreto)}`;
  const r = sanearTexto(texto, secreto);
  assert.equal(contiene(r, secreto), false);
  assert.equal(contiene(r, encodeURIComponent(secreto)), false);
  assert.equal(contiene(r, JSON.stringify(secreto).slice(1, -1)), false);
});

test('snapshot serializado en JSON (saltos de línea escapados): se redacta con y sin variable y el JSON sigue siendo válido', () => {
  const doc = { errors: [{ message: 'falló', snapshot: MULTILINEA }], otra: INLINE, numero: 7, intacto: 'sin secretos' };
  for (const secreto of ['', FICTICIO]) {
    const crudo = JSON.stringify(doc);
    assert.ok(contiene(crudo, FICTICIO), 'precondición: el crudo trae el marcador');
    const r = sanearJSONTexto(crudo, secreto);
    assert.equal(contiene(r, FICTICIO), false);
    const obj = JSON.parse(r);
    assert.equal(obj.numero, 7);
    assert.equal(obj.intacto, 'sin secretos');
    assert.ok(contiene(obj.otra, 'button "Entrar"'));
  }
});

test('anexos de texto en base64 (md, json, texto) se redactan y los binarios quedan idénticos', () => {
  const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
  for (const tipo of ['text/markdown', 'text/plain', 'application/json']) {
    const r = sanearAdjuntoBase64(tipo, b64(MULTILINEA), '');
    assert.equal(contiene(Buffer.from(r, 'base64').toString('utf8'), FICTICIO), false, tipo);
  }
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]).toString('base64');
  assert.equal(sanearAdjuntoBase64('image/png', png, FICTICIO), png);
  const reporte = JSON.stringify({ suites: [{ tests: [{ results: [{ attachments: [{ name: 'error-context', contentType: 'text/markdown', body: b64(MULTILINEA) }] }] }] }] });
  const limpio = sanearJSONTexto(reporte, '');
  assert.equal(contiene(limpio, FICTICIO), false, 'el JSON no lleva el valor en claro');
  const cuerpo = JSON.parse(limpio).suites[0].tests[0].results[0].attachments[0].body;
  assert.equal(contiene(Buffer.from(cuerpo, 'base64').toString('utf8'), FICTICIO), false, 'ni dentro del anexo base64 decodificado');
});

test('sanearCarpetas redacta archivos de texto y JSON, conserva el resto y no toca binarios', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qa048-'));
  await mkdir(join(dir, 'sub'));
  await writeFile(join(dir, 'a.md'), MULTILINEA);
  await writeFile(join(dir, 'sub', 'b.json'), JSON.stringify({ s: INLINE, ok: 'evidencia restante' }));
  await writeFile(join(dir, 'limpio.txt'), 'nada que redactar\n');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
  await writeFile(join(dir, 'c.png'), png);
  const antes = await readFile(join(dir, 'limpio.txt'), 'utf8');
  const { revisados, modificados } = await sanearCarpetas([dir]);
  assert.equal(revisados, 3);
  assert.equal(modificados, 2);
  assert.equal(contiene(await readFile(join(dir, 'a.md'), 'utf8'), FICTICIO), false);
  const b = JSON.parse(await readFile(join(dir, 'sub', 'b.json'), 'utf8'));
  assert.equal(b.ok, 'evidencia restante');
  assert.equal(contiene(b.s, FICTICIO), false);
  assert.equal(await readFile(join(dir, 'limpio.txt'), 'utf8'), antes);
  assert.deepEqual(await readFile(join(dir, 'c.png')), png);
});

test('importar el saneador no ejecuta su CLI (no imprime ni recorre carpetas)', () => {
  const modulo = resolve('tests/e2e/sanear-salidas.mjs').replace(/\\/g, '/');
  const salida = execFileSync(process.execPath, ['--input-type=module', '-e', `import('file:///${modulo}').then(() => console.log('importado'))`], { encoding: 'utf8' });
  assert.equal(salida.trim(), 'importado');
});

test('archivado de punta a punta: report.json, index.json y los anexos archivados salen redactados y la evidencia restante se conserva', async () => {
  const base = await mkdtemp(join(tmpdir(), 'qa048-arch-'));
  const results = join(base, 'tests', 'e2e', 'results');
  await mkdir(results, { recursive: true });
  const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]);
  const reporte = {
    suites: [{
      title: 'a.spec', specs: [{
        title: 'caso uno', tests: [{
          expectedStatus: 'passed',
          results: [{ status: 'failed', attachments: [
            { name: 'error-context', contentType: 'text/markdown', body: b64(MULTILINEA) },
            { name: 'diagnostics', contentType: 'application/json', body: b64(JSON.stringify({ nota: 'ok', snap: INLINE })) },
            { name: 'captura', contentType: 'image/png', body: png.toString('base64') },
          ] }],
        }],
      }],
    }],
  };
  await writeFile(join(results, 'results.json'), JSON.stringify(reporte));
  const script = resolve('tests/e2e/archive-run.mjs');
  const entorno = { ...process.env };
  delete entorno.QA_TEST_PASSWORD; // el caso difícil: sin variable
  execFileSync(process.execPath, [script, 'corte-prueba'], { cwd: base, env: entorno, encoding: 'utf8' });
  const dir = join(results, 'phases', 'corte-prueba');
  const archivos = await readdir(dir);
  assert.ok(archivos.length >= 5, 'report, index y tres anexos');
  for (const nombre of archivos) {
    if (nombre.endsWith('.png')) {
      assert.deepEqual(await readFile(join(dir, nombre)), png, 'el binario se archiva sin cambios');
      continue;
    }
    assert.equal(contiene(await readFile(join(dir, nombre), 'utf8'), FICTICIO), false, `${nombre} trae el marcador`);
  }
  const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
  assert.equal(index.length, 1);
  const diag = archivos.find((n) => n.includes('diagnostics'));
  assert.equal(JSON.parse(await readFile(join(dir, diag), 'utf8')).nota, 'ok', 'evidencia restante conservada');
  assert.ok(contiene(await readFile(join(dir, archivos.find((n) => n.includes('error-context'))), 'utf8'), 'button "Entrar"'));
  void OTRO;
});
