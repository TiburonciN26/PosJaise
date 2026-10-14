// Fase 10A · matriz ROLES × RUTAS por URL directa, sobre un build servido y el Supabase LOCAL (127.0.0.1:54321).
//   node scripts/fase10a/verificar-roles-rutas.cjs --app=http://127.0.0.1:5401 --cuentas=<json admin/cajera/clienteA> [--salida=<archivo.json>] [--control-negativo]
//
// Perfiles: visitante (sin sesión), clienta, asistente, cajera y administración. Para cada uno abre por URL DIRECTA las 27 rutas
// del POS (src/config/navegacion.js), las del portal (públicas, privadas y dos fichas de detalle) y comprueba:
//   · el destino final: la propia ruta si el perfil la tiene, o la redirección esperada (login, /inicio o la pantalla inicial del rol);
//   · que la pantalla se monta sin límite de error («No se pudo abrir…», «Ocurrió un error en…», «Algo salió mal») ni pageerror;
//   · que el menú del POS no ofrece rutas que el rol no tiene y sí su pantalla inicial;
//   · que, tras «Cerrar sesión», una ruta del POS vuelve a pedir el login.
// La matriz ESPERADA está escrita aquí (comportamiento aprobado) y además se compara con navegacion.js: un cambio de permisos no
// intencionado en la configuración también falla. La cuenta ASISTENTE es ficticia (@test.local): se crea en Local al empezar y se
// borra al terminar, también si algo falla. Las demás cuentas son las QA ficticias existentes. Solo lecturas en el negocio.
const path = require('node:path')
const fs = require('node:fs')
const cp = require('node:child_process')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { chromium } = require('playwright')
const { createClient } = require('@supabase/supabase-js')

const RAIZ = path.resolve(__dirname, '..', '..')
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').split('=').slice(1).join('=')
const APP = arg('app').replace(/\/+$/, ''), CUENTAS = arg('cuentas') && JSON.parse(fs.readFileSync(arg('cuentas'), 'utf8')), SALIDA = arg('salida')
if (!APP || !CUENTAS) { console.error('uso: --app=<url> --cuentas=<json> [--salida=<archivo>]'); process.exit(2) }
const API = 'http://127.0.0.1:54321'
// Control negativo: la prueba debe FALLAR si se le hace creer que la cajera puede abrir /dashboard (demuestra que detecta un
// destino equivocado). Solo altera la expectativa de la prueba, nunca la app.
const CONTROL = process.argv.includes('--control-negativo')

// ---------------- matriz esperada (comportamiento aprobado) ----------------
const A = 'ADMINISTRADOR', C = 'CAJERA', S = 'ASISTENTE'
const POS = {
  '/ventas': [A, C], '/inventario': [A, C], '/historial': [A, C], '/servicios': [A, C], '/dashboard': [A], '/mi-panel': [A, S],
  '/citas': [A, C, S], '/estadisticas': [A], '/auditoria': [A], '/clientes': [A], '/deudas': [A], '/porcentajes': [A], '/gastos': [A, C],
  '/asistentes': [A], '/mobiliario': [A], '/web': [A], '/promociones': [A], '/pedidos-web': [A], '/resenas-web': [A], '/contacto-web': [A],
  '/puntos-web': [A], '/referidos-web': [A], '/fidelizacion-web': [A], '/recompensas-web': [A], '/catalogo-web': [A],
  '/libro-reclamaciones-web': [A], '/galeria-web': [A],
}
const INICIAL = { [A]: '/ventas', [C]: '/ventas', [S]: '/mi-panel' }
const PUBLICAS = ['/inicio', '/servicios', '/productos', '/recompensas', '/nosotros', '/libro-de-reclamaciones', '/terminos-y-condiciones', '/politica-de-cambios-y-devoluciones', '/politica-de-privacidad']
const PRIVADAS = ['/mi-perfil', '/citas', '/citas/carrito', '/historial', '/carrito', '/mis-resenas', '/mi-perfil/direcciones', '/mi-perfil/pedidos', '/mi-perfil/notificaciones', '/mi-perfil/seguridad', '/mi-perfil/referidos']
const psql = (sql) => cp.execFileSync('docker', ['exec', '-i', 'supabase_db_WedJaiseReact', 'psql', '-U', 'postgres', '-d', 'postgres', '-At'], { input: sql, encoding: 'utf8' }).trim()

function esperado(perfil, ruta) {
  const base = ruta.replace(/\/[0-9a-f-]{36}$/, '/:id')
  const publica = PUBLICAS.includes(ruta) || base === '/productos/:id' || base === '/servicios/:id'
  const privada = PRIVADAS.includes(ruta)
  if (perfil === 'visitante') return publica ? ruta : '/login' // privada del portal o ruta del POS
  if (perfil === 'clienta') return publica || privada ? ruta : '/inicio'
  const rol = { asistente: S, cajera: C, admin: A }[perfil]
  if (CONTROL && rol === C && ruta === '/dashboard') return ruta
  if (POS[ruta]) return POS[ruta].includes(rol) ? ruta : INICIAL[rol]
  return INICIAL[rol] // ruta solo del portal: el árbol del POS manda a la pantalla inicial
}

const casos = []
async function caso(nombre, fn) {
  const t0 = Date.now()
  try { const detalle = await fn(); casos.push({ nombre, ok: true, ms: Date.now() - t0, detalle }); console.log(`OK    ${nombre}`) } catch (e) {
    const d = String(e.message).split('\n').filter(Boolean).slice(0, 8).join(' | ').slice(0, 1500)
    casos.push({ nombre, ok: false, ms: Date.now() - t0, error: d }); console.log(`FALLA ${nombre}\n      ${d}`)
  }
}

// Espera a que la ruta se asiente: mismo pathname 1 s seguido, documento completo y contenido visible (o el formulario de login).
async function asentar(page) {
  let previo = null, estable = 0
  const fin = Date.now() + 25000
  while (Date.now() < fin) {
    const e = await page.evaluate(() => ({
      ruta: location.pathname, listo: document.readyState === 'complete',
      login: Boolean(document.querySelector('#email')),
      texto: (document.querySelector('main')?.innerText ?? '').trim().length,
      cargando: /Cargando|Abriendo/i.test(document.body.innerText.slice(0, 400)) && (document.querySelector('main')?.innerText ?? '').trim().length < 40,
    })).catch(() => null)
    if (e && e.ruta === previo && e.listo && !e.cargando && (e.login || e.texto > 20)) { estable += 1; if (estable >= 4) return e } else estable = 0
    previo = e?.ruta
    await page.waitForTimeout(250)
  }
  return { ruta: previo, timeout: true }
}

async function main() {
  const local = JSON.parse(cp.execFileSync(path.join(RAIZ, 'node_modules/@supabase/cli-windows-x64/bin/supabase.exe'), ['status', '-o', 'json'], { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  if (local.API_URL !== API) throw new Error('Supabase no es el local verificado (127.0.0.1:54321): no se verifica')
  const svc = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

  // La matriz escrita aquí debe coincidir con la configuración real.
  const { secciones, rutaInicialPara } = await import(pathToFileURL(path.join(RAIZ, 'src/config/navegacion.js')).href)
  await caso('La matriz esperada coincide con src/config/navegacion.js (27 rutas, roles y pantalla inicial)', async () => {
    const real = Object.fromEntries(secciones.map((s) => [s.path, [...s.roles].sort()]))
    const esp = Object.fromEntries(Object.entries(POS).map(([k, v]) => [k, [...v].sort()]))
    if (JSON.stringify(real) !== JSON.stringify(esp)) throw new Error(`difiere: ${JSON.stringify({ real, esp })}`)
    for (const r of [A, C, S]) if (rutaInicialPara(r) !== INICIAL[r]) throw new Error(`pantalla inicial de ${r}: ${rutaInicialPara(r)}`)
    return { rutas: secciones.length }
  })

  const [idProducto, idServicio] = psql("begin read only; select (select id from productos where activo order by nombre limit 1) || '|' || (select id from servicios where activo order by nombre limit 1); rollback;").split('\n').find((l) => l.includes('|')).split('|')
  // /servicios, /citas e /historial existen en el POS y en el portal: cada ruta se visita una sola vez.
  const RUTAS = [...new Set([...Object.keys(POS), ...PUBLICAS, ...PRIVADAS, `/productos/${idProducto}`, `/servicios/${idServicio}`])]

  // Cuenta ASISTENTE ficticia (solo Local).
  const asistente = { email: `qa-f10a-asistente-${crypto.randomBytes(3).toString('hex')}@test.local`, password: crypto.randomBytes(18).toString('base64url') + 'aA1!' }
  let uidAsistente = null
  const navegador = await chromium.launch({ headless: true })
  try {
    const { data, error } = await svc.auth.admin.createUser({ email: asistente.email, password: asistente.password, email_confirm: true })
    if (error) throw new Error(`crear asistente: ${error.message}`)
    uidAsistente = data.user.id
    const ins = await svc.from('usuarios').insert({ id: uidAsistente, email: asistente.email, activo: true, rol: S, nombre_completo: 'TEST QA F10A Asistente' })
    if (ins.error) throw new Error(`perfil asistente: ${ins.error.message}`)

    const perfiles = [
      ['visitante', null], ['clienta', CUENTAS.clienteA], ['asistente', asistente], ['cajera', CUENTAS.cajera], ['admin', CUENTAS.admin],
    ]
    const matriz = {}
    for (const [perfil, cuenta] of perfiles) {
      const ctx = await navegador.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' })
      // Solo la app y el Supabase Local; el resto (fuentes, mapas) se responde vacío para no depender de la red.
      await ctx.route('**/*', (r) => { const o = new URL(r.request().url()).origin; return o === new URL(APP).origin || o === API ? r.continue() : r.fulfill({ status: 204, body: '' }) })
      const page = await ctx.newPage()
      const errores = []
      page.on('pageerror', (e) => errores.push(String(e.message).slice(0, 200)))
      if (cuenta) {
        await page.goto(`${APP}/login`)
        await page.fill('#email', cuenta.email); await page.fill('#password', cuenta.password); await page.click('button[type=submit]')
        await page.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 30000 })
        await asentar(page)
      }
      matriz[perfil] = []
      await caso(`${perfil}: ${RUTAS.length} rutas por URL directa llegan a su destino esperado y se montan sin error`, async () => {
        const malas = []
        for (const ruta of RUTAS) {
          const antesErr = errores.length
          await page.goto(`${APP}${ruta}`)
          const e = await asentar(page)
          const fin = (e.ruta ?? '').replace(/^\/PosJaise/, '')
          const quiere = esperado(perfil, ruta)
          const textoError = await page.evaluate(() => /No se pudo abrir|Ocurrió un error en|Algo salió mal/.test(document.body.innerText))
          const fila = { ruta, destino: fin, esperado: quiere, ok: fin === quiere && !textoError && !e.timeout && errores.length === antesErr }
          if (!fila.ok) malas.push({ ...fila, textoError, timeout: Boolean(e.timeout), pageerror: errores.slice(antesErr) })
          matriz[perfil].push(fila)
        }
        if (malas.length) throw new Error(JSON.stringify(malas.slice(0, 6)))
        return { rutas: RUTAS.length, permitidas: matriz[perfil].filter((f) => f.destino === f.ruta).length }
      })
      if (perfil === 'asistente' || perfil === 'cajera' || perfil === 'admin') {
        const rol = { asistente: S, cajera: C, admin: A }[perfil]
        await caso(`${perfil}: el menú del POS no ofrece rutas ajenas al rol y sí su pantalla inicial`, async () => {
          await page.goto(`${APP}${INICIAL[rol]}`); await asentar(page)
          const enlaces = await page.evaluate((rutas) => [...new Set([...document.querySelectorAll('header a[href], nav a[href], aside a[href]')]
            .map((a) => new URL(a.href).pathname.replace(/^\/PosJaise/, '')).filter((p) => rutas.includes(p)))], Object.keys(POS))
          const ajenas = enlaces.filter((p) => !POS[p].includes(rol))
          if (ajenas.length) throw new Error(`enlaces a rutas sin permiso: ${ajenas.join(', ')}`)
          if (!enlaces.includes(INICIAL[rol])) throw new Error(`falta su pantalla inicial ${INICIAL[rol]} en el menú: ${enlaces.join(', ')}`)
          return { enlaces }
        })
        await caso(`${perfil}: «Cerrar sesión» y después una ruta del POS vuelve a pedir el login`, async () => {
          await page.getByRole('button', { name: 'Menú de usuario' }).first().click()
          await page.getByRole('button', { name: 'Cerrar sesión' }).first().click()
          await page.getByRole('button', { name: 'Sí, cerrar sesión' }).click()
          await page.waitForTimeout(1500)
          await page.goto(`${APP}${INICIAL[rol]}`)
          const e = await asentar(page)
          if (e.ruta?.replace(/^\/PosJaise/, '') !== '/login') throw new Error(`tras salir, ${INICIAL[rol]} terminó en ${e.ruta}`)
        })
      }
      await ctx.close()
    }
    return matriz
  } finally {
    await navegador.close()
    if (uidAsistente) {
      await svc.from('usuarios').delete().eq('id', uidAsistente)
      const d = await svc.auth.admin.deleteUser(uidAsistente)
      casos.push({ nombre: 'Limpieza: la cuenta ASISTENTE ficticia se eliminó', ok: !d.error, detalle: d.error?.message })
    }
  }
}

main().then((matriz) => {
  const fallos = casos.filter((c) => !c.ok)
  if (SALIDA) fs.writeFileSync(SALIDA, JSON.stringify({ fecha: new Date().toISOString(), app: APP, controlNegativo: CONTROL, total: casos.length, fallos: fallos.length, casos, matriz }, null, 1))
  console.log(`\n${casos.length - fallos.length}/${casos.length} correctos`)
  process.exit(fallos.length ? 1 : 0)
}).catch((e) => { console.error(e); process.exit(2) })
