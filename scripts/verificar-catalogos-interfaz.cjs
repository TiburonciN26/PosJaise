// Pruebas de INTERFAZ de los catálogos públicos (Fase 4) contra la app local (Vite) y el Supabase LOCAL, en Chromium.
//   node scripts/verificar-catalogos-interfaz.cjs [--salida=<carpeta>] [--app=http://localhost:5173] [--con-categorias]
// Con --con-categorias siembra 25 categorías ficticias («QA F4 Cat NNN») en el Supabase LOCAL para probar «Todos» con MUCHAS categorías,
// y las borra siempre al terminar (ver escenario-catalogo-qa.mjs).
// Sesión anónima (el catálogo es público). Cualquier origen distinto de la app y de 127.0.0.1:54321 se aborta; las imágenes se
// responden con un PNG de 1×1 (aquí solo importa QUÉ se pide). Solo lecturas: no crea ni modifica datos.
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const arg = (n, d = '') => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').slice(n.length + 3) || d
const APP = arg('app', 'http://localhost:5173')
const SALIDA = arg('salida') && path.resolve(arg('salida'))
const API = 'http://127.0.0.1:54321'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

const casos = []
async function caso(nombre, fn) {
  try { await fn(); casos.push({ nombre, ok: true }); console.log(`OK    ${nombre}`) } catch (e) { casos.push({ nombre, ok: false, error: String(e.message).split('\n')[0].slice(0, 400) }); console.log(`FALLA ${nombre}\n      ${String(e.message).split('\n')[0].slice(0, 400)}`) }
}

const CATALOGOS = {
  productos: { ruta: '/productos', tabla: 'productos', campo: 'Buscar producto', hallado: 'ULTIMA UNIDAD', noExiste: 'zzz-no-existe-123', masivo: 'TEST', unidad: 'producto' },
  servicios: { ruta: '/servicios', tabla: 'servicios', campo: 'Buscar servicio', hallado: 'PORC muy8', noExiste: 'zzz-no-existe-123', masivo: 'TEST', unidad: 'servicio' },
}

async function nuevaPagina(navegador, ancho = 1440, alto = 900, extra = {}) {
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: alto }, serviceWorkers: 'block', ...extra })
  const registro = { rest: [], imagenes: [], bloqueadas: [], errores: [] }
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url())
    if (u.origin === new URL(APP).origin) return route.continue()
    if (u.origin === API) {
      if (route.request().resourceType() === 'image' || u.pathname.includes('/storage/v1/object/')) { registro.imagenes.push(u.pathname); return route.fulfill({ status: 200, contentType: 'image/png', body: PNG }) }
      return route.continue()
    }
    if (route.request().resourceType() === 'image') { registro.imagenes.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'image/png', body: PNG }) }
    registro.bloqueadas.push(u.origin)
    return route.abort()
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => registro.errores.push(String(e.message).slice(0, 200)))
  page.on('request', (r) => { const u = new URL(r.url()); if (u.origin === API && u.pathname.startsWith('/rest/v1/')) registro.rest.push({ metodo: r.method(), ruta: u.pathname.replace('/rest/v1/', ''), consulta: decodeURIComponent(u.search), range: r.headers()['range'] ?? null }) })
  return { ctx, page, registro }
}

// El paginador de categorías de «Todos» también es una <nav> «Paginación del catálogo»: se espera al del LISTADO de resultados (dice «de N productos/servicios»).
const esperarListadoPlano = (page) => page.waitForFunction(() => /de \d+ (productos|servicios)/.test(document.querySelector('nav[aria-label="Paginación del catálogo"]')?.innerText ?? ''), null, { timeout: 30000 })
const tarjetas = (page) => page.locator('article')
const campoBusqueda = (page, c) => page.getByLabel(c.campo, { exact: true })
async function abrir(page, c) {
  await page.goto(`${APP}${c.ruta}`)
  await page.locator('article').first().waitFor({ timeout: 60000 })
}
async function esperarFilas(page, esperado, tiempo = 20000) {
  await page.waitForFunction((n) => document.querySelectorAll('article').length === n, esperado, { timeout: tiempo })
}
const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1)

;(async () => {
  const navegador = await chromium.launch()
  for (const [nombre, c] of Object.entries(CATALOGOS)) {
    // ---- carga inicial ----
    await caso(`${nombre}: la vitrina inicial NO descarga el catálogo (ninguna consulta pide más de 40 filas) y monta pocas tarjetas`, async () => {
      const { ctx, page, registro } = await nuevaPagina(navegador)
      await abrir(page, c)
      await page.waitForTimeout(800)
      const catalogo = registro.rest.filter((r) => r.ruta.startsWith(c.tabla) || r.ruta.includes(`${c.tabla}_vitrina`))
      assert.ok(catalogo.length >= 2)
      for (const r of catalogo) {
        const lim = /limit=(\d+)/.exec(r.consulta)
        const esHead = r.metodo === 'HEAD'
        assert.ok(esHead || r.ruta.includes('vitrina') || (lim && Number(lim[1]) <= 40) || /^bytes|^\d+-\d+/.test(r.range ?? ''), `consulta sin acotar: ${r.metodo} ${r.ruta}${r.consulta.slice(0, 120)}`)
      }
      assert.ok(await tarjetas(page).count() <= 40, `tarjetas montadas: ${await tarjetas(page).count()}`)
      assert.deepEqual(registro.errores, [])
      assert.deepEqual([...new Set(registro.bloqueadas)].filter((o) => !/fonts\.(googleapis|gstatic)\.com/.test(o)), [])
      await ctx.close()
    })

    // ---- búsqueda más allá de 1000 ----
    await caso(`${nombre}: buscar «${c.hallado}» encuentra un registro posterior a la posición 1000 (antes no aparecía)`, async () => {
      const { ctx, page } = await nuevaPagina(navegador)
      await abrir(page, c)
      await campoBusqueda(page, c).fill(c.hallado)
      await page.getByRole('heading', { name: 'Resultados' }).waitFor({ timeout: 20000 })
      await page.waitForFunction((t) => [...document.querySelectorAll('article')].some((a) => a.innerText.includes(t)), c.hallado, { timeout: 20000 })
      assert.ok((await tarjetas(page).count()) <= 40)
      await ctx.close()
    })

    // ---- respuestas fuera de orden ----
    await caso(`${nombre}: respuestas fuera de orden — una respuesta lenta y vieja no pisa la búsqueda más reciente`, async () => {
      const { ctx, page } = await nuevaPagina(navegador)
      await abrir(page, c)
      // La búsqueda de «zzz» (vieja) responde MUY tarde y con resultados distintos; la final es «hallado».
      await ctx.route(new RegExp(`/rest/v1/${c.tabla}\\?.*ilike`), async (route) => {
        const url = decodeURIComponent(route.request().url())
        if (url.includes('zzz')) await new Promise((r) => setTimeout(r, 2500))
        return route.continue()
      })
      const campo = campoBusqueda(page, c)
      await campo.fill('zzz')
      await page.waitForTimeout(450) // pasa el retardo: la petición de «zzz» sale y queda retenida
      await campo.fill(c.hallado)
      await page.waitForFunction((t) => [...document.querySelectorAll('article')].some((a) => a.innerText.includes(t)), c.hallado, { timeout: 20000 })
      await page.waitForTimeout(3200) // tiempo de sobra para que llegue la respuesta vieja
      const textos = await tarjetas(page).allInnerTexts()
      assert.ok(textos.length > 0 && textos.every((t) => t.includes(c.hallado)), 'la respuesta vieja pisó el resultado nuevo')
      await ctx.close()
    })

    // ---- vaciar la búsqueda ----
    await caso(`${nombre}: limpiar la búsqueda vuelve a la vista agrupada al instante`, async () => {
      const { ctx, page } = await nuevaPagina(navegador)
      await abrir(page, c)
      const inicial = await tarjetas(page).count()
      await campoBusqueda(page, c).fill(c.hallado)
      await page.getByRole('heading', { name: 'Resultados' }).waitFor()
      await campoBusqueda(page, c).fill('')
      await page.waitForFunction(() => !([...document.querySelectorAll('h2')].some((h) => h.textContent.trim() === 'Resultados')), null, { timeout: 5000 })
      await esperarFilas(page, inicial, 10000)
      await ctx.close()
    })

    // ---- sin resultados ----
    await caso(`${nombre}: sin coincidencias muestra «Sin resultados» (no un error ni «Buscando…» eterno)`, async () => {
      const { ctx, page } = await nuevaPagina(navegador)
      await abrir(page, c)
      await campoBusqueda(page, c).fill(c.noExiste)
      await page.getByText(`Sin resultados para "${c.noExiste}".`).waitFor({ timeout: 20000 })
      assert.equal(await tarjetas(page).count(), 0)
      await ctx.close()
    })

    // ---- paginación ----
    await caso(`${nombre}: paginación — 40 tarjetas por página, el DOM NO acumula, sin repetidos entre páginas, primera/última/anterior`, async () => {
      const { ctx, page } = await nuevaPagina(navegador)
      await abrir(page, c)
      await campoBusqueda(page, c).fill(c.masivo)
      await esperarListadoPlano(page)
      await esperarFilas(page, 40)
      // Se compara por el enlace al detalle (el id): en la réplica hay registros distintos con el mismo texto visible.
      const ids = () => page.$$eval('article a[href]', (as) => [...new Set(as.map((x) => x.getAttribute('href')))])
      const pagina1 = await ids()
      const total = await page.locator('nav[aria-label="Paginación del catálogo"] p').innerText()
      const m = /de (\d+) /.exec(total)
      assert.ok(m && Number(m[1]) > 1000, `total esperado > 1000: ${total}`)
      await page.getByRole('button', { name: 'Página siguiente' }).click()
      await page.getByText(/^Página\s*2 de/).waitFor()
      await page.waitForFunction((p1) => { const t = [...new Set([...document.querySelectorAll('article a[href]')].map((x) => x.getAttribute('href')))]; return document.querySelectorAll('article').length === 40 && !t.some((x) => p1.includes(x)) }, pagina1, { timeout: 20000 })
      assert.equal(new Set([...pagina1, ...(await ids())]).size, 80, 'la página 2 repite tarjetas de la 1')
      assert.equal(await tarjetas(page).count(), 40)
      await page.getByRole('button', { name: 'Última página' }).click()
      await page.waitForFunction(() => /Página\s*\d+ de (\d+)/.test(document.body.innerText) && document.querySelector('button[aria-label="Página siguiente"]').disabled, null, { timeout: 20000 })
      const enUltima = await tarjetas(page).count()
      assert.ok(enUltima >= 1 && enUltima <= 40)
      await page.getByRole('button', { name: 'Primera página' }).click()
      await page.getByText(/^Página\s*1 de/).waitFor()
      await page.waitForFunction(() => document.querySelectorAll('article').length === 40)
      assert.ok(await page.getByRole('button', { name: 'Página anterior' }).isDisabled())
      await ctx.close()
    })

    // ---- error de red + reintento ----
    await caso(`${nombre}: un fallo de red muestra un error con «Reintentar» (distinto de «sin resultados») y se recupera`, async () => {
      const { ctx, page } = await nuevaPagina(navegador)
      await abrir(page, c)
      let bloquear = true
      await ctx.route(new RegExp(`/rest/v1/${c.tabla}\\?.*ilike`), (route) => (bloquear ? route.abort('failed') : route.continue()))
      await campoBusqueda(page, c).fill(c.hallado)
      const alerta = page.getByRole('alert')
      await alerta.waitFor({ timeout: 20000 })
      assert.match(await alerta.innerText(), /No se pudieron? cargar/)
      assert.equal(await page.getByText(/Sin resultados/).count(), 0)
      bloquear = false
      await alerta.getByRole('button', { name: 'Reintentar' }).click()
      await page.waitForFunction((t) => [...document.querySelectorAll('article')].some((a) => a.innerText.includes(t)), c.hallado, { timeout: 20000 })
      await ctx.close()
    })

    // ---- la vitrina falla al cargar ----
    await caso(`${nombre}: si la vitrina inicial falla se muestra un error con «Reintentar» (no «Cargando...» para siempre)`, async () => {
      const { ctx, page } = await nuevaPagina(navegador)
      let bloquear = true
      await ctx.route(new RegExp(`/rest/v1/rpc/${c.tabla}_vitrina_publica`), (route) => (bloquear ? route.abort('failed') : route.continue()))
      await page.goto(`${APP}${c.ruta}`)
      const alerta = page.getByRole('alert')
      await alerta.waitFor({ timeout: 30000 })
      bloquear = false
      await alerta.getByRole('button', { name: 'Reintentar' }).click()
      await page.locator('article').first().waitFor({ timeout: 30000 })
      await ctx.close()
    })

    // ---- navegación ida y vuelta ----
    await caso(`${nombre}: abrir el detalle de una tarjeta y volver conserva el catálogo funcionando`, async () => {
      const { ctx, page, registro } = await nuevaPagina(navegador)
      await abrir(page, c)
      const primera = tarjetas(page).first()
      const nombreTarjeta = (await primera.locator('a').nth(1).innerText()).split('\n')[0]
      await primera.locator('a').first().click()
      await page.waitForURL(new RegExp(`${c.ruta}/[0-9a-f-]{36}`))
      await page.getByText(nombreTarjeta, { exact: false }).first().waitFor({ timeout: 30000 })
      await page.goBack()
      await page.locator('article').first().waitFor({ timeout: 30000 })
      assert.deepEqual(registro.errores, [])
      await ctx.close()
    })

    // ---- anchos ----
    for (const ancho of [390, 412, 1440]) {
      await caso(`${nombre}: ${ancho}px — sin desborde horizontal en la vista agrupada, la lista paginada y el paginador`, async () => {
        const { ctx, page } = await nuevaPagina(navegador, ancho, ancho === 1440 ? 900 : 850, ancho < 1000 ? { isMobile: true, hasTouch: true } : {})
        await abrir(page, c)
        assert.ok(await sinDesborde(page), 'desborde en la vista agrupada')
        await campoBusqueda(page, c).fill(c.masivo)
        await esperarListadoPlano(page)
        await esperarFilas(page, 40)
        assert.ok(await sinDesborde(page), 'desborde en la lista paginada')
        const caja = await page.getByRole('navigation', { name: 'Paginación del catálogo' }).boundingBox()
        assert.ok(caja && caja.x >= 0 && caja.x + caja.width <= ancho + 1, 'el paginador se sale de la pantalla')
        await ctx.close()
      })
    }
  }

  // ---- una categoría elegida desde la barra (Productos) ----
  await caso('productos: elegir una categoría en la barra muestra su listado (conteo global) y «Todas las categorías» regresa', async () => {
    const { ctx, page } = await nuevaPagina(navegador)
    await abrir(page, CATALOGOS.productos)
    await page.getByRole('button', { name: /^Categorías/ }).click()
    const opcion = page.locator('#lista-categorias button').first()
    const textoOpcion = await opcion.innerText()
    const esperado = Number((/(\d+)\s*$/.exec(textoOpcion.replace(/\s+/g, ' ')) ?? [])[1])
    await opcion.click()
    await page.getByRole('button', { name: /Todas las categorías/ }).waitFor({ timeout: 20000 })
    if (esperado) await page.waitForFunction((n) => document.querySelectorAll('article').length === Math.min(n, 40), esperado, { timeout: 20000 })
    await page.getByRole('button', { name: /Todas las categorías/ }).click()
    await page.waitForFunction(() => !document.body.innerText.includes('Todas las categorías'), null, { timeout: 10000 })
    await ctx.close()
  })

  // ---- «Todos» con MUCHAS categorías (F4-01) ----
  if (process.argv.includes('--con-categorias')) {
    const raiz = path.resolve(__dirname, '..')
    const escenario = (...args) => execFileSync(process.execPath, [path.join(raiz, 'scripts', 'escenario-catalogo-qa.mjs'), ...args], { cwd: raiz, encoding: 'utf8' })
    escenario('sembrar-categorias', '--categorias=25', '--por-categoria=6')
    try {
      for (const [nombre, c] of Object.entries(CATALOGOS)) {
        await caso(`${nombre}: muchas categorías — «Todos» monta como máximo 40 tarjetas por ventana, con paginador de categorías, y TODAS las categorías son alcanzables`, async () => {
          const { ctx, page } = await nuevaPagina(navegador)
          const respuestas = []
          const ventanasPedidas = []
          page.on('request', (r) => {
            if (r.url().includes(`/rpc/${c.tabla}_vitrina_publica`)) ventanasPedidas.push(Number(/"grupo_desde":\s*(\d+)/.exec(r.postData() ?? '')?.[1] ?? 0))
          })
          page.on('response', async (r) => {
            if (r.url().includes(`/rpc/${c.tabla}_vitrina_publica`)) { try { respuestas.push((await r.json()).length) } catch { /* sin cuerpo */ } }
          })
          await abrir(page, c)
          const textoBoton = await page.getByRole('button', { name: /^Categorías/ }).innerText()
          const M = Number((/(\d+)\s*$/.exec(textoBoton.replace(/\s+/g, ' ').trim()) ?? [])[1])
          assert.ok(M > 20, `se esperaban más de 20 categorías, hay ${M}`)
          const K = Math.ceil(M / 10)
          await page.waitForTimeout(1500)
          assert.deepEqual([...new Set(ventanasPedidas)], [0], `antes de paginar solo debe pedirse la primera ventana: ${JSON.stringify(ventanasPedidas)}`)
          const titulos = []
          for (let ventana = 1; ventana <= K; ventana++) {
            await page.getByText(new RegExp(`^Página\\s*${ventana} de ${K}`)).waitFor({ timeout: 20000 })
            await page.waitForFunction(() => document.querySelectorAll('article').length > 0)
            await page.waitForTimeout(400)
            const arts = await tarjetas(page).count()
            assert.ok(arts <= 40, `ventana ${ventana}: ${arts} tarjetas montadas (máx. 40)`)
            titulos.push(...(await page.locator('section.gap-3\\.5 h2').allInnerTexts()).map((t) => t.trim()))
            if (ventana < K) await page.getByRole('button', { name: 'Página siguiente' }).click()
          }
          assert.equal(new Set(titulos).size, titulos.length, 'categoría repetida entre ventanas')
          assert.equal(titulos.length, M, `las ventanas muestran ${titulos.length} de ${M} categorías`)
          assert.ok(respuestas.length > 0 && respuestas.every((n) => n <= 40), `una respuesta trajo más de 40 filas: ${JSON.stringify(respuestas)}`)
          // Todas alcanzables también desde la barra de categorías.
          await page.getByRole('button', { name: /^Categorías/ }).click()
          assert.equal(await page.locator('#lista-categorias button').count(), M)
          await page.locator('#lista-categorias button').last().click()
          await page.getByRole('button', { name: /Todas las categorías/ }).waitFor({ timeout: 20000 })
          await page.waitForFunction(() => document.querySelectorAll('article').length >= 1, null, { timeout: 20000 })
          await ctx.close()
        })

        await caso(`${nombre}: muchas categorías — sin desborde horizontal y el paginador de categorías cabe en 390 px`, async () => {
          const { ctx, page } = await nuevaPagina(navegador, 390, 844, { isMobile: true, hasTouch: true })
          await abrir(page, c)
          const nav = page.getByRole('navigation', { name: 'Paginación del catálogo' })
          await nav.waitFor({ timeout: 20000 })
          assert.ok(await sinDesborde(page), 'desborde horizontal')
          const caja = await nav.boundingBox()
          assert.ok(caja && caja.x >= 0 && caja.x + caja.width <= 391)
          await ctx.close()
        })

        await caso(`${nombre}: muchas categorías — si falla una ventana se muestra el error con «Reintentar» y se recupera`, async () => {
          const { ctx, page } = await nuevaPagina(navegador)
          await abrir(page, c)
          let bloquear = true
          await ctx.route(new RegExp(`/rest/v1/rpc/${c.tabla}_vitrina_publica`), async (route) => {
            const cuerpo = route.request().postData() ?? ''
            if (bloquear && /"grupo_desde":\s*10/.test(cuerpo)) return route.abort('failed')
            return route.continue()
          })
          await page.getByRole('button', { name: 'Página siguiente' }).click()
          const alerta = page.getByRole('alert')
          await alerta.waitFor({ timeout: 40000 })
          assert.match(await alerta.innerText(), /No se pudieron cargar las categorías/)
          bloquear = false
          await alerta.getByRole('button', { name: 'Reintentar' }).click()
          await page.getByText(/^Página\s*2 de/).waitFor({ timeout: 20000 })
          await page.waitForFunction(() => !document.querySelector('[role="alert"]'), null, { timeout: 20000 })
          await ctx.close()
        })
      }
    } finally {
      escenario('limpiar-categorias')
    }
  }

  await navegador.close()
  const fallos = casos.filter((c) => !c.ok)
  if (SALIDA) {
    fs.mkdirSync(SALIDA, { recursive: true })
    fs.writeFileSync(path.join(SALIDA, 'interfaz.json'), JSON.stringify({ fecha: new Date().toISOString(), app: APP, api: API, casos, total: casos.length, fallos: fallos.length }, null, 1))
  }
  console.log(`\n${casos.length} casos, ${fallos.length} fallos`)
  process.exitCode = fallos.length ? 1 : 0
})().catch((e) => { console.error(e); process.exitCode = 2 })
