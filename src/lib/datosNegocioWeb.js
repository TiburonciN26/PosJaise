import { supabase } from './supabase.js'
import { hayDiasAbiertos, normalizarSemana } from './horarioAtencion.js'

// QA-022: contacto y horario son datos SECUNDARIOS del catálogo (WhatsApp,
// pie, textos de ayuda) pero se pedían junto a la lista en un único
// Promise.all, así que una respuesta lenta de ellos retrasaba productos o
// servicios ya recibidos; además el pie de página los volvía a pedir. Aquí
// se piden aparte y se comparten entre componentes con una caché de vida
// corta: una navegación entre pestañas no repite la consulta, pero un cambio
// del negocio se ve en <= TTL_MS (nunca se sirve un dato viejo indefinidamente).
const TTL_MS = 60_000
const cache = new Map()

function pedir(clave, rpc, transformar = (filas) => filas?.[0] ?? null) {
  const previo = cache.get(clave)
  if (previo && Date.now() - previo.en < TTL_MS) return previo.promesa
  const promesa = supabase.rpc(rpc).then(({ data, error }) => {
    if (error) {
      cache.delete(clave)
      return null
    }
    return transformar(data)
  })
  cache.set(clave, { promesa, en: Date.now() })
  return promesa
}

export const obtenerContacto = () => pedir('contacto', 'datos_contacto')

// Semana normalizada (7 días con sus turnos, ver horarioAtencion.js) o null si el negocio no tiene ningún día abierto
// todavía: las pantallas siguen mostrando su texto de «horario no configurado».
export const obtenerHorario = () =>
  pedir('horario', 'horario_atencion_semanal', (filas) => {
    const semana = normalizarSemana(filas)
    return hayDiasAbiertos(semana) ? semana : null
  })

// La administradora acaba de guardar un horario nuevo: que la próxima lectura no use la copia en caché.
export function olvidarHorario() {
  cache.delete('horario')
}
