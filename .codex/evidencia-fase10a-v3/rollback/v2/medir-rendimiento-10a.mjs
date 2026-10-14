// Fase 10A · pruebas de rendimiento reproducibles con PRESUPUESTOS (scripts/fase10a/presupuestos-rendimiento.json).
// Ejecuta los medidores existentes de cada fase y el de vitales de 10A, y compara cada cifra con su presupuesto. Solo lecturas en
// el negocio (cupones en reposo crea y borra su propia cuenta ficticia en Local, como en la Fase 1).
//
//   node scripts/fase10a/medir-rendimiento-10a.mjs --cuentas=<json> --salida=<carpeta NUEVA o vacía>
//     [--app-cf=http://127.0.0.1:5401] [--app-gh-puerto=5402] [--app-dev=http://127.0.0.1:5173] [--app-vitales=http://127.0.0.1:5403]
//     [--solo=cupones,busqueda,...]
//   node scripts/fase10a/medir-rendimiento-10a.mjs --evaluar --salida=<carpeta de una ejecución> [--solo=...]
//     (no mide: vuelve a evaluar las salidas de esa ejecución, comprobando su identidad con el manifiesto)
// Escenarios: cupones (reposo), busqueda (catálogos con búsqueda amplia), iniciales (datos iniciales de listas, Inicio y
// Recompensas), sesion (sesión larga en 27 rutas), vitales (LCP/CLS/interacción frío y caliente + movimiento reducido).
// No ejecutar en paralelo con otras pruebas: las cifras de laboratorio dependen de la carga de la máquina.
//
// V2 (F10A-02 de Codex): el resultado ya no puede ser «0/0 cumplidos» con código 0.
//   · Cada medición escribe en una carpeta nueva un MANIFIESTO (`ejecucion.json`): id de ejecución, alcance, artefacto de cada app
//     (SHA-256 de su index.html al empezar y al terminar) y, por productor, su código de salida y el SHA-256 de su archivo, que
//     debe haberse escrito durante ESTA ejecución.
//   · La evaluación exige el manifiesto, que cada productor del alcance terminara con 0, que cada archivo coincida con su hash y
//     que estén todos los resultados esperados (lib/evaluar-presupuestos.mjs). Cualquier problema → código 1, aunque las filas
//     presentes cumplan.
//   · `--solo` evalúa un alcance menor y lo declara PARCIAL; no es el cierre global.
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ARCHIVOS, GRUPOS, evaluarPresupuestos, formatear } from './lib/evaluar-presupuestos.mjs'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d
const CUENTAS = arg('cuentas'), SALIDA = arg('salida') && resolve(arg('salida'))
const APP_CF = arg('app-cf', 'http://127.0.0.1:5401'), GH = arg('app-gh-puerto', '5402'), APP_DEV = arg('app-dev', 'http://127.0.0.1:5173')
// Vitales: conviene servir el build con scripts/fase10a/servir-como-pages.cjs (cabeceras de _headers, Brotli, 304) para que
// la carga caliente use la caché como en Pages; con servir-dist-base.cjs (sin cabeceras de caché) caliente ≈ frío.
const APP_VITALES = arg('app-vitales', APP_CF)
const SOLO = arg('solo')?.split(',').filter(Boolean), SOLO_EVALUAR = process.argv.includes('--evaluar')
const salir = (codigo, mensaje) => { console.error(mensaje); process.exit(codigo) }
if (!SALIDA) salir(2, 'uso: --salida=<carpeta> (--cuentas=<json> para medir, o --evaluar)')
if (SOLO && (!SOLO.length || SOLO.some((g) => !GRUPOS.includes(g)))) salir(2, `--solo admite: ${GRUPOS.join(', ')}`)
const ALCANCE = SOLO ?? GRUPOS
const P = JSON.parse(readFileSync(join(RAIZ, 'scripts/fase10a/presupuestos-rendimiento.json'), 'utf8'))
const S = (f) => join(RAIZ, 'scripts', f), ev = (f) => join(SALIDA, f)
const MANIFIESTO = ev('ejecucion.json')
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

const MEDIDORES = {
  cupones: [S('medir-cupones-reposo.cjs'), 'f10a', GH, ev(ARCHIVOS.cupones)],
  busqueda: [S('medir-catalogos-fase4.cjs'), '--etiqueta=busqueda-amplia', `--salida=${SALIDA}`, `--app=${APP_DEV}`, '--muestras=3'],
  iniciales: [S('medir-fase5.cjs'), `--app=${APP_CF}`, `--cuentas=${CUENTAS}`, '--etiqueta=f10a', `--salida=${ev(ARCHIVOS.iniciales)}`, '--repeticiones=3'],
  sesion: [S('medir-fase6.cjs'), `--app=${APP_CF}`, `--cuentas=${CUENTAS}`, '--etiqueta=f10a', `--salida=${ev(ARCHIVOS.sesion)}`, '--ciclos=3'],
  vitales: [S('fase10a/medir-vitales-10a.cjs'), `--app=${APP_VITALES}`, `--cuentas=${CUENTAS}`, `--salida=${ev(ARCHIVOS.vitales)}`, '--muestras=3'],
}
const APPS_DE = { cupones: [`http://127.0.0.1:${GH}/PosJaise`], busqueda: [APP_DEV], iniciales: [APP_CF], sesion: [APP_CF], vitales: [APP_VITALES] }
const correr = (cmd, id) => new Promise((ok) => {
  const t0 = Date.now(), p = spawn(process.execPath, cmd, { cwd: RAIZ }); let out = ''
  p.stdout.on('data', (x) => { out += x }); p.stderr.on('data', (x) => { out += x })
  p.on('close', (estado) => { writeFileSync(ev(`${id}.log`), out); ok({ estado, ms: Date.now() - t0 }) })
})
// Identidad del artefacto servido: SHA-256 del index.html (null si la app no responde).
async function huella(app) {
  try {
    const r = await fetch(`${app.replace(/\/+$/, '')}/`, { redirect: 'error', signal: AbortSignal.timeout(10000) })
    return r.ok ? sha256(Buffer.from(await r.arrayBuffer())) : null
  } catch { return null }
}

// ---------------- medición ----------------
if (!SOLO_EVALUAR) {
  if (!CUENTAS) salir(2, 'uso: --cuentas=<json> --salida=<carpeta nueva> [...]')
  mkdirSync(SALIDA, { recursive: true })
  // Carpeta nueva o vacía: así ningún archivo de una ejecución anterior puede pasar por resultado de esta.
  if (readdirSync(SALIDA).length) salir(2, `--salida debe ser una carpeta nueva o vacía (${SALIDA} ya tiene archivos): no se reutilizan resultados anteriores`)
  const apps = [...new Set(ALCANCE.flatMap((g) => APPS_DE[g]))]
  const m = { id: randomUUID(), inicio: new Date().toISOString(), alcance: ALCANCE, global: ALCANCE.length === GRUPOS.length, artefactos: {}, productores: {} }
  for (const a of apps) m.artefactos[a] = { inicio: await huella(a), fin: null }
  writeFileSync(MANIFIESTO, JSON.stringify(m, null, 1))
  for (const id of ALCANCE) {
    const t0 = Date.now()
    const r = await correr(MEDIDORES[id], id)
    const f = ev(ARCHIVOS[id])
    const escrito = existsSync(f) && statSync(f).mtimeMs >= t0 - 1000
    m.productores[id] = { estado: r.estado, ms: r.ms, archivo: ARCHIVOS[id], escritoEnEstaEjecucion: escrito, sha256: escrito ? sha256(readFileSync(f)) : null }
    writeFileSync(MANIFIESTO, JSON.stringify(m, null, 1))
    console.log(`${r.estado === 0 && escrito ? 'medido' : 'FALLÓ '} ${id.padEnd(10)} ${(r.ms / 1000).toFixed(0)} s${escrito ? '' : ' (sin archivo de esta ejecución)'}`)
  }
  for (const a of apps) m.artefactos[a].fin = await huella(a)
  m.fin = new Date().toISOString()
  writeFileSync(MANIFIESTO, JSON.stringify(m, null, 1))
}

// ---------------- evaluación ----------------
const problemas = []
let manifiesto = null
try { manifiesto = existsSync(MANIFIESTO) ? JSON.parse(readFileSync(MANIFIESTO, 'utf8')) : null } catch { problemas.push('ejecucion.json ilegible') }
if (!manifiesto) problemas.push('sin manifiesto de ejecución (ejecucion.json): la identidad de los resultados no está verificada')
else {
  for (const g of ALCANCE) {
    const p = manifiesto.productores?.[g]
    if (!(manifiesto.alcance ?? []).includes(g) || !p) { problemas.push(`${g}: no forma parte de la ejecución ${manifiesto.id}`); continue }
    if (p.estado !== 0) problemas.push(`${g}: el medidor terminó con código ${p.estado}`)
    if (!p.escritoEnEstaEjecucion) problemas.push(`${g}: el medidor no escribió su archivo en esta ejecución`)
    else if (!existsSync(ev(p.archivo)) || sha256(readFileSync(ev(p.archivo))) !== p.sha256) problemas.push(`${g}: ${p.archivo} no coincide con el registrado en el manifiesto`)
  }
  // Los artefactos del manifiesto son los de su propio alcance.
  for (const [a, h] of Object.entries(manifiesto.artefactos ?? {})) {
    if (!h.inicio) problemas.push(`artefacto ${a}: no respondió al empezar`)
    else if (h.fin && h.fin !== h.inicio) problemas.push(`artefacto ${a}: cambió durante la ejecución`)
  }
}
const leer = (f) => (existsSync(ev(f)) ? JSON.parse(readFileSync(ev(f), 'utf8')) : null)
const r = evaluarPresupuestos({ leer, P, grupos: ALCANCE })
problemas.push(...r.problemas)
const filas = r.filas
const fallos = filas.filter((f) => !f.ok)
const global = ALCANCE.length === GRUPOS.length
const veredicto = problemas.length ? 'INCOMPLETA' : fallos.length ? 'NO CUMPLE' : 'CUMPLE'
const resultado = { fecha: new Date().toISOString(), presupuestos: 'scripts/fase10a/presupuestos-rendimiento.json', ejecucion: manifiesto?.id ?? null, alcance: ALCANCE, global, veredicto, total: filas.length, fallos: fallos.length, problemas, filas }
writeFileSync(ev('presupuestos-resultado.json'), JSON.stringify(resultado, null, 1))
const cabecera = [
  `Ejecución: ${manifiesto?.id ?? 'sin manifiesto'} · alcance: ${global ? 'global' : `PARCIAL (${ALCANCE.join(', ')})`} · veredicto: **${veredicto}** (${filas.length - fallos.length}/${filas.length} cumplen)`,
  ...(problemas.length ? ['', 'Problemas de la evaluación (la hacen incompleta):', ...problemas.map((p) => `- ${p}`)] : []),
  '',
]
const tabla = ['| Grupo | Medida | Valor | Presupuesto | ¿Cumple? |', '| --- | --- | ---: | --- | --- |', ...filas.map((f) => `| ${f.grupo} | ${f.que} | ${formatear(f.valor, f.que)} | ${f.limite} | ${f.ok ? 'sí' : '**NO**'} |`)].join('\n')
writeFileSync(ev('presupuestos-tabla.md'), `${cabecera.join('\n')}\n${tabla}\n`)
for (const f of fallos) console.log(`NO CUMPLE ${f.grupo} · ${f.que}: ${formatear(f.valor, f.que)} (presupuesto ${f.limite})`)
for (const p of problemas) console.log(`PROBLEMA ${p}`)
console.log(`\n${filas.length - fallos.length}/${filas.length} presupuestos cumplidos · ${problemas.length} problemas · alcance ${global ? 'global' : 'PARCIAL'}`)
console.log(`VEREDICTO: ${veredicto}`)
// exitCode en vez de process.exit(): tras los fetch de la huella, process.exit() puede abortar el proceso en Windows (aserción de
// libuv sobre un handle que se está cerrando) y el código real se perdería.
process.exitCode = problemas.length || fallos.length ? 1 : 0
