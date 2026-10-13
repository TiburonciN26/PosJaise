// Fase 9 · Simulación LOCAL de extremo a extremo de la migración de medios (sin ningún cambio remoto).
//
//   Supabase Local (127.0.0.1:54321) + Worker de medios en `wrangler dev --local` (R2 SIMULADO en disco, ligado al Supabase
//   Local) + la app en Vite dev leyendo de ese R2 simulado.
//
// Para no alterar los datos de prueba que ya tiene Local, las ESCRITURAS de la simulación (copiar/actualizar/revertir) se
// limitan a fixtures propios «QA-F9» que se crean al empezar y se eliminan al final. El inventario y la planificación (solo
// lectura) se ejecutan además sobre TODO el dataset de Local. Una huella de los valores de medios de las filas preexistentes
// se compara antes/después: deben quedar idénticos.
//
// Uso: node scripts/migracion-medios/simular-fase9.mjs --cuentas=<json con admin y adminB>
//      --trabajo=<carpeta temporal dedicada: %TEMP%/sim-f9-<sufijo>> [--evidencia=.codex/evidencia-fase9-v2] [--conservar]
// --trabajo se valida ANTES de nada (F9-01, trabajo-seguro.mjs): solo una carpeta sim-f9* dentro del temporal del sistema,
// nueva o con la marca de propiedad; entre corridas solo se vacía su subcarpeta `corrida/`.
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'
import { sha256 } from './lib.mjs'
import { SUBCARPETA, prepararTrabajo, validarTrabajo } from './trabajo-seguro.mjs'

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
// Primero de todo: la carpeta de trabajo. Ningún borrado, carpeta, lectura de cuentas, Docker ni red antes de validarla.
const VALIDACION_TRABAJO = validarTrabajo({ ruta: arg('trabajo'), raiz: RAIZ })
if (!VALIDACION_TRABAJO.ok) {
  console.error(`simular-fase9: --trabajo rechazado: ${VALIDACION_TRABAJO.motivo}`)
  process.exit(2)
}
const CUENTAS = JSON.parse(readFileSync(arg('cuentas'), 'utf8'))
const TRABAJO = join(VALIDACION_TRABAJO.carpeta, SUBCARPETA) // se crea/vacía en prepararTrabajo, ya dentro de la ejecución
const EVIDENCIA = resolve(RAIZ, arg('evidencia') ?? '.codex/evidencia-fase9-v2')
const CONSERVAR = process.argv.includes('--conservar')
const SUPA = 'http://127.0.0.1:54321'
const PUERTO_WORKER = 8799, WORKER = `http://127.0.0.1:${PUERTO_WORKER}`
const PUERTO_APP = 5391, APP = `http://127.0.0.1:${PUERTO_APP}`
const ESPERA = (ms) => new Promise((r) => setTimeout(r, ms))
const ENV = Object.fromEntries(readFileSync(join(RAIZ, '.env.local'), 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, '')]))
for (const c of [CUENTAS.admin, CUENTAS.adminB]) if (!/^qa[^@]*@test\.local$/i.test(c?.email ?? '')) throw new Error('Se requieren cuentas QA ficticias admin y adminB')
if (ENV.VITE_SUPABASE_URL !== SUPA) throw new Error('.env.local no apunta al Supabase Local')
if (!/:54321->8000/.test(execFileSync('docker', ['ps', '--filter', 'name=^supabase_kong_WedJaiseReact$', '--format', '{{.Ports}}'], { encoding: 'utf8' }))) throw new Error('Supabase Local no verificado en 54321')

const MARCA = `QA-F9-${Date.now().toString(36)}`
const MANIF = join(TRABAJO, 'manifiesto-fixtures.json'), CACHE = join(TRABAJO, 'cache'), R2SIM = join(TRABAJO, 'r2-simulado')
const casos = [], pasos = [], reintentosRed = []
async function caso(nombre, fn) {
  const t0 = Date.now()
  try { const detalle = await fn(); casos.push({ nombre, ok: true, ms: Date.now() - t0, detalle }); console.log(`OK    ${nombre}`) } catch (e) {
    casos.push({ nombre, ok: false, ms: Date.now() - t0, error: String(e.message).slice(0, 900) }); console.log(`FALLA ${nombre}\n      ${String(e.message).slice(0, 400)}`)
  }
}
const psql = (sql) => execFileSync('docker', ['exec', '-i', 'supabase_db_WedJaiseReact', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' }).trim()
function herramienta(args, { cuenta = CUENTAS.admin, esperarFallo = false } = {}) {
  const r = spawnSync(process.execPath, [join(RAIZ, 'scripts/migracion-medios/medios-migracion.mjs'), ...args], { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, MIGRACION_EMAIL: cuenta.email, MIGRACION_PASSWORD: cuenta.password } })
  pasos.push({ args: args.map((a) => a.replace(TRABAJO, '<trabajo>')), estado: r.status, salida: (r.stdout || r.stderr).slice(0, 4000) })
  if (!esperarFallo && r.status !== 0) throw new Error(`herramienta ${args[0]} terminó con ${r.status}: ${r.stderr.slice(0, 500)}`)
  if (esperarFallo) return { estado: r.status, error: r.stderr }
  const i = r.stdout.indexOf('{'); return JSON.parse(r.stdout.slice(i))
}
const leerManifiesto = () => JSON.parse(readFileSync(MANIF, 'utf8'))

// Huella de TODOS los valores de medios de las filas que no son fixtures (para demostrar que no se tocaron).
function huellaPreexistentes() {
  return psql(`begin read only;
    select md5(string_agg(x, '|' order by x)) from (
      select 'p'||id||coalesce(foto_url,'') x from productos where nombre not like 'QA-F9-%'
      union all select 'pf'||f.id||f.foto_url from producto_fotos f join productos p on p.id=f.producto_id where p.nombre not like 'QA-F9-%'
      union all select 's'||id||coalesce(foto_url,'') from servicios where nombre not like 'QA-F9-%'
      union all select 'sf'||f.id||f.foto_url from servicio_fotos f join servicios s on s.id=f.servicio_id where s.nombre not like 'QA-F9-%'
      union all select 'g'||id||antes_url||despues_url from galeria_web where coalesce(titulo,'') not like 'QA-F9-%') t; rollback;`).split('\n').find((l) => /^[0-9a-f]{32}$/.test(l))
}

// ---------------- fixtures ----------------
function fabricarImagenes(dir) {
  mkdirSync(dir, { recursive: true })
  const f = (nombre, args) => { const s = join(dir, nombre); execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, '-frames:v', '1', s]); return s }
  return {
    jpegGrande: f('a-grande.jpg', ['-f', 'lavfi', '-i', 'testsrc2=size=2400x1600', '-q:v', '3']),
    pngAlfa: f('b-alfa.png', ['-f', 'lavfi', '-i', 'testsrc2=size=800x800,format=rgba,colorchannelmixer=aa=0.5']),
    webpChico: f('c-chico.webp', ['-f', 'lavfi', '-i', 'testsrc2=size=500x500', '-c:v', 'libwebp', '-q:v', '75']),
    webpGrande: f('d-grande.webp', ['-f', 'lavfi', '-i', 'testsrc2=size=1800x1200', '-c:v', 'libwebp', '-q:v', '80']),
    // 960 px de ruido: g supera 512 KiB a calidad 80 y cabe a 70 (escalón de calidad). 1300 px no cabe ni a 60 (error esperado).
    ruido: f('e-ruido.jpg', ['-f', 'lavfi', '-i', 'nullsrc=s=960x960,geq=r=random(1)*255:g=random(2)*255:b=random(3)*255', '-q:v', '2']),
    ruidoGrande: f('e-ruido-grande.jpg', ['-f', 'lavfi', '-i', 'nullsrc=s=1300x1300,geq=r=random(1)*255:g=random(2)*255:b=random(3)*255', '-q:v', '2']),
    gif: f('f.gif', ['-f', 'lavfi', '-i', 'testsrc2=size=300x300']),
  }
}
async function crearFixtures(admin) {
  const img = fabricarImagenes(join(TRABAJO, 'imagenes'))
  const subir = async (bucket, ruta, archivo, tipo) => {
    const { error } = await admin.storage.from(bucket).upload(ruta, readFileSync(archivo), { contentType: tipo, upsert: false })
    if (error) throw new Error(`subida ${bucket}/${ruta}: ${error.message}`)
    return ruta
  }
  writeFileSync(join(TRABAJO, 'corrupto.jpg'), 'esto no es una imagen\n')
  const r = `${MARCA}`
  const obj = {
    X: await subir('fotos-productos', `${r}/x-compartida.jpg`, img.jpegGrande, 'image/jpeg'),
    Y: await subir('fotos-productos', `${r}/y-alfa.png`, img.pngAlfa, 'image/png'),
    Z: await subir('fotos-productos', `${r}/z-chico.webp`, img.webpChico, 'image/webp'),
    C: await subir('fotos-productos', `${r}/corrupto.jpg`, join(TRABAJO, 'corrupto.jpg'), 'image/jpeg'),
    N: await subir('fotos-productos', `${r}/ruido-grande.jpg`, img.ruidoGrande, 'image/jpeg'),
    S1: await subir('fotos-servicios', `${r}/s-grande.jpg`, img.jpegGrande, 'image/jpeg'),
    S2: await subir('fotos-servicios', `${r}/s-chico.webp`, img.webpChico, 'image/webp'),
    G1: await subir('fotos-galeria', `${r}/g-antes.webp`, img.webpGrande, 'image/webp'),
    G2: await subir('fotos-galeria', `${r}/g-ruido.jpg`, img.ruido, 'image/jpeg'),
    G3: await subir('fotos-galeria', `${r}/g.gif`, img.gif, 'image/gif'),
  }
  const urlGal = (ruta) => `${SUPA}/storage/v1/object/public/fotos-galeria/${ruta}`
  const ins = async (tabla, fila) => { const { data, error } = await admin.from(tabla).insert(fila).select('id').single(); if (error) throw new Error(`${tabla}: ${error.message}`); return data.id }
  const filas = {}
  filas.pA = await ins('productos', { nombre: `${r} A galería`, precio: 1, foto_url: obj.X })
  filas.pfA1 = await ins('producto_fotos', { producto_id: filas.pA, foto_url: obj.X, orden: 0 })
  filas.pfA2 = await ins('producto_fotos', { producto_id: filas.pA, foto_url: obj.Y, orden: 1 })
  filas.pB = await ins('productos', { nombre: `${r} B webp chico`, precio: 1, foto_url: obj.Z })
  filas.pC = await ins('productos', { nombre: `${r} C rota`, precio: 1, foto_url: `${r}/no-existe.webp` })
  filas.pD = await ins('productos', { nombre: `${r} D corrupta`, precio: 1, foto_url: obj.C })
  filas.pE = await ins('productos', { nombre: `${r} E compartida`, precio: 1, foto_url: obj.X }) // X: 3 referencias → 1 copia
  filas.pF = await ins('productos', { nombre: `${r} F no cabe`, precio: 1, foto_url: obj.N })
  filas.sA = await ins('servicios', { nombre: `${r} S servicio`, precio: 1, foto_url: obj.S2 })
  filas.sfA = await ins('servicio_fotos', { servicio_id: filas.sA, foto_url: obj.S1, orden: 0 })
  filas.g1 = await ins('galeria_web', { titulo: `${r} G1`, antes_url: urlGal(obj.G1), despues_url: urlGal(obj.G2), orden: 0, activo: true })
  filas.g2 = await ins('galeria_web', { titulo: `${r} G2`, antes_url: 'inicio-web/hero-antes-referencia.jpg', despues_url: urlGal(obj.G3), orden: 1, activo: true })
  // Defensa de privacidad: una URL de galería que apunta al bucket PRIVADO de comprobantes (inactiva: nunca se publica).
  filas.g3 = await ins('galeria_web', { titulo: `${r} G3`, antes_url: `${SUPA}/storage/v1/object/public/comprobantes-pedidos-web/${r}/x.webp`, despues_url: urlGal(obj.G1), orden: 2, activo: false })
  return { obj, filas }
}
async function limpiarFixtures(admin, fx) {
  // Solo la simulación borra, y solo lo que ella creó (la herramienta de migración no tiene borrados).
  const r = []
  if (fx?.filas) {
    psql(`delete from producto_fotos where producto_id in (select id from productos where nombre like '${MARCA}%');
      delete from servicio_fotos where servicio_id in (select id from servicios where nombre like '${MARCA}%');
      delete from productos where nombre like '${MARCA}%'; delete from servicios where nombre like '${MARCA}%';
      delete from galeria_web where titulo like '${MARCA}%';`)
    r.push('filas')
  }
  for (const bucket of ['fotos-productos', 'fotos-servicios', 'fotos-galeria']) {
    const { data } = await admin.storage.from(bucket).list(MARCA, { limit: 100 })
    if (data?.length) { const { error } = await admin.storage.from(bucket).remove(data.map((o) => `${MARCA}/${o.name}`)); if (error) throw error; r.push(`${bucket}:${data.length}`) }
  }
  return r
}

// ---------------- servicios locales ----------------
function arrancarWorker() {
  rmSync(R2SIM, { recursive: true, force: true })
  const bin = join(RAIZ, 'cloudflare/medios-worker/node_modules/wrangler/bin/wrangler.js')
  const p = spawn(process.execPath, [bin, 'dev', '--local', '--port', String(PUERTO_WORKER), '--persist-to', R2SIM, '--var', `SUPABASE_URL:${SUPA}`, '--var', `SUPABASE_ANON_KEY:${ENV.VITE_SUPABASE_ANON_KEY}`, '--var', 'SERVIR_LECTURA:1', '--var', `ORIGENES_PERMITIDOS:${APP}`, '--var', 'AMBIENTE:local'], { cwd: join(RAIZ, 'cloudflare/medios-worker'), stdio: 'ignore' })
  return p
}
function arrancarApp() {
  return spawn(process.execPath, [join(RAIZ, 'node_modules/vite/bin/vite.js'), '--port', String(PUERTO_APP), '--strictPort', '--host', '127.0.0.1'], { cwd: RAIZ, stdio: 'ignore', env: { ...process.env, VITE_MEDIOS_PUBLIC_URL: WORKER, VITE_MEDIOS_API_URL: WORKER, VITE_MEDIOS_PROVEEDOR: '' } })
}
async function esperarHttp(url, ms = 90000) {
  const fin = Date.now() + ms
  while (Date.now() < fin) { try { const r = await fetch(url); if (r.status < 500) return } catch {} await ESPERA(500) }
  throw new Error(`${url} no respondió`)
}
async function inventarioR2(admin) {
  const { data } = await admin.auth.getSession()
  let total = 0
  for (const d of ['fotos-productos', 'fotos-servicios', 'fotos-galeria']) {
    let cursor = ''
    do {
      const url = `${WORKER}/v1/inventario/${d}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`
      let r
      for (let intento = 1; ; intento++) {
        try { r = await fetch(url, { headers: { Authorization: `Bearer ${data.session.access_token}` } }); break } catch (e) {
          // Fallo de red del Worker local (wrangler dev): se registra y se reintenta, sin ocultarlo.
          reintentosRed.push({ url: url.replace(WORKER, ''), intento, causa: String(e.cause?.code ?? e.cause ?? e.message) })
          if (intento >= 3) throw e
          await ESPERA(1000 * intento)
        }
      }
      const j = await r.json(); total += j.objetos.length; cursor = j.cursor
    } while (cursor)
  }
  return total
}

// Imágenes que la app muestra realmente (src y si cargaron) en una página del portal.
async function imagenesEn(browser, ruta, prepararPagina) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto(`${APP}${ruta}`, { waitUntil: 'load' })
  if (prepararPagina) await prepararPagina(page)
  await ESPERA(3500)
  await page.evaluate(async () => { for (const i of document.querySelectorAll('img')) { i.loading = 'eager'; i.scrollIntoView?.(); } await new Promise((r) => setTimeout(r, 1500)) })
  const imgs = await page.evaluate(() => [...document.querySelectorAll('img')].map((i) => ({ src: i.currentSrc || i.src, ok: i.complete && i.naturalWidth > 0 })))
  await ctx.close()
  return imgs
}
function esperadoPorRef(m, tabla, fila, columna) {
  for (const e of m.entradas) for (const r of e.referencias) if (r.tabla === tabla && r.fila === fila && r.columna === columna) return r.estado === 'actualizada' ? r.nuevo : r.original
  return null
}
const aUrl = (valor, bucket) => valor.startsWith('r2:') ? `${WORKER}/${valor.slice(3)}/g.webp` : valor.startsWith('http') ? valor : `${SUPA}/storage/v1/object/public/${bucket}/${valor}`

// ---------------- ejecución ----------------
;(async () => {
  assert.equal(prepararTrabajo(VALIDACION_TRABAJO), TRABAJO); mkdirSync(EVIDENCIA, { recursive: true })
  const admin = createClient(SUPA, ENV.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { error: eLogin } = await admin.auth.signInWithPassword({ email: CUENTAS.admin.email, password: CUENTAS.admin.password })
  if (eLogin) throw eLogin
  const inicio = { huella: huellaPreexistentes(), auditoria: Number(psql('select count(*) from auditoria')), objetos: Number(psql('select count(*) from storage.objects')) }
  let fx, worker, app, browser
  try {
    await caso('Inventario y planificación de SOLO LECTURA sobre todo el dataset de Local (sin fixtures)', async () => {
      const inv = herramienta(['inventariar', `--salida=${join(TRABAJO, 'inventario-dataset.json')}`])
      const plan = herramienta(['planificar', `--inventario=${join(TRABAJO, 'inventario-dataset.json')}`, `--manifiesto=${join(TRABAJO, 'manifiesto-dataset.json')}`, `--cache=${CACHE}`, `--publica=${WORKER}`])
      const prep = herramienta(['copiar', `--manifiesto=${join(TRABAJO, 'manifiesto-dataset.json')}`, `--cache=${CACHE}`, `--api=${WORKER}`, `--lectura=${WORKER}`])
      assert.equal(prep.simulado, true); assert.equal(prep.subidas, 0)
      assert.equal(huellaPreexistentes(), inicio.huella, 'el modo sin --aplicar no escribe en la base')
      return { totales: inv.totales, plan: plan.resumen, variantesPreparadas: prep.preparadas, errores: prep.errores }
    })

    fx = await crearFixtures(admin)
    writeFileSync(join(TRABAJO, 'filas-fixtures.json'), JSON.stringify(Object.entries(fx.filas).map(([k, id]) => ({ tabla: { p: 'productos', pf: 'producto_fotos', s: 'servicios', sf: 'servicio_fotos', g: 'galeria_web' }[k.replace(/[A-Z0-9]+$/, '')], fila: id }))))
    worker = arrancarWorker(); app = arrancarApp()
    await esperarHttp(`${WORKER}/v1/no-existe`); await esperarHttp(APP)
    browser = await chromium.launch()

    await caso('Inventario con fixtures: clasifica rota, corrupta, GIF, recurso del build, URL a bucket privado y la foto compartida', async () => {
      const inv = herramienta(['inventariar', `--salida=${join(TRABAJO, 'inventario.json')}`, `--publica=${WORKER}`])
      const j = JSON.parse(readFileSync(join(TRABAJO, 'inventario.json'), 'utf8'))
      const de = (tabla, fila, columna) => j.referencias.find((r) => r.tabla === tabla && r.fila === fila && (!columna || r.columna === columna))
      assert.equal(de('productos', fx.filas.pC).motivo, 'rota: el objeto no existe en Storage')
      assert.equal(de('productos', fx.filas.pD).migrar, true, 'la corrupta parece migrable por su tipo declarado: la descarta planificar')
      assert.equal(de('galeria_web', fx.filas.g2, 'despues_url').motivo, 'tipo no migrable (image/gif)')
      assert.equal(de('galeria_web', fx.filas.g2, 'antes_url').motivo, 'recurso del build (public/)')
      assert.equal(j.referencias.some((r) => r.tabla === 'galeria_web' && r.fila === fx.filas.g3 && r.columna === 'antes_url'), false, 'la URL al bucket privado no aparece con su valor en el informe')
      assert.ok(j.totales.privadas >= 476)
      return inv.totales
    })

    await caso('Planificar fixtures: SHA-256 de los bytes, objeto compartido una sola vez, corrupta descartada; reanudar no duplica', async () => {
      const args = ['planificar', `--inventario=${join(TRABAJO, 'inventario.json')}`, `--manifiesto=${MANIF}`, `--cache=${CACHE}`, `--publica=${WORKER}`, `--filas=${join(TRABAJO, 'filas-fixtures.json')}`]
      const p1 = herramienta(args), p2 = herramienta(args)
      const m = leerManifiesto()
      assert.equal(p2.nuevas, 0); assert.equal(p2.refsNuevas, 0)
      const x = m.entradas.find((e) => e.origen.ruta === fx.obj.X)
      assert.equal(x.referencias.length, 3, 'X: producto A, su foto de galería y producto E')
      assert.equal(m.entradas.some((e) => e.origen.ruta === fx.obj.C), false)
      assert.ok(m.eventos.some((ev) => ev.tipo === 'origen-ilegible' && ev.ruta === fx.obj.C))
      assert.equal(m.entradas.some((e) => e.origen.bucket.startsWith('comprobantes')), false)
      for (const e of m.entradas) assert.equal(e.origen.sha256, sha256(readFileSync(join(CACHE, `${e.origen.sha256}.orig`))))
      return { entradas: m.entradas.length, referencias: p1.resumen.referencias, eventos: m.eventos.map((ev) => ev.tipo) }
    })

    await caso('Sin --aplicar, copiar solo prepara variantes; el Worker no recibe nada y la base no cambia', async () => {
      const r = herramienta(['copiar', `--manifiesto=${MANIF}`, `--cache=${CACHE}`, `--api=${WORKER}`, `--lectura=${WORKER}`])
      assert.equal(r.subidas, 0); assert.equal(await inventarioR2(admin), 0)
      const m = leerManifiesto()
      const g1 = m.entradas.find((e) => e.origen.ruta === fx.obj.G1), z = m.entradas.find((e) => e.origen.ruta === fx.obj.Z), y = m.entradas.find((e) => e.origen.ruta === fx.obj.Y), ruido = m.entradas.find((e) => e.origen.ruta === fx.obj.G2)
      assert.equal(z.variantes.g.reencode, false, 'WebP chico válido: g es el original sin recodificar'); assert.equal(z.variantes.g.sha256, z.origen.sha256)
      assert.ok(Math.max(g1.variantes.g.ancho, g1.variantes.g.alto) <= 1400 && g1.variantes.g.reencode)
      const gY = readFileSync(join(CACHE, `${y.id}-g.webp`)).toString('latin1')
      assert.ok(/ALPH|VP8L/.test(gY), 'el PNG con alfa conserva el canal alfa')
      const noCabe = m.entradas.find((e) => e.origen.ruta === fx.obj.N)
      assert.equal(noCabe.estado, 'error'); assert.match(noCabe.error, /no cabe/); assert.equal(noCabe.variantes, null)
      for (const e of m.entradas.filter((x) => x !== noCabe)) { assert.ok(e.variantes.m.bytes <= 96 * 1024 && Math.max(e.variantes.m.ancho, e.variantes.m.alto) <= 320); assert.ok(e.variantes.g.bytes <= 512 * 1024) }
      return { preparadas: r.preparadas, calidadRuido: { m: ruido.variantes.m.calidad, g: ruido.variantes.g.calidad }, ffmpeg: m.ffmpeg }
    })

    await caso('Bloqueo: dos ejecuciones sobre el mismo manifiesto no pueden convivir', async () => {
      writeFileSync(`${MANIF}.lock`, 'otra ejecución\n')
      const r = herramienta(['copiar', `--manifiesto=${MANIF}`, `--cache=${CACHE}`, `--api=${WORKER}`, `--lectura=${WORKER}`, '--aplicar'], { esperarFallo: true })
      rmSync(`${MANIF}.lock`)
      assert.notEqual(r.estado, 0); assert.match(r.error, /en uso/)
    })

    await caso('Guardas: remoto sin el permiso de SU función, producción y manifiesto de otro ambiente se rechazan antes de autenticar', async () => {
      const remoto = 'https://pos-jaise-medios.workers.dev'
      const r1 = herramienta(['copiar', `--manifiesto=${MANIF}`, `--cache=${CACHE}`, `--api=${remoto}`, `--lectura=${WORKER}`, '--aplicar'], { esperarFallo: true })
      assert.match(r1.error, /permitir-worker=pos-jaise-medios\.workers\.dev/)
      // El permiso de OTRA función (lectura) no habilita ese host como Worker.
      const r1b = herramienta(['copiar', `--manifiesto=${MANIF}`, `--cache=${CACHE}`, `--api=${remoto}`, `--lectura=${WORKER}`, '--aplicar', '--permitir-lectura=pos-jaise-medios.workers.dev'], { esperarFallo: true })
      assert.match(r1b.error, /permitir-worker/)
      writeFileSync(join(TRABAJO, 'env-prod'), 'VITE_SUPABASE_URL=https://cmkelllerzjqjbsqsylc.supabase.co\nVITE_SUPABASE_ANON_KEY=x\n')
      const r2 = herramienta(['actualizar', `--manifiesto=${MANIF}`, `--env-file=${join(TRABAJO, 'env-prod')}`, '--aplicar', '--permitir-supabase=cmkelllerzjqjbsqsylc.supabase.co'], { esperarFallo: true })
      assert.match(r2.error, /PRODUCCIÓN/)
      // El manifiesto de este Local contra OTRO Supabase (otro puerto, nada escuchando): se rechaza por el vínculo, sin login.
      writeFileSync(join(TRABAJO, 'env-otro'), 'VITE_SUPABASE_URL=http://127.0.0.1:54399\nVITE_SUPABASE_ANON_KEY=x\n')
      const r3 = herramienta(['actualizar', `--manifiesto=${MANIF}`, `--env-file=${join(TRABAJO, 'env-otro')}`, '--aplicar'], { esperarFallo: true })
      assert.equal(r3.estado, 2); assert.match(r3.error, /otro ambiente/)
      const r4 = herramienta(['actualizar', `--manifiesto=${MANIF}`, '--aplicar', '--permitir-remoto=x.dev'], { esperarFallo: true })
      assert.match(r4.error, /ya no existe/)
      return { remoto: r1.error.trim(), otraFuncion: r1b.error.trim(), produccion: r2.error.trim(), otroAmbiente: r3.error.trim() }
    })

    const antesApp = {}
    await caso('App ANTES de actualizar referencias: las fotos de los fixtures se leen de Supabase y cargan', async () => {
      antesApp.producto = await imagenesEn(browser, `/productos/${fx.filas.pA}`)
      const supa = antesApp.producto.filter((i) => i.src.includes('/storage/v1/object/public/fotos-productos/'))
      assert.ok(supa.length >= 2 && supa.every((i) => i.ok), JSON.stringify(antesApp.producto.slice(0, 6)))
      return { producto: supa.length }
    })

    await caso('Copiar con --aplicar en lotes, por el Worker (solo crear), con verificación por lectura byte a byte', async () => {
      const a = herramienta(['copiar', `--manifiesto=${MANIF}`, `--cache=${CACHE}`, `--api=${WORKER}`, `--lectura=${WORKER}`, '--aplicar', '--lote=3'])
      const b = herramienta(['copiar', `--manifiesto=${MANIF}`, `--cache=${CACHE}`, `--api=${WORKER}`, `--lectura=${WORKER}`, '--aplicar', '--lote=50'])
      const m = leerManifiesto()
      const verificadas = m.entradas.filter((e) => e.estado === 'verificada').length
      const noCabe = m.entradas.find((e) => e.origen.ruta === fx.obj.N)
      assert.equal(noCabe.estado, 'error'); assert.match(noCabe.error, /no cabe/)
      assert.equal(verificadas, m.entradas.length - 1, JSON.stringify(m.entradas.filter((e) => e.estado !== 'verificada').map((e) => [e.origen.ruta, e.estado, e.error])))
      assert.equal(await inventarioR2(admin), 2 * verificadas, 'exactamente 2 objetos (m, g) por entrada verificada; nada de la que no cabe')
      return { lote1: a.verificadas, lote2: b.verificadas, objetosR2: 2 * verificadas, errorEsperado: noCabe.error }
    })

    await caso('Reanudación: una entrada «perdida» tras subir (estado retrocedido) se re-sube con 200 «reanudado», sin duplicar', async () => {
      const m = leerManifiesto(); const i = m.entradas.findIndex((e) => e.estado === 'verificada'); m.entradas[i].estado = 'planificada'; writeFileSync(MANIF, JSON.stringify(m))
      const r = herramienta(['copiar', `--manifiesto=${MANIF}`, `--cache=${CACHE}`, `--api=${WORKER}`, `--lectura=${WORKER}`, '--aplicar'])
      assert.equal(r.reanudadas, 2); assert.equal(r.subidas, 0); assert.equal(leerManifiesto().entradas[i].estado, 'verificada')
      assert.equal(await inventarioR2(admin), 2 * leerManifiesto().entradas.filter((e) => e.estado === 'verificada').length)
      return r
    })

    await caso('Reanudación por OTRA administradora: el Worker responde 409 y la herramienta acepta la copia solo porque el SHA-256 coincide', async () => {
      const m = leerManifiesto(); const i = m.entradas.findLastIndex((e) => e.estado === 'verificada'); m.entradas[i].estado = 'planificada'; writeFileSync(MANIF, JSON.stringify(m))
      const r = herramienta(['copiar', `--manifiesto=${MANIF}`, `--cache=${CACHE}`, `--api=${WORKER}`, `--lectura=${WORKER}`, '--aplicar'], { cuenta: CUENTAS.adminB })
      assert.equal(r.existentesPropias, 2); assert.equal(r.subidas, 0); assert.equal(leerManifiesto().entradas[i].estado, 'verificada')
      return r
    })

    await caso('Contenido distinto bajo el mismo id (409 con otro SHA-256) → error de conflicto, sin sobrescribir ni actualizar referencias', async () => {
      const m = leerManifiesto(); const [i, j] = m.entradas.map((e, k) => (e.estado === 'verificada' ? k : -1)).filter((k) => k >= 0)
      const e = m.entradas[i]
      const copia = JSON.parse(JSON.stringify(e)); copia.estado = 'planificada'
      // Simula variantes regeneradas distintas de lo ya subido: la caché y el SHA esperado pasan a ser otros bytes válidos.
      const otra = join(CACHE, `${e.id}-m.webp`); const original = readFileSync(otra)
      writeFileSync(otra, readFileSync(join(CACHE, `${m.entradas[j].id}-m.webp`)))
      copia.variantes.m.sha256 = sha256(readFileSync(otra)); m.entradas[i] = copia; writeFileSync(MANIF, JSON.stringify(m))
      const antesR2 = await inventarioR2(admin)
      const r = herramienta(['copiar', `--manifiesto=${MANIF}`, `--cache=${CACHE}`, `--api=${WORKER}`, `--lectura=${WORKER}`, '--aplicar'])
      const tras = leerManifiesto().entradas[i]
      assert.equal(tras.estado, 'error'); assert.match(tras.error, /conflicto/)
      assert.equal(await inventarioR2(admin), antesR2, 'nada se sobrescribió ni se añadió')
      // restaurar el estado real (el objeto R2 es el original) para seguir la simulación
      writeFileSync(otra, original); const m2 = leerManifiesto(); m2.entradas[i] = e; writeFileSync(MANIF, JSON.stringify(m2))
      return { errores: r.errores, error: tras.error }
    })

    const conflictoFila = { tabla: 'productos', fila: fx?.filas?.pE }
    await caso('Actualizar en lotes con UPDATE condicional; una fila editada entretanto queda en «conflicto» y no se pisa', async () => {
      const dry = herramienta(['actualizar', `--manifiesto=${MANIF}`])
      assert.equal(dry.simulado, true); assert.equal(huellaPreexistentes(), inicio.huella)
      psql(`update productos set foto_url = '${MARCA}/editada-por-otra-persona.webp' where id = '${fx.filas.pE}'`)
      const lotes = []
      for (let i = 0; i < 10; i++) { const r = herramienta(['actualizar', `--manifiesto=${MANIF}`, '--aplicar', '--lote=3']); lotes.push(r.enEsteLote); if (!r.candidatas || r.enEsteLote === r.candidatas) break }
      const m = leerManifiesto(); const refs = m.entradas.flatMap((e) => e.referencias)
      const conf = refs.find((r) => r.tabla === conflictoFila.tabla && r.fila === fx.filas.pE)
      assert.equal(conf.estado, 'conflicto')
      assert.equal(psql(`select foto_url from productos where id='${fx.filas.pE}'`), `${MARCA}/editada-por-otra-persona.webp`, 'la edición ajena se conserva')
      const deVerificadas = m.entradas.filter((e) => e.estado === 'verificada').flatMap((e) => e.referencias)
      assert.equal(deVerificadas.filter((r) => r.estado === 'actualizada').length, deVerificadas.length - 1)
      const deError = m.entradas.filter((e) => e.estado !== 'verificada').flatMap((e) => e.referencias)
      assert.ok(deError.length >= 1 && deError.every((r) => r.estado === 'pendiente'), 'una copia no verificada nunca cambia referencias')
      assert.equal(psql(`select foto_url from productos where id='${fx.filas.pF}'`), fx.obj.N)
      assert.equal(huellaPreexistentes(), inicio.huella, 'filas preexistentes intactas')
      return { lotes, resumen: m.entradas.flatMap((e) => e.referencias).reduce((a, r) => ({ ...a, [r.estado]: (a[r.estado] ?? 0) + 1 }), {}) }
    })

    await caso('Verificar tras actualizar: referencias = manifiesto, R2 = SHA-256 de las variantes, originales intactos en Supabase', async () => {
      // Sin base de lectura no hay verificación de R2: falla cerrado, sin emitir un «ok».
      const sin = herramienta(['verificar', `--manifiesto=${MANIF}`], { esperarFallo: true })
      assert.equal(sin.estado, 2); assert.match(sin.error, /exige --lectura/)
      const r = herramienta(['verificar', `--manifiesto=${MANIF}`, `--lectura=${WORKER}`, `--salida=${join(TRABAJO, 'verificacion-tras-actualizar.json')}`])
      assert.equal(r.ok, true, JSON.stringify(r.problemas))
      assert.equal(r.cobertura, 'completa'); assert.ok(r.r2Esperados > 0); assert.equal(r.r2Coinciden, r.r2Esperados); assert.equal(r.refsComprobadas, r.refsEsperadas)
      return { ...r, sinLectura: sin.error.trim() }
    })

    await caso('App DESPUÉS: lectura mixta — producto y servicio desde R2 simulado, galería con su URL completa, rota/corrupta sin romper la página', async () => {
      const m = leerManifiesto()
      const prod = await imagenesEn(browser, `/productos/${fx.filas.pA}`)
      const espProd = [esperadoPorRef(m, 'producto_fotos', fx.filas.pfA1, 'foto_url'), esperadoPorRef(m, 'producto_fotos', fx.filas.pfA2, 'foto_url')].map((v) => aUrl(v, 'fotos-productos'))
      for (const u of espProd) assert.ok(prod.some((i) => i.src === u && i.ok), `falta ${u}: ${JSON.stringify(prod.slice(0, 8))}`)
      const serv = await imagenesEn(browser, `/servicios/${fx.filas.sA}`)
      const espServ = aUrl(esperadoPorRef(m, 'servicio_fotos', fx.filas.sfA, 'foto_url'), 'fotos-servicios')
      assert.ok(serv.some((i) => i.src === espServ && i.ok), `servicio: ${JSON.stringify(serv.slice(0, 8))}`)
      const gal = await imagenesEn(browser, '/nosotros', async (p) => { await p.getByRole('button', { name: 'Galería', exact: true }).first().click().catch(() => p.getByText('Galería', { exact: true }).first().click()) })
      const espGal = ['antes_url', 'despues_url'].map((c) => esperadoPorRef(m, 'galeria_web', fx.filas.g1, c))
      for (const u of espGal) assert.ok(gal.some((i) => i.src === u && i.ok), `galería ${u}: ${JSON.stringify(gal.filter((i) => i.src.includes(MARCA) || i.src.includes(WORKER)))}`)
      const rota = await imagenesEn(browser, `/productos/${fx.filas.pC}`)
      return { productoR2: espProd.filter((u) => u.startsWith(WORKER)).length, servicioR2: espServ.startsWith(WORKER), galeriaR2: espGal.filter((u) => u.startsWith(WORKER)).length, imagenesProductoRota: rota.length }
    })

    await caso('Revertir: vuelve cada referencia a su valor original (condicional); una editada después de migrar no se pisa', async () => {
      psql(`update servicios set foto_url = '${MARCA}/cambiada-tras-migrar.webp' where id = '${fx.filas.sA}'`)
      for (let i = 0; i < 10; i++) { const r = herramienta(['revertir', `--manifiesto=${MANIF}`, '--aplicar', '--lote=4']); if (!r.candidatas || r.enEsteLote === r.candidatas) break }
      const m = leerManifiesto(); const refs = m.entradas.flatMap((e) => e.referencias)
      const confRev = refs.find((r) => r.tabla === 'servicios' && r.fila === fx.filas.sA)
      assert.equal(confRev.estado, 'conflicto-reversion')
      for (const r of refs.filter((x) => x.estado === 'revertida')) {
        const actual = psql(`select ${r.columna} from ${r.tabla} where id='${r.fila}'`)
        assert.equal(actual, r.original, `${r.tabla}/${r.fila}`)
      }
      const v = herramienta(['verificar', `--manifiesto=${MANIF}`, `--lectura=${WORKER}`, `--salida=${join(TRABAJO, 'verificacion-tras-revertir.json')}`])
      assert.equal(v.ok, true, JSON.stringify(v.problemas))
      assert.equal(huellaPreexistentes(), inicio.huella)
      return { porEstado: refs.reduce((a, r) => ({ ...a, [r.estado]: (a[r.estado] ?? 0) + 1 }), {}), objetosR2Conservados: await inventarioR2(admin) }
    })

    await caso('App tras revertir: las fotos vuelven a leerse de Supabase (los originales nunca se tocaron)', async () => {
      const prod = await imagenesEn(browser, `/productos/${fx.filas.pA}`)
      const supa = prod.filter((i) => i.src.includes('/storage/v1/object/public/fotos-productos/'))
      assert.ok(supa.length >= 2 && supa.every((i) => i.ok)); assert.equal(prod.filter((i) => i.src.startsWith(WORKER)).length, 0)
      return { supabase: supa.length }
    })
  } finally {
    try { await browser?.close() } catch {}
    for (const p of [app, worker]) { try { p?.kill() } catch {} }
    if (CONSERVAR) console.log('--conservar: fixtures y R2 simulado se dejan para inspección')
    else {
      const limpio = await limpiarFixtures(admin, fx).catch((e) => [`ERROR limpieza: ${e.message}`])
      await ESPERA(1500); rmSync(R2SIM, { recursive: true, force: true })
      casos.push({ nombre: 'Limpieza de fixtures y R2 simulado', ok: !limpio.some((x) => String(x).startsWith('ERROR')), detalle: limpio })
    }
    const fin = { huella: huellaPreexistentes(), auditoria: Number(psql('select count(*) from auditoria')), objetos: Number(psql('select count(*) from storage.objects')) }
    casos.push({ nombre: 'Estado final de Local: valores de medios preexistentes idénticos y objetos de Storage como al inicio', ok: fin.huella === inicio.huella && (CONSERVAR || fin.objetos === inicio.objetos), detalle: { inicio, fin, filasDeAuditoriaNuevas: fin.auditoria - inicio.auditoria } })
    const fallos = casos.filter((c) => !c.ok)
    const informe = { fecha: new Date().toISOString(), entorno: 'Supabase Local 127.0.0.1:54321 + Worker wrangler dev --local (R2 simulado en disco) + app Vite dev; ningún recurso remoto', marca: MARCA, reintentosRed, total: casos.length, fallos: fallos.length, casos, pasos }
    writeFileSync(join(EVIDENCIA, 'simulacion-local.json'), JSON.stringify(informe, null, 1))
    if (existsSync(MANIF)) writeFileSync(join(EVIDENCIA, 'manifiesto-simulacion.json'), readFileSync(MANIF))
    for (const f of ['inventario-dataset.json', 'manifiesto-dataset.json', 'verificacion-tras-actualizar.json', 'verificacion-tras-revertir.json']) if (existsSync(join(TRABAJO, f))) writeFileSync(join(EVIDENCIA, f), readFileSync(join(TRABAJO, f)))
    console.log(`\n${casos.length - fallos.length}/${casos.length} correctos`)
    process.exit(fallos.length ? 1 : 0)
  }
})().catch((e) => { console.error(e); process.exit(2) })
