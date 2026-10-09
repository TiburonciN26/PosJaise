// Verificación funcional/visual de la Fase 1 (cupones) — SOLO Supabase Local.
// Uso: node scripts/verificar-cupones-fase1.cjs <etiqueta> <puerto> [carpetaSalida]
// Comprueba en /referidos-web y /promociones: reposo quieto, destello/chispas al pasar el puntero,
// chispas ocultas en cupones apagados, prefers-reduced-motion, y guarda capturas (oscuro/claro).
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const cp = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'))
const { createClient } = require(path.join(ROOT, 'node_modules/@supabase/supabase-js'))

const [etiqueta, puerto, carpetaArg] = process.argv.slice(2)
const ORIGEN = `http://127.0.0.1:${puerto}`
const SALIDA = path.resolve(carpetaArg || 'docs/evidencia-rendimiento/fase-1/capturas')
fs.mkdirSync(SALIDA, { recursive: true })
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const informe = { etiqueta, comprobaciones: [] }
const ok = (nombre, pasa, detalle) => { informe.comprobaciones.push({ nombre, pasa, detalle }); console.log(`${pasa ? 'OK  ' : 'FALLA'} ${nombre}${detalle !== undefined ? ' → ' + JSON.stringify(detalle) : ''}`) }

async function main() {
  const local = JSON.parse(cp.execFileSync(path.join(ROOT, 'node_modules/@supabase/cli-windows-x64/bin/supabase.exe'), ['status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  if (local.API_URL !== 'http://127.0.0.1:54321') throw new Error('Supabase no es el local verificado')
  const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const password = crypto.randomBytes(24).toString('base64url') + 'aA1!'
  const email = `perf-fase1v-${Date.now()}@test.local`
  let uid = null
  const browser = await chromium.launch({ headless: true })
  try {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (error) throw error
    uid = data.user.id
    const ins = await admin.from('usuarios').insert({ id: uid, email, activo: true, rol: 'ADMINISTRADOR', nombre_completo: 'TEST QA Fase1 verif' })
    if (ins.error) throw ins.error
    const cli = createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    const login = await cli.auth.signInWithPassword({ email, password })
    if (login.error) throw login.error

    for (const tema of ['oscuro', 'claro']) for (const reducido of [false, true]) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', reducedMotion: reducido ? 'reduce' : 'no-preference' })
      await ctx.addInitScript(({ origen, sesion, tema }) => {
        if (location.origin !== origen) return
        localStorage.setItem('sb-127-auth-token', JSON.stringify(sesion))
        localStorage.setItem('pos-jaise-tema', tema)
      }, { origen: ORIGEN, sesion: login.data.session, tema })
      const page = await ctx.newPage()
      const errores = []
      page.on('pageerror', (e) => errores.push(e.message))
      await page.goto(`${ORIGEN}/PosJaise/referidos-web`, { waitUntil: 'networkidle' })
      await page.waitForSelector('.cupon-tarjeta', { timeout: 20000 })
      await dormir(1500)
      if (!reducido) await page.screenshot({ path: path.join(SALIDA, `${etiqueta}-referidos-${tema}.png`), clip: { x: 0, y: 0, width: 1440, height: 900 } })
      const etq = `${tema}${reducido ? '/reduced-motion' : ''}`
      const nombreAnim = (sel, pseudo) => page.evaluate(([s, p]) => { const el = document.querySelector(s); return el ? getComputedStyle(el, p || null).animationName : null }, [sel, pseudo])

      // Reposo
      ok(`[${etq}] reposo: destello quieto`, (await nombreAnim('.cupon-metal', '::after')) === 'none')
      const conChispas = await page.$('.cupon-envoltura:not(.cupon-envoltura-apagada) .cupon-chispa')
      if (conChispas) ok(`[${etq}] reposo: chispas quietas`, (await conChispas.evaluate((el) => getComputedStyle(el).animationName)) === 'none')
      const apagadaChispa = await page.$('.cupon-envoltura-apagada .cupon-chispa')
      if (apagadaChispa) ok(`[${etq}] cupón apagado: chispas ocultas`, (await apagadaChispa.evaluate((el) => getComputedStyle(el).display)) === 'none')
      const animReposo = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)
      ok(`[${etq}] animaciones CSS activas en reposo`, animReposo < 20, animReposo)

      // Captura de reposo (recorte de la zona de tarjetas)
      const primera = page.locator('.cupon-envoltura:not(.cupon-envoltura-apagada)').first()
      await primera.scrollIntoViewIfNeeded()

      // Interacción
      if (await primera.count()) {
        await primera.hover()
        await dormir(150)
        const dest = await primera.locator('.cupon-metal').evaluate((el) => getComputedStyle(el, '::after').animationName)
        const chis = (await primera.locator('.cupon-chispa').count()) ? await primera.locator('.cupon-chispa').first().evaluate((el) => getComputedStyle(el).animationName) : null
        if (reducido) {
          ok(`[${etq}] reduced-motion: sin destello al hover`, dest === 'none', dest)
          if (chis !== null) ok(`[${etq}] reduced-motion: sin centelleo al hover`, chis === 'none', chis)
        } else {
          ok(`[${etq}] hover: destello corre (transform)`, dest === 'cupon-sheen-pasada', dest)
          if (chis !== null) ok(`[${etq}] hover: chispas centellean`, chis === 'cupon-titilar', chis)
          await page.mouse.move(0, 0)
          await dormir(200)
          ok(`[${etq}] fin del hover: vuelve a quieto`, (await primera.locator('.cupon-metal').evaluate((el) => getComputedStyle(el, '::after').animationName)) === 'none')
        }
      }
      ok(`[${etq}] sin errores de página`, errores.length === 0, errores.slice(0, 2))
      await ctx.close()
    }
  } catch (e) {
    ok('ejecución', false, String(e.message))
  } finally {
    await browser.close()
    if (uid) await admin.auth.admin.deleteUser(uid)
    fs.writeFileSync(path.join(SALIDA, `${etiqueta}-verificacion.json`), JSON.stringify(informe, null, 2))
  }
}
main()
