// Verificación de la web pública para visitantes (sin sesión) contra Vite + Supabase LOCAL.
//
//   node tests/e2e/web-publica-verificacion.mjs
//
// Requisitos: Vite en http://localhost:5173 apuntando a Supabase Local (http://127.0.0.1:54321) y el
// contenedor supabase_db_WedJaiseReact (para dar de alta cuentas de personal ficticias). Cubre:
//   · visitante: abre la web, recorre lo público, no hace consultas privadas ni tiene errores de consola;
//   · rutas privadas / pantallas del POS piden login y conservan el destino;
//   · acciones que requieren cuenta (agregar al carrito) piden login;
//   · cliente: se registra, vuelve a su destino, recarga, cierra sesión y vuelve al inicio público;
//   · personal (ADMINISTRADOR, CAJERA, ASISTENTE): entra a su panel según su rol, respeta el destino
//     permitido, puede abrir «Mi perfil de clienta», volver al POS y cerrar sesión hacia el inicio público.
// Datos: solo cuentas FICTICIAS «TEST VIS …» con @test.local en la base local (nunca producción). La
// contraseña es aleatoria por ejecución y no se imprime. Toda solicitud a otro origen distinto de Vite,
// Supabase Local y Google Fonts (tipos de letra, bloqueados) se aborta.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// Por omisión Vite en desarrollo. Para el build servido bajo el prefijo de GitHub Pages:
//   WEB_PUBLICA_APP=http://localhost:4173/PosJaise node tests/e2e/web-publica-verificacion.mjs   (tras `npm run build` y `npx vite preview`)
const APP = (process.env.WEB_PUBLICA_APP || 'http://localhost:5173').replace(/\/$/, '');
const ORIGEN_APP = new URL(APP).origin;
const BASE = new URL(APP).pathname.replace(/\/$/, '');
const API = 'http://127.0.0.1:54321';
const CAPTURAS = process.env.WEB_PUBLICA_CAPTURAS || '';
const corrida = Date.now().toString(36);
const password = `Vis-${randomBytes(9).toString('base64url')}`;
if (CAPTURAS) mkdirSync(CAPTURAS, { recursive: true });

// Consultas que un visitante NO debe hacer jamás (datos personales o internos).
const PRIVADAS = [
  /\/rest\/v1\/(carrito_|notificaciones|favoritos_|citas|cita_servicios|direcciones_cliente|pedidos_web|clientes_web|clientes\b|usuarios\b|estado_negocio|config_puntos|registro_servicios|cupones|ventas|productos_vista)/,
  /\/rpc\/(mi_|mis_|usuarios_para_citas|asistentes_para_citas|reclamar_|guardar_|generar_cupon|agendar_|cancelar_|vincular_|actualizar_mi_|aplicar_codigo)/,
];

let fallos = 0;
async function paso(nombre, fn) {
  try {
    await fn();
    console.log(`PASS  ${nombre}`);
  } catch (error) {
    fallos += 1;
    console.log(`FAIL  ${nombre}\n      ${String(error.message).split('\n')[0]}`);
  }
}
function esperar(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}

// Clave PÚBLICA (anon) de la app local; sale de .env.local y solo se usa si ese archivo apunta a Supabase Local.
function claveAnonLocal() {
  const entorno = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8');
  esperar(/VITE_SUPABASE_URL=http:\/\/127\.0\.0\.1:54321/.test(entorno), '.env.local no apunta a Supabase Local');
  const clave = entorno.match(/VITE_SUPABASE_ANON_KEY=(\S+)/)?.[1];
  esperar(clave, 'falta la clave pública local');
  return clave;
}

async function llavero(contexto) {
  await contexto.route('**/*', (ruta) => {
    const url = new URL(ruta.request().url());
    const permitido = [ORIGEN_APP, 'http://127.0.0.1:54321'].includes(url.origin) || url.protocol === 'data:' || url.protocol === 'blob:';
    return permitido ? ruta.continue() : ruta.abort('blockedbyclient');
  });
}

function observar(page, registro) {
  page.on('console', (m) => {
    // ERR_BLOCKED_BY_CLIENT = la guarda de orígenes de este script (tipos de letra de Google Fonts), no un fallo de la app.
    if (m.type() !== 'error' || m.text().includes('ERR_BLOCKED_BY_CLIENT')) return;
    // GitHub Pages responde 404 real al abrir un enlace directo (public/404.html redirige a index.html): el navegador
    // deja UNA línea de consola por documento. Se cuentan aparte y se descuentan de los documentos 404 observados.
    if (/status of 404/.test(m.text())) registro.consola404 += 1;
    else registro.consola.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => registro.consola.push(`pageerror: ${String(e.message).slice(0, 200)}`));
  page.on('response', (r) => {
    const url = r.url();
    if (url.startsWith(API) && r.status() >= 400) registro.http.push(`${r.status()} ${r.request().method()} ${new URL(url).pathname}`);
    if (!url.startsWith(API) && r.status() === 404) {
      if (r.request().resourceType() === 'document') registro.documentos404 += 1;
      else registro.consola.push(`recurso 404: ${new URL(url).pathname}`);
    }
  });
  page.on('request', (r) => {
    const url = r.url();
    if (url.startsWith(API)) registro.api.push(new URL(url).pathname + new URL(url).search.slice(0, 60));
  });
}
const nuevoRegistro = () => ({ consola: [], consola404: 0, documentos404: 0, http: [], api: [] });

// Alta de cuenta de PERSONAL ficticia: signUp por la API pública + fila en «usuarios» (solo base local).
async function altaPersonal(rol, ficha) {
  const email = `vis-${ficha}-${corrida}@test.local`;
  const claveAnon = claveAnonLocal();
  const respuesta = await fetch(`${API}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: claveAnon },
    body: JSON.stringify({ email, password }),
  });
  const cuerpo = await respuesta.json();
  const id = cuerpo?.user?.id ?? cuerpo?.id;
  esperar(respuesta.ok && id, `no se pudo crear la cuenta ficticia (${respuesta.status})`);
  const sql = `insert into public.usuarios (id, email, nombre_completo, rol, activo) values ('${id}', '${email}', 'TEST VIS ${ficha} ${corrida}', '${rol}', true);`;
  execFileSync('docker', ['exec', '-i', 'supabase_db_WedJaiseReact', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
  return { email, id };
}

async function iniciarSesionPorFormulario(page, email) {
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /^Ingresar$/ }).click();
}

const navegador = await chromium.launch();
try {
  // ======================= VISITANTE (sin sesión) =======================
  const ctxVisita = await navegador.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', locale: 'es-PE' });
  await llavero(ctxVisita);
  const visita = await ctxVisita.newPage();
  const regVisita = nuevoRegistro();
  observar(visita, regVisita);

  await paso('URL principal sin sesión muestra la web (no el login)', async () => {
    await visita.goto(`${APP}/`);
    await visita.waitForURL(/\/inicio$/);
    esperar(!/\/login/.test(visita.url()), 'terminó en el login');
    await visita.getByRole('link', { name: 'Iniciar sesión' }).first().waitFor();
    await visita.getByRole('link', { name: 'Crear cuenta' }).first().waitFor();
    esperar((await visita.getByRole('button', { name: 'Menú de cuenta' }).count()) === 0, 'muestra el menú de la cuenta a un visitante');
    esperar((await visita.getByRole('link', { name: 'Tu carrito' }).count()) === 0, 'muestra el carrito a un visitante');
    esperar((await visita.getByRole('button', { name: 'Notificaciones' }).count()) === 0, 'muestra notificaciones a un visitante');
    await visita.waitForLoadState('networkidle');
    if (CAPTURAS) await visita.screenshot({ path: `${CAPTURAS}/visitante-inicio-escritorio.png` });
  });

  let rutaServicio = null;
  let rutaProducto = null;
  let rutaProductoConStock = null;
  let rutaEquipo = null;
  await paso('páginas públicas cargan sin sesión: servicios, productos, nosotros, recompensas', async () => {
    for (const ruta of ['/servicios', '/productos', '/nosotros', '/recompensas', '/recompensas?seccion=tarjeta']) {
      await visita.goto(`${APP}${ruta}`);
      await visita.waitForLoadState('networkidle');
      esperar(!/\/login/.test(visita.url()), `${ruta} redirigió al login`);
      esperar(visita.url().includes(ruta.split('?')[0]), `${ruta} cambió de ruta: ${visita.url()}`);
    }
    await visita.goto(`${APP}/servicios`);
    await visita.waitForLoadState('networkidle');
    const hS = await visita.locator('a[href*="/servicios/"]').first().getAttribute('href');
    esperar(hS, 'no hay enlaces a detalle de servicio (¿catálogo vacío para visitantes?)');
    rutaServicio = hS.replace(BASE, '');
    await visita.goto(`${APP}/productos`);
    await visita.waitForLoadState('networkidle');
    const hP = await visita.locator('a[href*="/productos/"]').first().getAttribute('href');
    esperar(hP, 'no hay enlaces a detalle de producto');
    rutaProducto = hP.replace(BASE, '');
    // Para la prueba de «agregar al carrito» se necesita un producto con stock (uno agotado no ofrece la acción).
    const conStock = await fetch(`${API}/rest/v1/productos?select=id&activo=eq.true&stock_actual=gt.0&limit=1`, { headers: { apikey: claveAnonLocal(), Authorization: `Bearer ${claveAnonLocal()}` } });
    const filaStock = (await conStock.json())?.[0];
    esperar(filaStock?.id, 'no hay un producto activo con stock en la base local');
    rutaProductoConStock = `/productos/${filaStock.id}`;
    await visita.goto(`${APP}/nosotros`);
    await visita.waitForLoadState('networkidle');
    const hE = await visita.locator('a[href*="/nosotros/equipo/"]').first().getAttribute('href').catch(() => null);
    rutaEquipo = hE ? hE.replace(BASE, '') : null;
  });

  await paso('detalles públicos (servicio, producto, equipo) abren sin sesión y se pueden recargar', async () => {
    for (const ruta of [rutaServicio, rutaProducto, rutaEquipo].filter(Boolean)) {
      await visita.goto(`${APP}${ruta}`);
      await visita.waitForLoadState('networkidle');
      esperar(visita.url().endsWith(ruta), `${ruta} no se quedó en su ruta: ${visita.url()}`);
      await visita.reload();
      await visita.waitForLoadState('networkidle');
      esperar(visita.url().endsWith(ruta), `${ruta} cambió de ruta tras recargar: ${visita.url()}`);
      esperar((await visita.locator('main').innerText()).trim().length > 40, `${ruta} quedó vacía`);
    }
    if (CAPTURAS) await visita.screenshot({ path: `${CAPTURAS}/visitante-detalle-producto.png` });
  });

  await paso('el visitante no hace consultas privadas, ni recibe errores HTTP ni de consola', async () => {
    const privadas = regVisita.api.filter((p) => PRIVADAS.some((rx) => rx.test(p)));
    esperar(privadas.length === 0, `consultas privadas: ${[...new Set(privadas)].join(', ')}`);
    esperar(regVisita.http.length === 0, `respuestas HTTP con error: ${[...new Set(regVisita.http)].join(', ')}`);
    esperar(regVisita.consola.length === 0, `errores de consola: ${[...new Set(regVisita.consola)].join(' | ')}`);
    esperar(regVisita.consola404 <= regVisita.documentos404, `${regVisita.consola404} 404 en consola y solo ${regVisita.documentos404} documentos 404 que los expliquen`);
  });

  await paso('rutas privadas piden login y la pantalla del POS también', async () => {
    for (const ruta of ['/mi-perfil', '/historial', '/citas', '/citas/carrito', '/carrito', '/mis-resenas', '/mi-perfil/pedidos', '/mi-perfil/direcciones', '/mi-perfil/notificaciones', '/mi-perfil/seguridad', '/mi-perfil/referidos', '/ventas', '/dashboard']) {
      await visita.goto(`${APP}${ruta}`);
      await visita.waitForURL(/\/login$/);
      await visita.getByText('Necesitas una cuenta para continuar').waitFor();
    }
  });

  await paso('acción que requiere cuenta (agregar al carrito) pide login', async () => {
    await visita.goto(`${APP}${rutaProductoConStock}`);
    await visita.waitForLoadState('networkidle');
    await visita.getByRole('button', { name: /agregar al carrito/i }).first().click();
    await visita.waitForURL(/\/login$/);
  });

  await paso('rutas desconocidas del visitante vuelven al inicio', async () => {
    await visita.goto(`${APP}/ruta-que-no-existe`);
    await visita.waitForURL(/\/inicio$/);
  });

  // ---- Móvil
  await paso('móvil: encabezado con «Iniciar sesión» y menú con «Crear cuenta»', async () => {
    const ctxMovil = await navegador.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block', locale: 'es-PE' });
    await llavero(ctxMovil);
    const movil = await ctxMovil.newPage();
    await movil.goto(`${APP}/`);
    await movil.waitForURL(/\/inicio$/);
    await movil.getByRole('link', { name: 'Iniciar sesión' }).first().waitFor();
    await movil.getByRole('button', { name: 'Abrir menú' }).click();
    await movil.getByRole('link', { name: 'Crear cuenta' }).last().waitFor();
    await movil.waitForLoadState('networkidle');
    await movil.waitForTimeout(600);
    if (CAPTURAS) await movil.screenshot({ path: `${CAPTURAS}/visitante-movil-menu.png` });
    await ctxMovil.close();
  });
  await ctxVisita.close();

  // ======================= CLIENTE =======================
  const ctxCliente = await navegador.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', locale: 'es-PE' });
  await llavero(ctxCliente);
  const cliente = await ctxCliente.newPage();
  observar(cliente, nuevoRegistro());
  const emailCliente = `vis-cliente-${corrida}@test.local`;

  await paso('cliente: se registra desde una ruta privada, vuelve a ella y conserva la web', async () => {
    await cliente.goto(`${APP}/mi-perfil`);
    await cliente.waitForURL(/\/login$/);
    await cliente.getByRole('button', { name: 'Regístrate' }).click();
    await cliente.locator('#email').fill(emailCliente);
    await cliente.locator('#password').fill(password);
    await cliente.locator('#password-confirmar').fill(password);
    await cliente.getByRole('button', { name: /^Crear cuenta$/ }).click();
    await cliente.waitForURL(/\/mi-perfil$/, { timeout: 20000 });
    await cliente.getByRole('button', { name: 'Menú de cuenta' }).waitFor();
    esperar((await cliente.getByRole('link', { name: 'Iniciar sesión' }).count()) === 0, 'el cliente aún ve «Iniciar sesión»');
  });

  await paso('cliente: recargar una ruta privada conserva el comportamiento correcto', async () => {
    await cliente.reload();
    await cliente.waitForLoadState('networkidle');
    esperar(/\/mi-perfil$/.test(cliente.url()), `tras recargar quedó en ${cliente.url()}`);
    await cliente.getByRole('button', { name: 'Menú de cuenta' }).waitFor();
  });

  await paso('cliente: sus pantallas personales abren y el POS no (/ventas vuelve al inicio)', async () => {
    for (const ruta of ['/historial', '/citas', '/mi-perfil/notificaciones']) {
      await cliente.goto(`${APP}${ruta}`);
      await cliente.waitForLoadState('networkidle');
      esperar(cliente.url().endsWith(ruta), `${ruta} no abrió: ${cliente.url()}`);
    }
    await cliente.goto(`${APP}/ventas`);
    await cliente.waitForURL(/\/inicio$/);
  });

  await paso('cliente: «Iniciar sesión» ya con sesión desde /login lo lleva a la web', async () => {
    await cliente.goto(`${APP}/login`);
    await cliente.waitForURL(/\/inicio$/);
  });

  await paso('cliente: cerrar sesión vuelve al inicio público', async () => {
    await cliente.getByRole('button', { name: 'Menú de cuenta' }).click();
    await cliente.getByRole('button', { name: 'Cerrar sesión' }).click();
    await cliente.getByRole('button', { name: 'Sí, cerrar sesión' }).click();
    await cliente.waitForURL(/\/inicio$/, { timeout: 20000 });
    await cliente.getByRole('link', { name: 'Iniciar sesión' }).first().waitFor();
    await cliente.reload();
    await cliente.waitForLoadState('networkidle');
    esperar(/\/inicio$/.test(cliente.url()), 'tras recargar sin sesión salió de /inicio');
    await cliente.goto(`${APP}/mi-perfil`);
    await cliente.waitForURL(/\/login$/);
  });

  await paso('cliente: iniciar sesión por formulario respeta el destino guardado', async () => {
    await iniciarSesionPorFormulario(cliente, emailCliente);
    await cliente.waitForURL(/\/mi-perfil$/, { timeout: 20000 });
  });
  await ctxCliente.close();

  // ======================= PERSONAL =======================
  const cuentas = {
    ADMINISTRADOR: await altaPersonal('ADMINISTRADOR', 'admin'),
    CAJERA: await altaPersonal('CAJERA', 'cajera'),
    ASISTENTE: await altaPersonal('ASISTENTE', 'asistente'),
  };
  for (const [rol, cuenta] of Object.entries(cuentas)) {
    const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', locale: 'es-PE' });
    await llavero(ctx);
    const p = await ctx.newPage();
    observar(p, nuevoRegistro());

    await paso(`${rol}: login directo entra a su panel, no a la web`, async () => {
      await p.goto(`${APP}/login`);
      await iniciarSesionPorFormulario(p, cuenta.email);
      await p.waitForURL((u) => !/\/(login|inicio)$/.test(u.pathname), { timeout: 20000 });
      const ruta = new URL(p.url()).pathname.replace(BASE, '');
      const esperada = rol === 'ASISTENTE' ? '/mi-panel' : '/ventas';
      esperar(ruta === esperada, `${rol} llegó a ${ruta} (esperaba ${esperada})`);
      await p.getByRole('button', { name: 'Menú de usuario' }).waitFor();
    });

    await paso(`${rol}: recargar el panel conserva el POS`, async () => {
      await p.reload();
      await p.waitForLoadState('networkidle');
      await p.getByRole('button', { name: 'Menú de usuario' }).waitFor();
    });

    await paso(`${rol}: puede abrir «Mi perfil de clienta» y volver al POS`, async () => {
      await p.getByRole('button', { name: 'Menú de usuario' }).click();
      await p.getByRole('button', { name: /Mi perfil de clienta/ }).click();
      await p.getByRole('button', { name: 'Menú de cuenta' }).waitFor({ timeout: 20000 });
      await p.getByRole('button', { name: 'Menú de cuenta' }).click();
      await p.getByRole('button', { name: /Volver al POS/ }).click();
      await p.getByRole('button', { name: 'Menú de usuario' }).waitFor();
    });

    await paso(`${rol}: cerrar sesión desde el POS vuelve al inicio público`, async () => {
      await p.getByRole('button', { name: 'Menú de usuario' }).click();
      await p.getByRole('button', { name: /^Cerrar sesión$/ }).click();
      await p.getByRole('button', { name: 'Sí, cerrar sesión' }).click();
      await p.waitForURL(/\/inicio$/, { timeout: 20000 });
      await p.getByRole('link', { name: 'Iniciar sesión' }).first().waitFor();
    });

    await paso(`${rol}: abrir una pantalla del POS sin sesión y entrar lleva a ella si su rol la permite`, async () => {
      await p.goto(`${APP}/inventario`);
      await p.waitForURL(/\/login$/);
      await iniciarSesionPorFormulario(p, cuenta.email);
      await p.waitForURL((u) => !/\/login$/.test(u.pathname), { timeout: 20000 });
      const ruta = new URL(p.url()).pathname.replace(BASE, '');
      const esperada = rol === 'ASISTENTE' ? '/mi-panel' : '/inventario';
      esperar(ruta === esperada, `${rol} llegó a ${ruta} (esperaba ${esperada})`);
    });
    await ctx.close();
  }
} finally {
  await navegador.close();
}

console.log(fallos === 0 ? '\nTODO CORRECTO' : `\n${fallos} verificación(es) con fallo`);
process.exit(fallos === 0 ? 0 : 1);
