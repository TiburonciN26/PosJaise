// Barras flotantes «Tu carrito» / «Tu cita» (Fase 4): conteo sin duplicados, fallos de lectura de precios, recuperación y precio vigente.
//   node scripts/verificar-barras-seleccion.cjs --cuenta=<json con email/password/id> [--app=http://localhost:5173] [--salida=<carpeta>]
//
// Sobre las páginas REALES, con una cuenta FICTICIA del Supabase LOCAL (127.0.0.1:54321). El carrito y la cita de esa cuenta se
// vacían antes y después (solo sus filas, por cliente_web_id). Los fallos (403 / 500 / red) y los precios alternativos se simulan
// interceptando en el navegador las lecturas «por id» y las búsquedas: la base no se modifica salvo el carrito/cita de la cuenta.
// Cubre F4-02 (duplicados), F4-03 (lectura fallida presentada como total), F4-04 (precio viejo al salir de la página),
// F4-04b (una fila antigua de la vitrina no pisa una lectura posterior) y F4-05 (precio vencido + renovación fallida).
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const arg = (n, d = '') => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').slice(n.length + 3) || d
const APP = arg('app', 'http://localhost:5173')
const SALIDA = arg('salida') && path.resolve(arg('salida'))
const CUENTA = arg('cuenta') && JSON.parse(fs.readFileSync(path.resolve(arg('cuenta')), 'utf8'))
if (!CUENTA) { console.error('uso: --cuenta=<json con email/password/id>'); process.exit(2) }
const API = 'http://127.0.0.1:54321'
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]))
if (env.VITE_SUPABASE_URL !== API) { console.error(`.env.local no apunta a ${API}: no se ejecuta.`); process.exit(2) }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

const casos = []
async function caso(nombre, fn) {
  try { await fn(); casos.push({ nombre, ok: true }); console.log(`OK    ${nombre}`) } catch (e) { const d = String(e.message).split('\n').filter(Boolean).slice(0, 5).join(' | ').slice(0, 700); casos.push({ nombre, ok: false, error: d }); console.log(`FALLA ${nombre}\n      ${d}`) }
}

async function api(ruta) {
  const r = await fetch(`${API}/rest/v1/${ruta}`, { headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}` } })
  if (!r.ok) throw new Error(`API ${r.status} ${ruta}`)
  return r.json()
}
// Solo las filas de la cuenta ficticia, y solo en el contenedor de ESTE proyecto.
function limpiarSeleccion() {
  const sql = `delete from carrito_productos where cliente_web_id='${CUENTA.id}'; delete from carrito_servicios where cliente_web_id='${CUENTA.id}'`
  execFileSync('docker', ['exec', 'supabase_db_WedJaiseReact', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql], { encoding: 'utf8' })
}
const soles = (n) => `S/ ${n.toFixed(2)}`

// Interceptación configurable (cfg se cambia durante la prueba).
async function nuevaPagina(navegador, cfg) {
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
  const errores = []
  const porId = []
  // Reloj del navegador desplazable (window.__desfase, en ms) para probar la caducidad de la caché sin esperar.
  await ctx.addInitScript(() => { const n = Date.now.bind(Date); Date.now = () => n() + (window.__desfase || 0) })
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url())
    const metodo = route.request().method()
    if (u.origin === new URL(APP).origin) return route.continue()
    if (u.origin === API) {
      if (route.request().resourceType() === 'image' || u.pathname.includes('/storage/v1/object/')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
      const tabla = /\/rest\/v1\/(productos|servicios)\?/.exec(u.pathname + u.search)?.[1]
      const esPorId = metodo === 'GET' && tabla && /[?&]id=in\./.test(u.search) && !/limit=/.test(u.search)
      if (esPorId) {
        porId.push({ tabla, fallo: cfg.falla ?? null })
        if (cfg.falla === '403') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'forbidden' }) })
        if (cfg.falla === '500') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'boom' }) })
        if (cfg.falla === 'red') return route.abort('failed')
      }
      const reescribir = (esPorId && cfg.precioPorId) || (metodo === 'GET' && tabla && /ilike/.test(u.search) && cfg.precioBusqueda)
      if (reescribir) {
        const mapa = esPorId ? cfg.precioPorId : cfg.precioBusqueda
        const resp = await route.fetch()
        try {
          const cuerpo = await resp.json()
          return route.fulfill({ response: resp, json: cuerpo.map((f) => (mapa[f.id] != null ? { ...f, precio: mapa[f.id] } : f)) })
        } catch { return route.fulfill({ response: resp }) }
      }
      const esVitrina = metodo === 'POST' && /\/rest\/v1\/rpc\/(productos|servicios)_vitrina_publica$/.test(u.pathname)
      const esLista = metodo === 'GET' && tabla && !/ilike/.test(u.search) && !esPorId
      if (cfg.precioInicial && (esVitrina || esLista)) {
        const resp = await route.fetch()
        try {
          const cuerpo = await resp.json()
          return route.fulfill({ response: resp, json: cuerpo.map((f) => (cfg.precioInicial[f.id] != null ? { ...f, precio: cfg.precioInicial[f.id] } : f)) })
        } catch { return route.fulfill({ response: resp }) }
      }
      if (metodo === 'POST' && u.pathname.endsWith('/rest/v1/rpc/servicios_vitrina_publica') && cfg.inyectarServicio) {
        const resp = await route.fetch()
        const filas = await resp.json()
        const s = cfg.inyectarServicio
        const cat = filas[0]?.categoria ?? 'Cabello'
        const resto = filas.filter((f) => f.id !== s.id)
        const primera = resto.findIndex((f) => f.categoria === cat)
        resto.splice(Math.max(0, primera), 0, { ...s, categoria: cat, total_categoria: filas[0]?.total_categoria ?? 5 })
        return route.fulfill({ response: resp, json: resto })
      }
      return route.continue()
    }
    return route.abort()
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errores.push(String(e.message).slice(0, 200)))
  return { ctx, page, errores, porId }
}
async function entrar(page) {
  await page.goto(`${APP}/login`)
  await page.locator('#email').fill(CUENTA.email)
  await page.locator('#password').fill(CUENTA.password)
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30000 })
}
async function agregarProducto(page, id) {
  await page.goto(`${APP}/productos/${id}`)
  await page.getByRole('button', { name: /^Agregar al carrito/ }).click()
  await page.waitForTimeout(1500)
}
async function agregarServicio(page, id) {
  await page.goto(`${APP}/servicios/${id}`)
  await page.getByRole('button', { name: /Agregar a mi cita/ }).click()
  await page.getByRole('button', { name: /Agregado a tu cita/ }).waitFor({ timeout: 20000 })
}
// Texto de la barra flotante (el contenedor de «Ver carrito» / «Reservar»).
const barra = (page, regex) => page.locator('.lw-barra-flotante', { hasText: regex }).first()
const textoBarra = async (page) => (await page.locator('.lw-barra-flotante').first().innerText()).replace(/\s+/g, ' ')
// Espera (hasta `ms`) a que el texto de la barra cumpla `regex`; devuelve el texto. Las lecturas por red fallida se REINTENTAN
// automáticamente (postgrest-js), así que el estado de error puede tardar unos segundos en aparecer.
async function esperarBarra(page, regex, ms = 30000) {
  try {
    await page.waitForFunction((fuente) => {
      const el = document.querySelector('.lw-barra-flotante')
      return Boolean(el) && new RegExp(fuente).test(el.innerText.replace(/\s+/g, ' '))
    }, regex.source, { timeout: ms })
  } catch (e) {
    throw new Error(`la barra no cumplió ${regex} — texto actual: «${await page.locator('.lw-barra-flotante').first().innerText().catch(() => '(sin barra)')}»`.replace(/\s+/g, ' '), { cause: e })
  }
  return textoBarra(page)
}
const escapar = (n) => soles(n).replace('.', '\\.')

;(async () => {
  const navegador = await chromium.launch()
  limpiarSeleccion()
  try {
    // Elementos que NO están en la vitrina inicial ni en las cintas: sin categoría, sin foto, sin marcas de inicio/oferta.
    const [A, B] = await api('productos?select=id,nombre,precio&activo=eq.true&stock_actual=gt.3&destacado=eq.false&precio_antes=is.null&en_inicio=eq.false&nombre=ilike.*TEST PW*&order=nombre.asc,id.asc&limit=2&offset=700')
    const [SA, SB] = await api('servicios?select=id,nombre,precio&activo=eq.true&categoria=is.null&foto_url=is.null&nombre=ilike.*TEST*&order=nombre.asc,id.asc&limit=2&offset=40')
    const pA = Number(A.precio), pB = Number(B.precio), pSA = Number(SA.precio), pSB = Number(SB.precio)
    console.log(`      (productos ${A.id.slice(0, 8)} S/${pA} y ${B.id.slice(0, 8)} S/${pB}; servicios ${SA.id.slice(0, 8)} S/${pSA} y ${SB.id.slice(0, 8)} S/${pSB})`)

    // ---------------- F4-03 · lectura de precios fallida (carrito) ----------------
    const cfg = { falla: null }
    const { ctx, page, errores, porId } = await nuevaPagina(navegador, cfg)
    await entrar(page)
    await agregarProducto(page, A.id)
    await agregarProducto(page, B.id)

    for (const modo of ['403', '500', 'red']) {
      await caso(`F4-03 carrito: la lectura de precios falla (${modo}) → la barra cuenta los 2 productos y NO presenta un subtotal como total; «Reintentar» lo recupera`, async () => {
        cfg.falla = modo
        await page.goto(`${APP}/productos`)
        await page.locator('article').first().waitFor({ timeout: 60000 })
        const texto = await esperarBarra(page, /\b2\s+productos en tu carrito.*Total no disponible/)
        assert.ok(!/S\/\s*\d/.test(texto), `se presentó un importe como total: «${texto}»`)
        cfg.falla = null
        await page.getByRole('button', { name: /Total no disponible · Reintentar/ }).click()
        const final = await esperarBarra(page, new RegExp('\\b2\\s+productos en tu carrito.*' + escapar(pA + pB)))
        assert.ok(!/Total no disponible|calculando/.test(final), `la barra no quedó completa: «${final}»`)
      })
    }

    await caso('F4-03 carrito: recuperación SIN añadir un id distinto — al cambiar la cantidad de un producto la barra vuelve a pedir el precio que faltaba', async () => {
      cfg.falla = '500'
      await page.goto(`${APP}/productos/${B.id}`)
      await esperarBarra(page, /\b2\s+productos en tu carrito.*Total no disponible/)
      cfg.falla = null
      await page.getByRole('button', { name: /^Agregar al carrito/ }).click() // +1 de B (el mismo id; A sigue sin precio conocido)
      const final = await esperarBarra(page, new RegExp('\\b3\\s+productos en tu carrito.*' + escapar(pA + 2 * pB)))
      assert.ok(!/Total no disponible|calculando/.test(final), `no se recuperó sola: «${final}»`)
    })
    await ctx.close()
    limpiarSeleccion()

    // ---------------- F4-04 · precio vigente al salir de la página ----------------
    await caso('F4-04 carrito: un precio actualizado visto en la página NO se revierte al limpiar la búsqueda (la caché se reconcilia con lo que muestra la página)', async () => {
      const cfg4 = { precioPorId: { [A.id]: 20 }, precioBusqueda: { [A.id]: 25 } }
      const { ctx: c4, page: p4 } = await nuevaPagina(navegador, cfg4)
      await entrar(p4)
      await agregarProducto(p4, A.id)
      await p4.goto(`${APP}/productos`)
      await p4.locator('article').first().waitFor({ timeout: 60000 })
      await esperarBarra(p4, new RegExp('\\b1\\s+producto en tu carrito.*' + escapar(20))) // leído por id fuera de la página
      await p4.getByLabel('Buscar producto', { exact: true }).fill(A.nombre)
      await p4.waitForFunction((n) => [...document.querySelectorAll('article')].some((a) => a.innerText.includes(n)), A.nombre, { timeout: 20000 })
      await esperarBarra(p4, new RegExp('\\b1\\s+producto en tu carrito.*' + escapar(25))) // la página trae el precio nuevo
      await p4.getByLabel('Buscar producto', { exact: true }).fill('')
      await p4.waitForFunction(() => !([...document.querySelectorAll('h2')].some((h) => h.textContent.trim() === 'Resultados')), null, { timeout: 10000 })
      await p4.waitForTimeout(1500)
      const final = await textoBarra(p4)
      assert.match(final, new RegExp(escapar(25)), `el precio volvió al anterior: «${final}»`)
      await c4.close()
    })
    limpiarSeleccion()

    // ---------------- F4-03 · lectura de precios fallida (cita) ----------------
    const cfgS = { falla: null }
    const s3 = await nuevaPagina(navegador, cfgS)
    await entrar(s3.page)
    await agregarServicio(s3.page, SA.id)
    await agregarServicio(s3.page, SB.id)
    for (const modo of ['403', '500', 'red']) {
      await caso(`F4-03 cita: la lectura de precios falla (${modo}) → la barra cuenta los 2 servicios y NO presenta un subtotal como total; «Reintentar» lo recupera`, async () => {
        cfgS.falla = modo
        await s3.page.goto(`${APP}/servicios`)
        await s3.page.locator('article').first().waitFor({ timeout: 60000 })
        const texto = await esperarBarra(s3.page, /\b2\s+servicios en tu cita.*Total no disponible/)
        assert.ok(!/S\/\s*\d/.test(texto), `se presentó un importe como total: «${texto}»`)
        cfgS.falla = null
        await s3.page.getByRole('button', { name: /Total no disponible · Reintentar/ }).click()
        const final = await esperarBarra(s3.page, new RegExp('\\b2\\s+servicios en tu cita.*' + escapar(pSA + pSB)))
        assert.ok(!/Total no disponible|calculando/.test(final), `la barra no quedó completa: «${final}»`)
      })
    }
    await s3.ctx.close()
    limpiarSeleccion()

    // ---------------- F4-02 · un servicio en varias piezas de la página cuenta UNA vez ----------------
    await caso('F4-02 cita: un servicio presente a la vez en el héroe y en una fila de categoría cuenta UNA vez y suma su precio UNA vez', async () => {
      const cfgD = {}
      const { ctx: cD, page: pD, errores: eD } = await nuevaPagina(navegador, cfgD)
      await entrar(pD)
      await pD.goto(`${APP}/servicios`)
      await pD.locator('article').first().waitFor({ timeout: 60000 })
      // El servicio activo del héroe (primera diapositiva): se agrega a la cita y luego se duplica en la primera fila de categoría.
      const href = await pD.locator('section a', { hasText: 'Ver detalles' }).first().getAttribute('href')
      const idHero = /\/servicios\/([0-9a-f-]{36})/.exec(href)[1]
      const [fila] = await api(`servicios?id=eq.${idHero}&select=id,nombre,categoria,precio,duracion_min,foto_url,descripcion,en_tendencia`)
      cfgD.inyectarServicio = fila
      await agregarServicio(pD, idHero)
      await pD.goto(`${APP}/servicios`)
      await pD.locator('article').first().waitFor({ timeout: 60000 })
      const apariciones = await pD.locator(`a[href="/servicios/${idHero}"]`).count()
      assert.ok(apariciones >= 2, `la prueba no logró duplicar el servicio en la página (apariciones: ${apariciones})`)
      const texto = await esperarBarra(pD, new RegExp('\\b1\\s+servicio en tu cita.*' + escapar(Number(fila.precio)) + '(?!\\d)'))
      assert.ok(!/\b2\s+servicios/.test(texto), `conteo duplicado: «${texto}»`)
      // Y también si además aparece en los resultados de una búsqueda.
      await pD.getByLabel('Buscar servicio', { exact: true }).fill(fila.nombre)
      await pD.waitForFunction((n) => [...document.querySelectorAll('article')].some((a) => a.innerText.includes(n)), fila.nombre, { timeout: 20000 })
      const textoBusqueda = await esperarBarra(pD, new RegExp('\\b1\\s+servicio en tu cita.*' + escapar(Number(fila.precio)) + '(?!\\d)'))
      assert.ok(!/\b2\s+servicios/.test(textoBusqueda), `conteo duplicado con búsqueda: «${textoBusqueda}»`)
      assert.deepEqual(eD, [])
      await cD.close()
    })

    // ---------------- F4-04b · una fila antigua de la vitrina no pisa una lectura posterior ----------------
    const vitrina = async (rpc) => {
      const r = await fetch(`${API}/rest/v1/rpc/${rpc}`, { method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(rpc.startsWith('servicios') ? { por_categoria: 4, dias: 30, grupo_desde: 0, grupos_max: 10 } : { por_categoria: 4, grupo_desde: 0, grupos_max: 10 }) })
      return r.json()
    }
    const [VP] = await vitrina('productos_vitrina_publica')
    const [VS] = await vitrina('servicios_vitrina_publica')
    for (const t of [
      { nombre: 'carrito', fila: VP, ruta: 'productos', etiqueta: 'Buscar producto', agregar: agregarProducto, singular: 'producto en tu carrito' },
      { nombre: 'cita', fila: VS, ruta: 'servicios', etiqueta: 'Buscar servicio', agregar: agregarServicio, singular: 'servicio en tu cita' },
    ]) {
      await caso(`F4-04b ${t.nombre}: elemento que sigue en la vitrina (S/ 20) → la búsqueda lo confirma a S/ 25 → al limpiar la barra NO vuelve a S/ 20`, async () => {
        limpiarSeleccion()
        const cfg = { precioInicial: { [t.fila.id]: 20 }, precioBusqueda: { [t.fila.id]: 25 } }
        const { ctx: c, page: p } = await nuevaPagina(navegador, cfg)
        await entrar(p)
        await t.agregar(p, t.fila.id)
        await p.goto(`${APP}/${t.ruta}`)
        await p.locator('article').first().waitFor({ timeout: 60000 })
        await esperarBarra(p, new RegExp('\\b1\\s+' + t.singular + '.*' + escapar(20)))
        await p.getByLabel(t.etiqueta, { exact: true }).fill(t.fila.nombre)
        await p.waitForFunction((n) => [...document.querySelectorAll('article')].some((a) => a.innerText.includes(n)), t.fila.nombre, { timeout: 20000 })
        await esperarBarra(p, new RegExp('\\b1\\s+' + t.singular + '.*' + escapar(25)))
        await p.getByLabel(t.etiqueta, { exact: true }).fill('')
        await p.waitForFunction(() => !([...document.querySelectorAll('h2')].some((h) => h.textContent.trim() === 'Resultados')), null, { timeout: 10000 })
        await p.waitForTimeout(1500)
        const final = await textoBarra(p)
        assert.match(final, new RegExp(escapar(25)), `la fila antigua pisó el precio confirmado: «${final}»`)
        assert.ok(!new RegExp(escapar(20) + '(?!\\d)').test(final), `volvió a S/ 20: «${final}»`)
        await c.close()
      })
      limpiarSeleccion()
    }

    // ---------------- F4-05 · precio vencido y renovación fallida ----------------
    for (const t of [
      { nombre: 'carrito', a: A, b: B, ruta: 'productos', etiqueta: 'Buscar producto', agregar: agregarProducto, plural: 'productos en tu carrito', pa: pA, pb: pB },
      { nombre: 'cita', a: SA, b: SB, ruta: 'servicios', etiqueta: 'Buscar servicio', agregar: agregarServicio, plural: 'servicios en tu cita', pa: pSA, pb: pSB },
    ]) {
      for (const modo of ['403', '500', 'red']) {
        await caso(`F4-05 ${t.nombre}: precio en caché vencido (>60 s) y la renovación falla (${modo}) → NO se presenta como total vigente; «Reintentar» lo recupera`, async () => {
          limpiarSeleccion()
          const cfg = { falla: null }
          const { ctx: c, page: p } = await nuevaPagina(navegador, cfg)
          await entrar(p)
          await t.agregar(p, t.a.id)
          await t.agregar(p, t.b.id)
          await p.goto(`${APP}/${t.ruta}`)
          await p.locator('article').first().waitFor({ timeout: 60000 })
          await esperarBarra(p, new RegExp('\\b2\\s+' + t.plural + '.*' + escapar(t.pa + t.pb))) // caché caliente
          await p.evaluate(() => { window.__desfase = 61000 }) // caducan los precios leídos por id
          cfg.falla = modo
          await p.getByLabel(t.etiqueta, { exact: true }).fill('zzz-sin-coincidencias') // cambia la página → el hook intenta renovar
          const texto = await esperarBarra(p, new RegExp('\\b2\\s+' + t.plural + '.*Total no disponible'))
          assert.ok(!/S\/\s*\d/.test(texto), `se presentó un importe vencido como total: «${texto}»`)
          cfg.falla = null
          await p.getByRole('button', { name: /Total no disponible · Reintentar/ }).click()
          const final = await esperarBarra(p, new RegExp('\\b2\\s+' + t.plural + '.*' + escapar(t.pa + t.pb)))
          assert.ok(!/Total no disponible|calculando/.test(final), `no se recuperó: «${final}»`)
          await c.close()
        })
      }
      limpiarSeleccion()
    }
    assert.deepEqual(errores, [])
    assert.ok(porId.length > 0)
  } finally {
    limpiarSeleccion()
    await navegador.close()
  }

  const fallos = casos.filter((c) => !c.ok)
  if (SALIDA) {
    fs.mkdirSync(SALIDA, { recursive: true })
    fs.writeFileSync(path.join(SALIDA, 'barras.json'), JSON.stringify({ fecha: new Date().toISOString(), app: APP, casos, total: casos.length, fallos: fallos.length }, null, 1))
  }
  console.log(`\n${casos.length} casos, ${fallos.length} fallos`)
  process.exitCode = fallos.length ? 1 : 0
})().catch((e) => { console.error(e); process.exitCode = 2 })
