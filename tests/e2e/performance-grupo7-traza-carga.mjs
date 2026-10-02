// uso: node traza-carga.mjs <dirBuild> <puerto> [limitado]
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
const require = createRequire('C:/WedJaiseReact/package.json')
const { chromium } = require('playwright')
const { password } = await import(pathToFileURL('C:/WedJaiseReact/tests/e2e/fixtures/accounts.mjs').href)
const data = JSON.parse(readFileSync('C:/WedJaiseReact/tests/e2e/fixtures/runtime.json', 'utf8'))
const [dir, puerto, limitado] = process.argv.slice(2)
const srv = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', dir, '--port', puerto, '--strictPort', '--host', '127.0.0.1', '--base', '/PosJaise/'], { cwd: 'C:/WedJaiseReact', stdio: 'ignore' })
const base = `http://127.0.0.1:${puerto}/PosJaise`
for (let i = 0; i < 40; i++) { try { const r = await fetch(base + '/'); if (r.ok) break } catch {} await new Promise((r) => setTimeout(r, 250)) }
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
const page = await ctx.newPage()
if (limitado) { const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 }); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }) }
await page.goto(base + '/login'); await page.getByLabel('Correo', { exact: true }).waitFor()
await page.getByLabel('Correo', { exact: true }).fill(data.clientEmail); await page.getByLabel('Contraseña', { exact: true }).fill(password)
const t0 = Date.now(); const log = []
page.on('request', (r) => { const u = r.url(); if (u.includes('/assets/') && u.endsWith('.js') || u.includes('/rest/v1/') || u.includes('/auth/v1/')) log.push({ t: Date.now() - t0, ev: 'ini', u: u.split('/').slice(-2).join('/').slice(0, 60) }) })
page.on('requestfinished', (r) => { const u = r.url(); if (u.includes('/assets/') && u.endsWith('.js') || u.includes('/rest/v1/') || u.includes('/auth/v1/')) log.push({ t: Date.now() - t0, ev: 'fin', u: u.split('/').slice(-2).join('/').slice(0, 60) }) })
await page.getByRole('button', { name: 'Entrar', exact: true }).click()
await page.getByRole('button', { name: /Menú de (usuario|cuenta)/ }).waitFor({ timeout: 60000 })
log.push({ t: Date.now() - t0, ev: '*** MENÚ VISIBLE', u: '' })
await page.waitForLoadState('networkidle')
for (const l of log) console.log(String(l.t).padStart(5), l.ev.padEnd(16), l.u)
await browser.close(); srv.kill()
