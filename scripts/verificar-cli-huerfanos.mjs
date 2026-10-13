// Regresiones SIN red ni credenciales reales del CÓDIGO DE SALIDA del CLI habitual del recolector (scripts/medios-huerfanos.mjs).
//   node scripts/verificar-cli-huerfanos.mjs
// Tres niveles: (A) la decisión pura `codigoSalida`; (B) esa decisión sobre el informe del `recolectar` REAL con dobles;
// (C) el CLI REAL en un proceso hijo con `fetch` simulado por una precarga (Supabase y Worker ficticios): el código de salida
// del proceso, que el proceso TERMINE, y que el informe y los resultados parciales se imprimen/guardan aunque falle.
// Nunca se ejecuta contra staging, ni con credenciales reales, ni borra nada real.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { codigoSalida, recolectar } from './lib/huerfanos-medios.mjs'
import { REF_PRODUCCION } from './lib/entornos-supabase.mjs'

const resultados = []
async function prueba(nombre, fn) {
  try { await fn(); resultados.push({ nombre, ok: true }); console.log(`OK    ${nombre}`) } catch (e) { resultados.push({ nombre, ok: false }); console.log(`FALLA ${nombre}\n      ${String(e.message).split('\n')[0].slice(0, 300)}`) }
}

// ---------- A. decisión pura ----------
const sano = { errores: [], abortado: null, eliminados: [], omitidos: [] }
await prueba('A: informe sano de lectura → 0', () => assert.equal(codigoSalida({ ...sano, aplicar: false }), 0))
await prueba('A: informe sano de aplicar (con eliminados) → 0', () => assert.equal(codigoSalida({ ...sano, aplicar: true, eliminados: ['fotos-galeria/a'] }), 0))
await prueba('A: un error de borrado → no cero', () => assert.equal(codigoSalida({ ...sano, errores: [{ grupo: 'g', error: 'x' }] }), 1))
await prueba('A: varios errores de borrado → no cero', () => assert.equal(codigoSalida({ ...sano, errores: [{ grupo: 'g', error: 'x' }, { grupo: 'h', error: 'y' }] }), 1))
await prueba('A: abortado por lectura incierta → no cero', () => assert.equal(codigoSalida({ ...sano, abortado: 'Duda al comprobar g' }), 1))
await prueba('A: éxito parcial seguido de error → no cero', () => assert.equal(codigoSalida({ ...sano, eliminados: ['a'], errores: [{ grupo: 'b', error: 'x' }] }), 1))
await prueba('A: éxito parcial seguido de aborto → no cero', () => assert.equal(codigoSalida({ ...sano, eliminados: ['a'], abortado: 'Duda' }), 1))
await prueba('A: omitido por referencia tardía (resultado seguro) → 0, no se convierte en error', () => assert.equal(codigoSalida({ ...sano, omitidos: [{ grupo: 'g', motivo: 'referenciado-justo-antes-de-borrar' }] }), 0))
await prueba('A: informe ausente o malformado (sin lista de errores) → no cero, nunca un 0 por omisión', () => {
  assert.equal(codigoSalida(undefined), 1)
  assert.equal(codigoSalida(null), 1)
  assert.equal(codigoSalida({}), 1)
  assert.equal(codigoSalida({ abortado: null }), 1)
})

// ---------- B. decisión sobre el recolectar REAL ----------
const GRUPO = (n) => `fotos-galeria/0f1e2d3c-4b5a-4968-8777-6655443322${String(n).padStart(2, '0')}`
const vieja = new Date(Date.now() - 40 * 86_400_000).toISOString()
const objetos = (...ns) => ns.flatMap((n) => ['m', 'g'].map((v) => ({ clave: `${GRUPO(n)}/${v}.webp`, bytes: 10, subidoEn: vieja })))
const fuentesBase = (extra = {}) => ({
  listarReferencias: async () => new Set([GRUPO(1)]),
  listarObjetos: async () => objetos(1, 2, 3),
  estaReferenciado: async () => false,
  eliminar: async () => {},
  ...extra,
})
await prueba('B: lectura sana → 0', async () => assert.equal(codigoSalida(await recolectar({ fuentes: fuentesBase(), aplicar: false })), 0))
await prueba('B: aplicar sano (borra 2 candidatos) → 0', async () => {
  const informe = await recolectar({ fuentes: fuentesBase(), aplicar: true })
  assert.equal(informe.eliminados.length, 2)
  assert.equal(codigoSalida(informe), 0)
})
await prueba('B: un borrado falla y otro sale bien → no cero, con el parcial conservado en el informe', async () => {
  const informe = await recolectar({ fuentes: fuentesBase({ eliminar: async (g) => { if (g === GRUPO(3)) throw new Error('500') } }), aplicar: true })
  assert.deepEqual(informe.eliminados, [GRUPO(2)])
  assert.equal(informe.errores.length, 1)
  assert.equal(codigoSalida(informe), 1)
})
await prueba('B: lectura incierta en la consulta puntual → abortado y no cero', async () => {
  const informe = await recolectar({ fuentes: fuentesBase({ estaReferenciado: async () => { throw new Error('conteo inválido') } }), aplicar: true })
  assert.ok(informe.abortado)
  assert.equal(codigoSalida(informe), 1)
})
await prueba('B: referencia tardía → omitido, nada eliminado y salida 0 (resultado seguro)', async () => {
  const informe = await recolectar({ fuentes: fuentesBase({ estaReferenciado: async () => true }), aplicar: true })
  assert.equal(informe.omitidos.length, 2)
  assert.equal(informe.eliminados.length, 0)
  assert.equal(codigoSalida(informe), 0)
})

// ---------- C. CLI REAL en proceso hijo, con fetch simulado ----------
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = mkdtempSync(join(tmpdir(), 'cli-huerfanos-'))
const precarga = join(tmp, 'precarga.mjs')
writeFileSync(precarga, `
const E = process.env.ESCENARIO
const U = (n) => '0f1e2d3c-4b5a-4968-8777-6655443322' + String(n).padStart(2, '0')
const vieja = new Date(Date.now() - 40 * 86400000).toISOString()
const json = (c, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { 'content-type': 'application/json' } })
const conteo = (n) => new Response(null, { status: 200, headers: { 'content-range': '*/' + n } })
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url))
  if (u.pathname.includes('/auth/v1/token')) return json({ access_token: 'tok', token_type: 'bearer', expires_in: 3600, refresh_token: 'r', user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'qa@qa.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } })
  if (u.pathname.includes('/rest/v1/')) {
    const tabla = u.pathname.split('/rest/v1/')[1]
    const metodo = init.method ?? 'GET'
    if (u.searchParams.has('or')) { // consulta PUNTUAL de un grupo
      const o = u.searchParams.get('or')
      if (E === 'puntual-incierto-segundo' && o.includes(U(3))) return new Response(null, { status: 200 }) // sin Content-Range
      if (E === 'puntual-incierto') return new Response(null, { status: 200 })
      if (E === 'referencia-tardia' && tabla === 'galeria_web') return conteo(1)
      return conteo(0)
    }
    if (metodo === 'HEAD') return conteo(tabla === 'galeria_web' ? 1 : 0)
    if (tabla === 'galeria_web' && !u.searchParams.has('id')) return json([{ id: '1', antes_url: 'r2:' + 'fotos-galeria/' + U(1), despues_url: null }])
    return json([])
  }
  if (u.host === 'worker.ficticio.dev') {
    if (u.pathname.startsWith('/v1/inventario/')) {
      const objetos = u.pathname.endsWith('fotos-galeria') ? [1, 2, 3].flatMap((n) => ['m', 'g'].map((v) => ({ clave: 'fotos-galeria/' + U(n) + '/' + v + '.webp', bytes: 10, subidoEn: vieja }))) : []
      return json({ objetos, cursor: null })
    }
    if ((init.method ?? 'GET') === 'DELETE') {
      if (E === 'borrado-falla' && u.pathname.includes(U(3))) return json({}, 500)
      return json({})
    }
  }
  return json({}, 404)
}
`)
const cli = join(raiz, 'scripts', 'medios-huerfanos.mjs')
function correr(escenario, args, env = {}) {
  const salida = join(tmp, `informe-${escenario}-${Math.random().toString(16).slice(2, 6)}.json`)
  const t0 = Date.now()
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(precarga).href, cli, ...args, `--salida=${salida}`], {
    cwd: raiz, encoding: 'utf8', timeout: 30_000,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ESCENARIO: escenario, VITE_SUPABASE_URL: 'https://ficticio.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon', MEDIOS_ADMIN_EMAIL: 'qa@qa.test', MEDIOS_ADMIN_PASSWORD: 'x', ...env },
  })
  const informe = existsSync(salida) ? JSON.parse(readFileSync(salida, 'utf8')) : null
  return { estado: r.status, terminoSolo: r.signal === null && !r.error, stdout: r.stdout, stderr: r.stderr, informe, ms: Date.now() - t0 }
}
const API = '--api=https://worker.ficticio.dev'

await prueba('C: CLI real, lectura sana → termina con 0 y el informe lista los 2 candidatos sin borrar', () => {
  const r = correr('sano', [API])
  assert.ok(r.terminoSolo, 'el proceso no terminó: ' + r.stderr.slice(0, 200))
  assert.equal(r.estado, 0, r.stderr.slice(0, 300))
  assert.equal(r.informe.candidatos.length, 2)
  assert.equal(r.informe.eliminados.length, 0)
})
await prueba('C: CLI real, aplicar sano → 0 y elimina los 2 candidatos (el referenciado se conserva)', () => {
  const r = correr('sano', [API, '--aplicar'])
  assert.ok(r.terminoSolo)
  assert.equal(r.estado, 0, r.stderr.slice(0, 300))
  assert.deepEqual(r.informe.eliminados, [GRUPO(2), GRUPO(3)])
})
await prueba('C: CLI real, un borrado falla (el otro sale bien) → código 1, informe y parcial impresos y guardados', () => {
  const r = correr('borrado-falla', [API, '--aplicar'])
  assert.ok(r.terminoSolo)
  assert.equal(r.estado, 1)
  assert.deepEqual(r.informe.eliminados, [GRUPO(2)])
  assert.equal(r.informe.errores.length, 1)
  assert.match(r.stdout, /"errores"/, 'el informe también se imprime en stdout')
})
await prueba('C: CLI real, lectura incierta en el segundo candidato → código 1 con abortado y el parcial conservado', () => {
  const r = correr('puntual-incierto-segundo', [API, '--aplicar'])
  assert.ok(r.terminoSolo)
  assert.equal(r.estado, 1)
  assert.ok(r.informe.abortado)
  assert.deepEqual(r.informe.eliminados, [GRUPO(2)])
})
await prueba('C: CLI real, lectura incierta desde el primer candidato → código 1 y no borra nada', () => {
  const r = correr('puntual-incierto', [API, '--aplicar'])
  assert.equal(r.estado, 1)
  assert.deepEqual(r.informe.eliminados, [])
})
await prueba('C: CLI real, referencia tardía en ambos candidatos → 0 (omitidos, nada borrado): resultado seguro documentado', () => {
  const r = correr('referencia-tardia', [API, '--aplicar'])
  assert.ok(r.terminoSolo)
  assert.equal(r.estado, 0)
  assert.equal(r.informe.omitidos.length, 2)
  assert.deepEqual(r.informe.eliminados, [])
})
await prueba('C: CLI real, argumentos inválidos (opción desconocida, --aplicar=false, retención 0) → código 1 antes de autenticar', () => {
  for (const malos of [['--no-existe'], ['--aplicar=false'], ['--retencion-dias=0'], ['argumento-suelto']]) {
    const r = correr('sano', [API, ...malos])
    assert.equal(r.estado, 1, `${malos.join(' ')} → ${r.estado}`)
    assert.equal(r.informe, null, 'no debe generar informe')
  }
})
await prueba('C: CLI real, sin credenciales o sin --api → código 1', () => {
  assert.equal(correr('sano', [API], { MEDIOS_ADMIN_EMAIL: '', MEDIOS_ADMIN_PASSWORD: '' }).estado, 1)
  assert.equal(correr('sano', []).estado, 1)
})
await prueba('C: CLI real, Supabase del negocio sin --permitir-produccion → código 1 antes de leer nada (sin informe)', () => {
  const r = correr('sano', [API], { VITE_SUPABASE_URL: `https://${REF_PRODUCCION}.supabase.co` })
  assert.equal(r.estado, 1)
  assert.equal(r.informe, null)
  assert.match(r.stderr, /permitir-produccion/)
})

rmSync(tmp, { recursive: true, force: true })
const fallos = resultados.filter((r) => !r.ok)
console.log(`\n${resultados.length} casos, ${fallos.length} fallos`)
process.exit(fallos.length ? 1 : 0)
