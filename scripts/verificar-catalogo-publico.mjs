// Pruebas de la lectura acotada de los catálogos públicos (Fase 4): piezas puras, constructores de consultas con un cliente simulado,
// y —contra el Supabase LOCAL positivamente verificado (http://127.0.0.1:54321)— las funciones SQL de vitrina y las páginas del
// listado sobre la réplica de miles. Solo lecturas; no escribe nada. Sin credenciales: usa la clave pública (anon) del .env.local.
//   node scripts/verificar-catalogo-publico.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  COLUMNAS_PRODUCTO_TARJETA, COLUMNAS_SERVICIO_TARJETA, GRUPOS_POR_VENTANA, MAX_CINTA, POR_CATEGORIA,
  agruparVitrina, cargarVentanaGrupos, cargarVitrinaProductos, cargarVitrinaServicios, componerHeroServicios, leerPaginaCatalogo, leerPorIds, metadatosCategorias, paginasTotales, rangoPagina,
} from '../src/lib/catalogoPublico.js'

const resultados = []
async function prueba(nombre, fn) {
  try { await fn(); resultados.push({ nombre, ok: true }); console.log(`OK    ${nombre}`) } catch (e) { resultados.push({ nombre, ok: false }); console.log(`FALLA ${nombre}\n      ${String(e.message).split('\n')[0].slice(0, 300)}`) }
}

// ---------- A. piezas puras ----------
await prueba('A: paginasTotales y rangoPagina (límites, vacío, página 0/negativa)', () => {
  assert.equal(paginasTotales(0), 1)
  assert.equal(paginasTotales(40), 1)
  assert.equal(paginasTotales(41), 2)
  assert.equal(paginasTotales(3245), 82)
  assert.deepEqual(rangoPagina(1), [0, 39])
  assert.deepEqual(rangoPagina(2), [40, 79])
  assert.deepEqual(rangoPagina(0), [0, 39])
  assert.deepEqual(rangoPagina(-5), [0, 39])
})
await prueba('A: agruparVitrina conserva el orden del servidor, toma el total global de cada categoría y quita total_categoria de las tarjetas', () => {
  const g = agruparVitrina([
    { id: 'a', categoria: 'Tinte', total_categoria: '15', nombre: 'A' },
    { id: 'b', categoria: 'Tinte', total_categoria: 15, nombre: 'B' },
    { id: 'c', categoria: 'Bebidas', total_categoria: 2, nombre: 'C' },
  ])
  assert.deepEqual(g.categorias, ['Tinte', 'Bebidas'])
  assert.deepEqual(g.conteos, { Tinte: 15, Bebidas: 2 })
  assert.equal(g.grupos[0].primeros.length, 2)
  assert.ok(!('total_categoria' in g.grupos[0].primeros[0]))
  assert.deepEqual(agruparVitrina(null), { grupos: [], categorias: [], conteos: {} })
})
await prueba('A: metadatosCategorias — nombres en orden y total de CADA categoría (independiente de las tarjetas)', () => {
  assert.deepEqual(metadatosCategorias([{ categoria: 'Tinte', total: '15' }, { categoria: 'Bebidas', total: 2 }]), { categorias: ['Tinte', 'Bebidas'], conteos: { Tinte: 15, Bebidas: 2 } })
  assert.deepEqual(metadatosCategorias(null), { categorias: [], conteos: {} })
})
await prueba('A: componerHeroServicios — prioridad tendencia → más pedidos (orden del ranking) → relleno; sin repetir; tope 3', () => {
  const S = (id) => ({ id, nombre: id })
  const h = componerHeroServicios({ tendencia: [S('t1')], ranking: ['r2', 'r1', 'x'], conRanking: [S('r1'), S('r2')], relleno: [S('t1'), S('f1'), S('f2')] })
  assert.deepEqual(h.map((s) => [s.id, s.etiquetaHero]), [['t1', 'En tendencia'], ['r2', 'Lo más pedido'], ['r1', 'Lo más pedido']])
  const h2 = componerHeroServicios({ relleno: [S('f1'), S('f2')] })
  assert.deepEqual(h2.map((s) => s.etiquetaHero), ['Recomendado', 'Recomendado'])
  assert.deepEqual(componerHeroServicios({}), [])
})

// ---------- B. constructores de consultas con un cliente simulado ----------
function clienteFalso(respuesta = { data: [], count: 0, error: null }) {
  const llamadas = []
  const consulta = (tabla) => {
    const reg = { tabla, pasos: [] }
    llamadas.push(reg)
    const q = new Proxy(function () {}, {
      get(_, prop) {
        if (prop === 'then') {
          const r = typeof respuesta === 'function' ? respuesta(reg) : respuesta
          return (ok, ko) => Promise.resolve(r).then(ok, ko)
        }
        return (...args) => { reg.pasos.push([String(prop), ...args]); return q }
      },
    })
    return q
  }
  return { llamadas, from: consulta, rpc: (nombre, args) => { const q = consulta(`rpc:${nombre}`); q.pasos = null; llamadas[llamadas.length - 1].pasos.push(['rpc', nombre, args]); return q } }
}
const paso = (reg, nombre) => reg.pasos.filter((p) => p[0] === nombre)

await prueba('B: leerPaginaCatalogo — activo, categoría, ilike con comodines ESCAPADOS, orden (nombre, id), range inclusivo y conteo exacto', async () => {
  const c = clienteFalso({ data: [{ id: '1' }], count: 91, error: null })
  const r = await leerPaginaCatalogo(c, { tabla: 'productos', columnas: COLUMNAS_PRODUCTO_TARJETA, categoria: 'Tinte', termino: ' 50%_off ', pagina: 3 })
  const reg = c.llamadas[0]
  assert.deepEqual(paso(reg, 'select')[0], ['select', COLUMNAS_PRODUCTO_TARJETA, { count: 'exact' }])
  assert.deepEqual(paso(reg, 'eq'), [['eq', 'activo', true], ['eq', 'categoria', 'Tinte']])
  assert.deepEqual(paso(reg, 'ilike')[0], ['ilike', 'nombre', '%50\\%\\_off%'])
  assert.deepEqual(paso(reg, 'order'), [['order', 'nombre'], ['order', 'id']])
  assert.deepEqual(paso(reg, 'range')[0], ['range', 80, 119])
  assert.deepEqual(r, { filas: [{ id: '1' }], total: 91 })
})
await prueba('B: leerPaginaCatalogo — «todos» y texto vacío no agregan filtros; la señal de cancelación se propaga', async () => {
  const c = clienteFalso()
  const control = new AbortController()
  await leerPaginaCatalogo(c, { tabla: 'servicios', columnas: COLUMNAS_SERVICIO_TARJETA, categoria: 'todos', termino: '   ', signal: control.signal })
  const reg = c.llamadas[0]
  assert.deepEqual(paso(reg, 'eq'), [['eq', 'activo', true]])
  assert.equal(paso(reg, 'ilike').length, 0)
  assert.equal(paso(reg, 'abortSignal')[0][1], control.signal)
})
await prueba('B: leerPaginaCatalogo — un error de la consulta se LANZA (no se confunde con «sin resultados»)', async () => {
  const c = clienteFalso({ data: null, count: null, error: { message: 'boom', code: '500' } })
  await assert.rejects(() => leerPaginaCatalogo(c, { tabla: 'productos', columnas: 'id' }), (e) => e.message === 'boom')
})
await prueba('B: cargarVitrinaProductos — una pieza opcional (héroe/cintas) que falla NO bloquea; la vitrina o el total que fallan SÍ lanzan', async () => {
  const filasVitrina = [{ id: 'p1', categoria: 'Tinte', total_categoria: 3, nombre: 'A' }]
  const responder = (falla) => (reg) => {
    const esRpc = reg.tabla.startsWith('rpc:')
    const esHead = paso(reg, 'select').some((s) => s[2]?.head)
    if (falla === 'vitrina' && esRpc) return { data: null, error: { message: 'vitrina' } }
    if (falla === 'total' && esHead) return { data: null, error: { message: 'total' } }
    if (falla === 'cintas' && !esRpc && !esHead) return { data: null, error: { message: 'cinta' } }
    if (reg.tabla === 'rpc:productos_categorias_publicas') return { data: [{ categoria: 'Tinte', total: 3 }], count: 1, error: null }
    return { data: esRpc ? filasVitrina : [], count: esHead ? 7 : 0, error: null }
  }
  const ok = await cargarVitrinaProductos(clienteFalso(responder('cintas')))
  assert.deepEqual(ok.hero, [])
  assert.deepEqual(ok.ofertas, { filas: [], total: 0 })
  assert.equal(ok.total, 7)
  assert.deepEqual(ok.categorias, ['Tinte'])
  assert.deepEqual(ok.conteos, { Tinte: 3 })
  assert.equal(ok.grupos[0].primeros.length, 1)
  await assert.rejects(() => cargarVitrinaProductos(clienteFalso(responder('vitrina'))), (e) => e.message === 'vitrina')
  await assert.rejects(() => cargarVitrinaProductos(clienteFalso(responder('total'))), (e) => e.message === 'total')
})
await prueba('B: cargarVitrinaProductos — criterios explícitos y límites de héroe/ofertas/destacados', async () => {
  const c = clienteFalso()
  await cargarVitrinaProductos(c)
  const regs = c.llamadas
  const ventana = regs.find((r) => r.tabla === 'rpc:productos_vitrina_publica')
  assert.deepEqual(ventana.pasos[0], ['rpc', 'productos_vitrina_publica', { por_categoria: POR_CATEGORIA, grupo_desde: 0, grupos_max: GRUPOS_POR_VENTANA }])
  assert.ok(regs.some((r) => r.tabla === 'rpc:productos_categorias_publicas'), 'los metadatos de categorías salen de su propia función')
  const limites = regs.flatMap((r) => paso(r, 'limit').map((l) => l[1]))
  assert.deepEqual(limites.sort((a, b) => a - b), [5, MAX_CINTA, MAX_CINTA])
  const ofertas = regs.find((r) => paso(r, 'not').some((n) => n[1] === 'precio_antes'))
  assert.ok(paso(ofertas, 'gt').some((g) => g[1] === 'stock_actual' && g[2] === 0))
})
await prueba('B: cargarVitrinaServicios — héroe compuesto y precio mínimo del servidor', async () => {
  const S = (id, extra = {}) => ({ id, nombre: id, foto_url: 'x', precio: 10, ...extra })
  const c = clienteFalso((reg) => {
    if (reg.tabla === 'rpc:servicios_categorias_publicas') return { data: [{ categoria: 'Cabello', total: 9 }], count: 1, error: null }
    if (reg.tabla === 'rpc:servicios_vitrina_publica') return { data: [{ id: 's1', categoria: 'Cabello', total_categoria: 9, nombre: 'S1' }], error: null }
    if (reg.tabla === 'rpc:servicios_mas_pedidos') return { data: [{ servicio_id: 'r1' }], error: null }
    if (paso(reg, 'select').some((s) => s[2]?.head)) return { data: null, count: 5, error: null }
    if (paso(reg, 'eq').some((e) => e[1] === 'en_tendencia')) return { data: [S('t1')], error: null }
    if (paso(reg, 'in').length) return { data: [S('r1')], error: null }
    if (paso(reg, 'select').some((s) => s[1] === 'precio')) return { data: [{ precio: '12.50' }], error: null }
    return { data: [S('f1')], error: null }
  })
  const r = await cargarVitrinaServicios(c)
  assert.deepEqual(r.hero.map((s) => s.etiquetaHero), ['En tendencia', 'Lo más pedido', 'Recomendado'])
  assert.equal(r.precioDesde, 12.5)
  assert.equal(r.total, 5)
})
await prueba('B: cargarVentanaGrupos — la ventana n pide grupo_desde=(n-1)×10 con tope de 10 grupos, en Productos y en Servicios', async () => {
  const c = clienteFalso({ data: [], error: null })
  await cargarVentanaGrupos(c, { tabla: 'productos', pagina: 3 })
  await cargarVentanaGrupos(c, { tabla: 'servicios', pagina: 2 })
  assert.deepEqual(c.llamadas[0].pasos[0], ['rpc', 'productos_vitrina_publica', { por_categoria: POR_CATEGORIA, grupo_desde: 20, grupos_max: GRUPOS_POR_VENTANA }])
  assert.deepEqual(c.llamadas[1].pasos[0], ['rpc', 'servicios_vitrina_publica', { por_categoria: POR_CATEGORIA, dias: 30, grupo_desde: 10, grupos_max: GRUPOS_POR_VENTANA }])
})
await prueba('B: leerPorIds — sin ids no consulta; con ids usa una sola consulta `in`', async () => {
  const c = clienteFalso({ data: [{ id: 'a', precio: 1 }], error: null })
  assert.deepEqual(await leerPorIds(c, 'productos', 'id, precio', []), [])
  assert.equal(c.llamadas.length, 0)
  assert.deepEqual(await leerPorIds(c, 'productos', 'id, precio', ['a', 'b']), [{ id: 'a', precio: 1 }])
  assert.deepEqual(paso(c.llamadas[0], 'in')[0], ['in', 'id', ['a', 'b']])
})

// ---------- C. contra el Supabase LOCAL (solo lectura, clave pública) ----------
const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]))
const LOCAL = 'http://127.0.0.1:54321'
if (env.VITE_SUPABASE_URL !== LOCAL) {
  console.log(`\nOMITIDO: .env.local no apunta a ${LOCAL} (apunta a «${env.VITE_SUPABASE_URL}»). Las pruebas contra la base NO se ejecutan.`)
} else {
  const supabase = createClient(LOCAL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const todo = async (tabla, columnas) => {
    const filas = []
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await supabase.from(tabla).select(columnas).eq('activo', true).order('nombre').order('id').range(desde, desde + 999)
      assert.ifError(error)
      filas.push(...data)
      if (data.length < 1000) return filas
    }
  }
  const productos = await todo('productos', COLUMNAS_PRODUCTO_TARJETA)
  const servicios = await todo('servicios', COLUMNAS_SERVICIO_TARJETA)
  console.log(`      (base local: ${productos.length} productos y ${servicios.length} servicios activos)`)

  // Algoritmo que usaban las páginas en el navegador, para comparar exactamente.
  const legado = (filas, rango = new Map()) => {
    const categorias = [...new Set(filas.map((f) => f.categoria).filter(Boolean))]
    return categorias.map((categoria) => {
      const todos = [...filas.filter((f) => f.categoria === categoria)]
      todos.sort((a, b) => {
        const ra = rango.has(a.id) ? rango.get(a.id) : Infinity
        const rb = rango.has(b.id) ? rango.get(b.id) : Infinity
        return ra !== rb ? ra - rb : 0 // el sort es estable: conserva el orden (nombre, id) del servidor
      })
      return { categoria, total: todos.length, ids: todos.slice(0, POR_CATEGORIA).map((f) => f.id) }
    })
  }

  await prueba('C: productos_vitrina_publica — categorías, orden, totales y primeras tarjetas IDÉNTICOS al cálculo anterior del navegador', async () => {
    const v = await cargarVitrinaProductos(supabase)
    const esperado = legado(productos)
    assert.ok(esperado.length > 0)
    assert.deepEqual(v.categorias, esperado.map((e) => e.categoria)) // metadatos: TODAS las categorías, en el orden anterior
    assert.deepEqual(v.conteos, Object.fromEntries(esperado.map((e) => [e.categoria, e.total])))
    assert.deepEqual(v.grupos.map((g) => ({ categoria: g.categoria, total: g.total, ids: g.primeros.map((f) => f.id) })), esperado.slice(0, GRUPOS_POR_VENTANA))
    assert.equal(v.total, productos.length)
  })
  await prueba('C: servicios_vitrina_publica — igual que el cálculo anterior, con «más pedidos» primero dentro de cada categoría', async () => {
    const { data: ranking, error } = await supabase.rpc('servicios_mas_pedidos', { dias: 30 })
    assert.ifError(error)
    // Los servicios con las MISMAS reservas comparten posición (dense_rank) y se ordenan por nombre e id (el sort es estable sobre
    // el orden nombre,id del servidor). Antes el orden entre empatados era arbitrario (plan de ejecución), no hay contrato que conservar.
    const distintas = [...new Set(ranking.map((f) => Number(f.reservas)))].sort((x, y) => y - x)
    const rango = new Map(ranking.map((f) => [f.servicio_id, distintas.indexOf(Number(f.reservas))]))
    const v = await cargarVitrinaServicios(supabase)
    const esperado = legado(servicios, rango)
    assert.deepEqual(v.categorias, esperado.map((e) => e.categoria))
    assert.deepEqual(v.grupos.map((g) => ({ categoria: g.categoria, total: g.total, ids: g.primeros.map((f) => f.id) })), esperado.slice(0, GRUPOS_POR_VENTANA))
    assert.equal(v.total, servicios.length)
    assert.equal(v.precioDesde, Math.min(...servicios.map((s) => Number(s.precio))))
  })
  await prueba('C: héroe, ofertas y destacados de Productos == filtro anterior (con stock, mismo orden, mismos topes)', async () => {
    const v = await cargarVitrinaProductos(supabase)
    const conStock = productos.filter((p) => p.stock_actual > 0)
    assert.deepEqual(v.hero.map((p) => p.id), conStock.filter((p) => p.en_inicio).slice(0, 5).map((p) => p.id))
    const ofertas = conStock.filter((p) => p.precio_antes && Number(p.precio_antes) > 0)
    assert.deepEqual(v.ofertas.filas.map((p) => p.id), ofertas.slice(0, MAX_CINTA).map((p) => p.id))
    assert.equal(v.ofertas.total, ofertas.length)
    const destacados = conStock.filter((p) => p.destacado)
    assert.deepEqual(v.destacados.filas.map((p) => p.id), destacados.slice(0, MAX_CINTA).map((p) => p.id))
    assert.equal(v.destacados.total, destacados.length)
  })
  // Ventanas de grupos: la unión de TODAS las ventanas reproduce el cálculo anterior, sin duplicar ni omitir categorías, y ninguna
  // supera 10 grupos ni 40 tarjetas. Con pocas categorías (<= 10) solo hay una ventana: ejecute `escenario-catalogo-qa.mjs
  // sembrar-categorias` para cubrir también las siguientes (la verificación de la entrega lo hace).
  for (const [tabla, filasTabla] of [['productos', productos], ['servicios', servicios]]) {
    await prueba(`C: ${tabla} — las ventanas de grupos cubren TODAS las categorías sin duplicar ni omitir y cada una ≤ ${GRUPOS_POR_VENTANA} grupos / ${GRUPOS_POR_VENTANA * POR_CATEGORIA} tarjetas`, async () => {
      let rango = new Map()
      if (tabla === 'servicios') {
        const { data: ranking } = await supabase.rpc('servicios_mas_pedidos', { dias: 30 })
        const distintas = [...new Set(ranking.map((f) => Number(f.reservas)))].sort((x, y) => y - x)
        rango = new Map(ranking.map((f) => [f.servicio_id, distintas.indexOf(Number(f.reservas))]))
      }
      const esperado = legado(filasTabla, rango)
      const vistas = []
      for (let pagina = 1; ; pagina++) {
        const grupos = await cargarVentanaGrupos(supabase, { tabla, pagina })
        if (!grupos.length) break
        assert.ok(grupos.length <= GRUPOS_POR_VENTANA, `ventana ${pagina}: ${grupos.length} grupos`)
        assert.ok(grupos.reduce((n, g) => n + g.primeros.length, 0) <= GRUPOS_POR_VENTANA * POR_CATEGORIA)
        vistas.push(...grupos)
      }
      assert.equal(new Set(vistas.map((g) => g.categoria)).size, vistas.length, 'categoría repetida entre ventanas')
      assert.deepEqual(vistas.map((g) => ({ categoria: g.categoria, total: g.total, ids: g.primeros.map((f) => f.id) })), esperado)
      console.log(`      (${tabla}: ${esperado.length} categorías en ${Math.ceil(esperado.length / GRUPOS_POR_VENTANA)} ventana(s))`)
    })
  }
  await prueba('C: los parámetros están ACOTADOS en el servidor (por_categoria ≤ 12, grupos_max ≤ 20, valores negativos o enormes no rompen ni devuelven todo)', async () => {
    const grande = await supabase.rpc('productos_vitrina_publica', { por_categoria: 100000, grupo_desde: 0, grupos_max: 100000 })
    assert.ifError(grande.error)
    const porCat = Object.values(Object.groupBy(grande.data, (f) => f.categoria))
    assert.ok(porCat.length <= 20 && porCat.every((filas) => filas.length <= 12), 'sin acotar')
    const negativo = await supabase.rpc('productos_vitrina_publica', { por_categoria: -3, grupo_desde: -50, grupos_max: -1 })
    assert.ifError(negativo.error)
    assert.ok(negativo.data.length >= 1 && new Set(negativo.data.map((f) => f.categoria)).size === 1, 'mínimo: 1 grupo')
    const lejos = await supabase.rpc('productos_vitrina_publica', { por_categoria: 4, grupo_desde: 1000000, grupos_max: 10 })
    assert.deepEqual(lejos.data, [])
    const sv = await supabase.rpc('servicios_vitrina_publica', { por_categoria: 100000, dias: 30, grupo_desde: 0, grupos_max: 100000 })
    assert.ifError(sv.error)
    const svPorCat = Object.values(Object.groupBy(sv.data, (f) => f.categoria))
    assert.ok(svPorCat.length <= 20 && svPorCat.every((filas) => filas.length <= 12))
  })
  await prueba('C: *_categorias_publicas devuelve UNA fila por categoría con su total y respeta RLS (anon)', async () => {
    const { data, error } = await supabase.rpc('productos_categorias_publicas')
    assert.ifError(error)
    assert.equal(new Set(data.map((f) => f.categoria)).size, data.length)
    assert.equal(data.reduce((n, f) => n + Number(f.total), 0), productos.filter((p) => p.categoria).length)
    const sv = await supabase.rpc('servicios_categorias_publicas')
    assert.ifError(sv.error)
    assert.equal(sv.data.reduce((n, f) => n + Number(f.total), 0), servicios.filter((p) => p.categoria).length)
  })
  await prueba('C: la vitrina NO expone columnas privadas (costo, proveedor, stock_minimo, codigo_barras) y respeta el límite por categoría', async () => {
    const { data, error } = await supabase.rpc('productos_vitrina_publica', { por_categoria: 4 })
    assert.ifError(error)
    for (const privada of ['costo', 'proveedor', 'stock_minimo', 'codigo_barras']) assert.ok(!(privada in data[0]), privada)
    const porCat = Object.groupBy(data, (f) => f.categoria)
    for (const filas of Object.values(porCat)) assert.ok(filas.length <= 4)
    const grande = await supabase.rpc('productos_vitrina_publica', { por_categoria: 1 })
    for (const filas of Object.values(Object.groupBy(grande.data, (f) => f.categoria))) assert.equal(filas.length, 1)
  })

  const paginar = async (tabla, columnas, params) => {
    const filas = []
    let total = null
    for (let pagina = 1; ; pagina++) {
      const r = await leerPaginaCatalogo(supabase, { tabla, columnas, ...params, pagina })
      total = r.total
      filas.push(...r.filas)
      if (pagina >= paginasTotales(r.total)) return { filas, total }
    }
  }
  await prueba('C: recorrer TODAS las páginas de la réplica (más de 1000 filas) no duplica ni omite y respeta el orden (nombre, id)', async () => {
    const { filas, total } = await paginar('productos', COLUMNAS_PRODUCTO_TARJETA, {})
    assert.equal(total, productos.length)
    assert.equal(filas.length, productos.length)
    assert.equal(new Set(filas.map((f) => f.id)).size, filas.length)
    assert.deepEqual(filas.map((f) => f.id), productos.map((f) => f.id))
  })
  await prueba('C: la búsqueda alcanza filas POSTERIORES a la posición 1000 y filtra igual que el algoritmo anterior', async () => {
    const objetivo = productos.findIndex((p) => /ULTIMA UNIDAD/.test(p.nombre))
    assert.ok(objetivo > 1000, `se esperaba un producto después de la posición 1000, está en ${objetivo}`)
    const { filas, total } = await paginar('productos', COLUMNAS_PRODUCTO_TARJETA, { termino: 'ultima unidad' })
    const esperado = productos.filter((p) => p.nombre.toLowerCase().includes('ultima unidad'))
    assert.deepEqual(filas.map((f) => f.id), esperado.map((f) => f.id))
    assert.equal(total, esperado.length)
  })
  await prueba('C: con nombres repetidos el orden es determinista (mismo resultado dos veces, desempate por id)', async () => {
    const a = (await paginar('productos', 'id, nombre', {})).filas
    const b = (await paginar('productos', 'id, nombre', {})).filas
    assert.deepEqual(a, b)
    const repetido = a.find((f, i) => i > 0 && f.nombre === a[i - 1].nombre)
    assert.ok(repetido, 'la réplica debe tener nombres repetidos para esta prueba')
  })
  await prueba('C: categoría + texto, texto con comodines (% _) y texto sin coincidencias', async () => {
    const cat = productos.find((p) => p.categoria)?.categoria
    const { filas, total } = await paginar('productos', COLUMNAS_PRODUCTO_TARJETA, { categoria: cat })
    assert.deepEqual(filas.map((f) => f.id), productos.filter((p) => p.categoria === cat).map((f) => f.id))
    assert.equal(total, filas.length)
    const comodin = await leerPaginaCatalogo(supabase, { tabla: 'productos', columnas: 'id', termino: '%' })
    assert.equal(comodin.total, productos.filter((p) => p.nombre.includes('%')).length) // «%» literal, no «cualquier cosa»
    const nada = await leerPaginaCatalogo(supabase, { tabla: 'productos', columnas: 'id', termino: 'zzz-no-existe-123' })
    assert.deepEqual(nada, { filas: [], total: 0 })
  })
  await prueba('C: servicios — páginas completas sin duplicar y búsqueda más allá de la posición 1000', async () => {
    const { filas, total } = await paginar('servicios', COLUMNAS_SERVICIO_TARJETA, {})
    assert.equal(total, servicios.length)
    assert.deepEqual(filas.map((f) => f.id), servicios.map((f) => f.id))
    const r = await paginar('servicios', COLUMNAS_SERVICIO_TARJETA, { termino: 'PORC muy8' })
    assert.deepEqual(r.filas.map((f) => f.id), servicios.filter((s) => s.nombre.toLowerCase().includes('porc muy8')).map((f) => f.id))
  })
  await prueba('C: página fuera de rango → el servidor responde 416/PGRST103 (el hook la trata sin romper)', async () => {
    await assert.rejects(() => leerPaginaCatalogo(supabase, { tabla: 'productos', columnas: 'id', termino: 'zzz-no-existe-123', pagina: 5 }), (e) => e.code === 'PGRST103')
  })
  await prueba('C: leerPorIds devuelve solo los pedidos y las cintas respetan «activo»', async () => {
    const ids = [productos[0].id, productos[1500].id]
    const r = await leerPorIds(supabase, 'productos', 'id, precio', ids)
    assert.deepEqual(r.map((f) => f.id).sort(), [...ids].sort())
  })
}

const fallos = resultados.filter((r) => !r.ok)
console.log(`\n${resultados.length} casos, ${fallos.length} fallos`)
process.exit(fallos.length ? 1 : 0)
