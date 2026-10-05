// Preparación de QA-005 — desactiva SOLO cuatro promociones TEST de corridas anteriores que siguen vigentes y compiten en Inicio con
// la promoción propia del caso. Usa el flujo NORMAL de administración (inicio de sesión de ADMINISTRADOR y /promociones → Editar →
// Inactiva → Guardar cambios), solo contra Supabase Local TEST (la app en :5173 debe apuntar a http://127.0.0.1:54321).
//
//   node tests/e2e/qa-005-promociones-antiguas.mjs            → solo informa (no escribe)
//   QA_TEST_PASSWORD=… node tests/e2e/qa-005-promociones-antiguas.mjs --aplicar
//
// Lista CERRADA por ID y título exacto (sin filtros amplios). Aborta si alguna no coincide; al terminar comprueba que solo esas
// cuatro cambiaron y que ninguna otra promoción activa se tocó.
// QA-061: en /promociones se espera a que la lista (o su estado vacío / error) cargue antes de contar (promociones-admin.mjs).
import { chromium } from 'playwright';
import * as h from './recompensas-fase2-helpers.mjs';
import { localNetworkOnly } from './local-safety.mjs';
import { localizarPromocion, pendientesDeLaLista } from './promociones-admin.mjs';

const OBJETIVO = [
  { id: '618854d9-8f7d-4f39-9878-15804da4f543', titulo: 'TEST PW mus0eq08-m2w9o Promoción' },
  { id: 'ccaf389e-114f-4e21-855b-1dbf9f409a38', titulo: 'TEST PW muvlrok5-mgra3 Promoción' },
  { id: '5c2de485-4e3c-41b5-bd1c-36b14afd898f', titulo: 'TEST PW muvowz00-qrnjd Promoción' },
  { id: 'bb4e5e0c-8c7c-4386-a3e6-fb04232bdb95', titulo: 'TEST PW muvqg7ly-buh4v Promoción Q005 muvqm83r43u' },
];
const aplicar = process.argv.includes('--aplicar');
const ids = OBJETIVO.map((o) => `'${o.id}'`).join(',');

await h.verificarLocalTest(); // rama testing + Vite :5173 → http://127.0.0.1:54321 + solo cuentas @test.local

const estado = () => h.json(`select coalesce(json_agg(json_build_object('id', id, 'titulo', titulo, 'activo', activo,
  'vigente', activo and (vigente_desde is null or vigente_desde <= (now() at time zone 'America/Lima')::date)
                      and (vigente_hasta is null or vigente_hasta >= (now() at time zone 'America/Lima')::date)) order by titulo), '[]'::json)
  from public.promociones where id in (${ids})`);
const otrasActivas = () => h.json(`select coalesce(json_agg(id order by id), '[]'::json) from public.promociones where activo and id not in (${ids})`);

const antes = await estado();
const pendientes = pendientesDeLaLista(OBJETIVO, antes); // aborta si alguna no existe o su título no coincide
console.log(JSON.stringify(antes.map(({ titulo, activo, vigente }) => ({ titulo, activo, vigente })), null, 1));
if (!aplicar || pendientes.length === 0) {
  console.log(aplicar ? 'Nada que desactivar: las cuatro ya están inactivas; no se inicia sesión ni se escribe.' : `Modo informe: ${pendientes.length} por desactivar (usa --aplicar).`);
  process.exit(0);
}
const password = process.env.QA_TEST_PASSWORD;
if (!password) throw new Error('Falta QA_TEST_PASSWORD en el entorno del proceso.');

const otrasAntes = await otrasActivas();
const navegador = await chromium.launch({ headless: true });
try {
  const contexto = await navegador.newContext({ baseURL: 'http://localhost:5173', timezoneId: 'America/Lima' });
  await localNetworkOnly(contexto);
  const page = await contexto.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto('/login');
  await page.getByLabel('Correo', { exact: true }).fill('administradortest01@test.local');
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.getByRole('button', { name: /Menú de (usuario|cuenta)/ }).waitFor();
  for (const f of pendientes) {
    await page.goto('/promociones');
    // QA-061: contar solo cuando la lista ya cargó (antes se contaba en el acto y daba 0 con la lista aún en esqueleto).
    const { fila, tarjeta } = await localizarPromocion(page, f.titulo);
    await fila.click();
    await tarjeta.getByRole('button', { name: 'Editar', exact: true }).click();
    const edicion = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Editar promoción', exact: true }) });
    await edicion.getByRole('button', { name: 'Inactiva', exact: true }).click();
    await edicion.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await edicion.waitFor({ state: 'detached' });
  }
} finally { await navegador.close(); }

const despues = await estado();
const otrasDespues = await otrasActivas();
console.log(JSON.stringify(despues.map(({ titulo, activo }) => ({ titulo, activo })), null, 1));
if (despues.some((f) => f.activo)) throw new Error('Alguna de las cuatro sigue activa.');
if (JSON.stringify(otrasAntes) !== JSON.stringify(otrasDespues)) throw new Error('Cambiaron otras promociones activas: revisar.');
console.log('Listo: solo las cuatro promociones TEST indicadas quedaron inactivas.');
