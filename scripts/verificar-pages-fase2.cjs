// Verificación de la Fase 2 (Cloudflare Pages en raíz) — SOLO Supabase Local.
// Uso: node scripts/verificar-pages-fase2.cjs <etiqueta> <puerto> <base> [carpetaDistViva]
//   base: '/PosJaise/' (build de GitHub Pages) o '/' (build de Cloudflare).
// Con el MISMO conjunto de rutas y roles se compara el resultado de ambos builds (paridad).
// Si se da carpetaDistViva (la que sirve el servidor), además prueba el flujo de actualización PWA:
// cambia sw.js y comprueba que aparece el aviso «Hay una versión nueva de la app».
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const cp = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'))
const { createClient } = require(path.join(ROOT, 'node_modules/@supabase/supabase-js'))
const [etiqueta, puerto, base, distViva] = process.argv.slice(2)
const ORIGEN = `http://127.0.0.1:${puerto}`
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const rutasAdmin = [...fs.readFileSync(path.join(ROOT, 'src/config/navegacion.js'), 'utf8').matchAll(/path: '([^']+)'/g)].map((m) => m[1])
const rutasPublicas = ['/inicio', '/servicios', '/productos', '/nosotros', '/recompensas', '/libro-de-reclamaciones', '/terminos-y-condiciones', '/politica-de-privacidad', '/login', '/ruta-que-no-existe']
const resultado = { etiqueta, base, rutas: [], pwa: {}, errores: [] }

function url(ruta) { return `${ORIGEN}${base.replace(/\/$/, '')}${ruta}` }

async function visitar(ctx, rol, ruta) {
  const page = await ctx.newPage()
  const fallos = []
  const errores = []
  page.on('response', (r) => { if (r.url().startsWith(ORIGEN) && r.status() >= 400) fallos.push(`${r.status()} ${r.url().replace(ORIGEN, '')}`) })
  page.on('pageerror', (e) => errores.push(String(e.message).slice(0, 120)))
  // Entrada DIRECTA por URL (equivale a pegar el enlace / recargar).
  await page.goto(url(ruta), { waitUntil: 'networkidle' })
  await dormir(600)
  const info = await page.evaluate((b) => ({
    ruta: location.pathname.slice(b.length - 1) || '/',
    texto: (document.getElementById('root')?.innerText ?? '').trim().length > 20,
  }), base)
  // Recarga en la misma ruta (F5).
  await page.reload({ waitUntil: 'networkidle' })
  await dormir(400)
  const tras = await page.evaluate((b) => location.pathname.slice(b.length - 1) || '/', base)
  await page.close()
  resultado.rutas.push({ rol, pedida: ruta, final: info.ruta, trasRecarga: tras, conContenido: info.texto, fallosHttp: fallos, errores })
}

async function main() {
  const local = JSON.parse(cp.execFileSync(path.join(ROOT, 'node_modules/@supabase/cli-windows-x64/bin/supabase.exe'), ['status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  if (local.API_URL !== 'http://127.0.0.1:54321') throw new Error('Supabase no es el local verificado')
  const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const password = crypto.randomBytes(24).toString('base64url') + 'aA1!'
  const creados = []
  const sesiones = {}
  const browser = await chromium.launch({ headless: true })
  try {
    for (const rol of ['ADMINISTRADOR', 'CAJERA', 'CLIENTE']) {
      const email = `perf-f2-${rol.toLowerCase()}-${Date.now()}@test.local`
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
      if (error) throw error
      creados.push(data.user.id)
      const fila = rol === 'CLIENTE' ? { id: data.user.id, email, activo: true } : { id: data.user.id, email, activo: true, rol, nombre_completo: 'TEST QA F2 ' + rol }
      const ins = await admin.from(rol === 'CLIENTE' ? 'clientes_web' : 'usuarios').insert(fila)
      if (ins.error) throw ins.error
      const cli = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
      const login = await cli.auth.signInWithPassword({ email, password })
      if (login.error) throw login.error
      sesiones[rol] = login.data.session
    }
    const nuevoCtx = async (sesion, extra = {}) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', ...extra })
      if (sesion) await ctx.addInitScript(({ o, s }) => { if (location.origin === o) localStorage.setItem('sb-127-auth-token', JSON.stringify(s)) }, { o: ORIGEN, s: sesion })
      return ctx
    }
    // 1) Rutas POS con administrador; cajera en 3 rutas (incluye una solo-admin); público; cliente.
    let ctx = await nuevoCtx(sesiones.ADMINISTRADOR)
    for (const r of rutasAdmin) await visitar(ctx, 'ADMINISTRADOR', r)
    await ctx.close()
    ctx = await nuevoCtx(sesiones.CAJERA)
    for (const r of ['/ventas', '/historial', '/auditoria', '/dashboard']) await visitar(ctx, 'CAJERA', r)
    await ctx.close()
    ctx = await nuevoCtx(null)
    for (const r of rutasPublicas) await visitar(ctx, 'PUBLICO', r)
    await ctx.close()
    ctx = await nuevoCtx(sesiones.CLIENTE)
    for (const r of ['/inicio', '/servicios', '/productos', '/citas', '/carrito', '/mi-perfil', '/recompensas?seccion=cupones']) await visitar(ctx, 'CLIENTE', r)
    await ctx.close()

    // 2) PWA: manifest, íconos, registro del SW en el scope correcto, y aviso de actualización.
    ctx = await nuevoCtx(sesiones.ADMINISTRADOR, { serviceWorkers: 'allow' })
    const page = await ctx.newPage()
    await page.goto(url('/ventas'), { waitUntil: 'networkidle' })
    const man = await (await ctx.request.get(url('/manifest.webmanifest'))).json()
    resultado.pwa.manifest = { start_url: man.start_url, scope: man.scope }
    resultado.pwa.iconos = []
    for (const ic of man.icons) resultado.pwa.iconos.push({ src: ic.src, status: (await ctx.request.get(ORIGEN + ic.src)).status() })
    const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, activo: !!r.active } })
    resultado.pwa.sw = { scope: reg.scope.replace(ORIGEN, ''), activo: reg.activo }
    await page.reload({ waitUntil: 'networkidle' })
    resultado.pwa.controlaTrasRecargar = await page.evaluate(() => !!navigator.serviceWorker.controller)
    if (distViva) {
      const swPath = path.join(path.resolve(distViva), 'sw.js')
      const original = fs.readFileSync(swPath, 'utf8')
      try {
        fs.writeFileSync(swPath, original + `\n// build-nuevo-${Date.now()}\n`)
        await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update() })
        await page.waitForSelector('text=Hay una versión nueva de la app.', { timeout: 15000 }).then(() => { resultado.pwa.avisoActualizacion = true }).catch(() => { resultado.pwa.avisoActualizacion = false })
      } finally { fs.writeFileSync(swPath, original) }
    }
    await ctx.close()
  } catch (e) {
    resultado.errores.push(String(e.message))
    console.error(e.message)
  } finally {
    await browser.close()
    for (const id of creados) await admin.auth.admin.deleteUser(id)
    fs.mkdirSync(path.join(ROOT, 'docs/evidencia-rendimiento/fase-2'), { recursive: true })
    fs.writeFileSync(path.join(ROOT, `docs/evidencia-rendimiento/fase-2/${etiqueta}.json`), JSON.stringify(resultado, null, 2))
    console.log(`${etiqueta}: ${resultado.rutas.length} rutas, errores de ejecución: ${resultado.errores.length}`)
  }
}
main()
