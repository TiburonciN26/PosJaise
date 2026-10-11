// Regresiones SIN red del harness del recolector acotado a UUID propios (scripts/lib/ensayo-recolector.mjs).
//   node scripts/verificar-ensayo-recolector.mjs
import { acotarFuentes, ejecutarEnsayoRecolector } from './lib/ensayo-recolector.mjs'
import { grupoDeReferencia } from './lib/huerfanos-medios.mjs'

const casos = []
const caso = (nombre, ok, detalle = {}) => {
  casos.push({ nombre, ok: Boolean(ok) })
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${ok ? '' : ' ' + JSON.stringify(detalle)}`)
}

const DESTINO = 'fotos-galeria'
const PAGES = 'https://alias.pages.dev/medios'
const IDS = { protegido: '11111111-1111-4111-8111-111111111111', huerfano: '22222222-2222-4222-8222-222222222222', fila: '33333333-3333-4333-8333-333333333333', titulo: 'QA recolector abc123 (borrar)' }
const AJENO_VIEJO = `${DESTINO}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`
const AJENO_REF = `${DESTINO}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`
const DIA = 24 * 60 * 60 * 1000

function montar({ hook = {}, inicial = true } = {}) {
  let reloj = 1_700_000_000_000
  const objetos = new Map() // clave → subidoEn (ms)
  const filas = []
  const llamadas = { subir: [], borrar: [], eliminar: [], insertar: 0, borrarFila: 0 }
  if (inicial) {
    // objetos ajenos preexistentes: uno VIEJO sin referencias (candidato para un recolector sin acotar) y uno referenciado
    for (const g of [AJENO_VIEJO, AJENO_REF]) for (const v of ['m', 'g']) objetos.set(`${g}/${v}.webp`, reloj - 100 * DIA)
    filas.push({ id: 'fila-ajena', titulo: 'Foto de prueba (Inicio)', antes_url: `${PAGES}/${AJENO_REF}/g.webp`, despues_url: 'fotos/despues.jpg', orden: 1, activo: true })
  }
  const consultas = {}
  const llamadasConsulta = () => Object.values(consultas).reduce((a, b) => a + b, 0)
  const propiasDeGrupo = (g) => [...objetos.keys()].filter((k) => k.startsWith(`${g}/`))
  const fuentes = {
    async listarReferencias() {
      const s = new Set()
      for (const f of filas) for (const c of ['antes_url', 'despues_url']) { const g = grupoDeReferencia(f[c]); if (g) s.add(g) }
      return s
    },
    async listarObjetos() { return [...objetos].map(([clave, t]) => ({ clave, bytes: 100, subidoEn: new Date(t).toISOString() })) },
    async estaReferenciado(grupo) {
      consultas[grupo] = (consultas[grupo] ?? 0) + 1
      if (hook.consultaCaeDesde && llamadasConsulta() >= hook.consultaCaeDesde) throw new Error('consulta caída')
      if (hook.antesDeConsulta) hook.antesDeConsulta(grupo, filas, consultas[grupo])
      return filas.some((f) => grupoDeReferencia(f.antes_url) === grupo || grupoDeReferencia(f.despues_url) === grupo)
    },
    async eliminar(grupo) { if (hook.eliminarFalla) throw new Error('eliminar caído'); llamadas.eliminar.push(grupo); for (const k of propiasDeGrupo(grupo)) objetos.delete(k) },
  }
  const deps = {
    fuentes,
    ahora: () => reloj,
    fabricarWebp: async (l) => Buffer.from(`webp-${l}`),
    inventario: async () => {
      if (hook.inventarioCae && llamadas.subir.length > 0 && hook.inventarioCae()) throw new Error('inventario ilegible')
      return new Set(objetos.keys())
    },
    leerFilas: async () => filas.map((f) => ({ ...f })),
    subir: async (id, v) => {
      const clave = `${DESTINO}/${id}/${v}.webp`
      llamadas.subir.push(clave)
      if (hook.antesDePut) hook.antesDePut(objetos, clave, reloj)
      if (objetos.has(clave)) return 409
      objetos.set(clave, reloj)
      if (hook.respuestaPerdida && llamadas.subir.length === 1) throw new Error('respuesta perdida')
      return 201
    },
    insertarFila: async (cuerpo) => {
      llamadas.insertar += 1
      filas.push({ ...cuerpo })
      if (hook.insertarPierdeRespuesta) throw new Error('respuesta perdida del INSERT')
      return { estado: 201 }
    },
    borrarFila: async (id) => {
      llamadas.borrarFila += 1
      if (hook.borrarFilaSinEfecto) return { estado: 204 }
      const i = filas.findIndex((f) => f.id === id)
      if (i >= 0) filas.splice(i, 1)
      return { estado: 204 }
    },
    borrarPrefijo: async (pre) => { llamadas.borrar.push(pre); for (const k of [...objetos.keys()]) if (k.startsWith(pre)) objetos.delete(k); if (hook.trasBorrarPrefijo) hook.trasBorrarPrefijo(pre, filas); return 200 },
  }
  return { deps, objetos, filas, llamadas, reloj: { avanzar: (ms) => { reloj += ms } } }
}
const correr = async (opciones, ids = IDS) => {
  const w = montar(opciones)
  const informe = await ejecutarEnsayoRecolector({ ids, destino: DESTINO, bases: { pages: PAGES }, deps: w.deps })
  return { informe, ...w }
}
const ajenosIntactos = (w) => [AJENO_VIEJO, AJENO_REF].every((g) => ['m', 'g'].every((v) => w.objetos.has(`${g}/${v}.webp`))) && w.filas.some((f) => f.id === 'fila-ajena')

{
  const w = await correr()
  caso('flujo sano: borra SOLO el huérfano propio, conserva el protegido, restaura inventario y filas, completa', w.informe.completa && w.informe.estadoFinalConfirmado && w.llamadas.eliminar.length === 1 && w.llamadas.eliminar[0] === `${DESTINO}/${IDS.huerfano}` && w.llamadas.subir.length === 4, w.informe.resumen)
  caso('objetos ajenos (uno VIEJO sin referencias) y la fila ajena quedan INTACTOS: las fuentes acotadas no los ven ni los borran', ajenosIntactos(w), { claves: [...w.objetos.keys()] })
  caso('retención: con el reloj real aplicar:true no borra nada; solo el reloj simulado convierte al huérfano en candidato', w.informe.recolector.realAplicar.eliminados.length === 0 && w.informe.recolector.aplicado.eliminados.length === 1, w.informe.recolector)
  caso('la lectura acotada solo cuenta objetos y referencias PROPIOS (4 objetos, 1 referenciado)', w.informe.recolector.seco.objetos === 4 && w.informe.recolector.seco.referenciados === 1, w.informe.recolector.seco)
}
{
  const base = montar().deps
  const acot = acotarFuentes(base.fuentes, new Set([`${DESTINO}/${IDS.huerfano}`]))
  let e1 = null; let e2 = null
  await acot.eliminar(AJENO_VIEJO).catch((e) => { e1 = e })
  await acot.estaReferenciado(AJENO_VIEJO).catch((e) => { e2 = e })
  const objetos = await acot.listarObjetos()
  caso('acotarFuentes: eliminar o consultar un grupo ajeno LANZA aunque el recolector lo pidiera; no se listan objetos ajenos', e1 && e2 && objetos.length === 0, { e1: e1?.message, e2: e2?.message })
}
{
  const previo = `${DESTINO}/${IDS.huerfano}/m.webp`
  const w = montar(); w.objetos.set(previo, 1)
  const informe = await ejecutarEnsayoRecolector({ ids: IDS, destino: DESTINO, bases: { pages: PAGES }, deps: w.deps })
  caso('prefijo propio previo en el inventario: aborta ANTES de escribir, sin DELETE ni recolector; el objeto previo intacto', !informe.completa && w.llamadas.subir.length === 0 && w.llamadas.borrar.length === 0 && w.llamadas.eliminar.length === 0 && w.objetos.has(previo) && informe.estadoFinalConfirmado === true, w.llamadas)
}
{
  const w = await correr({ hook: { antesDePut: (obj, clave, t) => { if (clave === `${DESTINO}/${IDS.huerfano}/g.webp`) obj.set(clave, t) } } })
  caso('409 tardío en el huérfano: el grupo se CONSERVA (pertenencia incierta), pendiente explícito y estado NO confirmado', !w.informe.completa && !w.informe.estadoFinalConfirmado && w.informe.pendientes.length === 1 && w.objetos.has(`${DESTINO}/${IDS.huerfano}/g.webp`) && w.llamadas.eliminar.length === 0, { pendientes: w.informe.pendientes })
}
{
  const w = await correr({ hook: { respuestaPerdida: true } })
  caso('primer PUT guardado con respuesta perdida: se limpia lo propio por la intención registrada; ajenos intactos; corrida incompleta', !w.informe.completa && w.informe.estadoFinalConfirmado && ajenosIntactos(w) && [...w.objetos.keys()].every((k) => k.startsWith(AJENO_VIEJO) || k.startsWith(AJENO_REF)), { claves: [...w.objetos.keys()] })
}
{
  const w = await correr({ hook: { insertarPierdeRespuesta: true } })
  caso('INSERT de la fila guardado con respuesta perdida: la fila se borra por su id exacta y luego los objetos; estado restaurado', !w.informe.completa && w.informe.estadoFinalConfirmado && !w.filas.some((f) => f.id === IDS.fila) && ajenosIntactos(w), w.informe.limpieza)
}
{
  const w = await correr({ hook: { antesDeConsulta: (grupo, filas) => { if (grupo === `${DESTINO}/${IDS.huerfano}`) filas.push({ id: 'ref-tardia', titulo: 'ref tardía', antes_url: `${PAGES}/${grupo}/g.webp`, despues_url: null, orden: 1, activo: false }) } } })
  const aplicado = w.informe.recolector?.aplicado
  caso('referencia aparecida JUSTO antes del borrado: el recolector lo omite (no lo borra); el harness lo reporta como fallo y limpia lo propio', aplicado?.omitidos?.length === 1 && aplicado.eliminados.length === 0 && !w.informe.completa, aplicado)
}
{
  const w = await correr({ hook: { borrarFilaSinEfecto: true } })
  caso('DELETE de la fila sin efecto: NO se borran los objetos (evitaría referencias rotas), estado NO confirmado', !w.informe.estadoFinalConfirmado && !w.informe.completa && w.llamadas.borrar.length === 0 && w.filas.some((f) => f.id === IDS.fila), w.informe.limpieza)
}
{
  let n = 0
  const w = await correr({ hook: { inventarioCae: () => { n += 1; return n > 3 } } })
  caso('inventario ilegible durante la limpieza: estado final NO confirmado (nunca se acepta como vacío)', !w.informe.estadoFinalConfirmado && !w.informe.completa, w.informe.limpieza)
}
{
  const w = montar()
  const informe = await ejecutarEnsayoRecolector({ ids: { ...IDS, huerfano: IDS.protegido }, destino: DESTINO, bases: { pages: PAGES }, deps: w.deps })
  caso('identificadores repetidos: aborta antes de escribir', !informe.completa && w.llamadas.subir.length === 0 && w.llamadas.borrar.length === 0)
}

const claves = (w, id) => [...w.objetos.keys()].filter((k) => k.includes(id))
const refAjena = (id, grupo) => ({ id, titulo: `ref ajena ${id}`, antes_url: `${PAGES}/${grupo}/g.webp`, despues_url: null, orden: 1, activo: false })
{ // RG-01: referencia tardía sobre el HUÉRFANO: el recolector lo omite y la LIMPIEZA tampoco lo borra
  const G_H = `${DESTINO}/${IDS.huerfano}`
  const w = await correr({ hook: { antesDeConsulta: (grupo, filas, n) => { if (grupo === G_H && n === 1) filas.push(refAjena('ref-h', grupo)) } } })
  caso('RG-01: la foto con referencia tardía (huérfano) y su fila ajena SOBREVIVEN a la limpieza; pendiente explícito y estado NO confirmado', claves(w, IDS.huerfano).length === 2 && w.filas.some((f) => f.id === 'ref-h') && !w.informe.estadoFinalConfirmado && !w.informe.completa && w.informe.pendientes.some((p) => p.startsWith(`${G_H}/`)) && w.llamadas.borrar.every((b) => b !== `${G_H}/`), { borrar: w.llamadas.borrar, pendientes: w.informe.pendientes })
}
{ // RG-01: referencia tardía sobre el PROTEGIDO añadida al consultarlo en la limpieza
  const G_P = `${DESTINO}/${IDS.protegido}`
  const w = await correr({ hook: { antesDeConsulta: (grupo, filas) => { if (grupo === G_P) filas.push(refAjena('ref-p', grupo)) } } })
  caso('RG-01: referencia añadida al grupo protegido justo antes de su DELETE de limpieza → el grupo y la fila ajena se conservan', claves(w, IDS.protegido).length === 2 && w.filas.some((f) => f.id === 'ref-p') && !w.informe.estadoFinalConfirmado && w.informe.pendientes.some((p) => p.startsWith(`${G_P}/`)), { pendientes: w.informe.pendientes })
}
{ // RG-01: una referencia añadida TRAS limpiar el primer grupo protege el segundo
  const G_H = `${DESTINO}/${IDS.huerfano}`
  const G_P = `${DESTINO}/${IDS.protegido}`
  const w = await correr({ hook: { eliminarFalla: true, trasBorrarPrefijo: (pre, filas) => { if (pre === `${G_P}/`) filas.push(refAjena('ref-h2', G_H)) } } })
  caso('RG-01: tras limpiar el primer grupo (protegido) aparece una referencia al segundo (huérfano) → el segundo se conserva', claves(w, IDS.protegido).length === 0 && claves(w, IDS.huerfano).length === 2 && w.filas.some((f) => f.id === 'ref-h2') && !w.informe.estadoFinalConfirmado, { borrar: w.llamadas.borrar, pendientes: w.informe.pendientes })
}
{ // RG-01: consulta de referencias caída durante la limpieza → se conserva todo lo pendiente
  const w = await correr({ hook: { consultaCaeDesde: 2 } })
  caso('RG-01: la consulta de referencias cae durante la limpieza → los grupos se CONSERVAN (no se asume «sin referencias») y el estado NO se confirma', !w.informe.estadoFinalConfirmado && !w.informe.completa && w.informe.pendientes.length >= 1 && claves(w, IDS.protegido).length === 2, { pendientes: w.informe.pendientes })
}
// RG-02: el estado final compara el SNAPSHOT completo de las filas
for (const [campo, nuevoValor] of [['titulo', 'otro título'], ['antes_url', 'fotos/otra.jpg'], ['despues_url', 'fotos/otra2.jpg'], ['activo', false], ['orden', 42]]) {
  const w = await correr({ hook: { antesDeConsulta: (grupo, filas) => { const f = filas.find((x) => x.id === 'fila-ajena'); if (f) f[campo] = nuevoValor } } })
  caso(`RG-02: cambia «${campo}» de una fila ajena con el MISMO id → estado inicial NO confirmado y la diferencia queda informada (sin restaurar)`, !w.informe.estadoFinalConfirmado && !w.informe.completa && w.informe.diferenciasFilas.some((d) => d.id === 'fila-ajena' && d.campo === campo) && w.filas.find((f) => f.id === 'fila-ajena')[campo] === nuevoValor, w.informe.diferenciasFilas)
}
{
  const w = await correr({ hook: { antesDeConsulta: (grupo, filas) => { filas.reverse() } } })
  caso('RG-02: un cambio SOLO en el orden de llegada de las filas no impide confirmar el estado', w.informe.estadoFinalConfirmado && w.informe.completa && w.informe.diferenciasFilas.length === 0, w.informe.diferenciasFilas)
}
{
  const w = await correr({ hook: { antesDeConsulta: (grupo, filas) => { const f = filas.find((x) => x.id === IDS.fila); if (f) f.orden = 1 } } })
  caso('RG-02: un campo de la fila PROPIA distinto del insertado ya no cuenta como «intacta»', !w.informe.completa && w.informe.casos.some((c) => /TODOS sus campos intactos/.test(c.nombre) && !c.ok), w.informe.resumen)
}

const fallos = casos.filter((c) => !c.ok)
console.log(`\n${casos.length} casos, ${fallos.length} fallos`)
process.exitCode = fallos.length ? 1 : 0
