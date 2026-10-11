// Validación de la carpeta de SALIDA del constructor del build de lectura mixta (ML-01). Lógica pura (fs inyectado) para probarla SIN
// borrar nada. Reglas: la salida debe ser una carpeta NUEVA y dedicada; nunca la raíz del proyecto, un ancestro, una carpeta de
// código/configuración/evidencia ni una carpeta existente ajena. Reemplazar un artefacto propio exige `--reemplazar` Y la marca
// del manifiesto propio; aun así solo se borran los hijos conocidos (dist, servidor, manifiesto), nunca la carpeta entera.
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export const MARCA = 'manifiesto-lectura-mixta.json'
export const HIJOS_PROPIOS = ['dist', 'servidor', MARCA]
const PROTEGIDAS = ['.git', '.codex', '.claude', 'node_modules', 'src', 'public', 'supabase', 'docs', 'scripts', 'cloudflare', 'functions', 'tests', 'dist', 'worker', 'workers', 'icons']

const dentroDe = (raiz, ruta) => { const r = relative(raiz, ruta); return r !== '' && !r.startsWith('..') && !isAbsolute(r) }

/** Devuelve { ok, salida, reemplazo } o { ok:false, motivo }. `fs` = { existe(ruta), esCarpeta(ruta), leerMarca(ruta) } */
export function validarSalida({ salida, raiz, reemplazar = false, fs }) {
  if (!salida || typeof salida !== 'string') return { ok: false, motivo: 'falta --salida' }
  const ruta = resolve(salida)
  const base = resolve(raiz)
  if (dirname(ruta) === ruta) return { ok: false, motivo: 'la salida no puede ser la raíz de una unidad' }
  // Identidad según la semántica del sistema de archivos (en Windows C:/WedJaiseReact y c:/wedjaisereact son la MISMA ruta).
  if (relative(base, ruta) === '') return { ok: false, motivo: 'la salida no puede ser la raíz del proyecto' }
  if (dentroDe(ruta, base)) return { ok: false, motivo: 'la salida no puede ser un ancestro del proyecto' }
  if (dentroDe(base, ruta)) {
    const primero = relative(base, ruta).split(sep)[0].toLowerCase()
    const segundo = relative(base, ruta).split(sep)[1]
    // dentro del proyecto solo se permite una subcarpeta NUEVA y dedicada de .codex (evidencia local, no versionada)
    if (primero === '.codex') {
      if (!segundo) return { ok: false, motivo: 'la salida no puede ser .codex: use una subcarpeta dedicada' }
    } else if (PROTEGIDAS.includes(primero) || primero.startsWith('.')) {
      return { ok: false, motivo: `la salida cae en una carpeta protegida del proyecto (${primero})` }
    } else {
      return { ok: false, motivo: 'dentro del proyecto solo se admite una subcarpeta dedicada de .codex' }
    }
  }
  if (!basename(ruta) || basename(ruta).startsWith('.')) return { ok: false, motivo: 'nombre de carpeta de salida inválido' }
  if (!fs.existe(ruta)) return { ok: true, salida: ruta, reemplazo: false }
  if (!fs.esCarpeta(ruta)) return { ok: false, motivo: 'la salida existe y no es una carpeta' }
  if (!reemplazar) return { ok: false, motivo: 'la salida ya existe: use una carpeta nueva o --reemplazar sobre un artefacto propio' }
  const marca = fs.leerMarca(ruta)
  if (!marca || marca.tipo !== 'reversión con lectura mixta + B') return { ok: false, motivo: 'la carpeta existente no es un artefacto propio (falta la marca del manifiesto): no se reemplaza' }
  return { ok: true, salida: ruta, reemplazo: true }
}

/** El temporal solo se borra si es una carpeta propia dentro del directorio temporal del sistema. */
export function temporalPropio({ tmp, tmpdir }) {
  const ruta = resolve(tmp)
  return dentroDe(resolve(tmpdir), ruta) && basename(ruta).startsWith('lectura-mixta-') && dirname(ruta) === resolve(tmpdir)
}
