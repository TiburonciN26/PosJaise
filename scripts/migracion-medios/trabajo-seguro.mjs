// Fase 9 V2 (F9-01) · Carpeta de trabajo de la simulación local. La simulación borra y recrea sus artefactos entre corridas,
// así que la carpeta se valida ANTES de cualquier borrado, creación de carpeta o conexión. Mismos principios que
// scripts/lib/salida-segura.mjs, adaptados:
//   · Solo una carpeta dedicada `sim-f9` o `sim-f9-<sufijo>` DENTRO de la carpeta temporal del sistema (nunca ella misma).
//   · Identidad real del sistema de archivos: se resuelven alias (mayúsculas, nombres cortos 8.3, enlaces y junctions) del
//     tramo que existe; el proyecto, sus ancestros y todo lo que esté dentro del proyecto se rechazan siempre.
//   · Una carpeta que ya existe solo se reutiliza si es propia (marca de propiedad escrita al crearla) y no es un enlace.
//   · Nunca se borra la carpeta propia: solo su hijo conocido `corrida/`, donde la simulación deja todos sus artefactos.
// Lógica con `fs` inyectable: las pruebas la ejercen con dobles que registran y fallan antes de borrar.
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

export const MARCA_TRABAJO = '.sim-f9-propiedad.json'
export const TIPO_MARCA = 'simulacion-fase9-medios'
export const SUBCARPETA = 'corrida'
const RE_NOMBRE = /^sim-f9(-[a-z0-9]+)*$/i

export const fsReal = {
  existe: (r) => existsSync(r),
  lstat: (r) => lstatSync(r),
  realpath: (r) => realpathSync.native(r),
  leerMarca: (r) => { try { return JSON.parse(readFileSync(r, 'utf8')) } catch { return null } },
  crearCarpeta: (r) => mkdirSync(r, { recursive: true }),
  escribirMarca: (r, texto) => writeFileSync(r, texto, { flag: 'wx' }),
  borrarRecursivo: (r) => rmSync(r, { recursive: true, force: true }),
}

const enWindows = (plataforma) => plataforma === 'win32'
const clave = (ruta, plataforma) => (enWindows(plataforma) ? ruta.toLowerCase() : ruta)
function dentroDe(raiz, ruta, plataforma) {
  const r = relative(clave(raiz, plataforma), clave(ruta, plataforma))
  return r !== '' && !r.startsWith('..') && !isAbsolute(r)
}
const misma = (a, b, plataforma) => clave(resolve(a), plataforma) === clave(resolve(b), plataforma)

// Identidad real: resuelve el tramo que existe (realpath nativo) y le añade lo que aún no existe tal cual.
function identidadReal(ruta, fs) {
  let base = resolve(ruta)
  const resto = []
  while (!fs.existe(base)) {
    const padre = dirname(base)
    if (padre === base) break
    resto.unshift(basename(base))
    base = padre
  }
  return join(fs.existe(base) ? fs.realpath(base) : base, ...resto)
}

/**
 * Valida --trabajo SIN efectos (solo lee). Devuelve { ok, carpeta, nueva } o { ok:false, motivo }.
 * `raiz` = raíz del proyecto; `tmp` = carpeta temporal del sistema (inyectable en las pruebas).
 */
export function validarTrabajo({ ruta, raiz, tmp = tmpdir(), fs = fsReal, plataforma = process.platform }) {
  if (!ruta || typeof ruta !== 'string') return { ok: false, motivo: 'falta --trabajo' }
  const pedida = resolve(ruta)
  const real = identidadReal(pedida, fs)
  const raizReal = identidadReal(raiz, fs)
  const tmpReal = identidadReal(tmp, fs)
  for (const r of [pedida, real]) {
    if (dirname(r) === r) return { ok: false, motivo: 'no puede ser la raíz de una unidad' }
    if (misma(r, raizReal, plataforma) || dentroDe(r, raizReal, plataforma)) return { ok: false, motivo: 'no puede ser el proyecto ni un ancestro suyo' }
    if (dentroDe(raizReal, r, plataforma)) return { ok: false, motivo: 'no puede estar dentro del proyecto' }
  }
  if (!dentroDe(tmpReal, real, plataforma)) return { ok: false, motivo: `debe estar dentro de la carpeta temporal del sistema (${tmpReal}) y no ser ella misma` }
  if (!RE_NOMBRE.test(basename(real)) || !RE_NOMBRE.test(basename(pedida))) return { ok: false, motivo: 'el nombre debe ser sim-f9 o sim-f9-<sufijo> (carpeta dedicada)' }
  if (!fs.existe(pedida)) return { ok: true, carpeta: real, nueva: true }
  const st = fs.lstat(pedida)
  if (st.isSymbolicLink()) return { ok: false, motivo: 'es un enlace o junction: no se sigue' }
  if (!st.isDirectory()) return { ok: false, motivo: 'existe y no es una carpeta' }
  if (fs.leerMarca(join(real, MARCA_TRABAJO))?.tipo !== TIPO_MARCA) return { ok: false, motivo: 'existe y no es una carpeta propia de la simulación (falta la marca de propiedad): no se toca' }
  const corrida = join(real, SUBCARPETA)
  if (fs.existe(corrida) && fs.lstat(corrida).isSymbolicLink()) return { ok: false, motivo: `${SUBCARPETA}/ es un enlace o junction: no se sigue` }
  return { ok: true, carpeta: real, nueva: false }
}

/** Con una validación correcta: crea la carpeta propia (con su marca) si es nueva y deja `corrida/` vacía. Devuelve `corrida/`. */
export function prepararTrabajo(validacion, fs = fsReal) {
  if (!validacion?.ok) throw new Error('prepararTrabajo exige una validación correcta')
  if (validacion.nueva) {
    fs.crearCarpeta(validacion.carpeta)
    fs.escribirMarca(join(validacion.carpeta, MARCA_TRABAJO), `${JSON.stringify({ tipo: TIPO_MARCA, creada: new Date().toISOString() })}\n`)
  }
  const corrida = join(validacion.carpeta, SUBCARPETA)
  fs.borrarRecursivo(corrida) // solo el hijo conocido; nunca la carpeta propia ni nada fuera de ella
  fs.crearCarpeta(corrida)
  return corrida
}
