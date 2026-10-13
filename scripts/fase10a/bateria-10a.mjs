// Fase 10A · batería de regresión INTEGRADA (Fases 1–9 + comprobaciones nuevas de 10A) sobre el árbol actual y Supabase LOCAL.
// Ejecuta en serie las verificaciones existentes de cada fase y las nuevas de 10A; guarda por comprobación su log, código de salida,
// duración y el último «N/M» que imprime, y un resumen (JSON + tabla). No modifica ninguna verificación: solo las orquesta.
//
// Uso:
//   node scripts/fase10a/bateria-10a.mjs --cuentas=<json admin/adminB/cajera/clienteA/clienteB> --salida=<carpeta>
//     [--app-cf=http://127.0.0.1:5401]   build de Cloudflare Pages (base /) servido con scripts/servir-dist-base.cjs <dist> 5401 /
//     [--app-gh-puerto=5402]             build de GitHub Pages (base /PosJaise/) servido en ese puerto (Fase 1 lo exige)
//     [--app-dev=http://127.0.0.1:5173]  Vite dev
//     [--app-r2=http://127.0.0.1:5181]   Vite dev con VITE_MEDIOS_* apuntando a hosts .invalid (fotos de la Fase 4)
//     [--pwa-a=<dist A> --pwa-b=<dist B>] builds A/B de la Fase 8 (B con todos los nombres de assets distintos)
//     [--solo=id1,id2] [--excluir=id1,id2]
// Requisitos: Supabase Local verificado en 127.0.0.1:54321 (cada verificación lo comprueba por su cuenta) y Chromium de Playwright.
// Las verificaciones que escriben lo hacen SOLO en Local y limpian sus fixtures (ver la cabecera de cada script).
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d
const CUENTAS = arg('cuentas')
const SALIDA = resolve(arg('salida', '.codex/evidencia-fase10a/bateria'))
const APP_CF = arg('app-cf', 'http://127.0.0.1:5401')
const GH_PUERTO = arg('app-gh-puerto', '5402')
const APP_DEV = arg('app-dev', 'http://127.0.0.1:5173')
const APP_R2 = arg('app-r2', 'http://127.0.0.1:5181')
const PWA_A = arg('pwa-a'), PWA_B = arg('pwa-b')
const SOLO = arg('solo')?.split(','), EXCLUIR = arg('excluir', '').split(',').filter(Boolean)
if (!CUENTAS) { console.error('uso: --cuentas=<json> --salida=<carpeta> [...]'); process.exit(2) }
mkdirSync(SALIDA, { recursive: true })

// Cuenta individual (clienta A) que algunas verificaciones piden por separado. Lleva la contraseña ficticia, así que se escribe en
// el temporal del sistema (nunca en la evidencia) y se borra al terminar.
const cuentas = JSON.parse(readFileSync(CUENTAS, 'utf8'))
const CUENTA_A = join(tmpdir(), `qa-f10a-clienteA-${process.pid}.json`)
writeFileSync(CUENTA_A, JSON.stringify(cuentas.clienteA))
const ev = (n) => join(SALIDA, n)
const S = (f) => join(RAIZ, 'scripts', f)

const COMPROBACIONES = [
  // ---- sin navegador ----
  { id: 'f2-salvaguardas-entornos', fase: 2, cmd: [S('probar-salvaguardas-entornos.mjs'), ev('f2-salvaguardas.json')] },
  { id: 'f3-urls-medios', fase: 3, cmd: [S('verificar-urls-medios.mjs')] },
  { id: 'f3-lectura-mixta', fase: 3, cmd: [S('verificar-lectura-mixta.mjs')] },
  { id: 'f3-salida-segura', fase: 3, cmd: [S('verificar-salida-segura.mjs')] },
  { id: 'f3-fuentes-huerfanos', fase: 3, cmd: [S('verificar-fuentes-huerfanos.mjs')] },
  { id: 'f3-cli-huerfanos', fase: 3, cmd: [S('verificar-cli-huerfanos.mjs')] },
  { id: 'f3-guardas-interfaz-r2', fase: 3, cmd: [S('verificar-guardas-interfaz-r2.cjs')] },
  { id: 'f4-categorias-completas', fase: 4, cmd: [S('verificar-categorias-completas.mjs')] },
  { id: 'f4-catalogo-publico', fase: 4, cmd: [S('verificar-catalogo-publico.mjs')] },
  { id: 'f7-conteos', fase: 7, cmd: [S('verificar-conteos-fase7.cjs'), `--cuentas=${CUENTAS}`, `--salida=${ev('f7-conteos.json')}`] },
  { id: 'f9-lib', fase: 9, cmd: [S('migracion-medios/probar-lib.mjs'), `--salida=${ev('f9-lib.json')}`] },
  { id: 'f9-cli', fase: 9, cmd: [S('migracion-medios/probar-cli.mjs'), `--salida=${ev('f9-cli.json')}`], limiteMs: 900000 },
  // ---- navegador ----
  { id: 'f1-cupones', fase: 1, cmd: [S('verificar-cupones-fase1.cjs'), 'f10a', GH_PUERTO, ev('f1-cupones')] },
  { id: 'f4-catalogos-interfaz', fase: 4, cmd: [S('verificar-catalogos-interfaz.cjs'), `--app=${APP_DEV}`, `--salida=${ev('f4-catalogos-interfaz')}`, '--con-categorias'] },
  { id: 'f4-barras-seleccion', fase: 4, cmd: [S('verificar-barras-seleccion.cjs'), `--cuenta=${CUENTA_A}`, `--app=${APP_DEV}`, `--salida=${ev('f4-barras')}`] },
  { id: 'f4-fotos-sesion', fase: 4, cmd: [S('verificar-catalogos-fotos-sesion.cjs'), `--app=${APP_R2}`, `--cuenta=${CUENTA_A}`, `--salida=${ev('f4-fotos-sesion')}`] },
  { id: 'f5-listas-sesion', fase: 5, cmd: [S('verificar-fase5.cjs'), `--app=${APP_CF}`, `--cuentas=${CUENTAS}`, `--salida=${ev('f5.json')}`], limiteMs: 900000 },
  { id: 'f6-sesion-larga', fase: 6, cmd: [S('verificar-fase6.cjs'), `--app=${APP_CF}`, `--cuentas=${CUENTAS}`, `--salida=${ev('f6.json')}`], limiteMs: 1500000 },
  ...(PWA_A && PWA_B ? [{ id: 'f8-pwa-v2', fase: 8, cmd: [S('verificar-fase8-v2.cjs'), `--a=${PWA_A}`, `--b=${PWA_B}`, `--cuentas=${CUENTAS}`, `--salida=${ev('f8-v2.json')}`, '--etiqueta=f10a'], limiteMs: 900000 }] : []),
  // ---- nuevas de 10A ----
  // V2: regresiones de las herramientas de 10A (guardas de login, evaluador, servidor, CLS) y ensayo de la compatibilidad de
  // deudas dentro de una transacción revertida.
  { id: 'f10a-herramientas', fase: '10A', cmd: [S('fase10a/probar-herramientas-10a.mjs'), `--cuentas=${CUENTAS}`, `--app-real=${APP_CF}`, `--salida=${ev('f10a-herramientas.json')}`], limiteMs: 900000 },
  { id: 'f10a-compat-deudas', fase: '10A', cmd: [S('fase10a/ensayar-compat-deudas.mjs'), `--cuentas=${CUENTAS}`, `--salida=${ev('f10a-compat-deudas.json')}`] },
  { id: 'f10a-roles-rutas', fase: '10A', cmd: [S('fase10a/verificar-roles-rutas.cjs'), `--app=${APP_CF}`, `--cuentas=${CUENTAS}`, `--salida=${ev('f10a-roles.json')}`], limiteMs: 900000 },
]

function correr(c) {
  return new Promise((ok) => {
    const t0 = Date.now()
    const p = spawn(process.execPath, c.cmd, { cwd: RAIZ, env: process.env })
    let out = ''
    p.stdout.on('data', (x) => { out += x }); p.stderr.on('data', (x) => { out += x })
    const t = setTimeout(() => { out += '\n[bateria] TIEMPO AGOTADO'; p.kill() }, c.limiteMs ?? 600000)
    p.on('close', (estado) => {
      clearTimeout(t)
      writeFileSync(ev(`${c.id}.log`), out)
      // Formatos de resumen de los verificadores: «N/M correctos», «N casos, M fallos» y «VEREDICTO: …».
      const nm = [...out.matchAll(/(\d+)\s*\/\s*(\d+)\s+(correctos|casos|OK|aprobad|pasaron)/gi)].at(-1)
      const cf = [...out.matchAll(/(\d+) casos, (\d+) fallos/g)].at(-1)
      const ver = out.match(/VEREDICTO: (\S+)/)
      const resumen = nm ? `${nm[1]}/${nm[2]}` : cf ? `${cf[1] - cf[2]}/${cf[1]}` : ver ? ver[1] : null
      ok({ id: c.id, fase: c.fase, estado, ms: Date.now() - t0, resumen, cola: out.trim().split('\n').slice(-4).join(' | ').slice(0, 400) })
    })
  })
}

const elegidas = COMPROBACIONES.filter((c) => (!SOLO || SOLO.includes(c.id)) && !EXCLUIR.includes(c.id))
const resultados = []
try {
  for (const c of elegidas) {
    process.stdout.write(`… ${c.id}\r`)
    const r = await correr(c)
    resultados.push(r)
    console.log(`${r.estado === 0 ? 'OK   ' : 'FALLA'} ${c.id.padEnd(28)} ${String(r.resumen ?? '').padEnd(8)} ${(r.ms / 1000).toFixed(0)} s`)
    writeFileSync(ev('resumen.json'), JSON.stringify({ fecha: new Date().toISOString(), apps: { APP_CF, GH_PUERTO, APP_DEV, APP_R2 }, resultados }, null, 1))
  }
} finally {
  rmSync(CUENTA_A, { force: true })
}
const fallos = resultados.filter((r) => r.estado !== 0)
console.log(`\n${resultados.length - fallos.length}/${resultados.length} comprobaciones correctas`)
process.exit(fallos.length ? 1 : 0)
