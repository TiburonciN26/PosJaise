// Sirve un build de Vite (base /PosJaise/) en 127.0.0.1:<puerto> con fallback SPA.
// Uso: node scripts/servir-dist-base.cjs <carpetaDist> <puerto> [base=/PosJaise/]
// (base `/` imita Cloudflare Pages: fallback de SPA a index.html salvo que exista un 404.html)
const http = require('http')
const fs = require('fs')
const path = require('path')

const [dir, puerto, baseArg = '/PosJaise/'] = process.argv.slice(2)
const raiz = path.resolve(dir)
const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' }

http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0])
  if (!p.startsWith(baseArg)) { res.writeHead(404); return res.end() }
  let f = path.join(raiz, p.slice(baseArg.length))
  if (!f.startsWith(raiz) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    // Pages: si hay un 404.html de nivel superior, se sirve (404) y NO hay fallback de SPA
    const p404 = path.join(raiz, '404.html')
    if (baseArg === '/' && fs.existsSync(p404)) { res.writeHead(404, { 'Content-Type': 'text/html' }); return fs.createReadStream(p404).on('error', () => res.destroy()).pipe(res) }
    f = path.join(raiz, 'index.html')
  }
  res.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'application/octet-stream' })
  // Un archivo que desaparece a mitad de lectura (publicación simulada) no debe tumbar el servidor.
  fs.createReadStream(f).on('error', () => res.destroy()).pipe(res)
}).listen(Number(puerto), '127.0.0.1')
