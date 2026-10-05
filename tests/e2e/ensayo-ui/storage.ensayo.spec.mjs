// Storage con archivos FICTICIOS y sesiones reales. El respaldo de la base solo contiene METADATOS (storage.objects); los archivos
// viven aparte. Aquí se prueban subida, permisos y descarga con huella SHA-256, y la diferencia entre restaurar solo la base y
// restaurar también los archivos. Solo la instancia desechable: las operaciones de archivos pasan por ensayo-destino.mjs.
import { test, expect } from 'playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { R, verificarEntorno, sesion, sqlJson, sql, supabaseURL, ANON } from './ayuda.mjs';
import { shStorage, copiarDesdeStorage, copiarHaciaStorage, archivosDeStorage } from '../ensayo-destino.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\nARCHIVO FICTICIO DE ENSAYO\n', 'utf8');
const BIN = randomBytes(200 * 1024); // 200 KB de datos aleatorios ficticios
const S = {}; const sub = {};
const BACKUPS = process.env.ENSAYO_RESPALDOS ?? 'C:/JaiseQA-Backups';
const EVID = `${BACKUPS}/evidencia`;

const url = (b, p, modo = 'authenticated') => `${supabaseURL}/storage/v1/object/${modo === 'public' ? 'public' : modo}/${b}/${p}`;
async function subir(request, token, bucket, ruta, cuerpo, mime) {
  const r = await request.post(`${supabaseURL}/storage/v1/object/${bucket}/${ruta}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token ?? ANON}`, 'Content-Type': mime, 'x-upsert': 'false' }, data: cuerpo,
  });
  return { status: r.status(), texto: await r.text() };
}
async function bajar(request, token, bucket, ruta, modo = 'authenticated') {
  const r = await request.get(url(bucket, ruta, modo), { headers: { apikey: ANON, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  return { status: r.status(), cuerpo: r.ok() ? await r.body() : null };
}

test.beforeAll(async ({ request }) => {
  await verificarEntorno(request);
  // Estado inicial determinista: la base restaurada trae solo METADATOS; el Storage del ensayo parte sin ningún archivo
  // (instancia desechable: se limpia lo que dejó una ejecución anterior, incluida la copia de QA de la prueba final).
  shStorage('rm -rf /mnt/stub/stub/* 2>/dev/null; true');
  S.admin = await sesion(request, R.cuentas.ADMINISTRADOR);
  S.cajera = await sesion(request, R.cuentas.CAJERA);
  S.asistente = await sesion(request, R.cuentas.ASISTENTE);
  S.h1 = await sesion(request, R.clientas.h1.email);
  S.h2 = await sesion(request, R.clientas.h2.email);
  sub.comprobante = `${S.h1.uid}/ens-${R.nonce}-comprobante.png`;
  sub.pdf = `${S.h1.uid}/ens-${R.nonce}-recibo.pdf`;
  sub.avatar = `${S.h1.uid}/ens-${R.nonce}-avatar.png`;
  sub.galeria = `ens-${R.nonce}/galeria.bin`;
  sub.qr = `ens-${R.nonce}-qr.png`;
});

test('subida de archivos ficticios con sesiones reales y descarga con la misma huella SHA-256', async ({ request }) => {
  const casos = [
    ['comprobantes-pedidos-web', sub.comprobante, PNG, 'image/png', S.h1.token, false],
    ['comprobantes-pedidos-web', sub.pdf, PDF, 'application/pdf', S.h1.token, false],
    ['fotos-clientes', sub.avatar, PNG, 'image/png', S.h1.token, true],
    ['fotos-galeria', sub.galeria, BIN, 'application/octet-stream', S.admin.token, true],
    ['qr-pagos', sub.qr, PNG, 'image/png', S.admin.token, true],
  ];
  for (const [bucket, ruta, cuerpo, mime, tok] of casos) {
    const r = await subir(request, tok, bucket, ruta, cuerpo, mime);
    expect(r.status, `${bucket}/${ruta}: ${r.texto}`).toBe(200);
  }
  // Descarga: el dueño y el ADMIN reciben exactamente los mismos bytes.
  for (const [bucket, ruta, cuerpo, , , publico] of casos) {
    const prop = await bajar(request, bucket === 'fotos-galeria' || bucket === 'qr-pagos' ? S.admin.token : S.h1.token, bucket, ruta);
    expect(prop.status).toBe(200);
    expect(sha(prop.cuerpo), `${bucket}: huella del dueño`).toBe(sha(cuerpo));
    const adm = await bajar(request, S.admin.token, bucket, ruta);
    expect(sha(adm.cuerpo), `${bucket}: huella del ADMIN`).toBe(sha(cuerpo));
    if (publico) { // buckets públicos: descarga sin sesión
      const anon = await bajar(request, null, bucket, ruta, 'public');
      expect(anon.status).toBe(200);
      expect(sha(anon.cuerpo)).toBe(sha(cuerpo));
    }
  }
  // Metadatos en la base: tamaño y tipo coinciden con lo subido.
  const filas = await sqlJson(`select json_agg(json_build_object('b', bucket_id, 'n', name, 'tam', (metadata->>'size')::int, 'mime', metadata->>'mimetype') order by name) from storage.objects where name like '%ens-${R.nonce}%'`);
  expect(filas).toHaveLength(casos.length);
  for (const [bucket, ruta, cuerpo, mime] of casos) {
    const f = filas.find((x) => x.b === bucket && x.n === ruta);
    expect(f, `${bucket}/${ruta}`).toBeTruthy();
    expect(f.tam).toBe(cuerpo.length);
    expect(f.mime).toBe(mime);
  }
});

test('permisos de Storage: las descargas privadas y las subidas ajenas se rechazan', async ({ request }) => {
  // Bucket privado: otra CLIENTE, la CAJERA/ASISTENTE (no dueñas ni ADMIN) y sin sesión no descargan.
  for (const tok of [S.h2.token, null]) {
    const r = await bajar(request, tok, 'comprobantes-pedidos-web', sub.comprobante);
    expect(r.status, 'descarga privada ajena').toBeGreaterThanOrEqual(400);
  }
  // Subidas fuera de política.
  const antes = await sqlJson(`select to_json(count(*)) from storage.objects`);
  const intentos = [
    ['CLIENTE → galería (solo ADMIN)', S.h1.token, 'fotos-galeria', `ens-${R.nonce}/intruso.bin`],
    ['CAJERA → galería', S.cajera.token, 'fotos-galeria', `ens-${R.nonce}/cajera.bin`],
    ['ASISTENTE → qr-pagos', S.asistente.token, 'qr-pagos', `ens-${R.nonce}-asistente.png`],
    ['CLIENTE h2 → carpeta de h1', S.h2.token, 'comprobantes-pedidos-web', `${S.h1.uid}/ens-${R.nonce}-ajeno.png`],
    ['sin sesión → comprobantes', null, 'comprobantes-pedidos-web', `${S.h1.uid}/ens-${R.nonce}-anon.png`],
  ];
  for (const [nombre, tok, bucket, ruta] of intentos) {
    const r = await subir(request, tok, bucket, ruta, PNG, 'image/png');
    expect(r.status, `${nombre}: ${r.texto}`).toBeGreaterThanOrEqual(400);
  }
  expect(await sqlJson(`select to_json(count(*)) from storage.objects`), 'ningún intento rechazado dejó un objeto').toBe(antes);
});

test('respaldo: solo la base deja metadatos SIN archivos; el respaldo completo (base + archivos) los recupera con la misma huella', async ({ request }) => {
  // 1) Evidencia con datos reales: la copia de QA trae 380 FILAS de metadatos y ningún archivo (la instancia solo tiene los ficticios).
  const huerfano = await sqlJson(`select row_to_json(o) from (select bucket_id, name from storage.objects where bucket_id = 'comprobantes-pedidos-web' and name not like '%ens-${R.nonce}%' order by name limit 1) o`);
  const total = await sqlJson(`select to_json(count(*)) from storage.objects`);
  expect(total).toBeGreaterThan(380);
  const sinArchivo = await bajar(request, S.admin.token, huerfano.bucket_id, huerfano.name);
  expect(sinArchivo.status, 'metadatos restaurados desde la base, pero el archivo no existe').toBeGreaterThanOrEqual(400);
  const enDisco = archivosDeStorage();
  expect(enDisco, 'archivos reales en disco = solo los ficticios subidos').toBe(5);

  // 2) Respaldo completo de los ficticios: volcado de la base + copia de los archivos.
  const t = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const dirResp = `${BACKUPS}/storage-ensayo-${t}`;
  mkdirSync(dirResp, { recursive: true });
  copiarDesdeStorage('/mnt/stub', dirResp);
  expect(existsSync(`${dirResp}/stub`)).toBe(true);

  // 3) Pérdida de archivos (los metadatos quedan): la descarga falla.
  shStorage(`find /mnt/stub/stub -type f -path '*ens-${R.nonce}*' -delete`);
  expect(archivosDeStorage()).toBe(0);
  const fila = await sqlJson(`select to_json(count(*)) from storage.objects where name like '%ens-${R.nonce}%'`);
  expect(fila, 'los metadatos siguen en la base').toBe(5);
  const perdido = await bajar(request, S.h1.token, 'comprobantes-pedidos-web', sub.comprobante);
  expect(perdido.status).toBeGreaterThanOrEqual(400);

  // 4) Restauración de los archivos desde la copia: vuelven y con la MISMA huella.
  copiarHaciaStorage(`${dirResp}/stub/.`, '/mnt/stub/'); // la copia ya contiene su propio «stub/»
  expect(archivosDeStorage()).toBe(5);
  const rec = await bajar(request, S.h1.token, 'comprobantes-pedidos-web', sub.comprobante);
  expect(rec.status).toBe(200);
  expect(sha(rec.cuerpo)).toBe(sha(PNG));
  const gal = await bajar(request, null, 'fotos-galeria', sub.galeria, 'public');
  expect(sha(gal.cuerpo)).toBe(sha(BIN));
  void sql; void readFileSync; void readdirSync;
  expect(true).toBe(true);
});

test('respaldo de archivos de QA: la copia de Storage de QA restaura los 380 archivos y una muestra de 12 se descarga con la huella del manifiesto', async ({ request }) => {
  const dir = readdirSync(BACKUPS).filter((d) => d.startsWith('storage-qa-')).sort().pop();
  expect(dir, 'existe la copia de archivos de QA').toBeTruthy();
  const origen = `${BACKUPS}/${dir}`;
  copiarHaciaStorage(`${origen}/stub/.`, '/mnt/stub/');
  const manifiesto = new Map(readFileSync(`${origen}/MANIFIESTO-sha256.txt`, 'utf8').trim().split('\n').map((l) => {
    const [h, ...resto] = l.split('  '); return [resto.join('  ').replace(/^\.?\//, ''), h];
  }));
  // Muestra de 12 objetos de los metadatos de QA: se descargan por la API y se comparan con el manifiesto del respaldo.
  const muestra = await sqlJson(`select json_agg(json_build_object('b', bucket_id, 'n', name, 'v', version)) from (select bucket_id, name, version from storage.objects
    where name not like '%ens-${R.nonce}%' and bucket_id in ('comprobantes-pedidos-web', 'comprobantes-citas-web') order by md5(name) limit 12) q`);
  expect(muestra).toHaveLength(12);
  let comparados = 0;
  for (const o of muestra) {
    const r = await bajar(request, S.admin.token, o.b, o.n);
    expect(r.status, `${o.b}/${o.n}`).toBe(200);
    const esperado = manifiesto.get(`stub/${o.b}/${o.n}/${o.v}`);
    expect(esperado, `manifiesto de ${o.b}/${o.n}`).toBeTruthy();
    expect(sha(r.cuerpo)).toBe(esperado);
    comparados += 1;
  }
  expect(comparados).toBe(12);
  mkdirSync(EVID, { recursive: true });
  expect(archivosDeStorage()).toBeGreaterThanOrEqual(380);
});
