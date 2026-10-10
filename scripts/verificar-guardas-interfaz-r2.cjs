// Regresiones SIN red ni navegador de las salvaguardas de scripts/verificar-interfaz-r2-preview.cjs (IP-R1 / IP-R2).
//   node scripts/verificar-guardas-interfaz-r2.cjs
// Todo es memoria: `fetch` y las rutas de Playwright son dobles que CUENTAN las llamadas; ninguna sale de la máquina.
const assert = require('node:assert/strict')
const G = require('./lib/guardas-interfaz-r2.cjs')

const resultados = []
async function prueba(nombre, fn) {
  try { await fn(); resultados.push({ nombre, ok: true }); console.log(`OK    ${nombre}`) } catch (e) { resultados.push({ nombre, ok: false, error: String(e.message).slice(0, 300) }); console.log(`FALLA ${nombre}\n      ${String(e.message).split('\n')[0]}`) }
}

const REF = G.REF_STAGING
const claveJwt = (payload) => ['{"alg":"HS256"}', JSON.stringify(payload), 'firma'].map((x) => Buffer.from(x).toString('base64url')).join('.')
const CLAVE_ANON = claveJwt({ role: 'anon', ref: REF })
const clasificar = (clave, ref) => {
  try {
    const p = JSON.parse(Buffer.from(String(clave).split('.')[1], 'base64url').toString())
    return p.role === 'anon' && (!p.ref || p.ref === ref) ? { ok: true } : { ok: false, motivo: 'role/ref no admitido' }
  } catch { return { ok: false, motivo: 'formato' } }
}
const buenos = () => ({ entrega: 'r2dev', alias: G.ALIAS_APROBADO, buildId: 'ba07a32a', supabaseUrl: `https://${REF}.supabase.co`, claveAnon: CLAVE_ANON, emails: ['admin@staging.test', 'cliente@staging.test'], clasificarClave: clasificar })
const HTML = (id) => `<html><head><meta name="build-id" content="${id}"></head></html>`

// Sitio simulado: HTML con marca, sw.js con el precache y módulos JS con la configuración de medios tal como la compila Vite.
const bundle = ({ publica = G.PUBLICO_APROBADO, extras = '', api = G.WORKER_APROBADO, proveedor = 'r2' } = {}) =>
  `var ta=e=>(e??\`\`).trim();function na(){return{proveedor:\`${proveedor}\`,apiUrl:ta(\`${api}\`),publicUrl:ta(\`${publica}\`)}}var sa=()=>qi(na().publicUrl,\`${extras}\`);`
const PAGES_MEDIOS = `${G.ALIAS_APROBADO}/medios`
const sitio = ({ marca = 'ba07a32a', modulos = { 'assets/index-A.js': bundle() }, sw } = {}) => {
  const llamadas = []
  const swTexto = sw ?? `precacheAndRoute([{url:"index.html",revision:"x"},${Object.keys(modulos).map((m) => `{url:"${m}",revision:null}`).join(',')}])`
  return {
    llamadas,
    pedirHtml: async (url) => {
      llamadas.push(url)
      const ruta = url.replace(`${G.ALIAS_APROBADO}/`, '')
      if (ruta === '') return HTML(marca)
      if (ruta === 'sw.js') return swTexto
      return modulos[ruta] ?? '/* sin configuración de medios */'
    },
  }
}
// Doble de sesión: registra cada llamada. El «login» y las escrituras NUNCA deben aparecer tras un aborto de preflight.
function entorno(html) {
  const marca = /content="([^"]*)"/.exec(html)?.[1]
  return sitio({ marca })
}

;(async () => {
  // ---------- IP-R1 ----------
  await prueba('IP-R1: configuración correcta pasa y SOLO pide GET al alias (HTML, sw.js y sus módulos)', async () => {
    const e = entorno(HTML('ba07a32a'))
    await G.preflight(buenos(), e.pedirHtml)
    assert.deepEqual(e.llamadas, [`${G.ALIAS_APROBADO}/`, `${G.ALIAS_APROBADO}/sw.js`, `${G.ALIAS_APROBADO}/assets/index-A.js`])
    assert.ok(e.llamadas.every((u) => u.startsWith(`${G.ALIAS_APROBADO}/`)))
  })
  for (const [nombre, cambio] of [
    ['alias ajeno', { alias: 'https://destino-ajeno.example' }],
    ['alias con la marca esperada pero otro host', { alias: 'https://feat-cloudflare-pages.pos-jaise.pages.dev.evil.example' }],
    ['alias con ruta o query', { alias: `${G.ALIAS_APROBADO}/?x=1` }],
    ['alias http (sin TLS)', { alias: 'http://feat-cloudflare-pages.pos-jaise.pages.dev' }],
    ['Supabase ajeno con el ref de staging en el query', { supabaseUrl: `https://destino-ajeno.example/?ref=${REF}` }],
    ['Supabase del negocio', { supabaseUrl: `https://${G.REF_NEGOCIO}.supabase.co` }],
    ['Supabase local', { supabaseUrl: 'http://127.0.0.1:54321' }],
    ['cuenta fuera de las QA ficticias', { emails: ['persona@gmail.com', 'cliente@staging.test'] }],
    ['clave service_role', { claveAnon: claveJwt({ role: 'service_role', ref: REF }) }],
    ['clave vacía', { claveAnon: '' }],
    ['sin --build-id', { buildId: '' }],
  ]) {
    await prueba(`IP-R1: ${nombre} aborta ANTES de cualquier petición (cero login, cero red)`, async () => {
      const e = entorno(HTML('ba07a32a'))
      await assert.rejects(() => G.preflight({ ...buenos(), ...cambio }, e.pedirHtml))
      assert.equal(e.llamadas.length, 0)
    })
  }
  await prueba('IP-R1: artefacto con otra marca ABORTA tras leer el HTML y ANTES del login (el llamador no llega a autenticar)', async () => {
    const e = entorno(HTML('deadbeef'))
    let autentico = false
    await assert.rejects(async () => { await G.preflight(buenos(), e.pedirHtml); autentico = true })
    assert.equal(autentico, false)
    assert.deepEqual(e.llamadas, [`${G.ALIAS_APROBADO}/`]) // la marca se comprueba primero: ni sw.js ni módulos
  })
  await prueba('IP-R1: artefacto sin meta build-id aborta', async () => {
    await assert.rejects(() => G.preflight(buenos(), async () => '<html></html>'))
  })

  const aprobados = new Set([new URL(G.ALIAS_APROBADO).origin, `https://${REF}.supabase.co`, G.WORKER_APROBADO, G.PUBLICO_APROBADO])
  await prueba('IP-R1: clasificación de destinos — aprobados pasan; negocio, local, pasarela, otro Worker/bucket/Preview se prohíben', () => {
    for (const u of [`${G.ALIAS_APROBADO}/x`, `https://${REF}.supabase.co/rest/v1/productos`, `${G.WORKER_APROBADO}/v1/x`, `${G.PUBLICO_APROBADO}/a/m.webp`, 'data:image/png;base64,AAAA', 'https://fonts.googleapis.com/css']) assert.equal(G.clasificarDestino(u, aprobados), 'permitido', u)
    for (const u of [`https://${G.REF_NEGOCIO}.supabase.co/rest/v1/x`, 'https://otro.supabase.co/', 'http://127.0.0.1:54321/rest/v1/x', 'http://localhost:5173/', 'https://secure.culqi.com/x', 'https://api.culqi.com/v2/tokens', 'https://otro.workers.dev/', 'https://pub-ajeno.r2.dev/x', 'https://otra-rama.pos-jaise.pages.dev/', 'https://a.r2.cloudflarestorage.com/x']) assert.equal(G.clasificarDestino(u, aprobados), 'prohibido', u)
  })

  // Contexto doble: guarda el manejador de route() y permite simular peticiones de CUALQUIER contexto.
  const contextoFalso = () => { const c = { manejador: null, route: async (_p, fn) => { c.manejador = fn } }; return c }
  const peticion = (c, url, metodo = 'GET') => { let accion = null; c.manejador({ request: () => ({ url: () => url, method: () => metodo }), abort: (m) => { accion = `abort:${m}` }, continue: () => { accion = 'continue' } }); return accion }
  await prueba('IP-R1: el bloqueo se instala en ADMIN y en CLIENTE; el tráfico prohibido del contexto CLIENTE se ABORTA y se registra', async () => {
    const bloqueadas = []
    const admin = contextoFalso(); const cliente = contextoFalso()
    await G.instalarBloqueo(admin, 'ADMIN', aprobados, bloqueadas)
    await G.instalarBloqueo(cliente, 'CLIENTE', aprobados, bloqueadas)
    assert.equal(peticion(admin, `https://${REF}.supabase.co/rest/v1/productos`), 'continue')
    assert.equal(peticion(cliente, `https://${G.REF_NEGOCIO}.supabase.co/rest/v1/citas`, 'POST'), 'abort:blockedbyclient')
    assert.equal(peticion(cliente, 'https://api.culqi.com/v2/charges', 'POST'), 'abort:blockedbyclient')
    assert.equal(bloqueadas.length, 2)
    assert.ok(bloqueadas.every((b) => b.startsWith('CLIENTE:')))
  })
  await prueba('IP-R1: el fetch del propio script lanza ANTES de enviar a un destino no aprobado', () => {
    let enviado = 0
    const seguro = G.crearFetchSeguro(aprobados, () => { enviado++; return Promise.resolve({}) })
    assert.throws(() => seguro(`https://${G.REF_NEGOCIO}.supabase.co/auth/v1/token`))
    assert.throws(() => seguro('https://destino-ajeno.example/'))
    seguro(`${G.WORKER_APROBADO}/v1/inventario/fotos-galeria`)
    assert.equal(enviado, 1)
  })

  // ---------- IP-R2 ----------
  const vacio = { producto: { id: 'p', foto_url: null }, servicio: { id: 's', foto_url: null }, galeriaProducto: [], galeriaServicio: [] }
  await prueba('IP-R2: fixtures limpios → precondición sin motivos', () => assert.deepEqual(G.precondicionFixtures(vacio), []))
  for (const [nombre, cambio] of [
    ['producto con foto previa', { producto: { id: 'p', foto_url: 'r2:fotos-productos/aaa' } }],
    ['servicio con foto previa', { servicio: { id: 's', foto_url: 'foto-vieja.jpg' } }],
    ['producto con galería previa', { galeriaProducto: [{ id: 1 }] }],
    ['servicio con galería previa', { galeriaServicio: [{ id: 1 }] }],
    ['galería ilegible (null)', { galeriaProducto: null }],
    ['producto inexistente', { producto: undefined }],
  ]) {
    await prueba(`IP-R2: ${nombre} → precondición NO cumplida (la prueba aborta sin modificar)`, () => assert.ok(G.precondicionFixtures({ ...vacio, ...cambio }).length > 0))
  }

  await prueba('IP-R2: la limpieza borra SOLO la fila propia por id; una fila antigua con el MISMO título se conserva', () => {
    const titulo = G.tituloDeEjecucion('a1b2c3')
    const filas = [{ id: 'antigua', titulo }, { id: 'propia', titulo }, { id: 'otra', titulo: 'Foto de prueba (Inicio)' }]
    assert.deepEqual(G.planLimpiezaGaleria(filas, 'propia'), ['propia'])
    assert.deepEqual(G.planLimpiezaGaleria(filas, null), []) // sin id propio no se borra nada
    assert.deepEqual(G.planLimpiezaGaleria(filas, 'no-existe'), [])
  })
  await prueba('IP-R2: solo se consideran propios los grupos de fotos-galeria del dominio público aprobado referenciados por la fila propia', () => {
    const u = '11111111-2222-3333-4444-555555555555'
    const fila = { antes_url: `${G.PUBLICO_APROBADO}/fotos-galeria/${u}/g.webp`, despues_url: 'inicio-web/ajena.jpg' }
    assert.deepEqual(G.gruposPropiosDeFila(fila), [`fotos-galeria/${u}`])
    assert.deepEqual(G.gruposPropiosDeFila({ antes_url: `http://127.0.0.1:8789/fotos-galeria/${u}/g.webp`, despues_url: `${G.PUBLICO_APROBADO}/fotos-productos/${u}/g.webp` }), [])
    assert.deepEqual(G.gruposPropiosDeFila(undefined), [])
  })
  await prueba('IP-R1b: una redirección 307 de un origen aprobado a uno NO aprobado se rechaza; el segundo origen recibe CERO peticiones (POST con cabecera y cuerpo ficticios)', async () => {
    const http = require('node:http')
    let recibidoB = 0
    const B = http.createServer((q, r) => { recibidoB++; q.resume(); r.end('b') })
    await new Promise((ok) => B.listen(0, '127.0.0.1', ok))
    const A = http.createServer((q, r) => { q.resume(); r.writeHead(307, { Location: `http://127.0.0.1:${B.address().port}/x` }); r.end() })
    await new Promise((ok) => A.listen(0, '127.0.0.1', ok))
    try {
      const origenA = `http://127.0.0.1:${A.address().port}`
      const seguro = G.crearFetchSeguro(new Set([origenA]), (...a) => fetch(...a))
      await assert.rejects(() => seguro(`${origenA}/login`, { method: 'POST', headers: { apikey: 'ficticia' }, body: JSON.stringify({ password: 'ficticia' }) }))
      // el llamador no puede anular la protección
      await assert.rejects(() => seguro(`${origenA}/login`, { method: 'POST', redirect: 'follow', body: 'x' }))
      await assert.rejects(() => seguro(`${origenA}/`, { redirect: 'follow' })) // también el GET del preflight
      assert.equal(recibidoB, 0)
    } finally { A.close(); B.close() }
  })
  await prueba('IP-R2: inventario con cursor (paginado) se RECHAZA: no se declara snapshot completo', async () => {
    await assert.rejects(() => G.leerInventario(['d'], async () => ({ estado: 200, cuerpo: { objetos: [{ clave: 'x/1/m.webp' }], cursor: 'abc' } })))
    assert.equal((await G.leerInventario(['d'], async () => ({ estado: 200, cuerpo: { objetos: [], cursor: null } }))).size, 0)
  })

  // IP-R2b: simulador de fila + Worker. `modo` controla qué hace el DELETE de la fila.
  const escenario = (modo, { workerEstado = 200 } = {}) => {
    const U = '11111111-2222-3333-4444-555555555555'
    const fila = { id: 'propia', titulo: 't', antes_url: `${G.PUBLICO_APROBADO}/fotos-galeria/${U}/g.webp`, despues_url: 'inicio-web/x.jpg' }
    const e = { filas: [fila, { id: 'otra' }], objetosBorrados: [], intentosFila: 0 }
    e.args = {
      fila,
      borrarFila: async (id) => {
        e.intentosFila++
        if (modo === 'rechazo403') return { estado: 403 }
        if (modo === 'rechazo500') throw new Error('500')
        if (modo === 'sin-efecto-204') return { estado: 204 } // RLS: 2xx pero no borró
        e.filas = e.filas.filter((x) => x.id !== id) // 'ok' y 'respuesta-perdida-con-commit'
        if (modo === 'respuesta-perdida-con-commit') throw new Error('red')
        return { estado: 204 }
      },
      releerFila: async () => { if (modo === 'lectura-caida') throw new Error('caída'); return e.filas },
      borrarGrupo: async (g) => { e.objetosBorrados.push(g); return workerEstado },
    }
    return e
  }
  const sinReferenciasRotas = (e) => !e.filas.some((f) => f.id === 'propia') || e.objetosBorrados.length === 0 // fila viva ⇒ ningún objeto borrado
  await prueba('IP-R2b: DELETE ok confirmado por relectura → se borran sus objetos y los contadores reflejan lo confirmado', async () => {
    const e = escenario('ok'); const r = await G.limpiarFilaPropia(e.args)
    assert.equal(r.filaEliminada, true); assert.equal(r.objetosEliminados, 1); assert.deepEqual(r.pendientes, [])
  })
  for (const modo of ['rechazo403', 'rechazo500', 'sin-efecto-204']) {
    await prueba(`IP-R2b: DELETE de la fila (${modo}) → la fila sigue, los objetos se CONSERVAN, nada se cuenta como eliminado y queda pendiente`, async () => {
      const e = escenario(modo); const r = await G.limpiarFilaPropia(e.args)
      assert.equal(r.filaEliminada, false); assert.equal(r.objetosEliminados, 0); assert.deepEqual(e.objetosBorrados, [])
      assert.deepEqual(r.pendientes, ['galeria_web:propia']); assert.ok(sinReferenciasRotas(e))
      assert.ok(e.filas.some((f) => f.id === 'otra')) // ninguna otra fila se toca
    })
  }
  await prueba('IP-R2b: respuesta perdida CON commit → la relectura confirma la ausencia y se limpian los objetos', async () => {
    const e = escenario('respuesta-perdida-con-commit'); const r = await G.limpiarFilaPropia(e.args)
    assert.equal(r.filaEliminada, true); assert.equal(r.objetosEliminados, 1)
  })
  await prueba('IP-R2b: respuesta perdida SIN commit → la fila sigue, objetos conservados', async () => {
    const e = escenario('rechazo500'); const r = await G.limpiarFilaPropia(e.args)
    assert.equal(r.filaEliminada, false); assert.deepEqual(e.objetosBorrados, [])
  })
  await prueba('IP-R2b: lectura de reconciliación caída → estado desconocido: objetos conservados y pendiente informado', async () => {
    const e = escenario('lectura-caida'); const r = await G.limpiarFilaPropia(e.args)
    assert.equal(r.filaEliminada, false); assert.deepEqual(e.objetosBorrados, []); assert.equal(r.pendientes.length, 1)
  })
  await prueba('IP-R2b: fila borrada pero el Worker falla (500) → fila eliminada, objeto PENDIENTE, contador de objetos en 0', async () => {
    const e = escenario('ok', { workerEstado: 500 }); const r = await G.limpiarFilaPropia(e.args)
    assert.equal(r.filaEliminada, true); assert.equal(r.objetosEliminados, 0); assert.equal(r.pendientes.length, 1); assert.ok(r.pendientes[0].startsWith('objeto:'))
  })

  await prueba('IP-R2: con lectura fallida (filas = null) no hay limpieza destructiva', () => assert.deepEqual(G.planLimpiezaGaleria(null, 'propia'), []))
  await prueba('IP-R2: el título lleva una marca por ejecución (dos ejecuciones no comparten título)', () => assert.notEqual(G.tituloDeEjecucion('aaaaaa'), G.tituloDeEjecucion('bbbbbb')))

  const inv = (objetos, estado = 200) => async () => ({ estado, cuerpo: objetos === undefined ? null : { objetos } })
  await prueba('IP-R2: inventario con lectura fallida (500) LANZA, no devuelve lista vacía', async () => {
    await assert.rejects(() => G.leerInventario(['fotos-productos'], inv([], 500)))
    await assert.rejects(() => G.leerInventario(['fotos-productos'], inv(undefined)))
    await assert.rejects(() => G.leerInventario(['fotos-productos'], async () => null))
    await assert.rejects(() => G.leerInventario(['fotos-productos'], inv([{ clave: '' }])))
  })
  await prueba('IP-R2: el inventario devuelve claves COMPLETAS y la comparación detecta cambios concurrentes de igual cardinalidad', async () => {
    const base = await G.leerInventario(['d'], inv([{ clave: 'x/1/m.webp' }, { clave: 'x/1/g.webp' }]))
    const mismoTamano = await G.leerInventario(['d'], inv([{ clave: 'x/1/m.webp' }, { clave: 'x/2/g.webp' }])) // 2 claves = 2 claves, pero distintas
    assert.equal(base.size, mismoTamano.size)
    const dif = G.diferenciaInventario(base, mismoTamano)
    assert.deepEqual(dif, { nuevas: ['x/2/g.webp'], faltantes: ['x/1/g.webp'] })
    assert.deepEqual(G.diferenciaInventario(base, base), { nuevas: [], faltantes: [] })
  })
  await prueba('IP-R2: snapshot — detecta cambios de fotos/filas, ignora el orden de claves', () => {
    const a = { producto: { id: 'p', foto_url: null }, galeriaWeb: [{ id: '1', titulo: 'T', antes_url: 'a' }] }
    assert.ok(G.iguales(a, { galeriaWeb: [{ antes_url: 'a', titulo: 'T', id: '1' }], producto: { foto_url: null, id: 'p' } }))
    assert.ok(!G.iguales(a, { ...a, producto: { id: 'p', foto_url: 'r2:x/1' } }))
    assert.ok(!G.iguales(a, { ...a, galeriaWeb: [] }))
  })

  await prueba('IP-S1: galería conservada — idéntica pasa; otra referencia, etiqueta/orden/id u objeto desaparecido fallan', () => {
    const f = { id: 'g1', foto_url: 'r2:fotos-servicios/u1', etiqueta: 'a', orden: 0 }
    const claves = ['fotos-servicios/u1/m.webp', 'fotos-servicios/u1/g.webp', 'fotos-servicios/u2/m.webp', 'fotos-servicios/u2/g.webp']
    assert.ok(G.galeriaConservada([f], [{ ...f }], claves))
    assert.ok(!G.galeriaConservada([f], [{ ...f, foto_url: 'r2:fotos-servicios/u2' }], claves))
    assert.ok(!G.galeriaConservada([f], [{ ...f, etiqueta: 'b' }], claves))
    assert.ok(!G.galeriaConservada([f], [{ ...f, orden: 1 }], claves))
    assert.ok(!G.galeriaConservada([f], [{ ...f, id: 'g2' }], claves))
    assert.ok(!G.galeriaConservada([f], [], claves))
    assert.ok(!G.galeriaConservada([f], [f], ['fotos-servicios/u1/m.webp']))
    assert.ok(!G.galeriaConservada([f], [f], ['fotos-servicios/u1/g.webp']))
  })

  await prueba('Entrega Pages: la limpieza reconoce solo los grupos propios bajo /medios (y no los de r2.dev ni de otro host)', () => {
    const PAGES = `${G.ALIAS_APROBADO}/medios`
    const id = '0f1e2d3c-4b5a-4968-8777-665544332211'
    const fila = { antes_url: `${PAGES}/fotos-galeria/${id}/g.webp`, despues_url: `${G.PUBLICO_APROBADO}/fotos-galeria/${id.replace('0f', '1f')}/g.webp` }
    assert.deepEqual(G.gruposPropiosDeFila(fila, PAGES), [`fotos-galeria/${id}`])
    assert.deepEqual(G.gruposPropiosDeFila(fila), [`fotos-galeria/${id.replace('0f', '1f')}`])
    assert.deepEqual(G.gruposPropiosDeFila({ antes_url: `https://evil.com/medios/fotos-galeria/${id}/g.webp` }, PAGES), [])
  })

  await prueba('IP-P1: la marca no basta — misma marca con la entrega equivocada o sin las bases aborta SIN login (preflight)', async () => {
    const rechaza = async (entrega, modulos, sw) => {
      const e = sitio({ modulos, sw })
      let autentico = false
      await assert.rejects(async () => { await G.preflight({ ...buenos(), entrega }, e.pedirHtml); autentico = true })
      assert.equal(autentico, false)
    }
    const r2dev = bundle()
    const pages = bundle({ publica: PAGES_MEDIOS, extras: G.PUBLICO_APROBADO })
    // control positivo de cada entrega
    for (const [entrega, mod] of [['r2dev', r2dev], ['pages', pages]]) {
      const r = await G.preflight({ ...buenos(), entrega }, sitio({ modulos: { 'assets/index-A.js': mod } }).pedirHtml)
      assert.equal(r.entrega, entrega)
    }
    await rechaza('pages', { 'assets/index-A.js': r2dev })                    // artefacto anterior (r2.dev) con --entrega=pages
    await rechaza('r2dev', { 'assets/index-A.js': pages })                    // artefacto nuevo con --entrega=r2dev
    await rechaza('pages', { 'assets/index-A.js': bundle({ publica: PAGES_MEDIOS }) })                       // sin la base anterior reconocida
    await rechaza('pages', { 'assets/index-A.js': bundle({ publica: G.PUBLICO_APROBADO, extras: PAGES_MEDIOS }) })   // ambos strings, ROLES invertidos
    await rechaza('pages', { 'assets/index-A.js': bundle({ publica: `${PAGES_MEDIOS}/`, extras: G.PUBLICO_APROBADO }) })
    await rechaza('pages', { 'assets/index-A.js': bundle({ publica: PAGES_MEDIOS, extras: 'https://evil.example/x' }) })
    await rechaza('pages', { 'assets/index-A.js': bundle({ publica: PAGES_MEDIOS, extras: G.PUBLICO_APROBADO, api: 'https://otro.workers.dev' }) })
    await rechaza('pages', { 'assets/index-A.js': bundle({ publica: PAGES_MEDIOS, extras: G.PUBLICO_APROBADO, proveedor: 'supabase' }) })
    await rechaza('pages', { 'assets/index-A.js': '/* sin medios */' })       // no se reconoce la configuración → aborta (fail-closed)
    await rechaza('pages', { 'assets/index-A.js': pages, 'assets/index-B.js': r2dev }) // dos módulos con configuración contradictoria
    await rechaza('pages', {}, 'precacheAndRoute([{url:"index.html",revision:"x"}])') // sin scripts en el precache
    await assert.rejects(() => G.preflight({ ...buenos(), entrega: 'otra' }, sitio().pedirHtml))
    await assert.rejects(() => G.preflight({ ...buenos(), entrega: undefined }, sitio().pedirHtml))
  })
  await prueba('IP-P1: un build sin la variable de bases extra sigue siendo válido para r2dev (el binding no cambia el texto)', async () => {
    const sinVariable = 'function na(){return{proveedor:`r2`,apiUrl:ta(`' + G.WORKER_APROBADO + '`),publicUrl:ta(`' + G.PUBLICO_APROBADO + '`)}}var sa=()=>qi(na().publicUrl,void 0);'
    const r = await G.preflight({ ...buenos(), entrega: 'r2dev' }, sitio({ modulos: { 'assets/index-A.js': sinVariable } }).pedirHtml)
    assert.equal(r.entrega, 'r2dev')
  })
  await prueba('IP-P1: scriptsDelSw solo admite rutas relativas del alias (nada absoluto, con `..` ni de otro host)', () => {
    const sw = 'precacheAndRoute([{url:"assets/a.js"},{url:"/etc/x.js"},{url:"../x.js"},{url:"https://evil.com/x.js"},{url:"assets/../b.js"},{url:"assets/a.js"},{url:"workbox-1.js"}])'
    assert.deepEqual(G.scriptsDelSw(sw), ['assets/a.js', 'workbox-1.js'])
  })

  // CP-01: limpieza + comprobación final del script de caché — toda excepción es un resultado NO confirmado (exit != 0), nunca éxito
  await prueba('CP-01: limpiarObjetoPropio — sano confirma; inventario/DELETE/relectura fallidos, cursor o malformado NO confirman y solo se borra el grupo propio', async () => {
    const PRE = 'fotos-galeria/mi-id/'
    const base = new Set(['fotos-galeria/ajeno/m.webp', 'fotos-galeria/ajeno/g.webp'])
    const propios = [`${PRE}m.webp`, `${PRE}g.webp`]
    const escenario = async ({ inventarios, borrar }) => {
      let i = 0
      const borrados = []
      const r = await G.limpiarObjetoPropio({
        prefijo: PRE, base,
        leerInventario: async () => { const v = inventarios[Math.min(i, inventarios.length - 1)]; i += 1; if (v instanceof Error) throw v; return v },
        borrarObjeto: async () => { borrados.push('propio'); if (borrar instanceof Error) throw borrar; return borrar ?? 200 },
      })
      return { r, borrados, lecturas: i }
    }
    const sano = await escenario({ inventarios: [new Set([...base, ...propios]), new Set(base)] })
    assert.ok(sano.r.confirmada && sano.r.necesaria && sano.borrados.length === 1 && sano.r.errores.length === 0)
    const yaLimpio = await escenario({ inventarios: [new Set(base)] })
    assert.ok(yaLimpio.r.confirmada && !yaLimpio.r.necesaria && yaLimpio.borrados.length === 0)
    const negativos = {
      'primer inventario falla (red/5xx/malformado/cursor)': { inventarios: [new Error('inventario ilegible')] },
      'relectura tras el DELETE falla': { inventarios: [new Set([...base, ...propios]), new Error('red caída')] },
      'DELETE lanza': { inventarios: [new Set([...base, ...propios]), new Set([...base, ...propios])], borrar: new Error('DELETE caído') },
      'DELETE 500 y el objeto sigue': { inventarios: [new Set([...base, ...propios]), new Set([...base, ...propios])], borrar: 500 },
      'inventario final distinto del inicial (clave extraña)': { inventarios: [new Set([...base, ...propios]), new Set([...base, 'fotos-galeria/otro-nuevo/m.webp'])] },
      'falta una clave ajena al final': { inventarios: [new Set([...base, ...propios]), new Set(['fotos-galeria/ajeno/m.webp'])] },
    }
    for (const [nombre, cfg] of Object.entries(negativos)) {
      const { r, borrados } = await escenario(cfg)
      assert.equal(r.confirmada, false, nombre)
      assert.ok(borrados.length <= 1, `${nombre}: solo el grupo propio`)
    }
    const p1 = await escenario(negativos['primer inventario falla (red/5xx/malformado/cursor)'])
    assert.equal(p1.borrados.length, 0) // sin lectura no se borra nada
    assert.ok(p1.r.errores[0].startsWith('lectura del inventario'))
    const sinBase = await G.limpiarObjetoPropio({ prefijo: PRE, base: null, leerInventario: async () => new Set(), borrarObjeto: async () => 200 })
    assert.equal(sinBase.confirmada, false) // sin inventario inicial no se puede afirmar igualdad
  })

  await prueba('Rollback de Galería: grupos propios bajo varias bases y limpieza con varios prefijos (solo los propios)', async () => {
    const PAGES = `${G.ALIAS_APROBADO}/medios`
    const a = '0f1e2d3c-4b5a-4968-8777-665544332211'
    const d = '1f1e2d3c-4b5a-4968-8777-665544332211'
    const fila = { antes_url: `${PAGES}/fotos-galeria/${a}/g.webp`, despues_url: `${G.PUBLICO_APROBADO}/fotos-galeria/${d}/g.webp` }
    assert.deepEqual(G.gruposPropiosDeFila(fila, [PAGES, G.PUBLICO_APROBADO]).sort(), [`fotos-galeria/${a}`, `fotos-galeria/${d}`])
    assert.deepEqual(G.gruposPropiosDeFila({ antes_url: `${PAGES}/fotos-galeria/${a}/g.webp`, despues_url: `${PAGES}/fotos-galeria/${a}/m.webp` }, [PAGES]), [`fotos-galeria/${a}`]) // sin duplicados
    assert.deepEqual(G.gruposPropiosDeFila({ antes_url: `https://evil.com/fotos-galeria/${a}/g.webp` }, [PAGES, G.PUBLICO_APROBADO]), [])
    const base = new Set(['fotos-galeria/ajeno/m.webp'])
    const propios = [`fotos-galeria/${a}/m.webp`, `fotos-galeria/${a}/g.webp`, `fotos-galeria/${d}/m.webp`, `fotos-galeria/${d}/g.webp`]
    let inv = new Set([...base, ...propios])
    const borrados = []
    const r = await G.limpiarObjetoPropio({
      prefijo: [`fotos-galeria/${a}/`, `fotos-galeria/${d}/`], base,
      leerInventario: async () => new Set(inv),
      borrarObjeto: async (pre) => { borrados.push(pre); inv = new Set([...inv].filter((k) => !k.startsWith(pre))); return 200 },
    })
    assert.ok(r.confirmada && r.necesaria)
    assert.deepEqual(borrados.sort(), [`fotos-galeria/${a}/`, `fotos-galeria/${d}/`])
    assert.ok(inv.has('fotos-galeria/ajeno/m.webp')) // lo ajeno intacto
    // un prefijo sin claves no se borra
    inv = new Set([...base, ...propios.slice(0, 2)])
    const solo = []
    const r2 = await G.limpiarObjetoPropio({ prefijo: [`fotos-galeria/${a}/`, `fotos-galeria/${d}/`], base, leerInventario: async () => new Set(inv), borrarObjeto: async (pre) => { solo.push(pre); inv = new Set([...inv].filter((k) => !k.startsWith(pre))); return 200 } })
    assert.ok(r2.confirmada)
    assert.deepEqual(solo, [`fotos-galeria/${a}/`])
  })

  const fallos = resultados.filter((r) => !r.ok)
  console.log(`\n${resultados.length} casos, ${fallos.length} fallos`)
  process.exitCode = fallos.length ? 1 : 0
})().catch((e) => { console.error(e); process.exitCode = 2 })
