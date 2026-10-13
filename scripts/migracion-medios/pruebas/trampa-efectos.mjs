// Preload de PRUEBA (node --import) para ejecutar el harness REAL de la simulación sin que pueda tener efectos: sustituye las
// operaciones de fs que borran, crean o escriben, los procesos hijos y la red por dobles que REGISTRAN la llamada (en el
// archivo QA_F9_REGISTRO, con la función original) y lanzan ANTES de hacer nada. syncBuiltinESMExports() propaga el cambio a
// los `import { rmSync } from 'node:fs'` del harness. Las lecturas (existsSync, lstatSync, realpathSync, readFileSync) quedan
// intactas: son lo que necesita la guarda de --trabajo.
import childProcess from 'node:child_process'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'

const registro = process.env.QA_F9_REGISTRO
// Anotación por descriptor (openSync/writeSync no se sustituyen): appendFileSync llamaría internamente a writeFileSync.
const { openSync, writeSync, closeSync } = fs
function anotar(texto) {
  const fd = openSync(registro, 'a')
  try { writeSync(fd, texto) } finally { closeSync(fd) }
}
function trampa(nombre) {
  return (...args) => {
    anotar(`${JSON.stringify({ llamada: nombre, destino: String(args[0]).slice(0, 300) })}\n`)
    throw new Error(`trampa de prueba: ${nombre} bloqueado`)
  }
}
for (const n of ['rmSync', 'rmdirSync', 'unlinkSync', 'mkdirSync', 'writeFileSync', 'appendFileSync', 'renameSync', 'cpSync', 'copyFileSync', 'symlinkSync', 'truncateSync']) fs[n] = trampa(`fs.${n}`)
for (const n of ['rm', 'rmdir', 'unlink', 'mkdir', 'writeFile', 'rename', 'cp']) fs.promises[n] = trampa(`fs.promises.${n}`)
for (const n of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[n] = trampa(`child_process.${n}`)
globalThis.fetch = trampa('fetch')
syncBuiltinESMExports()
