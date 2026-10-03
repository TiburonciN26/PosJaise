// Capturas en el tiempo de la entrada de los catálogos (revisión visual de la animación, QA-020).
// uso: APP_URL=http://127.0.0.1:4173 QA_TEST_PASSWORD=... node performance-grupo7-capturas.mjs <etiqueta>
// Solo Local, cuenta CLIENTE ficticia del manifest, orígenes externos bloqueados.
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const require = createRequire('C:/WedJaiseReact/package.json')
const { chromium } = require('playwright')
const { password } = await import(pathToFileURL('C:/WedJaiseReact/tests/e2e/fixtures/accounts.mjs').href)
const data = JSON.parse(readFileSync('C:/WedJaiseReact/tests/e2e/fixtures/runtime.json', 'utf8'))
const APP = process.env.APP_URL ?? 'http://localhost:5173'
const etiqueta = process.argv[2] ?? 'build'
const SALIDA = `C:/WedJaiseReact/tests/e2e/results/performance-grupo7/capturas-${etiqueta}`
mkdirSync(SALIDA, { recursive: true })
const host = new URL(APP).host.replace(/\./g, '\\.')
const externos = new RegExp(`^https?://(?!${host}|127\\.0\\.0\\.1:54321)`)
const MOMENTOS = [100, 300, 600, 900, 1300, 2000]

const browser = await chromium.launch()
for (const [nombreVp, viewport] of [['desktop', { width: 1440, height: 900 }], ['movil', { width: 390, height: 844 }]]) {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const ctx = await browser.newContext({ viewport, baseURL: APP, serviceWorkers: 'block', timezoneId: 'America/Lima', reducedMotion })
    await ctx.route(externos, (r) => r.abort())
    const page = await ctx.newPage()
    await page.goto('/login')
    await page.getByLabel('Correo', { exact: true }).fill(data.clientEmail)
    await page.getByLabel('Contraseña', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.getByRole('button', { name: /Menú de (usuario|cuenta)/ }).waitFor()
    await page.waitForLoadState('networkidle')
    for (const ruta of ['/productos', '/servicios']) {
      await page.goto('/inicio'); await page.waitForLoadState('networkidle')
      const t0 = Date.now()
      // En móvil el menú está plegado: entrada directa; en escritorio, navegación desde el menú.
      if (nombreVp === 'movil') await page.goto(ruta)
      else await page.locator(`a[href="${ruta}"]:not([tabindex="-1"])`).filter({ visible: true }).first().click()
      for (const ms of MOMENTOS) {
        const espera = ms - (Date.now() - t0)
        if (espera > 0) await page.waitForTimeout(espera)
        await page.screenshot({ path: `${SALIDA}/${nombreVp}-${reducedMotion === 'reduce' ? 'movimiento-reducido' : 'normal'}${ruta.replace('/', '-')}-${String(ms).padStart(4, '0')}ms.png` })
      }
    }
    await ctx.close()
  }
}
await browser.close()
console.log('capturas en', SALIDA)
