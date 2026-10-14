// Fase 10A · pruebas de rendimiento reproducibles con PRESUPUESTOS (scripts/fase10a/presupuestos-rendimiento.json).
// Ejecuta los medidores existentes de cada fase y el de vitales de 10A, y compara cada cifra con su presupuesto. Solo lecturas en
// el negocio (cupones en reposo crea y borra su propia cuenta ficticia en Local, como en la Fase 1).
//
//   node scripts/fase10a/medir-rendimiento-10a.mjs --cuentas=<json> --salida=<carpeta>
//     [--app-cf=http://127.0.0.1:5401] [--app-gh-puerto=5402] [--app-dev=http://127.0.0.1:5173] [--app-vitales=http://127.0.0.1:5403]
//     [--solo=cupones,busqueda,...]
//     [--evaluar] (no mide: vuelve a evaluar las salidas ya guardadas en --salida)
// Escenarios: cupones (reposo), busqueda (catálogos con búsqueda amplia), iniciales (datos iniciales de listas, Inicio y
// Recompensas), sesion (sesión larga en 27 rutas), vitales (LCP/CLS/interacción frío y caliente + movimiento reducido).
// No ejecutar en paralelo con otras pruebas: las cifras de laboratorio dependen de la carga de la máquina.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d
const CUENTAS = arg('cuentas'), SALIDA = resolve(arg('salida', '.codex/evidencia-fase10a/rendimiento'))
const APP_CF = arg('app-cf', 'http://127.0.0.1:5401'), GH = arg('app-gh-puerto', '5402'), APP_DEV = arg('app-dev', 'http://127.0.0.1:5173')
// Vitales: conviene servir el build con scripts/fase10a/servir-como-pages.cjs (cabeceras de _headers, Brotli, 304) para que
// la carga caliente use la caché como en Pages; con servir-dist-base.cjs (sin cabeceras de caché) caliente ≈ frío.
const APP_VITALES = arg('app-vitales', APP_CF)
const SOLO = arg('solo')?.split(','), SOLO_EVALUAR = process.argv.includes('--evaluar')
const P = JSON.parse(readFileSync(join(RAIZ, 'scripts/fase10a/presupuestos-rendimiento.json'), 'utf8'))
mkdirSync(SALIDA, { recursive: true })
const S = (f) => join(RAIZ, 'scripts', f), ev = (f) => join(SALIDA, f)

const MEDIDORES = {
  cupones: [S('medir-cupones-reposo.cjs'), 'f10a', GH, ev('cupones-reposo.json')],
  busqueda: [S('medir-catalogos-fase4.cjs'), '--etiqueta=busqueda-amplia', `--salida=${SALIDA}`, `--app=${APP_DEV}`, '--muestras=3'],
  iniciales: [S('medir-fase5.cjs'), `--app=${APP_CF}`, `--cuentas=${CUENTAS}`, '--etiqueta=f10a', `--salida=${ev('datos-iniciales.json')}`, '--repeticiones=3'],
  sesion: [S('medir-fase6.cjs'), `--app=${APP_CF}`, `--cuentas=${CUENTAS}`, '--etiqueta=f10a', `--salida=${ev('sesion-larga.json')}`, '--ciclos=3'],
  vitales: [S('fase10a/medir-vitales-10a.cjs'), `--app=${APP_VITALES}`, `--cuentas=${CUENTAS}`, `--salida=${ev('vitales.json')}`, '--muestras=3'],
}
const correr = (cmd, id) => new Promise((ok) => {
  const t0 = Date.now(), p = spawn(process.execPath, cmd, { cwd: RAIZ }); let out = ''
  p.stdout.on('data', (x) => { out += x }); p.stderr.on('data', (x) => { out += x })
  p.on('close', (estado) => { writeFileSync(ev(`${id}.log`), out); ok({ id, estado, ms: Date.now() - t0 }) })
})

// ---------- evaluación ----------
const filas = []
const chequear = (grupo, que, valor, limite, cmp = '<=') => {
  const ok = valor !== null && valor !== undefined && (cmp === '<=' ? valor <= limite : cmp === '===' ? valor === limite : valor >= limite)
  filas.push({ grupo, que, valor, limite: `${cmp} ${limite}`, ok })
}
const leer = (f) => (existsSync(ev(f)) ? JSON.parse(readFileSync(ev(f), 'utf8')) : null)
function evaluar() {
  const cup = leer('cupones-reposo.json'), p1 = P.cupones_reposo
  if (cup) for (const r of cup.resultados) {
    const k = `${r.ruta} ${r.tema}`
    chequear('cupones', `${k} · TaskDuration mediana (ms/2,5 s)`, r.mediana_task_ms, p1.mediana_task_ms_max)
    chequear('cupones', `${k} · animaciones activas`, r.animaciones, p1.animaciones_activas_max)
    chequear('cupones', `${k} · mayor tarea larga (ms)`, Math.max(0, ...r.muestras.map((m) => m.mayor_tarea_ms)), p1.mayor_tarea_larga_ms_max)
  }
  const bus = leer('busqueda-amplia.json'), p4 = P.busqueda_amplia
  if (bus) for (const r of bus.resumen) {
    const k = `${r.ruta} ${r.ancho}px`
    chequear('busqueda', `${k} · nodos DOM`, r.nodosDom, p4.nodos_dom_max)
    chequear('busqueda', `${k} · tarjetas montadas`, r.tarjetasMontadas, p4.tarjetas_montadas_max)
    chequear('fotos', `${k} · imágenes pedidas en la carga`, r.imagenesCarga, P.fotos.imagenes_en_carga_max)
    chequear('busqueda', `${k} · bytes del catálogo en la carga`, r.bytesCatalogoCarga, p4.bytes_catalogo_carga_max)
    chequear('busqueda', `${k} · evento de búsqueda máx. (ms)`, r.busquedaEventoMaxMs, p4.busqueda_evento_max_ms)
    chequear('busqueda', `${k} · pedidos al catálogo por búsqueda`, r.busquedaPedidosCatalogo, p4.busqueda_pedidos_catalogo_max)
    chequear('busqueda', `${k} · encuentra el objetivo`, r.busquedaEncontroObjetivo, true, '===')
  }
  const ini = leer('datos-iniciales.json'), p5 = P.datos_iniciales
  if (ini) for (const [esc, r] of Object.entries(ini.resultados)) {
    const m = r.mediana
    chequear('iniciales', `${esc} · nodos`, m.nodos, p5.nodos_max)
    chequear('iniciales', `${esc} · bytes del API`, m.bytes, p5.bytes_max)
    chequear('iniciales', `${esc} · peticiones duplicadas`, m.duplicadas, p5.duplicadas_max)
    chequear('iniciales', `${esc} · canales Realtime`, m.canalesRealtime, p5.canales_realtime_max)
    chequear('iniciales', `${esc} · mayor tarea larga (ms)`, m.tareaMaxMs, p5.tarea_larga_max_ms)
  }
  const ses = leer('sesion-larga.json'), p6 = P.sesion_larga
  if (ses) {
    const [c1, c2, c3] = ses.ciclos
    chequear('sesion', 'pantallas montadas (máx.)', Math.max(...ses.ciclos.map((c) => c.maxPantallas)), p6.pantallas_montadas_max)
    chequear('sesion', 'heap tras GC al final (MB)', c3.finCiclo.heapMB, p6.heap_tras_gc_mb_max)
    chequear('sesion', 'crecimiento de heap ciclo 2→3 (MB)', Math.round((c3.finCiclo.heapMB - c2.finCiclo.heapMB) * 100) / 100, p6.crecimiento_heap_ciclo2_a_3_mb_max)
    chequear('sesion', 'crecimiento de nodos ciclo 2→3', c3.finCiclo.nodos - c2.finCiclo.nodos, p6.crecimiento_nodos_ciclo2_a_3_max)
    for (const c of [c1, c2, c3]) {
      chequear('sesion', `ciclo ${c.ciclo} · reposo en Ventas rAF/s`, c.reposo.rafPorSeg, p6.reposo_raf_por_seg_max)
      chequear('sesion', `ciclo ${c.ciclo} · reposo temporizadores/s`, c.reposo.timeoutsPorSeg, p6.reposo_temporizadores_por_seg_max)
      chequear('sesion', `ciclo ${c.ciclo} · reposo tarea ms/s`, c.reposo.tareaMsPorSeg, p6.reposo_tarea_ms_por_seg_max)
    }
  }
  const vit = leer('vitales.json'), pv = P.vitales_laboratorio, pr = P.movimiento_reducido
  if (vit) {
    for (const [esc, r] of Object.entries(vit.escenarios)) for (const modo of ['frio', 'caliente']) {
      chequear('vitales', `${esc} ${modo} · LCP (ms)`, r[modo].lcp, pv.lcp_ms_max)
      chequear('vitales', `${esc} ${modo} · CLS`, r[modo].cls, pv.cls_max)
      if (r[modo].interaccionMs !== null) chequear('vitales', `${esc} ${modo} · interacción (ms)`, typeof r[modo].interaccionMs === 'number' ? r[modo].interaccionMs : null, pv.interaccion_ms_max)
    }
    for (const [esc, r] of Object.entries(vit.reducido)) {
      chequear('reducido', `${esc} · rAF/s en reposo`, r.rafPorSeg, pr.raf_por_seg_max)
      chequear('reducido', `${esc} · animaciones en curso`, r.animacionesEnCurso, pr.animaciones_en_curso_max)
    }
  }
}

if (!SOLO_EVALUAR) {
  if (!CUENTAS) { console.error('uso: --cuentas=<json> --salida=<carpeta> [...]'); process.exit(2) }
  for (const [id, cmd] of Object.entries(MEDIDORES)) {
    if (SOLO && !SOLO.includes(id)) continue
    const r = await correr(cmd, id)
    console.log(`${r.estado === 0 ? 'medido' : 'FALLÓ '} ${id.padEnd(10)} ${(r.ms / 1000).toFixed(0)} s`)
  }
}
evaluar()
const fallos = filas.filter((f) => !f.ok)
writeFileSync(ev('presupuestos-resultado.json'), JSON.stringify({ fecha: new Date().toISOString(), presupuestos: 'scripts/fase10a/presupuestos-rendimiento.json', total: filas.length, fallos: fallos.length, filas }, null, 1))
const tabla = ['| Grupo | Medida | Valor | Presupuesto | ¿Cumple? |', '| --- | --- | ---: | --- | --- |', ...filas.map((f) => `| ${f.grupo} | ${f.que} | ${f.valor} | ${f.limite} | ${f.ok ? 'sí' : '**NO**'} |`)].join('\n')
writeFileSync(ev('presupuestos-tabla.md'), `${tabla}\n`)
for (const f of fallos) console.log(`NO CUMPLE ${f.grupo} · ${f.que}: ${f.valor} (presupuesto ${f.limite})`)
console.log(`\n${filas.length - fallos.length}/${filas.length} presupuestos cumplidos`)
process.exit(fallos.length ? 1 : 0)
