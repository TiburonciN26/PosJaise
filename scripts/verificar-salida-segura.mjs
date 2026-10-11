// Regresiones SIN borrados reales de la validación de la carpeta de salida del constructor (ML-01). El fs es un doble en memoria.
//   node scripts/verificar-salida-segura.mjs
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { HIJOS_PROPIOS, MARCA, temporalPropio, validarSalida } from './lib/salida-segura.mjs'

const resultados = []
function prueba(nombre, fn) {
  try { fn(); resultados.push({ nombre, ok: true }); console.log(`OK    ${nombre}`) } catch (e) { resultados.push({ nombre, ok: false }); console.log(`FALLA ${nombre}\n      ${String(e.message).split('\n')[0].slice(0, 300)}`) }
}

const RAIZ = resolve('C:/WedJaiseReact')
const fsDoble = ({ existentes = {}, marcas = {} } = {}) => ({
  existe: (r) => resolve(r) in existentes,
  esCarpeta: (r) => existentes[resolve(r)] !== 'archivo',
  leerMarca: (r) => marcas[resolve(r)] ?? null,
})
const validar = (salida, extra = {}, fs = fsDoble()) => validarSalida({ salida, raiz: RAIZ, fs, ...extra })
const PROPIO = { tipo: 'reversión con lectura mixta + B' }

prueba('salida nueva y dedicada bajo .codex o fuera del proyecto → aceptada', () => {
  for (const s of ['C:/WedJaiseReact/.codex/artefacto-mixto-nuevo', 'C:/artefactos/lectura-mixta', 'D:/salidas/x']) assert.equal(validar(s).ok, true, s)
})
prueba('rechaza la raíz del proyecto, sus ancestros y la raíz de una unidad', () => {
  for (const s of ['C:/WedJaiseReact', 'C:/WedJaiseReact/', 'C:/', 'C:/WedJaiseReact/.codex/..']) assert.equal(validar(s).ok, false, s)
})
prueba('rechaza .codex como carpeta de salida y subcarpetas de código/configuración/evidencia/dist', () => {
  for (const s of ['C:/WedJaiseReact/.codex', 'C:/WedJaiseReact/src', 'C:/WedJaiseReact/src/lib', 'C:/WedJaiseReact/scripts', 'C:/WedJaiseReact/docs/evidencia-rendimiento', 'C:/WedJaiseReact/supabase', 'C:/WedJaiseReact/functions', 'C:/WedJaiseReact/cloudflare', 'C:/WedJaiseReact/dist', 'C:/WedJaiseReact/.git', 'C:/WedJaiseReact/node_modules/x', 'C:/WedJaiseReact/otra']) {
    assert.equal(validar(s).ok, false, s)
  }
})
prueba('rechaza una salida existente por defecto (carpeta ajena, archivo o artefacto propio sin --reemplazar)', () => {
  const ajena = resolve('C:/artefactos/ajena')
  const propia = resolve('C:/artefactos/propia')
  const fs = fsDoble({ existentes: { [ajena]: 'carpeta', [propia]: 'carpeta', [resolve('C:/artefactos/archivo')]: 'archivo' }, marcas: { [propia]: PROPIO } })
  for (const s of [ajena, propia, 'C:/artefactos/archivo']) assert.equal(validar(s, {}, fs).ok, false, s)
})
prueba('--reemplazar solo sobre un artefacto PROPIO (marca del manifiesto); una carpeta ajena o con otra marca se rechaza', () => {
  const ajena = resolve('C:/artefactos/ajena')
  const otra = resolve('C:/artefactos/otra')
  const propia = resolve('C:/artefactos/propia')
  const fs = fsDoble({ existentes: { [ajena]: 'carpeta', [otra]: 'carpeta', [propia]: 'carpeta' }, marcas: { [otra]: { tipo: 'otra cosa' }, [propia]: PROPIO } })
  assert.equal(validar(ajena, { reemplazar: true }, fs).ok, false)
  assert.equal(validar(otra, { reemplazar: true }, fs).ok, false)
  const ok = validar(propia, { reemplazar: true }, fs)
  assert.equal(ok.ok, true)
  assert.equal(ok.reemplazo, true)
})
prueba('--reemplazar nunca habilita la raíz, .codex ni carpetas protegidas aunque exista una marca', () => {
  const marcas = Object.fromEntries(['C:/WedJaiseReact', 'C:/WedJaiseReact/.codex', 'C:/WedJaiseReact/src'].map((r) => [resolve(r), PROPIO]))
  const existentes = Object.fromEntries(Object.keys(marcas).map((r) => [r, 'carpeta']))
  for (const s of ['C:/WedJaiseReact', 'C:/WedJaiseReact/.codex', 'C:/WedJaiseReact/src']) assert.equal(validar(s, { reemplazar: true }, fsDoble({ existentes, marcas })).ok, false, s)
})
prueba('ML-01b: en Windows la raíz con OTRA capitalización es la misma ruta: se rechaza aunque exista y tenga marca propia (--reemplazar)', () => {
  if (process.platform !== 'win32') return // en sistemas sensibles a mayúsculas esas rutas son distintas
  const variantes = ['c:/wedjaisereact', 'C:/WEDJAISEREACT', 'c:\\WedJaiseReact\\','C:/wedjaisereact/.codex', 'C:/WEDJAISEREACT/SRC', 'c:/wedjaisereact/Scripts']
  const existentes = Object.fromEntries(variantes.map((v) => [resolve(v), 'carpeta']))
  const marcas = Object.fromEntries(variantes.map((v) => [resolve(v), PROPIO]))
  for (const v of variantes) {
    assert.equal(validar(v, { reemplazar: true }, fsDoble({ existentes, marcas })).ok, false, v)
    assert.equal(validar(v, {}, fsDoble({ existentes, marcas })).ok, false, v)
  }
  // control: una subcarpeta dedicada de .codex con otra capitalización sí es válida si es nueva
  assert.equal(validar('c:/wedjaisereact/.CODEX/nueva-carpeta').ok, true)
})
prueba('solo se pueden borrar hijos conocidos del artefacto (dist, servidor, manifiesto), nunca la carpeta entera', () => {
  assert.deepEqual([...HIJOS_PROPIOS].sort(), ['dist', MARCA, 'servidor'].sort())
})
prueba('el temporal solo se borra si es una carpeta propia «lectura-mixta-*» directamente bajo el directorio temporal del sistema', () => {
  const TMP = resolve('C:/Users/x/AppData/Local/Temp')
  assert.equal(temporalPropio({ tmp: `${TMP}/lectura-mixta-AbC123`, tmpdir: TMP }), true)
  for (const t of [TMP, `${TMP}/otra-cosa`, `${TMP}/lectura-mixta-X/anidada`, 'C:/WedJaiseReact', 'C:/WedJaiseReact/.codex', `${TMP}/..`, 'C:/']) assert.equal(temporalPropio({ tmp: t, tmpdir: TMP }), false, t)
})

const fallos = resultados.filter((r) => !r.ok)
console.log(`\n${resultados.length} casos, ${fallos.length} fallos`)
process.exitCode = fallos.length ? 1 : 0
