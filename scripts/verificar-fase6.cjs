// Verificación funcional de la Fase 6 (caché de pantallas, conservación de estado, pausa de animaciones, TarjetaPuntos / FondoNivel,
// máscara de Inicio e invalidación por cuenta) sobre un build servido (vite preview) y el Supabase LOCAL.
//   node scripts/verificar-fase6.cjs --app=http://localhost:5196 --cuentas=<json admin/adminB/clienteA> [--salida=<archivo.json>]
//
// Cuentas FICTICIAS del Supabase local (127.0.0.1:54321). Para la tarjeta de puntos se vincula la cuenta clienteA con una clienta
// «QA F6 Alfa» que se BORRA al terminar (también si algo falla). El resto es solo lectura salvo el carrito de la caja, que vive en
// memoria del navegador.
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const arg = (n, d = '') => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').slice(n.length + 3) || d
const APP = arg('app')
const SALIDA = arg('salida') && path.resolve(arg('salida'))
const SOLO = arg('solo')
const CUENTAS = arg('cuentas') && JSON.parse(fs.readFileSync(path.resolve(arg('cuentas')), 'utf8'))
if (!APP || !CUENTAS) { console.error('uso: --app=<url> --cuentas=<json>'); process.exit(2) }
const API = 'http://127.0.0.1:54321'
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]))
if (env.VITE_SUPABASE_URL !== API) { console.error(`.env.local no apunta a ${API}: no se ejecuta.`); process.exit(2) }
const puertos = execFileSync('docker', ['ps', '--filter', 'name=^supabase_kong_WedJaiseReact$', '--format', '{{.Ports}}'], { encoding: 'utf8' })
if (!/:54321->8000\/tcp/.test(puertos)) { console.error('54321 no es la pila WedJaiseReact'); process.exit(2) }
const sql = (c) => execFileSync('docker', ['exec', '-i', 'supabase_db_WedJaiseReact', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { input: c, encoding: 'utf8' }).trim()
const lit = (t) => `'${String(t).replace(/'/g, "''")}'`

const MAX = 6 // MAX_PANTALLAS_MONTADAS (src/components/PestanasCacheadas.jsx)
const RUTAS = ['/ventas', '/inventario', '/historial', '/servicios', '/dashboard', '/mi-panel', '/citas', '/estadisticas', '/auditoria', '/clientes', '/deudas', '/porcentajes', '/gastos', '/asistentes', '/mobiliario', '/web', '/promociones', '/pedidos-web', '/resenas-web', '/contacto-web', '/puntos-web', '/referidos-web', '/fidelizacion-web', '/recompensas-web', '/catalogo-web', '/libro-reclamaciones-web', '/galeria-web']

const casos = []
async function caso(nombre, fn) {
  if (SOLO && !nombre.includes(SOLO)) return
  const t0 = Date.now()
  try { await fn(); casos.push({ nombre, ok: true, ms: Date.now() - t0 }); console.log(`OK    ${nombre}`) } catch (e) {
    const d = String(e.message).split('\n').filter(Boolean).slice(0, 6).join(' | ').slice(0, 900)
    casos.push({ nombre, ok: false, error: d, ms: Date.now() - t0 }); console.log(`FALLA ${nombre}\n      ${d}`)
  }
}

async function iniciarSesion(navegador, cuenta) {
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await page.goto(`${APP}/login`)
  await page.fill('#email', cuenta.email)
  await page.fill('#password', cuenta.password)
  await page.click('button[type=submit]')
  await page.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 30000 })
  await page.waitForTimeout(1000)
  const estado = await ctx.storageState()
  await ctx.close()
  return estado
}
async function abrir(navegador, estado, opciones = {}) {
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', storageState: estado ?? undefined, ...opciones })
  await ctx.addInitScript(() => {
    const m = { raf: 0, timeouts: 0 }
    window.__m = m
    const raf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb) => { m.raf += 1; return raf(cb) }
    const st = window.setTimeout.bind(window)
    window.setTimeout = (cb, ms, ...a) => { m.timeouts += 1; return st(cb, ms, ...a) }
  })
  const page = await ctx.newPage()
  const errores = []
  page.on('pageerror', (e) => errores.push(String(e.message).slice(0, 200)))
  let enVuelo = 0
  let ultima = Date.now()
  page.on('request', (r) => { if (new URL(r.url()).origin === API) { enVuelo += 1; ultima = Date.now() } })
  page.on('requestfinished', (r) => { if (new URL(r.url()).origin === API) { enVuelo = Math.max(0, enVuelo - 1); ultima = Date.now() } })
  page.on('requestfailed', (r) => { if (new URL(r.url()).origin === API) enVuelo = Math.max(0, enVuelo - 1) })
  const quieto = async (ms = 600) => {
    const tope = Date.now() + 25000
    while (Date.now() < tope) { if (enVuelo === 0 && Date.now() - ultima >= ms) return; await page.waitForTimeout(100) }
  }
  return { ctx, page, errores, quieto }
}
const irA = (page, ruta) => page.evaluate((r) => { history.pushState({}, '', r); window.dispatchEvent(new PopStateEvent('popstate')) }, ruta)
const montadas = (page) => page.evaluate(() => [...document.querySelectorAll('main > div[data-ruta]')].map((d) => d.dataset.ruta))
const visitar = async (h, rutas) => { for (const r of rutas) { await irA(h.page, r); await h.page.waitForTimeout(120); await h.quieto(400) } }
const tasa = async (page, ms = 2500) => {
  const a = await page.evaluate(() => ({ r: window.__m.raf, t: window.__m.timeouts, ts: performance.now() }))
  await page.waitForTimeout(ms)
  const b = await page.evaluate(() => ({ r: window.__m.raf, t: window.__m.timeouts, ts: performance.now() }))
  const s = (b.ts - a.ts) / 1000
  return { raf: (b.r - a.r) / s, timeouts: (b.t - a.t) / s }
}

;(async () => {
  const navegador = await chromium.launch()
  const estados = {}
  try {
    for (const rol of ['admin', 'adminB', 'cajera', 'clienteA']) estados[rol] = await iniciarSesion(navegador, CUENTAS[rol])
    sql(`begin; set local session_replication_role = replica; delete from clientes where nombre like 'QA F6 %';
         insert into clientes_web (id, email, activo) values ('${CUENTAS.clienteA.id}', ${lit(CUENTAS.clienteA.email)}, true) on conflict (id) do nothing;
         insert into clientes (nombre, telefono, cliente_web_id) values ('QA F6 Alfa', '999000333', '${CUENTAS.clienteA.id}'); commit;`)

    // ============================================================ CACHÉ DE PANTALLAS
    await caso('Caché: recorrer las 27 rutas nunca deja más de 6 pantallas montadas y el regreso a Ventas funciona', async () => {
      const h = await abrir(navegador, estados.admin)
      await h.page.goto(`${APP}/ventas`)
      await h.page.waitForSelector('main')
      let max = 0
      for (const ruta of RUTAS) {
        await irA(h.page, ruta)
        await h.page.waitForTimeout(120)
        await h.quieto(400)
        const m = await montadas(h.page)
        max = Math.max(max, m.length)
        assert.ok(m.includes(ruta), `${ruta} debe estar montada`)
        assert.ok(m.length <= MAX, `${m.length} pantallas montadas en ${ruta}`)
        assert.equal(await h.page.evaluate(() => [...document.querySelectorAll('main > div[data-ruta]')].filter((d) => getComputedStyle(d).display !== 'none').length), 1, 'exactamente una visible')
      }
      await irA(h.page, '/ventas')
      await h.quieto(600)
      assert.ok((await montadas(h.page)).includes('/ventas'))
      assert.ok(await h.page.locator('[data-ruta="/ventas"] input').first().isVisible(), 'Ventas visible tras el recorrido')
      assert.equal(max, MAX, 'se alcanza el tope y no lo supera')
      assert.equal(h.errores.length, 0, h.errores.join('|'))
      await h.ctx.close()
    })

    await caso('Conservación: carrito, búsqueda y orden, y scroll se conservan aunque la pantalla se haya desmontado', async () => {
      const producto = sql(`select nombre from productos where activo and stock_actual > 0 and nombre !~ '[%_]' order by nombre limit 1`)
      const h = await abrir(navegador, estados.admin)
      await h.page.goto(`${APP}/ventas`)
      await h.page.waitForSelector('main')
      await h.quieto(800)
      // carrito de la caja
      await h.page.locator('[data-ruta="/ventas"] input').first().fill(producto.slice(0, 10))
      await h.page.getByRole('button', { name: new RegExp(producto.slice(0, 10).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click()
      await h.page.getByRole('button', { name: 'Quitar', exact: true }).first().waitFor({ timeout: 10000 })
      // filtros de Inventario + scroll
      await irA(h.page, '/inventario')
      await h.quieto(800)
      await h.page.locator('[data-ruta="/inventario"]').locator("input[type=search]").first().fill('relleno')
      await h.quieto(1000)
      await h.page.evaluate(() => { document.querySelector('main').scrollTop = 600 })
      await h.page.waitForTimeout(300)
      const antesLargo = await h.page.evaluate(() => document.querySelector('main').scrollTop)
      assert.ok(antesLargo > 500, `scroll de partida ${antesLargo}`)
      // Sin desmontar (la pantalla sigue en la caché): la posición se conserva exacta al ir y volver.
      await visitar(h, ['/historial', '/servicios'])
      await irA(h.page, '/inventario')
      await h.page.waitForTimeout(500)
      const sinDesmontar = await h.page.evaluate(() => document.querySelector('main').scrollTop)
      assert.ok(Math.abs(sinDesmontar - antesLargo) < 5, `scroll con la pantalla montada ${antesLargo} → ${sinDesmontar}`)
      // Con desmontaje: la lista vuelve a cargar su primera ventana de filas (como al abrirla por primera vez), así que se prueba una
      // posición que cabe en ella.
      await h.page.evaluate(() => { document.querySelector('main').scrollTop = 400 })
      await h.page.waitForTimeout(300)
      const antes = await h.page.evaluate(() => document.querySelector('main').scrollTop)
      // 7 pantallas más: Ventas e Inventario salen de la caché
      await visitar(h, ['/historial', '/servicios', '/dashboard', '/mi-panel', '/citas', '/estadisticas', '/auditoria', '/clientes'])
      const m = await montadas(h.page)
      assert.ok(!m.includes('/ventas') && !m.includes('/inventario'), `siguen montadas: ${m}`)
      // carrito intacto (vive por encima de las pantallas)
      await irA(h.page, '/ventas')
      await h.quieto(800)
      await h.page.getByRole('button', { name: 'Quitar', exact: true }).first().waitFor({ timeout: 10000 })
      // búsqueda y scroll de Inventario tras volver a montarla
      // Fase 10A: `quieto` solo espera si ya hay peticiones en vuelo o hubo una hace < 1,2 s. Al volver desde Ventas (en caché, sin
      // peticiones) la última podía tener más de 1,2 s: `quieto` volvía en 1–2 ms y se medía el scroll ANTES de que llegaran los datos
      // que permiten restaurarlo (reproducido de forma determinista). Se espera primero a la petición que dispara el remontaje.
      const remontaje = h.page.waitForRequest((r) => new URL(r.url()).origin === API, { timeout: 10000 }).catch(() => null)
      await irA(h.page, '/inventario')
      await remontaje
      await h.quieto(1200)
      assert.equal(await h.page.locator('[data-ruta="/inventario"]').locator("input[type=search]").first().inputValue(), 'relleno', 'búsqueda de Inventario')
      await h.page.waitForTimeout(500)
      const despues = await h.page.evaluate(() => document.querySelector('main').scrollTop)
      assert.ok(Math.abs(despues - antes) < 60, `scroll ${antes} → ${despues}`)
      assert.equal(h.errores.length, 0, h.errores.join('|'))
      await h.ctx.close()
    })

    await caso('Protección: un diálogo abierto y un formulario editado impiden desmontar su pantalla; al liberarse vuelve el tope', async () => {
      const h = await abrir(navegador, estados.admin)
      await h.page.goto(`${APP}/promociones`)
      await h.page.waitForSelector('main')
      await h.quieto(800)
      await h.page.getByRole('button', { name: 'Nueva promoción' }).first().click()
      await h.page.locator('form input[id$="-titulo"]').fill('QA F6 borrador')
      // el diálogo oculta la pantalla al navegar; se sale con el diálogo abierto (borrador a medias)
      await h.page.keyboard.press('Escape').catch(() => {})
      await h.page.getByRole('button', { name: 'Nueva promoción' }).first().click()
      await h.page.locator('form input[id$="-titulo"]').fill('QA F6 borrador')
      await visitar(h, ['/ventas', '/inventario', '/historial', '/servicios', '/dashboard', '/mi-panel', '/citas', '/estadisticas'])
      let m = await montadas(h.page)
      assert.ok(m.includes('/promociones'), `Promociones debe seguir montada con su diálogo: ${m}`)
      assert.ok(m.length <= MAX, `el tope se respeta recortando las NO protegidas: ${m.length}`)
      await irA(h.page, '/promociones')
      await h.page.waitForTimeout(400)
      assert.equal(await h.page.locator('form input[id$="-titulo"]').inputValue(), 'QA F6 borrador', 'el borrador del diálogo sigue ahí')
      await h.page.keyboard.press('Escape')
      await h.page.waitForTimeout(300)
      await visitar(h, ['/ventas', '/inventario'])
      m = await montadas(h.page)
      assert.ok(m.length <= MAX, `liberada la protección se recorta: ${m.length}`)
      assert.equal(n(`select count(*) from promociones where titulo like 'QA F6 %'`), 0, 'no se guardó nada')
      await h.ctx.close()
    })
    function n(c) { return Number(sql(c)) }

    await caso('Protección: un formulario editado sin enviar (Puntos Web) conserva su pantalla; los borradores de Recompensas Web también', async () => {
      const h = await abrir(navegador, estados.admin)
      await h.page.goto(`${APP}/puntos-web`)
      await h.page.waitForSelector('main form input')
      const campo = h.page.locator('main form input[type=number]').first()
      const original = await campo.inputValue()
      await campo.fill(original === '77' ? '78' : '77')
      await visitar(h, ['/ventas', '/inventario', '/historial', '/servicios', '/dashboard', '/mi-panel', '/citas', '/estadisticas'])
      assert.ok((await montadas(h.page)).includes('/puntos-web'), 'Puntos Web sigue montada con su formulario editado')
      await irA(h.page, '/puntos-web')
      await h.page.waitForTimeout(300)
      assert.notEqual(await h.page.locator('main form input[type=number]').first().inputValue(), original, 'el valor editado sigue ahí')
      // Recompensas Web: borrador de Protección
      await irA(h.page, '/recompensas-web?tab=proteccion')
      await h.page.locator('[role=tabpanel] li').first().waitFor({ timeout: 30000 })
      const fila = h.page.locator('[role=tabpanel] li').first()
      await fila.locator('button[aria-expanded]').click()
      await fila.locator('input[id$="-m"]').fill('55')
      await visitar(h, ['/ventas', '/inventario', '/historial', '/servicios', '/dashboard', '/mi-panel', '/citas', '/estadisticas'])
      assert.ok((await montadas(h.page)).includes('/recompensas-web'), 'Recompensas Web sigue montada con un borrador')
      await h.ctx.close()
    })

    await caso('Invalidación: al cambiar de cuenta no queda búsqueda, ni pantallas, ni scroll de la anterior', async () => {
      const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', storageState: estados.admin })
      const page = await ctx.newPage()
      await page.goto(`${APP}/inventario`)
      await page.waitForSelector('main')
      await page.locator('[data-ruta="/inventario"]').locator("input[type=search]").first().fill('relleno')
      await page.waitForTimeout(800)
      await page.getByRole('button', { name: 'Menú de usuario' }).click()
      await page.getByRole('button', { name: 'Cerrar sesión' }).first().click()
      await page.getByRole('button', { name: /Cerrar sesión|^Sí/ }).last().click()
      await page.waitForFunction(() => !Object.keys(localStorage).some((k) => /auth-token$/.test(k)), null, { timeout: 15000 })
      await page.waitForTimeout(800)
      await page.goto(`${APP}/login`)
      await page.fill('#email', CUENTAS.adminB.email)
      await page.fill('#password', CUENTAS.adminB.password)
      await page.click('button[type=submit]')
      await page.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 20000 })
      await page.goto(`${APP}/inventario`)
      await page.waitForSelector('main')
      await page.waitForTimeout(800)
      assert.equal(await page.locator('[data-ruta="/inventario"]').locator("input[type=search]").first().inputValue(), '', 'búsqueda de la cuenta anterior')
      assert.equal((await montadas(page)).length, 1)
      await ctx.close()
    })

    // ============================================================ TEMPORIZADORES / ANIMACIÓN
    await caso('Pausa: los placeholders animados de pantallas ocultas no consumen temporizadores; vuelven al mostrarse', async () => {
      const h = await abrir(navegador, estados.admin)
      await h.page.goto(`${APP}/ventas`)
      await h.page.waitForSelector('main')
      await visitar(h, ['/inventario', '/historial', '/servicios', '/clientes'])
      // todas con buscador; ahora una pantalla SIN buscador
      await irA(h.page, '/web')
      await h.quieto(800)
      const enWeb = await tasa(h.page, 6000)
      assert.ok(enWeb.timeouts < 1.5, `${enWeb.timeouts.toFixed(1)} temporizadores/s con solo pantallas ocultas`)
      await irA(h.page, '/inventario')
      await h.quieto(600)
      const enInventario = await tasa(h.page, 6000)
      assert.ok(enInventario.timeouts > 3 && enInventario.timeouts < 30, `placeholder visible ${enInventario.timeouts.toFixed(1)}/s (solo el suyo)`)
      await h.ctx.close()
    })

    await caso('Pausa: con la pestaña del navegador oculta el placeholder y la máscara no programan trabajo', async () => {
      const h = await abrir(navegador, estados.admin)
      await h.page.goto(`${APP}/inventario`)
      await h.page.waitForSelector('main')
      await h.quieto(800)
      await h.page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await h.page.waitForTimeout(400)
      const oculta = await tasa(h.page)
      assert.ok(oculta.timeouts < 3, `${oculta.timeouts.toFixed(1)}/s con la pestaña oculta`)
      await h.ctx.close()
    })

    await caso('Movimiento reducido: el placeholder muestra el texto completo sin escribirse', async () => {
      const h = await abrir(navegador, estados.admin, { reducedMotion: 'reduce' })
      await h.page.goto(`${APP}/ventas`)
      await h.page.waitForSelector('main')
      await h.quieto(800)
      const t = await tasa(h.page)
      assert.ok(t.timeouts < 3, `${t.timeouts.toFixed(1)}/s`)
      assert.ok((await h.page.locator('[data-ruta="/ventas"] input').first().getAttribute('placeholder')).startsWith('Buscar producto'), 'texto completo')
      await h.ctx.close()
    })

    await caso('Inicio: la máscara del héroe se duerme en reposo, despierta con el puntero y vuelve a dormirse', async () => {
      const h = await abrir(navegador, null)
      await h.page.goto(`${APP}/inicio`)
      await h.page.waitForSelector('h1')
      await h.quieto(1200)
      await h.page.waitForTimeout(1500)
      const reposo = await tasa(h.page, 2000)
      assert.ok(reposo.raf < 3, `${reposo.raf.toFixed(1)} rAF/s en reposo`)
      const caja = await h.page.locator('section').first().boundingBox()
      await h.page.mouse.move(caja.x + caja.width * 0.7, caja.y + caja.height * 0.5)
      await h.page.mouse.move(caja.x + caja.width * 0.75, caja.y + caja.height * 0.55, { steps: 6 })
      await h.page.waitForTimeout(150)
      const mov = await tasa(h.page, 500)
      assert.ok(mov.raf > 20, `${mov.raf.toFixed(1)} rAF/s moviendo el puntero`)
      const mascara = await h.page.evaluate(() => document.querySelector('section img[aria-hidden="true"]')?.style.maskImage ?? '')
      assert.ok(/radial-gradient/.test(mascara), 'la máscara se muestra al mover')
      await h.page.mouse.move(5, 5)
      await h.page.waitForTimeout(2500)
      const despues = await tasa(h.page, 1500)
      assert.ok(despues.raf < 3, `${despues.raf.toFixed(1)} rAF/s al volver al reposo`)
      assert.equal(h.errores.length, 0, h.errores.join('|'))
      await h.ctx.close()
    })

    // ============================================================ TARJETA DE PUNTOS / FONDO DE NIVEL
    for (const [etiqueta, opciones] of [['movimiento normal', {}], ['movimiento reducido', { reducedMotion: 'reduce' }]]) {
      await caso(`TarjetaPuntos y FondoNivel (${etiqueta}): ${etiqueta === 'movimiento normal' ? 'animan solo a la vista, se pausan fuera de pantalla y con la pestaña oculta' : 'quedan quietas, sin bucle; arrastrar sigue funcionando y luego vuelve a dormir'}`, async () => {
        const h = await abrir(navegador, estados.clienteA, opciones)
        await h.page.goto(`${APP}/recompensas?seccion=tarjeta`)
        await h.page.locator('.tp-card').first().waitFor({ timeout: 30000 })
        await h.quieto(1000)
        await h.page.waitForTimeout(3200) // termina el conteo inicial
        const reposo = await tasa(h.page, 2000)
        const card = h.page.locator('.tp-card').first()
        const t1 = await card.evaluate((e) => e.style.transform)
        await h.page.waitForTimeout(400)
        const t2 = await card.evaluate((e) => e.style.transform)
        if (etiqueta === 'movimiento normal') {
          assert.ok(reposo.raf > 30, `${reposo.raf.toFixed(1)} rAF/s con la tarjeta a la vista`)
          assert.notEqual(t1, t2, 'flota')
          // fuera de pantalla: se pausa
          await h.page.evaluate(() => { const m = document.querySelector('main') ?? document.scrollingElement; (document.querySelector('.tp-stage').closest('[class*=overflow-y-auto]') ?? m).scrollBy(0, 4000) })
          await h.page.waitForTimeout(600)
          // la tarjeta principal ya no está a la vista: su transform deja de cambiar (las tarjetas de nivel visibles sí siguen)
          const sinTarjeta = await h.page.evaluate(() => { const r = document.querySelector('.tp-stage').getBoundingClientRect(); return r.bottom < 0 || r.top > innerHeight })
          assert.ok(sinTarjeta, 'la tarjeta quedó fuera de la ventana')
          const f1 = await card.evaluate((e) => e.style.transform)
          await h.page.waitForTimeout(700)
          const f2 = await card.evaluate((e) => e.style.transform)
          assert.equal(f1, f2, 'la tarjeta principal sigue animándose fuera de pantalla')
          // pestaña oculta
          await h.page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })
          await h.page.waitForTimeout(500)
          const oculta = await tasa(h.page, 1500)
          assert.ok(oculta.raf < 3, `${oculta.raf.toFixed(1)} rAF/s con la pestaña oculta`)
        } else {
          assert.ok(reposo.raf < 3, `${reposo.raf.toFixed(1)} rAF/s en reposo con movimiento reducido`)
          assert.equal(t1, t2, 'no flota')
          // arrastrar: gira y luego vuelve a su sitio y el bucle se duerme
          const caja = await h.page.locator('.tp-stage').boundingBox()
          await h.page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2)
          await h.page.mouse.down()
          await h.page.mouse.move(caja.x + caja.width / 2 + 160, caja.y + caja.height / 2 + 20, { steps: 8 })
          await h.page.waitForTimeout(250)
          const girada = await card.evaluate((e) => e.style.transform)
          assert.notEqual(girada, t2, 'el arrastre gira la tarjeta')
          await h.page.mouse.up()
          await h.page.waitForTimeout(6000)
          const dormida = await tasa(h.page, 1500)
          assert.ok(dormida.raf < 3, `${dormida.raf.toFixed(1)} rAF/s tras soltar y volver al reposo`)
        }
        // el número final y el nivel siguen mostrándose
        assert.match(await h.page.locator('.tp-puntos b').first().innerText(), /\d/)
        assert.ok(await h.page.locator('.tn-fondo').count() >= 1, 'FondoNivel presente')
        assert.equal(h.errores.length, 0, h.errores.join('|'))
        await h.ctx.close()
      })
    }

    // ============================================================ REGRESIONES DE LA REVISIÓN V1 (F6-01 … F6-04)
    const OCHO = ['/ventas', '/inventario', '/historial', '/servicios', '/dashboard', '/mi-panel', '/citas', '/estadisticas']

    await caso('F6-01: un guardado que FALLA, una validación rechazada y un guardado EN VUELO no sueltan la protección de Puntos Web', async () => {
      for (const modo of ['error', 'validacion', 'en-vuelo']) {
        const h = await abrir(navegador, estados.admin)
        let liberar = null
        const enVuelo = new Promise((r) => { liberar = r })
        await h.ctx.route(/\/rest\/v1\/config_puntos/, async (route) => {
          if (route.request().method() !== 'PATCH') return route.continue()
          if (modo === 'error') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
          if (modo === 'en-vuelo') { await enVuelo; return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }) }
          return route.fulfill({ status: 204 })
        })
        await h.page.goto(`${APP}/puntos-web`)
        await h.page.waitForSelector('main form input')
        const campos = h.page.locator('main form input[type=number]')
        const original = await campos.first().inputValue()
        await campos.first().fill('77')
        if (modo === 'validacion') {
          await campos.nth(2).fill('99') // Premium 99
          await campos.nth(3).fill('30') // VIP 30 (< Premium): la validación real lo rechaza
        }
        await h.page.locator('main form button[type=submit]').click()
        await h.page.waitForTimeout(500)
        await visitar(h, OCHO)
        assert.ok((await montadas(h.page)).includes('/puntos-web'), `${modo}: Puntos Web debe seguir montada`)
        await irA(h.page, '/puntos-web')
        await h.page.waitForTimeout(300)
        assert.equal(await h.page.locator('main form input[type=number]').first().inputValue(), '77', `${modo}: el borrador sigue ahí (confirmado era ${original})`)
        liberar()
        await h.ctx.close()
      }
    })

    await caso('F6-01: un guardado CONFIRMADO suelta solo ese formulario; cancelar un diálogo no deja protección falsa; coexistencia', async () => {
      const h = await abrir(navegador, estados.admin)
      await h.ctx.route(/\/rest\/v1\/config_puntos/, (route) => (route.request().method() === 'PATCH' ? route.fulfill({ status: 204 }) : route.continue()))
      await h.page.goto(`${APP}/puntos-web`)
      await h.page.waitForSelector('main form input')
      await h.page.locator('main form input[type=number]').first().fill('12')
      await h.page.locator('main form button[type=submit]').click()
      await h.page.getByText('Configuración de puntos actualizada.').waitFor({ timeout: 10000 })
      await visitar(h, OCHO)
      assert.ok(!(await montadas(h.page)).includes('/puntos-web'), 'tras un guardado confirmado Puntos Web ya no está protegida')
      // diálogo editado y CANCELADO en Promociones
      await irA(h.page, '/promociones')
      await h.quieto(800)
      await h.page.getByRole('button', { name: 'Nueva promoción' }).first().click()
      await h.page.locator('form input[id$="-titulo"]').fill('QA F6 cancelada')
      await h.page.getByRole('button', { name: 'Cancelar' }).click()
      await h.page.waitForTimeout(300)
      await visitar(h, OCHO)
      assert.ok(!(await montadas(h.page)).includes('/promociones'), 'un diálogo cancelado no deja protección falsa')
      // coexistencia: un formulario editado en Puntos Web + un borrador en Recompensas Web: ambos siguen protegidos
      await irA(h.page, '/puntos-web')
      await h.page.waitForSelector('main form input')
      await h.page.locator('main form input[type=number]').first().fill('21')
      await irA(h.page, '/recompensas-web?tab=proteccion')
      await h.page.locator('[role=tabpanel] li').first().waitFor({ timeout: 30000 })
      const fila = h.page.locator('[role=tabpanel] li').first()
      await fila.locator('button[aria-expanded]').click()
      await fila.locator('input[id$="-m"]').fill('9')
      await visitar(h, OCHO)
      const m = await montadas(h.page)
      assert.ok(m.includes('/puntos-web') && m.includes('/recompensas-web'), `ambas protegidas: ${m}`)
      assert.equal(n(`select count(*) from promociones where titulo like 'QA F6 %'`), 0)
      await h.ctx.close()
    })

    // ============================================================ REGRESIONES DE LA REVISIÓN V2 (F6-01b, F6-05)
    await caso('F6-01b: un éxito de OTRO flujo (otro formulario) no libera un guardado fallido, rechazado ni en vuelo; el éxito propio libera solo el suyo', async () => {
      for (const modo of ['error', 'validacion', 'en-vuelo']) {
        const h = await abrir(navegador, estados.admin)
        let liberar = null
        const enVuelo = new Promise((r) => { liberar = r })
        await h.ctx.route(/\/rest\/v1\/config_puntos/, async (route) => {
          if (route.request().method() !== 'PATCH') return route.continue()
          if (modo === 'en-vuelo') { await enVuelo; return route.fulfill({ status: 204 }) }
          return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
        })
        await h.ctx.route(/\/rest\/v1\/config_fidelizacion/, (route) => (route.request().method() === 'PATCH' ? route.fulfill({ status: 204 }) : route.continue()))
        await h.page.goto(`${APP}/puntos-web`)
        await h.page.waitForSelector('main form input')
        const campos = h.page.locator('[data-ruta="/puntos-web"] form input[type=number]')
        await campos.first().fill('77')
        if (modo === 'validacion') { await campos.nth(2).fill('99'); await campos.nth(3).fill('30') }
        await h.page.locator('[data-ruta="/puntos-web"] form button[type=submit]').click()
        await h.page.waitForTimeout(400)
        // éxito AJENO: guardar Fidelización Web con confirmación real
        await irA(h.page, '/fidelizacion-web')
        await h.page.waitForSelector('#fidelizacion-porcentaje')
        await h.page.fill('#fidelizacion-porcentaje', '7')
        await h.page.locator('[data-ruta="/fidelizacion-web"] form button[type=submit]').click()
        await h.page.getByText('Configuración de fidelización actualizada.').waitFor({ timeout: 10000 })
        await visitar(h, OCHO)
        const m = await montadas(h.page)
        assert.ok(m.includes('/puntos-web'), `${modo}: un éxito ajeno liberó Puntos Web (${m})`)
        assert.ok(!m.includes('/fidelizacion-web'), `${modo}: el formulario que SÍ confirmó debe soltarse (${m})`)
        await irA(h.page, '/puntos-web')
        await h.page.waitForTimeout(300)
        assert.equal(await h.page.locator('[data-ruta="/puntos-web"] form input[type=number]').first().inputValue(), '77', `${modo}: el borrador sigue ahí`)
        liberar()
        await h.ctx.close()
      }
    })

    await caso('F6-01b: dos formularios enviados en la misma pantalla/sesión: el éxito de uno no libera al otro; editar tras enviar invalida la respuesta anterior', async () => {
      const h = await abrir(navegador, estados.admin)
      let liberarPuntos = null
      const retenido = new Promise((r) => { liberarPuntos = r })
      await h.ctx.route(/\/rest\/v1\/config_puntos/, async (route) => {
        if (route.request().method() !== 'PATCH') return route.continue()
        await retenido
        return route.fulfill({ status: 204 })
      })
      await h.ctx.route(/\/rest\/v1\/config_referidos/, (route) => (route.request().method() === 'PATCH' ? route.fulfill({ status: 204 }) : route.continue()))
      await h.page.goto(`${APP}/puntos-web`)
      await h.page.waitForSelector('main form input')
      const campo = h.page.locator('[data-ruta="/puntos-web"] form input[type=number]').first()
      await campo.fill('55')
      await h.page.locator('[data-ruta="/puntos-web"] form button[type=submit]').click() // intento 1: en vuelo
      await h.page.waitForTimeout(300)
      await campo.fill('88') // se sigue editando tras enviar
      // otro formulario enviado y confirmado
      await irA(h.page, '/referidos-web')
      await h.page.waitForSelector('[data-ruta="/referidos-web"] form input')
      await h.page.locator('[data-ruta="/referidos-web"] form input').first().fill('3')
      await h.page.locator('[data-ruta="/referidos-web"] form button[type=submit]').click()
      await h.page.getByText('Configuración de referidos actualizada.').waitFor({ timeout: 10000 })
      // llega la respuesta (éxito) del intento 1, que ya no representa lo que hay en pantalla
      liberarPuntos()
      await h.page.getByText('Configuración de puntos actualizada.').waitFor({ timeout: 10000 })
      await visitar(h, OCHO)
      const m = await montadas(h.page)
      assert.ok(m.includes('/puntos-web'), `el borrador 88 (editado después del envío) debe seguir protegido (${m})`)
      assert.ok(!m.includes('/referidos-web'), `Referidos confirmó y debe soltarse (${m})`)
      await irA(h.page, '/puntos-web')
      await h.page.waitForTimeout(300)
      assert.equal(await campo.inputValue(), '88')
      await h.ctx.close()
    })

    await caso('F6-01b: enviar → editar → reenviar → respuesta ANTIGUA no libera; la respuesta ACTUAL sí', async () => {
      const h = await abrir(navegador, estados.admin)
      const pendientes = []
      await h.ctx.route(/\/rest\/v1\/config_puntos/, async (route) => {
        if (route.request().method() !== 'PATCH') return route.continue()
        await new Promise((r) => pendientes.push(r))
        return route.fulfill({ status: 204 })
      })
      await h.page.goto(`${APP}/puntos-web`)
      await h.page.waitForSelector('[data-ruta="/puntos-web"] form input')
      const campo = h.page.locator('[data-ruta="/puntos-web"] form input[type=number]').first()
      const enviar = h.page.locator('[data-ruta="/puntos-web"] form button[type=submit]')
      await campo.fill('77'); await enviar.click() // intento 1
      await h.page.waitForTimeout(300)
      await campo.fill('88'); await h.page.evaluate(() => document.querySelector('[data-ruta="/puntos-web"] form').requestSubmit()) // intento 2 (el botón está deshabilitado en vuelo)
      await h.page.waitForTimeout(300)
      assert.equal(pendientes.length, 2, 'deben haber dos PATCH en vuelo')
      pendientes[0]() // llega primero la respuesta del intento 1
      await h.page.getByText('Configuración de puntos actualizada.').waitFor({ timeout: 10000 })
      await visitar(h, OCHO)
      assert.ok((await montadas(h.page)).includes('/puntos-web'), 'la respuesta antigua no debe liberar el intento 2')
      await irA(h.page, '/puntos-web')
      assert.equal(await campo.inputValue(), '88')
      pendientes[1]() // respuesta actual
      await h.page.waitForTimeout(600)
      await visitar(h, OCHO)
      assert.ok(!(await montadas(h.page)).includes('/puntos-web'), 'la respuesta actual libera')
      await h.ctx.close()
    })

    await caso('F6-05: editar y Cancelar un diálogo muchas veces en una sola pantalla no acumula formularios desmontados (nodos tras GC)', async () => {
      const h = await abrir(navegador, estados.admin)
      await h.page.goto(`${APP}/promociones`)
      await h.page.getByRole('button', { name: 'Nueva promoción' }).first().waitFor({ timeout: 30000 })
      await h.quieto(800)
      const cdp = await h.ctx.newCDPSession(h.page)
      await cdp.send('Performance.enable')
      const medir = async () => {
        await cdp.send('HeapProfiler.collectGarbage')
        await cdp.send('HeapProfiler.collectGarbage')
        const { metrics } = await cdp.send('Performance.getMetrics')
        return { nodos: metrics.find((x) => x.name === 'Nodes').value, oyentes: metrics.find((x) => x.name === 'JSEventListeners').value }
      }
      const ciclo = async () => {
        await h.page.getByRole('button', { name: 'Nueva promoción' }).first().click()
        await h.page.locator('form input[id$="-titulo"]').fill('QA F6 cancelada')
        await h.page.getByRole('button', { name: 'Cancelar' }).click()
        await h.page.waitForTimeout(120)
      }
      for (let i = 0; i < 3; i++) await ciclo() // calentamiento
      const base = await medir()
      for (let i = 0; i < 20; i++) await ciclo()
      const fin = await medir()
      console.log(`      F6-05 nodos ${base.nodos}→${fin.nodos}, oyentes ${base.oyentes}→${fin.oyentes} (20 cancelaciones)`)
      assert.ok(fin.nodos - base.nodos < 300, `los formularios cancelados se están acumulando: +${fin.nodos - base.nodos} nodos`)
      assert.equal(await h.page.locator('form').count(), 0)
      await h.ctx.close()
    })

    await caso('F6-02: cambio DIRECTO de cuenta y de rol con la pantalla montada (sin sesión nula): los filtros nuevos nacen en su valor por defecto', async () => {
      const guardada = (estado) => estado.origins.flatMap((o) => o.localStorage).find((x) => /auth-token$/.test(x.name))
      for (const [destino, etiqueta, esperadas] of [['adminB', 'otra administradora', null], ['cajera', 'cajera', '/ventas']]) {
        const h = await abrir(navegador, estados.admin)
        await h.page.goto(`${APP}/ventas`)
        await h.page.waitForSelector('main')
        await h.quieto(800)
        const buscador = h.page.locator('[data-ruta="/ventas"] input[type=search]').first()
        await buscador.fill('QA anterior')
        await h.page.waitForTimeout(300)
        const nueva = guardada(estados[destino])
        // Se sustituye la sesión guardada y se dispara el chequeo de visibilidad de Supabase: la cuenta cambia A→B directamente.
        await h.page.evaluate(([nombre, valor]) => {
          localStorage.setItem(nombre, valor)
          document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
        }, [nueva.name, nueva.value])
        const nombreDestino = destino === 'adminB' ? 'QA F5 Admin B' : 'QA F6 Cajera'
        await h.page.waitForFunction((t) => document.body.innerText.includes(t), nombreDestino, { timeout: 20000 })
        await h.quieto(800)
        assert.equal((await montadas(h.page)).join(','), '/ventas', `${etiqueta}: solo Ventas montada`)
        assert.equal(await h.page.locator('[data-ruta="/ventas"] input[type=search]').first().inputValue(), '', `${etiqueta}: el filtro nace vacío (no «QA anterior»)`)
        if (esperadas) {
          await irA(h.page, '/dashboard')
          await h.page.waitForTimeout(600)
          assert.ok(!(await montadas(h.page)).includes('/dashboard'), 'la cajera no monta pantallas de administración')
        }
        await h.ctx.close()
      }
    })

    await caso('F6-02: dentro de la MISMA identidad los filtros sí se conservan al desalojar (control)', async () => {
      const h = await abrir(navegador, estados.admin)
      await h.page.goto(`${APP}/ventas`)
      await h.page.waitForSelector('main')
      await h.page.locator('[data-ruta="/ventas"] input[type=search]').first().fill('QA misma')
      await visitar(h, OCHO.slice(1).concat(['/auditoria', '/clientes']))
      assert.ok(!(await montadas(h.page)).includes('/ventas'))
      await irA(h.page, '/ventas')
      await h.quieto(600)
      assert.equal(await h.page.locator('[data-ruta="/ventas"] input[type=search]').first().inputValue(), 'QA misma')
      await h.ctx.close()
    })

    await caso('F6-03: el mes anterior elegido en Dashboard (y el rango personalizado de las demás pantallas) se conserva exacto tras desalojar', async () => {
      const h = await abrir(navegador, estados.admin)
      const consultas = []
      h.page.on('request', (r) => { if (r.url().includes('/rest/v1/rpc/resumen_dashboard')) consultas.push(r.postData()) })
      await h.page.goto(`${APP}/dashboard`)
      await h.page.waitForSelector('main')
      await h.quieto(1000)
      const raiz = h.page.locator('[data-ruta="/dashboard"]')
      await raiz.locator('button[aria-haspopup="listbox"]').first().click()
      await raiz.locator('[role="option"]').nth(1).click() // primer mes anterior
      await h.quieto(1000)
      const etiquetaAntes = (await raiz.locator('button[aria-haspopup="listbox"]').first().innerText()).trim()
      const consultaAntes = consultas.at(-1)
      assert.ok(/desde/.test(consultaAntes ?? ''), 'hubo consulta con rango')
      await visitar(h, OCHO.slice(0, 4).concat(['/historial', '/auditoria', '/clientes', '/deudas']).filter((r) => r !== '/dashboard'))
      assert.ok(!(await montadas(h.page)).includes('/dashboard'), 'Dashboard desalojado')
      consultas.length = 0
      await irA(h.page, '/dashboard')
      await h.quieto(1200)
      const etiquetaDespues = (await h.page.locator('[data-ruta="/dashboard"] button[aria-haspopup="listbox"]').first().innerText()).trim()
      assert.equal(etiquetaDespues, etiquetaAntes, 'misma etiqueta de mes')
      assert.equal(consultas.at(-1), consultaAntes, 'misma consulta (desde/hasta) tras volver')
      await h.ctx.close()
    })

    await caso('F6-04: el contador de TarjetaPuntos se pausa fuera de pantalla y con la pestaña oculta, y CONTINÚA al volver; movimiento reducido lo salta', async () => {
      sql(`begin; set local session_replication_role = replica; delete from clientes where nombre like 'QA F6 Alfa';
           insert into clientes_web (id, email, activo) values ('${CUENTAS.clienteA.id}', ${lit(CUENTAS.clienteA.email)}, true) on conflict (id) do nothing;
           insert into clientes (nombre, telefono, cliente_web_id, puntos_bono) values ('QA F6 Alfa', '999000333', '${CUENTAS.clienteA.id}', 1234); commit;`)
      const numero = (page) => page.locator('.tp-puntos b').first().innerText()
      // referencia: valor final con movimiento reducido (salta al final)
      const r = await abrir(navegador, estados.clienteA, { reducedMotion: 'reduce' })
      await r.page.goto(`${APP}/recompensas?seccion=tarjeta`)
      await r.page.locator('.tp-card').first().waitFor({ timeout: 30000 })
      await r.quieto(800)
      const final = await numero(r.page)
      assert.ok(Number(final.replace(/\D/g, '')) >= 1000, `valor final ${final}`)
      assert.equal(await r.page.locator('.tp-barra i').first().evaluate((e) => e.style.width), await r.page.locator('.tp-barra i').first().evaluate((e) => e.style.width))
      await r.ctx.close()

      // fuera de pantalla: el conteo se detiene y al volver llega al valor final
      const h = await abrir(navegador, estados.clienteA)
      await h.page.goto(`${APP}/recompensas?seccion=tarjeta`)
      await h.page.locator('.tp-card').first().waitFor({ timeout: 30000 })
      const desplazar = (y) => h.page.evaluate((dy) => { const s = document.querySelector('.tp-stage').closest('[class*=overflow-y-auto]'); s.scrollTo(0, dy) }, y)
      await desplazar(5000)
      await h.page.waitForTimeout(500)
      const fuera = await h.page.evaluate(() => { const r = document.querySelector('.tp-stage').getBoundingClientRect(); return r.bottom < 0 || r.top > innerHeight })
      assert.ok(fuera, 'la tarjeta quedó fuera de la ventana')
      const n1 = await numero(h.page)
      const raf1 = await h.page.evaluate(() => window.__m.raf)
      await h.page.waitForTimeout(1200)
      const n2 = await numero(h.page)
      assert.equal(n1, n2, 'el número no cambia fuera de pantalla')
      await desplazar(0)
      await h.page.waitForTimeout(3500)
      assert.equal(await numero(h.page), final, 'al volver, el conteo termina en el valor final (no se queda a medias)')
      void raf1
      // pestaña oculta a mitad del conteo (recarga para reiniciar el conteo)
      await h.page.reload()
      await h.page.locator('.tp-card').first().waitFor({ timeout: 30000 })
      await h.page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')) })
      await h.page.waitForTimeout(300)
      const o1 = await numero(h.page)
      await h.page.waitForTimeout(1200)
      assert.equal(await numero(h.page), o1, 'el número no cambia con la pestaña oculta')
      await h.page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')) })
      await h.page.waitForTimeout(3500)
      assert.equal(await numero(h.page), final, 'al volver a verse llega al valor final')
      // movimiento reducido ACTIVADO durante el conteo: salta al final y no sigue trabajando
      await h.page.reload()
      await h.page.locator('.tp-card').first().waitFor({ timeout: 30000 })
      await h.page.waitForTimeout(300)
      await h.page.emulateMedia({ reducedMotion: 'reduce' })
      await h.page.waitForTimeout(300)
      assert.equal(await numero(h.page), final, 'activar movimiento reducido salta al valor final')
      const t = await tasa(h.page, 1500)
      assert.ok(t.raf < 3, `${t.raf.toFixed(1)} rAF/s tras activar movimiento reducido`)
      await h.ctx.close()
    })

  } catch (e) {
    console.log('FALLA GLOBAL', String(e.stack ?? e).split('\n').slice(0, 6).join(' | '))
    casos.push({ nombre: 'global', ok: false, error: String(e.message) })
  } finally {
    try { sql(`begin; set local session_replication_role = replica; delete from clientes where nombre like 'QA F6 %'; delete from promociones where titulo like 'QA F6 %'; commit;`) } catch (e) { console.log('NO SE PUDO LIMPIAR:', e.message) }
    await navegador.close()
  }
  const fallos = casos.filter((c) => !c.ok)
  console.log(`\n${casos.length} casos, ${fallos.length} fallos`)
  if (SALIDA) fs.writeFileSync(SALIDA, JSON.stringify({ app: APP, fecha: new Date().toISOString(), casos }, null, 1))
  process.exitCode = fallos.length ? 1 : 0
})()
