// Fase 3 · pruebas de los MODALES REALES (Producto, Servicio, Galería) con fallos inyectados.
//
// Aislamiento:
//   - Datos de negocio: las llamadas REST de Supabase (productos, servicios, producto_fotos,
//     servicio_fotos, galeria_web) las responde un simulador en memoria dentro de este script;
//     NO se escribe ni se lee ninguna tabla remota. Cualquier otra petición REST/Storage a
//     Supabase se bloquea y hace fallar la prueba.
//   - Imágenes: Worker de medios local con R2 SIMULADO (wrangler dev --local).
//   - Supabase de STAGING solo se usa para iniciar sesión con la cuenta QA ADMIN (que el
//     Worker valida contra /auth/v1/user y es_admin): son lecturas de autenticación.
//   - Los modales se montan con el arnés tests/harness/modales-fase3.jsx (solo desarrollo).
//
//   node scripts/verificar-modales-fase3.cjs
const { spawn, execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('C:/WedJaiseReact/node_modules/playwright')

const raiz = 'C:/WedJaiseReact'
const carpetaWorker = "C:\\Users\\jdeos\\.codex\\visualizations\\2026\\10\\09\\01a11ea8-be2a-7611-8e67-4ded5cca3f25\\fase3-verificacion-v2\\worker-clon"
const estado = path.join(carpetaWorker, ".estado-5522")
const borrarOriginal = fs.rmSync; fs.rmSync=()=>{}
const PUERTO_W = 5512
const PUERTO_V = 5522
const API = `http://127.0.0.1:${PUERTO_W}`
const ORIGEN = `http://localhost:${PUERTO_V}`
const REF_STAGING = 'tqkdtojnhgykmcbvwdmz'

function leerEnv(ruta) {
  const salida = {}
  for (const linea of fs.readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) salida[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return salida
}
const env = leerEnv(path.join(raiz, '.env.staging.local'))
if (!env.VITE_SUPABASE_URL.includes(REF_STAGING)) throw new Error('Debe ser el Supabase de staging')

const casos = []
const caso = (nombre, ok, detalle = {}) => {
  casos.push({ nombre, ...detalle, ok: Boolean(ok) })
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${ok ? '' : ' ' + JSON.stringify(detalle)}`)
}
const matar = (p) => { try { execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: 'ignore' }) } catch {} }
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

async function esperarUrl(url, estadoEsperado) {
  for (let i = 0; i < 90; i += 1) {
    try { const r = await fetch(url); if (!estadoEsperado || r.status === estadoEsperado) return } catch {}
    await espera(1000)
  }
  throw new Error('No arrancó ' + url)
}

// ---------------- simulador de PostgREST en memoria ----------------
function crearSimulador() {
  const db = { productos: [], productos_vista: [], servicios: [], producto_fotos: [], servicio_fotos: [], galeria_web: [] }
  const fallas = []
  const registro = { noSimuladas: [], llamadas: [] }
  let contador = 0

  const cabeceras = (extra = {}) => ({
    'access-control-allow-origin': ORIGEN,
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-expose-headers': '*',
    'content-type': 'application/json',
    ...extra,
  })

  function filtrar(filas, parametros) {
    let resultado = filas
    for (const [clave, valor] of parametros) {
      if (['select', 'order', 'limit', 'offset', 'columns'].includes(clave)) continue
      if (valor.startsWith('eq.')) resultado = resultado.filter((f) => String(f[clave]) === valor.slice(3))
      else if (valor.startsWith('in.(')) {
        const lista = valor.slice(4, -1).split(',').map((v) => v.replace(/^"|"$/g, ''))
        resultado = resultado.filter((f) => lista.includes(String(f[clave])))
      }
    }
    return resultado
  }

  async function manejar(route) {
    const peticion = route.request()
    const url = new URL(peticion.url())
    const tabla = url.pathname.split('/').pop()
    const metodo = peticion.method()
    if (metodo === 'OPTIONS') return route.fulfill({ status: 204, headers: cabeceras() })
    if (!db[tabla]) {
      registro.noSimuladas.push(`${metodo} ${url.pathname}`)
      return route.fulfill({ status: 404, headers: cabeceras(), body: '{"message":"no simulada"}' })
    }
    registro.llamadas.push(`${metodo} ${tabla}`)

    const falla = fallas.find((f) => f.tabla === tabla && f.metodo === metodo && f.quedan > 0)
    if (falla) {
      falla.quedan -= 1
      if (falla.silencioso) return route.fulfill({ status: 200, headers: cabeceras(), body: '[]' }) // RLS: 0 filas, sin error
      return route.fulfill({ status: falla.status ?? 403, headers: cabeceras(), body: JSON.stringify(falla.body ?? { code: '42501', message: 'permiso denegado (simulado)' }) })
    }

    const unico = (peticion.headers().accept ?? '').includes('vnd.pgrst.object')
    const responder = (filas, estadoHttp = 200) =>
      unico
        ? filas.length === 1
          ? route.fulfill({ status: estadoHttp, headers: cabeceras(), body: JSON.stringify(filas[0]) })
          : route.fulfill({ status: 406, headers: cabeceras(), body: JSON.stringify({ code: 'PGRST116', message: 'sin filas' }) })
        : route.fulfill({ status: estadoHttp, headers: cabeceras(), body: JSON.stringify(filas) })

    if (metodo === 'GET') {
      const filas = filtrar(db[tabla], url.searchParams).slice().sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      return responder(filas)
    }
    if (metodo === 'POST') {
      const cuerpo = JSON.parse(peticion.postData() ?? '{}')
      const nuevas = (Array.isArray(cuerpo) ? cuerpo : [cuerpo]).map((f) => ({ id: f.id ?? `id-${(contador += 1)}`, ...f }))
      db[tabla].push(...nuevas)
      return responder(nuevas, 201)
    }
    if (metodo === 'PATCH') {
      const cuerpo = JSON.parse(peticion.postData() ?? '{}')
      const afectadas = filtrar(db[tabla], url.searchParams)
      afectadas.forEach((f) => Object.assign(f, cuerpo))
      return responder(afectadas)
    }
    if (metodo === 'DELETE') {
      const afectadas = filtrar(db[tabla], url.searchParams)
      db[tabla] = db[tabla].filter((f) => !afectadas.includes(f))
      return responder(afectadas)
    }
    return route.fulfill({ status: 405, headers: cabeceras(), body: '{}' })
  }

  return {
    db,
    registro,
    manejar,
    reiniciar() { for (const k of Object.keys(db)) db[k] = []; fallas.length = 0 },
    fallar(tabla, metodo, opciones = {}) { fallas.push({ tabla, metodo, quedan: opciones.veces ?? 1, ...opciones }) },
    limpiarFallas() { fallas.length = 0 },
    sembrar(tabla, filas) { db[tabla].push(...filas) },
  }
}

;(async () => {
  try { fs.rmSync(estado, { recursive: true, force: true }) } catch {}
  fs.mkdirSync(estado, { recursive: true })
  fs.writeFileSync(path.join(carpetaWorker, '.dev.vars'), `SUPABASE_ANON_KEY=${env.VITE_SUPABASE_ANON_KEY}\n`)

  const worker = spawn(process.execPath, ['C:/WedJaiseReact/cloudflare/medios-worker/node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--port', String(PUERTO_W), '--persist-to', estado, '--var', 'SERVIR_LECTURA:1', '--var', `ORIGENES_PERMITIDOS:${ORIGEN}`], { cwd: carpetaWorker, shell: false, stdio: 'ignore' })
  const vite = spawn(process.execPath, ['C:/WedJaiseReact/node_modules/vite/bin/vite.js', '--configLoader', 'native', '--config', "C:\\Users\\jdeos\\.codex\\visualizations\\2026\\10\\09\\01a11ea8-be2a-7611-8e67-4ded5cca3f25\\fase3-verificacion-v2\\vite-diagnostico.mjs", '--port', String(PUERTO_V), '--strictPort', '--host', 'localhost'], {
    cwd: raiz, shell: false, stdio: 'ignore',
    env: { ...process.env, VITE_SUPABASE_URL: env.VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY, VITE_CULQI_PUBLIC_KEY: '', VITE_MEDIOS_PROVEEDOR: 'r2', VITE_MEDIOS_API_URL: API, VITE_MEDIOS_PUBLIC_URL: API },
  })
  const navegador = await chromium.launch()

  try {
    await esperarUrl(`${API}/ping`, 404)
    await esperarUrl(`${ORIGEN}/tests/harness/modales-fase3.html`)

    // Token de administrador QA (solo autenticación) para sembrar/inspeccionar R2 desde Node.
    const login = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: env.QA_ADMIN_EMAIL, password: env.QA_ADMIN_PASSWORD }) })
    const token = (await login.json()).access_token

    const sim = crearSimulador()
    const ctx = await navegador.newContext()
    const page = await ctx.newPage()
    const errores = []
    page.on('pageerror', (e) => { errores.push(String(e)); if (process.env.DEPURAR) console.log('pageerror', String(e)) })
    if (process.env.DEPURAR) page.on('console', (m) => m.type() === 'error' && console.log('consola:', m.text().slice(0, 300)))
    const supabaseNoAuth = []
    page.on('request', (r) => {
      const u = new URL(r.url())
      if (u.hostname.endsWith('supabase.co') && !u.pathname.startsWith('/auth/') && !u.pathname.startsWith('/rest/v1/')) supabaseNoAuth.push(`${r.method()} ${u.pathname}`)
    })
    await page.route(/supabase\.co\/rest\/v1\//, sim.manejar)

    await page.goto(`${ORIGEN}/tests/harness/modales-fase3.html`, { waitUntil: 'networkidle' })
    await page.evaluate(async ([email, password]) => {
      const { error } = await window.__supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    }, [env.QA_ADMIN_EMAIL, env.QA_ADMIN_PASSWORD])

    // ---------- utilidades ----------
    const generar = (lado) => page.evaluate(async (l) => {
      const c = document.createElement('canvas'); c.width = l; c.height = l
      const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, l, l)
      g.addColorStop(0, '#c9a24b'); g.addColorStop(1, '#2b2b2b'); x.fillStyle = g; x.fillRect(0, 0, l, l)
      const webp = async (lado2) => { const d = document.createElement('canvas'); d.width = lado2; d.height = lado2; d.getContext('2d').drawImage(c, 0, 0, lado2, lado2); const b = await new Promise((o) => d.toBlob(o, 'image/webp', 0.8)); return Array.from(new Uint8Array(await b.arrayBuffer())) }
      const png = await new Promise((o) => c.toBlob(o, 'image/png'))
      return { png: Array.from(new Uint8Array(await png.arrayBuffer())), m: await webp(320), g: await webp(600) }
    }, lado)
    const imagen = await generar(800)
    const PNG = Buffer.from(imagen.png)

    async function sembrarR2(destino) {
      const id = crypto.randomUUID()
      for (const [variante, bytes] of [['m', imagen.m], ['g', imagen.g]]) {
        const r = await fetch(`${API}/v1/medios/${destino}/${id}/${variante}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, Origin: ORIGEN, 'Content-Type': 'image/webp' }, body: Uint8Array.from(bytes) })
        if (r.status !== 201) throw new Error('No se pudo sembrar ' + r.status)
      }
      return `r2:${destino}/${id}`
    }
    async function inventario() {
      const grupos = new Set()
      for (const destino of ['fotos-productos', 'fotos-servicios', 'fotos-galeria']) {
        const r = await fetch(`${API}/v1/inventario/${destino}`, { headers: { Authorization: `Bearer ${token}`, Origin: ORIGEN } })
        for (const o of (await r.json()).objetos) grupos.add(o.clave.split('/').slice(0, 2).join('/'))
      }
      return grupos
    }
    const grupoDe = (ref) => ref.replace(/^r2:/, '')
    const textoModal = () => page.locator('form').innerText()
    const abrir = async (tipo, props) => {
      await page.evaluate(([t, p]) => window.__montar(t, p), [tipo, props])
      await page.waitForSelector('form')
      await espera(300)
    }
    const eligir = async (indice, buffer = PNG) => {
      await page.locator('input[type=file]').nth(indice).setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer })
      await page.waitForFunction(() => !document.body.innerText.includes('Procesando'), null, { timeout: 15000 })
      await espera(200)
    }
    const guardar = async () => {
      await page.locator('form button[type=submit]').click()
      await espera(300)
      await page.waitForFunction(() => !/Guardando\.\.\./.test(document.body.innerText), null, { timeout: 60000 })
      await espera(900) // los borrados «best-effort» del modal no se esperan
    }
    const eventos = () => page.evaluate(() => window.__eventos)
    const guardados = async () => (await eventos()).filter((e) => e.tipo === 'guardado').length
    const abortarDesdeSegundo = async (patron) => {
      const vistos = []
      await page.route(patron, (ruta) => {
        const id = ruta.request().url().split('/')[6]
        if (!vistos.includes(id)) vistos.push(id)
        return vistos.indexOf(id) >= 1 ? ruta.abort('failed') : ruta.continue()
      })
    }

    const producto = (extra = {}) => ({ id: 'p1', nombre: 'Producto QA ficticio', codigo_barras: 'QA-0001', categoria: 'Cabello', precio: 50, costo: 20, stock_actual: 5, ...extra })
    const servicio = (extra = {}) => ({ id: 's1', nombre: 'Servicio QA ficticio', categoria: 'Corte', precio: 40, duracion_min: 30, activo: true, ...extra })

    // =============== PRODUCTO ===============
    // PR1 feliz: foto principal nueva + una foto de galería nueva
    sim.reiniciar()
    let viejo = await sembrarR2('fotos-productos')
    let g0 = await sembrarR2('fotos-productos')
    sim.sembrar('productos', [{ id: 'p1', foto_url: viejo }])
    sim.sembrar('producto_fotos', [{ id: 'g0', producto_id: 'p1', foto_url: g0, etiqueta: 'Frente', orden: 0 }])
    let antes = await inventario()
    await abrir('producto', { modo: 'web', producto: producto({ foto_url: viejo }), categoriasExistentes: ['Cabello'] })
    await eligir(0)
    await eligir(1)
    await guardar()
    let despues = await inventario()
    let fila = sim.db.productos[0]
    let nuevasFilas = sim.db.producto_fotos
    caso('PRODUCTO feliz: se guarda, la foto principal nueva existe, la anterior se elimina, la galería suma una foto',
      (await guardados()) === 1 && fila.foto_url.startsWith('r2:') && fila.foto_url !== viejo && despues.has(grupoDe(fila.foto_url)) && !despues.has(grupoDe(viejo)) && nuevasFilas.length === 2 && nuevasFilas.every((f) => despues.has(grupoDe(f.foto_url))),
      { guardados: await guardados(), antes: antes.size, despues: despues.size })

    // PR2: el insert de la galería falla → resultado parcial claro, sin huérfano, y reintento correcto
    sim.reiniciar()
    viejo = await sembrarR2('fotos-productos'); g0 = await sembrarR2('fotos-productos')
    sim.sembrar('productos', [{ id: 'p1', foto_url: viejo }])
    sim.sembrar('producto_fotos', [{ id: 'g0', producto_id: 'p1', foto_url: g0, etiqueta: 'Frente', orden: 0 }])
    sim.fallar('producto_fotos', 'POST', { veces: 1 })
    antes = await inventario()
    await abrir('producto', { modo: 'web', producto: producto({ foto_url: viejo }), categoriasExistentes: ['Cabello'] })
    await eligir(1)
    await guardar()
    despues = await inventario()
    let texto = await textoModal()
    caso('PRODUCTO insert de galería rechazado (42501): NO se finge éxito, mensaje parcial visible, objeto subido limpiado, referencias intactas',
      (await guardados()) === 0 && /galería quedó incompleta/.test(texto) && despues.size === antes.size && sim.db.producto_fotos.length === 1 && despues.has(grupoDe(viejo)) && despues.has(grupoDe(g0)),
      { guardados: await guardados(), texto: texto.slice(-200), antes: antes.size, despues: despues.size })
    await guardar() // reintento (la falla ya se consumió)
    despues = await inventario()
    caso('PRODUCTO reintento tras el fallo: la foto de galería queda guardada una sola vez y el modal informa guardado',
      (await guardados()) === 1 && sim.db.producto_fotos.length === 2 && sim.db.producto_fotos.every((f) => despues.has(grupoDe(f.foto_url))) && despues.size === antes.size + 1,
      { guardados: await guardados(), filas: sim.db.producto_fotos.length, antes: antes.size, despues: despues.size })

    // PR3: falla el guardado del producto → la foto anterior se conserva, la nueva se limpia
    sim.reiniciar()
    viejo = await sembrarR2('fotos-productos')
    sim.sembrar('productos', [{ id: 'p1', foto_url: viejo }])
    sim.fallar('productos', 'PATCH', { veces: 1 })
    antes = await inventario()
    await abrir('producto', { modo: 'web', producto: producto({ foto_url: viejo }), categoriasExistentes: ['Cabello'] })
    await eligir(0)
    await guardar()
    despues = await inventario()
    caso('PRODUCTO falla el guardado en BD: la foto anterior se conserva, la nueva no queda huérfana, mensaje de error',
      (await guardados()) === 0 && sim.db.productos[0].foto_url === viejo && despues.has(grupoDe(viejo)) && despues.size === antes.size && /No se pudo guardar el producto/.test(await textoModal()),
      { antes: antes.size, despues: despues.size })
    await guardar()
    despues = await inventario()
    caso('PRODUCTO reintento tras fallo de BD: la foto nueva se guarda y la anterior se elimina',
      (await guardados()) === 1 && sim.db.productos[0].foto_url !== viejo && despues.has(grupoDe(sim.db.productos[0].foto_url)) && !despues.has(grupoDe(viejo)),
      { foto: sim.db.productos[0].foto_url })

    // PR4: principal guardada, galería falla; el reintento NO vuelve a subir ni borra la principal
    sim.reiniciar()
    viejo = await sembrarR2('fotos-productos')
    sim.sembrar('productos', [{ id: 'p1', foto_url: viejo }])
    sim.fallar('producto_fotos', 'POST', { veces: 1 })
    antes = await inventario()
    await abrir('producto', { modo: 'web', producto: producto({ foto_url: viejo }), categoriasExistentes: ['Cabello'] })
    await eligir(0)
    await eligir(1)
    await guardar()
    const principalTrasFallo = sim.db.productos[0].foto_url
    despues = await inventario()
    const tras1 = despues.size
    await guardar()
    despues = await inventario()
    caso('PRODUCTO principal ya guardada + galería fallida: el reintento reutiliza la subida (sin duplicar ni dejar referencia rota)',
      principalTrasFallo !== viejo && sim.db.productos[0].foto_url === principalTrasFallo && despues.has(grupoDe(principalTrasFallo)) && !despues.has(grupoDe(viejo)) && sim.db.producto_fotos.length === 1 && despues.size === tras1 + 1 && (await guardados()) === 1,
      { tras1, final: despues.size, filas: sim.db.producto_fotos.length })

    // PR5 / PR6 / PR7: quitar una foto de la galería
    for (const [variante, falla, esperaBorrado, esperaMensaje] of [
      ['se elimina la fila y luego el objeto', null, true, false],
      ['el delete falla (HTTP 500): fila y objeto se conservan', { status: 500, body: { message: 'caído' } }, false, true],
      ['el delete no afecta filas (RLS silencioso): el objeto NO se borra', { silencioso: true }, false, true],
    ]) {
      sim.reiniciar()
      g0 = await sembrarR2('fotos-productos')
      sim.sembrar('productos', [{ id: 'p1', foto_url: null }])
      sim.sembrar('producto_fotos', [{ id: 'g0', producto_id: 'p1', foto_url: g0, etiqueta: 'Frente', orden: 0 }])
      if (falla) sim.fallar('producto_fotos', 'DELETE', falla)
      await abrir('producto', { modo: 'web', producto: producto(), categoriasExistentes: ['Cabello'] })
      await page.getByRole('button', { name: 'Quitar foto de la galería' }).click()
      await guardar()
      despues = await inventario()
      const filaSigue = sim.db.producto_fotos.length === 1
      caso(`PRODUCTO quitar foto de galería — ${variante}`,
        esperaBorrado ? !filaSigue && !despues.has(grupoDe(g0)) && (await guardados()) === 1 : filaSigue && despues.has(grupoDe(g0)) && /quitar algunas fotos/.test(await textoModal()) && (await guardados()) === 0,
        { filaSigue, objetoExiste: despues.has(grupoDe(g0)), esperaMensaje })
    }

    // PR8: la segunda foto de galería no se puede subir (corte de red persistente)
    sim.reiniciar()
    sim.sembrar('productos', [{ id: 'p1', foto_url: null }])
    antes = await inventario()
    await abrir('producto', { modo: 'web', producto: producto(), categoriasExistentes: ['Cabello'] })
    await eligir(1)
    await eligir(1)
    await abortarDesdeSegundo(`${API}/v1/medios/fotos-productos/**`)
    await guardar()
    despues = await inventario()
    caso('PRODUCTO 2.ª foto de galería sin red: la 1.ª queda guardada, la 2.ª no deja huérfanos y se informa',
      sim.db.producto_fotos.length === 1 && despues.size === antes.size + 1 && /No se pudo subir una foto/.test(await textoModal()) && (await guardados()) === 0,
      { filas: sim.db.producto_fotos.length, antes: antes.size, despues: despues.size })
    await page.unroute(`${API}/v1/medios/fotos-productos/**`)
    await guardar()
    despues = await inventario()
    caso('PRODUCTO reintento tras recuperar la red: queda 1 sola fila por foto (sin duplicar la 1.ª)',
      sim.db.producto_fotos.length === 2 && sim.db.producto_fotos.every((f) => despues.has(grupoDe(f.foto_url))) && (await guardados()) === 1,
      { filas: sim.db.producto_fotos.length })

    // =============== SERVICIO (mismo flujo compartido) ===============
    sim.reiniciar()
    let viejoS = await sembrarR2('fotos-servicios')
    sim.sembrar('servicios', [{ id: 's1', foto_url: viejoS, nombre: 'Servicio QA ficticio', precio: 40 }])
    antes = await inventario()
    await abrir('servicio', { modo: 'web', servicio: servicio({ foto_url: viejoS }), categoriasExistentes: ['Corte'] })
    await eligir(0)
    await eligir(1)
    await guardar()
    despues = await inventario()
    caso('SERVICIO feliz: foto principal nueva + galería; la anterior se elimina',
      (await guardados()) === 1 && sim.db.servicios[0].foto_url !== viejoS && !despues.has(grupoDe(viejoS)) && sim.db.servicio_fotos.length === 1 && despues.has(grupoDe(sim.db.servicio_fotos[0].foto_url)),
      { texto: (await textoModal()).slice(-150) })

    sim.reiniciar()
    viejoS = await sembrarR2('fotos-servicios')
    sim.sembrar('servicios', [{ id: 's1', foto_url: viejoS, nombre: 'Servicio QA ficticio', precio: 40 }])
    sim.fallar('servicio_fotos', 'POST', { veces: 1 })
    antes = await inventario()
    await abrir('servicio', { modo: 'web', servicio: servicio({ foto_url: viejoS }), categoriasExistentes: ['Corte'] })
    await eligir(1)
    await guardar()
    despues = await inventario()
    caso('SERVICIO insert de galería rechazado: parcial claro, sin huérfano ni éxito ficticio',
      (await guardados()) === 0 && /galería quedó incompleta/.test(await textoModal()) && despues.size === antes.size && sim.db.servicio_fotos.length === 0,
      { antes: antes.size, despues: despues.size })
    await guardar()
    despues = await inventario()
    caso('SERVICIO reintento: la foto queda guardada una vez',
      (await guardados()) === 1 && sim.db.servicio_fotos.length === 1 && despues.has(grupoDe(sim.db.servicio_fotos[0].foto_url)) && despues.size === antes.size + 1)

    // =============== GALERÍA ANTES/DESPUÉS ===============
    const urlR2 = (ref, v = 'g') => `${API}/${grupoDe(ref)}/${v}.webp`
    // GA1: alta feliz
    sim.reiniciar()
    antes = await inventario()
    await abrir('galeria', { item: null })
    await eligir(0)
    await eligir(1)
    await guardar()
    despues = await inventario()
    caso('GALERÍA alta feliz: se suben las dos fotos y se guarda una fila',
      (await guardados()) === 1 && sim.db.galeria_web.length === 1 && despues.size === antes.size + 2,
      { filas: sim.db.galeria_web.length, antes: antes.size, despues: despues.size })

    // GA2: «después» no se puede subir → «antes» ya subida se limpia (F3-03.1)
    sim.reiniciar()
    antes = await inventario()
    await abrir('galeria', { item: null })
    await eligir(0)
    await eligir(1)
    await abortarDesdeSegundo(`${API}/v1/medios/fotos-galeria/**`)
    await guardar()
    despues = await inventario()
    caso('GALERÍA falla la subida de «después»: la de «antes» NO queda huérfana, sin escritura en BD, error visible',
      (await guardados()) === 0 && despues.size === antes.size && sim.db.galeria_web.length === 0 && /No se pudo subir alguna/.test(await textoModal()),
      { antes: antes.size, despues: despues.size })
    await page.unroute(`${API}/v1/medios/fotos-galeria/**`)

    // GA3: el insert falla → ambas se limpian
    sim.reiniciar()
    sim.fallar('galeria_web', 'POST', { veces: 1 })
    antes = await inventario()
    await abrir('galeria', { item: null })
    await eligir(0)
    await eligir(1)
    await guardar()
    despues = await inventario()
    caso('GALERÍA falla el insert en BD: ambas fotos subidas se limpian', (await guardados()) === 0 && despues.size === antes.size && /No se pudo guardar/.test(await textoModal()), { antes: antes.size, despues: despues.size })

    // GA4 / GA5: reemplazo de «antes»
    for (const [variante, falla, exito] of [['update correcto', null, true], ['update que RLS deja en 0 filas', { silencioso: true }, false]]) {
      sim.reiniciar()
      const refAntes = await sembrarR2('fotos-galeria'); const refDespues = await sembrarR2('fotos-galeria')
      const item = { id: 'ga1', titulo: 'QA', antes_url: urlR2(refAntes), despues_url: urlR2(refDespues), orden: 1, activo: true }
      sim.sembrar('galeria_web', [{ ...item }])
      if (falla) sim.fallar('galeria_web', 'PATCH', falla)
      antes = await inventario()
      await abrir('galeria', { item })
      await eligir(0)
      await guardar()
      despues = await inventario()
      const urlNueva = sim.db.galeria_web[0].antes_url
      caso(`GALERÍA reemplazo de «antes» — ${variante}`,
        exito
          ? (await guardados()) === 1 && urlNueva !== item.antes_url && !despues.has(grupoDe(refAntes)) && despues.has(grupoDe(refDespues)) && despues.size === antes.size
          : (await guardados()) === 0 && urlNueva === item.antes_url && despues.has(grupoDe(refAntes)) && despues.size === antes.size,
        { antes: antes.size, despues: despues.size })
    }

    // ---------- aislamiento ----------
    caso('aislamiento: ninguna petición REST/Storage fuera de las tablas simuladas llegó a Supabase', sim.registro.noSimuladas.length === 0 && supabaseNoAuth.length === 0, { noSimuladas: sim.registro.noSimuladas, supabaseNoAuth })
    caso('sin errores de página en todo el recorrido', errores.length === 0, { errores })
  } finally {
    await navegador.close().catch(() => {})
    matar(vite)
    matar(worker)
    fs.rmSync(path.join(carpetaWorker, '.dev.vars'), { force: true })
    await espera(1500)
    try { fs.rmSync(estado, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }) } catch {}
  }

  const fallos = casos.filter((c) => !c.ok)
  const carpeta = "C:\\Users\\jdeos\\.codex\\visualizations\\2026\\10\\09\\01a11ea8-be2a-7611-8e67-4ded5cca3f25\\fase3-verificacion-v2"
  fs.mkdirSync(carpeta, { recursive: true })
  fs.writeFileSync(path.join(carpeta, 'pruebas-modales.json'), JSON.stringify({ fecha: new Date().toISOString(), entorno: 'Modales reales + simulador REST en memoria + Worker local con R2 simulado; Supabase staging solo para iniciar sesión', total: casos.length, fallos: fallos.length, casos }, null, 2))
  console.log(`\n${casos.length} casos, ${fallos.length} fallos`)
  process.exit(fallos.length ? 1 : 0)
})().catch((e) => { console.error(e); try { fs.rmSync(path.join(carpetaWorker, '.dev.vars'), { force: true }) } catch {}; process.exit(2) })
