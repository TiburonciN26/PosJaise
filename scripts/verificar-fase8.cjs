// Fase 8 · verificación funcional: mapa diferido, hero WebP directo (actualización 2026-10-15), fuentes, contenido del precaché, PWA (instalación, sin conexión, frescura de
// datos) y actualización A→B con trabajo pendiente. Todo contra el Supabase LOCAL (el build lo incrusta) y servidores estáticos locales.
//
// Uso: node scripts/verificar-fase8.cjs --antes=<dist> --despues=<dist> --a=<dist build-id f8-a> --b=<dist build-id f8-b> --cuentas=<json> [--salida=ruta.json]
// Los dist se construyen con VITE_BASE_PATH=/ y sin 404.html (como en Cloudflare Pages). A y B: VITE_BUILD_ID distinto y, desde la V2,
// B compilado con OTROS nombres de assets (ver scripts/verificar-fase8-v2.cjs); «publicar» B reemplaza la carpeta servida entera
// (antes se copiaba B encima de A y los archivos de A seguían disponibles por accidente, Codex F8-01).
const assert = require('node:assert/strict')
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { chromium } = require('playwright')
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').split('=').slice(1).join('=')
const ANTES = path.resolve(arg('antes')), DESPUES = path.resolve(arg('despues')), A = path.resolve(arg('a')), B = path.resolve(arg('b'))
const CUENTAS = JSON.parse(fs.readFileSync(arg('cuentas'), 'utf8'))
const SALIDA = arg('salida')
const SERV = path.join(__dirname, 'servir-dist-base.cjs')
const casos = []
const ESPERA = (ms) => new Promise((r) => setTimeout(r, ms))
async function caso(nombre, fn) {
  const t0 = Date.now()
  try { await fn(); casos.push({ nombre, ok: true, ms: Date.now() - t0 }); console.log(`OK    ${nombre}`) } catch (e) {
    const d = String(e.message).split('\n').filter(Boolean).slice(0, 5).join(' | ').slice(0, 700)
    casos.push({ nombre, ok: false, error: d, ms: Date.now() - t0 }); console.log(`FALLA ${nombre}\n      ${d}`)
  }
}
const servidores = []
function servir(dir, puerto) { const p = spawn(process.execPath, [SERV, dir, String(puerto), '/'], { stdio: 'ignore' }); servidores.push(p); return `http://127.0.0.1:${puerto}` }
const esMapa = (u) => /(^|\.)maps\.googleapis\.com$|(^|\.)maps\.gstatic\.com$|^www\.google\.com$/.test(new URL(u).host)
const psql = (sql) => execFileSync('docker', ['exec', '-i', 'supabase_db_WedJaiseReact', 'psql', '-U', 'postgres', '-d', 'postgres', '-At'], { input: sql, encoding: 'utf8' }).trim()

// Cuenta peticiones a Google Maps de una página (incluye las que fallen por falta de Internet).
function contarMapas(page) {
  const urls = []
  page.on('request', (r) => { if (esMapa(r.url())) urls.push(r.url()) })
  return urls
}
async function nuevaPagina(browser, base, opciones = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce', ...opciones })
  if (opciones.saveData) await ctx.addInitScript(() => { Object.defineProperty(navigator, 'connection', { value: { saveData: true, effectiveType: '4g' }, configurable: true }) })
  const page = await ctx.newPage()
  return { ctx, page }
}
const estadoMapa = (page) => page.evaluate(() => document.querySelector('[data-mapa-diferido]')?.getAttribute('data-mapa-diferido') ?? 'ausente')
async function desplazarHastaMapa(page, bloque = 'center') {
  await page.evaluate((b) => { document.querySelector('[data-mapa-diferido]')?.scrollIntoView({ block: b }) }, bloque)
}

;(async () => {
  const browser = await chromium.launch()
  const baseD = servir(DESPUES, 5321)
  const baseAnt = servir(ANTES, 5322)
  await ESPERA(1200)

  // ---------------- Mapa ----------------
  await caso('Mapa de Inicio: sin peticiones a Google al abrir (antes: se descargaba sin llegar a la sección)', async () => {
    const { ctx, page } = await nuevaPagina(browser, baseD)
    const urls = contarMapas(page)
    await page.goto(`${baseD}/inicio`, { waitUntil: 'load' }); await page.waitForSelector('h1'); await ESPERA(4500)
    assert.equal(urls.length, 0, `peticiones a Google al abrir: ${urls.length}`)
    assert.equal(await estadoMapa(page), 'pendiente')
    await ctx.close()
    // control: el build anterior sí las hacía
    const ant = await nuevaPagina(browser, baseAnt)
    const urlsAnt = contarMapas(ant.page)
    await ant.page.goto(`${baseAnt}/inicio`, { waitUntil: 'load' }); await ant.page.waitForSelector('h1'); await ESPERA(4500)
    assert.ok(urlsAnt.length > 0, 'el control (build anterior) debería pedir el mapa al abrir')
    await ant.ctx.close()
  })
  await caso('Mapa de Inicio: se activa al acercarse a la sección y el diseño no cambia (iframe con los mismos atributos)', async () => {
    const { ctx, page } = await nuevaPagina(browser, baseD)
    const urls = contarMapas(page)
    await page.goto(`${baseD}/inicio`, { waitUntil: 'load' }); await page.waitForSelector('h1'); await ESPERA(1500)
    await page.evaluate(() => { const c = [...document.querySelectorAll('*')].filter((e) => ['auto', 'scroll'].includes(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 100).sort((a, b) => b.scrollHeight - a.scrollHeight)[0]; c?.setAttribute('data-sc', '1') })
    // un paso corto NO debe activarlo (la sección está a miles de píxeles)
    await page.evaluate(() => document.querySelector('[data-sc]').scrollTo(0, 400)); await ESPERA(1200)
    assert.equal(urls.length, 0, 'un desplazamiento corto no debe cargar el mapa')
    await desplazarHastaMapa(page); await page.waitForSelector('iframe[title="Ubicación en el mapa"]', { timeout: 10000 }); await ESPERA(2500)
    assert.ok(urls.length > 0, 'al llegar a la sección debe pedirse el mapa')
    const f = await page.evaluate(() => { const i = document.querySelector('iframe[title="Ubicación en el mapa"]'); return { loading: i.getAttribute('loading'), ref: i.getAttribute('referrerpolicy'), src: i.getAttribute('src') } })
    assert.equal(f.loading, 'lazy'); assert.equal(f.ref, 'no-referrer-when-downgrade'); assert.match(f.src, /^https:\/\/www\.google\.com\/maps\?q=.+&output=embed$/)
    await ctx.close()
  })
  await caso('Mapa con «ahorrar datos»: no carga al llegar; carga solo con «Ver mapa»; «Cómo llegar» sigue sin cargar nada', async () => {
    const { ctx, page } = await nuevaPagina(browser, baseD, { saveData: true })
    const urls = contarMapas(page)
    await page.goto(`${baseD}/inicio`, { waitUntil: 'load' }); await page.waitForSelector('h1'); await ESPERA(1500)
    await desplazarHastaMapa(page); await ESPERA(3500)
    assert.equal(urls.length, 0, 'con Save-Data no debe cargar al llegar')
    assert.equal(await estadoMapa(page), 'pendiente')
    const enlace = await page.evaluate(() => document.querySelector('a[href*="google.com/maps/search"]')?.getAttribute('href') ?? '')
    assert.match(enlace, /query=/, 'el enlace «Cómo llegar» sigue presente')
    await page.getByRole('button', { name: /Ver mapa/ }).click()
    await page.waitForSelector('iframe[title="Ubicación en el mapa"]', { timeout: 10000 }); await ESPERA(2500)
    assert.ok(urls.length > 0); assert.equal(await estadoMapa(page), 'activo')
    await ctx.close()
  })
  await caso('Mapa en Nosotros: mismo comportamiento (nada al abrir; se activa al acercarse)', async () => {
    const { ctx, page } = await nuevaPagina(browser, baseD)
    const urls = contarMapas(page)
    await page.goto(`${baseD}/nosotros`, { waitUntil: 'load' }); await page.waitForSelector('h1'); await ESPERA(3500)
    assert.equal(urls.length, 0, `peticiones al abrir Nosotros (pestaña Equipo): ${urls.length}`)
    // el mapa vive en la pestaña «Contacto»: se monta al abrirla (y recién entonces puede activarse)
    await page.getByRole('button', { name: 'Contacto', exact: true }).first().click().catch(() => page.getByText('Contacto', { exact: true }).first().click())
    await page.waitForSelector('[data-mapa-diferido]', { timeout: 20000 })
    assert.equal(urls.length, 0, `peticiones al abrir Nosotros: ${urls.length}`)
    await desplazarHastaMapa(page); await page.waitForSelector('iframe[title="Ubicación en el mapa"]', { timeout: 10000 }); await ESPERA(2000)
    assert.ok(urls.length > 0)
    await ctx.close()
  })
  await caso('Sin dirección de contacto: marcador sin iframe ni peticiones', async () => {
    const { ctx, page } = await nuevaPagina(browser, baseD)
    const urls = contarMapas(page)
    await page.route(/\/rest\/v1\/rpc\/datos_contacto/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ direccion: null, telefono: '999', instagram_url: null, facebook_url: null, tiktok_url: null, abierto: true }]) }))
    await page.goto(`${baseD}/inicio`, { waitUntil: 'load' }); await page.waitForSelector('h1'); await ESPERA(3000)
    assert.equal(await page.locator('iframe[title="Ubicación en el mapa"]').count(), 0); assert.equal(urls.length, 0)
    await ctx.close()
  })

  // ---------------- Hero: cuatro WebP originales, sin variantes ----------------
  async function heroPedido(base, vp, dpr, tema) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: dpr, isMobile: vp.width < 600, serviceWorkers: 'block', reducedMotion: 'reduce' })
    await ctx.addInitScript((t) => { localStorage.setItem('pos-jaise-tema', t); localStorage.setItem('jaise-tema-web', t) }, tema)
    const page = await ctx.newPage()
    const pedidos = []
    page.on('response', async (r) => { if (r.url().includes('/inicio-web/')) pedidos.push({ url: new URL(r.url()).pathname.split('/').pop(), bytes: (await r.body().catch(() => Buffer.alloc(0))).length }) })
    await page.goto(`${base}/inicio`, { waitUntil: 'load' }); await page.waitForSelector('h1'); await ESPERA(3000)
    const attrs = await page.evaluate(() => [...document.querySelectorAll('section img[fetchpriority]')].map((i) => ({ fp: i.getAttribute('fetchpriority'), alt: i.getAttribute('alt'), actual: i.currentSrc.split('/').pop(), srcset: i.getAttribute('srcset'), ancho: i.naturalWidth, alto: i.naturalHeight })))
    await ctx.close()
    return { pedidos, attrs }
  }
  await caso('Hero oscuro 390×2: dos WebP de 3024 px intactos, prioridad alta solo en «después»', async () => {
    const r = await heroPedido(baseD, { width: 390, height: 844 }, 2, 'oscuro')
    const nombres = r.pedidos.map((p) => p.url).sort()
    assert.deepEqual(nombres, ['hero-antes-oscuro.webp', 'hero-despues-oscuro.webp'], `pedidos: ${nombres}`)
    assert.ok(r.pedidos.every((p) => p.bytes < 500 * 1024), JSON.stringify(r.pedidos))
    assert.ok(r.attrs.every((a) => a.srcset === null && a.ancho === 3024 && a.alto === 1698), JSON.stringify(r.attrs))
    const despues = r.attrs.find((a) => a.alt === 'Resultado después del servicio'), antes = r.attrs.find((a) => a.alt === '')
    assert.equal(despues.fp, 'high'); assert.equal(antes.fp, 'low')
  })
  await caso('Hero claro 390×2 y oscuro 1440×1: los mismos WebP originales sin srcset', async () => {
    const m = await heroPedido(baseD, { width: 390, height: 844 }, 2, 'claro')
    assert.deepEqual(m.pedidos.map((p) => p.url).sort(), ['hero-antes-claro.webp', 'hero-despues-claro.webp'])
    const e = await heroPedido(baseD, { width: 1440, height: 900 }, 1, 'oscuro')
    assert.deepEqual(e.pedidos.map((p) => p.url).sort(), ['hero-antes-oscuro.webp', 'hero-despues-oscuro.webp'])
    assert.ok([...m.attrs, ...e.attrs].every((a) => a.srcset === null && a.ancho === 3024 && a.alto === 1698))
    assert.ok([...m.pedidos, ...e.pedidos].every((p) => p.bytes < 500 * 1024))
  })

  await caso('Precarga de pestañas del portal: con Save-Data no se descargan en reposo (≈330 kB menos); con conexión normal sigue igual', async () => {
    const contar = async (opciones) => {
      const { ctx, page } = await nuevaPagina(browser, baseD, opciones)
      const js = []
      page.on('response', (r) => { if (/\/assets\/[^/]+\.js$/.test(r.url())) js.push(r.url().split('/').pop()) })
      await page.goto(`${baseD}/inicio`, { waitUntil: 'load' }); await page.waitForSelector('h1'); await ESPERA(7000)
      await ctx.close()
      return js
    }
    const normal = await contar({}), ahorro = await contar({ saveData: true })
    const pesta = /^(RecompensasCliente|CitasCliente|CarritoCliente|DetalleProductoCliente|DetalleServicioCliente|ProductosCliente|ServiciosCliente|NosotrosCliente)-/
    assert.ok(normal.filter((n) => pesta.test(n)).length >= 6, `con conexión normal deben precargarse las pestañas: ${normal.filter((n) => pesta.test(n))}`)
    assert.equal(ahorro.filter((n) => pesta.test(n)).length, 0, `con Save-Data no deben descargarse: ${ahorro.filter((n) => pesta.test(n))}`)
  })

  // ---------------- Fuentes ----------------
  await caso('Google Fonts: ya no bloquea el render (antes sí), sin la familia Outfit y las familias usadas siguen cargando', async () => {
    const medir = async (base) => {
      const { ctx, page } = await nuevaPagina(browser, base)
      const peticiones = []
      page.on('request', (r) => { if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) peticiones.push(r.url()) })
      await page.goto(`${base}/inicio`, { waitUntil: 'load' }); await page.waitForSelector('h1'); await ESPERA(4000)
      const r = await page.evaluate(() => {
        const e = performance.getEntriesByType('resource').find((x) => x.name.includes('fonts.googleapis.com/css2'))
        const l = document.querySelector('link[href*="fonts.googleapis.com/css2"]')
        return { bloqueo: e?.renderBlockingStatus ?? null, media: l?.media ?? null, href: l?.href ?? '' }
      })
      await ctx.close()
      return { ...r, peticiones }
    }
    const nue = await medir(baseD), ant = await medir(baseAnt)
    assert.equal(ant.bloqueo, 'blocking'); assert.equal(nue.bloqueo, 'non-blocking', `bloqueo después: ${nue.bloqueo}`)
    assert.equal(nue.media, 'all'); assert.ok(!/Outfit/.test(nue.href)); assert.ok(/Outfit/.test(ant.href))
    assert.ok(nue.peticiones.length >= 2, 'las fuentes deben seguir cargándose')
  })

  // ---------------- Precaché (contenido) ----------------
  function entradasPrecache(dir) {
    const sw = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8')
    const m = sw.match(/precacheAndRoute\((\[.*?\]),/s)
    const arr = JSON.parse(m[1].replace(/([{,])\s*([A-Za-z_]+)\s*:/g, '$1"$2":')) // lista estática de Workbox: [{url:"…",revision:…}]
    return arr.map((e) => ({ url: e.url, bytes: fs.existsSync(path.join(dir, e.url)) ? fs.statSync(path.join(dir, e.url)).size : 0 }))
  }
  await caso('Precaché: solo el shell (sin POS, escáner, maquetas HTML ni íconos) y con lo necesario para arrancar offline', async () => {
    const nue = entradasPrecache(DESPUES), ant = entradasPrecache(ANTES)
    const urls = nue.map((e) => e.url)
    assert.ok(urls.includes('index.html')); assert.ok(urls.some((u) => /^assets\/index-.*\.js$/.test(u))); assert.ok(urls.some((u) => /^assets\/index-.*\.css$/.test(u)))
    assert.ok(urls.some((u) => /^assets\/InicioCliente-/.test(u)) && urls.some((u) => /^assets\/PortalCliente-/.test(u)), 'ruta de aterrizaje en el shell')
    for (const prohibido of [/ModalEscaner/, /dise.osPropios/, /^assets\/(Ventas|Citas|Inventario|Dashboard|Estadisticas|Clientes|Gastos|Mobiliario|Deudas|Historial|Asistentes|Porcentajes|Promociones|Servicios)-/, /icon-.*\.png$/, /\.html$/].filter(Boolean)) {
      const malos = urls.filter((u) => prohibido.test(u) && u !== 'index.html')
      assert.deepEqual(malos, [], `en el precaché: ${malos}`)
    }
    const total = nue.reduce((a, e) => a + e.bytes, 0), totalAnt = ant.reduce((a, e) => a + e.bytes, 0)
    assert.ok(nue.length <= 40 && total < 1_000_000, `${nue.length} entradas, ${total} B`)
    assert.ok(ant.some((e) => /ModalEscaner/.test(e.url)), 'control: el build anterior sí precacheaba el escáner')
    console.log(`      precaché: ${ant.length} entradas ${totalAnt} B → ${nue.length} entradas ${total} B`)
  })

  // ---------------- PWA: instalación, offline, frescura ----------------
  await caso('PWA: instala, tercera visita sirve el shell desde el SW; sin conexión Inicio arranca; Supabase nunca en caché ni por el SW', async () => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } })
    const page = await ctx.newPage()
    const respuestas = []
    page.on('response', (r) => respuestas.push({ url: r.url(), sw: r.fromServiceWorker() }))
    await page.goto(`${baseD}/inicio`, { waitUntil: 'load' }); await page.waitForSelector('h1')
    await page.evaluate(() => navigator.serviceWorker.ready); await ESPERA(4000)
    for (let i = 0; i < 2; i++) { await page.reload({ waitUntil: 'load' }); await page.waitForSelector('h1'); await ESPERA(2500) }
    const caches = await page.evaluate(async () => { const o = {}; for (const n of await caches.keys()) o[n] = (await (await caches.open(n)).keys()).map((k) => k.url); return o })
    const precache = Object.entries(caches).find(([n]) => /precache/.test(n))[1]
    assert.ok(precache.length <= 40)
    assert.ok((caches['assets-por-uso'] ?? []).length > 3, 'el caché por uso debe haberse llenado: ' + Object.keys(caches))
    const todas = Object.values(caches).flat()
    assert.deepEqual(todas.filter((u) => /:54321|\/rest\/v1|\/auth\/v1|\/storage\/v1/.test(u)), [], 'ninguna respuesta de Supabase en cachés')
    const supa = respuestas.filter((r) => /:54321/.test(r.url))
    assert.ok(supa.length > 0 && supa.every((r) => !r.sw), 'las peticiones a Supabase no deben pasar por el SW')
    await ctx.setOffline(true)
    await page.reload({ waitUntil: 'load', timeout: 20000 }); await ESPERA(3000)
    assert.ok(await page.evaluate(() => !!document.querySelector('h1') && /BELLEZA/i.test(document.body.innerText)), 'Inicio debe arrancar sin conexión')
    await ctx.close()
  })

  // ---------------- Actualización A → B con trabajo pendiente ----------------
  const viva = path.join(os.tmpdir(), `f8-viva-${Date.now()}`)
  fs.cpSync(A, viva, { recursive: true })
  const baseU = servir(viva, 5323)
  await ESPERA(800)
  // Producto de prueba de Local (nunca se confirma la venta: solo se agrega y se quita del carrito en memoria).
  const producto = psql(`select nombre from productos where activo and stock_actual > 0 and nombre ~ '^(TEST|ZZZ TEST|QA)' and nombre !~ '[%_]' order by nombre limit 1`)
  // Publicación simulada: la carpeta servida pasa a contener SOLO lo de B (los archivos de A dejan de existir).
  const publicarB = () => { fs.rmSync(viva, { recursive: true, force: true }); fs.cpSync(B, viva, { recursive: true }) }
  await caso('Actualización A→B: con una venta en curso el botón queda bloqueado y el carrito se conserva; al vaciarlo se habilita y actualiza a B', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    await page.goto(`${baseU}/login`); await page.fill('#email', CUENTAS.admin.email); await page.fill('#password', CUENTAS.admin.password)
    await page.click('button[type=submit]'); await page.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 30000 }); await ESPERA(1500)
    await page.goto(`${baseU}/ventas`); await page.waitForSelector('main'); await ESPERA(1500)
    await page.evaluate(() => navigator.serviceWorker.ready); await ESPERA(3000)
    const metaA = fs.readFileSync(path.join(A, 'index.html'), 'utf8').match(/name="build-id" content="([^"]+)"/)[1]
    assert.equal(await page.evaluate(() => document.querySelector('meta[name="build-id"]')?.content), metaA)
    await page.locator('[data-ruta="/ventas"] input').first().fill(producto.slice(0, 10))
    await page.getByRole('button', { name: new RegExp(producto.slice(0, 10).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click()
    await page.getByRole('button', { name: 'Quitar', exact: true }).first().waitFor({ timeout: 10000 })
    // «publicar» B (reemplaza a A)
    publicarB()
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()))
    await page.getByText('Hay una versión nueva de la app.').waitFor({ timeout: 60000 })
    const boton = page.getByRole('button', { name: 'Actualizar' })
    assert.equal(await boton.isDisabled(), true, 'con trabajo pendiente el botón debe estar deshabilitado')
    assert.ok(await page.getByTestId('aviso-actualizacion-bloqueada').isVisible())
    assert.equal(await page.evaluate(() => document.querySelector('meta[name="build-id"]')?.content), metaA, 'sigue en A')
    assert.ok(await page.getByRole('button', { name: 'Quitar', exact: true }).first().isVisible(), 'el carrito se conserva')
    await page.getByRole('button', { name: 'Quitar', exact: true }).first().click()
    await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Actualizar'); return b && !b.disabled }, null, { timeout: 15000 })
    await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => null), page.getByRole('button', { name: 'Actualizar' }).click()])
    const metaB = fs.readFileSync(path.join(B, 'index.html'), 'utf8').match(/name="build-id" content="([^"]+)"/)[1]
    await page.waitForFunction((m) => document.querySelector('meta[name="build-id"]')?.content === m, metaB, { timeout: 30000 })
    // tras actualizar, los datos siguen sin caché y el SW nuevo controla la página
    const caches = await page.evaluate(async () => { const o = []; for (const n of await caches.keys()) o.push(...(await (await caches.open(n)).keys()).map((k) => k.url)); return o })
    assert.deepEqual(caches.filter((u) => /:54321|\/rest\/v1|\/auth\/v1/.test(u)), [])
    await ctx.close()
  })
  await caso('Actualización A→B sin trabajo pendiente en Inicio público: «Actualizar» disponible de inmediato', async () => {
    fs.rmSync(viva, { recursive: true, force: true }); fs.cpSync(A, viva, { recursive: true })
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } })
    const page = await ctx.newPage()
    await page.goto(`${baseU}/inicio`, { waitUntil: 'load' }); await page.waitForSelector('h1')
    await page.evaluate(() => navigator.serviceWorker.ready); await ESPERA(3500)
    publicarB()
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()))
    await page.getByText('Hay una versión nueva de la app.').waitFor({ timeout: 60000 })
    assert.equal(await page.getByRole('button', { name: 'Actualizar' }).isDisabled(), false)
    await ctx.close()
  })

  await browser.close()
  for (const p of servidores) p.kill()
  fs.rmSync(viva, { recursive: true, force: true })
  const fallos = casos.filter((c) => !c.ok)
  const informe = { fecha: new Date().toISOString(), total: casos.length, correctos: casos.length - fallos.length, fallos: fallos.length, casos }
  if (SALIDA) fs.writeFileSync(SALIDA, JSON.stringify(informe, null, 1))
  console.log(`\n${informe.correctos}/${informe.total} correctos`)
  process.exit(fallos.length ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(2) })
