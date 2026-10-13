// Fase 10B · operaciones esenciales en el PREVIEW de staging con el build exacto del candidato (datos QA ficticios).
//   node scripts/fase10b/flujos-esenciales-staging.cjs --app=https://<id>.pos-jaise.pages.dev --build-id=<8 hex> --salida=<archivo.json>
//   [--solo=venta,carrito,cita]
// venta:   CAJERA vende 1 unidad (Yape) en Ventas → confirmar_venta; la anula en Historial → venta ANULADA y stock restituido.
// carrito: CLIENTA agrega un producto, lo quita, lo vuelve a agregar y confirma un pedido (recojo, Yape, captura generada, SIN
//          pago real) → confirmar_pedido_productos; lo cancela desde «Mis pedidos» → cancelar_mi_pedido_web; carrito vacío.
// cita:    fixture «TEST QA F10B Asistente» (tabla asistentes, sin cuenta); CLIENTA reserva un servicio con esa asistente
//          (agendar_cita_web, captura generada) y la cancela (cancelar_mi_cita_web).
// Guardas: lib/guarda-staging.cjs (Preview y backend de staging exactos antes de cualquier credencial; proxy por contexto).
// Comprobaciones en la base por lectura (scripts/fase10b/psql-staging.mjs). Limpieza en `finally`, solo por id de esta ejecución:
// asistente fixture y citas canceladas de la prueba; la venta anulada y el pedido cancelado quedan como historial QA de staging
// (su stock ya volvió). Las capturas generadas quedan en el Storage de staging con el prefijo de la prueba.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { chromium } = require('playwright')
const S = require('./lib/guarda-staging.cjs')

const RAIZ = path.resolve(__dirname, '..', '..')
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').split('=').slice(1).join('=')
const SOLO = arg('solo') ? arg('solo').split(',') : ['venta', 'carrito', 'cita']
const psql = (sql, escritura = false) => {
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts/fase10b/psql-staging.mjs'), `--sql=${sql}`, ...(escritura ? ['--escritura'] : [])], { encoding: 'utf8', cwd: RAIZ })
  if (r.status !== 0) throw new Error(`psql: ${String(r.stderr).slice(0, 400)}`)
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
}
const uno = (sql) => psql(sql).slice(-1)[0]
const casos = []
async function caso(nombre, fn) {
  try { const detalle = await fn(); casos.push({ nombre, ok: true, detalle }); console.log(`OK    ${nombre}`) } catch (e) {
    const captura = arg('salida') ? arg('salida').replace(/\.json$/, `-falla-${casos.length}.png`) : null
    if (captura && paginaActual) await paginaActual.screenshot({ path: captura, fullPage: true }).catch(() => {})
    const url = paginaActual ? paginaActual.url() : null
    casos.push({ nombre, ok: false, error: String(e.message).slice(0, 900), url, captura }); console.log(`FALLA ${nombre}\n      ${String(e.message).slice(0, 500)} · url=${url}`)
  }
}
const png = () => Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
// Promesa de respuesta con manejador propio: si el paso falla antes de esperarla, no aborta el proceso.
const esperarResp = (page, f) => { const p = page.waitForResponse(f); p.catch(() => {}); return p }
let paginaActual = null
const vb = (page, nombre) => page.getByRole('button', { name: nombre, exact: true }).filter({ visible: true })

async function main() {
  const APP = arg('app')
  const cuentas = S.cuentasStaging()
  const pre = await S.preflight(APP, arg('build-id'))
  const { origen } = S.validarApp(APP)
  casos.push({ nombre: 'Preflight: Preview aprobado, build-id y backend = staging', ok: true, detalle: pre })
  console.log('OK    Preflight: Preview aprobado, build-id y backend = staging')
  const run = crypto.randomBytes(3).toString('hex')
  const navegador = await chromium.launch({ headless: true })
  const guardas = []
  const sesion = async (cuenta, opciones) => {
    const g = S.crearGuarda(); guardas.push(g)
    const ctx = await S.contexto(navegador, APP, g, { timezoneId: 'America/Lima', ...opciones })
    const page = await ctx.newPage()
    page.setDefaultTimeout(20000)
    paginaActual = page
    await S.iniciarSesion(page, APP, cuenta, g)
    return { ctx, page }
  }
  let idAsistente = null
  const producto = 'Agua San Luis 625ml'
  try {
    if (SOLO.includes('venta')) {
      const { ctx, page } = await sesion(cuentas.cajera)
      const stockAntes = Number(uno(`select stock_actual from productos where nombre = '${producto}';`))
      let venta = null
      await caso(`venta: la CAJERA vende 1 «${producto}» con Yape → confirmar_venta OK y el stock baja en 1`, async () => {
        await page.goto(`${origen}/ventas`)
        await page.getByRole('searchbox').first().fill('Agua San Luis')
        await page.getByRole('button', { name: new RegExp(producto) }).first().click()
        await vb(page, 'Yape').click()
        const resp = esperarResp(page, (r) => r.url().includes('/rpc/confirmar_venta'))
        await vb(page, 'Confirmar venta').click()
        const r = await resp
        if (!r.ok()) throw new Error(`confirmar_venta ${r.status()}: ${(await r.text()).slice(0, 300)}`)
        const j = await r.json(); venta = Array.isArray(j) ? j[0] : j
        const stock = Number(uno(`select stock_actual from productos where nombre = '${producto}';`))
        if (stock !== stockAntes - 1) throw new Error(`stock ${stockAntes} → ${stock}`)
        return { codigo: venta.codigo, total: venta.total, stockAntes, stock }
      })
      await caso('venta: la CAJERA la anula en Historial → venta ANULADA y stock restituido', async () => {
        if (!venta) throw new Error('sin venta')
        await page.goto(`${origen}/historial`)
        await page.getByPlaceholder('Buscar por código o cliente...').fill(venta.codigo)
        await page.getByText(venta.codigo.replace(/^VEN/, 'V'), { exact: true }).filter({ visible: true }).first().click()
        await vb(page, 'Anular venta').click()
        const resp = esperarResp(page, (r) => r.url().includes('/rpc/anular_venta'))
        await vb(page, 'Sí, anular').click()
        if (!(await resp).ok()) throw new Error('anular_venta falló')
        await page.getByText('Venta anulada. Se devolvió el stock.', { exact: true }).waitFor()
        const estado = uno(`select estado from ventas where codigo = '${venta.codigo}';`)
        const stock = Number(uno(`select stock_actual from productos where nombre = '${producto}';`))
        if (stock !== stockAntes || !/ANULADA/i.test(estado)) throw new Error(`estado ${estado}, stock ${stock} (antes ${stockAntes})`)
        return { estado, stock }
      })
      await ctx.close()
    }

    // Perfil de la clienta QA: pedidos y citas exigen un perfil completo (mi_cliente_id). Si falta, se completa por la UI real
    // (Mi perfil → Editar → Guardar → vincular_o_crear_cliente_web), como haría una clienta nueva. Persiste como dato QA de staging.
    if (SOLO.includes('carrito') || SOLO.includes('cita')) {
      const tiene = () => Number(uno(`select count(*) from clientes where cliente_web_id = (select id from auth.users where email = '${cuentas.clienta.email}');`))
      if (!tiene()) {
        const { ctx, page } = await sesion(cuentas.clienta)
        await caso('perfil: la CLIENTA QA completa su perfil en Mi perfil → vincular_o_crear_cliente_web OK', async () => {
          await page.goto(`${origen}/mi-perfil`)
          await vb(page, 'Editar').click()
          await page.getByPlaceholder('Nombre completo').fill('TEST QA Clienta Staging')
          await page.locator('#perfil-telefono').fill('900000001')
          const resp = esperarResp(page, (r) => r.url().includes('/rpc/vincular_o_crear_cliente_web'))
          await vb(page, 'Guardar').click()
          const r = await resp
          if (!r.ok()) throw new Error(`vincular_o_crear_cliente_web ${r.status()}: ${(await r.text()).slice(0, 300)}`)
          await page.waitForTimeout(1000)
          if (!tiene()) throw new Error('el perfil no quedó vinculado')
          return { vinculado: true }
        })
        await ctx.close()
      }
    }

    if (SOLO.includes('carrito')) {
      const { ctx, page } = await sesion(cuentas.clienta)
      const idProd = uno(`select id from productos where nombre = '${producto}';`)
      const stockAntes = Number(uno(`select stock_actual from productos where id = '${idProd}';`))
      const enCarrito = () => Number(uno(`select coalesce(sum(cp.cantidad),0) from carrito_productos cp join clientes_web cw on cw.id = cp.cliente_web_id where cw.email = '${cuentas.clienta.email}' and cp.producto_id = '${idProd}';`))
      let pedidoId = null
      await caso('carrito: la CLIENTA agrega el producto desde su ficha, lo quita en el carrito y lo vuelve a agregar', async () => {
        await page.goto(`${origen}/productos/${idProd}`)
        await page.getByRole('button', { name: /^Agregar al carrito/ }).first().click()
        await page.waitForTimeout(1500)
        const a = enCarrito()
        await page.goto(`${origen}/carrito`)
        await page.getByRole('heading', { name: 'Tu carrito', exact: true }).waitFor()
        await page.getByRole('button', { name: `Quitar ${producto} del carrito` }).first().click()
        await page.waitForTimeout(1500)
        const b = enCarrito()
        await page.goto(`${origen}/productos/${idProd}`)
        await page.getByRole('button', { name: /^Agregar al carrito/ }).first().click()
        await page.waitForTimeout(1500)
        const c = enCarrito()
        if (!(a >= 1 && b === 0 && c >= 1)) throw new Error(`carrito: tras agregar ${a}, tras quitar ${b}, tras volver a agregar ${c}`)
        return { tras: { agregar: a, quitar: b, reagregar: c } }
      })
      await caso('carrito: confirma un pedido (recojo, Yape, captura generada; sin pago real) → confirmar_pedido_productos OK', async () => {
        await page.goto(`${origen}/carrito`)
        await vb(page, 'Recojo en tienda').click()
        await vb(page, 'Elige el día').click()
        const dias = page.getByRole('button', { name: /^\d{1,2}$/ }).filter({ visible: true })
        const n = await dias.count()
        let elegido = false
        for (let i = 0; i < n && !elegido; i += 1) { if (await dias.nth(i).isEnabled()) { await dias.nth(i).click(); elegido = true } }
        if (!elegido) throw new Error('no hay días disponibles en el calendario')
        await vb(page, 'Elige la hora').click()
        await page.getByRole('button', { name: /^\d{1,2}:\d{2}$/ }).filter({ visible: true }).first().click()
        await vb(page, 'Yape').click()
        await page.locator('input[type="file"]').first().setInputFiles({ name: `TEST-QA-F10B-${run}-NO-PAGO.png`, mimeType: 'image/png', buffer: png() })
        await page.getByText('Captura adjunta', { exact: true }).first().waitFor()
        await page.locator('#carrito-acepto-terminos').check()
        const resp = esperarResp(page, (r) => r.url().includes('/rpc/confirmar_pedido_productos'))
        await page.getByRole('button', { name: /^Confirmar pedido \(/ }).click()
        const r = await resp
        if (!r.ok()) throw new Error(`confirmar_pedido_productos ${r.status()}: ${(await r.text()).slice(0, 300)}`)
        const j = await r.json(); pedidoId = (Array.isArray(j) ? j[0] : j)?.id ?? (Array.isArray(j) ? j[0] : j)?.pedido_id ?? (typeof j === 'string' ? j : null)
        const fila = uno(`select estado || '|' || total from pedidos_web where id = '${pedidoId}';`)
        if (!fila || !fila.includes('|')) throw new Error(`pedido no encontrado: ${JSON.stringify(j).slice(0, 200)}`)
        return { pedidoId, fila, carritoTras: enCarrito() }
      })
      await caso('carrito: la CLIENTA cancela el pedido en «Mis pedidos» → cancelar_mi_pedido_web OK y el stock queda como antes', async () => {
        if (!pedidoId) throw new Error('sin pedido')
        await page.goto(`${origen}/mi-perfil/pedidos`)
        await vb(page, 'Cancelar pedido').first().click()
        const resp = esperarResp(page, (r) => r.url().includes('/rpc/cancelar_mi_pedido_web'))
        await vb(page, 'Sí, cancelar').click()
        if (!(await resp).ok()) throw new Error('cancelar_mi_pedido_web falló')
        await page.waitForTimeout(1500)
        const estado = uno(`select estado from pedidos_web where id = '${pedidoId}';`)
        const stock = Number(uno(`select stock_actual from productos where id = '${idProd}';`))
        if (!/CANCEL/i.test(estado) || stock !== stockAntes) throw new Error(`estado ${estado}, stock ${stock} (antes ${stockAntes})`)
        return { estado, stock }
      })
      await ctx.close()
    }

    if (SOLO.includes('cita')) {
      idAsistente = psql(`begin; insert into asistentes (nombres_completos, activo) values ('TEST QA F10B Asistente ${run}', true) returning id; commit;`, true).find((l) => /^[0-9a-f-]{36}$/.test(l))
      if (!idAsistente) throw new Error('no se creó la asistente fixture')
      const idServicio = uno('select id from servicios where activo order by nombre limit 1;')
      const { ctx, page } = await sesion(cuentas.clienta)
      let citaId = null
      await caso('cita: la CLIENTA reserva un servicio con la asistente de prueba (horario disponible, captura generada) → agendar_cita_web OK', async () => {
        await page.goto(`${origen}/servicios/${idServicio}`)
        await vb(page, 'Reservar ahora').click()
        await page.waitForURL(/\/citas$/)
        await page.getByRole('link', { name: 'Agendar cita', exact: true }).first().click()
        await page.waitForURL(/\/citas\/carrito$/)
        await page.locator('section[aria-labelledby="carrito-asis-titulo"]').getByRole('button').filter({ hasText: `TEST QA F10B Asistente ${run}` }).first().click()
        const fechas = page.locator('section[aria-labelledby="carrito-fecha-titulo"]')
        const dias = fechas.getByRole('button').filter({ hasText: /^(lun|mar|mié|jue|vie|sáb|dom) \d+$/i })
        const usables = await dias.evaluateAll((xs) => xs.map((x, i) => ({ i, d: x.disabled })).filter((x) => !x.d).map((x) => x.i))
        if (usables.length < 2) throw new Error('no hay días disponibles')
        const disp = esperarResp(page, (r) => r.url().includes('/rpc/horarios_disponibles_cita'))
        await dias.nth(usables[1]).click()
        const horas = await (await disp).json()
        if (!horas.length) throw new Error('sin horarios disponibles')
        await fechas.getByRole('button').filter({ hasText: /^\d{1,2}:\d{2}/ }).first().click()
        await page.getByPlaceholder('Algo que quieras avisar antes de tu cita (opcional)').fill(`TEST QA F10B ${run}`)
        await page.locator('input[type=file]').first().setInputFiles({ name: `TEST-QA-F10B-${run}-NO-PAGO.png`, mimeType: 'image/png', buffer: png() })
        await page.getByText('Captura adjunta', { exact: true }).first().waitFor()
        const terminos = page.locator('input[type=checkbox][id*="acepto-terminos"]').filter({ visible: true })
        if (await terminos.count()) await terminos.first().check()
        const resp = esperarResp(page, (r) => r.url().includes('/rpc/agendar_cita_web'))
        await vb(page, 'Confirmar reserva').click()
        const r = await resp
        if (!r.ok()) throw new Error(`agendar_cita_web ${r.status()}: ${(await r.text()).slice(0, 300)}`)
        await page.waitForURL(/\/citas$/)
        citaId = uno(`select id from citas where asistente_id = '${idAsistente}' order by created_at desc limit 1;`)
        const estado = uno(`select estado from citas where id = '${citaId}';`)
        return { citaId, estado, horariosOfrecidos: horas.length }
      })
      await caso('cita: la CLIENTA la cancela en Mis citas → cancelar_mi_cita_web OK y la cita queda CANCELADA', async () => {
        if (!citaId) throw new Error('sin cita')
        await page.reload()
        const prox = page.locator('section[aria-labelledby="citas-proxima-titulo"]')
        await prox.getByRole('button', { name: 'Cancelar', exact: true }).click()
        const resp = esperarResp(page, (r) => r.url().includes('/rpc/cancelar_mi_cita_web'))
        await vb(page, 'Sí, cancelar').click()
        if (!(await resp).ok()) throw new Error('cancelar_mi_cita_web falló')
        await page.waitForTimeout(1500)
        const estado = uno(`select estado from citas where id = '${citaId}';`)
        if (!/CANCEL/i.test(estado)) throw new Error(`estado ${estado}`)
        return { estado }
      })
      await ctx.close()
    }
    await caso('Guardas: ninguna violación de red en ningún contexto', async () => {
      for (const g of guardas) S.exigirSinViolaciones(g, 'flujos')
      return { contextos: guardas.length, neutralizadas: guardas.reduce((a, g) => a + g.neutralizadas, 0), preconexionesRechazadas: guardas.reduce((a, g) => a + g.preconexionesRechazadas, 0) }
    })
  } finally {
    await navegador.close()
    if (idAsistente) {
      const l = psql(`begin; delete from cita_servicios where cita_id in (select id from citas where asistente_id = '${idAsistente}' and estado ilike 'CANCEL%');
delete from citas where asistente_id = '${idAsistente}' and estado ilike 'CANCEL%';
delete from asistentes where id = '${idAsistente}' and not exists (select 1 from citas where asistente_id = '${idAsistente}');
select (select count(*) from asistentes where id = '${idAsistente}') || '|' || (select count(*) from citas where asistente_id = '${idAsistente}'); commit;`, true).find((x) => /^\d+\|\d+$/.test(x))
      casos.push({ nombre: 'Limpieza: asistente fixture y su cita cancelada borradas por id', ok: l === '0|0', detalle: l })
      console.log(`${l === '0|0' ? 'OK   ' : 'FALLA'} Limpieza: asistente fixture y su cita cancelada borradas por id (${l})`)
    }
  }
}

main().then(() => {
  const fallos = casos.filter((c) => !c.ok)
  if (arg('salida')) fs.writeFileSync(arg('salida'), JSON.stringify({ fecha: new Date().toISOString(), app: arg('app'), total: casos.length, fallos: fallos.length, casos }, null, 1))
  console.log(`\n${casos.length - fallos.length}/${casos.length} correctos`)
  process.exitCode = fallos.length ? 1 : 0
}).catch((e) => { console.error(String(e.message ?? e).slice(0, 600)); process.exitCode = 2 })
