import { test, expect } from './fixtures.mjs';
import { login } from './helpers.mjs';

// QA-086 y cambio de tema del POS (ThemeContext.alternarTema). Sesiones reales por el login normal,
// Supabase Local TEST (las guardas de fixtures.mjs: rama testing, red solo local). Sin mocks de Auth,
// sin sleeps, sin force ni clics por JavaScript: las activaciones son Espacio real sobre el switch
// enfocado (isTrusted) y las esperas son el fin REAL de cada View Transition (o el retiro de la
// clase .cambiando-tema en el flujo de respaldo). Cero pageerror en todos los casos.
//
// El único código de página que se inyecta es una GRABADORA PASIVA (addInitScript) que delega en la
// API original y no toca las promesas `ready`/`updateCallbackDone` (adjuntarles un manejador
// ocultaría el rechazo «Transition was skipped», que es justo lo que este caso debe poder ver):
//   · cuenta llamadas a startViewTransition y en qué orden corren sus callbacks,
//   · cuenta transiciones terminadas (finished),
//   · cuenta cuántas veces se añadió la clase .cambiando-tema al <html>.

const CLAVE = 'pos-jaise-tema';
const ESPERADO = {
  oscuro: { meta: '#0d0d0d', checked: 'true', etiqueta: 'Cambiar a tema claro' },
  claro: { meta: '#f5f4f1', checked: 'false', etiqueta: 'Cambiar a tema oscuro' },
};
const alternar = (tema, pulsaciones) => (pulsaciones % 2 ? (tema === 'oscuro' ? 'claro' : 'oscuro') : tema);

async function prepararPagina(page, { inicio, sinApi = false, movimientoReducido = false }) {
  await page.emulateMedia({ reducedMotion: movimientoReducido ? 'reduce' : 'no-preference' });
  await page.addInitScript(
    ([clave, tema, sinApi]) => {
      // Solo una PREFERENCIA de interfaz (no una sesión): se fija si aún no hay una guardada, para que
      // sobreviva a recargas dentro del mismo contexto sin pisar lo que elija la app.
      if (localStorage.getItem(clave) === null) localStorage.setItem(clave, tema);
      const q = { llamadas: 0, callbacks: 0, terminadas: 0, orden: [], clasesAgregadas: 0 };
      window.__qaTema = q;
      const original = document.startViewTransition;
      if (sinApi) {
        document.startViewTransition = undefined;
      } else if (typeof original === 'function') {
        document.startViewTransition = function (callback) {
          q.llamadas += 1;
          const n = q.llamadas;
          q.orden.push(['llamada', n, q.callbacks]); // [evento, nº de llamada, callbacks ya ejecutados]
          const envuelto =
            typeof callback === 'function'
              ? () => {
                  q.callbacks += 1;
                  q.orden.push(['callback', n]);
                  return callback();
                }
              : callback;
          const transicion = original.call(document, envuelto);
          transicion.finished.then(
            () => { q.terminadas += 1; },
            () => { q.terminadas += 1; },
          );
          return transicion;
        };
      }
      let activa = false;
      new MutationObserver(() => {
        const ahora = document.documentElement.classList.contains('cambiando-tema');
        if (ahora && !activa) q.clasesAgregadas += 1;
        activa = ahora;
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
    },
    [CLAVE, inicio, sinApi],
  );
  const errores = [];
  page.on('pageerror', (error) => errores.push(error.message));
  return errores;
}

async function abrirSwitch(page) {
  const menu = page.getByRole('button', { name: /Menú de (usuario|cuenta)/ });
  const interruptor = page.getByRole('switch');
  if (!(await interruptor.isVisible())) await menu.click();
  await expect(interruptor).toBeVisible();
  await interruptor.focus();
  return interruptor;
}

async function pulsar(page, veces) {
  for (let i = 0; i < veces; i += 1) await page.keyboard.press('Space');
}

// Fin REAL: toda View Transition iniciada ya terminó (finished) y, en el respaldo, la clase temporal ya se retiró.
async function esperarFin(page, { esperaLlamadas }) {
  await page.waitForFunction(
    ([n]) => {
      const q = window.__qaTema;
      if (n) return q.llamadas === n && q.terminadas === n && q.callbacks === n;
      return !document.documentElement.classList.contains('cambiando-tema');
    },
    [esperaLlamadas],
  );
}

async function camposCoherentes(page, esperado) {
  const e = ESPERADO[esperado];
  const interruptor = await abrirSwitch(page);
  await expect(page.locator('html')).toHaveAttribute('data-tema', esperado);
  await expect(page.locator('html')).not.toHaveClass(/cambiando-tema/);
  await expect(interruptor).toHaveAttribute('aria-checked', e.checked);
  await expect(interruptor).toHaveAttribute('aria-label', e.etiqueta);
  expect(await page.evaluate((c) => localStorage.getItem(c), CLAVE), 'localStorage').toBe(esperado);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', e.meta);
}

async function recargaConserva(page, esperado) {
  await page.reload();
  await page.getByRole('button', { name: /Menú de (usuario|cuenta)/ }).waitFor();
  await camposCoherentes(page, esperado);
}

const grabadora = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__qaTema)));

test.describe('Tema del POS: View Transitions', () => {
  for (const inicio of ['oscuro', 'claro']) {
    for (const pulsaciones of [1, 2, 3, 4]) {
      test(`${pulsaciones} pulsación(es) seguidas desde ${inicio}: tema, campos coherentes y recarga`, async ({ page, data }) => {
        const errores = await prepararPagina(page, { inicio });
        await login(page, 'ADMINISTRADOR', data);
        expect(await page.evaluate(() => typeof document.startViewTransition), 'el caso exige View Transitions').toBe('function');
        await abrirSwitch(page);
        await pulsar(page, pulsaciones);
        await esperarFin(page, { esperaLlamadas: pulsaciones });
        const esperado = alternar(inicio, pulsaciones);
        await camposCoherentes(page, esperado);
        const q = await grabadora(page);
        expect(q.llamadas).toBe(pulsaciones);
        expect(q.callbacks, 'cada activación ejecuta su callback, aunque la transición se salte').toBe(pulsaciones);
        expect(q.clasesAgregadas, 'con View Transitions no se usa .cambiando-tema').toBe(0);
        await recargaConserva(page, esperado);
        expect(errores, 'cero pageerror').toEqual([]);
      });
    }

    test(`doble pulsación antes del primer callback desde ${inicio}: vuelve a ${inicio}, y una acción posterior invierte`, async ({ page, data }) => {
      const errores = await prepararPagina(page, { inicio });
      await login(page, 'ADMINISTRADOR', data);
      await abrirSwitch(page);
      await pulsar(page, 2);
      await esperarFin(page, { esperaLlamadas: 2 });
      // Precondición del caso: la 2.ª llamada ocurrió ANTES de que corriera el callback de la 1.ª. Si no, esto no
      // ejercita la carrera y debe fallar como entorno, no pasar en falso.
      const q = await grabadora(page);
      const segunda = q.orden.find((evento) => evento[0] === 'llamada' && evento[1] === 2);
      expect(segunda, 'se registró la 2.ª llamada').toBeTruthy();
      expect(segunda[2], 'callbacks ya ejecutados al hacerse la 2.ª llamada').toBe(0);
      await camposCoherentes(page, inicio);
      // Una acción posterior parte del resultado vigente (no de un estado intermedio).
      await pulsar(page, 1);
      await esperarFin(page, { esperaLlamadas: 3 });
      await camposCoherentes(page, alternar(inicio, 1));
      await recargaConserva(page, alternar(inicio, 1));
      expect(errores, 'cero pageerror (incluye «Transition was skipped»)').toEqual([]);
    });
  }

  test('doble pulsación antes del primer callback con la cuenta CAJERA (mismo proveedor y switch)', async ({ page, data }) => {
    const errores = await prepararPagina(page, { inicio: 'oscuro' });
    await login(page, 'CAJERA', data);
    await abrirSwitch(page);
    await pulsar(page, 2);
    await esperarFin(page, { esperaLlamadas: 2 });
    const q = await grabadora(page);
    expect(q.orden.find((evento) => evento[0] === 'llamada' && evento[1] === 2)[2]).toBe(0);
    await camposCoherentes(page, 'oscuro');
    await recargaConserva(page, 'oscuro');
    expect(errores).toEqual([]);
  });
});

test.describe('Tema del POS: movimiento reducido y sin View Transitions', () => {
  for (const pulsaciones of [1, 2]) {
    test(`movimiento reducido, ${pulsaciones} pulsación(es): sin View Transitions ni clase temporal`, async ({ page, data }) => {
      const errores = await prepararPagina(page, { inicio: 'oscuro', movimientoReducido: true });
      await login(page, 'ADMINISTRADOR', data);
      await abrirSwitch(page);
      await pulsar(page, pulsaciones);
      const esperado = alternar('oscuro', pulsaciones);
      await esperarFin(page, { esperaLlamadas: 0 });
      await camposCoherentes(page, esperado);
      const q = await grabadora(page);
      expect(q.llamadas, 'no se llama a View Transitions').toBe(0);
      expect(q.clasesAgregadas, 'no se añade .cambiando-tema').toBe(0);
      await recargaConserva(page, esperado);
      expect(errores).toEqual([]);
    });

    test(`sin API de View Transitions, ${pulsaciones} pulsación(es): flujo de respaldo con clase temporal`, async ({ page, data }) => {
      const errores = await prepararPagina(page, { inicio: 'oscuro', sinApi: true });
      await login(page, 'ADMINISTRADOR', data);
      expect(await page.evaluate(() => typeof document.startViewTransition)).toBe('undefined');
      await abrirSwitch(page);
      await pulsar(page, pulsaciones);
      const esperado = alternar('oscuro', pulsaciones);
      await page.waitForFunction(() => window.__qaTema.clasesAgregadas >= 1);
      await esperarFin(page, { esperaLlamadas: 0 }); // la clase se retira sola (~500 ms)
      await camposCoherentes(page, esperado);
      const q = await grabadora(page);
      expect(q.llamadas).toBe(0);
      expect(q.clasesAgregadas, 'el respaldo añade la clase en cada activación').toBeGreaterThanOrEqual(1);
      await recargaConserva(page, esperado);
      expect(errores).toEqual([]);
    });
  }
});
