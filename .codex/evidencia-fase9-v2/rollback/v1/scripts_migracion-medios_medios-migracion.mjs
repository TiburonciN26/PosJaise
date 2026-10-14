#!/usr/bin/env node
// Fase 9 · Migración de medios existentes de Supabase Storage a R2. CLI con subcomandos; diseño y procedimiento en
// .codex/DISENO-MIGRACION-MEDIOS-FASE9.md.
//
//   inventariar  lee referencias y objetos (SQL de solo lectura) y clasifica tipo/proveedor/privacidad/alcance.
//   planificar   descarga (GET de solo lectura) cada objeto público de catálogo referenciado, calcula SHA-256 y medidas y
//                arma/actualiza el MANIFIESTO (reanudable: lo ya planificado o copiado no se vuelve a planificar).
//   copiar       genera las variantes m/g (ffmpeg + el validador del Worker) y, con --aplicar, las sube por el Worker
//                autenticado (solo crea; nunca sobrescribe) y verifica por lectura que los bytes servidos coinciden.
//   actualizar   con --aplicar, cambia las referencias en lotes con UPDATE CONDICIONAL al valor anterior (si alguien cambió
//                la fila entretanto, queda en «conflicto» y no se toca). Cada cambio queda en el manifiesto (diario de reversión).
//   verificar    reconcilia manifiesto ↔ base ↔ R2 ↔ originales de Supabase.
//   revertir     con --aplicar, devuelve cada referencia actualizada a su valor original, también condicional.
//
// Sin --aplicar ningún comando escribe nada fuera del manifiesto y la caché local. NINGÚN comando borra: ni originales de
// Supabase ni copias en R2 (los borrados de huérfanos los decide el recolector con retención, fuera de esta herramienta).
// Destinos remotos: exigen --permitir-remoto=<host> (y --permitir-produccion para el Supabase del negocio).
import { spawnSync, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, openSync, closeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { inspeccionarWebp } from '../../cloudflare/medios-worker/src/validar-imagen.js'
import { REF_PRODUCCION } from '../lib/entornos-supabase.mjs'
import {
  BUCKETS_PRIVADOS, CALIDADES, COLUMNAS, DESTINOS_R2, PRIVACIDAD, VARIANTES, clasificarValor, decidirAlcance, idDeFuente,
  parsearArgumentos, rechazoDeAmbiente, resumenManifiesto, sha256, urlPublicaSupabase, validarManifiesto, valorNuevo,
} from './lib.mjs'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ESPERA = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------- utilidades ----------------
function leerEnv(archivo) {
  const env = {}
  for (const linea of readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
  return env
}
function escribirJson(archivo, datos) {
  mkdirSync(dirname(resolve(archivo)), { recursive: true })
  const tmp = `${archivo}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(datos, null, 1))
  renameSync(tmp, archivo) // reemplazo atómico: una interrupción nunca deja el manifiesto a medias
}
const leerJson = (archivo) => JSON.parse(readFileSync(archivo, 'utf8'))
function bloquear(manifiesto) {
  const lock = `${manifiesto}.lock`
  let fd
  try { fd = openSync(lock, 'wx') } catch { throw new Error(`El manifiesto está en uso (${lock}). Si no hay otra ejecución, borre el .lock a mano.`) }
  writeFileSync(lock, `${process.pid} ${new Date().toISOString()}\n`)
  closeSync(fd)
  const soltar = () => rmSync(lock, { force: true })
  process.on('exit', soltar)
  return soltar
}
function guardarAmbiente({ url, opciones, que }) {
  const motivo = rechazoDeAmbiente({ url, permitirRemoto: opciones['permitir-remoto'], permitirProduccion: opciones['permitir-produccion'], refProduccion: REF_PRODUCCION })
  if (motivo) throw new Error(`${que}: ${motivo}`)
}
function configuracion(opciones) {
  const env = leerEnv(resolve(opciones['env-file'] ?? '.env.local'))
  const supabaseUrl = env.VITE_SUPABASE_URL?.replace(/\/+$/, '')
  if (!supabaseUrl || !env.VITE_SUPABASE_ANON_KEY) throw new Error('El archivo de entorno no tiene VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')
  return { supabaseUrl, anon: env.VITE_SUPABASE_ANON_KEY }
}
async function sesionAdmin({ supabaseUrl, anon }) {
  const email = process.env.MIGRACION_EMAIL, password = process.env.MIGRACION_PASSWORD
  if (!email || !password) throw new Error('Defina MIGRACION_EMAIL y MIGRACION_PASSWORD (cuenta de administración del ambiente); nunca se guardan')
  const cliente = createClient(supabaseUrl, anon, { auth: { persistSession: false, autoRefreshToken: true } })
  const { error } = await cliente.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Inicio de sesión: ${error.message}`)
  const { data: esAdmin, error: e2 } = await cliente.rpc('es_admin')
  if (e2 || esAdmin !== true) throw new Error('La cuenta no es de administración (es_admin ≠ true)')
  return cliente
}
async function token(cliente) {
  const { data } = await cliente.auth.getSession()
  if (!data?.session?.access_token) throw new Error('Sesión perdida')
  return data.session.access_token
}
async function descargar(url, intentos = 3) {
  let ultimo
  for (let i = 1; i <= intentos; i += 1) {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (r.ok) return { estado: r.status, tipo: r.headers.get('content-type'), bytes: Buffer.from(await r.arrayBuffer()) }
      if (r.status < 500 && r.status !== 429) return { estado: r.status, tipo: r.headers.get('content-type'), bytes: null }
      ultimo = new Error(`HTTP ${r.status}`)
    } catch (e) { ultimo = e }
    await ESPERA(300 * i)
  }
  throw ultimo
}
function medidas(archivo) {
  const s = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name', '-of', 'json', archivo], { encoding: 'utf8' })
  const st = JSON.parse(s).streams?.[0]
  if (!st?.width) throw new Error('ffprobe no reconoce una imagen')
  return { ancho: st.width, alto: st.height, codec: st.codec_name }
}
const versionFfmpeg = () => execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0].trim()

// Variante WebP con ffmpeg: cabe en lado×lado SIN ampliar, un solo fotograma, sin metadatos; baja de calidad por escalones
// si supera el tope de bytes del Worker. Se valida con EL MISMO validador del Worker antes de darla por buena.
function generarVariante(origen, destino, v) {
  const reglas = VARIANTES[v]
  for (const q of CALIDADES) {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', origen, '-frames:v', '1', '-map_metadata', '-1',
      '-vf', `scale=w='min(${reglas.lado},iw)':h='min(${reglas.lado},ih)':force_original_aspect_ratio=decrease`,
      '-c:v', 'libwebp', '-lossless', '0', '-q:v', String(q), '-compression_level', '6', '-f', 'webp', destino], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr.trim().slice(0, 200)}`)
    const bytes = readFileSync(destino)
    const insp = inspeccionarWebp(new Uint8Array(bytes))
    if (!insp.ok) throw new Error(`la variante ${v} no pasa el validador del Worker: ${insp.motivo}`)
    if (Math.max(insp.ancho, insp.alto) > reglas.ladoMaxWorker) throw new Error(`variante ${v} excede ${reglas.ladoMaxWorker}px`)
    if (bytes.length <= reglas.bytesMax) return { bytes: bytes.length, sha256: sha256(bytes), ancho: insp.ancho, alto: insp.alto, calidad: q, reencode: true }
  }
  throw new Error(`variante ${v}: no cabe en ${VARIANTES[v].bytesMax} bytes ni con calidad ${CALIDADES.at(-1)}`)
}
// g puede ser el ORIGINAL tal cual (sin pérdida extra) si ya es un WebP válido para el Worker y dentro de los topes.
function gSinRecodificar(bytes) {
  const insp = inspeccionarWebp(new Uint8Array(bytes))
  if (!insp.ok || Math.max(insp.ancho, insp.alto) > VARIANTES.g.lado || bytes.length > VARIANTES.g.bytesMax) return null
  return { bytes: bytes.length, sha256: sha256(bytes), ancho: insp.ancho, alto: insp.alto, calidad: null, reencode: false }
}

// ---------------- inventariar ----------------
function inventarioCrudo(opciones, supabaseUrl) {
  if (opciones['desde-json']) return leerJson(opciones['desde-json'])
  // Sin export: solo Local, por psql dentro del contenedor (transacción READ ONLY).
  if (rechazoDeAmbiente({ url: supabaseUrl })) throw new Error('Sin --desde-json solo se inventaría el Supabase LOCAL; para otro ambiente ejecute inventario.sql (solo lectura) y pase su salida')
  const contenedor = opciones.contenedor ?? 'supabase_db_WedJaiseReact'
  const sql = readFileSync(join(RAIZ, 'scripts', 'migracion-medios', 'inventario.sql'), 'utf8')
  const salida = execFileSync('docker', ['exec', '-i', contenedor, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  const linea = salida.split('\n').find((l) => l.startsWith('{'))
  if (!linea) throw new Error('inventario.sql no devolvió JSON')
  return JSON.parse(linea)
}

function inventariar(opciones) {
  const { supabaseUrl } = configuracion(opciones)
  const crudo = inventarioCrudo(opciones, supabaseUrl)
  const basesMedios = [opciones.publica, ...(opciones['bases-reconocidas'] ?? '').split(',')].filter(Boolean)
  const existeAssetBuild = (ruta) => existsSync(join(RAIZ, 'public', ruta))
  const objetos = new Map(crudo.objetos.map((o) => [`${o.bucket}/${o.ruta}`, o]))
  const referenciados = new Set()
  const filas = []
  for (const ref of crudo.referencias) {
    const columna = COLUMNAS.find((c) => c.tabla === ref.tabla && c.columna === ref.columna)
    const clasif = clasificarValor(columna, ref.valor, { supabaseUrl, basesMedios, existeAssetBuild })
    const objeto = clasif.ruta && clasif.bucket ? objetos.get(`${clasif.bucket}/${clasif.ruta}`) : undefined
    if (objeto) referenciados.add(`${clasif.bucket}/${clasif.ruta}`)
    const alcance = decidirAlcance(clasif, objeto)
    const privado = alcance.privacidad === 'privado'
    filas.push({
      tabla: ref.tabla, columna: ref.columna, fila: ref.fila,
      // De lo privado no se copian valores ni rutas al informe: solo su clasificación.
      valor: privado ? null : ref.valor,
      formato: clasif.formato, bucket: clasif.bucket, ruta: privado ? null : clasif.ruta ?? null,
      objeto: objeto ? { bytes: objeto.bytes, mime: objeto.mime } : null,
      ...alcance, detalle: clasif.detalle,
    })
  }
  const huerfanos = crudo.objetos.filter((o) => !referenciados.has(`${o.bucket}/${o.ruta}`))
  const porBucket = {}
  for (const o of crudo.objetos) {
    const b = (porBucket[o.bucket] ??= { privacidad: PRIVACIDAD[o.bucket] ?? 'desconocida', objetos: 0, bytes: 0, referenciados: 0, huerfanos: 0 })
    b.objetos += 1; b.bytes += o.bytes ?? 0
    if (referenciados.has(`${o.bucket}/${o.ruta}`)) b.referenciados += 1; else b.huerfanos += 1
  }
  const resumen = {}
  for (const f of filas) {
    const k = `${f.tabla}.${f.columna}`
    const bucketColumna = COLUMNAS.find((c) => c.tabla === f.tabla && c.columna === f.columna)?.bucket
    const r = (resumen[k] ??= { privacidad: PRIVACIDAD[bucketColumna] ?? 'sin-bucket', formatos: {}, migrables: 0, motivos: {} })
    r.formatos[f.formato] = (r.formatos[f.formato] ?? 0) + 1
    if (f.migrar) r.migrables += 1
    r.motivos[f.motivo] = (r.motivos[f.motivo] ?? 0) + 1
  }
  const objetosMigrables = new Set(filas.filter((f) => f.migrar).map((f) => `${f.bucket}/${f.ruta}`))
  const informe = {
    generado: new Date().toISOString(), origen: crudo.generado, supabase: new URL(supabaseUrl).host,
    columnas: crudo.columnas, buckets: crudo.buckets, porBucket, resumenPorColumna: resumen,
    totales: {
      referencias: filas.length, migrables: filas.filter((f) => f.migrar).length, objetosMigrables: objetosMigrables.size,
      rotasEnAlcance: filas.filter((f) => f.motivo.startsWith('rota')).length,
      privadas: filas.filter((f) => f.privacidad === 'privado').length,
    },
    referencias: filas.filter((f) => f.privacidad !== 'privado'),
    // Huérfanos de buckets públicos (con ruta) y solo el conteo de los privados.
    huerfanosPublicos: huerfanos.filter((o) => !BUCKETS_PRIVADOS.includes(o.bucket)).map((o) => ({ bucket: o.bucket, ruta: o.ruta, bytes: o.bytes, mime: o.mime, creado: o.creado })),
  }
  escribirJson(opciones.salida, informe)
  console.log(JSON.stringify({ salida: opciones.salida, totales: informe.totales }, null, 1))
}

// ---------------- planificar ----------------
async function planificar(opciones) {
  const { supabaseUrl } = configuracion(opciones)
  guardarAmbiente({ url: supabaseUrl, opciones, que: 'Supabase de origen' }) // incluso la lectura de un remoto exige el permiso
  const inv = leerJson(opciones.inventario)
  if (inv.supabase !== new URL(supabaseUrl).host) throw new Error(`El inventario es de ${inv.supabase}, no de ${new URL(supabaseUrl).host}`)
  const soltar = bloquear(opciones.manifiesto)
  const cache = resolve(opciones.cache); mkdirSync(cache, { recursive: true })
  const m = existsSync(opciones.manifiesto) ? leerJson(opciones.manifiesto) : { version: 1, ambiente: inv.supabase, creado: new Date().toISOString(), publica: opciones.publica ?? null, entradas: [], eventos: [] }
  if (m.ambiente !== inv.supabase) throw new Error('El manifiesto es de otro ambiente')
  if (opciones.publica && m.publica && opciones.publica !== m.publica) throw new Error('El manifiesto ya fija otra base pública de medios')
  m.publica ??= opciones.publica ?? null
  const filtro = opciones.filas ? new Set(leerJson(opciones.filas).map((f) => `${f.tabla}:${f.fila}`)) : null
  const grupos = new Map()
  for (const f of inv.referencias.filter((r) => r.migrar)) {
    if (filtro && !filtro.has(`${f.tabla}:${f.fila}`)) continue
    const k = `${f.bucket}/${f.ruta}`
    grupos.set(k, [...(grupos.get(k) ?? []), f])
  }
  const yaPlanificadas = new Map(m.entradas.map((e) => [`${e.origen.bucket}/${e.origen.ruta}`, e]))
  let nuevas = 0, refsNuevas = 0, errores = 0
  for (const [k, refs] of [...grupos].slice(0, opciones.limite ?? Infinity)) {
    let e = yaPlanificadas.get(k)
    if (!e) {
      const [bucket, ...partes] = k.split('/'); const ruta = partes.join('/')
      if (PRIVACIDAD[bucket] !== 'publico-catalogo') throw new Error(`Defensa: ${bucket} no es público de catálogo`)
      const url = urlPublicaSupabase(supabaseUrl, bucket, ruta)
      const d = await descargar(url)
      if (!d.bytes) { errores += 1; m.eventos.push({ en: new Date().toISOString(), tipo: 'origen-no-disponible', bucket, ruta, estado: d.estado }); continue }
      const sha = sha256(d.bytes)
      const archivo = join(cache, `${sha}.orig`); if (!existsSync(archivo)) writeFileSync(archivo, d.bytes)
      let med
      try { med = medidas(archivo) } catch (err) { errores += 1; m.eventos.push({ en: new Date().toISOString(), tipo: 'origen-ilegible', bucket, ruta, error: err.message }); continue }
      const declarados = refs[0].objeto?.bytes
      if (declarados && declarados !== d.bytes.length) m.eventos.push({ en: new Date().toISOString(), tipo: 'tamano-distinto-al-declarado', bucket, ruta, declarados, descargados: d.bytes.length })
      const id = idDeFuente({ ambiente: inv.supabase, bucket, ruta, sha })
      e = { id, destino: bucket, origen: { bucket, ruta, url, bytes: d.bytes.length, mime: d.tipo, sha256: sha, ...med }, ref: `r2:${bucket}/${id}`, variantes: null, estado: 'planificada', referencias: [], historial: [{ en: new Date().toISOString(), estado: 'planificada' }] }
      m.entradas.push(e); yaPlanificadas.set(k, e); nuevas += 1
    }
    for (const f of refs) {
      if (e.referencias.some((r) => r.tabla === f.tabla && r.columna === f.columna && r.fila === f.fila)) continue
      const columna = COLUMNAS.find((c) => c.tabla === f.tabla && c.columna === f.columna)
      e.referencias.push({ tabla: f.tabla, columna: f.columna, fila: f.fila, original: f.valor, nuevo: valorNuevo(columna, e.destino, e.id, m.publica), estado: 'pendiente' })
      refsNuevas += 1
    }
    escribirJson(opciones.manifiesto, m)
  }
  const errs = validarManifiesto(m)
  if (errs.length) throw new Error(`Manifiesto inválido: ${errs.slice(0, 5).join('; ')}`)
  escribirJson(opciones.manifiesto, m); soltar()
  console.log(JSON.stringify({ nuevas, refsNuevas, errores, resumen: resumenManifiesto(m) }, null, 1))
}

// ---------------- copiar ----------------
async function copiar(opciones) {
  const { supabaseUrl, anon } = configuracion(opciones)
  const aplicar = Boolean(opciones.aplicar)
  if (aplicar) {
    guardarAmbiente({ url: opciones.api, opciones, que: 'Worker de medios' })
    guardarAmbiente({ url: opciones.lectura, opciones, que: 'Lectura de medios' })
    guardarAmbiente({ url: supabaseUrl, opciones, que: 'Supabase (autenticación)' })
  }
  const soltar = bloquear(opciones.manifiesto)
  const m = leerJson(opciones.manifiesto)
  const errs = validarManifiesto(m); if (errs.length) throw new Error(`Manifiesto inválido: ${errs.slice(0, 5).join('; ')}`)
  const cache = resolve(opciones.cache)
  m.ffmpeg ??= versionFfmpeg()
  const cliente = aplicar ? await sesionAdmin({ supabaseUrl, anon }) : null
  const lote = m.entradas.filter((e) => e.estado === 'planificada' || e.estado === 'copiada' || (e.estado === 'error' && opciones['reintentar-errores'])).slice(0, opciones.lote ?? 50)
  const res = { preparadas: 0, subidas: 0, reanudadas: 0, existentesPropias: 0, verificadas: 0, errores: 0, simulado: !aplicar }
  let transitoriosSeguidos = 0
  for (const e of lote) {
    try {
      // 1) variantes (deterministas para la misma versión de ffmpeg; si ya están en caché con el SHA registrado, se reutilizan)
      const orig = join(cache, `${e.origen.sha256}.orig`)
      if (!existsSync(orig) || sha256(readFileSync(orig)) !== e.origen.sha256) throw new Error('falta el original en la caché (vuelva a planificar)')
      const archivoV = (v) => join(cache, `${e.id}-${v}.webp`)
      const listas = e.variantes && ['m', 'g'].every((v) => existsSync(archivoV(v)) && sha256(readFileSync(archivoV(v))) === e.variantes[v].sha256)
      if (!listas) {
        if (e.variantes && e.estado !== 'planificada') throw new Error('las variantes registradas ya se subieron y no están en caché: no se regeneran (podrían diferir)')
        const bytesOrig = readFileSync(orig)
        const g = gSinRecodificar(bytesOrig)
        e.variantes = { m: generarVariante(orig, archivoV('m'), 'm'), g: g ?? generarVariante(orig, archivoV('g'), 'g') }
        if (g) writeFileSync(archivoV('g'), bytesOrig)
        res.preparadas += 1
        escribirJson(opciones.manifiesto, m)
      }
      if (!aplicar) continue
      // 2) subida por el Worker (solo crear). 201 = creado, 200 = misma operación repetida; 409 = ya existe: se compara por lectura.
      for (const v of ['m', 'g']) {
        const bytes = readFileSync(archivoV(v))
        const r = await fetch(`${opciones.api}/v1/medios/${e.destino}/${e.id}/${v}`, { method: 'PUT', headers: { Authorization: `Bearer ${await token(cliente)}`, 'Content-Type': 'image/webp' }, body: bytes })
        if (r.status === 201) res.subidas += 1
        else if (r.status === 200) res.reanudadas += 1
        else if (r.status === 409) {
          const ex = await descargar(`${opciones.lectura}/${e.destino}/${e.id}/${v}.webp`)
          if (!ex.bytes || sha256(ex.bytes) !== e.variantes[v].sha256) throw new Error(`conflicto: ${e.destino}/${e.id}/${v} ya existe con OTRO contenido`)
          res.existentesPropias += 1
        } else if (r.status >= 500 || r.status === 429) {
          throw Object.assign(new Error(`Worker HTTP ${r.status}`), { transitorio: true })
        } else {
          throw new Error(`Worker rechazó ${v}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`)
        }
      }
      e.estado = 'copiada'; e.historial.push({ en: new Date().toISOString(), estado: 'copiada' })
      escribirJson(opciones.manifiesto, m)
      // 3) verificación por lectura: lo que sirve la base pública debe ser byte a byte lo generado.
      for (const v of ['m', 'g']) {
        const l = await descargar(`${opciones.lectura}/${e.destino}/${e.id}/${v}.webp`)
        if (!l.bytes) throw Object.assign(new Error(`lectura de ${v}: HTTP ${l.estado}`), { transitorio: true })
        if (!/^image\/webp/.test(l.tipo ?? '')) throw new Error(`lectura de ${v}: tipo ${l.tipo}`)
        if (sha256(l.bytes) !== e.variantes[v].sha256) throw new Error(`lectura de ${v}: el SHA-256 servido no coincide`)
      }
      e.estado = 'verificada'; e.error = undefined; e.historial.push({ en: new Date().toISOString(), estado: 'verificada' })
      res.verificadas += 1; transitoriosSeguidos = 0
      escribirJson(opciones.manifiesto, m)
    } catch (err) {
      res.errores += 1
      if (err.transitorio) {
        transitoriosSeguidos += 1
        e.error = err.message; escribirJson(opciones.manifiesto, m) // queda reanudable en su estado actual
        if (transitoriosSeguidos >= 3) { m.eventos.push({ en: new Date().toISOString(), tipo: 'parada', motivo: '3 fallos transitorios seguidos' }); break }
      } else {
        e.estado = 'error'; e.error = err.message; e.historial.push({ en: new Date().toISOString(), estado: 'error', error: err.message })
      }
      escribirJson(opciones.manifiesto, m)
    }
  }
  escribirJson(opciones.manifiesto, m); soltar()
  console.log(JSON.stringify({ ...res, resumen: resumenManifiesto(m) }, null, 1))
}

// ---------------- actualizar / revertir ----------------
async function leerValor(cliente, ref) {
  const { data, error } = await cliente.from(ref.tabla).select(`id,${ref.columna}`).eq('id', ref.fila).maybeSingle()
  if (error) throw new Error(`lectura ${ref.tabla}/${ref.fila}: ${error.message}`)
  return data ? { existe: true, valor: data[ref.columna] } : { existe: false }
}
// UPDATE … WHERE id = fila AND columna = esperado. Si no afecta filas, se relee: si ya tiene el valor de destino la operación
// se había hecho (respuesta perdida); si tiene otro valor, alguien la cambió → conflicto, no se toca.
async function cambiarCondicional(cliente, ref, de, a) {
  const { data, error } = await cliente.from(ref.tabla).update({ [ref.columna]: a }).eq('id', ref.fila).eq(ref.columna, de).select('id')
  if (error) throw new Error(`update ${ref.tabla}/${ref.fila}: ${error.message}`)
  if (data.length === 1) return 'hecho'
  const actual = await leerValor(cliente, ref)
  if (actual.existe && actual.valor === a) return 'hecho'
  return actual.existe ? 'conflicto' : 'fila-inexistente'
}
async function escribirReferencias(opciones, modo) {
  const { supabaseUrl, anon } = configuracion(opciones)
  const aplicar = Boolean(opciones.aplicar)
  if (aplicar) guardarAmbiente({ url: supabaseUrl, opciones, que: 'Supabase' })
  const soltar = bloquear(opciones.manifiesto)
  const m = leerJson(opciones.manifiesto)
  const errs = validarManifiesto(m); if (errs.length) throw new Error(`Manifiesto inválido: ${errs.slice(0, 5).join('; ')}`)
  const pendientes = []
  for (const e of m.entradas) {
    for (const ref of e.referencias) {
      if (modo === 'actualizar' && e.estado === 'verificada' && ref.estado === 'pendiente') pendientes.push(ref)
      if (modo === 'revertir' && ref.estado === 'actualizada') pendientes.push(ref)
    }
  }
  const lote = pendientes.slice(0, opciones.lote ?? 25)
  const res = { modo, candidatas: pendientes.length, enEsteLote: lote.length, hechas: 0, conflictos: 0, simulado: !aplicar }
  if (!aplicar) { soltar(); console.log(JSON.stringify({ ...res, muestra: lote.slice(0, 5).map((r) => ({ tabla: r.tabla, fila: r.fila, de: modo === 'actualizar' ? r.original : r.nuevo, a: modo === 'actualizar' ? r.nuevo : r.original })) }, null, 1)); return }
  const cliente = await sesionAdmin({ supabaseUrl, anon })
  for (const ref of lote) {
    const [de, a] = modo === 'actualizar' ? [ref.original, ref.nuevo] : [ref.nuevo, ref.original]
    const r = await cambiarCondicional(cliente, ref, de, a)
    const ahora = new Date().toISOString()
    if (r === 'hecho') { ref.estado = modo === 'actualizar' ? 'actualizada' : 'revertida'; ref[modo === 'actualizar' ? 'actualizadaEn' : 'revertidaEn'] = ahora; res.hechas += 1 }
    else { ref.estado = modo === 'actualizar' ? 'conflicto' : 'conflicto-reversion'; ref.conflicto = { en: ahora, motivo: r }; res.conflictos += 1 }
    escribirJson(opciones.manifiesto, m) // después de CADA fila: el diario de reversión nunca queda atrás de la base
    if (opciones['pausa-ms']) await ESPERA(opciones['pausa-ms'])
  }
  soltar()
  console.log(JSON.stringify({ ...res, resumen: resumenManifiesto(m) }, null, 1))
}

// ---------------- verificar ----------------
async function verificar(opciones) {
  const { supabaseUrl, anon } = configuracion(opciones)
  guardarAmbiente({ url: supabaseUrl, opciones, que: 'Supabase' })
  const m = leerJson(opciones.manifiesto)
  const cliente = await sesionAdmin({ supabaseUrl, anon })
  const problemas = []
  const res = { entradas: m.entradas.length, refsComprobadas: 0, r2Comprobados: 0, originalesComprobados: 0 }
  const errs = validarManifiesto(m); for (const x of errs) problemas.push({ tipo: 'manifiesto', detalle: x })
  for (const e of m.entradas) {
    if (BUCKETS_PRIVADOS.includes(e.origen.bucket) || !DESTINOS_R2.includes(e.destino)) problemas.push({ tipo: 'privado-o-destino', id: e.id })
    // El original sigue en Supabase, intacto (mismo SHA-256): la reversión siempre tiene a dónde volver.
    const o = await descargar(e.origen.url)
    res.originalesComprobados += 1
    if (!o.bytes || sha256(o.bytes) !== e.origen.sha256) problemas.push({ tipo: 'original-alterado-o-ausente', id: e.id, estado: o.estado })
    if (['copiada', 'verificada'].includes(e.estado) && opciones.lectura) {
      for (const v of ['m', 'g']) {
        const l = await descargar(`${opciones.lectura}/${e.destino}/${e.id}/${v}.webp`)
        res.r2Comprobados += 1
        if (!l.bytes || sha256(l.bytes) !== e.variantes[v].sha256) problemas.push({ tipo: 'r2-no-coincide', id: e.id, variante: v, estado: l.estado })
      }
    }
    for (const ref of e.referencias) {
      const actual = await leerValor(cliente, ref)
      res.refsComprobadas += 1
      const esperado = { pendiente: ref.original, actualizada: ref.nuevo, revertida: ref.original }[ref.estado]
      if (esperado !== undefined && actual.valor !== esperado) problemas.push({ tipo: 'referencia-no-coincide', tabla: ref.tabla, fila: ref.fila, estado: ref.estado })
      if (ref.estado === 'actualizada' && e.estado !== 'verificada') problemas.push({ tipo: 'referencia-a-copia-no-verificada', tabla: ref.tabla, fila: ref.fila })
    }
  }
  const informe = { generado: new Date().toISOString(), ...res, resumen: resumenManifiesto(m), problemas, ok: problemas.length === 0 }
  if (opciones.salida) escribirJson(opciones.salida, informe)
  console.log(JSON.stringify({ ok: informe.ok, ...res, problemas: problemas.slice(0, 10) }, null, 1))
  if (!informe.ok) process.exitCode = 1
}

// ---------------- entrada ----------------
const ESPEC = {
  flags: ['aplicar', 'permitir-produccion', 'reintentar-errores'],
  textos: ['env-file', 'salida', 'desde-json', 'publica', 'bases-reconocidas', 'contenedor', 'inventario', 'manifiesto', 'cache', 'api', 'lectura', 'permitir-remoto', 'filas'],
  numeros: { lote: [1, 500], limite: [1, 100000], 'pausa-ms': [0, 60000] },
}
const REQUERIDOS = {
  inventariar: ['salida'], planificar: ['inventario', 'manifiesto', 'cache'], copiar: ['manifiesto', 'cache', 'api', 'lectura'],
  actualizar: ['manifiesto'], revertir: ['manifiesto'], verificar: ['manifiesto'],
}
try {
  const opciones = parsearArgumentos(process.argv.slice(2), ESPEC)
  if (!REQUERIDOS[opciones.comando]) throw new Error(`Subcomando desconocido: ${opciones.comando}`)
  for (const r of REQUERIDOS[opciones.comando]) if (!opciones[r]) throw new Error(`${opciones.comando} requiere --${r}`)
  const acciones = { inventariar, planificar, copiar, actualizar: (o) => escribirReferencias(o, 'actualizar'), revertir: (o) => escribirReferencias(o, 'revertir'), verificar }
  await acciones[opciones.comando](opciones)
} catch (err) {
  console.error(`medios-migracion: ${err.message}`)
  process.exitCode = 2
}
