// Playwright del ENSAYO DE LANZAMIENTO (compatibilidad frontend/backend). Aparte de playwright.qa.config.mjs (QA, fija a 5173/54321)
// y de playwright.ensayo.config.mjs (ensayo de Recompensas). FRONT_PORT = 5273 (frontend de main) | 5274 (frontend de testing),
// servidos por tests/e2e/ensayo-servir-front.mjs contra la instancia desechable. No toca QA ni producción.
import { defineConfig } from 'playwright/test';

const puerto = process.env.FRONT_PORT ?? '5273';
export default defineConfig({
  testDir: './tests/e2e/ensayo-ui',
  testMatch: '**/lanzamiento*.ensayo.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 120_000,
  expect: { timeout: 12_000 },
  outputDir: './tests/e2e/artifacts-ensayo',
  reporter: [['line'], ['json', { outputFile: `./tests/e2e/results-ensayo/lanzamiento-reporte-${process.env.ESCENARIO ?? puerto}.json` }]],
  use: {
    baseURL: `http://localhost:${puerto}`,
    browserName: 'chromium', headless: true, viewport: { width: 1280, height: 900 },
    timezoneId: 'America/Lima', locale: 'es-PE', serviceWorkers: 'block',
    screenshot: 'only-on-failure', trace: 'off', video: 'off', actionTimeout: 10_000, navigationTimeout: 20_000,
  },
});
