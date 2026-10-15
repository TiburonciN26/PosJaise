// Regresiones SIN red (RG-03) del adaptador REAL del recolector (crearFuentes) con el SDK real de Supabase y un fetch ficticio:
// un conteo ausente/inválido es lectura INCIERTA y nunca «sin referencias».
//   node scripts/verificar-fuentes-huerfanos.mjs
import assert from 'node:assert/strict'
import { crearFuentes } from './medios-huerfanos.mjs'
import { recolectar } from './lib/huerfanos-medios.mjs'

const resultados = []
async function prueba(nombre, fn) {
  try { await fn(); resultados.push({ nombre, ok: true }); console.log(`OK    ${nombre}`) } catch (e) { resultados.push({ nombre, ok: false }); console.log(`FALLA ${nombre}\n      ${String(e.message).split('\n')[0].slice(0, 300)}`) }
}

const SUPA = 'https://ficticio.supabase.co'
const GRUPO = 'fotos-galeria/0f1e2d3c-4b5a-4968-8777-665544332211'
const json = (cuerpo, estado = 200, cab = {}) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json', ...cab } })
const sesion = () => json({ access_token: 'tok', token_type: 'bearer', expires_in: 3600, refresh_token: 'r', user: { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'qa@qa.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } })

// `conteos`: función (tabla, n) → { rangos: valor del header content-range | undefined, estado }
async function adaptador(respuestaConteo) {
  const peticiones = []
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url)
    peticiones.push({ metodo: init.method ?? 'GET', url: u })
    if (u.includes('/auth/v1/token')) return sesion()
    if (u.includes('/rest/v1/')) {
      const tabla = u.split('/rest/v1/')[1].split('?')[0]
      const r = respuestaConteo(tabla, peticiones.filter((p) => p.url.includes('/rest/v1/')).length)
      return new Response(null, { status: r.estado ?? 200, headers: r.rango === undefined ? {} : { 'content-range': r.rango } })
    }
    return json({}, 404)
  }
  const fuentes = await crearFuentes({ api: 'https://worker.ficticio.dev', supabaseUrl: SUPA, anonKey: 'anon', email: 'qa@qa.test', password: 'x' })
  return { fuentes, peticiones }
}

await prueba('conteo cero confirmado en las seis tablas → false (única respuesta que apoya «sin referencias»)', async () => {
  const { fuentes, peticiones } = await adaptador(() => ({ rango: '*/0' }))
  assert.equal(await fuentes.estaReferenciado(GRUPO), false)
  assert.equal(peticiones.filter((p) => p.url.includes('/rest/v1/')).length, 6)
})
await prueba('una foto referenciada solo por el login permanece protegida, incluso si está desactivada', async () => {
  const { fuentes, peticiones } = await adaptador((tabla) => ({ rango: tabla === 'login_web_fotos' ? '*/1' : '*/0' }))
  assert.equal(await fuentes.estaReferenciado(GRUPO), true)
  const consulta = peticiones.find((p) => p.url.includes('/rest/v1/login_web_fotos'))
  assert.ok(consulta)
  assert.equal(new URL(consulta.url).searchParams.has('activo'), false)
})
await prueba('conteo positivo en alguna tabla → true', async () => {
  const { fuentes } = await adaptador((tabla) => ({ rango: tabla === 'servicios' ? '*/2' : '*/0' }))
  assert.equal(await fuentes.estaReferenciado(GRUPO), true)
})
for (const [nombre, respuesta] of [
  ['sin Content-Range (count null)', () => ({ rango: undefined })],
  ['Content-Range malformado', () => ({ rango: '*/abc' })],
  ['Content-Range con total desconocido', () => ({ rango: '*/*' })],
  ['error 500 del servidor', () => ({ estado: 500, rango: undefined })],
  ['solo la tercera tabla sin conteo', (tabla) => ({ rango: tabla === 'servicios' ? undefined : '*/0' })],
  ['solo login_web_fotos sin conteo', (tabla) => ({ rango: tabla === 'login_web_fotos' ? undefined : '*/0' })],
]) {
  await prueba(`RG-03: ${nombre} → estaReferenciado LANZA (lectura incierta), nunca false`, async () => {
    const { fuentes } = await adaptador(respuesta)
    await assert.rejects(() => fuentes.estaReferenciado(GRUPO), /conteo inválido|Consulta puntual/)
  })
}
await prueba('RG-03: con recolectar real y el adaptador sin conteo, el candidato NO se borra y el informe aborta', async () => {
  const { fuentes } = await adaptador(() => ({ rango: undefined }))
  let eliminados = 0
  const f = {
    ...fuentes,
    listarReferencias: async () => new Set(['fotos-galeria/otro-grupo-referenciado']),
    listarObjetos: async () => [{ clave: `${GRUPO}/m.webp`, bytes: 10, subidoEn: new Date(Date.now() - 40 * 86_400_000).toISOString() }],
    eliminar: async () => { eliminados += 1 },
  }
  const informe = await recolectar({ fuentes: f, aplicar: true, retencionDias: 14 })
  assert.equal(eliminados, 0)
  assert.ok(informe.abortado)
  assert.equal(informe.eliminados.length, 0)
})
await prueba('control positivo: con conteo cero el mismo candidato SÍ se elimina (el aborto anterior es por la lectura incierta)', async () => {
  const { fuentes } = await adaptador(() => ({ rango: '*/0' }))
  let eliminados = 0
  const f = {
    ...fuentes,
    listarReferencias: async () => new Set(['fotos-galeria/otro-grupo-referenciado']),
    listarObjetos: async () => [{ clave: `${GRUPO}/m.webp`, bytes: 10, subidoEn: new Date(Date.now() - 40 * 86_400_000).toISOString() }],
    eliminar: async () => { eliminados += 1 },
  }
  const informe = await recolectar({ fuentes: f, aplicar: true, retencionDias: 14 })
  assert.equal(eliminados, 1)
  assert.equal(informe.abortado, null)
})

const fallos = resultados.filter((r) => !r.ok)
console.log(`\n${resultados.length} casos, ${fallos.length} fallos`)
process.exit(fallos.length ? 1 : 0)
