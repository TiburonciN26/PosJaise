// Regresiones SIN red del FLUJO COMPLETO del ensayo de rollback de Galería (scripts/lib/ensayo-rollback.cjs): RBG-01 y RBG-02.
//   node scripts/verificar-ensayo-rollback-galeria.cjs
// El «mundo» es memoria: filas de galeria_web, objetos de R2 y contadores de cada escritura. Se usan los helpers y el módulo de
// URLs reales; nada sale de la máquina ni toca Supabase/R2/Cloudflare.
const assert = require('node:assert/strict')
const path = require('node:path')
const G = require('./lib/guardas-interfaz-r2.cjs')
const { ejecutarEnsayo } = require('./lib/ensayo-rollback.cjs')

const ALIAS = G.ALIAS_APROBADO
const PAGES = `${ALIAS}/medios`
const R2DEV = G.PUBLICO_APROBADO
const DESTINO = 'fotos-galeria'
const IDS = { idFila: 'aaaaaaaa-1111-4222-8333-444444444444', idAntes: 'bbbbbbbb-1111-4222-8333-444444444444', idDespues: 'cccccccc-1111-4222-8333-444444444444', titulo: 'QA rollback a1b2c3 (borrar)' }
const ANTIGUA = { id: '4ab5c994-9bb1-40bf-b5ff-186d45603781', titulo: 'Foto de prueba (Inicio)', antes_url: 'inicio-web/a.jpg', despues_url: 'inicio-web/b.jpg', orden: 0, activo: true }
const AJENA_OCULTA = { id: 'dddddddd-1111-4222-8333-444444444444', titulo: 'Otra fila oculta', antes_url: 'x/a.jpg', despues_url: 'x/b.jpg', orden: 9999, activo: false }
const BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50])

const resultados = []
async function prueba(nombre, fn) {
  try { await fn(); resultados.push({ nombre, ok: true }); console.log(`OK    ${nombre}`) } catch (e) { resultados.push({ nombre, ok: false }); console.log(`FALLA ${nombre}\n      ${String(e.message).split('\n')[0].slice(0, 300)}`) }
}

// Mundo simulado con inyección de fallos
function mundo(o = {}) {
  const w = {
    filas: structuredClone(o.filasIniciales ?? [ANTIGUA, AJENA_OCULTA]),
    objetos: new Set(o.objetosIniciales ?? ['fotos-galeria/ajeno/m.webp', 'fotos-galeria/ajeno/g.webp']),
    c: { insert: 0, patch: 0, deleteFila: 0, put: 0, deleteGrupo: 0, lecturasFilas: 0 },
    borradosFila: [],
  }
  const U = o.U
  const deps = {
    bases: { pages: PAGES, r2dev: R2DEV }, ids: o.ids ?? IDS, destino: DESTINO, conObjetos: !!o.conObjetos, U,
    prefijoStorage: 'https://staging.supabase.co/storage/v1/object/public/fotos-galeria/',
    leerFilas: async () => {
      w.c.lecturasFilas += 1
      if (o.leerFallaEn && w.c.lecturasFilas >= o.leerFallaEn && (o.leerFallaHasta === undefined || w.c.lecturasFilas <= o.leerFallaHasta)) throw new Error('lectura caída (503)')
      return structuredClone(w.filas).sort((a, b) => (a.id < b.id ? -1 : 1))
    },
    leerInventario: async () => {
      w.c.lecturasInv = (w.c.lecturasInv ?? 0) + 1
      if (o.invFallaEn && w.c.lecturasInv >= o.invFallaEn) throw new Error('inventario caído/paginado')
      return new Set(w.objetos)
    },
    fabricarWebp: async () => BYTES,
    subir: async (id, v) => {
      w.c.put += 1
      if (o.subir === 'primero-confirmado-respuesta-perdida' && w.c.put === 1) { w.objetos.add(`${DESTINO}/${id}/${v}.webp`); throw new Error('primer PUT confirmado, respuesta perdida') }
      if (o.subir === 'primero-sin-commit' && w.c.put === 1) throw new Error('primer PUT sin commit')
      if (o.subir === 'segundo-confirmado-respuesta-perdida' && w.c.put === 2) { w.objetos.add(`${DESTINO}/${id}/${v}.webp`); throw new Error('segundo PUT confirmado, respuesta perdida') }
      w.objetos.add(`${DESTINO}/${id}/${v}.webp`)
      return 201
    },
    borrarGrupo: async (pre) => {
      w.c.deleteGrupo += 1
      if (o.grupoRechazado) return 500 // DELETE rechazado: el objeto sigue
      for (const k of [...w.objetos]) if (k.startsWith(pre)) w.objetos.delete(k)
      return 200
    },
    insertarFila: async (cuerpo) => {
      w.c.insert += 1
      if (o.insertar === '500-sin-commit') return { estado: 500 }
      w.filas.push({ ...cuerpo })
      if (o.editarTrasInsert) Object.assign(w.filas.find((f) => f.id === cuerpo.id), o.editarTrasInsert) // edición concurrente
      if (o.insertar === 'respuesta-perdida') throw new Error('respuesta perdida')
      return { estado: 201 }
    },
    actualizarFila: async (id, titulo, cambios) => {
      w.c.patch += 1
      const f = w.filas.find((x) => x.id === id && x.titulo === titulo)
      if (!f || o.patchSinEfecto) return { estado: 200, filas: [] }
      Object.assign(f, cambios)
      return { estado: 200, filas: [structuredClone(f)] }
    },
    borrarFila: async (id) => {
      w.c.deleteFila += 1
      w.borradosFila.push(id)
      if (!o.deleteSinEfecto) w.filas = w.filas.filter((f) => f.id !== id)
      return { estado: o.deleteSinEfecto ? 204 : 204 }
    },
    leerUrl: async (_url) => ({ estado: 200, tipo: 'image/webp', bytes: BYTES }),
  }
  return { w, deps }
}

const sinEscrituras = (c) => c.insert === 0 && c.patch === 0 && c.deleteFila === 0 && c.put === 0 && c.deleteGrupo === 0
const estadoInicial = (w, o = {}) => G.iguales(w.filas, structuredClone(o.filasIniciales ?? [ANTIGUA, AJENA_OCULTA]).sort((a, b) => (a.id < b.id ? -1 : 1))) && w.objetos.size === (o.objetosIniciales ?? ['x', 'y']).length

;(async () => {
  const U = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'src/lib/urlsMedios.js')).href)
  const correr = async (o = {}) => { const m = mundo({ ...o, U }); const inf = await ejecutarEnsayo(m.deps); return { ...m, inf } }

  await prueba('A sano: conversión de la fila propia, relectura exacta y limpieza; estado final idéntico al inicial, completa', async () => {
    const r = await correr()
    assert.ok(r.inf.completa && r.inf.estadoFinalConfirmado && r.inf.resumen.fallos === 0, JSON.stringify(r.inf.casos.filter((c) => !c.ok)))
    assert.equal(r.w.c.put, 0)
    assert.ok(estadoInicial(r.w))
    assert.deepEqual(r.w.borradosFila, [IDS.idFila])
  })
  await prueba('B sano: 4 PUT, bytes por Pages y r2.dev, Pages sigue sirviendo, limpieza ordenada; inventario y filas finales idénticos', async () => {
    const r = await correr({ conObjetos: true })
    assert.ok(r.inf.completa && r.inf.estadoFinalConfirmado && r.inf.resumen.fallos === 0, JSON.stringify(r.inf.casos.filter((c) => !c.ok)))
    assert.equal(r.w.c.put, 4)
    assert.ok(estadoInicial(r.w))
  })

  // RBG-01: las precondiciones abortan ANTES de escribir y no borran nada
  await prueba('RBG-01 título propio ya presente (metadata igual): aborto con CERO escrituras y la fila previa se conserva', async () => {
    const previa = { id: 'eeeeeeee-1111-4222-8333-444444444444', titulo: IDS.titulo, antes_url: 'x/a.jpg', despues_url: 'x/b.jpg', orden: 9999, activo: false }
    const r = await correr({ filasIniciales: [ANTIGUA, previa] })
    assert.ok(sinEscrituras(r.w.c) && !r.inf.completa && r.inf.sinEscrituras)
    assert.ok(r.w.filas.some((f) => f.id === previa.id))
  })
  await prueba('RBG-01 título previo con metadata DISTINTA: igualmente cero escrituras', async () => {
    const previa = { id: 'eeeeeeee-1111-4222-8333-444444444444', titulo: IDS.titulo, antes_url: 'x/a.jpg', despues_url: 'x/b.jpg', orden: 5, activo: true }
    const r = await correr({ filasIniciales: [ANTIGUA, previa] })
    assert.ok(sinEscrituras(r.w.c) && !r.inf.completa)
  })
  await prueba('RBG-01 título previo + INSERT que fallaría (500): no se intenta ni se borra la fila inicial', async () => {
    const previa = { id: 'eeeeeeee-1111-4222-8333-444444444444', titulo: IDS.titulo, antes_url: 'x/a.jpg', despues_url: 'x/b.jpg', orden: 9999, activo: false }
    const r = await correr({ filasIniciales: [ANTIGUA, previa], insertar: '500-sin-commit' })
    assert.ok(sinEscrituras(r.w.c))
    assert.equal(r.w.filas.length, 2)
  })
  await prueba('RBG-01 colisión del id previsto de la fila: aborto con cero escrituras', async () => {
    const colision = { id: IDS.idFila, titulo: 'otra', antes_url: 'x/a.jpg', despues_url: 'x/b.jpg', orden: 1, activo: true }
    const r = await correr({ filasIniciales: [ANTIGUA, colision] })
    assert.ok(sinEscrituras(r.w.c) && !r.inf.completa)
    assert.ok(r.w.filas.some((f) => f.id === IDS.idFila && f.titulo === 'otra'))
  })
  await prueba('RBG-01 colisión de los grupos previstos en el inventario: aborto sin escribir', async () => {
    const r = await correr({ objetosIniciales: [`${DESTINO}/${IDS.idAntes}/m.webp`] })
    assert.ok(sinEscrituras(r.w.c) && !r.inf.completa)
    assert.ok(r.w.objetos.has(`${DESTINO}/${IDS.idAntes}/m.webp`))
  })
  await prueba('RBG-01 lectura inicial fallida (snapshot no verificable): aborto sin escribir', async () => {
    const r = await correr({ leerFallaEn: 1 })
    assert.ok(sinEscrituras(r.w.c) && !r.inf.completa)
  })
  await prueba('RBG-01 INSERT rechazado (500, sin commit) tras el preflight: NO se borra ninguna fila inicial (ni la oculta con orden 9999)', async () => {
    const r = await correr({ insertar: '500-sin-commit' })
    assert.equal(r.w.c.deleteFila, 0)
    assert.ok(r.w.filas.some((f) => f.id === ANTIGUA.id) && r.w.filas.some((f) => f.id === AJENA_OCULTA.id))
    assert.ok(!r.inf.completa && r.inf.creacionIntentada && !r.inf.creacionConfirmada)
    assert.ok(r.inf.estadoFinalConfirmado) // no quedó nada propio y el estado coincide con el inicial
  })
  await prueba('RBG-01 (B) INSERT rechazado tras subir objetos: se borran SOLO los grupos propios (la fila no existe) y lo ajeno queda', async () => {
    const r = await correr({ conObjetos: true, insertar: '500-sin-commit' })
    assert.equal(r.w.c.deleteFila, 0)
    assert.ok(r.w.objetos.has('fotos-galeria/ajeno/m.webp') && ![...r.w.objetos].some((k) => k.includes(IDS.idAntes) || k.includes(IDS.idDespues)))
    assert.ok(r.inf.estadoFinalConfirmado && !r.inf.completa)
  })

  // RBG-02: identidad exacta, nunca metadatos
  for (const [nombre, edicion] of [['sin edición', null], ['título editado', { titulo: 'QA otro título' }], ['activo editado', { activo: true }], ['orden editado', { orden: 1 }]]) {
    await prueba(`RBG-02 (B) INSERT confirmado con respuesta perdida, ${nombre}: se identifica por id, se borra la fila y luego sus objetos; nada queda roto`, async () => {
      const r = await correr({ conObjetos: true, insertar: 'respuesta-perdida', editarTrasInsert: edicion })
      assert.deepEqual(r.w.borradosFila, [IDS.idFila])
      assert.ok(!r.w.filas.some((f) => f.id === IDS.idFila), 'la fila propia no debe quedar viva')
      assert.ok(![...r.w.objetos].some((k) => k.includes(IDS.idAntes) || k.includes(IDS.idDespues)))
      assert.ok(r.w.filas.some((f) => f.id === ANTIGUA.id) && r.w.filas.some((f) => f.id === AJENA_OCULTA.id))
      assert.ok(r.inf.estadoFinalConfirmado && !r.inf.completa) // la corrida falla por el INSERT sin confirmar, pero el estado final es limpio
    })
  }
  await prueba('RBG-02 lectura por id caída en la limpieza: no se borra la fila ni los objetos (estado desconocido, pendientes registrados)', async () => {
    // lecturas: 1 snapshot, 2 reconciliación tras el INSERT, 3 UPDATE→relectura, 4 limpieza ← cae desde aquí
    const r = await correr({ conObjetos: true, leerFallaEn: 4 })
    assert.equal(r.w.c.deleteFila, 0)
    assert.equal(r.w.c.deleteGrupo, 0)
    assert.ok(r.w.filas.some((f) => f.id === IDS.idFila) && r.w.objetos.has(`${DESTINO}/${IDS.idAntes}/m.webp`))
    assert.ok(r.inf.conservaObjetos && !r.inf.estadoFinalConfirmado && !r.inf.completa && r.inf.pendientes.length >= 1)
  })
  await prueba('RBG-02 DELETE 204 SIN efecto: la fila sigue viva ⇒ se CONSERVAN los objetos (cero borrados de grupos)', async () => {
    const r = await correr({ conObjetos: true, deleteSinEfecto: true })
    assert.equal(r.w.c.deleteGrupo, 0)
    assert.ok(r.w.filas.some((f) => f.id === IDS.idFila) && r.w.objetos.has(`${DESTINO}/${IDS.idDespues}/g.webp`))
    assert.ok(r.inf.conservaObjetos && !r.inf.completa && r.inf.pendientes.includes(`galeria_web:${IDS.idFila}`))
  })
  await prueba('RBG-02 DELETE aplicado pero la relectura posterior cae (503): estado desconocido ⇒ se CONSERVAN los objetos', async () => {
    // 1 snapshot, 2 tras INSERT, 3 relectura del UPDATE, 4 limpieza (existe), 5 tras DELETE ← cae
    const r = await correr({ conObjetos: true, leerFallaEn: 5 })
    assert.equal(r.w.c.deleteGrupo, 0)
    assert.ok(r.w.objetos.has(`${DESTINO}/${IDS.idAntes}/m.webp`))
    assert.ok(r.inf.conservaObjetos && !r.inf.completa && !r.inf.estadoFinalConfirmado)
  })
  await prueba('UPDATE sin efecto (0 filas): fallo, y la limpieza sigue borrando solo lo propio con el orden seguro', async () => {
    const r = await correr({ conObjetos: true, patchSinEfecto: true })
    assert.ok(r.inf.resumen.fallos >= 1) // el caso del UPDATE falla (la corrida llega al final, pero el resumen tiene fallos y el código de salida es distinto de cero)
    assert.ok(r.inf.estadoFinalConfirmado && !r.w.filas.some((f) => f.id === IDS.idFila) && estadoInicial(r.w))
  })
  await prueba('una fila ajena con título/orden/activo parecidos NUNCA se toca ni se confunde con la propia', async () => {
    const parecida = { id: 'ffffffff-1111-4222-8333-444444444444', titulo: 'QA rollback zzzzzz (borrar)', antes_url: 'x/a.jpg', despues_url: 'x/b.jpg', orden: 9999, activo: false }
    const r = await correr({ conObjetos: true, insertar: '500-sin-commit', filasIniciales: [ANTIGUA, parecida] })
    assert.equal(r.w.c.deleteFila, 0)
    assert.ok(r.w.filas.some((f) => f.id === parecida.id))
  })

  // RBG-03: la INTENCIÓN de subir se registra antes de cada PUT; una excepción o respuesta perdida no prueba ausencia
  const propios = (w) => [...w.objetos].filter((k) => k.includes(IDS.idAntes) || k.includes(IDS.idDespues))
  await prueba('RBG-03 primer PUT confirmado con respuesta perdida: se detecta por inventario, se borra el objeto propio y el estado final se confirma', async () => {
    const r = await correr({ conObjetos: true, subir: 'primero-confirmado-respuesta-perdida' })
    assert.equal(r.w.c.insert, 0)
    assert.ok(!r.inf.sinEscrituras, 'no debe declararse «sin escrituras»')
    assert.equal(propios(r.w).length, 0)
    assert.ok(r.w.objetos.has('fotos-galeria/ajeno/m.webp'))
    assert.ok(r.inf.estadoFinalConfirmado && !r.inf.completa)
  })
  await prueba('RBG-03 primer PUT sin commit: cero objetos propios y el estado final se confirma (sin afirmar «sin escrituras»)', async () => {
    const r = await correr({ conObjetos: true, subir: 'primero-sin-commit' })
    assert.equal(propios(r.w).length, 0)
    assert.ok(!r.inf.sinEscrituras && r.inf.estadoFinalConfirmado && !r.inf.completa)
  })
  await prueba('RBG-03 segundo PUT confirmado con respuesta perdida (tras uno correcto): se limpian todos los objetos propios', async () => {
    const r = await correr({ conObjetos: true, subir: 'segundo-confirmado-respuesta-perdida' })
    assert.equal(propios(r.w).length, 0)
    assert.ok(r.inf.estadoFinalConfirmado && !r.inf.completa)
  })
  await prueba('RBG-03 primer PUT con error y luego el inventario cae/pagina: NUNCA estadoFinalConfirmado ni «sin escrituras»; el objeto propio queda como pendiente explícito', async () => {
    const r = await correr({ conObjetos: true, subir: 'primero-confirmado-respuesta-perdida', invFallaEn: 2 })
    assert.equal(propios(r.w).length, 1)
    assert.ok(!r.inf.sinEscrituras && !r.inf.estadoFinalConfirmado && !r.inf.completa && r.inf.pendientes.length >= 1, JSON.stringify(r.inf.pendientes))
  })
  await prueba('RBG-03 limpieza rechazada (DELETE 500 sin efecto): el objeto propio permanece, estado no confirmado y pendiente explícito', async () => {
    const r = await correr({ conObjetos: true, subir: 'primero-confirmado-respuesta-perdida', grupoRechazado: true })
    assert.equal(propios(r.w).length, 1)
    assert.ok(!r.inf.estadoFinalConfirmado && !r.inf.completa && r.inf.pendientes.some((p) => p.startsWith('objeto:')))
  })

  // Cableado REAL de los adaptadores (REST + Worker) con un fetch FALSO que lanza o pierde la respuesta
  await prueba('RBG-03 cableado real (dependenciasReales): el primer PUT guarda en R2 simulado y el fetch LANZA ⇒ el núcleo limpia el objeto y no declara «sin escrituras»', async () => {
    const { dependenciasReales } = require('./lib/ensayo-rollback-reales.cjs')
    const SUPA = 'https://tqkdtojnhgykmcbvwdmz.supabase.co'
    const WORKER = G.WORKER_APROBADO
    const filas = structuredClone([ANTIGUA, AJENA_OCULTA])
    const objetos = new Set(['fotos-galeria/ajeno/m.webp'])
    let puts = 0
    const llamadas = []
    const seguro = async (url, init = {}) => {
      const m = init.method ?? 'GET'
      llamadas.push(`${m} ${url.replace(SUPA, '').replace(WORKER, '')}`)
      const json = (cuerpo, estado = 200, h = {}) => new Response(JSON.stringify(cuerpo), { status: estado, headers: h })
      if (url.startsWith(`${SUPA}/rest/v1/galeria_web`)) {
        if (m === 'GET') return json(filas, 200, { 'content-range': `0-${filas.length - 1}/${filas.length}` })
        throw new Error(`REST inesperado ${m}`)
      }
      if (url.startsWith(`${WORKER}/v1/inventario/`)) return json({ objetos: [...objetos].map((clave) => ({ clave })) })
      if (m === 'PUT') {
        puts += 1
        const clave = url.replace(`${WORKER}/v1/medios/`, '') // <destino>/<id>/<v>
        objetos.add(`${clave}.webp`)
        if (puts === 1) throw new Error('fetch lanzó: respuesta perdida tras confirmar el PUT')
        return json({ ok: true }, 201)
      }
      if (m === 'DELETE' && url.startsWith(`${WORKER}/v1/medios/`)) {
        const pre = url.replace(`${WORKER}/v1/medios/`, '') + '/'
        for (const k of [...objetos]) if (k.startsWith(pre)) objetos.delete(k)
        return json({ ok: true })
      }
      throw new Error(`petición inesperada ${m} ${url}`)
    }
    const reales = dependenciasReales({ seguro, supa: SUPA, anon: 'anon-ficticia', worker: WORKER, alias: ALIAS, destino: DESTINO, token: () => 't', fabricarWebp: async () => BYTES })
    const inf = await ejecutarEnsayo({ bases: { pages: PAGES, r2dev: R2DEV }, ids: IDS, destino: DESTINO, conObjetos: true, U, prefijoStorage: `${SUPA}/storage/v1/object/public/${DESTINO}/`, ...reales })
    assert.equal(puts, 1)
    assert.ok(![...objetos].some((k) => k.includes(IDS.idAntes) || k.includes(IDS.idDespues)), 'el objeto propio debe haberse limpiado')
    assert.ok(objetos.has('fotos-galeria/ajeno/m.webp'))
    assert.ok(!inf.sinEscrituras && inf.estadoFinalConfirmado && !inf.completa)
    assert.ok(!llamadas.some((l) => /^(POST|PATCH|DELETE) \/rest/.test(l)), 'sin escrituras REST')
  })

  const fallos = resultados.filter((x) => !x.ok)
  console.log(`\n${resultados.length} casos, ${fallos.length} fallos`)
  process.exitCode = fallos.length ? 1 : 0
})().catch((e) => { console.error(e); process.exitCode = 2 })
