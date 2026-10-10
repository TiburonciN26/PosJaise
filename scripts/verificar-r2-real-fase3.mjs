// Fase 3 · verificación del Worker de medios y del bucket de R2 REALES (entorno de pruebas ligado a staging).
//
//   # 1) Solo lectura / sin sesión (no escribe nada): configuración, CORS, rutas protegidas
//   node scripts/verificar-r2-real-fase3.mjs --api=https://… --publico=https://… --origen-pages=https://… --env-file=.env.staging.local
//
//   # 2) Con escritura (SOLO tras autorización del usuario): sube, mide, rechaza, borra lo suyo
//   node scripts/verificar-r2-real-fase3.mjs … --escribir [--fotos-dir=<carpeta con fotos de muestra>] [--repeticiones=8]
//
// Reglas de seguridad:
//   - Se niega a ejecutarse contra el Supabase del negocio (solo staging) y exige URLs https salvo localhost.
//   - Sin --escribir NO hay subidas ni borrados: solo peticiones que deben ser rechazadas o de lectura.
//   - Con --escribir usa claves nuevas (uuid) y SOLO borra los objetos que él mismo creó.
//   - No imprime ni guarda tokens, claves ni contraseñas. El informe va a docs/evidencia-rendimiento/fase-3/r2-real/.
//   - Lo que NO puede medir desde fuera (CPU del Worker, costo) se indica en el informe con dónde leerlo.
//
// El script también funciona contra el Worker LOCAL con R2 simulado (--api=http://127.0.0.1:PUERTO, --publico igual,
// Worker con SERVIR_LECTURA=1) para comprobar su propia lógica sin tocar Cloudflare.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REF_PRODUCCION } from './lib/entornos-supabase.mjs'

const aqui = dirname(fileURLToPath(import.meta.url))
const raiz = resolve(aqui, '..')

// ---------- argumentos estrictos ----------
const BOOLEANAS = new Set(['escribir'])
const TEXTUALES = new Set(['api', 'publico', 'origen-pages', 'env-file', 'fotos-dir', 'repeticiones'])
const args = { escribir: false, repeticiones: 8 }
for (const crudo of process.argv.slice(2)) {
  const igual = crudo.indexOf('=')
  const nombre = crudo.replace(/^--/, '').slice(0, igual === -1 ? undefined : igual - 2)
  const valor = igual === -1 ? null : crudo.slice(igual + 1)
  if (!crudo.startsWith('--')) throw new Error(`Argumento no reconocido: ${crudo}`)
  if (BOOLEANAS.has(nombre)) {
    if (valor !== null) throw new Error(`--${nombre} no admite valor`)
    args[nombre] = true
  } else if (TEXTUALES.has(nombre)) {
    if (!valor) throw new Error(`--${nombre} requiere valor`)
    args[nombre] = nombre === 'repeticiones' ? Number(valor) : valor
  } else throw new Error(`Opción desconocida: --${nombre}`)
}
if (!Number.isInteger(args.repeticiones) || args.repeticiones < 2 || args.repeticiones > 50) throw new Error('--repeticiones debe ser un entero entre 2 y 50')
for (const k of ['api', 'publico', 'origen-pages', 'env-file']) if (!args[k]) throw new Error(`Falta --${k}`)

const sinBarra = (u) => u.replace(/\/+$/, '')
const API = sinBarra(args.api)
const PUBLICO = sinBarra(args.publico)
const ORIGEN = sinBarra(args['origen-pages'])
const esLocal = (u) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u)
for (const [n, u] of [['api', API], ['publico', PUBLICO], ['origen-pages', ORIGEN]]) {
  if (!/^https:\/\//.test(u) && !esLocal(u)) throw new Error(`--${n} debe ser https (o localhost para la prueba del propio script)`)
}
const advertencias = []
if (/\.r2\.dev(\/|$)/.test(PUBLICO)) advertencias.push('El dominio público es r2.dev: la guía lo reserva para desarrollo; producción debe usar un dominio propio con caché de Cloudflare.')

function leerEnv(ruta) {
  const salida = {}
  for (const linea of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) salida[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return salida
}
const env = leerEnv(resolve(args['env-file']))
if (!env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL.includes(REF_PRODUCCION)) throw new Error('Solo el Supabase de STAGING: el del negocio está prohibido para esta verificación.')

// ---------- registro ----------
const informe = { fecha: new Date().toISOString(), api: API, publico: PUBLICO, origenPages: ORIGEN, escribio: args.escribir, advertencias, casos: [], mediciones: {}, noMedibleDesdeAqui: {} }
const caso = (nombre, ok, detalle = {}) => {
  informe.casos.push({ nombre, ...detalle, ok: Boolean(ok) })
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${ok ? '' : ' ' + JSON.stringify(detalle)}`)
}
const lecturasSinCabeceraCache = (filas) => filas.length > 0 && filas.every((f) => Object.keys(f.resumenCache).every((k) => k === 'sin-cabecera'))
const mismosBytes = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const uuid = () => crypto.randomUUID()
const ORIGEN_AJENO = 'https://origen-no-permitido.example'

async function pedir(url, opciones = {}) {
  const t0 = performance.now()
  const r = await fetch(url, { redirect: 'manual', ...opciones })
  const cuerpo = new Uint8Array(await r.arrayBuffer())
  return { estado: r.status, cabeceras: Object.fromEntries(r.headers), bytes: cuerpo.length, cuerpo, ms: performance.now() - t0 }
}

async function sesion(email, password) {
  const r = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  if (!r.ok) throw new Error(`Inicio de sesión rechazado (${r.status}) para una cuenta QA`)
  return (await r.json()).access_token
}

// ============ FASE A: sin sesión, sin escritura ============
{
  const id = uuid()
  const base = `${API}/v1/medios/fotos-productos/${id}`
  let r = await pedir(`${base}/g`, { method: 'PUT', headers: { Origin: ORIGEN, 'Content-Type': 'image/webp' }, body: new Uint8Array(40) })
  caso('A1 PUT sin sesión → 401', r.estado === 401, { estado: r.estado })
  r = await pedir(`${API}/v1/inventario/fotos-productos`, { headers: { Origin: ORIGEN } })
  caso('A2 inventario sin sesión → 401', r.estado === 401, { estado: r.estado })
  r = await pedir(`${base}/g`, { method: 'PUT', headers: { Origin: ORIGEN_AJENO, Authorization: 'Bearer x' }, body: new Uint8Array(40) })
  caso('A3 origen NO permitido → 403', r.estado === 403, { estado: r.estado })
  r = await pedir(`${base}/g`, { method: 'OPTIONS', headers: { Origin: ORIGEN, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type' } })
  caso('A4 preflight CORS del origen de Pages: 204 con el origen EXACTO, sin comodín', r.estado === 204 && r.cabeceras['access-control-allow-origin'] === ORIGEN && /PUT/.test(r.cabeceras['access-control-allow-methods'] ?? ''), { estado: r.estado, acao: r.cabeceras['access-control-allow-origin'] })
  r = await pedir(`${base}/g`, { method: 'OPTIONS', headers: { Origin: ORIGEN_AJENO, 'Access-Control-Request-Method': 'PUT' } })
  caso('A5 preflight de un origen ajeno → 403 y sin Allow-Origin', r.estado === 403 && !r.cabeceras['access-control-allow-origin'], { estado: r.estado })
  r = await pedir(`${API}/v1/medios/comprobantes-pedidos-web/${id}/g`, { method: 'PUT', headers: { Origin: ORIGEN, Authorization: 'Bearer x' }, body: new Uint8Array(40) })
  caso('A6 destino privado (comprobantes) → 400, nunca aceptado', r.estado === 400, { estado: r.estado })
  r = await pedir(`${PUBLICO}/comprobantes-pedidos-web/${id}/g.webp`)
  caso('A7 el dominio público NO sirve destinos privados → 404', r.estado === 404, { estado: r.estado })
  r = await pedir(`${PUBLICO}/fotos-productos/${id}/g.webp`)
  caso('A8 clave inexistente en el dominio público → 404', r.estado === 404, { estado: r.estado })
}

// ============ FASE B: con escritura (autorización explícita) ============
if (!args.escribir) {
  console.log('\nSin --escribir: no se subió ni se borró nada. Pasos de escritura omitidos.')
  informe.omitido = 'Fase B (escritura) no ejecutada: requiere --escribir y autorización del usuario.'
} else {
  const { chromium } = createRequire(resolve(raiz, 'package.json'))('playwright')
  const tokens = {
    admin: await sesion(env.QA_ADMIN_EMAIL, env.QA_ADMIN_PASSWORD),
    cajera: await sesion(env.QA_CAJERA_EMAIL, env.QA_CAJERA_PASSWORD),
    cliente: await sesion(env.QA_CLIENTE_EMAIL, env.QA_CLIENTE_PASSWORD),
  }
  const navegador = await chromium.launch()
  const pagina = await navegador.newPage()

  // Fuentes de imagen: carpeta indicada (fotos de catálogo reales) o las fotos de referencia del repositorio.
  let fuentes = []
  if (args['fotos-dir']) {
    fuentes = readdirSync(resolve(args['fotos-dir'])).filter((f) => ['.jpg', '.jpeg', '.png', '.webp'].includes(extname(f).toLowerCase())).map((f) => resolve(args['fotos-dir'], f))
    if (fuentes.length === 0) throw new Error('--fotos-dir no contiene imágenes jpg/png/webp')
  } else {
    fuentes = ['public/inicio-web/hero-antes-referencia.jpg', 'public/inicio-web/hero-despues-referencia.jpg', 'public/inicio-web/antes-claro.webp', 'src/assets/login/foto-login.jpeg'].map((f) => resolve(raiz, f))
    informe.advertencias.push('Se usaron las fotos de referencia del repositorio, NO fotos de catálogo: el peso real del catálogo sigue sin medirse (use --fotos-dir).')
  }

  // Mismo procesado que la app (600 px / calidad 0,8 para la foto de detalle; 320 px para la miniatura), hecho en Chromium.
  async function procesar(ruta) {
    const bytes = readFileSync(ruta)
    const tipo = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[extname(ruta).toLowerCase()]
    const r = await pagina.evaluate(async ([datos, mime]) => {
      const bmp = await createImageBitmap(new Blob([new Uint8Array(datos)], { type: mime }))
      const codificar = async (lado, calidad) => {
        const escala = Math.min(1, lado / Math.max(bmp.width, bmp.height))
        const c = document.createElement('canvas')
        c.width = Math.max(1, Math.round(bmp.width * escala)); c.height = Math.max(1, Math.round(bmp.height * escala))
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
        const b = await new Promise((ok) => c.toBlob(ok, 'image/webp', calidad))
        return Array.from(new Uint8Array(await b.arrayBuffer()))
      }
      return { m: await codificar(320, 0.8), g: await codificar(600, 0.8) }
    }, [Array.from(bytes), tipo])
    return { nombre: ruta.split(/[\\/]/).pop(), originalBytes: bytes.length, m: Uint8Array.from(r.m), g: Uint8Array.from(r.g) }
  }

  const creados = [] // grupos que ESTE script creó (los únicos que borra)
  const cabecera = (token) => ({ Authorization: `Bearer ${token}`, Origin: ORIGEN, 'Content-Type': 'image/webp' })
  const subir = (destino, id, variante, bytes, token) => pedir(`${API}/v1/medios/${destino}/${id}/${variante}`, { method: 'PUT', headers: cabecera(token), body: bytes })

  try {
    // --- B1 autorización por rol ---
    const muestra = await procesar(fuentes[0])
    const idRol = uuid()
    let r = await subir('fotos-productos', idRol, 'm', muestra.m, tokens.cajera)
    caso('B1 cajera → 403', r.estado === 403, { estado: r.estado })
    r = await subir('fotos-productos', idRol, 'm', muestra.m, tokens.cliente)
    caso('B2 cliente → 403', r.estado === 403, { estado: r.estado })

    // --- B3 archivos inválidos ---
    const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]
    const vp8xSolo = Uint8Array.from([...'RIFF'].map((c) => c.charCodeAt(0)).concat(u32(22), [...'WEBP'].map((c) => c.charCodeAt(0)), [...'VP8X'].map((c) => c.charCodeAt(0)), u32(10), [0, 0, 0, 0, 127, 0, 0, 127, 0, 0]))
    const invalidos = [
      ['VP8X sin píxeles (30 bytes)', vp8xSolo, 'm', [415]],
      ['PNG declarado como WebP', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, ...new Array(80).fill(1)]), 'm', [415]],
      ['HTML/JS', new TextEncoder().encode('<script>alert(1)</script>'.repeat(30)), 'm', [415]],
      ['archivo truncado', muestra.g.slice(0, muestra.g.length >> 1), 'g', [415]],
      ['exceso de bytes (600 KiB en g)', new Uint8Array(600 * 1024), 'g', [413]],
      ['cuerpo vacío', new Uint8Array(0), 'm', [400]],
    ]
    for (const [nombre, bytes, variante, esperados] of invalidos) {
      r = await subir('fotos-productos', uuid(), variante, bytes, tokens.admin)
      caso(`B3 inválido (${nombre}) → ${esperados.join('/')}`, esperados.includes(r.estado), { estado: r.estado })
    }
    r = await pedir(`${API}/v1/inventario/fotos-productos`, { headers: { Authorization: `Bearer ${tokens.admin}`, Origin: ORIGEN } })
    informe.mediciones.inventarioInicial = JSON.parse(new TextDecoder().decode(r.cuerpo)).objetos?.length ?? null

    // --- B4 subida real, entrega y caché ---
    const filas = []
    for (const fuente of fuentes) {
      const img = await procesar(fuente)
      const id = uuid()
      creados.push(`fotos-productos/${id}`)
      const rm = await subir('fotos-productos', id, 'm', img.m, tokens.admin)
      const rg = await subir('fotos-productos', id, 'g', img.g, tokens.admin)
      caso(`B4 subida de ${img.nombre}: m=201, g=201`, rm.estado === 201 && rg.estado === 201, { m: rm.estado, g: rg.estado, msPutM: Math.round(rm.ms), msPutG: Math.round(rg.ms) })
      // reintento idéntico (respuesta perdida) y contenido distinto
      const rep = await subir('fotos-productos', id, 'm', img.m, tokens.admin)
      const dist = await subir('fotos-productos', id, 'm', muestra.m, tokens.admin)
      const contenidoIgual = Buffer.compare(Buffer.from(img.m), Buffer.from(muestra.m)) === 0
      caso(`B5 ${img.nombre}: reintento idéntico → 200 reanudado; contenido distinto → 409`, rep.estado === 200 && (contenidoIgual || dist.estado === 409), { repeticion: rep.estado, distinto: dist.estado })

      // entrega desde el dominio PÚBLICO: cabeceras, bytes y caché (varias lecturas seguidas)
      const lecturas = []
      for (let i = 0; i < args.repeticiones; i += 1) {
        const l = await pedir(`${PUBLICO}/fotos-productos/${id}/m.webp`)
        lecturas.push({ estado: l.estado, ms: Math.round(l.ms), cache: l.cabeceras['cf-cache-status'] ?? null, age: l.cabeceras.age ?? null, bytes: l.bytes })
      }
      const ultima = await pedir(`${PUBLICO}/fotos-productos/${id}/m.webp`)
      const h = ultima.cabeceras
      const gg = await pedir(`${PUBLICO}/fotos-productos/${id}/g.webp`)
      // IGUALDAD BINARIA (byte a byte), no solo de longitud: lo servido por el dominio público debe ser exactamente lo subido.
      const mIgual = mismosBytes(ultima.cuerpo, img.m)
      const gIgual = mismosBytes(gg.cuerpo, img.g)
      caso(`B6 ${img.nombre}: dominio público 200 en m y g, image/webp, cache-control immutable y contenido IDÉNTICO byte a byte a lo subido (m y g)`,
        ultima.estado === 200 && gg.estado === 200 && h['content-type'] === 'image/webp' && gg.cabeceras['content-type'] === 'image/webp' &&
          /immutable/.test(h['cache-control'] ?? '') && /immutable/.test(gg.cabeceras['cache-control'] ?? '') && mIgual && gIgual,
        { estadoM: ultima.estado, estadoG: gg.estado, tipoM: h['content-type'], tipoG: gg.cabeceras['content-type'], cacheM: h['cache-control'], mIgual, gIgual,
          sha256Subido: { m: sha256(img.m), g: sha256(img.g) }, sha256Servido: { m: sha256(ultima.cuerpo), g: sha256(gg.cuerpo) } })
      // nosniff lo añade el dominio propio (Transform Rule), no el Worker ni r2.dev: en r2.dev es una advertencia
      // documentada; en un dominio propio de medios es una exigencia.
      const nosniffPresente = h['x-content-type-options'] === 'nosniff'
      if (/\.r2\.dev$/.test(new URL(PUBLICO).hostname)) {
        if (!nosniffPresente) informe.advertencias.push('r2.dev no envía X-Content-Type-Options: nosniff; configurarlo en el dominio propio (Transform Rule de cabecera de respuesta) antes de producción.')
      } else {
        caso(`B6c ${img.nombre}: el dominio propio envía X-Content-Type-Options: nosniff`, nosniffPresente, { nosniff: h['x-content-type-options'] ?? null })
      }
      filas.push({
        foto: img.nombre, originalKiB: +(img.originalBytes / 1024).toFixed(1), mKiB: +(img.m.length / 1024).toFixed(1), gKiB: +(img.g.length / 1024).toFixed(1),
        cumpleObjetivos: img.m.length <= 80 * 1024 && img.g.length <= 250 * 1024,
        lecturasM: lecturas, resumenCache: lecturas.reduce((a, l) => ({ ...a, [l.cache ?? 'sin-cabecera']: (a[l.cache ?? 'sin-cabecera'] ?? 0) + 1 }), {}),
        msMediana: [...lecturas].map((l) => l.ms).sort((x, y) => x - y)[Math.floor(lecturas.length / 2)],
      })
    }
    informe.mediciones.fotos = filas
    informe.advertencias = [...new Set(informe.advertencias)]
    if (lecturasSinCabeceraCache(filas)) informe.advertencias.push('El dominio público no devuelve cf-cache-status: no hay caché de Cloudflare delante (r2.dev); HIT/MISS solo se puede validar con un dominio propio.')
    informe.mediciones.nota = 'HIT/MISS dependen del punto de presencia y del momento; se registran, no se exigen. Investigar si TODAS las lecturas repetidas son MISS (cache-control, regla de caché, dominio sin proxy).'

    // --- B7 inventario y borrado ---
    r = await pedir(`${API}/v1/inventario/fotos-productos`, { headers: { Authorization: `Bearer ${tokens.admin}`, Origin: ORIGEN } })
    const claves = new Set((JSON.parse(new TextDecoder().decode(r.cuerpo)).objetos ?? []).map((o) => o.clave.split('/').slice(0, 2).join('/')))
    caso('B7 el inventario del Worker lista lo subido', creados.every((g) => claves.has(g)))
  } finally {
    // Limpieza: SOLO lo que este script creó.
    const resultadosBorrado = []
    for (const grupo of creados) {
      const d = await pedir(`${API}/v1/medios/${grupo}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokens.admin}`, Origin: ORIGEN } })
      const trasBorrar = await pedir(`${PUBLICO}/${grupo}/m.webp`)
      resultadosBorrado.push({ grupo, delete: d.estado, lecturaPublicaTrasBorrar: trasBorrar.estado, cache: trasBorrar.cabeceras['cf-cache-status'] ?? null })
    }
    informe.mediciones.borrado = resultadosBorrado
    caso('B8 los objetos creados por el script se eliminan (DELETE 200)', resultadosBorrado.every((x) => x.delete === 200), { resultadosBorrado })
    // Hallazgo, no aserción: tras borrar, la caché puede seguir sirviendo la copia hasta expirar/purgarse.
    informe.mediciones.cacheTrasBorrado = resultadosBorrado.some((x) => x.lecturaPublicaTrasBorrar === 200)
      ? 'Tras el DELETE alguna URL siguió respondiendo 200 desde la caché: la purga de caché sigue siendo una decisión pendiente.'
      : 'Tras el DELETE todas las URLs respondieron distinto de 200.'
    await navegador.close().catch(() => {})
  }
}

informe.noMedibleDesdeAqui = {
  cpuDelWorker: 'Panel de Cloudflare → Workers y Pages → (Worker) → Metrics → CPU time (p50/p99) y Errors. En plan Free el límite es 10 ms de CPU por petición; revisar p99 durante esta prueba.',
  costo: 'Panel → Billing y R2 → Metrics: operaciones Clase A/B y almacenamiento. Ver docs/evidencia-rendimiento/fase-3/README.md §7.',
  navegadoresYMoviles: 'Firefox, Safari/iOS y móvil físico: pasos manuales del runbook (R2-REAL-RUNBOOK.md §5).',
}
const fallos = informe.casos.filter((c) => !c.ok)
informe.total = informe.casos.length
informe.fallos = fallos.length
const carpeta = resolve(raiz, 'docs/evidencia-rendimiento/fase-3/r2-real')
mkdirSync(carpeta, { recursive: true })
const archivo = resolve(carpeta, `${args.escribir ? 'con-escritura' : 'solo-lectura'}-${new URL(API).hostname.replace(/[^a-z0-9.-]/gi, '_')}.json`)
writeFileSync(archivo, JSON.stringify(informe, null, 2))
console.log(`\n${informe.total} casos, ${fallos.length} fallos → ${archivo}`)
process.exitCode = fallos.length ? 1 : 0
