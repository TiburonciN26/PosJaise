// Fase 10A · V2: regresiones de las herramientas de 10A pedidas en la revisión V1 de Codex (F10A-01 a F10A-04). Solo Local.
//   node scripts/fase10a/probar-herramientas-10a.mjs --cuentas=<json QA> [--app-real=http://127.0.0.1:5401] [--salida=<archivo.json>]
//     [--sin-navegador]  omite los casos que necesitan Chromium (redirección y desvíos en ejecución)
//     [--filtro=<regex>] ejecuta solo los casos cuyo nombre coincide
//
// Del archivo de cuentas usa SOLO correos e ids (para que el preflight los encuentre en el Auth de Local). Las contraseñas se
// sustituyen por otras INVENTADAS en cada ejecución: ninguna contraseña real se escribe nunca en las apps falsas.
//   · F10A-01: las dos herramientas que inician sesión (medir-vitales-10a.cjs y verificar-roles-rutas.cjs) se ejecutan de verdad
//     contra apps FALSAS servidas en loopback y un servidor SEÑUELO que registra todo lo que recibe: app remota, backend ajeno en
//     el bundle, proxy del mismo origen, cuenta ajena, cuenta QA inexistente, login redirigido, desvío de credenciales al enviar el
//     formulario (a otro servidor y por proxy del mismo origen). En todos: código distinto de 0, la contraseña inventada no llega a
//     ningún servidor, ninguna escritura a la app y ninguna asistente provisionada. Control positivo: preflight de la app real.
//   · F10A-02: evaluador con carpeta vacía, productor que falla, carpeta reutilizada, archivo faltante o alterado, productor con
//     código distinto de 0, muestras vacías, escenario omitido, medición declarada incompleta, alcance parcial y ejecución sana.
//   · F10A-03: servidor estático con carpeta vecina de prefijo común, traversal codificado, junction hacia fuera, URI malformada
//     y NUL; controles de assets, HEAD, cabeceras de _headers y fallback de /ventas. También se reproduce el defecto en la V1.
//   · F10A-04: comparación exacta de CLS (0.1, 0.10001, 0.14, 0.149, 0.15, ausente) y mediana con número par de muestras.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cumple, evaluarPresupuestos, formatear } from './lib/evaluar-presupuestos.mjs'

const require = createRequire(import.meta.url)
const G = require('./lib/guardas-local-10a.cjs')
const { mediana, validarMuestras } = require('./lib/estadistica.cjs')
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d
const SALIDA = arg('salida'), APP_REAL = arg('app-real'), SIN_NAVEGADOR = process.argv.includes('--sin-navegador')
if (!arg('cuentas')) { console.error('uso: --cuentas=<json QA> [--app-real=<url>] [--salida=<archivo>] [--sin-navegador]'); process.exit(2) }
const reales = JSON.parse(readFileSync(arg('cuentas'), 'utf8'))
const CLAVE = `clave-inventada-${randomBytes(6).toString('hex')}` // la única «contraseña» que verán las apps falsas
const identidad = (k) => ({ email: reales[k].email, id: reales[k].id, password: CLAVE })
const TMP = mkdtempSync(join(tmpdir(), 'qa-f10a-herramientas-'))
const S = (f) => join(RAIZ, 'scripts', f)

const casos = []
const FILTRO = arg('filtro') && new RegExp(arg('filtro'))
async function caso(nombre, fn) {
  if (FILTRO && !FILTRO.test(nombre)) return
  const t0 = Date.now()
  try { const detalle = await fn(); casos.push({ nombre, ok: true, ms: Date.now() - t0, detalle }); console.log(`OK    ${nombre}`) } catch (e) {
    const d = String(e.message).split('\n').filter(Boolean).slice(0, 6).join(' | ').slice(0, 900)
    casos.push({ nombre, ok: false, ms: Date.now() - t0, error: d }); console.log(`FALLA ${nombre}\n      ${d}`)
  }
}

// ---------------- utilidades ----------------
/** Servidor HTTP en loopback que registra cada petición (método, ruta y cuerpo) y cada intento de WebSocket. */
function servidor(manejar) {
  return new Promise((ok) => {
    const peticiones = []
    const srv = http.createServer((req, res) => {
      let cuerpo = ''
      req.on('data', (c) => { cuerpo += c })
      req.on('end', () => { peticiones.push({ metodo: req.method, url: req.url, cuerpo }); manejar(req, res) })
    })
    srv.on('upgrade', (req, socket) => { peticiones.push({ metodo: 'UPGRADE', url: req.url, cuerpo: '' }); socket.destroy() })
    srv.listen(0, '127.0.0.1', () => ok({ puerto: srv.address().port, peticiones, cerrar: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r) }) }))
  })
}
function correr(script, args, limiteMs = 600000) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [script, ...args], { cwd: RAIZ })
    let salida = ''
    p.stdout.on('data', (x) => { salida += x }); p.stderr.on('data', (x) => { salida += x })
    const t = setTimeout(() => { salida += '\n[prueba] TIEMPO AGOTADO'; p.kill() }, limiteMs)
    p.on('close', (codigo) => { clearTimeout(t); ok({ codigo, salida }) })
  })
}
const psql = (sql) => execFileSync('docker', ['exec', '-i', 'supabase_db_WedJaiseReact', 'psql', '-U', 'postgres', '-d', 'postgres', '-At'], { input: `begin read only; ${sql} rollback;`, encoding: 'utf8' }).split('\n').find((l) => /^\d/.test(l)).trim()
const asistentesTemporales = () => psql("select (select count(*) from auth.users where email like 'qa-f10a-asistente-%') || '|' || (select count(*) from usuarios where email like 'qa-f10a-asistente-%');")
const escribirJson = (nombre, datos) => { const f = join(TMP, nombre); writeFileSync(f, JSON.stringify(datos)); return f }
const sha256 = (b) => createHash('sha256').update(b).digest('hex')

// ---------------- app falsa ----------------
// Bundle mínimo con la MISMA forma compilada de src/lib/supabase.js (`X=`url`,Y=X.startsWith(`/`)?…`). `backend` decide qué URL
// declara; `desvio` qué hace el formulario al enviarse: nada, POST a otro servidor (+ WebSocket) o POST por proxy del mismo origen.
function bundleFalso({ backend, desvio, puertoSenuelo }) {
  const destino = desvio === 'senuelo' ? `'http://127.0.0.1:'+${puertoSenuelo}+'/token'` : `'/auth/v1/token'`
  return `var u=\`${backend}\`,s=u.startsWith(\`/\`)?location.origin+u:u;window.__backend=s;
document.addEventListener('DOMContentLoaded',()=>{const f=document.querySelector('form');f&&f.addEventListener('submit',(e)=>{e.preventDefault();
${desvio ? `const d=JSON.stringify({e:document.querySelector('#email').value,p:document.querySelector('#password').value});
fetch(${destino},{method:'POST',body:d}).catch(()=>{});
${desvio === 'senuelo' ? `try{new WebSocket('ws://127.0.0.1:'+${puertoSenuelo}+'/ws')}catch(x){}` : ''}` : ''}
setTimeout(()=>history.pushState({},'','/inicio'),400)})});`
}
const HTML_FALSO = '<!doctype html><html><head><meta charset="utf-8"><title>App falsa QA</title></head><body><form><input id="email"><input id="password" type="password"><button type="submit">Entrar</button></form><main>Contenido de prueba de una app falsa servida en loopback para QA</main><script type="module" src="/assets/index-falso.js"></script></body></html>'
async function appFalsa(opciones) {
  return servidor((req, res) => {
    const ruta = new URL(req.url, 'http://x').pathname
    if (opciones.redirigirLogin && ruta === '/login') { res.writeHead(302, { Location: `http://127.0.0.1:${opciones.puertoSenuelo}/login` }); return res.end() }
    if (ruta === '/assets/index-falso.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundleFalso(opciones)) }
    if (ruta === '/sw.js' || req.method !== 'GET') { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(HTML_FALSO)
  })
}
const senuelo = () => servidor((req, res) => {
  // Si alguna vez llega aquí, sirve un login propio que enviaría las credenciales a este mismo servidor.
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end('<!doctype html><form method="post" action="/token"><input id="email" name="e"><input id="password" name="p"><button type="submit">Entrar</button></form><main>Señuelo de QA con texto suficiente</main>')
})

// ======================= F10A-04 y estadística =======================
await caso('F10A-04: CLS se compara EXACTO: 0.1 cumple; 0.10001, 0.14, 0.149, 0.15, ausente, texto y NaN no', () => {
  assert.equal(cumple(0.1, 0.1), true)
  for (const v of [0.10001, 0.14, 0.149, 0.15, null, undefined, '0.05', Number.NaN]) assert.equal(cumple(v, 0.1), false, String(v))
  assert.equal(formatear(0.10043430171997483, 'portal-inicio frio · CLS'), '0.1004')
})
await caso('F10A-04: la evaluación de vitales usa la mediana EXACTA de las muestras, no el resumen redondeado', () => {
  const m = (cls) => ({ lcp: 1000, cls, interaccionMs: 50 })
  const P = JSON.parse(readFileSync(S('fase10a/presupuestos-rendimiento.json'), 'utf8'))
  const vit = { completo: true, escenarios: { 'portal-inicio': { frio: { cls: 0.1 }, caliente: { cls: 0.1 }, muestrasFrio: [m(0.1004), m(0.1004), m(0.1004)], muestrasCaliente: [m(0.1), m(0.09), m(0.1)] } }, reducido: {} }
  const { filas } = evaluarPresupuestos({ leer: () => vit, P, grupos: ['vitales'] })
  assert.equal(filas.find((f) => f.que === 'portal-inicio frio · CLS').ok, false, '0.1004 con resumen 0.1 no debe aprobar')
  assert.equal(filas.find((f) => f.que === 'portal-inicio caliente · CLS').ok, true)
})
await caso('Mediana: impar, PAR (media de las dos centrales), sin muestras válidas → null; --muestras validado', () => {
  assert.equal(mediana([3, 1, 2]), 2)
  assert.equal(mediana([4, 1, 3, 2]), 2.5)
  assert.equal(mediana([1, null, 'sin-campo', 3]), 2)
  assert.equal(mediana([]), null)
  assert.equal(mediana(['sin-campo']), null)
  for (const v of ['0', '-1', '2.5', 'x', '10']) assert.throws(() => validarMuestras(v))
  assert.equal(validarMuestras('4'), 4)
})

// ======================= F10A-02: evaluador =======================
const EVAL = S('fase10a/medir-rendimiento-10a.mjs')
const LEGADO = join(RAIZ, '.codex/evidencia-fase10a/rendimiento')
const ARCH = { cupones: 'cupones-reposo.json', busqueda: 'busqueda-amplia.json', iniciales: 'datos-iniciales.json', sesion: 'sesion-larga.json', vitales: 'vitales.json' }
// Ejecución SANA sintética: los datos reales de 10A con vitales que cumplen y un manifiesto con los hashes correctos.
function carpetaSana(nombre, { alcance = Object.keys(ARCH), retocar, retocarTras } = {}) {
  const dir = join(TMP, nombre); mkdirSync(dir, { recursive: true })
  for (const g of alcance) copyFileSync(join(LEGADO, ARCH[g]), join(dir, ARCH[g]))
  if (alcance.includes('vitales')) {
    const v = JSON.parse(readFileSync(join(dir, ARCH.vitales), 'utf8'))
    v.completo = true
    for (const e of Object.values(v.escenarios)) for (const k of ['muestrasFrio', 'muestrasCaliente']) e[k] = e[k].map((x) => ({ ...x, lcp: 1800, cls: 0.02, interaccionMs: typeof x.interaccionMs === 'number' ? 80 : x.interaccionMs }))
    writeFileSync(join(dir, ARCH.vitales), JSON.stringify(v))
  }
  retocar?.(dir)
  const productores = Object.fromEntries(alcance.map((g) => [g, { estado: 0, archivo: ARCH[g], escritoEnEstaEjecucion: true, sha256: sha256(readFileSync(join(dir, ARCH[g]))) }]))
  writeFileSync(join(dir, 'ejecucion.json'), JSON.stringify({ id: randomUUID(), alcance, global: alcance.length === 5, artefactos: { 'http://127.0.0.1:5401': { inicio: 'a'.repeat(64), fin: 'a'.repeat(64) } }, productores }))
  retocarTras?.(dir) // después del manifiesto: simula lo que cambia o desaparece tras la ejecución
  return dir
}
const evaluar = (dir, extra = []) => correr(EVAL, ['--evaluar', `--salida=${dir}`, ...extra], 60000)
const veredicto = (r) => (r.salida.match(/VEREDICTO: (\S+)/) ?? [])[1]

await caso('F10A-02: carpeta sin mediciones → INCOMPLETA y código 1 (la V1 daba «0/0» con código 0)', async () => {
  const dir = join(TMP, 'vacia'); mkdirSync(dir)
  const r = await evaluar(dir)
  assert.equal(r.codigo, 1, r.salida.slice(-300)); assert.equal(veredicto(r), 'INCOMPLETA'); assert.match(r.salida, /sin manifiesto/)
})
await caso('F10A-02: el productor FALLA (archivo de cuentas inexistente) → FALLÓ, INCOMPLETA y código 1', async () => {
  const dir = join(TMP, 'productor-falla')
  const r = await correr(EVAL, ['--solo=vitales', `--cuentas=${join(TMP, 'no-existe.json')}`, `--salida=${dir}`], 120000)
  assert.equal(r.codigo, 1, r.salida.slice(-400)); assert.match(r.salida, /FALLÓ\s+vitales/); assert.equal(veredicto(r), 'INCOMPLETA')
  const m = JSON.parse(readFileSync(join(dir, 'ejecucion.json'), 'utf8'))
  assert.notEqual(m.productores.vitales.estado, 0)
  return { estadoProductor: m.productores.vitales.estado, problemas: r.salida.split('\n').filter((l) => l.startsWith('PROBLEMA')) }
})
await caso('F10A-02: medir en una carpeta con resultados anteriores se rechaza (código 2) y no los reutiliza', async () => {
  const dir = carpetaSana('reutilizada')
  const r = await correr(EVAL, ['--solo=vitales', `--cuentas=${join(TMP, 'no-existe.json')}`, `--salida=${dir}`], 60000)
  assert.equal(r.codigo, 2, r.salida.slice(-300)); assert.match(r.salida, /carpeta nueva o vacía/)
})
await caso('F10A-02: ejecución SANA completa (5 grupos, manifiesto y hashes correctos) → CUMPLE, alcance global y código 0', async () => {
  const r = await evaluar(carpetaSana('sana'))
  assert.equal(r.codigo, 0, r.salida.slice(-500)); assert.equal(veredicto(r), 'CUMPLE'); assert.match(r.salida, /219\/219 presupuestos cumplidos · 0 problemas · alcance global/)
})
for (const [nombre, retocar, patron, tras] of [
  ['archivo faltante', (d) => unlinkSync(join(d, ARCH.sesion)), /sesion: falta sesion-larga\.json/, true],
  ['muestras vacías', (d) => { const f = join(d, ARCH.vitales); const v = JSON.parse(readFileSync(f, 'utf8')); v.escenarios['pos-ventas'].muestrasFrio = []; writeFileSync(f, JSON.stringify(v)) }, /pos-ventas» frio con 0 muestras/],
  ['escenario omitido', (d) => { const f = join(d, ARCH.vitales); const v = JSON.parse(readFileSync(f, 'utf8')); delete v.escenarios['pos-pedidos-web']; writeFileSync(f, JSON.stringify(v)) }, /falta el resultado esperado «pos-pedidos-web»/],
  ['medición declarada incompleta', (d) => { const f = join(d, ARCH.vitales); const v = JSON.parse(readFileSync(f, 'utf8')); v.completo = false; v.errores = ['corte simulado']; writeFileSync(f, JSON.stringify(v)) }, /declaró la medición incompleta/],
  ['resultado de iniciales omitido', (d) => { const f = join(d, ARCH.iniciales); const v = JSON.parse(readFileSync(f, 'utf8')); delete v.resultados['inicio-visitante']; writeFileSync(f, JSON.stringify(v)) }, /falta el resultado esperado «inicio-visitante»/],
]) {
  await caso(`F10A-02: ${nombre} → INCOMPLETA y código 1 aunque las filas presentes cumplan`, async () => {
    // Los retoques de contenido van ANTES del manifiesto (hashes coherentes: solo se detecta el problema de contenido); el archivo
    // faltante desaparece DESPUÉS de la ejecución.
    const r = await evaluar(carpetaSana(nombre.replace(/\s+/g, '-'), tras ? { retocarTras: retocar } : { retocar }))
    assert.equal(r.codigo, 1, r.salida.slice(-400)); assert.equal(veredicto(r), 'INCOMPLETA'); assert.match(r.salida, patron)
  })
}
await caso('F10A-02: un archivo ALTERADO tras la ejecución (resultado antiguo o ajeno) no coincide con el manifiesto → código 1', async () => {
  const dir = carpetaSana('alterado')
  const f = join(dir, ARCH.cupones); const v = JSON.parse(readFileSync(f, 'utf8')); v.fecha = '2020-01-01T00:00:00Z'; writeFileSync(f, JSON.stringify(v))
  const r = await evaluar(dir)
  assert.equal(r.codigo, 1); assert.match(r.salida, /cupones: cupones-reposo\.json no coincide con el registrado/)
})
await caso('F10A-02: un productor con código distinto de 0 en el manifiesto → código 1 aunque su archivo cumpla', async () => {
  const dir = carpetaSana('productor-no-cero')
  const m = JSON.parse(readFileSync(join(dir, 'ejecucion.json'), 'utf8')); m.productores.busqueda.estado = 1; writeFileSync(join(dir, 'ejecucion.json'), JSON.stringify(m))
  const r = await evaluar(dir)
  assert.equal(r.codigo, 1); assert.match(r.salida, /busqueda: el medidor terminó con código 1/)
})
await caso('F10A-02: --solo evalúa un alcance menor y lo declara PARCIAL (no es el cierre global)', async () => {
  const r = await evaluar(carpetaSana('parcial', { alcance: ['vitales'] }), ['--solo=vitales'])
  assert.equal(r.codigo, 0, r.salida.slice(-300)); assert.match(r.salida, /alcance PARCIAL/)
  const r2 = await evaluar(carpetaSana('parcial-2', { alcance: ['vitales'] }))
  assert.equal(r2.codigo, 1, 'sin --solo, una ejecución parcial no puede presentarse como global'); assert.match(r2.salida, /no forma parte de la ejecución/)
})
await caso('F10A-02/04: la evidencia V1 reevaluada da 18/219 incumplimientos y queda INCOMPLETA por no tener manifiesto', async () => {
  const dir = join(TMP, 'legado-v1'); mkdirSync(dir)
  for (const f of Object.values(ARCH)) copyFileSync(join(LEGADO, f), join(dir, f))
  const r = await evaluar(dir)
  assert.equal(r.codigo, 1); assert.match(r.salida, /201\/219 presupuestos cumplidos/); assert.equal(veredicto(r), 'INCOMPLETA')
  return { incumplimientos: r.salida.split('\n').filter((l) => l.startsWith('NO CUMPLE')).length }
})

// ======================= F10A-03: servidor estático =======================
async function probarServidor(script, etiqueta) {
  const base = join(TMP, `srv-${etiqueta}`)
  const raiz = join(base, 'servidor-fixture'), vecina = join(base, 'servidor-fixture-ajeno'), fuera = join(base, 'fuera')
  for (const d of [join(raiz, 'assets'), vecina, fuera]) mkdirSync(d, { recursive: true })
  writeFileSync(join(raiz, 'index.html'), '<!doctype html><title>indice QA</title>')
  writeFileSync(join(raiz, 'assets', 'app-qa.js'), 'console.log("asset QA")')
  writeFileSync(join(raiz, '_headers'), '/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n')
  const MARCA = `MARCA-VECINA-${randomBytes(4).toString('hex')}`
  writeFileSync(join(vecina, 'marca.txt'), MARCA); writeFileSync(join(fuera, 'marca.txt'), MARCA)
  let enlace = false
  try { symlinkSync(fuera, join(raiz, 'enlace'), 'junction'); enlace = true } catch {}
  const puerto = 20000 + Math.floor(Math.random() * 20000)
  const p = spawn(process.execPath, [script, raiz, String(puerto)], { cwd: RAIZ })
  await new Promise((ok, mal) => { let o = ''; p.stdout.on('data', (x) => { o += x; if (o.includes('servir-como-pages')) ok() }); setTimeout(() => mal(new Error('el servidor no arrancó')), 8000) })
  // http.request con la ruta CRUDA (fetch/URL normalizarían %2e%2e antes de enviarla).
  const pedir = (ruta, metodo = 'GET') => new Promise((ok) => {
    const q = http.request({ host: '127.0.0.1', port: puerto, path: ruta, method: metodo }, (res) => { let c = ''; res.on('data', (x) => { c += x }); res.on('end', () => ok({ estado: res.statusCode, cuerpo: c, cab: res.headers })) })
    q.on('error', (e) => ok({ estado: 0, cuerpo: String(e.message), cab: {} })); q.end()
  })
  const r = {}
  for (const [k, ruta] of Object.entries({ prefijo: '/..%2fservidor-fixture-ajeno%2fmarca.txt', puntos: '/%2e%2e/servidor-fixture-ajeno/marca.txt', barraInvertida: '/..%5cservidor-fixture-ajeno%5cmarca.txt', enlaceArchivo: '/enlace/marca.txt', enlaceDir: '/enlace/', malformada: '/%E0%A4%A', nul: '/assets%00/app-qa.js', asset: '/assets/app-qa.js', ventas: '/ventas', raiz: '/' })) r[k] = await pedir(ruta)
  r.head = await pedir('/assets/app-qa.js', 'HEAD')
  p.kill()
  return { r, MARCA, enlace }
}
await caso('F10A-03: servidor V2 — prefijo vecino, traversal codificado, junction, URI malformada y NUL no salen de la carpeta; assets, HEAD, _headers y fallback intactos', async () => {
  const { r, MARCA, enlace } = await probarServidor(S('fase10a/servir-como-pages.cjs'), 'v2')
  for (const k of ['prefijo', 'puntos', 'barraInvertida', 'enlaceArchivo', 'enlaceDir', 'malformada', 'nul']) assert.ok(!r[k].cuerpo.includes(MARCA), `${k} devolvió la marca de fuera`)
  assert.equal(r.prefijo.estado, 400); assert.equal(r.barraInvertida.estado, 400); assert.equal(r.malformada.estado, 400); assert.equal(r.nul.estado, 400)
  if (enlace) { assert.equal(r.enlaceArchivo.estado, 403); assert.equal(r.enlaceDir.estado, 403) }
  assert.equal(r.asset.estado, 200); assert.match(r.asset.cuerpo, /asset QA/); assert.match(r.asset.cab['cache-control'], /immutable/)
  assert.equal(r.head.estado, 200); assert.equal(r.head.cuerpo, '')
  for (const k of ['ventas', 'raiz', 'puntos']) { assert.equal(r[k].estado, 200, k); assert.match(r[k].cuerpo, /indice QA/, k) }
  return { estados: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.estado])), junctionProbada: enlace }
})
await caso('F10A-03: reproducción del defecto en la V1 (copia de rollback): el prefijo vecino SÍ devolvía la marca', async () => {
  const v1 = join(RAIZ, '.codex/evidencia-fase10a-v2/rollback/v1/servir-como-pages.cjs')
  const { r, MARCA } = await probarServidor(v1, 'v1')
  assert.equal(r.prefijo.estado, 200); assert.equal(r.prefijo.cuerpo, MARCA)
  return { v1: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.estado])) }
})

// ======================= F10A-01: guardas =======================
await caso('F10A-01: validación de --app (remota, LAN, el propio Supabase, credenciales, query) y de cuentas (ajena, sin id)', () => {
  for (const a of ['https://feat-cloudflare-pages.pos-jaise.pages.dev', 'http://192.168.1.5:5401', 'http://127.0.0.1:54321', 'http://u:p@127.0.0.1:5401', 'http://127.0.0.1:5401/?x=1', 'http://127.0.0.1', 'file:///C:/dist/index.html']) assert.throws(() => G.validarApp(a), undefined, a)
  assert.equal(G.validarApp('http://127.0.0.1:5404/PosJaise/').app, 'http://127.0.0.1:5404/PosJaise')
  assert.throws(() => G.validarCuentas({ admin: { email: 'dueña@gmail.com', id: randomUUID(), password: 'x' } }, ['admin']), /no es una cuenta QA/)
  assert.throws(() => G.validarCuentas({ admin: { email: 'qa-x@test.local', password: 'x' } }, ['admin']), /id/)
  assert.throws(() => G.validarCuentas({}, ['admin']), /no es una cuenta QA/)
})
await caso('F10A-01: backend efectivo del bundle — Local exacto pasa; otro puerto, relativo/proxy, Supabase remoto, dos configuraciones o ninguna se rechazan', () => {
  const mod = (url) => ({ url: 'http://127.0.0.1:1/assets/x.js', texto: `var zi=\`${url}\`,Bi=zi.startsWith(\`/\`)?\`\${window.location.origin}\${zi}\`:zi,` })
  G.exigirBackendLocal(G.backendDeModulos([mod('http://127.0.0.1:54321')]))
  for (const mods of [[mod('http://127.0.0.1:55555')], [mod('/__supabase')], [mod('https://abcd.supabase.co')], [mod('http://127.0.0.1:54321'), mod('http://127.0.0.1:55555')], [{ url: 'x', texto: 'nada' }], [mod('http://127.0.0.1:54321'), { url: 'y', texto: 'fetch("https://cmkelllerzjqjbsqsylc.supabase.co/rest/v1")' }]]) {
    assert.throws(() => G.exigirBackendLocal(G.backendDeModulos(mods)))
  }
})
await caso('F10A-01: clasificación de peticiones del navegador (app solo lectura sin rutas de API; Supabase Local; terceros GET neutralizados; lo demás prohibido)', () => {
  const app = 'http://127.0.0.1:5401'
  const tabla = [
    ['http://127.0.0.1:5401/assets/a.js', 'GET', 'permitida'], ['http://127.0.0.1:5401/ventas', 'GET', 'permitida'],
    ['http://127.0.0.1:5401/auth/v1/token', 'POST', 'prohibida'], ['http://127.0.0.1:5401/__supabase/rest/v1/x', 'GET', 'prohibida'], ['http://127.0.0.1:5401/x', 'POST', 'prohibida'],
    ['http://127.0.0.1:54321/auth/v1/token?grant_type=password', 'POST', 'permitida'], ['http://127.0.0.1:54321/rest/v1/productos', 'GET', 'permitida'],
    ['https://fonts.googleapis.com/css2?family=Inter', 'GET', 'neutralizada'], ['https://fonts.gstatic.com/x.woff2', 'GET', 'neutralizada'],
    ['http://127.0.0.1:55555/token', 'POST', 'prohibida'], ['http://127.0.0.1:55555/login', 'GET', 'prohibida'], ['http://localhost:54321/rest/v1/x', 'GET', 'prohibida'],
    ['https://cmkelllerzjqjbsqsylc.supabase.co/rest/v1/x', 'GET', 'prohibida'], ['https://api.culqi.com/v2/tokens', 'GET', 'prohibida'], ['https://ejemplo.com/beacon', 'POST', 'prohibida'],
    ['data:image/png;base64,AA', 'GET', 'permitida'],
  ]
  for (const [u, m, esperado] of tabla) assert.equal(G.clasificarPeticion(u, m, app), esperado, `${m} ${u}`)
})

if (APP_REAL) {
  await caso('F10A-01: CONTROL POSITIVO — preflight de la app real (bundle servido con backend Local exacto y cuentas QA de Local)', async () => {
    const pre = await G.preflightLocal({ app: APP_REAL, cuentas: { admin: identidad('admin'), cajera: identidad('cajera'), clienteA: identidad('clienteA') }, claves: ['admin', 'cajera', 'clienteA'] })
    assert.equal(pre.api, G.API_LOCAL); assert.ok(pre.modulosRevisados > 10)
    return pre
  })
}

// Casos de extremo a extremo con las dos herramientas reales.
const HERRAMIENTAS = [
  ['medir-vitales', S('fase10a/medir-vitales-10a.cjs'), (app, cuentas, n) => [`--app=${app}`, `--cuentas=${cuentas}`, `--salida=${join(TMP, `vitales-${n}.json`)}`, '--muestras=1']],
  ['verificar-roles', S('fase10a/verificar-roles-rutas.cjs'), (app, cuentas, n) => [`--app=${app}`, `--cuentas=${cuentas}`, `--salida=${join(TMP, `roles-${n}.json`)}`]],
]
const cuentasQA = escribirJson('cuentas-qa-inventadas.json', { admin: identidad('admin'), cajera: identidad('cajera'), clienteA: identidad('clienteA') })
const cuentasAjena = escribirJson('cuentas-ajena.json', { admin: { ...identidad('admin'), email: 'duena.del.salon@gmail.com' }, cajera: identidad('cajera'), clienteA: identidad('clienteA') })
const cuentasInexistente = escribirJson('cuentas-inexistente.json', { admin: { email: `qa-f10a-inexistente-${randomBytes(3).toString('hex')}@test.local`, id: randomUUID(), password: CLAVE }, cajera: identidad('cajera'), clienteA: identidad('clienteA') })
const ESCENARIOS = [
  // [nombre, opciones de la app falsa (null = app remota), cuentas, motivo esperado, necesita navegador]
  ['app remota', null, cuentasQA, /debe ser una app local/, false],
  ['app local con backend ajeno en el bundle', { backend: 'SENUELO' }, cuentasQA, /backend efectivo del bundle no es exactamente/, false],
  ['app local con proxy del mismo origen (/__supabase)', { backend: '/__supabase' }, cuentasQA, /relativo \/__supabase/, false],
  ['cuenta ajena al conjunto QA', { backend: G.API_LOCAL }, cuentasAjena, /no es una cuenta QA ficticia/, false],
  ['cuenta QA que no existe en el Auth de Local', { backend: G.API_LOCAL }, cuentasInexistente, /no existen en el Auth de Local/, false],
  ['login redirigido a otro servidor', { backend: G.API_LOCAL, redirigirLogin: true }, cuentasQA, /la app redirige \/login \(302\)/, true],
  ['credenciales desviadas a otro servidor (y WebSocket) al enviar el login', { backend: G.API_LOCAL, desvio: 'senuelo' }, cuentasQA, /guarda de red/, true],
  ['credenciales desviadas por proxy del mismo origen al enviar el login', { backend: G.API_LOCAL, desvio: 'proxy' }, cuentasQA, /guarda de red/, true],
]
let n = 0
for (const [nombre, opciones, cuentas, motivo, conNavegador] of ESCENARIOS) {
  if (conNavegador && SIN_NAVEGADOR) continue
  for (const [herramienta, script, args] of HERRAMIENTAS) {
    await caso(`F10A-01: ${herramienta} · ${nombre} → se niega; cero credenciales enviadas, cero escrituras a la app y cero provisiones`, async () => {
      n += 1
      const s = await senuelo()
      const app = opciones ? await appFalsa({ ...opciones, backend: opciones.backend === 'SENUELO' ? `http://127.0.0.1:${s.puerto}` : opciones.backend, puertoSenuelo: s.puerto }) : null
      const antes = asistentesTemporales()
      try {
        const r = await correr(script, args(app ? `http://127.0.0.1:${app.puerto}` : 'https://feat-cloudflare-pages.pos-jaise.pages.dev', cuentas, n), 600000)
        const despues = asistentesTemporales()
        const todo = [...s.peticiones, ...(app?.peticiones ?? [])]
        assert.notEqual(r.codigo, 0, `debía negarse: ${r.salida.slice(-300)}`)
        assert.match(r.salida, motivo, `motivo inesperado: ${r.salida.slice(-400)}`)
        assert.ok(!todo.some((p) => p.url.includes(CLAVE) || p.cuerpo.includes(CLAVE)), 'la contraseña inventada llegó a un servidor')
        assert.ok(!todo.some((p) => p.url.includes(encodeURIComponent(reales.admin.email)) || p.cuerpo.includes(reales.admin.email)), 'un correo QA llegó a un servidor')
        assert.deepEqual(s.peticiones, [], 'el señuelo recibió alguna petición (ni siquiera un GET debe salir hacia él)')
        assert.deepEqual((app?.peticiones ?? []).filter((p) => p.metodo !== 'GET'), [], 'la app falsa recibió escrituras')
        assert.equal(despues, antes, 'se provisionó (o quedó) una asistente temporal')
        return { codigo: r.codigo, cola: r.salida.trim().split('\n').filter((l) => !/^\s+at /.test(l)).slice(-4).map((l) => l.slice(0, 220)), peticionesAlSenuelo: s.peticiones.map((p) => `${p.metodo} ${p.url}`), escriturasALaApp: 0, asistentesTemporales: despues, motivo: (r.salida.match(motivo) ?? [])[0] }
      } finally {
        await s.cerrar(); await app?.cerrar()
      }
    })
  }
}

rmSync(TMP, { recursive: true, force: true })
const fallos = casos.filter((c) => !c.ok)
if (SALIDA) writeFileSync(SALIDA, JSON.stringify({ fecha: new Date().toISOString(), appReal: APP_REAL ?? null, sinNavegador: SIN_NAVEGADOR, total: casos.length, fallos: fallos.length, casos }, null, 1))
console.log(`\n${casos.length - fallos.length}/${casos.length} correctos`)
process.exitCode = fallos.length ? 1 : 0 // no process.exit(): ver medir-rendimiento-10a.mjs
