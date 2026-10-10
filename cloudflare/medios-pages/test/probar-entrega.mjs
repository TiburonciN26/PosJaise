// Pruebas SIN red de la entrega de medios por Pages Functions (cloudflare/medios-pages/entrega.js).
//   node cloudflare/medios-pages/test/probar-entrega.mjs
// R2 y la Cache API son dobles en memoria que CUENTAN las lecturas; la caché respeta max-age con un reloj simulado.
// Nada sale de la máquina.
import { manejarMedios, TTL_POSITIVO } from '../entrega.js'
import { onRequest as onRaiz } from '../../../functions/medios.js'
import { onRequest as onRuta } from '../../../functions/medios/[[ruta]].js'

const casos = []
const caso = (nombre, ok, detalle = {}) => {
  casos.push({ nombre, ok: Boolean(ok) })
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${ok ? '' : ' ' + JSON.stringify(detalle)}`)
}

const ORIGEN = 'https://staging.pages.dev'
const ID = '0f1e2d3c-4b5a-4968-8777-665544332211'
const OTRO = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50])

function doblesR2(objetos = { [`fotos-productos/${ID}/m.webp`]: 'W/"abc"' }) {
  const r2 = {
    lecturas: 0, cabezas: 0, bytesLeidos: 0, falla: false, fallaCuerpo: false, fallaHead: false, sinHead: false,
    async get(clave) {
      r2.lecturas += 1
      if (r2.falla) throw new Error('R2 caído')
      if (!(clave in objetos)) return null
      return {
        httpEtag: objetos[clave].replace(/^W\//, ''),
        arrayBuffer: async () => {
          if (r2.fallaCuerpo) throw new Error('cuerpo ilegible')
          r2.bytesLeidos += BYTES.length
          return BYTES.buffer.slice(0)
        },
      }
    },
    async head(clave) {
      r2.cabezas += 1
      if (r2.fallaHead) throw new Error('head caído')
      return clave in objetos ? { httpEtag: objetos[clave].replace(/^W\//, '') } : null
    },
    borrar(clave) { delete objetos[clave] },
  }
  return r2
}

// Cache API simulada: rechaza lo que rechaza la real (no-GET, 206), expira por max-age con reloj simulado.
function doblesCache() {
  const almacen = new Map()
  const c = {
    reloj: 0, puts: 0, fallaMatch: false, fallaPut: false, ultimaLlave: null,
    async match(req) {
      c.ultimaLlave = req
      if (c.fallaMatch) throw new Error('match caído')
      const e = almacen.get(req.url)
      if (!e) return undefined
      const max = Number(/max-age=(\d+)/.exec(e.resp.headers.get('Cache-Control') ?? '')?.[1] ?? 0)
      if (c.reloj - e.t >= max * 1000) { almacen.delete(req.url); return undefined }
      return new Response(e.buf, { status: e.resp.status, headers: e.resp.headers })
    },
    async put(req, resp) {
      if (c.fallaPut) throw new Error('put caído')
      if (req.method !== 'GET') throw new TypeError('put solo admite GET')
      if (resp.status === 206) throw new TypeError('put no admite 206')
      c.puts += 1
      almacen.set(req.url, { resp, buf: await resp.clone().arrayBuffer(), t: c.reloj })
    },
    tamano: () => almacen.size,
  }
  return c
}

function entorno(opciones = {}) {
  const r2 = opciones.r2 ?? doblesR2()
  const cache = opciones.cache ?? doblesCache()
  const pendientes = []
  const ctx = { waitUntil: (p) => pendientes.push(p) }
  return {
    r2, cache, ctx,
    pedir: async (ruta, init = {}) => {
      const r = await manejarMedios(new Request(`${ORIGEN}${ruta}`, init), opciones.sinBinding ? {} : { MEDIOS: r2 }, ctx, { cache })
      await Promise.all(pendientes.splice(0))
      return r
    },
  }
}

const RUTA = `/medios/fotos-productos/${ID}/m.webp`
const sinFugas = (r) => r.headers.get('X-Content-Type-Options') === 'nosniff' && r.headers.get('X-Robots-Tag') === 'noindex'

// ---- ruta y método ----
{
  const e = entorno()
  const r = await e.pedir(RUTA)
  caso('GET válido: 200, image/webp, nosniff, noindex, ETag, MISS', r.status === 200 && r.headers.get('Content-Type') === 'image/webp' && sinFugas(r) && r.headers.get('ETag') === '"abc"' && r.headers.get('X-Medios-Cache') === 'MISS', Object.fromEntries(r.headers))
  caso('el cuerpo son los bytes del objeto', new Uint8Array(await r.arrayBuffer()).join() === BYTES.join())
  caso('Cache-Control POSITIVO corto (no el immutable de un año de R2)', r.headers.get('Cache-Control') === `public, max-age=${TTL_POSITIVO}` && TTL_POSITIVO === 300)
}
{
  const e = entorno()
  const invalidas = [
    '/medios', '/medios/', `/medios/${ID}`, `/medios/fotos-otro/${ID}/m.webp`, `/medios/fotos-productos/${ID}/x.webp`, `/medios/fotos-productos/${ID}/m.png`,
    `/medios/fotos-productos/${ID}/m.webp.png`, `/medios/fotos-productos/${ID}/M.webp`, `/medios/FOTOS-PRODUCTOS/${ID}/m.webp`,
    `/medios/fotos-productos/${ID.toUpperCase()}/m.webp`, `/medios/fotos-productos/%2e%2e/${ID}/m.webp`,
    `/medios//fotos-productos/${ID}/m.webp`, `/medios/fotos-productos//${ID}/m.webp`, `/medios/fotos-productos/${ID}/m.webp/`, `/medios/fotos-productos/${ID}/m%2ewebp`,
    `/medios/fotos-productos/${ID}/`, '/medios/fotos-productos/', `/medios/fotos-productos/not-a-uuid/m.webp`, `/medios/fotos-productos/${ID}%00/m.webp`,
    `/medios/fotos-productos/${ID}/m.webp%0a`, '/medios-extra/x', `/medios/fotos-productos/${ID}/g.webp/extra`,
  ]
  const malas = []
  for (const ruta of invalidas) {
    const r = await e.pedir(ruta)
    if (r.status !== 404 || r.headers.get('Cache-Control') !== 'no-store' || !sinFugas(r)) malas.push([ruta, r.status])
  }
  caso(`${invalidas.length} rutas inválidas (traversal, %xx, mayúsculas, doble extensión, sin segmentos...) → 404 no-store con nosniff/noindex`, malas.length === 0, malas)
  caso('las rutas inválidas NO leen R2 ni la caché', e.r2.lecturas === 0 && e.cache.tamano() === 0)
  // El parser de URL normaliza `..` ANTES de llegar a la función: nunca puede salir de los tres destinos exactos.
  const sube = await e.pedir(`/medios/fotos-productos/${ID}/../../../etc/passwd`)
  caso('un `..` normalizado fuera de la forma exacta sigue siendo 404 y no toca R2', sube.status === 404 && e.r2.lecturas === 0)
  const r = await e.pedir(`${RUTA}?v=1&x=%2e%2e`)
  caso('la query se ignora (200) y la clave de caché no la incluye', r.status === 200 && e.cache.ultimaLlave.url === `${ORIGEN}${RUTA}`)
}
{
  const e = entorno()
  const resultados = []
  for (const metodo of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    const r = await e.pedir(RUTA, { method: metodo })
    resultados.push([metodo, r.status, r.headers.get('Allow'), sinFugas(r), r.headers.get('Cache-Control')])
  }
  caso('POST/PUT/DELETE/PATCH/OPTIONS → 405 con Allow: GET, HEAD y sin leer R2', resultados.every((x) => x[1] === 405 && x[2] === 'GET, HEAD' && x[3] && x[4] === 'no-store') && e.r2.lecturas === 0, resultados)
}
{
  const e = entorno({ sinBinding: true })
  const r = await e.pedir(RUTA)
  caso('binding ausente → 404 no-store (sin detalles)', r.status === 404 && r.headers.get('Cache-Control') === 'no-store' && sinFugas(r) && (await r.text()) === 'No encontrado')
}
{
  const e = entorno()
  const r = await e.pedir(`/medios/fotos-servicios/${OTRO}/g.webp`)
  caso('objeto inexistente → 404 no-store, sin cachear errores', r.status === 404 && r.headers.get('Cache-Control') === 'no-store' && e.cache.tamano() === 0)
}

// ---- caché: MISS → HIT, conteo R2, expiración ----
{
  const e = entorno()
  const a = await e.pedir(RUTA)
  const b = await e.pedir(RUTA)
  caso('MISS → HIT: el segundo GET no vuelve a leer R2 (conteo del doble, no solo la cabecera)', a.headers.get('X-Medios-Cache') === 'MISS' && b.headers.get('X-Medios-Cache') === 'HIT' && e.r2.lecturas === 1, { lecturas: e.r2.lecturas })
  caso('el HIT conserva cuerpo, ETag y Cache-Control corto, y recalcula su cabecera (no hereda la del MISS)', new Uint8Array(await b.arrayBuffer()).join() === BYTES.join() && b.headers.get('ETag') === '"abc"' && b.headers.get('Cache-Control') === 'public, max-age=300' && sinFugas(b))
  e.cache.reloj += (TTL_POSITIVO - 1) * 1000
  const c = await e.pedir(RUTA)
  caso(`dentro del TTL (${TTL_POSITIVO - 1} s) sigue siendo HIT`, c.headers.get('X-Medios-Cache') === 'HIT' && e.r2.lecturas === 1)
  e.cache.reloj += 2000
  const d = await e.pedir(RUTA)
  caso(`pasado el TTL (${TTL_POSITIVO} s) la copia expira y se vuelve a leer R2 (MISS)`, d.headers.get('X-Medios-Cache') === 'MISS' && e.r2.lecturas === 2)
}
{
  // El objeto de R2 trae un immutable de un año: la copia almacenada NO debe conservarlo.
  const e = entorno()
  await e.pedir(RUTA)
  const guardada = await e.cache.match(new Request(`${ORIGEN}${RUTA}`))
  caso('la copia almacenada en Cache API lleva el TTL corto (no un año)', guardada.headers.get('Cache-Control') === 'public, max-age=300')
}
{
  // Borrado: una foto retirada de R2 sigue sirviéndose desde caché hasta que expire (contrato, no un defecto).
  const e = entorno()
  await e.pedir(RUTA)
  e.r2.borrar(`fotos-productos/${ID}/m.webp`)
  const caliente = await e.pedir(RUTA)
  caso('tras borrar en R2 con la caché caliente: HIT 200 (retención acotada al TTL)', caliente.status === 200 && caliente.headers.get('X-Medios-Cache') === 'HIT')
  e.cache.reloj += TTL_POSITIVO * 1000 + 1
  const fria = await e.pedir(RUTA)
  caso('al expirar el TTL el borrado se refleja: 404 y nada se cachea', fria.status === 404 && e.cache.tamano() === 0)
}

// ---- HEAD ----
{
  const e = entorno()
  const h = await e.pedir(RUTA, { method: 'HEAD' })
  caso('HEAD: 200 sin cuerpo con las mismas cabeceras, usa `head` (0 bytes de R2 leídos) y NO almacena en caché', h.status === 200 && (await h.text()) === '' && h.headers.get('Content-Type') === 'image/webp' && h.headers.get('ETag') === '"abc"' && sinFugas(h) && e.r2.cabezas === 1 && e.r2.lecturas === 0 && e.r2.bytesLeidos === 0 && e.cache.tamano() === 0 && e.cache.puts === 0, { cabezas: e.r2.cabezas, lecturas: e.r2.lecturas, bytes: e.r2.bytesLeidos })
  const g = await e.pedir(RUTA)
  caso('HEAD → GET: el GET posterior trae el cuerpo completo (no una entrada vacía)', g.status === 200 && new Uint8Array(await g.arrayBuffer()).join() === BYTES.join() && e.cache.tamano() === 1)
  const h2 = await e.pedir(RUTA, { method: 'HEAD' })
  caso('GET → HEAD: HEAD desde HIT, sin cuerpo, sin tocar R2 otra vez', h2.status === 200 && (await h2.text()) === '' && h2.headers.get('X-Medios-Cache') === 'HIT' && e.r2.lecturas === 1 && e.r2.cabezas === 1)
}
{
  // Binding sin `head`: se usa `get` pero NO se consume el cuerpo.
  const e = entorno()
  delete e.r2.head
  const h = await e.pedir(RUTA, { method: 'HEAD' })
  caso('HEAD con un binding sin `head`: usa get sin consumir el cuerpo (0 bytes) y sin caché', h.status === 200 && (await h.text()) === '' && e.r2.lecturas === 1 && e.r2.bytesLeidos === 0 && e.cache.tamano() === 0)
}
{
  const e = entorno()
  const nf = await e.pedir(`/medios/fotos-servicios/${OTRO}/g.webp`, { method: 'HEAD' })
  const ruta = await e.pedir('/medios/', { method: 'HEAD' })
  const metodo = await e.pedir(RUTA, { method: 'POST' })
  e.r2.fallaHead = true
  const f = await e.pedir(RUTA, { method: 'HEAD' })
  caso('HEAD de error (404 de objeto, 404 de ruta, 503 de metadatos) sin cuerpo y con las cabeceras; el 405 conserva su Allow', nf.status === 404 && ruta.status === 404 && f.status === 503 && (await nf.text()) === '' && (await ruta.text()) === '' && (await f.text()) === '' && [nf, ruta, f].every((r) => r.headers.get('Cache-Control') === 'no-store' && sinFugas(r)) && metodo.status === 405)
  const sinBinding = await entorno({ sinBinding: true }).pedir(RUTA, { method: 'HEAD' })
  caso('HEAD con binding ausente → 404 sin cuerpo', sinBinding.status === 404 && (await sinBinding.text()) === '')
  caso('HEAD con fallo de metadatos: cero escrituras en caché; al recuperarse vuelve a responder 200', e.cache.puts === 0 && (e.r2.fallaHead = false, (await e.pedir(RUTA, { method: 'HEAD' })).status === 200))
}

// ---- condicionales ----
{
  const e = entorno()
  const aprobadas = []
  const pruebas = [['"abc"', 304], ['W/"abc"', 304], ['"zzz"', 200], ['"zzz", "abc"', 304], ['*', 304], ['', 200]]
  for (const [valor, esperado] of pruebas) {
    for (const fase of ['MISS', 'HIT']) {
      const e2 = entorno()
      if (fase === 'HIT') await e2.pedir(RUTA)
      const r = await e2.pedir(RUTA, { headers: valor ? { 'If-None-Match': valor } : {} })
      const cuerpo = await r.text()
      aprobadas.push([valor, fase, r.status, r.status === esperado && r.headers.get('X-Medios-Cache') === fase && (r.status !== 304 || (cuerpo === '' && r.headers.get('ETag') === '"abc"' && sinFugas(r) && r.headers.get('Cache-Control') === 'public, max-age=300'))])
    }
  }
  caso('If-None-Match (coincidente, débil, no coincidente, lista, *, ausente) → 304/200 correcto en MISS y en HIT, con cabeceras en el 304', aprobadas.every((x) => x[3]), aprobadas.filter((x) => !x[3]))
  const antes = e.cache.puts
  await e.pedir(RUTA, { headers: { 'If-None-Match': '"abc"' } })
  caso('un 304 en MISS igualmente deja la copia COMPLETA en caché (no el 304)', e.cache.puts === antes + 1 && (await e.pedir(RUTA)).status === 200)
}

// ---- Range ignorado ----
{
  const e = entorno()
  const r = await e.pedir(RUTA, { headers: { Range: 'bytes=0-3' } })
  const r2 = await e.pedir(RUTA, { headers: { Range: 'bytes=0-3' } })
  caso('Range se ignora: 200 completo en MISS y en HIT (nunca 206 ni Content-Range), sin romper put', r.status === 200 && r2.status === 200 && !r.headers.get('Content-Range') && !r2.headers.get('Content-Range') && new Uint8Array(await r2.arrayBuffer()).length === BYTES.length && e.cache.puts === 1)
}

// ---- fallos ----
{
  // PFM-01: get() resuelve con metadatos correctos, pero la lectura del CUERPO falla
  const e = entorno()
  e.r2.fallaCuerpo = true
  const r = await e.pedir(RUTA)
  caso('PFM-01: GET con metadatos correctos y lectura del cuerpo fallida → 503 controlado (no una promesa rechazada ni un 404), no-store, nosniff/noindex, sin detalles y cero escrituras en caché', r.status === 503 && r.headers.get('Cache-Control') === 'no-store' && sinFugas(r) && (await r.text()) === 'No disponible' && e.cache.puts === 0 && e.cache.tamano() === 0)
  e.r2.fallaCuerpo = false
  const ok = await e.pedir(RUTA)
  caso('PFM-01: al recuperarse el cuerpo, el siguiente GET devuelve 200 (el error no se cacheó)', ok.status === 200 && ok.headers.get('X-Medios-Cache') === 'MISS' && e.cache.puts === 1)
  e.r2.fallaCuerpo = true
  const otra = await entorno({ r2: e.r2 }).pedir(RUTA, { method: 'HEAD' })
  caso('PFM-01: HEAD no lee el cuerpo, así que un cuerpo ilegible no lo afecta (200 sin cuerpo)', otra.status === 200 && (await otra.text()) === '')
}
{
  const e = entorno()
  e.r2.falla = true
  const r = await e.pedir(RUTA)
  caso('fallo de lectura de R2 → 503 no-store sin detalles y NO se cachea como 404', r.status === 503 && r.headers.get('Cache-Control') === 'no-store' && sinFugas(r) && (await r.text()) === 'No disponible' && e.cache.tamano() === 0)
  e.r2.falla = false
  caso('al recuperarse R2 vuelve a servir (el error no quedó cacheado)', (await e.pedir(RUTA)).status === 200)
}
{
  const cache = doblesCache(); cache.fallaMatch = true; cache.fallaPut = true
  const e = entorno({ cache })
  const r = await e.pedir(RUTA)
  caso('fallo de Cache API (match y put) → se entrega igual desde R2 (200 MISS)', r.status === 200 && r.headers.get('X-Medios-Cache') === 'MISS' && new Uint8Array(await r.arrayBuffer()).join() === BYTES.join())
}
{
  const e = entorno()
  const r = await manejarMedios(new Request(`${ORIGEN}${RUTA}`), { MEDIOS: e.r2 }, undefined, {})
  caso('sin Cache API disponible ni ctx → sigue sirviendo desde R2', r.status === 200)
}

// ---- envoltorios de Functions (rutas reales de Pages) ----
{
  const e = doblesR2()
  const llamar = (f, ruta, metodo = 'GET') => f({ request: new Request(`${ORIGEN}${ruta}`, { method: metodo }), env: { MEDIOS: e }, waitUntil: () => {} })
  caso('functions/medios.js atiende /medios exacto: 404 (no el fallback de la SPA)', (await llamar(onRaiz, '/medios')).status === 404)
  caso('functions/medios.js: POST /medios → 405', (await llamar(onRaiz, '/medios', 'POST')).status === 405)
  caso('functions/medios/[[ruta]].js: /medios/ → 404, ruta válida → 200', (await llamar(onRuta, '/medios/')).status === 404 && (await llamar(onRuta, RUTA)).status === 200)
}

const fallos = casos.filter((c) => !c.ok)
console.log(`\n${casos.length} casos, ${fallos.length} fallos`)
process.exitCode = fallos.length ? 1 : 0
