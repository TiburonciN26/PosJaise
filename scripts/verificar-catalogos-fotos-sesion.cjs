// Fotos, navegación y sesión de los catálogos públicos (Fase 4), en Chromium contra la app local y el Supabase LOCAL.
//   node scripts/verificar-catalogos-fotos-sesion.cjs --app=http://localhost:5181 [--cuenta=<json con email/password>] [--salida=<carpeta>]
//
// La app debe servirse con R2 configurado con hosts INEXISTENTES para observar las URLs sin tocar ningún servicio real, p. ej.:
//   VITE_MEDIOS_PROVEEDOR=r2 VITE_MEDIOS_PUBLIC_URL=https://medios.qa.invalid/medios VITE_MEDIOS_API_URL=https://api.qa.invalid \
//   npx vite --port 5181 --strictPort
// Las respuestas de la API se REESCRIBEN en el navegador (foto_url) para cubrir fotos ausentes, rutas antiguas de Storage,
// referencias r2: correctas y referencias cuya imagen falla; nada se escribe en la base. Las peticiones a hosts distintos de la app,
// de 127.0.0.1:54321 y de los .invalid se abortan. La parte con sesión (carrito y cita) usa una cuenta FICTICIA local si se indica.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { chromium } = require('playwright')

const arg = (n, d = '') => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').slice(n.length + 3) || d
const APP = arg('app', 'http://localhost:5181')
const SALIDA = arg('salida') && path.resolve(arg('salida'))
const CUENTA = arg('cuenta') && JSON.parse(fs.readFileSync(path.resolve(arg('cuenta')), 'utf8'))
const API = 'http://127.0.0.1:54321'
const PUBLICO = 'https://medios.qa.invalid/medios'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const BUENA = (i) => `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`
const MALA = (i) => `ffffffff-0000-4000-8000-${String(i).padStart(12, '0')}`

const casos = []
async function caso(nombre, fn) {
  try { await fn(); casos.push({ nombre, ok: true }); console.log(`OK    ${nombre}`) } catch (e) { const detalle = String(e.message).split('\n').filter(Boolean).slice(0, 6).join(' | ').slice(0, 700); casos.push({ nombre, ok: false, error: detalle }); console.log(`FALLA ${nombre}\n      ${detalle}`) }
}

// Reescribe foto_url de las filas de productos que devuelve la API (solo lectura en el navegador).
function reescribir(filas, { todasBuenas = false } = {}) {
  return filas.map((f, i) => {
    if (!('foto_url' in f)) return f
    if (todasBuenas) return { ...f, foto_url: `r2:fotos-productos/${BUENA(i)}` }
    const k = i % 4
    return { ...f, foto_url: k === 0 ? null : k === 1 ? 'ruta/p.webp' : k === 2 ? `r2:fotos-productos/${BUENA(i)}` : `r2:fotos-productos/${MALA(i)}` }
  })
}

async function nuevaPagina(navegador, ancho = 1440, alto = 900) {
  const ctx = await navegador.newContext({ viewport: { width: ancho, height: alto }, serviceWorkers: 'block' })
  const reg = { imagenes: [], fallidas: [], bloqueadas: [], errores: [], abortadas: [] }
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url())
    const tipo = route.request().resourceType()
    if (u.origin === new URL(APP).origin) return route.continue()
    if (u.hostname.endsWith('.invalid') || u.pathname.includes('/storage/v1/object/public/')) {
      if (tipo === 'image') {
        reg.imagenes.push(u.origin === API ? u.pathname : u.href)
        if (u.href.includes('ffffffff-0000')) { reg.fallidas.push(u.href); return route.fulfill({ status: 404, body: '' }) }
        return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
      }
      return route.abort()
    }
    if (u.origin === API) {
      const metodo = route.request().method()
      const esLectura = (metodo === 'GET' && /\/rest\/v1\/productos\?/.test(u.pathname + u.search)) || (metodo === 'POST' && u.pathname.endsWith('/rest/v1/rpc/productos_vitrina_publica'))
      if (!esLectura) return route.continue()
      const respuesta = await route.fetch()
      let cuerpo
      try { cuerpo = await respuesta.json() } catch { return route.fulfill({ response: respuesta }) }
      if (!Array.isArray(cuerpo)) return route.fulfill({ response: respuesta })
      return route.fulfill({ response: respuesta, json: reescribir(cuerpo, { todasBuenas: /en_inicio=eq\.true/.test(u.search) }) })
    }
    reg.bloqueadas.push(u.origin)
    return route.abort()
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => reg.errores.push(String(e.message).slice(0, 200)))
  page.on('requestfailed', (r) => { if (r.url().includes('/rest/v1/') && /aborted|ERR_ABORTED/i.test(r.failure()?.errorText ?? '')) reg.abortadas.push(r.url()) })
  return { ctx, page, reg }
}

// El paginador de categorías de «Todos» también es una <nav> «Paginación del catálogo»: se espera al del LISTADO de resultados (dice «de N productos/servicios»).
const esperarListadoPlano = (page) => page.waitForFunction(() => /de \d+ (productos|servicios)/.test(document.querySelector('nav[aria-label="Paginación del catálogo"]')?.innerText ?? ''), null, { timeout: 30000 })
const srcs = (page, sel) => page.$$eval(sel, (is) => is.map((i) => i.currentSrc || i.src))
const precioDe = (texto) => Number(/S\/\s*([\d.]+)/.exec(texto)?.[1])
// Fase 10A: la barra muestra primero «calculando total…» y el importe llega después (lee los precios vigentes). Se espera hasta
// 20 s a que deje de calcular; si nunca termina, el error lo dice (sería un defecto de la barra, no de la prueba).
async function textoBarraConTotal(barra) {
  const padre = barra.locator('xpath=..')
  const fin = Date.now() + 20000
  let t = await padre.innerText()
  while (/calculando/i.test(t) && Date.now() < fin) { await padre.page().waitForTimeout(250); t = await padre.innerText() }
  if (/calculando/i.test(t)) throw new Error(`la barra sigue en «calculando total…» tras 20 s: «${t.replace(/\s+/g, ' ')}»`)
  return t
}

;(async () => {
  const navegador = await chromium.launch()

  // ---------------- fotos ----------------
  await caso('fotos: las tarjetas piden la variante MINIATURA (m) para referencias r2:, la ruta antigua de Storage se conserva y no se piden «g» en las tarjetas', async () => {
    const { ctx, page, reg } = await nuevaPagina(navegador)
    await page.goto(`${APP}/productos`)
    await page.locator('article').first().waitFor({ timeout: 60000 })
    await page.waitForTimeout(1500)
    const enTarjetas = await srcs(page, 'article img')
    assert.ok(enTarjetas.length > 0, 'ninguna tarjeta con foto')
    const r2 = enTarjetas.filter((s) => s.startsWith(PUBLICO))
    assert.ok(r2.length > 0, 'ninguna referencia r2: llegó a una tarjeta')
    assert.ok(r2.every((s) => /\/m\.webp$/.test(s)), `variante inesperada en tarjetas: ${r2.find((s) => !/\/m\.webp$/.test(s))}`)
    assert.ok(enTarjetas.some((s) => s.includes('/storage/v1/object/public/fotos-productos/ruta/p.webp')), 'la ruta antigua de Storage no se conservó')
    assert.deepEqual(reg.errores, [])
    await ctx.close()
  })

  await caso('fotos: el héroe pide «g» solo para la foto activa y sus vecinas (no las 5) y sus miniaturas, «m»', async () => {
    const { ctx, page, reg } = await nuevaPagina(navegador)
    await page.goto(`${APP}/productos`)
    await page.locator('article').first().waitFor({ timeout: 60000 })
    await page.waitForTimeout(1500)
    const grandes = reg.imagenes.filter((u) => u.startsWith(PUBLICO) && /\/g\.webp$/.test(u))
    const hero = await page.$$eval('section img', (is) => is.length)
    assert.ok(hero >= 1, 'el héroe no mostró fotos')
    assert.ok(new Set(grandes).size <= 6, `se pidieron demasiadas fotos grandes: ${new Set(grandes).size}`) // héroe (≤3) + cintas visibles
    await ctx.close()
  })

  await caso('fotos: la primera vista NO pide todas las imágenes montadas (carga diferida: se piden menos de las que hay en el DOM)', async () => {
    const { ctx, page, reg } = await nuevaPagina(navegador, 390, 844)
    await page.goto(`${APP}/productos`)
    await page.locator('article').first().waitFor({ timeout: 60000 })
    await page.waitForTimeout(2000)
    const montadas = await page.$$eval('img', (is) => is.filter((i) => i.getAttribute('src')).length)
    const pedidas = new Set(reg.imagenes).size
    assert.ok(pedidas < montadas, `pedidas ${pedidas} ≥ montadas ${montadas}: no hay carga diferida efectiva`)
    await ctx.close()
  })

  await caso('fotos: las imágenes de la página 2 NO se piden antes de visitarla y sí después', async () => {
    const { ctx, page, reg } = await nuevaPagina(navegador)
    await page.goto(`${APP}/productos`)
    await page.locator('article').first().waitFor({ timeout: 60000 })
    await page.getByLabel('Buscar producto', { exact: true }).fill('TEST')
    await esperarListadoPlano(page)
    await page.waitForFunction(() => document.querySelectorAll('article').length === 40)
    await page.mouse.wheel(0, 20000)
    await page.waitForTimeout(1500)
    const antes = new Set(reg.imagenes)
    await page.getByRole('button', { name: 'Página siguiente' }).click()
    await page.getByText(/^Página\s*2 de/).waitFor()
    await page.waitForFunction(() => document.querySelectorAll('article').length === 40)
    await page.waitForTimeout(1500)
    const despues = new Set(reg.imagenes)
    assert.ok([...despues].some((u) => !antes.has(u)), 'la página 2 no pidió imágenes nuevas')
    await ctx.close()
  })

  await caso('fotos: una imagen que FALLA (404) muestra el degradado, no una imagen rota, y no rompe la página', async () => {
    const { ctx, page, reg } = await nuevaPagina(navegador)
    await page.goto(`${APP}/productos`)
    await page.locator('article').first().waitFor({ timeout: 60000 })
    await page.getByLabel('Buscar producto', { exact: true }).fill('TEST')
    await page.waitForFunction(() => document.querySelectorAll('article').length === 40, null, { timeout: 30000 })
    await page.mouse.wheel(0, 20000)
    await page.waitForTimeout(2500)
    assert.ok(reg.fallidas.length > 0, 'la prueba no provocó ninguna imagen fallida')
    const rotas = await page.$$eval('article img', (is) => is.filter((i) => i.complete && i.naturalWidth === 0).length)
    assert.equal(rotas, 0, `imágenes rotas visibles: ${rotas}`)
    assert.equal(await page.locator('article').count(), 40)
    assert.deepEqual(reg.errores, [])
    await ctx.close()
  })

  // ---------------- navegación y respuestas obsoletas ----------------
  await caso('navegación: salir de la página con una búsqueda en vuelo la cancela y no deja errores', async () => {
    const { ctx, page, reg } = await nuevaPagina(navegador)
    await page.goto(`${APP}/productos`)
    await page.locator('article').first().waitFor({ timeout: 60000 })
    await ctx.route(/\/rest\/v1\/productos\?.*ilike/, async (route) => { await new Promise((r) => setTimeout(r, 3000)); return route.continue().catch(() => {}) })
    await page.getByLabel('Buscar producto', { exact: true }).fill('TEST')
    await page.waitForTimeout(600)
    await page.goto(`${APP}/nosotros`)
    await page.waitForTimeout(3800)
    assert.deepEqual(reg.errores, [])
    await ctx.close()
  })

  // ---------------- sesión: carrito y cita con productos que NO están en la página inicial ----------------
  if (CUENTA) {
    // Fase 10A: el carrito y la cita de la cuenta FICTICIA se vacían antes y después (solo sus filas, por cliente_web_id; mismo criterio
    // que verificar-barras-seleccion.cjs). Antes dependía de que la cuenta empezara vacía: tras una corrida, la siguiente encontraba el
    // servicio ya «Agregado a tu cita» y el carrito con productos de antes.
    if (!/^[0-9a-f-]{36}$/.test(CUENTA.id ?? '')) throw new Error('--cuenta debe incluir el id (uuid) de la cuenta ficticia')
    const limpiarSeleccion = () => execFileSync('docker', ['exec', 'supabase_db_WedJaiseReact', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c',
      `delete from carrito_productos where cliente_web_id='${CUENTA.id}'; delete from carrito_servicios where cliente_web_id='${CUENTA.id}'`], { encoding: 'utf8' })
    limpiarSeleccion()
    const entrar = async (page) => {
      await page.goto(`${APP}/login`)
      await page.locator('#email').fill(CUENTA.email)
      await page.locator('#password').fill(CUENTA.password)
      await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
      await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 })
    }
    // Fase 10A: el paginador muestra «Página N» ~150 ms ANTES de que lleguen las tarjetas de esa página (medido). Antes se leía el texto
    // de la tarjeta i de la página ANTERIOR y, al hacer clic, `nth(i)` ya era otra tarjeta (con datos QA podía estar agotada y la
    // ficha no tenía «Agregar al carrito»). Ahora se espera a que cambie el conjunto de tarjetas y se hace clic en el enlace EXACTO
    // (por su href) de la tarjeta cuyo texto se leyó.
    const hrefsTarjetas = (page) => page.$$eval('article', (as) => as.map((a) => a.querySelector('a')?.getAttribute('href') ?? ''))
    const elegirTarjeta = async (page, { pagina, conStock }) => {
      for (let p = 1; p < pagina; p++) {
        const previas = (await hrefsTarjetas(page)).join('|')
        await page.getByRole('button', { name: 'Página siguiente' }).click()
        await page.getByText(new RegExp(`^Página\\s*${p + 1} de`)).waitFor()
        await page.waitForFunction((antes) => {
          const ahora = [...document.querySelectorAll('article')].map((a) => a.querySelector('a')?.getAttribute('href') ?? '').join('|')
          return ahora.length > 0 && ahora !== antes
        }, previas, { timeout: 30000 })
      }
      const tarjetas = await page.$$eval('article', (as) => as.map((a) => ({ texto: a.innerText, href: a.querySelector('a')?.getAttribute('href') ?? '' })))
      const elegida = tarjetas.find((t) => t.href && (!conStock || /En stock|Últimas/.test(t.texto)))
      if (!elegida) throw new Error('sin tarjeta elegible en la página')
      const enlace = page.locator(`article a[href="${elegida.href}"]`).first()
      // Centrada en pantalla: la barra flotante «Tu carrito / Tu cita» (fija abajo) no debe taparle el enlace.
      await enlace.evaluate((el) => el.scrollIntoView({ block: 'center' }))
      return { texto: elegida.texto, precio: precioDe(elegida.texto), enlace }
    }

    await caso('sesión (productos): un producto de la página 3 agregado al carrito aparece en la barra «Tu carrito» con su precio al volver al catálogo', async () => {
      const { ctx, page, reg } = await nuevaPagina(navegador)
      await entrar(page)
      let total = 0
      for (const [n, pagina] of [[1, 3], [2, 5]]) {
        await page.goto(`${APP}/productos`)
        await page.locator('article').first().waitFor({ timeout: 60000 })
        await page.getByLabel('Buscar producto', { exact: true }).fill('TEST PW')
        await esperarListadoPlano(page)
        const { precio, enlace } = await elegirTarjeta(page, { pagina, conStock: true })
        await enlace.click()
        await page.waitForURL(/\/productos\/[0-9a-f-]{36}/)
        await page.getByRole('button', { name: /^Agregar al carrito/ }).click()
        await page.getByRole('button', { name: /^Agregar al carrito|Agregado|En tu carrito/ }).first().waitFor({ timeout: 20000 }).catch(() => {})
        await page.waitForTimeout(1200)
        total += precio
        await page.goto(`${APP}/productos`)
        await page.locator('article').first().waitFor({ timeout: 60000 })
        const barra = page.getByText(new RegExp(`${n}\\s+productos? en tu carrito`))
        await barra.waitFor({ timeout: 20000 })
        const texto = (await textoBarraConTotal(barra)).replace(/\s+/g, ' ')
        assert.ok(Math.abs(precioDe(texto) - total) < 0.011, `total de la barra «${texto}» ≠ ${total.toFixed(2)}`)
      }
      assert.deepEqual(reg.errores, [])
      await ctx.close()
    })

    await caso('sesión (servicios): un servicio de la página 3 agregado a la cita aparece en la barra «Tu cita» con su precio al volver al catálogo', async () => {
      const { ctx, page, reg } = await nuevaPagina(navegador)
      await entrar(page)
      await page.goto(`${APP}/servicios`)
      await page.locator('article').first().waitFor({ timeout: 60000 })
      await page.getByLabel('Buscar servicio', { exact: true }).fill('TEST PW')
      await esperarListadoPlano(page)
      const { precio, enlace } = await elegirTarjeta(page, { pagina: 3, conStock: false })
      await enlace.click()
      await page.waitForURL(/\/servicios\/[0-9a-f-]{36}/)
      await page.getByRole('button', { name: /Agregar a mi cita/ }).click()
      await page.getByRole('button', { name: /Agregado a tu cita/ }).waitFor({ timeout: 20000 })
      await page.goto(`${APP}/servicios`)
      await page.locator('article').first().waitFor({ timeout: 60000 })
      const barra = page.getByText(/1\s+servicio en tu cita/)
      await barra.waitFor({ timeout: 20000 })
      const texto = (await textoBarraConTotal(barra)).replace(/\s+/g, ' ')
      assert.ok(Math.abs(precioDe(texto) - precio) < 0.011, `total de la barra «${texto}» ≠ ${precio.toFixed(2)}`)
      assert.deepEqual(reg.errores, [])
      await ctx.close()
    })
    limpiarSeleccion()
  } else {
    console.log('      (sin --cuenta: se omiten los casos con sesión)')
  }

  await navegador.close()
  const fallos = casos.filter((c) => !c.ok)
  if (SALIDA) {
    fs.mkdirSync(SALIDA, { recursive: true })
    fs.writeFileSync(path.join(SALIDA, 'fotos-sesion.json'), JSON.stringify({ fecha: new Date().toISOString(), app: APP, casos, total: casos.length, fallos: fallos.length }, null, 1))
  }
  console.log(`\n${casos.length} casos, ${fallos.length} fallos`)
  process.exitCode = fallos.length ? 1 : 0
})().catch((e) => { console.error(e); process.exitCode = 2 })
