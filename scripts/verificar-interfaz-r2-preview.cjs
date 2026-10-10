// Fase 3 · prueba de INTERFAZ REAL sobre el alias de Pages Preview (staging) con datos QA ficticios.
//
//   node scripts/verificar-interfaz-r2-preview.cjs --build-id=<8 hex del artefacto esperado> [--alias=<solo el alias aprobado>]
//
// Qué hace: entra con la cuenta QA ADMIN en la web desplegada, usa los modales REALES de Producto, Servicio y
// Galería (fotos nuevas, reemplazo, quitar), y verifica por canales independientes: la BD de staging (lectura REST con el
// token QA), el inventario del Worker y las URLs públicas de r2.dev. Después comprueba con la cuenta QA CLIENTE que el portal
// carga las fotos nuevas desde r2.dev.
//
// Salvaguardas (revisión IP-R1/IP-R2 de Codex; lógica en scripts/lib/guardas-interfaz-r2.cjs, probada SIN red por
// scripts/verificar-guardas-interfaz-r2.cjs):
//  · ANTES de autenticar o escribir: alias = origen aprobado EXACTO, Supabase = staging EXACTO, clave pública clasificada,
//    cuentas QA ficticias, y el build-id del artefacto servido = el pasado en --build-id (si no, se aborta sin login).
//  · Las peticiones a destinos no aprobados (otro Supabase, negocio, local, pasarelas, otro Worker/bucket) se ABORTAN en
//    TODOS los contextos del navegador (ADMIN y CLIENTE) y en los fetch del propio script, y hacen fallar la corrida.
//  · Precondición: producto/servicio sin foto ni galería; si no, se aborta sin tocar nada. Se toma un snapshot de lo que la
//    prueba puede cambiar (fotos, galerías, galería web) y del inventario del Worker (claves completas).
//  · La fila de Galería lleva una marca única por ejecución; la limpieza de emergencia borra SOLO esa fila (por id) y nunca
//    ante lecturas fallidas. Lo demás se informa, no se borra.
// Escribe SOLO datos QA ficticios de STAGING. No toca pagos, ventas, cuentas ni el Supabase del negocio.
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')
const G = require('./lib/guardas-interfaz-r2.cjs')

const raiz = path.resolve(__dirname, '..')
const argumento = (nombre) => (process.argv.find((a) => a.startsWith(`--${nombre}=`)) ?? '').slice(nombre.length + 3)
const ALIAS = (argumento('alias') || G.ALIAS_APROBADO).replace(/\/+$/, '')
const BUILD_ID = argumento('build-id')
const WORKER = G.WORKER_APROBADO
const PUBLICO = G.PUBLICO_APROBADO
const REF_STAGING = G.REF_STAGING
const PRODUCTO = '432a6610-67e5-4a7c-a979-eb891cc9263c' // «Agua San Luis 625ml» (ficticio, sin foto)
const SERVICIO = '6265a7d1-80b3-4b72-9b34-7f6eca3d7873' // «Corte de cabello» (ficticio, sin foto)
const ID_EJECUCION = crypto.randomBytes(3).toString('hex')
const TITULO_GALERIA = G.tituloDeEjecucion(ID_EJECUCION)

function leerEnv(ruta) {
  const salida = {}
  for (const linea of fs.readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) salida[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return salida
}
const env = leerEnv(path.join(raiz, '.env.staging.local'))
const SUPA = env.VITE_SUPABASE_URL
const FOTOS = ['public/inicio-web/hero-antes-referencia.jpg', 'public/inicio-web/hero-despues-referencia.jpg', 'public/inicio-web/antes-claro.webp', 'src/assets/login/foto-login.jpeg', 'public/inicio-web/hero-despues-referencia2.jpg'].map((f) => path.join(raiz, f))
const [FA, FB, FC, FD, FE] = FOTOS

const casos = []
const caso = (nombre, ok, detalle = {}) => {
  casos.push({ nombre, ...detalle, ok: Boolean(ok) })
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${ok ? '' : ' ' + JSON.stringify(detalle).slice(0, 400)}`)
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

const aprobados = new Set([new URL(G.ALIAS_APROBADO).origin, `https://${REF_STAGING}.supabase.co`, WORKER, PUBLICO])
const seguro = G.crearFetchSeguro(aprobados, (...a) => fetch(...a)) // los fetch del propio script nunca salen a destinos no aprobados
const bloqueadas = []
const guardia = () => { if (bloqueadas.length) throw new Error(`tráfico a destinos no aprobados bloqueado: ${bloqueadas.join(' | ')}`) }

async function sesion(email, password) {
  const r = await seguro(`${SUPA}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  if (!r.ok) throw new Error('login QA rechazado')
  return (await r.json()).access_token
}
let tokenAdmin
const rest = async (ruta, opciones = {}) => {
  const r = await seguro(`${SUPA}/rest/v1/${ruta}`, { ...opciones, headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json', ...(opciones.headers ?? {}) } })
  return { estado: r.status, datos: r.status === 204 ? null : await r.json().catch(() => null) }
}
// Lecturas ESTRICTAS: un fallo o una respuesta malformada lanza; nunca se interpreta como «lista vacía».
const leer = async (ruta) => {
  const r = await rest(ruta)
  if (r.estado !== 200 || !Array.isArray(r.datos)) throw new Error(`lectura fallida (${r.estado}) de ${ruta.split('?')[0]}`)
  return r.datos
}
const filaProducto = async () => (await leer(`productos?id=eq.${PRODUCTO}&select=id,foto_url`))[0]
const filaServicio = async () => (await leer(`servicios?id=eq.${SERVICIO}&select=id,foto_url`))[0]
const galeriaDe = async (tabla, col, id) => leer(`${tabla}?${col}=eq.${id}&select=id,foto_url,etiqueta,orden&order=orden`)
const galeriaWeb = async () => leer(`galeria_web?select=id,titulo,antes_url,despues_url&order=id`)
const DESTINOS = ['fotos-productos', 'fotos-servicios', 'fotos-galeria']
const inventarioClaves = () => G.leerInventario(DESTINOS, async (d) => {
  const r = await seguro(`${WORKER}/v1/inventario/${d}`, { headers: { Authorization: `Bearer ${tokenAdmin}`, Origin: ALIAS } })
  return { estado: r.status, cuerpo: await r.json().catch(() => null) }
})
const inventario = async () => G.gruposDe(await inventarioClaves())
// Todo lo que esta prueba puede modificar, para comparar el estado final con el inicial (no solo cantidades).
const tomarSnapshot = async () => ({
  producto: await filaProducto(), servicio: await filaServicio(),
  galeriaProducto: await galeriaDe('producto_fotos', 'producto_id', PRODUCTO), galeriaServicio: await galeriaDe('servicio_fotos', 'servicio_id', SERVICIO),
  galeriaWeb: await galeriaWeb(),
})
const grupoDe = (ref) => ref.replace(/^r2:/, '').split('/').slice(0, 2).join('/')
const grupoUrl = (u) => u.replace(`${PUBLICO}/`, '').split('/').slice(0, 2).join('/')
async function estadoPublico(grupo, v = 'm') {
  const r = await seguro(`${PUBLICO}/${grupo}/${v}.webp`)
  return { estado: r.status, tipo: r.headers.get('content-type'), bytes: (await r.arrayBuffer()).byteLength }
}

;(async () => {
  // ---------- IP-R1: destinos y artefacto validados ANTES de autenticar ----------
  const { clasificarClave } = await import('./lib/entornos-supabase.mjs')
  const { buildId } = await G.preflight(
    { alias: ALIAS, buildId: BUILD_ID, supabaseUrl: env.VITE_SUPABASE_URL, claveAnon: env.VITE_SUPABASE_ANON_KEY, emails: [env.QA_ADMIN_EMAIL, env.QA_CLIENTE_EMAIL], clasificarClave },
    async (url) => (await seguro(url)).text())

  tokenAdmin = await sesion(env.QA_ADMIN_EMAIL, env.QA_ADMIN_PASSWORD)

  // ---------- IP-R2: estado inicial comprobado y snapshot, antes de escribir ----------
  const baseClaves = await inventarioClaves()
  const snapInicial = await tomarSnapshot()
  const motivos = G.precondicionFixtures(snapInicial)
  if (motivos.length) throw new Error(`precondición de los fixtures no cumplida; no se modifica nada: ${motivos.join('; ')}`)
  let idGaleria = null // fila de Galería creada por ESTA ejecución

  const navegador = await chromium.launch()
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 } })
  await G.instalarBloqueo(ctx, 'ADMIN', aprobados, bloqueadas)
  const page = await ctx.newPage()
  const erroresPagina = []
  const hosts = new Set()
  const subidas = []
  const storageSupabase = []
  // El mismo observador para TODAS las páginas (ADMIN y CLIENTE): hosts de Supabase, Storage de Supabase y escrituras al Worker.
  const observar = (pg) => pg.on('request', (r) => {
    const u = new URL(r.url())
    if (u.hostname.endsWith('supabase.co')) {
      hosts.add(u.hostname)
      if (u.pathname.startsWith('/storage/v1/object') && ['POST', 'PUT', 'DELETE'].includes(r.method())) storageSupabase.push(`${r.method()} ${u.pathname}`)
    }
    if (u.hostname === new URL(WORKER).hostname && ['PUT', 'DELETE'].includes(r.method())) subidas.push(`${r.method()} ${u.pathname.split('/').slice(-1)[0]}`)
  })
  page.on('pageerror', (e) => erroresPagina.push(String(e)))
  observar(page)

  const carpetaCapturas = path.join(raiz, 'docs/evidencia-rendimiento/fase-3/interfaz-preview')
  fs.mkdirSync(carpetaCapturas, { recursive: true })
  const captura = (nombre) => page.screenshot({ path: path.join(carpetaCapturas, nombre), fullPage: false }).catch(() => {})

  let errorCorrida = null
  let limpieza = null
  try {
    // ---------- 0. el artefacto desplegado es el que lleva R2 ----------
    caso(`el alias sirve el build-id esperado (${BUILD_ID}); verificado ANTES de autenticar`, buildId === BUILD_ID, { buildId })
    caso('precondición: producto y servicio sin foto principal ni galería, y snapshot/inventario inicial leídos', true, { clavesIniciales: baseClaves.size, filasGaleriaWeb: snapInicial.galeriaWeb.length })

    // ---------- 1. login ADMIN real ----------
    await page.goto(`${ALIAS}/login`, { waitUntil: 'networkidle' })
    await page.locator('input[type="email"]').first().fill(env.QA_ADMIN_EMAIL)
    await page.locator('input[type="password"]').first().fill(env.QA_ADMIN_PASSWORD)
    await page.locator('button[type="submit"]').first().click()
    await page.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 30000 })
    caso('login ADMIN QA en el alias de Pages', !new URL(page.url()).pathname.endsWith('/login'), { ruta: new URL(page.url()).pathname })

    const abrirFicha = async (tab, id) => {
      await page.goto(`${ALIAS}/catalogo-web?tab=${tab}&id=${id}`, { waitUntil: 'networkidle' })
      await page.waitForSelector('form', { timeout: 30000 })
      await espera(500)
    }
    const elegir = async (indice, ruta) => {
      await page.locator('input[type=file]').nth(indice).setInputFiles(ruta)
      await page.waitForFunction(() => !document.body.innerText.includes('Procesando'), null, { timeout: 20000 })
      await espera(300)
    }
    const guardarModal = async () => {
      await page.locator('form button[type=submit]').click()
      await page.waitForSelector('form', { state: 'detached', timeout: 60000 }).catch(() => {})
      await espera(1200)
      guardia()
    }

    // ---------- 2. PRODUCTO: foto principal + galería ----------
    let antes = await inventario()
    await abrirFicha('productos', PRODUCTO)
    await elegir(0, FA)
    await elegir(1, FB)
    await captura('producto-antes-de-guardar.png')
    const subidasAntes = subidas.length
    await guardarModal()
    let p = await filaProducto()
    let gal = await galeriaDe('producto_fotos', 'producto_id', PRODUCTO)
    let inv = await inventario()
    const refP1 = p?.foto_url
    caso('PRODUCTO: foto principal y 1 foto de galería guardadas con referencia r2:',
      /^r2:fotos-productos\//.test(refP1 ?? '') && gal.length === 1 && /^r2:fotos-productos\//.test(gal[0].foto_url),
      { principal: refP1, galeria: gal.map((g) => g.foto_url) })
    const subidasProducto = subidas.slice(subidasAntes)
    caso('PRODUCTO: la subida fue al Worker de staging (4 PUT: m y g de cada foto) y NO a Supabase Storage',
      subidasProducto.filter((s) => s.startsWith('PUT')).length === 4 && storageSupabase.length === 0, { subidas: subidasProducto, storageSupabase })
    const pubs = []
    for (const ref of [refP1, gal[0]?.foto_url].filter(Boolean)) for (const v of ['m', 'g']) pubs.push(await estadoPublico(grupoDe(ref), v))
    caso('PRODUCTO: las 4 variantes responden 200 image/webp en el dominio público de pruebas', pubs.length === 4 && pubs.every((x) => x.estado === 200 && x.tipo === 'image/webp' && x.bytes > 500), { pubs })
    caso('PRODUCTO: el inventario del Worker muestra exactamente 2 grupos nuevos', inv.size === antes.size + 2, { antes: antes.size, despues: inv.size })

    // 2b. reemplazo de la foto principal
    await abrirFicha('productos', PRODUCTO)
    await elegir(0, FC)
    await guardarModal()
    p = await filaProducto()
    inv = await inventario()
    const refP2 = p?.foto_url
    caso('PRODUCTO: reemplazo de la foto principal — tras guardar, la nueva existe y la anterior ya no está (estado final; no prueba el orden temporal)',
      /^r2:/.test(refP2 ?? '') && refP2 !== refP1 && inv.has(grupoDe(refP2)) && !inv.has(grupoDe(refP1)), { anterior: refP1, nueva: refP2 })

    // 2c. quitar la foto de galería y la principal (devuelve el registro a su estado original)
    await abrirFicha('productos', PRODUCTO)
    await page.getByRole('button', { name: 'Quitar foto de la galería' }).click()
    await page.getByRole('button', { name: 'Quitar foto', exact: true }).first().click()
    await guardarModal()
    p = await filaProducto()
    gal = await galeriaDe('producto_fotos', 'producto_id', PRODUCTO)
    inv = await inventario()
    caso('PRODUCTO: quitar galería y foto principal — fila sin foto, 0 filas de galería, objetos eliminados (estado original)',
      p?.foto_url === null && gal.length === 0 && inv.size === antes.size && !inv.has(grupoDe(refP2)), { foto: p?.foto_url, filas: gal.length, inv: inv.size - antes.size })

    // ---------- 3. SERVICIO ----------
    antes = await inventario()
    await abrirFicha('servicios', SERVICIO)
    await elegir(0, FD)
    await elegir(1, FE)
    await guardarModal()
    let s = await filaServicio()
    let galS = await galeriaDe('servicio_fotos', 'servicio_id', SERVICIO)
    inv = await inventario()
    const refS = s?.foto_url
    caso('SERVICIO: foto principal + 1 de galería guardadas con referencia r2: y existentes',
      /^r2:fotos-servicios\//.test(refS ?? '') && galS.length === 1 && inv.has(grupoDe(refS)) && inv.has(grupoDe(galS[0].foto_url)) && inv.size === antes.size + 2, { principal: refS, galeria: galS.map((g) => g.foto_url) })

    // 3b. vista del CLIENTE: las fotos nuevas se cargan desde r2.dev (miniatura en listado, detalle en la ficha)
    const ctxCliente = await navegador.newContext({ viewport: { width: 1280, height: 900 } })
    await G.instalarBloqueo(ctxCliente, 'CLIENTE', aprobados, bloqueadas)
    const cli = await ctxCliente.newPage()
    observar(cli)
    cli.on('pageerror', (e) => erroresPagina.push('cliente: ' + String(e)))
    await cli.goto(`${ALIAS}/login`, { waitUntil: 'networkidle' })
    await cli.locator('input[type="email"]').first().fill(env.QA_CLIENTE_EMAIL)
    await cli.locator('input[type="password"]').first().fill(env.QA_CLIENTE_PASSWORD)
    await cli.locator('button[type="submit"]').first().click()
    await cli.waitForFunction(() => !location.pathname.endsWith('/login'), null, { timeout: 30000 })
    await cli.goto(`${ALIAS}/servicios`, { waitUntil: 'networkidle' })
    await espera(1500)
    const listado = await cli.evaluate(() => [...document.images].filter((i) => i.src.includes('r2.dev')).map((i) => ({ src: i.src.split('/').slice(-2).join('/'), v: i.src.split('/').slice(-1)[0], ok: i.naturalWidth > 0 })))
    const grupoPrincipal = refS.replace(/^r2:/, '')
    // Las tarjetas usan la miniatura m; la portada (hero, 300–600 px de alto) usa la variante de detalle g: ambas son correctas.
    caso('CLIENTE: el listado de servicios carga la foto nueva desde r2.dev — tarjeta en miniatura m y portada en g — y todas decodifican',
      listado.some((x) => x.src === `${grupoPrincipal.split('/')[1]}/m.webp`) && listado.every((x) => ['m.webp', 'g.webp'].includes(x.v) && x.ok), { listado })
    await cli.goto(`${ALIAS}/servicios/${SERVICIO}`, { waitUntil: 'networkidle' })
    await espera(1500)
    const detalle = await cli.evaluate(() => [...document.images].filter((i) => i.src.includes('r2.dev')).map((i) => ({ src: i.src.split('/').slice(-2).join('/'), v: i.src.split('/').slice(-1)[0], ok: i.naturalWidth > 0 })))
    // Con galería, el carrusel del detalle muestra SOLO las fotos de la galería (la principal no se duplica): aquí, la de la galería.
    caso('CLIENTE: el detalle del servicio muestra la foto de la galería desde r2.dev (variante g) y decodifica',
      detalle.length >= 1 && detalle.every((x) => x.v === 'g.webp' && x.ok) && detalle.some((x) => x.src === `${galS[0].foto_url.replace(/^r2:/, '').split('/')[1]}/g.webp`), { detalle })
    await cli.screenshot({ path: path.join(carpetaCapturas, 'cliente-detalle-servicio.png') }).catch(() => {})
    await ctxCliente.close()

    // 3c. devolver el servicio a su estado original
    await abrirFicha('servicios', SERVICIO)
    await page.getByRole('button', { name: 'Quitar foto de la galería' }).click()
    await page.getByRole('button', { name: 'Quitar foto', exact: true }).first().click()
    await guardarModal()
    s = await filaServicio()
    galS = await galeriaDe('servicio_fotos', 'servicio_id', SERVICIO)
    inv = await inventario()
    caso('SERVICIO: quitar galería y principal — fila sin foto, 0 filas de galería, objetos eliminados', s?.foto_url === null && galS.length === 0 && inv.size === antes.size, { foto: s?.foto_url, filas: galS.length })

    // ---------- 4. GALERÍA antes/después ----------
    antes = await inventario()
    const filasAntes = (await galeriaWeb()).length
    await page.goto(`${ALIAS}/galeria-web`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Agregar foto' }).click()
    await page.waitForSelector('form')
    await elegir(0, FA)
    await elegir(1, FB)
    await page.locator('form input[type=search]').first().fill(TITULO_GALERIA)
    await guardarModal()
    let g = (await galeriaWeb()).find((x) => x.titulo === TITULO_GALERIA)
    idGaleria = g?.id ?? null
    inv = await inventario()
    caso('GALERÍA: alta con dos fotos — la fila guarda URLs del dominio público de pruebas y ambos objetos existen',
      g && g.antes_url.startsWith(PUBLICO) && g.despues_url.startsWith(PUBLICO) && inv.has(grupoUrl(g.antes_url)) && inv.has(grupoUrl(g.despues_url)) && inv.size === antes.size + 2, { antes: g?.antes_url, despues: g?.despues_url })
    const visibleEnLista = await page.locator(`img[src^="${PUBLICO}"]`).count()
    caso('GALERÍA: la lista del administrador muestra las dos miniaturas desde r2.dev', visibleEnLista >= 2, { imagenes: visibleEnLista })
    await captura('galeria-alta.png')

    const viejoAntes = g.antes_url
    const viejoDespues = g.despues_url
    await page.getByRole('button', { name: `Editar ${TITULO_GALERIA}` }).click()
    await page.waitForSelector('form')
    await elegir(0, FC)
    await guardarModal()
    g = (await galeriaWeb()).find((x) => x.titulo === TITULO_GALERIA)
    inv = await inventario()
    caso('GALERÍA: reemplazo de «antes» — tras guardar, la nueva existe, la anterior ya no está y «después» conserva exactamente su URL anterior',
      g && g.id === idGaleria && g.antes_url !== viejoAntes && inv.has(grupoUrl(g.antes_url)) && !inv.has(grupoUrl(viejoAntes)) && g.despues_url === viejoDespues && inv.has(grupoUrl(g.despues_url)), { nueva: g?.antes_url })

    await page.getByRole('button', { name: `Eliminar ${TITULO_GALERIA}` }).click()
    await page.getByRole('button', { name: 'Sí, eliminar' }).click()
    await espera(2000)
    g = (await galeriaWeb()).find((x) => x.titulo === TITULO_GALERIA)
    inv = await inventario()
    caso('GALERÍA: eliminar — la fila desaparece y ambos objetos se borran del almacenamiento', !g && inv.size === antes.size && (await galeriaWeb()).length === filasAntes, { filas: (await galeriaWeb()).length, filasAntes })

    // ---------- 5. compatibilidad: lo antiguo sigue funcionando ----------
    const antigua = (await galeriaWeb()).find((x) => !/^https?:/.test(x.antes_url ?? ''))
    if (antigua) {
      const cl = await ctx.newPage()
      await cl.goto(`${ALIAS}/${antigua.antes_url}`.replace(/([^:])\/\//g, '$1/'), { waitUntil: 'load' }).catch(() => {})
      const respuesta = await seguro(`${ALIAS}/${antigua.antes_url}`)
      caso('COMPATIBILIDAD: la fila antigua de la galería (ruta relativa de /public) sigue resolviéndose en el alias', respuesta.status === 200, { ruta: antigua.antes_url, estado: respuesta.status })
      await cl.close()
    }

    // ---------- 6. aislamiento ----------
    caso('tráfico de ambos contextos (ADMIN y CLIENTE) y del script: Supabase solo de STAGING y ninguna petición a destinos no aprobados (negocio, local, pasarelas, otro Worker/bucket)', bloqueadas.length === 0 && [...hosts].every((h) => h.startsWith(REF_STAGING)), { hosts: [...hosts], bloqueadas })
    caso('ninguna subida/borrado de las páginas ADMIN ni CLIENTE usó Supabase Storage (todo pasó por el Worker de staging)', storageSupabase.length === 0, { storageSupabase })
    caso('sin errores de página durante todo el recorrido', erroresPagina.length === 0, { erroresPagina })
  } catch (e) {
    errorCorrida = e
    console.error(`ERROR durante el recorrido: ${String(e.message ?? e)}`)
  } finally {
    // ---------- verificación final: igualdad de snapshots y de CLAVES del inventario; limpieza solo de lo propio ----------
    try {
      const snapFinal = await tomarSnapshot()
      const dif = G.diferenciaInventario(baseClaves, await inventarioClaves())
      const igualSnapshot = G.iguales(snapInicial, snapFinal)
      const limpio = igualSnapshot && !dif.nuevas.length && !dif.faltantes.length
      caso('ESTADO FINAL: fotos, galerías y galería web idénticas al snapshot inicial, e inventario del Worker con las mismas claves (sin nuevas ni faltantes)', limpio,
        { igualSnapshot, clavesNuevas: dif.nuevas, clavesFaltantes: dif.faltantes })
      if (!limpio) {
        const propia = idGaleria ?? snapFinal.galeriaWeb.find((x) => x.titulo === TITULO_GALERIA)?.id
        const aBorrar = G.planLimpiezaGaleria(snapFinal.galeriaWeb, propia) // SOLO la fila de esta ejecución, por id
        const fila = snapFinal.galeriaWeb.find((x) => x.id === aBorrar[0])
        const res = await G.limpiarFilaPropia({
          fila,
          borrarFila: (id) => rest(`galeria_web?id=eq.${id}`, { method: 'DELETE' }),
          releerFila: () => galeriaWeb(),
          borrarGrupo: async (grupo) => (await seguro(`${WORKER}/v1/medios/${grupo}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokenAdmin}`, Origin: ALIAS } })).status,
        })
        limpieza = res
        console.log(`AVISO: el estado final difiere del inicial. Fila propia eliminada (confirmada): ${res.filaEliminada}; grupos de objetos propios eliminados (confirmados): ${res.objetosEliminados}; pendientes: ${res.pendientes.join(', ') || 'ninguno'}${res.motivo ? ` (${res.motivo})` : ''}. Otras claves nuevas/faltantes NO se tocan: revisar a mano.`)
      }
    } catch (e) {
      caso('ESTADO FINAL no verificable (lectura fallida): no se asume nada ni se limpia', false, { error: String(e.message ?? e) })
    }
    await navegador.close().catch(() => {})
  }

  // Cada corrida (también la que falla a mitad) deja su propio informe; resultados.json queda como evidencia HISTÓRICA de la versión anterior.
  const fallos = casos.filter((c) => !c.ok)
  const carpetaCorridas = path.join(carpetaCapturas, 'corridas')
  fs.mkdirSync(carpetaCorridas, { recursive: true })
  const informe = { fecha: new Date().toISOString(), version: 'guardas IP-R1/IP-R2 (IP-R1b/IP-R2b)', alias: ALIAS, buildId: BUILD_ID, idEjecucion: ID_EJECUCION, entorno: 'Pages Preview (staging) + Worker y bucket de pruebas; cuentas QA ficticias', completa: !errorCorrida, error: errorCorrida ? String(errorCorrida.message ?? errorCorrida) : null, limpieza, bloqueadas, total: casos.length, fallos: fallos.length, casos }
  fs.writeFileSync(path.join(carpetaCorridas, `corrida-${ID_EJECUCION}.json`), JSON.stringify(informe, null, 2))
  console.log(`
${casos.length} casos, ${fallos.length} fallos${errorCorrida ? ' — CORRIDA INCOMPLETA' : ''}`)
  process.exitCode = fallos.length || errorCorrida ? 1 : 0
})().catch((e) => { console.error(e); process.exitCode = 2 })
