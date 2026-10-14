// Fase 10A · servidor estático LOCAL que emula lo que importa de Cloudflare Pages para medir carga fría/caliente:
//   · reglas de `_headers` de la carpeta servida (rutas exactas y con `*` al final), p. ej. /assets/* inmutable y HTML no-cache;
//   · compresión Brotli (o gzip) según Accept-Encoding, como hace Pages;
//   · ETag + 304 para lo que se revalida (HTML, sw.js);
//   · fallback de SPA a index.html (Pages sin 404.html).
// No es Pages ni su CDN (sin HTTP/3, sin POP, sin caché de borde): sirve para comparar builds entre sí con el mismo servidor.
//   node scripts/fase10a/servir-como-pages.cjs <carpeta> <puerto>
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const crypto = require('node:crypto')

const [carpeta, puerto] = process.argv.slice(2)
if (!carpeta || !puerto) { console.error('uso: <carpeta> <puerto>'); process.exit(2) }
const raiz = path.resolve(carpeta)
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain' }
const COMPRIMIBLE = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.ttf', '.txt'])

// _headers: bloques «ruta» seguidos de líneas «  Cabecera: valor».
const reglas = []
const archivoHeaders = path.join(raiz, '_headers')
if (fs.existsSync(archivoHeaders)) {
  let actual = null
  for (const linea of fs.readFileSync(archivoHeaders, 'utf8').split(/\r?\n/)) {
    if (!linea.trim() || linea.trim().startsWith('#')) continue
    if (!/^\s/.test(linea)) { actual = { patron: linea.trim(), cabeceras: {} }; reglas.push(actual); continue }
    const m = linea.match(/^\s+([^:]+):\s*(.*)$/)
    if (m && actual) actual.cabeceras[m[1].trim()] = m[2].trim()
  }
}
const casa = (patron, ruta) => (patron.endsWith('*') ? ruta.startsWith(patron.slice(0, -1)) : ruta === patron)
const cache = new Map() // archivo → { cuerpo, br, gz, etag }
function leer(f) {
  if (!cache.has(f)) {
    const cuerpo = fs.readFileSync(f)
    const ext = path.extname(f)
    cache.set(f, {
      cuerpo, etag: `"${crypto.createHash('sha1').update(cuerpo).digest('hex').slice(0, 16)}"`,
      br: COMPRIMIBLE.has(ext) ? zlib.brotliCompressSync(cuerpo, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }) : null,
      gz: COMPRIMIBLE.has(ext) ? zlib.gzipSync(cuerpo, { level: 9 }) : null,
    })
  }
  return cache.get(f)
}

http.createServer((req, res) => {
  let ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let f = path.join(raiz, ruta)
  if (!f.startsWith(raiz) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    const indice = path.join(f, 'index.html')
    if (f.startsWith(raiz) && fs.existsSync(indice)) f = indice
    else { f = path.join(raiz, 'index.html'); ruta = '/index.html' }
  }
  if (f.endsWith('index.html')) ruta = ruta.endsWith('index.html') ? ruta : `${ruta.replace(/\/$/, '')}/index.html`
  const cab = { 'Content-Type': TIPOS[path.extname(f)] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=0, must-revalidate', Vary: 'Accept-Encoding' }
  for (const r of reglas) if (casa(r.patron, ruta)) Object.assign(cab, r.cabeceras)
  const a = leer(f)
  cab.ETag = a.etag
  if (req.headers['if-none-match'] === a.etag) { res.writeHead(304, cab); return res.end() }
  const acepta = req.headers['accept-encoding'] ?? ''
  let cuerpo = a.cuerpo
  if (a.br && /\bbr\b/.test(acepta)) { cuerpo = a.br; cab['Content-Encoding'] = 'br' } else if (a.gz && /gzip/.test(acepta)) { cuerpo = a.gz; cab['Content-Encoding'] = 'gzip' }
  res.writeHead(200, cab)
  res.end(req.method === 'HEAD' ? undefined : cuerpo)
}).listen(Number(puerto), '127.0.0.1', () => console.log(`servir-como-pages: ${raiz} en http://127.0.0.1:${puerto} (${reglas.length} reglas de _headers)`))
