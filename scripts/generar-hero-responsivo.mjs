// Fase 8 · variantes WebP responsivas del hero de Inicio (public/inicio-web). Reproducible: node scripts/generar-hero-responsivo.mjs
// Los originales (JPG y WebP de 1680×944) NO se tocan y siguen siendo el `src` de reserva; se crean <nombre>-<ancho>.webp para 640/960/1280.
// Requiere ffmpeg con libwebp en el PATH. Calidad 80 (el original WebP "claro" ya usa una calidad similar).
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
const dir = path.resolve('public/inicio-web')
const fuentes = ['hero-despues-referencia.jpg', 'hero-antes-referencia.jpg', 'despues-claro.webp', 'antes-claro.webp']
const anchos = [640, 960, 1280]
const ancho1680SoloJpg = true // los JPG (oscuro) necesitan además una variante WebP de 1680; los WebP (claro) ya son de 1680 y se usan tal cual
for (const f of fuentes) {
  const base = f.replace(/\.(jpg|webp)$/, '')
  for (const w of (ancho1680SoloJpg && f.endsWith('.jpg') ? [...anchos, 1680] : anchos)) {
    const salida = path.join(dir, `${base}-${w}.webp`)
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(dir, f), '-vf', `scale=${w}:-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', '80', '-compression_level', '6', salida])
    console.log(`${path.basename(salida)}  ${statSync(salida).size} bytes`)
  }
  console.log(`  original ${f} ${existsSync(path.join(dir, f)) ? statSync(path.join(dir, f)).size : '?'} bytes`)
}
