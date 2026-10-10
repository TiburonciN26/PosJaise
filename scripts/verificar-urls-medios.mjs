// Regresiones SIN red de PF-01/PF-02 (Fase 3): reconocimiento estricto de URLs de medios propios, convivencia de
// bases (r2.dev ↔ Pages /medios), ausencia de desvíos de borrado y conversión acotada para el rollback.
//   node scripts/verificar-urls-medios.mjs
// Parte A: módulo puro src/lib/urlsMedios.js. Parte B: el cableado REAL (src/lib/medios.js + imagenes.js) cargado con
// Vite SSR y variables ficticias; Supabase nunca recibe una petición (solo se construye el cliente).
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import * as U from '../src/lib/urlsMedios.js'
import { swExcluyeMedios } from './lib/sw-medios.mjs'
import { readFileSync, existsSync } from 'node:fs'

const resultados = []
async function prueba(nombre, fn) {
  try { await fn(); resultados.push({ nombre, ok: true }); console.log(`OK    ${nombre}`) } catch (e) { resultados.push({ nombre, ok: false }); console.log(`FALLA ${nombre}\n      ${String(e.message).split('\n')[0].slice(0, 300)}`) }
}

const R2DEV = 'https://pub-0000.r2.dev'
const PAGES = 'https://staging.pages.dev/medios'
const ID = '0f1e2d3c-4b5a-4968-8777-665544332211'
const SUPA = 'https://abcdefghij.supabase.co'
const PREFIJO_STORAGE = `${SUPA}/storage/v1/object/public/fotos-galeria/`
const AMBAS = U.basesReconocidas(PAGES, R2DEV)

await prueba('normalizarBase: acepta https y localhost http; rechaza relativas, http ajeno, credenciales, query y hash', () => {
  assert.equal(U.normalizarBase('https://x.pages.dev/medios/'), 'https://x.pages.dev/medios')
  assert.equal(U.normalizarBase('http://127.0.0.1:8789'), 'http://127.0.0.1:8789')
  for (const mala of ['', '/medios', 'medios', 'http://x.pages.dev/medios', 'https://u:p@x.pages.dev', 'https://x.pages.dev/m?x=1', 'https://x.pages.dev/m#h', 'ftp://x', null, undefined, 5]) assert.equal(U.normalizarBase(mala), '', String(mala))
})
await prueba('basesReconocidas: configurada + aprobadas (coma), sin duplicados ni inválidas', () => {
  assert.deepEqual(U.basesReconocidas(PAGES, `${R2DEV}, ${PAGES}, http://malo.com, /rel`), [PAGES, R2DEV])
  assert.deepEqual(U.basesReconocidas('', undefined), [])
})

// PF-01: con cada base configurada se reconocen URLs antiguas (r2.dev) y nuevas (Pages)
for (const [nombre, config] of [['Pages configurada', PAGES], ['r2.dev configurada (tras rollback)', R2DEV]]) {
  await prueba(`PF-01 ${nombre}: URL antigua r2.dev y URL nueva Pages → r2:fotos-galeria/<id>`, () => {
    const bases = U.basesReconocidas(config, `${R2DEV},${PAGES}`)
    for (const u of [`${R2DEV}/fotos-galeria/${ID}/g.webp`, `${PAGES}/fotos-galeria/${ID}/g.webp`, `${PAGES}/fotos-galeria/${ID}/m.webp`]) {
      assert.equal(U.referenciaDeUrl(u, bases), `r2:fotos-galeria/${ID}`, u)
      assert.equal(U.rutaDeUrlGaleriaPura({ url: u, bases, prefijoStorage: PREFIJO_STORAGE }), `r2:fotos-galeria/${ID}`, u)
    }
  })
}
await prueba('PF-01: hosts engañosos y rutas inválidas → null EN ambos proveedores (R2 y Storage)', () => {
  const malas = [
    `https://evil.com/fotos-galeria/${ID}/g.webp`, `https://evil.com/medios/fotos-galeria/${ID}/g.webp`, `https://evil.com/${SUPA}/storage/v1/object/public/fotos-galeria/x.webp`,
    `https://staging.pages.dev.evil.com/medios/fotos-galeria/${ID}/g.webp`, `https://evilstaging.pages.dev/medios/fotos-galeria/${ID}/g.webp`, `https://staging.pages.dev@evil.com/medios/fotos-galeria/${ID}/g.webp`,
    `https://user:p@staging.pages.dev/medios/fotos-galeria/${ID}/g.webp`, `http://staging.pages.dev/medios/fotos-galeria/${ID}/g.webp`, `https://staging.pages.dev:8443/medios/fotos-galeria/${ID}/g.webp`,
    `https://staging.pages.dev/medios-extra/fotos-galeria/${ID}/g.webp`, `https://staging.pages.dev/medios/fotos-otro/${ID}/g.webp`, `https://staging.pages.dev/medios/fotos-galeria/no-uuid/g.webp`,
    `https://staging.pages.dev/medios/fotos-galeria/${ID}/x.webp`, `https://staging.pages.dev/medios/fotos-galeria/${ID}/g.png`, `https://staging.pages.dev/medios/fotos-galeria/${ID}/g.webp?x=1`,
    `https://staging.pages.dev/medios/fotos-galeria/${ID}/g.webp#h`, `https://staging.pages.dev/medios/fotos-galeria/${ID}/g.webp/extra`, `https://staging.pages.dev/medios/fotos-galeria/${ID}`,
    `https://staging.pages.dev/medios/fotos-galeria/%2e%2e/g.webp`, `https://staging.pages.dev/medios/fotos-galeria/${ID.toUpperCase()}/g.webp`, `${R2DEV}/otra/fotos-galeria/${ID}/g.webp`,
    '', null, undefined, 42, '/fotos-galeria/x.webp', 'fotos/antes.jpg',
  ]
  for (const u of malas) {
    assert.equal(U.referenciaDeUrl(u, AMBAS), null, `R2: ${u}`)
    assert.equal(U.rutaDeUrlGaleriaPura({ url: u, bases: AMBAS, prefijoStorage: PREFIJO_STORAGE }), null, `Storage: ${u}`)
  }
})
await prueba('Storage legítimo se conserva; ajeno, con `..`, query o prefijo de otro bucket/proyecto → null', () => {
  const ok = (u) => U.rutaDeUrlGaleriaPura({ url: u, bases: AMBAS, prefijoStorage: PREFIJO_STORAGE })
  assert.equal(ok(`${PREFIJO_STORAGE}abc.webp`), 'abc.webp')
  assert.equal(ok(`${PREFIJO_STORAGE}carpeta/abc.webp`), 'carpeta/abc.webp')
  for (const mala of [`${PREFIJO_STORAGE}`, `${PREFIJO_STORAGE}../x.webp`, `${PREFIJO_STORAGE}a//b.webp`, `${PREFIJO_STORAGE}a.webp?t=1`, `${SUPA}/storage/v1/object/public/otro-bucket/a.webp`, `https://otro.supabase.co/storage/v1/object/public/fotos-galeria/a.webp`, `https://evil.com/fotos-galeria/a.webp`]) assert.equal(ok(mala), null, mala)
})

// PF-02: conversión acotada para el rollback
await prueba('PF-02 convertirBaseUrl: Pages → r2.dev y de vuelta, solo URLs válidas de la base de origen', () => {
  const nueva = `${PAGES}/fotos-galeria/${ID}/g.webp`
  const vieja = `${R2DEV}/fotos-galeria/${ID}/g.webp`
  assert.equal(U.convertirBaseUrl(nueva, PAGES, R2DEV), vieja)
  assert.equal(U.convertirBaseUrl(vieja, R2DEV, PAGES), nueva)
  assert.equal(U.convertirBaseUrl(`${PAGES}/fotos-galeria/${ID}/m.webp`, PAGES, R2DEV), `${R2DEV}/fotos-galeria/${ID}/m.webp`)
  for (const [u, de, a] of [[vieja, PAGES, R2DEV], ['https://evil.com/x', PAGES, R2DEV], [nueva, PAGES, 'http://malo.com'], [nueva, '/medios', R2DEV], ['fotos/antes.jpg', PAGES, R2DEV], [`${PAGES}/fotos-galeria/${ID}/g.webp?x=1`, PAGES, R2DEV]]) assert.equal(U.convertirBaseUrl(u, de, a), null, String(u))
})
await prueba('PF-02 ensayo de rollback ficticio: la fila revertida sigue administrable; sin revertir y sin la base de Pages ya no (por eso se revierte antes)', () => {
  const fila = { antes_url: `${PAGES}/fotos-galeria/${ID}/g.webp`, despues_url: `${PAGES}/fotos-galeria/${ID.replace('0f1e', '1f1e')}/g.webp` }
  const revertida = { antes_url: U.convertirBaseUrl(fila.antes_url, PAGES, R2DEV), despues_url: U.convertirBaseUrl(fila.despues_url, PAGES, R2DEV) }
  assert.ok(revertida.antes_url.startsWith(R2DEV) && revertida.despues_url.startsWith(R2DEV))
  const con = (bases) => (u) => U.rutaDeUrlGaleriaPura({ url: u, bases, prefijoStorage: PREFIJO_STORAGE })
  for (const f of [fila, revertida]) for (const u of Object.values(f)) assert.match(con(U.basesReconocidas(R2DEV, PAGES))(u), /^r2:fotos-galeria\//)
  assert.match(con(U.basesReconocidas(R2DEV))(revertida.antes_url), /^r2:/)
  assert.equal(con(U.basesReconocidas(R2DEV))(fila.antes_url), null)
})

// Comprobación del service worker del build (precisión de Codex): propiedad y patrón exactos, con controles negativos
await prueba('SW: swExcluyeMedios exige la denylist con el patrón exacto; la palabra «medios» suelta o un patrón distinto NO bastan', () => {
  const BUENO = String.raw`/^\/medios(?:\/|$)/`
  assert.equal(swExcluyeMedios(`e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("index.html"),{denylist:[${BUENO}]}))`), true)
  assert.equal(swExcluyeMedios(String.raw`{denylist:[/^\/api/,${BUENO}]}`), true)
  const malas = ['', 'precache([{url:"assets/medios-abc.js"}])', String.raw`{denylist:[/^\/medio/]}`, String.raw`{denylist:[/\/medios/]}`, '{denylist:[]}', `{allowlist:[${BUENO}]}`, String.raw`{denylist:[/^\/medios-extra/]}`, null, undefined]
  for (const mala of malas) assert.equal(swExcluyeMedios(mala), false, String(mala))
})
const swReal = process.env.SW_REAL
if (swReal && existsSync(swReal)) {
  await prueba('SW: el sw.js del build de Cloudflare (SW_REAL) cumple la comprobación estricta', () => assert.equal(swExcluyeMedios(readFileSync(swReal, 'utf8')), true))
}

// ---------- Parte B: el cableado real ----------
const servidor = (publica, bases) => createServer({
  configFile: false, envFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(SUPA), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('anon-ficticia'),
    'import.meta.env.VITE_MEDIOS_PROVEEDOR': JSON.stringify('r2'), 'import.meta.env.VITE_MEDIOS_API_URL': JSON.stringify('https://worker.example.dev'),
    'import.meta.env.VITE_MEDIOS_PUBLIC_URL': JSON.stringify(publica), 'import.meta.env.VITE_MEDIOS_BASES_RECONOCIDAS': JSON.stringify(bases),
    'import.meta.env.BASE_URL': JSON.stringify('/'),
  },
})

const s1 = await servidor(PAGES, R2DEV)
try {
  const imagenes = await s1.ssrLoadModule('/src/lib/imagenes.js')
  const medios = await s1.ssrLoadModule('/src/lib/medios.js')
  await prueba('B: rutaDeUrlGaleria REAL — antigua (r2.dev) y nueva (Pages) → r2:...; Supabase legítimo → ruta; ajeno → null (resultado final, sin fallback a Storage)', () => {
    assert.equal(imagenes.rutaDeUrlGaleria('fotos-galeria', `${R2DEV}/fotos-galeria/${ID}/g.webp`), `r2:fotos-galeria/${ID}`)
    assert.equal(imagenes.rutaDeUrlGaleria('fotos-galeria', `${PAGES}/fotos-galeria/${ID}/g.webp`), `r2:fotos-galeria/${ID}`)
    assert.equal(imagenes.rutaDeUrlGaleria('fotos-galeria', `${PREFIJO_STORAGE}foto.webp`), 'foto.webp')
    for (const u of [`https://evil.com/fotos-galeria/${ID}/g.webp`, 'https://evil.com/fotos-galeria/foto.webp', 'https://evil.com/storage/v1/object/public/fotos-galeria/foto.webp', `https://staging.pages.dev.evil.com/medios/fotos-galeria/${ID}/g.webp`, 'fotos/antes.jpg', '/fotos/antes.jpg']) {
      assert.equal(imagenes.rutaDeUrlGaleria('fotos-galeria', u), null, u)
    }
  })
  await prueba('B: lectura intacta — resolverUrlGaleria devuelve cualquier URL http(s) tal cual y antepone BASE_URL a las relativas', () => {
    for (const u of [`${R2DEV}/fotos-galeria/${ID}/g.webp`, `${PAGES}/fotos-galeria/${ID}/g.webp`, 'https://evil.com/x.webp']) assert.equal(imagenes.resolverUrlGaleria(u), u)
    assert.equal(imagenes.resolverUrlGaleria('fotos/antes.jpg'), '/fotos/antes.jpg')
    assert.equal(imagenes.resolverUrlGaleria(null), null)
  })
  await prueba('B: urlPublicaR2 usa la base configurada (Pages) y referenciaDeUrlR2 reconoce ambas', () => {
    assert.equal(medios.urlPublicaR2(`r2:fotos-productos/${ID}`, 'm'), `${PAGES}/fotos-productos/${ID}/m.webp`)
    assert.equal(medios.referenciaDeUrlR2(`${R2DEV}/fotos-servicios/${ID}/m.webp`), `r2:fotos-servicios/${ID}`)
    assert.equal(medios.errorDeConfiguracionMedios(), null)
  })
} finally {
  await s1.close()
}

// Sin la variable de bases extra: solo se reconoce la base configurada (comportamiento previo, ahora estricto)
const s2 = await servidor(R2DEV, '')
try {
  const imagenes = await s2.ssrLoadModule('/src/lib/imagenes.js')
  await prueba('B: sin bases extra solo se reconoce la configurada; una URL de Pages ya no se administra (ni se desvía a Storage)', () => {
    assert.equal(imagenes.rutaDeUrlGaleria('fotos-galeria', `${R2DEV}/fotos-galeria/${ID}/g.webp`), `r2:fotos-galeria/${ID}`)
    assert.equal(imagenes.rutaDeUrlGaleria('fotos-galeria', `${PAGES}/fotos-galeria/${ID}/g.webp`), null)
  })
} finally {
  await s2.close()
}

// Configuración inválida: la URL pública relativa o http ajena se rechaza antes de subir (no se guardan URLs ambiguas)
for (const [nombre, publica] of [['relativa', '/medios'], ['http ajena', 'http://x.pages.dev/medios']]) {
  const s = await servidor(publica, '')
  try {
    const medios = await s.ssrLoadModule('/src/lib/medios.js')
    await prueba(`B: VITE_MEDIOS_PUBLIC_URL ${nombre} → error de configuración y las subidas nuevas NO van a R2`, () => {
      assert.match(medios.errorDeConfiguracionMedios(), /URL absoluta https/)
      assert.equal(medios.subidasNuevasEnR2('fotos-productos'), false)
    })
  } finally { await s.close() }
}

const fallos = resultados.filter((r) => !r.ok)
console.log(`\n${resultados.length} casos, ${fallos.length} fallos`)
process.exitCode = fallos.length ? 1 : 0
