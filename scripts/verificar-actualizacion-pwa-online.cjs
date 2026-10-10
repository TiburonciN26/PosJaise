// Verificación de actualización PWA entre dos versiones EXACTAS (A → B) sobre el MISMO origen (Fase 2B, B3/B4).
// Uso:
//   node scripts/verificar-actualizacion-pwa-online.cjs --origen=https://<alias> --a=<idA> --b=<idB>
//        [--estado=vacio|venta|ventana|atras|dos-dialogos] [--espera-min=30] [--publicar-cmd="<comando que publica B>"]
//        [--permitir-origen=<host>] [--permitir-local] [--env-file=<archivo>] [--salida=archivo.json] [--entrega=pages|r2dev]
//  · --entrega=pages|r2dev (solo con el alias aprobado de Pages Preview): ANTES de abrir el navegador o enviar credenciales comprueba, con el mismo
//    preflight que los verificadores de medios (marca de A + configuración de medios efectiva del bundle servido), que A tiene esa entrega; tras
//    «Actualizar» lo repite para B. Con `pages` añade, SIN escribir nada, comprobaciones de /medios bajo el control del SW en A y en B (404
//    `no-store` con nosniff/noindex que NO es la SPA, navegación a /medios/ sin fallback del SW, /medios-extra sigue siendo la SPA) y registra el
//    SHA-256 del sw.js de A y de B (deben ser distintos).
//
// SEGURIDAD (antes de enviar cualquier credencial):
//  · El Supabase de .env.staging.local debe ser EXACTAMENTE el staging aprobado y la clave una anon/publishable válida
//    (misma clasificación que los builds: scripts/lib/entornos-supabase.mjs). Las cuentas QA deben ser @staging.test.
//  · El origen debe estar permitido: `pos-jaise-preview.pages.dev` y sus subdominios, hosts añadidos con
//    --permitir-origen=<host> (https) o, para el ensayo local, --permitir-local (http://127.0.0.1|localhost).
//  · Se BLOQUEA (abort) antes de salir del navegador todo tráfico a otro Supabase, al Supabase local y a pasarelas de pago.
//    Si ocurre algo bloqueado, el recorrido falla.
//  · Si A falla (marca distinta de la esperada, sin controlador del SW o sin sesión autenticada real) el recorrido ABORTA:
//    NO se ejecuta --publicar-cmd ni se pide publicar B.
//
// Estados de trabajo del POS (B4): `vacio` (sin trabajo pendiente: «Actualizar» disponible de inmediato),
// `venta` (un producto en el carrito: «Actualizar» bloqueado y el carrito se conserva hasta que se vacía),
// `ventana` (un diálogo abierto: bloqueado hasta cerrarlo con Esc), `atras` (diálogo de Ventas abierto y luego «Atrás» del navegador:
// la página de Ventas queda OCULTA en la caché con su diálogo en memoria → debe seguir bloqueado) y `dos-dialogos` (además se abre
// otro diálogo en la página visible: Esc cierra solo ese y el oculto sigue contando). No confirma ventas ni envía pagos.
const fs = require('fs')
const path = require('path')
const cp = require('child_process')
const ROOT = path.resolve(__dirname, '..')
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'))

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const flag = (n) => process.argv.includes(`--${n}`)
const origen = arg('origen')?.replace(/\/$/, '')
const idA = arg('a')
const idB = arg('b')
const estado = arg('estado') ?? 'venta'
const esperaMin = Number(arg('espera-min') ?? 30)
const publicarCmd = arg('publicar-cmd')
const permitidos = process.argv.filter((a) => a.startsWith('--permitir-origen=')).map((a) => a.slice('--permitir-origen='.length).toLowerCase())
const entrega = arg('entrega')
const salida = path.resolve(arg('salida') ?? path.join(ROOT, 'docs/evidencia-rendimiento/fase-2/pwa-actualizacion-online.json'))
const out = { origen, estado, idEsperadoA: idA, idEsperadoB: idB, fecha: new Date().toISOString(), pasos: [], bloqueadas: [], trafico: {}, publicadoB: false }
const paso = (n, ok, d) => { out.pasos.push({ n, ok, d }); console.log(`${ok ? 'OK   ' : 'FALLA'} ${n}${d !== undefined ? ' → ' + JSON.stringify(d) : ''}`) }
function terminar(codigo, extra) {
  out.resultado = codigo === 0 ? 'OK' : 'FALLA'
  if (extra) out.motivo = extra
  fs.writeFileSync(salida, JSON.stringify(out, null, 2))
  console.log(`\nResultado: ${out.resultado}${extra ? ' — ' + extra : ''} → ${path.relative(ROOT, salida)}`)
  process.exitCode = codigo // sin process.exit(): evita el assert de libuv en Windows con conexiones de fetch abiertas (código 127)
}

;(async () => {
  if (!origen || !idA || !idB || idA === idB || !['vacio', 'venta', 'ventana', 'atras', 'dos-dialogos'].includes(estado)) {
    console.error('Uso: --origen=<url> --a=<idA> --b=<idB distinto> [--estado=vacio|venta|ventana|atras|dos-dialogos]'); process.exit(2)
  }
  // ── Preflight: nada de navegador ni de credenciales hasta que todo esté validado ──
  const { validarSupabase } = await import(require('url').pathToFileURL(path.join(__dirname, 'lib/entornos-supabase.mjs')).href)
  const env = Object.fromEntries(fs.readFileSync(path.resolve(arg('env-file') ?? path.join(ROOT, '.env.staging.local')), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  const v = validarSupabase({ url: env.VITE_SUPABASE_URL, clave: env.VITE_SUPABASE_ANON_KEY, entorno: 'preview' })
  paso('preflight: Supabase de .env.staging.local = staging aprobado y clave anon/publishable válida', v.ok, v.ok ? undefined : v.motivo)
  const supa = env.VITE_SUPABASE_URL
  const hostStaging = v.ok ? new URL(supa).host : ''
  const emailOk = /@staging\.test$/i.test(env.QA_ADMIN_EMAIL ?? '') && !!env.QA_ADMIN_PASSWORD
  paso('preflight: cuenta QA ficticia (@staging.test)', emailOk)
  let u
  try { u = new URL(origen) } catch { u = null }
  const esLocal = !!u && flag('permitir-local') && u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname)
  const esPages = !!u && u.protocol === 'https:' && (u.hostname === 'pos-jaise-preview.pages.dev' || u.hostname.endsWith('.pos-jaise-preview.pages.dev'))
  const esExtra = !!u && u.protocol === 'https:' && permitidos.includes(u.hostname.toLowerCase())
  paso('preflight: origen QA permitido', esLocal || esPages || esExtra, u ? u.host : 'URL inválida')
  // Entrega de medios (opcional): mismo preflight que los verificadores de medios; si falla, no se abre el navegador ni se envía nada.
  const G = require('./lib/guardas-interfaz-r2.cjs')
  const sha = (t) => require('crypto').createHash('sha256').update(t).digest('hex')
  const fetchAlias = G.crearFetchSeguro(new Set([origen]), (...x) => fetch(...x))
  const preflightEntrega = async (marca) => {
    const { clasificarClave } = await import(require('url').pathToFileURL(path.join(__dirname, 'lib/entornos-supabase.mjs')).href)
    return G.preflight({ alias: origen, buildId: marca, entrega, supabaseUrl: supa, claveAnon: env.VITE_SUPABASE_ANON_KEY, emails: [env.QA_ADMIN_EMAIL], clasificarClave }, async (u) => (await fetchAlias(u)).text())
  }
  if (entrega) {
    paso('preflight: --entrega válida (pages|r2dev)', ['pages', 'r2dev'].includes(entrega), entrega)
    if (out.pasos.every((p) => p.ok)) {
      try {
        const pf = await preflightEntrega(idA)
        out.entrega = entrega
        out.swA = sha(await (await fetchAlias(`${origen}/sw.js`)).text())
        paso(`preflight: A sirve la marca ${idA} con la entrega de medios «${entrega}» efectiva (antes del navegador y de publicar B)`, true, { modulos: pf.modulos, swSha256: out.swA })
      } catch (e) { paso(`preflight: A sirve la marca ${idA} con la entrega «${entrega}»`, false, String(e.message).slice(0, 200)) }
    }
  }
  if (out.pasos.some((p) => !p.ok)) return terminar(1, 'preflight fallido: no se abrió el navegador ni se envió ninguna credencial')

  const browser = await chromium.launch({ headless: true })
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'allow' })
    // Bloqueo de tráfico ajeno ANTES de que salga (incluye lo que haga el SW de página: se intercepta en el contexto).
    await ctx.route('**/*', (route) => {
      let h = ''
      try { h = new URL(route.request().url()).host } catch { /* data:, blob: */ }
      const supabaseAjeno = /\.supabase\.(co|in)$/.test(h) && h !== hostStaging
      const local54321 = /^(127\.0\.0\.1|localhost):54321$/.test(h)
      const pago = /(^|\.)culqi\.com$/.test(h)
      if (supabaseAjeno || local54321 || pago) { out.bloqueadas.push(h); return route.abort('blockedbyclient') }
      return route.continue()
    })
    const page = await ctx.newPage()
    const hosts = {}
    const fallosHttp = []
    const reqFail = []
    const errs = []
    page.on('request', (r) => { try { const h = new URL(r.url()).host; if (/supabase\.(co|in)$/.test(h)) hosts[h] = (hosts[h] || 0) + 1 } catch { /* */ } })
    page.on('response', (r) => { if (r.url().startsWith(origen) && r.status() >= 400) fallosHttp.push(`${r.status()} ${r.url().replace(origen, '')}`) })
    page.on('requestfailed', (r) => { const f = r.failure()?.errorText ?? ''; if (!/ERR_ABORTED|blockedbyclient/i.test(f)) reqFail.push(`${r.url().slice(0, 90)} ${f}`) })
    page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)))

    const buildId = () => page.evaluate(() => document.querySelector('meta[name="build-id"]')?.content ?? null)
    // Sesión: usuario propio (/auth/v1/user) y SU fila en `usuarios` filtrada por ese id, no cualquier fila accesible.
    const sesionAutenticada = () => page.evaluate(async ({ supa, anon }) => {
      const k = Object.keys(localStorage).find((x) => x.includes('auth-token'))
      const tok = k ? JSON.parse(localStorage.getItem(k))?.access_token : null
      if (!tok) return { ok: false, motivo: 'sin access_token' }
      const h = { apikey: anon, Authorization: `Bearer ${tok}` }
      const ur = await fetch(`${supa}/auth/v1/user`, { headers: h })
      const usr = ur.ok ? await ur.json() : null
      if (!usr?.id) return { ok: false, auth: ur.status }
      const fr = await fetch(`${supa}/rest/v1/usuarios?id=eq.${usr.id}&select=id,rol`, { headers: h })
      const filas = fr.ok ? await fr.json() : []
      return { ok: Array.isArray(filas) && filas.length === 1 && filas[0].id === usr.id, auth: ur.status, lectura: fr.status, rol: filas[0]?.rol }
    }, { supa, anon: env.VITE_SUPABASE_ANON_KEY })
    const filasCarrito = () => page.getByRole('button', { name: 'Quitar' }).count() // una por ítem del cobro (escritorio)
    const botonActualizar = () => page.getByRole('button', { name: 'Actualizar' })
    const exigirA = (n, ok, d) => { paso(n, ok, d); if (!ok) throw new Error(`A inválida (${n}): se aborta; NO se publica B`) }

    // Comprobaciones SIN escritura de /medios bajo el control del SW (solo con --entrega=pages). Usan una segunda pestaña del mismo contexto
    // para que sus 404 esperados no cuenten como «respuestas HTTP ≥ 400» de la pestaña principal.
    const comprobarMedios = async (etiqueta) => {
      const p2 = await ctx.newPage()
      try {
        await p2.goto(`${origen}/login`, { waitUntil: 'networkidle' })
        const controlado = await p2.evaluate(async () => { await navigator.serviceWorker.ready; return !!navigator.serviceWorker.controller })
        paso(`${etiqueta}: el service worker controla la pestaña auxiliar`, controlado)
        const uuid = '00000000-0000-4000-8000-000000000000'
        const lecturas = await p2.evaluate(async (u) => {
          const salida = {}
          for (const ruta of [`/medios/fotos-galeria/${u}/m.webp`, '/medios/', '/medios']) {
            const r = await fetch(ruta, { cache: 'no-store' })
            const t = await r.text()
            salida[ruta] = { estado: r.status, cache: r.headers.get('cache-control'), nosniff: r.headers.get('x-content-type-options'), robots: r.headers.get('x-robots-tag'), texto: t.slice(0, 40), esSpa: t.includes('build-id') }
          }
          return salida
        }, uuid)
        const bien = Object.values(lecturas).every((x) => x.estado === 404 && x.cache === 'no-store' && x.nosniff === 'nosniff' && x.robots === 'noindex' && x.texto === 'No encontrado' && !x.esSpa)
        paso(`${etiqueta}: /medios (objeto inexistente, /medios/ y /medios) → 404 no-store de la Function, nunca la SPA, con el SW controlando`, bien, lecturas)
        const nav = await p2.goto(`${origen}/medios/`, { waitUntil: 'load' })
        const cuerpo = await p2.evaluate(() => ({ texto: document.body.innerText.slice(0, 40), spa: !!document.querySelector('meta[name="build-id"]') }))
        paso(`${etiqueta}: la NAVEGACIÓN a /medios/ no recibe el fallback del SW (404 de la Function, sin la SPA)`, nav?.status() === 404 && cuerpo.texto.trim() === 'No encontrado' && !cuerpo.spa, { estado: nav?.status(), ...cuerpo })
        const extra = await p2.goto(`${origen}/medios-extra`, { waitUntil: 'load' })
        const spa = await p2.evaluate(() => !!document.querySelector('meta[name="build-id"]'))
        paso(`${etiqueta}: /medios-extra sigue siendo la SPA (la exclusión no es por prefijo)`, extra?.status() === 200 && spa, { estado: extra?.status() })
      } finally { await p2.close() }
    }

    await page.goto(`${origen}/login`, { waitUntil: 'networkidle' })
    await page.locator('input[type="email"]').first().fill(env.QA_ADMIN_EMAIL)
    await page.locator('input[type="password"]').first().fill(env.QA_ADMIN_PASSWORD)
    await page.locator('button[type="submit"]').first().click()
    await page.waitForURL('**/ventas', { timeout: 30000 })
    await page.evaluate(async () => { await navigator.serviceWorker.ready; localStorage.setItem('qa-clave-ficticia-pwa', 'conservar-esto') })
    await page.reload({ waitUntil: 'networkidle' })

    // ── Validación de A: si falla, se aborta ANTES de publicar ──
    const a = await buildId()
    exigirA('A: el documento tiene EXACTAMENTE la marca esperada', a === idA, { observada: a, esperada: idA })
    exigirA('A: el service worker controla la pestaña', await page.evaluate(() => !!navigator.serviceWorker.controller))
    const s0 = await sesionAutenticada()
    exigirA('A: sesión autenticada (usuario propio + su fila en usuarios, a staging)', s0.ok, s0)
    exigirA('A: sin tráfico bloqueado hasta aquí', out.bloqueadas.length === 0, out.bloqueadas)
    if (entrega === 'pages') { await comprobarMedios('A'); exigirA('A: las comprobaciones de /medios pasaron (si no, NO se publica B)', out.pasos.every((p) => p.ok)) }

    // Trabajo pendiente del POS según el estado a probar
    if (estado === 'venta') {
      await page.locator('input').first().fill('Coca')
      await page.getByRole('button', { name: /Coca Cola 500ml/ }).first().click({ timeout: 8000 })
      await new Promise((r) => setTimeout(r, 500))
      exigirA('A: la caja tiene un producto en el carrito (sin cobrar)', (await filasCarrito()) >= 1)
    } else if (estado === 'ventana') {
      await page.getByRole('button', { name: /Cliente: \(ninguno\)/ }).click({ timeout: 8000 })
      await new Promise((r) => setTimeout(r, 400))
    } else if (estado === 'atras' || estado === 'dos-dialogos') {
      // Ventas → Clientes → Ventas por el menú (navegación del cliente, sin recargar): ambas páginas quedan en la caché de pestañas.
      await page.locator('a[href="/clientes"]').first().evaluate((el) => el.click())
      await page.waitForURL('**/clientes', { timeout: 10000 })
      await page.locator('a[href="/ventas"]').first().evaluate((el) => el.click())
      await page.waitForURL('**/ventas', { timeout: 10000 })
      await page.getByRole('button', { name: /Cliente: \(ninguno\)/ }).click({ timeout: 8000 })
      await new Promise((r) => setTimeout(r, 400))
    }

    // ── Publicación de B (solo si A pasó) ──
    if (publicarCmd) {
      const r = cp.spawnSync(publicarCmd, { shell: true, stdio: 'inherit' })
      out.publicadoB = r.status === 0
      paso('publicación de B por el comando indicado', r.status === 0, r.status)
    } else {
      console.log('\n>>> PUBLICA B AHORA bajo el mismo origen (la pestaña queda abierta en A; espera máx. ' + esperaMin + ' min) <<<\n')
    }
    const limite = Date.now() + esperaMin * 60000
    let aviso = false
    while (Date.now() < limite && !aviso) {
      await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r?.update() }).catch(() => {})
      aviso = await page.getByText('Hay una versión nueva de la app.').isVisible().catch(() => false)
      if (!aviso) await new Promise((r) => setTimeout(r, 5000))
    }
    paso('aparece el aviso «Hay una versión nueva de la app.»', aviso)
    if (!aviso) {
      // Diagnóstico para distinguir «B no llegó al SW» de «el aviso no se pintó»
      out.diagnostico = await page.evaluate(async () => {
        const r = await navigator.serviceWorker.getRegistration()
        const sw = await fetch('/sw.js', { cache: 'no-store' }).then(async (x) => ({ status: x.status, tipo: x.headers.get('content-type'), largo: (await x.text()).length })).catch((e) => ({ error: String(e.message) }))
        const ind = await fetch('/', { cache: 'no-store' }).then(async (x) => (await x.text()).match(/build-id" content="([^"]*)/)?.[1] ?? null).catch(() => 'err')
        return { swFetch: sw, indiceServido: ind, waiting: !!r?.waiting, installing: !!r?.installing, active: !!r?.active, hayTextoAviso: document.body.innerText.includes('Hay una versión nueva'), modalAbierto: !!document.querySelector('.fixed') }
      }).catch((e) => ({ error: String(e.message).slice(0, 80) }))
      throw new Error('no apareció el aviso: B no se publicó o es la misma versión ' + JSON.stringify(out.diagnostico))
    }
    paso('mientras espera, la pestaña sigue en A EXACTA (sin actualización silenciosa)', (await buildId()) === idA)

    // ── Protección de «Actualizar» según el estado ──
    const boton = botonActualizar()
    if (estado === 'vacio') {
      paso('sin trabajo pendiente: «Actualizar» habilitado y sin mensaje de bloqueo', (await boton.isEnabled()) && (await page.getByTestId('aviso-actualizacion-bloqueada').count()) === 0)
    } else if (estado === 'atras' || estado === 'dos-dialogos') {
      const ruta = () => new URL(page.url()).pathname
      const espera = (ms) => new Promise((r) => setTimeout(r, ms))
      const bloqueado = async () => (await botonActualizar().isDisabled()) && (await page.getByTestId('aviso-actualizacion-bloqueada').isVisible().catch(() => false))
      paso('Ventas con el diálogo abierto: «Actualizar» DESHABILITADO', await bloqueado())
      await page.goBack(); await espera(700)
      paso('«Atrás» deja la página anterior visible (/clientes) y Ventas oculta en la caché', ruta() === '/clientes', ruta())
      paso('con el diálogo en la página OCULTA «Actualizar» sigue DESHABILITADO', await bloqueado())
      paso('sin recarga: la pestaña sigue en A EXACTA', (await buildId()) === idA)
      if (estado === 'dos-dialogos') {
        await page.getByRole('button', { name: /Nuevo cliente/ }).first().click({ timeout: 8000 }); await espera(600)
        paso('con un segundo diálogo (Clientes, visible) «Actualizar» DESHABILITADO', await bloqueado())
        await page.keyboard.press('Escape'); await espera(500)
        paso('Esc cierra solo el diálogo VISIBLE; el de Ventas (oculto) sigue contando: DESHABILITADO', await bloqueado())
      }
      await page.goForward(); await espera(700)
      paso('al volver a /ventas el diálogo retenido sigue y «Actualizar» sigue DESHABILITADO', ruta() === '/ventas' && (await bloqueado()))
      await page.keyboard.press('Escape'); await espera(500)
      await page.waitForFunction(() => !document.querySelector('[data-testid="aviso-actualizacion-bloqueada"]'), null, { timeout: 5000 }).catch(() => {})
      paso('al cerrar el último diálogo «Actualizar» se habilita solo (sin bloqueo permanente)', (await botonActualizar().isEnabled()) && (await page.getByTestId('aviso-actualizacion-bloqueada').count()) === 0)
    } else {
      paso('con trabajo pendiente: «Actualizar» DESHABILITADO', await boton.isDisabled())
      paso('con trabajo pendiente: mensaje visible que explica el bloqueo', await page.getByTestId('aviso-actualizacion-bloqueada').isVisible())
      await boton.click({ force: true, timeout: 2000 }).catch(() => {})
      await new Promise((r) => setTimeout(r, 1200))
      paso('intentar pulsar no recarga: sigue la misma pestaña en A con su trabajo', (await buildId()) === idA && (estado === 'venta' ? (await filasCarrito()) >= 1 : true))
      if (estado === 'venta') {
        paso('el carrito NO se perdió mientras estaba bloqueado', (await filasCarrito()) >= 1)
        while ((await filasCarrito()) > 0) { await page.getByRole('button', { name: 'Quitar' }).first().evaluate((el) => el.click()); await new Promise((r) => setTimeout(r, 250)) } // el aviso fijo puede tapar el botón: clic por DOM, no por puntero
      } else {
        await page.keyboard.press('Escape')
        await new Promise((r) => setTimeout(r, 400))
      }
      await page.waitForFunction(() => !document.querySelector('[data-testid="aviso-actualizacion-bloqueada"]'), null, { timeout: 5000 }).catch(() => {})
      paso('al terminar/cancelar el trabajo, «Actualizar» se habilita solo', (await botonActualizar().isEnabled()) && (await page.getByTestId('aviso-actualizacion-bloqueada').count()) === 0)
    }

    await botonActualizar().click()
    await page.waitForFunction((x) => document.querySelector('meta[name="build-id"]')?.content === x, idB, { timeout: 30000 }).catch(() => {})
    await page.waitForLoadState('networkidle')
    await new Promise((r) => setTimeout(r, 800))
    const b = await buildId()
    paso('tras «Actualizar» el documento tiene EXACTAMENTE la marca B', b === idB, { observada: b, esperada: idB })
    if (b !== idB && b !== idA) paso('versión inesperada (ni A ni B)', false, b)
    const s1 = await sesionAutenticada()
    paso('B: sesión autenticada tras actualizar (usuario propio + su fila)', s1.ok, s1)
    paso('clave FICTICIA de localStorage conservada (no prueba borradores operativos)', (await page.evaluate(() => localStorage.getItem('qa-clave-ficticia-pwa'))) === 'conservar-esto')
    if (entrega) {
      try {
        const pfB = await preflightEntrega(idB)
        out.swB = sha(await (await fetchAlias(`${origen}/sw.js`)).text())
        paso(`B: el alias sirve la marca ${idB} con la entrega de medios «${entrega}» efectiva`, true, { modulos: pfB.modulos, swSha256: out.swB })
        paso('B: el service worker de B es distinto del de A (identidades exactas registradas)', !!out.swA && out.swB !== out.swA, { A: out.swA, B: out.swB })
      } catch (e) { paso(`B: el alias sirve la marca ${idB} con la entrega «${entrega}»`, false, String(e.message).slice(0, 200)) }
    }
    if (entrega === 'pages') await comprobarMedios('B')
    await page.goto(`${origen}/productos`, { waitUntil: 'networkidle' })
    await page.reload({ waitUntil: 'networkidle' })
    paso('sin respuestas HTTP ≥ 400 del mismo origen', fallosHttp.length === 0, fallosHttp.slice(0, 3))
    paso('sin requestfailed (salvo abortadas/bloqueadas)', reqFail.length === 0, reqFail.slice(0, 3))
    paso('sin pageerror', errs.length === 0, errs.slice(0, 3))
    paso('ninguna petición bloqueada (otro backend, Supabase local o pasarela)', out.bloqueadas.length === 0, out.bloqueadas)
    out.trafico = hosts
    paso('tráfico Supabase solo al staging aprobado', Object.keys(hosts).length > 0 && Object.keys(hosts).every((h) => h === hostStaging), hosts)
    await ctx.close()
  } catch (e) {
    paso('ejecución', false, String(e.message).slice(0, 200))
  } finally {
    await browser.close()
    terminar(out.pasos.some((p) => !p.ok) ? 1 : 0)
  }
})()
