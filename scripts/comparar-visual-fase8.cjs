// Fase 8 · equivalencia visual del hero y del mapa entre dos builds (antes/después). Capturas con movimiento reducido (estables),
// tema oscuro y claro, 390 y 1440 px; la comparación (PSNR y SSIM) la hace ffmpeg. Uso:
//   node scripts/comparar-visual-fase8.cjs --antes=<dist> --despues=<dist> --salida=<carpeta>
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').split('=').slice(1).join('=')
const SAL = path.resolve(arg('salida'))
fs.mkdirSync(SAL, { recursive: true })
const SERV = path.join(__dirname, 'servir-dist-base.cjs')
const casos = [['movil-390', { width: 390, height: 844 }, 2, true], ['escritorio-1440', { width: 1440, height: 900 }, 1, false]]
async function capturar(dist, puerto, etiqueta) {
  const srv = spawn(process.execPath, [SERV, path.resolve(dist), String(puerto), '/'], { stdio: 'ignore' })
  await new Promise((r) => setTimeout(r, 1000))
  const b = await chromium.launch()
  const out = []
  for (const tema of ['oscuro', 'claro']) for (const [nombre, vp, dpr, mobile] of casos) {
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', reducedMotion: 'reduce' })
    await ctx.addInitScript((t) => { { localStorage.setItem('pos-jaise-tema', t); localStorage.setItem('jaise-tema-web', t) } }, tema)
    const p = await ctx.newPage()
    await p.goto(`http://127.0.0.1:${puerto}/inicio`, { waitUntil: 'load' })
    await p.waitForSelector('h1'); await p.waitForTimeout(3500)
    const arriba = path.join(SAL, `${etiqueta}-${tema}-${nombre}-hero.png`)
    await p.screenshot({ path: arriba })
    // sección del mapa: se desplaza hasta el marcador/iframe y se captura una vez cargado (si hay red)
    await p.evaluate(() => { const el = document.querySelector('[data-mapa-diferido], iframe[title="Ubicación en el mapa"]'); el?.scrollIntoView({ block: 'center' }) })
    await p.waitForTimeout(4000)
    const mapa = path.join(SAL, `${etiqueta}-${tema}-${nombre}-mapa.png`)
    await p.screenshot({ path: mapa })
    out.push({ tema, nombre, arriba, mapa })
    await ctx.close()
  }
  await b.close(); srv.kill()
  return out
}
;(async () => {
  const A = await capturar(arg('antes'), 5311, 'antes')
  const D = await capturar(arg('despues'), 5312, 'despues')
  // ffmpeg escribe las métricas en stderr: se lanza de nuevo capturándolo
  const resultado = []
  for (let i = 0; i < A.length; i++) for (const zona of ['arriba', 'mapa']) {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-i', A[i][zona], '-i', D[i][zona], '-lavfi', '[0:v][1:v]ssim;[0:v][1:v]psnr', '-f', 'null', '-'], { encoding: 'utf8' })
    const ssim = /SSIM.*All:([\d.]+)/.exec(r.stderr)?.[1]
    const psnr = /PSNR.*average:([\d.inf]+)/.exec(r.stderr)?.[1]
    resultado.push({ tema: A[i].tema, vista: A[i].nombre, zona, ssim: Number(ssim), psnr_db: psnr === 'inf' ? 'inf' : Number(psnr) })
  }
  fs.writeFileSync(path.join(SAL, 'comparacion.json'), JSON.stringify(resultado, null, 1))
  console.table(resultado)
})().catch((e) => { console.error(e); process.exit(1) })
