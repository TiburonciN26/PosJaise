import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.mjs',
  // QA-056: la vía de ENSAYO (instancia desechable, :5273/:56321, playwright.ensayo.config.mjs) NO se recoge aquí; sus specs
  // cargan ayudas y credenciales propias (ENSAYO_PASSWORD) y abortarían la suite de QA.
  testIgnore: ['**/ensayo-ui/**', '**/*.ensayo.spec.mjs', '**/*.ensayo.mjs'],
  globalSetup: './tests/e2e/global-setup.mjs',
  globalTeardown: './tests/e2e/global-teardown.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: './tests/e2e/artifacts',
  reporter: [
    ['line'],
    ['json', { outputFile: './tests/e2e/results/results.json' }],
    ['html', { outputFolder: './tests/e2e/results/html', open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:5173',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    timezoneId: 'America/Lima',
    locale: 'es-PE',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    // Traces/HAR include Auth tokens. Prefer sanitized diagnostics and screenshots.
    trace: 'off',
    video: 'off',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
});
