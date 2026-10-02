import { supabase } from './supabase.js'

// QA-022: contacto y horario son datos SECUNDARIOS del catálogo (WhatsApp,
// pie, textos de ayuda) pero se pedían junto a la lista en un único
// Promise.all, así que una respuesta lenta de ellos retrasaba productos o
// servicios ya recibidos; además el pie de página los volvía a pedir. Aquí
// se piden aparte y se comparten entre componentes con una caché de vida
// corta: una navegación entre pestañas no repite la consulta, pero un cambio
// del negocio se ve en <= TTL_MS (nunca se sirve un dato viejo indefinidamente).
const TTL_MS = 60_000
const cache = new Map()

function pedir(clave, rpc) {
  const previo = cache.get(clave)
  if (previo && Date.now() - previo.en < TTL_MS) return previo.promesa
  const promesa = supabase.rpc(rpc).then(({ data, error }) => {
    if (error) {
      cache.delete(clave)
      return null
    }
    return data?.[0] ?? null
  })
  cache.set(clave, { promesa, en: Date.now() })
  return promesa
}

export const obtenerContacto = () => pedir('contacto', 'datos_contacto')
export const obtenerHorario = () => pedir('horario', 'horario_atencion')
