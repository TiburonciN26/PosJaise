// Fase 10A · V3 (F10A-05b de Codex): qué ve y qué intenta autorizar la UI de `main` al cobrar una deuda con abonos, y cómo
// reacciona a la respuesta que daría la base con el borrador V3 de compatibilidad. Solo Local; sin escrituras reales.
//   node scripts/fase10a/probar-deuda-main-ui.cjs --dist=<build de main con base /PosJaise> --cuentas=<json QA> --salida=<archivo.json>
// Cadena de la prueba:
//   1. `main` (build compilado) inicia sesión como la administradora QA de Local y abre Deudas. La deuda es FICTICIA y la sirve el
//      interceptor: monto 100 con un abono previo supuesto de 30 (saldo real 70). `main` no pide `deuda_pagos`, así que el abono
//      nunca le llega: se comprueba que muestra 100 y no 70.
//   2. Se pulsa «Cobrado». El PATCH que envía `main` se captura (no llega a la base) para ver QUÉ autoriza: solo `estado` y
//      `cobrado_en`, sin importe. Se responde con el error exacto que devuelve PostgREST cuando el trigger V3 rechaza ese mismo
//      UPDATE (el ensayo SQL S2b ejecuta esa sentencia en Local, como la administradora con RLS, y obtiene ese mensaje).
//   3. Se comprueba la reacción de `main`: aviso de error, la tarjeta sigue «Pendiente» por 100 y no hay más escrituras.
// Todo lo demás que no sea lectura, login o RPC de lectura se aborta y se registra.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const cp = require('node:child_process')
const crypto = require('node:crypto')
const { chromium } = require('playwright')

const RAIZ = path.resolve(__dirname, '..', '..')
const API = 'http://127.0.0.1:54321'
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const MENSAJE_TRIGGER = 'La deuda tiene abonos registrados (S/ 30.00 de S/ 100.00); cóbrala en la versión actual, que muestra el saldo.'

async function main() {
  const DIST = path.resolve(arg('dist') ?? ''), SALIDA = arg('salida')
  if (!arg('dist') || !arg('cuentas') || !SALIDA) throw new Error('uso: --dist=<build de main> --cuentas=<json QA> --salida=<archivo>')
  const cuenta = JSON.parse(fs.readFileSync(arg('cuentas'), 'utf8')).admin
  if (!/^qa-[a-z0-9-]+@test\.local$/.test(cuenta?.email ?? '')) throw new Error('la cuenta admin no es QA de Local')
  const assets = path.join(DIST, 'PosJaise', 'assets')
  const js = fs.readdirSync(assets).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(assets, f), 'utf8')).join('\n')
  if (!js.includes(API) || /https:\/\/[a-z0-9-]+\.supabase\.(co|in)/.test(js)) throw new Error('el build no apunta exactamente al Supabase Local')
  if (!/:54321->8000/.test(cp.execFileSync('docker', ['ps', '--filter', 'name=^supabase_kong_WedJaiseReact$', '--format', '{{.Ports}}'], { encoding: 'utf8' }))) throw new Error('Supabase Local no verificado')
  const indexSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(DIST, 'PosJaise', 'index.html'))).digest('hex')

  const reserva = http.createServer()
  const puerto = await new Promise((r) => reserva.listen(0, '127.0.0.1', () => r(reserva.address().port)))
  await new Promise((r) => reserva.close(r))
  const origen = `http://127.0.0.1:${puerto}`
  const servidor = cp.spawn(process.execPath, [path.join(RAIZ, 'scripts/fase10a/servir-como-pages.cjs'), DIST, String(puerto)], { cwd: RAIZ })
  await new Promise((ok, mal) => { let o = ''; servidor.stdout.on('data', (x) => { o += x; if (o.includes('servir-como-pages')) ok() }); setTimeout(() => mal(new Error('el servidor no arrancó')), 8000) })

  const navegador = await chromium.launch({ headless: true })
  const abortadas = [], parches = []
  try {
    const ctx = await navegador.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' })
    await ctx.routeWebSocket(/.*/, (ws) => ws.close())
    const deuda = { id: 'f1020000-0000-4000-8000-000000000001', cliente_id: 'f1020000-0000-4000-8000-000000000002', clientes: { nombre: 'TEST QA CLIENTE FICTICIO' }, concepto: 'TEST QA DEUDA CON ABONO', monto: 100, fecha: '2026-10-13', estado: 'PENDIENTE', cobrado_en: null, nota: null }
    await ctx.route('**/*', (route) => {
      const req = route.request(), u = new URL(req.url()), m = req.method()
      if (u.origin !== origen && u.origin !== API) return route.fulfill({ status: 204, body: '' })
      if (u.origin === API && u.pathname === '/rest/v1/deudas' && m === 'GET') return route.fulfill({ status: 200, json: [deuda] })
      if (u.origin === API && u.pathname === '/rest/v1/deudas' && m === 'PATCH') {
        parches.push({ consulta: decodeURIComponent(u.search), cuerpo: JSON.parse(req.postData() ?? '{}') })
        return route.fulfill({ status: 400, json: { code: 'P0001', details: null, hint: null, message: MENSAJE_TRIGGER } })
      }
      const rpc = u.pathname.split('/rest/v1/rpc/')[1]
      const escribe = rpc && /^(registrar|confirmar|anular|cancelar|agendar|guardar|actualizar|reclamar|aplicar|eliminar|vincular|migracion_|recalcular)/.test(rpc)
      const permitida = ['GET', 'HEAD', 'OPTIONS'].includes(m) || (u.origin === API && m === 'POST' && (['/auth/v1/token', '/auth/v1/logout'].includes(u.pathname) || (rpc && !escribe)))
      if (!permitida) { abortadas.push(`${m} ${u.pathname}`); return route.abort() }
      return route.continue()
    })
    const page = await ctx.newPage()
    await page.goto(`${origen}/PosJaise/login`)
    await page.fill('#email', cuenta.email); await page.fill('#password', cuenta.password); await page.click('button[type=submit]')
    await page.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 30000 })
    await page.goto(`${origen}/PosJaise/deudas`)
    await page.getByText(deuda.concepto, { exact: true }).waitFor()
    const tarjeta = async () => page.evaluate(() => { const p = [...document.querySelectorAll('p')].find((x) => x.innerText === 'TEST QA DEUDA CON ABONO'); return p?.parentElement?.parentElement?.parentElement?.innerText ?? '' })
    const antes = await tarjeta()
    await page.getByRole('button', { name: 'Cobrado', exact: true }).click()
    const aviso = await page.getByText('No se pudo actualizar la deuda.').waitFor({ timeout: 10000 }).then(() => true, () => false)
    await page.waitForTimeout(800)
    const despues = await tarjeta()
    await page.screenshot({ path: SALIDA.replace(/\.json$/, '.png') })
    await ctx.close()

    const r = {
      fecha: new Date().toISOString(), build: { dist: DIST, indexSha256 },
      metodo: 'UI compilada de main contra Supabase Local (login QA). Deuda ficticia y respuesta del PATCH servidas por el interceptor: ninguna escritura llega a la base.',
      deuda: { monto: 100, abonoPrevioSupuesto: 30, saldoReal: 70 },
      visibleEnMainAntes: { muestra100: /S\/\s*100[.,]00/.test(antes), muestraSaldo70: /S\/\s*70[.,]00/.test(antes), pendiente: /Pendiente/.test(antes) },
      intentoDeCobro: { parches, autorizaImporte: parches.some((p) => 'monto' in p.cuerpo) },
      respuestaSimulada: { status: 400, code: 'P0001', message: MENSAJE_TRIGGER, origen: 'ensayo SQL S2b (mismo UPDATE, administradora QA con RLS, borrador V3)' },
      reaccionDeMain: { avisoDeError: aviso, sigue100: /S\/\s*100[.,]00/.test(despues), siguePendiente: /Pendiente/.test(despues) },
      escriturasAbortadas: abortadas,
    }
    r.ok = r.visibleEnMainAntes.muestra100 && !r.visibleEnMainAntes.muestraSaldo70 && parches.length === 1 && parches[0].cuerpo.estado === 'COBRADA' && !r.intentoDeCobro.autorizaImporte
      && r.reaccionDeMain.avisoDeError && r.reaccionDeMain.sigue100 && r.reaccionDeMain.siguePendiente && !abortadas.length
    fs.writeFileSync(SALIDA, JSON.stringify(r, null, 1))
    console.log(JSON.stringify(r, null, 1))
    process.exitCode = r.ok ? 0 : 1
  } finally {
    await navegador.close(); servidor.kill()
  }
}
main().catch((e) => { console.error(e.message ?? e); process.exitCode = 2 })
