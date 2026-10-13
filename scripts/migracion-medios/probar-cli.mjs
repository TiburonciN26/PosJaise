// Fase 9 V2 · Regresiones de la CLI REAL (medios-migracion.mjs) y del harness REAL (simular-fase9.mjs) para F9-01…F9-06.
// Todo ocurre contra un servidor HTTP ficticio en memoria: sin Supabase, sin R2, sin credenciales reales y sin red externa
// (los hosts *.qa.invalid y el de producción se redirigen al servidor ficticio; cualquier otro remoto se bloquea). El harness
// se ejecuta con una trampa que impide borrar, crear, escribir, lanzar procesos o conectarse.
// Uso: node scripts/migracion-medios/probar-cli.mjs [--salida=archivo.json]
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { prepararTrabajo, validarTrabajo } from './trabajo-seguro.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = resolve(AQUI, '..', '..')
const CLI = join(AQUI, 'medios-migracion.mjs')
const HARNESS = join(AQUI, 'simular-fase9.mjs')
const RED = pathToFileURL(join(AQUI, 'pruebas', 'red-ficticia.mjs')).href
const TRAMPA = pathToFileURL(join(AQUI, 'pruebas', 'trampa-efectos.mjs')).href
const sha = (b) => createHash('sha256').update(b).digest('hex')

// Carpeta de trabajo de ESTAS pruebas: también pasa por la guarda F9-01 (dedicada, en el temporal, con marca).
const VALIDA = validarTrabajo({ ruta: join(tmpdir(), 'sim-f9-pruebas-cli'), raiz: RAIZ })
if (!VALIDA.ok) throw new Error(`carpeta de pruebas: ${VALIDA.motivo}`)
const TRABAJO = prepararTrabajo(VALIDA)

// ---------------- datos ficticios ----------------
const GUID = 'ad081420-22a3-54e1-bc21-3375e2087c28', UID = 'd9f5df00-bbf5-4c34-a9e4-e97a2bff7345'
const ORIGINAL = 'qa-origen.webp', NUEVO = `r2:fotos-productos/${GUID}`, AJENO = 'qa-editada-por-otra-persona.webp'
const BYTES = { orig: Buffer.from('original PUBLICO ficticio QA F9'), m: Buffer.from('variante m ficticia QA F9'), g: Buffer.from('variante g ficticia QA F9') }
const PROD = 'cmkelllerzjqjbsqsylc.supabase.co'

// ---------------- servidor ficticio ----------------
const s = { filas: new Map(), objetos: new Map(), registro: [], patch: [], getFalla: 0, barreraFalla: 0, enVuelo: null, liberadas: [], liberarEnMs: undefined }
function jwt() {
  const b = (x) => Buffer.from(JSON.stringify(x)).toString('base64url'), t = Math.floor(Date.now() / 1000)
  return `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub: UID, role: 'authenticated', aud: 'authenticated', exp: t + 3600, iat: t })}.cWE`
}
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://ficticio')
  const partes = []; for await (const c of req) partes.push(c)
  const cuerpo = Buffer.concat(partes)
  s.registro.push({ metodo: req.method, ruta: u.pathname, host: req.headers['x-qa-host'] ?? 'loopback' })
  const json = (estado, datos) => { res.writeHead(estado, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(datos)) }
  if (u.pathname === '/auth/v1/token') return json(200, { access_token: jwt(), refresh_token: 'FICTICIO', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-f9@test.local', app_metadata: {}, user_metadata: {} } })
  if (u.pathname === '/rest/v1/rpc/es_admin') return json(200, true)
  const tabla = u.pathname.match(/^\/rest\/v1\/(\w+)$/)?.[1]
  if (tabla) {
    const id = u.searchParams.get('id')?.replace(/^eq\./, '')
    const fila = s.filas.get(`${tabla}/${id}`)
    if (req.method === 'GET') {
      if (s.getFalla > 0) { s.getFalla -= 1; return json(500, { code: 'QA500', message: 'lectura caída (ficticia)' }) }
      return json(200, fila ? [{ id, ...fila }] : [])
    }
  }
  // Funciones del servidor de la migración 20261012000003, con su semántica: el cambio solo aplica si la fila tiene p_de Y el
  // reloj del servidor no alcanzó p_vence (también cuando una operación «en vuelo» se libera tarde); la barrera solo responde
  // vencido el plazo, con el valor de la fila.
  if (u.pathname === '/rest/v1/rpc/migracion_medios_cambiar') {
    const p = JSON.parse(cuerpo.toString('utf8')), fila = s.filas.get(`${p.p_tabla}/${p.p_fila}`), vence = Date.parse(p.p_vence)
    const aplicar = () => {
      if (Date.now() >= vence) return 'vencida'
      if (!fila || fila[p.p_columna] !== p.p_de) return 'sin-cambio'
      fila[p.p_columna] = p.p_a; return 'hecho'
    }
    const modo = s.patch.shift() ?? 'normal'
    if (modo === '403') return json(403, { code: '42501', message: 'permiso denegado (ficticio)' })
    if (modo === 'sin-commit-503') return json(503, { code: 'QA503', message: 'caída antes de confirmar (ficticia)' })
    if (modo === 'rls') return json(200, 'sin-cambio')
    if (modo === 'en-vuelo-503') {
      // El proxy responde 503 pero la sentencia sigue en vuelo: se ejecuta cuando la prueba la libera (o a los N ms).
      s.enVuelo = { liberar: () => { const r = aplicar(); s.liberadas.push({ en: Date.now(), resultado: r }); s.enVuelo = null; return r } }
      if (s.liberarEnMs !== undefined) { const t = s.liberarEnMs; s.liberarEnMs = undefined; setTimeout(() => s.enVuelo?.liberar(), t) }
      return json(503, { code: 'QA503', message: 'proxy devolvió 503; la sentencia sigue en vuelo (ficticia)' })
    }
    const r = aplicar()
    if (modo === 'commit-503') return json(503, { code: 'QA503', message: 'respuesta perdida después del commit (ficticia)' })
    if (modo === 'commit-corte') { req.socket.destroy(); return }
    return json(200, r)
  }
  if (u.pathname === '/rest/v1/rpc/migracion_medios_barrera') {
    if (s.barreraFalla > 0) { s.barreraFalla -= 1; return json(500, { code: 'QA500', message: 'barrera caída (ficticia)' }) }
    const p = JSON.parse(cuerpo.toString('utf8')), fila = s.filas.get(`${p.p_tabla}/${p.p_fila}`), faltan = Date.parse(p.p_vence) - Date.now()
    if (faltan > 0) return json(200, { estado: 'esperar', faltan_ms: Math.ceil(faltan) })
    return json(200, { estado: 'cerrada', existe: Boolean(fila), valor: fila ? fila[p.p_columna] : null })
  }
  if (req.method === 'PUT' && u.pathname.startsWith('/v1/medios/')) {
    const [, , , destino, id, v] = u.pathname.split('/')
    const k = `/medios/${destino}/${id}/${v}.webp`
    if (s.objetos.has(k)) return json(409, { error: 'ya existe' })
    s.objetos.set(k, { bytes: cuerpo, tipo: 'image/webp' }); return json(201, { ok: true })
  }
  const o = req.method === 'GET' && s.objetos.get(u.pathname)
  if (o) { res.writeHead(o.estado ?? 200, { 'Content-Type': o.tipo }); return res.end(o.bytes) }
  return json(404, { message: 'no existe (ficticio)' })
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${srv.address().port}`
const REDIRIGIR = { 'db.qa.invalid': BASE, 'worker.qa.invalid': BASE, 'pages.qa.invalid': BASE, [PROD]: BASE }

// ---------------- utilidades ----------------
const archivo = (n) => join(TRABAJO, n)
function entorno(nombre, url) { writeFileSync(archivo(nombre), `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_ANON_KEY=ANON-FICTICIA-QA\n`); return archivo(nombre) }
const ENV_LOCAL = entorno('local.env', BASE)
const ENV_REMOTO = entorno('remoto.env', 'https://db.qa.invalid')
const ENV_PROD = entorno('prod.env', `https://${PROD}`)
const urlOrigen = (ambiente) => `${ambiente}/storage/v1/object/public/fotos-productos/${ORIGINAL}`

function manifiesto({ ambiente = BASE, publica = `${BASE}/medios`, api = null, lectura = null, entrada = 'verificada', ref = {}, version = 2 } = {}) {
  return {
    version, ambiente, publica, api, lectura, ffmpeg: 'ficticio', eventos: [],
    entradas: [{
      id: GUID, destino: 'fotos-productos', estado: entrada, ref: NUEVO, historial: [],
      origen: { bucket: 'fotos-productos', ruta: ORIGINAL, url: urlOrigen(ambiente), bytes: BYTES.orig.length, sha256: sha(BYTES.orig) },
      variantes: { m: { bytes: BYTES.m.length, sha256: sha(BYTES.m) }, g: { bytes: BYTES.g.length, sha256: sha(BYTES.g) } },
      referencias: [{ tabla: 'productos', columna: 'foto_url', fila: UID, original: ORIGINAL, nuevo: NUEVO, estado: 'pendiente', ...ref }],
    }],
  }
}
function guardar(nombre, m) { writeFileSync(archivo(nombre), JSON.stringify(m, null, 1)); return archivo(nombre) }
const leerM = (ruta) => JSON.parse(readFileSync(ruta, 'utf8'))
const refDe = (ruta) => leerM(ruta).entradas[0].referencias[0]
function reiniciar({ valor = ORIGINAL, r2 = false, ambiente = BASE } = {}) {
  s.filas.clear(); s.objetos.clear(); s.registro.length = 0; s.patch.length = 0; s.getFalla = 0; s.barreraFalla = 0; s.enVuelo = null; s.liberadas.length = 0; s.liberarEnMs = undefined
  s.filas.set(`productos/${UID}`, { foto_url: valor })
  s.objetos.set(new URL(urlOrigen(ambiente)).pathname, { bytes: BYTES.orig, tipo: 'image/webp' })
  if (r2) for (const v of ['m', 'g']) s.objetos.set(`/medios/fotos-productos/${GUID}/${v}.webp`, { bytes: BYTES[v], tipo: 'image/webp' })
}
const valor = () => s.filas.get(`productos/${UID}`).foto_url
const pedidos = (filtro = () => true) => s.registro.filter(filtro)
function ejecutar(script, args, { preload, env = {} } = {}) {
  return new Promise((ok, mal) => {
    const p = spawn(process.execPath, [...(preload ? ['--import', preload] : []), script, ...args], { cwd: RAIZ, env: { ...process.env, MIGRACION_EMAIL: 'qa-f9@test.local', MIGRACION_PASSWORD: 'FICTICIA-NO-REAL', QA_F9_REDIRIGIR: JSON.stringify(REDIRIGIR), ...env } })
    let out = '', err = ''
    p.stdout.on('data', (x) => { out += x }); p.stderr.on('data', (x) => { err += x })
    const t = setTimeout(() => { p.kill(); mal(new Error(`tiempo agotado: ${args.join(' ')}`)) }, 60000)
    p.on('close', (estado) => { clearTimeout(t); let datos = null; try { datos = JSON.parse(out.slice(out.indexOf('{'))) } catch {} ok({ estado, out, err, datos }) })
  })
}
const cli = (args, opciones = {}) => ejecutar(CLI, args, { preload: RED, ...opciones })

const casos = []
async function caso(nombre, fn) {
  try { const detalle = await fn(); casos.push({ nombre, ok: true, detalle }); console.log(`OK    ${nombre}`) } catch (e) {
    casos.push({ nombre, ok: false, error: String(e.message).slice(0, 1500) }); console.log(`FALLA ${nombre}\n      ${String(e.message).slice(0, 600)}`)
  }
}

try {
  // ======================= F9-02 · vínculo manifiesto ↔ ambiente =======================
  await caso('F9-02 · Manifiesto de A con entorno B (mismo id y valor): actualizar/revertir/copiar/verificar abortan antes de login, PUT o PATCH', async () => {
    const otro = 'http://127.0.0.1:1'
    const r = {}
    for (const [comando, extra, estadoRef, conR2] of [
      ['actualizar', [], 'pendiente', false], ['revertir', [], 'actualizada', true],
      ['copiar', [`--cache=${TRABAJO}`, `--api=${BASE}`, `--lectura=${BASE}/medios`], 'pendiente', false],
      ['verificar', [`--lectura=${BASE}/medios`], 'actualizada', true],
    ]) {
      reiniciar({ valor: estadoRef === 'actualizada' ? NUEVO : ORIGINAL, r2: conR2 })
      const p = guardar(`f902-${comando}.json`, manifiesto({ ambiente: otro, publica: `${BASE}/medios`, entrada: comando === 'copiar' ? 'planificada' : 'verificada', ref: { estado: estadoRef } }))
      const antes = valor()
      const x = await cli([comando, `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, ...(comando === 'verificar' ? [] : ['--aplicar']), ...extra])
      assert.equal(x.estado, 2, `${comando}: ${x.err}`); assert.match(x.err, /otro ambiente/)
      assert.equal(pedidos().length, 0, `${comando}: ningún pedido al backend B (${JSON.stringify(pedidos())})`)
      assert.equal(valor(), antes)
      r[comando] = x.err.trim()
    }
    // Manifiesto V1 (identidad = solo host) y origen apuntando a otro host: también se rechazan sin contactar.
    reiniciar()
    const v1 = await cli(['actualizar', `--manifiesto=${guardar('f902-v1.json', manifiesto({ version: 1, ambiente: new URL(BASE).host }))}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(v1.estado, 2); assert.match(v1.err, /versión 1/)
    const mOrigen = manifiesto(); mOrigen.entradas[0].origen.url = 'https://otro.qa.invalid/storage/v1/object/public/fotos-productos/qa-origen.webp'
    const vo = await cli(['verificar', `--manifiesto=${guardar('f902-origen.json', mOrigen)}`, `--env-file=${ENV_LOCAL}`, `--lectura=${BASE}/medios`])
    assert.equal(vo.estado, 2); assert.match(vo.err, /URL del original/)
    // Copia ya ligada a un Worker: reanudar por otro Worker se rechaza antes de autenticar.
    reiniciar()
    const ligado = await cli(['copiar', `--manifiesto=${guardar('f902-worker.json', manifiesto({ entrada: 'planificada', api: 'http://127.0.0.1:2', lectura: `${BASE}/medios` }))}`, `--env-file=${ENV_LOCAL}`, `--cache=${TRABAJO}`, `--api=${BASE}`, `--lectura=${BASE}/medios`, '--aplicar'])
    assert.equal(ligado.estado, 2); assert.match(ligado.err, /Worker/); assert.equal(pedidos().length, 0)
    assert.equal(pedidos().length + s.registro.length, 0)
    return { ...r, v1: v1.err.trim(), origen: vo.err.trim(), worker: ligado.err.trim() }
  })
  await caso('F9-02 · Control: el manifiesto del MISMO entorno conserva el flujo sano (actualizar → verificar → revertir)', async () => {
    reiniciar({ r2: true })
    const p = guardar('f902-sano.json', manifiesto())
    const a = await cli(['actualizar', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(a.estado, 0, a.err); assert.equal(valor(), NUEVO); assert.equal(refDe(p).estado, 'actualizada'); assert.equal(refDe(p).operacion, undefined)
    const v = await cli(['verificar', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, `--lectura=${BASE}/medios`])
    assert.equal(v.estado, 0, v.out); assert.equal(v.datos.ok, true); assert.equal(v.datos.cobertura, 'completa')
    const r = await cli(['revertir', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(r.estado, 0, r.err); assert.equal(valor(), ORIGINAL); assert.equal(refDe(p).estado, 'revertida'); assert.equal(r.datos.completo, true)
    return { actualizar: a.datos.hechas, verificar: v.datos.cobertura, revertir: r.datos.hechas }
  })

  // ======================= F9-03 · resultado incierto y diario =======================
  await caso('F9-03 · Cambio confirmado + 503: la lectura de reconciliación lo da por hecho; revertir restaura el original', async () => {
    reiniciar(); s.patch.push('commit-503')
    const p = guardar('f903-a.json', manifiesto())
    const a = await cli(['actualizar', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(a.estado, 0, a.err); assert.equal(refDe(p).estado, 'actualizada'); assert.match(refDe(p).nota, /confirmado por lectura/)
    const r = await cli(['revertir', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(r.estado, 0, r.err); assert.equal(valor(), ORIGINAL); assert.equal(refDe(p).estado, 'revertida')
    return { nota: refDe(p).nota }
  })
  await caso('F9-03 · Cambio confirmado + 503 + lectura caída: la duda queda abierta (exit 3) y revertir nunca da éxito con la fila migrada', async () => {
    reiniciar(); s.patch.push('commit-503'); s.getFalla = Infinity
    const p = guardar('f903-b.json', manifiesto())
    const a = await cli(['actualizar', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(a.estado, 3, a.err); assert.equal(valor(), NUEVO, 'la base sí quedó migrada')
    const op = refDe(p).operacion
    assert.deepEqual([refDe(p).estado, op.modo, op.estado], ['pendiente', 'actualizar', 'incierta']); assert.match(op.id, /^[0-9a-f-]{36}$/)
    // Revertir con la lectura todavía caída: incompleto, nunca «0 candidatas, exit 0».
    const r1 = await cli(['revertir', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(r1.estado, 3, r1.err); assert.equal(r1.datos.completo, false); assert.equal(r1.datos.operacionesAbiertas, 1); assert.equal(valor(), NUEVO)
    assert.equal(refDe(p).operacion.id, op.id, 'el id de la operación se conserva')
    assert.equal(pedidos((x) => x.ruta === '/rest/v1/rpc/migracion_medios_cambiar').length, 1, 'con la duda abierta no se envía ningún UPDATE nuevo')
    // Backend sano: la reversión reconcilia la operación (la da por confirmada) y revierte.
    s.getFalla = 0
    const r2 = await cli(['revertir', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(r2.estado, 0, r2.err); assert.equal(r2.datos.reconciliadas, 1); assert.equal(r2.datos.hechas, 1); assert.equal(r2.datos.completo, true)
    assert.equal(valor(), ORIGINAL); assert.equal(refDe(p).estado, 'revertida'); assert.equal(refDe(p).operacion, undefined)
    return { primerIntento: r1.datos, final: { reconciliadas: r2.datos.reconciliadas, hechas: r2.datos.hechas } }
  })
  await caso('F9-03 · Interrupción tras el commit y antes de guardar el resultado: actualizar y revertir la reconcilian sin nuevo UPDATE de más', async () => {
    reiniciar({ valor: NUEVO })
    const enCurso = { operacion: { id: 'e7c7a1b2-0000-4000-8000-000000000001', modo: 'actualizar', de: ORIGINAL, a: NUEVO, estado: 'en-curso', inicio: new Date().toISOString() } }
    const p1 = guardar('f903-c1.json', manifiesto({ ref: enCurso }))
    const a = await cli(['actualizar', `--manifiesto=${p1}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(a.estado, 0, a.err); assert.equal(a.datos.reconciliadas, 1); assert.equal(pedidos((x) => x.ruta === '/rest/v1/rpc/migracion_medios_cambiar').length, 0, 'no repite el UPDATE')
    assert.equal(refDe(p1).estado, 'actualizada')
    reiniciar({ valor: NUEVO })
    const p2 = guardar('f903-c2.json', manifiesto({ ref: enCurso }))
    const r = await cli(['revertir', `--manifiesto=${p2}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(r.estado, 0, r.err); assert.equal(valor(), ORIGINAL); assert.equal(refDe(p2).estado, 'revertida')
    return { actualizar: a.datos.reconciliadas, revertir: r.datos }
  })
  const PASADO = () => new Date(Date.now() - 1000).toISOString()
  await caso('F9-03 · Sin commit: 503 deja la duda (exit 3) aunque la lectura vea el valor anterior; la barrera, vencido el plazo, la cierra y se aplica', async () => {
    reiniciar(); s.patch.push('sin-commit-503')
    const p = guardar('f903-d.json', manifiesto())
    const a1 = await cli(['actualizar', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, '--aplicar', '--plazo-ms=1500'])
    assert.equal(a1.estado, 3, a1.err); assert.equal(valor(), ORIGINAL); assert.equal(refDe(p).operacion.estado, 'incierta'); assert.ok(refDe(p).operacion.vence)
    const a2 = await cli(['actualizar', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(a2.estado, 0, a2.err); assert.equal(a2.datos.noAplicadas, 1); assert.equal(valor(), NUEVO); assert.equal(refDe(p).estado, 'actualizada')
    // Interrumpida sin commit (operación en curso con plazo ya vencido): la barrera la cierra y se aplica.
    reiniciar()
    const p2 = guardar('f903-d2.json', manifiesto({ ref: { operacion: { id: 'e7c7a1b2-0000-4000-8000-000000000002', modo: 'actualizar', de: ORIGINAL, a: NUEVO, estado: 'en-curso', vence: PASADO() } } }))
    const a3 = await cli(['actualizar', `--manifiesto=${p2}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(a3.estado, 0, a3.err); assert.equal(valor(), NUEVO); assert.equal(refDe(p2).estado, 'actualizada')
    return { primero: a1.datos.inciertas, segundo: a2.datos.noAplicadas }
  })
  await caso('F9-03 · Edición ajena: con operación abierta o con respuesta incierta, queda en conflicto (tras la barrera) y no se pisa', async () => {
    reiniciar({ valor: AJENO })
    const p = guardar('f903-e.json', manifiesto({ ref: { operacion: { id: 'e7c7a1b2-0000-4000-8000-000000000003', modo: 'actualizar', de: ORIGINAL, a: NUEVO, estado: 'incierta', vence: PASADO() } } }))
    const r = await cli(['revertir', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(r.estado, 0, r.err); assert.equal(valor(), AJENO); assert.equal(refDe(p).estado, 'conflicto'); assert.equal(pedidos((x) => x.ruta === '/rest/v1/rpc/migracion_medios_cambiar').length, 0)
    reiniciar({ valor: AJENO }); s.patch.push('commit-503')
    const p2 = guardar('f903-e2.json', manifiesto())
    const a = await cli(['actualizar', `--manifiesto=${p2}`, `--env-file=${ENV_LOCAL}`, '--aplicar', '--plazo-ms=1000'])
    assert.equal(a.estado, 3, a.err); assert.equal(refDe(p2).operacion.estado, 'incierta')
    const a2 = await cli(['actualizar', `--manifiesto=${p2}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(a2.estado, 0, a2.err); assert.equal(valor(), AJENO); assert.equal(refDe(p2).estado, 'conflicto')
    return { revertir: refDe(p).conflicto, actualizar: refDe(p2).conflicto }
  })
  await caso('F9-03 · Rechazos definitivos (403 de PostgREST, RLS con 0 filas) y corte de red tras el commit', async () => {
    reiniciar(); s.patch.push('403')
    const p = guardar('f903-f.json', manifiesto())
    const a = await cli(['actualizar', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(a.estado, 3, a.err); assert.equal(a.datos.rechazadas, 1); assert.equal(refDe(p).estado, 'pendiente'); assert.equal(refDe(p).operacion, undefined); assert.match(refDe(p).rechazo.motivo, /403/)
    reiniciar(); s.patch.push('rls')
    const p2 = guardar('f903-g.json', manifiesto())
    const b = await cli(['actualizar', `--manifiesto=${p2}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(b.estado, 3, b.err); assert.equal(b.datos.rechazadas, 1); assert.equal(valor(), ORIGINAL)
    reiniciar(); s.patch.push('commit-corte')
    const p3 = guardar('f903-h.json', manifiesto())
    const c = await cli(['actualizar', `--manifiesto=${p3}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(c.estado, 0, c.err); assert.equal(refDe(p3).estado, 'actualizada'); assert.match(refDe(p3).nota, /sin respuesta/)
    return { '403': refDe(p).rechazo.motivo, rls: refDe(p2).rechazo.motivo, corte: refDe(p3).nota }
  })

  // ======================= F9-03b · cambio todavía en vuelo =======================
  const RPC_CAMBIO = (x) => x.ruta === '/rest/v1/rpc/migracion_medios_cambiar', RPC_BARRERA = (x) => x.ruta === '/rest/v1/rpc/migracion_medios_barrera'
  await caso('F9-03b · 503 con el cambio EN VUELO y lectura del valor anterior; revertir ANTES del commit; el commit llega DESPUÉS de la reversión', async () => {
    reiniciar(); s.patch.push('en-vuelo-503')
    const p = guardar('f903b-1.json', manifiesto())
    const a = await cli(['actualizar', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, '--aplicar', '--plazo-ms=2500'])
    assert.equal(a.estado, 3, a.err); assert.equal(valor(), ORIGINAL, 'la lectura todavía ve el original'); assert.ok(s.enVuelo, 'el cambio sigue en vuelo')
    const op = refDe(p).operacion
    assert.deepEqual([refDe(p).estado, op.estado], ['pendiente', 'incierta'])
    // La reversión no da nada por cerrado con una lectura: espera el plazo y pasa por la barrera.
    const t0 = Date.now()
    const r = await cli(['revertir', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    const finReversion = Date.now()
    assert.equal(r.estado, 0, r.err)
    assert.ok(finReversion >= Date.parse(op.vence), 'la reversión terminó solo después del plazo del cambio en vuelo')
    assert.ok(pedidos(RPC_BARRERA).length >= 1, 'pasó por la barrera')
    assert.equal(r.datos.completo, true); assert.equal(refDe(p).operacion, undefined); assert.equal(refDe(p).estado, 'pendiente')
    // El cambio en vuelo se confirma ahora, DESPUÉS de que la reversión respondió: ya no puede aplicar (plazo vencido).
    assert.equal(s.enVuelo.liberar(), 'vencida'); assert.equal(valor(), ORIGINAL, 'la foto NO queda migrada tras la reversión completa')
    const r2 = await cli(['revertir', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(r2.estado, 0, r2.err); assert.equal(r2.datos.completo, true); assert.equal(valor(), ORIGINAL)
    return { esperaReversionMs: finReversion - t0, liberacionTardia: s.liberadas.at(-1).resultado, barreras: pedidos(RPC_BARRERA).length }
  })
  await caso('F9-03b · Commit temporizado a los 1.200 ms (antes del plazo) tras una lectura previa: la barrera lo ve y la reversión lo revierte, sin cambio duplicado', async () => {
    reiniciar(); s.patch.push('en-vuelo-503'); s.liberarEnMs = 1200
    const p = guardar('f903b-2.json', manifiesto())
    const a = await cli(['actualizar', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, '--aplicar', '--plazo-ms=3000'])
    assert.equal(a.estado, 3, a.err)
    const r = await cli(['revertir', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(r.estado, 0, r.err); assert.equal(s.liberadas[0]?.resultado, 'hecho', 'el commit en vuelo sí aplicó antes del plazo')
    assert.equal(r.datos.reconciliadas, 1); assert.equal(r.datos.hechas, 1); assert.equal(valor(), ORIGINAL); assert.equal(refDe(p).estado, 'revertida')
    assert.equal(pedidos(RPC_CAMBIO).length, 2, 'un cambio de actualizar (en vuelo) y uno de reversión; ninguno duplicado')
    return { reconciliadas: r.datos.reconciliadas, cambios: pedidos(RPC_CAMBIO).length }
  })
  await caso('F9-03b · Sin evidencia suficiente la operación sigue abierta con su id: plazo aún abierto, barrera caída y operación sin plazo → exit 3', async () => {
    reiniciar(); s.patch.push('en-vuelo-503')
    const p = guardar('f903b-3.json', manifiesto())
    await cli(['actualizar', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, '--aplicar', '--plazo-ms=1500'])
    const id = refDe(p).operacion.id
    // Plazo todavía abierto y sin permiso para esperar: no se cierra.
    const r0 = await cli(['revertir', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, '--aplicar', '--espera-max-ms=0'])
    assert.equal(r0.estado, 3, r0.err); assert.equal(r0.datos.completo, false); assert.equal(refDe(p).operacion.id, id)
    // Barrera caída: tampoco.
    s.barreraFalla = 10
    const r1 = await cli(['revertir', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(r1.estado, 3, r1.err); assert.equal(r1.datos.completo, false); assert.equal(refDe(p).operacion.id, id, 'se conserva el id')
    assert.equal(pedidos(RPC_CAMBIO).length, 1, 'con la duda abierta no se envía ningún cambio nuevo')
    // Barrera sana: cierra (el cambio en vuelo nunca se liberó: no aplicado) y la reversión es completa con la fila original.
    s.barreraFalla = 0
    const r2 = await cli(['revertir', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(r2.estado, 0, r2.err); assert.equal(r2.datos.completo, true); assert.equal(valor(), ORIGINAL)
    assert.equal(s.enVuelo.liberar(), 'vencida')
    // Operación de la versión anterior (sin plazo) con el valor anterior visible: nunca se cierra sola.
    reiniciar()
    const p2 = guardar('f903b-4.json', manifiesto({ ref: { operacion: { id: 'e7c7a1b2-0000-4000-8000-000000000005', modo: 'actualizar', de: ORIGINAL, a: NUEVO, estado: 'incierta' } } }))
    const r3 = await cli(['revertir', `--manifiesto=${p2}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(r3.estado, 3, r3.err); assert.equal(r3.datos.completo, false); assert.match(refDe(p2).operacion.detalle, /sin plazo/); assert.equal(pedidos(RPC_BARRERA).length, 0)
    return { plazoAbierto: r0.datos.operacionesAbiertas, barreraCaida: r1.datos.operacionesAbiertas, sinPlazo: refDe(p2).operacion.detalle }
  })
  await caso('F9-03b · Control: el commit concluye antes de reconciliar → reversión normal, sin barrera ni cambio duplicado', async () => {
    reiniciar(); s.patch.push('commit-503')
    const p = guardar('f903b-5.json', manifiesto())
    const a = await cli(['actualizar', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(a.estado, 0, a.err); assert.equal(refDe(p).estado, 'actualizada')
    const r = await cli(['revertir', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, '--aplicar'])
    assert.equal(r.estado, 0, r.err); assert.equal(valor(), ORIGINAL); assert.equal(refDe(p).estado, 'revertida')
    assert.equal(pedidos(RPC_CAMBIO).length, 2); assert.equal(pedidos(RPC_BARRERA).length, 0)
    return { cambios: pedidos(RPC_CAMBIO).length }
  })

  // ======================= F9-04 · verificación completa =======================
  await caso('F9-04 · verificar: sin --lectura falla cerrado; m/g ausentes, una sola variante, tipo o lectura caída nunca dan ok', async () => {
    const p = guardar('f904.json', manifiesto({ ref: { estado: 'actualizada' }, lectura: `${BASE}/medios` }))
    const correr = () => cli(['verificar', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, `--lectura=${BASE}/medios`])
    reiniciar({ valor: NUEVO })
    const sin = await cli(['verificar', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`])
    assert.equal(sin.estado, 2); assert.match(sin.err, /exige --lectura/); assert.equal(sin.datos, null, 'no emite ningún informe ok'); assert.equal(pedidos().length, 0)
    const ausentes = await correr()
    assert.equal(ausentes.estado, 1); assert.deepEqual([ausentes.datos.ok, ausentes.datos.r2Coinciden, ausentes.datos.r2Esperados], [false, 0, 2])
    s.objetos.set(`/medios/fotos-productos/${GUID}/m.webp`, { bytes: BYTES.m, tipo: 'image/webp' })
    const una = await correr()
    assert.equal(una.estado, 1); assert.deepEqual([una.datos.ok, una.datos.r2Coinciden, una.datos.cobertura], [false, 1, 'incompleta'])
    s.objetos.set(`/medios/fotos-productos/${GUID}/g.webp`, { bytes: BYTES.g, tipo: 'image/png' })
    const tipo = await correr()
    assert.equal(tipo.estado, 1); assert.equal(tipo.datos.ok, false)
    s.objetos.set(`/medios/fotos-productos/${GUID}/g.webp`, { bytes: BYTES.g, tipo: 'text/plain', estado: 500 })
    const caida = await correr()
    assert.equal(caida.estado, 1); assert.equal(caida.datos.ok, false)
    s.objetos.set(`/medios/fotos-productos/${GUID}/g.webp`, { bytes: BYTES.g, tipo: 'image/webp' })
    const bien = await correr()
    assert.equal(bien.estado, 0, bien.out); assert.deepEqual([bien.datos.ok, bien.datos.cobertura, bien.datos.r2Coinciden], [true, 'completa', 2])
    // Lectura distinta de la ligada al manifiesto: rechazo antes de autenticar.
    s.registro.length = 0
    const otra = await cli(['verificar', `--manifiesto=${p}`, `--env-file=${ENV_LOCAL}`, `--lectura=${BASE}/otra`])
    assert.equal(otra.estado, 2); assert.equal(pedidos().length, 0)
    // Referencia con operación abierta: tampoco es ok.
    const mAbierta = manifiesto({ ref: { estado: 'actualizada', operacion: { id: 'e7c7a1b2-0000-4000-8000-000000000004', modo: 'revertir', de: NUEVO, a: ORIGINAL, estado: 'incierta' } }, lectura: `${BASE}/medios` })
    const abierta = await cli(['verificar', `--manifiesto=${guardar('f904-abierta.json', mAbierta)}`, `--env-file=${ENV_LOCAL}`, `--lectura=${BASE}/medios`])
    assert.equal(abierta.estado, 1); assert.ok(abierta.datos.problemas.some((x) => x.tipo === 'operacion-abierta'))
    return { sinLectura: sin.err.trim(), una: una.datos.problemas, completa: bien.datos.cobertura }
  })
  await caso('F9-04 · Manifiesto vacío: caso explícito (cobertura «vacia»), sin inventar objetos ni autenticar', async () => {
    reiniciar()
    const m = manifiesto(); m.entradas = []
    const v = await cli(['verificar', `--manifiesto=${guardar('f904-vacio.json', m)}`, `--env-file=${ENV_LOCAL}`])
    assert.equal(v.estado, 0, v.err); assert.deepEqual([v.datos.cobertura, v.datos.r2Esperados, v.datos.originalesEsperados], ['vacia', 0, 0]); assert.equal(pedidos().length, 0)
    return v.datos
  })

  // ======================= F9-05 · redacción en el inventario =======================
  await caso('F9-05 · inventariar: URLs firmadas/autenticadas/públicas a buckets privados (propio, ajeno, proxy) nunca salen al informe', async () => {
    const TOKEN = 'eyJTOKEN.FICTICIO.QAF9'
    const referencias = []
    let n = 0
    for (const origen of [BASE, 'https://otro-proyecto.qa.invalid', 'https://proxy.qa.invalid/prefijo']) {
      for (const endpoint of ['sign', 'authenticated', 'public']) {
        for (const bucket of ['comprobantes-pedidos-web', 'comprobantes-citas-web', 'bucket-desconocido']) {
          for (const [tabla, columna] of [['galeria_web', 'antes_url'], ['galeria_web', 'despues_url'], ['pedidos_web', 'comprobante_url'], ['productos', 'foto_url']]) {
            referencias.push({ tabla, columna, fila: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, valor: `${origen}/storage/v1/object/${endpoint}/${bucket}/qa-sensible/foto.png?token=${TOKEN}` })
          }
        }
      }
    }
    const publica = `${BASE}/storage/v1/object/public/fotos-galeria/qa-publica.webp`
    referencias.push({ tabla: 'galeria_web', columna: 'antes_url', fila: 'ffffffff-0000-4000-8000-000000000001', valor: publica })
    referencias.push({ tabla: 'galeria_web', columna: 'despues_url', fila: 'ffffffff-0000-4000-8000-000000000001', valor: 'https://externa.qa.invalid/f.jpg?firma=SECRETO' })
    writeFileSync(archivo('f905-crudo.json'), JSON.stringify({ generado: new Date().toISOString(), columnas: [], buckets: [], referencias, objetos: [{ bucket: 'fotos-galeria', ruta: 'qa-publica.webp', bytes: 10, mime: 'image/webp' }] }))
    const salida = archivo('f905-informe.json')
    const r = await cli(['inventariar', `--desde-json=${archivo('f905-crudo.json')}`, `--env-file=${ENV_LOCAL}`, `--salida=${salida}`])
    assert.equal(r.estado, 0, r.err)
    const texto = readFileSync(salida, 'utf8') + r.out + r.err
    for (const prohibido of ['qa-sensible', TOKEN, 'SECRETO']) assert.ok(!texto.includes(prohibido), `el informe contiene «${prohibido}»`)
    const j = JSON.parse(readFileSync(salida, 'utf8'))
    assert.equal(j.totales.privadas, n, 'todas las sensibles cuentan como privadas'); assert.equal(j.referencias.length, 2)
    const pub = j.referencias.find((x) => x.valor === publica)
    assert.deepEqual([pub.formato, pub.migrar], ['supabase-url', true])
    assert.equal(j.referencias.find((x) => x.columna === 'despues_url').valor, 'https://externa.qa.invalid/f.jpg?<omitido>')
    return { sensibles: n, privadas: j.totales.privadas, publicadas: j.referencias.length }
  })

  // ======================= F9-06 · permisos por función =======================
  const remotos = { api: 'https://worker.qa.invalid', lectura: 'https://pages.qa.invalid/medios', ambiente: 'https://db.qa.invalid' }
  const permisos = ['--permitir-supabase=db.qa.invalid', '--permitir-worker=worker.qa.invalid', '--permitir-lectura=pages.qa.invalid']
  const mRemoto = () => manifiesto({ ambiente: remotos.ambiente, publica: remotos.lectura, entrada: 'planificada' })
  function cacheFicticia() {
    writeFileSync(join(TRABAJO, `${sha(BYTES.orig)}.orig`), BYTES.orig)
    for (const v of ['m', 'g']) writeFileSync(join(TRABAJO, `${GUID}-${v}.webp`), BYTES[v])
  }
  await caso('F9-06 · Tres hosts distintos aprobados (Supabase, Worker, lectura): copiar, actualizar y verificar llegan al cableado correcto', async () => {
    reiniciar({ ambiente: remotos.ambiente }); cacheFicticia()
    const p = guardar('f906-sano.json', mRemoto())
    const c = await cli(['copiar', `--manifiesto=${p}`, `--env-file=${ENV_REMOTO}`, `--cache=${TRABAJO}`, `--api=${remotos.api}`, `--lectura=${remotos.lectura}`, '--aplicar', ...permisos])
    assert.equal(c.estado, 0, c.err); assert.equal(c.datos.verificadas, 1)
    const a = await cli(['actualizar', `--manifiesto=${p}`, `--env-file=${ENV_REMOTO}`, '--aplicar', '--permitir-supabase=db.qa.invalid'])
    assert.equal(a.estado, 0, a.err); assert.equal(valor(), NUEVO)
    const v = await cli(['verificar', `--manifiesto=${p}`, `--env-file=${ENV_REMOTO}`, `--lectura=${remotos.lectura}`, '--permitir-supabase=db.qa.invalid', '--permitir-lectura=pages.qa.invalid'])
    assert.equal(v.estado, 0, v.out); assert.equal(v.datos.ok, true)
    const porHost = (pred) => [...new Set(pedidos(pred).map((x) => x.host))]
    assert.deepEqual(porHost((x) => x.ruta.startsWith('/auth/') || x.ruta.startsWith('/rest/')), ['db.qa.invalid'])
    assert.deepEqual(porHost((x) => x.metodo === 'PUT'), ['worker.qa.invalid'])
    assert.deepEqual(porHost((x) => x.ruta.startsWith('/medios/')), ['pages.qa.invalid'])
    assert.deepEqual(porHost((x) => x.ruta.startsWith('/storage/')), ['db.qa.invalid'])
    assert.ok(!pedidos().some((x) => x.host === PROD || x.host === 'loopback'))
    const m = leerM(p); assert.deepEqual([m.api, m.lectura], [remotos.api, remotos.lectura])
    return { pedidos: pedidos().length, put: pedidos((x) => x.metodo === 'PUT').length }
  })
  await caso('F9-06 · Host sin permiso, intercambio de roles, producción sin su permiso, opción repetida y --permitir-remoto: rechazo antes del login', async () => {
    const r = {}
    const intentos = {
      'falta permiso de lectura': ['copiar', ENV_REMOTO, ['--permitir-supabase=db.qa.invalid', '--permitir-worker=worker.qa.invalid']],
      'roles intercambiados': ['copiar', ENV_REMOTO, ['--permitir-supabase=db.qa.invalid', '--permitir-worker=pages.qa.invalid', '--permitir-lectura=worker.qa.invalid']],
      'Supabase con permiso de Worker': ['copiar', ENV_REMOTO, ['--permitir-supabase=worker.qa.invalid', '--permitir-worker=db.qa.invalid', '--permitir-lectura=pages.qa.invalid']],
      'producción sin --permitir-produccion': ['actualizar', ENV_PROD, [`--permitir-supabase=${PROD}`]],
      'opción repetida': ['copiar', ENV_REMOTO, [...permisos, '--permitir-worker=worker.qa.invalid']],
      'permiso general retirado': ['copiar', ENV_REMOTO, ['--permitir-remoto=db.qa.invalid']],
    }
    for (const [nombre, [comando, env, extra]] of Object.entries(intentos)) {
      reiniciar({ ambiente: remotos.ambiente }); cacheFicticia()
      const m = comando === 'actualizar' ? manifiesto({ ambiente: `https://${PROD}`, publica: remotos.lectura }) : mRemoto()
      const p = guardar(`f906-${Object.keys(r).length}.json`, m)
      const args = comando === 'copiar' ? [`--cache=${TRABAJO}`, `--api=${remotos.api}`, `--lectura=${remotos.lectura}`] : []
      const x = await cli([comando, `--manifiesto=${p}`, `--env-file=${env}`, '--aplicar', ...args, ...extra])
      assert.equal(x.estado, 2, `${nombre}: ${x.err}`); assert.equal(pedidos().length, 0, `${nombre}: ${JSON.stringify(pedidos())}`)
      r[nombre] = x.err.trim()
    }
    assert.match(r['producción sin --permitir-produccion'], /PRODUCCIÓN/)
    return r
  })

  // ======================= F9-01 · harness real con trampa de efectos =======================
  await caso('F9-01 · Harness real: raíz, proyecto, .codex, src, otra capitalización, ajena en tmp y junction a src → exit 2 con CERO efectos', async () => {
    const marca = Date.now().toString(36)
    const ajena = join(tmpdir(), `sim-f9-ajena-${marca}`)
    const junction = join(tmpdir(), `sim-f9-junction-${marca}`)
    mkdirSync(ajena); writeFileSync(join(ajena, 'importante.txt'), 'no borrar\n')
    let hayJunction = false
    try { symlinkSync(join(RAIZ, 'src'), junction, 'junction'); hayJunction = true } catch {}
    const srcAntes = readdirSync(join(RAIZ, 'src')).length
    const cuentas = archivo('cuentas-ficticias.json')
    writeFileSync(cuentas, JSON.stringify({ admin: { email: 'qa-a@test.local', password: 'x' }, adminB: { email: 'qa-b@test.local', password: 'x' } }))
    const r = {}
    try {
      const destinos = { 'raíz de unidad': 'C:/', proyecto: '.', 'proyecto absoluto': RAIZ, '.codex': join(RAIZ, '.codex'), src: join(RAIZ, 'src'), 'src con otra capitalización': join(RAIZ, 'src').toUpperCase(), 'ajena existente en tmp': ajena, ...(hayJunction ? { 'junction en tmp hacia src': junction } : {}) }
      for (const [nombre, destino] of Object.entries(destinos)) {
        const registro = archivo(`trampa-${Object.keys(r).length}.log`)
        const x = await ejecutar(HARNESS, [`--cuentas=${cuentas}`, `--trabajo=${destino}`], { preload: TRAMPA, env: { QA_F9_REGISTRO: registro } })
        const efectos = existsSync(registro) ? readFileSync(registro, 'utf8').trim() : ''
        assert.equal(x.estado, 2, `${nombre}: ${x.err.slice(0, 300)}`); assert.match(x.err, /--trabajo rechazado/)
        assert.equal(efectos, '', `${nombre}: efectos intentados ${efectos}`)
        r[nombre] = x.err.trim()
      }
      assert.ok(existsSync(join(ajena, 'importante.txt')), 'la carpeta ajena sigue intacta')
      assert.equal(readdirSync(join(RAIZ, 'src')).length, srcAntes)
      // Carpeta propia: la guarda la acepta y el primer efecto que intenta el harness ya no es un borrado de carpeta ajena.
      const propia = join(tmpdir(), 'sim-f9-pruebas-cli')
      const registro = archivo('trampa-propia.log')
      const x = await ejecutar(HARNESS, [`--cuentas=${cuentas}`, `--trabajo=${propia}`], { preload: TRAMPA, env: { QA_F9_REGISTRO: registro } })
      const primero = JSON.parse(readFileSync(registro, 'utf8').split('\n')[0])
      assert.doesNotMatch(x.err, /--trabajo rechazado/)
      assert.equal(primero.llamada, 'child_process.execFileSync', `la guarda pasa y lo siguiente es la comprobación de Docker: ${JSON.stringify(primero)}`)
      r.propia = { aceptada: true, primerEfectoBloqueado: primero.llamada }
    } finally {
      if (hayJunction && lstatSync(junction).isSymbolicLink()) rmdirSync(junction) // quita solo el enlace (no recursivo)
      rmSync(join(ajena, 'importante.txt')); rmdirSync(ajena)
    }
    assert.equal(readdirSync(join(RAIZ, 'src')).length, srcAntes, 'src intacto tras retirar la junction')
    return { ...r, junctionProbada: hayJunction }
  })
} finally {
  await new Promise((r) => srv.close(r))
}

const fallos = casos.filter((c) => !c.ok)
const salida = process.argv.find((a) => a.startsWith('--salida='))?.slice(9)
if (salida) writeFileSync(salida, JSON.stringify({ fecha: new Date().toISOString(), alcance: 'CLI y harness reales contra un servidor HTTP ficticio en memoria; sin red externa, sin Supabase, sin R2 y sin credenciales reales', total: casos.length, fallos: fallos.length, casos }, null, 1))
console.log(`\n${casos.length - fallos.length}/${casos.length} correctos`)
process.exit(fallos.length ? 1 : 0)
