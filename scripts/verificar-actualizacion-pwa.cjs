// ENSAYO LOCAL (no es la prueba online) de actualización PWA A → B con marcas exactas.
// Uso: node scripts/verificar-actualizacion-pwa.cjs <dirA> <dirB> <idA> <idB> <puerto> <salida.json>
//        [--estado=vacio|venta|ventana] [--a-esperada=<id>] [--env-file=<archivo>] [--sin-permitir-local]
//   dirA/dirB: salidas de `node scripts/build-preview-staging.mjs --out=<dir> --build-id=<id>` (ids exactos).
// Sirve una carpeta «viva» con A en http://127.0.0.1:<puerto> y delega en
// scripts/verificar-actualizacion-pwa-online.cjs, que «publica» B copiándola a esa carpeta. La publicación escribe además
// un marcador en disco: el resultado registra `publicacionEjecutada` para probar los negativos (A incorrecta → no se publica).
// La prueba ONLINE (O1) usa el mismo script contra el alias real, sin --publicar-cmd.
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')
const ROOT = path.resolve(__dirname, '..')
const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const opc = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const [dirA, dirB, idA, idB, puerto, salida] = pos
if (!dirA || !dirB || !idA || !idB || !puerto || !salida) { console.error('Uso: <dirA> <dirB> <idA> <idB> <puerto> <salida.json> [opciones]'); process.exit(2) }
const viva = path.join(os.tmpdir(), `pwa-viva-${Date.now()}`)
const marcador = `${viva}.publicado`
const copiar = (de) => { fs.rmSync(viva, { recursive: true, force: true }); fs.cpSync(path.resolve(de), viva, { recursive: true }) }
copiar(dirA)
const srv = cp.spawn(process.execPath, [path.join(ROOT, 'scripts/servir-dist-base.cjs'), viva, puerto, '/'], { stdio: 'ignore' })
setTimeout(() => {
  // Se copia B ENCIMA de A (sin borrar la carpeta): los archivos con hash de A quedan, como en un CDN con versiones previas; evita carreras con lecturas en curso.
  const js = "const fs=require('fs');fs.cpSync(process.argv[2],process.argv[1],{recursive:true,force:true});fs.writeFileSync(process.argv[3],'publicado')"
  const cmdPublicar = `"${process.execPath}" -e "${js}" "${viva}" "${path.resolve(dirB)}" "${marcador}"`
  const args = [
    path.join(ROOT, 'scripts/verificar-actualizacion-pwa-online.cjs'),
    `--origen=http://127.0.0.1:${puerto}`, `--a=${opc('a-esperada') ?? idA}`, `--b=${idB}`, '--espera-min=2',
    `--estado=${opc('estado') ?? 'venta'}`, `--publicar-cmd=${cmdPublicar}`, `--salida=${path.resolve(salida)}`,
  ]
  if (!process.argv.includes('--sin-permitir-local')) args.push('--permitir-local')
  if (opc('env-file')) args.push(`--env-file=${opc('env-file')}`)
  const r = cp.spawnSync(process.execPath, args, { stdio: 'inherit' })
  srv.kill()
  const publicada = fs.existsSync(marcador)
  try { const j = JSON.parse(fs.readFileSync(path.resolve(salida), 'utf8')); j.publicacionEjecutada = publicada; fs.writeFileSync(path.resolve(salida), JSON.stringify(j, null, 2)) } catch { /* sin salida */ }
  console.log(`publicacionEjecutada=${publicada}`)
  fs.rmSync(viva, { recursive: true, force: true }); fs.rmSync(marcador, { force: true })
  process.exit(r.status ?? 1)
}, 1500)
