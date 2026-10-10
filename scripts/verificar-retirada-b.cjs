// Regresiones SIN red del veredicto de retirada (CB-01): función real de medios (R2 y Cache simulados, una caché por POP) + scripts/lib/retirada-b.cjs.
//   node scripts/verificar-retirada-b.cjs
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { evaluarRetirada } = require('./lib/retirada-b.cjs')

const casos = []
const caso = (nombre, ok, detalle = {}) => {
  casos.push({ nombre, ok: Boolean(ok) })
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${ok ? '' : ' ' + JSON.stringify(detalle)}`)
}

const ORIGEN = 'https://staging.pages.dev'
const ID = '0f1e2d3c-4b5a-4968-8777-665544332211'
const CLAVES = { m: `fotos-galeria/${ID}/m.webp`, g: `fotos-galeria/${ID}/g.webp` }
const BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50])

function r2Doble() {
  const objetos = { [CLAVES.m]: '"em"', [CLAVES.g]: '"eg"' }
  return {
    borrar: () => { for (const k of Object.keys(objetos)) delete objetos[k] },
    get: async (k) => (k in objetos ? { httpEtag: objetos[k], arrayBuffer: async () => BYTES.buffer.slice(0) } : null),
    head: async (k) => (k in objetos ? { httpEtag: objetos[k] } : null),
  }
}
function cacheDoble() {
  const a = new Map()
  return {
    match: async (req) => { const e = a.get(req.url); return e ? new Response(e.buf, { status: 200, headers: e.headers }) : undefined },
    put: async (req, resp) => { a.set(req.url, { buf: await resp.arrayBuffer(), headers: resp.headers }) },
    delete: async (req) => a.delete(req.url),
  }
}

async function main() {
  const { manejarMedios } = await import(pathToFileURL(path.join(__dirname, '../cloudflare/medios-pages/entrega.js')).href)
  // Cada «centro de datos» tiene su caché; el cliente solo ve el POP (el sufijo de CF-Ray en el verificador real).
  const crearEscenario = (revocar) => {
    const r2 = r2Doble()
    const caches = { MIA: cacheDoble(), SCL: cacheDoble() }
    const pedir = async (pop, variante, init = {}) => {
      const pend = []
      const resp = await manejarMedios(new Request(`${ORIGEN}/medios/fotos-galeria/${ID}/${variante}.webp`, init), { MEDIOS: r2 }, { waitUntil: (p) => pend.push(p) }, { cache: caches[pop], revocar })
      await Promise.all(pend)
      const h = (n) => resp.headers.get(n)
      const cuerpo = Buffer.from(await resp.arrayBuffer())
      return { estado: resp.status, cache: h('Cache-Control'), nosniff: h('X-Content-Type-Options'), robots: h('X-Robots-Tag'), medios: h('X-Medios-Cache'), etag: h('ETag'), pop, cuerpoVacio: cuerpo.length === 0 }
    }
    return { r2, pedir }
  }
  const calentar = async (e, pop, variantes = ['m', 'g']) => {
    const out = { m: null, g: null }
    for (const v of variantes) {
      await e.pedir(pop, v)
      const r = await e.pedir(pop, v)
      out[v] = r.medios === 'HIT' ? { hit: true, pop: r.pop, etag: r.etag } : null
    }
    return out
  }
  const observar = async (e, pop, popPorFila = {}) => {
    const etags = { m: '"em"', g: '"eg"' }
    const out = []
    for (const v of ['m', 'g']) {
      out.push({ variante: v, metodo: 'GET', ...(await e.pedir(popPorFila[`${v}GET`] ?? pop, v)) })
      out.push({ variante: v, metodo: 'HEAD', ...(await e.pedir(popPorFila[`${v}HEAD`] ?? pop, v, { method: 'HEAD' })) })
      out.push({ variante: v, metodo: 'COND', ...(await e.pedir(popPorFila[`${v}COND`] ?? pop, v, { headers: { 'If-None-Match': etags[v] } })) })
    }
    return out
  }
  const conclusion = (ev) => ev.conclusion

  {
    const e = crearEscenario(false); const cal = await calentar(e, 'MIA'); e.r2.borrar()
    const ev = evaluarRetirada({ calientes: cal, despues: await observar(e, 'MIA') })
    caso('A con copia caliente y lecturas en el MISMO POP → FALLIDA (rechaza A)', conclusion(ev) === 'fallida', ev)
  }
  {
    const e = crearEscenario(false); const cal = await calentar(e, 'MIA'); e.r2.borrar()
    const ev = evaluarRetirada({ calientes: cal, despues: await observar(e, 'SCL') })
    caso('CB-01: A (revocar:false) con HIT en MIA y 404 desde SCL frío → INCONCLUSA, nunca acreditada', conclusion(ev) === 'inconclusa' && ev.resultados.every((r) => r.veredicto !== 'ok'), ev)
  }
  {
    const e = crearEscenario(true); const cal = await calentar(e, 'MIA'); e.r2.borrar()
    const ev = evaluarRetirada({ calientes: cal, despues: await observar(e, 'MIA') })
    caso('B con copia caliente y lecturas en el mismo POP → ACREDITADA (6 de 6 ok)', conclusion(ev) === 'acreditada' && ev.resultados.length === 6 && ev.resultados.every((r) => r.veredicto === 'ok'), ev)
  }
  {
    const e = crearEscenario(true); const cal = await calentar(e, 'MIA'); e.r2.borrar()
    const ev = evaluarRetirada({ calientes: cal, despues: await observar(e, 'SCL') })
    caso('B con lecturas desde un POP distinto al del HIT → INCONCLUSA (no se acredita la copia caliente)', conclusion(ev) === 'inconclusa', ev)
  }
  {
    const e = crearEscenario(true); const cal = await calentar(e, 'MIA'); e.r2.borrar()
    const despues = (await observar(e, 'MIA')).map((x) => ({ ...x, pop: null }))
    caso('POP ausente en las respuestas posteriores → INCONCLUSA', conclusion(evaluarRetirada({ calientes: cal, despues })) === 'inconclusa')
  }
  {
    const e = crearEscenario(true); const cal = await calentar(e, 'MIA'); e.r2.borrar()
    cal.m.pop = null; cal.g.pop = null
    caso('POP ausente en el HIT previo → INCONCLUSA', conclusion(evaluarRetirada({ calientes: cal, despues: await observar(e, 'MIA') })) === 'inconclusa')
  }
  {
    const e = crearEscenario(true); const cal = await calentar(e, 'MIA', ['m']); e.r2.borrar()
    const ev = evaluarRetirada({ calientes: cal, despues: await observar(e, 'MIA') })
    const deM = ev.resultados.filter((r) => r.nombre.includes(' de m '))
    const deG = ev.resultados.filter((r) => r.nombre.includes(' de g '))
    caso('variante g sin HIT previo → INCONCLUSA; m queda acreditada por separado', conclusion(ev) === 'inconclusa' && deM.length === 3 && deM.every((r) => r.veredicto === 'ok') && deG.length === 3 && deG.every((r) => r.veredicto === 'inconcluso'), ev)
  }
  {
    const e = crearEscenario(true); const cal = await calentar(e, 'MIA', ['g']); e.r2.borrar()
    caso('variante m sin HIT previo → INCONCLUSA', conclusion(evaluarRetirada({ calientes: cal, despues: await observar(e, 'MIA') })) === 'inconclusa')
  }
  {
    const e = crearEscenario(true); const cal = await calentar(e, 'MIA'); e.r2.borrar()
    const ev = evaluarRetirada({ calientes: cal, despues: await observar(e, 'MIA', { gCOND: 'SCL' }) })
    caso('un solo condicional de g desde otro POP → INCONCLUSA (5 ok, ninguna acreditación global)', conclusion(ev) === 'inconclusa' && ev.resultados.filter((r) => r.veredicto === 'ok').length === 5, ev)
  }
  {
    const e = crearEscenario(false); const cal = await calentar(e, 'MIA'); e.r2.borrar()
    const ev = evaluarRetirada({ calientes: cal, despues: await observar(e, 'MIA') })
    caso('A: el condicional tras borrar devuelve 304 (bytes reutilizables) → fallo en esa comprobación', ev.resultados.some((r) => r.nombre.includes('If-None-Match') && r.veredicto === 'fallo' && r.estado === 304), ev.resultados)
  }
  {
    const e = crearEscenario(true); const cal = await calentar(e, 'MIA'); e.r2.borrar()
    const despues = await observar(e, 'MIA')
    despues.find((x) => x.variante === 'm' && x.metodo === 'GET').cache = 'public, max-age=300'
    despues.find((x) => x.variante === 'g' && x.metodo === 'HEAD').cuerpoVacio = false
    const ev = evaluarRetirada({ calientes: cal, despues })
    caso('404 con Cache-Control cacheable o HEAD con cuerpo → FALLIDA (2 fallos)', conclusion(ev) === 'fallida' && ev.resultados.filter((r) => r.veredicto === 'fallo').length === 2, ev)
  }
  {
    const e = crearEscenario(true); const cal = await calentar(e, 'MIA'); e.r2.borrar()
    const despues = (await observar(e, 'MIA')).slice(0, 5)
    caso('falta una observación (6.ª comprobación) → INCONCLUSA', conclusion(evaluarRetirada({ calientes: cal, despues })) === 'inconclusa')
  }
  {
    const ev = evaluarRetirada({ calientes: {}, despues: [] })
    caso('sin ningún dato → INCONCLUSA (la ausencia en R2 no equivale a retirada probada)', conclusion(ev) === 'inconclusa' && ev.resultados.length === 6)
  }

  const fallos = casos.filter((c) => !c.ok)
  console.log(`\n${casos.length} casos, ${fallos.length} fallos`)
  process.exitCode = fallos.length ? 1 : 0
}
main().catch((e) => { console.error(e); process.exitCode = 1 })
