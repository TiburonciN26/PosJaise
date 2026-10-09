// Verifica un preview (local o *.pages.dev) contra el Supabase de STAGING con las cuentas QA ficticias
// de .env.staging.local. Uso: node scripts/verificar-preview-staging.cjs <origen> [salida.json]
// Login por la UI real (formulario), luego rutas por URL directa + recarga, y cierre de sesión.
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '..')
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'))
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env.staging.local'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const origen = process.argv[2]
const salida = process.argv[3] || path.join(ROOT, 'docs/evidencia-rendimiento/fase-2/preview-staging.json')
if (!origen) { console.error('Falta <origen>'); process.exit(2) }
const rutasAdmin = [...fs.readFileSync(path.join(ROOT, 'src/config/navegacion.js'), 'utf8').matchAll(/path: '([^']+)'/g)].map((m) => m[1])
const informe = { origen, supabase: env.VITE_SUPABASE_URL, fecha: new Date().toISOString(), login: {}, rutas: [], peticionesSupabase: {}, errores: [] }
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

async function login(browser, rol) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  const hosts = {}
  page.on('request', (r) => { try { const h = new URL(r.url()).host; if (/supabase|127\.0\.0\.1:54321/.test(h)) hosts[h] = (hosts[h] || 0) + 1 } catch {} })
  await page.goto(`${origen}/login`, { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').first().fill(env[`QA_${rol}_EMAIL`])
  await page.locator('input[type="password"]').first().fill(env[`QA_${rol}_PASSWORD`])
  await page.locator('button[type="submit"]').first().click()
  await page.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 20000 }).catch(() => {})
  await dormir(1500)
  informe.login[rol] = { ruta: new URL(page.url()).pathname, sesion: await page.evaluate(() => Object.keys(localStorage).some((k) => k.includes('auth-token'))) }
  return { ctx, page, hosts }
}

async function main() {
  const browser = await chromium.launch({ headless: true })
  try {
    for (const rol of ['ADMIN', 'CAJERA', 'CLIENTE']) {
      const { ctx, page, hosts } = await login(browser, rol)
      const rutas = rol === 'ADMIN' ? rutasAdmin : rol === 'CAJERA' ? ['/ventas', '/historial', '/auditoria'] : ['/inicio', '/servicios', '/productos', '/recompensas']
      for (const r of rutas) {
        const fallos = []; const errs = []
        const f = (x) => { if (x.url().startsWith(origen) && x.status() >= 400) fallos.push(`${x.status()} ${x.url().replace(origen, '')}`) }
        page.on('response', f); page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 100)))
        await page.goto(origen + r, { waitUntil: 'networkidle' })
        await dormir(400)
        const a = await page.evaluate(() => ({ ruta: location.pathname, contenido: (document.getElementById('root')?.innerText ?? '').trim().length > 20 }))
        await page.reload({ waitUntil: 'networkidle' })
        const b = await page.evaluate(() => location.pathname)
        page.off('response', f)
        informe.rutas.push({ rol, pedida: r, final: a.ruta, trasRecarga: b, contenido: a.contenido, fallosHttp: fallos, errores: errs })
      }
      informe.peticionesSupabase[rol] = hosts
      await ctx.close()
    }
    // sin sesión: rutas públicas
    const ctx = await browser.newContext(); const p = await ctx.newPage()
    for (const r of ['/inicio', '/productos', '/servicios', '/ruta-que-no-existe']) { await p.goto(origen + r, { waitUntil: 'networkidle' }); informe.rutas.push({ rol: 'PUBLICO', pedida: r, final: await p.evaluate(() => location.pathname), contenido: await p.evaluate(() => (document.getElementById('root')?.innerText ?? '').trim().length > 20), fallosHttp: [], errores: [] }) }
    const man = await (await ctx.request.get(origen + '/manifest.webmanifest')).json()
    informe.manifest = { start_url: man.start_url, scope: man.scope }
    await ctx.close()
  } catch (e) { informe.errores.push(String(e.message)) } finally {
    await browser.close()
    fs.writeFileSync(salida, JSON.stringify(informe, null, 2))
    const malas = informe.rutas.filter((r) => !r.contenido || r.fallosHttp.length || r.errores.length)
    console.log(`rutas=${informe.rutas.length} problemas=${malas.length} login=${JSON.stringify(informe.login)} hosts=${JSON.stringify(informe.peticionesSupabase)} errores=${informe.errores.length}`)
    if (malas.length) console.log(JSON.stringify(malas.slice(0, 4)))
  }
}
main()
