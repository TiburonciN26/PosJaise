// Fase 3 · prueba en NAVEGADOR REAL de la capa de medios (lib/medios.js + lib/imagenes.js).
//
// Entorno: Vite dev (puerto 5199) + Worker de medios local con R2 SIMULADO
// (wrangler dev --local). El Supabase de STAGING se usa SOLO para iniciar sesión
// (lecturas de autenticación). Las tablas (galeria_web) y Storage de Supabase están
// SIMULADOS en memoria: cualquier escritura REST/Storage que no sea una de las
// simuladas se aborta y hace fallar la prueba. No toca R2 real, el Supabase del
// negocio, producción ni GitHub Pages.
//
//   node scripts/verificar-medios-r2-fase3.cjs
const { spawn, execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const raiz = path.resolve(__dirname, '..')
const carpetaWorker = path.join(raiz, 'cloudflare/medios-worker')
const estado = path.join(carpetaWorker, '.estado-local')
const PUERTO_W = 8789
const PUERTO_V = 5199
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
const informePesos = []
const caso = (nombre, ok, detalle = {}) => {
  casos.push({ nombre, ...detalle, ok: Boolean(ok) })
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${ok ? '' : ' ' + JSON.stringify(detalle)}`)
}
const matar = (p) => { try { execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: 'ignore' }) } catch {} }

async function esperar(url, estadoEsperado) {
  for (let i = 0; i < 90; i += 1) {
    try {
      const r = await fetch(url)
      if (!estadoEsperado || r.status === estadoEsperado) return
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('No arrancó ' + url)
}

;(async () => {
  try { fs.rmSync(estado, { recursive: true, force: true }) } catch {}
  fs.mkdirSync(estado, { recursive: true })
  fs.writeFileSync(path.join(carpetaWorker, '.dev.vars'), `SUPABASE_ANON_KEY=${env.VITE_SUPABASE_ANON_KEY}\n`)

  const worker = spawn(
    'npx',
    ['wrangler', 'dev', '--local', '--port', String(PUERTO_W), '--persist-to', estado, '--var', 'SERVIR_LECTURA:1', '--var', `ORIGENES_PERMITIDOS:${ORIGEN}`],
    { cwd: carpetaWorker, shell: true, stdio: 'ignore' },
  )
  const vite = spawn('npx', ['vite', '--port', String(PUERTO_V), '--strictPort', '--host', 'localhost'], {
    cwd: raiz,
    shell: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY,
      VITE_CULQI_PUBLIC_KEY: '',
      VITE_MEDIOS_PROVEEDOR: 'r2',
      VITE_MEDIOS_API_URL: API,
      VITE_MEDIOS_PUBLIC_URL: API,
    },
  })

  const navegador = await chromium.launch()
  let ctx
  try {
    await esperar(`${API}/ping`, 404)
    await esperar(`${ORIGEN}/`)

    ctx = await navegador.newContext()
    const page = await ctx.newPage()
    const errores = []
    page.on('pageerror', (e) => errores.push(String(e)))
    const hostsSupabase = new Set()
    page.on('request', (r) => {
      const u = new URL(r.url())
      if (u.hostname.endsWith('supabase.co') || u.hostname.endsWith('supabase.in')) hostsSupabase.add(u.hostname)
    })

    const CORS = { 'access-control-allow-origin': ORIGEN, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': '*' }
    const escriturasBloqueadas = []
    await page.route(/supabase\.co\//, (ruta) => {
      const req = ruta.request()
      const { pathname } = new URL(req.url())
      // RPC de solo lectura que la app llama al iniciar sesión (POST por diseño de PostgREST).
      const rpcLectura = pathname === '/rest/v1/rpc/politicas_cita_publicas'
      if (pathname.startsWith('/auth/') || rpcLectura || ['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return ruta.continue()
      escriturasBloqueadas.push(`${req.method()} ${pathname}`)
      return ruta.abort('failed')
    })
    const galeriaMock = []
    await page.route(/supabase\.co\/rest\/v1\/galeria_web/, async (ruta) => {
      const req = ruta.request()
      const u = new URL(req.url())
      if (req.method() === 'OPTIONS') return ruta.fulfill({ status: 204, headers: CORS })
      const unico = (req.headers().accept ?? '').includes('vnd.pgrst.object')
      const filtro = (u.searchParams.get('id') ?? '').replace('eq.', '')
      const cuerpo = req.postData() ? JSON.parse(req.postData()) : {}
      const json = (estado, valor) => ruta.fulfill({ status: estado, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(valor) })
      if (req.method() === 'POST') { const fila = { id: `mock-${galeriaMock.length + 1}`, ...cuerpo }; galeriaMock.push(fila); return json(201, unico ? fila : [fila]) }
      const filas = galeriaMock.filter((f) => !filtro || f.id === filtro)
      if (req.method() === 'PATCH') { filas.forEach((f) => Object.assign(f, cuerpo)); return ruta.fulfill({ status: 204, headers: CORS }) }
      if (req.method() === 'DELETE') { galeriaMock.splice(0, galeriaMock.length, ...galeriaMock.filter((f) => !filas.includes(f))); return ruta.fulfill({ status: 204, headers: CORS }) }
      return json(200, unico ? filas[0] : filas)
    })
    const borradosStorage = []
    await page.route(/supabase\.co\/storage\/v1\/object\/fotos-servicios$/, (ruta) => {
      const req = ruta.request()
      if (req.method() === 'OPTIONS') return ruta.fulfill({ status: 204, headers: CORS })
      borradosStorage.push(req.postData() ?? '')
      return ruta.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: '[]' })
    })

    await page.goto(`${ORIGEN}/login`, { waitUntil: 'networkidle' })
    await page.locator('input[type="email"]').first().fill(env.QA_ADMIN_EMAIL)
    await page.locator('input[type="password"]').first().fill(env.QA_ADMIN_PASSWORD)
    await page.locator('button[type="submit"]').first().click()
    await page.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 30000 })

    // 200 si el <img> carga, 404 si no (lo que ve el usuario). Un <img> no necesita CORS.
    await page.evaluate(() => {
      window.__estado = (u) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(200); i.onerror = () => ok(404); i.src = u + (u.includes('?') ? '&' : '?') + 'n=' + Math.random() })
    })

    // Utilidades dentro de la página: usan los MISMOS módulos de la app (misma sesión de Supabase).
    const prepararWebp = (lado) =>
      page.evaluate(async (l) => {
        const { procesarImagen } = await import('/src/lib/imagenes.js')
        const c = document.createElement('canvas')
        c.width = l
        c.height = l
        const x = c.getContext('2d')
        const g = x.createLinearGradient(0, 0, l, l)
        g.addColorStop(0, '#b76e79')
        g.addColorStop(1, '#222')
        x.fillStyle = g
        x.fillRect(0, 0, l, l)
        const png = await new Promise((ok) => c.toBlob(ok, 'image/png'))
        const { blob, extension } = await procesarImagen(new File([png], 'f.png', { type: 'image/png' }), { ladoMaximo: 600, calidad: 0.8 })
        window.__blob = blob
        return { bytes: blob.size, extension, tipo: blob.type }
      }, lado)

    const info = await prepararWebp(1200)
    caso('procesarImagen existente sigue produciendo WebP ≤ 600 px', info.extension === 'webp' && info.tipo === 'image/webp', info)

    // ---- 1. imagen nueva: subida autenticada + variantes ----
    const subida = await page.evaluate(async () => {
      const { subirFoto, urlPublicaFoto } = await import('/src/lib/imagenes.js')
      const fases = []
      const ref = await subirFoto('fotos-servicios', `${crypto.randomUUID()}.webp`, window.__blob, { onProgreso: (e) => fases.push(e.fase) })
      return { ref, fases, urlG: urlPublicaFoto('fotos-servicios', ref), urlM: urlPublicaFoto('fotos-servicios', ref, 'm') }
    })
    caso('subirFoto devuelve referencia r2:fotos-servicios/<uuid>', /^r2:fotos-servicios\/[0-9a-f-]{36}$/.test(subida.ref), { ref: subida.ref })
    caso('progreso informado (preparando → subiendo → listo)', subida.fases[0] === 'preparando' && subida.fases.includes('subiendo') && subida.fases.at(-1) === 'listo', { fases: subida.fases })

    // Cabeceras y bytes desde Node (como las vería cualquier cliente) + decodificación
    // real con <img> en la página (como la consume la app; un <img> no necesita CORS).
    const medir = async (url) => {
      const resp = await fetch(url)
      const bytes = (await resp.arrayBuffer()).byteLength
      const dims = await page.evaluate(
        (u) => new Promise((ok) => { const i = new Image(); i.onload = () => ok({ ancho: i.naturalWidth, alto: i.naturalHeight }); i.onerror = () => ok({ ancho: 0, alto: 0 }); i.src = u }),
        url,
      )
      return { estado: resp.status, bytes, tipo: resp.headers.get('content-type'), cache: resp.headers.get('cache-control'), ...dims }
    }
    const g = await medir(subida.urlG)
    const m = await medir(subida.urlM)
    caso('variante g: 200, image/webp, decodifica, cache immutable, ≤ 250 KiB', g.estado === 200 && g.tipo === 'image/webp' && g.ancho === 600 && /immutable/.test(g.cache) && g.bytes <= 250 * 1024, g)
    caso('variante m: 320 px, ≤ 80 KiB y menor que g', m.estado === 200 && m.ancho === 320 && m.bytes <= 80 * 1024 && m.bytes < g.bytes, m)

    // ---- 2. galería antes/después en BD (URL completa) + lectura ----
    const galeria = await page.evaluate(async () => {
      const { subirFoto, urlPublicaFoto } = await import('/src/lib/imagenes.js')
      const { supabase } = await import('/src/lib/supabase.js')
      const refA = await subirFoto('fotos-galeria', 'a.webp', window.__blob)
      const refD = await subirFoto('fotos-galeria', 'd.webp', window.__blob)
      const antes = urlPublicaFoto('fotos-galeria', refA)
      const despues = urlPublicaFoto('fotos-galeria', refD)
      const { data, error } = await supabase.from('galeria_web').insert({ titulo: 'QA fase 3 (borrar)', antes_url: antes, despues_url: despues, orden: 9999, activo: false }).select('id,antes_url,despues_url').single()
      return { error: error?.message ?? null, fila: data, refA, refD }
    })
    caso('galería: fila con URLs completas del dominio de medios guardada', !galeria.error && galeria.fila?.antes_url.includes('/fotos-galeria/'), { error: galeria.error })

    // ---- 3. reemplazo: la anterior se elimina SOLO tras guardar la nueva ----
    const reemplazo = await page.evaluate(async (g) => {
      const { subirFoto, urlPublicaFoto, eliminarFoto, rutaDeUrlGaleria } = await import('/src/lib/imagenes.js')
      const { supabase } = await import('/src/lib/supabase.js')
      const refN = await subirFoto('fotos-galeria', 'n.webp', window.__blob)
      const nueva = urlPublicaFoto('fotos-galeria', refN)
      const antesDelUpdate = (await window.__estado(g.fila.antes_url)) // la vieja sigue viva mientras no se guarde
      const { error } = await supabase.from('galeria_web').update({ antes_url: nueva }).eq('id', g.fila.id)
      const eliminada = error ? null : await eliminarFoto('fotos-galeria', rutaDeUrlGaleria('fotos-galeria', g.fila.antes_url))
      return { antesDelUpdate, errorUpdate: error?.message ?? null, eliminada, vieja: (await window.__estado(g.fila.antes_url)), nueva: (await window.__estado(nueva)), nuevaUrl: nueva }
    }, galeria)
    caso('reemplazo: la anterior vive hasta guardar; luego se elimina; la nueva responde 200', reemplazo.antesDelUpdate === 200 && reemplazo.eliminada === true && reemplazo.vieja === 404 && reemplazo.nueva === 200, reemplazo)

    // ---- 4. fallo de subida: no queda referencia ni objeto a medias ----
    let g1Interceptado = 0
    await page.route(`${API}/v1/medios/**/g`, (ruta) => { g1Interceptado += 1; ruta.abort('failed') })
    const fallo = await page.evaluate(async () => {
      const { subirFoto } = await import('/src/lib/imagenes.js')
      try { await subirFoto('fotos-servicios', 'x.webp', window.__blob); return { rechazada: false } } catch (e) { return { rechazada: true, mensaje: e.message } }
    })
    await page.unroute(`${API}/v1/medios/**/g`)
    caso('fallo de red en la variante g: la promesa se rechaza (sin éxito ficticio) tras reintentar', fallo.rechazada && g1Interceptado === 3, { ...fallo, intentos: g1Interceptado })

    // ---- 5. fallo transitorio 503: reintenta y termina bien ----
    let contador = 0
    await page.route(`${API}/v1/medios/**/m`, (ruta) => { contador += 1; if (contador === 1) ruta.fulfill({ status: 503, body: '{"error":"temporal"}', headers: { 'Access-Control-Allow-Origin': ORIGEN } }); else ruta.continue() })
    const reintento = await page.evaluate(async () => {
      const { subirFoto } = await import('/src/lib/imagenes.js')
      const fases = []
      const ref = await subirFoto('fotos-servicios', 'y.webp', window.__blob, { onProgreso: (e) => fases.push(e.fase) })
      return { ref, fases }
    })
    await page.unroute(`${API}/v1/medios/**/m`)
    caso('503 transitorio: reintento visible y subida correcta', /^r2:/.test(reintento.ref) && reintento.fases.includes('reintentando'), reintento)

    // ---- 6. fotos antiguas de Supabase siguen funcionando (resolución y borrado por el camino antiguo) ----
    const legado = await page.evaluate(async () => {
      const { urlPublicaFoto, eliminarFoto } = await import('/src/lib/imagenes.js')
      const url = urlPublicaFoto('fotos-servicios', 'qa-legado.webp') // sin prefijo r2: → Supabase, nunca R2
      const resultado = await eliminarFoto('fotos-servicios', 'qa-legado.webp') // ruta antigua → helper de Supabase
      return { url, resultado }
    })
    caso(
      'foto antigua (sin prefijo): la URL es de Supabase Storage y el borrado usa el camino antiguo (no el Worker)',
      /supabase\.co\/storage\/v1\/object\/public\/fotos-servicios\/qa-legado\.webp$/.test(legado.url) && borradosStorage.length === 1 && borradosStorage[0].includes('qa-legado.webp'),
      { ...legado, borradosStorage },
    )

    // ---- 7. formato y buckets privados (sin subir nada a Supabase) ----
    const invalidos = await page.evaluate(async () => {
      const { subidasNuevasEnR2 } = await import('/src/lib/medios.js')
      const webp = new Blob([new Uint8Array(10)], { type: 'image/webp' })
      const jpeg = new Blob([new Uint8Array(10)], { type: 'image/jpeg' })
      const destinos = ['fotos-productos', 'fotos-servicios', 'fotos-galeria', 'comprobantes-pedidos-web', 'comprobantes-citas-web', 'qr-pagos', 'fotos-clientes', 'fotos-usuarios', 'fotos-asistentes']
      return {
        webpEnR2: subidasNuevasEnR2('fotos-servicios', webp),
        jpegEnR2: subidasNuevasEnR2('fotos-servicios', jpeg),
        enR2: Object.fromEntries(destinos.map((d) => [d, subidasNuevasEnR2(d, webp)])),
      }
    })
    caso('WebP va a R2; un JPEG (fallback del navegador) NO va a R2 y sigue por Supabase', invalidos.webpEnR2 === true && invalidos.jpegEnR2 === false, invalidos)
    caso(
      'solo productos/servicios/galería usan R2; comprobantes, QR, perfiles y equipo siguen en Supabase',
      invalidos.enR2['fotos-productos'] && invalidos.enR2['fotos-servicios'] && invalidos.enR2['fotos-galeria'] &&
        !invalidos.enR2['comprobantes-pedidos-web'] && !invalidos.enR2['comprobantes-citas-web'] && !invalidos.enR2['qr-pagos'] &&
        !invalidos.enR2['fotos-clientes'] && !invalidos.enR2['fotos-usuarios'] && !invalidos.enR2['fotos-asistentes'],
      invalidos.enR2,
    )

    // ---- 8. respuesta perdida DESPUÉS de que el Worker guardó (F3-02) ----
    for (const variante of ['m', 'g']) {
      let perdidas = 0
      let borrados = 0
      const patron = (u) => u.href.includes('/v1/medios/')
      await page.route(patron, async (ruta) => {
        const req = ruta.request()
        if (req.method() === 'DELETE') { borrados += 1; return ruta.continue() }
        if (req.method() === 'PUT' && req.url().endsWith(`/${variante}`) && perdidas === 0) {
          perdidas += 1
          await ruta.fetch() // el Worker SÍ guarda…
          return ruta.abort('failed') // …pero el navegador no recibe la respuesta
        }
        return ruta.continue()
      })
      const perdida = await page.evaluate(async () => {
        const { subirFoto, urlPublicaFoto } = await import('/src/lib/imagenes.js')
        try {
          const ref = await subirFoto('fotos-servicios', 'p.webp', window.__blob)
          return { ref, estadoM: await window.__estado(urlPublicaFoto('fotos-servicios', ref, 'm')), estadoG: await window.__estado(urlPublicaFoto('fotos-servicios', ref, 'g')) }
        } catch (e) { return { error: e.message } }
      })
      await page.unroute(patron)
      caso(`respuesta perdida tras guardar la variante ${variante}: el reintento recupera (200 reanudado), devuelve referencia válida, sin DELETE`, !perdida.error && /^r2:/.test(perdida.ref) && perdida.estadoM === 200 && perdida.estadoG === 200 && borrados === 0 && perdidas === 1, { ...perdida, borrados, perdidas })
    }

    // ---- 9. borrado fallido → diario → reintento (F3-04) ----
    const refDiario = await page.evaluate(async () => {
      const { subirFoto } = await import('/src/lib/imagenes.js')
      return subirFoto('fotos-servicios', 'd.webp', window.__blob)
    })
    const patronDel = (u) => u.href.includes('/v1/medios/')
    let denegados = 0
    await page.route(patronDel, (ruta) => {
      if (ruta.request().method() === 'DELETE') { denegados += 1; return ruta.fulfill({ status: 503, body: '{"error":"temporal"}', headers: { 'Access-Control-Allow-Origin': ORIGEN } }) }
      return ruta.continue()
    })
    const diario = await page.evaluate(async (ref) => {
      localStorage.removeItem('medios:eliminaciones-pendientes')
      const { eliminarFoto } = await import('/src/lib/imagenes.js')
      const { eliminacionesPendientes } = await import('/src/lib/medios.js')
      const resultado = await eliminarFoto('fotos-servicios', ref)
      return { resultado, pendientes: eliminacionesPendientes() }
    }, refDiario)
    await page.unroute(patronDel)
    caso('borrado fallido (503 persistente): devuelve false y queda anotado en el diario', diario.resultado === false && diario.pendientes.length === 1 && diario.pendientes[0].ref === refDiario && denegados === 3, { ...diario, denegados })
    const antesDelReintento = await medir(`${API}/${refDiario.replace('r2:', '')}/g.webp`)
    const recuperado = await page.evaluate(async () => {
      const { reintentarEliminacionesPendientes, eliminacionesPendientes } = await import('/src/lib/medios.js')
      const eliminadas = await reintentarEliminacionesPendientes()
      return { eliminadas, pendientes: eliminacionesPendientes() }
    })
    const tras = await medir(`${API}/${refDiario.replace('r2:', '')}/g.webp`)
    caso('el objeto sigue existiendo mientras el borrado está pendiente; el reintento del diario lo elimina y lo vacía', antesDelReintento.estado === 200 && recuperado.eliminadas === 1 && recuperado.pendientes.length === 0 && tras.estado === 404, { ...recuperado, antes: antesDelReintento.estado, despues: tras.estado })

    // ---- 10. peso real con FOTOS REALES del repositorio (no el degradado sintético) ----
    const fotosReales = ['/inicio-web/hero-antes-referencia.jpg', '/inicio-web/hero-despues-referencia.jpg', '/inicio-web/hero-despues-referencia2.jpg', '/inicio-web/antes-claro.webp', '/src/assets/login/foto-login.jpeg']
    const perfiles = [
      { nombre: 'producto (600 px, q0.8)', bucket: 'fotos-productos', opciones: {} },
      { nombre: 'servicio (900 px, q0.85)', bucket: 'fotos-servicios', opciones: { ladoMaximo: 900, calidad: 0.85 } },
      { nombre: 'galería (1400 px, q0.85)', bucket: 'fotos-galeria', opciones: { ladoMaximo: 1400, calidad: 0.85 } },
    ]
    const pesos = []
    for (const foto of fotosReales) {
      for (const perfil of perfiles) {
        const medida = await page.evaluate(async ([ruta, bucket, opciones]) => {
          let resp = null
          for (const c of [ruta, `/PosJaise${ruta}`]) { const r = await fetch(c); if (r.ok && (r.headers.get('content-type') ?? '').startsWith('image/')) { resp = r; break } }
          if (!resp) return { error: 'no se pudo leer ' + ruta }
          const original = await resp.blob()
          const { procesarImagen, subirFoto } = await import('/src/lib/imagenes.js')
          const { blob } = await procesarImagen(new File([original], 'f', { type: original.type }), opciones)
          const bmp = await createImageBitmap(blob)
          const ref = await subirFoto(bucket, 'x.webp', blob)
          return { ref, original: original.size, procesada: blob.size, ancho: bmp.width, alto: bmp.height }
        }, [foto, perfil.bucket, perfil.opciones])
        if (!medida.error) {
          const lee = async (v) => (await (await fetch(`${API}/${medida.ref.slice(3)}/${v}.webp`)).arrayBuffer()).byteLength
          medida.bytesM = await lee('m')
          medida.bytesG = await lee('g')
          await page.evaluate(async (ref) => { const { eliminarFoto } = await import('/src/lib/imagenes.js'); await eliminarFoto('fotos-productos', ref) }, medida.ref)
          delete medida.ref
        }
        pesos.push({ foto, perfil: perfil.nombre, ...medida })
      }
    }
    caso('se procesaron y subieron las fotos reales de muestra', pesos.length === 15 && pesos.every((p) => !p.error), { error: pesos.find((p) => p.error)?.error })
    informePesos.length = 0
    informePesos.push(...pesos)
    const excedeM = pesos.filter((p) => p.bytesM > 80 * 1024)
    const excedeG = pesos.filter((p) => p.bytesG > 250 * 1024)
    const topesDuros = pesos.filter((p) => p.bytesM > 96 * 1024 || p.bytesG > 512 * 1024)
    caso('fotos reales: ninguna supera los TOPES DUROS del Worker (m 96 KiB, g 512 KiB)', topesDuros.length === 0, { topesDuros })
    // Este caso documenta el cumplimiento de los OBJETIVOS (80/250 KiB); no falla la prueba si no se cumplen.
    caso(`fotos reales: objetivos de la guía (m ≤ 80 KiB, g ≤ 250 KiB) — ${excedeM.length} de 15 superan m, ${excedeG.length} de 15 superan g`, true, { excedenM: excedeM.map((p) => `${p.foto} · ${p.perfil}: ${(p.bytesM / 1024).toFixed(0)} KiB`), excedenG: excedeG.map((p) => `${p.foto} · ${p.perfil}: ${(p.bytesG / 1024).toFixed(0)} KiB`) })

    // ---- 11. configuración incompleta: FALLA en vez de caer a Supabase en silencio ----
    const viteIncompleto = spawn('npx', ['vite', '--port', '5198', '--strictPort', '--host', 'localhost'], {
      cwd: raiz, shell: true, stdio: 'ignore',
      env: { ...process.env, VITE_SUPABASE_URL: env.VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY, VITE_CULQI_PUBLIC_KEY: '', VITE_MEDIOS_PROVEEDOR: 'r2', VITE_MEDIOS_API_URL: '', VITE_MEDIOS_PUBLIC_URL: '' },
    })
    try {
      await esperar('http://localhost:5198/tests/harness/modales-fase3.html')
      const p2 = await ctx.newPage()
      const peticionesStorage = []
      p2.on('request', (r) => { if (r.url().includes('/storage/v1/') || r.url().includes('/v1/medios/')) peticionesStorage.push(r.url()) })
      await p2.goto('http://localhost:5198/tests/harness/modales-fase3.html', { waitUntil: 'networkidle' })
      const sinConfig = await p2.evaluate(async () => {
        const { subirFoto } = await import('/src/lib/imagenes.js')
        try { await subirFoto('fotos-servicios', 'x.webp', new Blob([new Uint8Array(10)], { type: 'image/webp' })); return { rechazada: false } } catch (e) { return { rechazada: true, mensaje: e.message } }
      })
      caso('proveedor r2 sin API/URL pública: la subida FALLA con mensaje claro, sin tocar Supabase Storage ni el Worker', sinConfig.rechazada && /mal configurados/.test(sinConfig.mensaje) && peticionesStorage.length === 0, { ...sinConfig, peticionesStorage })
      await p2.close()
    } finally {
      matar(viteIncompleto)
    }

    // ---- limpieza ----
    const limpieza = await page.evaluate(async (g) => {
      const { eliminarFoto, rutaDeUrlGaleria } = await import('/src/lib/imagenes.js')
      const { supabase } = await import('/src/lib/supabase.js')
      const { data } = await supabase.from('galeria_web').select('antes_url,despues_url').eq('id', g.fila.id).single()
      await supabase.from('galeria_web').delete().eq('id', g.fila.id)
      await eliminarFoto('fotos-galeria', rutaDeUrlGaleria('fotos-galeria', data.antes_url))
      await eliminarFoto('fotos-galeria', rutaDeUrlGaleria('fotos-galeria', data.despues_url))
      return { despues: (await window.__estado(data.despues_url)) }
    }, galeria)
    caso('limpieza: fila y objetos de galería eliminados', limpieza.despues === 404, limpieza)

    caso('solo se contactó el Supabase de staging', [...hostsSupabase].every((h) => h.startsWith(REF_STAGING)), { hosts: [...hostsSupabase] })
    caso('NINGUNA escritura REST/Storage llegó a Supabase (todo lo escribible estaba simulado)', escriturasBloqueadas.length === 0, { escriturasBloqueadas })
    caso('sin errores de página', errores.length === 0, { errores })
  } finally {
    await navegador.close().catch(() => {})
    matar(vite)
    matar(worker)
    fs.rmSync(path.join(carpetaWorker, '.dev.vars'), { force: true })
    await new Promise((r) => setTimeout(r, 1500))
    try { fs.rmSync(estado, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }) } catch {}
  }

  const fallos = casos.filter((c) => !c.ok)
  const carpeta = path.join(raiz, 'docs/evidencia-rendimiento/fase-3')
  fs.mkdirSync(carpeta, { recursive: true })
  fs.writeFileSync(path.join(carpeta, 'pruebas-navegador.json'), JSON.stringify({ fecha: new Date().toISOString(), entorno: 'Vite dev + Worker local con R2 simulado + Supabase staging', total: casos.length, fallos: fallos.length, pesosFotosReales: informePesos, casos }, null, 2))
  console.log(`\n${casos.length} casos, ${fallos.length} fallos`)
  process.exit(fallos.length ? 1 : 0)
})().catch((e) => { console.error(e); try { fs.rmSync(path.join(carpetaWorker, '.dev.vars'), { force: true }) } catch {}; process.exit(2) })
