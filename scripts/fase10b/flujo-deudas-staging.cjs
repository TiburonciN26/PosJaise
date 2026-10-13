// Fase 10B · deudas en STAGING con los DOS frontends (contrato D11-A, migraciones 20261010000001 + 20261013000001).
//   node scripts/fase10b/flujo-deudas-staging.cjs --nueva=https://<id>.pos-jaise.pages.dev --build-id=<8 hex>
//        --main=http://127.0.0.1:<puerto>/PosJaise --salida=<archivo.json>
// --nueva: el Preview con el candidato; --main: el build de `main` compilado contra staging y servido en loopback.
// Fixtures por SQL (prefijo «TEST QA F10B»): una clienta y dos deudas, A (S/100, recibirá un abono) y B (S/50, sin pagos).
//   1. UI nueva: abono de S/30 en A                                     → A PENDIENTE, 1 pago de 30.
//   2. `main`: lee A (muestra S/100, no el saldo) y pulsa «Cobrado»      → rechazo, aviso de error, ledger igual.
//   3. `main`: pulsa «Cobrado» en B (sin pagos)                          → aceptado, 1 pago de 50 por el importe visible.
//   4. UI nueva: cobra el saldo de A (el modal propone S/70)             → A COBRADA, pagos 30 + 70.
//   5. Invariante: cero deudas incoherentes en staging.
// Limpieza en `finally`: borra SOLO los pagos, deudas y clienta creados por esta ejecución (por id).
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { chromium } = require('playwright')
const S = require('./lib/guarda-staging.cjs')

const RAIZ = path.resolve(__dirname, '..', '..')
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').split('=').slice(1).join('=')
const psql = (sql, escritura = false) => {
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'scripts/fase10b/psql-staging.mjs'), `--sql=${sql}`, ...(escritura ? ['--escritura'] : [])], { encoding: 'utf8', cwd: RAIZ })
  if (r.status !== 0) throw new Error(`psql: ${String(r.stderr).slice(0, 400)}`)
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
}
const casos = []
async function caso(nombre, fn) {
  try { const detalle = await fn(); casos.push({ nombre, ok: true, detalle }); console.log(`OK    ${nombre}`) } catch (e) {
    casos.push({ nombre, ok: false, error: String(e.message).slice(0, 800) }); console.log(`FALLA ${nombre}\n      ${String(e.message).slice(0, 400)}`)
  }
}
const estadoDeuda = (id) => {
  const l = psql(`select d.estado || '|' || d.monto || '|' || (select count(*) from deuda_pagos where deuda_id = d.id) || '|' || (select coalesce(sum(monto),0) from deuda_pagos where deuda_id = d.id) from deudas d where d.id = '${id}';`).find((x) => x.includes('|'))
  const [estado, monto, pagos, pagado] = l.split('|')
  return { estado, monto: Number(monto), pagos: Number(pagos), pagado: Number(pagado) }
}
const incoherentes = () => Number(psql(`select count(*) from deudas d left join (select deuda_id, sum(monto) p from deuda_pagos group by deuda_id) q on q.deuda_id = d.id
  where (d.estado = 'COBRADA' and coalesce(q.p,0) < d.monto) or (d.estado = 'PENDIENTE' and coalesce(q.p,0) > 0 and coalesce(q.p,0) >= d.monto);`).find((l) => /^\d+$/.test(l)))
const tarjeta = (page, concepto) => page.locator('div').filter({ hasText: concepto }).filter({ has: page.getByRole('button', { name: 'Cobrado' }) }).last()

async function main() {
  const NUEVA = arg('nueva'), MAIN = arg('main')
  const cuentas = S.cuentasStaging()
  const preN = await S.preflight(NUEVA, arg('build-id'))
  const preM = await S.preflight(MAIN, null)
  casos.push({ nombre: 'Preflight de los dos frontends: app aprobada y backend efectivo = Supabase de staging', ok: true, detalle: { nueva: preN, main: preM } })
  console.log('OK    Preflight de los dos frontends: app aprobada y backend efectivo = Supabase de staging')

  const run = crypto.randomBytes(3).toString('hex')
  const nombreCliente = `TEST QA F10B Cliente ${run}`
  const conceptoA = `TEST QA F10B Deuda A ${run}`, conceptoB = `TEST QA F10B Deuda B ${run}`
  const adminId = psql(`select id from auth.users where email = '${cuentas.admin.email}';`).find((l) => /^[0-9a-f-]{36}$/.test(l))
  if (incoherentes() !== 0) throw new Error('staging ya tenía deudas incoherentes antes de empezar')
  const ids = psql(`begin;
insert into clientes (nombre) values ('${nombreCliente}');
insert into deudas (cliente_id, concepto, monto, fecha, creado_por) select id, '${conceptoA}', 100, current_date, '${adminId}' from clientes where nombre = '${nombreCliente}';
insert into deudas (cliente_id, concepto, monto, fecha, creado_por) select id, '${conceptoB}', 50, current_date, '${adminId}' from clientes where nombre = '${nombreCliente}';
select (select id from clientes where nombre = '${nombreCliente}') || '|' || (select id from deudas where concepto = '${conceptoA}') || '|' || (select id from deudas where concepto = '${conceptoB}');
commit;`, true).find((l) => /^[0-9a-f-]{36}\|[0-9a-f-]{36}\|[0-9a-f-]{36}$/.test(l))
  if (!ids) throw new Error('no se crearon los fixtures')
  const [idCliente, idA, idB] = ids.split('|')
  const navegador = await chromium.launch({ headless: true })
  const guardas = []
  const abrir = async (app) => {
    const g = S.crearGuarda(); guardas.push(g)
    const ctx = await S.contexto(navegador, app, g)
    const page = await ctx.newPage()
    await S.iniciarSesion(page, app, cuentas.admin, g)
    const { origen, base } = S.validarApp(app)
    await page.goto(`${origen}${base}/deudas`)
    return { ctx, page, g }
  }
  try {
    // 1. UI nueva: abono de 30 en A.
    const n = await abrir(NUEVA)
    await caso('1. UI nueva: abono de S/30 en la deuda A → PENDIENTE con 1 pago de 30', async () => {
      const t = tarjeta(n.page, conceptoA); await t.waitFor({ timeout: 30000 })
      await t.getByRole('button', { name: 'Pago parcial' }).click()
      await n.page.getByLabel('Monto pagado').fill('30')
      const resp = n.page.waitForResponse((r) => r.url().includes('/rpc/registrar_pago_deuda'))
      await n.page.getByRole('button', { name: 'Registrar pago' }).click()
      if (!(await resp).ok()) throw new Error(`registrar_pago_deuda respondió ${(await resp).status()}`)
      await n.page.waitForTimeout(1500)
      const e = estadoDeuda(idA)
      if (!(e.estado === 'PENDIENTE' && e.pagos === 1 && e.pagado === 30)) throw new Error(JSON.stringify(e))
      return e
    })
    // 2 y 3. `main`.
    const m = await abrir(MAIN)
    await caso('2. main: la deuda A con abono muestra S/100 (no el saldo S/70); su «Cobrado» se RECHAZA y el ledger queda igual', async () => {
      const t = tarjeta(m.page, conceptoA); await t.waitFor({ timeout: 30000 })
      const texto = await t.innerText()
      if (!/S\/\s*100[.,]00/.test(texto) || /S\/\s*70[.,]00/.test(texto)) throw new Error(`tarjeta: ${texto.replace(/\s+/g, ' ')}`)
      const resp = m.page.waitForResponse((r) => r.url().includes('/rest/v1/deudas') && r.request().method() === 'PATCH')
      await t.getByRole('button', { name: 'Cobrado' }).click()
      const r = await resp
      const cuerpo = await r.json().catch(() => null)
      await m.page.getByText('No se pudo actualizar la deuda.').waitFor({ timeout: 10000 })
      const e = estadoDeuda(idA)
      if (r.ok() || !(e.estado === 'PENDIENTE' && e.pagos === 1 && e.pagado === 30)) throw new Error(JSON.stringify({ status: r.status(), e }))
      return { visible: 'S/ 100.00', status: r.status(), mensaje: cuerpo?.message, e }
    })
    await caso('3. main: «Cobrado» en la deuda B sin pagos → aceptado; la base registra 1 pago por el importe visible (S/50)', async () => {
      const t = tarjeta(m.page, conceptoB); await t.waitFor({ timeout: 30000 })
      const resp = m.page.waitForResponse((r) => r.url().includes('/rest/v1/deudas') && r.request().method() === 'PATCH')
      await t.getByRole('button', { name: 'Cobrado' }).click()
      const r = await resp
      await m.page.getByText('Marcada como cobrada.').waitFor({ timeout: 10000 })
      const e = estadoDeuda(idB)
      const nota = psql(`select nota from deuda_pagos where deuda_id = '${idB}';`).find((l) => l.startsWith('Cobro registrado'))
      if (!r.ok() || !(e.estado === 'COBRADA' && e.pagos === 1 && e.pagado === 50) || !nota) throw new Error(JSON.stringify({ status: r.status(), e, nota }))
      return { e, nota }
    })
    await m.ctx.close()
    // 4. UI nueva: cobra el saldo de A.
    await caso('4. UI nueva: «Cobrado» en A propone el saldo S/70 y lo registra → COBRADA con pagos 30 + 70', async () => {
      await n.page.reload()
      const t = tarjeta(n.page, conceptoA); await t.waitFor({ timeout: 30000 })
      await t.getByRole('button', { name: 'Cobrado' }).click()
      const propuesto = await n.page.getByLabel('Monto pagado').inputValue()
      if (Number(propuesto) !== 70) throw new Error(`el modal propone ${propuesto}`)
      const resp = n.page.waitForResponse((r) => r.url().includes('/rpc/registrar_pago_deuda'))
      await n.page.getByRole('button', { name: 'Registrar pago' }).click()
      if (!(await resp).ok()) throw new Error('registrar_pago_deuda falló')
      await n.page.waitForTimeout(1500)
      const e = estadoDeuda(idA)
      if (!(e.estado === 'COBRADA' && e.pagos === 2 && e.pagado === 100)) throw new Error(JSON.stringify(e))
      return { propuesto, e }
    })
    await n.ctx.close()
    await caso('5. Invariante en staging: cero deudas incoherentes', async () => { const k = incoherentes(); if (k) throw new Error(`${k} incoherentes`); return { incoherentes: 0 } })
    await caso('Guardas: ninguna violación de red en los contextos de los dos frontends', async () => {
      for (const g of guardas) S.exigirSinViolaciones(g, 'deudas')
      return { neutralizadas: guardas.reduce((a, g) => a + g.neutralizadas, 0), preconexionesRechazadas: guardas.reduce((a, g) => a + g.preconexionesRechazadas, 0) }
    })
  } finally {
    await navegador.close()
    const l = psql(`begin;
delete from deuda_pagos where deuda_id in ('${idA}', '${idB}');
delete from deudas where id in ('${idA}', '${idB}');
delete from clientes where id = '${idCliente}';
select (select count(*) from deudas where concepto like 'TEST QA F10B%') || '|' || (select count(*) from clientes where nombre like 'TEST QA F10B%');
commit;`, true).find((x) => /^\d+\|\d+$/.test(x))
    casos.push({ nombre: 'Limpieza: fixtures TEST QA F10B borrados por id', ok: l === '0|0', detalle: l })
    console.log(`${l === '0|0' ? 'OK   ' : 'FALLA'} Limpieza: fixtures TEST QA F10B borrados por id (${l})`)
  }
}

main().then(() => {
  const fallos = casos.filter((c) => !c.ok)
  if (arg('salida')) fs.writeFileSync(arg('salida'), JSON.stringify({ fecha: new Date().toISOString(), nueva: arg('nueva'), main: arg('main'), total: casos.length, fallos: fallos.length, casos }, null, 1))
  console.log(`\n${casos.length - fallos.length}/${casos.length} correctos`)
  process.exitCode = fallos.length ? 1 : 0
}).catch((e) => { console.error(String(e.message ?? e).slice(0, 600)); process.exitCode = 2 })
