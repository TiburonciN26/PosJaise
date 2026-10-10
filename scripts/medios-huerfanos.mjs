// Recolector de huérfanos de R2 con retención (Fase 3).
//
//   node scripts/medios-huerfanos.mjs --api=<url del Worker> --env-file=.env.staging.local
//        [--retencion-dias=14] [--aplicar] [--salida=informe.json]
// Las opciones booleanas son flags SIN valor (--aplicar=false es un error). La retención
// debe ser un número ≥ 1; cualquier valor inválido aborta antes de autenticar.
//
// Por defecto es de SOLO LECTURA (informa). Con --aplicar borra únicamente los
// grupos no referenciados y más viejos que la retención (ver lib/huerfanos-medios.mjs).
// Credenciales: un administrador de Supabase (MEDIOS_ADMIN_EMAIL/MEDIOS_ADMIN_PASSWORD,
// o QA_ADMIN_* del --env-file). Se niega a correr contra el Supabase del negocio
// salvo --permitir-produccion.
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { grupoDeReferencia, leerTodasLasFilas, parsearArgumentos, recolectar } from './lib/huerfanos-medios.mjs'
import { REF_PRODUCCION } from './lib/entornos-supabase.mjs'

function leerEnv(ruta) {
  const salida = {}
  for (const linea of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) salida[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return salida
}

const DESTINOS = ['fotos-productos', 'fotos-servicios', 'fotos-galeria']
// tabla → columnas que pueden contener una referencia a medios públicos
const TABLAS = [
  ['productos', ['foto_url']],
  ['producto_fotos', ['foto_url']],
  ['servicios', ['foto_url']],
  ['servicio_fotos', ['foto_url']],
  ['galeria_web', ['antes_url', 'despues_url']],
]
const PAGINA = 1000

export async function crearFuentes({ api, supabaseUrl, anonKey, email, password }) {
  const supabase = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Inicio de sesión: ${error.message}`)
  const token = data.session.access_token

  async function worker(ruta, opciones = {}) {
    const r = await fetch(`${api}${ruta}`, { ...opciones, headers: { Authorization: `Bearer ${token}`, ...(opciones.headers ?? {}) } })
    if (!r.ok) throw new Error(`Worker ${opciones.method ?? 'GET'} ${ruta}: ${r.status}`)
    return r.json()
  }

  return {
    // Lectura COMPLETA con paginación por llave (id > último), no por offset: una fila viva durante
    // toda la lectura nunca se omite aunque otras se inserten o borren. El conteo exacto es solo una
    // comprobación de cordura: si difiere se lanza (con escrituras concurrentes puede abortar de más,
    // lo que es el lado seguro).
    async listarReferencias() {
      const grupos = new Set()
      for (const [tabla, columnas] of TABLAS) {
        const { count, error: errorConteo } = await supabase.from(tabla).select('id', { count: 'exact', head: true })
        if (errorConteo) throw new Error(`Conteo de ${tabla}: ${errorConteo.message}`)
        const filas = await leerTodasLasFilas(async (despuesDeId, tamano) => {
          let consulta = supabase.from(tabla).select(['id', ...columnas].join(',')).order('id').limit(tamano)
          if (despuesDeId !== null) consulta = consulta.gt('id', despuesDeId)
          const { data: pagina, error: errorLectura } = await consulta
          if (errorLectura) throw new Error(`Lectura de ${tabla}: ${errorLectura.message}`)
          return pagina
        }, PAGINA)
        if (filas.length !== count) throw new Error(`Lectura incompleta de ${tabla}: ${filas.length} de ${count} filas`)
        for (const fila of filas) {
          for (const columna of columnas) {
            const grupo = grupoDeReferencia(fila[columna])
            if (grupo) grupos.add(grupo)
          }
        }
      }
      return grupos
    },
    // Consulta PUNTUAL de un grupo (se usa justo antes de cada borrado). Cualquier error lanza.
    async estaReferenciado(grupo) {
      for (const [tabla, columnas] of TABLAS) {
        const condicion = columnas.map((c) => `${c}.eq.r2:${grupo},${c}.like.*/${grupo}/*`).join(',')
        const { count, error } = await supabase.from(tabla).select('id', { count: 'exact', head: true }).or(condicion)
        if (error) throw new Error(`Consulta puntual en ${tabla}: ${error.message}`)
        if (count > 0) return true
      }
      return false
    },
    async listarObjetos() {
      const objetos = []
      for (const destino of DESTINOS) {
        let cursor = null
        do {
          const pagina = await worker(`/v1/inventario/${destino}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)
          objetos.push(...pagina.objetos)
          cursor = pagina.cursor
        } while (cursor)
      }
      return objetos
    },
    async eliminar(grupo) {
      await worker(`/v1/medios/${grupo}`, { method: 'DELETE' })
    },
  }
}

async function principal() {
  // 1. Validar TODO antes de autenticar o leer nada.
  const argumentos = parsearArgumentos(process.argv.slice(2))
  const env = argumentos['env-file'] ? leerEnv(argumentos['env-file']) : {}
  const supabaseUrl = env.VITE_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY
  const email = process.env.MEDIOS_ADMIN_EMAIL ?? env.QA_ADMIN_EMAIL
  const password = process.env.MEDIOS_ADMIN_PASSWORD ?? env.QA_ADMIN_PASSWORD
  if (!argumentos.api || !supabaseUrl || !anonKey || !email || !password) {
    throw new Error('Faltan --api, URL/anon key de Supabase o credenciales de administrador.')
  }
  if (supabaseUrl.includes(REF_PRODUCCION) && !argumentos.permitirProduccion) {
    throw new Error('Supabase del negocio: requiere --permitir-produccion explícito.')
  }
  const fuentes = await crearFuentes({ api: String(argumentos.api).replace(/\/+$/, ''), supabaseUrl, anonKey, email, password })
  const informe = await recolectar({
    fuentes,
    aplicar: argumentos.aplicar,
    retencionDias: argumentos.retencionDias,
  })
  const texto = JSON.stringify(informe, null, 2)
  if (argumentos.salida) writeFileSync(argumentos.salida, texto)
  console.log(texto)
  process.exit(0) // el cliente de Supabase mantiene un temporizador de sesión que impide terminar solo
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('medios-huerfanos.mjs')) {
  principal().catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}
