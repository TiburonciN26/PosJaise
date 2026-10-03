// uso: node medir-carga.mjs <dirBuild> <puerto> <etiqueta>
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
const require = createRequire('C:/WedJaiseReact/package.json')
const { chromium } = require('playwright')
const { password, accounts } = await import(pathToFileURL('C:/WedJaiseReact/tests/e2e/fixtures/accounts.mjs').href)
const data = JSON.parse(readFileSync('C:/WedJaiseReact/tests/e2e/fixtures/runtime.json', 'utf8'))
const [dir, puerto, etiqueta] = process.argv.slice(2)
const SP = 'C:/WedJaiseReact/tests/e2e/results/performance-grupo7'
const N = Number(process.env.N ?? 3)
const srv = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', dir, '--port', puerto, '--strictPort', '--host', '127.0.0.1', '--base', '/PosJaise/'], { cwd: 'C:/WedJaiseReact', stdio: 'ignore' })
const base = `http://127.0.0.1:${puerto}/PosJaise`
for (let i = 0; i < 40; i++) { try { const r = await fetch(base + '/'); if (r.ok) break } catch {} await new Promise((r) => setTimeout(r, 250)) }
const browser = await chromium.launch()
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const res = (a) => ({ mediana: Math.round(med(a)), min: Math.round(Math.min(...a)), max: Math.round(Math.max(...a)) })

async function muestra({ limitado, usuario, esCliente }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', timezoneId: 'America/Lima' })
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1:(54321|\d+)|localhost)/, (r) => r.abort())
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  if (limitado) {
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  }
  const js = []
  page.on('requestfinished', async (rq) => { if (!rq.url().endsWith('.js') && !rq.url().includes('.js?')) return; try { const s = await rq.sizes(); js.push({ url: rq.url().split('/').pop(), enc: s.responseBodySize + s.responseHeadersSize, fase }) } catch {} })
  let fase = 'login'
  await page.addInitScript(() => { window.__fcp = null; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__fcp = e.startTime }).observe({ type: 'paint', buffered: true }) })
  await page.goto(base + '/login', { waitUntil: 'load' })
  await page.getByLabel('Correo', { exact: true }).waitFor()
  const fcp = await page.evaluate(() => window.__fcp)
  const jsLogin = js.filter((x) => x.fase === 'login')
  fase = 'post'
  await page.getByLabel('Correo', { exact: true }).fill(esCliente ? data.clientEmail : usuario)
  await page.getByLabel('Contraseña', { exact: true }).fill(password)
  const t0 = Date.now()
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.getByRole('button', { name: /Menú de (usuario|cuenta)/ }).waitFor({ timeout: 60000 })
  const tContenido = Date.now() - t0
  await page.waitForLoadState('networkidle')
  await new Promise((r) => setTimeout(r, 400))
  const jsPost = js.filter((x) => x.fase === 'post')
  const out = { fcp, loginJsBytes: jsLogin.reduce((s, x) => s + x.enc, 0), loginJsArchivos: jsLogin.length, postLoginJsBytes: jsPost.reduce((s, x) => s + x.enc, 0), postLoginJsArchivos: jsPost.length, entrarAMenuUsuarioMs: tContenido }
  await ctx.close()
  return out
}

const salida = { etiqueta, dir, N, nota: 'vite preview local, viewport 390x844, cold (contexto nuevo), serviceWorkers bloqueados; limitado = latencia 150 ms, 1.6/0.75 Mbps, CPU 4x' }
for (const limitado of [false, true]) {
  for (const [nombre, usuario, esCliente] of [['CLIENTE', null, true], ['CAJERA', accounts.CAJERA, false]]) {
    const ms = []
    for (let i = 0; i < N; i++) ms.push(await muestra({ limitado, usuario, esCliente }))
    const clave = `${nombre} · ${limitado ? 'limitado' : 'local'}`
    salida[clave] = {
      fcpLoginMs: res(ms.map((m) => m.fcp)),
      loginJsBytes: res(ms.map((m) => m.loginJsBytes)), loginJsArchivos: ms[0].loginJsArchivos,
      postLoginJsBytes: res(ms.map((m) => m.postLoginJsBytes)), postLoginJsArchivos: ms[0].postLoginJsArchivos,
      entrarAMenuUsuarioMs: res(ms.map((m) => m.entrarAMenuUsuarioMs)),
    }
    console.log(clave, JSON.stringify(salida[clave]))
  }
}
await browser.close(); srv.kill()
writeFileSync(`${SP}/carga-${etiqueta}.json`, JSON.stringify(salida, null, 2))
console.log('guardado')
