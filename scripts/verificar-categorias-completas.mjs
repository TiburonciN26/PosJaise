// Metadatos de categorías COMPLETOS (Fase 4, F4-06): con 999, 1000, 1001 y 2500 categorías y un servidor que corta toda respuesta
// en max_rows = 1000 (también la de una función que devuelve filas), la lectura devuelve TODAS, en orden, sin repetir.
//   node scripts/verificar-categorias-completas.mjs
//
// Usa el SDK REAL de Supabase con un `fetch` simulado que respeta Range / Prefer: count=exact como PostgREST. No toca ninguna base.
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { leerCategoriasCompletas, metadatosCategorias, cargarVitrinaProductos, cargarVitrinaServicios } from '../src/lib/catalogoPublico.js'

const MAX_ROWS = 1000
const nombres = (n) => Array.from({ length: n }, (_, i) => ({ categoria: `Categoria ${String(i).padStart(4, '0')}`, total: i + 1 }))

// Servidor simulado: aplica Range pedido, lo recorta a max_rows y responde Content-Range con el total si se pidió count=exact.
function servidorSimulado(n, { falla = null, conteo = null } = {}) {
  const filas = nombres(n)
  const llamadas = []
  const fetchSimulado = async (url, init = {}) => {
    const u = new URL(url)
    const h = new Headers(init.headers)
    const m = /(?:^|\/)rpc\/(\w+)$/.exec(u.pathname)
    llamadas.push({ ruta: u.pathname, offset: Number(u.searchParams.get('offset') ?? 0), limit: Number(u.searchParams.get('limit') ?? Infinity), count: /count=exact/.test(h.get('prefer') ?? '') })
    if (falla && llamadas.length === falla.enLlamada) return new Response('{"message":"boom"}', { status: 500, headers: { 'content-type': 'application/json' } })
    if (m && /categorias_publicas$/.test(m[1])) {
      // postgrest-js expresa range() como ?offset=&limit= (o como cabecera Range): se aceptan ambas formas.
      const rango = (h.get('range') ?? '').split('-')
      const desde = u.searchParams.has('offset') ? Number(u.searchParams.get('offset')) : Number(rango[0]) || 0
      const pedido = u.searchParams.has('limit') ? Number(u.searchParams.get('limit')) : rango[1] ? Number(rango[1]) - desde + 1 : MAX_ROWS
      const tope = desde + Math.min(pedido, MAX_ROWS) - 1
      const cuerpo = filas.slice(desde, tope + 1)
      const headers = { 'content-type': 'application/json' }
      // `conteo(nLlamada, totalReal)` permite simular un total ausente (null), desconocido ('*'), malformado o distinto.
      const tot = conteo ? conteo(llamadas.length, filas.length) : filas.length
      if (llamadas.at(-1).count && tot !== null) headers['content-range'] = `${cuerpo.length ? `${desde}-${desde + cuerpo.length - 1}` : '*'}/${tot}`
      return new Response(JSON.stringify(cuerpo), { status: cuerpo.length < filas.length - desde ? 206 : 200, headers })
    }
    // Resto de la vitrina: respuestas vacías mínimas (no son el objeto de esta prueba).
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json', 'content-range': '*/0' } })
  }
  const supabase = createClient('http://127.0.0.1:1', 'anon', { global: { fetch: fetchSimulado }, auth: { persistSession: false } })
  return { supabase, llamadas, filas }
}

const resultados = []
async function caso(nombre, fn) {
  try { await fn(); resultados.push({ nombre, ok: true }); console.log(`OK    ${nombre}`) } catch (e) { resultados.push({ nombre, ok: false }); console.log(`FALLA ${nombre}\n      ${String(e.message).split('\n')[0].slice(0, 400)}`) }
}

for (const n of [0, 5, 999, 1000, 1001, 2500]) {
  for (const funcion of ['productos_categorias_publicas', 'servicios_categorias_publicas']) {
    await caso(`${funcion}: ${n} categorías → se leen TODAS, en orden y sin repetir`, async () => {
      const { supabase, filas } = servidorSimulado(n)
      const leidas = await leerCategoriasCompletas(supabase, funcion)
      assert.equal(leidas.length, n)
      assert.deepEqual(leidas, filas)
      const meta = metadatosCategorias(leidas)
      assert.equal(new Set(meta.categorias).size, n)
      if (n) assert.equal(meta.categorias.at(-1), `Categoria ${String(n - 1).padStart(4, '0')}`)
    })
  }
}

await caso('cada tramo pide ≤ 500 filas con count exacto (nunca depende de que el servidor devuelva todo en una respuesta)', async () => {
  const { supabase, llamadas } = servidorSimulado(1001)
  await leerCategoriasCompletas(supabase, 'productos_categorias_publicas')
  assert.ok(llamadas.length >= 3, `tramos: ${llamadas.length}`)
  assert.ok(llamadas.every((l) => l.count), 'falta count=exact')
  for (const l of llamadas) assert.ok(l.limit <= 500, `tramo ${l.offset}+${l.limit}`)
})

await caso('si un tramo falla la lectura FALLA (nunca se devuelve una lista parcial como completa)', async () => {
  const { supabase } = servidorSimulado(1001, { falla: { enLlamada: 2 } })
  await assert.rejects(() => leerCategoriasCompletas(supabase, 'servicios_categorias_publicas'))
})

await caso('cargarVitrinaProductos / cargarVitrinaServicios con 1001 categorías: la barra y las ventanas cuentan 1001 (101 ventanas de 10)', async () => {
  const { supabase } = servidorSimulado(1001)
  for (const cargar of [cargarVitrinaProductos, cargarVitrinaServicios]) {
    const v = await cargar(supabase)
    assert.equal(v.categorias.length, 1001)
    assert.equal(Math.ceil(v.categorias.length / 10), 101)
    assert.equal(v.categorias.at(-1), 'Categoria 1000')
  }
})

await caso('si la lectura de categorías falla, la vitrina completa falla (no se muestra una lista truncada)', async () => {
  const { supabase } = servidorSimulado(2500, { falla: { enLlamada: 2 } })
  await assert.rejects(() => cargarVitrinaProductos(supabase))
})

// ---- F4-06b: el conteo es obligatorio y estricto en CADA tramo ----
const malos = {
  'sin Content-Range en el primer tramo': (k, t) => (k === 1 ? null : t),
  'sin conteo en el segundo tramo (el primero sí lo trajo)': (k, t) => (k === 2 ? null : t),
  'total desconocido «*»': () => '*',
  'total malformado «xyz»': () => 'xyz',
  'total negativo «-1»': () => -1,
  'el total cambia entre tramos (1001 → 1000)': (k, t) => (k === 1 ? t : t - 1),
}
for (const [nombre, conteo] of Object.entries(malos)) {
  for (const funcion of ['productos_categorias_publicas', 'servicios_categorias_publicas']) {
    await caso(`${funcion}: ${nombre} → la lectura FALLA (nunca una lista parcial como completa)`, async () => {
      const { supabase } = servidorSimulado(1001, { conteo })
      await assert.rejects(() => leerCategoriasCompletas(supabase, funcion), /Categor/)
    })
  }
}
await caso('colección vacía con conteo 0 → lista vacía válida (control sano)', async () => {
  const { supabase } = servidorSimulado(0)
  assert.deepEqual(await leerCategoriasCompletas(supabase, 'productos_categorias_publicas'), [])
})
await caso('conteo ausente → la vitrina completa falla (Reintentar) en vez de ofrecer 500 categorías', async () => {
  const { supabase } = servidorSimulado(1001, { conteo: () => null })
  await assert.rejects(() => cargarVitrinaProductos(supabase))
  await assert.rejects(() => cargarVitrinaServicios(supabase))
})
await caso('tras un fallo por conteo, un reintento con respuesta sana devuelve las 1001', async () => {
  let malo = true
  const { supabase } = servidorSimulado(1001, { conteo: (k, t) => (malo ? null : t) })
  await assert.rejects(() => leerCategoriasCompletas(supabase, 'productos_categorias_publicas'))
  malo = false
  assert.equal((await leerCategoriasCompletas(supabase, 'productos_categorias_publicas')).length, 1001)
})

const fallos = resultados.filter((r) => !r.ok)
console.log(`\n${resultados.length} casos, ${fallos.length} fallos`)
process.exitCode = fallos.length ? 1 : 0
