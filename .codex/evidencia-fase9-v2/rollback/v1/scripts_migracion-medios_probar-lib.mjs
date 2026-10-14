// Pruebas unitarias (sin red) de scripts/migracion-medios/lib.mjs y de garantías estáticas de la herramienta.
// Uso: node scripts/migracion-medios/probar-lib.mjs [--salida=archivo.json]
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  COLUMNAS, DESTINOS_R2, PRIVACIDAD, clasificarValor, decidirAlcance, idDeFuente, parsearArgumentos, rechazoDeAmbiente,
  rutaSegura, uuidV5, validarManifiesto, valorNuevo,
} from './lib.mjs'

const aqui = dirname(fileURLToPath(import.meta.url))
const casos = []
function caso(nombre, fn) {
  try { fn(); casos.push({ nombre, ok: true }); console.log(`OK    ${nombre}`) } catch (e) { casos.push({ nombre, ok: false, error: e.message }); console.log(`FALLA ${nombre}\n      ${e.message}`) }
}
const col = (t, c) => COLUMNAS.find((x) => x.tabla === t && x.columna === c)
const SUPA = 'http://127.0.0.1:54321'
const ctx = { supabaseUrl: SUPA, basesMedios: ['https://medios.ejemplo.dev/medios'], existeAssetBuild: (r) => r.startsWith('inicio-web/') }
const OBJ = { bytes: 1000, mime: 'image/webp' }

caso('UUID v5: vector conocido de RFC 9562 (espacio DNS, "www.example.com")', () => {
  assert.equal(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'), '2ed6657d-e927-568b-95e1-2665a8aea6a2')
})
caso('UUID v5: determinista por fuente y distinto si cambia ambiente, bucket, ruta o contenido', () => {
  const base = { ambiente: '127.0.0.1:54321', bucket: 'fotos-productos', ruta: 'a.webp', sha: 'a'.repeat(64) }
  assert.equal(idDeFuente(base), idDeFuente({ ...base }))
  for (const k of ['ambiente', 'bucket', 'ruta', 'sha']) assert.notEqual(idDeFuente(base), idDeFuente({ ...base, [k]: base[k] + 'x' }))
  assert.match(idDeFuente(base), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})
caso('Clasificación: formatos vistos en Local y en el contrato de la Fase 3', () => {
  const p = col('productos', 'foto_url'), g = col('galeria_web', 'antes_url')
  assert.equal(clasificarValor(p, null, ctx).formato, 'vacia')
  assert.equal(clasificarValor(p, '', ctx).formato, 'vacia')
  assert.deepEqual(clasificarValor(p, 'ruta/p.webp', ctx), { formato: 'supabase-ruta', bucket: 'fotos-productos', ruta: 'ruta/p.webp' })
  assert.equal(clasificarValor(p, 'r2:fotos-productos/0d1c3a4e-1b2c-4d5e-8f90-123456789abc', ctx).formato, 'r2')
  assert.equal(clasificarValor(p, 'r2:fotos-productos/no-uuid', ctx).formato, 'invalida')
  assert.equal(clasificarValor(p, 'r2:comprobantes-pedidos-web/0d1c3a4e-1b2c-4d5e-8f90-123456789abc', ctx).formato, 'invalida')
  assert.equal(clasificarValor(p, '../otro/x.webp', ctx).formato, 'invalida')
  assert.equal(clasificarValor(p, '/abs.webp', ctx).formato, 'invalida')
  const urlGal = `${SUPA}/storage/v1/object/public/fotos-galeria/75560750-c6d5-44a9-861f-afaf41141b24.webp`
  assert.deepEqual(clasificarValor(g, urlGal, ctx), { formato: 'supabase-url', bucket: 'fotos-galeria', ruta: '75560750-c6d5-44a9-861f-afaf41141b24.webp' })
  assert.equal(clasificarValor(g, 'https://cmkelllerzjqjbsqsylc.supabase.co/storage/v1/object/public/fotos-galeria/x.webp', ctx).formato, 'supabase-url-ajena')
  assert.equal(clasificarValor(g, 'https://medios.ejemplo.dev/medios/fotos-galeria/0d1c3a4e-1b2c-4d5e-8f90-123456789abc/g.webp', ctx).formato, 'r2-url')
  assert.equal(clasificarValor(g, 'inicio-web/hero-antes-referencia.jpg', ctx).formato, 'asset-build')
  assert.equal(clasificarValor(g, 'TEST/antes.png', ctx).detalle, 'no existe en public/')
  assert.equal(clasificarValor(g, 'https://otro.sitio/foto.jpg', ctx).formato, 'externa')
  assert.equal(clasificarValor(col('mobiliario', 'foto_url'), 'https://tienda.x/silla.jpg', ctx).formato, 'externa')
})
caso('Alcance: solo públicos de catálogo existentes y de tipo imagen; privados y perfiles nunca', () => {
  const p = col('productos', 'foto_url')
  const ok = clasificarValor(p, 'a/b.webp', ctx)
  assert.equal(decidirAlcance(ok, OBJ).migrar, true)
  assert.equal(decidirAlcance(ok, undefined).motivo, 'rota: el objeto no existe en Storage')
  assert.equal(decidirAlcance(ok, { bytes: 1, mime: 'image/gif' }).migrar, false)
  assert.equal(decidirAlcance(ok, { bytes: 1, mime: 'image/svg+xml' }).migrar, false)
  const priv = clasificarValor(col('pedidos_web', 'comprobante_url'), 'u/c.webp', ctx)
  assert.deepEqual([decidirAlcance(priv, OBJ).migrar, decidirAlcance(priv, OBJ).privacidad], [false, 'privado'])
  const privUrl = clasificarValor(col('galeria_web', 'antes_url'), `${SUPA}/storage/v1/object/public/comprobantes-pedidos-web/u/c.webp`, ctx)
  assert.equal(decidirAlcance(privUrl, OBJ).privacidad, 'privado', 'una URL de galería que apunte a un bucket privado tampoco se migra')
  for (const [t, c] of [['usuarios', 'foto_url'], ['clientes', 'foto_url'], ['asistentes', 'foto_url']]) {
    const x = decidirAlcance(clasificarValor(col(t, c), 'u/f.webp', ctx), OBJ)
    assert.equal(x.migrar, false); assert.equal(x.privacidad, 'publico-personal')
  }
  assert.equal(decidirAlcance(clasificarValor(col('estado_negocio', 'yape_qr_url'), 'yape.webp', ctx), OBJ).migrar, false)
})
caso('Valor nuevo: «r2:…» en columnas de ruta y URL completa de la variante g en galería (como guarda la app)', () => {
  const id = '0d1c3a4e-1b2c-4d5e-8f90-123456789abc'
  assert.equal(valorNuevo(col('productos', 'foto_url'), 'fotos-productos', id), `r2:fotos-productos/${id}`)
  assert.equal(valorNuevo(col('galeria_web', 'despues_url'), 'fotos-galeria', id, 'https://m.x/medios/'), `https://m.x/medios/fotos-galeria/${id}/g.webp`)
  assert.throws(() => valorNuevo(col('galeria_web', 'despues_url'), 'fotos-galeria', id, null), /base pública/)
})
caso('Guarda de ambiente: local libre; remoto exige host exacto; producción exige además su permiso', () => {
  assert.equal(rechazoDeAmbiente({ url: 'http://127.0.0.1:54321' }), null)
  assert.match(rechazoDeAmbiente({ url: 'https://x.workers.dev' }), /permitir-remoto=x\.workers\.dev/)
  assert.match(rechazoDeAmbiente({ url: 'http://x.dev' }), /https/)
  assert.equal(rechazoDeAmbiente({ url: 'https://x.workers.dev', permitirRemoto: 'x.workers.dev' }), null)
  assert.match(rechazoDeAmbiente({ url: 'https://x.workers.dev', permitirRemoto: 'y.workers.dev' }), /exige/)
  const prod = 'https://cmkelllerzjqjbsqsylc.supabase.co'
  assert.match(rechazoDeAmbiente({ url: prod, permitirRemoto: 'cmkelllerzjqjbsqsylc.supabase.co', refProduccion: 'cmkelllerzjqjbsqsylc' }), /PRODUCCIÓN/)
  assert.equal(rechazoDeAmbiente({ url: prod, permitirRemoto: 'cmkelllerzjqjbsqsylc.supabase.co', permitirProduccion: true, refProduccion: 'cmkelllerzjqjbsqsylc' }), null)
})
caso('Argumentos estrictos: --aplicar sin valor, números validados, opciones desconocidas rechazadas', () => {
  const esp = { flags: ['aplicar'], textos: ['manifiesto'], numeros: { lote: [1, 500] } }
  assert.deepEqual(parsearArgumentos(['copiar', '--aplicar', '--lote=3', '--manifiesto=m.json'], esp), { comando: 'copiar', aplicar: true, lote: 3, manifiesto: 'm.json' })
  assert.throws(() => parsearArgumentos(['copiar', '--aplicar=false'], esp), /no admite valor/)
  assert.throws(() => parsearArgumentos(['copiar', '--lote=0'], esp), /entre 1 y 500/)
  assert.throws(() => parsearArgumentos(['copiar', '--lote=-1'], esp), /entero/)
  assert.throws(() => parsearArgumentos(['copiar', '--borrar'], esp), /desconocida/)
  assert.throws(() => parsearArgumentos(['--aplicar'], esp), /subcomando/)
})
caso('Rutas seguras dentro de un bucket', () => {
  for (const r of ['a.webp', 'uid/x.webp', 'ruta/p.webp']) assert.equal(rutaSegura(r), true, r)
  for (const r of ['', '/a', 'a//b', '../a', 'a/./b', 'a?b', 'a#b', 'a\\b', 'a\u0000']) assert.equal(rutaSegura(r), false, JSON.stringify(r))
})
caso('Manifiesto: rechaza destinos/buckets fuera del catálogo, ids duplicados y referencias de otra columna', () => {
  const e = (x = {}) => ({ id: '0d1c3a4e-1b2c-4d5e-8f90-123456789abc', destino: 'fotos-productos', estado: 'planificada', origen: { bucket: 'fotos-productos', ruta: 'a.webp', sha256: 'a'.repeat(64) }, referencias: [{ tabla: 'productos', columna: 'foto_url', fila: '1', estado: 'pendiente' }], ...x })
  assert.deepEqual(validarManifiesto({ entradas: [e()] }), [])
  assert.ok(validarManifiesto({ entradas: [e({ destino: 'comprobantes-pedidos-web' })] }).length)
  assert.ok(validarManifiesto({ entradas: [e({ origen: { bucket: 'comprobantes-citas-web', ruta: 'a', sha256: 'a'.repeat(64) } })] }).length)
  assert.ok(validarManifiesto({ entradas: [e({ origen: { bucket: 'fotos-usuarios', ruta: 'a', sha256: 'a'.repeat(64) } })] }).length)
  assert.ok(validarManifiesto({ entradas: [e(), e()] }).some((x) => /duplicado/.test(x)))
  assert.ok(validarManifiesto({ entradas: [e({ referencias: [{ tabla: 'servicios', columna: 'foto_url', fila: '1', estado: 'pendiente' }] })] }).length)
  assert.ok(validarManifiesto({ entradas: [e({ origen: { bucket: 'fotos-productos', ruta: 'a', sha256: 'etag' } })] }).some((x) => /SHA-256/.test(x)))
})
caso('Tabla de privacidad: los destinos R2 son exactamente los públicos de catálogo; comprobantes privados', () => {
  assert.deepEqual(Object.keys(PRIVACIDAD).filter((b) => PRIVACIDAD[b] === 'publico-catalogo').sort(), [...DESTINOS_R2].sort())
  assert.equal(PRIVACIDAD['comprobantes-pedidos-web'], 'privado'); assert.equal(PRIVACIDAD['comprobantes-citas-web'], 'privado')
})
caso('Garantía estática: la herramienta no tiene operaciones de borrado (Storage remove, DELETE al Worker, delete de filas)', () => {
  for (const f of ['lib.mjs', 'medios-migracion.mjs']) {
    const s = readFileSync(join(aqui, f), 'utf8').replace(/\/\/.*$/gm, '')
    assert.doesNotMatch(s, /\.remove\(|method:\s*['"]DELETE['"]|\.delete\(\)|storage\.from\([^)]*\)\.(remove|move|update)/, f)
  }
})
caso('Garantía estática: las escrituras de referencias son condicionales al valor esperado', () => {
  const s = readFileSync(join(aqui, 'medios-migracion.mjs'), 'utf8')
  assert.match(s, /\.update\(\{ \[ref\.columna\]: a \}\)\.eq\('id', ref\.fila\)\.eq\(ref\.columna, de\)/)
  assert.equal((s.match(/\.update\(/g) ?? []).length, 1, 'un solo punto de UPDATE en toda la herramienta')
})

const fallos = casos.filter((c) => !c.ok)
const salida = process.argv.find((a) => a.startsWith('--salida='))?.slice(9)
if (salida) writeFileSync(salida, JSON.stringify({ fecha: new Date().toISOString(), total: casos.length, fallos: fallos.length, casos }, null, 1))
console.log(`\n${casos.length - fallos.length}/${casos.length} correctos`)
process.exit(fallos.length ? 1 : 0)
