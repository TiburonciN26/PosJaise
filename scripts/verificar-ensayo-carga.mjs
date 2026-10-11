// Regresiones SIN red del núcleo del ensayo de carga (scripts/lib/ensayo-carga.cjs).
//   node scripts/verificar-ensayo-carga.mjs
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { ejecutarCarga, percentil, MAX_LECTURAS, MAX_SIMULTANEAS, LECTURAS_POR_MUESTRA, NIVELES, MUESTRAS } = require('./lib/ensayo-carga.cjs')

const { ejecutarEnsayoCarga, crearLeerUrl } = require('./lib/ensayo-carga-flujo.cjs')

const casos = []
const caso = (nombre, ok, detalle = {}) => {
  casos.push({ nombre, ok: Boolean(ok) })
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${ok ? '' : ' ' + JSON.stringify(detalle)}`)
}
const esperados = { m: { etag: '"em"' }, g: { etag: '"eg"' } }
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

// Lector sano: 200/304 con HIT, tras la primera lectura de cada variante (MISS).
function lectorSano(extra = {}) {
  const vistos = new Set()
  const estado = { activas: 0, maxActivas: 0, llamadas: 0 }
  const leer = async ({ tipo, variante }) => {
    estado.llamadas += 1
    estado.activas += 1
    estado.maxActivas = Math.max(estado.maxActivas, estado.activas)
    await espera(1)
    estado.activas -= 1
    const primera = !vistos.has(variante)
    vistos.add(variante)
    const base = { estado: tipo.startsWith('COND') ? 304 : 200, medios: primera ? 'MISS' : 'HIT', pop: 'MIA', etag: esperados[variante].etag, bytesOk: true, ms: 5 }
    return extra.alterar ? extra.alterar({ tipo, variante, n: estado.llamadas, base }) : base
  }
  return { leer, estado }
}

{
  const { leer, estado } = lectorSano()
  const r = await ejecutarCarga({ leer, esperados })
  const previstas = 2 + MUESTRAS * NIVELES.reduce((s, n) => s + LECTURAS_POR_MUESTRA[n], 0)
  caso(`corrida sana: completa, ${previstas} lecturas (dentro del tope de ${MAX_LECTURAS})`, r.completa && r.lecturas === previstas && r.lecturas <= MAX_LECTURAS && estado.llamadas === r.lecturas, r)
  caso(`nunca más de ${MAX_SIMULTANEAS} simultáneas y el nivel máximo se alcanza (10)`, estado.maxActivas === 10 && r.maxSimultaneas === 10, { medido: estado.maxActivas })
  caso('métricas por nivel: n, p50/p95/p99, HIT/MISS y POP; la fase fría registra las 2 primeras lecturas', Object.keys(r.porNivel).join() === '1,5,10' && r.porNivel[10].n === 180 && r.porNivel[10].p95 === 5 && r.porNivel[1].hit === 30 && r.porNivel[1].pops.join() === 'MIA' && r.fria.length === 2 && r.fria.every((x) => x.medios === 'MISS'), r.porNivel)
}
{
  const { leer } = lectorSano({ alterar: ({ base, n }) => (n > 20 ? { ...base, estado: 429 } : base) })
  const r = await ejecutarCarga({ leer, esperados })
  caso('429 repetidos: se detiene tras 3, no sigue ni sube la carga, corrida incompleta', !r.completa && r.erroresServidor === 3 && /429\/5xx/.test(r.parada) && r.lecturas < 40, r)
}
{
  const { leer } = lectorSano({ alterar: ({ base, n }) => (n === 15 ? { ...base, estado: 503 } : base) })
  const r = await ejecutarCarga({ leer, esperados })
  caso('un 503 aislado se registra pero no detiene por sí solo (umbral de 3)', r.completa && r.erroresServidor === 1 && r.porNivel[1].errores + r.porNivel[5].errores + r.porNivel[10].errores === 1, r)
}
{
  const { leer } = lectorSano({ alterar: ({ base, tipo, n }) => (n === 12 && tipo.startsWith('GET') ? { ...base, bytesOk: false } : base) })
  const r = await ejecutarCarga({ leer, esperados })
  caso('bytes distintos a los subidos: parada inmediata', !r.completa && /bytes distintos/.test(r.parada) && r.lecturas < 30, r)
}
{
  const { leer } = lectorSano({ alterar: ({ base, n }) => (n === 9 ? { ...base, etag: '"otro"' } : base) })
  const r = await ejecutarCarga({ leer, esperados })
  caso('ETag inesperado: parada inmediata', !r.completa && /ETag/.test(r.parada), r)
}
{
  const { leer } = lectorSano({ alterar: ({ base, n }) => (n === 7 ? { ...base, estado: 404 } : base) })
  const r = await ejecutarCarga({ leer, esperados })
  caso('estado inesperado (404 con el objeto presente): parada inmediata', !r.completa && /estado inesperado 404/.test(r.parada), r)
}
{
  const { leer } = lectorSano({ alterar: ({ base, n }) => { if (n === 20) throw new Error('red caída'); return base } })
  const r = await ejecutarCarga({ leer, esperados })
  caso('fallo de red: parada y registro, sin reintentos', !r.completa && /fallo de red/.test(r.parada) && r.erroresServidor === 1, r)
}
{
  const { leer, estado } = lectorSano({ alterar: ({ base, n }) => (n === 3 ? { ...base, estado: 429 } : base) })
  const r = await ejecutarCarga({ leer, esperados })
  caso('el presupuesto no se reinicia ni se excede tras un error aislado', r.lecturas <= MAX_LECTURAS && estado.llamadas === r.lecturas, r.lecturas)
}
caso('percentiles: método de rango más cercano, vacío → null', percentil([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50) === 5 && percentil([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95) === 10 && percentil([], 50) === null)

// ---- EC-01: el adaptador REAL de lectura (crearLeerUrl) convierte un ETag ausente en null; el núcleo debe detenerse ----
{
  const BYTES = Buffer.from([1, 2, 3])
  const construir = (alterar) => {
    const vistos = new Set()
    const seguro = async (u, init = {}) => {
      const variante = u.endsWith('/m.webp') ? 'm' : 'g'
      const metodo = init.method ?? 'GET'
      const cond = !!init.headers?.['If-None-Match']
      const primera = !vistos.has(variante)
      vistos.add(variante)
      const cab = { 'cf-ray': 'abc-MIA', 'x-medios-cache': primera ? 'MISS' : 'HIT', etag: esperados[variante].etag }
      const base = { status: cond ? 304 : 200, headers: cab, cuerpo: metodo === 'HEAD' || cond ? null : BYTES, tipo: cond ? 'COND' : metodo }
      const m = alterar ? alterar(base, { variante, tipo: base.tipo }) : base
      return new Response(m.cuerpo, { status: m.status, headers: m.headers })
    }
    return crearLeerUrl({ seguro, url: (g, v) => `https://x/medios/${g}/${v}.webp` })
  }
  const correr = async (alterar) => {
    const leerUrl = construir(alterar)
    return ejecutarCarga({
      esperados,
      leer: async ({ tipo, variante }) => {
        const metodo = tipo.startsWith('HEAD') ? 'HEAD' : 'GET'
        const headers = tipo.startsWith('COND') ? { 'If-None-Match': esperados[variante].etag } : {}
        const r = await leerUrl({ grupo: 'A', variante, metodo, headers })
        return { estado: r.estado, medios: r.medios, pop: r.pop, etag: r.etag, bytesOk: metodo === 'GET' ? r.bytes.equals(BYTES) : true, ms: r.ms }
      },
    })
  }
  const sinEtag = (cuando) => (base, ctx) => (cuando(ctx) ? { ...base, headers: Object.fromEntries(Object.entries(base.headers).filter(([k]) => k !== 'etag')) } : base)
  const sano = await correr(null)
  caso('EC-01 control: el adaptador real con respuestas correctas completa la carga', sano.completa && sano.lecturas === 302, sano)
  for (const [nombre, f] of [['GET', (c) => c.tipo === 'GET'], ['HEAD', (c) => c.tipo === 'HEAD'], ['304', (c) => c.tipo === 'COND']]) {
    const r = await correr(sinEtag(f))
    caso(`EC-01: ${nombre} sin ETag (adaptador real: null) → parada por ETag ausente`, !r.completa && /ETag ausente/.test(r.parada), r.parada)
  }
  const vacio = await correr((base) => ({ ...base, headers: { ...base.headers, etag: '' } }))
  caso('EC-01: ETag vacío → parada', !vacio.completa && /ETag ausente/.test(vacio.parada), vacio.parada)
  const sinRef = await ejecutarCarga({ esperados: { m: { etag: null }, g: { etag: '"eg"' } }, leer: async () => { throw new Error('no debe leer') } })
  caso('EC-01: sin ETag de referencia válido no se lanza la carga (0 lecturas)', !sinRef.completa && sinRef.lecturas === 0 && /referencia/.test(sinRef.parada), sinRef)
  caso('por muestra: se conservan los resúmenes de las 9 repeticiones (3 niveles × 3 muestras)', sano.porMuestra.length === 9 && sano.porMuestra.every((x) => x.n > 0), sano.porMuestra.length)
}

// ---- EC-02: flujo completo con un Worker/inventario en memoria ----
{
  const IDS = { A: '11111111-1111-4111-8111-111111111111', B: '22222222-2222-4222-8222-222222222222' }
  const DESTINO = 'fotos-galeria'
  const BYTESm = Buffer.from('m-bytes')
  const BYTESg = Buffer.from('g-bytes')
  const montar = ({ inicial = [], hook = {} } = {}) => {
    const almacen = new Map(inicial.map((k) => [k, Buffer.from('previo')]))
    const vistos = new Set()
    const llamadas = { subir: [], borrar: [], inventario: 0 }
    const etagDe = (k) => `"e-${k.split('/').slice(1).join('-')}"`
    const deps = {
      espera: async () => {},
      fabricarWebp: async (l) => { if (hook.fabricar) throw new Error('chromium caído'); return l === 64 ? BYTESm : BYTESg },
      inventario: async () => {
        llamadas.inventario += 1
        if (hook.inventarioCaeTrasEscribir && llamadas.subir.length > 0 && llamadas.inventario > hook.inventarioCaeTrasEscribir) throw new Error('inventario ilegible')
        return new Set(almacen.keys())
      },
      subir: async (grupo, v, cuerpo) => {
        const clave = `${DESTINO}/${IDS[grupo]}/${v}.webp`
        llamadas.subir.push(clave)
        if (hook.antesDePut) hook.antesDePut(almacen, clave)
        if (almacen.has(clave)) return 409
        if (hook.rechazo) return 500
        almacen.set(clave, cuerpo)
        if (hook.respuestaPerdida && llamadas.subir.length === 1) throw new Error('respuesta perdida')
        return 201
      },
      borrarPrefijo: async (pre) => { llamadas.borrar.push(pre); for (const k of [...almacen.keys()]) if (k.startsWith(pre)) almacen.delete(k); return 200 },
      leerUrl: async ({ grupo, variante, metodo = 'GET', headers = {} }) => {
        const clave = `${DESTINO}/${IDS[grupo]}/${variante}.webp`
        const base = { pop: 'MIA', cache: 'public, max-age=0, must-revalidate', nosniff: 'nosniff', robots: 'noindex', ms: 3 }
        if (!almacen.has(clave)) return { ...base, estado: 404, cache: 'no-store', medios: null, etag: null, bytes: Buffer.alloc(0) }
        const primera = !vistos.has(clave)
        if (metodo === 'GET') vistos.add(clave)
        const cond = headers['If-None-Match'] === etagDe(clave)
        return { ...base, estado: cond ? 304 : 200, medios: primera ? 'MISS' : 'HIT', etag: etagDe(clave), bytes: metodo === 'HEAD' || cond ? Buffer.alloc(0) : almacen.get(clave) }
      },
    }
    return { deps, almacen, llamadas }
  }
  const correr = async (opciones, ids = IDS) => {
    const w = montar(opciones)
    const informe = await ejecutarEnsayoCarga({ ids, destino: DESTINO, deps: w.deps })
    return { informe, ...w }
  }

  {
    const { informe, almacen, llamadas } = await correr()
    caso('flujo sano: completa, retirada acreditada, estado final confirmado, inventario vacío y 4 PUT', informe.completa && informe.retirada.conclusion === 'acreditada' && informe.estadoFinalConfirmado && almacen.size === 0 && llamadas.subir.length === 4, informe.resumen)
  }
  {
    const previo = `${DESTINO}/${IDS.A}/m.webp`
    const { informe, almacen, llamadas } = await correr({ inicial: [previo] })
    caso('EC-02: prefijo de A ya existente en el inventario inicial → aborta ANTES de cualquier PUT y sin ningún DELETE; el objeto previo queda intacto', !informe.completa && llamadas.subir.length === 0 && llamadas.borrar.length === 0 && almacen.has(previo) && informe.estadoFinalConfirmado === true, { llamadas })
  }
  {
    const previo = `${DESTINO}/${IDS.B}/g.webp`
    const { informe, almacen, llamadas } = await correr({ inicial: [previo] })
    caso('EC-02: prefijo de B ya existente → aborta antes de escribir, sin DELETE, objeto intacto', llamadas.subir.length === 0 && llamadas.borrar.length === 0 && almacen.has(previo) && !informe.completa, { llamadas })
  }
  {
    const previo = `${DESTINO}/${IDS.B}/m.webp`
    const { informe, almacen, llamadas } = await correr({ hook: { antesDePut: (alm, clave) => { if (clave === previo && !alm.has(previo)) alm.set(previo, Buffer.from('ajeno')) } } })
    caso('EC-02: 409 en B/m (objeto aparecido tras el inventario) → B se CONSERVA, A se limpia, pendiente explícito y estado NO confirmado', !informe.completa && !informe.estadoFinalConfirmado && almacen.get(previo)?.toString() === 'ajeno' && !llamadas.borrar.includes(`${DESTINO}/${IDS.B}/`) && llamadas.borrar.includes(`${DESTINO}/${IDS.A}/`) && informe.pendientes.length === 1, { borrar: llamadas.borrar, pendientes: informe.pendientes })
  }
  {
    const { informe, llamadas } = await correr({ hook: { fabricar: true } })
    caso('error antes del primer PUT (WebP): cero PUT y cero DELETE', llamadas.subir.length === 0 && llamadas.borrar.length === 0 && informe.estadoFinalConfirmado === true && !informe.completa, informe.error)
  }
  {
    const { informe, almacen, llamadas } = await correr({ hook: { respuestaPerdida: true } })
    caso('primer PUT guardado con respuesta perdida: la intención ya estaba registrada → se borra SOLO lo propio y el inventario vuelve al inicial', almacen.size === 0 && llamadas.borrar.length === 1 && informe.estadoFinalConfirmado === true && !informe.completa, { borrar: llamadas.borrar })
  }
  {
    const { informe, almacen, llamadas } = await correr({ hook: { rechazo: true } })
    caso('PUT rechazado (500) sin commit: 0 DELETE y el estado final se confirma por inventario', almacen.size === 0 && llamadas.borrar.length === 0 && informe.estadoFinalConfirmado === true && !informe.completa, informe.limpieza)
  }
  {
    const { informe } = await correr({ hook: { inventarioCaeTrasEscribir: 2 } })
    caso('inventario ilegible durante la limpieza: estado final NO confirmado (nunca se acepta como vacío)', informe.estadoFinalConfirmado === false && !informe.completa && informe.limpieza.errores.length > 0, informe.limpieza)
  }
  {
    const w = montar()
    const informe = await ejecutarEnsayoCarga({ ids: { A: IDS.A, B: IDS.A }, destino: DESTINO, deps: w.deps })
    caso('UUID de A y B iguales: aborta antes de leer el inventario o escribir', w.llamadas.inventario === 0 && w.llamadas.subir.length === 0 && w.llamadas.borrar.length === 0 && !informe.completa)
  }
  {
    const w = montar()
    const original = w.deps.leerUrl
    w.deps.leerUrl = async (a) => { const r = await original(a); return a.metodo === 'HEAD' ? { ...r, etag: null } : r }
    const informe = await ejecutarEnsayoCarga({ ids: IDS, destino: DESTINO, deps: w.deps })
    caso('HEAD de referencia sin ETag: no se lanza la carga (EC-01) y se limpia lo propio', informe.carga.lecturas === 0 && !informe.completa && w.almacen.size === 0 && informe.estadoFinalConfirmado === true, informe.error)
  }
  {
    const w = montar()
    const original = w.deps.leerUrl
    w.deps.leerUrl = async (a) => { const r = await original(a); return a.grupo === 'B' ? { ...r, estado: 500 } : r }
    const informe = await ejecutarEnsayoCarga({ ids: IDS, destino: DESTINO, deps: w.deps })
    caso('un caso fallido (control B) deja completa=false aunque la retirada y la limpieza estén bien', informe.retirada?.conclusion === 'acreditada' && informe.estadoFinalConfirmado === true && informe.completa === false, informe.resumen)
  }
}

const fallos = casos.filter((c) => !c.ok)
console.log(`\n${casos.length} casos, ${fallos.length} fallos`)
process.exitCode = fallos.length ? 1 : 0
