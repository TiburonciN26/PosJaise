import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

// Fotos de perfil de clientas: el bucket `fotos-clientes` es PRIVADO desde la migración 20261120000004 (antes
// cualquiera con la ruta veía la foto, sin sesión). Se leen con URL firmada: la clienta la suya (carpeta =
// su auth.uid()) y la administradora todas; cualquier otro rol recibe error y se muestran las iniciales.
//
// Una firma por ruta y por hora, compartida por todos los avatares (lista + perfil + menú) mediante una caché
// de módulo con la PROMESA, para que N avatares de la misma clienta pidan una sola firma. Se vuelve a firmar
// cuando faltan menos de 5 minutos para que venza.
export const BUCKET_FOTOS_CLIENTES = 'fotos-clientes'
const DURACION_S = 3600
const MARGEN_MS = 5 * 60 * 1000
const cache = new Map() // ruta → { promesa: Promise<string|null>, vence: ms }

function urlFirmada(ruta) {
  const ahora = Date.now()
  const enCache = cache.get(ruta)
  if (enCache && enCache.vence - MARGEN_MS > ahora) return enCache.promesa
  const promesa = supabase.storage
    .from(BUCKET_FOTOS_CLIENTES)
    .createSignedUrl(ruta, DURACION_S)
    .then(({ data, error }) => {
      if (error || !data?.signedUrl) {
        cache.delete(ruta) // sin permiso o sin archivo: no se recuerda el fallo
        return null
      }
      return data.signedUrl
    })
    .catch(() => {
      cache.delete(ruta)
      return null
    })
  cache.set(ruta, { promesa, vence: ahora + DURACION_S * 1000 })
  return promesa
}

// URL firmada de la foto (o null mientras se firma, si no hay ruta o si no hay permiso).
export function useUrlFotoCliente(ruta) {
  const [firmada, setFirmada] = useState({ ruta: null, url: null })
  useEffect(() => {
    if (!ruta) return undefined
    let vigente = true
    urlFirmada(ruta).then((url) => {
      if (vigente) setFirmada({ ruta, url })
    })
    return () => {
      vigente = false
    }
  }, [ruta])
  return ruta && firmada.ruta === ruta ? firmada.url : null
}
