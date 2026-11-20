// SEO del portal: robots.txt, sitemap.xml (scripts/lib/seo.mjs), datos estructurados del salón
// (src/lib/datosEstructurados.js) y recorte de descripciones (src/hooks/useMetaPagina.js). Sin base de datos ni navegador:
//   node --test tests/e2e/seo.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RUTAS_PUBLICAS, SITIO_POR_DEFECTO, escribirSeo, rutasBloqueadas, rutasDelCatalogo, sitioDe, textoRobots, xmlSitemap } from '../../scripts/lib/seo.mjs'
import { construirLdSalon, horarioSchema, telefonoInternacional } from '../../src/lib/datosEstructurados.js'
import { recortarDescripcion } from '../../src/hooks/useMetaPagina.js'

const { secciones } = await import('../../src/config/navegacion.js')
const RUTAS_POS = secciones.map((s) => s.path)

test('sitioDe: VITE_SITIO_URL https válida o, si no, el dominio de producción', () => {
  assert.equal(sitioDe({ VITE_SITIO_URL: 'https://jaise.pe/' }), 'https://jaise.pe')
  for (const malo of [undefined, '', 'http://jaise.pe', 'jaise.pe', 'https://x.pe/ruta', 'javascript:alert(1)']) {
    assert.equal(sitioDe({ VITE_SITIO_URL: malo }), SITIO_POR_DEFECTO, String(malo))
  }
})

test('robots bloquea TODAS las pantallas exclusivas del POS y las privadas, pero nunca una pública', () => {
  const bloqueadas = rutasBloqueadas(RUTAS_POS)
  for (const publica of RUTAS_PUBLICAS) assert.ok(!bloqueadas.includes(publica), `pública bloqueada: ${publica}`)
  // POS y portal comparten /servicios y /citas: siguen indexables
  assert.ok(!bloqueadas.includes('/servicios') && !bloqueadas.includes('/citas'))
  for (const pos of ['/ventas', '/dashboard', '/personal', '/auditoria', '/clientes', '/caja-chica']) assert.ok(bloqueadas.includes(pos), pos)
  for (const privada of ['/mi-perfil', '/carrito', '/citas/carrito', '/historial', '/login']) assert.ok(bloqueadas.includes(privada), privada)
  // Ninguna regla Disallow es prefijo de una ruta pública (robots compara por prefijo)
  for (const b of bloqueadas) for (const p of RUTAS_PUBLICAS) assert.ok(!p.startsWith(b), `Disallow: ${b} bloquearía ${p}`)
})

test('robots: producción con Sitemap; preview «Disallow: /» sin sitemap', () => {
  const prod = textoRobots({ sitio: 'https://x.pe', indexar: true, bloqueadas: ['/ventas'] })
  assert.match(prod, /^User-agent: \*\nAllow: \/\nDisallow: \/ventas\n\nSitemap: https:\/\/x\.pe\/sitemap\.xml\n$/)
  assert.equal(textoRobots({ sitio: 'https://x.pe', indexar: false, bloqueadas: ['/ventas'] }), 'User-agent: *\nDisallow: /\n')
})

test('sitemap: URLs absolutas y escapadas', () => {
  const xml = xmlSitemap('https://x.pe', ['/inicio', '/a?b=1&c=2'])
  assert.match(xml, /<loc>https:\/\/x\.pe\/inicio<\/loc>/)
  assert.match(xml, /<loc>https:\/\/x\.pe\/a\?b=1&amp;c=2<\/loc>/)
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/)
})

test('catálogo: lee ids con la clave pública, descarta lo que no es UUID y, si falla, avisa sin lanzar', async () => {
  const pedidas = []
  const fetchOk = async (url, opciones) => {
    pedidas.push([url, opciones.headers.apikey])
    const filas = url.includes('/servicios?') ? [{ id: '11111111-1111-4111-8111-111111111111' }, { id: 'no-uuid' }] : [{ id: '22222222-2222-4222-8222-222222222222' }]
    return { ok: true, json: async () => filas }
  }
  const env = { VITE_SUPABASE_URL: 'https://abc.supabase.co/', VITE_SUPABASE_ANON_KEY: 'clave-publica' }
  assert.deepEqual(await rutasDelCatalogo(env, { fetch: fetchOk }), ['/servicios/11111111-1111-4111-8111-111111111111', '/productos/22222222-2222-4222-8222-222222222222'])
  assert.ok(pedidas.every(([url, clave]) => url.startsWith('https://abc.supabase.co/rest/v1/') && url.includes('activo=eq.true') && clave === 'clave-publica'))
  assert.deepEqual(await rutasDelCatalogo(env, { fetch: async () => ({ ok: false, status: 401 }) }), { error: 'servicios: HTTP 401' })
  assert.equal(await rutasDelCatalogo({}, { fetch: fetchOk }), null)
})

test('escribirSeo: producción escribe robots + sitemap; preview solo robots', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'seo-'))
  try {
    await escribirSeo(dir, { env: {}, indexar: true, rutasPos: RUTAS_POS, consultarCatalogo: false })
    assert.match(readFileSync(join(dir, 'robots.txt'), 'utf8'), /Disallow: \/ventas/)
    const sitemap = readFileSync(join(dir, 'sitemap.xml'), 'utf8')
    assert.equal((sitemap.match(/<url>/g) ?? []).length, RUTAS_PUBLICAS.length)
    rmSync(join(dir, 'sitemap.xml'))
    await escribirSeo(dir, { env: {}, indexar: false, rutasPos: RUTAS_POS, consultarCatalogo: true })
    assert.equal(readFileSync(join(dir, 'robots.txt'), 'utf8'), 'User-agent: *\nDisallow: /\n')
    assert.ok(!existsSync(join(dir, 'sitemap.xml')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('teléfono: celular peruano a +51; otros formatos, solo dígitos', () => {
  assert.equal(telefonoInternacional('917160188'), '+51917160188')
  assert.equal(telefonoInternacional('917 160 188'), '+51917160188')
  assert.equal(telefonoInternacional('51917160188'), '+51917160188')
  assert.equal(telefonoInternacional('(052) 42-1234'), '052421234')
  assert.equal(telefonoInternacional(''), null)
})

test('horario schema.org: agrupa días con el mismo turno y respeta los dos turnos', () => {
  const t = (inicio, fin) => ({ inicio, fin })
  const semana = [1, 2, 3, 4, 5, 6, 7].map((dia) => ({ dia, turnos: dia <= 6 ? [t('10:00', '13:00'), t('15:00', '20:30')] : [] }))
  assert.deepEqual(horarioSchema(semana), [
    { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], opens: '10:00', closes: '13:00' },
    { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], opens: '15:00', closes: '20:30' },
  ])
  assert.deepEqual(horarioSchema(null), [])
})

test('JSON-LD BeautySalon: solo datos de la base, sin inventar; lo que falta se omite', () => {
  const ld = construirLdSalon({
    sitio: 'https://x.pe',
    contacto: { direccion: ' Av. Argentina H-12 ', telefono: '917160188', instagram_url: 'https://instagram.com/j', facebook_url: '', tiktok_url: 'javascript:x' },
    semana: [{ dia: 1, turnos: [{ inicio: '10:00', fin: '13:00' }] }],
  })
  assert.equal(ld['@type'], 'BeautySalon')
  assert.equal(ld.url, 'https://x.pe/inicio')
  assert.deepEqual(ld.address, { '@type': 'PostalAddress', streetAddress: 'Av. Argentina H-12', addressCountry: 'PE' })
  assert.equal(ld.telephone, '+51917160188')
  assert.deepEqual(ld.sameAs, ['https://instagram.com/j']) // la vacía y la no-https se descartan
  assert.ok(!('addressLocality' in ld.address), 'no se inventa ciudad')
  const minimo = construirLdSalon({ sitio: 'https://x.pe', contacto: null, semana: null })
  assert.deepEqual(Object.keys(minimo).sort(), ['@context', '@type', 'image', 'logo', 'name', 'url'])
  assert.equal(construirLdSalon({ sitio: '', contacto: {}, semana: [] }), null)
})

test('descripción: se recorta en un espacio, sin cortar palabras, con «…»', () => {
  assert.equal(recortarDescripcion('  corta   y  limpia '), 'corta y limpia')
  const larga = 'palabra '.repeat(40)
  const r = recortarDescripcion(larga)
  assert.ok(r.length <= 160 && r.endsWith('…') && !r.includes('  '))
  assert.match(r, /palabra…$/)
})
