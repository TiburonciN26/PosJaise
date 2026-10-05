// La app, Auth, REST y SQL apuntan a la MISMA base donde se ejecutó la apertura (no basta con usar el puerto de la instancia).
import { test, expect } from 'playwright/test';
import { R, verificarEntorno, sesion, tabla, sqlJson, loginUI, soloRedDelEnsayo } from './ayuda.mjs';
import { ejecutarEnsayo } from '../ensayo-destino.mjs';

test('Auth, REST, SQL y la app usan la base donde se ejecutó la apertura; la base «transicion» no la tiene', async ({ request, page, context }) => {
  const bases = await verificarEntorno(request);
  expect(bases).toEqual({ auth: 'postgres', rest: 'postgres', sql: 'postgres' });

  // La apertura (modo definitivo) está en ESTA base.
  const ap = await sqlJson(`select json_build_object('aperturas', (select count(*) from public.recompensas_movimientos where tipo='APERTURA'),
    'activo', (select activo from public.recompensas_config), 'corte', (select to_char(corte at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"') from public.recompensas_config))`);
  expect(ap.aperturas).toBeGreaterThan(2000);
  expect(ap.activo).toBe(true);
  expect(ap.corte > '2026-10-05T04:32:53Z', 'el corte definitivo es posterior al corte del ensayo, que no se reutilizó').toBe(true);

  // Canario: existe en Auth (login), en REST (admin), en SQL «postgres» y NO en «transicion».
  const canario = await sesion(request, R.canario.email);
  expect(canario.uid).toBe(R.canario.uid);
  const admin = await sesion(request, R.cuentas.ADMINISTRADOR);
  const enRest = await tabla(request, admin.token, `clientes?select=id&nombre=eq.${encodeURIComponent(R.canario.nombre)}`);
  expect(enRest.status).toBe(200);
  expect(enRest.cuerpo).toHaveLength(1);
  const enTransicion = await ejecutarEnsayo('transicion', `select count(*) from public.clientes where nombre='${R.canario.nombre}'`);
  expect(enTransicion.out).toBe('0');

  // La interfaz: toda la red del navegador queda restringida al ensayo y el ADMIN ve el canario en pantalla.
  await soloRedDelEnsayo(context);
  const bloqueadas = [];
  page.on('requestfailed', (r) => { if (r.failure()?.errorText === 'net::ERR_BLOCKED_BY_CLIENT') bloqueadas.push(new URL(r.url()).origin); });
  const atendidos = new Set(); // orígenes que SÍ recibieron una respuesta
  page.on('response', (r) => atendidos.add(new URL(r.url()).origin));
  await loginUI(page, R.cuentas.ADMINISTRADOR);
  await page.goto('/clientes');
  await page.locator('input[type="search"]').first().fill(R.canario.nombre);
  await expect(page.getByText(R.canario.nombre, { exact: false }).first()).toBeVisible();
  expect([...atendidos].filter((o) => o.startsWith('http')).sort()).toEqual(['http://127.0.0.1:56321', 'http://localhost:5273']);
  // Lo único que la guarda bloquea son los tipos de letra de Google Fonts (recurso estático, sin datos).
  expect([...new Set(bloqueadas)].filter((o) => !/^https:\/\/fonts\.(googleapis|gstatic)\.com$/.test(o))).toEqual([]);
});
