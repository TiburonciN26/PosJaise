// Clasificación y recolección de objetos huérfanos de R2 (Fase 3), con retención.
//
// Un "grupo" es <destino>/<uuid>: sus variantes m.webp y g.webp se tratan juntas.
//   referenciado        → alguna fila de la BD lo menciona: NUNCA se toca.
//   protegido-reciente  → no referenciado pero más joven que la retención: puede ser
//                         una subida en curso o un reintento; NUNCA se toca todavía.
//   sin-fecha           → sin metadatos de fecha: NUNCA se toca (no se borra a ciegas).
//   candidato           → no referenciado y más viejo que la retención.
//
// Solo se borran candidatos, y solo con `aplicar`. ANTES DE CADA BORRADO se consulta
// a la BD si ese grupo concreto sigue sin referencias (`estaReferenciado`): es una
// consulta puntual (no una lectura paginada) justo antes del DELETE. Si cualquier
// lectura no es completa o hay duda (la fuente lanza), se aborta sin seguir borrando.
//
// LÍMITE HONESTO: entre esa consulta y el DELETE de R2 queda una ventana de milisegundos que
// ninguna lectura del cliente puede cerrar. Se mitiga porque (1) la retención exige que el
// objeto lleve ≥ N días sin referencia, y la app solo referencia UUID recién generados, así
// que referenciar uno viejo requiere una acción manual deliberada; y (2) se recomienda
// ejecutar el modo destructivo con el catálogo sin ediciones (ventana de mantenimiento).
// Una garantía fuerte exigiría cuarentena o un bloqueo del lado del servidor (no implementado).

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const DEST = '(fotos-productos|fotos-servicios|fotos-galeria)'
// Clave de objeto R2: <destino>/<uuid>/<m|g>.webp
const RE_CLAVE = new RegExp(`^${DEST}/(${UUID})/[mg]\\.webp$`)
// Referencia guardada en BD: "r2:<destino>/<uuid>" o URL completa ".../<destino>/<uuid>/<m|g>.webp".
// Una URL antigua de Supabase (".../<destino>/<uuid>.webp") NO coincide.
const RE_REF_R2 = new RegExp(`^r2:${DEST}/(${UUID})$`)
const RE_REF_URL = new RegExp(`/${DEST}/(${UUID})/[mg]\\.webp(?:[?#].*)?$`)

// "r2:fotos-productos/<uuid>", o una URL completa que contenga ".../fotos-galeria/<uuid>/g.webp".
// Devuelve "destino/uuid" o null. Las rutas antiguas de Supabase no coinciden.
export function grupoDeReferencia(valor) {
  if (typeof valor !== 'string') return null
  const coincidencia = valor.match(RE_REF_R2) ?? valor.match(RE_REF_URL)
  return coincidencia ? `${coincidencia[1]}/${coincidencia[2]}` : null
}

export const RETENCION_MINIMA_DIAS = 1

// Rechaza NaN, vacío, negativo, cero e infinito: con NaN la comparación «es reciente» es
// siempre falsa y TODO pasaría a candidato.
export function validarRetencion(retencionDias) {
  if (typeof retencionDias !== 'number' || !Number.isFinite(retencionDias) || retencionDias < RETENCION_MINIMA_DIAS) {
    throw new Error(`Retención inválida (${String(retencionDias)}): debe ser un número finito ≥ ${RETENCION_MINIMA_DIAS} día. Política publicada: 14.`)
  }
  return retencionDias
}

export function clasificar({ objetos, referenciados, ahora = Date.now(), retencionDias = 14 }) {
  validarRetencion(retencionDias)
  if (!Number.isFinite(ahora)) throw new Error('Fecha actual inválida.')
  const retencionMs = retencionDias * 24 * 60 * 60 * 1000
  const grupos = new Map()
  for (const objeto of objetos) {
    const coincidencia = objeto.clave.match(RE_CLAVE)
    if (!coincidencia) continue // clave ajena al contrato: se ignora, nunca se borra
    const grupo = `${coincidencia[1]}/${coincidencia[2]}`
    const actual = grupos.get(grupo) ?? { grupo, bytes: 0, claves: [], subidoEn: null }
    actual.bytes += objeto.bytes ?? 0
    actual.claves.push(objeto.clave)
    const fecha = objeto.subidoEn ? Date.parse(objeto.subidoEn) : NaN
    if (Number.isFinite(fecha)) actual.subidoEn = actual.subidoEn === null ? fecha : Math.max(actual.subidoEn, fecha) // la más reciente
    grupos.set(grupo, actual)
  }

  const resultado = { referenciado: [], 'protegido-reciente': [], 'sin-fecha': [], candidato: [] }
  for (const grupo of grupos.values()) {
    let estado
    if (referenciados.has(grupo.grupo)) estado = 'referenciado'
    else if (grupo.subidoEn === null) estado = 'sin-fecha'
    else if (ahora - grupo.subidoEn < retencionMs) estado = 'protegido-reciente'
    else estado = 'candidato'
    resultado[estado].push({ ...grupo, estado })
  }
  return resultado
}

// Lectura completa de una tabla con paginación POR LLAVE (id > último), no por posición.
// Con offset, una fila que se borra o inserta entre páginas desplaza las siguientes y se
// salta una fila viva; con llave, una fila que existe durante toda la lectura nunca se
// omite. leerPagina(despuesDeId|null, tamano) → filas ordenadas por id ascendente.
export async function leerTodasLasFilas(leerPagina, tamano = 1000) {
  const filas = []
  let ultimo = null
  for (;;) {
    const pagina = await leerPagina(ultimo, tamano)
    filas.push(...pagina)
    if (pagina.length < tamano) return filas
    ultimo = pagina[pagina.length - 1].id
  }
}

// Argumentos estrictos: los booleanos son SOLO flags sin valor (--aplicar=false es un error,
// no «true»), los números se validan y se rechazan opciones desconocidas.
export function parsearArgumentos(argv) {
  const booleanas = new Set(['aplicar', 'permitir-produccion'])
  const textuales = new Set(['api', 'env-file', 'salida'])
  const resultado = { retencionDias: 14, aplicar: false, permitirProduccion: false }
  for (const crudo of argv) {
    if (!crudo.startsWith('--')) throw new Error(`Argumento no reconocido: ${crudo}`)
    const igual = crudo.indexOf('=')
    const nombre = crudo.slice(2, igual === -1 ? undefined : igual)
    const valor = igual === -1 ? null : crudo.slice(igual + 1)
    if (booleanas.has(nombre)) {
      if (valor !== null) throw new Error(`--${nombre} no admite valor (recibió «${valor}»): escríbalo sin «=» para activarlo u omítalo.`)
      resultado[nombre === 'aplicar' ? 'aplicar' : 'permitirProduccion'] = true
    } else if (nombre === 'retencion-dias') {
      if (valor === null || !/^\d+(\.\d+)?$/.test(valor)) throw new Error(`--retencion-dias inválido («${valor ?? ''}»): use un número positivo.`)
      resultado.retencionDias = validarRetencion(Number(valor))
    } else if (textuales.has(nombre)) {
      if (!valor) throw new Error(`--${nombre} requiere un valor.`)
      resultado[nombre] = valor
    } else {
      throw new Error(`Opción desconocida: --${nombre}`)
    }
  }
  return resultado
}

// fuentes: {
//   listarReferencias(): Promise<Set<"destino/uuid">>   (lanza si la lectura no es completa)
//   listarObjetos():     Promise<{clave, bytes, subidoEn}[]>
//   estaReferenciado(g): Promise<boolean>                (consulta PUNTUAL; lanza si hay duda)
//   eliminar(grupo):     Promise<void>                   (lanza si falla)
// }
export async function recolectar({ fuentes, aplicar = false, retencionDias = 14, ahora = Date.now(), permitirSinReferencias = false }) {
  validarRetencion(retencionDias) // antes de leer o clasificar nada
  const referenciados = await fuentes.listarReferencias()
  const objetos = await fuentes.listarObjetos()
  const clasificado = clasificar({ objetos, referenciados, ahora, retencionDias })
  const informe = {
    retencionDias,
    aplicar,
    referenciados: referenciados.size,
    objetos: objetos.length,
    totales: Object.fromEntries(Object.entries(clasificado).map(([estado, lista]) => [estado, lista.length])),
    candidatos: clasificado.candidato.map((g) => ({ grupo: g.grupo, bytes: g.bytes, subidoEn: new Date(g.subidoEn).toISOString() })),
    eliminados: [],
    omitidos: [],
    errores: [],
    abortado: null,
  }
  if (!aplicar) return informe

  // Guardas antes de borrar nada.
  if (referenciados.size === 0 && objetos.length > 0 && !permitirSinReferencias) {
    throw new Error('Cero referencias con objetos existentes: lectura sospechosa. No se borra nada (use permitirSinReferencias solo si es correcto).')
  }
  if (typeof fuentes.estaReferenciado !== 'function') throw new Error('La fuente no puede comprobar referencias puntuales: no se borra nada.')

  for (const candidato of clasificado.candidato) {
    // Consulta puntual JUSTO antes de este borrado (no una sola vez por lote).
    let referenciado
    try {
      referenciado = await fuentes.estaReferenciado(candidato.grupo)
    } catch (error) {
      informe.abortado = `Duda al comprobar ${candidato.grupo}: ${String(error?.message ?? error)}`
      break // con incertidumbre no se sigue borrando
    }
    if (referenciado) {
      informe.omitidos.push({ grupo: candidato.grupo, motivo: 'referenciado-justo-antes-de-borrar' })
      continue
    }
    try {
      await fuentes.eliminar(candidato.grupo)
      informe.eliminados.push(candidato.grupo)
    } catch (error) {
      informe.errores.push({ grupo: candidato.grupo, error: String(error?.message ?? error) })
    }
  }
  return informe
}
