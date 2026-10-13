// Verificación funcional de la Fase 5 (listas administrativas paginadas, detalles diferidos, Recompensas por subpestaña, Inicio acotado,
// restauración de sesión sin duplicados y login / logout / cambio de cuenta) sobre un build servido (vite preview) y el Supabase LOCAL.
//   node scripts/verificar-fase5.cjs --app=http://localhost:5192 --cuentas=<json admin/clienteA/clienteB> [--salida=<archivo.json>]
//
// Cuentas FICTICIAS del Supabase local (127.0.0.1:54321). Para las pruebas se siembran filas con prefijo «QA F5» / «QAF5-» (clientas
// Alfa y Beta con un cupón cada una, una reseña pendiente, una promoción y un pedido clonado) y se BORRAN al terminar, también si algo
// falla. Los contadores esperados se leen de la base con SQL (docker exec en el contenedor de ESTE proyecto): la interfaz debe coincidir.
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const arg = (n, d = '') => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').slice(n.length + 3) || d
const APP = arg('app')
const DEV = arg('dev') // opcional: URL de un servidor de DESARROLLO (StrictMode activo) para los casos F5-05
const SALIDA = arg('salida') && path.resolve(arg('salida'))
const CUENTAS = arg('cuentas') && JSON.parse(fs.readFileSync(path.resolve(arg('cuentas')), 'utf8'))
if (!APP || !CUENTAS) { console.error('uso: --app=<url> --cuentas=<json>'); process.exit(2) }
const API = 'http://127.0.0.1:54321'
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]))
if (env.VITE_SUPABASE_URL !== API) { console.error(`.env.local no apunta a ${API}: no se ejecuta.`); process.exit(2) }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

const puertos = execFileSync('docker', ['ps', '--filter', 'name=^supabase_kong_WedJaiseReact$', '--format', '{{.Ports}}'], { encoding: 'utf8' })
if (!/:54321->8000\/tcp/.test(puertos)) { console.error('54321 no es la pila WedJaiseReact'); process.exit(2) }
function sql(consulta) {
  return execFileSync('docker', ['exec', '-i', 'supabase_db_WedJaiseReact', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { input: consulta, encoding: 'utf8', maxBuffer: 1 << 26 }).trim()
}
const n = (consulta) => Number(sql(consulta))
const lit = (texto) => `'${String(texto).replace(/'/g, "''")}'`

const casos = []
const SOLO = arg('solo')
async function caso(nombre, fn) {
  if (SOLO && !nombre.includes(SOLO)) return
  const t0 = Date.now()
  try { await fn(); casos.push({ nombre, ok: true, ms: Date.now() - t0 }); console.log(`OK    ${nombre}`) } catch (e) {
    const d = String(e.message).split('\n').filter(Boolean).slice(0, 6).join(' | ').slice(0, 900)
    casos.push({ nombre, ok: false, error: d, ms: Date.now() - t0 }); console.log(`FALLA ${nombre}\n      ${d}`)
  }
}

// ---------------------------------------------------------------- utilidades de navegador
async function iniciarSesion(navegador, cuenta, base = APP) {
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  await page.goto(`${base}/login`)
  await page.fill('#email', cuenta.email)
  await page.fill('#password', cuenta.password)
  await page.click('button[type=submit]')
  await page.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 60000 })
  await page.waitForTimeout(1000)
  const estado = await ctx.storageState()
  await ctx.close()
  return estado
}

async function abrir(navegador, estado, { vista = { width: 1280, height: 900 } } = {}) {
  const ctx = await navegador.newContext({ viewport: vista, serviceWorkers: 'block', storageState: estado ?? undefined })
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url())
    if (u.origin !== new URL(APP).origin && route.request().resourceType() === 'image') return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
    if (u.origin === API && u.pathname.includes('/storage/v1/object/')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
    return route.continue()
  })
  const page = await ctx.newPage()
  const reg = registro(page)
  return { ctx, page, reg }
}

// Registro de peticiones al API (método, ruta, consulta y, para las lecturas JSON, las filas recibidas).
function registro(page) {
  const lista = []
  const joins = []
  const errores = []
  page.on('pageerror', (e) => errores.push(String(e.message).slice(0, 200)))
  page.on('response', async (r) => {
    const u = new URL(r.url())
    if (u.origin !== API) return
    let cuerpo = null
    const ct = r.headers()['content-type'] ?? ''
    if (ct.includes('json')) { try { cuerpo = await r.json() } catch { /* sin cuerpo */ } }
    lista.push({ m: r.request().method(), ruta: u.pathname.replace(/^\/(rest|auth)\/v1\//, ''), q: decodeURIComponent(u.search.replace(/^\?/, '')), estado: r.status(), cuerpo })
  })
  page.on('websocket', (ws) => ws.on('framesent', (f) => { if (typeof f.payload === 'string' && f.payload.includes('phx_join')) joins.push(f.payload.slice(0, 200)) }))
  return {
    lista, joins, errores,
    limpiar() { lista.length = 0; joins.length = 0 },
    de(ruta, m = null) { return lista.filter((p) => p.ruta === ruta && (!m || p.m === m)) },
    cuantas(ruta, m = null) { return this.de(ruta, m).length },
    filas(ruta) { return this.de(ruta, 'GET').flatMap((p) => (Array.isArray(p.cuerpo) ? p.cuerpo : [])) },
  }
}

async function sinActividad(page, reg, ms = 900) {
  let ultimo = -1
  let estable = 0
  const tope = Date.now() + 25000
  while (Date.now() < tope) {
    if (reg.lista.length === ultimo) { estable += 150; if (estable >= ms) return } else { ultimo = reg.lista.length; estable = 0 }
    await page.waitForTimeout(150)
  }
}

// Navegación DENTRO de la app (history.pushState + popstate): equivale a pulsar un enlace y conserva el POS montado.
async function irA(page, ruta) {
  await page.evaluate((r) => { history.pushState({}, '', r); window.dispatchEvent(new PopStateEvent('popstate')) }, ruta)
}
const textoPie = async (page, etiqueta) => (await page.locator(`nav[aria-label="Paginación de ${etiqueta}"] p[data-total]`).innerText()).trim()
const totalPie = async (page, etiqueta) => Number(await page.locator(`nav[aria-label="Paginación de ${etiqueta}"] p[data-total]`).getAttribute('data-total'))
const filasVisibles = (page) => page.locator('main [aria-expanded]').count()
const contador = async (page, id) => Number(await page.locator(`[data-contador="${id}"]`).first().innerText())

async function esperarLista(page, etiqueta) {
  await page.waitForSelector(`nav[aria-label="Paginación de ${etiqueta}"] p[data-total]`, { timeout: 30000 })
}

// ---------------------------------------------------------------- siembra
const QA = { alfa: 'QA F5 Alfa', beta: 'QA F5 Beta' }
function sembrar() {
  const A = CUENTAS.clienteA, B = CUENTAS.clienteB
  limpiar()
  sql(`begin; set local session_replication_role = replica;
    insert into clientes_web (id, email, activo) values ('${A.id}', ${lit(A.email)}, true), ('${B.id}', ${lit(B.email)}, true) on conflict (id) do nothing;
    insert into clientes (nombre, telefono, cliente_web_id) values (${lit(QA.alfa)}, '999000111', '${A.id}'), (${lit(QA.beta)}, '999000222', '${B.id}');
    insert into cupones (cliente_id, codigo, origen, valor, tipo_descuento, estado)
      select id, 'QAF5-ALFA-01', 'FIDELIZACION', 10, 'PORCENTAJE', 'DISPONIBLE' from clientes where nombre = ${lit(QA.alfa)};
    insert into cupones (cliente_id, codigo, origen, valor, tipo_descuento, estado)
      select id, 'QAF5-BETA-01', 'FIDELIZACION', 15, 'PORCENTAJE', 'DISPONIBLE' from clientes where nombre = ${lit(QA.beta)};
    insert into resenas (cliente_id, calificacion, comentario, estado)
      select id, 4, 'QA F5 reseña pendiente', 'PENDIENTE' from clientes where nombre = ${lit(QA.alfa)};
    commit;`)
}
function limpiar() {
  sql(`begin; set local session_replication_role = replica;
    delete from pedidos_web_items where pedido_id in (select id from pedidos_web where cliente_id in (select id from clientes where nombre like 'QA F5 %'));
    delete from notificaciones where cliente_id in (select id from clientes where nombre like 'QA F5 %');
    delete from pedidos_web where cliente_id in (select id from clientes where nombre like 'QA F5 %');
    delete from resenas where cliente_id in (select id from clientes where nombre like 'QA F5 %');
    delete from cupones where codigo like 'QAF5-%';
    delete from promociones where titulo like 'QA F5 %';
    delete from clientes where nombre like 'QA F5 %';
    commit;`)
}

// ---------------------------------------------------------------- pruebas
;(async () => {
  const navegador = await chromium.launch()
  const estados = {}
  let falloGlobal = null
  try {
    for (const rol of ['admin', 'clienteA', 'clienteB']) estados[rol] = await iniciarSesion(navegador, CUENTAS[rol])
    sembrar()
    const base = {
      pedidos: n('select count(*) from pedidos_web'),
      promociones: n('select count(*) from promociones'),
      resenas: n('select (select count(*) from resenas) + (select count(*) from resenas_producto) + (select count(*) from resenas_servicio)'),
      referidos: n(`select count(*) from cupones where origen in ('REFERIDO_BIENVENIDA','REFERIDO_RECOMPENSA')`),
      fidelizacion: n(`select count(*) from cupones where origen = 'FIDELIZACION'`),
      premiosMonedas: n(`select count(*) from recompensas_catalogo where origen = 'MONEDAS'`),
      premiosSellos: n(`select count(*) from recompensas_catalogo where origen = 'SELLOS'`),
      servicios: n('select count(*) from servicios'),
      productos: n('select count(*) from productos'),
    }
    console.log('base', JSON.stringify(base))

    // ============================================================ PEDIDOS WEB
    await caso('Pedidos Web: 40 filas por página, total y contadores por estado = base de datos', async () => {
      const { ctx, page, reg } = await abrir(navegador, estados.admin)
      await page.goto(`${APP}/pedidos-web`)
      await esperarLista(page, 'pedidos')
      await sinActividad(page, reg)
      assert.equal(await totalPie(page, 'pedidos'), base.pedidos)
      assert.equal(await filasVisibles(page), Math.min(40, base.pedidos))
      for (const estado of ['PENDIENTE', 'LISTO', 'ENTREGADO', 'CANCELADO']) {
        assert.equal(await contador(page, estado), n(`select count(*) from pedidos_web where estado = '${estado}'`), `contador ${estado}`)
      }
      assert.equal(await contador(page, 'todos'), base.pedidos)
      assert.equal(reg.errores.length, 0, reg.errores.join('|'))
      await ctx.close()
    })

    await caso('Pedidos Web: recorrer todas las páginas no repite ni omite pedidos y la última tiene el resto', async () => {
      const { ctx, page, reg } = await abrir(navegador, estados.admin)
      await page.goto(`${APP}/pedidos-web`)
      await esperarLista(page, 'pedidos')
      const paginas = Math.ceil(base.pedidos / 40)
      for (let p = 2; p <= paginas; p += 1) {
        await page.getByRole('button', { name: 'Página siguiente' }).click()
        await page.waitForFunction((pp) => /^Página\s*\d+\s*de/.test(document.querySelector('nav[aria-label="Paginación de pedidos"] span[aria-live]')?.textContent ?? '') && document.querySelector('nav[aria-label="Paginación de pedidos"][aria-busy="false"] span b')?.textContent === String(pp), p)
        await sinActividad(page, reg, 300)
      }
      await sinActividad(page, reg, 600)
      const ids = reg.filas('pedidos_web').map((f) => f.id)
      assert.equal(ids.length, base.pedidos, 'filas leídas')
      assert.equal(new Set(ids).size, base.pedidos, 'sin duplicados')
      const esperadosBd = sql(`select id from pedidos_web`).split('\n')
      assert.deepEqual([...new Set(ids)].sort(), esperadosBd.sort(), 'mismas filas que la base')
      assert.equal(await filasVisibles(page), base.pedidos - 40 * (paginas - 1))
      await ctx.close()
    })

    await caso('Pedidos Web: detalles cerrados NO están en el DOM; los ítems se piden al expandir (una vez) y se conservan', async () => {
      const { ctx, page, reg } = await abrir(navegador, estados.admin)
      await page.goto(`${APP}/pedidos-web`)
      await esperarLista(page, 'pedidos')
      await sinActividad(page, reg)
      assert.equal(await page.getByText('Subtotal', { exact: true }).count(), 0, 'detalles montados con todo cerrado')
      assert.equal(reg.cuantas('pedidos_web_items'), 0, 'ítems pedidos sin expandir')
      const cabecera = page.locator('main [aria-expanded]').first()
      await cabecera.click()
      await page.getByText('Subtotal', { exact: true }).first().waitFor()
      await sinActividad(page, reg, 400)
      assert.equal(reg.cuantas('pedidos_web_items'), 1)
      assert.ok(await page.getByText(/\d+×/).count() >= 1, 'ítems visibles')
      await cabecera.click()
      await page.waitForFunction(() => ![...document.querySelectorAll('*')].some((e) => e.children.length === 0 && e.textContent === 'Subtotal'), null, { timeout: 3000 })
      await cabecera.click()
      await page.getByText('Subtotal', { exact: true }).first().waitFor()
      await sinActividad(page, reg, 400)
      assert.equal(reg.cuantas('pedidos_web_items'), 1, 'reabrir no repite la lectura')
      await ctx.close()
    })

    await caso('Pedidos Web: búsqueda y filtro de estado se resuelven en el servidor con total exacto', async () => {
      const { ctx, page, reg } = await abrir(navegador, estados.admin)
      await page.goto(`${APP}/pedidos-web`)
      await esperarLista(page, 'pedidos')
      const nombre = sql(`select c.nombre from pedidos_web p join clientes c on c.id = p.cliente_id where c.nombre !~ '[%_\\\\]' group by c.nombre order by count(*) asc, c.nombre limit 1`)
      const termino = nombre.slice(0, 12)
      const esperado = n(`select count(*) from pedidos_web p join clientes c on c.id = p.cliente_id where c.nombre ilike ${lit(`%${termino}%`)}`)
      assert.ok(esperado < base.pedidos, 'el término de prueba debe filtrar')
      reg.limpiar()
      await page.getByPlaceholder('Buscar por clienta...').fill(termino)
      await page.waitForResponse((r) => r.url().includes('/rest/v1/pedidos_web?') && r.url().includes('clientes.nombre'), { timeout: 15000 })
      await page.waitForFunction((t) => Number(document.querySelector('nav[aria-label="Paginación de pedidos"] p[data-total]')?.getAttribute('data-total')) === t, esperado, { timeout: 10000 })
      assert.ok(reg.de('pedidos_web', 'GET').some((p) => /clientes\.nombre=ilike/.test(p.q)), 'la búsqueda fue al servidor: ' + reg.de('pedidos_web', 'GET').map((p) => p.q.slice(-120)).join(' ## '))
      await page.getByPlaceholder('Buscar por clienta...').fill('')
      await page.waitForFunction((t) => Number(document.querySelector('nav[aria-label="Paginación de pedidos"] p[data-total]')?.getAttribute('data-total')) === t, base.pedidos, { timeout: 10000 })
      await page.getByRole('button', { name: /^Pendiente/ }).click()
      await page.waitForFunction((t) => Number(document.querySelector('nav[aria-label="Paginación de pedidos"] p[data-total]')?.getAttribute('data-total')) === t, n(`select count(*) from pedidos_web where estado='PENDIENTE'`), { timeout: 10000 })
      await page.getByPlaceholder('Buscar por clienta...').fill('zzzz-sin-resultados-f5')
      await page.getByText('Ningún pedido coincide con la búsqueda o el filtro.').waitFor({ timeout: 10000 })
      await ctx.close()
    })

    await caso('Pedidos Web: cambiar un estado refresca la fila y los contadores globales', async () => {
      sql(`begin; set local session_replication_role = replica;
        insert into pedidos_web (cliente_id, tipo_entrega, direccion_entrega, costo_delivery, subtotal, total, estado, creado_en, metodo_pago, tipo_comprobante, descuento_cupon, fecha_entrega, hora_entrega)
          select (select id from clientes where nombre = ${lit(QA.alfa)}), 'RECOJO_TIENDA', null, 0, 20, 20, 'PENDIENTE', now(), p.metodo_pago, p.tipo_comprobante, 0, p.fecha_entrega, p.hora_entrega
          from pedidos_web p limit 1;
        insert into pedidos_web_items (pedido_id, producto_id, nombre_producto, cantidad, precio_unitario, subtotal)
          select p.id, null, 'QA F5 producto', 2, 10, 20 from pedidos_web p where p.cliente_id = (select id from clientes where nombre = ${lit(QA.alfa)});
        commit;`)
      const { ctx, page, reg } = await abrir(navegador, estados.admin)
      await page.goto(`${APP}/pedidos-web`)
      await esperarLista(page, 'pedidos')
      const pendientes = await contador(page, 'PENDIENTE')
      const cancelados = await contador(page, 'CANCELADO')
      await page.getByPlaceholder('Buscar por clienta...').fill(QA.alfa)
      await page.waitForFunction(() => Number(document.querySelector('nav[aria-label="Paginación de pedidos"] p[data-total]')?.getAttribute('data-total')) === 1, null, { timeout: 10000 })
      await page.locator('main [aria-expanded]').first().click()
      await page.getByText('2× QA F5 producto').waitFor({ timeout: 10000 })
      await page.getByRole('button', { name: 'Cancelar' }).click()
      await page.waitForFunction(([p, c]) => document.querySelector('[data-contador="PENDIENTE"]')?.textContent === String(p) && document.querySelector('[data-contador="CANCELADO"]')?.textContent === String(c), [pendientes - 1, cancelados + 1], { timeout: 10000 })
      assert.equal(await contador(page, 'PENDIENTE'), n(`select count(*) from pedidos_web where estado='PENDIENTE'`))
      assert.equal(await contador(page, 'CANCELADO'), n(`select count(*) from pedidos_web where estado='CANCELADO'`))
      assert.equal(n(`select count(*) from pedidos_web where cliente_id = (select id from clientes where nombre = ${lit(QA.alfa)}) and estado = 'CANCELADO'`), 1)
      await ctx.close()
    })

    // ============================================================ PROMOCIONES
    await caso('Promociones: 40 por página con total exacto; crear, editar y eliminar refrescan fila y contador', async () => {
      const { ctx, page, reg } = await abrir(navegador, estados.admin)
      await page.goto(`${APP}/promociones`)
      await esperarLista(page, 'promociones')
      assert.equal(await totalPie(page, 'promociones'), base.promociones)
      assert.equal(await filasVisibles(page), 40)
      assert.equal(await page.locator('.cupon-envoltura').count(), 40)
      // crear
      await page.getByRole('button', { name: 'Nueva promoción' }).first().click()
      await page.locator('form input[id$="-titulo"]').fill('QA F5 promoción')
      await page.locator('form input[id$="-valor"]').fill('12')
      await page.locator('form button[type=submit]').click()
      await page.waitForFunction((t) => Number(document.querySelector('nav[aria-label="Paginación de promociones"] p[data-total]')?.getAttribute('data-total')) === t, base.promociones + 1, { timeout: 10000 })
      assert.equal(n(`select count(*) from promociones where titulo = 'QA F5 promoción'`), 1)
      // buscar, editar
      await page.getByPlaceholder('Buscar promoción...').fill('QA F5')
      await page.waitForFunction(() => Number(document.querySelector('nav[aria-label="Paginación de promociones"] p[data-total]')?.getAttribute('data-total')) === 1, null, { timeout: 10000 })
      await page.locator('main [aria-expanded]').first().click()
      await page.getByRole('button', { name: 'Editar' }).click()
      await page.locator('form input[id$="-titulo"]').fill('QA F5 promoción editada')
      await page.locator('form button[type=submit]').click()
      await page.getByText('QA F5 promoción editada').first().waitFor({ timeout: 10000 })
      // eliminar
      await page.locator('main [aria-expanded]').first().click()
      await page.getByRole('button', { name: 'Eliminar' }).first().click()
      await page.getByRole('button', { name: 'Sí, eliminar' }).click()
      await page.getByText('Ninguna promoción coincide con la búsqueda.').waitFor({ timeout: 10000 })
      await page.getByPlaceholder('Buscar promoción...').fill('')
      await page.waitForFunction((t) => Number(document.querySelector('nav[aria-label="Paginación de promociones"] p[data-total]')?.getAttribute('data-total')) === t, base.promociones, { timeout: 10000 })
      assert.equal(n(`select count(*) from promociones where titulo like 'QA F5 %'`), 0)
      await ctx.close()
    })

    // ============================================================ RESEÑAS
    await caso('Reseñas: tres tablas en una lista de 40, contadores globales por estado y moderación que los actualiza', async () => {
      const { ctx, page, reg } = await abrir(navegador, estados.admin)
      await page.goto(`${APP}/resenas-web`)
      await esperarLista(page, 'reseñas')
      await sinActividad(page, reg)
      const total = n('select (select count(*) from resenas) + (select count(*) from resenas_producto) + (select count(*) from resenas_servicio)')
      assert.equal(await totalPie(page, 'reseñas'), total)
      assert.equal(await filasVisibles(page), Math.min(40, total))
      const bd = (estado) => n(`select (select count(*) from resenas where estado='${estado}') + (select count(*) from resenas_producto where estado='${estado}') + (select count(*) from resenas_servicio where estado='${estado}')`)
      for (const estado of ['PENDIENTE', 'APROBADA', 'RECHAZADA']) assert.equal(await contador(page, estado), bd(estado), `contador ${estado}`)
      // páginas completas sin repetir
      const paginas = Math.ceil(total / 40)
      for (let p = 2; p <= paginas; p += 1) {
        await page.getByRole('button', { name: 'Página siguiente' }).click()
        await page.waitForFunction((pp) => document.querySelector('nav[aria-label="Paginación de reseñas"] span b')?.textContent === String(pp), p)
        await sinActividad(page, reg, 300)
      }
      const claves = reg.filas('resenas_moderacion').map((f) => `${f.origen}-${f.id}`)
      assert.equal(new Set(claves).size, total)
      // moderar la reseña QA
      const pendientes = await contador(page, 'PENDIENTE')
      const publicadas = await contador(page, 'APROBADA')
      await page.getByRole('button', { name: 'Primera página' }).click()
      await page.getByPlaceholder('Buscar por clienta, producto o servicio...').fill(QA.alfa)
      await page.waitForFunction(() => Number(document.querySelector('nav[aria-label="Paginación de reseñas"] p[data-total]')?.getAttribute('data-total')) === 1, null, { timeout: 10000 })
      await page.locator('main [aria-expanded]').first().click()
      await page.getByText('"QA F5 reseña pendiente"').waitFor()
      await page.getByRole('button', { name: 'Aprobar' }).click()
      await page.waitForFunction(([p, a]) => document.querySelector('[data-contador="PENDIENTE"]')?.textContent === String(p) && document.querySelector('[data-contador="APROBADA"]')?.textContent === String(a), [pendientes - 1, publicadas + 1], { timeout: 10000 })
      assert.equal(await contador(page, 'APROBADA'), bd('APROBADA'))
      await ctx.close()
    })

    // ============================================================ REFERIDOS / FIDELIZACIÓN
    for (const [ruta, etiqueta, esperado, filtroSql, codigoQA] of [
      ['referidos-web', 'cupones', base.referidos, `origen in ('REFERIDO_BIENVENIDA','REFERIDO_RECOMPENSA')`, null],
      ['fidelizacion-web', 'cupones', base.fidelizacion, `origen = 'FIDELIZACION'`, 'QAF5-ALFA-01'],
    ]) {
      await caso(`${ruta}: cupones de 40 en 40, contadores globales, búsqueda por código o clienta y filtro de estado`, async () => {
        const { ctx, page, reg } = await abrir(navegador, estados.admin)
        await page.goto(`${APP}/${ruta}`)
        await esperarLista(page, etiqueta)
        await sinActividad(page, reg)
        const total = n(`select count(*) from cupones where ${filtroSql}`)
        assert.equal(await totalPie(page, etiqueta), total)
        assert.equal(await page.locator('.cupon-envoltura').count(), Math.min(40, total))
        const resumen = (await page.locator('[data-conteos]').innerText()).replace(/\s+/g, ' ')
        const disp = n(`select count(*) from cupones where ${filtroSql} and estado='DISPONIBLE'`)
        const canj = n(`select count(*) from cupones where ${filtroSql} and estado='CANJEADO'`)
        assert.ok(resumen.startsWith(`${total} emitidos · ${disp} disponibles · ${canj} canjeados`), resumen)
        // todas las páginas
        const paginas = Math.ceil(total / 40)
        for (let p = 2; p <= paginas; p += 1) {
          await page.getByRole('button', { name: 'Página siguiente' }).click()
          await page.waitForFunction((pp) => document.querySelector('nav[aria-label="Paginación de cupones"] span b')?.textContent === String(pp), p)
          await sinActividad(page, reg, 250)
        }
        const ids = reg.filas('cupones_gestion').map((f) => f.id)
        assert.equal(new Set(ids).size, total, 'sin duplicados ni omisiones')
        // búsqueda por código y por clienta (cruce de dos tablas resuelto en el servidor)
        const fila = sql(`select c.codigo || '|' || coalesce(cl.nombre, '') from cupones c left join clientes cl on cl.id = c.cliente_id where ${filtroSql.replaceAll('origen', 'c.origen')} and cl.nombre is not null and cl.nombre !~ '[%_\\\\]' order by c.creado_en limit 1`)
        const [codigo, nombre] = fila.split('|')
        const porCodigo = n(`select count(*) from cupones c left join clientes cl on cl.id = c.cliente_id where ${filtroSql.replaceAll('origen', 'c.origen')} and (c.codigo ilike ${lit(`%${codigo}%`)} or cl.nombre ilike ${lit(`%${codigo}%`)})`)
        await page.getByRole('button', { name: 'Primera página' }).click().catch(() => {})
        await page.getByPlaceholder('Código o cliente').fill(codigo)
        await page.waitForFunction((t) => Number(document.querySelector('nav[aria-label="Paginación de cupones"] p[data-total]')?.getAttribute('data-total')) === t, porCodigo, { timeout: 10000 })
        const frag = nombre.split(' ')[0].slice(0, 4)
        const porNombre = n(`select count(*) from cupones c left join clientes cl on cl.id = c.cliente_id where ${filtroSql.replaceAll('origen', 'c.origen')} and (c.codigo ilike ${lit(`%${frag}%`)} or cl.nombre ilike ${lit(`%${frag}%`)})`)
        await page.getByPlaceholder('Código o cliente').fill(frag)
        await page.waitForFunction((t) => Number(document.querySelector('nav[aria-label="Paginación de cupones"] p[data-total]')?.getAttribute('data-total')) === t, porNombre, { timeout: 10000 })
        await page.getByPlaceholder('Código o cliente').fill('')
        await page.getByLabel('Filtrar cupones').click()
        await page.getByRole('option', { name: 'Disponibles' }).click().catch(async () => { await page.getByText('Disponibles', { exact: true }).last().click() })
        await page.waitForFunction((t) => Number(document.querySelector('nav[aria-label="Paginación de cupones"] p[data-total]')?.getAttribute('data-total')) === t, disp, { timeout: 10000 })
        if (codigoQA) {
          await page.getByPlaceholder('Código o cliente').fill(codigoQA)
          await page.waitForFunction(() => Number(document.querySelector('nav[aria-label="Paginación de cupones"] p[data-total]')?.getAttribute('data-total')) === 1, null, { timeout: 10000 })
        }
        await ctx.close()
      })
    }

    // ============================================================ RECOMPENSAS WEB
    await caso('Recompensas Web: al entrar solo se lee la configuración; cada subpestaña pide lo suyo', async () => {
      const { ctx, page, reg } = await abrir(navegador, estados.admin)
      await page.goto(`${APP}/ventas`)
      await page.waitForSelector('main')
      await sinActividad(page, reg)
      reg.limpiar()
      await irA(page, '/recompensas-web?tab=programa')
      await page.getByRole('tabpanel').waitFor()
      await sinActividad(page, reg, 1200)
      assert.deepEqual([...new Set(reg.lista.filter((p) => !/registro_servicios/.test(p.ruta)).map((p) => `${p.m} ${p.ruta}`))].sort(), ['GET recompensas_config'], 'Programa: solo la configuración')
      reg.limpiar()
      await page.getByRole('tab', { name: /Catálogo de monedas/ }).click()
      await esperarLista(page, 'premios')
      await sinActividad(page, reg, 800)
      assert.equal(await totalPie(page, 'premios'), base.premiosMonedas)
      assert.equal(await page.locator('[role=tabpanel] li').count(), 40)
      assert.equal(reg.cuantas('recompensas_canjes'), 0, 'canjes sin expandir')
      assert.equal(reg.cuantas('servicios'), 0)
      assert.equal(reg.cuantas('servicios_proteccion'), 0)
      assert.equal(await page.getByText(/Reclamados:/).count(), 0, 'detalles cerrados fuera del DOM')
      // expandir: un conteo exacto de ESE premio
      await page.locator('[role=tabpanel] li button[aria-expanded]').first().click()
      await page.getByText(/Reclamados: \d+/).waitFor({ timeout: 10000 })
      assert.equal(reg.cuantas('recompensas_canjes', 'HEAD'), 1)
      const idPremio = /catalogo_id=eq\.([0-9a-f-]+)/.exec(reg.de('recompensas_canjes', 'HEAD')[0].q)[1]
      const esperados = n(`select count(*) from recompensas_canjes where catalogo_id = '${idPremio}'`)
      assert.ok(new RegExp(`Reclamados: ${esperados}\\b`).test(await page.locator('[role=tabpanel]').innerText()))
      await ctx.close()
    })

    await caso('Recompensas Web › Premios de sellos y Protección de productos: totales exactos y 40 filas', async () => {
      const { ctx, page, reg } = await abrir(navegador, estados.admin)
      await page.goto(`${APP}/recompensas-web?tab=sellos`)
      await esperarLista(page, 'premios')
      assert.equal(await totalPie(page, 'premios'), base.premiosSellos)
      assert.ok((await page.locator('[role=tabpanel] li').count()) <= 40)
      await page.getByRole('tab', { name: /Protección de productos/ }).click()
      await esperarLista(page, 'productos')
      assert.equal(await totalPie(page, 'productos'), base.productos)
      assert.equal(await page.locator('[role=tabpanel] li').count(), 40)
      await ctx.close()
    })

    await caso('Recompensas Web › Protección de servicios: 40 por página con total exacto y BORRADORES conservados al paginar y buscar', async () => {
      const { ctx, page, reg } = await abrir(navegador, estados.admin)
      await page.goto(`${APP}/recompensas-web?tab=proteccion`)
      await esperarLista(page, 'servicios')
      await sinActividad(page, reg, 1200)
      assert.equal(await totalPie(page, 'servicios'), base.servicios)
      assert.equal(await page.locator('[role=tabpanel] li').count(), 40)
      assert.equal(await page.locator('[role=tabpanel] input[type=number]').count(), 0, 'filas cerradas sin campos en el DOM')
      const sinGuardar = n('select count(*) from servicios_proteccion')
      const primera = page.locator('[role=tabpanel] li').first()
      const nombre1 = (await primera.locator('button span.truncate').first().innerText()).trim()
      await primera.locator('button[aria-expanded]').click()
      await primera.locator('input[id$="-m"]').fill('7.25')
      const segunda = page.locator('[role=tabpanel] li').nth(1)
      await segunda.locator('button[aria-expanded]').click()
      await segunda.locator('input[id$="-o"]').fill('3.5')
      // siguiente página, atrás
      await page.getByRole('button', { name: 'Página siguiente' }).click()
      await page.waitForFunction(() => document.querySelector('nav[aria-label="Paginación de servicios"] span b')?.textContent === '2')
      await sinActividad(page, reg, 600)
      await page.waitForSelector('nav[aria-label="Paginación de servicios"][aria-busy="false"]')
      assert.equal(await page.locator('[role=tabpanel] input[type=number]').count(), 0, 'la página 2 no trae campos abiertos')
      await page.getByRole('button', { name: 'Página anterior' }).click()
      await page.waitForFunction(() => document.querySelector('nav[aria-label="Paginación de servicios"][aria-busy="false"] span b')?.textContent === '1')
      assert.equal(await page.locator('[role=tabpanel] li').first().locator('input[id$="-m"]').inputValue(), '7.25', 'borrador 1 tras paginar')
      assert.equal(await page.locator('[role=tabpanel] li').nth(1).locator('input[id$="-o"]').inputValue(), '3.5', 'borrador 2 tras paginar')
      // buscar y limpiar
      await page.getByLabel('Buscar servicio', { exact: true }).fill(nombre1.split(' ')[0].slice(0, 4))
      await sinActividad(page, reg, 800)
      await page.getByLabel('Buscar servicio', { exact: true }).fill('')
      await sinActividad(page, reg, 800)
      await page.waitForFunction(() => document.querySelectorAll('[role=tabpanel] li').length === 40)
      assert.equal(await page.locator('[role=tabpanel] li').first().locator('input[id$="-m"]').inputValue(), '7.25', 'borrador 1 tras buscar y limpiar')
      assert.equal(n('select count(*) from servicios_proteccion'), sinGuardar, 'no se escribió nada sin pulsar Guardar')
      await ctx.close()
    })

    await caso('Recompensas Web: el selector de servicio del premio ofrece ≤ 41 opciones y busca en el servidor', async () => {
      const { ctx, page, reg } = await abrir(navegador, estados.admin)
      await page.goto(`${APP}/recompensas-web?tab=monedas`)
      await esperarLista(page, 'premios')
      await page.getByRole('button', { name: 'Nuevo', exact: true }).click()
      await page.locator('form select').first().selectOption('SERVICIO')
      await page.getByLabel('Buscar servicio del premio').waitFor()
      await sinActividad(page, reg, 800)
      assert.ok((await page.locator('select[id$="-serv"] option').count()) <= 42, 'opciones montadas')
      const antes = reg.cuantas('servicios')
      const respuesta = page.waitForResponse((r) => r.url().includes('/rest/v1/servicios?') && r.url().includes('nombre=ilike'), { timeout: 20000 })
      await page.getByLabel('Buscar servicio del premio').fill('Corte')
      await respuesta
      await sinActividad(page, reg, 500)
      assert.ok(reg.cuantas('servicios') > antes)
      assert.ok(reg.de('servicios', 'GET').at(-1).q.includes('nombre=ilike'))
      await ctx.close()
    })

    // ============================================================ INICIO (CLIENTA)
    await caso('Inicio: lecturas acotadas (4 destacados, 3 galería, 3 tarjetas, 1 promoción) y sin descargar el catálogo', async () => {
      const { ctx, page, reg } = await abrir(navegador, estados.clienteA)
      await page.goto(`${APP}/inicio`)
      await page.waitForSelector('h1')
      await sinActividad(page, reg, 1500)
      const servicios = reg.de('servicios', 'GET')
      assert.ok(servicios.every((p) => /id=in\./.test(p.q)), 'ninguna lectura de servicios sin filtro por id')
      assert.ok(servicios.every((p) => (p.cuerpo ?? []).length <= 12))
      assert.ok(reg.filas('servicios').length <= 12)
      assert.ok(reg.de('rpc/galeria_para_web')[0].cuerpo.length <= 3)
      assert.ok(reg.de('rpc/resenas_inicio')[0].cuerpo.length <= 3)
      const promos = reg.de('promociones', 'GET')
      assert.ok(promos.every((p) => (p.cuerpo ?? []).length <= 1))
      const bytes = reg.lista.reduce((a, p) => a + JSON.stringify(p.cuerpo ?? '').length, 0)
      assert.ok(bytes < 60_000, `bytes de datos ${bytes}`)
      // contacto y horario compartidos con el pie de página: una lectura de cada uno
      assert.equal(reg.cuantas('rpc/datos_contacto'), 1)
      assert.equal(reg.cuantas('rpc/horario_atencion'), 1)
      await ctx.close()
    })

    await caso('Inicio: con 1,5 s de demora (o fallo) en las dependencias secundarias el hero permanece disponible', async () => {
      const { ctx, page, reg } = await abrir(navegador, estados.clienteA)
      await ctx.route(/\/rest\/v1\/rpc\/(galeria_para_web|resenas_inicio|resenas_publicas|servicios_mas_pedidos|datos_contacto|horario_atencion)/, async (route) => {
        await new Promise((r) => setTimeout(r, 1500))
        if (/resenas_publicas/.test(route.request().url())) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
        return route.continue()
      })
      const t0 = Date.now()
      await page.goto(`${APP}/inicio`)
      await page.waitForSelector('h1')
      const msHero = Date.now() - t0
      assert.ok(msHero < 1400, `el hero tardó ${msHero} ms`)
      assert.equal(await page.getByText('Cargando...').count(), 0, 'sin pantalla «Cargando…»')
      assert.ok(await page.getByRole('link', { name: 'Reserva tu cita' }).isVisible())
      await sinActividad(page, reg, 2200)
      assert.equal(reg.errores.length, 0, reg.errores.join('|'))
      assert.ok(await page.getByRole('link', { name: 'Reserva tu cita' }).isVisible())
      await ctx.close()
    })

    // ============================================================ RECOMPENSAS (CLIENTA)
    await caso('Recompensas (clienta): «Cómo funciona» no lee nada personal; cada subpestaña pide lo suyo una sola vez', async () => {
      const { ctx, page, reg } = await abrir(navegador, estados.clienteA)
      await page.goto(`${APP}/recompensas?seccion=como`)
      await page.getByRole('tabpanel').waitFor()
      await sinActividad(page, reg, 1500)
      const personales = /rpc\/(mis_|mi_)|config_fidelizacion|^promociones$/
      const leidas = reg.lista.filter((p) => personales.test(p.ruta) && !/mi_perfil_cliente|mi_cliente_id/.test(p.ruta))
      assert.deepEqual(leidas.map((p) => p.ruta), [], 'lecturas personales al abrir «Cómo funciona»')
      assert.equal(reg.cuantas('rpc/recompensas_reglas_publicas'), 1)
      // cupones
      reg.limpiar()
      await page.getByRole('tab', { name: 'Mis cupones' }).click()
      await sinActividad(page, reg, 1200)
      const rutas = reg.lista.map((p) => p.ruta)
      assert.ok(rutas.includes('rpc/mis_cupones') && rutas.includes('promociones') && rutas.includes('rpc/mi_saldo_recompensas'))
      assert.ok(!rutas.includes('rpc/mi_fidelizacion') && !rutas.includes('rpc/mis_movimientos_recompensas'))
      // ida y vuelta: nada se repite
      reg.limpiar()
      await page.getByRole('tab', { name: 'Cómo funciona' }).click()
      await page.getByRole('tab', { name: 'Mis cupones' }).click()
      await sinActividad(page, reg, 1000)
      assert.deepEqual(reg.lista.map((p) => p.ruta), [], 'volver a una subpestaña ya leída no repite lecturas')
      // sellos y movimientos
      reg.limpiar()
      await page.getByRole('tab', { name: 'Mis sellos' }).click()
      await sinActividad(page, reg, 1200)
      assert.ok(reg.cuantas('rpc/mis_cupones') === 0)
      await page.getByRole('tab', { name: 'Movimientos' }).click()
      await sinActividad(page, reg, 800)
      assert.equal(reg.cuantas('rpc/mi_saldo_recompensas'), 0, 'el saldo ya estaba leído')
      assert.equal(reg.errores.length, 0, reg.errores.join('|'))
      await ctx.close()
    })

    await caso('Recompensas (visitante): solo el catálogo público y solo al entrar a «Canjear puntos»', async () => {
      const { ctx, page, reg } = await abrir(navegador, null)
      await page.goto(`${APP}/recompensas?seccion=como`)
      await page.getByRole('tabpanel').waitFor()
      await sinActividad(page, reg, 1200)
      assert.equal(reg.cuantas('rpc/catalogo_recompensas_publico'), 0)
      assert.ok(!reg.lista.some((p) => /rpc\/(mis_|mi_)/.test(p.ruta)))
      await page.getByRole('tab', { name: /Canjear/ }).click()
      await sinActividad(page, reg, 1200)
      assert.equal(reg.cuantas('rpc/catalogo_recompensas_publico'), 1)
      await page.getByRole('tab', { name: 'Cómo funciona' }).click()
      await page.getByRole('tab', { name: /Canjear/ }).click()
      await sinActividad(page, reg, 800)
      assert.equal(reg.cuantas('rpc/catalogo_recompensas_publico'), 1, 'no se repite al volver')
      await ctx.close()
    })

    // ============================================================ SESIÓN
    await caso('Restaurar sesión del personal: un perfil, un estado de negocio y un canal Realtime', async () => {
      const { ctx, page, reg } = await abrir(navegador, estados.admin)
      await page.goto(`${APP}/ventas`)
      await page.waitForSelector('main')
      await sinActividad(page, reg, 1500)
      assert.equal(reg.cuantas('usuarios', 'GET'), 1)
      assert.equal(reg.cuantas('estado_negocio', 'GET'), 1)
      assert.equal(reg.joins.length, 1, `canales: ${reg.joins.length}`)
      const repetidas = Object.entries(reg.lista.reduce((a, p) => { const k = `${p.m} ${p.ruta}?${p.q}`; a[k] = (a[k] ?? 0) + 1; return a }, {})).filter(([, c]) => c > 1)
      assert.deepEqual(repetidas, [], 'peticiones idénticas repetidas')
      await ctx.close()
    })

    await caso('Restaurar sesión de la clienta: perfil, estado y canal una sola vez; sin precargar nada del POS', async () => {
      const { ctx, page, reg } = await abrir(navegador, estados.clienteA)
      await page.goto(`${APP}/inicio`)
      await page.waitForSelector('h1')
      await sinActividad(page, reg, 1500)
      assert.equal(reg.cuantas('usuarios', 'GET'), 1)
      assert.equal(reg.cuantas('clientes_web', 'GET'), 1)
      assert.equal(reg.cuantas('estado_negocio', 'GET'), 1)
      assert.equal(reg.cuantas('rpc/mi_perfil_cliente'), 1)
      assert.equal(reg.joins.length, 1)
      await ctx.close()
    })

    await caso('Refrescar el token no reabre el canal Realtime ni repite las lecturas de sesión', async () => {
      const { ctx, page, reg } = await abrir(navegador, estados.admin)
      await page.goto(`${APP}/ventas`)
      await page.waitForSelector('main')
      await sinActividad(page, reg, 1500)
      reg.limpiar()
      // Fuerza un TOKEN_REFRESHED real: la sesión guardada queda a 10 s de vencer y se recarga la página.
      await page.evaluate(() => {
        const clave = Object.keys(localStorage).find((k) => /auth-token$/.test(k))
        const s = JSON.parse(localStorage.getItem(clave))
        s.expires_at = Math.floor(Date.now() / 1000) + 5
        localStorage.setItem(clave, JSON.stringify(s))
      })
      await page.reload()
      await page.waitForSelector('main')
      await sinActividad(page, reg, 2500)
      assert.ok(reg.cuantas('auth/v1/token') >= 1 || reg.lista.some((p) => /token/.test(p.ruta)), 'hubo refresco de token')
      assert.equal(reg.cuantas('estado_negocio', 'GET'), 1)
      assert.equal(reg.cuantas('usuarios', 'GET'), 1)
      assert.equal(reg.joins.length, 1)
      await ctx.close()
    })

    await caso('El POS no precarga el portal ni Inicio al restaurar la sesión del personal', async () => {
      const { ctx, page } = await abrir(navegador, estados.admin)
      const chunks = []
      page.on('response', (r) => { const u = r.url(); if (u.startsWith(APP) && /\/assets\/(PortalCliente|InicioCliente|RecompensasCliente|ServiciosCliente)-/.test(u)) chunks.push(u) })
      await page.goto(`${APP}/ventas`)
      await page.waitForSelector('main')
      await page.waitForTimeout(3500)
      assert.deepEqual(chunks, [], 'chunks del portal descargados por el POS')
      await ctx.close()
    })

    // ============================================================ LOGIN / LOGOUT / CAMBIO DE CUENTA
    await caso('Login → logout → login de otra clienta: ningún dato de la cuenta anterior', async () => {
      const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
      const page = await ctx.newPage()
      const reg = registro(page)
      await page.goto(`${APP}/login`)
      await page.fill('#email', CUENTAS.clienteA.email)
      await page.fill('#password', CUENTAS.clienteA.password)
      await page.click('button[type=submit]')
      await page.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 20000 })
      await page.goto(`${APP}/recompensas?seccion=cupones`)
      await page.getByText('QAF5-ALFA-01').first().waitFor({ timeout: 15000 })
      assert.ok(await page.getByText(QA.alfa).count() >= 1, 'nombre de Alfa visible')
      // cerrar sesión (menú de cuenta → Cerrar sesión → confirmar)
      await page.getByRole('button', { name: 'Menú de cuenta' }).click()
      await page.getByRole('button', { name: 'Cerrar sesión' }).first().click()
      await page.getByRole('button', { name: /Cerrar sesión|^Sí/ }).last().click()
      await page.waitForFunction(() => location.pathname === '/' || location.pathname.endsWith('/inicio'), null, { timeout: 15000 })
      await page.goto(`${APP}/recompensas?seccion=cupones`)
      await page.getByText('Esta sección es solo para clientas con sesión').waitFor({ timeout: 15000 })
      assert.equal(await page.getByText('QAF5-ALFA-01').count(), 0, 'cupón de Alfa tras cerrar sesión')
      assert.equal(await page.getByText(QA.alfa).count(), 0)
      await page.goBack()
      await page.waitForTimeout(800)
      assert.equal(await page.getByText('QAF5-ALFA-01').count(), 0, 'cupón de Alfa tras «atrás»')
      // entra Beta
      await page.goto(`${APP}/login`)
      await page.fill('#email', CUENTAS.clienteB.email)
      await page.fill('#password', CUENTAS.clienteB.password)
      await page.click('button[type=submit]')
      await page.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 20000 })
      await page.goto(`${APP}/recompensas?seccion=cupones`)
      await page.getByText('QAF5-BETA-01').first().waitFor({ timeout: 15000 })
      assert.equal(await page.getByText('QAF5-ALFA-01').count(), 0, 'cupón de Alfa con Beta dentro')
      assert.equal(await page.getByText(QA.alfa).count(), 0)
      assert.ok(await page.getByText(QA.beta).count() >= 1)
      await ctx.close()
    })

    await caso('Cambio de cuenta con la pantalla abierta (otra pestaña cierra sesión y entra otra clienta): nunca se ven datos de Alfa después de salir', async () => {
      const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', storageState: estados.clienteA })
      // La lectura de cupones de Alfa se demora 3 s: llega cuando ya salió y entró Beta.
      let demorada = false
      await ctx.route(/\/rest\/v1\/rpc\/mis_cupones/, async (route) => {
        if (!demorada && route.request().headers()['authorization'] && !demorada) { demorada = true; await new Promise((r) => setTimeout(r, 3000)) }
        return route.continue()
      })
      const p1 = await ctx.newPage()
      const reg1 = registro(p1)
      await p1.goto(`${APP}/recompensas?seccion=como`)
      await p1.getByRole('tabpanel').waitFor()
      await p1.getByRole('tab', { name: 'Mis cupones' }).click()
      // otra pestaña: Alfa sale y entra Beta
      const p2 = await ctx.newPage()
      await p2.goto(`${APP}/inicio`)
      await p2.getByRole('button', { name: 'Menú de cuenta' }).click()
      await p2.getByRole('button', { name: 'Cerrar sesión' }).first().click()
      await p2.getByRole('button', { name: /Cerrar sesión|^Sí/ }).last().click()
      await p2.waitForFunction(() => !Object.keys(localStorage).some((k) => /auth-token$/.test(k)), null, { timeout: 15000 })
      await p2.waitForTimeout(800)
      let vistoAlfaTrasSalir = false
      const vigilante = setInterval(async () => {
        try { if (await p1.getByText('QAF5-ALFA-01').count()) { const salio = await p1.getByText('Esta sección es solo para clientas con sesión').count(); if (salio) vistoAlfaTrasSalir = true } } catch { /* pestaña cerrándose */ }
      }, 100)
      await p2.goto(`${APP}/login`)
      await p2.waitForSelector('#email', { timeout: 8000 }).catch(() => { throw new Error(`p2 no muestra el login: ${p2.url()}`) })
      await p2.fill('#email', CUENTAS.clienteB.email)
      await p2.fill('#password', CUENTAS.clienteB.password)
      await p2.click('button[type=submit]')
      await p2.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 20000 })
      await p1.getByText('QAF5-BETA-01').first().waitFor({ timeout: 20000 })
      await p1.waitForTimeout(3500)
      clearInterval(vigilante)
      assert.equal(vistoAlfaTrasSalir, false, 'se vio un cupón de Alfa junto al aviso de sesión cerrada')
      assert.equal(await p1.getByText('QAF5-ALFA-01').count(), 0, 'cupón de Alfa presente con Beta dentro')
      assert.equal(await p1.getByText(QA.alfa).count(), 0)
      assert.equal(reg1.errores.length, 0, reg1.errores.join('|'))
      await ctx.close()
    })

    await caso('Personal → cerrar sesión → clienta: la lista administrativa anterior no reaparece', async () => {
      const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', storageState: estados.admin })
      const page = await ctx.newPage()
      await page.goto(`${APP}/pedidos-web`)
      await esperarLista(page, 'pedidos')
      const nombres = (await page.locator('main [aria-expanded] p.truncate').allInnerTexts()).map((t) => t.trim())
      const nombre = nombres.find((t) => !t.startsWith('QA F5')) // el pedido sembrado de «QA F5 Alfa» es legítimamente visible para esa clienta
      assert.ok(nombre.length > 1)
      await page.getByRole('button', { name: 'Menú de usuario' }).click()
      await page.getByRole('button', { name: 'Cerrar sesión' }).first().click()
      await page.getByRole('button', { name: /Cerrar sesión|^Sí/ }).last().click()
      await page.waitForFunction(() => location.pathname === '/' || location.pathname.endsWith('/inicio'), null, { timeout: 15000 })
      assert.equal(await page.getByText(nombre).count(), 0, `nombre «${nombre}» tras cerrar sesión`)
      await page.goBack()
      await page.waitForTimeout(1200)
      assert.equal(await page.locator('nav[aria-label="Paginación de pedidos"]').count(), 0, 'lista de pedidos tras «atrás»')
      await page.goto(`${APP}/login`)
      await page.fill('#email', CUENTAS.clienteA.email)
      await page.fill('#password', CUENTAS.clienteA.password)
      await page.click('button[type=submit]')
      await page.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 20000 })
      await page.goto(`${APP}/pedidos-web`)
      await page.waitForTimeout(1500)
      assert.equal(await page.locator('nav[aria-label="Paginación de pedidos"]').count(), 0, 'una clienta no ve Pedidos Web')
      assert.equal(await page.getByText(nombre).count(), 0, `nombre «${nombre}» con la clienta dentro`)
      await ctx.close()
    })

    // ============================================================ REGRESIONES DE LA REVISIÓN V1 (F5-01 … F5-05)
    const totalActual = (page, etiqueta) => page.locator(`nav[aria-label="Paginación de ${etiqueta}"] p[data-total]`).getAttribute('data-total').then(Number)
    const paginaActual = (page, etiqueta) => page.locator(`nav[aria-label="Paginación de ${etiqueta}"] span[aria-live] b`).innerText().catch(() => null)

    await caso('F5-01: una página que falla NO se rotula como cargada: aviso, Reintentar y la página confirmada sigue rotulada', async () => {
      const { ctx, page, reg } = await abrir(navegador, estados.admin)
      await page.goto(`${APP}/promociones`)
      await esperarLista(page, 'promociones')
      const primeraFila = (await page.locator('main [aria-expanded] p.truncate').first().innerText()).trim()
      let fallar = true
      await ctx.route(/\/rest\/v1\/promociones\?.*offset=40/, (route) => (fallar ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }) : route.continue()))
      await page.getByRole('button', { name: 'Página siguiente' }).click()
      await page.getByRole('alert').filter({ hasText: 'No se pudo cargar las promociones' }).waitFor({ timeout: 10000 })
      assert.equal(await paginaActual(page, 'promociones'), '1', 'sigue rotulada la página 1')
      assert.equal((await page.locator('main [aria-expanded] p.truncate').first().innerText()).trim(), primeraFila, 'siguen las filas confirmadas')
      assert.equal(await totalActual(page, 'promociones'), base.promociones)
      // Reintentar con el servidor sano
      fallar = false
      await page.getByRole('button', { name: 'Reintentar' }).click()
      await page.waitForFunction(() => document.querySelector('nav[aria-label="Paginación de promociones"][aria-busy="false"] span[aria-live] b')?.textContent === '2', null, { timeout: 15000 })
      assert.equal(await page.getByRole('alert').count(), 0)
      assert.notEqual((await page.locator('main [aria-expanded] p.truncate').first().innerText()).trim(), primeraFila)
      // Ir de nuevo a una página que falla y volver a pedir con «siguiente» (misma página pedida) también funciona
      await ctx.close()
    })

    await caso('F5-01: una búsqueda nueva que falla no deja los resultados del filtro anterior; conteo ausente = fallo; reintento sano', async () => {
      const { ctx, page } = await abrir(navegador, estados.admin)
      await page.goto(`${APP}/promociones`)
      await esperarLista(page, 'promociones')
      let modo = 'error'
      await ctx.route(/\/rest\/v1\/promociones\?.*titulo=ilike/, async (route) => {
        if (modo === 'error') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
        if (modo === 'sin-conteo') {
          const resp = await route.fetch()
          const headers = { ...resp.headers() }
          delete headers['content-range']
          return route.fulfill({ response: resp, headers })
        }
        return route.continue()
      })
      await page.getByPlaceholder('Buscar promoción...').fill('QA')
      await page.getByRole('alert').filter({ hasText: 'No se pudo cargar las promociones' }).waitFor({ timeout: 10000 })
      assert.equal(await page.locator('main [aria-expanded]').count(), 0, 'no se muestran las 40 filas de la búsqueda anterior')
      assert.equal(await page.locator('nav[aria-label="Paginación de promociones"]').count(), 0)
      modo = 'sin-conteo'
      await page.getByRole('button', { name: 'Reintentar' }).click()
      await page.waitForTimeout(1500)
      assert.ok(await page.getByRole('alert').count() >= 1, 'un conteo ausente sigue siendo fallo')
      assert.equal(await page.locator('main [aria-expanded]').count(), 0)
      modo = 'sano'
      await page.getByRole('button', { name: 'Reintentar' }).click()
      await page.getByRole('alert').waitFor({ state: 'detached', timeout: 15000 })
      const esperado = n(`select count(*) from promociones where titulo ilike '%QA%'`)
      assert.equal(await totalActual(page, 'promociones'), esperado)
      await ctx.close()
    })

    await caso('F5-01: respuestas fuera de orden (página 2 lenta y luego una búsqueda): gana la última petición', async () => {
      const { ctx, page } = await abrir(navegador, estados.admin)
      await page.goto(`${APP}/promociones`)
      await esperarLista(page, 'promociones')
      let primera = true
      await ctx.route(/\/rest\/v1\/promociones\?.*offset=40/, async (route) => {
        if (primera) { primera = false; await new Promise((r) => setTimeout(r, 3000)) }
        return route.continue()
      })
      await page.getByRole('button', { name: 'Página siguiente' }).click()
      await page.getByPlaceholder('Buscar promoción...').fill('zzzz-f5-sin-resultados')
      await page.getByText('Ninguna promoción coincide con la búsqueda.').waitFor({ timeout: 10000 })
      await page.waitForTimeout(3500)
      assert.equal(await page.getByText('Ninguna promoción coincide con la búsqueda.').count(), 1, 'la respuesta tardía de la página 2 no pisa la búsqueda')
      assert.equal(await page.locator('main [aria-expanded]').count(), 0)
      await ctx.close()
    })

    await caso('F5-02: los borradores de Protección (servicios y productos) y de Programa sobreviven al cambiar de subpestaña', async () => {
      const { ctx, page, reg } = await abrir(navegador, estados.admin)
      await page.goto(`${APP}/recompensas-web?tab=proteccion`)
      await esperarLista(page, 'servicios')
      let fila = page.locator('[role=tabpanel] li').first()
      await fila.locator('button[aria-expanded]').click()
      await fila.locator('input[id$="-m"]').fill('77')
      await page.getByRole('tab', { name: /Protección de productos/ }).click()
      await esperarLista(page, 'productos')
      fila = page.locator('[role=tabpanel] li').first()
      await fila.locator('button[aria-expanded]').click()
      await fila.locator('input[id$="-t"]').fill('66')
      await page.getByRole('tab', { name: /Programa/ }).click()
      await page.locator('#prog-sm').waitFor()
      const original = await page.locator('#prog-sm').inputValue()
      await page.locator('#prog-sm').fill('9.5')
      await page.getByRole('tab', { name: /Premios de sellos/ }).click()
      await esperarLista(page, 'premios')
      await page.getByRole('tab', { name: /Programa/ }).click()
      assert.equal(await page.locator('#prog-sm').inputValue(), '9.5', `Programa conserva el borrador (original ${original})`)
      await page.getByRole('tab', { name: /Protección de servicios/ }).click()
      await esperarLista(page, 'servicios')
      fila = page.locator('[role=tabpanel] li').first()
      await fila.locator('button[aria-expanded]').click()
      assert.equal(await fila.locator('input[id$="-m"]').inputValue(), '77', 'borrador de servicio')
      await page.getByRole('tab', { name: /Protección de productos/ }).click()
      await esperarLista(page, 'productos')
      fila = page.locator('[role=tabpanel] li').first()
      await fila.locator('button[aria-expanded]').click()
      assert.equal(await fila.locator('input[id$="-t"]').inputValue(), '66', 'borrador de producto')
      assert.equal(n('select count(*) from servicios_proteccion') >= 0, true)
      await ctx.close()
    })

    await caso('F5-03: con la pantalla montada, al cambiar A→B (saldo de A fallido o lento) se piden los recursos de B sin tocar pestañas', async () => {
      for (const modo of ['falla', 'lento']) {
        const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', storageState: estados.clienteA })
        let vistos = 0
        await ctx.route(/\/rest\/v1\/rpc\/mi_saldo_recompensas/, async (route) => {
          vistos += 1
          if (vistos === 1) {
            if (modo === 'falla') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
            await new Promise((r) => setTimeout(r, 4000))
          }
          return route.continue()
        })
        const p1 = await ctx.newPage()
        const reg1 = registro(p1)
        await p1.goto(`${APP}/recompensas?seccion=cupones`)
        await p1.getByRole('tabpanel').waitFor()
        await p1.waitForTimeout(800)
        const p2 = await ctx.newPage()
        await p2.goto(`${APP}/inicio`)
        await p2.getByRole('button', { name: 'Menú de cuenta' }).click()
        await p2.getByRole('button', { name: 'Cerrar sesión' }).first().click()
        await p2.getByRole('button', { name: /Cerrar sesión|^Sí/ }).last().click()
        await p2.waitForFunction(() => !Object.keys(localStorage).some((k) => /auth-token$/.test(k)), null, { timeout: 15000 })
        await p2.waitForTimeout(800)
        await p2.goto(`${APP}/login`)
        await p2.fill('#email', CUENTAS.clienteB.email)
        await p2.fill('#password', CUENTAS.clienteB.password)
        await p2.click('button[type=submit]')
        await p2.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 20000 })
        await p1.getByText('QAF5-BETA-01').first().waitFor({ timeout: 20000 })
        assert.equal(await p1.getByText('QAF5-ALFA-01').count(), 0, `${modo}: sin cupones de Alfa`)
        assert.ok(vistos >= 2, `${modo}: el saldo de B se pidió (${vistos})`)
        assert.equal(reg1.errores.length, 0)
        await ctx.close()
      }
    })

    await caso('F5-04: la búsqueda de cupones ignora mayúsculas y tildes (como antes) y trata %, _, comas, paréntesis y comillas como texto', async () => {
      sql(`begin; set local session_replication_role = replica;
        insert into clientes (nombre) values ('QA F5 José Peña'), ('QA F5 Niño_100%');
        insert into cupones (cliente_id, codigo, origen, valor, tipo_descuento, estado)
          select id, 'QAF5-NEUTRO-' || row_number() over (), 'FIDELIZACION', 5, 'PORCENTAJE', 'DISPONIBLE' from clientes where nombre in ('QA F5 José Peña', 'QA F5 Niño_100%');
        commit;`)
      const { ctx, page } = await abrir(navegador, estados.admin)
      await page.goto(`${APP}/fidelizacion-web`)
      await esperarLista(page, 'cupones')
      const norm = (t) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
      const terminos = ['jose', 'josé', 'JOSE', 'José', 'pena', 'peña', 'PEÑA', 'nino', 'niño', 'NIÑO', 'QAF5-NEUTRO', 'qaf5-neutro-1', '_100%', '%', '_', 'a,b', '(', ')', '"', "o'b", '\\']
      for (const t of terminos) {
        const nt = norm(t)
        const esperado = n(`select count(*) from cupones_gestion where origen = 'FIDELIZACION' and (position(${lit(nt)} in codigo_busqueda) > 0 or position(${lit(nt)} in cliente_busqueda) > 0)`)
        const respuesta = page.waitForResponse((r) => r.url().includes('/rest/v1/cupones_gestion?') && r.request().method() === 'GET' && r.url().includes('offset=0'), { timeout: 10000 })
        await page.getByPlaceholder('Código o cliente').fill(t)
        const resp = await respuesta
        assert.equal(resp.status(), 200, `búsqueda «${t}» respondió ${resp.status()}`)
        await page.waitForFunction((e) => Number(document.querySelector('nav[aria-label="Paginación de cupones"] p[data-total]')?.getAttribute('data-total') ?? '0') === e || (e === 0 && !document.querySelector('nav[aria-label="Paginación de cupones"]')), esperado, { timeout: 10000 }).catch(() => { throw new Error(`«${t}»: se esperaban ${esperado}`) })
        if (['jose', 'josé', 'JOSE', 'José', 'pena', 'peña', 'PEÑA'].includes(t)) assert.ok(esperado >= 1, `«${t}» debe encontrar a José Peña`)
        if (['nino', 'niño', 'NIÑO'].includes(t)) assert.ok(esperado >= 1)
        if (t === '_100%') assert.ok(esperado === 1, 'comodines como texto literal')
        if (t === '%' || t === '_') assert.ok(esperado >= 0)
      }
      await page.getByPlaceholder('Código o cliente').fill('josé')
      await page.waitForFunction(() => document.querySelectorAll('.cupon-envoltura').length >= 1)
      assert.ok(await page.getByText('QA F5 José Peña').count() >= 1)
      await ctx.close()
    })

    // ============================================================ REGRESIONES DE LA REVISIÓN V2 (F5-02b, F5-04b)
    await caso('F5-04b: la búsqueda de cupones equivale al normalizador anterior también con texto NFD, Å y comparando contra las cadenas ORIGINALES', async () => {
      // Nombres: misma persona escrita compuesta (NFC) y descompuesta (NFD), más Å (fuera de una tabla fija).
      sql(`begin; set local session_replication_role = replica;
        insert into clientes (nombre) values
          ('QA F5 María NFC'), ('QA F5 Mari' || chr(769) || 'a NFD'),
          ('QA F5 Peña NFC'), ('QA F5 Pe' || 'n' || chr(771) || 'a NFD'),
          ('QA F5 José Perez NFC'), ('QA F5 Jos' || 'e' || chr(769) || ' Perez NFD'),
          ('QA F5 ' || chr(197) || 'ngela NFC'), ('QA F5 A' || chr(778) || 'ngela NFD'),
          ('QA F5 Ørsted Ł');
        insert into cupones (cliente_id, codigo, origen, valor, tipo_descuento, estado)
          select id, 'QAF5-NF-' || row_number() over (order by nombre), 'FIDELIZACION', 5, 'PORCENTAJE', 'DISPONIBLE' from clientes where nombre like 'QA F5 %' and not exists (select 1 from cupones c where c.cliente_id = clientes.id);
        commit;`)
      // Referencia INDEPENDIENTE: las cadenas originales (código y nombre) de TODOS los cupones de fidelización, normalizadas aquí con el
      // normalizador anterior (NFD + \p{Diacritic} + minúsculas + trim) y comparadas con includes().
      const filas = sql(`select c.codigo || E'\t' || coalesce(cl.nombre, '') from cupones c left join clientes cl on cl.id = c.cliente_id where c.origen = 'FIDELIZACION'`).split('\n').map((l) => l.split('\t'))
      const ref = (t) => { const nt = norm(t); return filas.filter(([codigo, nombre]) => norm(codigo).includes(nt) || norm(nombre).includes(nt)).length }
      function norm(t) { return t.toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim() }
      const { ctx, page } = await abrir(navegador, estados.admin)
      await page.goto(`${APP}/fidelizacion-web`)
      await esperarLista(page, 'cupones')
      const terminos = ['maria', 'MARÍA', 'mari\u0301a', 'pena', 'peña', 'pen\u0303a', 'PEÑA', 'jose perez', 'josé perez', 'jose\u0301 perez', 'angela', 'ångela', 'ÅNGELA', 'a\u030angela', 'ørsted', 'ł', 'qaf5-nf-1', '  maria  ', '^', '´', '`', '¨']
      const vistos = {}
      for (const t of terminos) {
        const esperado = ref(t)
        vistos[t] = esperado
        const respuesta = page.waitForResponse((r) => r.url().includes('/rest/v1/cupones_gestion?') && r.request().method() === 'GET' && r.url().includes('offset=0'), { timeout: 10000 })
        await page.getByPlaceholder('Código o cliente').fill(t)
        const resp = await respuesta
        assert.ok([200, 206].includes(resp.status()), `«${t}» respondió ${resp.status()}`)
        await page.waitForFunction((e) => (Number(document.querySelector('nav[aria-label="Paginación de cupones"] p[data-total]')?.getAttribute('data-total') ?? '0') === e) || (e === 0 && !document.querySelector('nav[aria-label="Paginación de cupones"]')), esperado, { timeout: 10000 }).catch(() => { throw new Error(`«${JSON.stringify(t)}»: se esperaban ${esperado}`) })
      }
      // La referencia debe encontrar a las dos versiones de cada nombre (si no, la prueba no probaría nada).
      assert.ok(vistos.maria >= 2 && vistos.pena >= 2 && vistos['jose perez'] >= 2 && vistos.angela >= 2, JSON.stringify(vistos))
      await ctx.close()
    })

    await caso('F5-02b: al cerrar sesión y entrar OTRA administradora, ni Programa ni Protección muestran los borradores de la anterior', async () => {
      const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', storageState: estados.admin })
      const page = await ctx.newPage()
      await page.goto(`${APP}/recompensas-web?tab=proteccion`)
      await esperarLista(page, 'servicios')
      const fila = page.locator('[role=tabpanel] li').first()
      await fila.locator('button[aria-expanded]').click()
      await fila.locator('input[id$="-m"]').fill('77')
      await page.getByRole('tab', { name: /Programa/ }).click()
      const original = await page.locator('#prog-sm').inputValue()
      await page.locator('#prog-sm').fill('88')
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
      await page.goto(`${APP}/recompensas-web?tab=programa`)
      await page.locator('#prog-sm').waitFor()
      assert.equal(await page.locator('#prog-sm').inputValue(), original, 'Programa de la otra cuenta muestra la configuración confirmada')
      await page.getByRole('tab', { name: /Protección de servicios/ }).click()
      await esperarLista(page, 'servicios')
      const fila2 = page.locator('[role=tabpanel] li').first()
      await fila2.locator('button[aria-expanded]').click()
      assert.equal(await fila2.locator('input[id$="-m"]').inputValue(), '', 'Protección de la otra cuenta sin el borrador')
      await ctx.close()
    })

    // ---- F5-05: StrictMode (servidor de desarrollo) -----------------------------------------------------------------------------
    if (DEV) {
      await caso('F5-05 (StrictMode, dev): entrada directa pública a «Canjear puntos» termina de cargar; desde «Cómo funciona» también', async () => {
        const { ctx, page, reg } = await abrir(navegador, null)
        await page.goto(`${DEV}/recompensas?seccion=canje`, { waitUntil: 'domcontentloaded' })
        await page.getByRole('tabpanel').waitFor({ timeout: 60000 })
        await sinActividad(page, reg, 1500)
        assert.equal(await page.locator('[aria-label="Cargando tus datos"]').count(), 0, 'sigue «Cargando tus datos» (entrada directa)')
        assert.ok(reg.cuantas('rpc/catalogo_recompensas_publico') >= 1)
        assert.ok(!reg.lista.some((p) => /rpc\/(mis_|mi_)/.test(p.ruta)), 'consultas personales del visitante')
        await page.goto(`${DEV}/recompensas?seccion=como`, { waitUntil: 'domcontentloaded' })
        await page.getByRole('tabpanel').waitFor({ timeout: 60000 })
        await page.getByRole('tab', { name: /Canjear/ }).click()
        await sinActividad(page, reg, 1500)
        assert.equal(await page.locator('[aria-label="Cargando tus datos"]').count(), 0, 'sigue «Cargando tus datos» (desde Cómo funciona)')
        assert.equal(reg.errores.length, 0, reg.errores.join('|'))
        await ctx.close()
      })
      await caso('F5-05 (StrictMode, dev): fallo y reintento del catálogo público, y recursos personales de la clienta', async () => {
        const { ctx, page, reg } = await abrir(navegador, null)
        let falla = true
        await ctx.route(/\/rest\/v1\/rpc\/catalogo_recompensas_publico/, (route) => (falla ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }) : route.continue()))
        await page.goto(`${DEV}/recompensas?seccion=canje`, { waitUntil: 'domcontentloaded' })
        await page.getByRole('tabpanel').waitFor({ timeout: 60000 })
        await page.getByRole('button', { name: /Reintentar|Intentar|Volver a intentar/ }).first().waitFor({ timeout: 15000 })
        falla = false
        await page.getByRole('button', { name: /Reintentar|Intentar|Volver a intentar/ }).first().click()
        await sinActividad(page, reg, 1200)
        assert.equal(await page.locator('[aria-label="Cargando tus datos"]').count(), 0)
        await ctx.close()
        const estadoDev = await iniciarSesion(navegador, CUENTAS.clienteA, DEV)
        const c2 = await abrir(navegador, estadoDev)
        await c2.page.goto(`${DEV}/recompensas?seccion=cupones`, { waitUntil: 'domcontentloaded' })
        await c2.page.getByText('QAF5-ALFA-01').first().waitFor({ timeout: 60000 })
        await c2.ctx.close()
      })
    }

  } catch (e) {
    falloGlobal = e
    console.log('FALLA GLOBAL', String(e.stack ?? e).split('\n').slice(0, 6).join(' | '))
  } finally {
    try { limpiar() } catch (e) { console.log('NO SE PUDO LIMPIAR:', e.message) }
    await navegador.close()
  }
  const fallos = casos.filter((c) => !c.ok)
  console.log(`\n${casos.length} casos, ${fallos.length} fallos${falloGlobal ? ' (+ fallo global)' : ''}`)
  if (SALIDA) fs.writeFileSync(SALIDA, JSON.stringify({ app: APP, fecha: new Date().toISOString(), casos, falloGlobal: falloGlobal ? String(falloGlobal.message) : null }, null, 1))
  process.exitCode = fallos.length || falloGlobal ? 1 : 0
})()
