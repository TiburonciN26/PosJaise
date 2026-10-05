// Playwright de la vía de ENSAYO (instancia desechable «JaiseEnsayo»). Aparte de playwright.qa.config.mjs, que sigue fijo a QA.
// La app debe estar servida por un Vite de ensayo en el puerto 5273 con VITE_SUPABASE_URL = http://127.0.0.1:56321 (solo entorno
// del proceso). Cada spec comprueba antes de actuar que la app y la base son las del ensayo.
import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './tests/e2e/ensayo-ui',
  testMatch: '**/*.ensayo.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  outputDir: './tests/e2e/artifacts-ensayo',
  reporter: [['line'], ['json', { outputFile: './tests/e2e/results-ensayo/results.json' }]],
  use: {
    baseURL: 'http://localhost:5273',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    timezoneId: 'America/Lima',
    locale: 'es-PE',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
});
