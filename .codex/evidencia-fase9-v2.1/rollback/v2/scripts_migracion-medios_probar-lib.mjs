// Pruebas unitarias (sin red) de scripts/migracion-medios/lib.mjs y de garantías estáticas de la herramienta.
// Uso: node scripts/migracion-medios/probar-lib.mjs [--salida=archivo.json]
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  COLUMNAS, DESTINOS_R2, PRIVACIDAD, VERSION_MANIFIESTO, clasificarValor, decidirAlcance, idDeFuente, normalizarBase,
  parsearArgumentos, rechazoDeAmbiente, rechazoDeVinculo, rutaSegura, uuidV5, validarManifiesto, valorNuevo, valorParaInforme,
} from './lib.mjs'
import { MARCA_TRABAJO, TIPO_MARCA, prepararTrabajo, validarTrabajo } from './trabajo-seguro.mjs'

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
  assert.match(rechazoDeAmbiente({ url: 'https://x.workers.dev', rol: 'worker' }), /permitir-worker=x\.workers\.dev/)
  assert.match(rechazoDeAmbiente({ url: 'http://x.dev' }), /https/)
  assert.equal(rechazoDeAmbiente({ url: 'https://x.workers.dev', rol: 'worker', permitido: 'x.workers.dev' }), null)
  assert.match(rechazoDeAmbiente({ url: 'https://x.workers.dev', rol: 'worker', permitido: 'y.workers.dev' }), /exige/)
  const prod = 'https://cmkelllerzjqjbsqsylc.supabase.co'
  assert.match(rechazoDeAmbiente({ url: prod, permitido: 'cmkelllerzjqjbsqsylc.supabase.co', refProduccion: 'cmkelllerzjqjbsqsylc' }), /PRODUCCIÓN/)
  assert.equal(rechazoDeAmbiente({ url: prod, permitido: 'cmkelllerzjqjbsqsylc.supabase.co', permitirProduccion: true, refProduccion: 'cmkelllerzjqjbsqsylc' }), null)
})
caso('F9-06 · Permisos por función: tres hosts distintos se autorizan a la vez; intercambio de roles y rol desconocido fallan', () => {
  const H = { supabase: 'db.qa.invalid', worker: 'worker.qa.invalid', lectura: 'pages.qa.invalid' }
  for (const [rol, host] of Object.entries(H)) assert.equal(rechazoDeAmbiente({ url: `https://${host}`, rol, permitido: host }), null, rol)
  // Cada host solo con el permiso de SU función: con el de cualquier otra, rechazo.
  for (const [rol, host] of Object.entries(H)) for (const [otro, permitido] of Object.entries(H)) if (otro !== rol) assert.match(rechazoDeAmbiente({ url: `https://${host}`, rol, permitido }), new RegExp(`permitir-${rol}=`))
  assert.match(rechazoDeAmbiente({ url: 'https://x.dev', rol: 'remoto', permitido: 'x.dev' }), /rol de destino desconocido/)
  // Producción exige su permiso adicional aunque llegue por otro rol.
  assert.match(rechazoDeAmbiente({ url: 'https://cmkelllerzjqjbsqsylc.supabase.co', rol: 'lectura', permitido: 'cmkelllerzjqjbsqsylc.supabase.co', refProduccion: 'cmkelllerzjqjbsqsylc' }), /PRODUCCIÓN/)
})
caso('F9-02 · Identidad canónica y vínculo manifiesto ↔ ambiente (Supabase, Worker y base de lectura)', () => {
  assert.equal(normalizarBase('HTTPS://Proyecto.Supabase.co:443/'), 'https://proyecto.supabase.co')
  assert.equal(normalizarBase('http://127.0.0.1:54321'), 'http://127.0.0.1:54321')
  assert.notEqual(normalizarBase('https://proxy.x/a'), normalizarBase('https://proxy.x/b'), 'el prefijo de ruta distingue bases detrás de un proxy')
  for (const malo of ['https://u:p@x.dev', 'https://x.dev/?a=1', 'https://x.dev/#h', 'ftp://x.dev', 'no-url']) assert.throws(() => normalizarBase(malo), malo)
  const m = { version: VERSION_MANIFIESTO, ambiente: 'http://127.0.0.1:54321', publica: 'http://127.0.0.1:8799', api: 'http://127.0.0.1:8799', lectura: 'http://127.0.0.1:8799' }
  assert.deepEqual(rechazoDeVinculo(m, { supabase: 'http://127.0.0.1:54321', api: 'http://127.0.0.1:8799', lectura: 'http://127.0.0.1:8799' }), [])
  assert.match(rechazoDeVinculo(m, { supabase: 'http://127.0.0.1:1' }).join(), /es de http:\/\/127\.0\.0\.1:54321/)
  assert.match(rechazoDeVinculo(m, { supabase: m.ambiente, api: 'http://127.0.0.1:9999' }).join(), /Worker/)
  assert.match(rechazoDeVinculo(m, { supabase: m.ambiente, lectura: 'http://127.0.0.1:9999' }).join(), /lectura/)
  assert.match(rechazoDeVinculo({ ...m, version: 1, ambiente: '127.0.0.1:54321' }, { supabase: m.ambiente }).join(), /versión 1/)
  // Un manifiesto que aún no fija Worker ni lectura solo exige que la lectura sea la base pública de la galería.
  assert.deepEqual(rechazoDeVinculo({ ...m, api: null, lectura: null }, { supabase: m.ambiente, api: 'http://127.0.0.1:1', lectura: 'http://127.0.0.1:8799' }), [])
  assert.match(rechazoDeVinculo({ ...m, api: null, lectura: null }, { supabase: m.ambiente, lectura: 'http://127.0.0.1:1' }).join(), /base pública/)
})
caso('F9-05 · URLs de Storage: manda el bucket REAL; firmadas/autenticadas, privadas o desconocidas son privadas y no salen al informe', () => {
  const columnas = [col('galeria_web', 'antes_url'), col('pedidos_web', 'comprobante_url'), col('productos', 'foto_url')]
  const TOKEN = 'eyJTOKENFICTICIO.QA.F9'
  for (const origen of [SUPA, 'https://otro-proyecto.qa.invalid', 'https://proxy.qa.invalid/prefijo']) {
    for (const endpoint of ['sign', 'authenticated', 'public']) {
      for (const bucket of ['comprobantes-pedidos-web', 'comprobantes-citas-web', 'bucket-desconocido']) {
        const valor = `${origen}/storage/v1/object/${endpoint}/${bucket}/qa-sensible/foto.png?token=${TOKEN}`
        for (const c of columnas) {
          const cl = clasificarValor(c, valor, ctx); const al = decidirAlcance(cl, OBJ)
          assert.equal(al.privacidad, 'privado', `${origen} ${endpoint} ${bucket} ${c.tabla}`); assert.equal(al.migrar, false)
          assert.equal(valorParaInforme(valor, al), null)
          assert.ok(!JSON.stringify({ cl, al }).includes('qa-sensible') && !JSON.stringify({ cl, al }).includes(TOKEN), 'la clasificación no arrastra ruta ni token')
        }
      }
    }
    // Endpoints firmados de un bucket PÚBLICO también se tratan como privados (llevan token).
    assert.equal(decidirAlcance(clasificarValor(col('galeria_web', 'antes_url'), `${origen}/storage/v1/object/sign/fotos-galeria/x.webp?token=${TOKEN}`, ctx), OBJ).privacidad, 'privado')
  }
  // Las públicas normales de catálogo siguen igual: propia migrable, ajena a revisión manual (con su bucket real).
  const g = col('galeria_web', 'antes_url')
  assert.deepEqual(clasificarValor(g, `${SUPA}/storage/v1/object/public/fotos-galeria/a.webp`, ctx), { formato: 'supabase-url', bucket: 'fotos-galeria', ruta: 'a.webp' })
  const ajena = clasificarValor(g, 'https://otro.qa.invalid/storage/v1/object/public/fotos-productos/a.webp', ctx)
  assert.deepEqual([ajena.formato, ajena.bucket, decidirAlcance(ajena, OBJ).privacidad], ['supabase-url-ajena', 'fotos-productos', 'publico-catalogo'])
  // Otras URL no migrables pierden la query en el informe; las migrables quedan exactas (son el «original» del UPDATE).
  assert.equal(valorParaInforme('https://otro.sitio/f.jpg?firma=abc#x', { privacidad: 'sin-bucket', migrar: false }), 'https://otro.sitio/f.jpg?<omitido>')
  assert.equal(valorParaInforme('https://otro.sitio/f.jpg', { privacidad: 'sin-bucket', migrar: false }), 'https://otro.sitio/f.jpg')
  assert.equal(valorParaInforme('a/b.webp', { privacidad: 'publico-catalogo', migrar: true }), 'a/b.webp')
})
caso('F9-01 · Carpeta de trabajo: raíz, ancestro, proyecto, .codex, src, ajena, alias y enlace se rechazan con CERO borrados', () => {
  // Sistema de archivos ficticio (Windows): nada real se toca. Cada operación con efecto se registra y falla.
  const RAIZ = 'C:\\WedJaiseReact', TMP = 'C:\\Users\\qa\\AppData\\Local\\Temp'
  const existentes = new Map([
    ['c:\\', 'dir'], ['c:\\users', 'dir'], ['c:\\users\\qa', 'dir'], ['c:\\users\\qa\\appdata', 'dir'], ['c:\\users\\qa\\appdata\\local', 'dir'], [TMP.toLowerCase(), 'dir'],
    [RAIZ.toLowerCase(), 'dir'], ['c:\\wedjaisereact\\src', 'dir'], ['c:\\wedjaisereact\\.codex', 'dir'],
    [`${TMP}\\sim-f9-ajena`.toLowerCase(), 'dir'], [`${TMP}\\sim-f9-propia`.toLowerCase(), 'dir'], [`${TMP}\\sim-f9-propia\\corrida`.toLowerCase(), 'dir'],
    [`${TMP}\\sim-f9-enlace`.toLowerCase(), 'enlace'], [`${TMP}\\sim-f9-archivo`.toLowerCase(), 'archivo'],
  ])
  const reales = new Map([[`${TMP}\\sim-f9-junction`.toLowerCase(), 'C:\\WedJaiseReact\\src']]) // junction en tmp → src del proyecto
  existentes.set(`${TMP}\\sim-f9-junction`.toLowerCase(), 'dir')
  const llamadas = []
  const fs = {
    existe: (r) => existentes.has(r.toLowerCase()),
    lstat: (r) => { const t = existentes.get(r.toLowerCase()); return { isSymbolicLink: () => t === 'enlace', isDirectory: () => t === 'dir' } },
    realpath: (r) => reales.get(r.toLowerCase()) ?? r,
    leerMarca: (r) => (r.toLowerCase() === `${TMP}\\sim-f9-propia\\${MARCA_TRABAJO}`.toLowerCase() ? { tipo: TIPO_MARCA } : null),
    crearCarpeta: (r) => { llamadas.push(['crear', r]); throw new Error('doble: no crea') },
    escribirMarca: (r) => { llamadas.push(['marca', r]); throw new Error('doble: no escribe') },
    borrarRecursivo: (r) => { llamadas.push(['borrar', r]); throw new Error('doble: no borra') },
  }
  const v = (ruta) => validarTrabajo({ ruta, raiz: RAIZ, tmp: TMP, fs, plataforma: 'win32' })
  const rechazos = {
    'raíz de unidad': 'C:\\', ancestro: 'C:\\Users', proyecto: RAIZ, 'proyecto en minúsculas': 'c:\\wedjaisereact', '.codex': `${RAIZ}\\.codex`,
    src: `${RAIZ}\\src`, 'src con otra capitalización': 'c:\\WEDJAISEREACT\\SRC', 'nueva dentro del proyecto': `${RAIZ}\\sim-f9-x`,
    'el temporal mismo': TMP, 'nombre no dedicado en tmp': `${TMP}\\otra`, 'existente ajena (sin marca)': `${TMP}\\sim-f9-ajena`,
    'enlace en tmp': `${TMP}\\sim-f9-enlace`, 'archivo en tmp': `${TMP}\\sim-f9-archivo`, 'junction en tmp hacia src': `${TMP}\\sim-f9-junction`, vacía: '',
  }
  const motivos = {}
  for (const [nombre, ruta] of Object.entries(rechazos)) {
    const r = v(ruta); assert.equal(r.ok, false, nombre); motivos[nombre] = r.motivo
    assert.throws(() => prepararTrabajo(r, fs), /validación correcta/, `${nombre}: prepararTrabajo no actúa sin validación correcta`)
  }
  assert.deepEqual(llamadas, [], 'cero creaciones y cero borrados en todos los rechazos')
  // Aceptadas: carpeta propia existente (solo se vacía corrida/) y carpeta nueva dedicada (se crea con su marca).
  const propia = v(`${TMP}\\sim-f9-propia`); assert.deepEqual([propia.ok, propia.nueva], [true, false])
  const nueva = v(`${TMP}\\sim-f9-nueva`); assert.deepEqual([nueva.ok, nueva.nueva], [true, true])
  const permisivo = { ...fs, crearCarpeta: (r) => llamadas.push(['crear', r]), escribirMarca: (r) => llamadas.push(['marca', r]), borrarRecursivo: (r) => llamadas.push(['borrar', r]) }
  prepararTrabajo(propia, permisivo)
  assert.deepEqual(llamadas, [['borrar', `${TMP}\\sim-f9-propia\\corrida`], ['crear', `${TMP}\\sim-f9-propia\\corrida`]], 'solo su hijo conocido')
  return motivos
})
caso('Argumentos estrictos: --aplicar sin valor, números validados, opciones desconocidas rechazadas', () => {
  const esp = { flags: ['aplicar'], textos: ['manifiesto'], numeros: { lote: [1, 500] } }
  assert.deepEqual(parsearArgumentos(['copiar', '--aplicar', '--lote=3', '--manifiesto=m.json'], esp), { comando: 'copiar', aplicar: true, lote: 3, manifiesto: 'm.json' })
  assert.throws(() => parsearArgumentos(['copiar', '--aplicar=false'], esp), /no admite valor/)
  assert.throws(() => parsearArgumentos(['copiar', '--lote=0'], esp), /entre 1 y 500/)
  assert.throws(() => parsearArgumentos(['copiar', '--lote=-1'], esp), /entero/)
  assert.throws(() => parsearArgumentos(['copiar', '--borrar'], esp), /desconocida/)
  assert.throws(() => parsearArgumentos(['--aplicar'], esp), /subcomando/)
  // F9-06: repetir una opción no crea una lista ni gana la última: se rechaza.
  assert.throws(() => parsearArgumentos(['copiar', '--manifiesto=a', '--manifiesto=b'], esp), /repetida/)
  assert.throws(() => parsearArgumentos(['copiar', '--aplicar', '--aplicar'], esp), /repetida/)
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
caso('F9-01 · Garantía estática del harness: valida --trabajo antes de cualquier efecto y nunca borra la carpeta entera', () => {
  const s = readFileSync(join(aqui, 'simular-fase9.mjs'), 'utf8')
  const cuerpo = s.split('\n').filter((l) => !/^import /.test(l)).join('\n').replace(/\/\/.*$/gm, '')
  const guarda = cuerpo.indexOf('validarTrabajo(')
  assert.ok(guarda > 0, 'el harness llama a validarTrabajo')
  for (const efecto of ['readFileSync(', 'execFileSync(', 'rmSync(', 'mkdirSync(', 'writeFileSync(', 'spawn(', 'spawnSync(', 'createClient(', 'fetch(']) {
    const i = cuerpo.indexOf(efecto)
    assert.ok(i === -1 || i > guarda, `${efecto} aparece antes de la guarda`)
  }
  assert.match(cuerpo.slice(guarda, guarda + 400), /process\.exit\(2\)/, 'un rechazo termina el proceso')
  assert.doesNotMatch(cuerpo, /rmSync\(TRABAJO\b/, 'nunca rmSync de la carpeta de trabajo entera')
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
